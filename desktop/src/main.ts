// Connect AI Desktop — Electron 메인 프로세스.
// 비서(영숙) 엔진 + 광장(Plaza) 연결을 IPC 로 렌더러에 노출.
import { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, Notification, nativeImage, desktopCapturer, screen, clipboard } from 'electron';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { talkToMyAgent, agentWithTools, ChatTurn, AGENT_CATEGORY } from './engine/company';
import { search as brainSearch } from './engine/brain';
import { quickIntent, planServe } from './engine/intent';
import { fetchRevenue } from './engine/paypal';
import { fetchTossRevenue, mergeRevenue } from './engine/toss';
import { detectTarget, chat, listModels, embed } from './engine/llm';
import { setBrainFile, allNotes, cosine, graph as brainGraph, addNote as brainAddNote, deleteNote, noteCount, importNotes, categoryStats, classify, CATEGORIES, type Category } from './engine/brain';
import { startBridge, stopBridge, bridgeStatus } from './engine/bridge';
import { startLocalEngine, stopLocalEngine, localStatus, LOCAL_BASE, setLocalOptions, getLocalOptions, onEngineStatus } from './engine/localengine';
import { searchGGUF, listGGUF, downloadGGUF, listLocalModels, deleteLocalModel, RECOMMENDED } from './engine/hfmodels';
import { autoUpdater } from 'electron-updater';
import { pushKnowledge, pullKnowledge, pushFile, importRepoMarkdown, listCommits, getRepoFile } from './engine/github';
import { encryptPack, decryptPack } from './engine/cryptopack';
import { uploadDataset, hfUsername, launchTrainingJob, launchJob, jobStatus, cancelJob } from './engine/hf';
import { buildNotebook } from './engine/train';
import { METHODS, buildMethodNotebook, buildSurgeryNotebook } from './engine/methods';
import { toConversationsJsonl, fallbackQuestion, trimAnswer, guessBase, nextModelName, noteTitle as dsTitle } from './engine/dataset';
import { sendEmail, fetchUnseen } from './engine/email';
import { fetchChannel, ytAccessToken, fetchAnalytics } from './engine/youtube';
import { setMcpConfig, testMcp, listMcpTools } from './engine/mcp';
import { fetchUrl, siteMeta } from './engine/web';
import { qwenTTS, localTTS } from './engine/tts';
import { edgeTTS } from './engine/edgetts';
import * as http from 'http';
import { setTaskFile, listTasks, addTask, setStatus as setTaskStatus, openTasks, taskCount } from './engine/tasks';
import { setApprovalFile, listApprovals, setApprovalStatus, pendingApprovals, approvalCount, getApproval, updateApprovalAction, addApproval, ApprovalAction } from './engine/approvals';
import { spawnSync, spawn, ChildProcess } from 'child_process';
import { agentPrompt } from './engine/persona';
import { AGENTS, AGENT_ORDER } from './agents';
import { joinPlaza, postPlazaMessage, setPlazaDbUrl, plazaConfigured, fetchMessages, fetchPresence, saveArchive, fetchArchive, putProfile, fetchProfile, PlazaSession, PlazaMessage } from './plaza';
import { startRemote, remoteInfo } from './engine/remote';
import { startRelay, relayPush, RelayDeps } from './engine/relay';

interface Service { id: string; name: string; url: string; desc: string; repo?: string; market?: string; price?: string }   // repo=깃허브 페어, market=타겟국가, price=가격
interface Config {
  company: string; agentName: string; userTitle: string; plazaEmoji: string; greeting: string; workspace: string; tools: boolean; agentModels?: Record<string, string>; agentNames?: Record<string, string>; agentImages?: Record<string, string>;
  voiceName: string; jarvis: boolean; plazaDbUrl: string; llmBase?: string; llmModel?: string; voice: boolean;
  services: Service[]; telegramToken: string; telegramChatId: string; telegramApprovals?: boolean; emailAutoReply?: boolean; apiKeys: Record<string, string>; paypalClientId: string; paypalSecret: string; tossSecretKey: string;
  apiConn: Record<string, Record<string, string>>;   // 🔌 서비스별 자격증명 (telegram/youtube/paypal/toss/gemini/…)
  briefingOn: boolean; briefingHour: number; briefingMin: number; lastBriefing: string;   // 📋 아침 브리핑(능동성)
  trainNotebookUrl: string;                                          // 🚀 내 학습 노트북(Colab/GitHub) URL
  autoSync: boolean; lastSyncCount: number; lastTrainHintCount: number;   // 🔄 자동 루프(GitHub 자동 커밋 + 학습 추천)
  lastCloudTrainAt?: number; cloudJob?: any; trainBaseModel?: string; brainModelName?: string;   // ☁️ 클라우드 학습(HF Jobs)
  gpuUsage?: { month: string; train: number; surgery: number };   // 🔒 GPU 기능 월 사용량 (학습·수술 각각 월 3회)
  stats?: { trains: number; datasets: number; fusions: number };   // 🎒 누적 전적 — 학습(레벨업)·데이터셋·합성 횟수 (인벤토리/광장 프로필용)
  createdModels?: Record<string, { id: string; name?: string; avatar?: string; personality?: string; method?: 'train' | 'fusion'; baseModel?: string; createdAt?: number }>;   // 🧬 내 AI 팀 — 학습·합성으로 만든 모델 캐릭터(이름·얼굴·성격)
  trainBackendUrl?: string; installId?: string;   // ☁️ 학습 서비스 백엔드(있으면 토큰 없이 그쪽으로) + 익명 식별자
  firebaseApiKey?: string; firebaseDbUrl?: string; auth?: { uid: string; email: string; refreshToken: string };   // 👤 회원(Firebase Auth)
  mcpConfig: any;   // 🔌 MCP 서버 설정 ({ mcpServers: {...} })
  voiceQuality: string;   // 🔊 'browser'(기본·빠름) | 'qwen'(Qwen3-TTS 고품질·클라우드)
  officeVoice?: boolean;  // 🎭 사무실 에이전트 음성 대화 (자비스처럼 서로 말함)
  monitorOn?: boolean;    // 🛰️ 상시 자산 감시 (구독·매출·커밋·메일 변화 → 폰 보고)
  onboarded?: boolean;    // 🚀 첫 실행 온보딩 완료 여부
  openOfficeOnLaunch?: boolean;   // 🏢 앱 켤 때 가상 사무실 창도 같이 띄우기 (기본 켜짐)
  remotePair?: string;    // 🌍 외부 리모컨 페어링 코드 (RTDB 릴레이 경로)
  qwenVoice: string;      // 🎤 Qwen3-TTS 음성 (Sohee=한국어 등)
  ttsLocalUrl: string;    // 🖥️ 로컬 Qwen3-TTS 서버 주소 (완전 로컬·무료)
  localModelPath: string; // 🧠 내장 추론 모델(GGUF) 경로 — 있으면 LM Studio 없이 앱이 직접 실행
  modelsDirOverride?: string; // 📁 모델 다운로드 저장 폴더(비우면 기본 userData/models). 윈도우 C: 용량 회피용
  localAuto: boolean;     // 부팅 시 내장 엔진 자동 시작
  localFlashAttn: boolean; // ⚡ Flash Attention (속도)
  localCtxSize: number;    // 📏 대화 기억 길이(컨텍스트 토큰)
  localTemp: number;       // 🌡️ 창의성(temperature)
  localMaxTokens: number; localTopP: number; localTopK: number; localMinP: number; localRepeatPenalty: number;   // 샘플링
  localFreqPenalty: number; localPresPenalty: number; localRepeatLastN: number;
}
const DEFAULTS: Config = {
  company: '1인 기업', agentName: '에이전트', userTitle: '사장님', plazaEmoji: '🖥️', greeting: '', workspace: '', tools: true,
  voiceName: '', jarvis: false, plazaDbUrl: '', llmBase: '', llmModel: '', voice: false,
  services: [], telegramToken: '', telegramChatId: '', apiKeys: {}, paypalClientId: '', paypalSecret: '', tossSecretKey: '',
  apiConn: {},
  briefingOn: true, briefingHour: 9, briefingMin: 0, lastBriefing: '', trainNotebookUrl: '',
  autoSync: true, lastSyncCount: 0, lastTrainHintCount: 0, mcpConfig: {}, voiceQuality: 'browser', qwenVoice: 'Sohee', ttsLocalUrl: '',
  openOfficeOnLaunch: true,
  localModelPath: '', localAuto: true, localFlashAttn: true, localCtxSize: 8192, localTemp: 0.7,
  localMaxTokens: 1024, localTopP: 0.9, localTopK: 40, localMinP: 0.05, localRepeatPenalty: 1.1,
  localFreqPenalty: 0, localPresPenalty: 0, localRepeatLastN: 64,
};
const defaultWorkspace = () => path.join(os.homedir(), 'Desktop');

let cfgPath = '';
function loadConfig(): Config {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; }
  catch {
    // 🛟 본 설정 손상 시 직전 백업에서 복구 시도 — 토큰·연동·키 전체가 조용히 사라지는 것 방지
    try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath + '.bak', 'utf8')) }; } catch { return { ...DEFAULTS }; }
  }
}
function saveConfig(patch: Partial<Config>): Config {
  const next = { ...loadConfig(), ...patch };
  try {
    const json = JSON.stringify(next, null, 2);
    if (json.length > 5_000_000) return next;   // 🛡️ 비정상적으로 큰 설정(손상/폭주)은 기록 거부 — 디스크/로드 폭주 방지
    // 원자적 쓰기: tmp 에 먼저 쓰고 rename (중간 크래시로 인한 반쪽 파일 방지). 직전 정상본은 .bak 로 보존.
    const tmp = cfgPath + '.tmp';
    fs.writeFileSync(tmp, json);
    try { const cur = fs.readFileSync(cfgPath, 'utf8'); JSON.parse(cur); fs.writeFileSync(cfgPath + '.bak', cur); } catch { /* 현재본 없음/손상 → 백업 갱신 생략 */ }
    fs.renameSync(tmp, cfgPath);
  } catch { /* ignore */ }
  return next;
}

let win: BrowserWindow | null = null;
let plaza: PlazaSession | null = null;
let plazaPresenceTimer: ReturnType<typeof setInterval> | null = null;
let plazaHarvestTimer: ReturnType<typeof setInterval> | null = null;
let plazaHarvestBuf: PlazaMessage[] = [];   // 🧠 광장에서 들은 다른 AI 발언 (지식 수확 대기)
let plazaLearnedToday = 0;                   // 오늘 광장에서 배운 지식 수 (브리핑용)
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
// 🛡️ 전역 예외 — 메인 프로세스가 조용히 죽지 않게: 로그 남기고 사용자에게 원인을 보여준다 (윈도우 "아무 동작 없이 종료" 방지)
logDiag(`=== 앱 시작 v${app.getVersion?.() || '?'} · ${process.platform} ${process.arch} · electron ${process.versions.electron} ===`);
process.on('uncaughtException', (e: any) => {
  logDiag(`FATAL uncaughtException: ${e?.stack || e?.message || e}`);
  try { dialog.showErrorBox('Connect AI 오류', `${e?.message || e}\n\n진단 로그: ${diagPath()}\n(이 경로를 캡처해 보내주시면 빠르게 고칠게요)`); } catch { /* */ }
});
process.on('unhandledRejection', (r: any) => { logDiag(`unhandledRejection: ${r?.stack || r?.message || r}`); });
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
function startAutoChat(opts: { uid: string; target: any; sys: string; makePrompt: (convo: string, topic: string) => string; post: (t: string) => Promise<any>; maxTurns?: number; recall?: boolean }): () => void {
  let replying = false, turns = 0, seenTopic = '', lastSpokeAt = 0, totalTurns = 0;
  const max = opts.maxTurns ?? 12;
  const HARD_CAP = 200;   // 🔒 토픽이 바뀌어도 리셋되지 않는 세션 전체 상한 — 자동대화(LLM+RTDB) 폭주·비용 방지([[feedback_gcp_cost_incident]])
  const iv = setInterval(async () => {
    if (replying || !opts.target) return;
    if (totalTurns >= HARD_CAP) return;   // 전체 상한 도달 → 정지(사람이 다시 입장/시작하면 새 세션으로 리셋)
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
      // 🧠 Memory Stream (Generative Agents) — 내 에이전트는 발언 전에 두뇌에서 관련 과거 기억을 검색(RAG)해 떠올린다
      let recalled = '';
      if (opts.recall) {
        try {
          const q = topicText || (curLast?.text || '').slice(0, 60);
          const hits = q ? brainSearch(q, 3) : [];
          if (hits.length) recalled = `\n\n[💭 내가 예전에 배운 것 — 떠올려서 자연스럽게 녹여라(인용X)]\n${hits.map((h: any) => '· ' + (h.text || '').replace(/^[🏛️💡]\s*/, '').slice(0, 90)).join('\n')}`;
        } catch { /* 기억 없으면 그냥 진행 */ }
      }
      // 턴마다 다른 관점 강제 → 같은 말 반복(degeneration) 방지
      const angles = ['구체적인 실제 사례를 들어', '앞 사람 주장에 반론을 제기하며', '실생활·비즈니스 적용 관점에서', '다른 분야(과학·역사·예술)와 연결해', '핵심을 찌르는 질문을 던지며', '정반대 입장에서'];
      const prompt = `${opts.makePrompt(convo, topicText)}${recalled}\n\n[이번 발언 지시] ${angles[turns % angles.length]} 말하라. 앞에 이미 나온 문장을 절대 그대로 반복하지 말 것.`;
      const t = cleanLine(await chat(opts.target, opts.sys, prompt, { temperature: 0.9, frequencyPenalty: 0.6, presencePenalty: 0.5 }));
      if (t) { await opts.post(t); lastSpokeAt = Date.now(); turns++; totalTurns++; }
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
  win.once('ready-to-show', () => {
    try { win?.show(); } catch { /* */ }
    // 🏢 앱 켜면 가상 사무실 창도 옆에 같이 — 끄려면 트레이 메뉴(기본 켜짐)
    try { if (loadConfig().openOfficeOnLaunch !== false) setTimeout(() => { try { openOfficeWindow(); } catch { /* */ } }, 700); } catch { /* */ }
  });
  // 안전장치: ready-to-show 가 안 떠도 4초 뒤 강제로 보여줌 (영영 흰 화면/숨김 방지)
  setTimeout(() => { try { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); } catch { /* */ } }, 4000);
  win.webContents.on('did-fail-load', (_e, code, desc, url) => { logDiag(`did-fail-load: ${code} ${desc} ${url}`); try { win?.show(); } catch { /* */ } });
  win.webContents.on('unresponsive', () => logDiag('renderer unresponsive'));
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // 닫으면 종료가 아니라 트레이로 숨김 (자는 동안 도는 회사 — 상주)
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide(); try { if (officeWin && !officeWin.isDestroyed()) officeWin.hide(); } catch { /* */ } if (process.platform === 'darwin') app.dock?.hide(); } });   // 🏢 사무실 창도 같이 숨김(혼자 떠있지 않게)
  if (SAFE_MODE) logDiag('실행: 안전 모드(GPU 끄기)');
}
function showWindow() { if (!win || win.isDestroyed()) createWindow(); else { win.show(); win.focus(); } try { if (officeWin && !officeWin.isDestroyed()) officeWin.show(); } catch { /* */ } if (process.platform === 'darwin') app.dock?.show(); }   // 🏢 숨겼던 사무실 창도 같이 복귀

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
    { label: '🪟 가상 사무실 창 열기', click: () => { try { openOfficeWindow(); } catch { /* */ } } },
    { label: '📋 오늘 브리핑 받기', click: () => runBriefing(true) },
    { label: '➕ 새 대화', click: () => { showWindow(); win?.webContents.send('tray:newchat'); } },
    { type: 'separator' },
    { label: '켤 때 사무실 창 같이 열기', type: 'checkbox', checked: loadConfig().openOfficeOnLaunch !== false,
      click: (item) => { saveConfig({ openOfficeOnLaunch: item.checked }); } },
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
      plazaLearnedToday ? `🧠 어젯밤 광장에서 다른 회사 AI들과 토론하며 ${plazaLearnedToday}가지를 새로 배웠음 (두뇌에 각인됨)` : '',
    ].filter(Boolean).join('\n');
    const title = c.userTitle || '사장님';
    const user = `${title}께 드리는 **아침 브리핑**을 작성해줘.\n\n[현재 상황]\n${ctx}\n\n형식: 따뜻한 한 줄 인사 → 오늘 핵심 3가지(우선순위) → 추천 액션 1개. 너무 길지 않게, ${title}이(가) 바로 움직일 수 있게.\n\n⚠️ 이건 읽어주는 브리핑이야. 도구·함수·<태그>·코드는 절대 쓰지 말고 순수 한국어 문장으로만 작성해.`;
    notify('📋 브리핑 준비 중…', `${c.agentName}가 오늘 할 일을 정리하고 있어요.`);
    let text = '';
    try { text = await chat(target, agentPrompt(c.agentName, c.company, title), user, { temperature: 0.6 }); } catch (e: any) { text = `브리핑 생성 중 문제가 생겼어요. (${e?.message || e})`; }
    // 🛡️ 브리핑에 도구 태그가 새면(모델이 멋대로) 그 지점부터 잘라냄 — 정보 전달용이라 실행 안 함
    text = text.replace(/(제가\s*바로\s*실행[^\n]*)?<\/?(write_file|run|read_file|list_dir|find|web_search|fetch_url|mcp|tool)[\s\S]*$/i, '').trim();
    text = text.trim();
    saveConfig({ lastBriefing: todayStr() });
    showWindow();
    win?.webContents.send('briefing:show', text);
    const firstLine = text.replace(/[#*`]/g, '').split('\n').filter(Boolean)[0] || '오늘의 브리핑이 도착했어요.';
    notify('📋 아침 브리핑', firstLine.slice(0, 120));
    // 📱 폰으로도 — 브리핑 보내고 곧장 오늘의 작전 제안까지 (아침에 번호만 답하면 회사가 돈다)
    const cc = loadConfig();
    if (cc.telegramToken && cc.telegramChatId) {
      tgSend(`📋 아침 브리핑\n\n${text.replace(/[#*`]/g, '').slice(0, 1500)}`).then(() => tgRunOps()).catch(() => undefined);
    }
    plazaLearnedToday = 0;   // 브리핑에 반영했으니 리셋
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
  loadOpsState();   // 🤖 자율 운영 상태 복원
  try { setMcpConfig(loadConfig().mcpConfig); } catch { /* */ }
  createWindow();
  buildTray();
  scheduleBriefing();
  scheduleAuto();
  // 🤖 사이클은 사람이 시작/다음을 누르는 수동형 → 재시작 후 자동 실행하지 않음(중간 실행상태만 정리)
  if (opsState.executing || opsState.phase === 'executing') { opsState.executing = false; opsState.phase = opsState.actions.length ? 'review' : 'idle'; }
  setInterval(tgTick, 3000);   // 📲 텔레그램 결재 브리지 폴링(승인 푸시 + 답장 처리)
  setInterval(() => { mailTick().catch(() => {}); }, 60000);   // 📥 이메일 자동 답장 폴링(60초)
  setInterval(() => { monitorTick().catch(() => { /* */ }); }, 60 * 60 * 1000);   // 🛰️ 자산 감시(1시간) — 변화를 폰으로
  setTimeout(() => { monitorTick().catch(() => { /* */ }); }, 90 * 1000);          // 시작 90초 후 첫 스냅샷
  startConnectBridge();   // 🔌 EZERAI ↔ Connect AI 두뇌 브릿지 (:4825)
  startPhoneRemote();     // 📱 폰 웹 리모컨 (:4830) — 같은 와이파이에서 브라우저로 지휘
  // 🧠 내장 추론 엔진 — 설정에 모델이 있으면 부팅 시 자동 시작(LM Studio 없이 동작)
  setTimeout(() => { const c = loadConfig(); if (c.localAuto && c.localModelPath && fs.existsSync(c.localModelPath)) bootLocalEngine(c.localModelPath); }, 1500);
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

// ─────────────────────────── 🧠 내장 추론 엔진 + 🤗 HuggingFace 모델 (LM Studio 불필요)
const modelsDir = () => {
  const o = (loadConfig().modelsDirOverride || '').trim();   // 📁 사용자가 다른 드라이브/폴더로 바꿨으면 거기로 (윈도우 C: 용량 회피)
  if (o) { try { fs.mkdirSync(o, { recursive: true }); return o; } catch { /* 권한·경로 문제면 기본으로 폴백 */ } }
  return path.join(app.getPath('userData'), 'models');
};
const sendLocal = (s: any) => { try { win?.webContents.send('local:status', s); } catch { /* */ } try { if (officeWin && !officeWin.isDestroyed()) officeWin.webContents.send('local:status', s); } catch { /* */ } };   // 🏢 사무실 창 'Brain' 배지도 갱신되게
onEngineStatus((s) => sendLocal(s));   // 🔁 GPU→CPU 폴백 등 엔진 진행 상황을 실시간으로 화면에 표시
async function bootLocalEngine(modelPath: string) {
  const c = loadConfig(); setLocalOptions({ flashAttn: c.localFlashAttn, ctxSize: c.localCtxSize, temp: c.localTemp, maxTokens: c.localMaxTokens, topP: c.localTopP, topK: c.localTopK, minP: c.localMinP, repeatPenalty: c.localRepeatPenalty, freqPenalty: c.localFreqPenalty, presPenalty: c.localPresPenalty, repeatLastN: c.localRepeatLastN });
  try { sendLocal({ ...localStatus(), loading: true }); await startLocalEngine(modelPath); saveConfig({ localModelPath: modelPath }); sendLocal(localStatus()); }
  catch (e: any) { sendLocal({ ...localStatus(), loading: false, error: String(e?.message || e) }); }
}
ipcMain.handle('local:status', () => localStatus());
ipcMain.handle('local:base', () => LOCAL_BASE);
ipcMain.handle('local:start', async (_e, modelPath: string) => { await bootLocalEngine(modelPath); return localStatus(); });
ipcMain.handle('local:stop', async () => { await stopLocalEngine(); saveConfig({ localModelPath: '' }); const s = localStatus(); sendLocal(s); return s; });
ipcMain.handle('local:models', () => listLocalModels(modelsDir()));
ipcMain.handle('local:modelsDir', () => ({ dir: modelsDir(), custom: !!(loadConfig().modelsDirOverride || '').trim() }));   // 📁 현재 모델 저장 폴더
ipcMain.handle('local:pickModelsDir', async () => {   // 📁 다른 드라이브/폴더로 변경 (윈도우 C: 꽉 찰 때 D: 등으로)
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: '모델을 저장할 폴더 선택 (예: D:\\ConnectAI-모델)' });
  if (r.canceled || !r.filePaths[0]) return { dir: modelsDir(), custom: !!(loadConfig().modelsDirOverride || '').trim() };
  let dir = r.filePaths[0];
  try { if (!/(models|모델)$/i.test(dir)) { dir = path.join(dir, 'ConnectAI-models'); } fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); }
  catch (e: any) { return { error: `이 폴더에 쓸 수 없어요: ${e?.message || e}` }; }
  saveConfig({ modelsDirOverride: dir });
  return { dir, custom: true };
});
ipcMain.handle('local:openModelsDir', () => { try { shell.openPath(modelsDir()); return true; } catch { return false; } });
ipcMain.handle('local:resetModelsDir', () => { saveConfig({ modelsDirOverride: '' }); return { dir: modelsDir(), custom: false }; });
ipcMain.handle('local:options', () => getLocalOptions());
ipcMain.handle('local:setOptions', async (_e, o: any) => {
  const prev = getLocalOptions(); setLocalOptions(o); const g = getLocalOptions();
  saveConfig({ localFlashAttn: g.flashAttn, localCtxSize: g.ctxSize, localTemp: g.temp, localMaxTokens: g.maxTokens, localTopP: g.topP, localTopK: g.topK, localMinP: g.minP, localRepeatPenalty: g.repeatPenalty, localFreqPenalty: g.freqPenalty, localPresPenalty: g.presPenalty, localRepeatLastN: g.repeatLastN });
  const needReload = (o.flashAttn !== undefined && o.flashAttn !== prev.flashAttn) || (o.ctxSize !== undefined && o.ctxSize !== prev.ctxSize);
  const s = localStatus();
  if (needReload && s.running && s.modelPath) { sendLocal({ ...s, loading: true }); try { await startLocalEngine(s.modelPath, true); } catch { /* */ } sendLocal(localStatus()); }
  return getLocalOptions();
});
ipcMain.handle('local:delete', async (_e, p: string) => { if (loadConfig().localModelPath === p) { await stopLocalEngine(); saveConfig({ localModelPath: '' }); sendLocal(localStatus()); } return deleteLocalModel(p); });
ipcMain.handle('hf:recommended', () => RECOMMENDED);
ipcMain.handle('hf:search', async (_e, q: string) => { try { return { ok: true, models: await searchGGUF(q) }; } catch (e: any) { return { ok: false, error: String(e?.message || e) }; } });
// 🔍 HF 모델 검색 — 수술실에서 합칠 모델(gemma·llama 등) 찾기 (전체 모델, GGUF 아님)
ipcMain.handle('hf:searchModels', async (_e, q: string) => {
  if (!q || q.trim().length < 2) return { ok: true, models: [] };
  try {
    const r: any = await axios.get(`https://huggingface.co/api/models?search=${encodeURIComponent(q.trim())}&limit=24&sort=downloads&direction=-1`, { timeout: 12000 });
    const models = (r.data || []).map((m: any) => m.id || m.modelId).filter(Boolean);
    return { ok: true, models };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
});
// 🧬 내가 만든 인공지능 — 내 HF 계정의 모델(학습·수술 결과). 수술실에서 다시 합치기
ipcMain.handle('hf:myModels', async () => {
  const h = connOf('huggingface');
  if (!h.HF_TOKEN) return { ok: false, error: '🗂️ 연동 → HuggingFace에 토큰을 먼저 넣어주세요.' };
  try {
    const me = await hfUsername(h.HF_TOKEN);
    if (!me) return { ok: false, error: 'HF 토큰 확인 실패' };
    const r: any = await axios.get(`https://huggingface.co/api/models?author=${encodeURIComponent(me)}&limit=100&full=false`, { headers: { Authorization: `Bearer ${h.HF_TOKEN}` }, timeout: 15000 });
    const models = (r.data || []).map((m: any) => m.id || m.modelId).filter(Boolean).sort();
    return { ok: true, me, models };
  } catch (e: any) { return { ok: false, error: e?.response?.data?.error || e?.message || String(e) }; }
});
ipcMain.handle('hf:files', async (_e, repo: string) => {
  try {
    const files = await listGGUF(repo);
    // 🧩 내가 학습한 모델은 보통 safetensors라 GGUF가 없음 → 다운로드가 '안 되는' 게 아니라 변환이 필요
    const hint = files.length ? '' : '이 저장소엔 실행용 GGUF 파일이 없어요. 직접 학습한 모델이면 GGUF로 변환해야 앱에서 켤 수 있어요 (영상의 변환 단계 참고). 비공개 저장소면 🤗 연동에 HF 토큰을 넣어주세요.';
    return { ok: true, files, hint };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
});
ipcMain.handle('hf:download', async (_e, repo: string, file: string) => {
  try { const p = await downloadGGUF(repo, file, modelsDir(), (pr) => { try { win?.webContents.send('hf:progress', { repo, file, ...pr }); } catch { /* */ } }); return { ok: true, path: p }; }
  catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
});
app.on('before-quit', () => { stopLocalEngine(); });

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
ipcMain.handle('update:install', () => {
  quitting = true;   // ⚠️ 상주형 close 가드 해제
  // 상주 서버·자식 프로세스를 먼저 닫아야 프로세스가 깨끗이 종료돼 설치·재실행이 됨 (안 그러면 앱만 꺼지고 새버전 실행 안 됨)
  try { stopBridge(); } catch { /* */ }
  try { stopLocalEngine(); } catch { /* */ }
  try { killTerm(); } catch { /* */ }
  try { tray?.destroy(); } catch { /* */ }
  setTimeout(() => { try { autoUpdater.quitAndInstall(false, true); } catch { /* */ } }, 400);   // isForceRunAfter=true → 설치 후 자동 재실행
});
// 엔진 이벤트를 메인+사무실 창 둘 다에 (사무실 창이 살아 움직이게)
const emitEngine = (ev: any) => { try { win?.webContents.send('engine:event', ev); } catch { /* */ } try { if (officeWin && !officeWin.isDestroyed()) officeWin.webContents.send('engine:event', ev); } catch { /* */ } };
// ✈️ 텔레그램 sendMessage — 한 곳에서(발송·테스트·승인실행·결재 브리지가 공유)
const tgPost = (token: string, chat: string, text: string) => axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text: text || '(빈 메시지)' }, { timeout: 9000 });
// 🌐 URL을 "확실히 눈앞에" 열기 — 맥은 open(브라우저를 전면 활성화), 그 외는 openExternal.
//    결과물이 뒤 창에 숨어서 "안 열린 줄" 아는 일 방지.
function openUrlFront(url: string) {
  try {
    if (process.platform === 'darwin') { spawn('open', [url], { detached: true, stdio: 'ignore' }).unref(); return; }
  } catch { /* 폴백 */ }
  shell.openExternal(url);
}
async function loadRevenue() {
  postRevenue({ type: 'state', loading: true, error: null, data: null });
  const c = loadConfig();
  const g = connOf('github'), y = connOf('youtube');
  const [state, services, yt, gh] = await Promise.all([
    Promise.all([   // 💰 PayPal + 💳 토스 → 하나로 합쳐 대시보드·분석에 전달
      fetchRevenue(c.paypalClientId, c.paypalSecret, { days: 30 }).catch((e: any) => ({ type: 'state', loading: false, error: String(e?.message || e), data: null } as any)),
      c.tossSecretKey ? fetchTossRevenue(c.tossSecretKey, { days: 30 }).catch((e: any) => ({ type: 'state', loading: false, error: String(e?.message || e), data: null } as any)) : Promise.resolve(null),
    ]).then(mergeRevenue),
    Promise.all((c.services || []).map(async (s) => {
      const m = s.url ? await siteMeta(s.url).catch(() => ({ title: '', image: '', favicon: '', text: '' })) : { title: '', image: '', favicon: '', text: '' };
      return {
        name: s.name, url: s.url, desc: s.desc,
        type: /youtube\.com|youtu\.be/i.test(s.url) ? 'youtube' : 'web',
        snapshot: (m.text || '').replace(/\s+/g, ' ').slice(0, 200), image: m.image || '', favicon: m.favicon || '', siteTitle: m.title || '',
      };
    })),
    fetchChannel(y.YOUTUBE_API_KEY, y.YOUTUBE_CHANNEL_ID).catch(() => null),   // 📺 유튜브 채널·영상
    listCommits(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO || '', 40).catch(() => null),   // ⚡ 깃허브 개발 활동
  ]);
  (state as any).services = services;
  (state as any).youtube = (yt && (yt as any).ok) ? yt : null;
  (state as any).github = (gh && (gh as any).ok) ? gh : null;
  (state as any).ops = opsPublic();   // 🤖 자율 운영 현황(지금 일하는 에이전트·작전)
  postRevenue(state);
}
ipcMain.handle('revenue:open', () => { openRevenueWindow(); return true; });
ipcMain.handle('revenue:ready', () => { loadRevenue(); return true; });
ipcMain.handle('revenue:refresh', () => { loadRevenue(); return true; });
ipcMain.handle('revenue:openSettings', () => { win?.focus(); return true; });

