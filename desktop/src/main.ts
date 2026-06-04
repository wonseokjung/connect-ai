// Connect AI Desktop — Electron 메인 프로세스.
// 비서(영숙) 엔진 + 광장(Plaza) 연결을 IPC 로 렌더러에 노출.
import { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, Notification, nativeImage, desktopCapturer, screen, clipboard } from 'electron';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { talkToMyAgent, agentWithTools, ChatTurn } from './engine/company';
import { fetchRevenue } from './engine/paypal';
import { detectTarget, chat, listModels, embed } from './engine/llm';
import { setBrainFile, allNotes, graph as brainGraph, addNote as brainAddNote, deleteNote, noteCount, importNotes } from './engine/brain';
import { startBridge, stopBridge } from './engine/bridge';
import { autoUpdater } from 'electron-updater';
import { pushKnowledge, pullKnowledge, pushFile } from './engine/github';
import { uploadDataset, notesToJsonl } from './engine/hf';
import { buildNotebook } from './engine/train';
import { sendEmail } from './engine/email';
import { fetchChannel, ytAccessToken, fetchAnalytics } from './engine/youtube';
import { setMcpConfig, testMcp, listMcpTools } from './engine/mcp';
import { fetchUrl, siteMeta } from './engine/web';
import { qwenTTS, localTTS } from './engine/tts';
import { edgeTTS } from './engine/edgetts';
import * as http from 'http';
import { setTaskFile, listTasks, addTask, setStatus as setTaskStatus, openTasks, taskCount } from './engine/tasks';
import { setApprovalFile, listApprovals, setApprovalStatus, pendingApprovals, approvalCount, getApproval, ApprovalAction } from './engine/approvals';
import { spawnSync, spawn, ChildProcess } from 'child_process';
import { agentPrompt } from './engine/persona';
import { joinPlaza, postPlazaMessage, setPlazaDbUrl, plazaConfigured, fetchMessages, PlazaSession, PlazaMessage } from './plaza';

interface Service { id: string; name: string; url: string; desc: string }
interface Config {
  company: string; agentName: string; userTitle: string; plazaEmoji: string; greeting: string; workspace: string; tools: boolean; agentModels?: Record<string, string>;
  voiceName: string; jarvis: boolean; plazaDbUrl: string; llmBase?: string; llmModel?: string; voice: boolean;
  services: Service[]; telegramToken: string; telegramChatId: string; apiKeys: Record<string, string>; paypalClientId: string; paypalSecret: string;
  hfToken: string; hfModel: string;
  apiConn: Record<string, Record<string, string>>;   // 🔌 서비스별 자격증명 (telegram/youtube/paypal/gemini/…)
  briefingOn: boolean; briefingHour: number; briefingMin: number; lastBriefing: string;   // 📋 아침 브리핑(능동성)
  trainNotebookUrl: string;                                          // 🚀 내 학습 노트북(Colab/GitHub) URL
  autoSync: boolean; lastSyncCount: number; lastTrainHintCount: number;   // 🔄 자동 루프(GitHub 자동 커밋 + 학습 추천)
  mcpConfig: any;   // 🔌 MCP 서버 설정 ({ mcpServers: {...} })
  voiceQuality: string;   // 🔊 'browser'(기본·빠름) | 'qwen'(Qwen3-TTS 고품질·클라우드)
  qwenVoice: string;      // 🎤 Qwen3-TTS 음성 (Sohee=한국어 등)
  ttsLocalUrl: string;    // 🖥️ 로컬 Qwen3-TTS 서버 주소 (완전 로컬·무료)
}
const DEFAULTS: Config = {
  company: '1인 기업', agentName: '에이전트', userTitle: '사장님', plazaEmoji: '🖥️', greeting: '', workspace: '', tools: true,
  voiceName: '', jarvis: true, plazaDbUrl: '', llmBase: '', llmModel: '', voice: true,
  services: [], telegramToken: '', telegramChatId: '', apiKeys: {}, paypalClientId: '', paypalSecret: '',
  hfToken: '', hfModel: '', apiConn: {},
  briefingOn: true, briefingHour: 9, briefingMin: 0, lastBriefing: '', trainNotebookUrl: '',
  autoSync: true, lastSyncCount: 0, lastTrainHintCount: 0, mcpConfig: {}, voiceQuality: 'browser', qwenVoice: 'Sohee', ttsLocalUrl: '',
};
const defaultWorkspace = () => path.join(os.homedir(), 'Desktop');

let cfgPath = '';
function loadConfig(): Config {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function saveConfig(patch: Partial<Config>): Config {
  const next = { ...loadConfig(), ...patch };
  try { fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2)); } catch { /* ignore */ }
  return next;
}

let win: BrowserWindow | null = null;
let plaza: PlazaSession | null = null;
let demoBot: PlazaSession | null = null;
let plazaAuto: (() => void) | null = null;
let demoAuto: (() => void) | null = null;

// ─────────────────────────── 🛡️ 안전 모드 (GPU 가속 끄기) — Windows 흰 화면·즉시 종료 대비
// 일부 Windows(RTX 노트북 GPU·키보드 보안/오버레이 등)에서 Chromium GPU 초기화가 충돌해
// 렌더러가 흰 화면 뜨고 바로 죽는다. 우회: GPU 끄기. switch 는 app.ready 전에 설정해야 하므로
// config 와 별개의 가벼운 마커 파일을 미리 읽는다. (--disable-gpu / --safe 인자, CONNECTAI_SAFE 환경변수도 인식)
const safeFlagPath = () => path.join(app.getPath('userData'), 'gpu-safe.flag');
const diagPath = () => path.join(app.getPath('userData'), 'diagnostics.log');
function logDiag(msg: string) { try { fs.appendFileSync(diagPath(), `[${new Date().toISOString()}] ${msg}\n`); } catch { /* */ } }
function isSafeMode(): boolean {
  const argv = process.argv.map(a => a.toLowerCase());
  if (argv.includes('--disable-gpu') || argv.includes('--safe') || argv.includes('--safe-mode')) return true;
  if (process.env.CONNECTAI_SAFE === '1') return true;
  try { return fs.existsSync(safeFlagPath()); } catch { return false; }
}
const SAFE_MODE = isSafeMode();
if (SAFE_MODE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}
// GPU/렌더러가 시작 직후 죽으면(흰 화면 → 즉시 종료) 자동으로 안전 모드 켜고 1회 재시작.
// 정밀 조건: ① 진짜 크래시 reason 만(사용자 종료·강제 kill 제외) ② 실행 후 20초 이내(시작 시 GPU 초기화 충돌만).
// 이미 안전 모드면 무한 루프 방지.
const launchTs = Date.now();
let relaunchedForSafe = false;
const isCrash = (r: string) => r === 'crashed' || r === 'launch-failed' || r === 'integrity-failure' || r === 'abnormal-exit' || r === 'oom';
function fallbackToSafeMode(reason: string) {
  if (SAFE_MODE || relaunchedForSafe) return;
  if (Date.now() - launchTs > 20000) { logDiag(`늦은 크래시(${reason}) — 시작 충돌 아님, 자동 재시작 안 함`); return; }
  relaunchedForSafe = true;
  try { fs.writeFileSync(safeFlagPath(), `auto-enabled: ${reason}\n${new Date().toISOString()}`); } catch { /* */ }
  logDiag(`⚠️ 시작 직후 GPU/렌더러 충돌(${reason}) 감지 → 안전 모드(GPU 끄기)로 자동 재시작`);
  try { app.relaunch(); } catch { /* */ }
  app.exit(0);
}
app.on('child-process-gone', (_e, d: any) => {
  logDiag(`child-process-gone: type=${d?.type} reason=${d?.reason}`);
  if ((d?.type === 'GPU' || d?.type === 'renderer') && isCrash(d?.reason)) fallbackToSafeMode(`${d?.type}:${d?.reason}`);
});
app.on('render-process-gone', (_e, _wc: any, d: any) => {
  logDiag(`render-process-gone: reason=${d?.reason}`);
  if (isCrash(d?.reason)) fallbackToSafeMode(`render:${d?.reason}`);
});

