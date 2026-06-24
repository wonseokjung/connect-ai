const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const desktopDir = path.resolve(__dirname, '..');
const preloadPath = path.join(desktopDir, 'out', 'preload.js');
const htmlPath = path.join(desktopDir, 'src', 'renderer', 'index.html');
const preloadSourcePath = path.join(desktopDir, 'src', 'preload.ts');

const defaultConfig = {
  company: 'Smoke Test',
  agentName: '에이전트',
  userTitle: '사장님',
  plazaEmoji: '🖥️',
  greeting: '',
  workspace: desktopDir,
  tools: true,
  voiceName: '',
  jarvis: false,
  plazaDbUrl: '',
  llmBase: '',
  llmModel: '',
  voice: false,
  services: [],
  telegramToken: '',
  telegramChatId: '',
  emailAutoReply: false,
  apiKeys: {},
  paypalClientId: '',
  paypalSecret: '',
  tossSecretKey: '',
  apiConn: {},
  briefingOn: false,
  briefingHour: 9,
  briefingMin: 0,
  lastBriefing: '',
  trainNotebookUrl: '',
  autoSync: false,
  lastSyncCount: 0,
  lastTrainHintCount: 0,
  firebaseApiKey: '',
  firebaseDbUrl: '',
  mcpConfig: {},
  gpuUsage: { month: '', train: 0, surgery: 0 },
  stats: { trains: 0, datasets: 0, fusions: 0 },
  voiceQuality: 'browser',
  qwenVoice: 'Sohee',
  ttsLocalUrl: '',
  localModelPath: '',
  modelsDirOverride: '',
  localAuto: false,
  localFlashAttn: true,
  localCtxSize: 8192,
  localTemp: 0.7,
  localMaxTokens: 1024,
  localTopP: 0.9,
  localTopK: 40,
  localMinP: 0.05,
  localRepeatPenalty: 1.1,
  localFreqPenalty: 0,
  localPresPenalty: 0,
  localRepeatLastN: 64,
  onboarded: true,
  monitorOn: false,
};

let config = { ...defaultConfig };

function finish(code) {
  if (process.env.CONNECT_AI_ELECTRON_TEST_DONE_FILE) {
    try {
      fs.writeFileSync(process.env.CONNECT_AI_ELECTRON_TEST_DONE_FILE, `${JSON.stringify({ code })}\n`);
    } catch {}
  }
  try { app.exit(code); } catch {}
  setTimeout(() => process.exit(code), 100);
}

