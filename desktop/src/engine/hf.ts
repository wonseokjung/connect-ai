// 🧬 장기 기억 = HuggingFace. 지식을 파인튜닝용 데이터셋(JSONL)으로 HF에 업로드 → Unsloth/AutoTrain으로 학습.
import axios from 'axios';


// 토큰 주인 아이디 조회 — 사용자가 "이름"만 적어도 자동으로 user/이름 으로 만든다.
export async function hfUsername(token: string): Promise<string> {
  try { const r = await axios.get('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }); return r.data?.name || ''; }
  catch { return ''; }
}

export async function uploadDataset(token: string, repo: string, jsonl: string, filename = 'connect-ai-knowledge.jsonl'): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!token) return { ok: false, error: '허깅페이스 토큰을 🗂️ 연동에서 먼저 입력하세요. (write 권한)' };
  // 전체 URL·datasets/ 접두어 제거. "이름"만 적었으면 토큰 주인 아이디를 자동으로 앞에 붙인다.
  const clean = (repo || '').trim().replace(/^https?:\/\/(www\.)?huggingface\.co\/(datasets\/)?/i, '').replace(/[#?].*$/, '').replace(/\/+$/, '');
  let parts = clean.split('/').filter(Boolean);
  if (parts.length === 1) { const me = await hfUsername(token); if (me) parts = [me, parts[0]]; }
  if (parts.length < 2) return { ok: false, error: '데이터셋 이름을 🗂️ 연동에서 입력하세요 (예: connect-ai-brain). 토큰이 올바르면 아이디는 자동으로 붙어요.' };
  repo = `${parts[0]}/${parts[1]}`;
  const headers = { Authorization: `Bearer ${token}` };
  const name = parts[1];
  try {
    // 데이터셋 레포 생성 (이미 있으면 무시)
    try { await axios.post('https://huggingface.co/api/repos/create', { type: 'dataset', name, private: true }, { headers, timeout: 15000 }); } catch { /* 이미 존재 등 */ }
    // 커밋 API (NDJSON) — 작은 파일은 base64 인라인
    const ndjson =
      JSON.stringify({ key: 'header', value: { summary: '🧠 Connect AI 지식 데이터셋 업데이트' } }) + '\n' +
      JSON.stringify({ key: 'file', value: { path: filename, content: Buffer.from(jsonl, 'utf8').toString('base64'), encoding: 'base64' } }) + '\n';
    await axios.post(`https://huggingface.co/api/datasets/${repo}/commit/main`, ndjson, { headers: { ...headers, 'Content-Type': 'application/x-ndjson' }, timeout: 30000 });
    return { ok: true, url: `https://huggingface.co/datasets/${repo}` };
  } catch (e: any) {
    const st = e?.response?.status, msg = e?.response?.data?.error || e?.response?.data?.message;
    if (st === 401) return { ok: false, error: '허깅페이스 토큰이 잘못됐거나 만료됐어요. write 권한 토큰으로 바꾸세요.' };
    if (st === 403) return { ok: false, error: `권한 없음(403): ${msg || ''}. 토큰에 write 권한이 필요해요.` };
    if (st === 404) return { ok: false, error: `데이터셋을 못 찾았어요(404): "${repo}". user/이름 형식과 토큰 권한을 확인하세요.` };
    return { ok: false, error: msg || e?.message || String(e) };
  }
}
