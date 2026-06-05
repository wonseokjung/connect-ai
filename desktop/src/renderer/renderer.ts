// Connect AI Desktop 렌더러 — 익스텐션 디자인 그대로. preload window.connect 로 통신.
import { AGENTS, AGENT_ORDER } from '../agents';
import { BrainViz } from './brainviz';
declare global { interface Window { connect: any; webkitSpeechRecognition: any; SpeechRecognition: any; } }
const connect = window.connect;
const $ = (id: string) => document.getElementById(id)!;
let cfg: any = { company: '1인 기업', agentName: '에이전트', voice: true, plazaDbUrl: '' };
let busy = false;
const agentName = () => cfg.agentName || '에이전트';
const agentTag = () => `🤖 ${agentName()}`;

// ── 마크다운 ──────────────────────────────────────────
function escapeHtml(s: string) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]); }
function md(src: string): string {
  if (!src) return '';
  const blocks: string[] = [];
  let s = src.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, _l, code) => { blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`); return ` B${blocks.length - 1} `; });
  s = escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>').replace(/^##? (.+)$/gm, '<h3>$1</h3>')
    .replace(/^\s*(?:[-*]|\d+\.) (.+)$/gm, '<li>$1</li>');
  const lines = s.split('\n'); const out: string[] = []; let inList = false;
  for (const ln of lines) { if (/^<li>/.test(ln)) { if (!inList) { out.push('<ul>'); inList = true; } out.push(ln); } else { if (inList) { out.push('</ul>'); inList = false; } out.push(ln); } }
  if (inList) out.push('</ul>');
  return out.join('\n').replace(/\n(<\/?(?:ul|pre|h\d)>)/g, '$1').replace(/(<\/?(?:ul|pre|h\d)>)\n/g, '$1').replace(/\n/g, '<br>').replace(/ B(\d+) /g, (_m, i) => blocks[+i]);
}
function stripMd(s: string): string { return s.replace(/```[\s\S]*?```/g, ' 코드 블록 ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`#>_~]/g, '').trim(); }

// ── 메시지 (익스텐션 .msg 구조) ──────────────────────────
function addLog(who: string, text: string, mine = false, asMarkdown = false, color?: string) {
  const el = document.createElement('div');
  el.className = 'msg ' + (mine ? 'msg-user' : 'msg-ai');
  const first = Array.from(who)[0] || '';
  const avChar = mine ? '🧑' : ((first.codePointAt(0) || 0) >= 0x1F300 ? first : '✦');
  const avStyle = (!mine && color) ? ` style="background:${color};color:#fff;box-shadow:0 0 12px ${color}66"` : '';
  el.innerHTML = `<div class="msg-head"><div class="av ${mine ? 'av-user' : 'av-ai'}"${avStyle}>${avChar}</div><span>${escapeHtml(who)}</span></div><div class="msg-body">${asMarkdown ? md(text) : escapeHtml(text)}</div>`;
  $('chat').appendChild(el); $('chat').scrollTop = $('chat').scrollHeight; return el;
}
function setBody(el: HTMLElement, text: string, asMarkdown = false) {
  const b = el.querySelector('.msg-body'); if (b) b.innerHTML = asMarkdown ? md(text) : escapeHtml(text);
  $('chat').scrollTop = $('chat').scrollHeight;
}
function hint(msg: string) { const h = $('inputHint'); const orig = 'Enter 전송 · Shift+Enter 줄바꿈'; h.textContent = msg; setTimeout(() => { h.textContent = orig; }, 2600); }

// ── 음성 합성(TTS) ────────────────────────────────────
let voices: SpeechSynthesisVoice[] = [];
function pickVoice() { voices = speechSynthesis.getVoices(); buildVoiceList(); }
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function chosenVoice(): SpeechSynthesisVoice | null {
  if (cfg.voiceName) { const v = voices.find(v => v.name === cfg.voiceName); if (v) return v; }
  return voices.find(v => /ko(-|_)?KR/i.test(v.lang)) || voices.find(v => /korean/i.test(v.name)) || null;
}
// 🦾 자비스 활성화 효과음 (Web Audio 신스 비프)
function chime(kind: 'wake' | 'speak') {
  if (!cfg.jarvis) return;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ac = new AC(); const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o2.type = 'triangle'; o.connect(g); o2.connect(g); g.connect(ac.destination);
    const t = ac.currentTime, base = kind === 'wake' ? 760 : 560;
    o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.13);
    o2.frequency.setValueAtTime(base * 2, t); o2.frequency.exponentialRampToValueAtTime(base * 3, t + 0.13);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === 'wake' ? 0.07 : 0.045, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.start(t); o2.start(t); o.stop(t + 0.3); o2.stop(t + 0.3);
    setTimeout(() => ac.close(), 500);
  } catch { /* */ }
}
let ttsAudio: HTMLAudioElement | null = null;
async function speakCloud(text: string): Promise<boolean> {
  try {
    const r = await connect.ttsSpeak(text);
    if (!r || !r.ok || !r.dataUri) return false;
    if (ttsAudio) { try { ttsAudio.pause(); } catch { /* */ } }
    ttsAudio = new Audio(r.dataUri);
    ttsAudio.onplay = () => brainEnergy(0.95);
    ttsAudio.onended = () => brainEnergy(0.14);
    await ttsAudio.play();
    return true;
  } catch { return false; }
}
function speak(text: string) {
  if (!cfg.voice || !text) return;
  if (cfg.voiceQuality === 'qwen' || cfg.voiceQuality === 'edge') { speakCloud(text).then(ok => { if (!ok) speakBrowser(text); }); return; }
  speakBrowser(text);
}
function speakBrowser(text: string) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = chosenVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ko-KR';
  if (cfg.jarvis) { u.rate = 0.94; u.pitch = 0.82; chime('speak'); } else { u.rate = 1.04; u.pitch = 1; }
  // 🧠 말하는 동안 두뇌가 출렁
  u.onstart = () => brainEnergy(0.95);
  u.onboundary = () => brainEnergy(0.7 + Math.random() * 0.3);
  u.onend = () => brainEnergy(0.14);
  speechSynthesis.speak(u);
}
function buildVoiceList() {
  const sel = document.getElementById('cfgVoiceName') as HTMLSelectElement | null;
  if (!sel || !voices.length) return;
  const cur = cfg.voiceName || '';
  sel.innerHTML = '<option value="">자동 (한국어)</option>' + voices.map(v => `<option value="${escapeHtml(v.name)}"${v.name === cur ? ' selected' : ''}>${escapeHtml(v.name)} (${v.lang})</option>`).join('');
}

// ── 설정 ─────────────────────────────────────────────
function applyCfgLabels() {
  $('brandSuffix').textContent = cfg.company ? `· ${cfg.company}` : '';
  inputEl.placeholder = `${agentName()}에게 무엇이든…`;
  // 명찰 입력과 설정 입력은 같은 agentName을 공유 — 양쪽 동기화
  const pa = $('plazaAgentName') as HTMLInputElement | null; if (pa) pa.value = cfg.agentName && cfg.agentName !== '에이전트' ? cfg.agentName : '';
}
async function loadCfg() {
  cfg = await connect.getConfig();
  ($('cfgDbUrl') as HTMLInputElement).value = cfg.plazaDbUrl || '';
  ($('cfgLlmBase') as HTMLInputElement).value = cfg.llmBase || '';
  ($('cfgGreeting') as HTMLInputElement).value = cfg.greeting || '';
  ($('cfgAgentName') as HTMLInputElement).value = cfg.agentName && cfg.agentName !== '에이전트' ? cfg.agentName : '';
  ($('cfgUserTitle') as HTMLInputElement).value = cfg.userTitle && cfg.userTitle !== '사장님' ? cfg.userTitle : '';
  ($('cfgVoice') as HTMLInputElement).checked = cfg.voice !== false;
  ($('cfgJarvis') as HTMLInputElement).checked = cfg.jarvis !== false;
  buildVoiceList();
  ($('cfgTools') as HTMLInputElement).checked = cfg.tools !== false;
  ($('cfgVoicePick') as HTMLSelectElement).value =
    cfg.voiceQuality === 'edge' ? 'edge:' + (cfg.qwenVoice || 'ko-KR-SunHiNeural')
    : cfg.voiceQuality === 'qwen' ? 'qwen:' + (cfg.qwenVoice || 'Sohee')
    : 'browser';
  ($('cfgTtsLocalUrl') as HTMLInputElement).value = cfg.ttsLocalUrl || '';
  ($('cfgBriefing') as HTMLInputElement).checked = cfg.briefingOn !== false;
  ($('cfgAutoSync') as HTMLInputElement).checked = cfg.autoSync !== false;
  ($('cfgBriefingTime') as HTMLInputElement).value = `${String(cfg.briefingHour ?? 9).padStart(2, '0')}:${String(cfg.briefingMin ?? 0).padStart(2, '0')}`;
  ($('cfgTrainUrl') as HTMLInputElement).value = cfg.trainNotebookUrl || '';
  connect.safeModeGet().then((on: boolean) => { ($('cfgSafeMode') as HTMLInputElement).checked = !!on; });
  connect.getWorkspace().then((w: string) => { ($('cfgWorkspace') as HTMLInputElement).value = w; });
  // 명찰 (이름·회사·아바타는 여기서만)
  ($('plazaEmoji') as HTMLInputElement).value = cfg.plazaEmoji || '🖥️';
  ($('plazaCompany') as HTMLInputElement).value = cfg.company || '';
  ($('plazaAgentName') as HTMLInputElement).value = cfg.agentName || '';
  applyCfgLabels();
}
// 명찰 변경 → 저장 (다음 등교부터 반영)
async function saveNameTag() {
  cfg = await connect.setConfig({
    plazaEmoji: ($('plazaEmoji') as HTMLInputElement).value.trim() || '🖥️',
    company: ($('plazaCompany') as HTMLInputElement).value.trim() || '1인 기업',
    agentName: ($('plazaAgentName') as HTMLInputElement).value.trim() || '에이전트',
  });
  applyCfgLabels();
  if (plazaJoined) hint('명찰 바뀜 — 하교 후 다시 등교하면 적용돼요');
}
['plazaEmoji', 'plazaCompany', 'plazaAgentName'].forEach(id => $(id).addEventListener('change', saveNameTag));
$('saveCfg').addEventListener('click', async () => {
  cfg = await connect.setConfig({
    plazaDbUrl: ($('cfgDbUrl') as HTMLInputElement).value.trim(),
    llmBase: ($('cfgLlmBase') as HTMLInputElement).value.trim(),
    greeting: ($('cfgGreeting') as HTMLInputElement).value.trim(),
    agentName: ($('cfgAgentName') as HTMLInputElement).value.trim() || '에이전트',
    userTitle: ($('cfgUserTitle') as HTMLInputElement).value.trim() || '사장님',
    voice: ($('cfgVoice') as HTMLInputElement).checked,
    jarvis: ($('cfgJarvis') as HTMLInputElement).checked,
    voiceName: ($('cfgVoiceName') as HTMLSelectElement).value,
    voiceQuality: ($('cfgVoicePick') as HTMLSelectElement).value.split(':')[0],
    qwenVoice: (($('cfgVoicePick') as HTMLSelectElement).value.split(':').slice(1).join(':')) || 'ko-KR-SunHiNeural',
    ttsLocalUrl: ($('cfgTtsLocalUrl') as HTMLInputElement).value.trim(),
    tools: ($('cfgTools') as HTMLInputElement).checked,
    briefingOn: ($('cfgBriefing') as HTMLInputElement).checked,
    autoSync: ($('cfgAutoSync') as HTMLInputElement).checked,
    briefingHour: parseInt((($('cfgBriefingTime') as HTMLInputElement).value || '09:00').split(':')[0], 10) || 9,
    briefingMin: parseInt((($('cfgBriefingTime') as HTMLInputElement).value || '09:00').split(':')[1], 10) || 0,
    trainNotebookUrl: ($('cfgTrainUrl') as HTMLInputElement).value.trim(),
  });
  applyCfgLabels();
  closeOverlay('settingsPanel'); loadModels(); hint('설정을 저장했어요 ✅');
});
$('briefNowBtn').addEventListener('click', () => { connect.briefingRun(); closeOverlay('settingsPanel'); hint('📋 브리핑을 준비하고 있어요…'); });
$('pickWorkspace').addEventListener('click', async () => {
  const w = await connect.pickWorkspace();
  ($('cfgWorkspace') as HTMLInputElement).value = w;
  hint('작업 폴더: ' + w);
});
// 목소리/모드 미리듣기 — Connect AI 브랜딩 (언어 자동)
function previewLine(): string {
  const v = chosenVoice();
  return v && /^en/i.test(v.lang) ? 'Connect AI online. Ready, sir.' : `Connect AI 준비 완료. ${agentName()} 대기 중입니다.`;
}
$('cfgVoiceName').addEventListener('change', (e: any) => { cfg.voiceName = e.target.value; cfg.voice = true; speak(previewLine()); });
$('cfgJarvis').addEventListener('change', (e: any) => { cfg.jarvis = e.target.checked; cfg.voice = true; speak(previewLine()); });
// 목소리 바꾸면 즉시 미리듣기
$('cfgVoicePick').addEventListener('change', async (e: any) => {
  const v = (e.target.value as string); cfg.voiceQuality = v.split(':')[0]; cfg.qwenVoice = v.split(':').slice(1).join(':') || 'ko-KR-SunHiNeural'; cfg.voice = true;
  cfg = await connect.setConfig({ voiceQuality: cfg.voiceQuality, qwenVoice: cfg.qwenVoice });  // 저장해야 main이 미리듣기 가능
  hint('🔊 미리듣기…'); speak(previewLine());
});

// ── 모델 드롭다운 (로드된 채팅 모델 자동) ──────────────────
let MODELS_CACHE: string[] = [];
let MODELS_LOADED = '';
async function loadModels() {
  const sel = $('modelSel') as HTMLSelectElement;
  const info = await connect.listModels();
  sel.innerHTML = '';
  if (!info || !info.models?.length) { const o = document.createElement('option'); o.textContent = '로컬 AI 없음'; sel.appendChild(o); MODELS_CACHE = []; return; }
  MODELS_CACHE = info.models; MODELS_LOADED = info.loaded || '';
  for (const m of info.models) { const o = document.createElement('option'); o.value = m; o.textContent = m + (/^gemini/i.test(m) ? '  ☁️ 클라우드' : (m === info.loaded ? '  ● 로드됨' : '')); sel.appendChild(o); }
  sel.value = (cfg.llmModel && info.models.includes(cfg.llmModel)) ? cfg.llmModel : (info.loaded || info.models[0]);
  cfg = await connect.setConfig({ llmBase: info.base, llmModel: sel.value });
}
$('modelSel').addEventListener('change', async (e) => { cfg = await connect.setConfig({ llmModel: (e.target as HTMLSelectElement).value }); hint('모델: ' + cfg.llmModel); });

