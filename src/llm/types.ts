/* v3.0 — LLM 프로바이더 공용 타입. extension.ts에 7곳 이상 복붙돼 있던
   Ollama/LM Studio fetch 로직을 단일 인터페이스로 수렴하기 위한 기반.
   이 모듈 트리는 config.ts 를 제외하고 vscode 에 의존하지 않는다 (스모크
   테스트를 순수 node 로 돌리기 위해). */

export type ProviderKind = 'ollama' | 'openai-compat' | 'anthropic-compat';

/** 라우팅 슬롯 — 에이전트는 모델이 아니라 슬롯에 매핑된다.
 *  fast: 로컬 소형 (라우팅·분류·요약) / worker: 로컬 중형 (일반 작업)
 *  external: 외부 API (코딩 플랜·Hermes 등, 고난도 작업) */
export type LLMSlot = 'fast' | 'worker' | 'external';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** base64 이미지 (data: prefix 없이). 비전 모델용, 마지막 user 메시지에만 유효 */
  images?: string[];
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 지정하면 스트리밍 모드 — 토큰 조각이 도착할 때마다 호출됨 */
  onToken?: (token: string) => void;
}

export interface ProviderConfig {
  /** 'ollama-fast' | 'ollama-worker' | 'external' | 'legacy' */
  id: string;
  kind: ProviderKind;
  /** 끝 슬래시 없는 base URL. 예: http://127.0.0.1:11434 / https://api.z.ai/api/anthropic */
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface LLMProvider {
  readonly cfg: ProviderConfig;
  /** 전체 응답 텍스트 반환. opts.onToken 지정 시 스트리밍하며 동일 텍스트 반환 */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
  health(): Promise<HealthResult>;
}

export interface ChatResult {
  text: string;
  /** 실제 사용된 프로바이더 id */
  provider: string;
  model: string;
  /** 1순위 프로바이더가 실패해서 폴백으로 처리됐는지 */
  fellBack: boolean;
  latencyMs: number;
}

export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_TOKENS = 4096;

/** 끝 슬래시 제거 */
export function stripSlash(u: string): string {
  return (u || '').trim().replace(/\/+$/, '');
}