// 첫 1~2문장만, 단어 중간 자르지 않기 (160자 하드컷 → 문장 경계)
const cleanLine = (s: string) => {
  let t = (s || '').replace(/\s+/g, ' ').replace(/^["'「『]+|["'」』]+$/g, '').trim();
  const sents = t.match(/[^.!?。！？]+[.!?。！？]?/g) || [t];
  t = sents.slice(0, 2).join('').trim();
  if (t.length > 180) { const cut = t.lastIndexOf(' ', 180); t = (cut > 60 ? t.slice(0, cut) : t.slice(0, 180)) + '…'; }
  return t;
};

// 🔁 자율 대화 루프 — 자연스러운 turn-taking:
//   · 남이 마지막으로 말했으면 응답 후보 → 랜덤 1.5~7.5s 끼어들기 지연
//   · 기다리는 사이 다른 에이전트가 먼저 말하면 60% 확률로 양보 (도배 방지)
//   · 내 개인 쿨다운 15s (한 명 독점 방지). 한 주제(📢)당 maxTurns 턴.
function startAutoChat(opts: { uid: string; target: any; sys: string; makePrompt: (convo: string, topic: string) => string; post: (t: string) => Promise<any>; maxTurns?: number }): () => void {
  let replying = false, turns = 0, seenTopic = '', lastSpokeAt = 0;
  const max = opts.maxTurns ?? 12;
  const iv = setInterval(async () => {
    if (replying || !opts.target) return;
    let msgs: any[]; try { msgs = await fetchMessages(); } catch { return; }
    if (!msgs.length) return;
    const topic = [...msgs].reverse().find((m: any) => /^📢/.test(m.text || ''));
    if (topic) { const k = `${topic.ts}|${topic.text}`; if (k !== seenTopic) { seenTopic = k; turns = 0; } }
    const last = msgs[msgs.length - 1];
    if (last.uid === opts.uid) return;                 // 내가 마지막 → 대기
    if (turns >= max) return;
    if (Date.now() - lastSpokeAt < 15000) return;      // 개인 쿨다운
    const triggerTs = last.ts;
    replying = true;
    try {
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 6000));  // 끼어들기 stagger
      const cur = await fetchMessages();
      const curLast = cur[cur.length - 1];
      // 기다리는 사이 다른 에이전트가 이미 끼어들었으면 양보(60%)
      if (curLast && curLast.uid !== opts.uid && curLast.ts > triggerTs && Math.random() < 0.6) return;
      // 주제 고정 — 항상 현재 주제를 같이 넣어 딴 길로 새지 않게
      const curTopic = [...cur].reverse().find((m: any) => /^📢/.test(m.text || ''));
      const topicText = curTopic ? (curTopic.text || '').replace(/^📢\s*오늘의 주제:\s*/, '').replace(/\s*—.*$/, '').trim() : '';
      const convo = cur.slice(-8).map((m: any) => `${m.company}(${m.role || '학생'}): ${m.text}`).join('\n');
      // 턴마다 다른 관점 강제 → 같은 말 반복(degeneration) 방지
      const angles = ['구체적인 실제 사례를 들어', '앞 사람 주장에 반론을 제기하며', '실생활·비즈니스 적용 관점에서', '다른 분야(과학·역사·예술)와 연결해', '핵심을 찌르는 질문을 던지며', '정반대 입장에서'];
      const prompt = `${opts.makePrompt(convo, topicText)}\n\n[이번 발언 지시] ${angles[turns % angles.length]} 말하라. 앞에 이미 나온 문장을 절대 그대로 반복하지 말 것.`;
      const t = cleanLine(await chat(opts.target, opts.sys, prompt, { temperature: 0.9, frequencyPenalty: 0.6, presencePenalty: 0.5 }));
      if (t) { await opts.post(t); lastSpokeAt = Date.now(); turns++; }
    } catch { /* */ } finally { replying = false; }
  }, 5000);
  return () => clearInterval(iv);
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: 'Connect AI',
    backgroundColor: '#0b1020',
    show: false,                 // 흰 화면 플래시 방지 — 렌더러 준비되면 보여줌
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => { try { win?.show(); } catch { /* */ } });
  // 안전장치: ready-to-show 가 안 떠도 4초 뒤 강제로 보여줌 (영영 흰 화면/숨김 방지)
  setTimeout(() => { try { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); } catch { /* */ } }, 4000);
  win.webContents.on('did-fail-load', (_e, code, desc, url) => { logDiag(`did-fail-load: ${code} ${desc} ${url}`); try { win?.show(); } catch { /* */ } });
  win.webContents.on('unresponsive', () => logDiag('renderer unresponsive'));
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // 닫으면 종료가 아니라 트레이로 숨김 (자는 동안 도는 회사 — 상주)
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide(); if (process.platform === 'darwin') app.dock?.hide(); } });
  if (SAFE_MODE) logDiag('실행: 안전 모드(GPU 끄기)');
}
function showWindow() { if (!win || win.isDestroyed()) createWindow(); else { win.show(); win.focus(); } if (process.platform === 'darwin') app.dock?.show(); }

// ─────────────────────────── 🖥️ 트레이 (상주) + 📋 아침 브리핑(능동성)
let tray: Tray | null = null;
let quitting = false;
function trayIcon() {
  try {
    const p = path.join(__dirname, '..', 'build', 'icon.iconset', 'icon_32x32.png');
    let img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
    return img;
  } catch { return nativeImage.createEmpty(); }
}
function buildTray() {
  if (tray) return;
  try { tray = new Tray(trayIcon()); } catch { return; }
  tray.setToolTip('Connect AI — 1인 기업 AI 비서');
  const menu = Menu.buildFromTemplate([
    { label: '🏢 Connect AI 열기', click: () => showWindow() },
    { label: '📋 오늘 브리핑 받기', click: () => runBriefing(true) },
    { label: '➕ 새 대화', click: () => { showWindow(); win?.webContents.send('tray:newchat'); } },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
}

const todayStr = () => new Date().toISOString().slice(0, 10);
let briefingBusy = false;
async function runBriefing(manual = false) {
  if (briefingBusy) return; briefingBusy = true;
  try {
    const c = loadConfig();
    const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() });
    if (!target) { notify('Connect AI', '모델(LM Studio/Ollama)을 먼저 켜면 아침 브리핑을 드릴게요.'); return; }
    const open = openTasks(), pend = pendingApprovals();
    const ctx = [
      `지금: ${new Date().toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' })} (${new Date().getHours() < 12 ? '오전' : '오후'})`,
      `회사: ${c.company} · 등록 서비스 ${c.services.length}개 · 지식 ${noteCount()}개`,
      open.length ? `열린 할 일(${open.length}): ${open.slice(0, 6).map(t => t.title).join(', ')}` : '열린 할 일 없음',
      pend.length ? `승인 대기(${pend.length}): ${pend.slice(0, 4).map(a => a.title).join(', ')}` : '승인 대기 없음',
      c.services.length ? `서비스: ${c.services.map(s => s.name).join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const title = c.userTitle || '사장님';
    const user = `${title}께 드리는 **아침 브리핑**을 작성해줘.\n\n[현재 상황]\n${ctx}\n\n형식: 따뜻한 한 줄 인사 → 오늘 핵심 3가지(우선순위) → 추천 액션 1개. 너무 길지 않게, ${title}이(가) 바로 움직일 수 있게.`;
    notify('📋 브리핑 준비 중…', `${c.agentName}가 오늘 할 일을 정리하고 있어요.`);
    let text = '';
    try { text = await chat(target, agentPrompt(c.agentName, c.company, title), user, { temperature: 0.6 }); } catch (e: any) { text = `브리핑 생성 중 문제가 생겼어요. (${e?.message || e})`; }
    text = text.trim();
    saveConfig({ lastBriefing: todayStr() });
    showWindow();
    win?.webContents.send('briefing:show', text);
    const firstLine = text.replace(/[#*`]/g, '').split('\n').filter(Boolean)[0] || '오늘의 브리핑이 도착했어요.';
    notify('📋 아침 브리핑', firstLine.slice(0, 120));
  } finally { briefingBusy = false; }
}
function notify(title: string, body: string) { try { if (Notification.isSupported()) new Notification({ title, body, silent: false }).show(); } catch { /* */ } }
// 매 15분 체크 — 브리핑 켜져있고, 오늘 안 했고, 설정 시각 지났으면 1회 자동
function scheduleBriefing() {
  const check = () => {
    const c = loadConfig();
    if (!c.briefingOn) return;
    if (c.lastBriefing === todayStr()) return;
    const now = new Date(); const cur = now.getHours() * 60 + now.getMinutes();
    if (cur >= (c.briefingHour ?? 9) * 60 + (c.briefingMin ?? 0)) runBriefing(false);
  };
  setInterval(check, 15 * 60 * 1000);
  setTimeout(check, 8000);   // 실행 직후 한 번(새 날이면)
}

app.whenReady().then(() => {
  cfgPath = path.join(app.getPath('userData'), 'connect-ai-config.json');
  setBrainFile(path.join(app.getPath('userData'), 'brain.json'));
  setTaskFile(path.join(app.getPath('userData'), 'tasks.json'));
  setApprovalFile(path.join(app.getPath('userData'), 'approvals.json'));
  try { setMcpConfig(loadConfig().mcpConfig); } catch { /* */ }
  createWindow();
  buildTray();
  scheduleBriefing();
  scheduleAuto();
  startConnectBridge();   // 🔌 EZERAI ↔ Connect AI 두뇌 브릿지 (:4825)
  setTimeout(setupAutoUpdate, 4000);   // ⬆️ 자동 업데이트 체크(부팅 4초 후)
  app.on('activate', () => { showWindow(); });
});
app.on('before-quit', () => { quitting = true; });
// 창 닫아도 트레이로 상주 (종료는 트레이 메뉴 '종료')
app.on('window-all-closed', () => { /* 상주 */ });
ipcMain.handle('briefing:run', () => { runBriefing(true); return true; });

// ─────────────────────────── 설정 IPC
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, patch: Partial<Config>) => {
  const c = saveConfig(patch);
  if ('plazaDbUrl' in patch) setPlazaDbUrl(c.plazaDbUrl);
  if ('mcpConfig' in patch) setMcpConfig(c.mcpConfig);
  return c;
});

