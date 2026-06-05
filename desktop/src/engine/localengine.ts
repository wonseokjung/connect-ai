// 🧠 내장 추론 엔진 — node-llama-cpp 로 LM Studio 없이 모델을 앱이 직접 실행.
//   핵심 아이디어: 앱이 스스로 127.0.0.1:1235 에 OpenAI 호환 서버를 띄운다.
//   → 기존 llm.ts(1234 LM Studio 감지) 가 1235 도 후보로 보면 채팅·도구·임베딩 코드 그대로 재사용.
//   검증된 우회(2026-06-05, macOS26): GGML_METAL_NO_RESIDENCY=1 + getLlama({build:'never'})(프리빌드만).
import * as http from 'http';
import * as path from 'path';

process.env.GGML_METAL_NO_RESIDENCY = process.env.GGML_METAL_NO_RESIDENCY || '1';   // macOS26 Metal residency-set 어설션 우회
// gemma-4 등 최신 모델: 사용자가 `npx node-llama-cpp source download --release b8642` 로 직접 빌드하면
// 이 옵션이 그 로컬 빌드와 매칭돼 build:'never' 가 프리빌드(b8390) 대신 b8642 를 쓴다. SVE 컴파일 정지도 우회.
process.env.NODE_LLAMA_CPP_CMAKE_OPTION_GGML_NATIVE = process.env.NODE_LLAMA_CPP_CMAKE_OPTION_GGML_NATIVE || 'OFF';

export const LOCAL_PORT = 1235;
export const LOCAL_BASE = `http://127.0.0.1:${LOCAL_PORT}`;

let _llama: any = null;          // getLlama() 인스턴스(1회)
let _model: any = null;          // 로드된 모델
let _ctx: any = null;            // 컨텍스트(시퀀스 재사용)
let _seq: any = null;            // 고정 시퀀스 1개(요청마다 재생성 금지 — 풀 고갈 방지)
let _session: any = null;        // 공유 LlamaChatSession(요청마다 setChatHistory 로 초기화)
let _server: http.Server | null = null;
let _Session: any = null;        // LlamaChatSession 클래스
let _defineFn: any = null;       // defineChatSessionFunction (네이티브 도구호출용)
let _modelPath = '', _modelName = '', _gpu = '';
let _maxCtx = 0, _loadedCtx = 0;   // 모델이 지원하는 최대 컨텍스트 / 실제 로드된 컨텍스트
let _loading = false, _error = '';
let _chain: Promise<any> = Promise.resolve();   // 요청 직렬화(단일 컨텍스트 보호)

// ⚙️ 추론 파라미터 — 사용자가 AI 패널에서 조절. (flashAttn·ctxSize=로드시 / 나머지=요청마다)
export interface LocalOptions {
  flashAttn: boolean; ctxSize: number; maxTokens: number;
  temp: number; topP: number; topK: number; minP: number; repeatPenalty: number;
  freqPenalty: number; presPenalty: number; repeatLastN: number;
}
let _opts: LocalOptions = { flashAttn: true, ctxSize: 8192, maxTokens: 1024, temp: 0.7, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.1, freqPenalty: 0, presPenalty: 0, repeatLastN: 64 };
export function setLocalOptions(o: Partial<LocalOptions>) { _opts = { ..._opts, ...o }; }
export function getLocalOptions(): LocalOptions { return { ..._opts }; }

export interface LocalStatus { running: boolean; loading: boolean; modelName: string; modelPath: string; port: number; base: string; gpu: string; error: string; maxCtx: number; ctxSize: number; }
export function localStatus(): LocalStatus {
  return { running: !!(_server && _model), loading: _loading, modelName: _modelName, modelPath: _modelPath, port: LOCAL_PORT, base: LOCAL_BASE, gpu: _gpu, error: _error, maxCtx: _maxCtx, ctxSize: _loadedCtx };
}

// node-llama-cpp 는 ESM 전용 → CJS(메인 번들)에서 런타임 동적 import 로 불러온다.
//   Function 생성자로 import() 를 만들어 esbuild 정적 분석/번들을 회피(네이티브 모듈이므로 external).
const _dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;
async function nlc(): Promise<any> { return await _dynImport('node-llama-cpp'); }