// ── 📎 첨부 (파일·이미지 끌어다 놓기) ─────────────────────
type Attach = { path: string; name: string; image?: string };
let attachments: Attach[] = [];
const isImg = (name: string) => /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(name);
function renderChips() {
  const box = $('attachChips'); if (!box) return;
  box.innerHTML = attachments.map((a, i) =>
    `<span class="chip">${a.image ? '🖼️' : '📄'} ${escapeHtml(a.name)} <b data-rm="${i}">✕</b></span>`).join('');
  box.querySelectorAll('[data-rm]').forEach(el => el.addEventListener('click', (e) => {
    attachments.splice(parseInt((e.target as HTMLElement).dataset.rm!, 10), 1); renderChips();
  }));
  (box as HTMLElement).style.display = attachments.length ? 'flex' : 'none';
}
async function addFiles(files: FileList | File[]) {
  for (const f of Array.from(files)) {
    const p = (connect.pathForFile ? connect.pathForFile(f) : (f as any).path) || '';
    const a: Attach = { path: p, name: f.name };
    if (isImg(f.name)) { try { a.image = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); }); } catch { /* */ } }
    attachments.push(a);
  }
  renderChips();
}
// 드래그&드롭 (창 전체에서 받기)
['dragover', 'drop'].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); }));
document.addEventListener('dragover', () => $('inputBox')?.classList.add('drag'));
document.addEventListener('dragleave', () => $('inputBox')?.classList.remove('drag'));
document.addEventListener('drop', (e: any) => { $('inputBox')?.classList.remove('drag'); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
$('attachBtn')?.addEventListener('click', () => ($('fileInput') as HTMLInputElement).click());
$('fileInput')?.addEventListener('change', (e: any) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; });

// ── 전송 ─────────────────────────────────────────────
async function ask(text: string) {
  text = text.trim();
  if ((!text && !attachments.length) || busy) return;
  const att = attachments; attachments = []; renderChips();
  const chipLine = att.length ? `\n\n📎 ${att.map(a => a.name).join(', ')}` : '';
  busy = true; addLog('사장님', (text || '(첨부 파일 참고)') + chipLine, true);
  ($('sendBtn') as HTMLElement).hidden = true; ($('stopBtn') as HTMLElement).hidden = false;
  $('thinkingBar').classList.add('active'); $('brandSuffix').textContent = '· 생각 중…';
  brainEnergy(0.7);  // 🧠 두뇌 활성화
  let finalText = ''; let liveEl: HTMLElement | null = null; let teamEngaged = false;
  // 🪟 사무실은 별도 창 전용 — 팀 작업 시작되면 옆 창 자동으로 띄움(메인 창은 채팅 집중)
  const ensureOffice = () => { if (teamEngaged) return; teamEngaged = true; connect.officeOpen?.(); };
  const off = connect.onEngineEvent((e: any) => {
    if (e.kind === 'status') { hint(e.text); brainEnergy(0.68); }
    else if (e.kind === 'dispatch') { ensureOffice(); brainEnergy(0.95); }
    else if (e.kind === 'agentStart') { hint(`${e.emoji} ${e.name} 작업 중…`); ensureOffice(); brainEnergy(0.85); }
    else if (e.kind === 'agentChunk') { brainEnergy(0.85); }
    else if (e.kind === 'agentDone') { addLog(`${e.emoji || AGENTS[e.id]?.emoji || '🤖'} ${AGENTS[e.id]?.name || e.id}`, e.output || '(결과 없음)', false, true, AGENTS[e.id]?.color); }
    else if (e.kind === 'agentConfer') { brainEnergy(0.8); }
    else if (e.kind === 'tool') { const lbl: any = { list_dir: '📁 폴더 확인', find: '🔎 파일 검색', read_file: '📄 파일 읽음', write_file: '📝 파일 생성', run_command: '⚡ 명령 실행', task: '📋 할 일 등록', remember: '🧠 기억함', approve: '✅ 승인 요청', mcp: '🧩 MCP 도구', web_search: '🌐 웹 검색', fetch_url: '🌐 페이지 읽기', revenue: '💰 매출 확인', screenshot: '👁️ 화면 봄', clipboard: '📋 클립보드', open: '🚀 열기/실행', serve: '🖥️ 서버 실행', youtube: '📺 유튜브 분석', telegram: '✈️ 텔레그램 전송' }; addLog(lbl[e.name] || '🔧 도구', `${e.ok ? '' : '⚠️ 실패 · '}${e.path}`, false, false, e.name === 'run_command' ? '#ffab40' : '#06aa45'); brainEnergy(0.9);
      if (e.name === 'write_file') codeBump(true); else if (e.name === 'run_command' || e.name === 'serve') codeBump(false); }
    else if (e.kind === 'token') { finalText += e.text; if (!liveEl) liveEl = addLog(agentTag(), '', false, true); setBody(liveEl, finalText, true); brainEnergy(0.88); }
    else if (e.kind === 'final') { finalText = e.text; if (liveEl) setBody(liveEl, finalText, true); else addLog(agentTag(), finalText, false, true); speak(stripMd(finalText)); brainEnergy(0.95); }
    else if (e.kind === 'error') { addLog(agentTag(), e.text, false, true); speak(e.text); }
  });
  try { await connect.run(text || '첨부한 파일/이미지를 봐줘.', { paths: att.map(a => a.path).filter(Boolean), images: att.map(a => a.image).filter(Boolean) }); }
  finally { off(); busy = false; ($('stopBtn') as HTMLElement).hidden = true; ($('sendBtn') as HTMLElement).hidden = false; $('thinkingBar').classList.remove('active'); $('brandSuffix').textContent = cfg.company ? `· ${cfg.company}` : ''; setTimeout(() => { if (!busy && !speechSynthesis.speaking) brainEnergy(0.13); }, 600); }
}
const inputEl = $('input') as HTMLTextAreaElement;
function sendFromInput() { if (!inputEl.value.trim() && !attachments.length) return; ask(inputEl.value); inputEl.value = ''; inputEl.style.height = 'auto'; }
$('sendBtn').addEventListener('click', sendFromInput);
$('stopBtn').addEventListener('click', () => { connect.stop(); hint('중단하는 중…'); });
inputEl.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromInput(); } });
inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px'; });
$('newChatBtn').addEventListener('click', async () => { await connect.reset(); $('chat').innerHTML = ''; greet(); hint('새 대화를 시작했어요'); });

// ── 오버레이 (광장·설정) ───────────────────────────────
function openOverlay(id: string) { $(id).classList.remove('hidden'); }
function closeOverlay(id: string) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeOverlay((b as HTMLElement).dataset.close!)));
$('settingsBtn').addEventListener('click', () => openOverlay('settingsPanel'));
// 🛡️ 안전 모드 (GPU 끄기) — 재시작해야 적용
$('cfgSafeMode').addEventListener('change', async (e: any) => {
  await connect.safeModeSet(e.target.checked);
  hint(e.target.checked ? '안전 모드 ON — 재시작하면 적용돼요' : '안전 모드 OFF — 재시작하면 적용돼요');
});
$('relaunchBtn').addEventListener('click', () => connect.relaunch());
$('diagBtn').addEventListener('click', () => connect.openDiagnostics());

// ── 🗂️ 관리 허브 (대시보드·서비스·연동) ──────────────
$('manageBtn').addEventListener('click', async () => { openOverlay('managePanel'); switchMtab('dash'); await Promise.all([loadServices(), loadIntegrations()]); });
document.querySelectorAll('.mtab').forEach(b => b.addEventListener('click', () => switchMtab((b as HTMLElement).dataset.mtab!)));
$('openRevenueBtn').addEventListener('click', () => connect.openRevenue());
$('svcReviewBtn').addEventListener('click', () => { closeOverlay('managePanel'); ask('내가 등록한 모든 서비스를 점검해줘. 각 서비스의 사이트/채널을 web_search·fetch_url 로 확인하고, 오늘 우선순위로 할 만한 개선·성장 액션을 서비스별로 <task>로 만들어줘.'); });
function switchMtab(tab: string) {
  document.querySelectorAll('.mtab').forEach(x => x.classList.toggle('active', (x as HTMLElement).dataset.mtab === tab));
  ['dash', 'svc', 'integ', 'mcp'].forEach(s => $('msec-' + s).classList.toggle('hidden', s !== tab));
  if (tab === 'dash') renderDash();
  if (tab === 'mcp') loadMcp();
}
// 🤖 AI 선택 패널
const LOCAL_BASE = 'http://127.0.0.1:1235';
$('aiBtn').addEventListener('click', () => { openOverlay('aiPanel'); loadAiPanel(); });
async function loadAiPanel() { await Promise.all([renderAiCurrent(), loadLocalAI(), loadParams()]); }
async function renderAiCurrent() {
  const cfg = await connect.getConfig();
  const ls = _localStatus || (await connect.localStatus?.());
  const el = $('aiCurrent'); if (!el) return;
  let icon = '🧠', name = '', tag = '', on = false;
  if (ls?.loading) { icon = '⏳'; name = '불러오는 중'; }
  else if (ls?.running && (cfg.llmBase || '').includes(':1235')) { name = ls.modelName; tag = '내장 · ' + (ls.gpu === 'metal' ? 'GPU' : ls.gpu || 'CPU'); on = true; }
  else if (cfg.llmModel) { const g = /gemini/i.test(cfg.llmModel); icon = g ? '☁️' : '🧠'; name = cfg.llmModel; tag = g ? 'Gemini' : (cfg.llmBase || '').includes('11434') ? 'Ollama' : 'LM Studio'; }
  else { icon = '🧠'; name = 'AI를 골라주세요'; tag = '아래에서 받아 사용'; }
  el.innerHTML = `<div class="aic-icon">${icon}</div><div class="aic-info"><div class="aic-name">${name}</div><div class="aic-tag">${tag}</div></div>`;
  el.className = 'ai-current' + (on ? ' on' : '');
}
// ⚙️ 추론 파라미터 (프로 콘솔)
let _params: any = {};
const SLIDERS = [
  { id: 'apTemp', val: 'apTempVal', key: 'temp', sc: 100, dp: 2 },
  { id: 'apTopP', val: 'apTopPVal', key: 'topP', sc: 100, dp: 2 },
  { id: 'apTopK', val: 'apTopKVal', key: 'topK', sc: 1, dp: 0 },
  { id: 'apMinP', val: 'apMinPVal', key: 'minP', sc: 100, dp: 2 },
  { id: 'apRep', val: 'apRepVal', key: 'repeatPenalty', sc: 100, dp: 2 },
];
const DEF_PARAMS = { temp: 0.7, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.1, flashAttn: true, ctxSize: 4096, maxTokens: 1024 };
const applyParams = async (patch: any) => { _params = await connect.localSetOptions?.(patch); await renderAiCurrent(); };
async function loadParams() {
  _params = (await connect.localOptions?.()) || _params;
  ($('apFlash') as HTMLInputElement).checked = !!_params.flashAttn;
  document.querySelectorAll('#apCtx button').forEach(b => b.classList.toggle('on', Number((b as HTMLElement).dataset.ctx) === _params.ctxSize));
  document.querySelectorAll('#apMax button').forEach(b => b.classList.toggle('on', Number((b as HTMLElement).dataset.max) === _params.maxTokens));
  for (const d of SLIDERS) { const v = _params[d.key] ?? 0; const el = $(d.id) as HTMLInputElement; if (el) el.value = String(Math.round(v * d.sc)); const vv = $(d.val); if (vv) vv.textContent = v.toFixed(d.dp); }
}
$('apFlash')?.addEventListener('change', (e) => applyParams({ flashAttn: (e.target as HTMLInputElement).checked }));
const segPick = (id: string, key: string, attr: string) => $(id)?.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; document.querySelectorAll('#' + id + ' button').forEach(x => x.classList.toggle('on', x === b)); applyParams({ [key]: Number((b as HTMLElement).dataset[attr]) }); });
segPick('apCtx', 'ctxSize', 'ctx'); segPick('apMax', 'maxTokens', 'max');
for (const d of SLIDERS) {
  const el = $(d.id); if (!el) continue;
  el.addEventListener('input', (e) => { const v = Number((e.target as HTMLInputElement).value) / d.sc; $(d.val).textContent = v.toFixed(d.dp); });
  el.addEventListener('change', (e) => applyParams({ [d.key]: Number((e.target as HTMLInputElement).value) / d.sc }));
}
$('apReset')?.addEventListener('click', async () => { _params = await connect.localSetOptions?.({ ...DEF_PARAMS }); await loadParams(); await renderAiCurrent(); });

