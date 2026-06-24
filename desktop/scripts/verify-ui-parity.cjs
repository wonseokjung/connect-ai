const crypto = require('node:crypto');
const fs = require('node:fs');
const originalFs = require('original-fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');
const packageJson = require('../package.json');
const {
  DEFAULT_VERSION,
  DEFAULT_ASAR_SHA256,
  baselineResources,
  cleanupBaselineApp,
  resolveBaselineApp,
} = require('./baseline-app.cjs');
const {
  desktopDir,
  preloadPath,
  htmlPath,
  registerIpcHandlers,
  loadWindow,
  isIgnorableConsoleError,
} = require('./smoke-electron.cjs');

const baseline = resolveBaselineApp();
const { asarPath } = baselineResources(baseline);
const screenshotDir = process.env.CONNECT_AI_UI_SCREENSHOT_DIR || path.join(os.tmpdir(), 'connect-ai-ui-parity');
const releaseDir = path.join(desktopDir, 'release');
const reportPath = process.env.CONNECT_AI_UI_PARITY_REPORT || path.join(releaseDir, 'ui-parity-report.json');
const checks = [];
let extractedBaselineAsarDir = null;
const testedSourcePaths = [
  'out/main.js',
  'out/preload.js',
  'out/renderer.js',
  'out/sim.js',
  'out/sim-mem.js',
  'out/sim-memory.js',
  'out/simmem.js',
  'src/renderer/index.html',
  'src/renderer/extension-ui.css',
  'src/renderer/supplement.css',
  'src/renderer/force-graph.min.js',
  'assets/plaza-bg.png',
];

function finish(code) {
  if (process.env.CONNECT_AI_ELECTRON_TEST_DONE_FILE) {
    try {
      fs.writeFileSync(process.env.CONNECT_AI_ELECTRON_TEST_DONE_FILE, `${JSON.stringify({ code })}\n`);
    } catch {}
  }
  try { app.exit(code); } catch {}
  setTimeout(() => process.exit(code), 100);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: desktopDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(originalFs.readFileSync(file)).digest('hex');
}

function fileFingerprint(relativePath) {
  const file = path.join(desktopDir, relativePath);
  const present = originalFs.existsSync(file);
  return {
    path: relativePath,
    present,
    bytes: present ? originalFs.statSync(file).size : null,
    sha256: present ? sha256(file) : null,
  };
}

function testedSourceFingerprint() {
  return {
    generatedAt: new Date().toISOString(),
    files: testedSourcePaths.map(fileFingerprint),
  };
}

