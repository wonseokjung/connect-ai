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
let _modelPath = '', _modelName = '', _gpu = '';
let _loading = false, _error = '';
let _chain: Promise<any> = Promise.resolve();   // 요청 직렬화(단일 컨텍스트 보호)

// ⚙️ 추론 파라미터 — 사용자가 AI 패널에서 조절. (flashAttn·ctxSize=로드시 / 나머지=요청마다)
export interface LocalOptions {
  flashAttn: boolean; ctxSize: number; maxTokens: number;
  temp: number; topP: number; topK: number; minP: number; repeatPenalty: number;
}
let _opts: LocalOptions = { flashAttn: true, ctxSize: 4096, maxTokens: 1024, temp: 0.7, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.1 };
export function setLocalOptions(o: Partial<LocalOptions>) { _opts = { ..._opts, ...o }; }
export function getLocalOptions(): LocalOptions { return { ..._opts }; }

export interface LocalStatus { running: boolean; loading: boolean; modelName: string; modelPath: string; port: number; base: string; gpu: string; error: string; }
export function localStatus(): LocalStatus {
  return { running: !!(_server && _model), loading: _loading, modelName: _modelName, modelPath: _modelPath, port: LOCAL_PORT, base: LOCAL_BASE, gpu: _gpu, error: _error };
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
    const { getLlama, LlamaChatSession } = await nlc();
    _Session = LlamaChatSession;
    if (!_llama) { _llama = await getLlama({ build: 'never' }); _gpu = String(_llama.gpu); }   // 프리빌드만, 컴파일 금지
    // 기존 모델 정리 후 새 모델 로드
    try { _seq?.dispose?.(); } catch { /* */ }
    try { await _ctx?.dispose?.(); } catch { /* */ }
    try { await _model?.dispose?.(); } catch { /* */ }
    _seq = null; _session = null; _ctx = null; _model = null;
    _model = await _llama.loadModel({ modelPath });
    _ctx = await _model.createContext({ contextSize: _opts.ctxSize, flashAttention: _opts.flashAttn });   // ⚡ flashAttn=속도
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
    _server = http.createServer((req, res) => { handle(req, res).catch((e) => sendJson(res, 500, { error: { message: String(e?.message || e) } })); });
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

// OpenAI messages[] → node-llama-cpp 세션(시스템+히스토리 복원) → 마지막 user 프롬프트
async function chatCompletion(body: any, res: http.ServerResponse) {
  const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];
  const stream = !!body?.stream;
  const maxTokens = Math.min(Number(body?.max_tokens) || _opts.maxTokens, _opts.ctxSize);
  const temperature = body?.temperature != null ? Number(body.temperature) : _opts.temp;
  const sampling: any = { maxTokens, temperature, topP: _opts.topP, topK: _opts.topK, minP: _opts.minP, repeatPenalty: { penalty: _opts.repeatPenalty } };

  const sys = messages.filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n').trim();
  const conv = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const last = conv[conv.length - 1];
  const prior = (last && last.role === 'user') ? conv.slice(0, -1) : conv;
  const promptText = (last && last.role === 'user') ? String(last.content || '') : '';

  // 공유 세션 재사용 — 매 요청 setChatHistory 로 상태 초기화(시퀀스 풀 고갈 방지)
  const history: any[] = [];
  if (sys) history.push({ type: 'system', text: sys });
  for (const m of prior) {
    if (m.role === 'user') history.push({ type: 'user', text: String(m.content || '') });
    else history.push({ type: 'model', response: [String(m.content || '')] });
  }
  try { _session.setChatHistory(history); } catch { /* */ }

  const id = 'chatcmpl-local-' + Date.now();
  const created = Math.floor(Date.now() / 1000);

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