// ─────────── 🧠 내장 AI (LM Studio 불필요) + 🤗 HuggingFace 모델 ───────────
const fmtGB = (b: number) => b >= 1e9 ? (b / 1e9).toFixed(1) + 'GB' : Math.max(1, Math.round(b / 1e6)) + 'MB';
let _localStatus: any = null;
function renderLocalStatus() {
  const s = _localStatus || {};
  const el = $('localStatus'); if (!el) return;
  if (s.loading) { el.innerHTML = '⏳ 모델 로딩 중…'; el.className = 'local-status loading'; }
  else if (s.running) { el.innerHTML = `🟢 <b>${s.modelName}</b> 실행 중 <span class="ls-badge">LM Studio 불필요 · ${s.gpu === 'metal' ? 'GPU' : s.gpu || 'CPU'}</span> <button id="localStopBtn" class="upd-ghost">끄기</button>`; el.className = 'local-status on'; }
  else if (s.error) { el.innerHTML = `⚠️ ${s.error}`; el.className = 'local-status err'; }
  else { el.innerHTML = '⚪ 내장 AI 꺼짐 — 아래에서 모델을 받아 <b>사용</b>을 누르세요.'; el.className = 'local-status'; }
  const stop = $('localStopBtn'); if (stop) stop.addEventListener('click', async () => { _localStatus = await connect.localStop?.(); renderLocalStatus(); loadLocalAI(); });
}
async function loadLocalAI() {
  try { _localStatus = await connect.localStatus?.(); } catch { /* */ } renderLocalStatus();
  // 내 모델
  const models = (await connect.localModels?.()) || [];
  const cur = _localStatus?.modelPath;
  $('localModels').innerHTML = models.length ? models.map((m: any) =>
    `<div class="lm-row ${m.path === cur ? 'active' : ''}"><span class="lm-name">${m.name}</span><span class="muted small">${fmtGB(m.size)}</span>` +
    `<button class="lm-use oc-primary" data-path="${encodeURIComponent(m.path)}">${m.path === cur ? '사용 중' : '사용'}</button>` +
    (m.removable ? `<button class="lm-del" data-del="${encodeURIComponent(m.path)}" title="삭제">🗑️</button>` : '') + `</div>`).join('')
    : '<div class="muted small">받은 모델이 없어요. 아래 검색에서 받거나 LM Studio 모델을 쓰세요.</div>';
  $('localModels').querySelectorAll('.lm-use').forEach(b => b.addEventListener('click', async () => {
    const p = decodeURIComponent((b as HTMLElement).dataset.path!); (b as HTMLElement).textContent = '⏳ 켜는 중…';
    _localStatus = await connect.localStart?.(p);
    // 비서가 내장 엔진을 쓰도록 설정 (LM Studio보다 우선)
    if (_localStatus?.running) await connect.setConfig({ llmBase: LOCAL_BASE, llmModel: _localStatus.modelName });
    renderLocalStatus(); await loadLocalAI(); await renderAiCurrent(); await loadModels(); refreshMem?.();
  }));
  $('localModels').querySelectorAll('.lm-del').forEach(b => b.addEventListener('click', async () => {
    const p = decodeURIComponent((b as HTMLElement).dataset.del!); await connect.localDelete?.(p); loadLocalAI();
  }));
}
$('hfSearchBtn')?.addEventListener('click', doHfSearch);
$('hfQuery')?.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') doHfSearch(); });
async function doHfSearch() {
  const q = ($('hfQuery') as HTMLInputElement).value.trim();
  $('hfResults').innerHTML = '<div class="muted small">🔍 검색 중…</div>';
  const r = await connect.hfSearch?.(q);
  if (!r?.ok) { $('hfResults').innerHTML = `<div class="muted small">⚠️ ${r?.error || '검색 실패'}</div>`; return; }
  $('hfResults').innerHTML = (r.models || []).map((m: any) =>
    `<div class="hf-row" data-repo="${m.id}"><span class="hf-id">${m.id}</span><span class="muted small">⬇ ${m.downloads.toLocaleString()}</span></div>`).join('') || '<div class="muted small">결과 없음</div>';
  $('hfResults').querySelectorAll('.hf-row').forEach(b => b.addEventListener('click', () => pickRepo((b as HTMLElement).dataset.repo!)));
}
async function pickRepo(repo: string) {
  $('hfResults').innerHTML = `<div class="muted small">📂 ${repo} 파일 불러오는 중…</div>`;
  const r = await connect.hfFiles?.(repo);
  if (!r?.ok) { $('hfResults').innerHTML = `<div class="muted small">⚠️ ${r?.error || '실패'}</div>`; return; }
  const files = r.files || [];
  $('hfResults').innerHTML = `<div class="hf-back muted small">← ${repo}</div>` + (files.length ? files.map((f: any) =>
    `<div class="hf-row file"><span class="hf-q">${f.quant}</span><span class="muted small">${fmtGB(f.size)}</span>` +
    `<button class="hf-get oc-primary" data-repo="${repo}" data-file="${encodeURIComponent(f.path)}">받기</button></div>`).join('')
    : '<div class="muted small">이 레포에 GGUF 파일이 없어요.</div>');
  $('hfResults').querySelector('.hf-back')?.addEventListener('click', doHfSearch);
  $('hfResults').querySelectorAll('.hf-get').forEach(b => b.addEventListener('click', () => doDownload((b as HTMLElement).dataset.repo!, decodeURIComponent((b as HTMLElement).dataset.file!), b as HTMLElement)));
}
async function doDownload(repo: string, file: string, btn: HTMLElement) {
  btn.textContent = '⏳'; (btn as HTMLButtonElement).disabled = true;
  $('hfDl').hidden = false; $('hfDlText').textContent = `${file} 받는 중…`;
  const r = await connect.hfDownload?.(repo, file);
  $('hfDl').hidden = true;
  if (!r?.ok) { $('hfDlText').textContent = ''; btn.textContent = '재시도'; (btn as HTMLButtonElement).disabled = false; alert('다운로드 실패: ' + (r?.error || '')); return; }
  btn.textContent = '✓ 받음'; await loadLocalAI();
}
connect.onHfProgress?.((p: any) => {
  if ($('hfDl').hidden) $('hfDl').hidden = false;
  ($('hfDlFill') as HTMLElement).style.width = (p.percent || 0) + '%';
  $('hfDlText').textContent = `${p.percent || 0}% · ${fmtGB(p.received)}${p.total ? ' / ' + fmtGB(p.total) : ''}`;
});
connect.onLocalStatus?.((s: any) => { _localStatus = s; renderLocalStatus(); renderAiCurrent(); });
// 🧩 MCP
async function loadMcp() {
  const cfg = await connect.mcpGet();
  if (cfg && Object.keys(cfg).length) ($('mcpConfig') as HTMLTextAreaElement).value = JSON.stringify(cfg, null, 2);
}
async function saveMcp(): Promise<boolean> {
  const raw = ($('mcpConfig') as HTMLTextAreaElement).value.trim();
  let cfg: any = {}; if (raw) { try { cfg = JSON.parse(raw); } catch { $('mcpStatus').textContent = '⚠️ JSON 형식 오류'; return false; } }
  await connect.mcpSave(cfg); return true;
}
$('mcpSaveBtn').addEventListener('click', async () => { if (await saveMcp()) $('mcpStatus').textContent = '✅ 저장됨'; });
$('mcpTestBtn').addEventListener('click', async () => {
  if (!(await saveMcp())) return;
  $('mcpStatus').textContent = '🔌 연결 중…'; $('mcpTools').innerHTML = '';
  const servers = await connect.mcpTest();
  $('mcpStatus').textContent = `${servers.filter((s: any) => s.ok).length}/${servers.length} 서버 연결됨`;
  $('mcpTools').innerHTML = servers.map((s: any) => `<div class="mcp-srv ${s.ok ? 'on' : 'off'}"><div class="ms-name">${s.ok ? '🟢' : '🔴'} ${escapeHtml(s.name)} <span class="muted small">${s.ok ? s.tools + '개 도구' : escapeHtml(s.error || '실패')}</span></div>${s.toolNames?.length ? `<div class="ms-tools">${s.toolNames.map((t: string) => `<span class="ms-tool">${escapeHtml(t)}</span>`).join('')}</div>` : ''}</div>`).join('');
});
function renderAgentMatrix() {
  // 👥 에이전트 매트릭스 — 10명 카드(사진/이모지·역할), 클릭 → 상세. 정적 데이터라 즉시 렌더.
  $('agentMatrix').innerHTML = AGENT_ORDER.map(id => {
    const a = AGENTS[id]; if (!a) return '';
    const photo = PROFILE[id]
      ? `<div class="am-photo" style="background-image:url('../../assets/agents/${PROFILE[id]}');border-color:${a.color}"></div>`
      : `<div class="am-photo am-emoji" style="background:linear-gradient(160deg,color-mix(in srgb,${a.color} 42%,#0a120c),#0a120c);border-color:${a.color}">${a.emoji}</div>`;
    return `<div class="am-card" data-id="${id}" style="--ag:${a.color}">${photo}<div class="am-info"><div class="am-name">${a.emoji} ${escapeHtml(a.name)}</div><div class="am-role">${escapeHtml(a.role)}</div></div></div>`;
  }).join('');
  $('agentMatrix').querySelectorAll('.am-card').forEach(c => c.addEventListener('click', () => openAgentDetail((c as HTMLElement).dataset.id!)));
}
async function renderTasks() {
  const all = await connect.tasksList();
  const open = (all || []).filter((t: any) => t.status === 'open');
  if (!open.length) { $('taskBoard').innerHTML = '<div class="muted small" style="padding:6px 2px">열린 할 일이 없어요. 위에서 추가하거나, 에이전트에게 맡기면 자동으로 쌓여요.</div>'; return; }
  $('taskBoard').innerHTML = open.map((t: any) => `<div class="task-tile prio-${t.priority}">
    <div class="tt-emoji">${t.agentEmoji || (t.owner === 'user' ? '👤' : '🤖')}</div>
    <div class="tt-title">${escapeHtml(t.title)}</div>
    <div class="tt-actions"><button class="tt-done" data-id="${t.id}" title="완료">✓</button><button class="tt-cancel" data-id="${t.id}" title="삭제">✕</button></div>
  </div>`).join('');
  $('taskBoard').querySelectorAll('.tt-done').forEach(b => b.addEventListener('click', async () => { await connect.tasksDone((b as HTMLElement).dataset.id); renderTasks(); }));
  $('taskBoard').querySelectorAll('.tt-cancel').forEach(b => b.addEventListener('click', async () => { await connect.tasksCancel((b as HTMLElement).dataset.id); renderTasks(); }));
}
async function addTaskFromInput() {
  const inp = $('taskInput') as HTMLInputElement; const v = inp.value.trim(); if (!v) return;
  await connect.tasksAdd(v); inp.value = ''; renderTasks();
}
$('taskAddBtn').addEventListener('click', addTaskFromInput);
$('taskInput').addEventListener('keydown', (e: any) => { if (e.key === 'Enter') addTaskFromInput(); });
async function renderApprovals() {
  const all = await connect.approvalsList();
  const pend = (all || []).filter((a: any) => a.status === 'pending');
  if (!pend.length) { $('aprBoard').innerHTML = '<div class="muted small" style="padding:6px 2px">대기 중인 승인이 없어요.</div>'; return; }
  $('aprBoard').innerHTML = pend.map((a: any) => `<div class="apr-card${a.action ? ' is-exec' : ''}">
    <div class="ac-ic">${a.agentEmoji || '🤖'}</div>
    <div class="ac-body"><div class="ac-title">${escapeHtml(a.title)}${a.action ? `<span class="ac-exec">⚡ ${escapeHtml(a.action.kind)}</span>` : ''}</div>${a.summary ? `<div class="ac-sum">${escapeHtml(a.summary)}</div>` : ''}</div>
    <div class="ac-actions"><button class="ac-ok" data-id="${a.id}" title="${a.action ? '승인하고 실행' : '승인'}">✓</button><button class="ac-no" data-id="${a.id}" title="거절">✕</button></div>
  </div>`).join('');
  $('aprBoard').querySelectorAll('.ac-ok').forEach(b => b.addEventListener('click', async () => { const r = await connect.approvalsApprove((b as HTMLElement).dataset.id); renderApprovals(); if (r?.result) addLog('✅ 실행 결과', r.result, false, false, '#00cc77'); hint(r?.result ? '승인 + 실행 완료 ⚡' : '승인했어요 ✅'); }));
  $('aprBoard').querySelectorAll('.ac-no').forEach(b => b.addEventListener('click', async () => { await connect.approvalsReject((b as HTMLElement).dataset.id); renderApprovals(); }));
}
const fmtN = (n: number) => Number(n || 0).toLocaleString();
// 🧭 비즈니스 인텔리전스 — 등록 서비스의 실시간 스냅샷 + 분석 액션
async function renderServiceIntel() {
  $('svcIntel').innerHTML = '<div class="muted small" style="padding:6px 2px">🌐 서비스 정보 읽는 중…</div>';
  const list = await connect.servicesIntel();
  if (!list || !list.length) { $('svcIntel').innerHTML = '<div class="muted small" style="padding:6px 2px">🗂️ 내 서비스 탭에서 등록하면 → 여기서 그 URL을 실시간으로 읽어 파악하고 분석합니다.</div>'; return; }
  $('svcIntel').innerHTML = list.map((s: any) => `<div class="si-card">
    <div class="si-head"><span class="si-ic">${s.type === 'youtube' ? '📺' : '🌐'}</span>
      <div class="si-info"><a class="si-name" data-url="${escapeHtml(s.url)}">${escapeHtml(s.name)}</a><div class="si-url">${escapeHtml(s.url || '')}</div></div>
      <button class="si-btn" data-name="${escapeHtml(s.name)}" data-url="${escapeHtml(s.url)}">🔍 분석</button></div>
    <div class="si-snap">${escapeHtml(s.snapshot || '(읽지 못함 — 사이트가 막았을 수 있어요)')}</div></div>`).join('');
  $('svcIntel').querySelectorAll('.si-name').forEach(a => a.addEventListener('click', () => connect.openExternal((a as HTMLElement).dataset.url)));
  $('svcIntel').querySelectorAll('.si-btn').forEach(b => b.addEventListener('click', () => {
    const el = b as HTMLElement; closeOverlay('managePanel');
    ask(`내 서비스 "${el.dataset.name}" (${el.dataset.url}) 를 분석해줘. 필요하면 web_search·fetch_url 로 직접 확인하고, 개선하거나 키울 구체적인 액션을 <task>로 2~4개 만들어줘.`);
  }));
}
async function renderYouTube() {
  const r = await connect.youtubeGet();
  if (!r || !r.ok) { $('ytDash').innerHTML = `<div class="muted small" style="padding:8px 2px">📺 미연결 — 🗂️ 연동에서 YouTube API Key + Channel ID를 넣으면 채널이 여기 떠요.${r?.error ? ` <span style="opacity:.7">(${escapeHtml(r.error)})</span>` : ''}</div>`; return; }
  const c = r.channel, an = r.analytics;
  const anHtml = an ? `<div class="yt-an">📊 28일 — 조회 ${fmtN(an.views)} · 평균 시청률 ${(an.avgViewPercentage || 0).toFixed(1)}% · 구독 +${fmtN(an.subscribersGained)}</div>` : '';
  $('ytDash').innerHTML = `
    <div class="yt-head">${c.thumb ? `<img class="yt-thumb" src="${c.thumb}" />` : ''}<div><div class="yt-name">${escapeHtml(c.title || '')}</div><div class="yt-stats">👥 ${fmtN(c.subs)} · 👁 ${fmtN(c.views)} · 🎬 ${fmtN(c.videos)}</div></div></div>
    ${anHtml}
    <div class="yt-videos">${(r.videos || []).map((v: any) => `<div class="yt-vid" data-id="${v.id}">${v.thumb ? `<img src="${v.thumb}" />` : ''}<div class="yt-vtitle">${escapeHtml(v.title || '')}</div><div class="yt-vstats">👁 ${fmtN(v.views)} · 👍 ${fmtN(v.likes)} · 💬 ${fmtN(v.comments)}</div></div>`).join('')}</div>`;
  $('ytDash').querySelectorAll('.yt-vid').forEach(a => a.addEventListener('click', () => connect.openExternal('https://www.youtube.com/watch?v=' + (a as HTMLElement).dataset.id)));
}
async function renderDash() {
  renderAgentMatrix();   // 먼저(동기) — stats 호출과 무관하게 항상 보이게
  renderTasks();
  renderApprovals();
  renderServiceIntel();
  renderYouTube();
  const s = await connect.dashboardStats();
  const cards: [string, any, string][] = [
    ['🏢', s.company, '회사'], ['🤖', s.agentName, '에이전트'], ['📋', s.tasks, '열린 할 일'], ['🧠', s.knowledge, '지식 노트'],
    ['🗂️', s.services, '등록 서비스'], ['💳', s.paypal ? '연결됨' : '미연결', 'PayPal'], ['📱', s.telegram ? '연결됨' : '미연결', '텔레그램'], ['💻', s.model, '모델'],
  ];
  $('dashGrid').innerHTML = cards.map(([i, v, l]) => `<div class="dash-card"><div class="dc-ic">${i}</div><div class="dc-v">${escapeHtml(String(v))}</div><div class="dc-l">${l}</div></div>`).join('');
}
async function loadServices() {
  const list = await connect.servicesList();
  $('svcList').innerHTML = list.length
    ? list.map((s: any) => `<div class="svc-item"><div class="si-main"><div class="si-name">${escapeHtml(s.name)}</div>${s.url ? `<a class="si-url" href="${escapeHtml(s.url)}" target="_blank">${escapeHtml(s.url)}</a>` : ''}${s.desc ? `<div class="si-desc">${escapeHtml(s.desc)}</div>` : ''}</div><button class="bn-x" data-id="${s.id}">✕</button></div>`).join('')
    : '<div class="muted" style="padding:16px;text-align:center">아직 등록한 서비스가 없어요. 위에 추가하세요.</div>';
  $('svcList').querySelectorAll('.bn-x').forEach(b => b.addEventListener('click', async () => { await connect.servicesDelete((b as HTMLElement).dataset.id); loadServices(); }));
}
$('svcAddBtn').addEventListener('click', async () => {
  const name = ($('svcName') as HTMLInputElement).value.trim(); if (!name) return;
  await connect.servicesAdd({ name, url: ($('svcUrl') as HTMLInputElement).value.trim(), desc: ($('svcDesc') as HTMLInputElement).value.trim() });
  ($('svcName') as HTMLInputElement).value = ''; ($('svcUrl') as HTMLInputElement).value = ''; ($('svcDesc') as HTMLInputElement).value = '';
  loadServices();
});
// 🔌 서비스 정의 — 익스텐션과 동일한 8개 연동
const API_SERVICES: any[] = [
  { id: 'telegram', name: '텔레그램 봇', icon: '📨', summary: '비서가 텔레그램으로 양방향 명령을 받고 보고합니다. 폰 어디서든 회사를 운영하세요.', helpUrl: 'https://t.me/BotFather', fields: [
    { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', type: 'password', help: '@BotFather에서 /newbot으로 발급 (숫자:문자)' },
    { key: 'TELEGRAM_CHAT_ID', label: 'Chat ID', type: 'text', placeholder: '비워두면 자동 감지', help: '봇한테 메시지 1번 보내고 비운 채 저장하면 자동 입력' } ] },
  { id: 'youtube', name: 'YouTube Data API', icon: '📺', summary: '내 채널 + 경쟁 채널 분석, 댓글 답장 큐. 비공개 데이터는 OAuth 별도.', helpUrl: 'https://console.cloud.google.com/', fields: [
    { key: 'YOUTUBE_API_KEY', label: 'API Key', type: 'password', help: 'Cloud Console → YouTube Data API v3 → API 키' },
    { key: 'YOUTUBE_CHANNEL_ID', label: 'Channel ID', type: 'text', placeholder: 'UCxxx...' } ] },
  { id: 'youtube-oauth', name: 'YouTube Analytics (OAuth)', icon: '📊', summary: '시청 지속률·트래픽·구독 증감. 저장 후 "⚡ 자동 연결"로 구글 로그인.', helpUrl: 'https://console.cloud.google.com/', wizard: true, fields: [
    { key: 'YOUTUBE_OAUTH_CLIENT_ID', label: 'Client ID', type: 'password' },
    { key: 'YOUTUBE_OAUTH_CLIENT_SECRET', label: 'Client Secret', type: 'password', help: 'Cloud Console에서 승인된 리디렉션 URI에 http://127.0.0.1:5814/yt-oauth-callback 추가' } ] },
  { id: 'google-calendar', name: 'Google Calendar', icon: '📅', summary: '비서가 일정을 읽고 task 마감일과 자동 동기화합니다.', fields: [
    { key: 'GOOGLE_CALENDAR_ID', label: 'Calendar ID', type: 'text', placeholder: 'primary 또는 ...@group.calendar.google.com' } ] },
  { id: 'paypal', name: 'PayPal (매출 분석)', icon: '💰', summary: '결제 거래 분석. 💰 매출 대시보드 + 새 결제 알림에 사용.', helpUrl: 'https://developer.paypal.com/dashboard/applications', fields: [
    { key: 'PAYPAL_MODE', label: '모드', type: 'select', options: ['live', 'sandbox'], help: '실제 결제는 live, 테스트는 sandbox' },
    { key: 'PAYPAL_CLIENT_ID', label: 'Client ID', type: 'password' },
    { key: 'PAYPAL_CLIENT_SECRET', label: 'Client Secret', type: 'password' },
    { key: 'PAYPAL_LOOKBACK_DAYS', label: '분석 기간(일)', type: 'text', placeholder: '30 (최대 31)' },
    { key: 'PAYPAL_CURRENCY', label: '기본 통화(선택)', type: 'text', placeholder: 'USD' } ] },
  { id: 'gemini', name: 'Google Gemini (텍스트+이미지)', icon: '✨', summary: '내 서비스에서 Gemini AI 호출.', helpUrl: 'https://aistudio.google.com/apikey', fields: [
    { key: 'GEMINI_API_KEY', label: 'API Key', type: 'password', help: 'aistudio.google.com/apikey 에서 발급(무료 OK)' },
    { key: 'GEMINI_TEXT_MODEL', label: '텍스트 모델', type: 'text', placeholder: 'gemini-3.1-flash-lite-preview' },
    { key: 'GEMINI_IMAGE_MODEL', label: '이미지 모델', type: 'text', placeholder: 'gemini-3.1-flash-image-preview' } ] },
  { id: 'github', name: 'GitHub — ⚡ 단기 기억', icon: '💻', summary: '지식 네트워크(단기 기억)를 GitHub 레포에 버전관리로 동기화. 어디서든 불러오고 사람이 직접 편집도.', helpUrl: 'https://github.com/settings/tokens', fields: [
    { key: 'GITHUB_TOKEN', label: 'Personal Access Token', type: 'password', help: 'github.com/settings/tokens → repo(Contents) 권한' },
    { key: 'GITHUB_DEFAULT_REPO', label: '지식 저장소', type: 'text', placeholder: 'owner/repo' } ] },
  { id: 'huggingface', name: 'HuggingFace — 🧬 장기 기억', icon: '🤗', summary: '쌓인 지식을 데이터셋으로 업로드 → 모델에 파인튜닝(체득). 학습된 모델을 회사 뇌로 사용.', helpUrl: 'https://huggingface.co/settings/tokens', fields: [
    { key: 'HF_TOKEN', label: 'Access Token (write)', type: 'password', help: 'huggingface.co/settings/tokens → write 권한' },
    { key: 'HF_REPO', label: '데이터셋 이름', type: 'text', placeholder: 'connect-ai-brain', help: '이름만 적으면 돼요 (아이디는 토큰에서 자동). HF에서 미리 안 만들어도 자동 생성.' } ] },
  { id: 'replicate', name: 'Replicate — 🔊 고품질 음성/AI', icon: '🔊', summary: 'Qwen3-TTS(사람 같은 한국어 음성) 등 AI 모델 호출. 설정에서 고품질 음성 켜면 사용.', helpUrl: 'https://replicate.com/account/api-tokens', fields: [
    { key: 'REPLICATE_API_TOKEN', label: 'API Token', type: 'password', help: 'replicate.com/account/api-tokens 에서 발급 (r8_...)' } ] },
  { id: 'email', name: '이메일 (SMTP)', icon: '📧', summary: '에이전트가 승인 후 메일을 보냅니다. Gmail은 앱 비밀번호 사용.', helpUrl: 'https://support.google.com/accounts/answer/185833', fields: [
    { key: 'SMTP_HOST', label: 'SMTP 호스트', type: 'text', placeholder: 'smtp.gmail.com' },
    { key: 'SMTP_PORT', label: '포트', type: 'text', placeholder: '587' },
    { key: 'SMTP_USER', label: '계정(이메일)', type: 'text', placeholder: 'me@gmail.com' },
    { key: 'SMTP_PASS', label: '비밀번호/앱 비밀번호', type: 'password', help: 'Gmail은 앱 비밀번호(2단계인증 후 발급)' },
    { key: 'SMTP_FROM', label: '보내는 사람(선택)', type: 'text', placeholder: '내 이름 <me@gmail.com>' } ] },
  { id: 'instagram', name: 'Instagram (Meta Graph)', icon: '📷', summary: '인스타 비즈니스 게시 + DM/댓글 분석.', helpUrl: 'https://developers.facebook.com/', comingSoon: true, fields: [
    { key: 'META_ACCESS_TOKEN', label: 'Access Token', type: 'password' },
    { key: 'INSTAGRAM_BUSINESS_ID', label: 'Business Account ID', type: 'text' } ] },
];
async function loadIntegrations() {
  const conn = (await connect.apiGet()) || {};
  $('apiGrid').innerHTML = API_SERVICES.map(svc => {
    const vals = conn[svc.id] || {};
    const connected = !svc.comingSoon && svc.fields.every((f: any) => (vals[f.key] || '').trim().length > 0);
    const status = svc.comingSoon ? '<span class="svc-status coming">준비 중</span>' : connected ? '<span class="svc-status connected">연결됨</span>' : '<span class="svc-status">미설정</span>';
    const fields = svc.fields.map((f: any) => {
      const val = vals[f.key] || ''; const dis = svc.comingSoon ? ' disabled' : '';
      let input;
      if (f.type === 'select' && f.options) input = `<select${dis}>${f.options.map((o: string) => `<option${o === val ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
      else input = `<input type="${f.type === 'password' ? 'password' : 'text'}" value="${escapeHtml(val)}" placeholder="${escapeHtml(f.placeholder || '')}"${dis} />`;
      return `<div class="svc-field" data-key="${f.key}"><label>${escapeHtml(f.label)}</label><div class="svc-input-wrap">${input}${f.type === 'password' && !svc.comingSoon ? '<button class="svc-eye" data-eye="1">👁</button>' : ''}</div>${f.help ? `<div class="svc-help">${escapeHtml(f.help)}</div>` : ''}</div>`;
    }).join('');
    const actions = svc.comingSoon ? '<div class="svc-coming">곧 합류합니다 · 다음 업데이트</div>'
      : `<div class="svc-actions"><button class="btn primary" data-act="save">💾 저장</button>${svc.wizard ? '<button class="btn" data-act="wizard">⚡ 자동 연결</button>' : ''}${svc.helpUrl ? '<button class="btn ghost" data-act="help">📘 도움말</button>' : ''}</div>`;
    return `<div class="svc-card ${svc.comingSoon ? 'coming' : connected ? 'connected' : ''}" data-svc="${svc.id}"><div class="svc-head"><div class="svc-icon">${svc.icon}</div><div class="svc-name">${escapeHtml(svc.name)}</div>${status}</div><div class="svc-summary">${escapeHtml(svc.summary)}</div><div class="svc-fields">${fields}</div>${actions}</div>`;
  }).join('');
  // 이벤트 배선
  $('apiGrid').querySelectorAll('.svc-card').forEach(card => {
    const id = (card as HTMLElement).dataset.svc!; const svc = API_SERVICES.find(s => s.id === id);
    card.querySelector('[data-act=help]')?.addEventListener('click', () => connect.openExternal(svc.helpUrl));
    card.querySelector('[data-act=wizard]')?.addEventListener('click', async () => {
      hint('⚡ 브라우저에서 구글 로그인하세요…');
      const r = await connect.youtubeOAuth();
      hint(r?.ok ? '✅ YouTube 연결 완료!' : `⚠️ ${r?.error || '연결 실패'}`);
    });
    card.querySelectorAll('.svc-eye').forEach(eye => eye.addEventListener('click', () => { const inp = (eye.previousElementSibling as HTMLInputElement); inp.type = inp.type === 'password' ? 'text' : 'password'; }));
    card.querySelector('[data-act=save]')?.addEventListener('click', async (e) => {
      const btn = e.target as HTMLButtonElement; const orig = btn.textContent; btn.textContent = '저장 중…';
      const values: Record<string, string> = {};
      card.querySelectorAll('.svc-field').forEach(fld => { const k = (fld as HTMLElement).dataset.key!; const el = fld.querySelector('input,select') as HTMLInputElement; values[k] = (el.value || '').trim(); });
      const r = await connect.apiSave(id, values);
      btn.textContent = orig; hint(r?.note || (r?.ok ? '저장됨 ✅' : ('⚠️ ' + (r?.error || '실패'))));
      loadIntegrations();
    });
  });
}

// ── 🏢 가상 사무실 — 구입한 LimeZu 픽셀 캐릭터가 진짜 걸어다니는 사무실 ──────────────
// 캐릭터 PNG = 스프라이트 시트(2688×1968, 셀 48×96). background-position을 rAF로 넘겨 걷는 애니메이션.
let officeBuilt = false;
const officeStreams: Record<string, string> = {};
const SPRITE = (id: string) => `../../assets/pixel/characters/${id}.png`;
const OFFICE_BG = '../../assets/map.jpeg';   // 사용자가 넣은 Connect AI 대형 사무실 맵 (2912×1440, 2:1)
// 자리(홈) 좌표 — map.jpeg 위. 각자 다른 방/구역에 배치(딱딱하게 뭉치지 않게)
const VO_HOME: Record<string, [number, number]> = {
  ceo: [53, 15],         // 상단 회의 테이블 (대표석)
  youtube: [13, 22],     // 좌상단 프레젠테이션/책장 방
  instagram: [88, 21],   // 우상단 데스크
  designer: [13, 47],    // 좌측 데스크
  developer: [48, 50],   // 중앙 메인 개발 데스크
  business: [85, 47],    // 우측 주방/미팅 바
  researcher: [86, 84],  // 우하단 라운지
  writer: [25, 86],      // 좌하단 방
  secretary: [47, 86],   // 하단 중앙 리셉션
  editor: [10, 80],      // 좌하단 라운지 소파 (사운드)
};
const VO_MEET: [number, number] = [50, 50];   // 중앙(소집 모임 지점)
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const setText = (id: string, t: string) => { const el = document.getElementById(id); if (el) el.textContent = t; };

function buildOffice() {
  $('officeName').textContent = cfg.company || '우리 회사';
  const room = $('voffice');
  room.innerHTML = `<div class="office-stage" id="officeStage" style="background-image:url('${OFFICE_BG}')"></div>`;
  const stage = $('officeStage');
  stage.innerHTML =
    `<div class="vo-meet" style="left:${VO_MEET[0]}%;top:${VO_MEET[1]}%"></div>` +
    AGENT_ORDER.map(id => {
      const a = AGENTS[id]; if (!a) return ''; const [x, y] = VO_HOME[id] || VO_MEET;
      const ceo = id === 'ceo' ? ' is-ceo' : '';
      return `<div class="vo-agent idle${ceo}" id="vo-${id}" data-dir="down" data-cx="${x}" data-cy="${y}" style="--ag:${a.color};left:${x}%;top:${y}%">
        <div class="vo-bubble" id="vob-${id}"></div>
        <div class="vo-status" id="vost-${id}">대기</div>
        <div class="character" style="background-image:url('${SPRITE(id)}')"></div>
        <div class="vo-plate">${a.emoji} ${a.name}</div>
      </div>`;
    }).join('');
  officeBuilt = true;
  startSpriteLoop();
  startOfficeLife();   // 🎬 자율 생활 시작 (일 없을 때 어슬렁·잡담)
}
// 스프라이트 애니메이션 루프 — 방향·상태에 따라 background-position 스텝
const TILE = 48, CH = 96;
let voFrame = 0, voRaf = 0;
function startSpriteLoop() {
  if (voRaf) return;
  const tick = () => {
    voFrame++;
    for (const id of AGENT_ORDER) {
      const el = document.getElementById('vo-' + id); if (!el) continue;
      const c = el.querySelector('.character') as HTMLElement | null; if (!c) continue;
      let col = 0; switch (el.dataset.dir) { case 'left': col = 6; break; case 'right': col = 12; break; case 'up': col = 18; break; default: col = 0; }
      const moving = el.classList.contains('walking') || el.classList.contains('working') || el.classList.contains('thinking');
      const row = moving ? 2 : 1;
      const speed = moving ? 8 : 14;
      const fi = Math.floor(voFrame / speed) % 6;
      c.style.backgroundPosition = `-${(col + fi) * TILE}px -${row * CH}px`;
    }
    voRaf = requestAnimationFrame(tick);
  };
  voRaf = requestAnimationFrame(tick);
}
// (x%,y%)로 걸어 이동 — 방향 계산 + walking 클래스
function voMove(id: string, x: number, y: number) {
  const el = document.getElementById('vo-' + id); if (!el) return;
  const px = parseFloat(el.dataset.cx || '50'), py = parseFloat(el.dataset.cy || '50');
  const dx = x - px, dy = y - py;
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) el.dataset.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  el.dataset.cx = String(x); el.dataset.cy = String(y);
  el.classList.add('walking'); el.style.left = x + '%'; el.style.top = y + '%';
  window.clearTimeout((el as any)._wt); (el as any)._wt = window.setTimeout(() => el.classList.remove('walking'), 950);
}
const voHome = (id: string) => { const h = VO_HOME[id] || VO_MEET; voMove(id, h[0], h[1]); };
// 작업 중 스파클 몇 개 뿜기
function voSparks(id: string) {
  const el = document.getElementById('vo-' + id); if (!el) return;
  for (let k = 0; k < 4; k++) {
    const sp = document.createElement('div'); sp.className = 'vo-spark';
    sp.style.left = (20 + (Math.random() - 0.5) * 10) + 'px'; sp.style.top = (18 + Math.random() * 8) + 'px';
    sp.style.setProperty('--sx', ((Math.random() - 0.5) * 30).toFixed(0) + 'px');
    sp.style.setProperty('--sy', (-34 - Math.random() * 18).toFixed(0) + 'px');
    sp.style.animationDelay = (k * 70) + 'ms';
    el.appendChild(sp); setTimeout(() => { try { sp.remove(); } catch { /* */ } }, 1400 + k * 70);
  }
}

function officeSet(id: string, state: 'idle' | 'think' | 'work' | 'done', text?: string) {
  if (!officeBuilt) buildOffice();
  const el = document.getElementById('vo-' + id); if (!el) return;
  el.classList.remove('thinking', 'working', 'done', 'idle');
  const b = document.getElementById('vob-' + id);
  if (state === 'think') { el.classList.add('thinking'); setText('vost-' + id, '준비 중…'); }
  else if (state === 'work') { el.classList.add('working'); setText('vost-' + id, WORK_LABEL[id] || '작업 중…'); voSparks(id); }
  else if (state === 'done') { el.classList.add('done'); setText('vost-' + id, '✓ 완료'); voHome(id); if (b) b.classList.remove('show', 'typing', 'speech'); }
  else { el.classList.add('idle'); setText('vost-' + id, '대기'); if (b) b.classList.remove('show', 'typing', 'speech'); }
}
// 🔴 실시간 — 작업 중 캐릭터 위 말풍선에 최근 글이 흐른다
function officeStream(id: string, chunk: string) {
  if (!officeBuilt) buildOffice();
  const el = document.getElementById('vo-' + id); if (!el) return;
  el.classList.add('working'); el.classList.remove('thinking', 'done', 'idle'); setText('vost-' + id, '작업 중…');
  officeStreams[id] = (officeStreams[id] || '') + chunk;
  const b = document.getElementById('vob-' + id);
  if (b) { b.textContent = officeStreams[id].replace(/\s+/g, ' ').trim().slice(-60) || '…'; b.classList.add('show', 'typing'); b.classList.remove('speech'); }
}
// 🎬 소집 — 배너 + CEO 지휘 + 동료들이 가운데로 모였다가 자리로 걸어감
function officeDispatch(agents: { id: string; name: string; emoji: string }[]) {
  if (!officeBuilt) buildOffice();
  taskActive = true;   // 소집되면 자율생활 멈춤
  $('officeStatus').textContent = `🚀 ${agents.length}명 소집`;
  const banner = document.createElement('div'); banner.className = 'dispatch-banner';
  banner.innerHTML = `<span class="db-tag">📋 팀 소집</span><span class="db-sub">${agents.map(a => a.emoji).join(' ')} ${agents.length}명 투입</span>`;
  $('officeStage').appendChild(banner); setTimeout(() => banner.remove(), 1900);
  const ceo = document.getElementById('vo-ceo'); if (ceo) { ceo.classList.add('commanding'); setTimeout(() => ceo.classList.remove('commanding'), 1900); }
  agents.forEach((a, i) => {
    officeStreams[a.id] = '';
    const ang = agents.length > 1 ? (i / agents.length) * Math.PI * 2 : 0;
    const cx = VO_MEET[0] + Math.cos(ang) * 12, cy = VO_MEET[1] + Math.sin(ang) * 10;
    setTimeout(() => { voMove(a.id, cx, cy); officeSet(a.id, 'think'); }, 150 + i * 140);   // 가운데로 모임
    setTimeout(() => { voHome(a.id); }, 1500 + i * 140);                                     // 자리로 복귀
  });
}
// 🗣️ 회의 — from 캐릭터가 to 자리로 걸어가 말풍선 → 돌아옴 + 피드
function officeConfer(e: any) {
  const to = VO_HOME[e.to] || VO_MEET, fr = VO_HOME[e.from] || VO_MEET;
  const el = document.getElementById('vo-' + e.from), b = document.getElementById('vob-' + e.from);
  voMove(e.from, to[0] + (to[0] > 50 ? -9 : 9), to[1] + 4);
  if (b) { b.textContent = e.text; b.classList.add('show', 'speech'); b.classList.remove('typing'); }
  setTimeout(() => { voMove(e.from, fr[0], fr[1]); if (b) b.classList.remove('show', 'speech'); }, 2600);
  const feed = $('conferFeed');
  const line = document.createElement('div'); line.className = 'cf-line';
  const fc = AGENTS[e.from]?.color || '#9fe', te = AGENTS[e.to]?.emoji || '';
  line.innerHTML = `<span class="cf-from" style="color:${fc}">${AGENTS[e.from]?.emoji || ''} ${esc(e.fromName)}</span><span class="cf-arrow">→</span><span class="cf-to">${te} ${esc(e.toName)}</span><span class="cf-txt">${esc(e.text)}</span>`;
  feed.appendChild(line); feed.scrollTop = feed.scrollHeight;
}
function officeReset() {
  if (officeBuilt) AGENT_ORDER.forEach(id => { officeStreams[id] = ''; officeSet(id, 'idle'); voHome(id); });
  $('conferFeed').innerHTML = '';
}

// ══════════ 🎬 살아있는 사무실 (Smallville 연출) ══════════
// 역할별 작업 라벨 — "일이 곧 행동으로" 보이게
const WORK_LABEL: Record<string, string> = { ceo: '🧭 지휘 중', youtube: '🎬 기획 중', instagram: '📸 콘텐츠 중', designer: '🎨 디자인 중', developer: '💻 코딩 중', business: '📈 분석 중', secretary: '🗂️ 정리 중', editor: '✂️ 편집 중', writer: '✍️ 작성 중', researcher: '🔍 조사 중' };
// 사무실 핫스팟(정수기·라운지·회의테이블 등) — 어슬렁거릴 목적지
const LIFE_SPOTS: [number, number][] = [[50, 30], [63, 40], [37, 40], [50, 58], [30, 70], [72, 70]];
// 에이전트별 혼잣말(성격) — 어슬렁거릴 때
const AMBIENT: Record<string, string[]> = {
  ceo: ['다들 잘하고 있네 👍', '이번 분기 가보자', '회의 한번 잡을까', '커피나 한잔 ☕'],
  youtube: ['다음 영상 뭐 찍지 🎬', '썸네일 A/B 돌려볼까', '이번 편 반응 좋다', '오프닝을 바꿔볼까'],
  instagram: ['릴스 각 나왔다 📸', '해시태그 뭐 달지', '피드 톤 맞춰야지', '스토리 올릴 시간'],
  designer: ['이 색 조합 괜찮은데 🎨', '폰트 좀 바꿔볼까', '레퍼런스 찾아봐야지', '여백이 생명이지'],
  developer: ['이 버그 왜 이러지 🐛', '리팩토링 땡긴다', '커밋하고 쉬자 ☕', '테스트 돌려놓고'],
  business: ['이번 달 매출 좋네 📈', '전환율이 관건이야', '광고 예산 어디 쓸까', '리텐션 보자'],
  secretary: ['일정 정리해야지 🗂️', '오늘 할 일 뭐였더라', '메일 답장 밀렸네', '다들 바빠 보여'],
  editor: ['컷 편집 깔끔하게 ✂️', 'BGM 뭐 깔지', '자막 타이밍 맞춰야지', '한 번 더 보자'],
  writer: ['첫 문장이 어렵네 ✍️', '카피 좀 더 짧게', '톤을 바꿔볼까', '제목이 절반이지'],
  researcher: ['이 자료 흥미롭다 🔍', '출처 더 찾아보자', '트렌드 정리 중', '데이터가 말해주네'],
};
const SMALLTALK = ['오늘 어때요? 😊', '커피 한잔? ☕', '그거 봤어요?', '수고 많아요 👍', '점심 뭐 먹죠?', '주말 계획 있어요?', '같이 해볼까요?', '좋은 아이디어네요 ✨', '잘 되가요?', '오 멋진데요!'];
const FRIENDS: [string, string][] = [['designer', 'developer'], ['youtube', 'editor'], ['instagram', 'writer'], ['business', 'secretary'], ['researcher', 'ceo']];
const pick = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];

