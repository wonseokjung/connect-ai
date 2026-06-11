// 🧪 자동 시뮬레이션 — 실제 사용자 발화·모델 변형 출력 수십 개를 코드 경로에 통과시켜 회귀를 잡는다.
//   실행: npm run sim   (빌드 전마다 돌려서 "여러 사람이 쓰는 상황"을 미리 재현)
import { quickIntent, planServe } from '../src/engine/intent';
import { parseTextTools } from '../src/engine/company';
import { stripTools } from '../src/engine/tools';

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

// ── 결과 ─────────────────────────────────────────────────────
console.log(`\n🧪 시뮬레이션: ${pass} 통과 · ${fail} 실패`);
if (fail > 0) process.exit(1);
console.log('✅ 전부 통과 — 배포해도 됨');
