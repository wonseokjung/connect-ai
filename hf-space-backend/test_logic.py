# 🧪 app.py 순수 로직 시뮬레이션 — fastapi/requests/huggingface_hub 를 스텁으로 막고 import.
#   실행: python3 test_logic.py  (Space 의존성 없이 로컬에서 회귀 잡기)
import sys, types

# ── 무거운 의존성 스텁 ──
def _mod(name):
    m = types.ModuleType(name); sys.modules[name] = m; return m

fa = _mod("fastapi")
class _App:
    def __init__(self, *a, **k): pass
    def get(self, *a, **k): return lambda f: f
    def post(self, *a, **k): return lambda f: f
fa.FastAPI = _App
class _Req: ...
fa.Request = _Req

rq = _mod("requests")
class _HTTPError(Exception):
    def __init__(self, *a, **k): super().__init__(*a); self.response = None
rq.HTTPError = _HTTPError
rq.get = lambda *a, **k: types.SimpleNamespace(json=lambda: {}, status_code=200, text="")
rq.post = lambda *a, **k: types.SimpleNamespace(json=lambda: {}, status_code=200, text="")

hh = _mod("huggingface_hub")
class _HfApi:
    def __init__(self, *a, **k): pass
    def create_repo(self, *a, **k): pass
    def upload_file(self, *a, **k): pass
    def update_repo_visibility(self, *a, **k): pass
    def update_repo_settings(self, *a, **k): pass
hh.HfApi = _HfApi
hh.hf_hub_download = lambda *a, **k: (_ for _ in ()).throw(Exception("no file"))

import app  # 이제 import 가능

P, F = 0, 0
def ok(name, cond):
    global P, F
    if cond: P += 1
    else: F += 1; print(f"❌ {name}")

# ── sanitize ──
ok("sanitize 경로문자 치환", app.sanitize("a/b.c#d e") == "a_b_c_d_e")
ok("sanitize 40자 제한", len(app.sanitize("x" * 100)) == 40)
ok("sanitize None", app.sanitize(None) == "")

# ── used_of: None/非dict/월불일치 방어(#5) ──
M = app.month()
ok("used_of 정상", app.used_of({"train": {"month": M, "count": 2}}, "train", M) == 2)
ok("used_of 월 다르면 0", app.used_of({"train": {"month": "2000-01", "count": 2}}, "train", M) == 0)
ok("used_of kind 없으면 0", app.used_of({}, "train", M) == 0)
ok("used_of None게이트 크래시 안남(#5)", app.used_of({"train": None}, "train", M) == 0)
ok("used_of 非dict 크래시 안남", app.used_of({"train": "corrupt"}, "train", M) == 0)

# ── resolve_owner: 토큰없음→폴백 / 유효→소유 / 무효→거부(#7) ──
_orig = app.hf_whoami
app.hf_whoami = lambda tok: "alice" if tok == "good" else ""
try:
    ok("resolve 토큰없음→제공자폴백", app.resolve_owner({}) == ("", None))
    un, err = app.resolve_owner({"userHfToken": "good"})
    ok("resolve 유효토큰→회원명", un == "alice" and err is None)
    un2, err2 = app.resolve_owner({"userHfToken": "bad"})
    ok("resolve 무효토큰→거부(#7, 조용한폴백 금지)", un2 == "" and err2 is not None and not err2.get("ok"))
finally:
    app.hf_whoami = _orig

# ── 전역 월 캡(#2 비용 하드캡): in-memory 게이트로 시뮬 ──
_store = {}
app.gate_get = lambda sid: _store.get(sid, {})
app.gate_set = lambda sid, data: _store.__setitem__(sid, data)
app.GLOBAL_MONTHLY = 3
M2 = app.month()
ok("global_reserve 1~3회 통과", all(app.global_reserve(M2) for _ in range(3)))
ok("global_reserve 4회째 거부(하드캡)", app.global_reserve(M2) is False)
app.global_rollback(M2)                                   # 1칸 복구
ok("rollback 후 다시 1회 통과", app.global_reserve(M2) is True)
ok("전역 카운트 정확", _store[app.GLOBAL_KEY]["count"] == 3)
_store.clear()
ok("월 바뀌면 리셋", (app.gate_set(app.GLOBAL_KEY, {"month": "2000-01", "count": 99}), app.global_reserve(M2))[1] is True)

print(f"\n🧪 백엔드 로직 시뮬: {P} 통과 · {F} 실패")
sys.exit(1 if F else 0)
