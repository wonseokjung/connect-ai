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
// 🦾 자비스 전자음 — 짧은 딜레이 콤필터(금속성 울림) + 하이패스(스피커 느낌). 영화 AI 보이스의 그 질감.
let jarvisCtx: AudioContext | null = null;
let jarvisSrc: AudioBufferSourceNode | null = null;
async function playJarvisFx(dataUri: string): Promise<boolean> {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    jarvisCtx = jarvisCtx || new AC();
    if (jarvisSrc) { try { jarvisSrc.stop(); } catch { /* */ } }
    const buf = await (await fetch(dataUri)).arrayBuffer();
    const audio = await jarvisCtx.decodeAudioData(buf);
    const src = jarvisCtx.createBufferSource(); src.buffer = audio; jarvisSrc = src;
    const hp = jarvisCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 130;   // 저역 컷 = 무전기·스피커
    const dry = jarvisCtx.createGain(); dry.gain.value = 0.8;
    const dl = jarvisCtx.createDelay(); dl.delayTime.value = 0.013;                              // 13ms 콤필터 = 금속성
    const wet = jarvisCtx.createGain(); wet.gain.value = 0.42;
    const dl2 = jarvisCtx.createDelay(); dl2.delayTime.value = 0.029;                            // 2차 반사 = 홀로그램 룸톤
    const wet2 = jarvisCtx.createGain(); wet2.gain.value = 0.16;
    src.connect(hp);
    hp.connect(dry); dry.connect(jarvisCtx.destination);
    hp.connect(dl); dl.connect(wet); wet.connect(jarvisCtx.destination);
    hp.connect(dl2); dl2.connect(wet2); wet2.connect(jarvisCtx.destination);
    brainEnergy(0.95);
    await new Promise<void>((res) => { src.onended = () => res(); src.start(); });
    brainEnergy(0.14); jarvisSrc = null;
    return true;
  } catch { return false; }
}
async function speakCloud(text: string): Promise<boolean> {
  try {
    const r = await connect.ttsSpeak(text);
    if (!r || !r.ok || !r.dataUri) return false;
    if (ttsAudio) { try { ttsAudio.pause(); } catch { /* */ } }
    // 자비스 보이스면 전자음 이펙트 체인으로 재생
    if (/^jarvis/.test(cfg.qwenVoice || '') && await playJarvisFx(r.dataUri)) return true;
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
  ($('cfgTrainBackend') as HTMLInputElement).value = cfg.trainBackendUrl || '';
  ($('cfgFbApiKey') as HTMLInputElement).value = cfg.firebaseApiKey || '';
  ($('cfgFbDbUrl') as HTMLInputElement).value = cfg.firebaseDbUrl || '';
  ($('cfgLlmBase') as HTMLInputElement).value = cfg.llmBase || '';
  ($('cfgGreeting') as HTMLInputElement).value = cfg.greeting || '';
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
  ($('cfgEmailAuto') as HTMLInputElement).checked = !!cfg.emailAutoReply;
  ($('cfgMonitor') as HTMLInputElement).checked = cfg.monitorOn !== false;
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
  if (plazaJoined) hint('명찰 바뀜 — 퇴장 후 다시 입장하면 적용돼요');
}
['plazaEmoji', 'plazaCompany', 'plazaAgentName'].forEach(id => $(id).addEventListener('change', saveNameTag));
$('saveCfg').addEventListener('click', async () => {
  cfg = await connect.setConfig({
    plazaDbUrl: ($('cfgDbUrl') as HTMLInputElement).value.trim(),
    trainBackendUrl: ($('cfgTrainBackend') as HTMLInputElement).value.trim(),
    firebaseApiKey: ($('cfgFbApiKey') as HTMLInputElement).value.trim(),
    firebaseDbUrl: ($('cfgFbDbUrl') as HTMLInputElement).value.trim(),
    llmBase: ($('cfgLlmBase') as HTMLInputElement).value.trim(),
    greeting: ($('cfgGreeting') as HTMLInputElement).value.trim(),
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
    emailAutoReply: ($('cfgEmailAuto') as HTMLInputElement).checked,
    monitorOn: ($('cfgMonitor') as HTMLInputElement).checked,
    briefingHour: parseInt((($('cfgBriefingTime') as HTMLInputElement).value || '09:00').split(':')[0], 10) || 9,
    briefingMin: parseInt((($('cfgBriefingTime') as HTMLInputElement).value || '09:00').split(':')[1], 10) || 0,
    trainNotebookUrl: ($('cfgTrainUrl') as HTMLInputElement).value.trim(),
  });
  applyCfgLabels();
  closeOverlay('settingsPanel'); loadModels(); hint('설정을 저장했어요 ✅');
});
$('briefNowBtn').addEventListener('click', () => { connect.briefingRun(); closeOverlay('settingsPanel'); hint('📋 브리핑을 준비하고 있어요…'); });
// 📱 폰 웹 리모컨 — 같은 와이파이에서 폰 브라우저로 운영 지휘 (주소 복사 + 안내)
$('remoteBtn')?.addEventListener('click', async () => {
  const r = await connect.remoteInfo?.().catch(() => null);
  if (!r?.url) { hint('와이파이(네트워크)에 연결돼 있어야 해요'); return; }
  try { await navigator.clipboard.writeText(r.url); } catch { /* */ }
  closeOverlay('settingsPanel');
  const webUrl = r.relay?.ready ? `https://connectai-desktop.web.app/remote.html#db=${encodeURIComponent(r.relay.db.replace(/\/+$/, ''))}&p=${encodeURIComponent(r.relay.pair)}` : '';
  if (webUrl) { try { await navigator.clipboard.writeText(webUrl); } catch { /* */ } }   // 외부 링크가 더 유용 — 그걸 복사
  const relay = webUrl
    ? `\n\n🌍 어디서든(외부) — 이 링크를 폰에 보내두세요 (복사됨):\n${webUrl}\n\n홈 화면에 추가하면 진짜 리모컨처럼 쓸 수 있어요. 텔레그램 "운영"도 됩니다.`
    : '\n\n🌍 외부 접속은 텔레그램 "운영" 명령을 쓰세요. (⚙️ 광장 DB URL을 넣으면 웹 리모컨도 활성화)';
  addLog('📱 폰 리모컨', `같은 와이파이(집)에서는:\n${r.url}${relay}`, false, false, '#00a0ff');
});
$('openAiTeamBtn')?.addEventListener('click', () => { closeOverlay('settingsPanel'); openOverlay('aiPanel'); loadAiPanel(); });
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
  // 모델 선택 UI는 🤖 내 AI 팀에 통합됨 — 여기선 자동 감지로 base/model만 맞춰둔다
  const info = await connect.listModels();
  if (!info || !info.models?.length) { MODELS_CACHE = []; return; }
  MODELS_CACHE = info.models; MODELS_LOADED = info.loaded || '';
  const chosen = (cfg.llmModel && info.models.includes(cfg.llmModel)) ? cfg.llmModel : (info.loaded || info.models[0]);
  cfg = await connect.setConfig({ llmBase: info.base, llmModel: chosen });
}

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
  $('suggChips')?.remove();   // 💡 첫 메시지를 보내면 추천 칩은 퇴장
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
async function loadAiPanel() { renderOfficePreview(); renderTeamRoster(); await Promise.all([renderAiCurrent(), loadLocalAI(), loadParams()]); }
// 🏢 작은 사무실 미리보기 — 팀 아바타가 둥실둥실, 누르면 큰 사무실 창. [[project_my_ai_team_vision]]
function renderOfficePreview() {
  const el = $('officePreview'); if (!el) return;
  el.style.backgroundImage = `url('${OFFICE_BG}')`;
  el.innerHTML = AGENT_ORDER.map((id, i) => {
    const a = AGENTS[id]; if (!a) return ''; const [x, y] = VO_HOME[id] || [50, 50];
    const im = agImgSrc(id);
    const inner = im ? `<div class="opc-av" style="background-image:url('${escAttr(im)}')"></div>` : `<div class="opc-av opc-emoji">${a.emoji}</div>`;
    return `<div class="op-char" style="left:${x}%;top:${y}%;animation-delay:${(i % 6) * 0.35}s">${inner}</div>`;
  }).join('') + `<div class="op-expand">⤢ 크게 보기</div>`;
}
// 👥 우리 팀 로스터 — 캐릭터별 이름·얼굴·두뇌를 한눈에. 클릭 → 상세(커스텀). [[project_my_ai_team_vision]]
function renderTeamRoster() {
  const el = $('teamRoster'); if (!el) return;
  el.innerHTML = AGENT_ORDER.map(id => {
    const a = AGENTS[id]; if (!a) return '';
    const im = agImgSrc(id);
    const av = im
      ? `<div class="tr-av" style="background-image:url('${escAttr(im)}');border-color:${a.color}"></div>`
      : `<div class="tr-av tr-av-emoji" style="border-color:${a.color};background:color-mix(in srgb,${a.color} 22%,#0a120c)">${a.emoji}</div>`;
    const brain = (cfg.agentModels || {})[id];
    const brainLabel = brain ? (brain.length > 14 ? brain.slice(0, 13) + '…' : brain) : '공용 두뇌';
    return `<div class="tr-card${brain ? ' has-brain' : ''}" data-id="${id}" style="--ag:${a.color}" title="${escAttr(a.role)} — 클릭해서 이름·얼굴·두뇌 바꾸기">
      ${av}
      <div class="tr-info"><div class="tr-name">${escapeHtml(agName(id))}</div><div class="tr-brain">🧠 ${escapeHtml(brainLabel)}</div></div>
    </div>`;
  }).join('');
  el.querySelectorAll('.tr-card').forEach(c => c.addEventListener('click', () => openAgentDetail((c as HTMLElement).dataset.id!)));
}
$('officePreview')?.addEventListener('click', () => connect.officeOpen?.());
$('dashTeamBtn')?.addEventListener('click', () => { openOverlay('aiPanel'); loadAiPanel(); });

// ───────── 🚀 운영 시작 시네마틱 — 부팅 → 팀 기상 → 자산 스캔 → 작전 → 사령부 ─────────
const opsWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const OPS_SCAN: [string, string][] = [
  ['youtube', '유튜브 채널 분석 중… 상위 영상·시청층 포착'],
  ['business', '페이팔 매출 스캔 중… 이번 달 집계 완료'],
  ['developer', '웹사이트·코드 점검 중… 배포 상태 OK'],
  ['designer', '비주얼 자산 확인 중… 브랜드 일관성 점검'],
  ['secretary', '작전 종합 중… 수익화 기회 정리'],
];
let opsRaf = 0, opsAutoTimer = 0, opsRunning = false;
function startOpsRain() {
  const cv = $('opsRain') as HTMLCanvasElement; if (!cv) return; const ctx = cv.getContext('2d'); if (!ctx) return;
  cv.width = window.innerWidth; cv.height = window.innerHeight;
  const cols = Math.floor(cv.width / 16); const drops = new Array(cols).fill(0).map(() => Math.random() * -cv.height);
  const chars = 'アイウエオカキクケコサシ0123456789ABCDEF<>/{}#$%';
  const draw = () => {
    ctx.fillStyle = 'rgba(2,8,4,0.10)'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.font = '15px monospace';
    for (let i = 0; i < cols; i++) {
      const c = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillStyle = Math.random() > 0.94 ? '#b6ffce' : '#22c55e';
      ctx.fillText(c, i * 16, drops[i]);
      drops[i] = drops[i] > cv.height && Math.random() > 0.975 ? 0 : drops[i] + 16;
    }
    opsRaf = requestAnimationFrame(draw);
  };
  draw();
}
function stopOpsRain() { if (opsRaf) cancelAnimationFrame(opsRaf); opsRaf = 0; }
function closeOps() {
  if (opsAutoTimer) { clearTimeout(opsAutoTimer); opsAutoTimer = 0; }
  const cin = $('opsCinema'); cin.classList.remove('show'); cin.classList.add('out');
  stopOpsRain(); opsRunning = false;
  setTimeout(() => { cin.setAttribute('hidden', ''); cin.classList.remove('out'); }, 480);
}
async function startOps() {
  if (opsRunning) return;
  // 두뇌 없으면 운영 시작 대신 모델부터 (가짜 분석 방지)
  const ls = _localStatus || (await connect.localStatus?.().catch(() => null));
  if (!ls?.running && !cfg.llmModel) { hint('먼저 🤖 에서 AI 두뇌를 켜주세요 — 그래야 팀이 일해요'); openOverlay('aiPanel'); loadAiPanel(); return; }
  opsRunning = true;
  const cin = $('opsCinema'), stage = $('opsStage'); if (!cin || !stage) { opsRunning = false; return; }
  cin.removeAttribute('hidden'); requestAnimationFrame(() => cin.classList.add('show'));
  startOpsRain();
  // 🤖 진짜 분석 시작 — 부팅·기상 연출이 도는 동안 백그라운드에서 실데이터를 분석한다(연출 끝날 즈음 결과 도착)
  const opsP: Promise<any> = (connect.opsStart?.() || Promise.resolve(null)).catch(() => null);
  const company = (cfg.company && cfg.company !== '1인 기업') ? cfg.company : '내 회사';
  // ① 부팅
  stage.innerHTML = `<div class="ops-boot">
    <div class="ops-logo">✦ CONNECT AI</div>
    <div class="ops-tag">${escapeHtml(company)} · 운영 개시</div>
    <div class="ops-bar"><div class="ops-bar-fill" id="opsBarFill"></div></div>
    <div class="ops-sub" id="opsSub">INITIALIZING</div>
  </div>`;
  await opsWait(60); const bf = $('opsBarFill'); if (bf) bf.style.width = '100%';
  for (const s of ['두뇌 로딩…', '팀 호출…', '연동 점검…']) { const sub = $('opsSub'); if (sub) sub.textContent = s; await opsWait(440); }
  await opsWait(280); if (!opsRunning) return;
  // ② 팀 기상
  stage.innerHTML = `<div class="ops-act"><div class="ops-h">팀 기상</div><div class="ops-roster" id="opsRoster"></div></div>`;
  const roster = $('opsRoster');
  for (const id of AGENT_ORDER) {
    const a = AGENTS[id]; if (!a || !roster) continue; const im = agImgSrc(id);
    const av = im ? `<div class="ow-av" style="background-image:url('${escAttr(im)}');border-color:${a.color}"></div>` : `<div class="ow-av ow-emoji" style="border-color:${a.color};background:color-mix(in srgb,${a.color} 22%,#020804)">${a.emoji}</div>`;
    const el = document.createElement('div'); el.className = 'ow-card'; el.style.setProperty('--ag', a.color);
    el.innerHTML = `${av}<div class="ow-name">${escapeHtml(agName(id))}</div><div class="ow-on">● ONLINE</div>`;
    roster.appendChild(el); requestAnimationFrame(() => el.classList.add('in')); await opsWait(160);
  }
  await opsWait(550); if (!opsRunning) return;
  // ③ 자산 스캔 — 진짜 분석 결과를 기다렸다가(연출 동안 이미 돌고 있음) 실제 숫자로 채운다
  stage.innerHTML = `<div class="ops-act"><div class="ops-h">자산 스캔</div><div class="ops-lines" id="opsLines"></div></div>`;
  const ops = await opsP;   // { scan:[{agent,label,ok}], actions:[{title,agent,risk}], summary }
  const scanItems: { agent: string; label: string; ok: boolean }[] = (ops?.scan?.length)
    ? ops.scan
    : OPS_SCAN.map(([agent, label]) => ({ agent, label, ok: true }));
  const lines = $('opsLines');
  for (const s of scanItems) {
    const a = AGENTS[s.agent] || ({ emoji: '▸', color: '#39ff14' } as any); if (!lines) break;
    const el = document.createElement('div'); el.className = 'os-line' + (s.ok ? '' : ' os-skip'); el.style.setProperty('--ag', a.color);
    el.innerHTML = `<span class="os-who">${a.emoji} ${escapeHtml(agName(s.agent))}</span><span class="os-txt"></span><span class="os-ok">${s.ok ? '✓' : '—'}</span>`;
    lines.appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
    const tEl = el.querySelector('.os-txt') as HTMLElement; const txt = s.label;
    for (let i = 0; i <= txt.length; i += 2) { tEl.textContent = txt.slice(0, i); await opsWait(8); }
    tEl.textContent = txt; el.classList.add('done'); await opsWait(160);
  }
  await opsWait(450); if (!opsRunning) return;
  // ④ 분석 완료 → 사람이 작전을 고르는 사이클 패널로 넘긴다
  const summary = ops?.summary ? `<div class="ops-summary">“${escapeHtml(ops.summary)}”</div>` : '';
  const n = (ops?.actions?.length) || 0;
  stage.innerHTML = `<div class="ops-act ops-plan"><div class="ops-h ops-h-big">✓ 분석 완료</div>${summary}<div class="ops-note">오늘의 작전 ${n}개를 준비했어요 — 할 것을 직접 고르세요</div><button class="ops-go" id="opsGo">📋 작전 검토하기 →</button></div>`;
  const finish = () => { closeOps(); openCyclePanel(); };
  $('opsGo')?.addEventListener('click', finish);
  opsAutoTimer = window.setTimeout(finish, 3200);
}
// 🚀/⏹ 시작·중단 토글 — 운영 중이면 같은 버튼이 '운영 중단'으로
let opsActive = false;
function setOpsBtn(active: boolean) {
  opsActive = active;
  const b = $('opsStartBtn'); if (!b) return;
  b.classList.toggle('active', active);
  b.textContent = active ? '⏹ 운영 중단' : '🚀 운영 시작';
  b.title = active ? '운영 사이클을 멈춥니다' : '운영 시작 — 분석 → 작전 검토 → 실행 사이클을 시작합니다';
}
$('opsStartBtn')?.addEventListener('click', async () => {
  if (opsActive) { await connect.opsStop?.(); setOpsBtn(false); hint('⏹ 자율 운영을 멈췄어요'); }
  else { startOps(); }
});
$('opsSkip')?.addEventListener('click', closeOps);

