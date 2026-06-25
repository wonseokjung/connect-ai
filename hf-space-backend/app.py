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
ACCESS_CODE = os.environ.get("ACCESS_CODE", "__SET_SPACE_SECRET__")  # 🎟️ 멤버십 코드
FREE_FLAVOR = os.environ.get("FLAVOR", "l4x1")       # 무료/저가 GPU
BASE_MODEL = "unsloth/llama-3.2-3b-instruct-bnb-4bit"
TRAIN_MONTHLY = int(os.environ.get("TRAIN_MONTHLY", "3"))   # 회원당 월 학습 캡 (클라이언트와 통일 = 3)
MERGE_MONTHLY = int(os.environ.get("MERGE_MONTHLY", "3"))   # 회원당 월 합성 캡
GLOBAL_MONTHLY = int(os.environ.get("GLOBAL_MONTHLY", "60"))  # 💰 전체 월 잡 하드캡 — userId를 바꿔치기해도 이걸 못 넘음(비용 폭주 방지). $20 예산 안.
FIREBASE_API_KEY = os.environ.get("FIREBASE_API_KEY", "")   # 있으면 idToken 검증(권장) — 없으면 userId 신뢰(임시)

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

def hf_whoami(token):
    # 회원 토큰의 실제 HF 사용자명(결과를 회원 계정에 올릴 때). 실패하면 빈 문자열
    try:
        r = requests.get("https://huggingface.co/api/whoami-v2", headers={"Authorization": f"Bearer {token}"}, timeout=10)
        return (r.json() or {}).get("name", "") if r.status_code == 200 else ""
    except Exception:
        return ""

# 🎁 회원이 본인 HF 토큰을 연동했으면 → 결과를 회원 계정에 업로드(진짜 소유). 아니면 제공자 계정.
#    반환: (out_owner, upload_token)
def upload_target(body):
    tok = (body.get("userHfToken") or "").strip()
    if tok:
        un = hf_whoami(tok)
        if un:
            return un, tok
    return provider(), HF_TOKEN

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

def used_of(g, kind, m):
    # 🛡️ 손상/레거시 게이트(kind가 None·非dict)도 500 안 나게 안전 추출
    k = g.get(kind) or {}
    if not isinstance(k, dict): return 0
    return k.get("count", 0) if k.get("month") == m else 0

# 💰 전체 월 잡 하드캡 — per-user 캡이 우회돼도(예: FIREBASE_API_KEY 미설정으로 userId 위조) 총비용을 막는다.
#    잡 띄우기 직전에 선점, 실패 시 롤백. (read-modify-write라 경합은 있으나 비용 '상한'으로서 충분)
GLOBAL_KEY = "__global__"
def global_reserve(m):
    g = gate_get(GLOBAL_KEY)
    used = g.get("count", 0) if g.get("month") == m else 0
    if used >= GLOBAL_MONTHLY:
        return False
    gate_set(GLOBAL_KEY, {"month": m, "count": used + 1})
    return True
def global_rollback(m):
    try:
        g = gate_get(GLOBAL_KEY)
        if g.get("month") == m and g.get("count", 0) > 0:
            gate_set(GLOBAL_KEY, {"month": m, "count": g["count"] - 1})
    except Exception:
        pass

# 🎁 회원이 본인 HF 토큰을 연동했으면 결과를 회원 계정에(소유). 토큰을 줬는데 검증 실패면(만료·일시오류)
#    조용히 제공자 계정으로 떨어뜨리지 않는다(개인 데이터가 제공자 계정에 올라가는 사고 방지) → 명확히 거부.
#    반환: (un 또는 "", 에러응답 또는 None). un=""이면 미연동(제공자 폴백 허용).
def resolve_owner(body):
    tok = (body.get("userHfToken") or "").strip()
    if not tok:
        return "", None
    un = hf_whoami(tok)
    if un:
        return un, None
    return "", {"ok": False, "error": "연동한 HuggingFace 토큰을 확인하지 못했어요(만료·권한·일시 오류). 🗂️ 연동에서 write 토큰을 다시 넣거나 잠시 후 다시 시도해 주세요."}

