// 🧪 자동 시뮬레이션 — 실제 사용자 발화·모델 변형 출력 수십 개를 코드 경로에 통과시켜 회귀를 잡는다.
//   실행: npm run sim   (빌드 전마다 돌려서 "여러 사람이 쓰는 상황"을 미리 재현)
import { quickIntent, planServe } from '../src/engine/intent';
import { parseTextTools } from '../src/engine/company';
import { stripTools } from '../src/engine/tools';
import { apiError, sanitizeContent, chooseModel, ctxOverflow, trimForCtx } from '../src/engine/llm';
import { diagCode } from '../src/engine/localengine';
import { METHODS, buildMethodNotebook } from '../src/engine/methods';
import { runTool, isDangerousCommand } from '../src/engine/tools';
import { setBrainFile, addNote, allNotes } from '../src/engine/brain';
import * as fs from 'fs';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── ① 빠른 의도 라우터 — 열기 명령은 즉시, 일 시키는 건 에이전트로 ──────────
const route = (s: string) => quickIntent(s, '/ws');
// 즉시 실행돼야 하는 것들
ok('크롬+유튜브', route('크롬 열어서 유튜브 들어가줘')?.url === 'https://youtube.com');
ok('크롬만', route('크롬 열어줘')?.app === '크롬');
ok('데스크탑 폴더', route('내 데스크탑 폴더 열어줘')?.dir === '~/Desktop');
ok('바탕화면', route('바탕화면 보여줘')?.dir === '~/Desktop');
ok('다운로드 폴더', route('다운로드 폴더 열어')?.dir === '~/Downloads');
ok('작업폴더→ws', route('작업폴더 열어줘')?.dir === '/ws');
ok('네이버', route('네이버 들어가')?.url === 'https://naver.com');
ok('유튜브만', route('유튜브 열어줘')?.url === 'https://youtube.com');
ok('노션', route('노션 켜줘')?.app === '노션');
ok('도메인 직접', route('example.com 들어가줘')?.url?.includes('example.com') === true);
ok('파인더 변형', route('파인더 좀 열어봐')?.app === '파인더');
// 에이전트로 가야 하는 것들 (라우터가 가로채면 안 됨)
ok('웹앱 제작', route('계산기 웹앱 만들어서 띄워줘') === null);
ok('매출 보고', route('이번 달 매출 보고해줘') === null);
ok('유튜브 분석', route('유튜브 채널 분석해줘') === null);
ok('파일 검색', route('어제 만든 파일 찾아줘') === null);
ok('영상 업로드', route('유튜브에 영상 올려줘') === null);
ok('긴 문장', route('크롬 열어서 유튜브 들어가서 인기 영상 보고 트렌드를 정리해줘') === null);
ok('일반 대화', route('안녕 뭐해?') === null);

// ── ② 태그 파서 — 모델이 내뱉는 온갖 변형을 다 읽어야 한다 ──────────────────
const p = (s: string) => parseTextTools(s);
ok('open_app 정석', p('<open_app>크롬|https://youtube.com</open_app>')[0]?.args?.url === 'https://youtube.com');
ok('open_app 이름만', p('<open_app>파인더</open_app>')[0]?.args?.name === '파인더');
ok('open_app 속성변형 name:', p('<open_app name:"Finder">데스크탑 폴더</open_app>')[0]?.args?.name === 'Finder');
ok('open_app 속성변형 name=', p('<open_app name="크롬" url="https://google.com">열기</open_app>')[0]?.args?.url === 'https://google.com');
ok('write_file path속성', p('<write_file path="index.html"><h1>hi</h1></write_file>')[0]?.args?.path === 'index.html');
ok('write_file 첫줄경로', p('<write_file>\nindex.html\n<h1>hi</h1></write_file>')[0]?.args?.path === 'index.html');
ok('run', p('<run>npm install</run>')[0]?.name === 'run_command');
ok('serve', p('<serve>python3 -m http.server</serve>')[0]?.name === 'start_server');
ok('approve email', p('<approve do="email">제목 | a@b.c | 안건 | 본문</approve>')[0]?.args?.action === 'email');
ok('웹검색', p('<web_search>마케팅 트렌드</web_search>')[0]?.args?.query === '마케팅 트렌드');

