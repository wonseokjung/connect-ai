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
    if (st === 403) return { ok: false, error: `권한 없음(403): ${msg || ''}. 토큰에 repo(contents 쓰기) 권한이 필요해요.` };
    if (st === 404) return { ok: false, error: `못 찾았어요(404): "${repo}". owner/이름 철자와 토큰 권한(repo)을 확인하세요.` };
    if (st === 422) return { ok: false, error: `요청 오류(422): ${msg || ''}` };
    return { ok: false, error: msg || e?.message || String(e) };
  }
}

export async function pushKnowledge(token: string, repo: string, notes: any[]): Promise<{ ok: boolean; count?: number; error?: string; url?: string }> {
  const r = await pushFile(token, repo, FILE_PATH, JSON.stringify(notes, null, 2), `🧠 Connect AI 지식 동기화 (${notes.length}개)`);
  return r.ok ? { ok: true, count: notes.length, url: r.url } : r;
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