// 모델 로드(+ 필요시 엔진/서버 기동). 이미 같은 모델이면 그대로.
export async function startLocalEngine(modelPath: string, force = false): Promise<LocalStatus> {
  if (_loading) return localStatus();
  if (!force && _model && _modelPath === modelPath && _server) return localStatus();
  _loading = true; _error = '';
  try {
    const { getLlama, LlamaChatSession, defineChatSessionFunction } = await nlc();
    _Session = LlamaChatSession; _defineFn = defineChatSessionFunction;
    if (!_llama) { _llama = await getLlama({ build: 'never' }); _gpu = String(_llama.gpu); }   // 프리빌드만, 컴파일 금지
    // 기존 모델 정리 후 새 모델 로드
    try { _seq?.dispose?.(); } catch { /* */ }
    try { await _ctx?.dispose?.(); } catch { /* */ }
    try { await _model?.dispose?.(); } catch { /* */ }
    _seq = null; _session = null; _ctx = null; _model = null;
    _model = await _llama.loadModel({ modelPath });
    try { _maxCtx = Number(_model.trainContextSize) || 0; } catch { _maxCtx = 0; }   // 모델이 지원하는 최대 컨텍스트
    _loadedCtx = _maxCtx ? Math.min(_opts.ctxSize, _maxCtx) : _opts.ctxSize;          // 모델 최대를 넘지 않게
    _ctx = await _model.createContext({ contextSize: _loadedCtx, flashAttention: _opts.flashAttn });   // ⚡ flashAttn=속도
    _seq = _ctx.getSequence();
    _session = new _Session({ contextSequence: _seq });   // 공유 세션 1개
    _modelPath = modelPath;
    _modelName = path.basename(modelPath).replace(/\.gguf$/i, '');
    if (!_server) await startServer();
    return localStatus();
  } catch (e: any) {
    _error = String(e?.message || e); _model = null; _ctx = null;
    throw e;
  } finally { _loading = false; }
}

export async function stopLocalEngine(): Promise<void> {
  try { _seq?.dispose?.(); } catch { /* */ }
  try { await _ctx?.dispose?.(); } catch { /* */ }
  try { await _model?.dispose?.(); } catch { /* */ }
  _seq = null; _session = null; _ctx = null; _model = null; _modelPath = ''; _modelName = '';
  if (_server) { try { _server.close(); } catch { /* */ } _server = null; }
}

// ── OpenAI 호환 미니 서버 (127.0.0.1:1235) ─────────────────────
function startServer(): Promise<void> {
  return new Promise((resolve) => {
    _server = http.createServer((req, res) => { handle(req, res).catch((e) => { try { console.error('[localengine] 요청 에러:', e?.stack || e); } catch { /* */ } try { sendJson(res, 500, { error: { message: String(e?.message || e) } }); } catch { /* */ } }); });
    _server.on('error', (e) => { _error = 'server: ' + String((e as any)?.message || e); });
    _server.listen(LOCAL_PORT, '127.0.0.1', () => resolve());
  });
}

function sendJson(res: http.ServerResponse, code: number, obj: any) {
  const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b);
}
function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => { let s = ''; req.on('data', (d) => s += d); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } }); });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = (req.url || '').split('?')[0];
  if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
    return sendJson(res, 200, { object: 'list', data: _model ? [{ id: _modelName, object: 'model', owned_by: 'connect-ai-local' }] : [] });
  }
  if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
    if (!_model || !_ctx) return sendJson(res, 503, { error: { message: '내장 모델이 아직 로드되지 않았어요.' } });
    const body = await readBody(req);
    // 동일 컨텍스트 보호 위해 요청 직렬화
    return await (_chain = _chain.then(() => chatCompletion(body, res), () => chatCompletion(body, res)));
  }
  sendJson(res, 404, { error: { message: 'not found' } });
}

// 생성 중단(throw·에러) 후 공유 세션을 깨끗하게 재생성 — 다음 요청이 꼬이지 않게.
function resetSession() { try { if (_Session && _seq) _session = new _Session({ contextSequence: _seq }); } catch { /* */ } }
// 함수호출 캡처용 — 핸들러에서 이걸 던지면 prompt() 가 멈추고 우리가 호출을 OpenAI tool_calls 로 반환.
class ToolStop extends Error {}
// OpenAI JSON Schema → node-llama-cpp GbnfJsonSchema (지원 키만 남김).
function normSchema(s: any): any {
  if (!s || typeof s !== 'object') return { type: 'object', properties: {} };
  const out: any = {};
  if (s.type) out.type = s.type;
  if (s.enum) out.enum = s.enum;
  if (typeof s.description === 'string') out.description = s.description;
  if (s.properties) { out.properties = {}; for (const k of Object.keys(s.properties)) out.properties[k] = normSchema(s.properties[k]); }
  if (s.items) out.items = normSchema(s.items);
  if ((out.type === 'object' || out.properties) && !out.properties) out.properties = {};
  if (!out.type && out.properties) out.type = 'object';
  if (!out.type) out.type = 'string';
  return out;
}