let lifeTimer: any = null;
let taskActive = false;   // 진짜 작업(팀 소집) 중엔 자율생활 멈춤
const officeMemory: string[] = [];   // 🧠 사무실 기억 — 최근 사건(에이전트가 잡담에서 언급)
function rememberOffice(ev: string) { if (!ev) return; officeMemory.push(ev); if (officeMemory.length > 8) officeMemory.shift(); }
const REACT = ['그거 봤어요? ', '아까 ', '오 ', '대박 ', '역시 ', '와 '];
function startOfficeLife() { if (lifeTimer) return; lifeTimer = window.setInterval(lifeTick, 2800); }
function officeLive() { if (!taskActive) $('officeStatus').textContent = '🟢 LIVE · 사무실 가동 중'; }

function lifeBubble(id: string, text: string, cls = 'speech') {
  const b = document.getElementById('vob-' + id); if (!b) return;
  b.textContent = text; b.classList.add('show', cls); b.classList.remove('typing');
  window.clearTimeout((b as any)._lt); (b as any)._lt = window.setTimeout(() => b.classList.remove('show', 'speech', 'ambient'), 2900);
}
function feedAmbient(html: string) { feedRaw(html, 'ambient'); }
function feedRaw(html: string, cls: string) {
  const feed = $('conferFeed'); if (!feed) return;
  const line = document.createElement('div'); line.className = 'cf-line ' + cls; line.innerHTML = html;
  feed.appendChild(line); feed.scrollTop = feed.scrollHeight;
  while (feed.childElementCount > 60 && feed.firstChild) feed.removeChild(feed.firstChild);
}
// 작업 스토리 한 줄 (내레이터) — 누가·무엇을
function feedStory(emoji: string, name: string, action: string, color = '#9fe') {
  feedRaw(`<span class="cf-from" style="color:${color}">${emoji} ${esc(name)}</span><span class="cf-txt story">${esc(action)}</span>`, 'story');
}
const isIdle = (id: string) => { const el = document.getElementById('vo-' + id); return !!el && el.classList.contains('idle'); };

