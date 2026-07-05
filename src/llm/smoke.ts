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