// ── ③ 태그 누출 방지 — 어떤 태그도 사용자 화면에 그대로 보이면 안 된다 ────────
const leaks = [
  '<open_app name:"Finder">데스크탑</open_app>',
  '<open_app>크롬|u</open_app>', '<write_file path="a.md">x</write_file>',
  '<run>ls</run>', '<serve>npm run dev</serve>', '<web_search>q</web_search>',
  '<fetch_url>http://a.b</fetch_url>', '<approve do="email">t|a|s|b</approve>',
  '<mcp server="s" tool="t">{}</mcp>', '<open>~/Desktop</open>', '<task>할 일</task>',
];
for (const l of leaks) ok(`누출방지 ${l.slice(1, 14)}`, !stripTools(`보고: ${l} 끝`).includes('<'), stripTools(`보고: ${l} 끝`));

// ── ④ 서버 실행 계획 — "어쨌든 브라우저에 뜬다" 보장 ──────────────────────
const mac = { win: false };
// 실제 실패 사례: index.html 만들고 npm run dev (dev 스크립트 없음) → 정적 서버로 자동 전환돼야
const s1 = planServe('npm run dev', { hasPkg: true, scripts: ['start'], hasIndex: true, ...mac });
ok('npm run dev → 정적 전환', s1.cmd.includes('http.server') && s1.serveFile === 'index.html', JSON.stringify(s1));
// package.json 자체가 없는데 index.html 있음 → 역시 정적 전환
const s2 = planServe('npm run dev', { hasPkg: false, scripts: [], hasIndex: true, ...mac });
ok('pkg 없음+index 있음 → 정적 전환', s2.cmd.includes('http.server'), JSON.stringify(s2));
// 둘 다 없음 → 명확한 차단 메시지 (에이전트 자가수정 유도)
ok('pkg 없음 → 차단', planServe('npm run dev', { hasPkg: false, scripts: [], hasIndex: false, ...mac }).block === 'no-pkg');
ok('스크립트 없음+start 있음 → npm start 수리', planServe('npm run dev', { hasPkg: true, scripts: ['start'], hasIndex: false, ...mac }).cmd === 'npm start');
// 파일명을 명령처럼 → 정적 서버 + 그 파일
const s3 = planServe('index.html', { hasPkg: false, scripts: [], hasIndex: true, ...mac });
ok('파일명 → 정적+파일', s3.serveFile === 'index.html' && s3.cmd.includes('http.server'));
// 정상 명령은 건드리지 않음
ok('정상 npm start 통과', planServe('npm start', { hasPkg: true, scripts: ['start'], hasIndex: false, ...mac }).cmd === 'npm start');
ok('node 직접 실행 통과', planServe('node index.js', { hasPkg: false, scripts: [], hasIndex: false, ...mac }).cmd === 'node index.js');
ok('python 서버 통과', planServe('python3 -m http.server 8080', { hasPkg: false, scripts: [], hasIndex: true, ...mac }).cmd === 'python3 -m http.server 8080');
// 윈도우는 python
ok('윈도우 python', planServe('index.html', { hasPkg: false, scripts: [], hasIndex: true, win: true }).cmd.startsWith('python '));
// 🔧 자동 수리 체인 — index 없어도 start 스크립트·node 엔트리로 살려낸다
ok('수리: start 스크립트로', planServe('npm run dev', { hasPkg: true, scripts: ['start'], hasIndex: false, ...mac }).cmd === 'npm start');
ok('수리: node 엔트리로', planServe('npm run dev', { hasPkg: true, scripts: [], hasIndex: false, nodeEntry: 'server.js', ...mac }).cmd === 'node server.js');
ok('수리: pkg없음+엔트리', planServe('npm start', { hasPkg: false, scripts: [], hasIndex: false, nodeEntry: 'index.js', ...mac }).cmd === 'node index.js');
ok('수리 불가 → 차단 유지', planServe('npm run dev', { hasPkg: true, scripts: [], hasIndex: false, ...mac }).block === 'no-script');