const defaults = {
  'config:get': () => config,
  'config:set': (patch = {}) => {
    config = { ...config, ...patch };
    return config;
  },
  'safemode:get': () => false,
  'safemode:set': () => true,
  'workspace:get': () => desktopDir,
  'workspace:pick': () => desktopDir,
  'fs:tree': () => ({ root: desktopDir, children: [] }),
  'fs:read': () => ({ text: '', binary: false }),
  'fs:write': () => ({ ok: true }),
  'fs:reveal': () => true,
  'models:list': () => ({ ok: false, models: [], base: '', model: '' }),
  'local:status': () => ({ running: false, modelName: '', baseUrl: '' }),
  'local:start': () => ({ running: false, modelName: '', baseUrl: '' }),
  'local:stop': () => ({ running: false, modelName: '', baseUrl: '' }),
  'local:base': () => 'http://127.0.0.1:3867/v1',
  'local:models': () => [],
  'local:modelsDir': () => ({ dir: path.join(desktopDir, 'models'), custom: false }),
  'local:pickModelsDir': () => ({ dir: path.join(desktopDir, 'models'), custom: false }),
  'local:openModelsDir': () => true,
  'local:resetModelsDir': () => ({ dir: path.join(desktopDir, 'models'), custom: false }),
  'local:delete': () => ({ ok: true }),
  'local:options': () => ({}),
  'local:setOptions': (patch = {}) => patch,
  'hf:recommended': () => [],
  'hf:search': () => ({ ok: true, models: [] }),
  'hf:files': () => ({ ok: true, files: [] }),
  'hf:download': () => ({ ok: false, error: 'smoke' }),
  'hf:myModels': () => ({ ok: true, me: 'smoke', models: [] }),
  'hf:searchModels': () => ({ ok: true, models: [] }),
  'mcp:get': () => ({}),
  'mcp:save': () => true,
  'mcp:test': () => [],
  'mcp:tools': () => [],
  'tasks:list': () => [],
  'tasks:add': () => [],
  'tasks:done': () => [],
  'tasks:cancel': () => [],
  'approvals:list': () => [],
  'approvals:approve': () => ({ list: [] }),
  'approvals:reject': () => ({ list: [] }),
  'approvals:test': () => ({ ok: true }),
  'services:list': () => [],
  'services:add': () => [],
  'services:update': () => [],
  'services:delete': () => [],
  'services:intel': () => [],
  'integrations:get': () => ({}),
  'integrations:save': () => true,
  'api:get': () => ({}),
  'api:save': () => ({ ok: true }),
  'youtube:get': () => ({ ok: false, error: 'smoke' }),
  'youtube:oauth': () => ({ ok: false, error: 'smoke' }),
  'dashboard:stats': () => ({ services: 0, tasks: 0, notes: 0, approvals: 0 }),
  'ops:status': () => ({ running: false, phase: 'idle', cycle: 0, ideas: [], shipped: [] }),
  'ops:start': () => ({ running: false, phase: 'idle', cycle: 0, ideas: [], shipped: [] }),
  'ops:feedback': () => ({ running: false, phase: 'idle', cycle: 0, ideas: [], shipped: [] }),
  'ops:stop': () => ({ running: false, phase: 'idle', cycle: 0, ideas: [], shipped: [] }),
  'ops:nextCycle': () => ({ running: false, phase: 'idle', cycle: 0, ideas: [], shipped: [] }),
  'ops:executeSelected': () => ({ running: false, phase: 'idle', cycle: 0, ideas: [], shipped: [] }),
  'ops:openReview': () => true,
  'ops:clearShipped': () => ({ running: false, phase: 'idle', cycle: 0, ideas: [], shipped: [] }),
  'ops:openArtifact': () => ({ ok: false, error: 'smoke' }),
  'remote:info': () => null,
  'brain:graph': () => ({ nodes: [], links: [] }),
  'brain:list': () => [],
  'brain:count': () => 0,
  'brain:delete': () => 0,
  'brain:stats': () => [],
  'bridge:status': () => ({ running: false }),
  'brain:publishPack': () => ({ ok: false, error: 'smoke' }),
  'brain:linkBrain': () => ({ ok: false, error: 'smoke' }),
  'brain:buildDataset': () => ({ ok: false, error: 'smoke' }),
  'brain:buildPreference': () => ({ ok: false, error: 'smoke' }),
  'brain:modelName': () => ({ suggested: 'smoke-model', prev: '' }),
  memstatus: () => ({ ok: true, count: 0 }),
  'github:push': () => ({ ok: false, error: 'smoke' }),
  'github:pull': () => ({ ok: false, error: 'smoke' }),
  'hf:uploadBrain': () => ({ ok: false, error: 'smoke' }),
  'hf:uploadPreference': () => ({ ok: false, error: 'smoke' }),
  'train:notebook': () => ({ ok: false, error: 'smoke' }),
  'train:autotrain': () => ({ ok: false, error: 'smoke' }),
  'train:cloud': () => ({ ok: false, error: 'smoke' }),
  'train:cloudStatus': () => ({ ok: false, error: 'smoke' }),
  'train:cloudInstall': () => ({ ok: false, error: 'smoke' }),
  'methods:list': () => [],
  'auth:current': () => ({ configured: false }),
  'auth:signup': () => ({ ok: false, error: 'smoke' }),
  'auth:login': () => ({ ok: false, error: 'smoke' }),
  'auth:logout': () => ({ ok: true }),
  'plaza:isAdmin': () => false,
  'plaza:labPersonas': () => [],
  'plaza:dburl': () => '',
  'plaza:enter': () => ({ ok: false, error: 'smoke' }),
  'plaza:leave': () => true,
  'plaza:send': () => ({ ok: true }),
  'plaza:topic': () => ({ ok: false, error: 'smoke' }),
  'plaza:grade': () => ({ ok: false, error: 'smoke' }),
  'plaza:demobot': () => ({ ok: true }),
  'plaza:lab': () => ({ ok: false, error: 'smoke' }),
  'plaza:labStop': () => ({ ok: true }),
  'plaza:profile': () => ({ ok: true, profile: null }),
  'inventory:get': () => ({ models: 0, datasets: 0, fusions: 0, trains: 0, totalLevel: 1, topModel: '' }),
  'update:check': () => ({ dev: true }),
  'update:install': () => true,
  'open:external': () => true,
  'diag:open': () => true,
  'briefing:run': () => true,
  'company:run': () => ({ ok: true }),
  'company:stop': () => true,
  'company:reset': () => true,
  'tts:speak': () => ({ ok: false, error: 'smoke' }),
  'tts:speakAgent': () => ({ ok: false, error: 'smoke' }),
  'office:open': () => true,
  'office:banter': () => ({ ok: false, lines: [] }),
  'revenue:open': () => true,
  'revenue:ready': () => true,
  'revenue:refresh': () => true,
  'revenue:openSettings': () => true,
  'cycle:idea': () => ({ ok: false, error: 'smoke' }),
  'cycle:report': () => ({ ok: false, error: 'smoke' }),
  'cycle:marketing': () => ({ ok: false, error: 'smoke' }),
  'gpu:usage': () => ({ used: 0, limit: 3, left: 3 }),
  'surgery:merge': () => ({ ok: false, error: 'smoke' }),
  'report:briefing': () => ({ ok: false, error: 'smoke' }),
  'report:speak': () => ({ ok: false, error: 'smoke' }),
  'telegram:test': () => ({ ok: false, error: 'smoke' }),
  'term:run': () => ({ ok: true }),
  'term:kill': () => true,
  'app:relaunch': () => true,
};

