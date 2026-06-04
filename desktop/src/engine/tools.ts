// 🛠️ 에이전트 도구 — 파일 읽기/목록/쓰기 + 명령 실행(코딩). 진짜 "행동하는" 에이전트의 핵심.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

export interface ToolCall { tool: 'list_dir' | 'read_file' | 'write_file' | 'run_command' | 'find'; path: string; content?: string; }
export interface ToolResult { tool: string; path: string; output: string; ok: boolean; }

// ~ 확장 + 절대경로화. workspace 기준 상대경로도 허용.
function resolvePath(p: string, workspace: string): string {
  p = (p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
  if (!path.isAbsolute(p)) p = path.join(workspace || os.homedir(), p);
  return path.resolve(p);
}

// 에이전트 응답에서 도구 호출 태그 추출
export function parseTools(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  let m: RegExpExecArray | null;
  const reList = /<list_dir>([\s\S]*?)<\/list_dir>/g;
  while ((m = reList.exec(text))) calls.push({ tool: 'list_dir', path: m[1].trim() });
  const reRead = /<read_file>([\s\S]*?)<\/read_file>/g;
  while ((m = reRead.exec(text))) calls.push({ tool: 'read_file', path: m[1].trim() });
  const reWrite = /<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g;
  while ((m = reWrite.exec(text))) calls.push({ tool: 'write_file', path: m[1].trim(), content: m[2] });
  // 일부 모델은 path 속성 대신 첫 줄에 경로를 쓴다: <write_file>\n경로\n내용...</write_file>
  const reWrite2 = /<write_file>\s*\n?\s*([^\n<]+?)\s*\n([\s\S]*?)<\/write_file>/g;
  while ((m = reWrite2.exec(text))) calls.push({ tool: 'write_file', path: m[1].trim(), content: m[2].replace(/\n$/, '') });
  const reRun = /<run>([\s\S]*?)<\/run>/g;
  while ((m = reRun.exec(text))) calls.push({ tool: 'run_command', path: m[1].trim() });
  const reFind = /<find>([\s\S]*?)<\/find>/g;
  while ((m = reFind.exec(text))) calls.push({ tool: 'find', path: m[1].trim() });
  return calls;
}
export const stripTools = (text: string) =>
  text.replace(/<list_dir>[\s\S]*?<\/list_dir>/g, '').replace(/<read_file>[\s\S]*?<\/read_file>/g, '')
      .replace(/<write_file[\s\S]*?<\/write_file>/g, '').replace(/<run>[\s\S]*?<\/run>/g, '').replace(/<find>[\s\S]*?<\/find>/g, '')
      .replace(/<team>[\s\S]*?<\/team>/g, '').replace(/<task>[\s\S]*?<\/task>/g, '').replace(/<approve[^>]*>[\s\S]*?<\/approve>/g, '')
      .replace(/<web_search>[\s\S]*?<\/web_search>/g, '').replace(/<fetch_url>[\s\S]*?<\/fetch_url>/g, '').replace(/<\/?revenue\s*\/?>/g, '').replace(/<\/?screenshot\s*\/?>/g, '').replace(/<\/?clipboard\s*\/?>/g, '').replace(/<open>[\s\S]*?<\/open>/g, '').replace(/<serve(?:_server)?>[\s\S]*?<\/serve(?:_server)?>/g, '').replace(/\[END_TOOL_REQUEST\]/g, '').trim();

// 🔎 이름으로 파일 검색 — 바탕화면·문서·다운로드·동영상·음악·사진(+작업폴더) 재귀(깊이4).
function findFiles(query: string, workspace: string): ToolResult {
  const wrap = (output: string, ok = true): ToolResult => ({ tool: 'find', path: query, output, ok });
  // 와일드카드(*?[]) 등 제거 → 단어들로 분해. 모든 단어가 파일명에 들어가면 매칭(순서·간격 무관).
  const tokens = (query || '').toLowerCase().replace(/[*?\[\]{}()'"]/g, ' ').split(/\s+/).map(t => t.trim()).filter(t => t && t.length >= 1);
  // 너무 흔한 단어(영상/파일/음성 같은 일반어)는 빼고 핵심만; 다 빠지면 원복
  const stop = new Set(['영상', '파일', '음성', '비디오', '동영상', 'video', 'file', 'mp4', 'intro', '인트로']);
  let core = tokens.filter(t => !stop.has(t));
  if (!core.length) core = tokens;
  if (!core.length) return wrap('검색어가 없어요.', false);
  const roots = ['Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures']
    .map(d => path.join(os.homedir(), d)).filter(p => { try { return fs.existsSync(p); } catch { return false; } });
  try { if (workspace && fs.existsSync(workspace) && !roots.includes(workspace)) roots.unshift(workspace); } catch { /* */ }
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || out.length >= 60) return;
    let items: fs.Dirent[]; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (out.length >= 60) return;
      if (it.name.startsWith('.')) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) { if (/^(node_modules|Library|\.git|venv|__pycache__|\$RECYCLE)/i.test(it.name)) continue; walk(full, depth + 1); }
      else { const n = it.name.toLowerCase(); if (core.every(t => n.includes(t))) out.push(full); }
    }
  };
  for (const r of roots) walk(r, 0);
  return wrap(out.length ? `${out.length}개 찾음:\n${out.join('\n')}` : `'${query}' 와(과) 관련된 파일을 못 찾았어요. (검색 위치: 바탕화면·문서·다운로드·동영상·음악·사진)`);
}

