# SPEC-01 — LLM 프로바이더 코어 모듈 (`src/llm/`)

## 목표
Ollama · OpenAI-호환(LM Studio, Hermes/OpenRouter 등) · Anthropic-호환(GLM 코딩 플랜 등)
3종 백엔드를 **동일한 인터페이스**로 호출하는 순수 모듈을 만든다.
이 스펙에서는 **기존 파일을 하나도 수정하지 않는다.** 새 파일 5개만 생성한다.

## 생성할 파일
```
src/llm/types.ts            ← 공용 타입
src/llm/ollama.ts           ← Ollama 프로바이더
src/llm/openai-compat.ts    ← OpenAI 호환 프로바이더 (LM Studio 포함)
src/llm/anthropic-compat.ts ← Anthropic 호환 프로바이더 (코딩 플랜용)
src/llm/smoke.ts            ← VS Code 없이 도는 스모크 테스트
```
**주의: 이 5개 파일 어디에서도 `vscode`를 import하지 않는다.**

---

## 파일 1: `src/llm/types.ts` — 아래 코드 그대로 생성

```ts
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
```

---

## 파일 2: `src/llm/ollama.ts` — 아래 코드 그대로 생성

```ts
/* v3.0 — Ollama 프로바이더. POST {base}/api/chat
   스트리밍: NDJSON 라인 ({"message":{"content":"..."},"done":false})
   비전: 마지막 user 메시지의 images(base64 배열)를 Ollama 형식 그대로 전달. */
import axios from 'axios';
import {
  LLMProvider, ProviderConfig, ChatMessage, ChatOptions, HealthResult,
  DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TOKENS, stripSlash
} from './types';

export class OllamaProvider implements LLMProvider {
  constructor(public readonly cfg: ProviderConfig) {}

  private _url(): string { return `${stripSlash(this.cfg.baseUrl)}/api/chat`; }

  private _body(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
    const msgs = messages.map(m => {
      const out: any = { role: m.role, content: m.content };
      if (m.images && m.images.length > 0) out.images = m.images;
      return out;
    });
    return {
      model: this.cfg.model,
      messages: msgs,
      stream,
      options: {
        num_predict: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: opts.temperature ?? 0.7,
        ...(opts.topP !== undefined ? { top_p: opts.topP } : {})
      }
    };
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!opts.onToken) {
      const r = await axios.post(this._url(), this._body(messages, opts, false), {
        timeout, signal: opts.signal
      });
      return r.data?.message?.content?.toString() ?? '';
    }
    /* 스트리밍 — NDJSON 라인 파싱 */
    const r = await axios.post(this._url(), this._body(messages, opts, true), {
      timeout, signal: opts.signal, responseType: 'stream'
    });
    return await new Promise<string>((resolve, reject) => {
      let full = '';
      let buffer = '';
      const stream = r.data;
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            const token = json?.message?.content ?? '';
            if (token) { full += token; opts.onToken!(token); }
            if (json?.error) reject(new Error(`[llm:${this.cfg.id}] ${json.error}`));
          } catch { /* 불완전 라인 — 다음 청크에서 이어짐 */ }
        }
      });
      stream.on('end', () => resolve(full));
      stream.on('error', (e: Error) => reject(new Error(`[llm:${this.cfg.id}] ${e.message}`)));
    });
  }

  async health(): Promise<HealthResult> {
    const t0 = Date.now();
    try {
      await axios.get(`${stripSlash(this.cfg.baseUrl)}/api/tags`, { timeout: 3000 });
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - t0, error: e?.message || String(e) };
    }
  }
}
```

---

## 파일 3: `src/llm/openai-compat.ts` — 아래 코드 그대로 생성