// ───────── 🎯 운영 사이클 패널 — 분석 → 사람이 작전 선택 → 하나씩 수행 → 다음 사이클? ─────────
let _ops: any = null;
function openCyclePanel() { openOverlay('opsCyclePanel'); connect.opsStatus?.().then((s: any) => { _ops = s; renderCycle(s); }).catch(() => { /* */ }); }
const PHASE_LABEL: Record<string, string> = { planning: '분석 중…', review: '할 작전을 골라주세요', executing: '실행 중…', done: '사이클 완료', idle: '대기' };
function shipFor(s: any, title: string) { return (s.shipped || []).find((x: any) => x.title === title); }
const fileIcon = (name: string): string => {
  if (/\.(md|markdown)$/i.test(name)) return '📄';
  if (/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(name)) return '🖼️';
  if (/\.(mp4|mov|avi|mkv|webm)$/i.test(name)) return '🎬';
  if (/\.(mp3|wav|m4a|aac)$/i.test(name)) return '🎵';
  if (/\.(json|jsonl|csv|xlsx?)$/i.test(name)) return '📊';
  if (/\.(py|js|ts|tsx|jsx|go|rs)$/i.test(name)) return '💻';
  if (/\.(html|css)$/i.test(name)) return '🌐';
  if (/\.(zip|tar|gz|7z)$/i.test(name)) return '📦';
  return '📎';
};
function artsHtml(ship: any) {
  const arr: string[] = ship?.artifacts || [];
  if (!arr.length) return '';
  const files: string[] = ship?.files || [];
  return `<div class="cyc-arts">${arr.map(x => {
    const m = x.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);   // 산출물 태그 앞 이모지를 아이콘으로 분리
    const icon = m ? m[1] : fileIcon(x);
    const label = m ? m[2] : x;
    const name = label.split('/').pop() || label;
    // 📄 실제 생성 파일과 매칭되면 클릭해서 열 수 있게
    const file = files.find(f => (f.split('/').pop() || f) === name) || '';
    return `<span class="cyc-art${file ? ' openable' : ''}" data-icon="${icon}"${file ? ` data-file="${escAttr(file)}"` : ''} title="${escapeHtml(file ? label + ' — 클릭해서 열기' : label)}">${escapeHtml(name)}</span>`;
  }).join('')}</div>`;
}
// 산출물 칩 클릭 → 실제 파일 오픈 (위임 — 사이클 패널 전체)
$('opsCyclePanel')?.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement)?.closest?.('.cyc-art.openable') as HTMLElement | null;
  if (!el?.dataset.file) return;
  const r = await connect.opsOpenArtifact?.(el.dataset.file);
  hint(r?.ok ? '📄 파일을 열었어요' : (r?.reason || '파일을 못 열었어요'));
});
function renderCycle(s: any) {
  if (!s || $('opsCyclePanel')?.classList.contains('hidden')) return;
  $('cycleNum').textContent = '#' + (s.cycle || 1);
  $('cyclePhase').textContent = PHASE_LABEL[s.phase] || '';
  $('cyclePhase').className = 'cycle-phase ph-' + (s.phase || 'idle');
  // 단계 스테퍼 — 분석 → 검토·분담 → 실행 → 완료 (지금 어디인지 한눈에)
  const stepIdx = ['planning', 'review', 'executing', 'done'].indexOf(s.phase);
  $('cycleSteps')?.querySelectorAll('.cstep').forEach((el, i) => {
    el.classList.toggle('on', i === stepIdx);
    el.classList.toggle('past', stepIdx > i);
  });
  const sm = $('cycleSummary'); sm.textContent = s.summary ? '“' + s.summary + '”' : ''; sm.style.display = s.summary ? '' : 'none';
  const body = $('cycleBody'), foot = $('cycleFoot');
  if (s.phase === 'planning') {
    body.innerHTML = `<div class="cyc-loading"><span class="cyc-spin"></span> 현황을 분석해 오늘의 작전을 짜는 중…</div>`;
    foot.innerHTML = '';
  } else if (s.phase === 'review') {
    // ① 오늘의 TODO — 체크로 할 일 고르고, 🤖/🙋 토글로 누가 할지 정한다
    body.innerHTML = `<div class="cyc-step">① 오늘의 TODO — 할 것만 체크하고, 누가 할지 정하세요</div>` + (s.actions || []).map((a: any, i: number) => {
      const risky = a.risk && a.risk !== 'safe';
      const human = a.assignee === 'human';
      const agName = AGENTS[a.agent]?.name || '에이전트';
      const agColor = AGENTS[a.agent]?.color || '#39ff14';
      return `<label class="cyc-task${human ? ' is-me' : ''}"><input type="checkbox" class="cyc-chk" data-title="${escAttr(a.title)}" checked><span class="cyc-box"></span><span class="cyc-n">${i + 1}</span><span class="cyc-t">${escapeHtml(a.title)}</span><button type="button" class="cyc-who${human ? ' me' : ''}" data-title="${escAttr(a.title)}" data-agent="${escAttr(agName)}" style="--ag:${agColor}" title="클릭해서 담당 바꾸기">${human ? '🙋 내가 할게' : `🤖 ${escapeHtml(agName)}`}</button>${risky ? '<span class="cyc-risk">승인 필요</span>' : ''}</label>`;
    }).join('') || '<div class="cyc-loading">작전이 없어요</div>';
    foot.innerHTML = `<div class="cyc-legend">🤖 = 에이전트가 수행 · 🙋 = 내 할 일로 등록(태스크 보드+폰 알림)</div><button class="cyc-btn ghost" id="cycReplan">🔄 다시 분석</button><button class="cyc-btn primary" id="cycRun">TODO 전부 수행 ▶</button>`;
    // 담당 토글 — 🤖 에이전트 ↔ 🙋 내가
    body.querySelectorAll('.cyc-who').forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const el = b as HTMLElement; const me = el.classList.toggle('me');
      el.textContent = me ? '🙋 내가 할게' : `🤖 ${el.dataset.agent || '에이전트'}`;
      el.closest('.cyc-task')?.classList.toggle('is-me', me);
    }));
  } else if (s.phase === 'executing') {
    // 🔴 실시간 작업 로그 — 에이전트가 지금 어떤 도구로 뭘 하는지 그대로 흐른다
    const feed = (s.feed || []).slice(0, 9);
    const feedAgo = (ts: number) => { const sec = Math.floor((Date.now() - ts) / 1000); return sec < 5 ? '방금' : sec < 60 ? sec + '초 전' : Math.floor(sec / 60) + '분 전'; };
    const feedHtml = feed.length ? `<div class="cyc-feed"><div class="cyc-feed-h"><span class="cyc-live-dot"></span>실시간 작업 로그</div>${feed.map((f: any, i: number) => {
      const ag = AGENTS[f.agent];
      return `<div class="cyc-feed-line${f.ok === false ? ' bad' : ''}${i === 0 ? ' new' : ''}" style="--ag:${ag?.color || '#39ff14'}"><span class="cf-ic">${f.icon || '🔧'}</span><span class="cf-tx">${escapeHtml(f.text || '')}</span><span class="cf-ago">${feedAgo(f.ts)}</span></div>`;
    }).join('')}</div>` : '';
    body.innerHTML = `<div class="cyc-step">② 고른 작전을 하나씩 수행 중…</div>` + (s.actions || []).map((a: any) => {
      const ship = shipFor(s, a.title); const running = s.executingTitle === a.title;
      let st = '<span class="cyc-st wait">대기</span>';
      if (running) st = '<span class="cyc-st run"><span class="cyc-spin"></span> 실행 중</span>';
      else if (ship) st = ship.ok ? '<span class="cyc-st ok">✅ 완료</span>' : '<span class="cyc-st fail">결과 없음</span>';
      return `<div class="cyc-task exec ${running ? 'on' : ''}"><span class="cyc-t">${escapeHtml(a.title)}</span>${st}${ship ? artsHtml(ship) : ''}</div>`;
    }).join('') + feedHtml;
    foot.innerHTML = `<button class="cyc-btn danger" id="cycStop">■ 멈추기</button>`;
  } else if (s.phase === 'done') {
    const done = (s.actions || []).filter((a: any) => shipFor(s, a.title));
    const okN = done.filter((a: any) => shipFor(s, a.title)?.ok).length;
    body.innerHTML = `<div class="cyc-complete"><div class="cyc-complete-ic">✅</div><div class="cyc-complete-t">사이클 #${s.cycle} 완료</div><div class="cyc-complete-s">${done.length}개 수행 · 산출물 ${okN}개</div></div>` +
      done.map((a: any) => { const sh = shipFor(s, a.title); return `<div class="cyc-task exec"><span class="cyc-t">${escapeHtml(a.title)}</span><span class="cyc-st ${sh.ok ? 'ok' : 'fail'}">${sh.ok ? '✅' : '미완'}</span>${artsHtml(sh)}</div>`; }).join('');
    foot.innerHTML = `<div class="cyc-ask">한 사이클이 끝났어요. 다음 사이클을 돌릴까요?</div><div class="cyc-foot-row"><button class="cyc-btn ghost" id="cycEnd">■ 운영 종료</button><button class="cyc-btn primary" id="cycNext">▶ 다음 사이클</button></div>`;
  } else { body.innerHTML = `<div class="cyc-loading">운영을 시작하면 오늘의 작전이 여기 떠요.</div>`; foot.innerHTML = ''; }
  // 버튼 배선
  const run = $('cycRun'); if (run) run.onclick = async () => {
    const titles = Array.from(document.querySelectorAll('.cyc-chk:checked')).map(c => (c as HTMLElement).dataset.title!).filter(Boolean);
    if (!titles.length) { hint('실행할 작전을 하나 이상 골라주세요'); return; }
    // 🙋 토글이 "내가"인 작전 → 사장님 할 일로 (태스크 보드 등록), 나머지 → 에이전트 실행
    const humanTitles = Array.from(document.querySelectorAll('.cyc-who.me')).map(b => (b as HTMLElement).dataset.title!).filter(t => titles.includes(t));
    run.setAttribute('disabled', ''); _ops = await connect.opsExecuteSelected?.(titles, humanTitles); renderCycle(_ops);
  };
  const replan = $('cycReplan'); if (replan) replan.onclick = async () => { replan.setAttribute('disabled', ''); _ops = await connect.opsNextCycle?.(); renderCycle(_ops); };
  const next = $('cycNext'); if (next) next.onclick = async () => { next.setAttribute('disabled', ''); _ops = await connect.opsNextCycle?.(); renderCycle(_ops); };
  const stop = $('cycStop'); if (stop) stop.onclick = async () => { _ops = await connect.opsStop?.(); hint('■ 멈췄어요'); renderCycle(_ops); };
  const end = $('cycEnd'); if (end) end.onclick = async () => { await connect.opsStop?.(); closeOverlay('opsCyclePanel'); hint('운영을 종료했어요'); };
}
connect.onOpsUpdate?.((s: any) => { _ops = s; setOpsBtn(!!s?.running); renderCycle(s); try { officeOpsTick(s); } catch { /* */ } });   // 상태 변할 때마다 버튼+패널+사무실 동기화
connect.onOpsOpenPanel?.(() => openCyclePanel());   // 🔗 대시보드 "작전 검토" 버튼 → 메인 창 패널 열림
connect.opsStatus?.().then((s: any) => { _ops = s; setOpsBtn(!!s?.running); }).catch(() => { /* */ });
async function renderAiCurrent() {
  const cfg = await connect.getConfig();
  const ls = _localStatus || (await connect.localStatus?.());
  const el = $('aiCurrent'); if (!el) return;
  let icon = '🧠', name = '', tag = '', on = false, busy = false;
  if (ls?.loading) { icon = '⏳'; name = ls.modelName ? ls.modelName : '불러오는 중'; tag = ls.loadMsg || '불러오는 중…'; busy = true; }   // 🔁 GPU→CPU 폴백 진행 표시
  else if (ls?.running && (cfg.llmBase || '').includes(':1235')) {
    name = ls.modelName;
    tag = ls.mode === 'cpu' ? '🖥️ 내장 · CPU 모드 (GPU 미지원)' : '⚡ 내장 · GPU 가속';
    on = true;
  }
  else if (ls?.error) { icon = '⚠️'; name = '모델을 못 켰어요'; tag = String(ls.error).slice(0, 44); }
  else if (cfg.llmModel) { const g = /gemini/i.test(cfg.llmModel); icon = g ? '☁️' : '🧠'; name = cfg.llmModel; tag = g ? 'Gemini' : (cfg.llmBase || '').includes('11434') ? 'Ollama' : 'LM Studio'; }
  else { icon = '🧠'; name = 'AI를 골라주세요'; tag = '아래에서 받아 사용'; }
  const off = on ? `<button class="aic-off" id="aicOff">끄기</button>` : '';
  el.innerHTML = `<div class="aic-icon${busy ? ' spin' : ''}">${icon}</div><div class="aic-info"><div class="aic-name">${name}</div><div class="aic-tag">${tag}</div></div>${off}`;
  el.className = 'ai-current' + (on ? ' on' : '');
  $('aicOff')?.addEventListener('click', async () => {
    _localStatus = { ...(_localStatus || {}), loading: true, running: false }; renderAiCurrent();
    await connect.localStop?.(); await connect.setConfig({ llmBase: '', llmModel: '' });
    _localStatus = await connect.localStatus?.(); await loadLocalAI(); await renderAiCurrent();
  });
}
// ⚙️ 추론 파라미터 (프로 콘솔)
let _params: any = {};
const SLIDERS = [
  { id: 'apTemp', val: 'apTempVal', key: 'temp', sc: 100, dp: 2 },
  { id: 'apTopP', val: 'apTopPVal', key: 'topP', sc: 100, dp: 2 },
  { id: 'apTopK', val: 'apTopKVal', key: 'topK', sc: 1, dp: 0 },
  { id: 'apMinP', val: 'apMinPVal', key: 'minP', sc: 100, dp: 2 },
  { id: 'apRep', val: 'apRepVal', key: 'repeatPenalty', sc: 100, dp: 2 },
  { id: 'apFreq', val: 'apFreqVal', key: 'freqPenalty', sc: 100, dp: 2 },
  { id: 'apPres', val: 'apPresVal', key: 'presPenalty', sc: 100, dp: 2 },
  { id: 'apLastN', val: 'apLastNVal', key: 'repeatLastN', sc: 1, dp: 0 },
];
const DEF_PARAMS = { temp: 0.7, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.1, freqPenalty: 0, presPenalty: 0, repeatLastN: 64, flashAttn: true, ctxSize: 8192, maxTokens: 1024 };
// 🎭 성격 프리셋 — 슬라이더 8개를 비개발자용 4개로 묶음. 전문가는 접기에서 직접 조정.
const PERSONAS: Record<string, any> = {
  calm:     { temp: 0.4, topP: 0.85, topK: 40, minP: 0.05, repeatPenalty: 1.10 },
  balanced: { temp: 0.7, topP: 0.90, topK: 40, minP: 0.05, repeatPenalty: 1.10 },
  creative: { temp: 1.0, topP: 0.95, topK: 60, minP: 0.02, repeatPenalty: 1.05 },
  strict:   { temp: 0.2, topP: 0.70, topK: 20, minP: 0.10, repeatPenalty: 1.15 },
};
const PERSONA_KEYS = ['temp', 'topP', 'topK', 'minP', 'repeatPenalty'];
const applyParams = async (patch: any) => { _params = await connect.localSetOptions?.(patch); await renderAiCurrent(); };
const kctx = (n: number) => n >= 1024 ? Math.round(n / 1024) + 'K' : String(n);
async function loadParams() {
  _params = (await connect.localOptions?.()) || _params;
  const st = _localStatus || (await connect.localStatus?.()) || {};
  const maxCtx = Number(st.maxCtx) || 0;
  ($('apFlash') as HTMLInputElement).checked = !!_params.flashAttn;
  document.querySelectorAll('#apCtx button').forEach(b => {
    const v = Number((b as HTMLElement).dataset.ctx); const over = !!maxCtx && v > maxCtx;
    b.classList.toggle('on', v === _params.ctxSize && !over);
    b.classList.toggle('dim', over); (b as HTMLButtonElement).disabled = over;
    (b as HTMLElement).title = over ? '이 모델 최대 컨텍스트 초과' : '';
  });
  const ctxEm = document.querySelector('#apCtx')?.closest('.ap-row')?.querySelector('.ap-name em');
  if (ctxEm) ctxEm.textContent = maxCtx ? `ctx · 모델최대 ${kctx(maxCtx)}` : 'ctx';
  document.querySelectorAll('#apMax button').forEach(b => b.classList.toggle('on', Number((b as HTMLElement).dataset.max) === _params.maxTokens));
  for (const d of SLIDERS) { const v = _params[d.key] ?? 0; const el = $(d.id) as HTMLInputElement; if (el) el.value = String(Math.round(v * d.sc)); const vv = $(d.val); if (vv) vv.textContent = v.toFixed(d.dp); }
  // 현재 값이 어떤 성격 프리셋과 일치하는지 표시
  const match = Object.entries(PERSONAS).find(([, p]) => PERSONA_KEYS.every(k => Math.abs((_params[k] ?? -99) - p[k]) < 1e-6));
  document.querySelectorAll('#apPersona button').forEach(b => b.classList.toggle('on', (b as HTMLElement).dataset.persona === (match?.[0] || '')));
}
$('apFlash')?.addEventListener('change', (e) => applyParams({ flashAttn: (e.target as HTMLInputElement).checked }));
const segPick = (id: string, key: string, attr: string) => $(id)?.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; document.querySelectorAll('#' + id + ' button').forEach(x => x.classList.toggle('on', x === b)); applyParams({ [key]: Number((b as HTMLElement).dataset[attr]) }); });
segPick('apCtx', 'ctxSize', 'ctx'); segPick('apMax', 'maxTokens', 'max');
// 🎭 성격 프리셋 클릭 → 8개 파라미터 한 번에
$('apPersona')?.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  const p = PERSONAS[(b as HTMLElement).dataset.persona || '']; if (!p) return;
  await applyParams(p); await loadParams();
});
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
  const recos = models.length ? [] : ((await connect.hfRecommended?.()) || []);   // 받은 모델 없으면 추천 두뇌 원클릭
  $('localModels').innerHTML = models.length ? models.map((m: any) =>
    `<div class="lm-row ${m.path === cur ? 'active' : ''}"><span class="lm-name">${m.name}</span><span class="muted small">${fmtGB(m.size)}</span>` +
    `<button class="lm-use oc-primary" data-path="${encodeURIComponent(m.path)}">${m.path === cur ? '사용 중' : '사용'}</button>` +
    `<button class="lm-del" data-del="${encodeURIComponent(m.path)}" data-rm="${m.removable ? 1 : 0}" data-nm="${escAttr(m.name)}" data-sz="${fmtGB(m.size)}" data-src="${escAttr(m.source || '')}" title="삭제">🗑️</button></div>`).join('')
    : (recos.length
      ? `<div class="muted small" style="margin-bottom:8px">받은 두뇌가 없어요. 추천 두뇌를 한 번에 받으세요 👇</div>` + recos.map((r: any) => `<div class="reco-card" data-repo="${escAttr(r.repo)}"><div class="reco-info"><div class="reco-name">${escapeHtml(r.label)}</div><div class="reco-hint muted small">${escapeHtml(r.hint)}</div></div><button class="reco-get oc-primary">받기</button></div>`).join('')
      : '<div class="muted small">받은 모델이 없어요. 아래 검색에서 받으세요.</div>');
  $('localModels').querySelectorAll('.reco-card').forEach(c => c.addEventListener('click', () => pickRepo((c as HTMLElement).dataset.repo!)));
  $('localModels').querySelectorAll('.lm-use').forEach(b => b.addEventListener('click', async () => {
    if ((b as HTMLButtonElement).disabled) return;
    const p = decodeURIComponent((b as HTMLElement).dataset.path!);
    const nm = (b as HTMLElement).closest('.lm-row')?.querySelector('.lm-name')?.textContent || '';
    document.querySelectorAll('.lm-use').forEach(x => ((x as HTMLButtonElement).disabled = true));   // 중복 클릭 방지
    _localStatus = { ...(_localStatus || {}), loading: true, modelName: nm, running: false, error: '' }; await renderAiCurrent();   // 즉시 로딩 표시
    _localStatus = await connect.localStart?.(p);
    if (_localStatus?.running) await connect.setConfig({ llmBase: LOCAL_BASE, llmModel: _localStatus.modelName });   // 비서가 내장 엔진 쓰게
    await loadLocalAI(); await renderAiCurrent(); await loadModels(); refreshMem?.();
  }));
  $('localModels').querySelectorAll('.lm-del').forEach(b => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const el = b as HTMLElement; const p = decodeURIComponent(el.dataset.del!);
    const nm = el.dataset.nm || '모델', sz = el.dataset.sz || '', rm = el.dataset.rm === '1', src = el.dataset.src || '';
    const warn = rm ? '' : `\n\n⚠️ 이건 ${src || '외부(LM Studio 등)'} 모델이에요. 지우면 그쪽에서도 사라져요.`;
    if (!confirm(`'${nm}' (${sz}) 모델 파일을 삭제할까요?\n디스크에서 완전히 지워지고 되돌릴 수 없어요.${warn}`)) return;
    (el as HTMLButtonElement).disabled = true; el.textContent = '…';
    await connect.localDelete?.(p); await loadLocalAI();
  }));
}
$('hfSearchBtn')?.addEventListener('click', doHfSearch);
$('hfQuery')?.addEventListener('keydown', (e: any) => { if (e.key === 'Enter') doHfSearch(); });
async function doHfSearch() {
  const q = ($('hfQuery') as HTMLInputElement).value.trim();
  $('hfResults').innerHTML = '<div class="muted small">🔍 검색 중…</div>';
  const r = await connect.hfSearch?.(q);
  if (!r?.ok) { $('hfResults').innerHTML = `<div class="muted small">⚠️ ${r?.error || '검색 실패'}</div>`; return; }
  $('hfResults').innerHTML = (r.models || []).map((m: any) => {
    const slash = m.id.indexOf('/'); const org = slash > 0 ? m.id.slice(0, slash) : ''; const nm = slash > 0 ? m.id.slice(slash + 1) : m.id;
    const badges = `${m.params ? `<span class="hf-badge hf-param">${m.params}</span>` : ''}${m.vision ? `<span class="hf-badge hf-vis">👁 비전</span>` : ''}`;
    return `<div class="hf-row" data-repo="${escAttr(m.id)}" title="${escAttr(m.id)}${m.updated ? ' · 갱신 ' + fmtAgo(m.updated) : ''}">
      <div class="hf-main"><div class="hf-id">${escapeHtml(nm)}</div><div class="hf-org">${escapeHtml(org)}${m.updated ? ` · ${fmtAgo(m.updated)}` : ''}</div></div>
      <div class="hf-stats">${badges}<span class="muted small">⬇ ${fmtN(m.downloads)}</span><span class="muted small">♥ ${fmtN(m.likes)}</span></div>
    </div>`;
  }).join('') || '<div class="muted small">결과 없음</div>';
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
let _cpuNotified = false;
connect.onLocalStatus?.((s: any) => {
  _localStatus = s; renderLocalStatus(); renderAiCurrent(); if (!$('aiPanel').classList.contains('hidden')) loadParams();
  // 🖥️ CPU 모드로 처음 전환되면 사용자에게 한 번 안내 (왜 느린지 알 수 있게)
  if (s?.mode === 'cpu' && s?.running && !_cpuNotified) { _cpuNotified = true; hint('🖥️ 이 PC는 GPU 가속이 안 돼서 CPU 모드로 작동해요. 잘 켜졌지만 응답이 조금 느릴 수 있어요.'); }
  if (s?.mode === 'gpu') _cpuNotified = false;
});
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
// ✈️ 폰 결재 테스트 — 텔레그램으로 테스트 결재 푸시 → 폰에서 "보내기" 답장 → 실제 실행 한 바퀴 체험
$('aprTestBtn')?.addEventListener('click', async () => {
  const b = $('aprTestBtn'); b.setAttribute('disabled', ''); b.textContent = '✈️ 보내는 중…';
  const r = await connect.approvalsTest?.().catch(() => null);
  b.removeAttribute('disabled'); b.textContent = '✈️ 폰 결재 테스트';
  if (r?.ok) { renderApprovals(); addLog('✈️ 결재 테스트', '폰(텔레그램)으로 결재 요청을 보냈어요!\n\n📱 텔레그램을 열고 "보내기"라고 답장해보세요 — 승인되면 메시지가 실제로 발송됩니다.\n("수정 …" / "취소"도 됩니다)', false, false, '#00a0ff'); }
  else hint(r?.reason || '텔레그램 연동을 먼저 해주세요 (🗂️ 연동 → Telegram)');
});
const fmtN = (n: number) => Number(n || 0).toLocaleString();
const fmtAgo = (iso: string) => { const t = Date.parse(iso); if (!t) return ''; const d = Math.floor((Date.now() - t) / 86400000); if (d < 1) return '오늘'; if (d < 30) return d + '일 전'; if (d < 365) return Math.floor(d / 30) + '개월 전'; return Math.floor(d / 365) + '년 전'; };
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
  // (로스터는 🤖 내 AI 팀으로 이동 — 대시보드 중복 제거)
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
  { id: 'google-calendar', name: 'Google Calendar', icon: '📅', summary: '비서가 일정을 읽고 task 마감일과 자동 동기화합니다.', comingSoon: true, fields: [
    { key: 'GOOGLE_CALENDAR_ID', label: 'Calendar ID', type: 'text', placeholder: 'primary 또는 ...@group.calendar.google.com' } ] },
  { id: 'paypal', name: 'PayPal (매출 분석)', icon: '💰', summary: '결제 거래 분석. 💰 매출 대시보드 + 새 결제 알림에 사용.', helpUrl: 'https://developer.paypal.com/dashboard/applications', fields: [
    { key: 'PAYPAL_MODE', label: '모드', type: 'select', options: ['live', 'sandbox'], help: '실제 결제는 live, 테스트는 sandbox' },
    { key: 'PAYPAL_CLIENT_ID', label: 'Client ID', type: 'password' },
    { key: 'PAYPAL_CLIENT_SECRET', label: 'Client Secret', type: 'password' },
    { key: 'PAYPAL_LOOKBACK_DAYS', label: '분석 기간(일)', type: 'text', placeholder: '30 (최대 31)' },
    { key: 'PAYPAL_CURRENCY', label: '기본 통화(선택)', type: 'text', placeholder: 'USD' } ] },
  { id: 'github', name: 'GitHub — ⚡ 단기 기억', icon: '💻', summary: '지식 네트워크(단기 기억)를 GitHub 레포에 버전관리로 동기화. 어디서든 불러오고 사람이 직접 편집도.', helpUrl: 'https://github.com/settings/tokens', fields: [
    { key: 'GITHUB_TOKEN', label: 'Personal Access Token', type: 'password', help: 'github.com/settings/tokens → repo(Contents) 권한' },
    { key: 'GITHUB_DEFAULT_REPO', label: '지식 저장소', type: 'text', placeholder: 'owner/repo' } ] },
  { id: 'huggingface', name: 'HuggingFace — 🧬 장기 기억', icon: '🤗', summary: '쌓인 지식을 데이터셋으로 업로드 → 모델에 파인튜닝(체득). 학습된 모델을 회사 뇌로 사용.', helpUrl: 'https://huggingface.co/settings/tokens', fields: [
    { key: 'HF_TOKEN', label: 'Access Token (write)', type: 'password', help: 'huggingface.co/settings/tokens → write 권한' },
    { key: 'HF_REPO', label: '데이터셋 이름', type: 'text', placeholder: 'connect-ai-brain', help: '이름만 적으면 돼요 (아이디는 토큰에서 자동). HF에서 미리 안 만들어도 자동 생성.' } ] },
  { id: 'email', name: '이메일 (Gmail SMTP+IMAP)', icon: '📧', summary: '받은 메일을 읽고(IMAP) AI가 답장 초안 → 텔레그램으로 보낼까요? 승인하면 발송(SMTP). Gmail 앱 비밀번호 하나로 둘 다.', helpUrl: 'https://support.google.com/accounts/answer/185833', fields: [
    { key: 'SMTP_HOST', label: 'SMTP 호스트', type: 'text', placeholder: 'smtp.gmail.com' },
    { key: 'SMTP_PORT', label: '포트', type: 'text', placeholder: '465' },
    { key: 'SMTP_USER', label: '계정(이메일)', type: 'text', placeholder: 'me@gmail.com' },
    { key: 'SMTP_PASS', label: '앱 비밀번호', type: 'password', help: 'Gmail 2단계인증 후 myaccount.google.com/apppasswords 에서 발급(16자리). 이걸로 발송+수신 둘 다 돼요.' },
    { key: 'SMTP_FROM', label: '보내는 사람(선택)', type: 'text', placeholder: '내 이름 <me@gmail.com>' },
    { key: 'IMAP_HOST', label: '받기 IMAP 호스트(선택)', type: 'text', placeholder: 'imap.gmail.com (비우면 자동)' } ] },
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
        <div class="vo-plate">${a.emoji} ${escapeHtml(agName(id))}</div>
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
  officeSay(e.from, e.text);   // 🎭 회의 발언도 그 에이전트 목소리로
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
function startOfficeLife() { if (lifeTimer) return; syncOfficeVoiceBtn(); lifeTimer = window.setInterval(lifeTick, 2800); }
function officeLive() { if (!taskActive) $('officeStatus').textContent = '🟢 LIVE · 사무실 가동 중'; }

// 🎭 에이전트 음성 대화 — 각자 다른 목소리로(자비스 모드). 큐로 한 명씩 차례로 말한다(안 겹침).
let officeVoiceOn = false;
const officeVoiceQ: { id: string; text: string }[] = [];
let officeVoicePlaying = false;
async function pumpOfficeVoice() {
  if (officeVoicePlaying || !officeVoiceQ.length) return;
  officeVoicePlaying = true;
  const { id, text } = officeVoiceQ.shift()!;
  try {
    const r = await connect.ttsSpeakAgent?.(id, text);
    if (officeVoiceOn && r?.ok && r.dataUri) {
      // 말하는 동안 말풍선·아바타 강조
      const b = document.getElementById('vob-' + id); b?.classList.add('show', 'speech');
      await new Promise<void>((res) => { const a = new Audio(r.dataUri); a.onended = () => res(); a.onerror = () => res(); a.play().catch(() => res()); });
    }
  } catch { /* */ }
  officeVoicePlaying = false;
  pumpOfficeVoice();
}
function officeSay(id: string, text: string) {
  if (!officeVoiceOn || !text || !AGENTS[id]) return;
  if (officeVoiceQ.length > 2) officeVoiceQ.shift();   // 밀리면 옛 대사 버림 (라이브 느낌 유지)
  officeVoiceQ.push({ id, text: stripMd(text).slice(0, 120) });
  pumpOfficeVoice();
}
function syncOfficeVoiceBtn() {
  officeVoiceOn = !!cfg.officeVoice;
  const b = $('officeVoiceBtn'); if (b) { b.textContent = officeVoiceOn ? '🔊' : '🔇'; b.classList.toggle('on', officeVoiceOn); }
}
$('officeVoiceBtn')?.addEventListener('click', async () => {
  officeVoiceOn = !officeVoiceOn;
  cfg.officeVoice = officeVoiceOn;
  connect.setConfig?.({ officeVoice: officeVoiceOn });
  syncOfficeVoiceBtn();
  if (officeVoiceOn) officeSay('secretary', '음성 대화를 켰어요! 이제 저희끼리도 목소리로 이야기할게요, 사장님.');
  hint(officeVoiceOn ? '🎭 에이전트 음성 대화 켜짐 — 각자 다른 목소리로 말해요' : '🔇 음성 대화를 껐어요');
});

function lifeBubble(id: string, text: string, cls = 'speech') {
  const b = document.getElementById('vob-' + id); if (!b) return;
  b.textContent = text; b.classList.add('show', cls); b.classList.remove('typing');
  window.clearTimeout((b as any)._lt); (b as any)._lt = window.setTimeout(() => b.classList.remove('show', 'speech', 'ambient'), 2900);
  if (cls !== 'typing') officeSay(id, text);   // 🎭 말풍선이 뜨면 실제 목소리로도 (켜져 있을 때)
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

// 💬 진짜 AI 대화 풀 — 백엔드가 현황(매출·작전·방금 한 일) 반영해 생성. 비면 미리 박아둔 문구로 폴백.
let banterPool: { from: string; to: string; text: string }[] = [];
let banterFetching = false, banterLast = 0;
async function refillBanter() {
  if (banterFetching || banterPool.length > 2) return;
  if (Date.now() - banterLast < 25000) return;   // 최소 25초 간격(로컬 모델 보호)
  banterFetching = true; banterLast = Date.now();
  try { const r = await connect.officeBanter?.(); if (r?.ok && r.lines?.length) banterPool = r.lines; } catch { /* */ } finally { banterFetching = false; }
}
const nextBanter = (): { from: string; to: string; text: string } | null => {
  while (banterPool.length) { const b = banterPool.shift()!; if (AGENTS[b.from] && b.text) return b; }
  return null;
};
// 자율 행동 한 틱 — 잡담 / 어슬렁 / 감정표현
function lifeTick() {
  if (taskActive || !officeBuilt) return;
  if ($('officePanel').classList.contains('hidden')) return;   // 안 보면 쉬기(성능)
  officeLive();
  refillBanter();   // 풀 떨어지면 진짜 대화 새로 받아오기(백그라운드)
  const idle = AGENT_ORDER.filter(isIdle); if (idle.length < 1) return;
  const roll = Math.random();
  if (roll < 0.46) {                                           // 🗣️ 잡담 — 진짜 AI 대사 우선
    const bl = nextBanter();
    if (bl && isIdle(bl.from)) {
      const b = (bl.to && AGENTS[bl.to] && bl.to !== bl.from && isIdle(bl.to)) ? bl.to : pick(idle.filter(x => x !== bl.from));
      if (b) lifeSocialize(bl.from, b, bl.text); else lifeBubble(bl.from, bl.text, 'ambient');
    } else if (idle.length >= 2) {
      const a = pick(idle);
      const fr = FRIENDS.find(([x, y]) => (x === a || y === a))?.filter(z => z !== a)[0];
      const b = (fr && isIdle(fr)) ? fr : pick(idle.filter(x => x !== a));
      if (b) lifeSocialize(a, b);
    }
  } else if (roll < 0.74) {                                    // 🚶 어슬렁
    lifeWander(pick(idle));
  } else {                                                     // 💭 혼잣말/감정 — 진짜 대사 있으면 사용
    const bl = nextBanter(); const id = (bl && isIdle(bl.from)) ? bl.from : pick(idle);
    lifeBubble(id, (bl && id === bl.from) ? bl.text : pick(AMBIENT[id] || SMALLTALK), 'ambient');
  }
}
function lifeWander(id: string) {
  if (!isIdle(id)) return;
  const spot = pick(LIFE_SPOTS), home = VO_HOME[id] || VO_MEET;
  voMove(id, spot[0] + (Math.random() - 0.5) * 8, spot[1] + (Math.random() - 0.5) * 6);
  if (Math.random() < 0.5) setTimeout(() => lifeBubble(id, pick(AMBIENT[id] || SMALLTALK), 'ambient'), 600);
  window.setTimeout(() => { if (isIdle(id) && !taskActive) voHome(id); }, 2600 + Math.random() * 1600);
}
function lifeSocialize(a: string, b: string, realLine?: string) {
  if (!isIdle(a) || !isIdle(b)) return;
  const hb = VO_HOME[b] || VO_MEET, ha = VO_HOME[a] || VO_MEET;
  voMove(a, hb[0] + (hb[0] > 50 ? -8 : 8), hb[1] + 5);   // a가 b에게 다가감
  // 진짜 AI 대사 우선, 없으면 35%는 최근 사건 언급(기억), 나머지는 폴백 문구
  const la = realLine || ((officeMemory.length && Math.random() < 0.35) ? `${pick(REACT)}${pick(officeMemory)} 👏` : pick(SMALLTALK));
  const lb = pick([...SMALLTALK, ...(AMBIENT[b] || [])]);
  setTimeout(() => { if (taskActive) return; lifeBubble(a, la); feedAmbient(`<span class="cf-from" style="color:${AGENTS[a]?.color || '#9fe'}">${AGENTS[a]?.emoji || ''} ${esc(AGENTS[a]?.name || a)}</span><span class="cf-arrow">→</span><span class="cf-to">${AGENTS[b]?.emoji || ''} ${esc(AGENTS[b]?.name || b)}</span><span class="cf-txt">${esc(la)}</span>`); }, 750);
  setTimeout(() => { if (taskActive) return; lifeBubble(b, lb); }, 1700);
  window.setTimeout(() => { if (!taskActive) voMove(a, ha[0], ha[1]); }, 3100);
}

// 🏢 헤더 버튼 제거 — 사무실은 🤖 내 AI 팀 미리보기 클릭으로 엶 (버튼 수 줄이기)

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
// 🎬 그랜드 입장 — 사무실 열릴 때 에이전트가 한 명씩 "뿅" 하고 자리에 나타남
function grandEntrance() {
  $('officeStatus').textContent = '팀 출근 중…';
  AGENT_ORDER.forEach((id, i) => {
    const el = document.getElementById('vo-' + id); if (!el) return;
    el.style.opacity = '0'; el.classList.remove('vo-pop');
    setTimeout(() => {
      el.style.opacity = '1'; el.classList.add('vo-pop');
      const ring = document.createElement('div'); ring.className = 'vo-burst'; el.appendChild(ring);
      setTimeout(() => { try { ring.remove(); } catch { /* */ } }, 650);
      voSparks(id); officeSet(id, 'work');
      setTimeout(() => { el.classList.remove('vo-pop'); officeSet(id, 'idle'); }, 900);
      if (i === AGENT_ORDER.length - 1) setTimeout(() => { $('officeStatus').textContent = '전원 출근 · 운영 중'; officeLive(); }, 700);
    }, 240 * i + 120);
  });
}
// 🏢 운영 작업 로그 → 사무실 — 캐릭터 옆 피드에 실시간으로 흐르고, 일하는 에이전트가 움직인다
let _ofsFeedTs = 0;
const _ofsIdleTimers: Record<string, any> = {};
function officeOpsTick(s: any) {
  if (!s || !officeBuilt) return;
  if (s.executing && s.executingTitle) $('officeStatus').textContent = '⚡ 작전 수행 중 · ' + String(s.executingTitle).slice(0, 26);
  else if (s.phase === 'done' && s.running) $('officeStatus').textContent = '🏁 사이클 완료 — 다음 지시 대기';
  const fresh = (s.feed || []).filter((f: any) => f.ts > _ofsFeedTs).reverse();   // 옛 것부터 차례로
  for (const f of fresh) {
    _ofsFeedTs = Math.max(_ofsFeedTs, f.ts);
    const ag = AGENTS[f.agent];
    feedStory(f.icon || '🔧', ag?.name || f.agent, f.text || '', ag?.color);
    if (ag) {   // 그 에이전트가 일하는 모습 — 잠깐 work 모드 + 불꽃
      officeSet(f.agent, 'work'); voSparks(f.agent);
      window.clearTimeout(_ofsIdleTimers[f.agent]);
      _ofsIdleTimers[f.agent] = window.setTimeout(() => { if (!taskActive) officeSet(f.agent, 'idle'); }, 2600);
    }
  }
}
const OFFICE_MODE = new URLSearchParams(location.search).get('office') === '1';
if (OFFICE_MODE) {
  document.body.classList.add('office-only');
  buildOffice(); openOverlay('officePanel');
  requestAnimationFrame(() => grandEntrance());   // 🎬 입장 연출 후 자율 생활 시작
  connect.onEngineEvent?.(driveOfficeEvent);   // 메인에서 브로드캐스트되는 엔진 이벤트 수신
  connect.onOpsUpdate?.((s: any) => officeOpsTick(s));   // 🔗 운영 피드가 캐릭터 옆에서 흐름
}
$('officePop')?.addEventListener('click', () => connect.officeOpen?.());

// ── 💻 작업실 (파일 트리 + 코드 뷰어) ──────────────────────
let codeWs = '';
let codeCurrentFile = '';
const NEW_MS = 25000;
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
  playInjection(`${emoji[d.kind] || '🔌'} EZER AI 지식 스토어 → ${d.kind === 'knowledge' ? '두뇌' : '작업실'}`, [d.label || '브레인팩 주입'], (CAT_META[d.category] || CAT_META.general).color);
  if (d.kind !== 'knowledge') { showFiles(true); setTimeout(() => loadTree(true), 400); }   // 스킬/템플릿/디자인 = 파일 생김
  if (!$('brainPanel').classList.contains('hidden')) setTimeout(() => renderBrain(), 300);    // 두뇌 패널 열려있으면 실시간 갱신
});
// 시작: 파일 탐색기 상시 표시(트리 로드), 터미널은 접힌 상태(⌨️로 펴기)
showFiles(true);

