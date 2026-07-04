/* v3.0 — 3-슬롯 라우터. 에이전트는 모델이 아니라 슬롯(fast/worker/external)에
   매핑되고, 슬롯은 폴백 체인을 갖는다:
     external 요청 → [external, worker, fast]
     worker   요청 → [worker, fast]
     fast     요청 → [fast, worker]
   신규 설정이 전부 비어 있으면 legacy(기존 ollamaUrl+defaultModel) 프로바이더
   하나로 수렴 — 기존 사용자 동작 100% 보존. */
import {
  LLMProvider, LLMSlot, ProviderConfig, ProviderKind,
  ChatMessage, ChatOptions, ChatResult
} from './types';
import { OllamaProvider } from './ollama';
import { OpenAICompatProvider } from './openai-compat';
import { AnthropicCompatProvider } from './anthropic-compat';
import { externalBudgetLeft, recordExternalCall } from './usage';

export function buildProvider(cfg: ProviderConfig): LLMProvider {
  if (cfg.kind === 'ollama') return new OllamaProvider(cfg);
  if (cfg.kind === 'anthropic-compat') return new AnthropicCompatProvider(cfg);
  return new OpenAICompatProvider(cfg);
}

/* 기존 _isLMStudioEngine 과 동일한 휴리스틱 — legacy 엔진 종류 판별 */
export function legacyKind(ollamaBase: string): ProviderKind {
  return (ollamaBase.includes('1234') || ollamaBase.includes('v1')) ? 'openai-compat' : 'ollama';
}

/** 에이전트 기본 슬롯. 여기 없는 id는 worker. */
export const AGENT_DEFAULT_SLOT: Record<string, LLMSlot> = {
  ceo: 'fast',
  secretary: 'fast',
  developer: 'external',
  researcher: 'external',
  youtube: 'worker',
  instagram: 'worker',
  designer: 'worker',
  business: 'worker',
  editor: 'worker',
  writer: 'worker'
};

export function slotForAgent(agentId: string): LLMSlot {
  return AGENT_DEFAULT_SLOT[agentId] || 'worker';
}

/** 라우터가 필요로 하는 해석된 설정 — config.ts(vscode) 또는 테스트가 주입 */
export interface RouterEnv {
  ollamaBase: string;
  defaultModel: string;
  timeoutMs: number;
  fastModel: string;
  workerModel: string;
  externalKind: ProviderKind | 'none';
  externalBaseUrl: string;
  externalModel: string;
  externalApiKey: string;
  externalDailyLimit: number;
}

export function resolveSlotConfigs(env: RouterEnv): Record<LLMSlot, ProviderConfig | undefined> {
  const lk = legacyKind(env.ollamaBase);
  const legacy: ProviderConfig | undefined = env.defaultModel
    ? { id: 'legacy', kind: lk, baseUrl: env.ollamaBase, model: env.defaultModel }
    : undefined;
  const fast: ProviderConfig | undefined = env.fastModel
    ? { id: 'ollama-fast', kind: lk, baseUrl: env.ollamaBase, model: env.fastModel }
    : legacy;
  const worker: ProviderConfig | undefined = env.workerModel
    ? { id: 'ollama-worker', kind: lk, baseUrl: env.ollamaBase, model: env.workerModel }
    : legacy;
  const external: ProviderConfig | undefined =
    (env.externalKind !== 'none' && env.externalBaseUrl && env.externalModel && env.externalApiKey)
      ? { id: 'external', kind: env.externalKind, baseUrl: env.externalBaseUrl, model: env.externalModel, apiKey: env.externalApiKey }
      : undefined;
  return { fast, worker, external };
}

export interface RouteRequest {
  /** 슬롯 직접 지정. 없으면 agentId 로 결정, 둘 다 없으면 worker */
  slot?: LLMSlot;
  agentId?: string;
  /** 에이전트별 모델 오버라이드 (기존 getAgentModel 결과). 있으면 로컬 슬롯 모델을 덮어씀 */
  modelOverride?: string;
  messages: ChatMessage[];
  opts?: ChatOptions;
}

export async function routeChatWithEnv(env: RouterEnv, req: RouteRequest): Promise<ChatResult> {
  const slot: LLMSlot = req.slot || (req.agentId ? slotForAgent(req.agentId) : 'worker');
  const cfgs = resolveSlotConfigs(env);

  /* 폴백 체인 구성 */
  const chainSlots: LLMSlot[] =
    slot === 'external' ? ['external', 'worker', 'fast']
      : slot === 'worker' ? ['worker', 'fast']
        : ['fast', 'worker'];

  const chain: ProviderConfig[] = [];
  for (const s of chainSlots) {
    let c = cfgs[s];
    if (!c) continue;
    /* 외부 예산 초과 시 external 은 체인에서 제외 → 자동 로컬 폴백 */
    if (s === 'external' && !externalBudgetLeft(env.externalDailyLimit)) continue;
    /* 사용자 지정 모델 오버라이드는 로컬 슬롯에만 적용 (외부 모델명과 충돌 방지).
       kind 비교가 아니라 id 비교 — 외부가 openai-compat 이고 로컬 엔진이
       LM Studio(동일 kind)인 경우에도 로컬 슬롯엔 오버라이드가 먹어야 함. */
    if (req.modelOverride && c.id !== 'external') {
      c = { ...c, model: req.modelOverride };
    }
    /* 동일 (kind+baseUrl+model) 중복 제거 */
    if (!chain.some(x => x.kind === c!.kind && x.baseUrl === c!.baseUrl && x.model === c!.model)) {
      chain.push(c);
    }
  }
  if (chain.length === 0) {
    throw new Error('[llm:router] 사용 가능한 모델이 없습니다. Ollama/LM Studio 실행 또는 모델 설정을 확인하세요.');
  }

  const opts: ChatOptions = { timeoutMs: env.timeoutMs, ...(req.opts || {}) };
  let lastErr: any;
  for (let i = 0; i < chain.length; i++) {
    const cfg = chain[i];
    const t0 = Date.now();
    try {
      const provider = buildProvider(cfg);
      const text = await provider.chat(req.messages, opts);
      if (cfg.id === 'external') recordExternalCall();
      return {
        text, provider: cfg.id, model: cfg.model,
        fellBack: i > 0, latencyMs: Date.now() - t0
      };
    } catch (e: any) {
      lastErr = e;
      console.warn(`[llm:router] ${cfg.id}(${cfg.model}) 실패 → 다음 폴백 시도:`, e?.message || e);
      /* 사용자 취소(abort)는 폴백하지 않고 즉시 전파 */
      if (opts.signal?.aborted) throw e;
    }
  }
  throw new Error(`[llm:router] 모든 프로바이더 실패 (마지막 오류: ${lastErr?.message || lastErr})`);
}