// ───────── 🤖 자율 운영 — 비즈니스 에이전트가 실데이터를 분석해 작전(할 일) 생성, N시간 반복 ─────────
interface OpsScan { agent: string; label: string; ok: boolean; }
interface OpsAction { title: string; agent: string; risk: 'money' | 'post' | 'deploy' | 'safe'; assignee?: 'agent' | 'human'; }   // assignee: 에이전트가 할 일 vs 사장님만 할 수 있는 일
interface OpsShip { title: string; agent: string; result: string; artifacts: string[]; ok: boolean; ts: number; files?: string[]; }   // files: 파이프라인용 실제 파일 경로
type OpsPhase = 'idle' | 'planning' | 'review' | 'executing' | 'done';
interface OpsFeedItem { icon: string; text: string; agent: string; ok: boolean; ts: number; }
interface OpsFeedback { title: string; good: boolean; cycle: number; ts: number; }   // 👍/👎 — 다음 사이클 플랜의 보상신호(강화학습 루프)
interface OpsState { running: boolean; phase: OpsPhase; cycle: number; startedAt: number; lastRun: number; runs: number; busy: boolean; executing: boolean; activity: string; executingTitle: string; summary: string; scan: OpsScan[]; actions: OpsAction[]; shipped: OpsShip[]; feed: OpsFeedItem[]; feedback: OpsFeedback[]; }
let opsState: OpsState = { running: false, phase: 'idle', cycle: 0, startedAt: 0, lastRun: 0, runs: 0, busy: false, executing: false, activity: '', executingTitle: '', summary: '', scan: [], actions: [], shipped: [], feed: [], feedback: [] };
const opsFile = () => path.join(app.getPath('userData'), 'ops.json');
function loadOpsState() { try { const s = JSON.parse(fs.readFileSync(opsFile(), 'utf8')); opsState = { ...opsState, ...s, busy: false }; } catch { /* */ } }
function saveOpsState() { try { fs.writeFileSync(opsFile(), JSON.stringify(opsState)); } catch { /* */ } }
const opsPublic = () => ({ ...opsState });
// 📡 모든 창이 같은 운영 상태를 본다 — 메인 창 + 대시보드에 동시 전송 (단절 금지)
const opsBroadcast = () => {
  const s = opsPublic();
  try { win?.webContents.send('ops:update', s); } catch { /* */ }
  try { if (revenueWin && !revenueWin.isDestroyed()) revenueWin.webContents.send('ops:update', s); } catch { /* */ }
  try { if (officeWin && !officeWin.isDestroyed()) officeWin.webContents.send('ops:update', s); } catch { /* */ }   // 🏢 사무실 창에도 — 캐릭터 옆에서 작업 로그가 흐른다
  try { relayPush(remoteDeps); } catch { /* */ }   // 🌍 외부 폰 리모컨(RTDB)에도 즉시 반영
};
const opsEmit = () => { opsBroadcast(); if (revenueWin && !revenueWin.isDestroyed()) loadRevenue(); };
// 가벼운 즉시 전송 — 도구 사용 한 번마다 호출해도 부담 없게(데이터 재수집 없이 상태만)
const opsEmitLight = opsBroadcast;
const fmtN = (n: number) => Math.round(n || 0).toLocaleString();