// 👤 캐릭터 클릭 → 에이전트 상세
const PROFILE: Record<string, string> = { youtube: 'youtube.png', developer: 'developer.png', business: 'business.jpeg', editor: 'editor.png', secretary: 'secretary.jpeg' };
// 🪪 캐릭터 커스텀 — 사용자가 이름·사진을 직접 지정(없으면 기본값). [[project_my_ai_team_vision]]
function agName(id: string): string { return (cfg.agentNames || {})[id] || AGENTS[id]?.name || id; }
function agImgSrc(id: string): string { const c = (cfg.agentImages || {})[id]; if (c) return c; return PROFILE[id] ? `../../assets/agents/${PROFILE[id]}` : ''; }
// 업로드 사진 → 256px 다운스케일 데이터URL (config 가볍게 유지)
function downscaleImage(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)); const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const ctx = cv.getContext('2d');
      if (!ctx) return reject(new Error('canvas')); ctx.drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', 0.85));
    }; img.onerror = reject; img.src = String(fr.result); };
    fr.onerror = reject; fr.readAsDataURL(file);
  });
}
// 이름·사진 바꾸면 매트릭스·사무실 명패 즉시 반영
function refreshAgentVisuals(id: string) {
  try { if ($('teamRoster')) renderTeamRoster(); } catch { /* */ }
  const plate = document.querySelector(`#vo-${id} .vo-plate`); if (plate) plate.textContent = `${AGENTS[id]?.emoji || ''} ${agName(id)}`;
}

