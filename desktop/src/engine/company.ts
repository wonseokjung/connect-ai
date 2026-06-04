// 엔진 — 통합 1인 기업 모드. 에이전트 하나가 스스로 판단해서 직접 처리하거나, 큰 일은 <team>으로 동료에게 위임(dispatch). 별도 모드 구분 없음.
import * as os from 'os';
import { chat, completeMessages, completeWithTools, detectTarget, embed, LlmTarget, ChatMessage, ToolSchema, ToolUse } from './llm';
import { AGENTS, SPECIALIST_IDS, specialistPrompt, agentPrompt, triagePrompt } from './persona';
import { parseTools, runTool, toolGuide, stripTools } from './tools';
import { search as brainSearch, addNote as brainAdd } from './brain';
import { addTask } from './tasks';
import { addApproval } from './approvals';
import { listMcpTools, callMcpTool } from './mcp';
import { webSearch, fetchUrl } from './web';

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

export type EngineEvent =
  | { kind: 'status'; text: string }
  | { kind: 'dispatch'; agents: { id: string; name: string; emoji: string }[] }  // 팀 소집 — 시네마틱 진입
  | { kind: 'agentStart'; id: string; name: string; emoji: string }
  | { kind: 'agentChunk'; id: string; text: string }                    // 실시간 스트리밍 (책상에 흐름)
  | { kind: 'agentDone'; id: string; output: string }
  | { kind: 'agentConfer'; from: string; fromName: string; to: string; toName: string; text: string } // 팀 회의 한마디
  | { kind: 'tool'; name: string; path: string; ok: boolean }
  | { kind: 'token'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; text: string };

export interface RunOpts { company: string; agentName?: string; userTitle?: string; workspace?: string; servicesInfo?: string; target?: Partial<LlmTarget>; signal?: AbortSignal; realtimeFor?: (agentId: string) => Promise<string>; getRevenue?: () => Promise<string>; captureScreen?: () => Promise<string | null>; readClipboard?: () => Promise<string>; openPath?: (p: string) => Promise<string>; startServer?: (cmd: string) => Promise<string>; attachImages?: string[]; agentModels?: Record<string, string>; }
const aborted = (opts: { signal?: AbortSignal }) => !!opts.signal?.aborted;

// ── 네이티브 tool calling ───────────────────────────────────────────────
// 도구 1개 정의: 이름·설명·JSON 스키마 + 실제 실행 함수.
interface RegEntry { name: string; description: string; parameters: any; event?: string; run: (args: any) => Promise<{ text: string; ok?: boolean; path?: string; image?: string }>; }

