const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');

const desktopDir = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const mainBundlePath = path.join(desktopDir, 'out', 'main.js');
const reportPath = path.join(desktopDir, 'release', 'ipc-security-report.json');
const doneFile = process.env.CONNECT_AI_ELECTRON_TEST_DONE_FILE || '';
const openedUrls = [];

function finish(code, report) {
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch {}
  if (doneFile) {
    try { fs.writeFileSync(doneFile, `${JSON.stringify({ code })}\n`); } catch {}
  }
  try { app.exit(code); } catch {}
  setTimeout(() => process.exit(code), 100);
}

function assertCheck(checks, name, ok, detail, level = 'blocker') {
  checks.push({ name, ok: Boolean(ok), level: ok ? 'pass' : level, detail });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMainWindow() {
  for (let i = 0; i < 80; i += 1) {
    const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (win) {
      if (win.webContents.isLoading()) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('main window load timed out')), 20000);
          win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
          win.webContents.once('did-fail-load', (_event, code, description, url) => {
            clearTimeout(timer);
            reject(new Error(`main window failed to load: ${code} ${description} ${url}`));
          });
        });
      }
      await wait(1200);
      return win;
    }
    await wait(250);
  }
  throw new Error('main window was not created');
}

async function main() {
  const checks = [];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-ai-ipc-security-'));
  const userData = path.join(tempRoot, 'userData');
  const workspace = path.join(tempRoot, 'workspace');
  const outsideDir = path.join(tempRoot, 'outside');
  const insideFile = path.join(workspace, 'inside.txt');
  const outsideFile = path.join(outsideDir, 'outside.txt');

  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(insideFile, 'inside-ok', 'utf8');
  fs.writeFileSync(outsideFile, 'outside-secret', 'utf8');

  process.env.CONNECTAI_SAFE = '1';
  process.env.ELECTRON_ENABLE_LOGGING = '0';
  app.setPath('userData', userData);
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');

  shell.openExternal = async (url) => {
    openedUrls.push(String(url));
    return '';
  };

  assertCheck(checks, 'main bundle exists', fs.existsSync(mainBundlePath), path.relative(desktopDir, mainBundlePath));
  if (!fs.existsSync(mainBundlePath)) {
    finish(1, { schemaVersion: 1, generatedAt: new Date().toISOString(), ok: false, summary: { blockers: 1, warnings: 0 }, checks });
    return;
  }

  require(mainBundlePath);
  const win = await waitForMainWindow();

  const result = await win.webContents.executeJavaScript(`(async () => {
    const workspace = ${JSON.stringify(workspace)};
    const insideFile = ${JSON.stringify(insideFile)};
    const outsideFile = ${JSON.stringify(outsideFile)};
    const outsideDir = ${JSON.stringify(outsideDir)};
    const outsideRel = ${JSON.stringify(path.relative(workspace, outsideFile))};
    const probes = {};

    probes.hasConnect = !!window.connect;
    const cfg = await window.connect.setConfig({ workspace, briefingOn: false, autoSync: false, localAuto: false, monitorOn: false });
    probes.workspaceApplied = cfg.workspace === workspace;

    const readInside = await window.connect.fsRead(insideFile);
    probes.readInsideOk = readInside?.content === 'inside-ok';

    const readOutsideAbs = await window.connect.fsRead(outsideFile);
    probes.rejectReadOutsideAbsolute = !!readOutsideAbs?.error;

    const readOutsideRel = await window.connect.fsRead(outsideRel);
    probes.rejectReadOutsideRelative = !!readOutsideRel?.error;

    const writeInside = await window.connect.fsWrite('created.txt', 'created-ok');
    probes.writeInsideOk = !!writeInside?.ok;

    const writeOutside = await window.connect.fsWrite(outsideFile, 'changed');
    probes.rejectWriteOutside = writeOutside?.ok === false;

    const treeOutside = await window.connect.fsTree(outsideDir);
    probes.rejectTreeOutside = !!treeOutside?.error;

    const revealOutside = await window.connect.fsReveal(outsideFile);
    probes.rejectRevealOutside = revealOutside === false;

    const artifactOutside = await window.connect.opsOpenArtifact(outsideFile);
    probes.rejectArtifactOutside = artifactOutside?.ok === false;

    const termOutside = await window.connect.termRun('pwd', outsideDir);
    probes.rejectTermOutside = termOutside === false;

    const jsUrl = await window.connect.openExternal('javascript:alert(1)');
    probes.rejectJavascriptUrl = jsUrl === false;

    const fileUrl = await window.connect.openExternal('file:///tmp/connect-ai-ipc-test');
    probes.rejectFileUrl = fileUrl === false;

    const httpsUrl = await window.connect.openExternal('https://example.com/connect-ai?ok=1');
    probes.acceptHttpsUrl = httpsUrl === true;

    return { probes, createdInside: await window.connect.fsRead('created.txt') };
  })()`);

  assertCheck(checks, 'renderer security probes completed', !!result.probes, 'renderer returned probe results');
  assertCheck(checks, 'preload API available', result.probes?.hasConnect, 'window.connect exposed');
  assertCheck(checks, 'workspace config applied', result.probes?.workspaceApplied, workspace);
  assertCheck(checks, 'inside workspace fsRead allowed', result.probes?.readInsideOk, insideFile);
  assertCheck(checks, 'absolute outside fsRead rejected', result.probes?.rejectReadOutsideAbsolute, outsideFile);
  assertCheck(checks, 'relative traversal fsRead rejected', result.probes?.rejectReadOutsideRelative, path.relative(workspace, outsideFile));
  assertCheck(checks, 'inside workspace fsWrite allowed', result.probes?.writeInsideOk, 'created.txt');
  assertCheck(checks, 'absolute outside fsWrite rejected', result.probes?.rejectWriteOutside, outsideFile);
  assertCheck(checks, 'outside fsTree rejected', result.probes?.rejectTreeOutside, outsideDir);
  assertCheck(checks, 'outside fsReveal rejected', result.probes?.rejectRevealOutside, outsideFile);
  assertCheck(checks, 'outside opsOpenArtifact rejected', result.probes?.rejectArtifactOutside, outsideFile);
  assertCheck(checks, 'outside terminal cwd rejected', result.probes?.rejectTermOutside, outsideDir);
  assertCheck(checks, 'javascript external URL rejected', result.probes?.rejectJavascriptUrl, 'javascript:alert(1)');
  assertCheck(checks, 'file external URL rejected', result.probes?.rejectFileUrl, 'file:///tmp/connect-ai-ipc-test');
  assertCheck(checks, 'https external URL accepted', result.probes?.acceptHttpsUrl, 'https://example.com/connect-ai?ok=1');
  assertCheck(checks, 'workspace fsWrite persists inside workspace', result.createdInside?.content === 'created-ok', result.createdInside?.content || JSON.stringify(result.createdInside));
  assertCheck(checks, 'outside file unchanged', fs.readFileSync(outsideFile, 'utf8') === 'outside-secret', 'outside file content was not modified');
  assertCheck(checks, 'external opener accepted only safe URL', openedUrls.length === 1 && openedUrls[0] === 'https://example.com/connect-ai?ok=1', openedUrls.join(', ') || 'none');

  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: blockers === 0,
    product: { name: pkg.build?.productName || 'Connect AI', version: pkg.version, appId: pkg.build?.appId || null },
    policy: {
      externalUrlProtocols: ['http:', 'https:', 'mailto:'],
      workspaceConfinement: true,
      checkedApis: ['open:external', 'fs:tree', 'fs:read', 'fs:write', 'fs:reveal', 'ops:openArtifact', 'term:run'],
    },
    summary: { blockers, warnings },
    checks,
  };

  try { win.destroy(); } catch {}
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}

  console.log('Connect AI IPC security verification');
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${path.relative(desktopDir, reportPath)}`);
  finish(blockers ? 1 : 0, report);
}

main().catch((error) => {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: false,
    summary: { blockers: 1, warnings: 0 },
    checks: [{ name: 'IPC security verifier crashed', ok: false, level: 'blocker', detail: error?.stack || String(error) }],
  };
  console.error(error?.stack || error);
  finish(1, report);
});