async function openAgentDetail(id: string) {
  const a = AGENTS[id]; if (!a) return;
  const img = agImgSrc(id);
  const avatar = img
    ? `<img class="ag-photo" src="${escAttr(img)}" alt="" />`
    : `<div class="ag-photo ag-photo-emoji" style="background:color-mix(in srgb,${a.color} 18%,#0a120c);border-color:${a.color}">${a.emoji}</div>`;
  $('agHeadName').textContent = `${a.emoji} ${agName(id)}`;
  const cur = (cfg.agentModels || {})[id] || '';
  // 후보 = 엔드포인트가 서빙하는 모델 + 받아둔 로컬 모델 전부(받았지만 안 켠 것도 배정 가능)
  const localNames = ((await connect.localModels?.()) || []).map((m: any) => m.name).filter(Boolean);
  const allModels = Array.from(new Set<string>([...MODELS_CACHE, ...localNames]));
  const opts = ['<option value="">⚙️ 자동 (공용 두뇌)</option>']
    .concat(allModels.map(m => `<option value="${esc(m)}"${m === cur ? ' selected' : ''}>${esc(m)}${/^gemini/i.test(m) ? ' ☁️' : (m === MODELS_LOADED ? ' ● 로드됨' : '')}</option>`)).join('');
  $('agentBody').innerHTML = `
    <div class="ag-detail" style="--ag:${a.color}">
      <div class="ag-photo-wrap">
        ${avatar}
        <button class="ag-photo-edit" id="agImgBtn" title="사진 바꾸기">📷</button>
        <input type="file" id="agImgFile" accept="image/*" hidden />
      </div>
      <div class="ag-meta">
        <input class="ag-name-edit" id="agNameEdit" value="${escAttr(agName(id))}" maxlength="20" placeholder="${escAttr(a.name)}" />
        <div class="ag-role">${esc(a.role)}</div>
        <div class="ag-spec">${esc((a as any).specialty || '')}</div>
      </div>
    </div>
    <div class="ag-model">
      <label>🧠 ${escapeHtml(agName(id))}의 두뇌 (AI 모델)</label>
      <select id="agModelSel">${opts}</select>
      <div class="ag-model-hint">학습한 <b>전용 모델</b>을 배정하세요 (예: 마케팅튜닝 → 비즈니스). 비우면 공용 모델 사용.</div>
    </div>
    <button class="ag-char-reset" id="agCharReset">이름·사진 기본값으로</button>`;
  // 이름 저장
  $('agNameEdit')?.addEventListener('change', async (e) => {
    const v = (e.target as HTMLInputElement).value.trim();
    const nm = { ...(cfg.agentNames || {}) }; if (v && v !== a.name) nm[id] = v; else delete nm[id];
    cfg = await connect.setConfig({ agentNames: nm });
    $('agHeadName').textContent = `${a.emoji} ${agName(id)}`; refreshAgentVisuals(id); hint(`${a.emoji} 이름 → ${agName(id)}`);
  });
  // 사진 바꾸기
  $('agImgBtn')?.addEventListener('click', () => ($('agImgFile') as HTMLInputElement)?.click());
  $('agImgFile')?.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    try { const data = await downscaleImage(f); const im = { ...(cfg.agentImages || {}) }; im[id] = data; cfg = await connect.setConfig({ agentImages: im }); openAgentDetail(id); refreshAgentVisuals(id); hint(`${a.emoji} 사진 바뀜`); }
    catch { hint('사진을 불러오지 못했어요'); }
  });
  // 두뇌(모델) 저장
  $('agModelSel')?.addEventListener('change', async (e) => {
    const v = (e.target as HTMLSelectElement).value;
    const am = { ...(cfg.agentModels || {}) }; if (v) am[id] = v; else delete am[id];
    cfg = await connect.setConfig({ agentModels: am });
    refreshAgentVisuals(id);
    hint(v ? `${a.emoji} ${agName(id)} → ${v}` : `${a.emoji} ${agName(id)} → 공용 모델`);
  });
  // 이름·사진 기본값으로
  $('agCharReset')?.addEventListener('click', async () => {
    const nm = { ...(cfg.agentNames || {}) }; delete nm[id];
    const im = { ...(cfg.agentImages || {}) }; delete im[id];
    cfg = await connect.setConfig({ agentNames: nm, agentImages: im });
    openAgentDetail(id); refreshAgentVisuals(id); hint(`${a.emoji} 기본값으로`);
  });
  openOverlay('agentPanel');
}
$('voffice').addEventListener('click', (e) => { const el = (e.target as HTMLElement).closest('.vo-agent'); if (el) openAgentDetail(el.id.replace('vo-', '')); });