// 자율 행동 한 틱 — 잡담 / 어슬렁 / 감정표현
function lifeTick() {
  if (taskActive || !officeBuilt) return;
  if ($('officePanel').classList.contains('hidden')) return;   // 안 보면 쉬기(성능)
  officeLive();
  const idle = AGENT_ORDER.filter(isIdle); if (idle.length < 1) return;
  const roll = Math.random();
  if (roll < 0.42 && idle.length >= 2) {                       // 🗣️ 잡담
    const a = pick(idle);
    const fr = FRIENDS.find(([x, y]) => (x === a || y === a))?.filter(z => z !== a)[0];
    const b = (fr && isIdle(fr)) ? fr : pick(idle.filter(x => x !== a));
    if (b) lifeSocialize(a, b);
  } else if (roll < 0.74) {                                    // 🚶 어슬렁
    lifeWander(pick(idle));
  } else {                                                     // 💭 혼잣말/감정
    const id = pick(idle); lifeBubble(id, pick(AMBIENT[id] || SMALLTALK), 'ambient');
  }
}
function lifeWander(id: string) {
  if (!isIdle(id)) return;
  const spot = pick(LIFE_SPOTS), home = VO_HOME[id] || VO_MEET;
  voMove(id, spot[0] + (Math.random() - 0.5) * 8, spot[1] + (Math.random() - 0.5) * 6);
  if (Math.random() < 0.5) setTimeout(() => lifeBubble(id, pick(AMBIENT[id] || SMALLTALK), 'ambient'), 600);
  window.setTimeout(() => { if (isIdle(id) && !taskActive) voHome(id); }, 2600 + Math.random() * 1600);
}
function lifeSocialize(a: string, b: string) {
  if (!isIdle(a) || !isIdle(b)) return;
  const hb = VO_HOME[b] || VO_MEET, ha = VO_HOME[a] || VO_MEET;
  voMove(a, hb[0] + (hb[0] > 50 ? -8 : 8), hb[1] + 5);   // a가 b에게 다가감
  // 35%는 최근 사건을 언급(기억) — 스몰빌처럼 맥락 있는 대화
  const la = (officeMemory.length && Math.random() < 0.35) ? `${pick(REACT)}${pick(officeMemory)} 👏` : pick(SMALLTALK);
  const lb = pick([...SMALLTALK, ...(AMBIENT[b] || [])]);
  setTimeout(() => { if (taskActive) return; lifeBubble(a, la); feedAmbient(`<span class="cf-from" style="color:${AGENTS[a]?.color || '#9fe'}">${AGENTS[a]?.emoji || ''} ${esc(AGENTS[a]?.name || a)}</span><span class="cf-arrow">→</span><span class="cf-to">${AGENTS[b]?.emoji || ''} ${esc(AGENTS[b]?.name || b)}</span><span class="cf-txt">${esc(la)}</span>`); }, 750);
  setTimeout(() => { if (taskActive) return; lifeBubble(b, lb); }, 1700);
  window.setTimeout(() => { if (!taskActive) voMove(a, ha[0], ha[1]); }, 3100);
}

$('officeBtn').addEventListener('click', () => { connect.officeOpen?.(); });   // 🏢 → 바로 옆 창으로

// ⬆️ 자동 업데이트 배너
connect.onUpdateStatus?.((s: any) => {
  const bar = $('updateBar'); if (!bar) return;
  if (s.state === 'downloading') { bar.hidden = false; bar.className = 'update-bar dl'; bar.innerHTML = `⬇️ 새 버전 받는 중… <b>${s.percent || 0}%</b>`; }
  else if (s.state === 'downloaded') {
    bar.hidden = false; bar.className = 'update-bar ready';
    bar.innerHTML = `🎉 새 버전 <b>v${s.version}</b> 준비됐어요 <button id="updNow">재시작해서 업그레이드</button> <button id="updLater" class="upd-ghost">나중에</button>`;
    $('updNow')?.addEventListener('click', () => connect.updateInstall?.());
    $('updLater')?.addEventListener('click', () => { bar.setAttribute('hidden', ''); });
  } else if (s.state === 'available') { hint(`⬆️ 새 버전 v${s.version} 받는 중…`); }
});

// 🪟 별도 사무실 창 — 옆에 띄워놓고 에이전트들 일하는 거 구경
let officeEngagedM = false;
function ensureOfficeM() { if (officeEngagedM) return; officeEngagedM = true; taskActive = true; buildOffice(); officeReset(); $('officeStatus').textContent = '가동 중…'; officeSet('ceo', 'work'); }
function driveOfficeEvent(e: any) {   // 엔진 이벤트로 사무실만 구동 (별도 창용)
  if (e.kind === 'dispatch') { ensureOfficeM(); officeDispatch(e.agents); feedStory('🧑‍🏫', cfg.userTitle || '사장님', `팀 ${e.agents.length}명 소집`, '#ffd166'); }
  else if (e.kind === 'agentStart') { ensureOfficeM(); officeStreams[e.id] = ''; officeSet(e.id, 'work'); feedStory(e.emoji, e.name, (WORK_LABEL[e.id] || '작업 중').replace(/중$/, '시작'), AGENTS[e.id]?.color); }
  else if (e.kind === 'agentChunk') { officeStream(e.id, e.text); }
  else if (e.kind === 'agentDone') { officeSet(e.id, 'done', e.output); feedStory(AGENTS[e.id]?.emoji || '🤖', AGENTS[e.id]?.name || e.id, '✓ 완료', AGENTS[e.id]?.color); rememberOffice(`${AGENTS[e.id]?.name || e.id}가 일 끝낸 거`); }
  else if (e.kind === 'agentConfer') { officeConfer(e); }
  else if (e.kind === 'final') { if (officeEngagedM) { officeSet('ceo', 'done', e.text); $('officeStatus').textContent = '보고 완료'; feedStory('🧭', 'CEO', '종합 보고 완료 ✓', '#9fe'); setTimeout(() => { taskActive = false; officeLive(); }, 3000); } }
}
const OFFICE_MODE = new URLSearchParams(location.search).get('office') === '1';
if (OFFICE_MODE) {
  document.body.classList.add('office-only');
  buildOffice(); openOverlay('officePanel'); officeLive();
  connect.onEngineEvent?.(driveOfficeEvent);   // 메인에서 브로드캐스트되는 엔진 이벤트 수신
}
$('officePop')?.addEventListener('click', () => connect.officeOpen?.());

