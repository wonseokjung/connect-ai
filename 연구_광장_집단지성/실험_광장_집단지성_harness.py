#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
연구 ①: Cross-Organizational LLM Agent Society — 광장 집단지성 실험 하니스
=========================================================================
핵심 주장(논문):
  기존 멀티에이전트(Generative Agents·AutoGen·ChatDev)는 '한 시스템 안' 에이전트.
  우리 광장은 '서로 다른 사용자(=다른 조직)'의 에이전트가 만나 토론 → 그 결과가 각자 지식이 됨.
  → 조직 간 지식 전이(cross-org knowledge transfer)로, 혼자선 못 푸는 문제를 광장에선 푼다.

실험 설계(통제 시뮬레이션, 재현가능·무료):
  - K개 조직(org). 각 org는 '전문 지식(facts)' 일부만 보유. 어떤 org도 전체를 못 가짐.
  - 벤치마크: 각 문제는 2개 이상 org의 지식을 합쳐야 풀림 (1인 기업 테마).
  - 조건 A) SOLO  : org 에이전트가 자기 지식만으로 답.
  - 조건 B) PLAZA : 에이전트들이 광장에서 토론하며 지식 공유(Memory Stream에 관측 저장)
                    → 누적 기억으로 답.
  - 지표: 정답률(solo vs plaza), 지식전이(타 org 지식 사용), 기여 조직 다양성.

LLM: OpenAI 호환 /v1/chat/completions. 기본값 = Connect AI 내장 엔진(127.0.0.1:1235).
     LM Studio(1234)·Ollama·Gemini 등 BASE/MODEL 바꿔도 됨. 엔진 꺼져 있으면 안내 후 종료.