// ── 🧠 지식 네트워크 (두뇌) ───────────────────────────
$('brainBtn').addEventListener('click', async () => { openOverlay('brainPanel'); await refreshMem(); await renderBridge(); await renderBrain(); renderMethods();
  try { const saved = localStorage.getItem('cloudCode'); const cc = $('cloudCode') as HTMLInputElement | null; if (saved && cc && !cc.value) cc.value = saved; } catch { /* */ }   // 🎟️ 저장된 멤버십 코드 자동 채움
});
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
  // 🚀 서버 학습은 HF 토큰 불필요 — 변환만 끝나면 ②(개인 HF 업로드) 없이 바로 학습 가능하게 ③을 풀어준다
  $('lfStep3').classList.remove('lf-locked');
  const cb = $('cloudTrainBtn') as HTMLButtonElement | null; if (cb) cb.disabled = false;
  const mnEl = $('modelNameInput') as HTMLInputElement | null;
  if (mnEl && mnEl.disabled) { mnEl.disabled = false; connect.brainModelName().then((nm: any) => { if (!mnEl.value) mnEl.value = nm.suggested; }); }
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
// 💎 유료 학습(클라우드 GPU) — 곧 출시. (AutoTrain 백엔드 train:autotrain 는 준비돼 있고, 출시 때 이 핸들러만 교체.)
$('hfExportBtn').addEventListener('click', async () => { $('hfStatus').textContent = '📦 바탕화면 connect-ai-brain.jsonl 확인 (변환 시 자동 저장)'; });

// 👤 회원 (Firebase Auth) — 이메일/비밀번호 로그인·회원가입
let _authMode: 'login' | 'signup' = 'login';
async function refreshAuthBtn() {
  const me = await connect.authCurrent?.();
  const b = $('authBtn'); const hb = $('hdrAuthBtn');   // 설정 안 버튼 + 헤더 버튼 둘 다 동기화
  if (b) { b.style.display = me?.configured ? '' : 'none'; b.textContent = me?.email ? `👤 ${me.email}` : '👤 회원 로그인'; b.title = me?.email ? `${me.email} — 회원 메뉴` : '회원 — 로그인/회원가입'; }
  if (hb) { hb.classList.toggle('on', !!me?.email); hb.textContent = me?.email ? '👤✓' : '👤'; hb.title = me?.email ? `${me.email} — 내 계정` : '로그인 / 회원가입'; }
}
async function openAuth() {
  openOverlay('authPanel');
  const me = await connect.authCurrent?.();
  const body = $('authBody'); if (!body) return;
  if (!me?.configured) { $('authTitle').textContent = '회원'; body.innerHTML = `<div class="muted small" style="line-height:1.6">회원 시스템이 아직 설정되지 않았어요. ⚙️ 설정 → 고급에 <b>회원 Firebase API Key</b>를 넣어주세요.</div>`; return; }
  if (me?.email) {
    $('authTitle').textContent = '내 계정';
    body.innerHTML = `<div class="auth-me"><div class="auth-ava">👤</div><div><div class="auth-email">${escapeHtml(me.email)}</div><div class="muted small">무료 회원 · 학습 월 1회</div></div></div><button class="cyc-btn ghost" id="authLogout" style="width:100%;margin-top:12px">로그아웃</button>`;
    $('authLogout')?.addEventListener('click', async () => { await connect.authLogout?.(); refreshAuthBtn(); openAuth(); hint('로그아웃했어요'); });
    return;
  }
  $('authTitle').textContent = _authMode === 'login' ? '로그인' : '회원가입';
  const signup = _authMode === 'signup';
  body.innerHTML = `
    ${signup ? `<input id="authName" class="auth-in" type="text" placeholder="이름" autocomplete="name" />
    <div class="auth-phone"><select id="authCc" class="auth-in" style="flex:0 0 96px">
      <option value="+82">🇰🇷 +82</option><option value="+1">🇺🇸 +1</option><option value="+81">🇯🇵 +81</option><option value="+86">🇨🇳 +86</option><option value="+44">🇬🇧 +44</option></select>
    <input id="authPhone" class="auth-in" type="tel" placeholder="전화번호 (숫자만)" autocomplete="tel" style="flex:1" /></div>` : ''}
    <input id="authEmail" class="auth-in" type="email" placeholder="이메일" autocomplete="username" />
    <input id="authPw" class="auth-in" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="${signup ? 'new-password' : 'current-password'}" />
    ${signup ? `<input id="authPw2" class="auth-in" type="password" placeholder="비밀번호 확인" autocomplete="new-password" />
    <div class="auth-agree">
      <label class="auth-chk"><input type="checkbox" id="agTerms" /> <span>[필수] <a id="lnkTerms">이용약관</a>에 동의합니다</span></label>
      <label class="auth-chk"><input type="checkbox" id="agPriv" /> <span>[필수] <a id="lnkPriv">개인정보 처리방침</a>에 동의합니다</span></label>
      <label class="auth-chk"><input type="checkbox" id="agMkt" /> <span>[선택] 마케팅·소식 수신에 동의합니다</span></label>
    </div>` : ''}
    <div class="auth-msg" id="authMsg"></div>
    <button class="cyc-btn primary" id="authGo" style="width:100%">${signup ? '회원가입' : '로그인'}</button>
    <div class="auth-switch">${signup ? '이미 회원? <a id="authToLogin">로그인</a>' : '계정이 없나요? <a id="authToSignup">회원가입</a>'}</div>`;
  $('authToSignup')?.addEventListener('click', () => { _authMode = 'signup'; openAuth(); });
  $('authToLogin')?.addEventListener('click', () => { _authMode = 'login'; openAuth(); });
  $('lnkTerms')?.addEventListener('click', () => connect.openExternal?.('https://aicitybuilders.com/terms'));
  $('lnkPriv')?.addEventListener('click', () => connect.openExternal?.('https://aicitybuilders.com/privacy'));
  const go = async () => {
    const email = ($('authEmail') as HTMLInputElement).value.trim(); const pw = ($('authPw') as HTMLInputElement).value;
    const msg = (t: string) => { $('authMsg').textContent = t; };
    if (signup) {
      const name = ($('authName') as HTMLInputElement).value.trim();
      const phone = ($('authPhone') as HTMLInputElement).value.replace(/[^0-9]/g, '');
      const cc = ($('authCc') as HTMLSelectElement).value;
      const pw2 = ($('authPw2') as HTMLInputElement).value;
      if (name.length < 2) return msg('이름을 입력하세요 (2자 이상).');
      if (!/\S+@\S+\.\S+/.test(email)) return msg('올바른 이메일을 입력하세요.');
      if (phone.length < 8) return msg('올바른 전화번호를 입력하세요.');
      if (pw.length < 6) return msg('비밀번호는 6자 이상이어야 해요.');
      if (pw !== pw2) return msg('비밀번호가 일치하지 않아요.');
      if (!($('agTerms') as HTMLInputElement).checked) return msg('이용약관 동의가 필요해요.');
      if (!($('agPriv') as HTMLInputElement).checked) return msg('개인정보 처리방침 동의가 필요해요.');
      const btn = $('authGo') as HTMLButtonElement; btn.disabled = true; btn.textContent = '처리 중…';
      const r = await connect.authSignup?.(email, pw, { name, phone: cc + phone, marketing: ($('agMkt') as HTMLInputElement).checked });
      btn.disabled = false; btn.textContent = '회원가입';
      if (r?.ok) { refreshAuthBtn(); hint('🎉 가입 완료! 환영합니다'); openAuth(); } else msg('⚠️ ' + (r?.error || '실패'));
      return;
    }
    if (!email || !pw) return msg('이메일과 비밀번호를 입력하세요.');
    const btn = $('authGo') as HTMLButtonElement; btn.disabled = true; btn.textContent = '처리 중…';
    const r = await connect.authLogin?.(email, pw);
    btn.disabled = false; btn.textContent = '로그인';
    if (r?.ok) { refreshAuthBtn(); hint('✅ 로그인됨'); openAuth(); } else msg('⚠️ ' + (r?.error || '실패'));
  };
  $('authGo')?.addEventListener('click', go);
  $('authPw')?.addEventListener('keydown', (e: any) => { if (e.key === 'Enter' && !signup) go(); });
}
$('authBtn')?.addEventListener('click', openAuth);
$('hdrAuthBtn')?.addEventListener('click', openAuth);   // 🔝 헤더 로그인/회원 진입점
refreshAuthBtn();