// OpenAI messages[] → node-llama-cpp 세션. tools 있으면 네이티브 함수호출로 tool_calls 반환.
async function chatCompletion(body: any, res: http.ServerResponse) {
  const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];
  const tools: any[] = Array.isArray(body?.tools) ? body.tools : [];
  const useTools = tools.length > 0 && !!_defineFn;
  const stream = !!body?.stream && !useTools;   // 도구 모드는 비스트림(호출 캡처)
  const maxTokens = Math.min(Number(body?.max_tokens) || _opts.maxTokens, _loadedCtx || _opts.ctxSize);
  const temperature = body?.temperature != null ? Number(body.temperature) : _opts.temp;
  const sampling: any = { maxTokens, temperature, topP: _opts.topP, topK: _opts.topK, minP: _opts.minP, repeatPenalty: { penalty: _opts.repeatPenalty, frequencyPenalty: _opts.freqPenalty, presencePenalty: _opts.presPenalty, lastTokens: _opts.repeatLastN } };

  const sys = messages.filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n').trim();
  const conv = messages.filter((m) => m.role !== 'system');
  // tool_call_id → 도구 이름
  const callName: Record<string, string> = {};
  for (const m of conv) if (m.role === 'assistant' && Array.isArray(m.tool_calls)) for (const tc of m.tool_calls) callName[tc.id] = tc.function?.name || 'tool';
  // 마지막 assistant 이후 = 현재 입력, 그 전 = 히스토리
  let splitIdx = -1;
  for (let i = 0; i < conv.length; i++) if (conv[i].role === 'assistant') splitIdx = i;
  const historyMsgs = conv.slice(0, splitIdx + 1);
  const promptMsgs = conv.slice(splitIdx + 1);

  const history: any[] = [];
  if (sys) history.push({ type: 'system', text: sys });
  for (const m of historyMsgs) {
    if (m.role === 'user') history.push({ type: 'user', text: String(m.content || '') });
    else if (m.role === 'assistant') {
      let txt = String(m.content || '');
      if (Array.isArray(m.tool_calls)) txt += (txt ? '\n' : '') + m.tool_calls.map((tc: any) => `[도구 실행: ${tc.function?.name} ${tc.function?.arguments || ''}]`).join('\n');
      history.push({ type: 'model', response: [txt] });
    } else if (m.role === 'tool') {
      history.push({ type: 'user', text: `[도구 결과 ${callName[m.tool_call_id] || ''}]\n${String(m.content || '')}` });
    }
  }
  let promptText = '';
  for (const m of promptMsgs) {
    if (m.role === 'tool') promptText += `[도구 결과 ${callName[m.tool_call_id] || ''}]\n${String(m.content || '')}\n`;
    else promptText += String(m.content || '') + '\n';
  }
  promptText = promptText.trim() || (useTools ? '도구 결과를 보고 이어서 답해줘.' : '');

  try { _session.setChatHistory(history); } catch { /* */ }
  const id = 'chatcmpl-local-' + Date.now();
  const created = Math.floor(Date.now() / 1000);

  // ── 도구 모드: 모델이 함수 부르면 캡처 → tool_calls 로 반환 ──
  if (useTools) {
    let captured: any = null;
    let fns: any = {};
    try {
      for (const t of tools) {
        const f = t.function; if (!f?.name) continue;
        fns[f.name] = _defineFn({ description: f.description || '', params: normSchema(f.parameters), handler: (args: any) => { captured = { name: f.name, args: args || {} }; throw new ToolStop(); } });
      }
    } catch { fns = null; }   // 스키마 변환 실패 → 일반 채팅 폴백
    if (fns) {
      let answer = '', realErr: any = null;
      try { answer = await _session.prompt(promptText, { ...sampling, functions: fns }); }
      catch (e) { if (!(e instanceof ToolStop)) realErr = e; }
      resetSession();   // ⚠️ 함수호출 throw·에러는 생성을 끊으므로 다음 요청 위해 세션 재생성
      if (captured) {
        return sendJson(res, 200, { id, object: 'chat.completion', created, model: _modelName, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + Date.now(), type: 'function', function: { name: captured.name, arguments: JSON.stringify(captured.args) } }] }, finish_reason: 'tool_calls' }], usage: {} });
      }
      if (realErr) { console.error('[localengine] 도구 생성 에러:', realErr?.message || realErr); return sendJson(res, 200, { id, object: 'chat.completion', created, model: _modelName, choices: [{ index: 0, message: { role: 'assistant', content: '처리 중 문제가 생겼어요. 다시 한 번 말씀해 주세요.' }, finish_reason: 'stop' }], usage: {} }); }
      return sendJson(res, 200, { id, object: 'chat.completion', created, model: _modelName, choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: {} });
    }
  }

  // ── 일반 채팅 ──
  if (stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (delta: any, finish: any = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: _modelName, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    send({ role: 'assistant' });
    await _session.prompt(promptText, { ...sampling, onTextChunk: (t: string) => send({ content: t }) });
    send({}, 'stop'); res.write('data: [DONE]\n\n'); res.end();
  } else {
    const answer = await _session.prompt(promptText, sampling);
    sendJson(res, 200, { id, object: 'chat.completion', created, model: _modelName, choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: {} });
  }
}
