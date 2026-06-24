// 📱 폰 웹 리모컨 — 같은 와이파이에서 폰 브라우저로 회사를 돌린다 (설치 0).
// http://<내IP>:4830/?k=<토큰>  →  분석 → 작전 선택 → 실행 → 실시간 로그 → 결과.
// 보안: 실행마다 랜덤 토큰(k) — 주소를 아는 사람만 접속. LAN 전용(외부 인터넷 노출 없음).
import * as http from 'http';
import * as os from 'os';
import * as crypto from 'crypto';

export interface RemoteDeps {
  company: () => string;
  status: () => any;                                              // opsPublic()
  startCycle: () => Promise<any>;                                 // 분석 시작 → review
  execute: (titles: string[], humanTitles: string[]) => Promise<any>;
  stop: () => any;
}

const PORT = 4830;
let server: http.Server | null = null;
let token = '';

export function remoteInfo(): { url: string; port: number; on: boolean } {
  const nets = os.networkInterfaces();
  let ip = '';
  for (const list of Object.values(nets)) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal && !/^169\.254/.test(n.address)) { ip = ip || n.address; }
  }
  return { url: ip ? `http://${ip}:${PORT}/?k=${token}` : '', port: PORT, on: !!server };
}

const body = (req: http.IncomingMessage): Promise<any> =>
  new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 200_000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); req.on('error', () => resolve({})); });

export function startRemote(deps: RemoteDeps): void {
  if (server) return;
  token = crypto.randomBytes(8).toString('hex');
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    if ((u.searchParams.get('k') || '') !== token) { res.statusCode = 403; res.end('forbidden'); return; }
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (u.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE(deps.company())); return; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (u.pathname === '/api/status') { res.end(JSON.stringify({ ok: true, company: deps.company(), ops: deps.status() })); return; }
      if (req.method === 'POST' && u.pathname === '/api/run') { deps.startCycle().catch(() => undefined); res.end(JSON.stringify({ ok: true })); return; }
      if (req.method === 'POST' && u.pathname === '/api/execute') { const b = await body(req); deps.execute(b.titles || [], b.humanTitles || []).catch(() => undefined); res.end(JSON.stringify({ ok: true })); return; }
      if (req.method === 'POST' && u.pathname === '/api/stop') { deps.stop(); res.end(JSON.stringify({ ok: true })); return; }
      res.statusCode = 404; res.end('{}');
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: e?.message })); }
  });
  server.on('error', () => { server = null; });
  server.listen(PORT, '0.0.0.0');
}
export function stopRemote(): void { try { server?.close(); } catch { /* */ } server = null; }