// ☁️ 내 AI 키우기 — 코랩 없이 HF Jobs로 학습 (무료 월 1회)
let cloudPoll = 0;
function cloudStat(html: string) { const el = $('cloudTrainStatus'); if (!el) return; el.style.display = 'block'; el.innerHTML = html; }
$('cloudTrainBtn')?.addEventListener('click', async () => {
  const btn = $('cloudTrainBtn') as HTMLButtonElement; btn.disabled = true;
  cloudStat('<span class="cyc-spin"></span> 두뇌 변환 · 데이터셋 업로드 · GPU 작업 요청 중…');
  let r: any = null;
  const code = (($('cloudCode') as HTMLInputElement)?.value || '').trim();
  if (!code) { btn.disabled = false; cloudStat('🎟️ 멤버십 코드를 입력하세요. <a href="#" id="acbLink">AI CITY BUILDERS</a> 멤버에게 공유된 코드예요.'); $('acbLink')?.addEventListener('click', (e) => { e.preventDefault(); connect.openExternal?.('https://aicitybuilders.com'); }); return; }
  try { r = await connect.trainCloud?.(code); } catch (e: any) { r = { ok: false, error: String(e?.message || e) }; }
  btn.disabled = false;
  if (!r) { cloudStat('⚠️ 응답이 없어요.'); return; }
  if (r.badCode) { cloudStat(`🎟️ ${escapeHtml(r.error || '멤버십 코드가 틀렸어요')}`); return; }
  if (!localStorage) { /* noop */ }
  else if (r.ok || r.gated || r.needLogin) { try { localStorage.setItem('cloudCode', code); } catch { /* */ } }   // 통과한 코드 기억(재입력 방지)
  if (r.ok && r.jobId) {
    cloudStat(`🚀 학습 시작! <a href="${escAttr(r.url || r.modelRepo)}" target="_blank">진행상황 보기</a><br><span class="muted small">완료되면 "내 모델로 받기"가 떠요. (보통 15~40분)</span>`);
    if (cloudPoll) clearInterval(cloudPoll);
    cloudPoll = window.setInterval(async () => {
      const s = await connect.trainCloudStatus?.(); if (!s?.ok) return;
      if (/COMPLETED|SUCCESS/i.test(s.stage)) { clearInterval(cloudPoll); cloudStat(`✅ 학습 완료! <button id="cloudInstallBtn" class="oc-primary">⬇️ 내 모델로 받기</button>`); wireCloudInstall(); }
      else if (/ERROR|FAIL/i.test(s.stage)) { clearInterval(cloudPoll); cloudStat(`⚠️ 학습 실패: ${escapeHtml(s.message || s.stage)} · <a href="${escAttr(s.jobUrl)}" target="_blank">로그</a>`); }
      else cloudStat(`⏳ 학습 중… (${escapeHtml(s.stage)}) · <a href="${escAttr(s.jobUrl)}" target="_blank">진행상황</a>`);
    }, 20000);
  } else if (r.needLogin) {
    cloudStat(`🔑 ${escapeHtml(r.error || '로그인이 필요해요')} — 가입은 무료예요.`); openAuth();
  } else if (r.gated) {
    cloudStat(`🗓️ ${escapeHtml(r.error)}`);
  } else {
    // REST 자동실행 실패(Pro 필요 등) → 확실한 폴백 명령 제공
    const cmd = r.command ? `<div class="muted small" style="margin-top:6px">아래 명령을 터미널에서 실행하면 됩니다 (hf CLI):</div><pre class="cmd-box">${escapeHtml(r.command)}</pre>` : '';
    cloudStat(`⚠️ ${escapeHtml(r.error || '자동 실행 실패')}${cmd}`);
  }
});
function wireCloudInstall() {
  $('cloudInstallBtn')?.addEventListener('click', async () => {
    const b = $('cloudInstallBtn') as HTMLButtonElement; b.disabled = true; b.textContent = '받는 중…';
    const r = await connect.trainCloudInstall?.();
    if (r?.ok) { cloudStat(`🎉 받았어요! 🤖 내 AI 팀에서 "${escapeHtml(r.model || '내 모델')}"을 선택해 쓰세요.`); loadLocalAI?.(); }
    else cloudStat(`⚠️ ${escapeHtml(r?.error || '받기 실패')}`);
  });
}

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
    : '<div class="muted" style="text-align:center;padding:14px">아직 지식이 없어요. ⬇ GitHub 불러오기, 🧠 EZER AI 지식 스토어에서 주입, 또는 대화 중 에이전트가 자동으로 쌓아요.</div>';
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
  if (b.state === 'listening') { el.className = 'bridge-row on'; el.innerHTML = `🧠 EZER AI 지식 스토어 <b>연결됨</b> (:${b.port}) — 스토어에서 [주입] 누르면 에이전트 두뇌로 들어와요`; }
  else if (b.state === 'yielded') { el.className = 'bridge-row warn'; el.innerHTML = `⚠️ 포트 ${b.port}를 <b>${escapeHtml(b.heldBy || '다른 앱')}</b>이 점유 중 — 지식 스토어 주입이 그쪽으로 가요. 데스크탑으로 받으려면 그 앱(익스텐션)을 끄세요`; }
  else { el.className = 'bridge-row'; el.innerHTML = `🧠 EZER AI 지식 스토어 대기 중 (:${b.port})`; }
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
// 🛡️ 광장 열 때 관리자(선생님) 여부 반영 — 주제 등록·수확은 관리자만, 일반 유저는 주제 보고 참여만
async function openPlaza() {
  openOverlay('plazaPanel'); ensurePlazaStream();
  const admin = await connect.plazaIsAdmin?.().catch(() => false);
  const dock = document.querySelector('.pw-dock') as HTMLElement | null;
  dock?.classList.toggle('admin', !!admin);
  // 일반 유저: 주제 입력·수확 숨기고 "현재 주제 보고 참여" 안내
  const ti = $('topicInput') as HTMLInputElement | null, tb = $('topicBtn'), gb = $('gradeBtn');
  if (admin) {
    if (ti) { ti.style.display = ''; ti.placeholder = '🧑‍🏫 [선생님] 토론 주제를 등록하면 모든 에이전트가 토론해요'; }
    tb?.classList.remove('hidden'); gb?.classList.remove('hidden');
    $('pwLabBtn')?.classList.remove('hidden');   // 🧪 실험실 버튼 (관리자만)
  } else {
    if (ti) ti.style.display = 'none';
    tb?.classList.add('hidden'); gb?.classList.add('hidden');
    $('pwLabBtn')?.classList.add('hidden');
  }
}
// 🧪 에이전트 실험실 — 페르소나 선택 + N마리 소환 + 토론 관찰
let labSelected = new Set<string>();
let labRunning = false;
async function openLab() {
  $('pwLab')?.classList.remove('hidden');
  const grid = $('pwLabPersonas'); if (!grid) return;
  if (!grid.children.length) {   // 페르소나 카드 1회 렌더
    const personas = await connect.plazaLabPersonas?.().catch(() => []) || [];
    grid.innerHTML = (personas as any[]).map(p =>
      `<button class="pw-persona" data-key="${escAttr(p.key)}" title="${escAttr(p.trait)}"><span class="pp-e">${p.emoji}</span><span class="pp-n">${escapeHtml(p.name)}</span></button>`).join('');
    grid.querySelectorAll('.pw-persona').forEach(el => el.addEventListener('click', () => {
      const k = (el as HTMLElement).dataset.key!;
      if (labSelected.has(k)) { labSelected.delete(k); el.classList.remove('on'); }
      else { labSelected.add(k); el.classList.add('on'); }
    }));
  }
}
$('pwLabBtn')?.addEventListener('click', openLab);
$('pwLabClose')?.addEventListener('click', () => $('pwLab')?.classList.add('hidden'));
$('pwLabRange')?.addEventListener('input', (e: any) => { $('pwLabNum').textContent = e.target.value; });
$('pwLabSpawn')?.addEventListener('click', async () => {
  if (!plazaJoined) { hint('먼저 🏫 광장 입장부터 하세요'); return; }
  const count = parseInt(($('pwLabRange') as HTMLInputElement).value, 10);
  const keys = labSelected.size ? [...labSelected] : undefined;   // 선택 없으면 count만큼 자동
  const btn = $('pwLabSpawn') as HTMLButtonElement; btn.disabled = true; btn.textContent = '소환 중…';
  const r = await connect.plazaLab?.({ count, keys });
  btn.disabled = false; btn.textContent = '🚀 실험 시작';
  if (!r?.ok) { hint('실험 실패: ' + (r?.error || '')); return; }
  labRunning = true;
  $('pwLabStopBtn')?.classList.remove('hidden'); btn.classList.add('hidden');
  const world = $('plazaWorld'); if (world) pwToast(world, `🧪 실험 에이전트 ${r.spawned.length}마리 소환! 주제를 던져보세요`);
  hint(`🧪 소환: ${r.spawned.map((s: any) => s.emoji + s.name).join(' ')}`);
});
$('pwLabStopBtn')?.addEventListener('click', async () => {
  await connect.plazaLabStop?.();
  labRunning = false;
  $('pwLabStopBtn')?.classList.add('hidden'); $('pwLabSpawn')?.classList.remove('hidden');
  const world = $('plazaWorld'); if (world) pwToast(world, '⏹ 실험 종료 — 에이전트들이 퇴장했어요');
});
$('plazaBtn')?.addEventListener('click', openPlaza);
$('hdrPlazaBtn')?.addEventListener('click', openPlaza);   // 🏫 헤더 광장 진입

// ── 광장 ─────────────────────────────────────────────
let plazaJoined = false, plazaES: EventSource | null = null, plazaMsgs: Record<string, any> = {};
let plazaPresES: EventSource | null = null, plazaPeople: Record<string, any> = {};
async function plazaToggleFn() {
  if (!plazaJoined) {
    await saveNameTag().catch(() => {});   // 입력 직후 바로 입장해도 명찰(이모지·회사·이름) 확실히 반영
    const r = await connect.plazaEnter();
    if (!r?.ok) { hint('입장 실패: ' + (r?.reason || '설정에서 광장 DB URL 확인')); return; }
    (window as any)._myPlazaUid = r.uid || '';   // 🌐 내 캐릭터 식별 (게임 월드에서 "나" 표시)
    plazaJoined = true; $('plazaWorld')?.classList.add('joined'); $('pwLeaveBtn')?.classList.remove('hidden'); $('plazaStatus').textContent = '🟢 입장 중'; ensurePlazaStream();
    // ⚡ 내 캐릭터 즉시 등장 — RTDB 폴링(5초)을 기다리지 않고 바로 렌더 (첫 입장에 안 보이던 버그 수정)
    if (r.uid) {
      const myEmoji = (($('plazaEmoji') as HTMLInputElement)?.value || cfg.plazaEmoji || '🖥️').trim();
      const myCompany = (($('plazaCompany') as HTMLInputElement)?.value || cfg.company || '내 회사').trim();
      plazaPeople[r.uid] = { uid: r.uid, company: myCompany, emoji: myEmoji, agents: [], source: 'connect-ai', ts: Date.now() };
      renderDesks();
    }
  } else {
    await connect.plazaLeave(); plazaJoined = false;
    $('plazaWorld')?.classList.remove('joined'); $('pwLeaveBtn')?.classList.add('hidden');
    $('plazaStatus').textContent = '대기 중';
    // 🧹 퇴장 시 캐릭터·상태 정리 (잔재가 환영카드 뒤에 남지 않게)
    for (const uid of Object.keys(pwActors)) { pwActors[uid].el?.remove(); delete pwActors[uid]; }
    for (const uid of Object.keys(plazaPeople)) delete plazaPeople[uid];
    (window as any)._myPlazaUid = ''; (window as any)._mineActor = null;
  }
}
$('plazaToggle')?.addEventListener('click', plazaToggleFn);
$('pwLeaveBtn')?.addEventListener('click', plazaToggleFn);   // HUD 퇴장 = 입장토글 같은 함수
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