def verify_user(id_token, fallback_user_id):
    # FIREBASE_API_KEY가 있으면 idToken을 '반드시' 검증해 진짜 uid를 뽑는다(스푸핑·캡 우회 차단).
    # 키가 없으면 임시로 클라이언트 userId를 신뢰(키 넣기 전까진 HF $20 캡이 최종 방어).
    if FIREBASE_API_KEY:
        if not id_token:
            return None   # 키 설정됨 → idToken 없으면 거부 (우회 차단)
        try:
            r = requests.post(
                f"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={FIREBASE_API_KEY}",
                json={"idToken": id_token}, timeout=10)
            users = (r.json() or {}).get("users") or []
            if users and users[0].get("localId"):
                return users[0]["localId"]
        except Exception:
            pass
        return None   # 키 있는데 검증 실패 → 거부
    return fallback_user_id   # 키 없음 → 임시(userId 신뢰)

# ── HF 헬퍼 ──
def commit_dataset(repo, files, token=None, public=False):  # files: [(path, content_str)]. token=None이면 제공자
    a = HfApi(token=token or HF_TOKEN)
    a.create_repo(repo, repo_type="dataset", private=not public, exist_ok=True)
    if public:
        # ⚠️ create_repo(exist_ok=True)는 '기존 private repo'를 public으로 안 바꾼다 → 회원 토큰 잡이 마운트 실패.
        #    공용 스크립트는 반드시 공개로 강제(예전 founder-only 배포가 private로 만들어놨을 수 있음).
        try: a.update_repo_visibility(repo, private=False, repo_type="dataset")
        except Exception:
            try: a.update_repo_settings(repo_id=repo, private=False, repo_type="dataset")
            except Exception: pass
    for path, content in files:
        a.upload_file(path_or_fileobj=io.BytesIO(content.encode()),
                      path_in_repo=path, repo_id=repo, repo_type="dataset", token=token or HF_TOKEN)

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

