// 🔌 EZERAI ↔ Connect AI 두뇌 브릿지 (localhost:4825)
// EZERAI 웹(브레인팩 마켓)이 여기로 지식·스킬·템플릿·디자인을 POST 하면 → 내 두뇌/작업폴더에 주입.
// 계약은 EZERAI src/data/packTypes.ts 의 injectPack() 과 일치해야 함.
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

// 후보 포트들 — 4825가 익스텐션 등에 막혀도 4826/4827로 받는다(에제르가 전 포트에 쏴줌).
const PORTS = process.env.CONNECT_BRIDGE_PORT ? [Number(process.env.CONNECT_BRIDGE_PORT)] : [4825, 4826, 4827];
let server: http.Server | null = null;

// 브릿지 상태 — 'listening'(내가 어떤 포트로 수신중) · 'yielded'(전 포트가 점유됨) · 'off'(아직/꺼짐).
type BridgeState = 'listening' | 'yielded' | 'off';
let state: BridgeState = 'off';
let boundPort = 0;
let heldBy = '';
export function bridgeStatus(): { state: BridgeState; port: number; heldBy: string } { return { state, port: boundPort || PORTS[0], heldBy }; }
// 양보 시 첫 포트를 누가 점유했는지 가볍게 조회(익스텐션이면 app/version 회신).
function probeHolder(port: number) {
  try {
    const r = http.get({ host: '127.0.0.1', port, path: '/ping', timeout: 1500 }, (res) => {
      let d = ''; res.on('data', (c) => d += c); res.on('end', () => { try { const j = JSON.parse(d); heldBy = j?.app ? `${j.app}${j.version ? ' v' + j.version : ''}` : '다른 앱'; } catch { heldBy = '다른 앱'; } });
    });
    r.on('error', () => { heldBy = '다른 앱'; }); r.on('timeout', () => { try { r.destroy(); } catch { /* */ } heldBy = '다른 앱'; });
  } catch { heldBy = '다른 앱'; }
}

export interface BridgeDeps {
  status: () => { defaultModel: string; brain: { fileCount: number; enabled: boolean } };
  addKnowledge: (title: string, markdown: string) => Promise<void>;   // 두뇌(RAG)에 저장
  workspace: () => string;                                            // 팩 파일 저장 위치 기준
  runExam: (prompt: string) => Promise<string>;                       // 연결 테스트(에이전트 응답)
  onInject: (kind: string, label: string, dir?: string) => void;      // 렌더러 알림(파일트리 새로고침 등)
}

const PACK_ROOT = 'connect-ai-packs';

function cors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 12_000_000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); req.on('error', () => resolve({})); });
}
function saveFiles(dir: string, files: { path: string; content: string }[]): string {
  for (const f of files) { const full = path.join(dir, f.path.replace(/^[\\/]+/, '')); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, f.content ?? '', 'utf8'); }
  return dir;
}

export function startBridge(deps: BridgeDeps): void {
  if (server) return;
  server = http.createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const url = (req.url || '').split('?')[0];
    const ok = (data: any = {}) => res.end(JSON.stringify({ ok: true, ...data }));
    try {
      // 🔋 연결 상태 (EZERAI ConnectionDashboard)
      if (req.method === 'GET' && url === '/ping') { const s = deps.status(); return ok({ app: 'connect-ai', config: { defaultModel: s.defaultModel }, brain: s.brain }); }

      if (req.method === 'POST') {
        const p = await readBody(req);
        const ws = deps.workspace();

        // 🧠 지식 → 두뇌(RAG)
        if (url === '/api/brain-inject') {
          const title = p.title || '지식'; await deps.addKnowledge(title, p.markdown || '');
          deps.onInject('knowledge', title); return ok();
        }
        // 🐍 스킬 → 작업폴더에 .py + 두뇌에 "이 스킬 실행 가능" 노트
        if (url === '/api/skill-inject') {
          const dir = path.join(ws, PACK_ROOT, '스킬', (p.agent || 'general'));
          saveFiles(dir, [
            { path: `${p.name}.py`, content: p.script || '' },
            { path: `${p.name}.json`, content: JSON.stringify(p.config || {}, null, 2) },
            { path: `${p.name}.md`, content: p.readme || '' },
          ]);
          await deps.addKnowledge(`스킬: ${p.displayName || p.name}`, `${p.description || ''}\n실행 가능한 파이썬 스킬: <run>python3 "${path.join(dir, p.name + '.py')}"</run>`);
          deps.onInject('skill', p.displayName || p.name, dir); return ok({ dir });
        }
        // 📦 템플릿 → 작업폴더에 파일들 생성 (작업실 파일트리에 등장)
        if (url === '/api/template-inject') {
          const dir = path.join(ws, PACK_ROOT, '템플릿', (p.name || 'template'));
          const files = (Array.isArray(p.files) ? p.files : []).map((f: any) => ({ path: f.path || f.name || 'file.txt', content: f.content || '' }));
          if (p.readme) files.push({ path: 'README.md', content: p.readme });
          if (p.manifest) files.push({ path: 'manifest.json', content: typeof p.manifest === 'string' ? p.manifest : JSON.stringify(p.manifest, null, 2) });
          saveFiles(dir, files);
          deps.onInject('template', p.displayName || p.name, dir); return ok({ dir });
        }
        // 🎨 디자인 → DESIGN.md 저장 + 두뇌에 디자인 가이드
        if (url === '/api/design-inject') {
          const dir = path.join(ws, PACK_ROOT, '디자인', (p.slug || 'design'));
          saveFiles(dir, [{ path: 'DESIGN.md', content: p.markdown || '' }]);
          await deps.addKnowledge(`디자인 가이드: ${p.title || p.slug}`, `테마 ${p.theme || ''} · 강조색 ${p.accentColor || ''}. 디자인 작업 시 이 토큰을 따라라. 파일: ${path.join(dir, 'DESIGN.md')}\n\n${(p.markdown || '').slice(0, 1800)}`);
          deps.onInject('design', p.title || p.slug, dir); return ok();
        }
        // 🧪 연결 테스트
        if (url === '/api/exam') { const result = await deps.runExam(p.prompt || '안녕하세요, 연결 테스트입니다.'); return ok({ result }); }
      }
      res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: 'not found' }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: e?.message || String(e) })); }
  });
  server.once('listening', () => { state = 'listening'; boundPort = (server!.address() as any)?.port || 0; heldBy = ''; try { console.error(`[bridge] 수신중 :${boundPort}`); } catch { /* */ } });
  // 후보 포트를 순서대로 시도 — 막히면 다음 포트로(에러는 once라 매번 재등록).
  let idx = 0;
  const tryNext = () => {
    if (!server) return;
    if (idx >= PORTS.length) { state = 'yielded'; probeHolder(PORTS[0]); try { console.error(`[bridge] 포트 ${PORTS.join('/')} 전부 사용 중 — 양보`); } catch { /* */ } server = null; return; }
    const p = PORTS[idx++];
    server.once('error', (e: any) => { if (e?.code === 'EADDRINUSE') tryNext(); else { state = 'off'; try { console.error(`[bridge] ${e?.message}`); } catch { /* */ } server = null; } });
    server.listen(p, '127.0.0.1');
  };
  tryNext();
}
export function stopBridge(): void { try { server?.close(); } catch { /* */ } server = null; }
