#!/usr/bin/env node
/* apply-order-pipeline.js — extension.ts (NFD 인코딩) 에 신규 오더 파이프라인 코드 주입.
 * extension.ts 는 macOS NFD 한글이라 Edit 도구가 문자열 매칭 못 함 → node 로 직접 수정.
 * 역순(큰 인덱스부터) 적용으로 삽입으로 인한 오프셋 밀림 방지. idempotent.
 */
'use strict';
const fs = require('fs');
const FILE = 'src/extension.ts';
const s = fs.readFileSync(FILE, 'utf-8');

const find = (needle) => { const i = s.indexOf(needle); if (i < 0) throw new Error('NOT FOUND: ' + needle.slice(0, 50)); return i; };

if (s.includes('PIPELINE_PROMPTS: Record<string, string>')) {
  console.log('already applied — skip');
  process.exit(0);
}

// ────────── 변경 블록 (큰따옴표 문자열로 안전하게) ──────────

const BLOCK_IMPORT = [
  '/* v2.89.158 — 신규 오더 파이프라인 추적 모듈 (/order <명령> 진입). */',
  "import { createOrder, getOrder, listOrders, listActiveOrders, updateStage, completeOrder, abortOrder, saveStageOutput, orderSummary, nextPendingStage, STAGE_ORDER, STAGE_LABEL, STAGE_AGENTS } from './orders';",
  ''
].join('\n');
const ANCHOR_IMPORT = "import { _getBrainDir, _isBrainDirExplicitlySet, getCompanyDir, COMPANY_SUBDIR, _expandTilde, _resolvePathInput } from './paths';";

const BLOCK_PROMPTS = [
  '/* v2.89.158 — 신규 오더 파이프라인 단계별 프롬프트. /order <명령> 진입 시',
  '   ①아이디어 ②화면기획 ③화면구현 ④개발 ⑤운영 5단계를 순차 실행하며, 각 단계',
  '   산출물이 다음 단계 userMsg 에 명시적으로 주입됨. orders.ts 가 상태 추적. */',
  'const PIPELINE_PROMPTS: Record<string, string> = {',
  "  idea: _loadPrompt('pipeline-idea.md'),",
  "  design: _loadPrompt('pipeline-design.md'),",
  "  build: _loadPrompt('pipeline-build.md'),",
  "  develop: _loadPrompt('pipeline-develop.md'),",
  "  operate: _loadPrompt('pipeline-operate.md'),",
  '};',
  ''
].join('\n');
const ANCHOR_PROMPTS = "const CEO_PLANNER_PROMPT = _loadPrompt('ceo-planner.md');\n/* Conversational CEO prompt";