// ── 💻 작업실 (파일 트리 + 코드 뷰어) ──────────────────────
let codeWs = '';
let codeCurrentFile = '';
const NEW_MS = 25000;
function fileIcon(name: string) {
  const e = (name.split('.').pop() || '').toLowerCase();
  const map: any = { js: '🟨', mjs: '🟨', ts: '🔷', jsx: '🟨', tsx: '🔷', py: '🐍', html: '🌐', css: '🎨', json: '📦', md: '📝', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', mp4: '🎬', mov: '🎬', mp3: '🎵', pdf: '📕', sh: '⚙️', txt: '📄', yml: '⚙️', yaml: '⚙️' };
  return map[e] || '📄';
}
function renderTreeNodes(nodes: any[], depth: number): string {
  return nodes.map(n => {
    const pad = `padding-left:${8 + depth * 13}px`;
    if (n.dir) return `<div class="tnode tdir" style="${pad}"><span class="tcaret">▸</span>📁 ${escapeHtml(n.name)}</div>`
      + `<div class="tchildren" hidden>${renderTreeNodes(n.children || [], depth + 1)}</div>`;
    const fresh = (Date.now() - (n.mtime || 0)) < NEW_MS ? ' <b class="tnew">✨</b>' : '';
    return `<div class="tnode tfile" data-file="${escapeHtml(n.path)}" style="${pad}">${fileIcon(n.name)} <span>${escapeHtml(n.name)}</span>${fresh}</div>`;
  }).join('');
}
async function loadTree(autoOpenNewest = false) {
  const tree = await connect.fsTree(codeWs || undefined);
  codeWs = tree.root;
  $('codePath').textContent = (tree.root || '').split(/[\\/]/).filter(Boolean).pop() || tree.root;
  const treeEl = $('codeTree');
  treeEl.innerHTML = tree.children?.length ? renderTreeNodes(tree.children, 0) : '<div class="code-empty-tree">빈 폴더예요.<br/>에이전트에게 "웹사이트 만들어줘" 해보세요.</div>';
  treeEl.querySelectorAll('.tdir').forEach(el => el.addEventListener('click', () => {
    const kids = el.nextElementSibling as HTMLElement; const caret = el.querySelector('.tcaret');
    if (!kids) return; const hidden = kids.hasAttribute('hidden');
    if (hidden) { kids.removeAttribute('hidden'); if (caret) caret.textContent = '▾'; } else { kids.setAttribute('hidden', ''); if (caret) caret.textContent = '▸'; }
  }));
  treeEl.querySelectorAll('.tfile').forEach(el => el.addEventListener('click', () => openFile((el as HTMLElement).dataset.file!)));
  if (autoOpenNewest) {
    let bestP = ''; let bestM = -1;
    const scan = (nodes: any[]) => nodes.forEach((n: any) => { if (n.dir) scan(n.children || []); else if ((n.mtime || 0) > bestM) { bestM = n.mtime || 0; bestP = n.path; } });
    scan(tree.children || []);
    if (bestP && (Date.now() - bestM) < NEW_MS) { openFile(bestP); revealInTree(bestP); }
  }
}
function revealInTree(p: string) {
  const el = $('codeTree').querySelector(`.tfile[data-file="${(window as any).CSS?.escape ? CSS.escape(p) : p}"]`) as HTMLElement;
  let par = el?.parentElement; while (par && par.id !== 'codeTree') { if (par.classList?.contains('tchildren') && par.hasAttribute('hidden')) { par.removeAttribute('hidden'); const c = par.previousElementSibling?.querySelector('.tcaret'); if (c) c.textContent = '▾'; } par = par.parentElement; }
  el?.scrollIntoView({ block: 'nearest' });
}
function closeEditor() { $('codeView').classList.remove('open'); $('codeView').innerHTML = ''; }
function edHead(name: string, rightBtns: string) {
  return `<div class="code-fname">${fileIcon(name)} <span class="cf-name">${escapeHtml(name)}</span><span class="cf-btns">${rightBtns}<button class="code-mini cf-x" id="cvClose" title="닫기 (채팅으로)">✕</button></span></div>`;
}
function wireHead() { $('cvClose')?.addEventListener('click', closeEditor); }
async function openFile(p: string) {
  codeCurrentFile = p;
  $('codeTree').querySelectorAll('.tfile').forEach(el => el.classList.toggle('sel', (el as HTMLElement).dataset.file === p));
  $('codeView').classList.add('open');
  const r = await connect.fsRead(p);
  const view = $('codeView');
  const nm = r.name || (p.split(/[\\/]/).pop() || '');
  if (r.error) { view.innerHTML = edHead(nm, '') + `<div class="code-empty">⚠️ ${escapeHtml(r.error)}</div>`; wireHead(); return; }
  if (r.image) { view.innerHTML = edHead(nm, `<button class="code-mini" id="cvReveal">🔍</button>`) + `<div class="code-img"><img src="${r.image}"/></div>`; wireHead(); $('cvReveal')?.addEventListener('click', () => connect.fsReveal(p)); return; }
  if (r.binary) { view.innerHTML = edHead(nm, `<button class="code-mini" id="cvReveal">🔍 Finder</button>`) + `<div class="code-empty">바이너리 파일이라 미리보기를 못 해요.</div>`; wireHead(); $('cvReveal')?.addEventListener('click', () => connect.fsReveal(p)); return; }
  renderFileView(nm, r.content || '');
}
function renderFileView(name: string, content: string) {
  const lines = content.split('\n');
  const gutter = lines.map((_l: string, i: number) => i + 1).join('\n');
  $('codeView').classList.add('open');
  $('codeView').innerHTML = edHead(name, `<span class="cf-lines">${lines.length}줄</span><button class="code-mini" id="cvEdit">✏️ 편집</button>`)
    + `<div class="code-scroll"><pre class="code-gutter">${gutter}</pre><pre class="code-text">${escapeHtml(content)}</pre></div>`;
  wireHead();
  $('cvEdit')?.addEventListener('click', () => enterEdit(name, content));
}
function enterEdit(name: string, content: string) {
  $('codeView').innerHTML = edHead(name, `<span class="edit-tag">● 편집중</span><button class="code-mini cv-save" id="cvSave">💾 저장</button><button class="code-mini" id="cvCancel">취소</button>`)
    + `<textarea class="code-edit" id="cvText" spellcheck="false"></textarea>`;
  wireHead();
  const ta = $('cvText') as HTMLTextAreaElement; ta.value = content; ta.focus();
  $('cvSave')?.addEventListener('click', saveFile);
  $('cvCancel')?.addEventListener('click', () => openFile(codeCurrentFile));
  ta.addEventListener('keydown', (e: any) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveFile(); } });
}
async function saveFile() {
  const ta = $('cvText') as HTMLTextAreaElement; if (!ta) return;
  const r = await connect.fsWrite(codeCurrentFile, ta.value);
  if (r?.ok) { hint('💾 저장됐어요'); renderFileView(codeCurrentFile.split(/[\\/]/).pop() || '', ta.value); loadTree(false); }
  else { hint('저장 실패: ' + (r?.error || '')); }
}
// 📁 파일 사이드바 토글
function showFiles(v: boolean) { $('sideFiles').classList.toggle('collapsed', !v); ($('filesBtn') as HTMLElement).classList.toggle('on', v); if (v) loadTree(false); }
$('filesBtn').addEventListener('click', () => showFiles($('sideFiles').classList.contains('collapsed')));
// ⌨️ 터미널 토글 (하단)
function showTerm(v: boolean) { $('codeTerm').classList.toggle('collapsed', !v); ($('termBtn') as HTMLElement).classList.toggle('on', v); if (v) setTimeout(() => ($('termInput') as HTMLInputElement)?.focus(), 50); }
$('termBtn').addEventListener('click', () => showTerm($('codeTerm').classList.contains('collapsed')));
$('termCollapse')?.addEventListener('click', () => showTerm(false));
let codeBumpTimer: any = null;
function codeBump(autoOpen: boolean) {
  if (autoOpen) showFiles(true);                       // 파일 생기면 탐색기 보이게
  clearTimeout(codeBumpTimer); codeBumpTimer = setTimeout(() => { if (!$('sideFiles').classList.contains('collapsed')) loadTree(false); }, 500);
}
$('codeRefresh').addEventListener('click', () => loadTree(false));
$('codePickWs').addEventListener('click', async () => { const w = await connect.pickWorkspace(); codeWs = w; loadTree(false); hint('작업 폴더: ' + w); });

// ⌨️ 통합 터미널
function termAppend(d: any) {
  const el = $('termOut'); if (!el || !d) return;
  const span = document.createElement('span');
  if (d.kind === 'cmd') span.className = 't-cmd';
  else if (d.kind === 'exit') span.className = 't-exit';
  const nl = String.fromCharCode(10);
  span.textContent = (d.kind === 'cmd' ? nl : '') + (d.text || '') + (d.kind === 'cmd' || d.kind === 'exit' ? nl : '');
  el.appendChild(span);
  while (el.childNodes.length > 4000 && el.firstChild) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
const termHist: string[] = []; let termHistIdx = -1;
const termInputEl = $('termInput') as HTMLInputElement;
termInputEl?.addEventListener('keydown', (e: any) => {
  if (e.key === 'Enter') {
    const cmd = termInputEl.value.trim(); if (!cmd) return;
    termHist.push(cmd); termHistIdx = termHist.length;
    connect.termRun(cmd, codeWs || undefined); termInputEl.value = '';
  } else if (e.key === 'ArrowUp') { if (termHist.length) { termHistIdx = Math.max(0, termHistIdx - 1); termInputEl.value = termHist[termHistIdx] || ''; e.preventDefault(); } }
  else if (e.key === 'ArrowDown') { if (termHist.length) { termHistIdx = Math.min(termHist.length, termHistIdx + 1); termInputEl.value = termHist[termHistIdx] || ''; e.preventDefault(); } }
  else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); connect.termKill(); termAppend({ kind: 'exit', text: '^C 중지' }); }   // Ctrl+C → 실행 중지
});
$('termKillBtn')?.addEventListener('click', () => connect.termKill());
$('termClearBtn')?.addEventListener('click', () => { const el = $('termOut'); if (el) el.textContent = ''; });
connect.onTermData?.((d: any) => termAppend(d));
connect.onTermShow?.(() => showTerm(true));   // 에이전트가 서버/명령 실행하면 터미널 자동 표시
// 🔌 EZERAI 브레인팩 주입 → 매트릭스 FX + 작업실 파일트리 새로고침
connect.onBridgeInject?.((d: any) => {
  const emoji: any = { knowledge: '🧠', skill: '🐍', template: '📦', design: '🎨' };
  playInjection(`${emoji[d.kind] || '🔌'} EZERAI → ${d.kind === 'knowledge' ? '두뇌' : '작업실'}`, [d.label || '브레인팩 주입'], (CAT_META[d.category] || CAT_META.general).color);
  if (d.kind !== 'knowledge') { showFiles(true); setTimeout(() => loadTree(true), 400); }   // 스킬/템플릿/디자인 = 파일 생김
  if (!$('brainPanel').classList.contains('hidden')) setTimeout(() => renderBrain(), 300);    // 두뇌 패널 열려있으면 실시간 갱신
});
// 시작: 파일 탐색기 상시 표시(트리 로드), 터미널은 접힌 상태(⌨️로 펴기)
showFiles(true);

// 👤 캐릭터 클릭 → 에이전트 상세
const PROFILE: Record<string, string> = { youtube: 'youtube.png', developer: 'developer.png', business: 'business.jpeg', editor: 'editor.png', secretary: 'secretary.jpeg' };
function openAgentDetail(id: string) {
  const a = AGENTS[id]; if (!a) return;
  const avatar = PROFILE[id]
    ? `<img class="ag-photo" src="../../assets/agents/${PROFILE[id]}" alt="" />`
    : `<div class="ag-photo ag-photo-emoji" style="background:color-mix(in srgb,${a.color} 18%,#0a120c);border-color:${a.color}">${a.emoji}</div>`;
  $('agHeadName').textContent = `${a.emoji} ${a.name}`;
  const cur = (cfg.agentModels || {})[id] || '';
  const opts = ['<option value="">⚙️ 자동 (공용 모델)</option>']
    .concat(MODELS_CACHE.map(m => `<option value="${esc(m)}"${m === cur ? ' selected' : ''}>${esc(m)}${/^gemini/i.test(m) ? ' ☁️' : (m === MODELS_LOADED ? ' ●' : '')}</option>`)).join('');
  $('agentBody').innerHTML = `
    <div class="ag-detail" style="--ag:${a.color}">
      ${avatar}
      <div class="ag-meta">
        <div class="ag-role">${esc(a.role)}</div>
        <div class="ag-spec">${esc((a as any).specialty || '')}</div>
      </div>
    </div>
    <div class="ag-model">
      <label>🤖 이 에이전트의 AI 모델</label>
      <select id="agModelSel">${opts}</select>
      <div class="ag-model-hint">장기기억으로 학습한 <b>전용 모델</b>을 배정하세요 (예: 마케팅튜닝 → 비즈니스). 비워두면 공용 모델 사용.</div>
    </div>`;
  $('agModelSel')?.addEventListener('change', async (e) => {
    const v = (e.target as HTMLSelectElement).value;
    const am = { ...(cfg.agentModels || {}) }; if (v) am[id] = v; else delete am[id];
    cfg = await connect.setConfig({ agentModels: am });
    hint(v ? `${a.emoji} ${a.name} → ${v}` : `${a.emoji} ${a.name} → 공용 모델`);
  });
  openOverlay('agentPanel');
}
$('voffice').addEventListener('click', (e) => { const el = (e.target as HTMLElement).closest('.vo-agent'); if (el) openAgentDetail(el.id.replace('vo-', '')); });

// ── 🧠 지식 네트워크 (두뇌) ───────────────────────────
$('brainBtn').addEventListener('click', async () => { openOverlay('brainPanel'); await refreshMem(); await renderBridge(); await renderBrain(); renderMethods(); });
// 🗂️ 지식 목록은 평소 숨김(그래프로 충분) — 정리(삭제)할 때만 펼침
$('notesToggle').addEventListener('click', () => { const n = $('brainNotes'); n.classList.toggle('hidden'); ($('notesToggle') as HTMLElement).classList.toggle('on', !n.classList.contains('hidden')); });
// 🧠 제이 브레인 링크 — 멘토 두뇌 연동(구독자) / 게시(대장)
$('mentorLinkBtn').addEventListener('click', async () => {
  const repo = ($('mentorRepo') as HTMLInputElement).value.trim(), pw = ($('mentorPw') as HTMLInputElement).value;
  $('mentorStatus').textContent = '🧠 멘토 두뇌 연동 중…';
  const r = await connect.brainLinkBrain(repo, pw);
  if (!r.ok) { $('mentorStatus').textContent = `⚠️ ${r.error}`; return; }
  $('mentorStatus').textContent = `✅ 제이 브레인 ${r.added}개 연동 (총 ${r.total}개)`;
  if (r.added) { playInjection('🧠 제이 브레인 링크', [`${r.added}개 지식 연동`], '#00e5ff'); await renderBrain(); }
});
// 단기(GitHub)/장기(HuggingFace) 연결 상태 표시
async function refreshMem() {
  const m = await connect.memStatus();
  $('ghRepo').textContent = m.githubReady ? `🔗 ${m.githubRepo}` : '미연결 (🗂️ 연동에서 GitHub)';
  $('ghRepo').className = 'mem-repo' + (m.githubReady ? ' on' : '');
  const hfEl = $('hfRepo') as HTMLElement;
  hfEl.textContent = m.hfReady ? `🔗 ${m.hfRepo}${m.hfUrl ? ' ↗' : ''}` : '미연결 (🗂️ 연동에서 HuggingFace)';
  hfEl.className = 'mem-repo' + (m.hfReady ? ' on' : '') + (m.hfUrl ? ' link' : '');
  hfEl.title = m.hfUrl ? 'HuggingFace에서 데이터셋 열어 확인' : '';
  (hfEl as any).onclick = m.hfUrl ? () => connect.openExternal(m.hfUrl) : null;
}
// 탭 전환
document.querySelectorAll('.btab').forEach(b => b.addEventListener('click', () => {
  const t = (b as HTMLElement).dataset.btab!;
  document.querySelectorAll('.btab').forEach(x => x.classList.toggle('active', (x as HTMLElement).dataset.btab === t));
  $('bsec-short').classList.toggle('hidden', t !== 'short');
  $('bsec-long').classList.toggle('hidden', t !== 'long');
}));
// ⚡ 단기 = GitHub
$('ghPushBtn').addEventListener('click', async () => {
  $('ghStatus').textContent = '⬆ GitHub에 동기화 중…';
  const r = await connect.githubPush();
  $('ghStatus').textContent = r.ok ? `✅ ${r.count}개 지식 동기화 완료` : `⚠️ ${r.error}`;
});
$('ghPullBtn').addEventListener('click', async () => {
  $('ghStatus').textContent = '⬇ GitHub에서 불러오는 중…';
  const r = await connect.githubPull();
  if (r.ok) { const extra = r.scanned ? ` · 파일 ${r.scanned}개 스캔${r.skipped ? `, 잡파일 ${r.skipped}개 제외` : ''}${r.capped ? ' (상한 도달)' : ''}` : ''; $('ghStatus').textContent = `✅ ${r.added}개 새로 가져옴 (총 ${r.total}개)${extra}`; }
  else $('ghStatus').textContent = `⚠️ ${r.error}`;
  if (r.ok && r.added) { playInjection('GitHub → 두뇌 동기화', [`${r.added}개 지식 주입`]); await renderBrain(); }
});
// 🧬 장기기억 만들기: ① 변환 → ② 업로드 → ③ 모델 이름·학습
const LONG_FX = '#a78bfa';   // 장기기억 = 보라
// ① 변환/생성 — SFT: 지식→Q&A · AI자동피드백: AI가 좋은답/나쁜답 생성 (라이브)
$('dsConvertBtn').addEventListener('click', async () => {
  const isDpo = currentMethod === 'dpo';
  const btn = $('dsConvertBtn') as HTMLButtonElement; btn.disabled = true; btn.textContent = isDpo ? 'AI 생성 중…' : '변환 중…';
  $('dsProg').classList.remove('hidden'); $('dsPreview').innerHTML = ''; ($('dsFill') as HTMLElement).style.width = '0%';
  const off = connect.onDatasetProgress((d: any) => {
    ($('dsFill') as HTMLElement).style.width = Math.round(d.done / d.total * 100) + '%';
    $('dsCnt').textContent = isDpo ? `🤖 AI가 좋은답/나쁜답 만드는 중… ${d.done}/${d.total}` : `🤖 AI가 학습 문제 출제 중… ${d.done}/${d.total}`;
    if (d.q) { const el = document.createElement('div'); el.className = 'ds-q'; el.textContent = '❓ ' + d.q; const p = $('dsPreview'); p.prepend(el); while (p.children.length > 4) p.lastChild!.remove(); }
  });
  const r = isDpo ? await connect.brainBuildPreference() : await connect.brainBuildDataset(($('augChk') as HTMLInputElement).checked);
  off?.();
  btn.disabled = false; btn.textContent = isDpo ? '다시 생성' : '다시 변환';
  if (!r.ok) { $('dsCnt').textContent = ''; $('hfStatus').textContent = `⚠️ ${r.error}`; return; }
  if (isDpo) {
    $('dsCnt').textContent = `✅ 선호쌍 ${r.pairs}개 생성 (좋은답 ✅ vs 나쁜답 ❌)`;
    $('dsPreview').innerHTML = (r.sample || []).map((s: any) => `<div class="ds-q">❓ ${escapeHtml(s.q)}<div class="ds-a">✅ ${escapeHtml(s.chosen)}…</div><div class="ds-a" style="color:#e88">❌ ${escapeHtml(s.rejected)}…</div></div>`).join('');
  } else {
    $('dsCnt').textContent = `✅ Q&A ${r.pairs}쌍 생성 (지식 ${r.notes}개${r.augment ? ' · 🔬증강' : ''} · ${r.llm ? 'AI 질문생성' : '템플릿'})`;
    $('dsPreview').innerHTML = (r.sample || []).map((s: any) => `<div class="ds-q">❓ ${escapeHtml(s.q)}<div class="ds-a">→ ${escapeHtml(s.a)}…</div></div>`).join('');
  }
  playInjection(isDpo ? '⚖️ AI 자동 피드백 생성' : '📦 학습 데이터로 변환', [`${r.pairs}개`], LONG_FX);
  $('lfStep1').classList.add('lf-done');
  $('lfStep2').classList.remove('lf-locked'); ($('hfUploadBtn') as HTMLButtonElement).disabled = false;
});
// ② 업로드 — HF에 데이터셋(방식별)
$('hfUploadBtn').addEventListener('click', async () => {
  $('hfStatus').textContent = '🤗 HuggingFace에 업로드 중…';
  const r = currentMethod === 'dpo' ? await connect.hfUploadPreference() : await connect.hfUploadBrain();
  if (!r.ok) { $('hfStatus').innerHTML = `⚠️ ${escapeHtml(r.error || '실패')}`; return; }
  $('hfStatus').innerHTML = `✅ 데이터셋 업로드 완료 — <a href="#" id="hfLink">${escapeHtml(r.url)}</a>`;
  $('hfLink')?.addEventListener('click', (e) => { e.preventDefault(); connect.openExternal(r.url); });
  playInjection('🤗 클라우드에 각인', ['데이터셋 업로드 완료'], LONG_FX);
  $('lfStep2').classList.add('lf-done');
  $('lfStep3').classList.remove('lf-locked');
  const nm = await connect.brainModelName(); const inp = $('modelNameInput') as HTMLInputElement; inp.disabled = false; inp.value = nm.suggested; ($('hfTrainBtn') as HTMLButtonElement).disabled = false;
});
// 학습 강도 프리셋 (lr·epochs 묶음) — 한 번에 최적값
const TS_PRESET: Record<string, { lr: number; epochs: number; hint: string }> = {
  safe: { lr: 2e-4, epochs: 6, hint: '🛡️ 안전 — 과적합 방지 우선 (lr 2e-4, 적게 학습)' },
  balanced: { lr: 3e-4, epochs: 8, hint: '⚖️ 기본 — 학습·과적합 균형 (권장 · lr 3e-4)' },
  strong: { lr: 5e-4, epochs: 10, hint: '🔥 강하게 — 확실히 외움 (lr 5e-4 · 과적합 주의)' },
};
let tsPreset = 'balanced';
document.querySelectorAll('.ts-preset').forEach(b => b.addEventListener('click', () => {
  tsPreset = (b as HTMLElement).dataset.preset!;
  document.querySelectorAll('.ts-preset').forEach(x => x.classList.toggle('on', x === b));
  $('tsHint').textContent = TS_PRESET[tsPreset].hint;
}));
// ③ 모델 이름 정하고 학습
$('hfTrainBtn').addEventListener('click', async () => {
  const name = ($('modelNameInput') as HTMLInputElement).value.trim();
  const p = TS_PRESET[tsPreset];
  const sv = (id: string) => ($(id) as HTMLSelectElement).value;
  const steps = parseInt(($('tsSteps') as HTMLInputElement).value, 10) || 0;
  const al = sv('tsAlpha'), lrv = sv('tsLr'), ep = sv('tsEpochs');
  const opts = {
    method: currentMethod,
    rank: +sv('tsRank'), alpha: al === 'auto' ? undefined : +al, dropout: +sv('tsDropout'),
    learningRate: lrv ? +lrv : p.lr, epochs: ep ? +ep : p.epochs,
    maxSeq: +sv('tsSeq'), scheduler: sv('tsSched'), quant: sv('tsQuant'),
    maxSteps: steps > 0 ? steps : undefined,
  };
  $('hfStatus').textContent = '🚀 학습 노트북 만드는 중…';
  const r = await connect.trainNotebook(name, opts);
  if (!r.ok) { $('hfStatus').textContent = `⚠️ ${r.error}`; return; }
  $('hfStatus').innerHTML = `✅ Colab 열기 → <a href="#" id="colabLink">학습 노트북</a> · "런타임 → 모두 실행"${r.note ? ` <span class="muted">(${escapeHtml(r.note)})</span>` : ''}`;
  $('colabLink')?.addEventListener('click', (e) => { e.preventDefault(); connect.openExternal(r.colab); });
  if (r.colab) connect.openExternal(r.colab);
  playInjection('🧠 장기기억 각인 시작', [name || '내 두뇌'], LONG_FX);
  $('lfStep3').classList.add('lf-done');
});
$('hfExportBtn').addEventListener('click', async () => { $('hfStatus').textContent = '📦 바탕화면 connect-ai-brain.jsonl 확인 (변환 시 자동 저장)'; });

