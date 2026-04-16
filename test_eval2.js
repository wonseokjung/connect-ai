const axios = require('axios');
axios.post('http://127.0.0.1:1234/v1/chat/completions', {
    model: 'google/gemma-4-e2b',
    messages: [{'role':'user','content':'당신은 AI 에이전트의 역량을 검증하는 자동 채점관입니다.\n\n[평가 과제]\ntest\n\n위 문제에 대해 스스로 완벽한 답안을 도출해 본 뒤, 그 수준이 100점 만점에 몇 점에 해당하는지 자체 평가하십시오. 출력 포맷은 반드시 아래 1줄의 순수 JSON이어야 합니다.\n{ "score": 점수숫자, "reason": "이 점수를 준 이유를 한글로 간략히 작성" }'}],
    stream: false
}).then(r => console.log(r.data.choices[0].message.content)).catch(e => console.error(e));
