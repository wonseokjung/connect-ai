# SPEC-02 — 3-슬롯 라우터 + 설정 + 시크릿 (`src/llm/` 완성)

> 선행 조건: SPEC-01 완료 (`src/llm/types.ts` 등 5개 파일 존재)

## 목표
1. **3-슬롯 라우팅**: `fast`(Ollama 소형) / `worker`(Ollama 중형) / `external`(외부 API)
2. 에이전트 → 슬롯 기본 매핑 + 폴백 체인 (external → worker → fast → legacy)
3. 외부 API 키를 VS Code **SecretStorage**에 저장하는 명령 `connect-ai-lab.connectExternalBrain`
4. 외부 호출 **일일 한도** (초과 시 자동 로컬 폴백)
5. **하위 호환**: 새 설정이 비어 있으면 기존 `ollamaUrl`+`defaultModel` 동작과 100% 동일

## 생성할 파일
```
src/llm/usage.ts    ← 외부 호출 일일 카운터 (순수 node)
src/llm/config.ts   ← 설정·시크릿 (이 파일만 vscode import 허용)
src/llm/router.ts   ← 슬롯 해석 + 폴백 체인 (순수 node)
src/llm/index.ts    ← 공개 API (initLLM, routeChat, ...)
```
## 수정할 파일
```
package.json        ← 설정 스키마 6개 + 명령 1개 추가 (아래 지시 그대로)
```

---

## 파일 1: `src/llm/usage.ts` — 그대로 생성

```ts
/* v3.0 — 외부 API 일일 사용량 카운터. 과금 폭주 방지 가드레일.
   저장 위치: ~/.connect-ai-lab/llm_usage.json  (vscode 비의존) */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface UsageFile { date: string; externalCalls: number; }

function _usagePath(): string {
  return path.join(os.homedir(), '.connect-ai-lab', 'llm_usage.json');
}

function _today(): string {
  return new Date().toISOString().slice(0, 10); /* YYYY-MM-DD */
}

export function readUsage(): UsageFile {
  try {
    const raw = JSON.parse(fs.readFileSync(_usagePath(), 'utf-8'));
    if (raw && raw.date === _today() && typeof raw.externalCalls === 'number') return raw;
  } catch { /* 파일 없음/파손 — 새로 시작 */ }
  return { date: _today(), externalCalls: 0 };
}

export function recordExternalCall(): void {
  const u = readUsage();
  u.externalCalls += 1;
  try {
    fs.mkdirSync(path.dirname(_usagePath()), { recursive: true });
    fs.writeFileSync(_usagePath(), JSON.stringify(u, null, 2));
  } catch (e: any) {
    console.warn('[llm:usage] write failed:', e?.message || e);
  }
}

/** dailyLimit <= 0 이면 무제한 */
export function externalBudgetLeft(dailyLimit: number): boolean {
  if (!dailyLimit || dailyLimit <= 0) return true;
  return readUsage().externalCalls < dailyLimit;
}
```

---

## 파일 2: `src/llm/config.ts` — 그대로 생성

