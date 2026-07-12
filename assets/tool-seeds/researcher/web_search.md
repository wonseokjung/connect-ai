# Web Search — You.com 실시간 웹 검색

실시간 웹 검색을 수행하여 트렌드, 경쟁사 정보, 사실 확인 등 연구 작업을 지원합니다.

## 설정

`web_search.json` 파일을 편집하여 API 키를 설정합니다:

```json
{
  "you_com_api_key": "YOUR-API-KEY-HERE",
  "max_results": 10
}
```

API 키는 https://api.you.com/apiKey 에서 무료로 발급받을 수 있습니다.

## 사용법

```
python web_search.py <검색어>
```

예시:
```
python web_search.py AI coding agents trends 2026
python web_search.py competitor analysis youtube channels
python web_search.py latest news about Llama models
```

## 출력

- **memory.md** — 연구원 에이전트의 메모리에 자동 저장 (후속 분석에 활용)
- **web_search_report.md** — 검색 보고서 (확인용)

## 연계 에이전트

- `researcher` — 트렌드 리서치, 경쟁사 분석, 사실 확인
- `ceo` — 분류된 후 웹 검색이 필요한 조사의 1차 수행
- `business` — 시장 조사, 경쟁 분석
- `youtube` — 트렌드 분석, 버즈 파악
