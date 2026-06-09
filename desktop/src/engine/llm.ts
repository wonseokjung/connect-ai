// 로컬 LLM 클라이언트 (LM Studio / Ollama 자동 감지) — vscode 의존성 없음.
// 익스텐션의 _callAgentLLM 핵심 로직을 데스크톱용으로 추출·단순화.
import axios from 'axios';

export interface LlmTarget { base: string; model: string; engine: 'lmstudio' | 'ollama' | 'gemini'; key?: string; }
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

// 1234=LM Studio, 1235=Connect AI 내장 엔진(localengine) — 둘 다 OpenAI 호환이라 동일 경로로 처리.
const isLMStudio = (base: string) => /:(1234|1235)(\/|$)/.test(base) || /lm[-_]?studio/i.test(base);

// 채팅용이 아닌 모델 — 임베딩·오디오·이미지·rerank 등은 비서 모델로 부적합. 자동 선택에서 제외.
const NON_CHAT = /embed|ace-step|whisper|\btts\b|rerank|\bclip\b|sdxl|stable-diffusion|\bflux\b|bark|musicgen|nomic|reranker/i;

interface ModelInfo { id: string; loaded: boolean; chat: boolean; }

// 한 엔진을 조사 → 모델 목록 + 각 모델의 (로드 여부 / 채팅 가능 여부).
async function probe(base: string): Promise<{ engine: 'lmstudio' | 'ollama'; models: ModelInfo[] } | null> {
  if (isLMStudio(base)) {
    // LM Studio 네이티브 API — state(loaded)·type(llm/vlm/embeddings) 제공
    try {
      const r = await axios.get(`${base}/api/v0/models`, { timeout: 1500 });
      const arr = r.data?.data || [];
      if (arr.length) return {
        engine: 'lmstudio',
        models: arr.map((m: any) => ({
          id: m.id,
          loaded: m.state === 'loaded',
          chat: /llm|vlm/i.test(m.type || '') && m.type !== 'embeddings' && !NON_CHAT.test(m.id),
        })),
      };
    } catch { /* 구버전 — OpenAI 호환으로 폴백 */ }
    try {
      const r = await axios.get(`${base}/v1/models`, { timeout: 1500 });
      const arr = r.data?.data || [];
      if (arr.length) return { engine: 'lmstudio', models: arr.map((m: any) => ({ id: m.id, loaded: true, chat: !NON_CHAT.test(m.id) })) };
    } catch { /* */ }
    return null;
  }
  // Ollama — /api/tags(전체) + /api/ps(현재 로드/실행 중)
  try {
    const tags = (await axios.get(`${base}/api/tags`, { timeout: 1500 })).data?.models || [];
    if (!tags.length) return null;
    let loaded: string[] = [];
    try { loaded = ((await axios.get(`${base}/api/ps`, { timeout: 1500 })).data?.models || []).map((m: any) => m.name); } catch { /* ps 미지원 */ }
    return { engine: 'ollama', models: tags.map((m: any) => ({ id: m.name, loaded: loaded.includes(m.name), chat: !NON_CHAT.test(m.name) })) };
  } catch { return null; }
}

// 채팅 가능 모델만, 로드된 것(=사용자가 LM Studio에 띄운 것) 먼저. 단순하게 로드된 걸 그대로 쓴다.
function rank(models: ModelInfo[]): ModelInfo[] {
  return models.filter(m => m.chat).sort((a, b) => (b.loaded ? 1 : 0) - (a.loaded ? 1 : 0));
}

// 엔진 자동 감지 → 로드된 채팅 모델 우선 선택. 사용자가 base/model 지정 시 우선.
export async function detectTarget(pref?: Partial<LlmTarget>): Promise<LlmTarget | null> {
  // ☁️ Gemini 고성능 두뇌 — 모델이 gemini* 이고 키가 있으면 클라우드(OpenAI 호환)로
  if (pref?.model && /^gemini/i.test(pref.model) && pref?.key) {
    return { base: GEMINI_BASE, model: pref.model, engine: 'gemini', key: pref.key };
  }
  const candidates = [pref?.base, 'http://127.0.0.1:1234', 'http://127.0.0.1:11434', 'http://127.0.0.1:1235'].filter(Boolean) as string[];
  for (const base of candidates) {
    const p = await probe(base);
    if (!p) continue;
    const ranked = rank(p.models);
    const model = pref?.model || ranked[0]?.id || p.models[0]?.id;
    if (model) return { base, model, engine: p.engine };
  }
  return null;
}