// 🎓 학습 방법론 — 선택 시 교육 카드 + SFT/배움용 뷰 전환
let currentMethod = 'sft', methodsRendered = false, methodList: any[] = [];
async function renderMethods() {
  if (methodsRendered) return; methodsRendered = true;
  methodList = await connect.methodsList();
  $('methodPick').innerHTML = methodList.map((m: any) => `<button class="m-chip${m.id === 'sft' ? ' on' : ''}" data-m="${m.id}">${m.emoji} ${m.label}<span class="m-lv">${m.level}</span></button>`).join('');
  document.querySelectorAll('.m-chip').forEach(b => b.addEventListener('click', () => selectMethod((b as HTMLElement).dataset.m!)));
  selectMethod('sft');
}
function selectMethod(id: string) {
  currentMethod = id;
  const m = methodList.find(x => x.id === id); if (!m) return;
  document.querySelectorAll('.m-chip').forEach(c => c.classList.toggle('on', (c as HTMLElement).dataset.m === id));
  $('methodCard').innerHTML = `<div class="mc-what">${m.emoji} <b>${escapeHtml(m.label)}</b> — ${escapeHtml(m.what)}</div><div class="mc-row">📌 <b>언제</b>: ${escapeHtml(m.when)}</div><div class="mc-row">📦 <b>데이터</b>: ${escapeHtml(m.data)}</div>${m.note ? `<div class="mc-note">💡 ${escapeHtml(m.note)}</div>` : ''}`;
  const isDpo = id === 'dpo';
  $('step1Title').textContent = isDpo ? '⚖️ AI 자동 피드백 생성' : '📦 학습 데이터로 변환';
  $('step1Sub').textContent = isDpo ? 'AI가 좋은답 ✅ vs 나쁜답 ❌ 을 스스로 생성 (사람 클릭 0)' : '지식 → AI가 Q&A 문제로 자동 출제';
  ($('dsConvertBtn') as HTMLButtonElement).textContent = isDpo ? '생성' : '변환';
  ($('augToggle') as HTMLElement).style.display = isDpo ? 'none' : '';
  // 단계 초기화
  ['lfStep1', 'lfStep2', 'lfStep3'].forEach(s => $(s).classList.remove('lf-done'));
  $('lfStep2').classList.add('lf-locked'); $('lfStep3').classList.add('lf-locked');
  ($('hfUploadBtn') as HTMLButtonElement).disabled = true; ($('hfTrainBtn') as HTMLButtonElement).disabled = true;
  $('dsProg').classList.add('hidden');
}
// 🧠 매트릭스 브레인 인젝션 FX — 지식이 분야 두뇌로 다운로드되는 연출(분야 색으로 물듦)
let injectRaf = 0;
const hexToRgb = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0x00ff41; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const PROTOCOL = ['> 인젝션 프로토콜 시작…', '> 페이로드 직렬화…', '> 신경망 채널 동기화…', '> 두뇌 가중치 전송…', '> ✓ 주입 완료'];
function playInjection(label: string, lines: string[] = [], color = '#00ff41') {
  const fx = $('injectFx'); const canvas = $('injectRain') as HTMLCanvasElement;
  fx.classList.remove('hidden', 'out');
  fx.style.setProperty('--fx', color);   // HUD 글로우·바·코어를 분야 색으로
  const [r, g, b] = hexToRgb(color);
  $('ihText').textContent = lines.join('\n').slice(0, 280);
  $('ihLog').innerHTML = ''; let shown = 0;
  const ctx = canvas.getContext('2d'); if (!ctx) { setTimeout(() => fx.classList.add('hidden'), 1200); return; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.width = canvas.clientWidth * dpr, H = canvas.height = canvas.clientHeight * dpr;
  const cx = W / 2, cy = H * 0.42, maxR = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));   // 수렴 중심 = 두뇌 코어 위치
  const fontSize = 15 * dpr;
  const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃ0123◆◇⬢⬡01';
  const gl = () => glyphs[Math.floor(Math.random() * glyphs.length)];
  // 🌌 지식 입자 — 화면 밖에서 두뇌 코어로 빨려 들어옴(꼬리 달린 데이터 스트림)
  const spawn = () => ({ a: Math.random() * Math.PI * 2, r: maxR * (0.65 + Math.random() * 0.45), sp: (1.5 + Math.random() * 2.8) * dpr, g: gl() });
  const P = Array.from({ length: 90 }, spawn);
  // 배경 매트릭스(옅게)
  const cols = Math.max(1, Math.floor(W / (fontSize * 1.7)));
  const drops = new Array(cols).fill(0).map(() => Math.random() * -40);
  brainEnergy(1);
  const t0 = performance.now(), DUR = 2800;
  cancelAnimationFrame(injectRaf);
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / DUR);
    ($('ihFill') as HTMLElement).style.width = (p * 100) + '%';
    $('ihSub').textContent = p < 1 ? `${label} … ${Math.floor(p * 100)}%` : '✓ 두뇌에 주입 완료';
    const want = Math.min(PROTOCOL.length, Math.floor(p * PROTOCOL.length) + 1);
    while (shown < want) { const d = document.createElement('div'); d.className = 'ih-line'; d.textContent = PROTOCOL[shown]; $('ihLog').appendChild(d); shown++; }
    ctx.fillStyle = 'rgba(0,5,7,0.24)'; ctx.fillRect(0, 0, W, H);
    // 배경 매트릭스 비 (희미)
    ctx.font = fontSize + 'px monospace';
    for (let k = 0; k < cols; k++) { const x = k * fontSize * 1.7, y = drops[k] * fontSize; ctx.fillStyle = `rgba(${r},${g},${b},0.16)`; ctx.fillText(gl(), x, y); if (y > H && Math.random() > 0.97) drops[k] = 0; drops[k] += 0.5; }
    // 중앙 코어 글로우 (펄스)
    const pulse = 0.62 + 0.38 * Math.sin(now / 110);
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 86 * dpr * pulse);
    grd.addColorStop(0, `rgba(${r},${g},${b},0.55)`); grd.addColorStop(0.45, `rgba(${r},${g},${b},0.13)`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, 86 * dpr * pulse, 0, 7); ctx.fill();
    // 회전 테크 링 2겹
    for (let ring = 0; ring < 2; ring++) { const rad = (40 + ring * 16) * dpr; const off = now / (500 + ring * 300) % (Math.PI * 2); ctx.strokeStyle = `rgba(${r},${g},${b},${0.55 - ring * 0.2})`; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(cx, cy, rad, off, off + Math.PI * 1.3); ctx.stroke(); }
    // 수렴 입자 + 꼬리
    for (const q of P) {
      q.r -= q.sp * (0.8 + p * 1.9);
      if (q.r < 7 * dpr) { Object.assign(q, spawn()); continue; }
      const near = 1 - q.r / maxR, al = Math.min(1, 0.22 + near * 0.95);
      const ca = Math.cos(q.a), sa = Math.sin(q.a);
      const x = cx + ca * q.r, y = cy + sa * q.r;
      const tail = (14 + near * 26) * dpr, x2 = cx + ca * (q.r + tail), y2 = cy + sa * (q.r + tail);
      ctx.strokeStyle = `rgba(${r},${g},${b},${al * 0.45})`; ctx.lineWidth = (0.8 + near) * dpr; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.fillStyle = Math.random() < 0.07 ? '#ffffff' : `rgba(${r},${g},${b},${al})`;
      ctx.font = (fontSize * (0.65 + near * 0.8)) + 'px monospace'; ctx.fillText(q.g, x, y);
    }
    if (p < 1 && !fx.classList.contains('hidden')) injectRaf = requestAnimationFrame(tick);
    else { $('ihCore')?.classList.add('blast'); setTimeout(() => $('ihCore')?.classList.remove('blast'), 600); fx.classList.add('out'); setTimeout(() => { fx.classList.add('hidden'); fx.classList.remove('out'); brainEnergy(0.3); }, 620); }   // 주입 완료 충격파
  };
  injectRaf = requestAnimationFrame(tick);
}
$('injectFx').addEventListener('click', () => { cancelAnimationFrame(injectRaf); $('injectFx').classList.add('hidden'); brainEnergy(0.3); });
// 🎨 분야 = 두뇌 — 라벨·이모지·색(그래프 노드/칩/성장바 공통)
const CAT_META: Record<string, { label: string; emoji: string; color: string }> = {
  marketing: { label: '마케팅', emoji: '📣', color: '#ff5c8a' },
  coding: { label: '코딩', emoji: '💻', color: '#22d3ee' },
  design: { label: '디자인', emoji: '🎨', color: '#a78bfa' },
  business: { label: '사업', emoji: '💼', color: '#f5c518' },
  general: { label: '일반', emoji: '🗂️', color: '#00ff41' },
};
// 노트의 한 줄 제목 — 마크다운 첫 제목/첫 줄만 (카드가 본문 전체를 토하지 않게)
function noteTitle(t: string): string {
  const first = (t.split('\n').map(l => l.trim()).find(l => l && l !== '---') || t).replace(/^#+\s*/, '').replace(/[*_`>#]/g, '').trim();
  return first.slice(0, 64) + (first.length > 64 ? '…' : '');
}
async function renderBrain() {
  const [g, list, count, stats] = await Promise.all([connect.brainGraph(), connect.brainList(), connect.brainCount(), connect.brainStats()]);
  $('brainCount').textContent = `${count}개`;
  const lsc = $('longShortCount'); if (lsc) lsc.textContent = String(count);   // 장기 탭의 단기 개수
  drawGraph(g);
  renderGrowth(stats);
  $('brainNotes').innerHTML = list.length
    ? list.map((n: any) => { const c = CAT_META[n.category] || CAT_META.general; return `<div class="bn" style="border-left:3px solid ${c.color}" title="${escapeHtml(n.text.slice(0, 500))}"><span class="bn-t">${escapeHtml(noteTitle(n.text))}</span><button class="bn-x" data-id="${n.id}">✕</button></div>`; }).join('')
    : '<div class="muted" style="text-align:center;padding:14px">아직 지식이 없어요. ⬇ GitHub 불러오기, 에제르 주입, 또는 대화 중 에이전트가 자동으로 쌓아요.</div>';
  $('brainNotes').querySelectorAll('.bn-x').forEach(b => b.addEventListener('click', async () => { await connect.brainDelete((b as HTMLElement).dataset.id); await renderBrain(); }));
}

// 📊 분야별 두뇌 성장바 — 각 분야가 파인튜닝 임계점(30개)에 얼마나 다가갔나. point 5를 눈에 보이게.
function renderGrowth(stats: any[]) {
  const el = $('catGrowth'); if (!el) return;
  if (!stats || !stats.length) { el.innerHTML = ''; return; }
  el.innerHTML = stats.map((s: any) => {
    const c = CAT_META[s.id] || CAT_META.general;
    const ready = s.ready;
    return `<div class="cg-row${ready ? ' ready' : ''}" title="${c.label} 두뇌 · ${s.count}개${s.verified ? ` (검증 ${s.verified})` : ''}">
      <span class="cg-ico" style="color:${c.color}">${c.emoji}</span>
      <span class="cg-lab">${c.label}</span>
      <span class="cg-bar"><span class="cg-fill" style="width:${s.pct}%;background:linear-gradient(90deg,${c.color}88,${c.color});box-shadow:0 0 ${ready ? 12 : 7}px ${c.color}${ready ? '' : '99'}"></span></span>
      <span class="cg-num" style="color:${ready ? c.color : ''}">${ready ? '🔥' : ''}${s.count}</span>
    </div>`;
  }).join('');
}

// 🔌 에제르 브릿지 상태 — 주입이 데스크탑에 안 보이는 이유를 솔직하게 알려줌.
async function renderBridge() {
  const el = $('bridgeRow'); if (!el) return;
  let b: any; try { b = await connect.bridgeStatus(); } catch { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (b.state === 'listening') { el.className = 'bridge-row on'; el.innerHTML = `🔌 에제르 브릿지 <b>수신중</b> (:${b.port}) — 웹에서 [주입] 누르면 여기로 들어와요`; }
  else if (b.state === 'yielded') { el.className = 'bridge-row warn'; el.innerHTML = `⚠️ 포트 ${b.port}를 <b>${escapeHtml(b.heldBy || '다른 앱')}</b>이 점유 중 — 에제르 주입이 그쪽으로 가요. 데스크탑으로 받으려면 그 앱(익스텐션)을 끄세요`; }
  else { el.className = 'bridge-row'; el.innerHTML = `🔌 에제르 브릿지 대기 중 (:${b.port})`; }
}
// 🕸️ force-graph — 익스텐션과 동일한 force-directed 지식 네트워크
let fg: any = null;
const hexA = (h: string, a: number) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };
function drawGraph(g: any) {
  const el = $('brainGraph'); const FG = (window as any).ForceGraph;
  // 연결 수(degree) — 허브 뉴런일수록 크게
  const deg: Record<string, number> = {};
  (g.links || []).forEach((l: any) => { const s = l.source?.id || l.source, t = l.target?.id || l.target; deg[s] = (deg[s] || 0) + 1; deg[t] = (deg[t] || 0) + 1; });
  const nodes = (g.nodes || []).map((n: any) => ({ id: n.id, label: n.label, color: (CAT_META[n.category] || CAT_META.general).color, deg: deg[n.id] || 0 }));
  const links = (g.links || []).map((l: any) => ({ source: l.source, target: l.target, w: l.w }));
  if (!FG) { el.innerHTML = '<div class="muted" style="text-align:center;padding:30px">그래프 라이브러리 로드 실패</div>'; return; }
  if (!nodes.length) { el.innerHTML = '<div class="muted" style="text-align:center;padding:46px">지식을 추가하면 신경망이 그려져요 🧠</div>'; fg = null; return; }
  if (!fg || (el.firstChild as HTMLElement)?.tagName !== 'CANVAS') {
    el.innerHTML = '';
    fg = FG()(el)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeRelSize(3).nodeColor((n: any) => n.color || '#00FF41').nodeLabel((n: any) => n.label)   // 기본 노드 항상 그림(안전) + 텍스트는 hover만
      .linkColor((l: any) => hexA(l.source?.color || '#00FF41', 0.2)).linkWidth((l: any) => Math.max(0.6, (l.w || 0.3) * 1.6))   // 시냅스 = 분야 색
      .linkDirectionalParticles(2).linkDirectionalParticleWidth(2).linkDirectionalParticleColor((l: any) => l.source?.color || '#a5ffd7')   // 흐르는 신호 = 분야 색
      .nodeCanvasObjectMode(() => 'after')
      .nodeCanvasObject((node: any, ctx: any) => {
        if (!isFinite(node.x) || !isFinite(node.y)) return;               // 좌표 준비 전 프레임 가드
        const col = node.color || '#00FF41';
        const rad = 3 + Math.min(5, (node.deg || 0) * 0.8);               // 허브 = 큰 뉴런
        const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, rad * 3);   // 시냅스 글로우
        grd.addColorStop(0, hexA(col, 0.7)); grd.addColorStop(0.5, hexA(col, 0.12)); grd.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(node.x, node.y, rad * 3, 0, 7); ctx.fill();
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;  // 뉴런 코어
        ctx.beginPath(); ctx.arc(node.x, node.y, rad, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';                          // 밝은 중심
        ctx.beginPath(); ctx.arc(node.x, node.y, Math.max(0.7, rad * 0.4), 0, 7); ctx.fill();
      });
  }
  fg.width(el.clientWidth || 700).height(el.clientHeight || 300);
  fg.graphData({ nodes, links });
}
$('plazaBtn').addEventListener('click', () => { openOverlay('plazaPanel'); ensurePlazaStream(); });

// ── 광장 ─────────────────────────────────────────────
let plazaJoined = false, plazaES: EventSource | null = null, plazaMsgs: Record<string, any> = {};
let friendOn = false;
let plazaPresES: EventSource | null = null, plazaPeople: Record<string, any> = {};
$('plazaToggle').addEventListener('click', async () => {
  if (!plazaJoined) {
    const r = await connect.plazaEnter();
    if (!r?.ok) { hint('등교 실패: ' + (r?.reason || '설정에서 광장 DB URL 확인')); return; }
    plazaJoined = true; ($('plazaToggle') as HTMLElement).textContent = '🚪 하교하기'; $('plazaStatus').textContent = '🟢 등교 중'; ensurePlazaStream();
  } else { await connect.plazaLeave(); plazaJoined = false; friendOn = false; $('friendBtn').classList.remove('on'); ($('friendBtn') as HTMLElement).textContent = '👥 친구 에이전트 부르기'; ($('plazaToggle') as HTMLElement).textContent = '🏫 등교하기'; $('plazaStatus').textContent = '하교 중'; }
});
// RTDB SSE 구독 헬퍼 — put/patch 이벤트로 변경분이 옴.
function subscribe(url: string, sub: string, store: Record<string, any>, onChange: () => void): EventSource {
  const es = new EventSource(`${url.replace(/\/$/, '')}/plaza/rooms/lobby/${sub}.json`);
  const onEv = (e: MessageEvent) => {
    try {
      const { path, data } = JSON.parse(e.data);
      if (path === '/') { Object.keys(store).forEach(k => delete store[k]); Object.assign(store, data || {}); }
      else { const k = path.replace(/^\//, '').split('/')[0]; if (data === null) delete store[k]; else store[k] = data; }
      onChange();
    } catch { /* keep-alive */ }
  };
  es.addEventListener('put', onEv as any); es.addEventListener('patch', onEv as any);
  return es;
}
async function ensurePlazaStream() {
  if (plazaES) return;
  const url = await connect.plazaDbUrl();
  if (!url || !/^https?:\/\//.test(url)) { $('plazaStatus').textContent = '설정에서 DB URL을 먼저 입력하세요'; return; }
  plazaES = subscribe(url, 'messages', plazaMsgs, onMessages);
  plazaPresES = subscribe(url, 'presence', plazaPeople, renderDesks);
}
const escAttr = (s: string) => String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// 책상(학생) 렌더 — 등교 순서로 정렬, 0=반장 1=부반장
// 등교한 에이전트 — 반장/부반장 없이 동등한 학생. 가로 스트립.
function renderDesks() {
  const now = Date.now();
  const list = Object.values(plazaPeople).filter((p: any) => p && now - p.ts < 60000).sort((a: any, b: any) => a.ts - b.ts);
  $('plazaStatus').textContent = list.length ? `🟢 ${list.length}명 등교` : '하교 중';
  if (!list.length) { $('desks').innerHTML = '<div class="cls-empty">아직 아무도 등교 안 했어요 🙋</div>'; return; }
  $('desks').innerHTML = list.map((p: any) =>
    `<div class="desk" data-company="${escAttr(p.company)}">
      <div class="student"><span class="st-av">${p.emoji || '🧑'}</span></div>
      <div class="st-tag">${escapeHtml(p.company || '')}</div>
    </div>`).join('');
}

// 새 메시지 → 보드는 '현재 문제'만 고정 / 대화는 피드 / 책상 폴짝
let lastMsgKey = '';
function onMessages() {
  renderFeed();
  const list = Object.values(plazaMsgs).filter((m: any) => m && m.text).sort((a: any, b: any) => a.ts - b.ts);
  if (!list.length) return;
  // 책상 애니메이션 — 최신 발언자
  const m: any = list[list.length - 1];
  const key = `${m.ts}|${m.text}`;
  if (key !== lastMsgKey) { const firstLoad = !lastMsgKey; lastMsgKey = key; if (!firstLoad) talkAt(m.company, m.text); }
  // 보드 = 마지막 '문제'(선생님 📢)만 고정 표시 → 피드와 중복 제거
  const topic = [...list].reverse().find((x: any) => x.role === '선생님' || /^📢/.test(x.text || ''));
  if (topic) $('bbLine').innerHTML = `📢 <b>${escapeHtml((topic.text || '').replace(/^📢\s*오늘의 주제:\s*/, ''))}</b>`;
}
function talkAt(company: string, _text: string) {
  const desk = (Array.from(document.querySelectorAll('.desk')) as HTMLElement[]).find(d => d.dataset.company === company);
  if (!desk) return;
  desk.classList.add('talking');
  setTimeout(() => desk.classList.remove('talking'), 4000);
}

// 💬 SNS 피드 — 대화가 카드로 쌓인다 (새 것만 append, slide-in)
const feedSeen = new Set<string>();
function timeAgo(ts: number) { const s = Math.floor((Date.now() - ts) / 1000); return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`; }
function renderFeed() {
  const list = Object.values(plazaMsgs).filter((m: any) => m && m.text).sort((a: any, b: any) => a.ts - b.ts);
  for (const m of list as any[]) {
    const id = `${m.ts}|${m.text}`;
    if (feedSeen.has(id)) continue;
    feedSeen.add(id);
    const teacher = m.role === '선생님' || /^📢/.test(m.text);
    const grade = /^🏆/.test(m.text);
    const el = document.createElement('div');
    el.className = 'post' + (teacher ? ' post-teacher' : '') + (grade ? ' post-grade' : '');
    el.innerHTML = `<div class="post-av">${m.emoji || '🧑'}</div>
      <div class="post-body">
        <div class="post-head"><span class="post-name">${escapeHtml(m.company || '')}</span>${m.role ? `<span class="post-role">${escapeHtml(m.role)}</span>` : ''}<span class="post-time">${timeAgo(m.ts)}</span></div>
        <div class="post-text">${escapeHtml(m.text || '')}</div>
      </div>`;
    $('feed').appendChild(el);
  }
  $('feed').scrollTop = $('feed').scrollHeight;
}
connect.onPlazaPeer((_m: any) => { /* 표시는 onMessages/renderDesks 가 처리 */ });

// 📢 오늘의 주제 발표 — 모든 에이전트가 이 주제로 토론
function sendTopic() {
  const i = $('topicInput') as HTMLInputElement;
  const t = i.value.trim(); if (!t) return;
  if (!plazaJoined) { $('plazaStatus').textContent = '⚠️ 먼저 🏫 등교부터 하세요!'; return; }
  connect.plazaTopic(t);
  $('bbLine').innerHTML = `<b>🧑‍🏫 선생님</b> ✏️ 📢 오늘의 주제: ${escapeHtml(t)}`;
  i.value = '';
}
$('topicBtn').addEventListener('click', sendTopic);
$('topicInput').addEventListener('keydown', (e: any) => { if (e.key === 'Enter') sendTopic(); });

// 🧑‍🏫 선생님 채점 + 🏅 리더보드 (localStorage 누적)
function loadBoard(): Record<string, number> { try { return JSON.parse(localStorage.getItem('academy_board') || '{}'); } catch { return {}; } }
function renderLeaderboard() {
  const b = loadBoard();
  const list = Object.entries(b).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('leaderboard').innerHTML = list.length
    ? '<div class="lb-title">🏅 리더보드</div>' + list.map(([c, p], i) => `<div class="lb-row"><span class="lb-rank">${['🥇', '🥈', '🥉', '4', '5'][i]}</span><span class="lb-name">${escapeHtml(c)}</span><span class="lb-pts">${p}점</span></div>`).join('')
    : '';
}
// 👥 친구 에이전트 (데모) 토글
$('friendBtn').addEventListener('click', async () => {
  if (!plazaJoined) { $('plazaStatus').textContent = '⚠️ 먼저 🏫 등교부터 하세요!'; return; }
  friendOn = !friendOn;
  await connect.plazaDemoBot(friendOn);
  $('friendBtn').classList.toggle('on', friendOn);
  $('friendBtn').textContent = friendOn ? '👥 친구 내보내기' : '👥 친구 에이전트 부르기';
});
$('gradeBtn').addEventListener('click', async () => {
  if (!plazaJoined) { $('plazaStatus').textContent = '⚠️ 먼저 🏫 등교부터 하세요!'; return; }
  const btn = $('gradeBtn') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = '🧑‍🏫 채점 중…';
  const r = await connect.plazaGrade();
  btn.disabled = false; btn.textContent = '🧑‍🏫 선생님 채점 — 우등생 뽑기';
  if (!r?.ok) { hint('채점 실패: ' + (r?.reason || '')); return; }
  const b = loadBoard();
  for (const s of r.scores) b[s.company] = (b[s.company] || 0) + (s.score || 0);
  localStorage.setItem('academy_board', JSON.stringify(b));
  renderLeaderboard();
  hint(`🏆 오늘의 우등생: ${r.top}`);
});

// ── 부팅 + 시작 ───────────────────────────────────────
function timeHello() { const h = new Date().getHours(); return h < 5 ? '늦은 시간이네요' : h < 12 ? '좋은 아침입니다' : h < 18 ? '좋은 오후입니다' : '좋은 저녁입니다'; }
function greet() {
  const custom = (cfg.greeting || '').trim();
  const title = cfg.userTitle || '사장님';
  const g = custom ? custom.replace(/\{name\}/g, agentName()).replace(/\{title\}/g, title) : `${timeHello()}, ${title}. ${agentName()}입니다. 무엇을 도와드릴까요?`;
  addLog(agentTag(), g, false, true);
}
// 🕐 JARVIS 헤더 시계
function startClock() {
  const el = $('hdrClock');
  const tick = () => { el.textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  tick(); setInterval(tick, 1000);
}
function runBoot() {
  const boot = $('boot'), fill = $('bootFill'), sub = $('bootSub');
  const steps = ['INITIALIZING', 'LOADING LOCAL AI', 'CONNECTING', 'WAKING 영숙', 'READY']; let i = 0, pct = 0;
  const tick = setInterval(() => {
    pct = Math.min(100, pct + 9 + Math.random() * 11); fill.style.width = pct + '%';
    const si = Math.min(steps.length - 1, Math.floor(pct / 100 * steps.length)); if (si !== i) { i = si; sub.textContent = steps[i]; }
    if (pct >= 100) { clearInterval(tick); sub.textContent = 'READY'; setTimeout(() => { boot.classList.add('done'); setTimeout(() => boot.remove(), 700); }, 320); }
  }, 160);
}
// 🧠 두뇌 비주얼 (메인 배경)
let brainViz: BrainViz | null = null;
let brainOn = true;
function initBrain() { if (brainViz) return; brainViz = new BrainViz($('brainGlobe') as HTMLCanvasElement); brainViz.start(); brainViz.setEnergy(0.12); }
function brainEnergy(v: number) { if (brainViz) brainViz.setEnergy(brainOn ? v : 0); }
$('cfgBrainViz').addEventListener('change', (e: any) => {
  brainOn = e.target.checked;
  $('mainStage').classList.toggle('brain-off', !brainOn);
  if (brainOn) { initBrain(); brainEnergy(0.12); } else brainEnergy(0);
});

runBoot();
loadCfg().then(() => { loadModels(); greet(); });
renderLeaderboard();
initBrain();
startClock();
// 📋 아침 브리핑(능동성) — 트레이/자동으로 도착하면 채팅에 표시 + 음성
connect.onBriefing((text: string) => { addLog('📋 아침 브리핑', text, false, true, '#FBBF24'); brainEnergy(0.9); try { speak(stripMd(text)); } catch { /* */ } });
connect.onTrayNewChat(async () => { await connect.reset(); $('chat').innerHTML = ''; greet(); hint('새 대화를 시작했어요'); });
export {};