```ts
/* v3.0 — LLM 설정·시크릿. src/llm/ 트리에서 유일하게 vscode 를 import 하는
   파일. API 키는 절대 설정(JSON)에 넣지 않고 SecretStorage 만 사용. */
import * as vscode from 'vscode';
import { ProviderKind, stripSlash } from './types';

const SECRET_KEY = 'connectAiLab.externalApiKey';

let _context: vscode.ExtensionContext | undefined;

export function setLLMContext(context: vscode.ExtensionContext) {
  _context = context;
}

export interface LLMSettings {
  /* 기존 설정 (legacy 엔진) */
  ollamaBase: string;
  defaultModel: string;
  timeoutMs: number;
  /* 신규 슬롯 설정 */
  fastModel: string;
  workerModel: string;
  externalKind: ProviderKind | 'none';
  externalBaseUrl: string;
  externalModel: string;
  externalDailyLimit: number;
}

export function getLLMSettings(): LLMSettings {
  const cfg = vscode.workspace.getConfiguration('connectAiLab');
  let ollamaBase = (cfg.get<string>('ollamaUrl', 'http://127.0.0.1:11434') || '').trim();
  if (!/^https?:\/\//i.test(ollamaBase)) ollamaBase = 'http://127.0.0.1:11434';
  const rawTimeout = cfg.get<number>('requestTimeout', 300);
  const timeoutSec = (typeof rawTimeout === 'number' && isFinite(rawTimeout))
    ? Math.min(1800, Math.max(5, rawTimeout)) : 300;
  const kindRaw = (cfg.get<string>('llm.externalKind', 'none') || 'none').trim();
  const kind: ProviderKind | 'none' =
    kindRaw === 'openai-compat' || kindRaw === 'anthropic-compat' ? kindRaw : 'none';
  return {
    ollamaBase: stripSlash(ollamaBase),
    defaultModel: (cfg.get<string>('defaultModel', '') || '').trim(),
    timeoutMs: timeoutSec * 1000,
    fastModel: (cfg.get<string>('llm.fastModel', '') || '').trim(),
    workerModel: (cfg.get<string>('llm.workerModel', '') || '').trim(),
    externalKind: kind,
    externalBaseUrl: stripSlash(cfg.get<string>('llm.externalBaseUrl', '') || ''),
    externalModel: (cfg.get<string>('llm.externalModel', '') || '').trim(),
    externalDailyLimit: cfg.get<number>('llm.externalDailyLimit', 200) ?? 200
  };
}

export async function getExternalApiKey(): Promise<string> {
  if (!_context) return '';
  return (await _context.secrets.get(SECRET_KEY)) || '';
}

export async function setExternalApiKey(key: string): Promise<void> {
  if (!_context) throw new Error('[llm:config] context not initialized');
  if (key) await _context.secrets.store(SECRET_KEY, key);
  else await _context.secrets.delete(SECRET_KEY);
}

/* v3.0 — 외부 두뇌 연결 마법사. 프리셋 URL은 예시이며 사용자가 수정 가능.
   흐름: 프리셋 선택 → baseUrl/model 확인 → 키 입력(password) → 저장 */
const PRESETS: { label: string; kind: ProviderKind; baseUrl: string; modelHint: string }[] = [
  { label: '💠 GLM Coding Plan (Anthropic 호환)', kind: 'anthropic-compat', baseUrl: 'https://api.z.ai/api/anthropic', modelHint: 'glm-4.7' },
  { label: '🪽 Nous Hermes (OpenAI 호환)', kind: 'openai-compat', baseUrl: 'https://inference-api.nousresearch.com/v1', modelHint: 'Hermes-4-405B' },
  { label: '🌐 OpenRouter (OpenAI 호환)', kind: 'openai-compat', baseUrl: 'https://openrouter.ai/api/v1', modelHint: 'anthropic/claude-sonnet-4' },
  { label: '⚙️ 직접 입력 (OpenAI 호환)', kind: 'openai-compat', baseUrl: '', modelHint: '' },
  { label: '⚙️ 직접 입력 (Anthropic 호환)', kind: 'anthropic-compat', baseUrl: '', modelHint: '' }
];

export function registerExternalBrainCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand('connect-ai-lab.connectExternalBrain', async () => {
    const pick = await vscode.window.showQuickPick(
      [...PRESETS.map(p => p.label), '🗑️ 외부 두뇌 연결 해제'],
      { placeHolder: '외부 두뇌(코딩 플랜/API) 프로바이더를 선택하세요' }
    );
    if (!pick) return;
    if (pick.startsWith('🗑️')) {
      await setExternalApiKey('');
      await vscode.workspace.getConfiguration('connectAiLab').update('llm.externalKind', 'none', vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('외부 두뇌 연결 해제됨 — 100% 로컬 모드로 동작합니다.');
      return;
    }
    const preset = PRESETS.find(p => p.label === pick)!;
    const baseUrl = await vscode.window.showInputBox({
      prompt: 'API Base URL', value: preset.baseUrl, ignoreFocusOut: true
    });
    if (!baseUrl) return;
    const model = await vscode.window.showInputBox({
      prompt: '모델 ID', value: preset.modelHint, ignoreFocusOut: true
    });
    if (!model) return;
    const key = await vscode.window.showInputBox({
      prompt: 'API 키 (SecretStorage에 암호화 저장 — 파일/설정에 남지 않음)',
      password: true, ignoreFocusOut: true
    });
    if (key === undefined) return;
    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    await cfg.update('llm.externalKind', preset.kind, vscode.ConfigurationTarget.Global);
    await cfg.update('llm.externalBaseUrl', baseUrl.trim(), vscode.ConfigurationTarget.Global);
    await cfg.update('llm.externalModel', model.trim(), vscode.ConfigurationTarget.Global);
    await setExternalApiKey(key.trim());
    /* 연결 확인 */
    const { buildProvider } = await import('./router');
    const p = buildProvider({ id: 'external', kind: preset.kind, baseUrl: baseUrl.trim(), model: model.trim(), apiKey: key.trim() });
    const h = await p.health();
    if (h.ok) {
      vscode.window.showInformationMessage(`🧠 외부 두뇌 연결 완료 (${model.trim()}, ${h.latencyMs}ms) — 개발자·리서처 에이전트가 이 두뇌를 사용합니다.`);
    } else {
      vscode.window.showWarningMessage(`외부 두뇌 저장은 됐지만 연결 확인 실패: ${h.error || '알 수 없음'} — URL/키를 확인하세요.`);
    }
  }));
}
```

---

## 파일 3: `src/llm/router.ts` — 그대로 생성