// 🌐🎮 포켓몬st 광장 — 진짜 픽셀 캐릭터가 잔디 타일맵을 또각또각 걸어다닌다.
//   각 회사 = 48×96 스프라이트 캐릭터(걷기 4방향×6프레임). 자율로 배회하다 서로 만나면 멈춰 대화.
const PLAZA_SPRITES = ['secretary', 'youtube', 'developer', 'business', 'designer', 'writer', 'researcher', 'editor', 'instagram', 'ceo'];
interface PwActor { uid: string; company: string; emoji: string; sprite: string; x: number; y: number; tx: number; ty: number; dir: string; moving: boolean; mine: boolean; pauseT: number; el?: HTMLElement; charEl?: HTMLElement; _dirty?: boolean; _met?: boolean; }
let pwMeetBudget = 0;   // 대규모일 때 이펙트(토스트·대화) 폭주 방지 — 프레임당 제한
// ❗ 만남 감지 (공간 해싱) — 가까운 셀끼리만 비교해 O(n²) 회피
function pwDetectMeet(arr: PwActor[], many: boolean) {
  const CELL = 12; const grid: Record<string, PwActor[]> = {};
  for (const a of arr) { const k = `${(a.x / CELL) | 0},${(a.y / CELL) | 0}`; (grid[k] ||= []).push(a); }
  pwMeetBudget = many ? 2 : 99;   // 대규모면 프레임당 최대 2쌍만 연출
  for (const a of arr) {
    const cx = (a.x / CELL) | 0, cy = (a.y / CELL) | 0;
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      const cell = grid[`${gx},${gy}`]; if (!cell) continue;
      for (const b of cell) {
        if (b.uid <= a.uid) continue;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 8 && !a._met && !b._met) {
          a._met = b._met = true;
          a.pauseT = 70; b.pauseT = 70; a.dir = a.x > b.x ? 'left' : 'right'; b.dir = b.x > a.x ? 'left' : 'right';
          if (pwMeetBudget-- > 0) { pwMeetFx(a); pwMeetFx(b); pwEncounter(a, b); }   // 연출은 예산 내에서만
          else { pwDexAdd(a); pwDexAdd(b); }   // 예산 초과여도 도감은 조용히 수집
        } else if (dist > 15) { a._met = b._met = false; }
      }
    }
  }
}
const pwActors: Record<string, PwActor> = {};
let pwRaf = 0, pwFrame = 0;
const myPlazaUid = () => (window as any)._myPlazaUid || '';
const hashIdx = (s: string, n: number) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % n; };
// 🚧 장애물 박스 [x1,y1,x2,y2] (%) — plaza-bg.png 기준 (연못·카페·도서관·가장자리 나무숲). 캐릭터 발이 못 들어감.
const PW_OBSTACLES: [number, number, number, number][] = [
  [11, 40, 35, 67],   // 💧 연못
  [50, 4, 70, 42],    // ☕ 카페 건물
  [72, 2, 94, 40],    // 📚 도서관 건물
  [0, 0, 100, 16],    // 상단 나무 테두리
  [0, 0, 9, 100],     // 좌측 나무
  [91, 40, 100, 100], // 우하단 나무
];
const pwBlocked = (x: number, y: number) => PW_OBSTACLES.some(([x1, y1, x2, y2]) => x > x1 && x < x2 && y > y1 && y < y2);
// 걸을 수 있는 목적지 뽑기 (장애물 밖, 화면 안)
function pwWalkable(): [number, number] {
  for (let k = 0; k < 20; k++) { const x = 12 + Math.random() * 76, y = 44 + Math.random() * 48; if (!pwBlocked(x, y)) return [x, y]; }
  return [50, 80];   // 폴백: 하단 중앙 잔디
}
function pwEnsureLoop() {
  if (pwRaf) return;
  const PT = 48, PCH = 96;   // 스프라이트 셀 (사무실과 동일)
  const tick = () => {
    pwFrame++;
    const arr = Object.values(pwActors);
    const many = arr.length > 40;   // 🚦 대규모 모드 — 100명+일 때 이동·애니 빈도 줄여 60fps 유지
    const animDiv = many ? 2 : 1;   // 프레임 절반만 업데이트
    for (const a of arr) {
      // 이동 (장애물 회피 — 막히면 그 축으로 슬라이드)
      const dx = a.tx - a.x, dy = a.ty - a.y; const d = Math.hypot(dx, dy);
      if (a.pauseT > 0) { a.pauseT--; a.moving = false; }
      else if (d > 0.6) {
        const sp = Math.min(0.42, 0.18 + d * 0.04) * animDiv;
        const nx = a.x + dx / d * sp, ny = a.y + dy / d * sp;
        let moved = false;
        if (!pwBlocked(nx, ny)) { a.x = nx; a.y = ny; moved = true; }
        else if (!pwBlocked(nx, a.y)) { a.x = nx; moved = true; }
        else if (!pwBlocked(a.x, ny)) { a.y = ny; moved = true; }
        if (moved) { a.moving = true; a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); }
        else { const [wx, wy] = pwWalkable(); a.tx = wx; a.ty = wy; a.moving = false; }
      } else { a.moving = false; }
      // DOM 쓰기 — 부모(plaza-world) 기준 left/top %. 변화 없으면 skip
      if (a.el && (a.moving || a._dirty)) {
        a._dirty = a.moving;
        a.el.style.left = a.x + '%'; a.el.style.top = a.y + '%';
        a.el.style.zIndex = String(100 + (a.y | 0));
      }
      // 스프라이트 프레임 — 대규모면 격프레임만
      if (a.charEl && (pwFrame % animDiv === 0)) {
        const col = a.dir === 'left' ? 6 : a.dir === 'right' ? 12 : a.dir === 'up' ? 18 : 0;
        const row = a.moving ? 2 : 1;
        const fi = ((pwFrame / (a.moving ? 7 : 16)) | 0) % 6;
        a.charEl.style.backgroundPosition = `-${(col + fi) * PT}px -${row * PCH}px`;
      }
    }
    // ❗ 만남 감지 — 공간 그리드로 O(n²)→근접쌍만. 대규모면 16프레임마다·이펙트 throttle
    if (pwFrame % (many ? 16 : 8) === 0) pwDetectMeet(arr, many);
    pwRaf = requestAnimationFrame(tick);
  };
  pwRaf = requestAnimationFrame(tick);
  // 🚶 자율 배회 — 2초마다 한 명이 새 목적지 (서로 가까운 곳으로 가서 만나기도)
  if (!(window as any)._pwWander) (window as any)._pwWander = window.setInterval(() => {
    const arr = Object.values(pwActors); if (arr.length < 1) return;
    const a = pick(arr); if (!a || a.pauseT > 0) return;
    if (arr.length > 1 && Math.random() < 0.45) {            // 45% 확률로 다른 캐릭터 옆으로 (만나서 대화)
      const t = pick(arr.filter(x => x.uid !== a.uid));
      let nx = t.x + (Math.random() < .5 ? 7 : -7), ny = t.y + 3;
      if (pwBlocked(nx, ny)) { const [wx, wy] = pwWalkable(); nx = wx; ny = wy; }   // 옆자리가 막혀있으면 잔디로
      a.tx = nx; a.ty = ny;
    } else { const [wx, wy] = pwWalkable(); a.tx = wx; a.ty = wy; }   // 랜덤 산책 (장애물 밖)
  }, 2000);
}
// 🌳 맵 데코 한 번 깔기 (나무·연못·꽃) — 고정 위치
function pwBuildDeco(_world: HTMLElement) {
  // 🖼️ 배경 이미지(plaza-bg.png)에 나무·연못·카페·도서관이 이미 그려져 있어 CSS 데코는 생략
}
function pwToast(world: HTMLElement, text: string) {
  const t = document.createElement('div'); t.className = 'pw-toast'; t.textContent = text; world.appendChild(t);
  setTimeout(() => { try { t.remove(); } catch { /* */ } }, 2700);
}
function pwMeetFx(a: PwActor) {
  if (!a.el) return; const m = document.createElement('div'); m.className = 'pw-meet'; m.textContent = '❗'; m.style.left = '50%'; m.style.top = '0'; a.el.appendChild(m);
  setTimeout(() => { try { m.remove(); } catch { /* */ } }, 900);
}
// 🤖 실험·데모·테스트 봇 uid 패턴 (진짜 사람 에이전트와 구별)
const isBotUid = (uid: string) => /^(lab-|friend-bot|test-|demo)/.test(uid || '');
function renderDesks() {
  const now = Date.now();
  const list = Object.values(plazaPeople).filter((p: any) => p && now - p.ts < 60000).sort((a: any, b: any) => a.ts - b.ts);
  // 🌍 라이브 현장감 — 진짜 사람 N명 · 실험 M마리 구분 표시
  const realN = list.filter((p: any) => !isBotUid(p.uid)).length;
  const botN = list.length - realN;
  $('plazaStatus').innerHTML = list.length
    ? `🟢 <b>${list.length}</b>명 접속 중${realN > 1 ? ` <span style="opacity:.8">· 👤 실제 ${realN}</span>` : ''}${botN ? ` <span style="opacity:.7">· 🧪 ${botN}</span>` : ''}`
    : '대기 중';
  const world = $('plazaWorld'); if (!world) return;
  // 입장 카드(명찰·입장버튼)는 "내가 입장했는지"로만 숨김 — 남들이 있어도 내가 입장 전이면 보여야 함
  world.classList.toggle('joined', plazaJoined);
  pwBuildDeco(world);
  const seen = new Set<string>();
  const mine = myPlazaUid();
  const frag = document.createDocumentFragment();   // 100명도 reflow 한 번에
  let newCount = 0;
  list.forEach((p: any, i: number) => {
    seen.add(p.uid);
    let a = pwActors[p.uid];
    if (!a) {
      newCount++;
      const isMine = p.uid === mine;
      const isReal = !isBotUid(p.uid);   // 진짜 사람의 에이전트
      const sprite = isMine ? (cfg.agentSprite || 'secretary') : PLAZA_SPRITES[hashIdx(p.uid, PLAZA_SPRITES.length)];
      const [wx, wy] = pwWalkable();
      a = pwActors[p.uid] = { uid: p.uid, company: p.company, emoji: p.emoji || '🤖', sprite, x: 48 + (i % 5) * 1.5, y: 96, tx: wx, ty: wy, dir: 'up', moving: false, mine: isMine, pauseT: 0, _dirty: true };
      const el = document.createElement('div');
      el.className = 'pw-actor' + (isMine ? ' mine' : '') + (isReal && !isMine ? ' real' : '');
      el.id = 'pw-' + p.uid;
      el.style.left = a.x + '%'; el.style.top = a.y + '%';
      el.innerHTML = `<div class="pw-bubble" id="pwb-${escAttr(p.uid)}"></div>` +
        (isMine ? '<div class="pw-portal"></div>' : '') +   // ✨ 내 입장 포탈 연출
        `<div class="pw-char" style="background-image:url('${SPRITE(sprite)}')"></div>` +
        `<div class="pw-name">${isReal && !isMine ? '⭐ ' : ''}${p.emoji || ''} ${escapeHtml(p.company || '익명')}${isMine ? ' <b>(나)</b>' : ''}</div>`;
      frag.appendChild(el); a.el = el; a.charEl = el.querySelector('.pw-char') as HTMLElement;
      el.classList.add('pw-spawn'); setTimeout(() => el.classList.remove('pw-spawn'), 900);
      el.addEventListener('click', () => { pwBubble(a!, `안녕! 우리는 ${p.company}예요 ${(p.agents || []).join('') || '🤖'}`); });
      if (isMine) { (window as any)._mineActor = a; const w2 = $('plazaWorld'); if (w2) pwToast(w2, '✨ 광장에 입장했어요!'); }
      else if (isReal) { const w2 = $('plazaWorld'); if (w2) pwToast(w2, `🌍 실제 유저 등장! ${p.emoji || ''} ${p.company}`); }   // 진짜 사람 = 특별 강조
    }
    a.company = p.company; a.emoji = p.emoji || a.emoji;
  });
  if (frag.childNodes.length) world.appendChild(frag);
  // 🎬 등장 토스트 — 소수면 회사명, 대규모면 "N명 우르르 입장!"
  if (newCount > 0 && list.length > 1) {
    if (newCount <= 2) { for (const p of list.slice(-newCount)) { if (p.uid !== mine) pwToast(world, `✨ ${p.company} 입장!`); } }
    else pwToast(world, `🎉 ${newCount}명이 우르르 입장! (총 ${list.length}명)`);
  }
  for (const uid of Object.keys(pwActors)) { if (!seen.has(uid)) { pwActors[uid].el?.remove(); delete pwActors[uid]; } }
  if (list.length) pwEnsureLoop();
}
function pwBubble(a: PwActor, text: string) {
  const b = document.getElementById('pwb-' + a.uid);
  if (b) { b.textContent = text.slice(0, 70); b.classList.add('show'); window.clearTimeout((b as any)._t); (b as any)._t = window.setTimeout(() => b.classList.remove('show'), 4500); }
}
// 💬 만남 미니 대화 — 두 캐릭터가 만나면 짧은 인사를 주고받는다 (도감도 수집)
const PW_GREET = ['안녕하세요! 👋', '오, 반가워요!', '어떤 일 하세요?', '같이 공부해요!', '오늘 주제 봤어요?', '협업할래요?', '멋진 회사네요!', '저희도 1인 기업이에요', '좋은 아이디어 있어요?', '화이팅! 🔥'];
let pwTalkCooldown: Record<string, number> = {};
function pwEncounter(a: PwActor, b: PwActor) {
  pwDexAdd(a); pwDexAdd(b);   // 📕 도감 수집 (다른 회사만 실제 기록됨)
  const key = a.uid < b.uid ? a.uid + '|' + b.uid : b.uid + '|' + a.uid;
  const now = Date.now();
  if ((pwTalkCooldown[key] || 0) > now) return;
  pwTalkCooldown[key] = now + 12000;
  // 메모리 정리 — 쿨다운 맵이 100명에서 비대해지지 않게 만료분 청소
  if (Math.random() < 0.05) { for (const k in pwTalkCooldown) if (pwTalkCooldown[k] < now) delete pwTalkCooldown[k]; }
  setTimeout(() => pwBubble(a, pick(PW_GREET)), 200);
  setTimeout(() => pwBubble(b, pick(PW_GREET)), 1500);
}
// 📕 에이전트 도감 — 만난 회사 수집
const pwDex = new Set<string>(JSON.parse(localStorage.getItem('pwDex') || '[]'));
const pwDexMeta: Record<string, { emoji: string; sprite: string }> = JSON.parse(localStorage.getItem('pwDexMeta') || '{}');
function pwDexAdd(a: PwActor) {
  if (a.mine || pwDex.has(a.company)) return;
  pwDex.add(a.company); pwDexMeta[a.company] = { emoji: a.emoji, sprite: a.sprite };
  try { localStorage.setItem('pwDex', JSON.stringify([...pwDex])); localStorage.setItem('pwDexMeta', JSON.stringify(pwDexMeta)); } catch { /* */ }
  pwToastWorld(`📕 도감 등록! ${a.emoji} ${a.company} (${pwDex.size}개째)`);
  renderDex();
}
function pwToastWorld(text: string) { const w = $('plazaWorld'); if (w) pwToast(w, text); }
function renderDex() {
  const el = $('pwDexCount'); if (el) el.textContent = `📕 ${pwDex.size}`;
  const grid = $('pwDexGrid'); if (!grid) return;
  grid.innerHTML = [...pwDex].map(co => { const m = pwDexMeta[co] || { emoji: '🤖' }; return `<div class="dex-card" title="${escAttr(co)}"><div class="dex-e">${m.emoji}</div><div class="dex-n">${escapeHtml(co)}</div></div>`; }).join('') || '<div class="muted small" style="padding:10px">아직 만난 회사가 없어요 — 광장에서 다른 에이전트와 마주치면 등록돼요!</div>';
}
// 누군가 말하면 그 캐릭터가 멈춰서 말풍선 + 가까운 상대에게 다가가 마주봄
function pwTalk(uid: string, company: string, text: string) {
  const a = Object.values(pwActors).find(x => x.uid === uid) || Object.values(pwActors).find(x => x.company === company);
  if (!a) return;
  pwBubble(a, text);
  a.pauseT = 90;   // 말하는 동안 잠시 멈춤(자연스럽게)
  const others = Object.values(pwActors).filter(x => x.uid !== a.uid);
  if (others.length) { const t = pick(others); let nx = t.x + (a.x > t.x ? 8 : -8), ny = t.y + 3; if (pwBlocked(nx, ny)) { const [wx, wy] = pwWalkable(); nx = wx; ny = wy; } a.tx = nx; a.ty = ny; a.pauseT = 0;
    a.dir = a.x > t.x ? 'left' : 'right'; t.pauseT = 60; t.dir = t.x > a.x ? 'left' : 'right'; }
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
  if (topic) { const bb = $('bbLine'); bb.innerHTML = `🧑‍🏫 <b>${escapeHtml((topic.text || '').replace(/^📢\s*오늘의 주제:\s*/, ''))}</b>`; bb.classList.remove('hidden'); }
}
function talkAt(company: string, text: string) {
  // 🌐 게임 월드 — 그 회사 캐릭터 위에 말풍선 + 서로 다가가기
  const m: any = (Object.values(plazaMsgs) as any[]).filter(x => x && x.company === company).sort((a, b) => b.ts - a.ts)[0];
  pwTalk(m?.uid || '', company, text);
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
// 🌐 main의 presence 폴링 → 게임 월드 동기화 (SSE 백업·보강)
connect.onPlazaPresence?.((list: any[]) => {
  if (!Array.isArray(list)) return;
  for (const p of list) if (p?.uid) plazaPeople[p.uid] = p;
  renderDesks();
});
// 🧠 광장에서 배운 지식 — 두뇌 각인 토스트 + 내 캐릭터 위 💡
connect.onPlazaLearned?.((d: any) => {
  const items: string[] = d?.items || [];
  const world = $('plazaWorld');
  if (world) pwToast(world, `🧠 광장에서 ${d.count}가지 배웠어요! → 두뇌에 각인 (총 ${d.total})`);
  // 내 캐릭터 머리 위에 💡 + 배운 내용 말풍선
  const mine = (window as any)._mineActor as PwActor | undefined;
  if (mine && items[0]) { pwBubble(mine, '💡 ' + items[0]); const lb = document.createElement('div'); lb.className = 'pw-meet'; lb.textContent = '💡'; lb.style.left = '50%'; lb.style.top = '0'; mine.el?.appendChild(lb); setTimeout(() => lb.remove(), 900); }
  hint(`🧠 광장에서 배운 지식이 두뇌에 쌓였어요: ${items.join(' · ')}`);
});

// 📢 오늘의 주제 발표 — 관리자(선생님)만 등록, 모든 에이전트가 이 주제로 토론
async function sendTopic() {
  const i = $('topicInput') as HTMLInputElement;
  const t = i.value.trim(); if (!t) return;
  if (!plazaJoined) { $('plazaStatus').textContent = '⚠️ 먼저 🏫 광장 입장부터 하세요!'; return; }
  const r = await connect.plazaTopic(t);
  if (r && r.ok === false) { hint(r.notAdmin ? '🛡️ 주제 등록은 관리자(선생님)만 할 수 있어요.' : (r.error || '실패')); return; }
  i.value = '';
}
$('topicBtn').addEventListener('click', sendTopic);
$('topicInput').addEventListener('keydown', (e: any) => { if (e.key === 'Enter') sendTopic(); });

// 🌾 지식 수확 + 🏅 기여도 (localStorage 누적) (localStorage 누적)
function loadBoard(): Record<string, number> { try { return JSON.parse(localStorage.getItem('academy_board') || '{}'); } catch { return {}; } }
function renderLeaderboard() {
  const b = loadBoard();
  const list = Object.entries(b).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('leaderboard').innerHTML = list.length
    ? '<div class="lb-title">🏅 리더보드</div>' + list.map(([c, p], i) => `<div class="lb-row"><span class="lb-rank">${['🥇', '🥈', '🥉', '4', '5'][i]}</span><span class="lb-name">${escapeHtml(c)}</span><span class="lb-pts">${p}점</span></div>`).join('')
    : '';
}
$('gradeBtn')?.addEventListener('click', async () => {
  if (!plazaJoined) { $('plazaStatus').textContent = '⚠️ 먼저 🏫 광장 입장부터 하세요!'; return; }
  const btn = $('gradeBtn') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = '🌾 수확 중…';
  const r = await connect.plazaGrade();
  btn.disabled = false; btn.textContent = '🌾 지식 수확';
  if (!r?.ok) { hint('수확 실패: ' + (r?.reason || '아직 토론이 부족해요')); return; }
  // 가장 빛난 관점도 보너스로 표시(경쟁 아닌 기여)
  const b = loadBoard();
  for (const s of r.scores || []) b[s.company] = (b[s.company] || 0) + (s.score || 0);
  localStorage.setItem('academy_board', JSON.stringify(b));
  renderLeaderboard();
  // 🎬 핵심: 수확 시네마틱 — 지식이 빛이 되어 두뇌로 응축
  if (r.insight) {
    playHarvestCinematic(r.insight, r.topic || '');
    hint(`🌾 광장에서 수확한 지식: "${r.insight}" — 단기기억에 저장됨 (장기학습으로 이어집니다)`);
  } else { hint('🌾 수확 완료'); }
  if (r.top) setTimeout(() => pwGlow(r.top), 2600);   // 시네마틱 후 가장 빛난 관점 강조
});
// 🎬 수확 시네마틱 — 캐릭터들의 의견이 빛 입자로 중앙에 모여 결정체로 응축 → 두뇌로 빨려듦
function playHarvestCinematic(insight: string, topic: string) {
  const fx = $('pwHarvestFx'); const world = $('plazaWorld'); if (!fx || !world) return;
  fx.classList.remove('hidden'); fx.classList.add('show');
  $('phfLabel').textContent = topic ? `🌾 "${topic}" 수확 중…` : '🌾 집단지성 수확 중…';
  $('phfInsight').textContent = ''; $('phfFoot').textContent = '';
  const crystal = $('phfCrystal'); crystal.className = 'phf-crystal gather'; crystal.textContent = '💎';
  // ① 각 캐릭터 위치에서 빛 입자가 중앙으로 날아감
  const wb = world.getBoundingClientRect();
  for (const a of Object.values(pwActors)) {
    if (!a.el) continue;
    const r = a.el.getBoundingClientRect();
    const sx = r.left + r.width / 2 - wb.left, sy = r.top - wb.top;
    for (let k = 0; k < 3; k++) {
      const p = document.createElement('div'); p.className = 'phf-particle'; p.textContent = pick(['✨', '💡', '⭐', '🔆']);
      p.style.left = sx + 'px'; p.style.top = sy + 'px';
      p.style.setProperty('--dx', (wb.width / 2 - sx) + 'px'); p.style.setProperty('--dy', (wb.height / 2 - sy) + 'px');
      p.style.animationDelay = (k * 90 + Math.random() * 220) + 'ms';
      fx.appendChild(p); setTimeout(() => { try { p.remove(); } catch { /* */ } }, 1700);
    }
  }
  // ② 결정체 펄스 → 인사이트 타이핑
  setTimeout(() => { crystal.className = 'phf-crystal pulse'; $('phfLabel').textContent = '💎 지식 결정 완성'; }, 1300);
  setTimeout(() => {
    let i = 0; const el = $('phfInsight'); const t = '"' + insight + '"';
    const typer = window.setInterval(() => { el.textContent = t.slice(0, ++i); if (i >= t.length) clearInterval(typer); }, 32);
  }, 1700);
  // ③ 두뇌로 빨려듦
  setTimeout(() => { $('phfFoot').textContent = '🧠 내 두뇌에 각인 — 장기기억으로 자랍니다'; crystal.className = 'phf-crystal absorb'; }, 3400);
  setTimeout(() => { fx.classList.remove('show'); fx.classList.add('hidden'); const w = $('plazaWorld'); if (w) pwToast(w, '🧠 두뇌에 새 지식의 별이 떴어요 ✨'); }, 4700);
}
// ✨ 가장 빛난 관점에 '인사이트의 빛' (경쟁/왕관 아닌 기여를 빛으로 표현)
function pwGlow(company: string) {
  for (const a of Object.values(pwActors)) a.el?.querySelector('.pw-crown')?.remove();
  const a = Object.values(pwActors).find(x => x.company === company); if (!a?.el) return;
  const c = document.createElement('div'); c.className = 'pw-crown'; c.textContent = '💡'; a.el.appendChild(c);
  for (let k = 0; k < 10; k++) { const f = document.createElement('div'); f.className = 'pw-confetti'; f.textContent = pick(['✨', '💡', '⭐']); f.style.left = (40 + Math.random() * 20) + '%'; f.style.setProperty('--fx', ((Math.random() - 0.5) * 160).toFixed(0) + 'px'); f.style.animationDelay = (k * 50) + 'ms'; $('plazaWorld')?.appendChild(f); setTimeout(() => f.remove(), 2000); }
}
// 📕 도감 토글
$('pwDexBtn')?.addEventListener('click', () => { renderDex(); $('pwDex')?.classList.toggle('hidden'); });
// 🎵 8비트 BGM — 포켓몬st 루프 (WebAudio, 에셋 불필요)
let pwBgm: { ctx: AudioContext; stop: () => void } | null = null;
function pwToggleBgm() {
  const btn = $('pwBgmBtn');
  if (pwBgm) { pwBgm.stop(); pwBgm = null; if (btn) btn.textContent = '🔇'; return; }
  const AC = window.AudioContext || (window as any).webkitAudioContext; const ctx = new AC();
  const notes = [523, 587, 659, 784, 659, 587, 523, 440, 494, 523, 587, 523, 494, 440, 392, 440];   // 밝은 마을 멜로디
  let i = 0; const master = ctx.createGain(); master.gain.value = 0.06; master.connect(ctx.destination);
  const id = window.setInterval(() => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = notes[i % notes.length];
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + 0.24);
    // 베이스
    if (i % 2 === 0) { const bo = ctx.createOscillator(), bg = ctx.createGain(); bo.type = 'triangle'; bo.frequency.value = notes[i % notes.length] / 2; bg.gain.setValueAtTime(0.3, ctx.currentTime); bg.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3); bo.connect(bg); bg.connect(master); bo.start(); bo.stop(ctx.currentTime + 0.3); }
    i++;
  }, 230);
  pwBgm = { ctx, stop: () => { clearInterval(id); try { ctx.close(); } catch { /* */ } } };
  if (btn) btn.textContent = '🔊';
}
$('pwBgmBtn')?.addEventListener('click', pwToggleBgm);