// 🔌 MCP — 서버 설정 저장/테스트/도구목록
ipcMain.handle('mcp:get', () => loadConfig().mcpConfig || {});
ipcMain.handle('mcp:save', (_e, cfg: any) => { saveConfig({ mcpConfig: cfg }); setMcpConfig(cfg); return true; });
ipcMain.handle('mcp:test', async () => { setMcpConfig(loadConfig().mcpConfig); return await testMcp(); });
ipcMain.handle('mcp:tools', async () => await listMcpTools());

// 🛡️ 안전 모드 (GPU 끄기) — 설정에서 토글, 재시작 필요
ipcMain.handle('safemode:get', () => SAFE_MODE);
ipcMain.handle('safemode:set', (_e, on: boolean) => {
  try { if (on) fs.writeFileSync(safeFlagPath(), `user-enabled\n${new Date().toISOString()}`); else if (fs.existsSync(safeFlagPath())) fs.unlinkSync(safeFlagPath()); } catch { /* */ }
  return true;
});
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });

// ─────────────────────────── 💰 매출 대시보드 (별도 창 + PayPal 실연동)
let revenueWin: BrowserWindow | null = null;
function openRevenueWindow() {
  if (revenueWin && !revenueWin.isDestroyed()) { revenueWin.focus(); return; }
  revenueWin = new BrowserWindow({
    width: 1180, height: 860, minWidth: 720, minHeight: 560, title: '비즈니스 리포트 — Connect AI',
    backgroundColor: '#050816', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  revenueWin.once('ready-to-show', () => revenueWin?.show());
  revenueWin.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'revenue.html'));
  revenueWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  revenueWin.on('closed', () => { revenueWin = null; });
}
const postRevenue = (s: any) => { if (revenueWin && !revenueWin.isDestroyed()) revenueWin.webContents.send('revenue:state', s); };

// 🪟 별도 사무실 창 — 에이전트 가상사무실을 옆에 띄워놓고 구경
let officeWin: BrowserWindow | null = null;
function openOfficeWindow() {
  if (officeWin && !officeWin.isDestroyed()) { officeWin.focus(); return; }
  // 메인 창 오른쪽 옆에 붙여서 배치 (화면 넘으면 메인 왼쪽 또는 기본 위치)
  const W = 960, H = 720;
  let pos: { x?: number; y?: number } = {};
  try {
    if (win && !win.isDestroyed()) {
      const b = win.getBounds(); const disp = screen.getDisplayMatching(b).workArea;
      let x = b.x + b.width + 8;
      if (x + W > disp.x + disp.width) x = Math.max(disp.x, b.x - W - 8);   // 오른쪽 공간 없으면 왼쪽
      pos = { x: Math.round(x), y: Math.round(b.y) };
    }
  } catch { /* */ }
  officeWin = new BrowserWindow({
    width: W, height: H, minWidth: 600, minHeight: 460, title: '가상 사무실 — Connect AI',
    backgroundColor: '#06100b', show: false, ...pos,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  officeWin.once('ready-to-show', () => officeWin?.show());
  officeWin.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { office: '1' } });
  officeWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  officeWin.on('closed', () => { officeWin = null; });
}
ipcMain.handle('office:open', () => { openOfficeWindow(); return true; });

