/* demo-order.mjs — 신규 오더 파이프라인 엔드투엔드 데모 검증.
 *
 * 실제 Ollama qwen2.5:14b 를 호출해 ①아이디어→②화면기획→③화면구현→④개발→⑤운영
 * 5단계를 순차 실행하고, 각 단계 산출물이 다음 단계로 전달되는지, orders.json 에
 * 상태가 영속되는지, ③build 에서 실제 파일이 생성되는지 검증.
 *
 * 프로덕션 src/orders.ts 를 그대로 로드 (vscode 목킹) → 진짜 코드 검증.
 * 프롬프트는 assets/prompts/pipeline-*.md 를 로드 → 진짜 프롬프트 검증.
 *
 * 사용: node scripts/demo-order.mjs "강아지 용품 쇼핑몰 랜딩페이지"
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';

// ────────────── orders.ts 빌드 (CJS, vscode stub 주입) ──────────────
const BRAIN_DIR = process.env.BRAIN_DIR || path.join(os.homedir(), '.connect-ai-brain');
const COMPANY_DIR = path.join(BRAIN_DIR, '_company');

// vscode stub 파일 — orders.ts → paths.ts 가 import 하는 vscode 대체
const stubPath = path.join(process.cwd(), '_vscode-stub.cjs');
fs.writeFileSync(stubPath, `// vscode stub for offline test (demo-order.mjs 가 즉석 생성)
const BRAIN = ${JSON.stringify(BRAIN_DIR)};
const noop = () => {};
module.exports = {
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k === 'localBrainPath' ? BRAIN : (k === 'companyDir' ? '' : d)), update: noop }),
    fs: { exists: noop },
  },
  window: { showInformationMessage: noop, showErrorMessage: noop },
  commands: { registerCommand: noop, executeCommand: noop },
  Uri: { file: (p) => ({ fsPath: p }) },
  ConfigurationTarget: { Global: 1 },
};
`);

// esbuild 로 orders.ts → CJS 번들 (vscode 를 stub 으로 alias)
import { build } from 'esbuild';
const tmpOut = path.join(os.tmpdir(), `orders-bundle-${Date.now()}.cjs`);
await build({
  entryPoints: ['src/orders.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: tmpOut,
  logLevel: 'silent',
  alias: { vscode: stubPath },
});
// createRequire 로 CJS 로드 (ESM 컨텍스트에서)
const { createRequire } = await import('module');
const req = createRequire(import.meta.url);
const O = req(tmpOut);

// ────────────── LLM 호출 (Ollama) ──────────────
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.MODEL || 'qwen2.5:14b';
async function callLLM(system, user, { jsonMode = false, maxTokens = 1200 } = {}) {
  const body = {
    model: MODEL, stream: false,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    options: { num_ctx: 8192, num_predict: maxTokens, temperature: 0.6 },
  };
  if (jsonMode) body.format = 'json';
  const r = await axios.post(`${OLLAMA}/api/chat`, body, { timeout: 180000 });
  return r.data.message?.content || '';
}

// ────────────── 프롬프트 로드 ──────────────
function loadPrompt(stage) {
  try { return fs.readFileSync(path.join('assets', 'prompts', `pipeline-${stage}.md`), 'utf-8'); }
  catch { return ''; }
}
function personalize(s) { return (s || '').replace(/\{\{COMPANY\}\}/g, '1인 AI 기업'); }

// ────────────── 메인: 5단계 순차 실행 ──────────────
const orderPrompt = process.argv[2] || '강아지 용품 쇼핑몰 랜딩페이지 하나 만들어줘';
console.log(`\n🚀 데모 오더: "${orderPrompt}"\n`);
console.log(`   엔진: ${OLLAMA} · 모델: ${MODEL}`);
console.log(`   회사: ${COMPANY_DIR}\n`);

// 1) 회사 폴더 보장
fs.mkdirSync(path.join(COMPANY_DIR, '_shared'), { recursive: true });
fs.mkdirSync(path.join(COMPANY_DIR, 'orders'), { recursive: true });

// 2) 오더 생성 (프로덕션 createOrder)
const order = O.createOrder(orderPrompt);
console.log(`✅ 오더 생성: ${order.id} — "${order.title}"\n`);

// 3) <create_file> 태그에서 파일 추출해 실제 작성 (③build/④develop 용)
// 프로덕션 extension.ts _executeActions 와 동일: 코드펜스 먼저 벗기고 정규식으로 추출.
function extractAndWriteFiles(text, sessionRoot) {
  // 코드펜스(```html 등) 안의 태그도 잡히도록 펜스 제거
  let cleaned = text.replace(/```(?:html|xml|action|tool|tools)?\s*\n/gi, '').replace(/```\s*\n/g, '');
  const re = /<(?:create_file|write_file|file)\s+(?:path|file|name|경로|파일)=['"]?([^'">]+)['"]?[^>]*>([\s\S]*?)<\/(?:create_file|write_file|file)>/gi;
  let count = 0; const files = [];
  let m;
  while ((m = re.exec(cleaned))) {
    let p = m[1].trim();
    // {{SESSION_ROOT}} 치환 + 상대경로는 sessionRoot/site 아래로
    p = p.replace(/\{\{SESSION_ROOT\}\}/g, sessionRoot);
    let abs = p;
    if (!path.isAbsolute(abs)) abs = path.join(sessionRoot, 'site', abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, m[2]);
    files.push(abs.replace(os.homedir(), '~'));
    count++;
  }
  return { count, files };
}

// 4) 5단계 순차 실행
let prevOutput = '';
const stageResults = [];
for (const stage of O.STAGE_ORDER) {
  const label = O.STAGE_LABEL[stage];
  const tpl = loadPrompt(stage);
  const sys = personalize(tpl)
    .replace(/\{\{ORDER_PROMPT\}\}/g, orderPrompt)
    .replace(/\{\{ORDER_TITLE\}\}/g, order.title)
    .replace(/\{\{PREV_OUTPUT\}\}/g, prevOutput.slice(0, 6000))
    .replace(/\{\{SESSION_ROOT\}\}/g, order.sessionRoot);
  O.updateStage(order.id, stage, { status: 'running', startedAt: new Date().toISOString() });
  const t0 = Date.now();
  process.stdout.write(`  ${label} 진행 중...`);
  let out = '';
  try {
    out = await callLLM(sys, `${label} 단계 수행. 원본: "${orderPrompt}"`, { maxTokens: 1500 });
  } catch (e) { out = ''; console.log(` 실패: ${e.message}`); }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  // 파일 추출 (build/develop)
  let fileWriteResult = { count: 0, files: [] };
  if ((stage === 'build' || stage === 'develop') && out) {
    fileWriteResult = extractAndWriteFiles(out, order.sessionRoot);
  }
  const savedFile = O.saveStageOutput(order.id, stage, out);
  if (out && out.trim().length > 20) {
    O.updateStage(order.id, stage, { status: 'done', output: out, completedAt: new Date().toISOString() });
    prevOutput = out;
    stageResults.push({ stage, label, ok: true, len: out.length, dt, savedFile, files: fileWriteResult.files });
    console.log(` ✅ ${dt}s · ${out.length}자${fileWriteResult.files.length ? ' · 파일 ' + fileWriteResult.files.length + '개' : ''}`);
  } else {
    O.updateStage(order.id, stage, { status: 'failed', output: out });
    stageResults.push({ stage, label, ok: false, dt });
    console.log(` ❌ ${dt}s · 빈 산출물`);
    O.abortOrder(order.id, `${label} 빈 산출물`);
    break;
  }
}

// 5) 종합 보고서
const doneCount = stageResults.filter(x => x.ok).length;
const allOk = doneCount === O.STAGE_ORDER.length;
const summary = stageResults.map(x => `${x.ok ? '✅' : '❌'} ${x.label} (${x.dt}s, ${x.len || 0}자)`).join('\n');
const finalReport = `# 🎉 오더 완성 — ${order.title}\n\n오더 ID: \`${order.id}\`\n완성: ${doneCount}/${O.STAGE_ORDER.length}단계\n\n## 단계별 산출물\n${summary}\n\n## 원본 명령\n> ${orderPrompt}\n`;
const reportFile = path.join(order.sessionRoot, '_report.md');
fs.writeFileSync(reportFile, finalReport);
if (allOk) O.completeOrder(order.id, finalReport);

// ────────────── 검증 결과 출력 ──────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(allOk ? '🎉 데모 오더 완성 (5/5 단계)' : `⚠️ 부분 완료 (${doneCount}/5)`);
console.log('═'.repeat(60));
console.log(summary);
console.log(`\n📁 산출물: ${order.sessionRoot.replace(os.homedir(), '~')}/`);
console.log(`📄 보고서: ${reportFile.replace(os.homedir(), '~')}`);
const filesCreated = stageResults.flatMap(x => x.files);
if (filesCreated.length) {
  console.log(`\n🔨 생성된 파일 (${filesCreated.length}):`);
  filesCreated.forEach(f => console.log(`   ${f}`));
}
// orders.json 영속 확인
const ordersJson = JSON.parse(fs.readFileSync(path.join(COMPANY_DIR, '_shared', 'orders.json'), 'utf-8'));
const persisted = ordersJson.find(o => o.id === order.id);
console.log(`\n📊 orders.json 영속: ${persisted ? '✅ status=' + persisted.status + ', currentStage=' + persisted.currentStage : '❌ 없음'}`);
console.log(`📊 각 단계 상태: ${O.STAGE_ORDER.map(s => s + '=' + persisted?.stages[s]?.status).join(', ')}`);

// 정리
try { fs.unlinkSync(stubPath); fs.unlinkSync(tmpOut); } catch { /* */ }
process.exit(allOk ? 0 : 1);