// 드롭다운용 목록 — 채팅 모델만, 로드된 것 먼저. loaded = 현재 로드된 모델 이름.
export async function listModels(pref?: Partial<LlmTarget>): Promise<{ base: string; engine: 'lmstudio' | 'ollama'; models: string[]; loaded: string | null } | null> {
  const candidates = [pref?.base, 'http://127.0.0.1:1234', 'http://127.0.0.1:11434', 'http://127.0.0.1:1235'].filter(Boolean) as string[];
  for (const base of candidates) {
    const p = await probe(base);
    if (!p) continue;
    const ranked = rank(p.models);
    if (!ranked.length) continue;
    return { base, engine: p.engine, models: ranked.map(m => m.id), loaded: ranked.find(m => m.loaded)?.id || null };
  }
  return null;
}

// 🧠 임베딩 — 두뇌 의미 검색용. LM Studio 에 임베딩 모델 있으면 사용, 없으면 null(키워드 폴백).
let _embModel: string | null | undefined;
export async function embed(base: string, text: string): Promise<number[] | null> {
  const b = base || 'http://127.0.0.1:1234';
  if (_embModel === undefined) {
    try {
      const r = await axios.get(`${b}/v1/models`, { timeout: 1500 });
      const ids = (r.data?.data || []).map((x: any) => x.id);
      _embModel = ids.find((id: string) => /embed|nomic|bge|gte|e5/i.test(id)) || null;
    } catch { _embModel = null; }
  }
  if (!_embModel) return null;
  try {
    const r = await axios.post(`${b}/v1/embeddings`, { model: _embModel, input: (text || '').slice(0, 6000) }, { timeout: 15000 });
    return r.data?.data?.[0]?.embedding || null;
  } catch { return null; }
}

export interface ChatOpts { temperature?: number; onToken?: (t: string) => void; signal?: AbortSignal; frequencyPenalty?: number; presencePenalty?: number; }
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | any[] | null; tool_calls?: any[]; tool_call_id?: string; name?: string; }   // 배열 content = 비전, tool 역할/tool_calls = 네이티브 함수 호출

// 네이티브 함수(도구) 호출 — OpenAI 호환(LM Studio/Ollama/Gemini). 모델이 tool_calls 를 구조화해서 반환.
export interface ToolSchema { type: 'function'; function: { name: string; description: string; parameters: any }; }
export interface ToolUse { id: string; name: string; args: any; }
// 🧩 빡빡한 chat 템플릿(Mistral/Zephyr 등 — system 미지원·역할 교차 강제) 대응:
//   system을 첫 user에 합치고, 같은 역할 연속을 병합하고, user로 시작하게 평탄화한다.
function flattenMessages(messages: ChatMessage[]): ChatMessage[] {
  let sys = '';
  const rest: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') sys += (sys ? '\n\n' : '') + (m.content || '');
    else rest.push({ role: m.role, content: m.content || '' } as ChatMessage);
  }
  if (sys) {
    const fu = rest.find(m => m.role === 'user');
    if (fu) fu.content = sys + '\n\n' + fu.content;
    else rest.unshift({ role: 'user', content: sys } as ChatMessage);
  }
  while (rest.length && rest[0].role !== 'user') rest.shift();
  const out: ChatMessage[] = [];
  for (const m of rest) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + m.content;
    else out.push(m);
  }
  return out;
}
const isTemplateErr = (e: any) => { const m = String(e?.response?.data?.error?.message || e?.response?.data?.error || e?.response?.data?.message || e?.message || ''); return /template|alternate|parser|roles must|jinja|raise_exception|system role/i.test(m); };