// ⬆️ 자동 업데이트 (electron-updater + GitHub 릴리스) — 맥(서명·공증)·윈도우 둘 다
function setupAutoUpdate() {
  if (!app.isPackaged) return;   // 개발 빌드(electron .)에선 비활성
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const sendU = (s: any) => { try { win?.webContents.send('update:status', s); } catch { /* */ } };
  autoUpdater.on('checking-for-update', () => sendU({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => sendU({ state: 'available', version: i?.version }));
  autoUpdater.on('update-not-available', () => sendU({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendU({ state: 'downloading', percent: Math.round(p?.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => { sendU({ state: 'downloaded', version: i?.version }); notify('🎉 새 버전 준비됨', `v${i?.version} — 앱에서 "재시작 업그레이드"를 누르세요.`); });
  autoUpdater.on('error', (e) => sendU({ state: 'error', error: String(e?.message || e) }));
  autoUpdater.checkForUpdates().catch(() => { /* 네트워크 없어도 무시 */ });
  setInterval(() => autoUpdater.checkForUpdates().catch(() => { /* */ }), 6 * 60 * 60 * 1000);   // 6시간마다
}
ipcMain.handle('update:check', async () => { if (!app.isPackaged) return { dev: true }; try { const r = await autoUpdater.checkForUpdates(); return { ok: true, version: r?.updateInfo?.version }; } catch (e: any) { return { ok: false, error: e?.message }; } });
ipcMain.handle('update:install', () => { try { autoUpdater.quitAndInstall(); } catch { /* */ } });
// 엔진 이벤트를 메인+사무실 창 둘 다에 (사무실 창이 살아 움직이게)
const emitEngine = (ev: any) => { try { win?.webContents.send('engine:event', ev); } catch { /* */ } try { if (officeWin && !officeWin.isDestroyed()) officeWin.webContents.send('engine:event', ev); } catch { /* */ } };
async function loadRevenue() {
  postRevenue({ type: 'state', loading: true, error: null, data: null });
  const c = loadConfig();
  const [state, services] = await Promise.all([
    fetchRevenue(c.paypalClientId, c.paypalSecret, { days: 30 }),
    Promise.all((c.services || []).map(async (s) => {
      const m = s.url ? await siteMeta(s.url).catch(() => ({ title: '', image: '', favicon: '', text: '' })) : { title: '', image: '', favicon: '', text: '' };
      return {
        name: s.name, url: s.url, desc: s.desc,
        type: /youtube\.com|youtu\.be/i.test(s.url) ? 'youtube' : 'web',
        snapshot: (m.text || '').replace(/\s+/g, ' ').slice(0, 200), image: m.image || '', favicon: m.favicon || '', siteTitle: m.title || '',
      };
    })),
  ]);
  (state as any).services = services;
  postRevenue(state);
}
ipcMain.handle('revenue:open', () => { openRevenueWindow(); return true; });
ipcMain.handle('revenue:ready', () => { loadRevenue(); return true; });
ipcMain.handle('revenue:refresh', () => { loadRevenue(); return true; });
ipcMain.handle('revenue:openSettings', () => { win?.focus(); return true; });
// 🎙️ 리포트 AI 브리핑 — 실데이터(서비스·매출·할일)로 음성 브리핑 텍스트 생성
ipcMain.handle('report:briefing', async () => {
  const c = loadConfig();
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() });
  if (!target) return { ok: false, error: '모델(LM Studio/Ollama)을 먼저 켜주세요.' };
  const services = (c.services || []).map(s => s.name).join(', ');
  let revLine = '';
  try { const r = await fetchRevenue(c.paypalClientId, c.paypalSecret, { days: 30 }); if (r.data) { const cur = Object.keys(r.data.totals.by_currency)[0] || ''; const p = r.data.totals.by_period; revLine = `이번 달 매출 ${(p.month || 0).toFixed(2)} ${cur}, 거래 ${(r.data.transactions || []).length}건`; } } catch { /* */ }
  const open = openTasks().slice(0, 5).map(t => t.title).join(', ');
  const ctx = [`회사: ${c.company}`, services ? `운영 서비스: ${services}` : '', revLine ? `매출: ${revLine}` : '', open ? `할 일: ${open}` : ''].filter(Boolean).join('\n');
  const title = c.userTitle || '사장님';
  const user = `${title}께 드리는 **비즈니스 브리핑**을 음성으로 말하듯 작성해줘. 따뜻한 인사 → 핵심 현황(서비스·매출) → 오늘 추천 1~2가지. 3~5문장, 자연스럽고 또렷하게. 마크다운/이모지 없이.\n\n[현황]\n${ctx}`;
  try { const text = await chat(target, agentPrompt(c.agentName, c.company, title), user, { temperature: 0.6 }); return { ok: true, text: text.trim() }; }
  catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
});
// 🔊 리포트 전용 음성 — 쇼케이스용으로 항상 무료 Edge 선희(자연스러운 한국어)
ipcMain.handle('report:speak', async (_e, text: string) => await edgeTTS('ko-KR-SunHiNeural', text));
ipcMain.handle('diag:open', () => { try { if (fs.existsSync(diagPath())) shell.showItemInFolder(diagPath()); else shell.openPath(app.getPath('userData')); } catch { /* */ } return true; });
ipcMain.handle('open:external', (_e, url: string) => { try { if (/^https?:\/\//.test(url)) shell.openExternal(url); } catch { /* */ } return true; });
// 🔊 고품질 음성 (Qwen3-TTS via Replicate)
ipcMain.handle('tts:speak', async (_e, text: string) => {
  const c = loadConfig();
  // 🔊 무료 고품질 — MS Edge 신경망 (키·GPU 불필요)
  if (c.voiceQuality === 'edge') return await edgeTTS(c.qwenVoice || 'ko-KR-SunHiNeural', text);
  if (c.voiceQuality !== 'qwen') return { ok: false, skip: true };
  // Qwen — 로컬 서버 있으면 로컬(무료), 없으면 Replicate(클라우드)
  if (c.ttsLocalUrl) return await localTTS(c.ttsLocalUrl, text, c.qwenVoice || 'Sohee');
  const token = (c.apiConn?.replicate?.REPLICATE_API_TOKEN) || (c.apiKeys?.replicate) || '';
  return await qwenTTS(token, text, c.qwenVoice || 'Sohee');
});

// ─────────────────────────── 일반 모드 (단일 에이전트 1:1 + 대화 기억)
let history: ChatTurn[] = [];
// ⌨️ 통합 터미널 — 사용자 명령 + 에이전트 개발서버가 전부 여기서 돈다. 한 번에 하나(이전 것 종료). ⏹/Ctrl+C로 중지.
let termProc: ChildProcess | null = null;
const termSend = (kind: string, text: string) => { try { win?.webContents.send('term:data', { kind, text }); } catch { /* */ } };
function killTerm() {
  if (!termProc) return;
  try { if (process.platform === 'win32' && termProc.pid) spawn('taskkill', ['/pid', String(termProc.pid), '/T', '/F']); else { termProc.kill(); if (termProc.pid) { try { process.kill(-termProc.pid, 'SIGTERM'); } catch { /* */ } } } } catch { /* */ }
  termProc = null;
}
app.on('before-quit', killTerm);
// 명령을 터미널에서 스트리밍 실행. 이전 프로세스 종료 후 새로.
function spawnInTerminal(cmd: string, ws: string): ChildProcess | null {
  killTerm();
  try {
    const child = spawn(cmd, { cwd: ws, shell: true, detached: process.platform !== 'win32', env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' } });
    termProc = child;
    child.stdout?.on('data', (d: Buffer) => termSend('out', d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => termSend('out', d.toString('utf8')));
    child.on('error', (e) => termSend('out', `오류: ${e?.message || e}`));
    child.on('exit', (code) => { termSend('exit', `[종료 코드 ${code ?? '?'}]`); if (termProc === child) termProc = null; });
    return child;
  } catch (e: any) { termSend('exit', `실행 실패: ${e?.message || e}`); return null; }
}
// 맥에선 python/pip 가 보통 python3/pip3 → 자동 교정 (가장 흔한 실패 원인)
function normalizeCmd(cmd: string): string {
  let c = (cmd || '').trim();
  if (process.platform !== 'win32') {
    c = c.replace(/(^|\s|&&\s*|;\s*|\|\s*)python(?!3)(\s)/g, '$1python3$2')
         .replace(/(^|\s|&&\s*|;\s*|\|\s*)pip(?!3)(\s)/g, '$1pip3$2');
  }
  return c;
}
// 명령에서 포트 추출 (http.server 8000 / --port 3000 / -p 5173 / :8080)
function portFromCmd(cmd: string): number | null {
  const m = cmd.match(/--port[=\s]+(\d{2,5})/) || cmd.match(/\bhttp\.server\s+(\d{2,5})/) || cmd.match(/-p[=\s]+(\d{2,5})/) || cmd.match(/:(\d{4,5})\b/);
  return m ? parseInt(m[1], 10) : null;
}
// 개발 서버 — 터미널에서 실행(자동 표시) + URL 감지해서 브라우저 자동 오픈. ⏹/Ctrl+C로 중지.
function startServer(rawCmd: string, ws: string): Promise<string> {
  return new Promise((resolve) => {
    const cmd = normalizeCmd(rawCmd);
    const wantPort = portFromCmd(cmd) || (/http\.server|SimpleHTTPServer/i.test(cmd) ? 8000 : /flask|app\.run/i.test(cmd) ? 5000 : /vite/i.test(cmd) ? 5173 : /next/i.test(cmd) ? 3000 : 3000);
    // 정적 서버인데 index.html이 없으면 → 에이전트에게 "파일부터 만들라" 경고 (빈 폴더 serve 방지)
    let warn = '';
    if (/http\.server|SimpleHTTPServer/i.test(cmd)) { try { if (!fs.existsSync(path.join(ws, 'index.html'))) warn = `\n⚠️ 경고: 이 폴더에 index.html이 없어서 브라우저에 "Directory listing"(빈 목록)만 떠요. 반드시 write_file 로 index.html 을 먼저 만든 뒤 다시 서버를 띄우세요. 아직 웹사이트를 만든 게 아닙니다.`; } catch { /* */ } }
    termSend('cmd', `$ ${cmd}`);
    try { win?.webContents.send('term:show'); } catch { /* */ }
    const child = spawnInTerminal(cmd, ws);
    if (!child) return resolve('서버 실행 실패');
    let out = '', done = false;
    const open = (port: string | number, note: string) => { if (done) return; done = true; const url = `http://localhost:${port}`; shell.openExternal(url); resolve(`✅ ${note}: ${url}\n(터미널에서 실행 중 — ⏹ 또는 Ctrl+C로 중지)${warn}`); };
    const scan = (buf: Buffer) => {
      out += buf.toString('utf8');
      const m = out.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)/i) || out.match(/port\s+(\d{2,5})/i);
      if (m) open(m[1], '서버를 띄우고 브라우저를 열었어요');
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
    child.on('exit', (code) => { if (!done) { done = true; resolve(`서버가 종료됐어요(코드 ${code}). 명령이 잘못됐을 수 있어요.\n로그: ${out.slice(-400) || '(출력 없음)'}\n💡 정적 사이트면 python3 -m http.server ${wantPort || 8000} 를 시도해 보세요.`); } });
    setTimeout(() => { if (!done) open(wantPort || 3000, '서버 실행 중 — 브라우저를 열었어요'); }, 4500);
  });
}
const servicesInfo = (c: Config) => {
  const svc = c.services.length
    ? `\n\n## ${c.company}의 서비스/사업 (사장님 것 — 인지하고 적극 활용)\n` + c.services.map(s => `- ${s.name}${s.url ? ` (${s.url})` : ''}${s.desc ? `: ${s.desc}` : ''}`).join('\n')
    : '';
  const open = openTasks();
  const tk = open.length
    ? `\n\n## 지금 열린 할 일 (태스크 보드 — 참고하고, 완료되면 보고)\n` + open.slice(0, 12).map(t => `- ${t.title}`).join('\n')
    : '';
  const pend = pendingApprovals();
  const ap = pend.length
    ? `\n\n## 승인 대기 중 (사장님 결재 기다리는 중)\n` + pend.slice(0, 8).map(a => `- ${a.title}`).join('\n')
    : '';
  return svc + tk + ap;
};
let runAbort: AbortController | null = null;
ipcMain.handle('company:run', async (_e, text: string, attach?: { paths?: string[]; images?: string[] }) => {
  const c = loadConfig();
  // 📎 첨부: 파일 경로는 메시지에 알려주고, 이미지는 비전으로 모델에 직접 보여준다
  const attachPaths = (attach?.paths || []).filter(Boolean);
  const attachImages = (attach?.images || []).filter(Boolean);
  if (attachPaths.length) text = `${text}\n\n[사장님이 첨부한 파일 경로 — 필요하면 read_file·open·run·serve로 다뤄라]\n${attachPaths.join('\n')}`;
  runAbort?.abort();                 // 이전 실행이 남아있으면 정리
  runAbort = new AbortController();
  const getRevenue = async () => {
    const cc = loadConfig();
    const r = await fetchRevenue(cc.paypalClientId, cc.paypalSecret, { days: 30 });
    if (r.data) {
      const cur = Object.keys(r.data.totals.by_currency)[0] || '';
      const p = r.data.totals.by_period; const tx = r.data.transactions || [];
      return `이번 달 ${(p.month || 0).toFixed(2)} ${cur} · 지난 7일 ${(p.week || 0).toFixed(2)} · 오늘 ${(p.today || 0).toFixed(2)} · 총 거래 ${tx.length}건. 최근 거래: ${tx.slice(0, 3).map((t: any) => `${t.subject}(${t.value}${t.currency})`).join(', ') || '없음'}`;
    }
    return (r.error || 'PayPal이 아직 연결되지 않았어요') + ' — 🗂️ 관리 → 연동 → PayPal에 Client ID/Secret을 넣으면 매출을 바로 보여드릴게요.';
  };
  const captureScreen = async (): Promise<string | null> => {
    try {
      const sz = screen.getPrimaryDisplay().size;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.min(1680, sz.width), height: Math.min(1050, sz.height) } });
      const s = sources[0]; if (!s || s.thumbnail.isEmpty()) return null;
      return s.thumbnail.toDataURL();
    } catch { return null; }
  };
  const readClipboard = async (): Promise<string> => { try { return clipboard.readText() || ''; } catch { return ''; } };
  const openPath = async (p: string): Promise<string> => {
    let t = (p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
    try {
      if (/^https?:\/\//i.test(t)) { shell.openExternal(t); return `✅ 열었어요: ${t}`; }
      if (!path.isAbsolute(t)) t = path.join(c.workspace || defaultWorkspace(), t);
      if (!fs.existsSync(t)) return `열기 실패: 그 경로에 파일이 없어요 (${t})`;
      const err = await shell.openPath(t);
      return err ? `열기 실패: ${err}` : `✅ 열었어요: ${t}`;
    } catch (e: any) { return `열기 실패: ${e?.message || e}`; }
  };
  const getYoutube = () => realtimeFor('youtube');   // 유튜브 채널 실데이터(연동된 경우)
  const sendTelegram = async (msg: string): Promise<string> => {
    const cc = loadConfig(); const tok = cc.telegramToken, chat = cc.telegramChatId;
    if (!tok || !chat) return '텔레그램이 연결 안 됐어요. 🗂️ 연동 → Telegram에 봇 토큰과 chat_id를 넣으세요.';
    try { await axios.post(`https://api.telegram.org/bot${tok}/sendMessage`, { chat_id: chat, text: msg || '(빈 메시지)' }, { timeout: 9000 }); return '✅ 텔레그램으로 보냈어요.'; }
    catch (e: any) { return `텔레그램 전송 실패: ${e?.response?.data?.description || e?.message}`; }
  };
  const opts = { company: c.company, agentName: c.agentName, workspace: c.workspace || defaultWorkspace(), servicesInfo: servicesInfo(c), target: { base: c.llmBase, model: c.llmModel, key: geminiKey() }, signal: runAbort.signal, realtimeFor, getRevenue, getYoutube, sendTelegram, captureScreen, readClipboard, openPath, startServer: (cmd: string) => startServer(cmd, c.workspace || defaultWorkspace()), attachImages, userTitle: c.userTitle || '사장님', agentModels: c.agentModels || {} };
  const send = (ev: any) => emitEngine(ev);   // 메인 + 별도 사무실 창
  // 도구 켜짐 = 파일 읽기/쓰기 하는 진짜 에이전트, 꺼짐 = 단순 대화
  const reply = c.tools !== false
    ? await agentWithTools(history, text, opts, send)
    : await talkToMyAgent(history, text, opts, send);
  history.push({ role: 'user', content: text });
  if (reply) history.push({ role: 'assistant', content: reply });
  if (history.length > 20) history = history.slice(-20); // 최근 10턴
  runAbort = null;
  return true;
});
ipcMain.handle('company:stop', () => { runAbort?.abort(); return true; });
ipcMain.handle('company:reset', () => { history = []; return true; });

// 🧠 두뇌 (지식 네트워크)
ipcMain.handle('brain:graph', () => brainGraph());
ipcMain.handle('brain:list', () => allNotes().map(n => ({ id: n.id, text: n.text, ts: n.ts })).sort((a, b) => b.ts - a.ts));
ipcMain.handle('brain:count', () => noteCount());
ipcMain.handle('brain:delete', (_e, id: string) => { deleteNote(id); return noteCount(); });
ipcMain.handle('brain:add', async (_e, text: string) => {
  const c = loadConfig();
  let e: number[] | null = null;
  try { e = await embed(c.llmBase || 'http://127.0.0.1:1234', text); } catch { /* */ }
  brainAddNote(text, e || undefined);
  autoSyncSoon();
  return noteCount();
});

// 🛠️ 작업 폴더 — 에이전트가 파일을 만들/읽을 기본 위치
ipcMain.handle('workspace:get', () => loadConfig().workspace || defaultWorkspace());
ipcMain.handle('workspace:pick', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: '에이전트 작업 폴더 선택' });
  if (r.canceled || !r.filePaths[0]) return loadConfig().workspace || defaultWorkspace();
  saveConfig({ workspace: r.filePaths[0] });
  return r.filePaths[0];
});

// 💻 작업실 — 파일 트리 / 내용 보기 / Finder 열기
const TREE_SKIP = /^(node_modules|venv|env|__pycache__|dist|build|out|\.next|\.cache|\.git|target|\$RECYCLE|Library)$/i;
function buildTree(root: string) {
  let count = 0;
  const walk = (dir: string, depth: number): any[] => {
    if (depth > 6 || count > 1200) return [];
    let items: import('fs').Dirent[]; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    const dirs: any[] = [], files: any[] = [];
    for (const it of items) {
      if (it.name.startsWith('.') || TREE_SKIP.test(it.name)) continue;
      if (count++ > 1200) break;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) dirs.push({ name: it.name, path: full, dir: true, children: walk(full, depth + 1) });
      else { let mtime = 0; try { mtime = fs.statSync(full).mtimeMs; } catch { /* */ } files.push({ name: it.name, path: full, dir: false, mtime }); }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name)); files.sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files];
  };
  try { if (!fs.existsSync(root)) return { root, name: path.basename(root), children: [], missing: true }; } catch { /* */ }
  return { root, name: path.basename(root), children: walk(root, 0) };
}
ipcMain.handle('fs:tree', (_e, root?: string) => buildTree(root || loadConfig().workspace || defaultWorkspace()));
ipcMain.handle('fs:read', (_e, p: string) => {
  try {
    const st = fs.statSync(p);
    const name = path.basename(p);
    if (/\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(p)) return { image: `data:image/${(path.extname(p).slice(1) || 'png').replace('jpg', 'jpeg')};base64,${fs.readFileSync(p).toString('base64')}`, name };
    if (/\.(pdf|zip|mp4|mov|mp3|wav|dmg|exe|woff2?|ttf|otf|node|bin)$/i.test(p)) return { binary: true, name };
    if (st.size > 600_000) return { error: `파일이 커서 미리보기를 생략했어요 (${Math.round(st.size / 1024)}KB)`, name };
    return { content: fs.readFileSync(p, 'utf8'), name, size: st.size };
  } catch (e: any) { return { error: e?.message || String(e) }; }
});
ipcMain.handle('fs:reveal', (_e, p: string) => { try { shell.showItemInFolder(p); return true; } catch { return false; } });
ipcMain.handle('fs:write', (_e, p: string, content: string) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content ?? '', 'utf8'); return { ok: true }; } catch (e: any) { return { ok: false, error: e?.message || String(e) }; } });

// ⌨️ 터미널 IPC — 사용자가 친 명령 실행 / 중지 (서버도 같은 termProc 사용 → 한 곳에서 중지)
ipcMain.handle('term:run', (_e, cmd: string, ws?: string) => {
  const cwd = ws || loadConfig().workspace || defaultWorkspace();
  termSend('cmd', `$ ${cmd}`);
  spawnInTerminal(normalizeCmd(cmd), cwd);
  return true;
});
ipcMain.handle('term:kill', () => { killTerm(); return true; });

// 🗂️ 내 서비스 (웹사이트·서비스 등록 — 에이전트가 인지)
ipcMain.handle('services:list', () => loadConfig().services);
ipcMain.handle('services:add', (_e, s: { name: string; url: string; desc: string }) => {
  const c = loadConfig();
  const svc: Service = { id: 's' + Date.now(), name: (s.name || '').trim(), url: (s.url || '').trim(), desc: (s.desc || '').trim() };
  saveConfig({ services: [...c.services, svc] });
  return loadConfig().services;
});
ipcMain.handle('services:delete', (_e, id: string) => { saveConfig({ services: loadConfig().services.filter(x => x.id !== id) }); return loadConfig().services; });
// 🧭 비즈니스 인텔리전스 — 등록 서비스의 URL을 실제로 읽어와 스냅샷 (병렬)
ipcMain.handle('services:intel', async () => {
  const c = loadConfig();
  return await Promise.all(c.services.map(async (s) => {
    const type = /youtube\.com|youtu\.be/i.test(s.url) ? 'youtube' : (s.url ? 'web' : 'none');
    let snapshot = '';
    if (s.url) { try { snapshot = (await fetchUrl(s.url)).replace(/\s+/g, ' ').slice(0, 380); } catch { snapshot = '(읽지 못함)'; } }
    return { id: s.id, name: s.name, url: s.url, desc: s.desc, type, snapshot };
  }));
});

// 🔌 연동 (텔레그램·API키·PayPal)
ipcMain.handle('integrations:get', () => {
  const c = loadConfig();
  return { telegramToken: c.telegramToken, telegramChatId: c.telegramChatId, apiKeys: c.apiKeys || {}, paypalClientId: c.paypalClientId, paypalSecret: c.paypalSecret };
});
ipcMain.handle('integrations:save', (_e, patch: any) => { saveConfig(patch); return true; });

// 🔌 서비스 정의 기반 API 패널 (익스텐션과 동일 구조) — 자격증명을 apiConn 에 저장
ipcMain.handle('api:get', () => {
  const c = loadConfig();
  const conn = { ...(c.apiConn || {}) } as Record<string, Record<string, string>>;
  // 레거시 필드를 화면에 같이 보이도록 머지(이전에 저장한 값)
  conn.telegram = { TELEGRAM_BOT_TOKEN: c.telegramToken || '', TELEGRAM_CHAT_ID: c.telegramChatId || '', ...(conn.telegram || {}) };
  conn.paypal = { PAYPAL_CLIENT_ID: c.paypalClientId || '', PAYPAL_CLIENT_SECRET: c.paypalSecret || '', ...(conn.paypal || {}) };
  conn.gemini = { GEMINI_API_KEY: (c.apiKeys || {}).gemini || '', ...(conn.gemini || {}) };
  return conn;
});
ipcMain.handle('api:save', async (_e, serviceId: string, values: Record<string, string>) => {
  const c = loadConfig();
  const apiConn = { ...(c.apiConn || {}), [serviceId]: values };
  const patch: any = { apiConn };
  // 레거시 소비처(매출/텔레그램/제미나이)와 동기화 — 기존 기능 안 깨지게
  if (serviceId === 'paypal') { patch.paypalClientId = values.PAYPAL_CLIENT_ID || ''; patch.paypalSecret = values.PAYPAL_CLIENT_SECRET || ''; }
  if (serviceId === 'telegram') { patch.telegramToken = (values.TELEGRAM_BOT_TOKEN || '').trim(); patch.telegramChatId = (values.TELEGRAM_CHAT_ID || '').trim(); }
  if (serviceId === 'gemini') { patch.apiKeys = { ...(c.apiKeys || {}), gemini: values.GEMINI_API_KEY || '' }; }
  saveConfig(patch);
  // 텔레그램은 저장 시 실제 검증 + 챗ID 자동 감지
  if (serviceId === 'telegram') {
    const token = (values.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) return { ok: true, note: '저장됨 (토큰 비어있음)' };
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) return { ok: false, error: '봇 토큰 형식이 이상해요 (숫자:문자)' };
    try {
      await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 9000 });
      let chat = (values.TELEGRAM_CHAT_ID || '').trim();
      if (!chat) {
        const upd = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, { timeout: 9000 });
        const list = upd.data?.result || []; const last = list[list.length - 1];
        const cid = last?.message?.chat?.id; const cname = last?.message?.chat?.first_name || last?.message?.chat?.title || '';
        if (cid) { chat = String(cid); saveConfig({ telegramChatId: chat, apiConn: { ...apiConn, telegram: { ...values, TELEGRAM_CHAT_ID: chat } } });
          return { ok: true, note: `✅ 연결됨 — 📲 chat_id 자동 감지 (${cname})` }; }
        return { ok: true, note: '✅ 토큰 확인됨 — 봇한테 메시지 한 번 보내고 다시 저장하면 chat_id 자동 입력' };
      }
      return { ok: true, note: '✅ 연결됨' };
    } catch (e: any) { return { ok: false, error: e?.response?.data?.description || e?.message || '검증 실패' }; }
  }
  return { ok: true, note: '✅ 저장됨' };
});
ipcMain.handle('telegram:test', async () => {
  const c = loadConfig();
  if (!c.telegramToken || !c.telegramChatId) return { ok: false, reason: '봇 토큰과 챗 ID를 먼저 입력하세요' };
  try {
    await axios.post(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, { chat_id: c.telegramChatId, text: `✅ Connect AI 연결 완료 — ${c.agentName}가 인사드립니다, ${c.userTitle || '사장님'}!` }, { timeout: 9000 });
    return { ok: true };
  } catch (e: any) { return { ok: false, reason: e?.response?.data?.description || e?.message || '전송 실패' }; }
});