function extractBaselineAsar() {
  if (!originalFs.existsSync(asarPath)) throw new Error(`baseline app.asar not found: ${asarPath}`);
  const actualSha = sha256(asarPath);
  if (actualSha !== DEFAULT_ASAR_SHA256) {
    throw new Error(`baseline app.asar SHA changed: ${actualSha}. Expected ${DEFAULT_ASAR_SHA256}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-ui-baseline-'));
  const localAsarBin = path.join(desktopDir, 'node_modules', '.bin', process.platform === 'win32' ? 'asar.cmd' : 'asar');
  try {
    if (fs.existsSync(localAsarBin)) {
      run(localAsarBin, ['extract', asarPath, tmp]);
    } else {
      run('npx', ['--yes', '--package', '@electron/asar', '--', 'asar', 'extract', asarPath, tmp]);
    }
  } catch (error) {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
    throw error;
  }
  return tmp;
}

function cleanupTempArtifacts() {
  if (extractedBaselineAsarDir) {
    try { fs.rmSync(extractedBaselineAsarDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
    extractedBaselineAsarDir = null;
  }
  cleanupBaselineApp(baseline);
}

function createWindow(preload) {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload,
    },
  });
  return win;
}

function attachErrorCapture(win, label, errors) {
  win.webContents.on('preload-error', (_event, preload, error) => {
    errors.push(`${label}: preload-error ${preload}: ${error?.stack || error}`);
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 3 && !isIgnorableConsoleError(message)) {
      errors.push(`${label}: console error: ${message} (${sourceId}:${line})`);
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    errors.push(`${label}: render-process-gone: ${details.reason}`);
  });
}

async function collectState(win, label) {
  return await win.webContents.executeJavaScript(`(() => {
    const norm = (s) => (s || '')
      .replace(/\\s+/g, ' ')
      .replace(/(오전|오후)\\s+\\d{1,2}:\\d{2}:\\d{2}/g, '$1 TIME')
      .trim();
    const selectors = [
      '.brand',
      '.header',
      '.header-right',
      '#opsStartBtn',
      '#filesBtn',
      '#termBtn',
      '#brainBtn',
      '#aiBtn',
      '#hdrPlazaBtn',
      '#manageBtn',
      '#newChatBtn',
      '#hdrAuthBtn',
      '#settingsBtn',
      '#chat',
      '#input',
      '#suggChips',
      '#codeTree',
      '#settingsPanel',
      '#managePanel',
      '#plazaPanel',
      '#brainPanel',
      '#aiPanel',
      '#officePanel',
      '#officeTodoBoard',
      '#bsec-short',
      '#bsec-long',
      '#bsec-surgery',
      '#ghHeroSync',
      '#ghHeroTrain',
      '#ghHeroFuse',
      '#longTools',
      '#surgeryPanel',
      '#surgBody'
    ];
    const sig = {};
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) {
        sig[selector] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      sig[selector] = {
        tag: el.tagName,
        className: el.className,
        text: norm(el.innerText || el.textContent || '').slice(0, 220),
        hidden: el.hidden,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      };
    }
    return {
      label: ${JSON.stringify(label)},
      title: document.title,
      url: location.href.replace(/.*\\/src\\/renderer\\//, 'src/renderer/'),
      hasConnect: !!window.connect,
      connectMethods: window.connect ? Object.keys(window.connect).sort() : [],
      bodyClass: document.body.className,
      bodyNonEmpty: (document.body.innerText || '').length > 200,
      signature: sig,
    };
  })()`);
}

async function clickAndCollect(win, selector, label) {
  return await win.webContents.executeJavaScript(`(async () => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return { clicked: false, reason: 'missing target' };
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const panels = {};
    for (const id of ['settingsPanel', 'managePanel', 'plazaPanel', 'brainPanel', 'aiPanel', 'officePanel', 'surgeryPanel', 'bsec-short', 'bsec-long', 'bsec-surgery', 'officeTodoBoard', 'surgBody']) {
      const el = document.getElementById(id);
      panels[id] = el ? { className: el.className, hidden: el.hidden, text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 180) } : null;
    }
    return {
      clicked: true,
      label: ${JSON.stringify(label)},
      activeElement: document.activeElement?.id || document.activeElement?.tagName || '',
      panels,
      chatChildren: document.getElementById('chat')?.children.length || 0,
    };
  })()`);
}

async function actionAndCollect(win, script, label) {
  await win.webContents.executeJavaScript(`(async () => {
    ${script}
    await new Promise((resolve) => setTimeout(resolve, 650));
  })()`);
  return await collectState(win, label);
}

async function stabilizeSurgeryForScreenshot(win) {
  return await win.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (el) => {
      if (!el || el.hidden || el.classList?.contains('hidden')) return false;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0 && r.width > 0 && r.height > 0;
    };
    const click = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    };
    const opened = () => visible(document.getElementById('surgeryPanel')) && (document.getElementById('surgBody')?.innerText || '').includes('Model Merging');

    for (let i = 0; i < 6 && !opened(); i += 1) {
      click('#brainBtn');
      await wait(120);
      click('.btab[data-btab="surgery"]');
      await wait(160);
      click('#ghHeroFuse') || click('#surgeryOpenBtn');
      await wait(450);
    }

    const panel = document.getElementById('surgeryPanel');
    const body = document.getElementById('surgBody');
    let normalizedTopOverlay = false;
    if (panel && body && body.innerText.includes('Model Merging')) {
      document.querySelectorAll('.overlay').forEach((el) => {
        if (el.id === 'surgeryPanel') {
          el.classList.remove('hidden');
          el.hidden = false;
        } else {
          el.classList.add('hidden');
          el.hidden = true;
        }
      });
      normalizedTopOverlay = true;
    }

    let freezeStyle = document.getElementById('connect-ai-parity-freeze');
    if (!freezeStyle) {
      freezeStyle = document.createElement('style');
      freezeStyle.id = 'connect-ai-parity-freeze';
      freezeStyle.textContent = [
        '* { transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; }',
        '*, *::before, *::after { animation-delay: 0s !important; }'
      ].join('\\n');
      document.head.appendChild(freezeStyle);
    }
    document.querySelectorAll('*').forEach((el) => {
      try {
        el.getAnimations?.({ subtree: true }).forEach((animation) => {
          animation.currentTime = 0;
          animation.pause();
        });
      } catch {}
    });
    document.querySelectorAll('.header').forEach((el) => {
      el.textContent = (el.textContent || '').replace(/(오전|오후)\\s+\\d{1,2}:\\d{2}:\\d{2}/g, '$1 TIME');
    });
    await wait(350);
    return {
      opened: opened(),
      normalizedTopOverlay,
      panelClass: panel?.className || null,
      bodyText: (body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
    };
  })()`);
}