const BLOCK_METHOD = [
  '    /* v2.89.158 — 신규 오더 5단계 순차 파이프라인 실행.',
  '     *',
  '     * 사용자가 "/order <명령>" 을 내리면 createOrder() 로 오더를 만들고',
  '     * ①아이디어 → ②화면기획 → ③화면구현 → ④개발 → ⑤운영 을 for...of 로 순차 실행.',
  '     * 각 단계는 기존 _callAgentLLM 을 재사용하고, 산출물은 다음 단계 userMsg 에',
  '     * "선행 단계 핸드오프" 로 명시적 주입 (기존 peerCtx 무조건 주입과 다름).',
  '     * 단계별 산출물은 orders/<id>/<stage>.md 로 저장, 상태는 orders.json 에 영속.',
  '     * 실패 시 1회 재시도 후 사용자에게 알리고 중단.',
  '     */',
  '    private async _runOrderPipeline(prompt: string, modelName: string): Promise<void> {',
  '        const post = (m: any) => this._broadcastCorporate(m);',
  '        const isAborted = () => !!this._abortController?.signal.aborted;',
  '        ensureCompanyStructure();',
  '',
  '        const order = createOrder(prompt);',
  "        appendConversationLog({ speaker: '사용자', emoji: '🚀', section: '신규 오더', body: '/order ' + prompt });",
  '',
  "        post({ type: 'response', value: '🚀 **신규 오더 시작** — ' + order.title + '\\n\\n' + STAGE_LABEL.idea + ' → ' + STAGE_LABEL.design + ' → ' + STAGE_LABEL.build + ' → ' + STAGE_LABEL.develop + ' → ' + STAGE_LABEL.operate + '\\n\\n오더 ID: `' + order.id + '`' });",
  '',
  '        let prevOutput = \'\';   // 직전 단계 산출물 — 다음 단계 userMsg 에 주입',
  '        const stageOutputs: { stage: string; label: string; ok: boolean; file?: string }[] = [];',
  '',
  '        for (const stage of STAGE_ORDER) {',
  '            if (isAborted()) {',
  "                appendConversationLog({ speaker: '시스템', emoji: '⛔', body: '오더 ' + order.id + ' 중단됨 (사용자)' });",
  "                abortOrder(order.id, '사용자 중단');",
  "                post({ type: 'response', value: '⛔ 오더가 중단되었습니다.' });",
  '                return;',
  '            }',
  '            const label = STAGE_LABEL[stage];',
  '            const agentIds = STAGE_AGENTS[stage];',
  "            updateStage(order.id, stage, { status: 'running', startedAt: new Date().toISOString(), agentIds });",
  "            post({ type: 'agentStart', agent: agentIds[0], task: label + ' (오더 파이프라인)' });",
  "            post({ type: 'response', value: '\\n━━━ ' + label + ' 진행 중 ━━━' });",
  '',
  "            const stagePromptTpl = PIPELINE_PROMPTS[stage] || '';",
  '            let out = \'\';',
  '            let ok = false;',
  '            let errMsg = \'\';',
  '',
  '            // 최대 1회 재시도 포함',
  '            for (let attempt = 0; attempt < 2 && !ok; attempt++) {',
  '                try {',
  '                    const sysBase = _personalizePrompt(stagePromptTpl)',
  '                        .replace(/\\{\\{ORDER_PROMPT\\}\\}/g, prompt)',
  '                        .replace(/\\{\\{ORDER_TITLE\\}\\}/g, order.title)',
  '                        .replace(/\\{\\{PREV_OUTPUT\\}\\}/g, prevOutput.slice(0, 6000))',
  '                        .replace(/\\{\\{SESSION_ROOT\\}\\}/g, order.sessionRoot);',
  '                    const sys = sysBase + \'\\n\\n\' + readAgentSharedContext(agentIds[0]);',
  "                    const userMsg = '이 오더의 ' + label + ' 단계를 수행하세요. 원본 명령: \"' + prompt + '\"';",
  '',
  '                    out = await this._callAgentLLM(sys, userMsg, modelName, agentIds[0], true);',
  '',
  '                    // ③build / ④develop 단계는 <create_file>·<run_command> 태그를 실행',
  "                    if (stage === 'build' || stage === 'develop') {",
  '                        try {',
  '                            await this._executeActions(out, { silent: false });',
  '                        } catch (e: any) {',
  '                            /* 파일 액션 실패해도 텍스트 산출물은 살아있음 — 경고만 */',
  "                            post({ type: 'response', value: '⚠️ ' + label + ' 파일 액션 일부 실패: ' + (e?.message || e) });",
  '                        }',
  '                    }',
  '',
  '                    if (out && out.trim().length > 20) {',
  '                        ok = true;',
  '                    } else {',
  "                        errMsg = '빈 산출물';",
  '                    }',
  '                } catch (e: any) {',
  '                    errMsg = e?.message || String(e);',
  "                    post({ type: 'response', value: '⚠️ ' + label + ' 시도 ' + (attempt + 1) + ' 실패: ' + errMsg });",
  '                }',
  '            }',
  '',
  '            const file = saveStageOutput(order.id, stage, out);',
  '            if (ok) {',
  "                updateStage(order.id, stage, { status: 'done', output: out, completedAt: new Date().toISOString(), sessionDir: order.sessionRoot });",
  '                stageOutputs.push({ stage, label, ok: true, file });',
  '                prevOutput = out;   // 다음 단계로 핸드오프',
  "                appendAgentMemory(agentIds[0], label + ' 완료 → ' + (file ? file.replace(os.homedir(), '~') : '') + ' (오더 ' + order.id + ')');",
  "                post({ type: 'response', value: '✅ ' + label + ' 완료' + (file ? ' → ' + file.replace(os.homedir(), '~') : '') });",
  '            } else {',
  "                updateStage(order.id, stage, { status: 'failed', output: out, error: errMsg, attempts: 2 });",
  '                stageOutputs.push({ stage, label, ok: false });',
  "                appendConversationLog({ speaker: '시스템', emoji: '❌', body: '오더 ' + order.id + ' ' + label + ' 실패: ' + errMsg });",
  "                post({ type: 'response', value: '❌ ' + label + ' 실패 (' + errMsg + ') — 오더를 중단합니다.' });",
  "                post({ type: 'agentEnd', agent: agentIds[0] });",
  "                abortOrder(order.id, label + ' 실패: ' + errMsg);",
  '                return;',
  '            }',
  "            post({ type: 'agentEnd', agent: agentIds[0] });",
  '        }',
  '',
  '        // 5단계 전부 성공 — 종합 보고서 작성',
  '        const doneCount = stageOutputs.filter(x => x.ok).length;',
  "        const summaryLines = stageOutputs.map(x => (x.ok ? '✅' : '❌') + ' ' + x.label + (x.file ? ' → ' + x.file.replace(os.homedir(), '~') : '')).join('\\n');",
  "        const finalReport = '# 🎉 오더 완성 — ' + order.title + '\\n\\n오더 ID: `' + order.id + '`\\n완성: ' + doneCount + '/' + STAGE_ORDER.length + '단계\\n\\n## 단계별 산출물\\n' + summaryLines + '\\n\\n## 원본 명령\\n> ' + prompt + '\\n\\n## 산출물 위치\\n`' + order.sessionRoot.replace(os.homedir(), '~') + '/`\\n';",
  "        const reportFile = path.join(order.sessionRoot, '_report.md');",
  '        try { fs.writeFileSync(reportFile, finalReport); } catch { /* ignore */ }',
  '        completeOrder(order.id, finalReport);',
  "        appendConversationLog({ speaker: 'CEO', emoji: '🎉', section: '오더 완성', body: finalReport });",
  '',
  "        post({ type: 'response', value: '\\n━━━ 🎉 오더 완성 ━━━\\n\\n' + summaryLines + '\\n\\n📁 `' + order.sessionRoot.replace(os.homedir(), '~') + '`\\n📄 `' + reportFile.replace(os.homedir(), '~') + '`' });",
  '    }',
  '',
  ''
].join('\n');
const ANCHOR_METHOD = '    private async _handleCorporatePrompt(prompt: string, modelName: string) {';