export async function completeWithTools(t: LlmTarget, messages: ChatMessage[], tools: ToolSchema[], opts: ChatOpts = {}): Promise<{ content: string; reasoning: string; toolCalls: ToolUse[]; message: any }> {
  const url = t.engine === 'gemini' ? `${t.base}/chat/completions` : `${t.base}/v1/chat/completions`;
  const headers: any = t.key ? { Authorization: `Bearer ${t.key}` } : {};
  const body: any = { model: t.model, messages, temperature: opts.temperature ?? 0.4, stream: false };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  let r;
  try {
    r = await axios.post(url, body, { timeout: 180000, signal: opts.signal as any, headers });
  } catch (e: any) {
    // 🛠️ 일부 모델은 chat template이 도구 호출을 지원 안 해 tools 요청에 400/500을 낸다(llama-server --jinja).
    //    → tools 빼고 재시도. 앱은 태그 기반 도구 폴백(parseTextTools)으로 그대로 동작한다. (사용자 "status code 400" 해결)
    const status = e?.response?.status;
    if (status === 400 || status === 500) {
      // tools 제거 + (템플릿이 빡빡하면) 메시지 평탄화로 재시도 → 어떤 모델이든 답하게
      delete body.tools; delete body.tool_choice;
      if (isTemplateErr(e)) body.messages = flattenMessages(messages);
      r = await axios.post(url, body, { timeout: 180000, signal: opts.signal as any, headers });
    } else throw e;
  }
  const msg = r.data?.choices?.[0]?.message || {};
  const toolCalls: ToolUse[] = (msg.tool_calls || []).map((tc: any, i: number) => {
    let args: any = {};
    const raw = tc?.function?.arguments;
    try { args = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { args = {}; }
    return { id: tc.id || `call_${i}`, name: tc?.function?.name || '', args };
  });
  // reasoning 모델(gemma/qwen 등)은 도구호출·답을 reasoning_content 에 넣기도 함 → 같이 노출(태그 폴백용)
  return { content: msg.content || '', reasoning: msg.reasoning_content || msg.reasoning || '', toolCalls, message: msg };
}

// 🔎 에러에서 사람이 읽을 '원인'을 뽑아낸다 — 서버가 준 상세 메시지 + HTTP 상태 + 흔한 원인 힌트.
//    (사용자가 "status code 400" 만 보고 원인을 모르던 문제 해결)
export function apiError(e: any): string {
  if (!e) return '알 수 없는 오류';
  const d = e?.response?.data;
  let detail = d ? (d?.error?.message || (typeof d?.error === 'string' ? d.error : '') || d?.message || (typeof d === 'string' ? d : '')) : '';
  const code = e?.code || '';
  detail = String(detail || e?.message || code || e).replace(/\s+/g, ' ').trim().slice(0, 240);
  const status = e?.response?.status;
  let hint = '';
  if (status === 400) hint = /tool|template|jinja|function/i.test(detail) ? ' — 이 모델이 도구 호출을 지원하지 않아요(⚙️ 설정에서 🛠️ 파일 도구를 끄거나, 도구 지원 모델을 쓰세요)' : ' — 모델이 요청을 거부했어요(문맥 길이/형식 확인)';
  else if (status === 404) hint = ' — 모델/주소를 찾지 못함(모델 이름·LLM 주소 확인)';
  else if (status === 500 || status === 503) hint = ' — 엔진 내부 오류(모델을 다시 로드해 보세요)';
  else if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|Network|ENOTFOUND/i.test(detail + code)) hint = ' — AI 엔진에 연결하지 못했어요(🤖 내 AI 팀에서 두뇌가 켜져 있는지 확인)';
  return (status ? `HTTP ${status}: ${detail}` : detail) + hint;
}

// 한 번의 system+user 호출. onToken 주면 스트리밍.
export async function chat(t: LlmTarget, system: string, user: string, opts: ChatOpts = {}): Promise<string> {
  return completeMessages(t, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], opts);
}

// 한 번의 모델 호출 결과 — text + 길이 한도로 잘렸는지(truncated)
interface OneShot { text: string; truncated: boolean; }

