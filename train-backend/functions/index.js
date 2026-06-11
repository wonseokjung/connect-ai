// 🧬 Connect AI — 클라우드 학습 백엔드 (Firebase Cloud Functions)
//
// 제공자(너)의 HF Pro 토큰을 여기 'secret'으로 보관 → 유저 앱은 이 함수만 호출.
// 토큰은 절대 앱에 안 들어간다. 유저당 무료 월 1회 게이트(Realtime Database).
//
// 흐름: 앱이 두뇌 JSONL 전송 → 함수가 (제공자 계정에) 데이터셋+스크립트 업로드 → HF Job 실행 → jobId 반환.
//       결과 모델은 public repo라 앱이 토큰 없이 다운로드.
//
// 배포: 아래 README 참고. HF_TOKEN secret 설정 필수.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const HF_TOKEN = defineSecret('HF_TOKEN');          // 제공자 HF write 토큰 (Pro 계정)
const MONTH_MS = 30 * 24 * 3600 * 1000;
const FREE_FLAVOR = 'l4x1';                          // 무료 티어 GPU
const BASE_MODEL = 'unsloth/llama-3.2-3b-instruct-bnb-4bit';  // ≤8B 가드
const sanitize = (s) => String(s || '').replace(/[.#$\[\]/\s]/g, '_').slice(0, 40);

// 학습 스크립트(UV) — 데이터셋 repo에 함께 올려서 Job이 실행
const UV_SCRIPT = `# /// script
# requires-python = ">=3.10"
# dependencies = ["unsloth", "trl>=0.9", "datasets", "huggingface_hub", "torch"]
# ///
import os, sys
DATASET_REPO=os.environ.get("DATASET_REPO",""); DATASET_FILE=os.environ.get("DATASET_FILE","brain.jsonl")
BASE_MODEL=os.environ.get("BASE_MODEL","${BASE_MODEL}"); OUTPUT_REPO=os.environ.get("OUTPUT_REPO","")
HF_TOKEN=os.environ.get("HF_TOKEN",""); MAX_STEPS=int(os.environ.get("MAX_STEPS","120")); MAX_SEQ=2048
def main():
    if not (DATASET_REPO and OUTPUT_REPO and HF_TOKEN): print("env missing",file=sys.stderr); sys.exit(1)
    from huggingface_hub import hf_hub_download
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template
    from datasets import load_dataset
    from trl import SFTTrainer, SFTConfig
    p=hf_hub_download(repo_id=DATASET_REPO,filename=DATASET_FILE,repo_type="dataset",token=HF_TOKEN)
    ds=load_dataset("json",data_files=p,split="train")
    if len(ds)>2000: ds=ds.select(range(2000))
    model,tok=FastLanguageModel.from_pretrained(model_name=BASE_MODEL,max_seq_length=MAX_SEQ,load_in_4bit=True)
    model=FastLanguageModel.get_peft_model(model,r=16,lora_alpha=16,lora_dropout=0,
        target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],use_gradient_checkpointing="unsloth")
    tok=get_chat_template(tok,chat_template="chatml")
    def to_text(r):
        if r.get("messages"): m=r["messages"]
        elif r.get("instruction") is not None: m=[{"role":"user","content":r.get("instruction","")},{"role":"assistant","content":r.get("output","")}]
        else: return {"text":r.get("text","")}
        return {"text":tok.apply_chat_template(m,tokenize=False,add_generation_prompt=False)}
    ds=ds.map(to_text).filter(lambda x:bool((x.get("text") or "").strip()))
    SFTTrainer(model=model,tokenizer=tok,train_dataset=ds,args=SFTConfig(dataset_text_field="text",max_seq_length=MAX_SEQ,
        per_device_train_batch_size=2,gradient_accumulation_steps=4,warmup_steps=5,max_steps=MAX_STEPS,learning_rate=2e-4,
        logging_steps=5,optim="adamw_8bit",weight_decay=0.01,lr_scheduler_type="linear",output_dir="outputs",report_to="none")).train()
    model.push_to_hub(OUTPUT_REPO,token=HF_TOKEN); tok.push_to_hub(OUTPUT_REPO,token=HF_TOKEN)
    try: model.push_to_hub_gguf(OUTPUT_REPO,tok,quantization_method="q4_k_m",token=HF_TOKEN)
    except Exception as e: print("gguf fail",e,file=sys.stderr)
    print("DONE",OUTPUT_REPO)
if __name__=="__main__": main()
`;

const hdr = (token) => ({ Authorization: `Bearer ${token}` });

async function hfUsername(token) {
  const r = await axios.get('https://huggingface.co/api/whoami-v2', { headers: hdr(token), timeout: 10000 });
  return r.data?.name || '';
}
// 데이터셋 repo 생성(있으면 무시) + 파일 커밋 (public — 유저가 토큰 없이 결과 받게)
async function commitToDataset(token, repo, files, isPublic = false) {
  const name = repo.split('/')[1];
  try { await axios.post('https://huggingface.co/api/repos/create', { type: 'dataset', name, private: !isPublic }, { headers: hdr(token), timeout: 15000 }); } catch (e) { /* exists */ }
  const ndjson = JSON.stringify({ key: 'header', value: { summary: 'Connect AI 학습 데이터' } }) + '\n' +
    files.map(f => JSON.stringify({ key: 'file', value: { path: f.path, content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' } })).join('\n') + '\n';
  await axios.post(`https://huggingface.co/api/datasets/${repo}/commit/main`, ndjson, { headers: { ...hdr(token), 'Content-Type': 'application/x-ndjson' }, timeout: 30000 });
}
async function ensureModelRepoPublic(token, repo) {
  const name = repo.split('/')[1];
  try { await axios.post('https://huggingface.co/api/repos/create', { type: 'model', name, private: false }, { headers: hdr(token), timeout: 15000 }); } catch (e) { /* exists */ }
}
async function launchJob(token, namespace, body) {
  const r = await axios.post(`https://huggingface.co/api/jobs/${namespace}`, body, { headers: hdr(token), timeout: 30000 });
  return r.data;
}
async function jobStatus(token, namespace, jobId) {
  const r = await axios.get(`https://huggingface.co/api/jobs/${namespace}/${jobId}`, { headers: hdr(token), timeout: 15000 });
  return r.data?.status || { stage: r.data?.stage || 'UNKNOWN' };
}

// 🌐 단일 진입점 api — /train, /trainStatus 를 path로 라우팅 (Gen2 함수당 URL 분리 문제 해결, 앱은 URL 하나만 알면 됨)
const ACCESS_CODE = '0101';   // 🎟️ 멤버십 런칭 코드 — 멤버에게만 공유 (변경 시 여기 수정 후 재배포)
exports.api = onRequest({ secrets: [HF_TOKEN], cors: true, timeoutSeconds: 120, memory: '512MiB' }, async (req, res) => {
  const path = (req.path || '').replace(/^\/+/, '').toLowerCase();
  if (path === 'trainstatus') return trainStatusHandler(req, res);
  return trainHandler(req, res);   // 기본 = train
});

// POST /train  { userId, jsonl, idToken, accessCode }   → { ok, jobId, namespace, outputRepo }
async function trainHandler(req, res) {
  try {
    let { userId, jsonl, idToken, accessCode } = req.body || {};
    // 🎟️ 게이트 ① 멤버십 코드
    if (String(accessCode || '').trim() !== ACCESS_CODE) return res.json({ ok: false, badCode: true, error: '멤버십 코드가 틀렸어요. 멤버에게 공유된 코드를 입력하세요.' });
    // 🎟️ 게이트 ② 회원 로그인 필수 (익명 불가 — 재설치 우회 방지)
    if (!idToken) return res.json({ ok: false, needLogin: true, error: '무료 학습은 회원 전용이에요. 앱에서 로그인해주세요.' });
    try { const dec = await admin.auth().verifyIdToken(idToken); userId = dec.uid; } catch (e) { return res.json({ ok: false, needLogin: true, error: '로그인 세션이 만료됐어요. 다시 로그인해주세요.' }); }
    if (!userId) return res.json({ ok: false, error: 'userId가 필요해요(로그인).' });
    if (!jsonl || jsonl.length < 20) return res.json({ ok: false, error: '학습할 두뇌 데이터가 비어 있어요.' });

    // 무료 월 1회 게이트 (Realtime Database)
    const ref = admin.database().ref(`trainGate/${sanitize(userId)}`);
    const last = (await ref.get()).val()?.lastAt || 0;
    if (last && Date.now() - last < MONTH_MS) {
      const days = Math.ceil((MONTH_MS - (Date.now() - last)) / 86400000);
      return res.json({ ok: false, gated: true, error: `무료 학습은 월 1회예요. 약 ${days}일 후 다시 가능해요.` });
    }

    const token = HF_TOKEN.value();
    const provider = await hfUsername(token);
    if (!provider) return res.json({ ok: false, error: '제공자 HF 토큰 확인 실패(서버 설정 오류).' });
    const id = sanitize(userId).slice(0, 24);
    const datasetRepo = `${provider}/cai-brain-${id}`;
    const outputRepo = `${provider}/cai-model-${id}`;

    // 데이터셋(두뇌 + 스크립트) 업로드 + 결과 모델 repo를 public으로 미리 생성
    await commitToDataset(token, datasetRepo, [{ path: 'brain.jsonl', content: jsonl }, { path: 'train.py', content: UV_SCRIPT }], false);
    await ensureModelRepoPublic(token, outputRepo);

    // GPU 작업 실행 — 데이터셋 볼륨 마운트 후 uv run
    const job = await launchJob(token, provider, {
      dockerImage: 'ghcr.io/astral-sh/uv:python3.12-bookworm',
      command: ['uv', 'run', '/data/train.py'],
      flavor: FREE_FLAVOR, timeout: '1h',
      environment: { DATASET_REPO: datasetRepo, DATASET_FILE: 'brain.jsonl', OUTPUT_REPO: outputRepo, BASE_MODEL, MAX_STEPS: '120' },
      secrets: { HF_TOKEN: token },
      volumes: [{ type: 'dataset', source: datasetRepo, mountPath: '/data' }],
    });
    const jobId = job?.id || job?.jobId;
    await ref.set({ lastAt: Date.now(), jobId, outputRepo, namespace: provider });
    return res.json({ ok: true, jobId, namespace: provider, outputRepo, modelRepo: `https://huggingface.co/${outputRepo}` });
  } catch (e) {
    const st = e?.response?.status, msg = e?.response?.data?.error || e?.response?.data?.message || e?.message;
    if (st === 402 || /credit|insufficient|balance/i.test(String(msg))) return res.json({ ok: false, error: '서버 HF 크레딧이 부족해요(운영자에 문의).' });
    if (st === 403 || /pro|billing|subscription/i.test(String(msg))) return res.json({ ok: false, error: '제공자 계정에 HF Pro가 필요해요(서버 설정).' });
    return res.json({ ok: false, error: (st ? `HTTP ${st}: ` : '') + (msg || '학습 시작 실패') });
  }
}

// GET /trainStatus?userId=...   → { ok, stage, outputRepo }
async function trainStatusHandler(req, res) {
  try {
    const userId = req.query.userId;
    if (!userId) return res.json({ ok: false, error: 'userId 필요' });
    const g = (await admin.database().ref(`trainGate/${sanitize(userId)}`).get()).val();
    if (!g?.jobId) return res.json({ ok: false, error: '진행 중인 학습이 없어요.' });
    const s = await jobStatus(HF_TOKEN.value(), g.namespace, g.jobId);
    return res.json({ ok: true, stage: s.stage || 'UNKNOWN', message: s.message || '', outputRepo: g.outputRepo, jobUrl: `https://huggingface.co/jobs/${g.namespace}/${g.jobId}` });
  } catch (e) { return res.json({ ok: false, error: e?.message || String(e) }); }
}
