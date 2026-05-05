# 🎯 트렌드 스나이퍼

유튜브 Data API로 최근 30일 떡상 영상을 수집하고, 로컬 LLM(Ollama/LM Studio)으로 패턴을 분석해 다음 영상 기획안(제목·썸네일·후크)을 도출합니다.

## 필요한 것
- Python 3 + `pip install google-api-python-client requests`
- `youtube_account.json`에 `YOUTUBE_API_KEY` 채우기 (한 번만)
- 로컬 LLM (Ollama 또는 LM Studio)이 켜져 있어야 함

## 설정값 (trend_sniper.json)
- `TARGET_KEYWORDS` — 분석할 키워드 배열
- (API 키·Ollama URL·모델은 공유 `youtube_account.json`에서 자동 로드)

## 실행 방법
패널의 [▶ 실행] 버튼을 누르거나 터미널에서:
```bash
python trend_sniper.py
```

## 출력
같은 폴더에 `trend_sniper_report.md` 누적 저장.