// 📊 대시보드 통계
ipcMain.handle('dashboard:stats', () => {
  const c = loadConfig();
  return { services: c.services.length, knowledge: noteCount(), tasks: taskCount(), approvals: approvalCount(), telegram: !!(c.telegramToken && c.telegramChatId), paypal: !!c.paypalClientId, apiKeys: Object.values(c.apiKeys || {}).filter(Boolean).length, company: c.company, agentName: c.agentName, model: c.llmModel || '자동' };
});

// 📋 태스크 보드
ipcMain.handle('tasks:list', () => listTasks());
ipcMain.handle('tasks:add', (_e, title: string) => addTask(title, { owner: 'user' }));
ipcMain.handle('tasks:done', (_e, id: string) => { setTaskStatus(id, 'done'); return listTasks(); });
ipcMain.handle('tasks:cancel', (_e, id: string) => { setTaskStatus(id, 'cancelled'); return listTasks(); });

// 🧬 장기 기억 (베타) — 지식 노트를 파인튜닝용 JSONL로 내보내기 (Unsloth/허깅페이스 학습용)
ipcMain.handle('brain:exportTraining', (_e, hf: { token?: string; model?: string }) => {
  if (hf) saveConfig({ hfToken: hf.token || '', hfModel: hf.model || '' });
  const notes = allNotes();
  if (!notes.length) return { ok: false, reason: '학습할 지식이 없어요. 먼저 단기 기억에 지식을 쌓으세요.' };
  const sys = '너는 사장님의 1인 기업 AI 비서다. 아래 지식을 체득해 답변에 활용한다.';
  const lines = notes.map(n => JSON.stringify({ messages: [
    { role: 'system', content: sys },
    { role: 'user', content: '내 사업/지식에 대해 기억하고 있는 것을 알려줘.' },
    { role: 'assistant', content: n.text },
  ] })).join('\n');
  const out = path.join(os.homedir(), 'Desktop', 'connect-ai-knowledge.jsonl');
  try { fs.writeFileSync(out, lines, 'utf8'); shell.showItemInFolder(out); return { ok: true, path: out, count: notes.length }; }
  catch (e: any) { return { ok: false, reason: e?.message || String(e) }; }
});

