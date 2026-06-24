// ⚡ 단기 기억 = GitHub. 지식 노트를 레포에 버전관리로 동기화(push) / 불러오기(pull).
import axios from 'axios';

const FILE_PATH = 'connect-ai/knowledge.json';
const hdr = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'connect-ai-desktop' });
// 레포 입력 정규화 — 전체 URL(https://github.com/owner/repo.git)·git@·owner/repo 모두 owner/name 으로
const split = (repo: string) => {
  const s = (repo || '').trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '');
  const parts = s.split('/').filter(Boolean);
  return { owner: parts[0] || '', name: (parts[1] || '').replace(/[#?].*$/, '') };
};
const validRepo = (repo: string) => { const { owner, name } = split(repo); return !!(owner && name); };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 📊 최근 커밋 — "지금 개발 중" 활동 그래프(사령부)용. 메시지·날짜·작성자.
export async function listCommits(token: string, repo: string, limit = 30): Promise<{ ok: boolean; commits?: { sha: string; msg: string; date: string; author: string }[]; error?: string }> {
  const { owner, name } = split(repo);
  if (!token || !owner || !name) return { ok: false, error: 'GitHub 미연결' };
  try {
    const r = await axios.get(`https://api.github.com/repos/${owner}/${name}/commits`, { headers: hdr(token), params: { per_page: limit }, timeout: 12000 });
    const commits = (Array.isArray(r.data) ? r.data : []).map((c: any) => ({
      sha: (c.sha || '').slice(0, 7),
      msg: (c.commit?.message || '').split('\n')[0].slice(0, 90),
      date: c.commit?.author?.date || c.commit?.committer?.date || '',
      author: c.commit?.author?.name || c.author?.login || '',
    }));
    return { ok: true, commits };
  } catch (e: any) { return { ok: false, error: e?.response?.data?.message || e?.message || String(e) }; }
}

// 📖 특정 레포의 파일 하나를 읽는다(에이전트가 코드를 고치기 전에 현재 내용 확인용). 공개 레포는 토큰 없이도.
export async function getRepoFile(token: string, repo: string, filePath: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!validRepo(repo)) return { ok: false, error: `레포를 "owner/이름"으로 입력하세요. 지금 값: "${repo}"` };
  const { owner, name } = split(repo);
  const h: any = token ? hdr(token) : { Accept: 'application/vnd.github+json', 'User-Agent': 'connect-ai-desktop' };
  try {
    const r = await axios.get(`https://api.github.com/repos/${owner}/${name}/contents/${(filePath || '').replace(/^\/+/, '')}`, { headers: h, timeout: 15000 });
    if (Array.isArray(r.data)) return { ok: true, text: '[폴더] ' + r.data.map((x: any) => x.name).join(', ') };   // 디렉터리면 목록
    const raw = Buffer.from(r.data.content || '', 'base64').toString('utf8');
    return { ok: true, text: raw.slice(0, 12000) };   // 너무 큰 파일은 잘라서
  } catch (e: any) {
    const st = e?.response?.status;
    if (st === 404) return { ok: false, error: `파일을 못 찾았어요(404): "${repo}/${filePath}". 경로를 확인하거나 list로 폴더부터 보세요.` };
    if (st === 401 || st === 403) return { ok: false, error: '비공개 레포면 토큰 권한(repo)이 필요해요.' };
    return { ok: false, error: e?.response?.data?.message || e?.message || String(e) };
  }
}

// 범용 파일 푸시(생성/업데이트). 레포가 없으면 자동 생성(본인 계정일 때). 텍스트를 레포 path 에 커밋.
export async function pushFile(token: string, repo: string, filePath: string, text: string, message: string): Promise<{ ok: boolean; error?: string; url?: string }> {
  if (!token) return { ok: false, error: 'GitHub 토큰을 🗂️ 연동에서 먼저 입력하세요. (repo 권한 필요)' };
  if (!validRepo(repo)) return { ok: false, error: `레포를 "owner/이름" 또는 GitHub URL로 입력하세요 (예: wonseokjung/memory). 지금 값: "${repo}"` };
  const { owner, name } = split(repo);
  const base = `https://api.github.com/repos/${owner}/${name}`;
  const url = `${base}/contents/${filePath}`;
  try {
    // 1) 레포 존재 확인 → 없으면 자동 생성(본인 계정 한정)
    let exists = true;
    try { await axios.get(base, { headers: hdr(token), timeout: 12000 }); }
    catch (e: any) { if (e?.response?.status === 404) exists = false; else throw e; }
    if (!exists) {
      const me = await axios.get('https://api.github.com/user', { headers: hdr(token), timeout: 10000 }).then((r) => r.data?.login).catch(() => null);
      if (!me) return { ok: false, error: 'GitHub 토큰이 잘못됐거나 만료됐어요. 새 토큰(repo 권한)으로 바꾸세요.' };
      if (String(me).toLowerCase() !== String(owner).toLowerCase()) {
        return { ok: false, error: `'${repo}' 레포가 없어요. 본인 계정은 "${me}"인데 owner가 "${owner}"네요. "${me}/${name}"로 바꾸거나 GitHub에서 레포를 먼저 만드세요.` };
      }
      try { await axios.post('https://api.github.com/user/repos', { name, private: true, auto_init: true, description: 'Connect AI 지식 동기화' }, { headers: hdr(token), timeout: 15000 }); await sleep(1400); }
      catch (e: any) { return { ok: false, error: `레포 자동 생성 실패: ${e?.response?.data?.message || e?.message}. 토큰에 repo 권한이 있는지 확인하세요.` }; }
    }
    // 2) 기존 sha 조회 후 생성/업데이트
    let sha: string | undefined;
    try { const cur = await axios.get(url, { headers: hdr(token), timeout: 12000 }); sha = cur.data?.sha; } catch { /* 신규 파일 */ }
    const content = Buffer.from(text, 'utf8').toString('base64');
    await axios.put(url, { message, content, sha }, { headers: hdr(token), timeout: 20000 });
    return { ok: true, url: `https://github.com/${owner}/${name}/blob/main/${filePath}` };
  } catch (e: any) {
    const st = e?.response?.status, msg = e?.response?.data?.message;
    if (st === 401) return { ok: false, error: 'GitHub 토큰이 잘못됐거나 만료됐어요. 새 토큰(repo 권한)으로 바꾸세요.' };
    if (st === 403) return { ok: false, error: `권한 없음(403): 토큰에 쓰기 권한이 없어요. ▸Fine-grained 토큰: 해당 레포를 토큰의 Repository access에 넣고 → Repository permissions → Contents를 "Read and write"로. ▸Classic 토큰: "repo" 스코프 체크. (${msg || ''})` };
    if (st === 404) return { ok: false, error: `못 찾았어요(404): "${repo}". owner/이름 철자와 토큰 권한(repo)을 확인하세요.` };
    if (st === 422) return { ok: false, error: `요청 오류(422): ${msg || ''}` };
    return { ok: false, error: msg || e?.message || String(e) };
  }
}

export async function pushKnowledge(token: string, repo: string, notes: any[]): Promise<{ ok: boolean; count?: number; error?: string; url?: string }> {
  const r = await pushFile(token, repo, FILE_PATH, JSON.stringify(notes, null, 2), `🧠 Connect AI 지식 동기화 (${notes.length}개)`);
  return r.ok ? { ok: true, count: notes.length, url: r.url } : r;
}

// 📥 범용 지식 가져오기 — 어떤 GitHub 레포든 마크다운/텍스트 파일을 지식 노트로.
//   폴더 구조 가정 없음. 기술적 잡파일(코드·로그·캐시·설정)만 제외해서 누구 레포에나 동작.
const TEXT_EXT = ['.md', '.markdown', '.txt', '.mdx'];
// 지식이 아닌 게 거의 확실한 경로(로그·세션·캐시·빌드·의존성·메타). 폴더명은 일반적 용어만.
const SKIP_RE = /(^|\/)(\.[^/]+|node_modules|dist|build|out|coverage|vendor|sessions?|logs?|cache|tmp|temp|history|backups?)(\/|$)/i;
const SKIP_FILE = /(^|\/)(readme|license|licence|contributing|changelog|code_of_conduct|security)\.(md|markdown|txt)$/i;
const MAX_MD = 300;
// YAML 프론트매터에서 title 추출 + 본문 분리(있으면), 없으면 첫 H1.
function parseMd(md: string): { title: string; body: string } {
  let title = '', body = md;
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(md);
  if (m) { body = m[2]; const t = /^title:\s*"?(.+?)"?\s*$/m.exec(m[1]); if (t) title = t[1].trim(); }
  if (!title) { const h = /^#\s+(.+)$/m.exec(body); if (h) title = h[1].replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim(); }
  return { title, body: body.trim() };
}
const fileTitle = (p: string) => (p.split('/').pop() || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
// 레포의 지식 파일을 노트로 변환해 반환(병합은 호출측 importNotes 가).
export async function importRepoMarkdown(token: string, repo: string): Promise<{ ok: boolean; notes?: { text: string }[]; scanned?: number; skipped?: number; capped?: boolean; error?: string }> {
  if (!validRepo(repo)) return { ok: false, error: '레포 형식 오류' };
  const { owner, name } = split(repo);
  const h: any = token ? hdr(token) : { Accept: 'application/vnd.github+json', 'User-Agent': 'connect-ai-desktop' };
  const treeUrl = (br: string) => `https://api.github.com/repos/${owner}/${name}/git/trees/${br}?recursive=1`;
  try {
    let tree: any;
    try { tree = await axios.get(treeUrl('main'), { headers: h, timeout: 20000 }); }
    catch (e: any) { if (e?.response?.status === 404) tree = await axios.get(treeUrl('master'), { headers: h, timeout: 20000 }); else throw e; }
    const all = (tree.data.tree || []).filter((x: any) => x.type === 'blob' && TEXT_EXT.some(e => x.path.toLowerCase().endsWith(e)));
    const skipped = all.filter((x: any) => SKIP_RE.test(x.path) || SKIP_FILE.test(x.path)).length;
    let blobs = all.filter((x: any) => !SKIP_RE.test(x.path) && !SKIP_FILE.test(x.path));
    const capped = blobs.length > MAX_MD; if (capped) blobs = blobs.slice(0, MAX_MD);
    const notes: { text: string }[] = [];
    for (const bl of blobs) {
      try {
        const r = await axios.get(`https://api.github.com/repos/${owner}/${name}/git/blobs/${bl.sha}`, { headers: h, timeout: 15000 });
        const raw = Buffer.from(r.data.content, 'base64').toString('utf8');
        const { title, body } = parseMd(raw);
        const head = title || fileTitle(bl.path);
        const text = ((head ? `# ${head}\n` : '') + body).trim();
        if (text.length > 12) notes.push({ text: text.slice(0, 4000) });
      } catch { /* 파일 하나 실패는 건너뜀 */ }
    }
    return { ok: true, notes, scanned: blobs.length, skipped, capped };
  } catch (e: any) {
    const st = e?.response?.status;
    if (st === 404) return { ok: false, error: '레포 또는 브랜치(main/master)를 못 찾았어요.' };
    if (st === 401 || st === 403) return { ok: false, error: '비공개 레포면 토큰 권한이 필요해요(공개 레포는 토큰 없이도 됨).' };
    return { ok: false, error: e?.response?.data?.message || e?.message || String(e) };
  }
}

export async function pullKnowledge(token: string, repo: string): Promise<{ ok: boolean; notes?: any[]; error?: string }> {
  if (!token || !validRepo(repo)) return { ok: false, error: 'GitHub 토큰과 레포(owner/이름 또는 URL)를 🗂️ 연동에서 먼저 입력하세요.' };
  const { owner, name } = split(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${FILE_PATH}`;
  try {
    const r = await axios.get(url, { headers: hdr(token), timeout: 15000 });
    const json = Buffer.from(r.data.content, 'base64').toString('utf8');
    const notes = JSON.parse(json);
    return { ok: true, notes: Array.isArray(notes) ? notes : [] };
  } catch (e: any) {
    if (e?.response?.status === 404) return { ok: false, error: '아직 GitHub에 동기화된 지식이 없어요. 먼저 ⬆ 동기화하세요.' };
    return { ok: false, error: e?.response?.data?.message || e?.message || String(e) };
  }
}