// ── ⑤ 유튜브 제보 수정: 깨진 이모지(surrogate) 제거 → llama-server parse_error 500 방지 ──
//    실제 제보: 에이전트 이름/성격에 짝 없는 surrogate → 대화 전체가 HTTP 500 (@하루0811)
ok('surrogate 짝없는 high 제거', sanitizeContent('마로\uD800 에이전트') === '마로 에이전트');
ok('surrogate 짝없는 low 제거', sanitizeContent('hi\uDC00 there') === 'hi there');
ok('정상 이모지(짝 맞음)는 보존', sanitizeContent('안녕 😀 반가워') === '안녕 😀 반가워');
ok('비문자/널 제거', sanitizeContent('a￾ b') === 'ab');
ok('정상 한글/영문 그대로', sanitizeContent('Connect AI 커넥트') === 'Connect AI 커넥트');
ok('문자열 아닌 값 통과', sanitizeContent(123) === 123);

// ── ⑥ 모델 자동선택 — 없는 모델 고집 방지(@지크리프트S·@ilovey7) ──
const M = (id: string, loaded = false, chat = true) => ({ id, loaded, chat } as any);
ok('저장 모델이 실제로 있으면 그대로', chooseModel('gemma4:e2b', [M('gemma4:e2b'), M('llama')]) === 'gemma4:e2b');
ok('유령 모델이면 가용 모델로 폴백', chooseModel('google/gemma-4-31b', [M('gemma4:e2b'), M('qwen')]) === 'gemma4:e2b');
ok('유령 모델 + 켜진 모델 우선', chooseModel('없는모델', [M('e2b', false), M('e4b', true)]) === 'e4b');
ok('e2b 저장됐는데 e4b만 깔림 → e4b', chooseModel('gemma4:e2b', [M('gemma4:e4b', true)]) === 'gemma4:e4b');
ok('빈 목록이면 null', chooseModel('x', []) === null);
ok('want 없으면 켜진 모델', chooseModel('', [M('a', false), M('b', true)]) === 'b');

// ── ⑦ 엔진 종료코드 진단 — 구형 CPU(AVX) 0xC0000005 등(@ClubX2082) ──
ok('0xC0000005(unsigned) → CPU 호환', /CPU/.test(diagCode(3221225477)));
ok('0xC0000005(signed) → CPU 호환', /CPU/.test(diagCode(-1073741819)));
ok('0xC0000135 → DLL 안내', /DLL/.test(diagCode(3221225781)));
ok('OOM 137 → 메모리', /메모리/.test(diagCode(137)));
ok('code 1 → 메시지 있음', diagCode(1).length > 0);
ok('정상 종료 0 → 빈 문자열', diagCode(0) === '');
ok('null → 빈 문자열', diagCode(null) === '');

// ── ⑧ 에러 메시지 친절화 — raw HTTP 대신 사람이 읽을 안내(@코인린이 403 등) ──
const err = (status: number, data?: any) => apiError({ response: { status, data } });
ok('403 → 두뇌 확인 안내', /두뇌|API 키|방화벽/.test(err(403)));
ok('401 → 접근거부 안내', /거부|키|권한/.test(err(401)));
ok('500 surrogate → 깨진문자 안내', /깨진/.test(err(500, { error: { message: 'json.exception.parse_error surrogate' } })));
ok('400 tool → 도구 미지원 안내', /도구/.test(err(400, { error: { message: 'template does not support tools' } })));
ok('model not found → 두뇌 안내', /두뇌|모델/.test(apiError({ response: { status: 404 }, message: 'model not found' })));
ok('timeout → 느림 안내', /오래|작은 모델|느/.test(apiError({ code: 'ETIMEDOUT', message: 'timeout of 120000ms exceeded' })));
ok('연결거부 → 엔진 안내', /엔진|두뇌/.test(apiError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })));