function invokedChannels() {
  const source = fs.readFileSync(preloadSourcePath, 'utf8');
  return [...source.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function registerIpcHandlers() {
  for (const channel of new Set(invokedChannels())) {
    ipcMain.handle(channel, async (_event, ...args) => {
      const handler = defaults[channel];
      return typeof handler === 'function' ? handler(...args) : true;
    });
  }
}

function isIgnorableConsoleError(message) {
  return /IndexSizeError: Failed to execute 'arc'.*radius provided .* is negative/.test(message);
}

function loadWindow(win, targetHtmlPath = htmlPath) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('renderer load timed out')), 15000);
    win.webContents.once('did-fail-load', (_event, code, description, url) => {
      clearTimeout(timer);
      reject(new Error(`renderer failed to load: ${code} ${description} ${url}`));
    });
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
    win.loadFile(targetHtmlPath);
  });
}

async function main() {
  for (const required of [preloadPath, htmlPath]) {
    if (!fs.existsSync(required)) throw new Error(`missing required smoke input: ${required}`);
  }

  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');

  await app.whenReady();
  registerIpcHandlers();

  const errors = [];
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  win.webContents.on('preload-error', (_event, preload, error) => {
    errors.push(`preload-error ${preload}: ${error?.stack || error}`);
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 3 && !isIgnorableConsoleError(message)) {
      errors.push(`console error: ${message} (${sourceId}:${line})`);
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    errors.push(`render-process-gone: ${details.reason}`);
  });

  await loadWindow(win);
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const result = await win.webContents.executeJavaScript(`(() => {
    const text = document.body.innerText || '';
    return {
      title: document.title,
      hasConnect: !!window.connect,
      connectMethods: window.connect ? Object.keys(window.connect).length : 0,
      brand: document.querySelector('.brand')?.textContent || '',
      chatExists: !!document.getElementById('chat'),
      bodyLength: text.length,
      bootExists: !!document.getElementById('boot')
    };
  })()`);

  win.destroy();
  app.quit();

  const failures = [];
  if (!result.title.includes('Connect AI')) failures.push(`unexpected title: ${result.title}`);
  if (!result.hasConnect) failures.push('window.connect was not exposed by preload');
  if (result.connectMethods < 50) failures.push(`too few preload methods exposed: ${result.connectMethods}`);
  if (result.brand.trim() !== 'Connect AI') failures.push(`brand text mismatch: ${result.brand}`);
  if (!result.chatExists) failures.push('chat container missing');
  if (result.bodyLength < 200) failures.push(`renderer body looks too small: ${result.bodyLength}`);
  failures.push(...errors);

  if (failures.length) {
    console.error('Connect AI Electron smoke failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    finish(1);
    return;
  }

  console.log(`Connect AI Electron smoke passed (${result.connectMethods} preload methods, ${result.bodyLength} body chars).`);
  finish(0);
}

if (!module.parent) {
  main().catch((error) => {
    console.error(error?.stack || error);
    try { app.quit(); } catch {}
    finish(1);
  });
}

module.exports = {
  desktopDir,
  htmlPath,
  preloadPath,
  registerIpcHandlers,
  loadWindow,
  isIgnorableConsoleError,
};