// 모델 1회 호출 (스트리밍/비스트리밍). finish_reason 'length' → truncated=true
async function callOnce(t: LlmTarget, messages: ChatMessage[], opts: ChatOpts, stream: boolean): Promise<OneShot> {
  if (t.engine === 'lmstudio' || t.engine === 'gemini') {
    // OpenAI 호환 (LM Studio 로컬 / Gemini 클라우드)
    const url = t.engine === 'gemini' ? `${t.base}/chat/completions` : `${t.base}/v1/chat/completions`;
    const headers: any = t.key ? { Authorization: `Bearer ${t.key}` } : {};
    const body: any = { model: t.model, messages, temperature: opts.temperature ?? 0.6, stream };
    if (opts.frequencyPenalty != null) body.frequency_penalty = opts.frequencyPenalty;
    if (opts.presencePenalty != null) body.presence_penalty = opts.presencePenalty;
    if (!stream) {
      const r = await axios.post(url, body, { timeout: 180000, signal: opts.signal as any, headers });
      const choice = r.data?.choices?.[0];
      return { text: choice?.message?.content || '', truncated: choice?.finish_reason === 'length' };
    }
    return streamSSE(url, body, opts.onToken!, opts.signal, headers);
  }
  // Ollama
  const url = `${t.base}/api/chat`;
  const body: any = { model: t.model, messages, stream, options: { temperature: opts.temperature ?? 0.6, num_predict: -1 } };
  if (opts.frequencyPenalty != null) body.options.repeat_penalty = 1 + opts.frequencyPenalty; // 0.6 → 1.6
  if (!stream) {
    const r = await axios.post(url, body, { timeout: 180000, signal: opts.signal as any });
    return { text: r.data?.message?.content || '', truncated: r.data?.done_reason === 'length' };
  }
  return streamNdjson(url, body, opts.onToken!, opts.signal);
}

// 멀티턴 호출 — 길이 한도로 잘리면 자동으로 "이어서 써"를 보내 끝까지 이어붙인다(최대 3회 이어쓰기).
// 컨텍스트가 작거나 답이 길어 중간에 끊기는 현상을 구조적으로 막음.
export async function completeMessages(t: LlmTarget, messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const stream = !!opts.onToken;
  let full = '';
  let msgs = messages;
  let flattened = false;
  for (let cont = 0; cont <= 3; cont++) {
    if (opts.signal?.aborted) break;
    let res: OneShot;
    try { res = await callOnce(t, msgs, opts, stream); }
    catch (e: any) {
      // 빡빡한 템플릿(역할 교차 강제·system 미지원) → 메시지 평탄화로 한 번 재시도
      if (isTemplateErr(e) && !flattened) { flattened = true; msgs = flattenMessages(msgs); res = await callOnce(t, msgs, opts, stream); }
      else throw e;
    }
    const { text, truncated } = res;
    full += text;
    if (!truncated || !text) break;   // 정상 종료거나 더 안 나오면 끝
    // 길이로 잘림 → 끊긴 지점부터 이어쓰기 요청 (스트리밍이면 onToken으로 계속 흘러나감)
    msgs = [...messages,
      { role: 'assistant', content: full },
      { role: 'user', content: '바로 직전 답변이 길이 제한으로 중간에 끊겼다. 끊긴 지점에서 곧바로 이어서 계속 작성해라. 인사·서론·이미 쓴 내용 반복 없이 이어지는 부분만.' }];
  }
  return full;
}

// ── 스트리밍 파서 (Node response stream) — OpenAI SSE. finish_reason 'length' 감지 ──
async function streamSSE(url: string, body: any, onToken: (t: string) => void, signal: AbortSignal | undefined, headers: any = {}): Promise<OneShot> {
  const res = await axios.post(url, body, { responseType: 'stream', timeout: 0, signal: signal as any, headers });
  let acc = '', truncated = false;
  await new Promise<void>((resolve, reject) => {
    let buf = '';
    res.data.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const ch = JSON.parse(payload)?.choices?.[0];
          const tok = ch?.delta?.content || '';
          if (tok) { acc += tok; onToken(tok); }
          if (ch?.finish_reason === 'length') truncated = true;
        } catch { /* keep-alive */ }
      }
    });
    res.data.on('end', resolve);
    res.data.on('error', reject);
  });
  return { text: acc, truncated };
}

async function streamNdjson(url: string, body: any, onToken: (t: string) => void, signal: AbortSignal | undefined): Promise<OneShot> {
  const res = await axios.post(url, body, { responseType: 'stream', timeout: 0, signal: signal as any });
  let acc = '', truncated = false;
  await new Promise<void>((resolve, reject) => {
    let buf = '';
    res.data.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          const j = JSON.parse(s);
          const tok = j?.message?.content; if (tok) { acc += tok; onToken(tok); }
          if (j?.done_reason === 'length') truncated = true;
        } catch { /* partial */ }
      }
    });
    res.data.on('end', resolve);
    res.data.on('error', reject);
  });
  return { text: acc, truncated };
}