async function gatherOps() {
  const c = loadConfig();
  const g = connOf('github'), y = connOf('youtube');
  const [rev, yt, gh] = await Promise.all([
    Promise.all([
      fetchRevenue(c.paypalClientId, c.paypalSecret, { days: 30 }).catch(() => null),
      c.tossSecretKey ? fetchTossRevenue(c.tossSecretKey, { days: 30 }).catch(() => null) : Promise.resolve(null),
    ]).then(mergeRevenue).catch(() => null),
    fetchChannel(y.YOUTUBE_API_KEY, y.YOUTUBE_CHANNEL_ID).catch(() => null),
    listCommits(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO || '', 20).catch(() => null),
  ]);
  return { c, rev, yt, gh };
}
// 실데이터 → 에이전트별 점검 라인 (결정적 — AI가 실패해도 진짜 숫자가 남는다)
function buildScan(d: any): OpsScan[] {
  const { c, rev, yt, gh } = d; const scan: OpsScan[] = [];

  // 💼 비즈니스: 매출 추세·거래량·주요 상품
  const bc = rev?.data?.totals?.by_currency;
  if (bc && Object.keys(bc).length) {
    const t = rev.data.totals; const cur = t.primary_currency || Object.keys(bc)[0]; const cc = bc[cur];
    const net = (cc.gross || 0) + (cc.refunds || 0) + (cc.fees || 0);
    const trend = rev.data?.totals?.by_period?.month && rev.data?.totals?.by_period?.prev_month
      ? ((rev.data.totals.by_period.month - rev.data.totals.by_period.prev_month) / rev.data.totals.by_period.prev_month * 100).toFixed(0)
      : null;
    const trendLabel = trend ? (parseInt(trend) > 0 ? `📈 +${trend}%` : `📉 ${trend}%`) : '';
    scan.push({ agent: 'business', label: `💰 매출 — 순 ${fmtN(net)} ${cur} · 거래 ${cc.count}건${trendLabel ? ` ${trendLabel}` : ''} · 환불율 ${((cc.refunds || 0) / (cc.gross || 1) * 100).toFixed(1)}%`, ok: true });
  } else scan.push({ agent: 'business', label: rev?.error ? `⚠️ 결제 연결 오류 — 재인증 필요` : '❌ 결제(PayPal·토스) 미연결 — 🗂️ 연동에서 키 입력', ok: false });

  // 📺 유튜브: 구독자·조회·상위 영상·성장률
  if (yt?.ok && yt.channel) {
    const ch = yt.channel; const top = (yt.videos || []).slice().sort((a: any, b: any) => b.views - a.views)[0];
    const growth = ch.subs && ch.prev_subs ? Math.round((ch.subs - ch.prev_subs) / ch.prev_subs * 100) : null;
    const topTitle = top?.title || '';
    scan.push({ agent: 'youtube', label: `📺 유튜브 — 구독 ${fmtN(ch.subs)}${growth ? ` (${growth > 0 ? '+' : ''}${growth}%)` : ''} · 조회 ${fmtN(ch.views)} · 인기 영상 "${topTitle.slice(0, 24)}" (${fmtN(top?.views || 0)})`, ok: true });
  } else scan.push({ agent: 'youtube', label: '❌ YouTube 미연결 — 채널 분석 불가능', ok: false });

  // 💻 개발자: 최근 커밋·활동 주기·주요 변경사항
  if (gh?.ok && gh.commits?.length) {
    const recent = gh.commits[0];
    const daysAgo = recent?.date ? Math.floor((Date.now() - new Date(recent.date).getTime()) / 86400000) : 0;
    const freq = daysAgo > 0 ? (gh.commits.length / Math.max(1, daysAgo)).toFixed(1) : '많음';
    scan.push({ agent: 'developer', label: `💻 개발 — 최근 커밋 "${recent?.msg?.slice(0, 28) || ''}" (${daysAgo}일 전) · 최근 ${gh.commits.length}개 (${freq}건/일) · 주요: ${(gh.commits.slice(1, 3).map((c: any) => c.msg.split(' ')[0]).join(', ') || '...')}`, ok: true });
  } else scan.push({ agent: 'developer', label: '❌ GitHub 미연결 — 코드 추적 불가능', ok: false });

  // 🎨 디자인: 등록된 서비스·자산 개수
  const svc = (c.services || []).length;
  scan.push({ agent: 'designer', label: svc ? `🎨 브랜드 — 서비스 ${svc}곳 · 등록된 자산 확인 중` : '❌ 서비스 미등록 — 웹사이트·채널·상품을 먼저 등록하세요', ok: !!svc });

  // 📋 비서: 할 일·승인 대기·정리 작업
  const openCount = openTasks().length, appCount = pendingApprovals().length;
  scan.push({ agent: 'secretary', label: `📋 운영 — 할 일 ${openCount}개${appCount ? ` · 승인 대기 ${appCount}개` : ''} · 지난 사이클 ${opsState.runs}회 · 산출물 ${opsState.shipped.length}개`, ok: true });

  return scan;
}
function opsRisk(title: string): OpsAction['risk'] {
  if (/결제|환불|가격|구매|송금|payout|invoice|청구/i.test(title)) return 'money';
  if (/메일|발송|이메일|dm|게시|업로드|발행|공지|email|post|publish/i.test(title)) return 'post';
  if (/배포|deploy|푸시|머지|릴리즈|release|push/i.test(title)) return 'deploy';
  return 'safe';
}
// 🤝 사람이 해야 잘되는 일(로컬 AI가 약한 영역) — 모델 태그와 무관하게 사람 몫으로 강제.
function humanCap(title: string): boolean {
  return /코딩|코드 ?(작성|짜|구현)|바이브 ?코딩|프로그래밍|앱 ?(개발|만들|제작)|사이트 ?(개발|만들|제작)|웹사이트 ?(개발|제작)|기능 ?구현|버그 ?수정|배포|deploy|github ?(푸시|연동|업로드)|계정 ?(생성|만들|가입)|회원 ?가입|결제 ?(수단|연동|등록)|카드 ?등록|api ?키 ?(발급|등록)|연동 ?(입력|설정)|촬영|녹화|미팅|회의|전화|통화|오프라인|방문|서명|계약|최종 ?(결정|승인|선택)|의사 ?결정/i.test(title);
}
// AI 없거나 실패해도 점검 결과로 진짜 작전을 만든다 (구체적이고 실행 가능하게)
function fallbackActions(scan: OpsScan[]): OpsAction[] {
  const out: OpsAction[] = [];
  const miss = (a: string) => scan.find(s => s.agent === a && !s.ok);
  const hit = (a: string) => scan.find(s => s.agent === a && s.ok);

  if (miss('business')) {
    out.push({ title: 'PayPal 계정 만들고 🗂️ 연동에 Client ID/Secret 입력하기', agent: 'business', risk: 'safe', assignee: 'human' });   // 계정 연결은 사람만 가능
    out.push({ title: '내 서비스에 맞는 수익 모델 3가지 조사·정리', agent: 'business', risk: 'safe', assignee: 'agent' });
  } else if (hit('business')) {
    out.push({ title: '경쟁사 가격 분석 및 내 수익화 전략 수정안 작성', agent: 'business', risk: 'safe', assignee: 'agent' });
  }

  if (miss('youtube')) {
    out.push({ title: '유튜브 채널 개설하고 🗂️ 연동에 API 키·채널 ID 입력하기', agent: 'youtube', risk: 'safe', assignee: 'human' });
    out.push({ title: '채널 로고·배너 디자인 컨셉 3안 기획', agent: 'designer', risk: 'safe', assignee: 'agent' });
  } else if (hit('youtube')) {
    out.push({ title: `지난달 인기 영상 분석 후 후속 기획안 3개 작성`, agent: 'youtube', risk: 'safe', assignee: 'agent' });
  }

  if (miss('developer')) {
    out.push({ title: '간단한 자동화 스크립트(뉴스레터 발송 등) 작성', agent: 'developer', risk: 'safe', assignee: 'agent' });
  } else if (hit('developer')) {
    out.push({ title: '최근 커밋 분석 후 다음 개발 목표 정의 및 일정 수립', agent: 'developer', risk: 'safe', assignee: 'agent' });
  }

  out.push({ title: '이번 주 할 일 정리 및 우선순위 지정', agent: 'secretary', risk: 'safe', assignee: 'agent' });

  return out.slice(0, 4);
}
// ① 스케줄 짜기 — 현황 분석 → '오늘의 작전' 제안(자동 실행 안 함). 사람이 고를 차례(phase=review).
// 핵심 개선: 에이전트별 특화 + 두뇌 기반 제안 + 파이프라인 사고
async function runOperation(): Promise<OpsState> {
  if (opsState.busy) return opsPublic();
  if (!opsState.scan.length) opsState.scan = ['business', 'youtube', 'developer', 'designer', 'secretary'].map(a => ({ agent: a, label: '데이터 읽는 중…', ok: false }));
  opsState.busy = true; opsState.phase = 'planning'; opsEmit();
  try {
    const d = await gatherOps();
    const scan = buildScan(d); const c = d.c;
    let summary = '', actions: OpsAction[] = [];
    const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() }).catch(() => null);
    if (target) {
      const findings = scan.map(s => `- ${s.label}`).join('\n');
      const notes = allNotes();
      const brainCtx = notes.length ? '\n\n[내 두뇌 — 쌓인 지식·노하우]\n' + notes.slice(-15).map(n => `- ${n.text.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n') : '';
      const svcCtx = (c.services || []).length ? '\n\n[내 서비스/사업]\n' + c.services.map(s => `- ${s.name}${s.url ? ` (${s.url})` : ''}${s.desc ? `: ${s.desc}` : ''}`).join('\n') : '';
      const shipped = opsState.shipped.slice(0, 5).filter(s => s.ok).map(s => `✅ ${s.title}`).join('\n');
      const shippedCtx = shipped ? `\n\n[지난 실행 성공]\n${shipped}` : '';
      // 🔁 강화학습 루프 — 사장님이 준 피드백(👍/👎)을 다음 플랜의 보상신호로
      const recentFb = (opsState.feedback || []).slice(-10);
      const fbCtx = recentFb.length ? `\n\n[지난 피드백 — 👍는 더 늘리고 👎는 줄여라]\n${recentFb.map(f => `${f.good ? '👍' : '👎'} ${f.title.replace(/\s+/g, ' ').slice(0, 50)}`).join('\n')}` : '';
      const user = `너는 ${c.company}의 CEO 에이전트야. 아래 데이터를 분석해 오늘의 작전 TODO 리스트(4~6개)를 세워줘. 사람(사장님)과 AI 에이전트가 '협업'하는 1인 기업이다 — 각 일을 누가 더 잘하는지로 나눠라.\n\n핵심:\n- 반드시 이 4개 고정 카테고리 안에서만 제안하라: 💡아이디어(바이브코딩으로 만들 새 서비스)·🗂️관리(고객·일정·정리·운영)·📊자산 분석(매출·지표·경쟁·현황)·📣마케팅(콘텐츠·발행·홍보). 가능하면 네 카테고리를 골고루 다뤄라.\n- 막연한 일반론 금지. 실제 수치·서비스명·지난 성공/피드백을 직접 언급.\n- 각 작전은 한 줄, 바로 실행 가능한 구체적인 행동.\n- 🤖 [에이전트id] = AI가 컴퓨터로 잘하는 일: 리서치·분석·데이터정리·문서·기획초안·콘텐츠 초안·모니터링·관리.\n- 🙋 [사장님] = 사람이 해야 잘되는 일: 코딩/바이브코딩(로컬 AI는 코딩이 약함)·계정 생성·결제수단·연동 입력·촬영·미팅·최종 의사결정·관계.\n- 분담 비율은 일에 따라 자연스럽게(보통 에이전트 2~4 : 사장님 1~2). 코딩이 필요하면 반드시 [사장님] 몫으로.\n- 한 작전의 산출물이 다음 작전의 입력이 되도록 순서를 짜라(파이프라인).\n\n형식:\n요약: <한 줄 현황>\n작전:\n- [에이전트id] 행동\n- [에이전트id] 행동\n- [사장님] 사람이 해야 잘되는 행동\n\n에이전트: youtube(레오)·instagram·designer·developer(코다리)·business(현빈)·secretary(영숙)·editor(루나)·writer·researcher\n\n[실시간 점검]\n${findings}${svcCtx}${brainCtx}${shippedCtx}${fbCtx}`;
      try {
        const text = await chat(target, agentPrompt(c.agentName, c.company, c.userTitle || '사장님'), user, { temperature: 0.5 });
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const sm = lines.find(l => /^요약[:：]/.test(l)); if (sm) summary = sm.replace(/^요약[:：]\s*/, '').slice(0, 120);
        const agentMap: Record<string, string> = { youtube: 'youtube', 레오: 'youtube', instagram: 'instagram', designer: 'designer', developer: 'developer', 코다리: 'developer', business: 'business', 현빈: 'business', secretary: 'secretary', 영숙: 'secretary', editor: 'editor', 루나: 'editor', writer: 'writer', researcher: 'researcher' };
        actions = lines.filter(l => /^[-•*]\s*\[?/.test(l))
          .map(l => {
            const m = l.match(/\[([^\]]*)\]/); const tag = (m?.[1] || '').trim();
            let human = /사장님|사람|human|user|owner|me/i.test(tag) && !agentMap[tag];   // [사장님] = 사람만 할 수 있는 일
            const t = l.replace(/^[-•*]\s*\[?[^\]]*\]?\s*/, '').replace(/^<[^>]{1,16}>\s*/, '').replace(/^\*+|\*+$/g, '').trim().slice(0, 120);   // <행동1>·마크다운 찌꺼기 제거
            // 🤝 능력 기반 보정 — 로컬 AI가 약한 일(코딩·계정·결제·촬영·오프라인)은 모델이 뭐라 태그했든 사람 몫으로
            if (humanCap(t)) human = true;
            const agent = human ? 'human' : (agentMap[tag] || 'secretary');
            return t ? { title: t, agent, risk: opsRisk(t), assignee: human ? 'human' as const : 'agent' as const } : null;
          }).filter(Boolean) as OpsAction[];
      } catch { /* */ }
    }
    if (!actions.length) actions = fallbackActions(scan);
    if (!summary) summary = scan.filter(s => s.ok).map(s => s.label.split(' — ')[0]).join(' · ') || '연동을 추가하면 더 정밀하게 운영할게요';
    opsState.scan = scan; opsState.actions = actions; opsState.summary = summary;
    opsState.lastRun = Date.now(); opsState.runs += 1;
    opsState.phase = 'review';
  } finally { opsState.busy = false; }
  saveOpsState(); opsEmit();
  return opsPublic();
}
// 에이전트별 전문 지시 — ①실데이터(API) 수집 → ②리서치 → ③산출물 생성 → ④한 줄 보고. 진짜 도구를 쓰는 전문가.
function buildAgentInstr(agent: string, title: string, context: { notes?: string; services?: string }): string {
  const today = new Date().toISOString().slice(0, 10);
  const dir = `오늘업무_${today}`;   // 하루 산출물이 한 폴더에 모인다 (바탕화면 안 어지럽힘)
  const base = `[운영 사이클 — "${title}" 작전] (오늘: ${today})\n\n규칙(중요):\n- 말로만 하지 마라. 반드시 도구를 호출해서 일해라. "하겠습니다"로 끝내면 실패다.\n- 작업 순서를 지켜라: ① 데이터 도구로 실데이터부터 확인 → ② 필요하면 web_search/fetch_url 리서치 → ③ write_file로 산출물 생성 → ④ 마지막에 한국어 2~3문장으로 결과 보고.\n- 산출물 파일은 전부 "${dir}/" 폴더 안에 만들어라 (예: ${dir}/보고서.md).\n- 산출물에는 ①②에서 얻은 실제 숫자·사실을 인용해라. 지어내지 마라.\n`;
  const agentInstr: Record<string, string> = {
    youtube: `${base}너는 유튜브 채널 전문가(레오)야.\n① get_youtube를 먼저 호출해 내 채널 실데이터(구독·조회·최근 영상)를 확인하고\n② web_search로 지금 통하는 주제·트렌드를 1~2번 검색한 뒤\n③ 그 근거로 영상 기획안을 write_file로 만들어라 → ${dir}/youtube_기획안.md (제목 3안, 첫 3초 후크, 구성, 타깃 시청자, 참고한 실데이터 포함).\n④ 기존 영상 제목·설명 개선이 작전이면 youtube_update_video로 실제 수정 결재까지 올려라(승인되면 진짜 반영됨).${context.notes ? `\n\n[내 지식]: ${context.notes}` : ''}`,
    instagram: `${base}너는 인스타그램 콘텐츠 전문가야.\n① web_search로 요즘 릴스 트렌드를 확인하고\n② 릴스 기획·캡션·해시태그·게시 시간을 write_file로 정리해라 → ${dir}/인스타_콘텐츠.md.`,
    designer: `${base}너는 브랜드 디자이너야.\n① 등록된 서비스가 있으면 fetch_url로 사이트 비주얼을 직접 보고\n② 시각 가이드(색상·타이포·썸네일 3안 컨셉)를 write_file로 작성해라 → ${dir}/디자인_가이드.md.`,
    developer: `${base}너는 시니어 풀스택 개발자(코다리)야. 데모가 아니라 실제로 돌아가는 걸 만든다.\n① get_github로 최근 커밋·개발 흐름을 먼저 확인하고(미연결이면 list_dir로 작업폴더 파악)\n② 프로젝트는 폴더로 구성해라 → ${dir}/프로젝트명/ 안에 여러 파일(코드+README.md). 단일 스크립트면 ${dir}/script.py 또는 .js\n③ 반드시 run_command로 실행·테스트해라. 에러가 나면 read_file로 코드를 다시 보고 고쳐서 재실행 — 통과할 때까지 반복(이게 네 일의 핵심).\n④ 웹앱이면 write_file로 index.html을 만들고 start_server로 띄워 브라우저로 확인까지.\n⑤ 외부 패키지가 필요하면 run_command("pip install …" 또는 "npm init -y && npm install …")를 먼저.${context.notes ? `\n\n[내 지식/선례]: ${context.notes}` : ''}`,
    business: `${base}너는 비즈니스 전략가(현빈)야.\n① get_revenue를 먼저 호출해 실제 매출 데이터를 확인하고\n② web_search로 경쟁사·시장 가격을 1~2번 검색한 뒤\n③ 실제 숫자가 들어간 전략 보고서를 write_file로 만들어라 → ${dir}/사업전략.md (현황 진단, 경쟁사 비교, 추천 액션 3개).${context.services ? `\n\n[내 서비스]: ${context.services}` : ''}`,
    secretary: `${base}너는 비서(영숙)야.\n① get_tasks로 태스크 보드를 먼저 확인하고, 끝난 건 complete_task로 정리해라.\n② check_email로 안 읽은 메일을 확인하고(미연결이면 생략), 중요한 건 요약해라.\n③ 오늘의 현황·우선순위를 write_file로 정리하고 → ${dir}/오늘브리핑.md, 핵심만 send_telegram으로 사장님께 보고해라.\n④ 발송·결제 같은 민감한 일은 request_approval로 결재를 올려라.`,
    editor: `${base}너는 음악·사운드 감독(루나)야.\n① web_search로 요즘 인기 BGM 스타일을 확인하고\n② 영상용 BGM 요구사항·오디오 가이드(BPM·키·무드 구체 명시)를 write_file로 정리해라 → ${dir}/사운드_가이드.md.`,
    writer: `${base}너는 카피라이터(Writer)야.\n① web_search로 주제 관련 최신 정보를 확인하고\n② 영상 스크립트·블로그 글·캡션을 write_file로 작성해라 → ${dir}/스크립트.md. 각각 고유한 톤으로.\n③ 블로그 글 발행이 작전이면 publish_content로 실제 게시 결재까지 올려라(승인되면 진짜 발행됨).`,
    researcher: `${base}너는 리서처야.\n① web_search로 2~3개 키워드를 검색하고\n② 좋은 결과는 fetch_url로 본문까지 읽은 뒤\n③ 출처 링크가 달린 분석 보고서를 write_file로 정리해라 → ${dir}/리서치.md.`,
  };
  return agentInstr[agent] || base + `네 전문성을 살려 "${title}" 작전을 수행해라. 데이터 도구(get_revenue·get_youtube·get_github·web_search)로 사실을 확인하고 write_file로 산출물을 남겨라.`;
}

// ③ 작전 1개를 실제 에이전트로 수행 → 진짜 산출물(파일·검색)만 SHIPPED 기록
let opsExecAbort: AbortController | null = null;
async function executeOne(c: Config, a: OpsAction, prior: OpsShip[] = []): Promise<OpsShip> {
  opsExecAbort = new AbortController();
  opsState.executingTitle = a.title; opsState.activity = a.title; opsEmit();
  const opts = { ...buildRunOpts(c, opsExecAbort.signal), maxIters: 16 };   // 진짜 코딩·리서치는 루프가 길어야 한다
  // 🧠 하이브리드 두뇌 — 이 에이전트 전용 모델이 설정돼 있으면 그걸로 (예: 코다리=Gemini → 코딩만 클라우드, 나머지는 로컬 무료)
  const am = (c.agentModels || {})[a.agent];
  if (am) { (opts as any).target = { ...(opts as any).target, model: am }; opsState.feed.unshift({ icon: '🧠', text: `${AGENTS[a.agent]?.name || a.agent} 전용 두뇌: ${am.slice(0, 28)}`, agent: a.agent, ok: true, ts: Date.now() }); }
  // 🧠 분야별 RAG — 이 작전과 관련된 내 지식을 골라서 (전체 최근 5개가 아니라, 작전 내용으로 검색)
  let notes = '';
  try {
    const found = brainSearch(a.title, 4, undefined, AGENT_CATEGORY[a.agent]);
    notes = found.map(n => n.text.replace(/\s+/g, ' ').slice(0, 110)).join(' / ');
  } catch { /* */ }
  if (!notes) notes = allNotes().slice(-3).map(n => n.text.slice(0, 80)).join(' / ');
  const services = c.services.map(s => s.name).join(', ');
  // 🔗 파이프라인 — 같은 사이클에서 동료가 방금 만든 산출물을 받아 이어서 작업한다
  const pipe = prior.filter(p => p.ok && (p.files || []).length)
    .map(p => `- ${AGENTS[p.agent]?.name || p.agent}가 "${p.title.slice(0, 50)}" 완료 → 파일: ${(p.files || []).join(', ')}`).join('\n');
  // 🛡️ 민감 작전 결재 게이트 — 라벨만이 아니라 실제 지시로
  const riskGate = a.risk && a.risk !== 'safe'
    ? `\n\n[⚠️ 민감 작전] 이 작전에는 ${a.risk === 'money' ? '돈(결제·환불·가격변경)' : a.risk === 'post' ? '외부 발송(메일·게시·업로드)' : '배포(deploy·push·릴리즈)'}이 포함될 수 있다. 그 단계는 절대 직접 실행하지 말고 request_approval로 결재를 올려라(분석·초안·파일 작성까지는 자유).`
    : '';
  const instr = buildAgentInstr(a.agent, a.title, { notes, services })
    + (pipe ? `\n\n[같은 사이클에서 동료가 방금 만든 산출물 — 관련 있으면 read_file로 읽고 이어받아 작업해라]\n${pipe}` : '')
    + riskGate;
  const artifacts: string[] = []; const files: string[] = []; const seen = new Set<string>();
  const base = (p: string) => (p || '').split('/').pop() || (p || '');
  // 🔴 라이브 피드 — 도구 한 번 쓸 때마다 화면에 실시간으로 (일하는 게 보인다)
  const feedPush = (icon: string, text: string, ok = true) => {
    opsState.feed.unshift({ icon, text: text.slice(0, 64), agent: a.agent, ok, ts: Date.now() });
    opsState.feed = opsState.feed.slice(0, 40); opsEmitLight();
  };
  const FEED_LABEL: Record<string, [string, string]> = {
    write_file: ['📄', '파일 생성'], read_file: ['📖', '파일 읽기'], list_dir: ['📂', '폴더 확인'], find: ['🔎', '파일 검색'],
    run_command: ['⚡', '명령 실행'], serve: ['🖥️', '서버 실행'], open: ['🖥️', '열기'], open_app: ['🖥️', '앱 실행'],
    web_search: ['🔍', '웹 검색'], fetch_url: ['🔗', '페이지 읽기'],
    revenue: ['💰', '매출 데이터 조회'], youtube: ['📺', '채널 데이터 조회'], github: ['💻', '깃허브 커밋 조회'], email_in: ['📥', '메일함 확인'],
    tasks: ['📋', '할 일 목록 확인'], task_done: ['☑️', '할 일 완료 처리'],
    telegram: ['✈️', '텔레그램 보고'], approve: ['✅', '결재 요청'], remember: ['🧠', '기억 저장'], task: ['📋', '할 일 등록'],
    screenshot: ['📸', '화면 확인'], clipboard: ['📋', '클립보드'], mcp: ['🔌', '외부 도구'],
  };
  const collect = (ev: any) => {
    emitEngine(ev);
    if (ev?.kind === 'tool') {
      const [icon, label] = FEED_LABEL[ev.name] || ['🔧', ev.name];
      const detail = String(ev.path || '').slice(0, 40);
      feedPush(icon, detail ? `${label}: ${detail}` : label, ev.ok !== false);
    }
    if (ev?.kind !== 'tool' || ev.ok === false) return;
    if (ev.name === 'write_file' && ev.path) files.push(String(ev.path));   // 파이프라인 — 다음 에이전트에게 전달할 파일
    let tag = '';
    if (ev.name === 'write_file') tag = `📄 ${base(ev.path)}`;
    else if (ev.name === 'run_command') tag = `⚡ ${String(ev.path || '').slice(0, 36)}`;
    else if (ev.name === 'serve' || ev.name === 'open') tag = `🖥️ ${String(ev.path || '').slice(0, 36)}`;
    else if (ev.name === 'web_search') tag = `🌐 검색: ${String(ev.path || '').slice(0, 26)}`;
    else if (ev.name === 'fetch_url') tag = `🔗 ${String(ev.path || '').slice(0, 36)}`;
    else if (ev.name === 'request_approval') tag = `✅ 승인: ${String(ev.path || '').slice(0, 28)}`;
    else if (ev.name === 'telegram') tag = '✈️ 텔레그램';
    if (tag && !seen.has(tag)) { seen.add(tag); artifacts.push(tag); }
  };
  feedPush(AGENTS[a.agent]?.emoji || '🤖', `${AGENTS[a.agent]?.name || a.agent} 작전 시작 — ${a.title.slice(0, 40)}`);
  let result = '';
  try { result = await agentWithTools([], instr, opts, collect); }
  catch (e: any) { result = `중단(${e?.message || e})`; }
  const did = artifacts.length > 0;
  feedPush(did ? '✅' : '⚠️', did ? `완료 — 산출물 ${artifacts.length}개` : '결과물 없이 종료', did);
  const ship: OpsShip = { title: a.title, agent: a.agent, artifacts, files, ok: did, result: did ? (result || '').replace(/\s+/g, ' ').trim().slice(0, 140) : (result || '결과물 없음').replace(/\s+/g, ' ').trim().slice(0, 160), ts: Date.now() };
  opsState.shipped.unshift(ship); opsState.shipped = opsState.shipped.slice(0, 20);
  opsState.executingTitle = ''; opsState.activity = ''; saveOpsState(); opsEmit();
  return ship;
}
// 🚀 운영 시작 = 첫 사이클 스케줄 짜기 (실행 안 함)
ipcMain.handle('ops:start', async () => {
  opsState.running = true; if (!opsState.startedAt) opsState.startedAt = Date.now();
  opsState.cycle = (opsState.cycle || 0) + 1;
  return await runOperation();   // → phase 'review' (사람이 고를 차례)
});

// ════════ 🎯 성장 사이클 — 1인 기업 3단계 (아이디어·진단·마케팅) ════════
// 1️⃣ 아이디어 제안 [🙋 사람이 결정] — 연결된 모든 데이터를 종합해 '지금 만들 새 서비스' 1개 구체 제안
ipcMain.handle('cycle:idea', async () => {
  const c = loadConfig();
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() });
  if (!target) return { ok: false, error: 'AI 두뇌를 먼저 켜주세요 — 🤖 내 AI에서 모델을 실행하면 분석할 수 있어요.' };
  const ctrl = new AbortController();
  const opts: any = buildRunOpts(c, ctrl.signal);
  // 📊 연결된 데이터 전부 수집 (느린 API는 타임아웃·실패해도 진행)
  const within = <T>(p: Promise<T>, ms: number, fb: T): Promise<T> => Promise.race([p.catch(() => fb), new Promise<T>(r => setTimeout(() => r(fb), ms))]);
  const [rev, yt, gh, mail] = await Promise.all([
    within(Promise.resolve(opts.getRevenue?.() ?? ''), 9000, '(매출 미연결)'),
    within(Promise.resolve(opts.getYoutube?.() ?? ''), 9000, '(유튜브 미연결)'),
    within(Promise.resolve(opts.getGithub?.() ?? ''), 9000, '(깃허브 미연결)'),
    within(Promise.resolve(opts.checkEmail?.() ?? ''), 9000, '(이메일 미연결)'),
  ]);
  const services = c.services.length
    ? c.services.map(s => `· ${s.name}${s.url ? ` (${s.url})` : ''}${s.repo ? ` [repo:${s.repo}]` : ''}${s.market ? ` · 타겟:${s.market}` : ''}${s.price ? ` · ${s.price}` : ''}: ${s.desc || ''}`).join('\n')
    : '(아직 등록된 서비스 없음 — 첫 서비스를 만들 기회)';
  const notes = allNotes().slice(-15).map(n => '· ' + (n.text || '').slice(0, 80)).join('\n') || '(지식 없음)';
  const sys = `너는 1인 기업 전략가다. 연결된 '실제 데이터'만 근거로, 사장님이 바로 만들 수 있는 구체적인 새 서비스/제품 1개를 제안한다. 막연한 일반론 금지 — 반드시 데이터에서 본 사실(매출·채널·기존서비스·지식)을 근거로 든다.`;
  const dataBlock = `[내 비즈니스 현황 — ${c.company}]\n■ 기존 서비스:\n${services}\n■ 매출: ${rev}\n■ 유튜브: ${yt}\n■ 깃허브: ${gh}\n■ 이메일: ${mail}\n■ 내 지식·노하우:\n${notes}`;
  const jsonSpec = `{"title":"서비스 이름","what":"무엇을 만드는지 1~2문장","how":"어떤 방식/스택으로 만드는지 — 사장님이 바이브코딩으로 구현할 구체적 방법(예: Next.js+Supabase, Flutter, 노코드 등)","why":"왜 지금 기회인지 — 위 데이터+웹검색에서 본 구체 근거 인용","market":"타겟 국가/고객층(구체적으로)","price":"추천 가격(통화 포함)과 근거","firstStep":"오늘 당장 할 첫 행동 1개"}`;
  // 🌐 1차 — 웹 검색으로 트렌드·경쟁·가격을 확인한 뒤 제안 (web_search 도구 사용)
  const instr = `${dataBlock}\n\n[해야 할 일]\n1) web_search를 1~2회 호출해 "이 아이템이 지금 통하는지" 최신 트렌드·경쟁 서비스·가격대를 확인하라(가능하면 타겟 국가 기준).\n2) 그 근거로 사장님이 '바이브코딩으로 오늘 시작'할 수 있는 새 서비스 딱 1개를 정하라.\n3) 맨 마지막에 아래 JSON '하나만' 출력하라(앞뒤 설명·코드펜스 금지):\n${jsonSpec}`;
  let idea: any = null;
  try {
    const raw = await agentWithTools([], instr, { ...opts, maxIters: 6 }, () => { /* 라이브 피드 없이 조용히 */ });
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { idea = JSON.parse(m[0]); } catch { /* */ } }
  } catch { /* 웹검색 실패 — 데이터 폴백으로 */ }
  // 🛟 2차 폴백 — 웹검색이 안 되면 데이터만으로 (항상 답을 준다)
  if (!idea?.title) {
    try {
      const raw = await chat(target, sys, `${dataBlock}\n\n위 실제 데이터를 근거로 '지금 만들면 좋은 새 1인 기업 서비스' 딱 1개를 제안하라.\n반드시 이 JSON만 출력:\n${jsonSpec}`, { temperature: 0.7 });
      const m = raw.match(/\{[\s\S]*\}/); idea = m ? JSON.parse(m[0]) : null;
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  }
  if (!idea?.title) return { ok: false, error: '제안 생성 실패 — 다시 시도하거나 데이터를 더 연결해보세요.' };
  return { ok: true, idea, dataUsed: { services: c.services.length, revenue: !rev.includes('미연결'), youtube: !yt.includes('미연결'), github: !gh.includes('미연결'), web: true } };
});
// 2️⃣ 분석 리포트 [🤖 작성 → 🙋 공부] — 현재 모든 상황을 종합한 한국어 진단 리포트(마크다운). 다 읽으면 '공부 완료'.
ipcMain.handle('cycle:report', async () => {
  const c = loadConfig();
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() });
  if (!target) return { ok: false, error: 'AI 두뇌를 먼저 켜주세요 — 🤖 내 AI에서 모델을 실행하면 분석할 수 있어요.' };
  const ctrl = new AbortController();
  const opts: any = buildRunOpts(c, ctrl.signal);
  const within = <T>(p: Promise<T>, ms: number, fb: T): Promise<T> => Promise.race([p.catch(() => fb), new Promise<T>(r => setTimeout(() => r(fb), ms))]);
  const [rev, yt, gh, mail] = await Promise.all([
    within(Promise.resolve(opts.getRevenue?.() ?? ''), 9000, '(매출 미연결)'),
    within(Promise.resolve(opts.getYoutube?.() ?? ''), 9000, '(유튜브 미연결)'),
    within(Promise.resolve(opts.getGithub?.() ?? ''), 9000, '(깃허브 미연결)'),
    within(Promise.resolve(opts.checkEmail?.() ?? ''), 9000, '(이메일 미연결)'),
  ]);
  const services = c.services.length ? c.services.map(s => `· ${s.name}${s.url ? ` (${s.url})` : ''}${s.market ? ` · 타겟:${s.market}` : ''}${s.price ? ` · ${s.price}` : ''}`).join('\n') : '(등록된 서비스 없음)';
  const notes = allNotes().slice(-12).map(n => '· ' + (n.text || '').slice(0, 80)).join('\n') || '(지식 없음)';
  const sys = `너는 1인 기업 전담 애널리스트다. 사장님이 5분 안에 '지금 내 사업이 어떤 상태인지' 완전히 파악하도록, 실제 데이터만 근거로 한국어 진단 리포트를 쓴다. 막연한 칭찬·일반론 금지, 숫자와 사실 중심.`;
  const user = `아래 실제 데이터로 '오늘의 사업 진단 리포트'를 마크다운으로 작성하라.\n\n[데이터]\n■ 서비스:\n${services}\n■ 매출: ${rev}\n■ 유튜브: ${yt}\n■ 깃허브: ${gh}\n■ 이메일: ${mail}\n■ 내 지식:\n${notes}\n\n[형식 — 이 구조 그대로, 각 항목에 '왜'와 '실제 숫자' 포함]\n## 📊 한눈 요약\n## 💰 매출·수익\n## 📺 콘텐츠·트래픽\n## 🛠️ 제품·개발\n## ⚠️ 지금 가장 큰 리스크 1가지\n## 🎯 이번 주 집중할 3가지\n(데이터가 미연결이면 솔직히 '미연결'로 표시하고 무엇을 연결하면 좋은지 한 줄로 권하라.)`;
  try {
    const md = await chat(target, sys, user, { temperature: 0.4 });
    return { ok: true, md: (md || '').trim(), dataUsed: { services: c.services.length, revenue: !rev.includes('미연결'), youtube: !yt.includes('미연결'), github: !gh.includes('미연결') } };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
});
// 3️⃣ 마케팅 [🤝 자동 발행] — 유튜브 마케팅 에이전트 실행(채널 분석 → 영상 기획안 → 제목·설명 개선 결재). IG·X·쓰레드는 연결 예정.
ipcMain.handle('cycle:marketing', async (_e, channel: string = 'youtube') => {
  if (opsState.executing) return { ...opsPublic(), mktOk: false, busy: true };
  const c = loadConfig();
  opsState.running = true; opsState.executing = true; opsState.phase = 'executing'; opsState.feed = []; opsState.activity = '마케팅 발행'; opsEmit();
  try { openOfficeWindow(); } catch { /* 🏢 일하는 모습이 보이게 */ }
  const action: OpsAction = { title: '유튜브 마케팅 — 채널 분석 → 영상 기획안 → 제목·설명 개선 결재', agent: 'youtube', risk: 'post', assignee: 'agent' };
  let ship: OpsShip | null = null;
  try { ship = await executeOne(c, action, []); }
  catch { /* */ }
  finally { opsState.executing = false; opsState.executingTitle = ''; opsState.activity = ''; opsState.phase = 'review'; saveOpsState(); opsEmit(); }
  return { ...opsPublic(), mktOk: !!ship?.ok };
});
// ▶ 다음 사이클 — 다시 스케줄을 짠다
ipcMain.handle('ops:nextCycle', async () => {
  opsState.running = true; opsState.cycle = (opsState.cycle || 0) + 1;
  return await runOperation();
});
// ②→③ 사람이 고른 작전 수행 — 🙋 사장님 몫은 태스크 보드 등록, 🤖 에이전트 몫은 파이프라인으로 하나씩
// (앱 UI와 📱 텔레그램 원격 운영이 같은 함수를 쓴다)
async function doExecuteSelected(titles: string[], humanTitles: string[] = []): Promise<OpsState> {
  if (opsState.executing) return opsPublic();
  const set = new Set(titles || []);
  const humanSet = new Set(humanTitles || []);
  const chosen = opsState.actions.filter(a => set.has(a.title))
    .map(a => ({ ...a, assignee: humanSet.has(a.title) ? 'human' as const : 'agent' as const }));   // UI 토글이 최종 결정
  if (!chosen.length) { opsState.phase = 'done'; saveOpsState(); opsEmit(); return opsPublic(); }
  const c = loadConfig();
  opsState.executing = true; opsState.phase = 'executing'; opsState.feed = []; opsEmit();
  try { openOfficeWindow(); } catch { /* */ }   // 🏢 일하는 모습이 보이게
  const batch: OpsShip[] = [];   // 이번 사이클 산출물 — 파이프라인으로 다음 에이전트에 전달
  try {
    // 🙋 사장님 몫 — 태스크 보드에 등록하고 폰으로도 알림 (에이전트는 못 하는 일)
    const humans = chosen.filter(a => a.assignee === 'human');
    for (const h of humans) {
      addTask(h.title, { owner: 'user', agentEmoji: '🙋', priority: 'high' });
      const ship: OpsShip = { title: h.title, agent: 'human', artifacts: ['📋 사장님 할 일로 등록'], files: [], ok: true, result: '태스크 보드에 등록했어요 — 사장님이 직접 진행해 주세요', ts: Date.now() };
      opsState.shipped.unshift(ship); batch.push(ship);
      opsState.feed.unshift({ icon: '🙋', text: `사장님 할 일 등록: ${h.title.slice(0, 44)}`, agent: 'secretary', ok: true, ts: Date.now() });
    }
    if (humans.length) { opsEmit(); tgSend(`🙋 사장님 몫 할 일 ${humans.length}개가 등록됐어요:\n${humans.map(h => `□ ${h.title}`).join('\n')}`).catch(() => undefined); }
    // 🤖 에이전트 몫 — 앞 작전의 산출물을 이어받으며 하나씩 실행
    for (const a of chosen.filter(x => x.assignee !== 'human')) {
      if (!opsState.running) break;
      const ship = await executeOne(c, a, batch);   // 위험 단계는 에이전트가 알아서 request_approval(→텔레그램)
      batch.push(ship);
    }
    // 🧠 사이클 기억 — 완수한 작전을 두뇌에 기록 → 다음 사이클 계획이 이걸 참고한다
    const done = batch.filter(s => s.ok && s.agent !== 'human');
    if (done.length) {
      const today = new Date().toISOString().slice(0, 10);
      brainAddNote(`[운영 ${today} 사이클#${opsState.cycle}] ${done.map(s => `${AGENTS[s.agent]?.name || s.agent}: ${s.title.slice(0, 60)}${(s.files || []).length ? ` (${(s.files || []).join(', ')})` : ''}`).join(' / ')}`, undefined, { source: 'agent', verified: true });
    }
  } finally { opsState.executing = false; opsState.executingTitle = ''; opsState.activity = ''; opsExecAbort = null; opsState.phase = 'done'; saveOpsState(); opsEmit(); }
  return opsPublic();
}
ipcMain.handle('ops:executeSelected', (_e, titles: string[], humanTitles: string[] = []) => doExecuteSelected(titles, humanTitles));
ipcMain.handle('ops:status', () => opsPublic());
// 👍👎 피드백 — 다음 사이클 플랜에 반영되는 보상신호(강화학습 루프)
ipcMain.handle('ops:feedback', (_e, title: string, good: boolean) => {
  opsState.feedback = [...(opsState.feedback || []), { title: String(title || '').slice(0, 80), good: !!good, cycle: opsState.cycle, ts: Date.now() }].slice(-50);
  saveOpsState(); opsEmit();
  return opsPublic();
});
// 🔗 대시보드 → 메인 창 작전 검토 열기 (창 사이 단절 제거)
ipcMain.handle('ops:openReview', () => { try { win?.show(); win?.focus(); win?.webContents.send('ops:openPanel'); } catch { /* */ } return true; });
// 🧹 지난 산출물 기록 비우기 — 옛 실패 기록이 화면을 어지럽히지 않게
ipcMain.handle('ops:clearShipped', () => { opsState.shipped = []; saveOpsState(); opsEmit(); return opsPublic(); });
// 📄 산출물 열기 — 사이클 화면의 파일 칩 클릭 → 실제 파일이 기본 프로그램으로 열린다
ipcMain.handle('ops:openArtifact', (_e, rel: string) => {
  try {
    const c = loadConfig(); const ws = c.workspace || defaultWorkspace();
    let p = String(rel || '').replace(/^~(?=\/|$)/, os.homedir());
    if (!path.isAbsolute(p)) p = path.join(ws, p);
    if (!fs.existsSync(p)) return { ok: false, reason: '파일을 찾을 수 없어요 (이동·삭제됐을 수 있음)' };
    shell.openPath(p);
    return { ok: true };
  } catch (e: any) { return { ok: false, reason: e?.message || String(e) }; }
});
ipcMain.handle('ops:stop', () => { opsState.running = false; opsState.executing = false; opsState.phase = 'idle'; opsState.activity = ''; opsState.executingTitle = ''; opsExecAbort?.abort(); saveOpsState(); opsEmit(); return opsPublic(); });
// 💬 사무실 진짜 대화 — 현황(매출·작전·방금 한 일)을 반영해 캐릭터별 짧은 대사를 AI가 생성
// 개선: 각 에이전트의 성격·역할·최근 업무를 깊게 반영해 더 생생한 대화로
ipcMain.handle('office:banter', async () => {
  const c = loadConfig();
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() }).catch(() => null);
  if (!target) return { ok: false };

  // 실시간 상황 데이터 구성
  const svc = (c.services || []).map(s => s.name).join(', ');
  const recentShip = opsState.shipped.slice(0, 5).filter((s: any) => s.ok).map((s: any) => s.title);
  const agentActivity = new Map<string, string>();  // 각 에이전트가 뭘 했는지
  for (const ship of opsState.shipped.slice(0, 10)) {
    if (!agentActivity.has(ship.agent)) agentActivity.set(ship.agent, ship.title);
  }

  const ctx = [
    `회사: ${c.company}`,
    svc && `서비스: ${svc}`,
    opsState.summary && `현황: ${opsState.summary}`,
    recentShip.length && `완료: ${recentShip.join(', ')}`,
    openTasks().length && `할 일: ${openTasks().slice(0, 2).map(t => t.title).join(' · ')}`,
  ].filter(Boolean).join('\n');

  // 각 에이전트의 성격·최근 역할을 명시
  const agentProfiles = AGENT_ORDER.map(id => {
    const ag = AGENTS[id];
    const recentWork = agentActivity.get(id) ? ` (최근: ${agentActivity.get(id)?.slice(0, 20)})` : '';
    return `- ${ag?.name}(${id}): ${ag?.tagline}${recentWork}`;
  }).join('\n');

  const sys = `너는 1인 기업 AI팀의 사무실 작가야.
각 에이전트는 고유한 성격과 전문성을 가진 인물이다:
${agentProfiles}

핵심:
- 캐릭터 성격을 살려서(예: 레오는 데이터·결과 중심, 영숙은 챙겨주는 톤)
- 실제 일을 주제로(매출·콘텐츠·코드·마케팅 등)
- 자연스럽고 짧게(25자 이내, 이모지 최대 1개)
- 대화 흐름이 자연스럽게(한 사람 말 → 다음 사람이 받아서 이어감)`;

  const user = `아래 상황 속에서 이 팀이 오늘 사무실에서 나눌 법한 짧은 대화 9줄을 만들어줘.
응답 형식:
${AGENT_ORDER.slice(0, 3).map(id => id).join('|말할사람(한글)|대사')}

각 줄 형식: 말하는사람id|상대방이름또는|대사
예시:
youtube|secretary|영숙, 이번 달 조회수 50% 올렸대!
secretary||정말? 축하합니다! 🎉
developer|youtube|근데 렌더링이 느려지네…

[현황]
${ctx}`;

  try {
    const text = await chat(target, sys, user, { temperature: 0.8 });
    const ok = new Set(AGENT_ORDER);
    const lines = text.split('\n')
      .map(l => l.trim())
      .filter(l => l && (l.includes('|') || l.includes('：')))
      .map(l => {
        const p = l.replace(/：/g, '|').split('|');
        const from = (p[0] || '').trim().toLowerCase();
        const dialogue = (p.slice(2).join('|') || p[1] || '').trim()
          .replace(/^["'\-•*\s]+|["']+$/g, '')
          .replace(/^(사람이름|[가-힣]+)\s*[:：]?\s*/, '')  // 이름 제거
          .slice(0, 50);
        return dialogue && ok.has(from) ? { from, text: dialogue } : null;
      })
      .filter((x): x is { from: string; text: string } => !!x);
    return { ok: true, lines: lines.slice(0, 12) };
  } catch { return { ok: false }; }
});
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
  // 🦾 자비스 스마트 라우팅 — 한국어 문장은 한국어 잘하는 딥 보이스(Andrew), 영어 문장은 영화급 영국 집사(Kokoro 로컬 → 없으면 Ryan UK)
  if (c.voiceQuality === 'edge' && /^jarvis/.test(c.qwenVoice || '')) {
    const hangul = (text.match(/[가-힣]/g) || []).length;
    const alpha = (text.match(/[A-Za-z가-힣]/g) || []).length || 1;
    if (hangul / alpha > 0.25) return await edgeTTS('ko-KR-InJoonNeural', text, { pitch: '-14Hz', rate: '+6%' });   // 한국어 — 네이티브 딥 톤, 빠릿하게
    if (c.ttsLocalUrl) { const r = await localTTS(c.ttsLocalUrl, text, 'jarvis-local'); if (r.ok) return r; }                    // 영어 — 로컬 Kokoro 집사(최고)
    return await edgeTTS('en-GB-RyanNeural', text, { pitch: '-6Hz', rate: '-5%' });                                              // 영어 — 영국 정통(서버 없을 때)
  }
  if (c.voiceQuality === 'edge') return await edgeTTS(c.qwenVoice || 'ko-KR-SunHiNeural', text);
  if (c.voiceQuality !== 'qwen') return { ok: false, skip: true };
  // Qwen — 로컬 서버 있으면 로컬(무료), 없으면 Replicate(클라우드)
  if (c.ttsLocalUrl) return await localTTS(c.ttsLocalUrl, text, c.qwenVoice || 'Sohee');
  const token = (c.apiConn?.replicate?.REPLICATE_API_TOKEN) || (c.apiKeys?.replicate) || '';
  return await qwenTTS(token, text, c.qwenVoice || 'Sohee');
});
// 🎭 에이전트별 목소리 — 자비스처럼 각자 다른 음색으로 말한다 (보이스 + 음높이/속도 변주, 무료 Edge TTS)
const AGENT_VOICE: Record<string, { voice: string; rate?: string; pitch?: string }> = {
  secretary:  { voice: 'ko-KR-SunHiNeural' },                                          // 영숙 — 밝고 또렷한 비서
  youtube:    { voice: 'ko-KR-InJoonNeural', rate: '+12%', pitch: '+10Hz' },           // 레오 — 에너지 넘침
  developer:  { voice: 'ko-KR-HyunsuMultilingualNeural', rate: '-4%', pitch: '-4Hz' }, // 코다리 — 차분한 엔지니어
  business:   { voice: 'ko-KR-InJoonNeural', rate: '-8%', pitch: '-16Hz' },            // 현빈 — 묵직한 전략가 (자비스 톤)
  designer:   { voice: 'ko-KR-JiMinNeural', pitch: '+8Hz' },                           // 밝은 디자이너
  editor:     { voice: 'ko-KR-JiMinNeural', rate: '-6%', pitch: '-4Hz' },              // 루나 — 잔잔한 사운드 감독
  writer:     { voice: 'ko-KR-SunHiNeural', rate: '-6%', pitch: '-8Hz' },              // 낮고 단정한 작가
  researcher: { voice: 'ko-KR-HyunsuMultilingualNeural', rate: '+8%' },                // 빠릿한 리서처
  instagram:  { voice: 'ko-KR-SunHiNeural', rate: '+10%', pitch: '+12Hz' },            // 통통 튀는 SNS
  ceo:        { voice: 'ko-KR-InJoonNeural', rate: '-4%', pitch: '-10Hz' },            // 지휘하는 CEO
};
ipcMain.handle('tts:speakAgent', async (_e, agentId: string, text: string) => {
  const v = AGENT_VOICE[agentId] || AGENT_VOICE.secretary;
  return await edgeTTS(v.voice, String(text || '').slice(0, 300), { rate: v.rate, pitch: v.pitch });
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
    // 🛡️ 실행 계획 교정 (engine/intent.ts planServe — simulate.ts가 검증)
    //   파일명을 명령처럼 넘김 / package.json 없음 / npm run dev인데 dev 스크립트 없음 →
    //   index.html이 있으면 정적 서버로 자동 전환해서 "어쨌든 브라우저에 뜨게" 한다.
    let hasPkg = false, scripts: string[] = [];
    try { const pj = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8')); hasPkg = true; scripts = Object.keys(pj?.scripts || {}); } catch { /* 없음 */ }
    let hasIndex = false; try { hasIndex = fs.existsSync(path.join(ws, 'index.html')); } catch { /* */ }
    let nodeEntry = ''; for (const f of ['index.js', 'server.js', 'app.js', 'main.js']) { try { if (fs.existsSync(path.join(ws, f))) { nodeEntry = f; break; } } catch { /* */ } }
    const plan = planServe(normalizeCmd(rawCmd), { hasPkg, scripts, hasIndex, win: process.platform === 'win32', nodeEntry: nodeEntry || undefined });
    if (plan.block === 'no-pkg') {
      return resolve(`실행 실패: 이 폴더(${ws})에 package.json이 없어서 npm 명령을 못 돌려요.\n💡 정적 웹사이트면: ① write_file로 index.html을 먼저 만들고 → ② start_server를 다시 호출하세요(자동으로 정적 서버를 띄웁니다).\n💡 Node 프로젝트가 필요하면: run_command로 "npm init -y" 먼저.`);
    }
    if (plan.block === 'no-script') {
      return resolve(`실행 실패: package.json에 "${plan.missing}" 스크립트가 없어요 (있는 것: ${scripts.join(', ') || '없음'}).\n💡 Node 서버면 start_server("node index.js"), 정적이면 index.html을 만들고 start_server를 다시 호출하세요.`);
    }
    const cmd = plan.cmd; const serveFile = plan.serveFile || '';
    if (plan.repaired) termSend('cmd', `# "${normalizeCmd(rawCmd)}" → ${plan.repaired}로 자동 수리`);
    const wantPort = portFromCmd(cmd) || (/http\.server|SimpleHTTPServer/i.test(cmd) ? 8000 : /flask|app\.run/i.test(cmd) ? 5000 : /vite/i.test(cmd) ? 5173 : /next/i.test(cmd) ? 3000 : 3000);
    // 정적 서버인데 index.html이 없으면 → 에이전트에게 "파일부터 만들라" 경고 (빈 폴더 serve 방지)
    let warn = '';
    if (/http\.server|SimpleHTTPServer/i.test(cmd)) { try { if (!fs.existsSync(path.join(ws, 'index.html'))) warn = `\n⚠️ 경고: 이 폴더에 index.html이 없어서 브라우저에 "Directory listing"(빈 목록)만 떠요. 반드시 write_file 로 index.html 을 먼저 만든 뒤 다시 서버를 띄우세요. 아직 웹사이트를 만든 게 아닙니다.`; } catch { /* */ } }
    termSend('cmd', `$ ${cmd}`);
    try { win?.webContents.send('term:show'); } catch { /* */ }
    const child = spawnInTerminal(cmd, ws);
    if (!child) return resolve('서버 실행 실패');
    let out = '', done = false;
    const open = (port: string | number, note: string) => { if (done) return; done = true; const url = `http://localhost:${port}${serveFile ? '/' + encodeURI(serveFile) : ''}`; openUrlFront(url); resolve(`✅ ${note}: ${url}\n(터미널에서 실행 중 — ⏹ 또는 Ctrl+C로 중지)${warn}`); };
    const scan = (buf: Buffer) => {
      out += buf.toString('utf8');
      const m = out.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)/i) || out.match(/port\s+(\d{2,5})/i);
      if (m) open(m[1], '서버를 띄우고 브라우저를 열었어요');
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
    child.on('exit', (code) => {
      if (done) return; done = true;
      // 정적 파일이 목적이었으면 서버가 죽어도 파일을 직접 열어준다 (사용자는 결과를 본다)
      if (serveFile) {
        const abs = path.isAbsolute(serveFile) ? serveFile : path.join(ws, serveFile);
        if (fs.existsSync(abs)) { shell.openPath(abs); return resolve(`서버 대신 파일을 직접 열었어요: ${abs} (브라우저에 표시됨)`); }
      }
      resolve(`서버가 종료됐어요(코드 ${code}). 명령이 잘못됐을 수 있어요.\n로그: ${out.slice(-400) || '(출력 없음)'}\n💡 정적 사이트면 python3 -m http.server ${wantPort || 8000} 를 시도해 보세요.`);
    });
    setTimeout(() => { if (!done) open(wantPort || 3000, '서버 실행 중 — 브라우저를 열었어요'); }, 4500);
  });
}
const servicesInfo = (c: Config) => {
  const svc = c.services.length
    ? `\n\n## ${c.company}의 서비스/사업 (사장님 것 — 인지하고 적극 활용)\n` + c.services.map(s => `- ${s.name}${s.url ? ` (${s.url})` : ''}${s.repo ? ` [깃헙:${s.repo} — read_repo_file/edit_repo_file로 코드 수정 가능]` : ''}${s.desc ? `: ${s.desc}` : ''}`).join('\n')
    : '';
  const open = openTasks();
  const tk = open.length
    ? `\n\n## 지금 열린 할 일 (배경 정보 — 사용자가 물을 때만 언급)\n` + open.slice(0, 6).map(t => `- ${t.title}`).join('\n')
    : '';
  const pend = pendingApprovals();
  const ap = pend.length
    ? `\n\n## 승인 대기 중 (배경 정보)\n` + pend.slice(0, 5).map(a => `- ${a.title}`).join('\n')
    : '';
  const guard = (tk || ap) ? `\n\n⚠️ 위 할 일·승인 목록은 배경일 뿐이다. 사용자의 "지금 메시지"에만 답해라 — 묻지 않은 할 일 얘기를 먼저 꺼내지 마라.` : '';
  return svc + tk + ap + guard;
};
let runAbort: AbortController | null = null;
// 🛠️ 에이전트 실행 옵션 빌더 — 1:1 대화와 자율 운영이 같은 도구(파일·매출·유튜브·웹·텔레그램·승인)를 공유
function buildRunOpts(c: Config, signal: AbortSignal, attachImages: string[] = []) {
  const getRevenue = async () => {
    const cc = loadConfig();
    const r = await fetchRevenue(cc.paypalClientId, cc.paypalSecret, { days: 30 });
    if (r.data) {
      const t = r.data.totals; const cur = (t as any).primary_currency || Object.keys(t.by_currency)[0] || 'USD';
      const cy: any = t.by_currency[cur] || { gross: 0, refunds: 0, fees: 0, count: 0 };
      const net = (cy.gross || 0) + (cy.refunds || 0) + (cy.fees || 0);   // 환불·수수료는 음수 → 더하면 차감
      const p = t.by_period;
      const f = (n: number) => Math.round(n).toLocaleString();
      const others = Object.keys(t.by_currency).filter(k => k !== cur);
      return `[통화=${cur}] 순매출(환불·수수료 차감 후) ${f(net)} ${cur}. 총 결제 ${f(cy.gross)} · 환불 ${f(cy.refunds)} · 거래 ${cy.count}건. 기간(${cur}): 30일 ${f(p.month || 0)}, 7일 ${f(p.week || 0)}, 오늘 ${f(p.today || 0)}.${others.length ? ` 다른 통화: ${others.map(k => { const o = t.by_currency[k]; return `${f((o.gross || 0) + (o.refunds || 0) + (o.fees || 0))} ${k}`; }).join(', ')}.` : ''} ⚠️ 통화는 반드시 ${cur}로 표기(달러로 바꾸지 마라). "매출"은 순매출 기준으로, 총결제와 구분해서 보고해라.`;
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
      if (/^https?:\/\//i.test(t)) { openUrlFront(t); return `✅ 열었어요: ${t}`; }
      if (!path.isAbsolute(t)) t = path.join(c.workspace || defaultWorkspace(), t);
      if (!fs.existsSync(t)) return `열기 실패: 그 경로에 파일이 없어요 (${t})`;
      const err = await shell.openPath(t);
      return err ? `열기 실패: ${err}` : `✅ 열었어요: ${t}`;
    } catch (e: any) { return `열기 실패: ${e?.message || e}`; }
  };
  // 🖥️ 앱 실행 — "크롬 열어서 구글 들어가"가 진짜로 된다 (한국어 이름 매핑 + 맥/윈도우 분기)
  const openApp = async (name: string, url?: string): Promise<string> => {
    const mac = process.platform === 'darwin';
    const n = (name || '').trim().toLowerCase().replace(/\s+/g, '');
    const ALIAS: Record<string, string> = mac
      ? { 크롬: 'Google Chrome', chrome: 'Google Chrome', 구글크롬: 'Google Chrome', 사파리: 'Safari', safari: 'Safari', 파인더: 'Finder', 탐색기: 'Finder', 익스플로러: 'Finder', finder: 'Finder', 메모장: 'TextEdit', 메모: 'Notes', 노트: 'Notes', 캘린더: 'Calendar', 달력: 'Calendar', 카카오톡: 'KakaoTalk', 카톡: 'KakaoTalk', 터미널: 'Terminal', 계산기: 'Calculator', 음악: 'Music', 사진: 'Photos', 메일: 'Mail', 유튜브: '', 슬랙: 'Slack', 노션: 'Notion', 줌: 'zoom.us', vscode: 'Visual Studio Code', 브이에스코드: 'Visual Studio Code' }
      : { 크롬: 'chrome', chrome: 'chrome', 엣지: 'msedge', edge: 'msedge', 탐색기: 'explorer', 익스플로러: 'explorer', 파인더: 'explorer', 메모장: 'notepad', 계산기: 'calc', 터미널: 'cmd', 카카오톡: 'KakaoTalk', 카톡: 'KakaoTalk' };
    const app = ALIAS[n] !== undefined ? ALIAS[n] : (name || '').trim();
    const u = (url || '').trim();
    const link = u && !/^https?:\/\//i.test(u) ? `https://${u}` : u;
    try {
      if (!app && link) { openUrlFront(link); return `✅ 기본 브라우저로 열었어요: ${link}`; }   // 앱 이름이 사이트면(유튜브 등) 브라우저로
      if (mac) {
        const args = link ? ['-a', app, link] : ['-a', app];
        const r = spawnSync('open', args, { encoding: 'utf8', timeout: 8000 });
        if (r.status !== 0) { if (link) { openUrlFront(link); return `"${app}" 앱을 못 찾아서 기본 브라우저로 열었어요: ${link}`; } return `실패: "${app}" 앱을 찾을 수 없어요 (${(r.stderr || '').trim().slice(0, 80)})`; }
        return `✅ ${app}${link ? `로 ${link}` : ''} 열었어요`;
      }
      const r = spawnSync('cmd', ['/c', 'start', '', app, ...(link ? [link] : [])], { encoding: 'utf8', timeout: 8000, shell: false });
      if (r.status !== 0 && link) { openUrlFront(link); return `기본 브라우저로 열었어요: ${link}`; }
      return r.status === 0 ? `✅ ${app}${link ? `로 ${link}` : ''} 열었어요` : `실패: "${app}" 실행이 안 됐어요`;
    } catch (e: any) { return `실패: ${e?.message || e}`; }
  };
  const getYoutube = () => realtimeFor('youtube');
  // 💻 깃허브 실데이터 — 개발자 에이전트가 커밋 현황을 직접 본다
  const getGithub = async (): Promise<string> => {
    const cc = loadConfig(); const g = (cc.apiConn || {}).github || {};
    if (!g.GITHUB_TOKEN || !g.GITHUB_DEFAULT_REPO) return '(깃허브 미연결 — 🗂️ 연동 → GitHub에 토큰·레포를 넣으면 커밋 현황을 보여드려요)';
    const r = await listCommits(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO, 15).catch(() => null);
    if (!r?.ok || !r.commits?.length) return `(커밋을 못 읽었어요: ${(r as any)?.error || '레포 확인 필요'})`;
    return `[레포 ${g.GITHUB_DEFAULT_REPO} — 최근 커밋 ${r.commits.length}개]\n` + r.commits.map(c => `- ${c.date?.slice(0, 10)} ${c.msg.split('\n')[0].slice(0, 70)} (${c.author})`).join('\n');
  };
  // 💻 서비스 레포 파일 읽기 — 에이전트가 코드를 고치기 전 현재 내용 확인 (공개 레포는 토큰 없이도)
  const readRepoFile = async (repo: string, path: string): Promise<string> => {
    const cc = loadConfig(); const g = (cc.apiConn || {}).github || {};
    if (!repo) return '⚠️ 레포를 지정하세요 (서비스에 등록한 owner/repo).';
    const r = await getRepoFile(g.GITHUB_TOKEN || '', repo, path).catch((e: any) => ({ ok: false, error: String(e?.message || e) } as any));
    return r.ok ? (r.text || '(빈 파일)') : `⚠️ ${r.error}`;
  };
  // 📥 받은 메일함 — 비서 에이전트가 안 읽은 메일을 직접 확인
  const checkEmail = async (): Promise<string> => {
    const cc = loadConfig(); const e = (cc.apiConn || {}).email || {};
    if (!e.SMTP_USER || !e.SMTP_PASS) return '(이메일 미연결 — 🗂️ 연동 → Email에 계정을 넣으면 메일함을 확인해드려요)';
    const host = e.IMAP_HOST || (e.SMTP_HOST || '').replace(/^smtp\./, 'imap.') || 'imap.gmail.com';
    const r = await fetchUnseen({ host, port: e.IMAP_PORT || '993', user: e.SMTP_USER, pass: e.SMTP_PASS }, 5).catch(() => null);
    if (!r?.ok) return `(메일함을 못 열었어요: ${(r as any)?.error || 'IMAP 설정 확인'})`;
    if (!r.mails?.length) return '안 읽은 새 메일이 없어요. 메일함이 깨끗합니다.';
    return `[안 읽은 메일 ${r.mails.length}통]\n` + r.mails.map(m => `- ${m.fromName || m.from} | ${m.subject} | ${(m.text || '').replace(/\s+/g, ' ').slice(0, 100)}`).join('\n');
  };
  const sendTelegram = async (msg: string): Promise<string> => {
    const cc = loadConfig(); const tok = cc.telegramToken, chat = cc.telegramChatId;
    if (!tok || !chat) return '텔레그램이 연결 안 됐어요. 🗂️ 연동 → Telegram에 봇 토큰과 chat_id를 넣으세요.';
    try { await tgPost(tok, chat, msg); return '✅ 텔레그램으로 보냈어요.'; }
    catch (e: any) { return `텔레그램 전송 실패: ${e?.response?.data?.description || e?.message}`; }
  };
  return { company: c.company, agentName: c.agentName, workspace: c.workspace || defaultWorkspace(), servicesInfo: servicesInfo(c), target: { base: c.llmBase, model: c.llmModel, key: geminiKey() }, signal, realtimeFor, getRevenue, getYoutube, sendTelegram, getGithub, readRepoFile, checkEmail, captureScreen, readClipboard, openPath, openApp, startServer: (cmd: string) => startServer(cmd, c.workspace || defaultWorkspace()), attachImages, userTitle: c.userTitle || '사장님', agentModels: c.agentModels || {},
    // ⌨️ 에이전트 명령 → 앱 터미널에 실시간 표시 (처음 쓸 때 터미널 자동 펼침)
    onTerminal: (kind: 'cmd' | 'out' | 'exit', text: string) => { termSend(kind === 'out' ? 'data' : kind, text + '\n'); if (kind === 'cmd') { try { win?.webContents.send('term:show'); } catch { /* */ } } } };
}

ipcMain.handle('company:run', async (_e, text: string, attach?: { paths?: string[]; images?: string[] }) => {
  const c = loadConfig();
  // ⚡ 명확한 열기 명령 = 즉시 실행 (모델 경유 X — 컨텍스트에 휘둘리지 않음. 로직은 engine/intent.ts, scripts/simulate.ts가 자동 검증)
  const qi = quickIntent(text, c.workspace || defaultWorkspace());
  if (qi && c.tools !== false) {
    history.push({ role: 'user', content: text });
    emitEngine({ kind: 'status', text: `🖥️ ${qi.label} 여는 중…` });
    const opts0 = buildRunOpts(c, new AbortController().signal);
    const r = qi.dir ? await (opts0 as any).openPath(qi.dir) : await (opts0 as any).openApp(qi.app || '', qi.url);
    emitEngine({ kind: 'tool', name: qi.dir ? 'open' : 'open_app', path: qi.label.slice(0, 40), ok: !/실패/.test(r) });
    emitEngine({ kind: 'final', text: r });
    history.push({ role: 'assistant', content: r });
    return true;
  }
  // 📎 첨부: 파일 경로는 메시지에 알려주고, 이미지는 비전으로 모델에 직접 보여준다
  const attachPaths = (attach?.paths || []).filter(Boolean);
  const attachImages = (attach?.images || []).filter(Boolean);
  if (attachPaths.length) text = `${text}\n\n[사장님이 첨부한 파일 경로 — 필요하면 read_file·open·run·serve로 다뤄라]\n${attachPaths.join('\n')}`;
  runAbort?.abort();                 // 이전 실행이 남아있으면 정리
  runAbort = new AbortController();
  const opts = buildRunOpts(c, runAbort.signal, attachImages);
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
ipcMain.handle('brain:list', () => allNotes().map(n => ({ id: n.id, text: n.text, ts: n.ts, category: n.category || 'general', source: n.source || 'me', verified: !!n.verified })).sort((a, b) => b.ts - a.ts));
ipcMain.handle('brain:count', () => noteCount());
ipcMain.handle('brain:delete', (_e, id: string) => { deleteNote(id); return noteCount(); });
// 📊 분야별 두뇌 성장 통계 (마케팅·코딩·디자인·사업·일반) — 개수·검증·파인튜닝 준비 여부
ipcMain.handle('brain:stats', () => categoryStats());
// 🧬 학습 데이터 내보내기 — 두뇌를 JSONL로(클라우드 QLoRA 학습용). 분야를 instruction 컨텍스트로 감싼다.
ipcMain.handle('brain:exportJsonl', () => {
  const notes = allNotes();
  if (!notes.length) return { ok: false, error: '두뇌에 저장된 지식이 없어요. 먼저 지식을 쌓아주세요.' };
  const catLabel: Record<string, string> = { marketing: '마케팅', coding: '개발', design: '디자인', business: '사업', general: '일반' };
  const lines = notes.map(n => {
    const cat = catLabel[(n.category as string) || 'general'] || '일반';
    // 지식 1건 → 간단한 instruction/output 쌍(체득용). 더 좋은 품질은 Q&A 쌍 권장.
    return JSON.stringify({ instruction: `${cat} 관련해서 내가 아는 것을 알려줘.`, output: n.text });
  });
  const dir = path.join(app.getPath('userData'), 'training'); try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
  const file = path.join(dir, 'brain.jsonl');
  try { fs.writeFileSync(file, lines.join('\n'), 'utf8'); } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  return { ok: true, file, count: lines.length };
});
// 분야 미리보기(입력 중 자동분류 표시) — 저장 안 함
// 🔌 에제르 브릿지 상태 — 수신중/양보(다른 앱 점유)/꺼짐
ipcMain.handle('bridge:status', () => bridgeStatus());

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
ipcMain.handle('services:add', (_e, s: { name: string; url: string; desc: string; repo?: string; market?: string; price?: string }) => {
  const c = loadConfig();
  const svc: Service = { id: 's' + Date.now(), name: (s.name || '').trim(), url: (s.url || '').trim(), desc: (s.desc || '').trim(), repo: (s.repo || '').trim(), market: (s.market || '').trim(), price: (s.price || '').trim() };
  saveConfig({ services: [...c.services, svc] });
  return loadConfig().services;
});
ipcMain.handle('services:update', (_e, id: string, patch: Partial<Service>) => {
  const c = loadConfig();
  saveConfig({ services: c.services.map(x => x.id === id ? { ...x, ...patch } : x) });
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
    return { id: s.id, name: s.name, url: s.url, desc: s.desc, repo: s.repo || '', type, snapshot };
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
  conn.toss = { TOSS_SECRET_KEY: c.tossSecretKey || '', ...(conn.toss || {}) };
  conn.gemini = { GEMINI_API_KEY: (c.apiKeys || {}).gemini || '', ...(conn.gemini || {}) };
  return conn;
});
ipcMain.handle('api:save', async (_e, serviceId: string, values: Record<string, string>) => {
  const c = loadConfig();
  const apiConn = { ...(c.apiConn || {}), [serviceId]: values };
  const patch: any = { apiConn };
  // 레거시 소비처(매출/텔레그램/제미나이)와 동기화 — 기존 기능 안 깨지게
  if (serviceId === 'paypal') { patch.paypalClientId = values.PAYPAL_CLIENT_ID || ''; patch.paypalSecret = values.PAYPAL_CLIENT_SECRET || ''; }
  if (serviceId === 'toss') { patch.tossSecretKey = (values.TOSS_SECRET_KEY || '').trim(); }
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
    await tgPost(c.telegramToken, c.telegramChatId, `✅ Connect AI 연결 완료 — ${c.agentName}가 인사드립니다, ${c.userTitle || '사장님'}!\n\n📱 여기서 "운영" 이라고 보내면 어디서든 회사를 돌릴 수 있어요:\n분석 → 작전 제안 → 번호로 승인 → 실행 → 결과 보고`);
    return { ok: true };
  } catch (e: any) { return { ok: false, reason: e?.response?.data?.description || e?.message || '전송 실패' }; }
});

// 👤 회원(Firebase Auth) — 이메일/비밀번호 회원가입·로그인. 토큰은 학습 서버 인증에 쓰임.
//    Web API Key·DB URL은 공개값(앱에 넣어도 안전). 제공자가 채우거나 설정에서 입력.
const DEFAULT_FIREBASE_API_KEY = 'AIzaSyAKcmDV-_1OF8XRQHLdxQcvSb7vqbrlAnU';   // samoyed 웹 공개키 — 웹(EZERAI)과 같은 회원 풀
const DEFAULT_FIREBASE_DB = 'https://samoyed-fit-2026-jay-default-rtdb.asia-southeast1.firebasedatabase.app';
const fbApiKey = () => (loadConfig().firebaseApiKey || DEFAULT_FIREBASE_API_KEY || '').trim();
const fbDbUrl = () => (loadConfig().firebaseDbUrl || DEFAULT_FIREBASE_DB || '').replace(/\/+$/, '');
// 🌐 광장 DB — 기본 내장(설정 안 해도 전원 같은 광장에 접속). plaza/rooms/lobby 경로는 공개 규칙.
const plazaDb = () => (loadConfig().plazaDbUrl || DEFAULT_FIREBASE_DB || '').replace(/\/+$/, '');
const authPretty = (e: any) => { const m = e?.response?.data?.error?.message || ''; const map: any = { EMAIL_EXISTS: '이미 가입된 이메일이에요.', EMAIL_NOT_FOUND: '가입되지 않은 이메일이에요.', INVALID_PASSWORD: '비밀번호가 틀렸어요.', INVALID_LOGIN_CREDENTIALS: '이메일 또는 비밀번호가 틀렸어요.', WEAK_PASSWORD: '비밀번호는 6자 이상이어야 해요.', INVALID_EMAIL: '이메일 형식이 올바르지 않아요.' }; return map[m] || m || e?.message || '인증 실패'; };
async function fbAuth(kind: 'signUp' | 'signInWithPassword', email: string, password: string, profile?: { name?: string; phone?: string; marketing?: boolean }) {
  const key = fbApiKey(); if (!key) return { ok: false, error: '회원 시스템이 아직 설정 안 됐어요(관리자에 문의).' };
  try {
    const r = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:${kind}?key=${key}`, { email, password, returnSecureToken: true }, { timeout: 15000 });
    const d = r.data; const auth = { uid: d.localId, email: d.email, refreshToken: d.refreshToken };
    saveConfig({ auth });
    // 멤버 프로필 — EZERAI 웹과 같은 users/<uid> 스키마(name·phone·marketingAgreed·plan·source)
    if (kind === 'signUp') {
      if (profile?.name) { try { await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${key}`, { idToken: d.idToken, displayName: profile.name, returnSecureToken: false }, { timeout: 10000 }); } catch { /* */ } }
      if (fbDbUrl()) { try { await axios.patch(`${fbDbUrl()}/users/${d.localId}.json?auth=${d.idToken}`, { email: d.email, name: profile?.name || '', phone: profile?.phone || '', marketingAgreed: !!profile?.marketing, plan: 'free', createdAt: Date.now(), source: 'connect-ai-desktop' }, { timeout: 10000 }); } catch { /* */ } }
    }
    return { ok: true, uid: d.localId, email: d.email, idToken: d.idToken };
  } catch (e: any) { return { ok: false, error: authPretty(e) }; }
}
// 저장된 refreshToken → 새 idToken (로그인 유지)
async function fbIdToken(): Promise<{ uid: string; email: string; idToken: string } | null> {
  const c = loadConfig(); const key = fbApiKey(); if (!c.auth?.refreshToken || !key) return null;
  try {
    const r = await axios.post(`https://securetoken.googleapis.com/v1/token?key=${key}`, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.auth.refreshToken }), { timeout: 15000 });
    const d = r.data; if (d.refresh_token && d.refresh_token !== c.auth.refreshToken) saveConfig({ auth: { ...c.auth, refreshToken: d.refresh_token } });
    return { uid: d.user_id || c.auth.uid, email: c.auth.email, idToken: d.id_token };
  } catch { return null; }
}
ipcMain.handle('auth:signup', async (_e, email: string, password: string, profile?: any) => await fbAuth('signUp', (email || '').trim(), password || '', profile));
ipcMain.handle('auth:login', async (_e, email: string, password: string) => await fbAuth('signInWithPassword', (email || '').trim(), password || ''));
ipcMain.handle('auth:logout', () => { saveConfig({ auth: undefined } as any); return { ok: true }; });
ipcMain.handle('auth:current', () => { const c = loadConfig(); return c.auth ? { uid: c.auth.uid, email: c.auth.email, configured: !!fbApiKey() } : { configured: !!fbApiKey() }; });

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

