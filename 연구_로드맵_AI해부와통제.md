# 🔬 AI 해부와 통제 — 8주 연구 학습 로드맵

> **목표**: AI를 블랙박스가 아니라 *해부·이해·통제할 수 있는 구조*로 다룬다.
> weight editing · mechanistic interpretability · alignment를 논문+실습으로 정복하고,
> 한국어 모델 연구라는 미개척 영역에서 나만의 연구로 발전시킨다.
>
> **방식**: 매주 [논문 정독 → 한국어 정리 → 실습 노트북 → 블로그/영상화]
> claude가 논문검증·노트북·코드를 깔고, 나는 이해하고 한국어로 푼다.

---

## 📅 주차별 커리큘럼

### 1주 — 토대: "가중치를 바꾼다는 것" (빠르게)
- 📄 **LoRA** (Hu 2021, arXiv:2106.09685) — 효율적 가중치 변경
- 📄 **Task Arithmetic** (Ilharco, arXiv:2212.04089) — 능력 = 벡터, 더하고 빼기
- 🧪 실습 1: **AI 두 개 합치기** (`실험_AI두개합치기_model_merging.ipynb`) ✅
- ✍️ 정리 포인트: "능력이 가중치 공간의 방향으로 표현된다"는 통찰

### 2주 — 모델 합치기 심화
- 📄 **TIES-Merging** (Yadav, arXiv:2306.01708) — trim/elect/merge
- 📄 **DARE** (Yu, arXiv:2311.03099) — drop & rescale
- 📄 **Model Soups** (Wortsman, arXiv:2203.05482)
- 🧪 실습 2: TIES/DARE로 3개 이상 모델 합치기, t값·방법 비교 실험

### 3주 — AI 내부 들여다보기 (해석 입문)
- 📄 **Representation Engineering** (Zou, arXiv:2310.01405)
- 📖 Anthropic *Towards Monosemanticity* / *Scaling Monosemanticity* (블로그)
- 🧪 실습 3: 모델 활성화 추출·시각화 (특정 개념이 어느 방향인지)

### 4주 — 행동을 조종하기 (통제의 핵심)
- 📄 **Contrastive Activation Addition / CAA** (Rimsky, arXiv:2312.06681)
- 🧪 실습 4: steering 벡터로 모델 성격·말투 실시간 바꾸기 (가중치 안 건드림)

### 5주 — 🔑 안전은 어디에 있나 (핵심 주차)
- 📄 **Refusal in LMs Is Mediated by a Single Direction** (Arditi 2024, arXiv:2406.11717)
- 📄 반박: **Concept Cones** (arXiv:2502.17420) — 거부는 다방향이기도
- 🧪 실습 5: **refusal direction 찾기·시각화** (제거는 안 함 — 이해까지만)
- ✍️ 핵심 질문: "AI 안전은 정말 한 방향에 있나? 한국어에선?"

### 6주 — ⚖️ 안전의 취약성 (윤리·책임)
- 📄 **Fine-tuning Aligned Models Compromises Safety** (arXiv:2310.03693)
- 📄 abliteration 능력손실 분석 (arXiv:2512.13655)
- ✍️ 결론: "안전은 가중치 접근만으로 무너진다 → 더 튼튼한 통제가 필요"

### 7~8주 — 🎓 나만의 연구 프로젝트
**미개척 영역 (한국어 = 거의 비어있음):**
- 한국어 모델의 refusal direction은 영어와 어떻게 다른가?
- 다국어 모델에서 안전 방향이 언어마다 다른가? (steering의 언어 의존성)
- 한국어 steering vector로 톤·페르소나 제어
- → 재현 실험 → 한국어 특화 발견 → 블로그/논문/발표

---

## 🔁 매주 학습 루프
```
월: 논문 정독 (claude가 핵심 해설·그림)
화-수: 한국어로 내 말로 정리 (블로그 초안)
목-금: 실습 노트북 직접 돌리기 (Colab 무료 GPU)
주말: 이해 점검 + 다음 주 연결 + 콘텐츠화(유튜브/강의)
```

## 🧰 환경
- **Colab 무료 T4** (실습 GPU) / 사장님 맥 (작은 모델·추론)
- **mergekit** (모델 합치기), **transformers/peft/trl** (파인튜닝), **transformer_lens**(해석)
- **Connect AI 앱** — 만든 모델을 GGUF로 바로 실행·테스트

## 📌 원칙
- 검열 제거(abliteration) **완성·배포는 안 함** — 연구 재현(방향 찾기·시각화)까지만.
  "원리 이해"와 "무삭제 모델 배포"는 책임이 다르다. (Anthropic·딥마인드가 지키는 선)
- 모든 실습 = 안전하고 건설적인 방향 (능력 더하기·이해하기·통제하기)

---
*claude와 함께. 논문 1편 = 실습 1개씩 정복.*
