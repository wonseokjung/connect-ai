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
const releaseDir = path.join(desktopDir, 'release');
const reportPath = process.env.CONNECT_AI_PERFORMANCE_PARITY_REPORT || path.join(releaseDir, 'performance-parity-report.json');
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

const thresholds = {
  loadRatio: 1.5,
  loadSlackMs: 750,
  interactionRatio: 1.75,
  interactionSlackMs: 250,
  identicalUiSourceInteractionRatio: 4,
  identicalUiSourceInteractionSlackMs: 2000,
  heapRatio: 1.5,
  heapSlackBytes: 10 * 1024 * 1024,
};

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

function testedSourceParity(baselineRoot) {
  const uiSurfacePaths = new Set([
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
  ]);
  const files = testedSourcePaths.map((relativePath) => {
    const localFile = path.join(desktopDir, relativePath);
    const baselineFile = path.join(baselineRoot, relativePath);
    const localPresent = originalFs.existsSync(localFile);
    const baselinePresent = originalFs.existsSync(baselineFile);
    const localSha256 = localPresent ? sha256(localFile) : null;
    const baselineSha256 = baselinePresent ? sha256(baselineFile) : null;
    return {
      path: relativePath,
      uiSurface: uiSurfacePaths.has(relativePath),
      localPresent,
      baselinePresent,
      localSha256,
      baselineSha256,
      match: localPresent && baselinePresent && localSha256 === baselineSha256,
    };
  });
  const uiFiles = files.filter((file) => file.uiSurface);
  return {
    exactMatch: files.every((file) => file.match),
    uiSurfaceExactMatch: uiFiles.length > 0 && uiFiles.every((file) => file.match),
    files,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractBaselineAsar() {
  if (!originalFs.existsSync(asarPath)) throw new Error(`baseline app.asar not found: ${asarPath}`);
  const actualSha = sha256(asarPath);
  if (actualSha !== DEFAULT_ASAR_SHA256) {
    throw new Error(`baseline app.asar SHA changed: ${actualSha}. Expected ${DEFAULT_ASAR_SHA256}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-performance-baseline-'));
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

function addCheck(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    level: ok ? 'pass' : level,
    detail,
  });
}

function withinBudget(local, baselineValue, ratio, slack) {
  if (!Number.isFinite(local) || !Number.isFinite(baselineValue)) return false;
  return local <= Math.max(baselineValue * ratio, baselineValue + slack);
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function createWindow(preload) {
  return new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload,
    },
  });
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

async function collectRuntimeMetrics(win, label) {
  return await win.webContents.executeJavaScript(`(() => {
    const nav = performance.getEntriesByType('navigation')[0] || null;
    const resources = performance.getEntriesByType('resource');
    const resourceSummary = resources.reduce((acc, item) => {
      acc.durationMs += item.duration || 0;
      acc.transferSize += item.transferSize || 0;
      acc.encodedBodySize += item.encodedBodySize || 0;
      acc.decodedBodySize += item.decodedBodySize || 0;
      return acc;
    }, { count: resources.length, durationMs: 0, transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 });
    const all = document.querySelectorAll('*');
    const visible = [...all].filter((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    });
    return {
      label: ${JSON.stringify(label)},
      title: document.title,
      url: location.href.replace(/.*\\/src\\/renderer\\//, 'src/renderer/'),
      timeOrigin: performance.timeOrigin,
      nowMs: performance.now(),
      navigation: nav ? {
        type: nav.type,
        durationMs: nav.duration,
        domInteractiveMs: nav.domInteractive,
        domContentLoadedMs: nav.domContentLoadedEventEnd,
        loadEventEndMs: nav.loadEventEnd,
      } : null,
      resources: resourceSummary,
      dom: {
        nodeCount: all.length,
        visibleNodeCount: visible.length,
        bodyTextLength: (document.body?.innerText || '').length,
        scriptCount: document.scripts.length,
        stylesheetCount: document.styleSheets.length,
      },
      connectMethods: window.connect ? Object.keys(window.connect).sort().length : 0,
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      } : null,
    };
  })()`);
}

async function timeAction(win, selector, label) {
  return await win.webContents.executeJavaScript(`(async () => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return { label: ${JSON.stringify(label)}, selector: ${JSON.stringify(selector)}, ok: false, durationMs: null, reason: 'missing target' };
    const start = performance.now();
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const durationMs = performance.now() - start;
    return {
      label: ${JSON.stringify(label)},
      selector: ${JSON.stringify(selector)},
      ok: true,
      durationMs,
      activeElement: document.activeElement?.id || document.activeElement?.tagName || '',
      bodyTextLength: (document.body?.innerText || '').length,
    };
  })()`);
}

async function measureSurface(label, preload, html, errors) {
  const win = createWindow(preload);
  attachErrorCapture(win, label, errors);
  const startedAt = Date.now();
  await loadWindow(win, html);
  const loadMs = Date.now() - startedAt;
  await wait(1000);
  const initial = await collectRuntimeMetrics(win, label);
  const interactions = [];
  for (const action of [
    ['#settingsBtn', 'settings'],
    ['#manageBtn', 'manage'],
    ['#brainBtn', 'brain short'],
    ['.btab[data-btab="long"]', 'brain long'],
    ['.btab[data-btab="surgery"]', 'brain surgery'],
    ['#ghHeroFuse', 'surgery modal'],
  ]) {
    interactions.push(await timeAction(win, action[0], action[1]));
  }
  const afterInteractions = await collectRuntimeMetrics(win, `${label}:after-interactions`);
  win.destroy();
  return {
    label,
    loadMs,
    initial,
    interactions,
    afterInteractions,
  };
}

function interactionByLabel(surface, label) {
  return surface.interactions.find((item) => item.label === label) || null;
}

function compareSurfaces(local, baselineSurface, failures, sourceParity) {
  addCheck(
    'renderer load time parity',
    withinBudget(local.loadMs, baselineSurface.loadMs, thresholds.loadRatio, thresholds.loadSlackMs),
    `local=${local.loadMs}ms baseline=${baselineSurface.loadMs}ms ratio<=${thresholds.loadRatio} slack<=${thresholds.loadSlackMs}ms`
  );

  addCheck(
    'connect preload method count parity',
    local.initial.connectMethods === baselineSurface.initial.connectMethods && local.initial.connectMethods > 0,
    `local=${local.initial.connectMethods} baseline=${baselineSurface.initial.connectMethods}`
  );

  addCheck(
    'DOM node footprint parity',
    local.initial.dom.nodeCount === baselineSurface.initial.dom.nodeCount &&
      local.initial.dom.scriptCount === baselineSurface.initial.dom.scriptCount &&
      local.initial.dom.stylesheetCount === baselineSurface.initial.dom.stylesheetCount,
    `local=${JSON.stringify(local.initial.dom)} baseline=${JSON.stringify(baselineSurface.initial.dom)}`
  );

  addCheck(
    'resource footprint parity',
    local.initial.resources.count === baselineSurface.initial.resources.count,
    `local=${local.initial.resources.count} baseline=${baselineSurface.initial.resources.count}`
  );

  const localHeap = local.afterInteractions.memory?.usedJSHeapSize;
  const baselineHeap = baselineSurface.afterInteractions.memory?.usedJSHeapSize;
  addCheck(
    'renderer heap budget parity',
    localHeap == null || baselineHeap == null || withinBudget(localHeap, baselineHeap, thresholds.heapRatio, thresholds.heapSlackBytes),
    `local=${localHeap ?? 'unavailable'} baseline=${baselineHeap ?? 'unavailable'} ratio<=${thresholds.heapRatio} slack<=${thresholds.heapSlackBytes}`
  );

  addCheck(
    'interaction sample coverage',
    local.interactions.length === baselineSurface.interactions.length &&
      local.interactions.every((item) => item.ok) &&
      baselineSurface.interactions.every((item) => item.ok),
    `local=${local.interactions.length} baseline=${baselineSurface.interactions.length}`
  );

  for (const action of local.interactions) {
    const baselineAction = interactionByLabel(baselineSurface, action.label);
    const strictOk = Boolean(
      action.ok &&
        baselineAction?.ok &&
        withinBudget(action.durationMs, baselineAction.durationMs, thresholds.interactionRatio, thresholds.interactionSlackMs)
    );
    const identicalUiSourceJitterOk = Boolean(
      sourceParity?.uiSurfaceExactMatch &&
        action.ok &&
        baselineAction?.ok &&
        withinBudget(
          action.durationMs,
          baselineAction.durationMs,
          thresholds.identicalUiSourceInteractionRatio,
          thresholds.identicalUiSourceInteractionSlackMs,
        )
    );
    const ok = Boolean(
      strictOk || identicalUiSourceJitterOk
    );
    addCheck(
      `interaction latency parity: ${action.label}`,
      ok,
      strictOk
        ? `local=${round(action.durationMs)}ms baseline=${round(baselineAction?.durationMs)}ms ratio<=${thresholds.interactionRatio} slack<=${thresholds.interactionSlackMs}ms`
        : `local=${round(action.durationMs)}ms baseline=${round(baselineAction?.durationMs)}ms ratio<=${thresholds.interactionRatio} slack<=${thresholds.interactionSlackMs}ms; identicalUiSourceJitter=${identicalUiSourceJitterOk} uiSurfaceExactMatch=${Boolean(sourceParity?.uiSurfaceExactMatch)} jitterRatio<=${thresholds.identicalUiSourceInteractionRatio} jitterSlack<=${thresholds.identicalUiSourceInteractionSlackMs}ms`
    );
  }

  for (const check of checks) {
    if (!check.ok && check.level === 'blocker') failures.push(`${check.name}: ${check.detail}`);
  }
}

function writeReport({ ok, failures, errors, local, baselineSurface, sourceParity = null }) {
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
    thresholds,
    measurements: {
      local,
      baseline: baselineSurface,
    },
    sourceParity,
    testedSource: testedSourceFingerprint(),
    checks,
    failures,
    errors,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.on('window-all-closed', () => {});
  await app.whenReady();

  registerIpcHandlers();
  extractedBaselineAsarDir = extractBaselineAsar();
  const baselinePreload = path.join(extractedBaselineAsarDir, 'out', 'preload.js');
  const baselineHtml = path.join(extractedBaselineAsarDir, 'src', 'renderer', 'index.html');
  const errors = [];
  const failures = [];

  const baselineSurface = await measureSurface('baseline', baselinePreload, baselineHtml, errors);
  const local = await measureSurface('local', preloadPath, htmlPath, errors);
  const sourceParity = testedSourceParity(extractedBaselineAsarDir);

  addCheck('baseline app.asar hash', sha256(asarPath) === DEFAULT_ASAR_SHA256, sha256(asarPath));
  compareSurfaces(local, baselineSurface, failures, sourceParity);
  for (const error of errors) {
    addCheck('renderer error capture', false, error);
    failures.push(`renderer error capture: ${error}`);
  }

  const report = writeReport({
    ok: failures.length === 0,
    failures,
    errors,
    local,
    baselineSurface,
    sourceParity,
  });
  cleanupTempArtifacts();

  if (failures.length) {
    console.error('Connect AI performance parity check failed:');
    for (const failure of failures.slice(0, 80)) console.error(`- ${failure}`);
    console.error(`Wrote ${path.relative(desktopDir, reportPath)}`);
    finish(1);
    return;
  }

  console.log(`Connect AI performance parity check passed against ${baseline.source} v${DEFAULT_VERSION}`);
  console.log(`- renderer load: local ${local.loadMs}ms / baseline ${baselineSurface.loadMs}ms`);
  console.log(`- interactions: ${local.interactions.length}`);
  console.log(`- report: ${path.relative(desktopDir, reportPath)} (${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s))`);
  finish(0);
}

main().catch((error) => {
  console.error(error?.stack || error);
  checks.push({
    name: 'performance parity runtime',
    ok: false,
    level: 'blocker',
    detail: error?.stack || String(error),
  });
  try {
    writeReport({
      ok: false,
      failures: [error?.stack || String(error)],
      errors: [error?.stack || String(error)],
      local: null,
      baselineSurface: null,
    });
    console.error(`Wrote ${path.relative(desktopDir, reportPath)}`);
  } catch {}
  cleanupTempArtifacts();
  try { app.quit(); } catch {}
  finish(1);
});