// ── 📱 모바일 리모컨 페이지 (단일 HTML — 매트릭스 그린 테마) ──────────────────
const PAGE = (company: string) => `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>${company} 리모컨</title><style>
:root{--g:#39ff14;--bg:#020804;--card:rgba(0,30,15,.6);--bd:rgba(57,255,20,.25);--dim:#86a096}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:#d6ffe0;font-family:-apple-system,'SF Pro Display',system-ui,sans-serif;min-height:100vh;padding:18px 16px 90px}
.logo{font-weight:900;letter-spacing:2px;color:var(--g);text-shadow:0 0 18px rgba(57,255,20,.6);font-size:18px}
.sub{color:var(--dim);font-size:12px;margin-top:2px}
.phase{display:inline-block;margin-top:10px;font-size:11px;font-weight:800;border:1px solid var(--bd);border-radius:999px;padding:4px 12px;color:#9fe6b4;background:rgba(57,255,20,.07)}
.sum{font-style:italic;color:#c7ffd8;font-size:13px;line-height:1.5;margin:12px 0 4px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:13px 14px;margin:9px 0;display:flex;gap:10px;align-items:center}
.card.off{opacity:.45}
.chk{width:22px;height:22px;border-radius:7px;border:2px solid var(--bd);flex-shrink:0;display:grid;place-items:center;font-weight:900;color:#052}
.card.sel .chk{background:var(--g);border-color:var(--g)}
.t{flex:1;font-size:14px;font-weight:600;line-height:1.45}
.who{font-size:10px;font-weight:800;border-radius:999px;padding:3px 8px;white-space:nowrap;border:1px solid var(--bd);color:#9fe6b4}
.who.me{color:#ffd166;border-color:rgba(255,209,102,.5)}
.st{font-size:11px;font-weight:800;white-space:nowrap}
.st.ok{color:var(--g)} .st.run{color:#7fdcff} .st.fail{color:#ff8a8a} .st.wait{color:var(--dim)}
.feed{background:rgba(0,10,4,.7);border:1px solid var(--bd);border-radius:12px;padding:10px 12px;margin-top:10px;font:11.5px/1.6 ui-monospace,monospace;max-height:200px;overflow-y:auto}
.feed div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;flex-basis:100%}
.art{font-size:10.5px;font-weight:700;color:#d6ffe6;background:rgba(57,255,20,.1);border:1px solid var(--bd);border-radius:7px;padding:3px 8px;font-family:ui-monospace,monospace}
.bar{position:fixed;left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 30%);display:flex;gap:10px}
button{flex:1;padding:15px;border-radius:13px;border:none;font-size:15px;font-weight:800;font-family:inherit}
.go{background:linear-gradient(135deg,#39ff14,#16a34a);color:#052;box-shadow:0 0 22px rgba(57,255,20,.45)}
.ghost{background:rgba(255,255,255,.06);color:var(--dim);border:1px solid rgba(255,255,255,.14);flex:0 0 auto;padding:15px 16px}
.spin{display:inline-block;width:13px;height:13px;border-radius:50%;border:2px solid rgba(57,255,20,.3);border-top-color:var(--g);animation:sp .7s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
.empty{color:var(--dim);text-align:center;padding:40px 10px;font-size:13.5px;line-height:1.7}
</style></head><body>
<div class="logo">✦ ${company}</div><div class="sub">모바일 사령부 — 컴퓨터의 AI 회사를 원격 지휘</div>
<div class="phase" id="phase">연결 중…</div>
<div class="sum" id="sum"></div>
<div id="list"><div class="empty">🚀 운영 시작을 누르면<br/>AI가 분석하고 작전을 제안합니다</div></div>
<div class="feed" id="feed" style="display:none"></div>
<div class="bar"><button class="ghost" id="stopB">⏹</button><button class="go" id="goB">🚀 운영 시작</button></div>
<script>
const k=new URLSearchParams(location.search).get('k')||'';
const api=(p,b)=>fetch(p+'?k='+k,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}).then(r=>r.json()).catch(()=>null);
const $=id=>document.getElementById(id);
let ops=null,sel={},mode='idle';
const esc=s=>String(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const PH={planning:'🔍 분석 중…',review:'☑️ 작전을 골라주세요',executing:'⚡ 실행 중…',done:'🏁 사이클 완료',idle:'대기'};
function render(){
  if(!ops)return;
  $('phase').innerHTML=(ops.busy||ops.phase==='planning'?'<span class="spin"></span> ':'')+(PH[ops.phase]||'대기')+(ops.cycle?' · #'+ops.cycle:'');
  $('sum').textContent=ops.summary?'“'+ops.summary+'”':'';
  const L=$('list'),F=$('feed');
  if(ops.phase==='review'){
    mode='review';
    L.innerHTML=(ops.actions||[]).map((a,i)=>{const on=sel[a.title]!==false;
      return '<div class="card '+(on?'sel':'off')+'" data-t="'+esc(a.title)+'"><div class="chk">'+(on?'✓':'')+'</div><div class="t">'+esc(a.title)+'</div><span class="who '+(a.assignee==='human'?'me':'')+'">'+(a.assignee==='human'?'🙋 내가':'🤖 에이전트')+'</span></div>';}).join('');
    L.querySelectorAll('.card').forEach(c=>c.onclick=()=>{const t=c.dataset.t;sel[t]=sel[t]===false?true:false;render();});
    $('goB').textContent='▶ 선택한 작전 실행'; F.style.display='none';
  } else if(ops.phase==='executing'){
    mode='exec';
    L.innerHTML=(ops.actions||[]).map(a=>{const sh=(ops.shipped||[]).find(x=>x.title===a.title);const run=ops.executingTitle===a.title;
      let st='<span class="st wait">대기</span>';if(run)st='<span class="st run"><span class="spin"></span> 실행 중</span>';else if(sh)st=sh.ok?'<span class="st ok">✅ 완료</span>':'<span class="st fail">미완</span>';
      const arts=sh&&sh.artifacts&&sh.artifacts.length?'<div class="arts">'+sh.artifacts.map(x=>'<span class="art">'+esc(x)+'</span>').join('')+'</div>':'';
      return '<div class="card" style="flex-wrap:wrap"><div class="t">'+esc(a.title)+'</div>'+st+arts+'</div>';}).join('');
    F.style.display='';F.innerHTML=(ops.feed||[]).slice(0,8).map(f=>'<div>'+esc(f.icon||'🔧')+' '+esc(f.text||'')+'</div>').join('');
    $('goB').textContent='⚡ 실행 중…';
  } else if(ops.phase==='done'){
    mode='done';
    const ships=(ops.shipped||[]).slice(0,8);
    L.innerHTML=ships.map(s=>'<div class="card" style="flex-wrap:wrap"><div class="t">'+esc(s.title)+'</div><span class="st '+(s.ok?'ok':'fail')+'">'+(s.ok?'✅':'⚠️')+'</span>'+((s.artifacts||[]).length?'<div class="arts">'+s.artifacts.map(x=>'<span class="art">'+esc(x)+'</span>').join('')+'</div>':'')+'</div>').join('');
    F.style.display='none';$('goB').textContent='▶ 다음 사이클';
  } else if(mode==='idle'){ $('goB').textContent='🚀 운영 시작'; }
}
$('goB').onclick=async()=>{
  if(mode==='review'){const titles=(ops.actions||[]).filter(a=>sel[a.title]!==false).map(a=>a.title);
    const humans=(ops.actions||[]).filter(a=>sel[a.title]!==false&&a.assignee==='human').map(a=>a.title);
    if(!titles.length)return alert('작전을 하나 이상 선택하세요');
    await api('/api/execute',{titles,humanTitles:humans});}
  else if(mode!=='exec'){sel={};await api('/api/run');}
};
$('stopB').onclick=()=>api('/api/stop');
async function tick(){const r=await api('/api/status');if(r&&r.ok){ops=r.ops;render();}else{$('phase').textContent='⚠️ 연결 끊김 — 컴퓨터 앱이 켜져 있나요?';}}
tick();setInterval(tick,2000);
</script></body></html>`;
