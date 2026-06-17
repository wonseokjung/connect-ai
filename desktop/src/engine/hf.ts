// 🧬 장기 기억 = HuggingFace. 지식을 파인튜닝용 데이터셋(JSONL)으로 HF에 업로드 → Unsloth/AutoTrain으로 학습.
import axios from 'axios';


// 토큰 주인 아이디 조회 — 사용자가 "이름"만 적어도 자동으로 user/이름 으로 만든다.
export async function hfUsername(token: string): Promise<string> {
  try { const r = await axios.get('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }); return r.data?.name || ''; }
  catch { return ''; }
}

// 🧬 HF Jobs — "내 AI 키우기" 클라우드 학습 (Pro/Team 전용, 초당 종량제). 제공자 토큰으로 실행.
export interface JobLaunch { ok: boolean; jobId?: string; url?: string; command?: string; error?: string; needsPro?: boolean; }
// 🧪 범용 HF Jobs 러너 — 데이터셋 repo에 올린 파이썬 스크립트를 GPU에서 실행 (학습·합치기·수술 공통).
export async function launchJob(token: string, namespace: string, opts: { datasetRepo: string; scriptFile: string; env: Record<string, string>; flavor?: string; timeout?: string }): Promise<JobLaunch> {
  const flavor = opts.flavor || 'l4x1';
  const timeout = opts.timeout || '1h';
  const scriptUrl = `https://huggingface.co/datasets/${opts.datasetRepo}/resolve/main/${opts.scriptFile}`;
  // 코랩 없이 실행되는 동등 CLI(확실한 폴백 — 복사해서 돌리면 무조건 됨)
  const command = `hf jobs uv run --flavor ${flavor} --timeout ${timeout} --secrets HF_TOKEN ${Object.entries(opts.env).map(([k, v]) => `-e ${k}=${v}`).join(' ')} ${scriptUrl}`;
  // best-effort REST 자동 실행 — Volume으로 데이터셋(스크립트 포함) 마운트 후 uv run
  const body = {
    dockerImage: 'ghcr.io/astral-sh/uv:python3.12-bookworm',
    command: ['uv', 'run', `/data/${opts.scriptFile}`],
    flavor, timeout, environment: opts.env, secrets: { HF_TOKEN: token },
    volumes: [{ type: 'dataset', source: opts.datasetRepo, mountPath: '/data' }],
  };
  try {
    const r = await axios.post(`https://huggingface.co/api/jobs/${namespace}`, body, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });
    const jobId = r.data?.id || r.data?.jobId;
    return { ok: true, jobId, url: r.data?.url || (jobId ? `https://huggingface.co/jobs/${namespace}/${jobId}` : ''), command };
  } catch (e: any) {
    const st = e?.response?.status; const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message;
    if (st === 402 || /credit|insufficient|balance/i.test(String(msg))) return { ok: false, needsPro: true, command, error: 'HF 크레딧이 부족해요. huggingface.co/settings/billing 에서 크레딧을 충전하면 바로 학습돼요 (1회 ~$0.3).' };
    if (st === 403 || /pro|subscription|payment|billing/i.test(String(msg))) return { ok: false, needsPro: true, command, error: 'HF Jobs는 HF Pro($9/월)·Team·Enterprise가 필요해요. Pro 가입 후 다시 시도하거나 아래 명령을 복사해 실행하세요.' };
    return { ok: false, command, error: (st ? `HTTP ${st}: ` : '') + (msg || '작업 실행 실패') + ' — 아래 명령으로 직접 실행할 수 있어요.' };
  }
}
// 🧬 장기기억 학습 — 범용 러너 위에 얹은 래퍼(기존 호출 호환)
export async function launchTrainingJob(token: string, namespace: string, opts: { datasetRepo: string; outputRepo: string; baseModel: string; flavor?: string; maxSteps?: number; scriptUrl: string; }): Promise<JobLaunch> {
  return launchJob(token, namespace, {
    datasetRepo: opts.datasetRepo, scriptFile: 'train_qlora_uv.py', flavor: opts.flavor,
    env: { DATASET_REPO: opts.datasetRepo, DATASET_FILE: 'connect-ai-brain.jsonl', OUTPUT_REPO: opts.outputRepo, BASE_MODEL: opts.baseModel, MAX_STEPS: String(opts.maxSteps || 120) },
  });
}
export async function jobStatus(token: string, namespace: string, jobId: string): Promise<{ ok: boolean; stage?: string; message?: string; error?: string }> {
  try {
    const r = await axios.get(`https://huggingface.co/api/jobs/${namespace}/${jobId}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
    const s = r.data?.status || {};
    return { ok: true, stage: s.stage || r.data?.stage || 'UNKNOWN', message: s.message || '' };
  } catch (e: any) { return { ok: false, error: e?.response?.data?.error || e?.message || String(e) }; }
}

// 🚫 HF Job 취소 (best-effort) — 멈춘/오래 걸리는 작업 중단
export async function cancelJob(token: string, namespace: string, jobId: string): Promise<boolean> {
  try { await axios.post(`https://huggingface.co/api/jobs/${namespace}/${jobId}/cancel`, {}, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }); return true; }
  catch { return false; }
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