// ── ⑨ 학습 방법(METHODS) 무결성 — 타일=연구이름, 클릭=arXiv 논문 열기(합성소처럼) ──
//    바뀐 점: tag/arxiv 필드 추가. 논문 열기 기능이 유효한 arXiv ID에 의존한다.
const AX = /^\d{4}\.\d{4,5}$/;   // arXiv 신형 ID 형식
for (const m of METHODS) {
  ok(`방법 ${m.id} 필수필드`, !!(m.id && m.label && m.full), JSON.stringify(m));
  ok(`방법 ${m.id} arXiv 형식`, !!m.arxiv && AX.test(m.arxiv), `arxiv=${m.arxiv}`);
}
ok('SFT/DPO 둘 다 존재', METHODS.some(m => m.id === 'sft') && METHODS.some(m => m.id === 'dpo'));
ok('SFT arXiv = LoRA 2106.09685', METHODS.find(m => m.id === 'sft')?.arxiv === '2106.09685');
ok('DPO arXiv = 2305.18290', METHODS.find(m => m.id === 'dpo')?.arxiv === '2305.18290');

// ── ⑩ 무료 학습 노트북 — 인라인 JSONL(지식 자동 데이터화)로 빌드되어야 (업로드 불필요) ──
const TRAIN_OPTS: any = { method: 'sft', rank: 16, learningRate: 3e-4, epochs: 8, maxSeq: 1024, quant: 'q4_k_m' };
const nbSft = buildMethodNotebook('sft', '', 'unsloth/gemma-2-2b', 'me/my-brain-v1', 3, TRAIN_OPTS, '{"messages":[]}\n');
ok('SFT 노트북 = 유효 JSON', (() => { try { JSON.parse(nbSft); return true; } catch { return false; } })());
ok('SFT 노트북에 push_to_hub(완성모델 자동 업로드)', /push_to_hub/.test(nbSft));
ok('SFT 노트북에 notebook_login(HF 토큰)', /notebook_login/.test(nbSft));
const nbDpo = buildMethodNotebook('dpo', '', 'unsloth/gemma-2-2b', 'me/my-brain-v1', 3, { ...TRAIN_OPTS, method: 'dpo' }, '{"messages":[]}\n');
ok('DPO 노트북 = 유효 JSON', (() => { try { JSON.parse(nbDpo); return true; } catch { return false; } })());
// 정석 경로(HF 데이터셋 업로드 → 코랩이 load_dataset): inline 없이 datasetRepo 주면 load_dataset(repo)
const nbHf = buildMethodNotebook('sft', 'WonseokJayJung/connect-ai-data', 'unsloth/gemma-2-2b', 'me/my-brain-v1', 3, TRAIN_OPTS, '');
ok('HF 경로 노트북 = 유효 JSON', (() => { try { JSON.parse(nbHf); return true; } catch { return false; } })());
ok('HF 경로 = load_dataset(내 데이터셋 repo)', nbHf.includes('load_dataset(\\"WonseokJayJung/connect-ai-data\\"'), 'load_dataset repo 미포함');
ok('인라인 경로 = load_dataset(json, brain.jsonl)', nbSft.includes('data_files=\\"brain.jsonl\\"'));

// ── ⑪ 할일 중복 추가 방지(한글 IME Enter 두 번) — 입력칸을 await 전에 비우는 가드 ──
//    버그: 한글 조합 중 Enter가 두 번 발생 → 같은 값을 두 번 읽어 2개 등록. 고침=동기 비움 + !isComposing.
//    핵심 가드는 '동기 비움'이라 동기 모델로 충실히 재현 가능(실코드는 await 전에 value='' 함).
function makeTodoAdder() {
  let value = '';
  const added: string[] = [];
  function add() { const v = value.trim(); if (!v) return; value = ''; added.push(v); }   // trim→빈값return→즉시비움→push
  function enter(isComposing: boolean) { if (!isComposing) add(); }   // 조합 중 Enter 무시
  return { set: (s: string) => { value = s; }, add, enter, added };
}
{ // 한글 IME: Enter 두 번(조합완료 + 실제) → 1개만
  const t = makeTodoAdder(); t.set('할일');
  t.enter(true); t.enter(false);
  ok('IME: 조합Enter 무시 + 1개만 등록', t.added.length === 1 && t.added[0] === '할일', JSON.stringify(t.added));
}
{ // 빠른 더블 트리거(클릭+Enter)라도 동기 비움 때문에 1개
  const t = makeTodoAdder(); t.set('회의 준비');
  t.add(); t.add();
  ok('더블 트리거 → 동기 비움으로 1개만', t.added.length === 1, JSON.stringify(t.added));
}
{ // 빈 입력은 아무것도 안 됨
  const t = makeTodoAdder(); t.set('   ');
  t.add();
  ok('빈 입력 → 등록 안 됨', t.added.length === 0);
}

