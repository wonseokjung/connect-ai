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