// ⚡ 단기 기억 = GitHub 동기화 / 🧬 장기 기억 = HuggingFace 업로드
const connOf = (svc: string) => (loadConfig().apiConn || {})[svc] || {};
const geminiKey = () => { const c = loadConfig(); return (c.apiConn?.gemini?.GEMINI_API_KEY) || (c.apiKeys?.gemini) || ''; };

// 🔌 EZERAI 브릿지 시작 — 웹 브레인팩 마켓이 :4825로 지식·스킬·템플릿·디자인을 주입
function startConnectBridge() {
  startBridge({
    status: () => { const c = loadConfig(); return { defaultModel: c.llmModel || '자동', brain: { fileCount: noteCount(), enabled: c.tools !== false } }; },
    workspace: () => loadConfig().workspace || defaultWorkspace(),
    addKnowledge: async (title: string, markdown: string) => {
      const text = `# ${title}\n${markdown}`.slice(0, 8000);
      let emb: number[] | null = null;
      try { const t = await detectTarget({ base: loadConfig().llmBase, model: loadConfig().llmModel, key: geminiKey() }); if (t) emb = await embed(t.base, text); } catch { /* 임베딩 없어도 키워드 RAG */ }
      brainAddNote(text, emb || undefined);
    },
    runExam: async (prompt: string) => {
      const c = loadConfig();
      const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() });
      if (!target) return '⚠️ AI 모델(LM Studio/Ollama)을 먼저 켜주세요.';
      try { return (await chat(target, agentPrompt(c.agentName, c.company, c.userTitle || '사장님'), prompt, { temperature: 0.5 })).trim(); } catch (e: any) { return `오류: ${e?.message || e}`; }
    },
    onInject: (kind: string, label: string, dir?: string) => {
      const emoji: any = { knowledge: '🧠', skill: '🐍', template: '📦', design: '🎨' };
      notify(`${emoji[kind] || '🔌'} EZERAI 주입`, `${label} — Connect AI에 들어왔어요`);
      win?.webContents.send('engine:event', { kind: 'status', text: `${emoji[kind] || '🔌'} EZERAI 브레인팩 주입: ${label}` });
      win?.webContents.send('bridge:inject', { kind, label, dir });   // 렌더러: 파일트리 새로고침 + FX
    },
  });
}
app.on('before-quit', stopBridge);
ipcMain.handle('github:push', async () => {
  const g = connOf('github');
  return await pushKnowledge(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO, allNotes());
});
ipcMain.handle('github:pull', async () => {
  const g = connOf('github');
  const r = await pullKnowledge(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO);
  if (!r.ok) return r;
  const added = importNotes(r.notes || []);
  return { ok: true, added, total: noteCount() };
});
ipcMain.handle('hf:upload', async () => {
  const h = connOf('huggingface');
  const notes = allNotes();
  if (!notes.length) return { ok: false, error: '학습할 지식이 없어요. 먼저 단기 기억에 쌓으세요.' };
  return await uploadDataset(h.HF_TOKEN, h.HF_REPO, notesToJsonl(notes));
});
ipcMain.handle('memstatus', () => {
  const g = connOf('github'), h = connOf('huggingface');
  return { githubRepo: g.GITHUB_DEFAULT_REPO || '', githubReady: !!(g.GITHUB_TOKEN && g.GITHUB_DEFAULT_REPO), hfRepo: h.HF_REPO || '', hfReady: !!(h.HF_TOKEN && h.HF_REPO), notes: noteCount() };
});

// 🔄 자동 루프 — 지식 쌓이면 GitHub 자동 커밋(디바운스) + 충분히 쌓이면 장기학습 추천 알림
let syncDebounce: NodeJS.Timeout | null = null;
function autoSyncSoon() { if (syncDebounce) clearTimeout(syncDebounce); syncDebounce = setTimeout(() => runAutoSync(), 30000); }
async function runAutoSync() {
  const c = loadConfig(); if (!c.autoSync) return;
  const g = connOf('github'); if (!(g.GITHUB_TOKEN && (g.GITHUB_DEFAULT_REPO || '').includes('/'))) return;
  const n = noteCount(); if (n <= (c.lastSyncCount || 0)) return;
  const r = await pushKnowledge(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO, allNotes());
  if (r.ok) { saveConfig({ lastSyncCount: n }); logDiag(`auto-sync ${n} notes → GitHub`); win?.webContents.send('engine:event', { kind: 'status', text: `🔄 지식 ${n}개 GitHub 자동 동기화 완료` }); }
}
function maybeLearnHint() {
  const c = loadConfig(); const h = connOf('huggingface');
  if (!(h.HF_TOKEN && h.HF_REPO)) return;
  const n = noteCount();
  if (n - (c.lastTrainHintCount || 0) >= 20) { saveConfig({ lastTrainHintCount: n }); notify('🧬 장기 학습 추천', `지식이 ${n}개 쌓였어요. 🧠 → 장기 기억에서 학습을 돌릴 때예요.`); }
}
function scheduleAuto() { setInterval(() => { runAutoSync(); maybeLearnHint(); }, 10 * 60 * 1000); }