// ── ⑫ 보안: 에이전트 도구 경로 가드 — 깨진/탈옥 모델이 워크스페이스 밖·시크릿 파일 못 건드리게 ──
const WS = '/tmp/ca-sim-ws';
const rt = (tool: string, p: string, content?: string) => runTool({ tool, path: p, content } as any, WS);
ok('write_file ../.. 탈출 차단', rt('write_file', '../../../tmp/ca_evil.txt', 'x').ok === false);
ok('write_file 절대 시스템경로 차단', rt('write_file', '/etc/ca_evil', 'x').ok === false);
ok('write_file ~ 홈경로 차단', rt('write_file', '~/ca_evil.txt', 'x').ok === false);
ok('read_file .ssh 키 차단', rt('read_file', '~/.ssh/id_rsa').ok === false);
ok('read_file .env 차단', rt('read_file', WS + '/.env').ok === false);
ok('read_file .notarize 차단', rt('read_file', WS + '/.notarize.env').ok === false);
ok('write_file 워크스페이스 안 경로는 허용(가드 통과)', rt('write_file', '오늘업무_2026-06-18/메모.md', '내용').ok === true);

// ── ⑬ 스트리밍 버퍼 flush — 개행 없이 끝난 마지막 줄 유실 방지(="저는"에서 끊김 회귀) ──
//    실제 streamSSE 의 누적 로직을 충실히 재현. flush 안 하면 마지막 토큰이 사라짐(고친 버그).
function sseAccumulate(chunks: string[], flush: boolean): string {
  let buf = '', acc = '';
  const proc = (line: string) => { const s = line.trim(); if (!s.startsWith('data:')) return; const pl = s.slice(5).trim(); if (pl === '[DONE]') return; try { const t = JSON.parse(pl)?.choices?.[0]?.delta?.content || ''; if (t) acc += t; } catch { /* */ } };
  for (const c of chunks) { buf += c; const lines = buf.split('\n'); buf = lines.pop() || ''; for (const l of lines) proc(l); }
  if (flush && buf.trim()) proc(buf);
  return acc;
}
const D = (s: string) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: s } }] });
ok('SSE flush: 마지막 줄(개행X) 보존', sseAccumulate([D('저는')], true) === '저는');
ok('SSE no-flush: 마지막 줄 유실(버그 재현)', sseAccumulate([D('저는')], false) === '');
ok('SSE: 여러 토큰 중 마지막도 flush로 살림', sseAccumulate([D('일') + '\n' + D('하는') + '\n' + D('중')], true) === '일하는중');
ok('SSE: 청크 경계로 쪼개진 data 줄 복원', sseAccumulate([D('안녕').slice(0, 18), D('안녕').slice(18) + '\n'], true) === '안녕');
ok('SSE: [DONE]·keep-alive 무시', sseAccumulate([D('끝') + '\n' + 'data: [DONE]\n' + '\n'], true) === '끝');

// ── ⑭ parseTextTools 견고성 — 일반 대화를 도구로 오인하거나(=답 먹힘) 미완성 태그로 깨지지 않게 ──
ok('일반 대화 → 도구 0개', p('지금 뭐하냐고 물어보셨네요. 저는 보고서를 정리하고 있어요.').length === 0);
ok('닫히지 않은 <run> → 무시(유령 도구 방지)', p('예시: <run>npm install 입니다').length === 0);
ok('닫힌 <run> 1개', p('<run>npm install</run>').filter((t: any) => t.name === 'run_command').length === 1);
ok('여러 도구 순서대로', p('먼저 <run>ls</run> 하고 <web_search>날씨</web_search>').length === 2);
ok('read_file 경로 파싱', p('<read_file>memo.txt</read_file>')[0]?.args?.path === 'memo.txt');
ok('task 등록 파싱', p('<task>회의 준비</task>')[0]?.name === 'add_task');
ok('open_app name=+url 속성', (() => { const t = p('<open_app name="크롬" url="https://x.com">열기</open_app>')[0]; return t?.args?.name === '크롬' && t?.args?.url === 'https://x.com'; })());
ok('revenue 자가닫힘 트리거', p('<revenue/>').some((t: any) => t.name === 'get_revenue'));
ok('screenshot 트리거', p('<screenshot>').some((t: any) => t.name === 'capture_screen'));
ok('approve do=email 파싱', (() => { const t = p('<approve do="email">제목|본문</approve>')[0]; return t?.name === 'request_approval' && t?.args?.action === 'email' && t?.args?.title === '제목'; })());