function deepStable(value) {
  if (Array.isArray(value)) return value.map(deepStable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, deepStable(value[key])]));
}

function firstDiff(left, right, trail = '') {
  if (Object.is(left, right)) return null;
  if (typeof left !== typeof right || !left || !right || typeof left !== 'object') {
    return { path: trail || '.', local: left, installed: right };
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    const diff = firstDiff(left[key], right[key], `${trail}.${key}`);
    if (diff) return diff;
  }
  return null;
}

function compare(label, local, installed, failures) {
  const left = deepStable(local);
  const right = deepStable(installed);
  const diff = firstDiff(left, right);
  if (diff) {
    const detail = `${label} differs at ${diff.path}: local=${JSON.stringify(diff.local)} installed=${JSON.stringify(diff.installed)}`;
    checks.push({ name: label, ok: false, level: 'blocker', detail });
    failures.push(detail);
  } else {
    checks.push({ name: label, ok: true, level: 'pass', detail: 'matches baseline' });
  }
}

function addCheck(name, ok, detail, failures, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
  });
  if (!ok && failures) failures.push(`${name}: ${detail}`);
}

async function screenshot(win, file, rect = null) {
  const full = await win.webContents.capturePage();
  let img = full;
  if (rect) {
    const size = full.getSize();
    const viewport = rect.viewport || { width: size.width, height: size.height };
    const scaleX = size.width / Math.max(1, viewport.width);
    const scaleY = size.height / Math.max(1, viewport.height);
    img = full.crop({
      x: Math.max(0, Math.floor(rect.x * scaleX)),
      y: Math.max(0, Math.floor(rect.y * scaleY)),
      width: Math.max(1, Math.min(size.width, Math.ceil(rect.width * scaleX))),
      height: Math.max(1, Math.min(size.height, Math.ceil(rect.height * scaleY))),
    });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, img.toPNG());
  return { file, sha256: sha256(file), size: fs.statSync(file).size, imageSize: img.getSize(), bitmap: img.toBitmap() };
}

async function panelCaptureRect(win) {
  return await win.webContents.executeJavaScript(`(() => {
    const el =
      document.querySelector('#surgeryPanel .surgery-card') ||
      document.querySelector('#surgeryPanel .overlay-card') ||
      document.getElementById('surgeryPanel');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(r.x)),
      y: Math.max(0, Math.floor(r.y)),
      width: Math.max(1, Math.ceil(r.width)),
      height: Math.max(1, Math.ceil(r.height)),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
    };
  })()`);
}

