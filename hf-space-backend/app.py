# 🧬 Connect AI — 무료 학습·합성 백엔드 (HF Space · 문지기)
#
# 역할: 제공자(사장님) HF Pro 토큰을 Space 시크릿으로 보관 → 회원 검증 후 HF Job을 대신 실행.
#       토큰은 앱에 절대 안 들어가고, 계산(GPU)은 100% HF Jobs가 한다. GCP 불필요.
#
# 엔드포인트(데스크톱이 부르는 그대로): POST /train · POST /merge · GET /trainStatus · GET /mergeStatus
# 한도 기록: HF Dataset({provider}/connect-ai-gates) — 회원당 월 캡. 비용 방어는 HF Jobs 지출 캡($20)이 최종.
import os, io, re, json, datetime
from fastapi import FastAPI, Request
import requests
from huggingface_hub import HfApi, hf_hub_download

HF_TOKEN = os.environ.get("HF_TOKEN", "")            # 🔑 Space Secret — 제공자 HF write(Pro) 토큰
ACCESS_CODE = os.environ.get("ACCESS_CODE", "0101")  # 🎟️ 멤버십 코드
FREE_FLAVOR = os.environ.get("FLAVOR", "l4x1")       # 무료/저가 GPU
BASE_MODEL = "unsloth/llama-3.2-3b-instruct-bnb-4bit"
TRAIN_MONTHLY = int(os.environ.get("TRAIN_MONTHLY", "1"))   # 회원당 월 학습 캡
MERGE_MONTHLY = int(os.environ.get("MERGE_MONTHLY", "3"))   # 회원당 월 합성 캡

app = FastAPI(title="Connect AI Backend")
api = HfApi(token=HF_TOKEN)
HDR = {"Authorization": f"Bearer {HF_TOKEN}"}

_HERE = os.path.dirname(__file__)
TRAIN_SCRIPT = open(os.path.join(_HERE, "train_uv.py"), encoding="utf-8").read()
MERGE_SCRIPT = open(os.path.join(_HERE, "merge_uv.py"), encoding="utf-8").read()

def sanitize(s): return re.sub(r"[.#$\[\]/\s]", "_", str(s or ""))[:40]
def month(): return datetime.datetime.utcnow().strftime("%Y-%m")

_provider = None
def provider():
    global _provider
    if _provider: return _provider
    r = requests.get("https://huggingface.co/api/whoami-v2", headers=HDR, timeout=10)
    _provider = (r.json() or {}).get("name", "")
    return _provider

# ── 회원 한도 기록 (HF Dataset, 회원당 파일) ──
_gate_ds = None
def gate_ds():
    global _gate_ds
    if _gate_ds: return _gate_ds
    _gate_ds = f"{provider()}/connect-ai-gates"
    api.create_repo(_gate_ds, repo_type="dataset", private=True, exist_ok=True)
    return _gate_ds

def gate_get(sid):
    try:
        p = hf_hub_download(gate_ds(), f"{sid}.json", repo_type="dataset", token=HF_TOKEN)
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return {}

def gate_set(sid, data):
    api.upload_file(path_or_fileobj=io.BytesIO(json.dumps(data).encode()),
                    path_in_repo=f"{sid}.json", repo_id=gate_ds(), repo_type="dataset")

# ── HF 헬퍼 ──
def commit_dataset(repo, files):  # files: [(path, content_str)]
    api.create_repo(repo, repo_type="dataset", private=True, exist_ok=True)
    for path, content in files:
        api.upload_file(path_or_fileobj=io.BytesIO(content.encode()),
                        path_in_repo=path, repo_id=repo, repo_type="dataset")

def ensure_model_public(repo):
    api.create_repo(repo, repo_type="model", private=False, exist_ok=True)

def launch_job(body):
    r = requests.post(f"https://huggingface.co/api/jobs/{provider()}", json=body, headers=HDR, timeout=30)
    r.raise_for_status()
    return r.json()