const BLOCK_BRANCH = [
  '        try {',
  '            /* v2.89.158 — /order <명령> 진입 시 신규 오더 5단계 파이프라인 실행.',
  '               일반 CEO 분배(단발성)와 별개 경로 — 한 명령을 끝까지(운영까지) 끝냄. */',
  '            if (/^\\/order\\b\\s*\\S/i.test(prompt)) {',
  "                const orderPrompt = prompt.replace(/^\\/order\\s*/i, '').trim();",
  '                if (!orderPrompt) {',
  "                    this._broadcastCorporate({ type: 'response', value: '사용법: `/order <만들 것>` — 예) `/order 강아지 용품 쇼핑몰 랜딩페이지`' });",
  '                    return;',
  '                }',
  '                await this._runOrderPipeline(orderPrompt, modelName);',
  '                return;',
  '            }',
  '            ensureCompanyStructure();',
  '            const sessionDir = makeSessionDir();'
].join('\n');
const ANCHOR_BRANCH = '        try {\n            ensureCompanyStructure();\n            const sessionDir = makeSessionDir();';

const BLOCK_CMD = [
  "        // v2.89.158 — 신규 오더 파이프라인 명령 (/order 와 동일 로직, 명령 팔레트 진입점)",
  "        vscode.commands.registerCommand('connectAiLab.order.new', async () => {",
  '            const orderPrompt = await vscode.window.showInputBox({',
  "                placeHolder: '만들 것을 한 줄로 — 예) 강아지 용품 쇼핑몰 랜딩페이지',",
  "                prompt: '신규 오더: ①아이디어 ②화면기획 ③화면구현 ④개발 ⑤운영 자동 실행',",
  '            });',
  '            if (!orderPrompt) return;',
  '            try {',
  '                _activeChatProvider?._runOrderPipeline?.(orderPrompt, \'\');',
  '            } catch (e: any) {',
  "                vscode.window.showErrorMessage('오더 시작 실패: ' + (e?.message || e));",
  '            }',
  '        }),',
  "        vscode.commands.registerCommand('connectAiLab.order.list', async () => {",
  '            const orders = listOrders();',
  "            if (!orders.length) { vscode.window.showInformationMessage('아직 오더가 없습니다. /order <명령> 으로 시작하세요.'); return; }",
  '            const items = orders.map(o => ({',
  "                label: (o.status === 'completed' ? '✅' : o.status === 'aborted' ? '⛔' : '🔄') + ' ' + o.title,",
  '                description: orderSummary(o),',
  "                detail: '생성 ' + o.createdAt.slice(0, 16) + ' · ' + o.id,",
  '                order: o,',
  '            }));',
  "            const picked = await vscode.window.showQuickPick(items, { placeHolder: '오더 선택 — 산출물 폴더 열기' });",
  '            if (picked) {',
  '                const uri = vscode.Uri.file(picked.order.sessionRoot);',
  "                vscode.commands.executeCommand('revealFileInOS', uri);",
  '            }',
  '        }),',
  '        '
].join('\n');
const ANCHOR_CMD = "        vscode.commands.registerCommand('connectAiLab.developer.scaffoldProject'";