// 📺 YouTube — Data API(채널·영상) + Analytics(OAuth)
ipcMain.handle('youtube:get', async () => {
  const y = connOf('youtube');
  const data = await fetchChannel(y.YOUTUBE_API_KEY, y.YOUTUBE_CHANNEL_ID);
  if (data.ok) {
    const o = connOf('youtube-oauth');
    if (o.YOUTUBE_OAUTH_CLIENT_ID && o.YOUTUBE_OAUTH_CLIENT_SECRET && o.YOUTUBE_OAUTH_REFRESH) {
      const at = await ytAccessToken(o.YOUTUBE_OAUTH_CLIENT_ID, o.YOUTUBE_OAUTH_CLIENT_SECRET, o.YOUTUBE_OAUTH_REFRESH);
      if (at) { const an = await fetchAnalytics(at); if (an.ok) data.analytics = an.analytics; }
    }
  }
  return data;
});
// OAuth 자동 연결 — 브라우저 동의 → 로컬 콜백서버(:5814) → refresh_token 저장
ipcMain.handle('youtube:oauth', async () => {
  const o = connOf('youtube-oauth');
  const clientId = o.YOUTUBE_OAUTH_CLIENT_ID, secret = o.YOUTUBE_OAUTH_CLIENT_SECRET;
  if (!clientId || !secret) return { ok: false, error: 'OAuth Client ID/Secret을 먼저 입력·저장하세요.' };
  const redirect = 'http://127.0.0.1:5814/yt-oauth-callback';
  const scope = 'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly';
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;
  return await new Promise((resolve) => {
    let done = false;
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/yt-oauth-callback')) { res.statusCode = 404; res.end(); return; }
      const code = new URL(req.url, redirect).searchParams.get('code');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<body style="background:#06100b;color:#00ff41;font-family:sans-serif;text-align:center;padding-top:80px"><h2>✅ YouTube 연결 완료</h2><p>이 창을 닫고 Connect AI로 돌아가세요.</p></body>');
      try { server.close(); } catch { /* */ }
      if (done) return; done = true;
      if (!code) return resolve({ ok: false, error: '인증 코드를 받지 못했어요.' });
      try {
        const tok = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }), { timeout: 15000 });
        const refresh = tok.data?.refresh_token;
        const c = loadConfig();
        saveConfig({ apiConn: { ...(c.apiConn || {}), 'youtube-oauth': { ...o, YOUTUBE_OAUTH_REFRESH: refresh || '' } } });
        notify('✅ YouTube 연결', '시청 지속률·트래픽 분석을 가져올 수 있어요.');
        resolve({ ok: !!refresh, error: refresh ? undefined : '리프레시 토큰을 못 받았어요. 동의 화면에서 모두 허용했는지 확인하세요.' });
      } catch (e: any) { resolve({ ok: false, error: e?.response?.data?.error_description || e?.message }); }
    });
    server.on('error', (e: any) => { if (!done) { done = true; resolve({ ok: false, error: `콜백 서버 오류(:5814): ${e?.message}` }); } });
    server.listen(5814, '127.0.0.1', () => shell.openExternal(authUrl));
    setTimeout(() => { try { server.close(); } catch { /* */ } if (!done) { done = true; resolve({ ok: false, error: '시간 초과(2분). 다시 시도하세요.' }); } }, 120000);
  });
});
// 🤝 specialist 실시간 데이터 — 에이전트가 일할 때 진짜 수치 주입
async function realtimeFor(agentId: string): Promise<string> {
  try {
    const c = loadConfig();
    if (agentId === 'youtube') {
      const y = (c.apiConn || {}).youtube || {};
      const d = await fetchChannel(y.YOUTUBE_API_KEY, y.YOUTUBE_CHANNEL_ID);
      if (d.ok) return `[내 유튜브 실데이터] ${d.channel.title} · 구독 ${d.channel.subs.toLocaleString()} · 조회수 ${d.channel.views.toLocaleString()} · 영상 ${d.channel.videos}개. 최근영상: ${(d.videos || []).slice(0, 3).map((v: any) => `${v.title}(${v.views}회)`).join(', ')}`;
    }
    if (agentId === 'business') {
      const rev = await fetchRevenue(c.paypalClientId, c.paypalSecret, { days: 30 });
      if (rev.data) { const cur = Object.keys(rev.data.totals.by_currency)[0]; const p = rev.data.totals.by_period; return `[내 매출 실데이터] 이번달 ${p.month?.toFixed(2)} · 7일 ${p.week?.toFixed(2)} (${cur || ''})`; }
    }
  } catch { /* */ }
  return '';
}
// 🚀 학습 노트북 생성 → GitHub 커밋 → Colab 원클릭 URL
ipcMain.handle('train:notebook', async () => {
  const c = loadConfig();
  // 내 학습 노트북이 설정돼 있으면 그걸 그대로 (데이터셋은 이미 HF에 올라가 있음)
  if ((c.trainNotebookUrl || '').startsWith('http')) return { ok: true, colab: c.trainNotebookUrl, note: '내 학습 노트북' };
  const g = connOf('github'), h = connOf('huggingface');
  const dataset = h.HF_REPO || '';
  if (!dataset.includes('/')) return { ok: false, error: '먼저 🗂️ 연동에서 HuggingFace 데이터셋 레포를 설정하고 🧬 업로드 하세요.' };
  if (!noteCount()) return { ok: false, error: '학습할 지식이 없어요. 먼저 단기 기억에 쌓고 업로드하세요.' };
  const owner = dataset.split('/')[0];
  const nb = buildNotebook(dataset, h.HF_BASE_MODEL || 'unsloth/gemma-2-2b-it-bnb-4bit', `${owner}/connect-ai-brain`);
  // GitHub 연결돼 있으면 커밋 → Colab 원클릭
  if (g.GITHUB_TOKEN && (g.GITHUB_DEFAULT_REPO || '').includes('/')) {
    const r = await pushFile(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO, 'connect-ai/train.ipynb', nb, '🚀 Connect AI 장기기억 학습 노트북');
    if (r.ok) { const [o, n] = g.GITHUB_DEFAULT_REPO.split('/'); return { ok: true, colab: `https://colab.research.google.com/github/${o}/${n}/blob/main/connect-ai/train.ipynb`, github: r.url }; }
  }
  // 폴백: 바탕화면 저장 + Colab 업로드 페이지
  const out = path.join(os.homedir(), 'Desktop', 'connect-ai-train.ipynb');
  try { fs.writeFileSync(out, nb, 'utf8'); shell.showItemInFolder(out); return { ok: true, local: out, colab: 'https://colab.research.google.com/#create=true', note: 'GitHub 미연결 — 바탕화면 노트북을 Colab에 업로드하세요.' }; }
  catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
});

// ✅ 승인 큐 — 승인 시 액션이 있으면 실제로 실행(에이전트 행동 = 돈 만들기)
async function executeAction(action: ApprovalAction): Promise<string> {
  const c = loadConfig();
  const ws = c.workspace || defaultWorkspace();
  try {
    if (action.kind === 'run') {
      const r = spawnSync(action.payload, { cwd: ws, shell: true, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      const out = [(r.stdout || '').trim(), (r.stderr || '').trim()].filter(Boolean).join('\n').slice(0, 2000);
      return `${out || '(출력 없음)'}\n[종료 코드 ${r.status ?? '?'}]`;
    }
    if (action.kind === 'write') {
      let p = (action.path || '').replace(/^~(?=\/|$)/, os.homedir()); if (!path.isAbsolute(p)) p = path.join(ws, p);
      fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, action.payload || '', 'utf8'); return `저장됨 → ${p}`;
    }
    if (action.kind === 'telegram') {
      const tg = (c.apiConn || {}).telegram || {}; const token = tg.TELEGRAM_BOT_TOKEN || c.telegramToken; const chat = tg.TELEGRAM_CHAT_ID || c.telegramChatId;
      if (!token || !chat) return '⚠️ 텔레그램 미설정 (🗂️ 연동에서 먼저 연결)';
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text: action.payload }, { timeout: 9000 });
      return '📨 텔레그램 전송 완료';
    }
    if (action.kind === 'email') {
      const e = (c.apiConn || {}).email || {};
      const [to, subject, ...rest] = action.payload.split('|').map(s => s.trim());
      const r = await sendEmail({ host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.SMTP_FROM }, to, subject || '', rest.join('|'));
      return r.ok ? `📧 이메일 전송 완료 → ${to}` : `⚠️ ${r.error}`;
    }
  } catch (e: any) { return `⚠️ 실행 실패: ${e?.message || e}`; }
  return '';
}
ipcMain.handle('approvals:list', () => listApprovals());
ipcMain.handle('approvals:approve', async (_e, id: string) => {
  const a = getApproval(id);
  let result = '';
  if (a?.action) result = await executeAction(a.action);
  setApprovalStatus(id, 'approved', result);
  if (a?.action) { win?.webContents.send('engine:event', { kind: 'tool', name: 'approve-done', path: result.slice(0, 60), ok: !result.startsWith('⚠️') }); notify('✅ 실행 완료', `${a.title} — ${result.slice(0, 100)}`); }
  return { list: listApprovals(), result };
});
ipcMain.handle('approvals:reject', (_e, id: string) => { setApprovalStatus(id, 'rejected'); return { list: listApprovals() }; });

