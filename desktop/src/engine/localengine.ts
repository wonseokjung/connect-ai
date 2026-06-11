// 🧠 내장 추론 엔진 — llama.cpp 공식 llama-server 바이너리를 앱이 직접 띄운다 (LM Studio·Ollama 불필요).
//   핵심: 동봉한 llama-server 를 127.0.0.1:1235 에 OpenAI 호환 서버로 실행.
//   → 기존 llm.ts(1234/1235 감지)·company.ts(도구호출) 코드가 그대로 재사용된다.
//   왜 node-llama-cpp 가 아니라 이걸 쓰나:
//     node-llama-cpp 의 프리빌드는 구버전(b8390)이라 gemma-4 등 최신 아키텍처를 못 읽고,
//     packaged Electron 에선 동봉 빌드가 read-only(.asar) 로 간주돼 무시된다(실증).
//     반면 llama.cpp 공식 릴리즈는 맥(arm64·x64)·윈도우 프리빌드를 매일 내고 gemma-4 도 지원한다.
//     llama-server 는 도구호출(OpenAI tools)·임베딩·스트리밍을 네이티브로 제공한다.
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

export const LOCAL_PORT = 1235;
export const LOCAL_BASE = `http://127.0.0.1:${LOCAL_PORT}`;

let _proc: ChildProcess | null = null;       // 실행 중인 llama-server
let _modelPath = '', _modelName = '', _gpu = '';
let _mode: 'gpu' | 'cpu' | '' = '';   // 현재 실행 모드 (사용자 표시용)
let _loadMsg = '';                    // 로딩 중 진행 메시지 (GPU 시도/CPU 전환)
let _statusCb: ((s: LocalStatus) => void) | null = null;
export function onEngineStatus(cb: (s: LocalStatus) => void) { _statusCb = cb; }
function emitStatus() { try { _statusCb?.(localStatus()); } catch { /* */ } }
let _maxCtx = 0, _loadedCtx = 0;              // 모델 최대 컨텍스트 / 실제 로드된 컨텍스트
let _ready = false, _loading = false, _error = '';
let _startSeq = 0;                            // 모델 전환 경쟁 방지용 토큰

// ⚙️ 추론 파라미터 — 사용자가 AI 패널에서 조절. (flashAttn·ctxSize=기동 플래그 / 나머지=요청마다 llm.ts 가 전송)
export interface LocalOptions {
  flashAttn: boolean; ctxSize: number; maxTokens: number;
  temp: number; topP: number; topK: number; minP: number; repeatPenalty: number;
  freqPenalty: number; presPenalty: number; repeatLastN: number;
}
let _opts: LocalOptions = { flashAttn: true, ctxSize: 8192, maxTokens: 1024, temp: 0.7, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.1, freqPenalty: 0, presPenalty: 0, repeatLastN: 64 };
export function setLocalOptions(o: Partial<LocalOptions>) { _opts = { ..._opts, ...o }; }
export function getLocalOptions(): LocalOptions { return { ..._opts }; }

export interface LocalStatus { running: boolean; loading: boolean; modelName: string; modelPath: string; port: number; base: string; gpu: string; error: string; maxCtx: number; ctxSize: number; mode: 'gpu' | 'cpu' | ''; loadMsg: string; }
export function localStatus(): LocalStatus {
  return { running: _ready && !!_proc, loading: _loading, modelName: _modelName, modelPath: _modelPath, port: LOCAL_PORT, base: LOCAL_BASE, gpu: _gpu, error: _error, maxCtx: _maxCtx, ctxSize: _loadedCtx, mode: _mode, loadMsg: _loadMsg };
}

// 플랫폼별 llama-server 바이너리 폴더. packaged: resources/llamacpp/<plat>, dev: desktop/vendor/llamacpp/<plat>.
function binDir(): string {
  const plat = process.platform === 'win32' ? 'win-x64' : (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64');
  const res = (process as any).resourcesPath as string | undefined;
  if (res) { const p = path.join(res, 'llamacpp', plat); if (fs.existsSync(p)) return p; }
  return path.join(__dirname, '..', 'vendor', 'llamacpp', plat);   // __dirname=desktop/out → ../vendor
}
function binPath(): string {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  return path.join(binDir(), exe);
}

// GET → JSON (없으면 null). 짧은 폴링용.
function getJson(pathname: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: LOCAL_PORT, path: pathname, timeout: timeoutMs }, (res) => {
      let s = ''; res.on('data', (d) => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.on('timeout', () => { try { req.destroy(); } catch { /* */ } resolve(null); });
  });
}

