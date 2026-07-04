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