async function waitForScreenshotPaint(win) {
  return await win.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.body?.getBoundingClientRect();
    await wait(500);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panel = document.getElementById('surgeryPanel');
    const body = document.getElementById('surgBody');
    const visible = panel && !panel.hidden && !panel.classList.contains('hidden');
    return {
      visible,
      text: (body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
    };
  })()`);
}

function screenshotSimilarity(left, right) {
  if (left.imageSize.width !== right.imageSize.width || left.imageSize.height !== right.imageSize.height) return 0;
  if (left.bitmap.length !== right.bitmap.length) return 0;
  const pixels = left.imageSize.width * left.imageSize.height;
  let same = 0;
  for (let i = 0; i < left.bitmap.length; i += 4) {
    const dr = Math.abs(left.bitmap[i] - right.bitmap[i]);
    const dg = Math.abs(left.bitmap[i + 1] - right.bitmap[i + 1]);
    const db = Math.abs(left.bitmap[i + 2] - right.bitmap[i + 2]);
    const da = Math.abs(left.bitmap[i + 3] - right.bitmap[i + 3]);
    if (dr <= 16 && dg <= 16 && db <= 16 && da <= 16) same += 1;
  }
  return same / pixels;
}

function writeReport({
  ok,
  failures,
  errors,
  localShot,
  installedShot,
  similarity,
  localInitial,
  installedInitial,
  fullPageSimilarity,
  localFullShot,
  installedFullShot,
}) {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: Boolean(ok),
    summary: {
      blockers,
      warnings,
      failures: failures.length,
      errors: errors.length,
    },
    product: {
      name: packageJson.build?.productName || packageJson.name,
      version: packageJson.version,
      appId: packageJson.build?.appId,
      electronVersion: packageJson.build?.electronVersion,
    },
    baseline: {
      source: baseline.source,
      appPath: baseline.appPath,
      fromZip: Boolean(baseline.fromZip),
      appAsarSha256: sha256(asarPath),
      expectedAppAsarSha256: DEFAULT_ASAR_SHA256,
    },
    screenshots: {
      directory: screenshotDir,
      similarity,
      threshold: 0.99,
      scope: 'surgeryCard',
      fullPageSimilarity,
      local: localShot
        ? {
            path: localShot.file,
            bytes: localShot.size,
            sha256: localShot.sha256,
            width: localShot.imageSize.width,
            height: localShot.imageSize.height,
          }
        : null,
      localFullPage: localFullShot
        ? {
            path: localFullShot.file,
            bytes: localFullShot.size,
            sha256: localFullShot.sha256,
            width: localFullShot.imageSize.width,
            height: localFullShot.imageSize.height,
          }
        : null,
      baseline: installedShot
        ? {
            path: installedShot.file,
            bytes: installedShot.size,
            sha256: installedShot.sha256,
            width: installedShot.imageSize.width,
            height: installedShot.imageSize.height,
          }
        : null,
      baselineFullPage: installedFullShot
        ? {
            path: installedFullShot.file,
            bytes: installedFullShot.size,
            sha256: installedFullShot.sha256,
            width: installedFullShot.imageSize.width,
            height: installedFullShot.imageSize.height,
          }
        : null,
    },
    surface: {
      localPreloadMethods: localInitial?.connectMethods?.length ?? null,
      baselinePreloadMethods: installedInitial?.connectMethods?.length ?? null,
      title: localInitial?.title || null,
      bodyNonEmpty: Boolean(localInitial?.bodyNonEmpty),
    },
    testedSource: testedSourceFingerprint(),
    checks,
    failures,
    errors,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function loadSurface(label, preload, html, errors) {
  const win = createWindow(preload);
  attachErrorCapture(win, label, errors);
  await loadWindow(win, html);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return win;
}

async function main() {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  await app.whenReady();

  registerIpcHandlers();

  extractedBaselineAsarDir = extractBaselineAsar();
  const installedPreload = path.join(extractedBaselineAsarDir, 'out', 'preload.js');
  const installedHtml = path.join(extractedBaselineAsarDir, 'src', 'renderer', 'index.html');
  const errors = [];
  const failures = [];

  const localWin = await loadSurface('local', preloadPath, htmlPath, errors);
  const installedWin = await loadSurface('installed', installedPreload, installedHtml, errors);

  const localInitial = await collectState(localWin, 'initial');
  const installedInitial = await collectState(installedWin, 'initial');
  compare('initial DOM/layout signature', localInitial, installedInitial, failures);

  const localSettings = await clickAndCollect(localWin, '#settingsBtn', 'settings');
  const installedSettings = await clickAndCollect(installedWin, '#settingsBtn', 'settings');
  compare('settings button behavior', localSettings, installedSettings, failures);

  const localManage = await clickAndCollect(localWin, '#manageBtn', 'manage');
  const installedManage = await clickAndCollect(installedWin, '#manageBtn', 'manage');
  compare('manage button behavior', localManage, installedManage, failures);

  const localNewChat = await clickAndCollect(localWin, '#newChatBtn', 'new chat');
  const installedNewChat = await clickAndCollect(installedWin, '#newChatBtn', 'new chat');
  compare('new chat behavior', localNewChat, installedNewChat, failures);

  const localBrain = await clickAndCollect(localWin, '#brainBtn', 'brain short');
  const installedBrain = await clickAndCollect(installedWin, '#brainBtn', 'brain short');
  compare('brain short tab behavior', localBrain, installedBrain, failures);

  const localLong = await actionAndCollect(localWin, `document.querySelector('.btab[data-btab="long"]')?.click();`, 'brain long');
  const installedLong = await actionAndCollect(installedWin, `document.querySelector('.btab[data-btab="long"]')?.click();`, 'brain long');
  compare('brain long tab behavior', localLong, installedLong, failures);

  const localSurgeryTab = await actionAndCollect(localWin, `document.querySelector('.btab[data-btab="surgery"]')?.click();`, 'brain surgery');
  const installedSurgeryTab = await actionAndCollect(installedWin, `document.querySelector('.btab[data-btab="surgery"]')?.click();`, 'brain surgery');
  compare('brain surgery tab behavior', localSurgeryTab, installedSurgeryTab, failures);

  const localSurgery = await actionAndCollect(localWin, `document.querySelector('#ghHeroFuse')?.click();`, 'surgery modal');
  const installedSurgery = await actionAndCollect(installedWin, `document.querySelector('#ghHeroFuse')?.click();`, 'surgery modal');
  compare('surgery modal behavior', localSurgery, installedSurgery, failures);

  const localStable = await stabilizeSurgeryForScreenshot(localWin);
  const installedStable = await stabilizeSurgeryForScreenshot(installedWin);
  compare('surgery screenshot stabilization', localStable, installedStable, failures);
  addCheck(
    'surgery screenshot target',
    localStable.opened && installedStable.opened,
    `local=${JSON.stringify(localStable)} installed=${JSON.stringify(installedStable)}`,
    failures
  );
  const localPanelRect = await panelCaptureRect(localWin);
  const installedPanelRect = await panelCaptureRect(installedWin);
  compare('surgery screenshot capture bounds', localPanelRect, installedPanelRect, failures);
  const localPaint = await waitForScreenshotPaint(localWin);
  const installedPaint = await waitForScreenshotPaint(installedWin);
  addCheck(
    'surgery screenshot paint readiness',
    localPaint.visible && installedPaint.visible,
    `local=${JSON.stringify(localPaint)} installed=${JSON.stringify(installedPaint)}`,
    failures
  );
  const localShot = await screenshot(localWin, path.join(screenshotDir, 'local.png'), localPanelRect);
  const installedShot = await screenshot(installedWin, path.join(screenshotDir, 'installed.png'), installedPanelRect);
  const similarity = screenshotSimilarity(localShot, installedShot);
  await waitForScreenshotPaint(localWin);
  await waitForScreenshotPaint(installedWin);
  const localFullShot = await screenshot(localWin, path.join(screenshotDir, 'local-full.png'));
  const installedFullShot = await screenshot(installedWin, path.join(screenshotDir, 'installed-full.png'));
  const fullPageSimilarity = screenshotSimilarity(localFullShot, installedFullShot);
  addCheck(
    'surgery card screenshot similarity >= 99%',
    similarity >= 0.99,
    `${(similarity * 100).toFixed(2)}%`,
    failures
  );
  addCheck(
    'full-page screenshot similarity >= 99%',
    fullPageSimilarity >= 0.99,
    `${(fullPageSimilarity * 100).toFixed(2)}%`,
    failures
  );
  const localSize = localWin.getBounds();
  const installedSize = installedWin.getBounds();
  compare('window bounds', localSize, installedSize, failures);

  for (const error of errors) addCheck('renderer error capture', false, error, failures);
  const report = writeReport({
    ok: failures.length === 0,
    failures,
    errors,
    localShot,
    installedShot,
    similarity,
    fullPageSimilarity,
    localFullShot,
    installedFullShot,
    localInitial,
    installedInitial,
  });
  localWin.destroy();
  installedWin.destroy();
  cleanupTempArtifacts();
  try { app.quit(); } catch {}
  if (failures.length) {
    console.error('Connect AI UI parity check failed:');
    for (const failure of failures.slice(0, 80)) console.error(`- ${failure}`);
    console.error(`Screenshots: ${localShot.file}, ${installedShot.file}`);
    console.error(`Wrote ${path.relative(desktopDir, reportPath)}`);
    finish(1);
    return;
  }

  console.log(`Connect AI UI parity check passed against ${baseline.source} v${DEFAULT_VERSION}`);
  console.log(`- local screenshot: ${localShot.file} (${localShot.sha256}, ${localShot.size} bytes)`);
  console.log(`- installed screenshot: ${installedShot.file} (${installedShot.sha256}, ${installedShot.size} bytes)`);
  console.log(`- surgery card screenshot similarity: ${(similarity * 100).toFixed(2)}%`);
  console.log(`- full-page screenshot similarity: ${(fullPageSimilarity * 100).toFixed(2)}%`);
  console.log(`- preload methods: ${localInitial.connectMethods.length}`);
  console.log(`- report: ${path.relative(desktopDir, reportPath)} (${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s))`);
  finish(0);
}

main().catch((error) => {
  console.error(error?.stack || error);
  checks.push({
    name: 'ui parity runtime',
    ok: false,
    level: 'blocker',
    detail: error?.stack || String(error),
  });
  try {
    writeReport({
      ok: false,
      failures: [error?.stack || String(error)],
      errors: [error?.stack || String(error)],
      localShot: null,
      installedShot: null,
      similarity: null,
      localInitial: null,
      installedInitial: null,
    });
    console.error(`Wrote ${path.relative(desktopDir, reportPath)}`);
  } catch {}
  cleanupTempArtifacts();
  try { app.quit(); } catch {}
  finish(1);
});