// ────────── 검증 + 역순 적용 ──────────
const changes = [
  { anchor: ANCHOR_CMD, name: 'cmd register', replaceWith: BLOCK_CMD + ANCHOR_CMD },
  { anchor: ANCHOR_BRANCH, name: '/order branch', replaceWith: BLOCK_BRANCH },
  { anchor: ANCHOR_METHOD, name: '_runOrderPipeline method', replaceWith: BLOCK_METHOD + ANCHOR_METHOD },
  { anchor: ANCHOR_PROMPTS, name: 'PIPELINE_PROMPTS', replaceWith: "const CEO_PLANNER_PROMPT = _loadPrompt('ceo-planner.md');\n" + BLOCK_PROMPTS + '/* Conversational CEO prompt' },
  { anchor: ANCHOR_IMPORT, name: 'orders import', replaceWith: ANCHOR_IMPORT + '\n' + BLOCK_IMPORT }
];

// 각 앵커 정확히 1회 등장 검증
for (const c of changes) {
  const count = s.split(c.anchor).length - 1;
  if (count !== 1) throw new Error("anchor '" + c.name + "' appears " + count + " times (need 1): '" + c.anchor.slice(0, 40) + "'");
}

// 역순 적용
let result = s;
const sorted = changes.map(c => ({ ...c, offset: s.indexOf(c.anchor) })).sort((a, b) => b.offset - a.offset);
for (const c of sorted) {
  if (!result.includes(c.anchor)) throw new Error('anchor lost during apply: ' + c.name);
  result = result.replace(c.anchor, c.replaceWith);
  console.log('applied: ' + c.name + ' (offset ' + c.offset + ')');
}

fs.writeFileSync(FILE, result, 'utf-8');
console.log('done: ' + s.length + ' -> ' + result.length + ' bytes (+' + (result.length - s.length) + ')');