실행:  python3 실험_광장_집단지성_harness.py
환경변수: LLM_BASE(기본 http://127.0.0.1:1235/v1), LLM_MODEL(기본 자동감지), LLM_KEY(선택)
"""
import os, json, re, time, urllib.request, urllib.error

LLM_BASE = os.environ.get("LLM_BASE", "http://127.0.0.1:1235/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "")
LLM_KEY = os.environ.get("LLM_KEY", "")

# ───────────────────── 조직 + '사적/가상' 전문 지식 ─────────────────────
# ⚠️ 핵심: facts는 모델이 절대 모르는 '지어낸 고유 토큰'(가상 제품명·발명된 숫자)이어야
#    parametric 지식 누수 없이 'cross-org 지식 전이'만 깨끗이 측정된다.
#    각 org는 단 하나의 사적 지식만 보유 → 혼자선 cross-org 문제(2개 필요)를 못 푼다.
ORGS = [
    {"name": "마케터팀", "specialty": "내부 채널 운영 데이터", "facts": {
        "F_mkt": "우리 내부 분석상, 채널 'NovaPulse-7'의 쇼츠는 KST 04시 17분 업로드가 노출 최고였다.",
    }},
    {"name": "개발팀", "specialty": "사내 프레임워크", "facts": {
        "F_dev": "사내 프레임워크 'Zephyrix'의 무료 플랜 동시연결 한도는 정확히 37개다.",
    }},
    {"name": "결제팀", "specialty": "전용 결제 연동", "facts": {
        "F_pay": "우리가 쓰는 결제사 'PayGlin'의 해외결제 수수료는 건당 2.83%다.",
    }},
    {"name": "법무팀", "specialty": "본사 등록지 규정", "facts": {
        "F_law": "본사 등록지 기준, 연매출 6400만원 미만 사업자는 'C형 신고'만 하면 된다.",
    }},
]
ALL_FACTS = {fid: txt for o in ORGS for fid, txt in o["facts"].items()}
FACT_OWNER = {fid: o["name"] for o in ORGS for fid in o["facts"]}

# ───────────────────── 벤치마크: 각 문제는 '서로 다른 2개 조직'의 사적 지식 필요 ─────────────────────
PROBLEMS = [
    {"q": "NovaPulse-7 쇼츠를 가장 잘 노출시키려면 몇 시에 올리고, 우리 사내 프레임워크 Zephyrix 무료 플랜의 동시연결 한도는 몇 개인가? 정확한 값으로 답하라.",
     "need": ["F_mkt", "F_dev"]},
    {"q": "결제사 PayGlin의 해외결제 수수료는 몇 %이고, 본사 등록지 기준 연매출 6400만원 미만이면 어떤 신고를 하면 되는가? 정확한 값으로 답하라.",
     "need": ["F_pay", "F_law"]},
    {"q": "Zephyrix 무료 플랜 동시연결 한도 안에서 운영하면서 PayGlin으로 해외결제를 받으려 한다. 한도 개수와 수수료 %를 정확히 답하라.",
     "need": ["F_dev", "F_pay"]},
    {"q": "NovaPulse-7 최적 업로드 시각과, 본사 등록지 기준 우리 사업자가 해야 하는 신고 유형을 정확히 답하라.",
     "need": ["F_mkt", "F_law"]},
]

# ───────────────────── LLM 호출 (OpenAI 호환) ─────────────────────
def _post(path, body):
    req = urllib.request.Request(LLM_BASE + path, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {LLM_KEY}"} if LLM_KEY else {})})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))

def detect_model():
    global LLM_MODEL
    if LLM_MODEL:
        return LLM_MODEL
    try:
        req = urllib.request.Request(LLM_BASE + "/models",
                                     headers={"Authorization": f"Bearer {LLM_KEY}"} if LLM_KEY else {})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        LLM_MODEL = (data.get("data") or [{}])[0].get("id", "")
        return LLM_MODEL
    except Exception:
        return ""

def chat(system, user, temp=0.3):
    body = {"model": LLM_MODEL, "temperature": temp, "stream": False,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    out = _post("/chat/completions", body)
    return (out.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""

# ───────────────────── Memory Stream (Generative Agents 축약판) ─────────────────────
class MemoryStream:
    """관측(observation)을 시간순으로 저장하고, 질의 키워드와 겹치면 회상한다."""
    def __init__(self):
        self.mem = []   # [{"t":int, "text":str, "src":org, "fact_ids":[...]}]
    def observe(self, text, src, fact_ids=()):
        self.mem.append({"t": len(self.mem), "text": text, "src": src, "fact_ids": list(fact_ids)})
    def recall(self, query, k=6):
        qs = set(re.findall(r"[가-힣A-Za-z]{2,}", query))
        scored = []
        for m in self.mem:
            ws = set(re.findall(r"[가-힣A-Za-z]{2,}", m["text"]))
            scored.append((len(qs & ws) + 0.01 * m["t"], m))   # 관련성 + 약한 최신성
        scored.sort(key=lambda x: -x[0])
        return [m for _, m in scored[:k]]

# ───────────────────── 채점: 답이 필요한 지식을 담았나 + 어느 org 지식이 쓰였나 ─────────────────────
def score_answer(ans, need):
    """needed fact별 핵심 키워드가 답에 들어있으면 사용된 것으로 간주(결정적·무료)."""
    # 채점 키워드 = 모델이 지어낼 수 없는 '고유 토큰'. 답에 있으면 그 org 지식이 전이된 것.
    KW = {
        "F_mkt": ["04:17", "4:17", "4시 17", "04시 17", "417"],
        "F_dev": ["37"],
        "F_pay": ["2.83"],
        "F_law": ["c형", "C형"],
    }
    low = ans.lower()
    used = [fid for fid in need if any(k.lower() in low for k in KW.get(fid, []))]
    orgs_used = set(FACT_OWNER[f] for f in used)
    solved = len(used) == len(need)          # 필요한 지식을 '모두' 담아야 정답
    return solved, used, orgs_used

# ───────────────────── 조건 A: SOLO (자기 조직 지식만) ─────────────────────
def run_solo():
    print("\n──────── 조건 A) SOLO — 혼자(자기 조직 지식만) ────────")
    results = []
    for p in PROBLEMS:
        owner_org = next(o for o in ORGS if any(f in o["facts"] for f in p["need"]))  # 문제와 가장 관련된 org가 시도
        own = "\n".join(f"- {t}" for t in owner_org["facts"].values())
        sys = f"너는 '{owner_org['name']}'의 1인 기업 에이전트다. 아래 '네가 아는 지식'만 근거로 질문에 답하라. 모르면 모른다고 하라.\n[네가 아는 지식]\n{own}"
        ans = chat(sys, p["q"])
        solved, used, orgs = score_answer(ans, p["need"])
        results.append({"solved": solved, "used": used, "orgs": orgs})
        print(f"  [{ '✅' if solved else '❌'}] {owner_org['name']} 단독 — 사용지식 {len(used)}/{len(p['need'])} (기여org {len(orgs)})")
    return results

# ───────────────────── 조건 B: PLAZA (광장에서 토론 → Memory Stream → 답) ─────────────────────
def run_plaza():
    print("\n──────── 조건 B) PLAZA — 광장에서 다른 조직과 토론 ────────")
    results = []
    for p in PROBLEMS:
        stream = MemoryStream()
        # 1) 광장 입장: 각 org 에이전트가 '이 문제에 도움 될 내 지식'을 한 마디씩 공유 → 모두의 Memory Stream에 관측됨
        for o in ORGS:
            own = "\n".join(f"- {t}" for t in o["facts"].values())
            sys = (f"너는 '{o['name']}'({o['specialty']}) 에이전트다. 광장에서 다른 회사 에이전트들과 만났다. "
                   f"아래 '내 전문지식' 중 이 질문에 도움 될 게 있으면 1~2문장으로 공유하라. 없으면 '없음'.\n[내 전문지식]\n{own}")
            say = chat(sys, f"[광장 질문] {p['q']}", temp=0.2)
            if "없음" not in say[:6]:
                ids = [fid for fid in o["facts"] if any(w in say for w in re.findall(r"[가-힣A-Za-z]{3,}", o['facts'][fid])[:3])]
                stream.observe(f"{o['name']}: {say.strip()}", src=o["name"], fact_ids=ids or list(o["facts"]))
        # 2) 누적 기억(다른 조직 지식 포함)으로 종합 답변
        recalled = stream.recall(p["q"], k=6)
        ctx = "\n".join(f"- {m['text']}" for m in recalled)
        sys2 = ("너는 광장의 진행 에이전트다. 아래 '광장에서 다른 회사들이 공유한 지식'을 종합해 질문에 구체적으로 답하라.\n"
                f"[광장에서 모인 지식]\n{ctx}")
        ans = chat(sys2, p["q"])
        solved, used, orgs = score_answer(ans, p["need"])
        results.append({"solved": solved, "used": used, "orgs": orgs})
        print(f"  [{ '✅' if solved else '❌'}] 광장 종합 — 사용지식 {len(used)}/{len(p['need'])} (기여org {len(orgs)})")
    return results

def summarize(solo, plaza):
    n = len(PROBLEMS)
    s_solved = sum(r["solved"] for r in solo); p_solved = sum(r["solved"] for r in plaza)
    s_div = sum(len(r["orgs"]) for r in solo) / n; p_div = sum(len(r["orgs"]) for r in plaza) / n
    # 지식 전이: 답에 '자기 조직이 아닌' 지식이 쓰인 비율
    p_transfer = sum(1 for r in plaza if len(r["orgs"]) >= 2) / n
    print("\n════════════════ 결과 요약 ════════════════")
    print(f"  정답률:        SOLO {s_solved}/{n} ({100*s_solved//n}%)   vs   PLAZA {p_solved}/{n} ({100*p_solved//n}%)")
    print(f"  기여 조직 다양성(평균): SOLO {s_div:.2f}   vs   PLAZA {p_div:.2f}")
    print(f"  지식 전이율(2+org 융합): PLAZA {100*p_transfer:.0f}%")
    print(f"  → 핵심 주장 검증: 광장이 solo 대비 정답률 +{p_solved - s_solved}건 (Δ {100*(p_solved-s_solved)//n}%p)")
    print("  (논문 지표: solve-rate, knowledge-transfer-rate, contributing-org-diversity)")

if __name__ == "__main__":
    print("🌐 광장 집단지성 실험 — Cross-Organizational LLM Agent Society")
    m = detect_model()
    if not m:
        print(f"\n⚠️  LLM 엔진을 못 찾았어요: {LLM_BASE}")
        print("   Connect AI 앱에서 모델을 켜거나(127.0.0.1:1235), 환경변수 LLM_BASE/LLM_MODEL을 지정하세요.")
        print("   예) LLM_BASE=http://127.0.0.1:1234/v1 LLM_MODEL=gemma-4-e2b python3 실험_광장_집단지성_harness.py")
        raise SystemExit(1)
    print(f"   엔진: {LLM_BASE} · 모델: {m}")
    print(f"   조직 {len(ORGS)}개 · 문제 {len(PROBLEMS)}개 (각 문제는 2개 조직 지식 필요)")
    t0 = time.time()
    solo = run_solo()
    plaza = run_plaza()
    summarize(solo, plaza)
    print(f"\n⏱  {time.time()-t0:.0f}s")