// ── 부팅 + 시작 ───────────────────────────────────────
function timeHello() { const h = new Date().getHours(); return h < 5 ? '늦은 시간이네요' : h < 12 ? '좋은 아침입니다' : h < 18 ? '좋은 오후입니다' : '좋은 저녁입니다'; }
function greet() {
  const custom = (cfg.greeting || '').trim();
  const title = cfg.userTitle || '사장님';
  const g = custom ? custom.replace(/\{name\}/g, agentName()).replace(/\{title\}/g, title) : `${timeHello()}, ${title}. ${agentName()}입니다. 무엇을 도와드릴까요?`;
  addLog(agentTag(), g, false, true);
}
// 🚀 첫 실행 온보딩 — 다운로드한 사람이 60초 안에 "우와"를 보게. 3단계: AI 켜기 → 회사 → 운영 시작
let welTimer: any = null;
function updateWelcome() {
  if ($('welcomePanel').classList.contains('hidden')) return;
  const aiOn = !!(_localStatus?.running || cfg.llmModel);
  const coOn = !!(cfg.company && cfg.company !== '1인 기업');
  $('welStep1').className = 'wel-step' + (aiOn ? ' done' : ' on');
  $('welStep2').className = 'wel-step' + (coOn ? ' done' : aiOn ? ' on' : '');
  $('welStep3').className = 'wel-step' + (aiOn && coOn ? ' on' : '');
  const b1 = $('welAiBtn'); b1.textContent = _localStatus?.loading ? '⏳ 켜는 중…' : aiOn ? '✓ 켜짐' : '모델 받기';
}
function maybeShowWelcome() {
  if (cfg.onboarded || OFFICE_MODE) return;
  openOverlay('welcomePanel');
  ($('welCompany') as HTMLInputElement).value = (cfg.company && cfg.company !== '1인 기업') ? cfg.company : '';
  updateWelcome();
  welTimer = window.setInterval(updateWelcome, 2000);   // AI 켜짐·회사 저장을 실시간 반영
}
function closeWelcome(done: boolean) {
  if (welTimer) { clearInterval(welTimer); welTimer = null; }
  closeOverlay('welcomePanel');
  cfg.onboarded = true; connect.setConfig?.({ onboarded: true });
  if (done) hint('🎉 준비 완료 — AI 팀이 일을 시작합니다!');
}
$('welAiBtn')?.addEventListener('click', () => { openOverlay('aiPanel'); loadAiPanel(); });
$('welCompany')?.addEventListener('change', async () => {
  const v = ($('welCompany') as HTMLInputElement).value.trim();
  if (v) { cfg = await connect.setConfig({ company: v }); applyCfgLabels(); updateWelcome(); }
});
$('welGoBtn')?.addEventListener('click', async () => {
  const v = ($('welCompany') as HTMLInputElement).value.trim();
  if (v && v !== cfg.company) { cfg = await connect.setConfig({ company: v }); applyCfgLabels(); }
  closeWelcome(true);
  startOps();   // 모델이 안 켜져 있으면 startOps가 알아서 AI 패널로 안내
});
$('welSkip')?.addEventListener('click', () => closeWelcome(false));
// 🌱 생태계 — 유튜브·강의·지식스토어·공유 (서로가 서로의 광고판)
document.querySelectorAll('.eco-mini').forEach(b => b.addEventListener('click', () => { const u = (b as HTMLElement).dataset.url; if (u) connect.openExternal?.(u); }));
$('ecoYt')?.addEventListener('click', () => connect.openExternal?.('https://www.youtube.com/channel/UCdLZ0MsYS4hmqFgOYCB6C9w'));
$('acbBtn')?.addEventListener('click', () => connect.openExternal?.('https://aicitybuilders.com'));
$('ezerBtn')?.addEventListener('click', () => connect.openExternal?.('https://salmon-ground-06a59b710.3.azurestaticapps.net'));
$('ecoSite')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText('https://connectai-desktop.web.app'); } catch { /* */ } connect.openExternal?.('https://connectai-desktop.web.app'); hint('🔗 주소 복사됨 — 친구에게 보내주세요!'); });

// 💡 추천 명령 칩 — 클릭 한 번으로 첫 경험
document.querySelectorAll('.sg-chip').forEach(b => b.addEventListener('click', () => {
  const el = b as HTMLElement;
  if (el.dataset.act === 'ops') { $('suggChips')?.remove(); startOps(); return; }
  if (el.dataset.q) ask(el.dataset.q);
}));

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
loadCfg().then(async () => {
  await loadModels(); greet();
  // 🚀 첫 실행 = 온보딩(3단계 → 운영 시작까지). 온보딩 마친 사용자는 두뇌 없을 때만 AI 패널 안내.
  if (!cfg.onboarded && !OFFICE_MODE) { setTimeout(() => maybeShowWelcome(), 900); return; }
  const ls = await connect.localStatus?.().catch(() => null);
  if (!ls?.running && !cfg.llmModel) setTimeout(() => { openOverlay('aiPanel'); loadAiPanel(); hint('AI 두뇌부터 받으면 팀이 일을 시작해요 — 추천 두뇌 하나 받아보세요 👇'); }, 700);
});
renderLeaderboard();
initBrain();
startClock();
// 📋 아침 브리핑(능동성) — 트레이/자동으로 도착하면 채팅에 표시 + 음성
connect.onBriefing((text: string) => { addLog('📋 아침 브리핑', text, false, true, '#FBBF24'); brainEnergy(0.9); try { speak(stripMd(text)); } catch { /* */ } });
connect.onTrayNewChat(async () => { await connect.reset(); $('chat').innerHTML = ''; greet(); hint('새 대화를 시작했어요'); });
export {};