// ⚡ 단기 기억 = GitHub 동기화 / 🧬 장기 기억 = HuggingFace 업로드
const connOf = (svc: string) => (loadConfig().apiConn || {})[svc] || {};
const geminiKey = () => { const c = loadConfig(); return (c.apiConn?.gemini?.GEMINI_API_KEY) || (c.apiKeys?.gemini) || ''; };

// 📱 폰 웹 리모컨(LAN) + 🌍 외부 릴레이(RTDB) — 같은 지휘 함수 공유
const remoteDeps: RelayDeps = {
  db: () => loadConfig().plazaDbUrl || '',
  pair: () => loadConfig().remotePair || '',
  company: () => loadConfig().company || '내 회사',
  status: () => opsPublic(),
  startCycle: async () => {
    opsState.running = true; if (!opsState.startedAt) opsState.startedAt = Date.now();
    opsState.cycle = (opsState.cycle || 0) + 1;
    return await runOperation();
  },
  execute: (titles, humanTitles) => doExecuteSelected(titles, humanTitles),
  stop: () => { opsState.running = false; opsState.executing = false; opsState.phase = 'idle'; opsState.activity = ''; opsState.executingTitle = ''; opsExecAbort?.abort(); saveOpsState(); opsEmit(); return opsPublic(); },
};
function startPhoneRemote() {
  const c = loadConfig();
  if (!c.remotePair) saveConfig({ remotePair: Math.random().toString(36).slice(2, 10) });   // 페어링 코드 1회 생성
  startRemote(remoteDeps);                       // 📱 LAN (:4830)
  startRelay(remoteDeps);                        // 🌍 RTDB 릴레이 (plazaDbUrl 설정돼 있으면 자동)
}
ipcMain.handle('remote:info', () => {
  const c = loadConfig();
  return { ...remoteInfo(), relay: { db: c.plazaDbUrl || '', pair: c.remotePair || '', ready: !!(c.plazaDbUrl && c.remotePair) } };
});