export function runTool(call: ToolCall, workspace: string): ToolResult {
  const wrap = (output: string, ok = true): ToolResult => ({ tool: call.tool, path: call.path, output, ok });
  if (call.tool === 'find') return findFiles(call.path, workspace);
  try {
    const target = resolvePath(call.path, workspace);
    if (call.tool === 'list_dir') {
      const items = fs.readdirSync(target, { withFileTypes: true });
      const out = items.slice(0, 200).map(d => (d.isDirectory() ? '📁 ' : '📄 ') + d.name).join('\n');
      return wrap(out || '(빈 폴더)');
    }
    if (call.tool === 'read_file') {
      const st = fs.statSync(target);
      // 바이너리(영상·이미지·음악·PDF 등)는 텍스트로 못 읽음 → 규칙 대신 결과로 안내(자가교정)
      if (/\.(mp4|mov|avi|mkv|webm|mp3|wav|m4a|flac|aac|png|jpe?g|gif|webp|heic|bmp|pdf|zip|dmg|exe|psd|ai|sketch)$/i.test(target))
        return wrap(`이건 ${path.extname(target).slice(1).toUpperCase()} 파일이라 텍스트로 못 읽어요. 재생/열기는 <open>${target}</open> 를 쓰세요. (못 본 내용을 지어내지 마세요)`, false);
      if (st.size > 300_000) return wrap(`(파일이 너무 큼: ${Math.round(st.size / 1024)}KB — 일부만 읽으세요)`, false);
      return wrap(fs.readFileSync(target, 'utf8').slice(0, 14000));
    }
    if (call.tool === 'write_file') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, call.content ?? '', 'utf8');
      return wrap(`저장됨 → ${target}`);
    }
    if (call.tool === 'run_command') {
      const cwd = resolvePath('.', workspace);
      const r = spawnSync(call.path, { cwd, shell: true, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      const out = [(r.stdout || '').trim(), (r.stderr || '').trim()].filter(Boolean).join('\n').slice(0, 8000);
      const ok = r.status === 0;
      return wrap(`${out || '(출력 없음)'}\n[종료 코드 ${r.status ?? '?'}]`, ok);
    }
    return wrap('알 수 없는 도구', false);
  } catch (e: any) { return wrap(`오류: ${e?.message || e}`, false); }
}