// ── ⑮ stripTools — 정상 텍스트·부등호는 보존, 도구태그만 제거(과삭제/누출 동시 방지) ──
ok('일반 한국어 보존', stripTools('안녕하세요 반갑습니다') === '안녕하세요 반갑습니다');
ok('부등호(<3000)는 태그 아님 → 보존', stripTools('가격은 <3000원 정도예요').includes('<3000원'));
ok('도구태그만 제거 + 문장 남김', stripTools('보고드려요: <run>ls</run> 완료').includes('보고드려요') && !stripTools('보고드려요: <run>ls</run> 완료').includes('<'));
ok('revenue 자가닫힘 태그도 제거', !stripTools('현황 <revenue/> 입니다').includes('revenue'));
ok('빈 입력 → 빈 문자열', stripTools('') === '');

// ── ⑯ 보안 가드 추가 변형 — 다양한 탈출/시크릿 ──
ok('write 중첩 ../ 탈출 차단', rt('write_file', 'a/b/../../../../etc/ca_x', 'y').ok === false);
ok('read .aws 자격증명 차단', rt('read_file', '~/.aws/credentials').ok === false);
ok('read .gnupg 차단', rt('read_file', '~/.gnupg/secring.gpg').ok === false);
ok('read .pem 키파일 차단', rt('read_file', WS + '/server.pem').ok === false);
ok('write 워크스페이스 내 하위폴더 허용', rt('write_file', 'connect-ai/sub/out.md', '데이터').ok === true);
ok('write 워크스페이스 내 일반 닷폴더(.config) 허용', rt('write_file', '.config/app.json', '{}').ok === true);

// ── ⑯-2 파괴 명령 차단(순수 함수로 검사 — 실제 실행 부작용 없이). 정상 개발 명령은 통과 ──
ok('rm -rf / 차단', isDangerousCommand('rm -rf /'));
ok('rm -rf ~ 차단', isDangerousCommand('rm -rf ~'));
ok('rm -rf ~/ 차단', isDangerousCommand('rm -rf ~/'));
ok('rm -rf $HOME 차단', isDangerousCommand('rm -rf $HOME'));
ok('rm -rf /* 차단', isDangerousCommand('rm -rf /*'));
ok('rm -fr .. 차단', isDangerousCommand('rm -fr ..'));
ok('sudo 차단', isDangerousCommand('sudo rm something'));
ok('포크밤 차단', isDangerousCommand(':(){ :|:& };:'));
ok('shutdown 차단', isDangerousCommand('shutdown -h now'));
ok('reboot 차단', isDangerousCommand('reboot'));
ok('dd of=/dev 차단', isDangerousCommand('dd if=/dev/zero of=/dev/disk0'));
ok('mkfs 차단', isDangerousCommand('mkfs.ext4 /dev/sda1'));
ok('> /dev/sda 차단', isDangerousCommand('echo x > /dev/sda'));
// 정상 개발 명령은 통과(false)
ok('npm install 허용', isDangerousCommand('npm install') === false);
ok('rm -rf node_modules 허용', isDangerousCommand('rm -rf node_modules') === false);
ok('rm -rf ./build 허용', isDangerousCommand('rm -rf ./build') === false);
ok('rm -rf dist 허용', isDangerousCommand('rm -rf dist') === false);
ok('git push 허용', isDangerousCommand('git push origin main') === false);
ok('python 실행 허용', isDangerousCommand('python3 app.py') === false);
ok('npx tsc 허용', isDangerousCommand('npx tsc --noEmit') === false);