```ts
/* v3.0 — OpenAI 호환 프로바이더. LM Studio(로컬)와 외부 API(Hermes/OpenRouter/
   Together 등)를 모두 커버. POST {base}/v1/chat/completions
   baseUrl 정규화: 끝이 /v1 이 아니면 /v1 을 붙인다.
   (LM Studio: http://localhost:1234 → .../v1/chat/completions
    OpenRouter: https://openrouter.ai/api/v1 → 그대로 사용) */
import axios from 'axios';
import {
  LLMProvider, ProviderConfig, ChatMessage, ChatOptions, HealthResult,
  DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TOKENS, stripSlash
} from './types';

export class OpenAICompatProvider implements LLMProvider {
  constructor(public readonly cfg: ProviderConfig) {}

  private _base(): string {
    const b = stripSlash(this.cfg.baseUrl);
    return /\/v1$/.test(b) ? b : `${b}/v1`;
  }

  private _headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) h['Authorization'] = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  private _messages(messages: ChatMessage[]): any[] {
    return messages.map((m, i) => {
      const isLast = i === messages.length - 1;
      if (m.images && m.images.length > 0 && isLast && m.role === 'user') {
        const parts: any[] = [{ type: 'text', text: m.content }];
        for (const img of m.images) {
          parts.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } });
        }
        return { role: m.role, content: parts };
      }
      return { role: m.role, content: m.content };
    });
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = `${this._base()}/chat/completions`;
    const body: any = {
      model: this.cfg.model,
      messages: this._messages(messages),
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 0.7,
      ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
      stream: !!opts.onToken
    };
    if (!opts.onToken) {
      const r = await axios.post(url, body, { timeout, signal: opts.signal, headers: this._headers() });
      if (r.data?.error) throw new Error(`[llm:${this.cfg.id}] ${r.data.error.message || JSON.stringify(r.data.error)}`);
      return r.data?.choices?.[0]?.message?.content?.toString() ?? '';
    }
    /* 스트리밍 — SSE (data: {...} / data: [DONE]) */
    const r = await axios.post(url, body, {
      timeout, signal: opts.signal, headers: this._headers(), responseType: 'stream'
    });
    return await new Promise<string>((resolve, reject) => {
      let full = '';
      let buffer = '';
      const stream = r.data;
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t || t === 'data: [DONE]') continue;
          const raw = t.startsWith('data: ') ? t.slice(6) : t;
          try {
            const json = JSON.parse(raw);
            if (json?.error) { reject(new Error(`[llm:${this.cfg.id}] ${json.error.message || JSON.stringify(json.error)}`)); return; }
            const token = json?.choices?.[0]?.delta?.content ?? '';
            if (token) { full += token; opts.onToken!(token); }
          } catch { /* 불완전 라인 */ }
        }
      });
      stream.on('end', () => resolve(full));
      stream.on('error', (e: Error) => reject(new Error(`[llm:${this.cfg.id}] ${e.message}`)));
    });
  }

  async health(): Promise<HealthResult> {
    const t0 = Date.now();
    try {
      await axios.get(`${this._base()}/models`, { timeout: 5000, headers: this._headers() });
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - t0, error: e?.message || String(e) };
    }
  }
}
```

---

## 파일 4: `src/llm/anthropic-compat.ts` — 아래 코드 그대로 생성

```ts
/* v3.0 — Anthropic 호환 프로바이더. GLM Coding Plan 등 "코딩 플랜" 구독형
   API가 Anthropic /v1/messages 형식을 제공하므로 이 kind 하나로 커버.
   POST {base}/v1/messages
   - system 롤은 최상위 system 필드로 분리 (Anthropic 규격)
   - 스트리밍: SSE, type === 'content_block_delta' 의 delta.text 누적
   baseUrl 정규화: 끝이 /v1 이면 {base}/messages, 아니면 {base}/v1/messages */
import axios from 'axios';
import {
  LLMProvider, ProviderConfig, ChatMessage, ChatOptions, HealthResult,
  DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TOKENS, stripSlash
} from './types';

export class AnthropicCompatProvider implements LLMProvider {
  constructor(public readonly cfg: ProviderConfig) {}

  private _url(): string {
    const b = stripSlash(this.cfg.baseUrl);
    return /\/v1$/.test(b) ? `${b}/messages` : `${b}/v1/messages`;
  }

  private _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.cfg.apiKey || '',
      'anthropic-version': '2023-06-01'
    };
  }

  private _body(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const rest = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.images && m.images.length > 0 && m.role === 'user') {
          const parts: any[] = m.images.map(img => ({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: img }
          }));
          parts.push({ type: 'text', text: m.content });
          return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
      });
    /* Anthropic 규격: messages는 user로 시작해야 함 */
    if (rest.length === 0 || rest[0].role !== 'user') {
      rest.unshift({ role: 'user', content: '(계속)' });
    }
    return {
      model: this.cfg.model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 0.7,
      ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
      ...(system ? { system } : {}),
      messages: rest,
      stream
    };
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!opts.onToken) {
      const r = await axios.post(this._url(), this._body(messages, opts, false), {
        timeout, signal: opts.signal, headers: this._headers()
      });
      if (r.data?.error) throw new Error(`[llm:${this.cfg.id}] ${r.data.error.message || JSON.stringify(r.data.error)}`);
      const blocks = Array.isArray(r.data?.content) ? r.data.content : [];
      return blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
    }
    const r = await axios.post(this._url(), this._body(messages, opts, true), {
      timeout, signal: opts.signal, headers: this._headers(), responseType: 'stream'
    });
    return await new Promise<string>((resolve, reject) => {
      let full = '';
      let buffer = '';
      const stream = r.data;
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t || !t.startsWith('data: ')) continue; /* event: 라인은 무시 */
          try {
            const json = JSON.parse(t.slice(6));
            if (json?.type === 'content_block_delta') {
              const token = json?.delta?.text ?? '';
              if (token) { full += token; opts.onToken!(token); }
            } else if (json?.type === 'error') {
              reject(new Error(`[llm:${this.cfg.id}] ${json?.error?.message || 'stream error'}`));
              return;
            }
          } catch { /* 불완전 라인 */ }
        }
      });
      stream.on('end', () => resolve(full));
      stream.on('error', (e: Error) => reject(new Error(`[llm:${this.cfg.id}] ${e.message}`)));
    });
  }

  /** Anthropic 계열엔 무과금 헬스 엔드포인트가 없어 max_tokens:1 초소형 호출로 확인 */
  async health(): Promise<HealthResult> {
    const t0 = Date.now();
    try {
      await axios.post(this._url(), {
        model: this.cfg.model, max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }, { timeout: 15000, headers: this._headers() });
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - t0, error: e?.response?.data?.error?.message || e?.message || String(e) };
    }
  }
}
```

