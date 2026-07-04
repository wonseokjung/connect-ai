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