```ts
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
```

---

## 파일 4: `src/llm/index.ts` — 그대로 생성

```ts
/* v3.0 — LLM 모듈 공개 API. extension.ts 는 이 파일만 import 한다. */
import * as vscode from 'vscode';
import { getLLMSettings, getExternalApiKey, setLLMContext, registerExternalBrainCommand } from './config';
import { routeChatWithEnv, RouteRequest, slotForAgent, resolveSlotConfigs, buildProvider } from './router';
import { readUsage } from './usage';
import { ChatResult, LLMSlot } from './types';

export { slotForAgent, buildProvider, resolveSlotConfigs, readUsage };
export * from './types';

export function initLLM(context: vscode.ExtensionContext) {
  setLLMContext(context);
  registerExternalBrainCommand(context);
}

/** 설정·시크릿을 읽어 라우팅 호출. extension.ts 의 표준 진입점. */
export async function routeChat(req: RouteRequest): Promise<ChatResult> {
  const s = getLLMSettings();
  const externalApiKey = await getExternalApiKey();
  return routeChatWithEnv({ ...s, externalApiKey }, req);
}

/** UI 표시용 — 현재 슬롯 구성 + 오늘 외부 사용량 요약 */
export async function getLLMStatus() {
  const s = getLLMSettings();
  const externalApiKey = await getExternalApiKey();
  const cfgs = resolveSlotConfigs({ ...s, externalApiKey });
  const usage = readUsage();
  return {
    slots: {
      fast: cfgs.fast ? { model: cfgs.fast.model, kind: cfgs.fast.kind } : null,
      worker: cfgs.worker ? { model: cfgs.worker.model, kind: cfgs.worker.kind } : null,
      external: cfgs.external ? { model: cfgs.external.model, kind: cfgs.external.kind } : null
    },
    externalToday: usage.externalCalls,
    externalDailyLimit: s.externalDailyLimit
  };
}
```

---

## package.json 수정 (2곳)

### (a) `contributes.configuration.properties` 에 아래 6개 키 추가
기존 `connectAiLab.ollamaUrl` 프로퍼티가 있는 객체와 같은 레벨에 추가한다:

```json
"connectAiLab.llm.fastModel": {
  "type": "string",
  "default": "",
  "description": "🚀 Slot A — 빠른 로컬 모델 (CEO 라우팅·분류·요약용, 예: qwen3:4b). 비우면 defaultModel 사용."
},
"connectAiLab.llm.workerModel": {
  "type": "string",
  "default": "",
  "description": "🏗️ Slot B — 일꾼 로컬 모델 (전문 에이전트 일반 작업, 예: qwen3:14b). 비우면 defaultModel 사용."
},
"connectAiLab.llm.externalKind": {
  "type": "string",
  "enum": ["none", "openai-compat", "anthropic-compat"],
  "default": "none",
  "description": "🧠 Slot C — 외부 두뇌 종류. anthropic-compat = GLM 코딩 플랜 등, openai-compat = Hermes/OpenRouter 등. 'Connect AI: 외부 두뇌 연결' 명령으로 설정 권장."
},
"connectAiLab.llm.externalBaseUrl": {
  "type": "string",
  "default": "",
  "description": "외부 두뇌 API Base URL (예: https://api.z.ai/api/anthropic)"
},
"connectAiLab.llm.externalModel": {
  "type": "string",
  "default": "",
  "description": "외부 두뇌 모델 ID (예: glm-4.7)"
},
"connectAiLab.llm.externalDailyLimit": {
  "type": "number",
  "default": 200,
  "description": "외부 두뇌 일일 호출 한도. 초과 시 자동으로 로컬 모델 폴백. 0 = 무제한."
}
```

### (b) `contributes.commands` 배열에 아래 항목 추가

```json
{
  "command": "connect-ai-lab.connectExternalBrain",
  "title": "Connect AI: 🧠 외부 두뇌 연결 (코딩 플랜/외부 API)"
}
```

> **주의**: JSON에 주석 넣지 말 것. 콤마 위치 확인. 다른 프로퍼티 삭제·수정 금지.

---

## 검증 절차
1. `npm run compile` → 에러 0
2. `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('json ok')"` → `json ok`
3. `grep -n "from 'vscode'" src/llm/*.ts` → **config.ts 와 index.ts 두 파일에서만** 나와야 함
4. `npx esbuild src/llm/smoke.ts --bundle --platform=node --outfile=out/llm-smoke.js && node out/llm-smoke.js` → SPEC-01과 동일하게 통과 (라우터 추가로 깨지지 않았는지)

## 완료 기준
- [ ] 새 파일 4개 생성 + package.json 2곳 수정, 그 외 수정 0
- [ ] 검증 1~4 통과
- [ ] `routeChatWithEnv`는 vscode 없이 호출 가능 (테스트 가능성 유지)
