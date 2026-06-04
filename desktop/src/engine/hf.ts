// 🧬 장기 기억 = HuggingFace. 지식을 파인튜닝용 데이터셋(JSONL)으로 HF에 업로드 → Unsloth/AutoTrain으로 학습.
import axios from 'axios';

// 지식 노트 → 챗 파인튜닝 JSONL
export function notesToJsonl(notes: { text: string }[]): string {
  const sys = '너는 사장님의 1인 기업 AI 비서다. 아래 지식을 체득해 답변에 활용한다.';
  return notes.map(n => JSON.stringify({ messages: [
    { role: 'system', content: sys },
    { role: 'user', content: '내 사업/지식에 대해 기억하고 있는 것을 알려줘.' },
    { role: 'assistant', content: n.text },
  ] })).join('\n');
}

export async function uploadDataset(token: string, repo: string, jsonl: string, filename = 'connect-ai-knowledge.jsonl'): Promise<{ ok: boolean; url?: string; error?: string }> {
  // 전체 URL(https://huggingface.co/datasets/user/name) 붙여넣어도 user/name 으로 정규화
  const clean = (repo || '').trim().replace(/^https?:\/\/(www\.)?huggingface\.co\/(datasets\/)?/i, '').replace(/[#?].*$/, '').replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (!token || parts.length < 2) return { ok: false, error: '허깅페이스 토큰과 데이터셋(user/이름 또는 URL)을 🗂️ 연동에서 먼저 입력하세요.' };
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