def job_logs(job_id, n=8):
    # 🖥️ 작업 로그(제공자 토큰으로) — 회원에게 라이브 진행을 보여주기 위함. 실패하면 빈 리스트(진행바는 그대로 동작)
    for url in (f"https://huggingface.co/api/jobs/{provider()}/{job_id}/logs",
                f"https://huggingface.co/api/jobs/{provider()}/{job_id}/logs-stream"):
        try:
            r = requests.get(url, headers=HDR, timeout=8)
            if r.status_code == 200 and r.text:
                out = []
                for raw in r.text.splitlines():
                    s = raw.strip()
                    if not s:
                        continue
                    # SSE면 data: 접두 제거, JSON이면 메시지만
                    if s.startswith("data:"):
                        s = s[5:].strip()
                    try:
                        j = json.loads(s)
                        s = j.get("message") or j.get("log") or j.get("data") or s
                    except Exception:
                        pass
                    s = str(s).strip()
                    if s:
                        out.append(s[:140])
                if out:
                    return out[-n:]
        except Exception:
            pass
    return []

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
    user_id = verify_user(b.get("idToken"), b.get("userId"))
    if not user_id:
        return {"ok": False, "needLogin": True, "error": "회원 식별이 필요해요. 앱에서 로그인해주세요."}
    jsonl = b.get("jsonl") or ""
    if len(jsonl) < 20:
        return {"ok": False, "error": "학습할 두뇌 데이터가 비어 있어요."}
    if not HF_TOKEN:
        return {"ok": False, "error": "서버 토큰 미설정(Space 시크릿 HF_TOKEN)."}
    sid = sanitize(user_id); m = month()
    if sid == GLOBAL_KEY: return {"ok": False, "error": "잘못된 사용자 ID."}   # 전역 카운터 파일 충돌·조작 방지
    g = gate_get(sid)
    used = used_of(g, "train", m)
    if used >= TRAIN_MONTHLY:
        return {"ok": False, "gated": True, "error": f"무료 학습은 월 {TRAIN_MONTHLY}회예요. 다음 달에 다시 가능해요."}
    prov = provider()
    # 🎓 우리는 GPU 서버만 제공. 회원 HF 연동 시 → 데이터·모델이 회원 계정에(소유). 미연동(구버전 호환) → 제공자 계정.
    un, owner_err = resolve_owner(b)
    if owner_err: return owner_err                       # 토큰 줬는데 검증 실패 → 거부(개인데이터 제공자계정 업로드 방지)
    rid = datetime.datetime.utcnow().strftime("%m%d-%H%M%S")   # 🆔 run id — 이전 학습 모델을 덮어쓰지 않게
    if un:
        job_token = (b.get("userHfToken") or "").strip(); brain_repo = f"{un}/cai-brain"; out_repo = f"{un}/cai-model-{rid}"; mount_repo = f"{prov}/cai-train-script"
    else:
        job_token = HF_TOKEN; brain_repo = f"{prov}/cai-brain-{sid}"; out_repo = f"{prov}/cai-model-{sid}-{rid}"; mount_repo = brain_repo
    # 🛡️ 캡 선점 — 잡 띄우기 '전에' 카운트 올려 저장(경쟁/무카운트 과금 방지). 실패하면 롤백.
    g["train"] = {"month": m, "count": used + 1, "outputRepo": out_repo, "namespace": prov}
    gres = False
    try:
        gate_set(sid, g)                                # reserve 도 try 안 — 쓰기 실패해도 500 대신 친절 에러
        if not global_reserve(m):                       # 💰 전체 월 한도 — 비용 폭주 방지
            g["train"]["count"] = used; gate_set(sid, g)   # per-user 롤백
            return {"ok": False, "gated": True, "error": "이번 달 무료 서버 전체 한도에 도달했어요. 다음 달에 다시 가능해요(운영자가 한도를 늘릴 수 있어요)."}
        gres = True
        if un:   # 회원 계정: 데이터는 회원 토큰으로 회원 계정, 스크립트는 공용(공개) 마운트
            commit_dataset(mount_repo, [("train.py", TRAIN_SCRIPT)], public=True)
            commit_dataset(brain_repo, [("brain.jsonl", jsonl)], token=job_token)   # 회원 토큰으로 회원 계정에
        else:    # 제공자 계정(구버전 호환): 데이터+스크립트 한 repo에
            commit_dataset(brain_repo, [("brain.jsonl", jsonl), ("train.py", TRAIN_SCRIPT)])
            ensure_model_public(out_repo)
        job = launch_job({
            "dockerImage": "ghcr.io/astral-sh/uv:python3.12-bookworm",
            "command": ["uv", "run", "/data/train.py"],
            "flavor": FREE_FLAVOR, "timeout": "1h",
            "environment": {"DATASET_REPO": brain_repo, "DATASET_FILE": "brain.jsonl",
                            "OUTPUT_REPO": out_repo, "BASE_MODEL": BASE_MODEL, "MAX_STEPS": "120"},
            "secrets": {"HF_TOKEN": job_token},       # 회원 토큰(소유) or 제공자 토큰. GPU 컴퓨트는 제공자가 launch
            "volumes": [{"type": "dataset", "source": mount_repo, "mountPath": "/data"}],
        })
        job_id = job.get("id") or job.get("jobId")
        if not job_id:
            raise RuntimeError("잡 ID를 받지 못했어요(HF Jobs 응답 이상).")
        g["train"]["jobId"] = job_id; gate_set(sid, g)
        return {"ok": True, "jobId": job_id, "namespace": prov, "outputRepo": out_repo,
                "modelRepo": f"https://huggingface.co/{out_repo}", "left": TRAIN_MONTHLY - used - 1}
    except Exception as e:
        try: g["train"]["count"] = used; gate_set(sid, g)   # 🔙 롤백 — 잡 못 띄웠으면 카운트 복구
        except Exception: pass
        if gres: global_rollback(m)                         # 💰 전역 카운트도 복구(예약 성공했을 때만)
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
    user_id = verify_user(b.get("idToken"), b.get("userId"))
    if not user_id:
        return {"ok": False, "needLogin": True, "error": "회원 식별이 필요해요. 앱에서 로그인해주세요."}
    model_a, model_b = b.get("modelA") or "", b.get("modelB") or ""
    if not (model_a and model_b):
        return {"ok": False, "error": "합칠 두 모델(A·B)을 모두 지정하세요."}
    if not HF_TOKEN:
        return {"ok": False, "error": "서버 토큰 미설정(Space 시크릿 HF_TOKEN)."}
    method = str(b.get("method") or "slerp"); t = str(b.get("t") or "0.5")
    sid = sanitize(user_id); m = month()
    if sid == GLOBAL_KEY: return {"ok": False, "error": "잘못된 사용자 ID."}   # 전역 카운터 파일 충돌·조작 방지
    g = gate_get(sid)
    used = used_of(g, "merge", m)
    if used >= MERGE_MONTHLY:
        return {"ok": False, "gated": True, "error": f"무료 합성은 월 {MERGE_MONTHLY}회예요. 다음 달에 다시 가능해요."}
    prov = provider()
    # 🎓 GPU 서버만 제공. 회원 HF 연동 시 → 결과가 회원 계정에(소유). 미연동(구버전 호환) → 제공자 계정.
    un, owner_err = resolve_owner(b)
    if owner_err: return owner_err                       # 토큰 줬는데 검증 실패 → 거부
    rid = datetime.datetime.utcnow().strftime("%m%d-%H%M%S")   # 🆔 이전 합성 결과를 덮어쓰지 않게(#3)
    nm = sanitize(b.get("outName") or "")
    nm = f"{nm}-{rid}" if nm else f"merged-{rid}"
    if un:
        job_token = (b.get("userHfToken") or "").strip(); out_repo = f"{un}/{nm}"; mount_repo = f"{prov}/cai-merge-script"
    else:
        job_token = HF_TOKEN; out_repo = f"{prov}/cai-merge-{sid}-{nm}"; mount_repo = f"{prov}/cai-surg-{sid}"
    # 🛡️ 캡 선점 (경쟁/무카운트 과금 방지) — 실패 시 롤백
    g["merge"] = {"month": m, "count": used + 1, "outputRepo": out_repo, "namespace": prov}
    gres = False
    try:
        gate_set(sid, g)                                # reserve 도 try 안 — 쓰기 실패해도 500 대신 친절 에러
        if not global_reserve(m):                       # 💰 전체 월 한도 — 비용 폭주 방지
            g["merge"]["count"] = used; gate_set(sid, g)
            return {"ok": False, "gated": True, "error": "이번 달 무료 서버 전체 한도에 도달했어요. 다음 달에 다시 가능해요(운영자가 한도를 늘릴 수 있어요)."}
        gres = True
        if un:
            commit_dataset(mount_repo, [("merge_uv.py", MERGE_SCRIPT)], public=True)   # 공용 스크립트(공개)
        else:
            commit_dataset(mount_repo, [("merge_uv.py", MERGE_SCRIPT)])
            ensure_model_public(out_repo)
        job = launch_job({
            "dockerImage": "ghcr.io/astral-sh/uv:python3.12-bookworm",
            "command": ["uv", "run", "/data/merge_uv.py"],
            "flavor": FREE_FLAVOR, "timeout": "1h",
            "environment": {"MODEL_A": model_a, "MODEL_B": model_b, "METHOD": method,
                            "MERGE_T": t, "OUTPUT_REPO": out_repo},
            "secrets": {"HF_TOKEN": job_token},       # 회원 토큰(소유) or 제공자 토큰. GPU는 제공자 launch
            "volumes": [{"type": "dataset", "source": mount_repo, "mountPath": "/data"}],
        })
        job_id = job.get("id") or job.get("jobId")
        if not job_id:
            raise RuntimeError("잡 ID를 받지 못했어요(HF Jobs 응답 이상).")
        g["merge"]["jobId"] = job_id; gate_set(sid, g)
        return {"ok": True, "jobId": job_id, "namespace": prov, "outputRepo": out_repo,
                "modelRepo": f"https://huggingface.co/{out_repo}", "left": MERGE_MONTHLY - used - 1}
    except Exception as e:
        try: g["merge"]["count"] = used; gate_set(sid, g)   # 🔙 롤백
        except Exception: pass
        if gres: global_rollback(m)                         # 💰 전역 카운트도 복구(예약 성공했을 때만)
        return err_payload(e)

def _status(sid, kind):
    g = gate_get(sid).get(kind) or {}                   # 🛡️ kind가 None/非dict여도 500 안 나게
    if not isinstance(g, dict) or not g.get("jobId"):
        return {"ok": False, "error": "진행 중인 작업이 없어요."}
    try:
        s = job_status(g["jobId"])
        stage = s.get("stage", "UNKNOWN") if isinstance(s, dict) else str(s)
        logs = []
        try: logs = job_logs(g["jobId"])   # 🖥️ 라이브 진행 로그(회원이 HF 로그인 없이 봄)
        except Exception: pass
        return {"ok": True, "stage": stage, "message": (s.get("message", "") if isinstance(s, dict) else ""),
                "logs": logs, "outputRepo": g.get("outputRepo"),
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