def job_status(job_id):
    r = requests.get(f"https://huggingface.co/api/jobs/{provider()}/{job_id}", headers=HDR, timeout=15)
    d = r.json() or {}
    return d.get("status") or {"stage": d.get("stage", "UNKNOWN")}

def err_payload(e):
    msg = ""
    if isinstance(e, requests.HTTPError) and e.response is not None:
        try: msg = (e.response.json() or {}).get("error") or e.response.text
        except Exception: msg = e.response.text
        st = e.response.status_code
        if st == 402 or re.search(r"credit|insufficient|balance", str(msg), re.I):
            return {"ok": False, "error": "서버 HF 크레딧이 부족해요(운영자에 문의)."}
        if st == 403 or re.search(r"pro|billing|subscription", str(msg), re.I):
            return {"ok": False, "error": "제공자 계정에 HF Pro/크레딧이 필요해요(서버 설정)."}
        return {"ok": False, "error": f"HTTP {st}: {msg}"}
    return {"ok": False, "error": str(e)}

@app.get("/")
def root():
    return {"ok": True, "service": "connect-ai-backend", "provider": (provider() if HF_TOKEN else None),
            "endpoints": ["/train", "/merge", "/trainStatus", "/mergeStatus"]}

# ── 🧠 POST /train ──
@app.post("/train")
async def train(req: Request):
    try:
        b = await req.json()
    except Exception:
        b = {}
    access = str(b.get("accessCode", "")).strip()
    if access != ACCESS_CODE:
        return {"ok": False, "badCode": True, "error": "멤버십 코드가 틀렸어요. 멤버에게 공유된 코드를 입력하세요."}
    user_id = b.get("userId") or ""
    if not user_id:
        return {"ok": False, "needLogin": True, "error": "회원 식별이 필요해요. 앱에서 로그인해주세요."}
    jsonl = b.get("jsonl") or ""
    if len(jsonl) < 20:
        return {"ok": False, "error": "학습할 두뇌 데이터가 비어 있어요."}
    if not HF_TOKEN:
        return {"ok": False, "error": "서버 토큰 미설정(Space 시크릿 HF_TOKEN)."}
    sid = sanitize(user_id)
    g = gate_get(sid); m = month()
    used = (g.get("train", {}) or {}).get("count", 0) if g.get("train", {}).get("month") == m else 0
    if used >= TRAIN_MONTHLY:
        return {"ok": False, "gated": True, "error": f"무료 학습은 월 {TRAIN_MONTHLY}회예요. 다음 달에 다시 가능해요."}
    try:
        prov = provider()
        ds_repo = f"{prov}/cai-brain-{sid[:24]}"
        out_repo = f"{prov}/cai-model-{sid[:24]}"
        commit_dataset(ds_repo, [("brain.jsonl", jsonl), ("train.py", TRAIN_SCRIPT)])
        ensure_model_public(out_repo)
        job = launch_job({
            "dockerImage": "ghcr.io/astral-sh/uv:python3.12-bookworm",
            "command": ["uv", "run", "/data/train.py"],
            "flavor": FREE_FLAVOR, "timeout": "1h",
            "environment": {"DATASET_REPO": ds_repo, "DATASET_FILE": "brain.jsonl",
                            "OUTPUT_REPO": out_repo, "BASE_MODEL": BASE_MODEL, "MAX_STEPS": "120"},
            "secrets": {"HF_TOKEN": HF_TOKEN},
            "volumes": [{"type": "dataset", "source": ds_repo, "mountPath": "/data"}],
        })
        job_id = job.get("id") or job.get("jobId")
        g["train"] = {"month": m, "count": used + 1, "jobId": job_id, "outputRepo": out_repo, "namespace": prov}
        gate_set(sid, g)
        return {"ok": True, "jobId": job_id, "namespace": prov, "outputRepo": out_repo,
                "modelRepo": f"https://huggingface.co/{out_repo}", "left": TRAIN_MONTHLY - used - 1}
    except Exception as e:
        return err_payload(e)