// /health 가 200(ok) 될 때까지 대기. timeoutMs 내 못 뜨면 false.
async function waitReady(timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!_proc) return false;                       // 프로세스가 죽으면 중단
    const h = await getJson('/health', 1500);
    if (h && (h.status === 'ok' || h.status === undefined)) {
      // status 키가 없어도 JSON 응답이면 살아있음 — 한 번 더 확실히 ok 확인
      if (h.status === 'ok' || (await getJson('/v1/models', 1500))) return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// 모델 로드 = llama-server 를 해당 모델로 (재)기동. 같은 모델이고 이미 떠 있으면 그대로.
export async function startLocalEngine(modelPath: string, force = false, ngl?: number): Promise<LocalStatus> {
  if (_loading) return localStatus();
  if (!force && _ready && _proc && _modelPath === modelPath) return localStatus();
  const seq = ++_startSeq;
  const useNgl = ngl ?? 999;                         // 999=가능한 GPU 전부 / 0=CPU 전용(폴백)
  _loading = true; _ready = false; _error = '';
  _loadMsg = useNgl > 0 ? '⚡ GPU 가속으로 모델 켜는 중…' : '🖥️ CPU 모드로 모델 켜는 중… (조금 느릴 수 있어요)';
  emitStatus();
  try {
    await killProc();                               // 기존 서버 종료
    if (seq !== _startSeq) return localStatus();    // 더 최신 요청이 들어왔으면 양보

    const bin = binPath();
    if (!fs.existsSync(bin)) throw new Error(`추론 엔진 실행파일을 찾을 수 없어요: ${bin}`);
    try { if (process.platform !== 'win32') fs.chmodSync(bin, 0o755); } catch { /* */ }

    _maxCtx = 0; _loadedCtx = _opts.ctxSize;
    const args = [
      '-m', modelPath,
      '--host', '127.0.0.1', '--port', String(LOCAL_PORT),
      '-c', String(_opts.ctxSize),
      '-ngl', String(useNgl),                       // GPU 레이어 오프로드 (0=CPU 폴백)
      '-fa', (useNgl > 0 && _opts.flashAttn) ? 'on' : 'off',   // ⚡ flash-attention (CPU 모드선 끔)
      '--jinja',                                    // 모델 정식 chat template → 도구호출 정확도
      '--no-webui',
      // 샘플링 기본값(AI 패널 슬라이더) — 서버 디폴트로 적용. temp 는 요청마다 덮어씀(라이브).
      '--temp', String(_opts.temp),
      '--top-p', String(_opts.topP),
      '--top-k', String(_opts.topK),
      '--min-p', String(_opts.minP),
      '--repeat-penalty', String(_opts.repeatPenalty),
      '--repeat-last-n', String(_opts.repeatLastN),
      '--frequency-penalty', String(_opts.freqPenalty),
      '--presence-penalty', String(_opts.presPenalty),
    ];
    const env: NodeJS.ProcessEnv = { ...process.env, GGML_METAL_NO_RESIDENCY: '1' };   // macOS26 Metal residency 어설션 우회
    // 윈도우: DLL 이 바이너리 옆에 있으므로 PATH 에 폴더 추가(cwd 로도 충분하지만 안전하게).
    if (process.platform === 'win32') env.PATH = `${binDir()}${path.delimiter}${env.PATH || ''}`;

    const child = spawn(bin, args, { cwd: binDir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    _proc = child;
    let log = '';
    const onOut = (d: any) => { log = (log + String(d)).slice(-4000); };
    child.stdout?.on('data', onOut); child.stderr?.on('data', onOut);
    child.on('exit', (code) => {
      if (_proc === child) { _proc = null; _ready = false; if (!_error && code) _error = `엔진이 종료됐어요 (code ${code}). ${tailErr(log)}`; }
    });
    child.on('error', (e) => { if (_proc === child) { _error = String((e as any)?.message || e); _proc = null; _ready = false; } });

    const ok = await waitReady(120000);             // 큰 모델 로드까지 넉넉히
    if (seq !== _startSeq) return localStatus();    // 그 사이 다른 모델 요청 → 결과 무시
    if (!ok || !_proc) {
      // 🔁 GPU(Vulkan/Metal) 오프로드 실패 → CPU 전용으로 1회 자동 재시도
      //    (Vulkan 드라이버 없는 윈도우 PC·VM에서 엔진이 code 1로 죽던 문제 구제)
      if (useNgl > 0) {
        await killProc(); _loading = false; _error = '';
        _loadMsg = '🖥️ 이 PC는 GPU 가속이 안 돼서 CPU 모드로 다시 켜는 중…'; emitStatus();
        return startLocalEngine(modelPath, true, 0);
      }
      throw new Error(_error || `모델 로드 실패. ${tailErr(log)}`);
    }

    _modelPath = modelPath;
    _modelName = path.basename(modelPath).replace(/\.gguf$/i, '');
    _ready = true;
    _mode = useNgl > 0 ? 'gpu' : 'cpu';
    _loadMsg = useNgl > 0 ? '' : '🖥️ CPU 모드로 작동 중 (이 PC는 GPU 가속 미지원 — 응답이 조금 느릴 수 있어요)';
    emitStatus();
    // 부가정보: 컨텍스트·GPU. 실패해도 무시.
    try {
      const props = await getJson('/props', 3000);
      if (props) {
        const n = Number(props.n_ctx ?? props?.default_generation_settings?.n_ctx);
        if (n) _loadedCtx = n;
        const tr = Number(props?.default_generation_settings?.n_ctx_train ?? props?.n_ctx_train);
        _maxCtx = tr || n || 0;
      }
    } catch { /* */ }
    _gpu = process.platform === 'win32' ? 'cuda/vulkan' : (process.arch === 'arm64' ? 'metal' : 'cpu/metal');
    return localStatus();
  } catch (e: any) {
    if (seq === _startSeq) { _error = String(e?.message || e); _ready = false; }
    await killProc();
    throw e;
  } finally { if (seq === _startSeq) _loading = false; }
}

export async function stopLocalEngine(): Promise<void> {
  _startSeq++;                                      // 진행 중 기동 무효화
  await killProc();
  _ready = false; _modelPath = ''; _modelName = '';
}

// 마지막 로그에서 사람이 읽을 만한 에러 줄만 추려 보여줌.
function tailErr(log: string): string {
  const lines = String(log).split(/\r?\n/).filter((l) => /error|failed|unknown|assert|exception/i.test(l));
  return lines.slice(-2).join(' | ').slice(0, 300);
}

function killProc(): Promise<void> {
  return new Promise((resolve) => {
    const p = _proc; _proc = null;
    if (!p || p.exitCode != null) return resolve();
    let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
    p.once('exit', fin);
    try { p.kill('SIGTERM'); } catch { /* */ }
    setTimeout(() => { try { if (p.exitCode == null) p.kill('SIGKILL'); } catch { /* */ } fin(); }, 2500);
  });
}