// 🔌 EZERAI 브릿지 시작 — 웹 브레인팩 마켓이 :4825로 지식·스킬·템플릿·디자인을 주입
function startConnectBridge() {
  startBridge({
    status: () => { const c = loadConfig(); return { defaultModel: c.llmModel || '자동', brain: { fileCount: noteCount(), enabled: c.tools !== false } }; },
    workspace: () => loadConfig().workspace || defaultWorkspace(),
    addKnowledge: async (title: string, markdown: string) => {
      const text = `# ${title}\n${markdown}`.slice(0, 8000);
      let emb: number[] | null = null;
      try { const t = await detectTarget({ base: loadConfig().llmBase, model: loadConfig().llmModel, key: geminiKey() }); if (t) emb = await embed(t.base, text); } catch { /* 임베딩 없어도 키워드 RAG */ }
      brainAddNote(text, emb || undefined, { source: 'ezerai', verified: true });   // 에제르 큐레이션 팩 = 검증됨
    },
    runExam: async (prompt: string) => {
      const c = loadConfig();
      const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() });
      if (!target) return '⚠️ AI 모델(LM Studio/Ollama)을 먼저 켜주세요.';
      try { return (await chat(target, agentPrompt(c.agentName, c.company, c.userTitle || '사장님'), prompt, { temperature: 0.5 })).trim(); } catch (e: any) { return `오류: ${e?.message || e}`; }
    },
    onInject: (kind: string, label: string, dir?: string) => {
      const emoji: any = { knowledge: '🧠', skill: '🐍', template: '📦', design: '🎨' };
      // FX 색상용 분야: 지식은 제목으로 자동분류, 스킬=코딩·디자인=디자인
      const category: Category = kind === 'skill' ? 'coding' : kind === 'design' ? 'design' : kind === 'knowledge' ? classify(label) : 'general';
      notify(`${emoji[kind] || '🔌'} EZERAI 주입`, `${label} — Connect AI에 들어왔어요`);
      win?.webContents.send('engine:event', { kind: 'status', text: `${emoji[kind] || '🔌'} EZERAI 브레인팩 주입: ${label}` });
      win?.webContents.send('bridge:inject', { kind, label, dir, category });   // 렌더러: 파일트리 새로고침 + FX
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
  // ① Connect AI 표준 형식(connect-ai/knowledge.json) ② 범용: 레포의 마크다운/텍스트 지식 파일
  const r = await pullKnowledge(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO);
  let added = 0;
  if (r.ok) added += importNotes(r.notes || [], { source: 'me', verified: true });
  const md = await importRepoMarkdown(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO);
  let scanned = 0, skipped = 0, capped = false;
  if (md.ok) { added += importNotes(md.notes || [], { source: 'me', verified: true }); scanned = md.scanned || 0; skipped = md.skipped || 0; capped = !!md.capped; }
  if (!r.ok && !md.ok) return { ok: false, error: md.error || r.error };
  return { ok: true, added, total: noteCount(), scanned, skipped, capped };
});