# ── 🔪 POST /merge ──
@app.post("/merge")
async def merge(req: Request):
    try:
        b = await req.json()
    except Exception:
        b = {}
    access = str(b.get("accessCode", "")).strip()
    if access != ACCESS_CODE:
        return {"ok": False, "badCode": True, "error": "멤버십 코드가 틀렸어요. 멤버에게 공유된 코드를 입력하세요."}
    user_id = b.get("userId") or ""
    if not user_id:
        return {"ok": False, "needLogin": True, "error": "회원 식별이 필요해요. 앱에서 로그인해주세요."}
    model_a, model_b = b.get("modelA") or "", b.get("modelB") or ""
    if not (model_a and model_b):
        return {"ok": False, "error": "합칠 두 모델(A·B)을 모두 지정하세요."}
    if not HF_TOKEN:
        return {"ok": False, "error": "서버 토큰 미설정(Space 시크릿 HF_TOKEN)."}
    method = str(b.get("method") or "slerp"); t = str(b.get("t") or "0.5")
    sid = sanitize(user_id)
    g = gate_get(sid); m = month()
    used = (g.get("merge", {}) or {}).get("count", 0) if g.get("merge", {}).get("month") == m else 0
    if used >= MERGE_MONTHLY:
        return {"ok": False, "gated": True, "error": f"무료 합성은 월 {MERGE_MONTHLY}회예요. 다음 달에 다시 가능해요."}
    try:
        prov = provider()
        surg_repo = f"{prov}/cai-surg-{sid[:24]}"
        safe = sanitize(b.get("outName") or f"merged-{int(datetime.datetime.utcnow().timestamp())}") or "merged"
        out_repo = f"{prov}/{safe}"
        commit_dataset(surg_repo, [("merge_uv.py", MERGE_SCRIPT)])
        ensure_model_public(out_repo)
        job = launch_job({
            "dockerImage": "ghcr.io/astral-sh/uv:python3.12-bookworm",
            "command": ["uv", "run", "/data/merge_uv.py"],
            "flavor": FREE_FLAVOR, "timeout": "1h",
            "environment": {"MODEL_A": model_a, "MODEL_B": model_b, "METHOD": method,
                            "MERGE_T": t, "OUTPUT_REPO": out_repo},
            "secrets": {"HF_TOKEN": HF_TOKEN},
            "volumes": [{"type": "dataset", "source": surg_repo, "mountPath": "/data"}],
        })
        job_id = job.get("id") or job.get("jobId")
        g["merge"] = {"month": m, "count": used + 1, "jobId": job_id, "outputRepo": out_repo, "namespace": prov}
        gate_set(sid, g)
        return {"ok": True, "jobId": job_id, "namespace": prov, "outputRepo": out_repo,
                "modelRepo": f"https://huggingface.co/{out_repo}", "left": MERGE_MONTHLY - used - 1}
    except Exception as e:
        return err_payload(e)

def _status(sid, kind):
    g = gate_get(sid).get(kind, {})
    if not g.get("jobId"):
        return {"ok": False, "error": "진행 중인 작업이 없어요."}
    try:
        s = job_status(g["jobId"])
        stage = s.get("stage", "UNKNOWN") if isinstance(s, dict) else str(s)
        return {"ok": True, "stage": stage, "message": (s.get("message", "") if isinstance(s, dict) else ""),
                "outputRepo": g.get("outputRepo"),
                "jobUrl": f"https://huggingface.co/jobs/{g.get('namespace')}/{g['jobId']}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/trainStatus")
def train_status(userId: str = ""):
    if not userId: return {"ok": False, "error": "userId 필요"}
    return _status(sanitize(userId), "train")

@app.get("/mergeStatus")
def merge_status(userId: str = ""):
    if not userId: return {"ok": False, "error": "userId 필요"}
    return _status(sanitize(userId), "merge")