// 모델이 호출할 도구 레지스트리 — 로컬 파일/실행 + on-demand(매출·화면 등) + MCP 동적 도구.
async function buildRegistry(opts: RunOpts, workspace: string, target: LlmTarget, onEvent: (e: EngineEvent) => void): Promise<RegEntry[]> {
  const obj = (properties: any, required: string[] = []) => ({ type: 'object', properties, required });
  const reg: RegEntry[] = [];
  const tl = (tool: any, path: string, content?: string) => { const r = runTool({ tool, path, content }, workspace); return { text: r.output, ok: r.ok, path }; };
  reg.push({ name: 'list_dir', description: '폴더의 파일·하위폴더 목록', event: 'list_dir', parameters: obj({ path: { type: 'string', description: '폴더 경로(절대 또는 작업폴더 기준)' } }, ['path']), run: async a => tl('list_dir', a.path || '.') });
  reg.push({ name: 'read_file', description: '텍스트/코드 파일 읽기(영상·이미지 등 바이너리는 불가, open_path 사용)', event: 'read_file', parameters: obj({ path: { type: 'string' } }, ['path']), run: async a => tl('read_file', a.path) });
  reg.push({ name: 'write_file', description: '파일 생성/덮어쓰기 — 코드·문서를 실제 파일로 만든다', event: 'write_file', parameters: obj({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']), run: async a => tl('write_file', a.path, a.content ?? '') });
  reg.push({ name: 'run_command', description: '금방 끝나는 셸 명령 실행(설치·테스트·git 등). 계속 떠있는 개발 서버는 start_server 사용', event: 'run_command', parameters: obj({ command: { type: 'string' } }, ['command']), run: async a => tl('run_command', a.command) });
  reg.push({ name: 'find_files', description: '이름으로 내 컴퓨터에서 파일 검색(바탕화면·문서·다운로드·동영상·음악·사진)', event: 'find', parameters: obj({ query: { type: 'string' } }, ['query']), run: async a => tl('find', a.query) });
  if (opts.openPath) reg.push({ name: 'open_path', description: '파일·앱·URL을 기본 프로그램으로 열기/실행/재생(영상·이미지·음악·문서·웹)', event: 'open', parameters: obj({ target: { type: 'string', description: '경로 또는 URL' } }, ['target']), run: async a => { const r = await opts.openPath!(a.target); return { text: r, ok: !/실패/.test(r), path: a.target }; } });
  if (opts.startServer) reg.push({ name: 'start_server', description: '개발 서버·로컬호스트 실행(npm run dev·vite·flask·python -m http.server 등) — 백그라운드로 띄우고 브라우저를 자동으로 연다. ⚠️ 정적 웹사이트는 반드시 write_file로 index.html을 먼저 만든 뒤에 호출할 것(빈 폴더를 serve하면 "Directory listing"만 뜬다).', event: 'serve', parameters: obj({ command: { type: 'string' } }, ['command']), run: async a => { const r = await opts.startServer!(a.command); return { text: r, ok: !/실패/.test(r), path: a.command }; } });
  reg.push({ name: 'web_search', description: '웹 검색(최신 정보·리서치)', event: 'web_search', parameters: obj({ query: { type: 'string' } }, ['query']), run: async a => { const r = await webSearch(a.query); return { text: r, ok: true, path: a.query }; } });
  reg.push({ name: 'fetch_url', description: '웹페이지 내용 읽기', event: 'fetch_url', parameters: obj({ url: { type: 'string' } }, ['url']), run: async a => { const r = await fetchUrl(a.url); return { text: r, ok: !r.startsWith('('), path: a.url }; } });
  if (opts.getRevenue) reg.push({ name: 'get_revenue', description: '내 매출/수익 확인(PayPal 실데이터 — 파일 찾지 말고 이걸 써라)', event: 'revenue', parameters: obj({}), run: async () => { const r = await opts.getRevenue!(); return { text: r, ok: true, path: 'PayPal' }; } });
  if (opts.readClipboard) reg.push({ name: 'read_clipboard', description: '사용자가 방금 복사한 클립보드 내용 읽기', event: 'clipboard', parameters: obj({}), run: async () => { const r = await opts.readClipboard!(); return { text: r || '(비어 있음)', ok: true, path: '클립보드' }; } });
  if (opts.captureScreen) reg.push({ name: 'capture_screen', description: '사용자 화면을 캡처해서 직접 본다(화면 분석·에러 확인 — 비전 모델 필요)', event: 'screenshot', parameters: obj({}), run: async () => { const img = await opts.captureScreen!(); return img ? { text: '화면을 캡처했어요. 아래 이미지를 보고 분석하세요.', ok: true, path: '화면', image: img } : { text: '화면 캡처 실패 — macOS 시스템 설정 → 개인정보 보호 → 화면 기록 에서 권한을 켜야 해요.', ok: false, path: '화면' }; } });
  reg.push({ name: 'remember', description: '두뇌에 지식을 영구 저장', event: 'remember', parameters: obj({ text: { type: 'string' } }, ['text']), run: async a => { let e: number[] | null = null; try { e = await embed(target.base, a.text); } catch { /* */ } brainAdd(a.text, e || undefined); return { text: '기억했어요.', ok: true, path: a.text }; } });
  reg.push({ name: 'add_task', description: '할 일을 태스크 보드에 등록', event: 'task', parameters: obj({ text: { type: 'string' } }, ['text']), run: async a => { addTask(a.text, { owner: 'agent', agentEmoji: '🤖' }); return { text: '할 일을 등록했어요.', ok: true, path: a.text }; } });
  reg.push({ name: 'request_approval', description: '되돌리기 어려운 행동(돈 쓰기·발송·배포) 전 사용자 결재 요청. action 지정 시 승인되면 자동 실행', event: 'approve', parameters: obj({ title: { type: 'string' }, detail: { type: 'string' }, action: { type: 'string', enum: ['run', 'write', 'telegram', 'email'], description: '승인 후 자동 실행 종류(선택)' }, payload: { type: 'string', description: '실행할 명령/내용(선택)' }, path: { type: 'string', description: 'write 시 파일 경로(선택)' } }, ['title']), run: async a => { const act = ['run', 'write', 'telegram', 'email'].includes(a.action) ? { kind: a.action, payload: a.payload || '', path: a.path } : undefined; addApproval(a.title, act ? `⚡ ${a.action}: ${(a.payload || '').slice(0, 80)}` : (a.detail || a.title), '🤖', act as any); return { text: '승인 요청을 올렸어요.', ok: true, path: a.title }; } });
  reg.push({ name: 'dispatch_team', description: '콘텐츠 기획+디자인+개발처럼 여러 전문 분야가 동시에 필요한 큰 프로젝트를 전문 동료(유튜브·디자이너·개발자 등)에게 위임하고 결과를 받는다', parameters: obj({ brief: { type: 'string', description: '동료들에게 시킬 일' } }, ['brief']), run: async a => { const digest = await dispatchTeam(target, a.brief, opts.agentName || '에이전트', opts.company || '1인 기업', onEvent, opts.signal, opts.realtimeFor, workspace, opts.userTitle || '사장님', opts.agentModels || {}); return { text: digest, ok: true, path: '팀' }; } });
  try {
    const mt = await listMcpTools();
    for (const t of mt as any[]) {
      const fn = `mcp__${t.server}__${t.name}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60);
      const schema = (t.inputSchema && t.inputSchema.type === 'object') ? t.inputSchema : obj({});
      reg.push({ name: fn, description: `[MCP ${t.server}] ${(t.description || t.name || '').slice(0, 160)}`, event: 'mcp', parameters: schema, run: async a => { const r = await callMcpTool(t.server, t.name, a || {}); return { text: r, ok: !r.startsWith('(MCP'), path: `${t.server}.${t.name}` }; } });
    }
  } catch { /* MCP 없어도 진행 */ }
  return reg;
}

function nativeGuide(workspace: string): string {
  return `\n\n## 도구 사용 (매우 중요)\n너는 함수(도구)를 직접 호출할 수 있다. 파일 읽기/쓰기, 명령 실행, 개발 서버 실행(start_server), 파일 검색, 웹 검색, 화면 보기, 매출 확인 등은 반드시 해당 도구를 호출해서 실제로 수행해라.\n- "지금 만들겠습니다 / 잠시만 기다려 주세요" 같은 예고만 하고 끝내지 마라. 만들라고 하면 그 턴에서 바로 write_file 등을 호출해라.\n- 웹사이트/앱을 만들면 순서를 반드시 지켜라: ① write_file 로 index.html(+css/js)을 실제로 만든다 → ② start_server 로 띄운다. 파일 없이 start_server만 하면 빈 폴더라 아무것도 안 보인다. "만들었다"고만 말하고 실제로 write_file을 안 하는 것은 거짓 보고다.\n- 작업 폴더 = ${workspace} (상대경로는 이 기준). 도구를 다 쓴 뒤 사용자에게 한국어로 자연스럽게 보고해라.`;
}

// 텍스트 태그(<write_file> 등)를 레지스트리 도구 호출 {name,args}로 변환 — tool_calls 안 쓰는 모델 대비. 실행기는 동일.
function parseTextTools(text: string): { name: string; args: any }[] {
  const out: { name: string; args: any }[] = [];
  let m: RegExpExecArray | null;
  const reW1 = /<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g;
  while ((m = reW1.exec(text))) out.push({ name: 'write_file', args: { path: m[1].trim(), content: m[2] } });
  const reW2 = /<write_file>\s*\n?\s*([^\n<]+?)\s*\n([\s\S]*?)<\/write_file>/g;
  while ((m = reW2.exec(text))) out.push({ name: 'write_file', args: { path: m[1].trim(), content: m[2].replace(/\n$/, '') } });
  const simple: [string, string, string][] = [['read_file', 'read_file', 'path'], ['list_dir', 'list_dir', 'path'], ['find', 'find_files', 'query'], ['open', 'open_path', 'target'], ['web_search', 'web_search', 'query'], ['fetch_url', 'fetch_url', 'url'], ['remember', 'remember', 'text'], ['task', 'add_task', 'text']];
  for (const [tag, name, key] of simple) { const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g'); while ((m = re.exec(text))) out.push({ name, args: { [key]: m[1].trim() } }); }
  const reRun = /<run>([\s\S]*?)<\/run>/g; while ((m = reRun.exec(text))) out.push({ name: 'run_command', args: { command: m[1].trim() } });
  const reSrv = /<serve(?:_server)?>([\s\S]*?)<\/serve(?:_server)?>/g; while ((m = reSrv.exec(text))) out.push({ name: 'start_server', args: { command: m[1].trim() } });
  if (/<revenue[\s>/]/.test(text)) out.push({ name: 'get_revenue', args: {} });
  if (/<screenshot[\s>/]/.test(text)) out.push({ name: 'capture_screen', args: {} });
  if (/<clipboard[\s>/]/.test(text)) out.push({ name: 'read_clipboard', args: {} });
  for (const a of text.matchAll(/<approve([^>]*)>([\s\S]*?)<\/approve>/g)) { const body = (a[2] || '').trim(); const bar = body.indexOf('|'); out.push({ name: 'request_approval', args: { title: (bar >= 0 ? body.slice(0, bar) : body).trim(), detail: bar >= 0 ? body.slice(bar + 1).trim() : '', action: a[1].match(/do="([^"]+)"/)?.[1], payload: bar >= 0 ? body.slice(bar + 1).trim() : '', path: a[1].match(/path="([^"]+)"/)?.[1] } }); }
  for (const a of text.matchAll(/<team>([\s\S]*?)<\/team>/g)) out.push({ name: 'dispatch_team', args: { brief: a[1].trim() } });
  for (const a of text.matchAll(/<mcp\s+server="([^"]+)"\s+tool="([^"]+)"\s*>([\s\S]*?)<\/mcp>/g)) { let args: any = {}; try { args = JSON.parse((a[3] || '').trim() || '{}'); } catch { /* */ } out.push({ name: `mcp__${a[1]}__${a[2]}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60), args }); }
  return out;
}

// 🛠️ 도구 쓰는 에이전트 — 네이티브 tool_calls 우선, 미지원/텍스트 모델은 태그 파싱. 실행기는 하나(레지스트리).
export async function agentWithTools(history: ChatTurn[], userText: string, opts: RunOpts, onEvent: (e: EngineEvent) => void): Promise<string> {
  const company = opts.company || '1인 기업';
  const name = opts.agentName || '에이전트';
  const title = opts.userTitle || '사장님';
  const workspace = opts.workspace || os.homedir();
  const target = await detectTarget(opts.target);
  if (!target) { noEngine(onEvent); return ''; }
  let ragBlock = '';
  try {
    const qEmb = await embed(target.base, userText);
    const notes = brainSearch(userText, 4, qEmb || undefined);
    if (notes.length) ragBlock = `\n\n## 내 두뇌 (기억한 지식 — 답변에 적극 활용)\n` + notes.map(n => `- ${n.text}`).join('\n');
  } catch { /* */ }
  const reg = await buildRegistry(opts, workspace, target, onEvent);
  const schemas: ToolSchema[] = reg.map(e => ({ type: 'function', function: { name: e.name, description: e.description, parameters: e.parameters } }));
  const sys = agentPrompt(name, company, title) + (opts.servicesInfo || '') + ragBlock + nativeGuide(workspace);
  const imgs = opts.attachImages || [];
  const lastUser: ChatMessage = imgs.length
    ? { role: 'user', content: [{ type: 'text', text: userText || '이 이미지를 보고 도와줘.' }, ...imgs.map(u => ({ type: 'image_url', image_url: { url: u } }))] }
    : { role: 'user', content: userText };
  const messages: ChatMessage[] = [{ role: 'system', content: sys }, ...history.map(h => ({ role: h.role, content: h.content } as ChatMessage)), lastUser];
  let finalText = '';
  for (let iter = 0; iter < 8; iter++) {
    if (aborted(opts)) { onEvent({ kind: 'final', text: '⏹️ 중단했어요.' }); return ''; }
    onEvent({ kind: 'status', text: iter === 0 ? `${name} 생각 중…` : `${name}가 이어서 작업 중…` });
    let res: { content: string; toolCalls: ToolUse[]; message: any };
    try { res = await completeWithTools(target, messages, schemas, { temperature: 0.4, signal: opts.signal }); }
    catch (e: any) { onEvent({ kind: 'final', text: aborted(opts) ? '⏹️ 중단했어요.' : `잠시 문제가 생겼어요. (${e?.message || e})` }); return finalText; }
    if (aborted(opts)) { onEvent({ kind: 'final', text: '⏹️ 중단했어요.' }); return ''; }

    // 🎯 도구 호출 수집 — 네이티브 tool_calls 우선, 없으면 텍스트 태그(약한/커스텀 모델) 파싱. 실행기는 레지스트리 하나로 통일.
    const native = res.toolCalls.length > 0;
    const invocations = native ? res.toolCalls : parseTextTools(res.content || '').map((c, i) => ({ id: `t${iter}_${i}`, name: c.name, args: c.args }));
    if (!invocations.length) { finalText = stripTools(res.content || '').trim() || '(완료)'; onEvent({ kind: 'final', text: finalText }); return finalText; }

    messages.push(native ? res.message : { role: 'assistant', content: res.content || '' });
    const results: string[] = [];
    const pendingImages: string[] = [];
    for (const inv of invocations) {
      const entry = reg.find(e => e.name === inv.name);
      onEvent({ kind: 'status', text: `🔧 ${entry?.event || inv.name}` });
      let out: { text: string; ok?: boolean; path?: string; image?: string };
      if (!entry) out = { text: `알 수 없는 도구: ${inv.name}`, ok: false };
      else { try { out = await entry.run(inv.args || {}); } catch (e: any) { out = { text: `오류: ${e?.message || e}`, ok: false }; } }
      if (out.image) pendingImages.push(out.image);
      onEvent({ kind: 'tool', name: entry?.event || inv.name, path: (out.path || '').slice(0, 40), ok: out.ok !== false });
      if (native) messages.push({ role: 'tool', tool_call_id: (inv as ToolUse).id, content: out.text || '(완료)' });
      else results.push(`[${entry?.event || inv.name}] ${out.text || '(완료)'}`);
    }
    if (!native && results.length) messages.push({ role: 'user', content: `결과:\n${results.join('\n\n')}\n\n이 결과로 이어서 진행하거나, 다 됐으면 도구 없이 한국어로 보고해라.` });
    if (pendingImages.length) messages.push({ role: 'user', content: [{ type: 'text', text: '방금 캡처한 화면입니다. 보고 분석해 주세요.' }, ...pendingImages.map(u => ({ type: 'image_url', image_url: { url: u } }))] });
  }
  finalText = '작업이 좀 길어졌어요. 더 구체적으로 말씀해 주시면 이어갈게요.';
  onEvent({ kind: 'final', text: finalText });
  return finalText;
}


const firstJson = (s: string) => { const m = s.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const noEngine = (onEvent: (e: EngineEvent) => void) =>
  onEvent({ kind: 'error', text: 'AI 엔진(LM Studio 또는 Ollama)을 찾지 못했어요. 사장님, 모델을 먼저 켜주세요.' });

// 🔌 연결된 MCP 서버 도구를 프롬프트용 텍스트로
async function buildMcpBlock(): Promise<string> {
  try {
    const mt = await listMcpTools();
    if (!mt.length) return '';
    return `\n\n## 🔌 MCP 외부 도구 (필요하면 아래 태그로 호출 — 디자인은 Stitch 등)\n`
      + mt.map(t => `- ${t.server}.${t.name}: ${(t.description || '').slice(0, 120)}`).join('\n')
      + `\n호출법: <mcp server="서버명" tool="도구명">{"인자":"값"}</mcp>  (인자는 JSON 객체).`;
  } catch { return ''; }
}
const MCP_RE = /<mcp\s+server="([^"]+)"\s+tool="([^"]+)"\s*>([\s\S]*?)<\/mcp>/g;

// 🌐 웹 도구 실행 (검색·페이지 읽기) — 텍스트에서 태그 찾아 실행하고 결과 반환
async function execWebTools(text: string, onEvent: (e: EngineEvent) => void): Promise<{ results: string[]; count: number }> {
  const results: string[] = [];
  for (const m of text.matchAll(/<web_search>([\s\S]*?)<\/web_search>/g)) {
    const q = m[1].trim(); if (!q) continue;
    onEvent({ kind: 'status', text: `🌐 웹 검색 · ${q.slice(0, 30)}` });
    const out = await webSearch(q);
    onEvent({ kind: 'tool', name: 'web_search', path: q.slice(0, 40), ok: !out.startsWith('(') });
    results.push(`[웹 검색: ${q}]\n${out}`);
  }
  for (const m of text.matchAll(/<fetch_url>([\s\S]*?)<\/fetch_url>/g)) {
    const u = m[1].trim(); if (!u) continue;
    onEvent({ kind: 'status', text: `🌐 페이지 읽기 · ${u.slice(0, 30)}` });
    const out = await fetchUrl(u);
    onEvent({ kind: 'tool', name: 'fetch_url', path: u.slice(0, 40), ok: !out.startsWith('(') });
    results.push(`[페이지: ${u}]\n${out}`);
  }
  return { results, count: results.length };
}

// 🧑‍🔧 specialist 도구 루프 — 동료(디자이너 등)가 직접 MCP·파일·실행 도구를 쓰며 일한다
async function runSpecialist(target: LlmTarget, id: string, company: string, brief: string, rt: string, workspace: string, mcpBlock: string, onEvent: (e: EngineEvent) => void, signal?: AbortSignal, title = '사장님'): Promise<string> {
  const sys = specialistPrompt(id, company, title) + mcpBlock + toolGuide(workspace);
  const messages: ChatMessage[] = [
    { role: 'system', content: sys },
    { role: 'user', content: `[요청]\n${brief}\n\n당신의 전문성으로 처리하세요. 도구가 필요하면 쓰고(특히 디자인은 MCP 도구), 다 되면 결과를 보고하세요.` + (rt ? `\n\n${rt}\n⚠️ 위 실데이터만 근거로, 숫자를 지어내지 마세요.` : '') },
  ];
  let finalText = '';
  for (let iter = 0; iter < 3; iter++) {
    if (signal?.aborted) break;
    let raw = '';
    try { raw = await completeMessages(target, messages, { temperature: 0.6, signal, onToken: (t) => onEvent({ kind: 'agentChunk', id, text: t }) }); } catch { break; }
    let cleaned = raw;
    const mcpCalls = [...cleaned.matchAll(MCP_RE)].map(m => ({ server: m[1], tool: m[2], args: m[3].trim() }));
    const hasWeb = /<web_search>|<fetch_url>/.test(cleaned);
    cleaned = cleaned.replace(/<mcp\s+[^>]*>[\s\S]*?<\/mcp>/g, '');
    const calls = parseTools(cleaned);
    finalText = stripTools(cleaned).trim();
    if (!mcpCalls.length && !calls.length && !hasWeb) break;
    messages.push({ role: 'assistant', content: raw });
    const results: string[] = [];
    if (hasWeb) { const web = await execWebTools(raw, onEvent); results.push(...web.results); }
    for (const mc of mcpCalls) {
      onEvent({ kind: 'status', text: `🔌 ${AGENTS[id].name} · ${mc.server}.${mc.tool}` });
      let args: any = {}; try { args = mc.args ? JSON.parse(mc.args) : {}; } catch { /* */ }
      const out = await callMcpTool(mc.server, mc.tool, args);
      onEvent({ kind: 'tool', name: 'mcp', path: `${mc.server}.${mc.tool}`, ok: !out.startsWith('(MCP') });
      results.push(`[MCP ${mc.server}.${mc.tool}]\n${out}`);
    }
    for (const c of calls) {
      const r = runTool(c, workspace);
      onEvent({ kind: 'tool', name: c.tool, path: c.path, ok: r.ok });
      results.push(`[${c.tool} ${c.path}] ${r.ok ? '' : '(실패)'}\n${r.output}`);
    }
    messages.push({ role: 'user', content: `결과:\n${results.join('\n\n')}\n\n이어서 진행하거나 다 됐으면 보고하세요(도구 태그 없이).` });
  }
  return finalText || '(완료)';
}

// 팀 소집 — 브리프를 전문 동료들에게 분배·작업시키고(실시간 스트리밍) → 짧은 팀 회의 → 결과 종합 반환
async function dispatchTeam(target: LlmTarget, brief: string, name: string, company: string, onEvent: (e: EngineEvent) => void, signal?: AbortSignal, realtimeFor?: (id: string) => Promise<string>, workspace = '', title = '사장님', agentModels: Record<string, string> = {}): Promise<string> {
  let plan: any = null;
  try { const raw = await chat(target, triagePrompt(name, company, title), `요청: ${brief}`, { temperature: 0.2, signal }); plan = firstJson(raw); } catch { /* */ }
  if (signal?.aborted) return '(중단됨)';
  let agents: string[] = (plan?.agents || []).filter((id: string) => SPECIALIST_IDS.includes(id)).slice(0, 3);
  if (!agents.length) agents = ['developer'];
  const mcpBlock = await buildMcpBlock();   // 동료들도 MCP(Stitch 등) 도구를 쓴다
  // 🎬 팀 소집 — 시네마틱 진입(배너 + 책상 thinking + CEO 지휘)
  onEvent({ kind: 'dispatch', agents: agents.map(id => ({ id, name: AGENTS[id].name, emoji: AGENTS[id].emoji })) });
  await sleep(2000);   // 소집 연출(모임→자리 복귀)이 보이도록 텀
  const outputs: Record<string, string> = {};
  for (const id of agents) {
    if (signal?.aborted) break;
    const a = AGENTS[id]; onEvent({ kind: 'agentStart', id, name: a.name, emoji: a.emoji });
    try {
      // 🤝 실데이터 주입(유튜브·매출) + 🧑‍🔧 도구 루프(MCP·파일·실행) — 동료가 직접 도구를 쓴다
      const rt = realtimeFor ? await realtimeFor(id).catch(() => '') : '';
      // 🤖 이 에이전트 전용 모델이 지정돼 있으면 그 모델로 (예: 마케팅튜닝→비즈니스, 디자인튜닝→디자이너)
      const spTarget = agentModels[id] ? { ...target, model: agentModels[id] } : target;
      if (agentModels[id]) onEvent({ kind: 'status', text: `${a.emoji} ${a.name} · 전용 모델(${agentModels[id]})` });
      const out = await runSpecialist(spTarget, id, company, brief, rt, workspace, mcpBlock, onEvent, signal, title);
      outputs[id] = out; onEvent({ kind: 'agentDone', id, output: out });
    } catch (e: any) { outputs[id] = `(${a.name} 실패: ${e?.message || e})`; onEvent({ kind: 'agentDone', id, output: outputs[id] }); }
  }
  // 🗣️ 팀 회의 — 2명 이상이면 서로 한마디씩 (동의·보완·제안)
  const present = agents.filter(id => outputs[id] && !outputs[id].startsWith('('));
  if (present.length >= 2 && !signal?.aborted) { onEvent({ kind: 'status', text: '🗣️ 팀 회의 중…' }); await conferRound(target, present, brief, outputs, company, onEvent, signal); }
  return agents.map(id => `## ${AGENTS[id].name}\n${(outputs[id] || '').slice(0, 1200)}`).join('\n\n');
}

// 짧은 팀 회의 한 바퀴 — 각자 다음 동료에게 한 문장씩. 에이전트끼리 대화하는 느낌(Layer 1).
async function conferRound(target: LlmTarget, present: string[], brief: string, outputs: Record<string, string>, company: string, onEvent: (e: EngineEvent) => void, signal?: AbortSignal): Promise<void> {
  const transcript: string[] = [];
  const summary = present.map(id => `- ${AGENTS[id].name}: ${(outputs[id] || '').replace(/\s+/g, ' ').slice(0, 140)}`).join('\n');
  for (let i = 0; i < present.length; i++) {
    if (signal?.aborted) return;
    const from = present[i], to = present[(i + 1) % present.length];
    const fromA = AGENTS[from], toA = AGENTS[to];
    const user = `[회의 주제]\n${brief}\n\n[동료들 결과 요약]\n${summary}` +
      (transcript.length ? `\n\n[방금 오간 말]\n${transcript.join('\n')}` : '') +
      `\n\n너는 ${fromA.name}. ${toA.name}에게 회의에서 한마디 해줘 — 동의·보완·제안 중 하나. 한 문장, 50자 이내. 이름표·인사 없이 내용만.`;
    let line = '';
    try { line = (await chat(target, specialistPrompt(from, company), user, { temperature: 0.75, signal })).split('\n').map(s => s.trim()).filter(Boolean)[0] || ''; } catch { /* */ }
    line = line.replace(/^["'`\-•\s]+/, '').replace(/^.*?[:：]\s*/, '').slice(0, 80).trim();
    if (!line) continue;
    transcript.push(`${fromA.name}→${toA.name}: ${line}`);
    onEvent({ kind: 'agentConfer', from, fromName: fromA.name, to, toName: toA.name, text: line });
  }
}

// ── 도구 끔(설정) 시 폴백: 단일 에이전트와 1:1 대화 + 멀티턴 기억 ──────────────
export async function talkToMyAgent(history: ChatTurn[], userText: string, opts: RunOpts, onEvent: (e: EngineEvent) => void): Promise<string> {
  const company = opts.company || '1인 기업';
  const name = opts.agentName || '에이전트';
  const title = opts.userTitle || '사장님';
  const target = await detectTarget(opts.target);
  if (!target) { noEngine(onEvent); return ''; }
  onEvent({ kind: 'status', text: `${name} 생각 중…` });
  const messages: ChatMessage[] = [
    { role: 'system', content: agentPrompt(name, company, title) + (opts.servicesInfo || '') },
    ...history.map(h => ({ role: h.role, content: h.content } as ChatMessage)),
    { role: 'user', content: userText },
  ];
  let acc = '';
  try {
    acc = await completeMessages(target, messages, { temperature: 0.6, signal: opts.signal, onToken: (t) => onEvent({ kind: 'token', text: t }) });
  } catch (e: any) { acc = aborted(opts) ? '⏹️ 중단했어요.' : `사장님, 잠시 문제가 생겼어요. (${e?.message || e})`; }
  acc = acc.trim();
  onEvent({ kind: 'final', text: acc });
  return acc;
}