// ── 🧠 제이 브레인 링크 — 멘토(대장)가 지식을 비번으로 암호화 게시 → 구독자만 연동 ──────
const parseRepo = (repo: string) => { const s = (repo || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/^git@github\.com:/i, '').replace(/\.git$/i, ''); const p = s.split('/').filter(Boolean); return { owner: p[0] || '', name: (p[1] || '').replace(/[#?].*$/, '') }; };
// 📤 게시(대장) — 내 지식을 비번으로 잠가 공개 레포에 (암호화돼서 공개여도 안전)
ipcMain.handle('brain:publishPack', async (_e, password: string) => {
  const g = connOf('github');
  const notes = allNotes();
  if (!notes.length) return { ok: false, error: '게시할 지식이 없어요. 먼저 지식을 쌓으세요.' };
  if (!password || password.length < 4) return { ok: false, error: '비밀번호를 4자 이상 입력하세요.' };
  const slim = notes.map((n: any) => ({ text: n.text, tags: n.tags, category: n.category, ts: n.ts }));
  const blob = encryptPack(JSON.stringify(slim), password);
  const r = await pushFile(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO, 'connect-ai/brain.enc', blob, `🔒 제이 브레인 링크 게시 (${notes.length}개)`);
  if (!r.ok) return r;
  const { owner, name } = parseRepo(g.GITHUB_DEFAULT_REPO);
  return { ok: true, repo: `${owner}/${name}`, count: notes.length };
});
// 🧠 연동(구독자) — 멘토 레포의 암호화 두뇌를 비번으로 복호화해 가져옴
ipcMain.handle('brain:linkBrain', async (_e, repoOrUrl: string, password: string) => {
  const { owner, name } = parseRepo(repoOrUrl);
  if (!owner || !name) return { ok: false, error: '멘토 레포를 owner/repo 로 입력하세요 (예: wonseokjung/memory).' };
  if (!password) return { ok: false, error: '비밀번호를 입력하세요.' };
  let blob = '';
  for (const br of ['main', 'master']) {
    try { const res = await axios.get(`https://raw.githubusercontent.com/${owner}/${name}/${br}/connect-ai/brain.enc`, { timeout: 15000, responseType: 'text', transformResponse: [(d: any) => d] }); blob = res.data; break; }
    catch (e: any) { if (e?.response?.status !== 404) return { ok: false, error: '다운로드 실패: ' + (e?.message || e) }; }
  }
  if (!blob) return { ok: false, error: '멘토 브레인이 아직 게시 안 됐어요 (connect-ai/brain.enc 없음).' };
  let plain = '';
  try { plain = decryptPack(blob, password); } catch { return { ok: false, error: '비밀번호가 틀렸어요. (또는 만료된 비번)' }; }
  let notes: any[] = [];
  try { notes = JSON.parse(plain); } catch { return { ok: false, error: '데이터 형식 오류' }; }
  const added = importNotes(notes, { source: 'jay', verified: true });
  return { ok: true, added, total: noteCount() };
});
// ── 🧬 장기기억 만들기: ① 변환 → ② 업로드 → ③ 모델 이름·학습 ───────────────
let lastBrainJsonl = '';          // 변환 결과(세 단계가 공유)
let lastBrainPairs = 0;
async function genQuestion(target: any, n: any, temp: number): Promise<string> {
  try {
    const sys = '너는 학습 데이터 출제자다. 주어진 지식을 사용자가 물어볼 법한 자연스러운 한국어 질문 하나만 만들어라. 질문만 한 줄, 따옴표 없이.';
    const u = `분야: ${CATEGORIES[(n.category || 'general') as Category]?.label || '일반'}\n지식: ${dsTitle(n.text)} — ${n.text.slice(0, 300)}`;
    const r = await chat(target, sys, u, { temperature: temp });
    return ((r || '').split('\n').map((s: string) => s.trim()).filter(Boolean)[0] || '').replace(/^["'?\-•\s]+|["'\s]+$/g, '').slice(0, 120);
  } catch { return ''; }
}
// ① 변환 — 단기 지식 → conversations Q&A. 🔬증강 시 노트당 질문 2개(다양성=echo 방지).
ipcMain.handle('brain:buildDataset', async (_e, augment?: boolean) => {
  const notes = allNotes();
  if (!notes.length) return { ok: false, error: '학습할 지식이 없어요. 먼저 단기 기억에 쌓으세요.' };
  const c = loadConfig();
  let target: any = null;
  try { target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() }); } catch { /* */ }
  const pairs: { q: string; a: string }[] = [];
  let i = 0;
  for (const n of notes) {
    i++;
    const qs: string[] = [];
    const want = augment ? 2 : 1;
    for (let k = 0; k < want; k++) {
      let q = target ? await genQuestion(target, n, 0.6 + k * 0.3) : '';
      if (!q) q = fallbackQuestion(n);
      if (!qs.includes(q)) qs.push(q);
    }
    for (const q of qs) pairs.push({ q, a: trimAnswer(n.text) });
    win?.webContents.send('dataset:progress', { done: i, total: notes.length, q: qs[0].slice(0, 60) });
  }
  lastBrainJsonl = toConversationsJsonl(pairs);
  lastBrainPairs = lastBrainJsonl ? lastBrainJsonl.split('\n').filter(Boolean).length : 0;
  if (!lastBrainPairs) { lastBrainJsonl = ''; return { ok: false, error: '학습할 내용이 너무 짧아요 — 지식이 한두 글자뿐이면 학습이 안 돼요. 문장 단위로 좀 더 자세히 쌓은 뒤 다시 변환해 주세요.' }; }   // 🛡️ 빈/부실 데이터셋으로 학습 망가지는 것 방지
  try { fs.writeFileSync(path.join(os.homedir(), 'Desktop', 'connect-ai-brain.jsonl'), lastBrainJsonl, 'utf8'); } catch { /* */ }
  return { ok: true, notes: notes.length, pairs: lastBrainPairs, llm: !!target, augment: !!augment, sample: pairs.slice(0, 3).map(p => ({ q: p.q, a: p.a.slice(0, 90) })) };
});
// ② 업로드 — 변환된 데이터셋을 HF에
ipcMain.handle('hf:uploadBrain', async () => {
  const h = connOf('huggingface');
  if (!lastBrainJsonl) return { ok: false, error: '먼저 ① 변환을 눌러 데이터셋을 만드세요.' };
  return await uploadDataset(h.HF_TOKEN, h.HF_REPO, lastBrainJsonl, 'connect-ai-brain.jsonl');
});
// ── ⚖️ AI 자동 피드백 (RLAIF·DPO) — AI가 좋은답/나쁜답을 스스로 만들어 선호쌍 생성 ──────
let lastDpoJsonl = '';
ipcMain.handle('brain:buildPreference', async () => {
  const notes = allNotes();
  if (!notes.length) return { ok: false, error: '지식이 없어요. 먼저 단기 기억에 쌓으세요.' };
  const c = loadConfig();
  let target: any = null;
  try { target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() }); } catch { /* */ }
  if (!target) return { ok: false, error: '🤖 내 AI에서 두뇌(모델)를 먼저 켜주세요. AI가 좋은답/나쁜답을 생성합니다.' };
  const rows: { prompt: string; chosen: string; rejected: string }[] = [];
  let i = 0;
  for (const n of notes) {
    i++;
    let q = await genQuestion(target, n, 0.6); if (!q) q = fallbackQuestion(n);
    const chosen = trimAnswer(n.text);   // 지식 기반 = 좋은 답(구체적)
    let rejected = '';
    try { rejected = (await chat(target, '너는 일부러 두루뭉술하고 구체성·실행안 없이 짧게 답하는 봇이다. 한두 문장.', q, { temperature: 0.9 })).trim().slice(0, 300); } catch { /* */ }
    if (!rejected || rejected === chosen) rejected = '음, 상황마다 다르죠. 알아서 잘 해보세요.';
    rows.push({ prompt: q, chosen, rejected });
    win?.webContents.send('dataset:progress', { done: i, total: notes.length, q: q.slice(0, 60) });
  }
  lastDpoJsonl = rows.map(r => JSON.stringify(r)).join('\n');
  try { fs.writeFileSync(path.join(os.homedir(), 'Desktop', 'connect-ai-dpo.jsonl'), lastDpoJsonl, 'utf8'); } catch { /* */ }
  return { ok: true, notes: notes.length, pairs: rows.length, sample: rows.slice(0, 3).map(r => ({ q: r.prompt, chosen: r.chosen.slice(0, 70), rejected: r.rejected.slice(0, 70) })) };
});
ipcMain.handle('hf:uploadPreference', async () => {
  const h = connOf('huggingface');
  if (!lastDpoJsonl) return { ok: false, error: '먼저 ① AI 피드백 생성을 누르세요.' };
  return await uploadDataset(h.HF_TOKEN, h.HF_REPO, lastDpoJsonl, 'connect-ai-dpo.jsonl');
});
// ③ 모델 이름 제안(이전 버전 → 다음 버전)
ipcMain.handle('brain:modelName', () => { const c: any = loadConfig(); return { suggested: nextModelName(c.brainModelName), prev: c.brainModelName || '' }; });
// ☁️ "내 AI 키우기" — 코랩 없이 HF Jobs로 학습 (무료 월 1회). 변환→업로드(데이터셋+스크립트)→GPU 작업 실행.
function scriptText(name: string): string {
  for (const p of [path.join(__dirname, '..', 'training', name), path.join(process.resourcesPath || '', 'training', name)]) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch { /* */ }
  }
  return '';
}
function uvScriptText(): string { return scriptText('train_qlora_uv.py'); }
// 제공자가 배포 후 채우는 기본 백엔드 (비우면 사용자 토큰 직접 모드). config.trainBackendUrl 로 덮어쓰기 가능.
const DEFAULT_TRAIN_BACKEND = 'https://wonseokjayjung-connectai.hf.space';   // ☁️ Connect AI 학습·합성 백엔드 (HF Space 문지기 — /train·/merge·/trainStatus·/mergeStatus). GCP 불필요, 토큰·잡 전부 HF.
const trainBackendBase = (c: Config) => ((c.trainBackendUrl || DEFAULT_TRAIN_BACKEND || '').replace(/\/+$/, ''));
function installId(): string { const c = loadConfig() as any; if (c.installId) return c.installId; const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); saveConfig({ installId: id } as any); return id; }
function brainToJsonl(): string { const notes = allNotes(); return notes.map(n => JSON.stringify({ instruction: '다음 내용에 대해 알려줘.', output: (n.text || '').slice(0, 1200) })).join('\n'); }
// 무료 노트북에 직접 심을 conversations 형식 — ① 변환 없이도 지식 그대로(AI 호출 X)
function brainToConversationsJsonl(): string {
  // 🎯 질문을 지식별로 다양화 — 모든 예시에 같은 질문("다음 내용에 대해…")을 붙이면 모델이
  //    "아무 질문에나 노트를 덤프"하도록 학습돼 출력이 망가진다. 키워드 앵커 + 템플릿 회전으로 신호를 살린다.
  const QS = ['{k}에 대해 알려줘.', '{k} 관련해서 설명해줘.', '{k}이(가) 뭔지 알려줄래?', '{k}에 대해 네가 아는 걸 말해줘.', '{k}을(를) 정리해서 설명해줘.', '{k}에 대해 자세히 알려줘.'];
  return allNotes().map((n, i) => {
    const text = (n.text || '').trim(); if (!text) return '';
    const k = (Array.isArray((n as any).tags) && (n as any).tags[0]) || text.replace(/^[🏛️💡#\s]+/, '').split(/[\s.,·\n]/).filter(Boolean)[0] || '이것';
    const q = QS[i % QS.length].replace(/\{k\}/g, k);
    return JSON.stringify({ conversations: [{ role: 'user', content: q }, { role: 'assistant', content: text.slice(0, 1200) }] });
  }).filter(Boolean).join('\n');
}

// 🔒 GPU 기능 게이트 — 비밀번호(0101) + 월 3회 제한, 학습·수술 각각 따로 카운트
//    👑 관리자 비밀번호(0003) = 무제한 (횟수 제한·카운트 모두 무시)
const GPU_PW = '0101';
const GPU_ADMIN_PW = '0003';
const GPU_MONTHLY_LIMIT = 3;
type GpuKind = 'train' | 'surgery';
function gpuMonth() { return new Date().toISOString().slice(0, 7); }   // YYYY-MM
function isGpuAdmin(password: string): boolean { return (password || '').trim() === GPU_ADMIN_PW; }
function gpuUsageOf(kind: GpuKind): number { const c = loadConfig(); const m = gpuMonth(); const u: any = c.gpuUsage; return (u && u.month === m) ? (u[kind] || 0) : 0; }
function gpuGate(password: string, kind: GpuKind): { ok: boolean; error?: string; left?: number; admin?: boolean } {
  if (isGpuAdmin(password)) return { ok: true, left: 999, admin: true };   // 👑 무제한
  if (!(password || '').trim()) return { ok: false, error: `비밀번호를 입력해주세요.` };
  if ((password || '').trim() !== GPU_PW) return { ok: false, error: `비밀번호가 맞지 않아요.` };
  const used = gpuUsageOf(kind);
  const what = kind === 'train' ? '학습' : '수술';
  if (used >= GPU_MONTHLY_LIMIT) return { ok: false, error: `이번 달 ${what} 횟수(${GPU_MONTHLY_LIMIT}회)를 다 썼어요. 다음 달에 다시 가능해요.` };
  return { ok: true, left: GPU_MONTHLY_LIMIT - used };
}
function gpuUse(kind: GpuKind, password = '') { if (isGpuAdmin(password)) return; const c = loadConfig(); const m = gpuMonth(); const u: any = (c.gpuUsage && (c.gpuUsage as any).month === m) ? c.gpuUsage : { month: m, train: 0, surgery: 0 }; saveConfig({ gpuUsage: { month: m, train: u.train || 0, surgery: u.surgery || 0, [kind]: (u[kind] || 0) + 1 } as any }); }
ipcMain.handle('gpu:usage', (_e, kind: GpuKind = 'train') => { const used = gpuUsageOf(kind); return { used, limit: GPU_MONTHLY_LIMIT, left: Math.max(0, GPU_MONTHLY_LIMIT - used) }; });

// 🎒 누적 전적 — 학습 1회 = 데이터셋 1개 + 레벨업, 합성 1회 = fusion. 인벤토리/광장 프로필의 원천.
function bumpStat(kind: 'train' | 'fusion') {
  const c = loadConfig(); const s = c.stats || { trains: 0, datasets: 0, fusions: 0 };
  if (kind === 'train') saveConfig({ stats: { trains: (s.trains || 0) + 1, datasets: (s.datasets || 0) + 1, fusions: s.fusions || 0 } });
  else saveConfig({ stats: { trains: s.trains || 0, datasets: s.datasets || 0, fusions: (s.fusions || 0) + 1 } });
  if (plaza) void pushMyProfile(plaza.uid);   // 🎒 전적이 늘면 광장 프로필도 즉시 갱신
}
// 🎒 내 AI 보유 현황 — 로컬 모델 + 내 HF 모델 합산(보유), 누적 전적(데이터셋·합성·학습) 결합
async function gatherInventory() {
  const c = loadConfig();
  const localList = (() => { try { return listLocalModels(modelsDir()); } catch { return []; } })();
  let hfModels: string[] = [];
  try {
    const h = connOf('huggingface');
    if (h.HF_TOKEN) {
      const me = await hfUsername(h.HF_TOKEN);
      if (me) { const r: any = await axios.get(`https://huggingface.co/api/models?author=${encodeURIComponent(me)}&limit=100&full=false`, { headers: { Authorization: `Bearer ${h.HF_TOKEN}` }, timeout: 12000 }); hfModels = (r.data || []).map((m: any) => m.id || m.modelId).filter(Boolean); }
    }
  } catch { /* HF 조회 실패해도 로컬 기준으로 표시 */ }
  const s = c.stats || { trains: 0, datasets: 0, fusions: 0 };
  const localCount = localList.length;
  const models = localCount + hfModels.length;
  const trains = s.trains || 0, datasets = s.datasets || 0, fusions = s.fusions || 0;
  const topModel = (localList[0] as any)?.name || hfModels[0] || c.llmModel || '내 두뇌';
  return { models, localModels: localCount, hfModels: hfModels.length, datasets, fusions, trains, totalLevel: trains + fusions, topModel };
}
ipcMain.handle('inventory:get', () => gatherInventory());
// 🧬 내 AI 팀 — 학습/합성으로 만든 모델을 캐릭터로 기록
function recordCreatedModel(method: 'train' | 'fusion', id: string, name?: string, baseModel?: string) {
  if (!id) return;
  const c = loadConfig(); const cm = { ...(c.createdModels || {}) };
  const prev = cm[id] || { id, createdAt: Date.now() };
  cm[id] = { ...prev, id, method, baseModel: baseModel || prev.baseModel, name: prev.name || name || id.split('/').pop() };
  saveConfig({ createdModels: cm });
}
// 내 AI 팀 목록 — 내 HF 모델 + 기록된 캐릭터 메타 합쳐서 반환
ipcMain.handle('created:list', async () => {
  const c = loadConfig(); const created = c.createdModels || {};
  let hfModels: string[] = [];
  try {
    const h = connOf('huggingface');
    if (h.HF_TOKEN) { const me = await hfUsername(h.HF_TOKEN); if (me) { const r: any = await axios.get(`https://huggingface.co/api/models?author=${encodeURIComponent(me)}&limit=100&full=false`, { headers: { Authorization: `Bearer ${h.HF_TOKEN}` }, timeout: 12000 }); hfModels = (r.data || []).map((m: any) => m.id || m.modelId).filter(Boolean); } }
  } catch { /* HF 실패해도 기록된 것만 표시 */ }
  const ids = Array.from(new Set([...hfModels, ...Object.keys(created)]));
  const items = ids.map(id => ({ name: id.split('/').pop(), ...(created[id] || {}), id }));
  return { ok: true, items };
});
// 내 AI 캐릭터 편집(이름·이모지/얼굴·성격) 저장
ipcMain.handle('created:save', (_e, id: string, patch: any) => {
  if (!id) return { ok: false };
  const c = loadConfig(); const cm = { ...(c.createdModels || {}) };
  cm[id] = { ...(cm[id] || { id, createdAt: Date.now() }), ...(patch || {}), id };
  saveConfig({ createdModels: cm });
  return { ok: true };
});

// 🎒 광장 프로필 업로드 — 입장/전적 변동 시 내 인벤토리를 RTDB에 덮어쓰기(작은 객체 1개)
async function pushMyProfile(uid: string) {
  try {
    const c = loadConfig(); const inv = await gatherInventory();
    await putProfile({ uid, company: c.company || '1인 기업', emoji: c.plazaEmoji || '🖥️', models: inv.models, datasets: inv.datasets, fusions: inv.fusions, trains: inv.trains, totalLevel: inv.totalLevel, topModel: inv.topModel });
  } catch { /* 프로필은 부가정보 — 실패해도 광장 동작엔 영향 없음 */ }
}
// 🎒 다른(또는 내) 캐릭터 클릭 시 그 회사의 보유 현황 조회
ipcMain.handle('plaza:profile', (_e, uid: string) => fetchProfile(uid));

ipcMain.handle('train:cloud', async (_e, accessCode = '') => {
  const gate = gpuGate(accessCode, 'train');   // 🔒 비번 0101 + 학습 월 3회
  if (!gate.ok) return { ok: false, gated: true, error: gate.error };
  const c = loadConfig();
  const backend = trainBackendBase(c);
  // ── 서비스 모드(무료 백엔드) 우선 — 실패하면 내 HF 토큰(HF Jobs)으로 폴백 ──
  const hasHf = !!connOf('huggingface').HF_TOKEN;
  if (backend) {
    const jsonl = lastBrainJsonl || brainToJsonl();
    if (!jsonl) return { ok: false, error: '두뇌에 지식이 없어요. 먼저 지식을 쌓으세요.' };
    const user = await fbIdToken();
    // 🆓 무료 서버 우선 — 본인 토큰이 있어도 로그인하면 우리 서버에서 무료. (옛 레슨 따라 토큰 넣은 회원이 결제벽에 빠지지 않게)
    if (fbApiKey() && !user) return { ok: false, needLogin: true, error: '회원으로 로그인하시면 우리 서버에서 무료로 학습됩니다. 또는 🆓 무료로 시작(코랩)을 이용하세요.' };
    if (!fbApiKey() || user) {
      try {
        const r = await axios.post(`${backend}/train`, { userId: user?.uid || installId(), idToken: user?.idToken, jsonl, accessCode, userHfToken: connOf('huggingface').HF_TOKEN || '' }, { timeout: 60000 });   // 🎁 회원 HF 연동 시 결과를 회원 계정에(소유)
        const d = r.data || {};
        if (d.ok) { gpuUse('train', accessCode); bumpStat('train'); recordCreatedModel('train', d.outputRepo || '', '', c.trainBaseModel); saveConfig({ cloudJob: { backend: true, outRepo: (d.outputRepo || '') } }); return { ...d, viaBackend: true }; }
        if (!hasHf) return { ...d, viaBackend: true };   // 백엔드가 거절 + HF 없음 → 백엔드 응답 그대로
      } catch (e: any) {
        const st = e?.response?.status;
        if (!hasHf) return { ok: false, error: `학습 서버가 잠시 불안정해요(${st || '네트워크'}). 🗂️ 연동에 HuggingFace 토큰을 넣으면 내 계정(HF Jobs)으로 바로 학습돼요.` };
        // HF 토큰 있음 → 아래 직접 모드(HF Jobs)로 폴백
      }
    }
    // 여기로 오면: 백엔드 실패/거절 + HF 토큰 있음 → 직접 모드로 폴백
  }
  // ── 직접 모드 — 사용자 본인 HF Pro 토큰 (검증/파워유저용) ──
  const h = connOf('huggingface');
  if (!h.HF_TOKEN) return { ok: false, error: '🗂️ 연동 → HuggingFace에 write 토큰을 먼저 넣으세요. (또는 학습 서버 URL 설정)' };
  // (월 사용 제한은 위 gpuGate가 처리 — 비번 0101 + 월 3회)
  // 1) 데이터셋 — 변환된 게 있으면 그걸, 없으면 두뇌로 즉석 생성
  let jsonl = lastBrainJsonl;
  if (!jsonl) {
    const notes = allNotes();
    if (!notes.length) return { ok: false, error: '두뇌에 지식이 없어요. 먼저 지식을 쌓고 (가능하면 🧬 변환을 누른 뒤) 다시 시도하세요.' };
    jsonl = notes.map(n => JSON.stringify({ instruction: '다음 내용에 대해 알려줘.', output: (n.text || '').slice(0, 1200) })).join('\n');
  }
  const me = await hfUsername(h.HF_TOKEN);
  if (!me) return { ok: false, error: 'HF 토큰 확인 실패 — write 권한 토큰인지 확인하세요.' };
  let dsRepo = (h.HF_REPO || 'connect-ai-brain').trim(); if (!dsRepo.includes('/')) dsRepo = `${me}/${dsRepo}`;
  // HF repo 이름은 ASCII만 — 한글 모델명은 깨지므로 안전하게 정리(전부 기호면 기본값)
  let mn = (c.brainModelName || '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  const modelName = /[a-zA-Z0-9]/.test(mn) ? mn : 'my-connect-ai';
  const outRepo = `${me}/${modelName}`;
  // 2) 업로드 — 두뇌 데이터셋 + UV 학습 스크립트(같은 데이터셋 repo에)
  const up = await uploadDataset(h.HF_TOKEN, dsRepo, jsonl, 'connect-ai-brain.jsonl');
  if (!up.ok) return { ok: false, error: '데이터셋 업로드 실패: ' + up.error };
  const script = uvScriptText();
  if (script) { try { await uploadDataset(h.HF_TOKEN, dsRepo, script, 'train_qlora_uv.py'); } catch { /* */ } }
  const scriptUrl = `https://huggingface.co/datasets/${dsRepo}/resolve/main/train_qlora_uv.py`;
  // 3) GPU 작업 실행 (best-effort REST + 확실한 CLI 폴백)
  const base = c.trainBaseModel || 'unsloth/llama-3.2-3b-instruct-bnb-4bit';
  const job = await launchTrainingJob(h.HF_TOKEN, me, { datasetRepo: dsRepo, outputRepo: outRepo, baseModel: base, scriptUrl });
  if (job.ok && job.jobId) { gpuUse('train', accessCode); bumpStat('train'); recordCreatedModel('train', outRepo, '', guessBase(loadConfig().llmModel)); saveConfig({ lastCloudTrainAt: Date.now(), cloudJob: { id: job.jobId, namespace: me, outRepo, ts: Date.now() } }); }
  return { ...job, dataset: `https://huggingface.co/datasets/${dsRepo}`, outRepo, modelRepo: `https://huggingface.co/${outRepo}` };
});
ipcMain.handle('train:cloudStatus', async () => {
  const c = loadConfig(); const backend = trainBackendBase(c); const j = c.cloudJob;
  if (backend && j?.backend) {
    const user = await fbIdToken(); const userId = user?.uid || installId();
    const ep = j.kind === 'merge' ? 'mergeStatus' : 'trainStatus';   // 🔪 합성/학습 각자 게이트 조회
    try { const r = await axios.get(`${backend}/${ep}`, { params: { userId }, timeout: 15000 }); if (r.data?.outputRepo) saveConfig({ cloudJob: { ...j, outRepo: r.data.outputRepo } }); return r.data; }
    catch (e: any) { return { ok: false, error: e?.response?.data?.error || e?.message || String(e) }; }
  }
  const h = connOf('huggingface');
  if (!j?.id) return { ok: false, error: '진행 중인 작업이 없어요.' };
  const s = await jobStatus(h.HF_TOKEN, j.namespace, j.id);
  return { ...s, outRepo: j.outRepo, jobUrl: `https://huggingface.co/jobs/${j.namespace}/${j.id}` };
});
ipcMain.handle('train:cloudInstall', async () => {
  const c = loadConfig(); const j = c.cloudJob;
  if (!j?.outRepo) return { ok: false, error: '학습 결과가 아직 없어요.' };
  try {
    const files = await listGGUF(j.outRepo);
    const f = (files || [])[0];
    if (!f) {
      // GGUF 없음 → 학습이 끝났는지(어댑터/safetensors 존재) 확인해 정확히 안내 (변환 실패 vs 아직 진행중 구분)
      let hasModel = false;
      try { const tr = await axios.get(`https://huggingface.co/api/models/${j.outRepo}/tree/main?recursive=1`, { timeout: 12000 }); hasModel = (tr.data || []).some((e: any) => /\.safetensors$|adapter_config\.json$|adapter_model/i.test(e.path || '')); } catch { /* */ }
      const isMerge = j.kind === 'merge';   // 🔪 합성/학습 문구 구분
      if (hasModel) return { ok: false, adapterOnly: true, repo: `https://huggingface.co/${j.outRepo}`, error: isMerge ? '합성은 끝났는데 자동 GGUF 변환이 실패해 모델 파일(safetensors)만 올라가 있어요. 🔁 다시 합성하면 GGUF까지 재시도해요. (이 형식은 앱 내장 엔진에서 바로 못 켜요)' : '학습은 끝났는데 자동 GGUF 변환이 실패해 어댑터(safetensors)만 올라가 있어요. 🔁 다시 학습을 돌리면 GGUF까지 재시도해요. (어댑터 형식은 앱 내장 엔진에서 바로 못 켜요)' };
      return { ok: false, error: `아직 GGUF가 없어요 — ${isMerge ? '합성' : '학습'}이 진행 중이거나 막 끝난 직후일 수 있어요. 잠시 후 다시 시도하세요.` };
    }
    const fp = (f as any).path || (f as any).rfilename || f;
    const p = await downloadGGUF(j.outRepo, fp, modelsDir(), (pr) => { try { win?.webContents.send('hf:progress', { repo: j.outRepo, file: fp, ...pr }); } catch { /* */ } });
    return { ok: true, path: p, model: j.outRepo };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
});

// ── 🔪 AI 수술 (합치기) — 장기기억과 같은 HF Jobs GPU에서 실행 (코랩 불필요) ───────
ipcMain.handle('surgery:merge', async (_e, modelA: string, modelB: string, method = 'slerp', t = '0.5', outName = '', password = '') => {
  const gate = gpuGate(password, 'surgery');   // 🔒 비번 0101 + 월 3회 (학습과 공유)
  if (!gate.ok) return { ok: false, gated: true, error: gate.error };
  if (!modelA || !modelB) return { ok: false, error: '합칠 두 모델을 모두 골라주세요 (같은 베이스·같은 크기여야 합쳐져요).' };
  const c = loadConfig();
  // ── 우리 서버(무료 백엔드) 우선 — 제공자(사장님) HF Pro 토큰으로 HF Job 실행. 회원 본인 토큰 안 씀(학습과 동일) ──
  const backend = trainBackendBase(c);
  const hasHf = !!connOf('huggingface').HF_TOKEN;
  if (backend) {
    const user = await fbIdToken();
    if (fbApiKey() && !user) return { ok: false, needLogin: true, error: '회원으로 로그인하시면 우리 서버에서 무료로 합성됩니다. 또는 🆓 무료로 직접 하기(Colab)를 이용하세요.' };
    if (!fbApiKey() || user) {
      try {
        const r = await axios.post(`${backend}/merge`, { userId: user?.uid || installId(), idToken: user?.idToken, accessCode: password, modelA, modelB, method, t: String(t), outName, userHfToken: connOf('huggingface').HF_TOKEN || '' }, { timeout: 60000 });   // 🎁 회원 HF 연동 시 결과를 회원 계정에(소유)
        const d = r.data || {};
        if (d.ok) { gpuUse('surgery', password); bumpStat('fusion'); recordCreatedModel('fusion', d.outputRepo || '', outName, `${modelA}+${modelB}`); saveConfig({ cloudJob: { backend: true, kind: 'merge', id: d.jobId, namespace: d.namespace, outRepo: d.outputRepo || '', ts: Date.now() } }); return { ...d, viaBackend: true, modelRepo: d.modelRepo || `https://huggingface.co/${d.outputRepo}` }; }
        if (!hasHf) return { ...d, viaBackend: true };   // 백엔드 거절(코드·로그인·캡) + 본인 HF 없음 → 그대로 안내
      } catch (e: any) {
        const st = e?.response?.status;
        if (!hasHf) return { ok: false, error: `합성 서버가 잠시 불안정해요(${st || '네트워크'}). 잠시 후 다시 시도하거나 🆓 무료로 직접 하기(Colab)를 쓰세요.` };
        // 본인 HF 토큰 있으면 아래 직접 모드로 폴백(파워유저)
      }
    }
  }
  // ── 직접 모드(백엔드 미설정/불안정 + 파워유저) — 본인 HF Pro 토큰 ──
  const h = connOf('huggingface');
  if (!h.HF_TOKEN) return { ok: false, error: '💎 무료 서버 합성은 회원 로그인이 필요해요. 또는 🆓 무료로 직접 하기(Colab)로 결제 없이 합성하세요.' };
  const me = await hfUsername(h.HF_TOKEN);
  if (!me) return { ok: false, error: 'HF 토큰 확인 실패 — write 권한 토큰인지 확인하세요.' };
  const script = scriptText('merge_uv.py');
  if (!script) return { ok: false, error: '합치기 스크립트를 찾을 수 없어요 (training/merge_uv.py).' };
  const surgRepo = `${me}/connect-ai-surgery`;
  const up = await uploadDataset(h.HF_TOKEN, surgRepo, script, 'merge_uv.py');   // 스크립트를 데이터셋 repo에 올려 Job이 마운트
  if (!up.ok) return { ok: false, error: '스크립트 업로드 실패: ' + up.error };
  const safe = (outName || `merged-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'merged';
  const outRepo = `${me}/${safe}`;
  const job = await launchJob(h.HF_TOKEN, me, {
    datasetRepo: surgRepo, scriptFile: 'merge_uv.py', flavor: 'l4x1', timeout: '1h',
    env: { MODEL_A: modelA, MODEL_B: modelB, METHOD: method, MERGE_T: String(t), OUTPUT_REPO: outRepo },   // ⚠️ 키 'T'는 HF Jobs가 거부 → MERGE_T
  });
  if (job.ok && job.jobId) { gpuUse('surgery', password); bumpStat('fusion'); recordCreatedModel('fusion', outRepo, outName, `${modelA}+${modelB}`); saveConfig({ cloudJob: { kind: 'merge', id: job.jobId, namespace: me, outRepo, ts: Date.now() } }); }   // 기존 상태/설치 UI 재사용
  return { ...job, outRepo, modelRepo: `https://huggingface.co/${outRepo}` };
});
// 🆓 무료 합성 — 비멤버용. 같은 합성을 Colab 무료 GPU에서 직접(노트북 생성→깃→Colab 원클릭). 비번·GPU 게이트 없음.
ipcMain.handle('surgery:notebook', async (_e, modelA = '', modelB = '', method = 'task_add', scale = 1.0, outName = '') => {
  if (!modelA || !modelB) return { ok: false, error: '합칠 두 모델을 모두 골라주세요.' };
  const g = connOf('github'), h = connOf('huggingface');
  const me = h.HF_TOKEN ? await hfUsername(h.HF_TOKEN) : '';
  const owner = me || 'my-hf-id';
  const safe = (outName || `fusion-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'my-fusion';
  const outRepo = safe.includes('/') ? safe : `${owner}/${safe}`;
  const nb = buildSurgeryNotebook(method, modelA, modelB, Number(scale) || 1.0, outRepo);
  const fileName = `connect-ai/surgery-${method}.ipynb`;
  if (g.GITHUB_TOKEN && (g.GITHUB_DEFAULT_REPO || '').includes('/')) {
    const r = await pushFile(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO, fileName, nb, `🧬 Connect AI 합성 노트북 (${method})`);
    if (r.ok && r.url) return { ok: true, colab: r.url.replace('https://github.com/', 'https://colab.research.google.com/github/'), github: r.url, outRepo };
  }
  const out = path.join(os.homedir(), 'Desktop', `connect-ai-surgery-${method}.ipynb`);
  try { fs.writeFileSync(out, nb, 'utf8'); shell.showItemInFolder(out); return { ok: true, local: out, colab: 'https://colab.research.google.com/#create=true', outRepo, note: 'GitHub 미연결 — 바탕화면 노트북을 Colab에 업로드하세요.' }; }
  catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
});
// 🚫 진행 중(또는 멈춘) 클라우드 작업 취소 — 학습·합성 공용(cloudJob 하나 공유)
ipcMain.handle('cloud:cancel', async () => {
  const c: any = loadConfig(); const j = c.cloudJob; const h = connOf('huggingface');
  let cancelled = false;
  if (j?.id && j?.namespace && h.HF_TOKEN) { try { cancelled = await cancelJob(h.HF_TOKEN, j.namespace, j.id); } catch { /* */ } }
  saveConfig({ cloudJob: null } as any);
  return { ok: true, cancelled };
});
ipcMain.handle('memstatus', async () => {
  const g = connOf('github'), h = connOf('huggingface');
  let hfRepo = h.HF_REPO || '', hfUrl = '';
  if (hfRepo && !hfRepo.includes('/') && h.HF_TOKEN) { const me = await hfUsername(h.HF_TOKEN); if (me) hfRepo = `${me}/${hfRepo}`; }   // 이름만 → 풀네임
  if (hfRepo.includes('/')) hfUrl = `https://huggingface.co/datasets/${hfRepo}`;
  return { githubRepo: g.GITHUB_DEFAULT_REPO || '', githubReady: !!(g.GITHUB_TOKEN && g.GITHUB_DEFAULT_REPO), hfRepo, hfUrl, hfReady: !!(h.HF_TOKEN && h.HF_REPO), notes: noteCount() };
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
// 🎓 학습 방법론 목록 (배움용)
ipcMain.handle('methods:list', () => METHODS);
// ☁️ HF AutoTrain — 클라우드 GPU 유료 학습. 업로드된 데이터셋·추천설정으로 AutoTrain UI에 넘김.
//   (실제 GPU 실행·과금은 사용자 HF 계정에서. 사용자 과금[Stripe]은 별도 결제 백엔드 필요 — 로컬앱에 키 두지 않음.)
ipcMain.handle('train:autotrain', async (_e, modelName?: string, opts?: any) => {
  const c: any = loadConfig();
  const h = connOf('huggingface');
  if (!h.HF_TOKEN) return { ok: false, error: 'HuggingFace 연결이 필요해요 (🗂️ 연동 → HF 토큰).' };
  let dataset = h.HF_REPO || '';
  if (dataset && !dataset.includes('/') && h.HF_TOKEN) { const me = await hfUsername(h.HF_TOKEN); if (me) dataset = `${me}/${dataset}`; }
  if (!dataset.includes('/')) return { ok: false, error: '먼저 ② 데이터셋을 HuggingFace에 업로드하세요.' };
  if (!noteCount()) return { ok: false, error: '학습할 지식이 없어요. 먼저 단기 기억에 쌓고 변환·업로드하세요.' };
  const owner = dataset.split('/')[0] || 'my-hf-id';
  const name = (modelName || '').trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g,'') || nextModelName(c.brainModelName);   // HF repo 영어만 (한글 제거)
  const base = guessBase(c.llmModel);
  const params = { rank: opts?.rank || 16, alpha: opts?.alpha || ((opts?.rank || 16) * 2), lr: opts?.learningRate || 3e-4, epochs: opts?.epochs || 3, maxSeq: opts?.maxSeq || 1024 };
  saveConfig({ brainModelName: name } as any);
  return { ok: true, url: 'https://huggingface.co/autotrain', dataset, base, outRepo: `${owner}/${name}`, params };
});
ipcMain.handle('train:notebook', async (_e, modelName?: string, opts?: any) => {
  const c: any = loadConfig();
  const g = connOf('github'), h = connOf('huggingface');
  let dataset = h.HF_REPO || '';
  if (dataset && !dataset.includes('/') && h.HF_TOKEN) { const me = await hfUsername(h.HF_TOKEN); if (me) dataset = `${me}/${dataset}`; }   // 이름만 입력 → 아이디 자동 보충
  const method = (opts?.method || 'sft') as string;
  // 🗂️ 정석 파이프라인: 지식 → 변환 → HF 데이터셋 업로드 → 코랩이 load_dataset 으로 가져와 학습.
  //    (HF 미연결이면 노트북에 데이터 인라인으로 심어 폴백 — 끊기지 않게)
  let inlineJsonl = '';
  let uploadedDs = '';
  if (method === 'sft') {
    if (!noteCount()) return { ok: false, error: '학습할 지식이 없어요. 먼저 ⚡ 단기 기억에 지식을 쌓으세요.' };
    const jsonl = lastBrainJsonl || brainToConversationsJsonl();   // ① 변환 했으면 그걸, 안 했으면 지식 그대로
    if (!jsonl) return { ok: false, error: '학습할 내용이 너무 짧아요 — 문장 단위로 좀 더 쌓아주세요.' };
    if (h.HF_TOKEN) {
      const me = await hfUsername(h.HF_TOKEN);
      if (me) {
        if (!dataset) dataset = `${me}/connect-ai-data`;
        else if (!dataset.includes('/')) dataset = `${me}/${dataset}`;
        const up = await uploadDataset(h.HF_TOKEN, dataset, jsonl, 'connect-ai-brain.jsonl');
        if (up.ok) uploadedDs = dataset;        // ✅ 업로드 성공 → inlineJsonl 비움 → 노트북이 load_dataset 사용
        else inlineJsonl = jsonl;               // 업로드 실패 → 인라인 폴백
      } else inlineJsonl = jsonl;               // 토큰 이상 → 인라인 폴백
    } else inlineJsonl = jsonl;                 // HF 미연결 → 인라인 폴백
  } else if (method === 'dpo') {
    // DPO 선호쌍은 LLM으로 생성해야 해서 즉석 불가 — 미리 만든 게 있으면 HF에 올려 코랩이 load_dataset 으로 받음.
    if (!lastDpoJsonl) return { ok: false, error: 'DPO는 먼저 ④ 데이터 → "변환(AI 피드백 생성)"으로 선호쌍을 만든 뒤 학습하세요.' };
    if (!h.HF_TOKEN) return { ok: false, error: 'DPO 무료 학습은 🗂️ 연동에서 HuggingFace write 토큰이 필요해요 (선호쌍 데이터셋을 올려 코랩이 받아갑니다).' };
    const me = await hfUsername(h.HF_TOKEN);
    if (!me) return { ok: false, error: 'HF 토큰 확인 실패 — write 권한 토큰인지 확인하세요.' };
    if (!dataset) dataset = `${me}/connect-ai-data`;
    else if (!dataset.includes('/')) dataset = `${me}/${dataset}`;
    const up = await uploadDataset(h.HF_TOKEN, dataset, lastDpoJsonl, 'connect-ai-dpo.jsonl');
    if (!up.ok) return { ok: false, error: 'DPO 선호쌍 업로드 실패: ' + up.error };
    uploadedDs = dataset;   // nbDPO 가 load_dataset(dataset, "connect-ai-dpo.jsonl") 으로 사용
  }
  const owner = dataset.includes('/') ? dataset.split('/')[0] : '';
  const name = (modelName || '').trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g,'') || nextModelName(c.brainModelName);   // HF repo 영어만 (한글 제거)
  const trainOpts = { rank: opts?.rank, alpha: opts?.alpha, dropout: opts?.dropout, learningRate: opts?.learningRate, maxSteps: opts?.maxSteps, epochs: opts?.epochs, warmup: opts?.warmup, maxSeq: opts?.maxSeq, scheduler: opts?.scheduler, quant: opts?.quant };
  saveConfig({ brainModelName: name, trainOpts, trainMethod: method } as any);
  const outRepo = name.includes('/') ? name : (owner ? `${owner}/${name}` : name);   // owner 없으면 Colab 로그인 계정으로 push_to_hub
  const base = guessBase(c.llmModel);                          // 내가 로드한 모델 위에 누적 학습
  const nb = buildMethodNotebook(method, dataset, base, outRepo, lastBrainPairs || noteCount(), trainOpts, inlineJsonl);
  const fileName = `connect-ai/train-${method}.ipynb`;
  // GitHub 연결돼 있으면 커밋 → Colab 원클릭
  if (g.GITHUB_TOKEN && (g.GITHUB_DEFAULT_REPO || '').includes('/')) {
    const r = await pushFile(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO, fileName, nb, `🚀 Connect AI 학습 노트북 (${method.toUpperCase()})`);
    // r.url 은 이미 정규화된 github blob 주소 → 그걸 그대로 colab 주소로 변환(전체 URL·.git 입력해도 안전)
    if (r.ok && r.url) { return { ok: true, colab: r.url.replace('https://github.com/', 'https://colab.research.google.com/github/'), github: r.url, dataset: uploadedDs || undefined }; }
  }
  // 폴백: 바탕화면 저장 + Colab 업로드 페이지
  const out = path.join(os.homedir(), 'Desktop', `connect-ai-train-${method}.ipynb`);
  try { fs.writeFileSync(out, nb, 'utf8'); shell.showItemInFolder(out); return { ok: true, local: out, colab: 'https://colab.research.google.com/#create=true', note: 'GitHub 미연결 — 바탕화면 노트북을 Colab에 업로드하세요.', dataset: uploadedDs || undefined }; }
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
      await tgPost(token, chat, action.payload);
      return '📨 텔레그램 전송 완료';
    }
    if (action.kind === 'email') {
      const e = (c.apiConn || {}).email || {};
      const [to, subject, ...rest] = action.payload.split('|').map(s => s.trim());
      const r = await sendEmail({ host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.SMTP_FROM }, to, subject || '', rest.join('|'));
      return r.ok ? `📧 이메일 전송 완료 → ${to}` : `⚠️ ${r.error}`;
    }
    if (action.kind === 'github') {
      // 📤 콘텐츠 실제 발행/코드 수정 — 깃허브 레포에 푸시 (GitHub Pages면 곧바로 라이브)
      const g = (c.apiConn || {}).github || {};
      const repo = (action.repo || g.GITHUB_DEFAULT_REPO || '').trim();   // 서비스별 레포 지정 시 그리로, 아니면 기본 레포
      if (!g.GITHUB_TOKEN || !repo) return '⚠️ 깃허브 미연결 (🗂️ 연동 → GitHub 토큰·레포 먼저, 또는 서비스에 레포 등록)';
      const filePath = action.path || `posts/post_${Date.now()}.md`;
      const r = await pushFile(g.GITHUB_TOKEN, repo, filePath, action.payload || '', `수정: ${filePath}`);
      return r.ok ? `📤 적용 완료 → ${repo}/${filePath}${r.url ? `\n${r.url}` : ''}` : `⚠️ 적용 실패: ${r.error}`;
    }
    if (action.kind === 'ytmeta') {
      // 📺 유튜브 영상 제목·설명 실제 수정 (OAuth 필요 — 🗂️ 연동 → YouTube 로그인)
      const o = (c.apiConn || {})['youtube-oauth'] || {};
      if (!o.YOUTUBE_OAUTH_CLIENT_ID || !o.YOUTUBE_OAUTH_REFRESH) return '⚠️ 유튜브 OAuth 미연결 (🗂️ 연동 → YouTube 로그인 연동 먼저)';
      const at = await ytAccessToken(o.YOUTUBE_OAUTH_CLIENT_ID, o.YOUTUBE_OAUTH_CLIENT_SECRET, o.YOUTUBE_OAUTH_REFRESH);
      if (!at) return '⚠️ 유튜브 토큰 갱신 실패 — 연동을 다시 해주세요';
      const [videoId, title, ...rest] = action.payload.split('|').map(s => s.trim());
      const desc = rest.join('|');
      const cur = await axios.get('https://www.googleapis.com/youtube/v3/videos', { params: { part: 'snippet', id: videoId }, headers: { Authorization: `Bearer ${at}` }, timeout: 15000 });
      const sn = cur.data?.items?.[0]?.snippet;
      if (!sn) return `⚠️ 영상(${videoId})을 찾을 수 없어요`;
      const snippet = { ...sn, title: title || sn.title, description: desc || sn.description, categoryId: sn.categoryId || '22' };
      await axios.put('https://www.googleapis.com/youtube/v3/videos?part=snippet', { id: videoId, snippet }, { headers: { Authorization: `Bearer ${at}` }, timeout: 20000 });
      return `📺 유튜브 메타 수정 완료 → ${videoId} "${snippet.title.slice(0, 40)}"`;
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
// 🧪 결재 플로우 체험 — 테스트 결재를 만들고 즉시 폰(텔레그램)으로 푸시. 폰에서 "보내기" 답장 → 실제 실행까지 한 바퀴.
ipcMain.handle('approvals:test', async () => {
  const c = loadConfig();
  if (!c.telegramToken || !c.telegramChatId) return { ok: false, reason: '먼저 🗂️ 연동 → Telegram에 봇 토큰·챗 ID를 연결하세요' };
  addApproval('🧪 결재 플로우 테스트', '폰에서 승인하면 이 메시지가 실제로 발송됩니다', '🧪',
    { kind: 'telegram', payload: `🎉 결재 테스트 성공! ${c.userTitle || '사장님'}이 폰에서 승인하신 메시지가 실제로 실행됐어요. 이제 이메일 답장·발송·배포도 이 흐름으로 결재됩니다.` } as any);
  try { await tgPushApprovals(); } catch { /* */ }
  return { ok: true };
});

// 📲 텔레그램 결재 브리지 — 실행 가능한 승인을 폰으로 보내고, 답장(보내기/수정/취소)으로 진짜 실행한다.
// 자리에 없어도 폰에서 "보내기"면 실제 발송, "수정 …"이면 AI가 고쳐서 다시 물어봄.
let tgOffset = 0, tgPrimed = false;
const tgPushed = new Set<string>();
let tgAwaitId = '';
const tgSend = (text: string) => { const c = loadConfig(); if (!c.telegramToken || !c.telegramChatId) return Promise.resolve(undefined); return tgPost(c.telegramToken, c.telegramChatId, text).then(() => undefined).catch(() => undefined); };
const tgHead = (k: string) => k === 'email' ? '📧 이메일 초안 — 보낼까요?' : k === 'telegram' ? '✈️ 메시지 초안 — 보낼까요?' : k === 'run' ? '⚡ 명령 — 실행할까요?' : k === 'github' ? '📤 콘텐츠 발행 — 게시할까요?' : k === 'ytmeta' ? '📺 유튜브 수정 — 적용할까요?' : '📝 작업 — 할까요?';
const tgRefresh = (res: string, ok: boolean) => { try { win?.webContents.send('engine:event', { kind: 'tool', name: 'approve-done', path: res.slice(0, 60), ok }); } catch { /* */ } };
async function tgPushApprovals() {
  const c = loadConfig(); if (!c.telegramToken || !c.telegramChatId || c.telegramApprovals === false) return;
  for (const a of pendingApprovals()) {
    if (tgPushed.has(a.id) || !a.action) continue;   // 실행 가능한 것만 폰으로
    tgPushed.add(a.id); tgAwaitId = a.id;
    const body = String(a.action.payload || a.summary || a.title).slice(0, 2500);
    await tgSend(`${tgHead(a.action.kind)}\n■ ${a.title}\n\n${body}\n\n답장: "보내기" / "수정 <어떻게>" / "취소"`);
  }
}
async function tgRegenerate(a: any, how: string): Promise<string> {
  const c = loadConfig();
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() }).catch(() => null);
  const cur = String(a.action?.payload || '');
  if (!target) return cur;
  const user = `아래 초안을 이 지시대로 고쳐줘: "${how}"\n- 초안이 "받는사람 | 제목 | 본문" 형식이면 그 형식(| 구분)을 반드시 유지해.\n- 고친 결과만 출력(설명·따옴표 없이).\n\n[현재 초안]\n${cur}`;
  try { return (await chat(target, agentPrompt(c.agentName, c.company, c.userTitle || '사장님'), user, { temperature: 0.5 })).trim() || cur; } catch { return cur; }
}
// 📱 폰으로 회사 돌리기 — 텔레그램에서 "운영" 한 마디면: 분석 → 작전 제안 → 번호로 선택 → 실행 → 결과 보고
let tgOpsAwait = false;
async function tgRunOps() {
  if (opsState.busy || opsState.executing) { await tgSend('지금 이미 작전을 짜거나 수행 중이에요 — 끝나면 보고드릴게요.'); return; }
  await tgSend('🔍 분석 시작 — 매출·유튜브·코드·할 일을 읽고 작전을 짭니다 (약 30초~1분)…');
  opsState.running = true; if (!opsState.startedAt) opsState.startedAt = Date.now();
  opsState.cycle = (opsState.cycle || 0) + 1;
  const s = await runOperation();
  if (!s.actions?.length) { await tgSend('⚠️ 작전을 못 짰어요 — 앱에서 🤖 AI 모델이 켜져 있는지 확인해주세요.'); return; }
  tgOpsAwait = true;
  await tgSend(`🎯 오늘의 작전 — 사이클 #${s.cycle}\n${s.summary ? `“${s.summary}”\n\n` : ''}` +
    s.actions.map((a, i) => `${i + 1}. ${a.assignee === 'human' ? '🙋' : '🤖'} ${a.title}`).join('\n') +
    `\n\n답장 → 번호 "1,3" / "전부" / "취소"\n(🙋 = 사장님 몫 — 선택하면 할 일로 등록만)`);
}
async function tgRunSelected(chosen: OpsAction[]) {
  const titles = chosen.map(a => a.title);
  const humans = chosen.filter(a => a.assignee === 'human').map(a => a.title);
  await tgSend(`▶ ${titles.length}개 작전 실행 — 에이전트들이 일하는 동안 기다리세요. 끝나면 보고드립니다.`);
  const s = await doExecuteSelected(titles, humans);
  const ships = (s.shipped || []).filter(x => titles.includes(x.title)).slice(0, titles.length);
  const okN = ships.filter(x => x.ok).length;
  await tgSend(`🏁 사이클 #${s.cycle} 완료 — ${okN}/${titles.length} 완수\n` +
    ships.map(x => `${x.ok ? '✅' : '⚠️'} ${x.title.slice(0, 48)}${(x.artifacts || []).length ? `\n   └ ${(x.artifacts || []).join(' · ')}` : ''}`).join('\n') +
    `\n\n📂 산출물은 작업폴더의 "오늘업무_…" 안에 있어요.\n다음 사이클 → "운영" 이라고 답장`);
}
async function tgHandleReply(text: string) {
  const t = (text || '').trim(); if (!t) return;
  // 📱 원격 운영 명령 — "운영"/"작전"/"/ops"
  if (/^\/?(운영|작전|오늘|ops|operate)$/i.test(t)) { tgRunOps().catch(() => undefined); return; }
  if (tgOpsAwait) {
    if (/^(취소|그만|cancel|no)/i.test(t)) { tgOpsAwait = false; await tgSend('🚫 작전 선택을 취소했어요.'); return; }
    const all = /^(전부|전체|다|all)/i.test(t);
    const nums = (t.match(/\d+/g) || []).map(Number);
    if (all || nums.length) {
      tgOpsAwait = false;
      const chosen = all ? opsState.actions : nums.map(n => opsState.actions[n - 1]).filter(Boolean);
      if (!chosen.length) { tgOpsAwait = true; await tgSend('번호를 못 읽었어요 — 예: "1,3" 또는 "전부"'); return; }
      tgRunSelected(chosen).catch(() => undefined);
      return;
    }
    await tgSend('작전 선택 대기 중이에요 — 번호("1,3") / "전부" / "취소" 로 답해주세요.');
    return;
  }
  const a = getApproval(tgAwaitId);
  if (!a || a.status !== 'pending' || !a.action) { if (/^(보내|수정|취소)/.test(t)) await tgSend('지금 결재 대기 중인 게 없어요.'); return; }
  if (/^(취소|cancel|no|하지\s*마|싫)/i.test(t)) { setApprovalStatus(a.id, 'rejected'); tgAwaitId = ''; await tgSend('🚫 취소했어요.'); tgRefresh('취소', false); return; }
  if (/^(수정|고쳐|바꿔|edit)/i.test(t)) {
    const how = t.replace(/^(수정|고쳐|바꿔|edit)[\s:：]*/i, '').trim() || '더 자연스럽고 정중하게';
    await tgSend('✏️ 고치는 중…');
    const nb = await tgRegenerate(a, how);
    updateApprovalAction(a.id, { ...a.action, payload: nb });
    await tgSend(`✏️ 이렇게 고쳤어요:\n\n${nb.slice(0, 2500)}\n\n답장: "보내기" / "수정 <어떻게>" / "취소"`);
    return;
  }
  if (/^(보내|보낼|ㅇㅇ|응|네|예|yes|ok|승인|go|해줘|해)/i.test(t)) {
    await tgSend('📤 실행할게요…');
    const res = await executeAction(a.action);
    setApprovalStatus(a.id, 'approved', res); tgAwaitId = '';
    const ok = !res.startsWith('⚠️');
    await tgSend(ok ? `✅ ${res}` : `실패: ${res}`); tgRefresh(res, ok);
    return;
  }
  await tgSend('못 알아들었어요 🙂 "보내기" / "수정 <어떻게>" / "취소" 중에 답해주세요.');
}
function tgTick() {
  const c = loadConfig(); if (!c.telegramToken || !c.telegramChatId) return;
  tgPushApprovals();
  axios.get(`https://api.telegram.org/bot${c.telegramToken}/getUpdates`, { params: { offset: tgOffset || undefined, timeout: 0 }, timeout: 10000 })
    .then(async (r) => {
      const list = r.data?.result || [];
      for (const u of list) {
        tgOffset = u.update_id + 1;
        if (!tgPrimed) continue;   // 시작 시 쌓여있던 옛 메시지는 무시(오프셋만 전진)
        const msg = u.message?.text; const chat = String(u.message?.chat?.id || '');
        if (msg && chat === String(c.telegramChatId)) await tgHandleReply(msg);
      }
      tgPrimed = true;
    }).catch(() => { /* 네트워크/충돌 무시 — 다음 틱에 재시도 */ });
}

// 📥 이메일 자동 답장 — 받은 메일 감지 → 두뇌 RAG로 답장 초안 → 승인 큐(→ 텔레그램으로 "보낼까요?")
let mailBusy = false; const mailSeen = new Set<string>();
async function ragContext(query: string, base: string): Promise<string> {
  try {
    const notes = allNotes(); if (!notes.length) return '';
    const q = base ? await embed(base, query).catch(() => null) : null;
    let top = notes.slice(-5);
    if (q) { const scored = notes.filter(n => n.emb && n.emb.length).map(n => ({ n, s: cosine(q, n.emb as number[]) })).sort((a, b) => b.s - a.s); if (scored.length) top = scored.slice(0, 5).map(x => x.n); }
    return top.map(n => `- ${n.text}`).join('\n').slice(0, 1500);
  } catch { return ''; }
}
async function mailTick() {
  const c = loadConfig();
  if (!c.emailAutoReply) return;
  if (!c.telegramToken || !c.telegramChatId) return;   // 결재를 폰으로 받을 채널이 있어야 함
  const e = (c.apiConn || {}).email || {};
  if (!e.SMTP_USER || !e.SMTP_PASS) return;
  if (mailBusy) return; mailBusy = true;
  try {
    const host = e.IMAP_HOST || (e.SMTP_HOST || '').replace(/^smtp\./, 'imap.') || 'imap.gmail.com';
    const r = await fetchUnseen({ host, port: e.IMAP_PORT || '993', user: e.SMTP_USER, pass: e.SMTP_PASS }, 5);
    if (!r.ok || !r.mails?.length) return;
    const target = await detectTarget({ base: c.llmBase, model: c.llmModel, key: geminiKey() }).catch(() => null);
    if (!target) return;
    for (const m of r.mails) {
      if (!m.from || mailSeen.has(m.messageId)) continue;
      mailSeen.add(m.messageId);
      const rag = await ragContext(`${m.subject}\n${m.text}`, target.base);
      const sys = agentPrompt(c.agentName, c.company, c.userTitle || '사장님');
      const user = `받은 이메일에 대한 답장 본문을 한국어로 정중하고 자연스럽게 써줘(인사 → 핵심 → 맺음, 5문장 이내). 마크다운·머리말 없이 본문만 출력.\n\n[보낸사람] ${m.fromName} <${m.from}>\n[제목] ${m.subject}\n[받은 내용]\n${m.text}${rag ? `\n\n[참고할 내 지식·과거 답변]\n${rag}` : ''}`;
      let body = '';
      try { body = (await chat(target, sys, user, { temperature: 0.5 })).trim(); } catch { continue; }
      if (!body) continue;
      const subj = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
      addApproval(`📧 ${(m.fromName || m.from).slice(0, 30)}에게 답장`, `받은 메일: ${m.subject}`, '📧', { kind: 'email', payload: `${m.from}|${subj}|${body}` });
      notify('📧 새 메일 답장 초안', `${m.fromName || m.from} — 텔레그램에서 확인 후 보내세요`);
      // → tgPushApprovals 가 폰으로 "보낼까요?" 자동 푸시 → 보내기/수정/취소
    }
  } catch { /* 다음 틱 재시도 */ } finally { mailBusy = false; }
}

// 🛰️ 상시 자산 감시 — 1시간마다 구독자·매출·커밋·메일 변화를 감지해 폰(텔레그램)으로 보고.
// 회사가 "살아서 지켜보고 있다"는 감각 — 앱을 안 봐도 변화가 먼저 찾아온다.
interface MonSnap { ytSubs?: number; ytViews?: number; payCount?: number; payNet?: number; ghSha?: string; mails?: number; t?: number; }
const monFile = () => path.join(app.getPath('userData'), 'monitor.json');
let monBusy = false;
async function monitorTick() {
  const c = loadConfig();
  if (c.monitorOn === false) return;
  if (!c.telegramToken || !c.telegramChatId) return;   // 보고 채널이 있어야 의미
  if (monBusy) return; monBusy = true;
  try {
    let prev: MonSnap = {}; try { prev = JSON.parse(fs.readFileSync(monFile(), 'utf8')); } catch { /* 첫 실행 */ }
    const next: MonSnap = { t: Date.now() };
    const alerts: string[] = [];
    const fmt = (n: number) => Math.round(n).toLocaleString();
    // 📺 유튜브 — 구독·조회 변화
    const y = connOf('youtube');
    if (y.YOUTUBE_API_KEY && y.YOUTUBE_CHANNEL_ID) {
      const yt: any = await fetchChannel(y.YOUTUBE_API_KEY, y.YOUTUBE_CHANNEL_ID).catch(() => null);
      if (yt?.ok && yt.channel) {
        next.ytSubs = yt.channel.subs; next.ytViews = yt.channel.views;
        if (prev.ytSubs != null && next.ytSubs !== prev.ytSubs) { const d = next.ytSubs! - prev.ytSubs; alerts.push(`📺 구독자 ${d > 0 ? '+' : ''}${fmt(d)} → ${fmt(next.ytSubs!)}명`); }
        if (prev.ytViews != null && (next.ytViews! - prev.ytViews) >= 1000) alerts.push(`👁 조회수 +${fmt(next.ytViews! - prev.ytViews)} → ${fmt(next.ytViews!)}`);
      }
    }
    // 💰 페이팔 — 새 결제
    if (c.paypalClientId && c.paypalSecret) {
      const r: any = await fetchRevenue(c.paypalClientId, c.paypalSecret, { days: 7 }).catch(() => null);
      const t = r?.data?.totals; const cur = t?.primary_currency || Object.keys(t?.by_currency || {})[0];
      const cc2 = cur ? t.by_currency[cur] : null;
      if (cc2) {
        next.payCount = cc2.count; next.payNet = (cc2.gross || 0) + (cc2.refunds || 0) + (cc2.fees || 0);
        if (prev.payCount != null && next.payCount! > prev.payCount) alerts.push(`💰 새 결제 ${next.payCount! - prev.payCount}건! 7일 순매출 ${fmt(next.payNet!)} ${cur}`);
      }
    }
    // 💻 깃허브 — 새 커밋
    const g = connOf('github');
    if (g.GITHUB_TOKEN && g.GITHUB_DEFAULT_REPO) {
      const gh: any = await listCommits(g.GITHUB_TOKEN, g.GITHUB_DEFAULT_REPO, 1).catch(() => null);
      const top = gh?.commits?.[0];
      if (top) { next.ghSha = top.sha; if (prev.ghSha && prev.ghSha !== top.sha) alerts.push(`💻 새 커밋: ${top.msg.split('\n')[0].slice(0, 60)}`); }
    }
    // 📧 메일 — 안 읽은 메일 증가 (이메일 자동답장 꺼져 있을 때만 — 켜져 있으면 그쪽이 처리)
    if (!c.emailAutoReply) {
      const e = (c.apiConn || {}).email || {};
      if (e.SMTP_USER && e.SMTP_PASS) {
        const host = e.IMAP_HOST || (e.SMTP_HOST || '').replace(/^smtp\./, 'imap.') || 'imap.gmail.com';
        const m: any = await fetchUnseen({ host, port: e.IMAP_PORT || '993', user: e.SMTP_USER, pass: e.SMTP_PASS }, 5).catch(() => null);
        if (m?.ok) { next.mails = (m.mails || []).length; if (prev.mails != null && next.mails! > prev.mails) alerts.push(`📧 새 메일 ${next.mails! - prev.mails}통 — "${(m.mails[0]?.subject || '').slice(0, 40)}"`); }
      }
    }
    try { fs.writeFileSync(monFile(), JSON.stringify(next)); } catch { /* */ }
    if (alerts.length && prev.t) {   // 첫 스냅샷은 조용히(기준점만)
      await tgSend(`🛰️ ${c.company || '회사'} 자산 변화 감지\n${alerts.join('\n')}\n\n"운영" 이라고 답하면 바로 대응 작전을 짭니다.`);
      for (const al of alerts) { opsState.feed.unshift({ icon: '🛰️', text: al.slice(0, 64), agent: 'secretary', ok: true, ts: Date.now() }); }
      opsState.feed = opsState.feed.slice(0, 40); opsEmitLight();
      notify('🛰️ 자산 변화 감지', alerts[0]);
    }
  } finally { monBusy = false; }
}

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
// 🧠 shared thought — 광장에서 들은 다른 AI 발언 중 '배울 점'만 골라 두뇌에 각인.
//   사람이 토론하며 배우듯, 내 AI도 광장에서 사회적으로 학습한다.
async function harvestPlazaKnowledge(target: any, speaker: string) {
  const buf = plazaHarvestBuf.splice(0, plazaHarvestBuf.length);   // 비우고 처리
  if (buf.length < 2) return;   // 너무 적으면 다음 주기로
  const convo = buf.slice(-12).map(m => `${m.company}: ${m.text}`).join('\n');
  try {
    const sys = `너는 광장에서 다른 회사 AI들의 토론을 듣고 '배울 만한 인사이트'만 골라내는 큐레이터다. 잡담·인사·동어반복은 버린다. 진짜 배울 점이 있을 때만 추출한다.`;
    const u = `다음은 광장에서 들은 다른 AI들의 대화다. 여기서 '${speaker}'(나)가 배워서 기억할 가치가 있는 핵심 인사이트를 0~2개만 뽑아라.\n\n[대화]\n${convo}\n\n규칙: 진짜 배울 게 없으면 빈 줄. 있으면 한 줄에 하나씩, "주제: 핵심" 형식으로 25자 내외. 군더더기·서론 금지.`;
    const r = await chat(target, sys, u, { temperature: 0.4 });
    const lines = (r || '').split('\n').map(s => s.trim().replace(/^[-•*\d.]+\s*/, '')).filter(s => s.length > 6 && s.length < 120);
    for (const line of lines.slice(0, 2)) {
      brainAddNote(`💡 광장에서 배움 — ${line}`, undefined, { source: 'plaza' });
      plazaLearnedToday++;
    }
    if (lines.length) { win?.webContents.send('plaza:learned', { count: lines.length, items: lines.slice(0, 2), total: plazaLearnedToday }); }
  } catch { /* 다음 주기에 재시도 */ }
}
ipcMain.handle('plaza:enter', async () => {
  const c = loadConfig();
  setPlazaDbUrl(plazaDb());
  if (!plazaConfigured()) return { ok: false, reason: 'DB URL 미설정' };
  if (plaza) return { ok: true, already: true };

  const uid = 'desk-' + Buffer.from(app.getPath('userData')).toString('base64').slice(0, 8).replace(/[^a-z0-9]/gi, '');
  const emoji = c.plazaEmoji || '🖥️';
  const speaker = c.agentName || '에이전트';
  const inv0 = await gatherInventory().catch(() => null);   // 🎒 보유 현황 요약을 명찰에 얹음(작은 숫자)
  const me = { uid, company: c.company, emoji, agents: ['📺', '🎨', '💻', '📊', '✍️', '🔍'], source: 'connect-ai' as const, models: inv0?.models, level: inv0?.totalLevel };
  void pushMyProfile(uid);   // 🎒 내 인벤토리 프로필을 광장에 올림(캐릭터 클릭 시 보임)
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel });
  // 비서가 아니라 '학생'으로 토론 — 자기소개·"도와드릴게요" 멘트 방지
  const studentSys = `너는 'AI Agent University'의 똑똑한 학생 에이전트 '${speaker}'(소속: ${c.company})다. 토론에서 자기 생각을 당당하고 구체적으로 말한다. 너는 비서가 아니라 '학생'이다. 사장님 같은 표현, 자기소개, "도와드리겠습니다" 류 멘트는 절대 쓰지 않는다.`;

  // joinPlaza 는 프레즌스·표시 전용 + 🧠 shared thought: 남의 발언을 버퍼에 모아 두뇌로 수확
  plaza = joinPlaza(me, (m: PlazaMessage) => {
    win?.webContents.send('plaza:peer', m);
    if (m.text && m.uid !== uid && m.role !== '선생님') plazaHarvestBuf.push(m);   // 다른 AI 발언만 모음
  });

  // 🧠 지식 수확 루프 — 사람이 토론하며 배우듯, 광장 대화에서 '배울 점'만 골라 두뇌에 각인
  if (plazaHarvestTimer) clearInterval(plazaHarvestTimer);
  if (target) plazaHarvestTimer = setInterval(() => void harvestPlazaKnowledge(target, speaker), 90000);   // 90초마다

  // 🌐 광장 인원(presence) 폴링 → 렌더러가 다른 회사 에이전트를 2D 맵에 캐릭터로 띄운다
  if (plazaPresenceTimer) clearInterval(plazaPresenceTimer);
  const pushPresence = async () => { try { const list = await fetchPresence(); win?.webContents.send('plaza:presence', list); } catch { /* */ } };
  pushPresence();
  plazaPresenceTimer = setInterval(pushPresence, 5000);

  // 자율 대화 루프 — 남이 마지막으로 말하면 그 흐름에 이어서 계속 응답
  if (target) {
    plazaAuto = startAutoChat({
      uid, target, sys: studentSys, recall: true,   // 🧠 Memory Stream — 내 에이전트는 두뇌에서 과거 기억을 떠올려 토론
      makePrompt: (convo, topic) => `[오늘의 주제] ${topic || '자유 토론'}\n\n[최근 대화]\n${convo}\n\n너는 '${speaker}'. 위 '오늘의 주제'에서 절대 벗어나지 말고 토론을 이어가라. 앞 사람 문장을 그대로 따라하지 말고 [새 관점·구체 예시·반론·질문] 중 하나를 더해 주제를 깊게 파고들어라. 자기소개·비서멘트 금지. 짧고 또렷하게 한국어 1~2문장, 대사만.`,
      post: (t) => postPlazaMessage({ uid, company: c.company, emoji, role: speaker, text: t }),
    });
    // 등교 인사 한 줄
    (async () => {
      try {
        const hello = await chat(target, studentSys, `방금 'AI 에이전트 광장'에 입장했다. 친구들에게 건넬 짧고 산뜻한 입장 인사 한 문장(30자 이내). 장황한 소개 금지. 대사만.`, { temperature: 0.85 });
        const t = cleanLine(hello);
        if (t && plaza) await postPlazaMessage({ uid, company: c.company, emoji, role: speaker, text: t });
      } catch { /* */ }
    })();
  }

  return { ok: true, uid };
});

ipcMain.handle('plaza:leave', () => { if (plazaPresenceTimer) { clearInterval(plazaPresenceTimer); plazaPresenceTimer = null; } if (plazaHarvestTimer) { clearInterval(plazaHarvestTimer); plazaHarvestTimer = null; } plazaHarvestBuf = []; stopLab(); plazaAuto?.(); plazaAuto = null; plaza?.stop(); plaza = null; demoAuto?.(); demoAuto = null; demoBot?.stop(); demoBot = null; return true; });

ipcMain.handle('plaza:send', async (_e, text: string) => {
  const c = loadConfig();
  setPlazaDbUrl(plazaDb());
  if (!plazaConfigured()) return false;
  const uid = 'desk-' + Buffer.from(app.getPath('userData')).toString('base64').slice(0, 8).replace(/[^a-z0-9]/gi, '');
  await postPlazaMessage({ uid, company: c.company, emoji: c.plazaEmoji || '🖥️', role: c.agentName || '에이전트', text });
  return true;
});

ipcMain.handle('plaza:dburl', () => plazaDb());

// 👥 친구 에이전트 (데모) — 혼자여도 대화가 보이게. 다른 정체성의 자율 에이전트.
ipcMain.handle('plaza:demobot', async (_e, on: boolean) => {
  if (!on) { demoAuto?.(); demoAuto = null; demoBot?.stop(); demoBot = null; return false; }
  const c = loadConfig();
  setPlazaDbUrl(plazaDb());
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
    (async () => { try { const h = await chat(target, persona, '방금 AI 에이전트 광장에 입장했다. 짧고 발랄한 인사 한 문장(30자 이내). 대사만.', { temperature: 0.9 }); const t = cleanLine(h); if (t && demoBot) await botPost(t); } catch { /* */ } })();
  }
  return true;
});

// ════════ 🧪 에이전트 실험실 — 다양한 성격의 AI를 N마리 풀어놓고 토론 관찰 ════════
//   집단지성·창발(emergence) 실험. 관리자가 페르소나·인원을 정해 소환.
interface LabPersona { key: string; name: string; emoji: string; company: string; trait: string; }
const LAB_PERSONAS: LabPersona[] = [
  { key: 'optimist', name: '해돌이', emoji: '🌞', company: '낙관연구소', trait: '극도의 낙관론자. 모든 것에서 기회와 희망을 본다. 긍정적 가능성을 강조한다.' },
  { key: 'skeptic', name: '의심이', emoji: '🧐', company: '회의주의자클럽', trait: '날카로운 회의론자. 모든 주장에 "정말?"이라 묻고 허점·리스크를 파고든다.' },
  { key: 'realist', name: '현실이', emoji: '⚖️', company: '현실주의컴퍼니', trait: '냉정한 현실주의자. 데이터·제약·실행가능성을 따진다. 이상론을 경계한다.' },
  { key: 'innovator', name: '번뜩이', emoji: '💡', company: '혁신랩', trait: '대담한 혁신가. 기존 틀을 깨는 파격적 아이디어를 던진다. "왜 안 돼?"가 입버릇.' },
  { key: 'analyst', name: '분석이', emoji: '📊', company: '데이터분석소', trait: '치밀한 분석가. 구조·수치·근거로 말한다. 감정보다 논리.' },
  { key: 'dreamer', name: '몽상이', emoji: '🌙', company: '상상공작소', trait: '엉뚱한 몽상가. 10년 후·SF적 상상을 펼친다. 비현실적이어도 영감을 준다.' },
  { key: 'pragmatist', name: '실속이', emoji: '🔧', company: '실용주의상회', trait: '실속파. "그래서 당장 뭘 하면 되는데?"를 묻는다. 구체적 액션 중시.' },
  { key: 'devil', name: '딴지이', emoji: '😈', company: '악마의대변인', trait: '일부러 반대편을 든다(악마의 대변인). 모두가 동의할 때 굳이 반박한다.' },
  { key: 'empath', name: '공감이', emoji: '💗', company: '공감연구원', trait: '따뜻한 공감형. 사람·감정·윤리 측면을 챙긴다. 인간적 영향을 본다.' },
  { key: 'mediator', name: '중재이', emoji: '🕊️', company: '중재의전당', trait: '균형잡힌 중재자. 대립을 정리하고 공통점을 찾아 합의를 이끈다.' },
  { key: 'scientist', name: '실험이', emoji: '🔬', company: '실험과학소', trait: '과학자. 가설·검증·반증을 말한다. "그건 어떻게 증명하지?"를 묻는다.' },
  { key: 'hustler', name: '돌격이', emoji: '🚀', company: '그로스해커스', trait: '성장 해커. 속도·실행·돈을 본다. "일단 해보고 빨리 배우자".' },
];
interface LabBot { uid: string; session: PlazaSession; stop: () => void; persona: LabPersona; }
let labBots: LabBot[] = [];
function stopLab() { for (const b of labBots) { try { b.stop(); b.session.stop(); } catch { /* */ } } labBots = []; }

ipcMain.handle('plaza:lab', async (_e, opts: { count?: number; keys?: string[] } = {}) => {
  if (!isPlazaAdmin()) return { ok: false, error: '실험실은 관리자(선생님)만 운영할 수 있어요.' };
  const c = loadConfig(); setPlazaDbUrl(plazaDb());
  if (!plazaConfigured()) return { ok: false, error: '광장 DB 미설정' };
  stopLab();   // 기존 실험 정리
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel });
  if (!target) return { ok: false, error: 'AI 모델을 먼저 켜주세요 — 실험 에이전트들이 이 모델로 사고합니다.' };
  // 선택된 페르소나 (없으면 count만큼 순서대로)
  let chosen = (opts.keys && opts.keys.length) ? LAB_PERSONAS.filter(p => opts.keys!.includes(p.key)) : LAB_PERSONAS;
  const count = Math.max(2, Math.min(opts.count || 6, LAB_PERSONAS.length));
  chosen = chosen.slice(0, count);
  for (let i = 0; i < chosen.length; i++) {
    const p = chosen[i];
    const uid = `lab-${p.key}`;
    const sys = `너는 '${p.name}'(소속: ${p.company}). 성격: ${p.trait} 토론에서 너의 성격을 분명히 드러내며 자기 생각을 말한다. 비서 아닌 토론 참가자. 자기소개·"도와드릴게요" 금지.`;
    const post = (t: string) => postPlazaMessage({ uid, company: p.company, emoji: p.emoji, role: p.name, text: t });
    const session = joinPlaza({ uid, company: p.company, emoji: p.emoji, agents: [p.emoji], source: 'connect-ai' }, () => { /* 표시 전용 */ });
    const stop = startAutoChat({
      uid, target, sys,
      makePrompt: (convo, topic) => `[토론 주제] ${topic || '자유 토론'}\n\n[지금까지 대화]\n${convo}\n\n너는 '${p.name}'(${p.trait}). 위 주제에서 벗어나지 말고, 너의 성격대로 [새 관점·반론·질문] 중 하나를 더해 토론을 진전시켜라. 앞 사람 말 반복 금지. 짧고 또렷하게 한국어 1~2문장, 대사만.`,
      post,
    });
    labBots.push({ uid, session, stop, persona: p });
    // 입장 인사 (살짝 시차)
    setTimeout(async () => { try { const h = await chat(target, sys, `방금 실험 광장에 입장. 너의 성격이 드러나는 짧은 인사 한 문장(25자내). 대사만.`, { temperature: 0.95 }); const t = cleanLine(h); if (t) await post(t); } catch { /* */ } }, 400 + i * 700);
  }
  return { ok: true, spawned: chosen.map(p => ({ key: p.key, name: p.name, emoji: p.emoji, company: p.company })), personas: LAB_PERSONAS.map(p => ({ key: p.key, name: p.name, emoji: p.emoji, trait: p.trait })) };
});
ipcMain.handle('plaza:labStop', () => { stopLab(); return { ok: true }; });
ipcMain.handle('plaza:labPersonas', () => LAB_PERSONAS.map(p => ({ key: p.key, name: p.name, emoji: p.emoji, trait: p.trait })));

// 📢 오늘의 주제 — '선생님'이 낸다. 내 에이전트와 다른 정체성이라 모든 에이전트(내 것 포함)가 반응함.
// 🛡️ 광장 관리자 — 주제 등록·채점은 관리자만 (선생님 권한)
const PLAZA_ADMIN = 'opctverse@gmail.com';
const isPlazaAdmin = () => (loadConfig().auth?.email || '').trim().toLowerCase() === PLAZA_ADMIN;
ipcMain.handle('plaza:isAdmin', () => isPlazaAdmin());

ipcMain.handle('plaza:topic', async (_e, topic: string) => {
  if (!isPlazaAdmin()) return { ok: false, notAdmin: true, error: '주제 등록은 관리자(선생님)만 할 수 있어요.' };
  const c = loadConfig();
  setPlazaDbUrl(plazaDb());
  if (!plazaConfigured()) return { ok: false, error: '광장 DB 미설정' };
  await postPlazaMessage({ uid: 'teacher-board', company: '선생님', emoji: '🧑‍🏫', role: '선생님',
    text: `📢 오늘의 주제: ${topic} — 다들 의견을 내고 함께 풀어봅시다!` });
  return { ok: true };
});

// 🧑‍🏫 선생님 채점 — 최근 토론을 보고 학생(회사)들을 채점, 우등생 발표 (관리자 전용)
ipcMain.handle('plaza:grade', async () => {
  if (!isPlazaAdmin()) return { ok: false, reason: '채점은 관리자(선생님)만 할 수 있어요.' };
  const c = loadConfig();
  setPlazaDbUrl(plazaDb());
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
  // 🏛️ 집단지성 아카이브 — 이 토론의 핵심 결론을 영구 저장 (데이터 자산)
  try {
    const topicMsg = [...recent].reverse().find(m => /^📢/.test(m.text || ''));
    const topic = (topicMsg?.text || '').replace(/^📢\s*오늘의 주제:\s*/, '').split(' — ')[0] || '자유 토론';
    const insightRaw = await chat(target, '너는 토론에서 핵심 결론·집단지성을 한 줄로 요약하는 큐레이터다.',
      `[토론]\n${convo}\n\n이 토론에서 도출된 가장 중요한 인사이트·합의를 딱 한 문장(40자 내)으로. 결론만, 군더더기 금지.`, { temperature: 0.3 });
    const insight = cleanLine(insightRaw).slice(0, 80);
    await saveArchive({ topic, participants: scores.map((s: any) => s.company), top, insight, scores: scores.map((s: any) => ({ company: s.company, score: s.score })), log: convo.slice(0, 1200) });
    // 🧠 수확한 집단지성을 내 단기기억(두뇌)에 심는다 — 광장→단기→장기 학습 루프 완성
    if (insight) { brainAddNote(`🏛️ 광장 토론 수확 — [${topic}] ${insight}`, undefined, { source: 'plaza' }); plazaLearnedToday++; }
    win?.webContents.send('plaza:archived', { topic, insight, top });
    return { ok: true, scores, top, insight, topic };
  } catch { /* 아카이브 실패해도 수확은 성공 */ }
  return { ok: true, scores, top };
});

// 🏛️ 집단지성 아카이브 열람 — 지난 토론·결론들
ipcMain.handle('plaza:archive', async () => { setPlazaDbUrl(plazaDb()); try { return await fetchArchive(50); } catch { return []; } });