// 에이전트 시스템 프롬프트에 들어갈 도구 설명
export function toolGuide(workspace: string): string {
  return [
    `\n## 사용 가능한 도구 (필요하면 답변 안에 아래 태그를 써라. 그러면 시스템이 실행하고 결과를 준다)`,
    `- 폴더 목록: <list_dir>경로</list_dir>`,
    `- 파일 찾기(이름으로 내 컴퓨터 검색 — 바탕화면·문서·다운로드·동영상·음악·사진): <find>파일 이름 일부</find>`,
    `- 파일 읽기(텍스트/코드만, 정확한 경로 하나): <read_file>경로</read_file>`,
    `- 🚀 파일/앱/주소 열기·실행·재생 (영상·이미지·음악·문서·웹은 이걸로!): <open>경로 또는 URL</open>`,
    `- 파일 쓰기/생성: <write_file path="경로">내용</write_file>`,
    `- 명령 실행(코딩·자동화 — 금방 끝나는 것): <run>명령어</run>`,
    `- 🖥️ 개발 서버·로컬호스트 띄우기 (npm run dev·vite·next·flask·http.server 등 계속 떠있는 것): <serve>명령어</serve> → 백그라운드로 실행하고 브라우저를 자동으로 연다`,
    `- 웹 검색(최신 정보·리서치): <web_search>검색어</web_search>`,
    `- 웹페이지 읽기: <fetch_url>https://주소</fetch_url>`,
    `- 💰 내 매출/수익 확인 (PayPal 실데이터 — 파일 찾지 말고 반드시 이 도구!): <revenue></revenue>`,
    `- 👁️ 내 화면 보기 (사장님 화면을 실제로 캡처해서 본다 — "화면 봐줘/이거 뭐야/이 에러"): <screenshot></screenshot>`,
    `- 📋 클립보드 읽기 (사장님이 방금 복사한 것): <clipboard></clipboard>`,
    `- 기억하기(두뇌에 영구 저장): <remember>저장할 지식 한 줄</remember>`,
    `- 할 일 등록(태스크 보드에 쌓임): <task>해야 할 일 한 줄</task>`,
    `- 승인 요청(중요한 행동 전 사장님 결재): <approve>무엇을 할지 | 왜/상세</approve>`,
    `- 승인 후 자동 실행(사장님이 ✓ 누르면 그때 실행됨 — 돈 쓰기·발행·배포처럼 되돌리기 어려운 건 직접 말고 이걸로):`,
    `   · 명령 실행: <approve do="run">설명 | 실행할 명령어</approve>`,
    `   · 파일 생성: <approve do="write" path="경로">설명 | 파일 내용</approve>`,
    `   · 텔레그램 발송: <approve do="telegram">설명 | 보낼 메시지</approve>`,
    `   · 이메일 발송: <approve do="email">설명 | 받는사람@메일 | 제목 | 본문</approve>`,
    `- 팀에 위임(혼자 벅찬 멀티 도메인 프로젝트): <team>동료들에게 시킬 브리프</team>`,
    `규칙:`,
    `- 간단한 질문·파일·코딩은 네가 직접. 콘텐츠 기획+디자인+개발을 한꺼번에 하는 큰 프로젝트면 <team>으로 전문 동료(유튜브·디자이너·개발자 등)에게 위임하고 결과를 종합 보고해라.`,
    `- 경로는 절대경로(~ 가능) 또는 작업폴더 기준 상대경로. 작업폴더 = ${workspace}`,
    `- 파일을 "찾아줘/검색해줘" 하면 read_file 에 와일드카드(*)나 추측 경로를 넣지 말고 반드시 <find>이름</find> 으로 검색해라. read_file 은 정확한 경로 하나만 읽는다.`,
    `- 사용자의 파일/폴더가 궁금하면 추측하지 말고 find·list_dir·read_file 로 실제로 확인해라. 존재하지 않는 파일명을 지어내지 마라.`,
    `- 💰 "매출/수익/돈 얼마" 물으면 절대 파일(csv 등)을 찾지 말고 <revenue> 도구를 써라. 등록된 내 서비스/웹사이트는 servicesInfo 또는 fetch_url 로 확인해라.`,
    `- 🚀 "실행해/열어/틀어/재생해" 하면 <open>경로</open> 로 열어라. 영상(mp4·mov)·이미지(png·jpg)·음악(mp3)·PDF는 절대 read_file 하지 마라(바이너리라 못 읽는다). 못 본 영상/파일 내용을 지어내지 마라.`,
    `- ⛔ "지금 만들겠습니다/잠시만 기다려주세요" 같은 예고만 하고 끝내는 것 금지. "만들어줘"라고 하면 그 답변 안에서 즉시 <write_file> 로 실제 파일을 만들어라(텍스트 설명만 X).`,
    `- 웹사이트/앱을 만들면: <write_file> 로 index.html 등을 만들고 → 바로 <serve>python3 -m http.server 8000</serve> (또는 npm 프로젝트면 <run>npm install</run> 후 <serve>npm run dev</serve>) 로 띄워서 브라우저로 보여줘라. 한 답변 안에서 만들고 실행까지.`,
    `- 코딩: write_file 로 코드 파일을 만들고 <run> 으로 실행·테스트·패키지 설치·git 까지 직접 해라. (예: <run>python3 app.py</run>, <run>npm install</run>)`,
    `- 🖥️ 웹사이트·앱을 만들어 "실행/미리보기" 해달라면: 파일 만들고 → 설치는 <run>npm install</run> → 서버는 <serve>npm run dev</serve> 로 띄워라. <run> 으로 서버 띄우면 멈추니 반드시 <serve> 를 써라.`,
    `- 명령은 작업폴더에서 실행됨. 위험한 명령(rm -rf, 시스템 변경 등)은 하지 마라.`,
    `- 도구를 쓴 턴에는 결과를 받은 뒤 다음 턴에서 사용자에게 자연스럽게 보고해라.`,
  ].join('\n');
}
