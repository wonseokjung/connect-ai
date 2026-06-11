// ⚡ 빠른 의도 라우터 — "크롬 열어서 유튜브" 같은 명확한 명령은 LLM 없이 코드가 즉시 실행.
//   작은 모델이 컨텍스트에 휘둘려 헛소리할 틈을 주지 않는다. (순수 함수 — scripts/simulate.ts 가 자동 검증)
export interface QuickIntent { app?: string; url?: string; dir?: string; label: string; }

const DIRS: Record<string, string> = {
  데스크탑: '~/Desktop', 바탕화면: '~/Desktop', 다운로드: '~/Downloads', 문서: '~/Documents',
  사진: '~/Pictures', 동영상: '~/Movies', '작업폴더': '@ws', '작업 폴더': '@ws',
};
const SITES: Record<string, string> = {
  유튜브: 'https://youtube.com', 구글: 'https://google.com', 네이버: 'https://naver.com',
  지메일: 'https://mail.google.com', 인스타그램: 'https://instagram.com', 인스타: 'https://instagram.com',
  깃허브: 'https://github.com', 챗지피티: 'https://chatgpt.com',
};
const APPS = ['크롬', '사파리', '파인더', '탐색기', '익스플로러', '메모장', '카카오톡', '카톡', '터미널', '계산기', '노션', '슬랙', '줌', 'chrome', 'safari', 'finder'];

// 🖥️ 서버 실행 계획 — 모델이 넘긴 명령을 실제 상황(package.json·index.html 유무)에 맞게 교정한다.
//   목표: "어쨌든 사용자 브라우저에 결과가 뜬다". (순수 함수 — simulate.ts가 검증)
export interface ServePlan { cmd: string; serveFile?: string; block?: 'no-pkg' | 'no-script'; missing?: string; repaired?: string; }
export function planServe(rawCmd: string, ctx: { hasPkg: boolean; scripts: string[]; hasIndex: boolean; win: boolean; nodeEntry?: string }): ServePlan {
  const cmd = (rawCmd || '').trim();
  const py = ctx.win ? 'python' : 'python3';
  // 🔧 자동 수리 체인 — "어쨌든 뜬다": ① 정적 파일(가장 확실) ② start 스크립트 ③ node 엔트리 ④ 안내
  const repair = (): ServePlan | null => {
    if (ctx.hasIndex) return { cmd: `${py} -m http.server 8080`, serveFile: 'index.html', repaired: '정적 서버' };
    if (ctx.hasPkg && ctx.scripts.includes('start')) return { cmd: 'npm start', repaired: 'npm start' };
    if (ctx.nodeEntry) return { cmd: `node ${ctx.nodeEntry}`, repaired: `node ${ctx.nodeEntry}` };
    return null;
  };
  // 파일명을 명령처럼 넘김 → 정적 서버 + 그 파일
  const fm = cmd.match(/^(?:serve\s+|open\s+)?["']?([\w가-힣 ./-]*\.(?:html?|htm))["']?$/i);
  if (fm) return { cmd: `${py} -m http.server 8080`, serveFile: fm[1].replace(/^\.\//, '').trim() };
  // npm 계열인데 package.json 없음 → 수리 시도, 안 되면 차단
  if (/^(npm|yarn|pnpm|npx)\s/i.test(cmd) && !ctx.hasPkg) return repair() || { cmd, block: 'no-pkg' };
  // npm run X인데 그 스크립트가 없음 (예: dev 없는데 npm run dev) → 수리 시도
  const runM = cmd.match(/^npm\s+run\s+([\w:-]+)/i);
  if (runM && ctx.hasPkg && !ctx.scripts.includes(runM[1])) return repair() || { cmd, block: 'no-script', missing: runM[1] };
  return { cmd };
}

export function quickIntent(t: string, workspace = ''): QuickIntent | null {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 44) return null;
  if (/만들|작성|분석|보고서|코드|개발|검색해|찾아|알려|정리|운영|요약|올려|업로드/.test(s)) return null;   // 일 시키는 건 에이전트에게
  if (!/(열어|열고|켜|들어가|띄워|실행해|보여줘)/.test(s)) return null;
  // 📂 폴더
  for (const k of Object.keys(DIRS)) if (s.includes(k)) {
    const d = DIRS[k] === '@ws' ? (workspace || '~/Desktop') : DIRS[k];
    return { dir: d, label: `${k} 폴더` };
  }
  let app = ''; for (const a of APPS) if (s.toLowerCase().includes(a)) { app = a; break; }
  let url = ''; let site = '';
  for (const k of Object.keys(SITES)) if (s.includes(k)) { url = SITES[k]; site = k; break; }
  const m = s.match(/(https?:\/\/\S+|[a-z0-9-]+\.(?:com|net|kr|io|app|ai)\S*)/i);
  if (m) { url = m[1]; site = m[1]; }
  if (!app && !url) return null;
  return { app: app || undefined, url: url || undefined, label: [app, site].filter(Boolean).join(' → ') };
}