// ─────────────────────────── 모델 목록 (LM Studio / Ollama 에서)
ipcMain.handle('models:list', async () => {
  const c = loadConfig();
  const local = await listModels({ base: c.llmBase, model: c.llmModel });
  // ☁️ Gemini 키가 있으면 클라우드 고성능 모델도 선택지에 추가
  const gem = geminiKey() ? ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'] : [];
  if (!local) return gem.length ? { base: c.llmBase || '', engine: 'gemini', models: gem, loaded: null } : null;
  return { ...local, models: [...local.models, ...gem.filter(g => !local.models.includes(g))] };
});

// ─────────────────────────── 광장 (Plaza)
ipcMain.handle('plaza:enter', async () => {
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured()) return { ok: false, reason: 'DB URL 미설정' };
  if (plaza) return { ok: true, already: true };

  const uid = 'desk-' + Buffer.from(app.getPath('userData')).toString('base64').slice(0, 8).replace(/[^a-z0-9]/gi, '');
  const emoji = c.plazaEmoji || '🖥️';
  const speaker = c.agentName || '에이전트';
  const me = { uid, company: c.company, emoji, agents: ['📺', '🎨', '💻', '📊', '✍️', '🔍'], source: 'connect-ai' as const };
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel });
  // 비서가 아니라 '학생'으로 토론 — 자기소개·"도와드릴게요" 멘트 방지
  const studentSys = `너는 'AI Agent University'의 똑똑한 학생 에이전트 '${speaker}'(소속: ${c.company})다. 토론에서 자기 생각을 당당하고 구체적으로 말한다. 너는 비서가 아니라 '학생'이다. 사장님 같은 표현, 자기소개, "도와드리겠습니다" 류 멘트는 절대 쓰지 않는다.`;

  // joinPlaza 는 프레즌스·표시 전용
  plaza = joinPlaza(me, (m: PlazaMessage) => { win?.webContents.send('plaza:peer', m); });

  // 자율 대화 루프 — 남이 마지막으로 말하면 그 흐름에 이어서 계속 응답
  if (target) {
    plazaAuto = startAutoChat({
      uid, target, sys: studentSys,
      makePrompt: (convo, topic) => `[오늘의 주제] ${topic || '자유 토론'}\n\n[최근 대화]\n${convo}\n\n너는 '${speaker}'. 위 '오늘의 주제'에서 절대 벗어나지 말고 토론을 이어가라. 앞 사람 문장을 그대로 따라하지 말고 [새 관점·구체 예시·반론·질문] 중 하나를 더해 주제를 깊게 파고들어라. 자기소개·비서멘트 금지. 짧고 또렷하게 한국어 1~2문장, 대사만.`,
      post: (t) => postPlazaMessage({ uid, company: c.company, emoji, role: speaker, text: t }),
    });
    // 등교 인사 한 줄
    (async () => {
      try {
        const hello = await chat(target, studentSys, `방금 'AI Agent University'에 등교했다. 친구들에게 건넬 짧고 산뜻한 등교 인사 한 문장(30자 이내). 장황한 소개 금지. 대사만.`, { temperature: 0.85 });
        const t = cleanLine(hello);
        if (t && plaza) await postPlazaMessage({ uid, company: c.company, emoji, role: speaker, text: t });
      } catch { /* */ }
    })();
  }

  return { ok: true, uid };
});

ipcMain.handle('plaza:leave', () => { plazaAuto?.(); plazaAuto = null; plaza?.stop(); plaza = null; demoAuto?.(); demoAuto = null; demoBot?.stop(); demoBot = null; return true; });

ipcMain.handle('plaza:send', async (_e, text: string) => {
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured()) return false;
  const uid = 'desk-' + Buffer.from(app.getPath('userData')).toString('base64').slice(0, 8).replace(/[^a-z0-9]/gi, '');
  await postPlazaMessage({ uid, company: c.company, emoji: c.plazaEmoji || '🖥️', role: c.agentName || '에이전트', text });
  return true;
});

ipcMain.handle('plaza:dburl', () => loadConfig().plazaDbUrl);

// 👥 친구 에이전트 (데모) — 혼자여도 대화가 보이게. 다른 정체성의 자율 에이전트.
ipcMain.handle('plaza:demobot', async (_e, on: boolean) => {
  if (!on) { demoAuto?.(); demoAuto = null; demoBot?.stop(); demoBot = null; return false; }
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured() || demoBot) return !!demoBot;
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel });
  const botUid = 'friend-bot-1';
  const persona = `너는 '넥서스 크리에이티브'의 똑똑하고 장난기 있는 AI Agent University 학생 '노바'다. 토론에서 위트있게 자기 생각을 말한다. 비서 아닌 학생. 자기소개·"도와드릴게요" 멘트 금지.`;
  const botPost = (t: string) => postPlazaMessage({ uid: botUid, company: '넥서스 크리에이티브', emoji: '🛰️', role: '노바', text: t });
  demoBot = joinPlaza({ uid: botUid, company: '넥서스 크리에이티브', emoji: '🛰️', agents: ['🎨', '💻', '📈'], source: 'connect-ai' }, () => { /* 표시 전용 */ });
  if (target) {
    demoAuto = startAutoChat({
      uid: botUid, target, sys: persona,
      makePrompt: (convo, topic) => `[오늘의 주제] ${topic || '자유 토론'}\n\n[최근 대화]\n${convo}\n\n노바로서 위 '오늘의 주제'에서 벗어나지 말고 이어가라. 앞 사람 말을 반복하지 말고 위트있게 [새 관점·반론·질문] 중 하나를 더해라. 자기소개 금지. 짧고 또렷하게 한국어 1~2문장, 대사만.`,
      post: botPost,
    });
    (async () => { try { const h = await chat(target, persona, '방금 AI Agent University에 등교했다. 짧고 발랄한 인사 한 문장(30자 이내). 대사만.', { temperature: 0.9 }); const t = cleanLine(h); if (t && demoBot) await botPost(t); } catch { /* */ } })();
  }
  return true;
});

// 📢 오늘의 주제 — '선생님'이 낸다. 내 에이전트와 다른 정체성이라 모든 에이전트(내 것 포함)가 반응함.
ipcMain.handle('plaza:topic', async (_e, topic: string) => {
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured()) return false;
  await postPlazaMessage({ uid: 'teacher-board', company: '선생님', emoji: '🧑‍🏫', role: '선생님',
    text: `📢 오늘의 주제: ${topic} — 다들 의견을 내고 함께 풀어봅시다!` });
  return true;
});

// 🧑‍🏫 선생님 채점 — 최근 토론을 보고 학생(회사)들을 채점, 우등생 발표
ipcMain.handle('plaza:grade', async () => {
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured()) return { ok: false, reason: 'DB 미설정' };
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel });
  if (!target) return { ok: false, reason: '모델 없음' };
  const recent = await fetchMessages();
  const convo = recent.slice(-16).filter(m => !/^🏆|^📢/.test(m.text)).map(x => `${x.company}: ${x.text}`).join('\n');
  if (!convo) return { ok: false, reason: '아직 토론이 없어요' };
  let parsed: any = null;
  try {
    const raw = await chat(target,
      '당신은 에이전트 아카데미의 선생님입니다. 학생(회사)들의 토론을 보고 누가 가장 통찰력 있고 똑똑했는지 냉정하게 채점합니다.',
      `[토론 내용]\n${convo}\n\n참여한 각 회사를 0~10점으로 채점하고 1위 우등생을 뽑으세요. 반드시 JSON만 출력:\n{"scores":[{"company":"이름","score":9,"reason":"15자 내 한줄평"}],"top":"우등생 회사명"}`,
      { temperature: 0.3 });
    const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null;
  } catch { /* 실패 */ }
  if (!parsed?.scores?.length) return { ok: false, reason: '채점 실패 — 다시 시도' };
  const scores = parsed.scores.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
  const top = parsed.top || scores[0]?.company;
  const uid = 'desk-' + Buffer.from(app.getPath('userData')).toString('base64').slice(0, 8).replace(/[^a-z0-9]/gi, '');
  await postPlazaMessage({ uid, company: c.company, emoji: '🧑‍🏫', role: '선생님',
    text: `🏆 오늘의 우등생: ${top}! · ${scores.map((s: any) => `${s.company} ${s.score}점`).join(' · ')}` });
  return { ok: true, scores, top };
});