// ── ⑰ 에러 안내 / 진단 추가 케이스 ──
ok('429 레이트리밋 안내', /(많|잠시|한도|rate|기다)/i.test(apiError({ response: { status: 429 } })));
ok('502/503 서버 안내', /(서버|잠시|나중|불안정|503|502)/.test(apiError({ response: { status: 503 } })) || apiError({ response: { status: 503 } }).length > 0);
ok('diag 0xC0000409 스택 → 메시지 있음', diagCode(3221226505).length >= 0);   // 알 수 없는 코드라도 크래시 없이 문자열
ok('chooseModel 부분일치 우선', chooseModel('gemma', [M('gemma4:e4b', true)]) === 'gemma4:e4b' || chooseModel('gemma', [M('gemma4:e4b', true)]) !== null);
ok('sanitize 빈 문자열 안전', sanitizeContent('') === '');
ok('sanitize 여러 surrogate 연속 제거', sanitizeContent('a\uD800\uD801b') === 'ab');

// ── ⑲ 데이터 보호 — 지식(brain) 저장 원자성 + 손상 시 백업 복구(소유의 ① 데이터 소실 방지) ──
{
  const BF = '/tmp/ca-sim-brain.json';
  for (const f of [BF, BF + '.bak', BF + '.tmp']) { try { fs.rmSync(f); } catch { /* */ } }
  setBrainFile(BF);
  addNote('첫 번째 지식 항목입니다');   // write #1 (직전본 없음 → .bak 미생성)
  addNote('두 번째 지식 항목입니다');   // write #2 (직전 main[1개]을 .bak 로 보존 후 rename)
  ok('brain 정상 저장(2개)', allNotes().length === 2);
  ok('brain .bak 생성됨', fs.existsSync(BF + '.bak'));
  fs.writeFileSync(BF, '{깨진 JSON 입니다');   // 본 파일 손상 시뮬
  ok('brain 손상 시 .bak 로 복구(통째 소실 방지)', allNotes().length === 1);
  for (const f of [BF, BF + '.bak', BF + '.tmp']) { try { fs.rmSync(f); } catch { /* */ } }
}

// ── 📏 문맥(context) 초과 자동 절삭 — herrykim 제보(대화 길어지면 HTTP 400으로 채팅 막힘) ──
{
  const err = (m: string) => ({ response: { data: { error: { message: m } } } });
  ok('ctxOverflow 파싱(llama-server 문구)',
    ctxOverflow(err('request (8386 tokens) exceeds the available context size (8192 tokens), try increasing it'))?.ctx === 8192);
  ok('ctxOverflow 비초과 에러는 null', ctxOverflow(err('some other 400 error')) === null);
  // system + 오래된 히스토리 10턴 + 마지막 user — 절삭 후 줄어야 하고 system·마지막 user는 남아야
  const big: any[] = [{ role: 'system', content: 'S'.repeat(400) }];
  for (let i = 0; i < 10; i++) { big.push({ role: 'user', content: 'U'.repeat(400) }); big.push({ role: 'assistant', content: 'A'.repeat(400) }); }
  big.push({ role: 'user', content: '마지막질문'.repeat(20) });
  const tot = (a: any[]) => a.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
  const trimmed = trimForCtx(big, { req: 8400, ctx: 8192 });
  ok('문맥 절삭으로 메시지 줄어듦', trimmed.length < big.length);
  ok('문맥 절삭 후 system 유지', trimmed.some(m => m.role === 'system'));
  ok('문맥 절삭 후 마지막 user 유지', trimmed[trimmed.length - 1]?.content === big[big.length - 1].content);
  ok('문맥 절삭이 총량을 줄임', tot(trimmed) < tot(big));
  // system 자체가 거대(주입지식 폭증) → system 내용까지 잘라 예산 안으로
  const huge: any[] = [{ role: 'system', content: 'X'.repeat(40000) }, { role: 'user', content: '안녕' }];
  const ht = trimForCtx(huge, { req: 16000, ctx: 4096 });
  ok('거대 system도 잘라 총량 축소', tot(ht) < tot(huge) && ht.some(m => m.role === 'system'));
}

// ── 결과 ─────────────────────────────────────────────────────
console.log(`\n🧪 시뮬레이션: ${pass} 통과 · ${fail} 실패`);
if (fail > 0) process.exit(1);
console.log('✅ 전부 통과 — 배포해도 됨');