---

## 파일 5: `src/llm/smoke.ts` — 아래 코드 그대로 생성

```ts
/* v3.0 — 스모크 테스트. VS Code 밖에서 프로바이더 3종을 직접 두드린다.
   실행:
     npx esbuild src/llm/smoke.ts --bundle --platform=node --outfile=out/llm-smoke.js
     node out/llm-smoke.js                          # 로컬 Ollama만
     SMOKE_EXT_KIND=anthropic-compat SMOKE_EXT_URL=... SMOKE_EXT_MODEL=... SMOKE_EXT_KEY=... node out/llm-smoke.js */
import { OllamaProvider } from './ollama';
import { OpenAICompatProvider } from './openai-compat';
import { AnthropicCompatProvider } from './anthropic-compat';
import { ChatMessage, LLMProvider } from './types';

const MSGS: ChatMessage[] = [
  { role: 'system', content: '한 단어로만 답하라.' },
  { role: 'user', content: '1+1은?' }
];

async function tryProvider(name: string, p: LLMProvider) {
  const h = await p.health();
  console.log(`[${name}] health: ok=${h.ok} ${h.latencyMs}ms ${h.error || ''}`);
  if (!h.ok) return;
  try {
    let streamed = '';
    const text = await p.chat(MSGS, { maxTokens: 32, temperature: 0, onToken: t => { streamed += t; } });
    console.log(`[${name}] chat(stream): "${text.trim()}" (streamed ${streamed.length} chars)`);
    const text2 = await p.chat(MSGS, { maxTokens: 32, temperature: 0 });
    console.log(`[${name}] chat(sync): "${text2.trim()}"`);
  } catch (e: any) {
    console.log(`[${name}] chat FAILED: ${e?.message || e}`);
  }
}

(async () => {
  const ollamaModel = process.env.SMOKE_OLLAMA_MODEL || 'qwen3:4b';
  await tryProvider('ollama', new OllamaProvider({
    id: 'smoke-ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: ollamaModel
  }));
  await tryProvider('lmstudio', new OpenAICompatProvider({
    id: 'smoke-lmstudio', kind: 'openai-compat', baseUrl: 'http://127.0.0.1:1234', model: process.env.SMOKE_LM_MODEL || ''
  }));
  const kind = process.env.SMOKE_EXT_KIND;
  if (kind && process.env.SMOKE_EXT_URL && process.env.SMOKE_EXT_MODEL) {
    const cfg = {
      id: 'smoke-external', kind: kind as any,
      baseUrl: process.env.SMOKE_EXT_URL!, model: process.env.SMOKE_EXT_MODEL!,
      apiKey: process.env.SMOKE_EXT_KEY
    };
    const p = kind === 'anthropic-compat' ? new AnthropicCompatProvider(cfg) : new OpenAICompatProvider(cfg);
    await tryProvider('external', p);
  } else {
    console.log('[external] SMOKE_EXT_KIND/URL/MODEL 미설정 — 건너뜀');
  }
})().then(() => {
  /* axios keep-alive 소켓이 남아도 스모크 CLI는 결과 출력 후 종료한다. */
  process.exit(0);
}).catch((e: any) => {
  console.error(`[smoke] FAILED: ${e?.message || e}`);
  process.exit(1);
});
```

---

## 검증 절차 (순서대로 실행하고 결과 보고)

1. `npm run compile` → 에러 0 (smoke.ts는 extension 번들에 포함되지 않지만 타입 오류는 tsc watch에서 걸림)
2. `npx esbuild src/llm/smoke.ts --bundle --platform=node --outfile=out/llm-smoke.js` → 에러 0
3. Ollama가 떠 있는 상태에서 `node out/llm-smoke.js` → `[ollama] chat(stream)`과 `chat(sync)`에 "2" 유사 응답
4. (선택) 외부 API 키가 있으면 SMOKE_EXT_* 환경변수로 external도 확인

## 완료 기준
- [ ] 새 파일 5개 생성, 기존 파일 수정 0
- [ ] `src/llm/*.ts` 어디에도 `vscode` import 없음 (`grep -n "from 'vscode'" src/llm/*.ts` → 결과 없음)
- [ ] 검증 1~3 통과
