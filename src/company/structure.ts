/* company/structure.ts — 회사 폴더 구조 보장 + 에이전트 미션(goal) 템플릿/시딩.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: fs·path + paths(회사 폴더) + agents(AGENTS·AGENT_ORDER) + agent-tools(도구 시딩).
 * 순수 시딩 레이어 — 본문 LLM/대화로그 역참조 0(검증). 에이전트 메모리(appendAgentMemory)는
 * _copyDirRecursive 결합으로 본문 잔류. */
import * as fs from 'fs';
import * as path from 'path';
import { getCompanyDir } from '../paths';
import { AGENTS, AGENT_ORDER } from '../agents';
import { _seedAgentToolsIfMissing, _seedAgentToolsManifestIfMissing } from '../agent-tools';

export function ensureCompanyStructure(): string {
  const dir = getCompanyDir();
  fs.mkdirSync(path.join(dir, '_shared'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_agents'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'approvals', 'pending'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'approvals', 'history'), { recursive: true });
  AGENT_ORDER.forEach(id => {
    fs.mkdirSync(path.join(dir, '_agents', id), { recursive: true });
    _seedAgentGoalIfMissing(id);
    _seedAgentToolsIfMissing(id);
    _seedAgentToolsManifestIfMissing(id);
  });

  const goalsPath = path.join(dir, '_shared', 'goals.md');
  if (!fs.existsSync(goalsPath)) {
    fs.writeFileSync(goalsPath,
`# 🎯 공동 목표 (Company Goals)

_이 파일은 **모든 에이전트가 매번 읽는** 회사의 북극성입니다. 자유롭게 편집하세요._

## 장기 목표 (1년)
- [ ] (예) 유튜브 구독자 10만 달성
- [ ] (예) 인스타그램 팔로워 5만
- [ ] (예) 월 수익 500만원

## 단기 목표 (1개월)
- [ ] (예) 영상 4개 업로드
- [ ] (예) 릴스 12개 게시
`);
  }
  const idPath = path.join(dir, '_shared', 'identity.md');
  if (!fs.existsSync(idPath)) {
    fs.writeFileSync(idPath,
`# 🏢 회사 정체성 / 톤앤매너

_브랜드 보이스, 톤, 절대 금지어 등을 적으세요. 모든 에이전트가 매번 참조합니다._

- **회사 이름:**
- **대표자:**
- **타깃 청중:**
- **핵심 가치:**
- **브랜드 톤:**
- **금기 (절대 하지 말 것):**
`);
  }
  AGENT_ORDER.forEach(id => {
    const memPath = path.join(dir, '_agents', id, 'memory.md');
    if (!fs.existsSync(memPath)) {
      fs.writeFileSync(memPath,
`# ${AGENTS[id].emoji} ${AGENTS[id].name} (${AGENTS[id].role}) 개인 메모리

_${AGENTS[id].name} 에이전트만 읽고 쓰는 개인 노트. 학습·교훈·자주 쓰는 패턴이 누적됩니다._

## 학습 기록
`);
    }
    /* v2.89.115 — skills/ 디렉토리. memory.md(append-only firehose)와
       구분되는 "큐레이션된 재사용 패턴". 사용자가 텔레그램 `/skill` 또는
       명령 팔레트로 직전 산출물을 승격시킬 때 여기 저장됨. 매 호출 시
       readAgentSharedContext가 system prompt 위쪽에 주입. */
    const skillsDir = path.join(dir, '_agents', id, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const skillReadme = path.join(skillsDir, 'README.md');
    if (!fs.existsSync(skillReadme)) {
      fs.writeFileSync(skillReadme,
`# ${AGENTS[id].emoji} ${AGENTS[id].name} 스킬

_재사용 가능한 패턴 모음. memory.md는 모든 활동의 로그(append-only firehose),
이 폴더는 **검증된 패턴만 골라낸 것**입니다. 각 \`*.md\` 파일은 다음 호출 시
${AGENTS[id].name}의 system prompt에 자동 주입됩니다._

## 어떻게 채우나요?
- 텔레그램에서 \`/skill\` (직전 산출물 자동 승격)
- VS Code 명령 팔레트: \`Connect AI: 방금 산출물 → 스킬로 저장\`
- 직접 이 폴더에 \`<주제>.md\` 파일을 만들어도 됩니다 (\`# 제목\` + 본문)

\`README.md\` 자체는 system prompt에 주입되지 않습니다.
`);
    }
    const promptPath = path.join(dir, '_agents', id, 'prompt.md');
    if (!fs.existsSync(promptPath)) {
      fs.writeFileSync(promptPath,
`# ${AGENTS[id].emoji} ${AGENTS[id].name} 페르소나 디테일

_여기에 ${AGENTS[id].name} 에이전트에게 주고 싶은 추가 지시·말투·취향·예시 등을 자유롭게 적으세요._
_매 호출 시 시스템 프롬프트에 자동 주입됩니다. (git에 동기화됨)_

`);
    }
    const configPath = path.join(dir, '_agents', id, 'config.md');
    if (!fs.existsSync(configPath)) {
      let presets = '';
      if (id === 'secretary') {
        presets = `\n## 텔레그램 봇\n_BotFather에서 봇을 만들고 토큰을 받으세요. https://t.me/BotFather_\n_그리고 본인 채팅 ID를 알아내려면 https://t.me/userinfobot 에 메시지를 보내세요._\n\n- TELEGRAM_BOT_TOKEN: \n- TELEGRAM_CHAT_ID: \n`;
      } else if (id === 'youtube') {
        presets = `\n## YouTube Data API\n- YOUTUBE_API_KEY: \n- YOUTUBE_CHANNEL_ID: \n`;
      } else if (id === 'instagram') {
        presets = `\n## Meta Graph API\n- META_ACCESS_TOKEN: \n- INSTAGRAM_BUSINESS_ID: \n`;
      } else if (id === 'designer') {
        presets = `\n## 디자인 도구\n- FIGMA_TOKEN: \n- STITCH_API_KEY: \n`;
      }
      fs.writeFileSync(configPath,
`# ${AGENTS[id].emoji} ${AGENTS[id].name} 설정 (시크릿)

_이 파일은 \`.gitignore\`에 의해 깃 동기화에서 제외됩니다. API 키·토큰을 자유롭게 적으세요._
${presets}
`);
    }
  });

  // .gitignore — 시크릿과 캐시 보호
  const giPath = path.join(dir, '.gitignore');
  const desiredGi =
`# 자동 생성 — Connect AI 1인 기업 모드
# 시크릿·API 키 보호
_agents/*/config.md
# 도구 설정 JSON 안에 API 키·텔레그램 봇 토큰이 들어갈 수 있어 git에서 제외
_agents/*/tools/*.json
_agents/*/tools/youtube_account.json

# 외부 API 응답 캐시 (재현 가능)
_cache/

# 대용량 임시 산출물
_tmp/
*.log
`;
  if (!fs.existsSync(giPath)) {
    fs.writeFileSync(giPath, desiredGi);
  } else {
    /* Migrate old gitignore that didn't list tool JSONs — append the
       missing rules so existing users get token protection without us
       clobbering anything they manually added. */
    let cur = '';
    try { cur = fs.readFileSync(giPath, 'utf-8'); } catch { /* ignore */ }
    const additions: string[] = [];
    if (!cur.includes('_agents/*/tools/*.json')) {
      additions.push('# 도구 설정 JSON 안에 API 키·텔레그램 봇 토큰이 들어갈 수 있어 git에서 제외');
      additions.push('_agents/*/tools/*.json');
    }
    if (!cur.includes('youtube_account.json')) {
      additions.push('_agents/*/tools/youtube_account.json');
    }
    if (additions.length > 0) {
      try { fs.appendFileSync(giPath, '\n' + additions.join('\n') + '\n'); } catch { /* ignore */ }
    }
  }

  // _system.md — 시스템 자가 매뉴얼 (사람도 읽고 LLM도 컨텍스트로)
  const sysPath = path.join(dir, '_shared', '_system.md');
  if (!fs.existsSync(sysPath)) {
    fs.writeFileSync(sysPath,
`# 🧬 1인 기업 OS — 자가 매뉴얼

## 이 폴더는 무엇인가요?
당신의 1인 기업의 두뇌입니다. 7명의 AI 에이전트가 여기서 일합니다.

## 폴더 구조
- \`_shared/\` — 모든 에이전트가 매번 읽는 공동 메모리
  - \`identity.md\` — 회사 정체성 (이름, 톤, 가치)
  - \`goals.md\` — 목표
  - \`decisions.md\` — 의사결정 로그 (자가학습이 자동 누적)
  - \`_system.md\` — 이 파일
- \`_agents/<id>/\` — 각 에이전트 개인 공간
  - \`memory.md\` — 자가학습 (자동, append-only)
  - \`prompt.md\` — 페르소나 디테일 (사용자가 편집)
  - \`config.md\` — API 키·시크릿 (\`.gitignore\`로 보호)
- \`sessions/<ts>/\` — 세션별 산출물 (자동)
- \`_cache/\` — API 응답 캐시 (sync 제외)

## 메모리 위계 (충돌 시 우선순위)
1. \`decisions.md\` — 가장 강한 신뢰
2. \`identity.md\`
3. \`goals.md\`
4. 개인 메모리
5. 지식 베이스 (\`10_Wiki/\`)

## 다른 PC로 옮길 때
1. 새 PC에 Connect AI 설치
2. 👔 모드 ON → "📥 다른 PC에서 가져오기" 선택
3. GitHub URL 입력 → 자동 clone
4. 끝.

## 동기화 정책
- \`_shared/\`, \`_agents/*/memory.md\`, \`_agents/*/prompt.md\`, \`sessions/\` → git sync ✅
- \`_agents/*/config.md\`, \`_cache/\` → git sync ❌ (시크릿·캐시)

## 7명의 에이전트
${AGENT_ORDER.map(id => `- ${AGENTS[id].emoji} **${AGENTS[id].name}** (${AGENTS[id].role}): ${AGENTS[id].specialty}`).join('\n')}
`);
  }

  return dir;
}

/* Mission templates — what each agent works toward when 24h autonomy is on.
   Users edit freely from the agent panel; saved to `_agents/{id}/goal.md`.
   Empty string = no template (agent follows only the company goal). */
export const _GOAL_PREAMBLE = `> 🌞 24시간 업무가 켜져 있으면 이 미션을 향해 자동으로 한 스텝씩 일합니다.
> 자유롭게 수정하세요. 비워두면 회사 공동 목표만 따라갑니다.
`;
export const DEFAULT_AGENT_GOALS: Record<string, string> = {
  youtube: `# 🎯 YouTube 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 채널 정체성 확립 + 구독자 1만 도달
- 영상 평균 시청 지속률 50% 이상

## 이번 주 목표
- 후크 강한 영상 기획서 3개 작성
- 감시 채널 댓글 패턴에서 후크 단어 5개 추출
- 경쟁 채널 인기 영상 → 다음 액션 브리프 1건

## 사용 가능한 도구 (Skills)
- 🔑 \`youtube_account\` — API 키·내 채널·감시 채널·텔레그램 한 번에 설정
- 🎯 \`trend_sniper\` — 키워드 기반 떡상 영상 패턴 분석
- 🌙 \`auto_planner\` — 트렌드 스나이퍼 무인 반복 실행
- 🎬 \`my_videos_check\` — 내 채널 영상이 잘 올라갔는지 자동 판단
- 💬 \`comment_harvester\` — 감시 채널 댓글 → memory.md 누적
- 🔭 \`competitor_brief\` — 경쟁 채널 → 지시문 형식 다음 액션
- 📨 \`telegram_notify\` — 다른 도구 보고를 메신저로 자동 푸시

## 작업 원칙
- 추상적 조언 대신 **실행 가능한 산출물** (제목·썸네일 브리프·스크립트 후크)
- 매번 다음 단계 1줄을 명시
- 메모리(\`memory.md\`)에 누적된 댓글·반응 키워드를 후크에 반영
`,
  instagram: `# 📸 Instagram 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 피드 톤앤매너 확립 + 팔로워 5천 도달
- 릴스 평균 도달 1만 이상

## 이번 주 목표
- 릴스 기획 3개 (훅·보이스오버·자막 포함)
- 캡션·해시태그 패턴 정리

## 작업 원칙
- 매 산출물마다 게시 시간 + 후속 스토리 아이디어 1개
`,
  designer: `# 🎨 Designer 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 브랜드 컬러·타이포·로고 시스템 확정
- 썸네일/포스트 템플릿 3종 표준화

## 이번 주 목표
- 디자인 브리프 1건 작성 (레퍼런스 5장 포함)
- 썸네일 컨셉 3안 비교 정리

## 작업 원칙
- 텍스트 설명만 X — 색상 코드·폰트명·레이아웃 좌표까지 구체적으로
`,
  developer: `# 💻 코다리 — 시니어 풀스택 엔지니어

${_GOAL_PREAMBLE}
## 정체성
- 시니어 엔지니어. 코드 한 줄도 그냥 못 넘어감. "왜?"·"어떻게?"·"이게 깨질 수 있나?" 항상 묻는다.
- TypeScript·Python·Bash 능숙. React·Next·FastAPI·SQL·Docker 친숙.
- 클로드 코드처럼 작동: 목표 받으면 → 워크스페이스 탐색 → 계획 → 구현 → 자기 검증.

## 작업 흐름 (반드시 이 순서)
1. **탐색 먼저**: 새 파일 만들기 전에 \`<list_files>\`·\`<glob pattern="..."/>\`·\`<grep pattern="..."/>\` 로
   기존 코드·구조·관습 먼저 파악. 이미 있는 거면 안 새로 쓴다.
2. **편집 전 read**: \`<edit_file>\` 직전엔 반드시 \`<read_file path="..."/>\` 로 줄번호·현재 내용 확인.
   v2.89.104부턴 read 결과에 cat -n 줄번호 들어옴 — 이걸 보고 정확한 \`<find>\` 텍스트 잡는다.
3. **자기 검증 루프**: 코드 만들고/고친 직후 다음 중 1개 실행:
   - JS/TS: \`<run_command>node --check 파일.js</run_command>\` 또는 \`npx tsc --noEmit\`
   - Python: \`<run_command>python -m py_compile 파일.py</run_command>\` 또는 단위 테스트
   - 설정/JSON: \`<run_command>node -e "JSON.parse(require('fs').readFileSync('파일.json','utf8'))"</run_command>
   실패하면 에러 메시지 보고 자동 수정 (최대 2회 재시도).
4. **결과 시각 확인**: 만든 파일 위치를 \`<reveal_in_explorer>\` 로 보여주기.

## 코딩 원칙 (시니어 스타일)
- **명명**: 함수·변수가 무엇을 하는지 이름만 봐도 알아야. \`doSomething()\`·\`temp\`·\`data\` 금지.
- **함수 길이**: 50줄 넘어가면 분리. SRP (단일 책임).
- **에러 처리**: 외부 입력 (API·파일·사용자)에는 가드. 내부 호출엔 가드 자제 (root cause 가리지 마라).
- **주석**: 'WHY'만 적고 'WHAT'은 안 적는다. 코드 읽으면 알 수 있는 건 안 적기.
- **테스트 가능하게**: 사이드 이펙트는 끝에, 순수 로직은 분리.
- **타입**: TypeScript 엄격. Python은 type hint 권장.
- **시크릿**: 하드코드 절대 금지. \`process.env.\` 또는 config 파일 + .gitignore.
- **의존성**: 새 패키지 추가 전에 기존으로 해결 가능한지 본다. lodash 한 함수 쓰자고 lodash 통째 깔지 않는다.

## Git 워크플로우
- 의미 단위 커밋. "fix typo" 같은 무의미 메시지 금지.
- 커밋 메시지: 첫 줄 50자 이내 요약, 본문은 'why' 위주.
- \`<run_command>git add 특정파일 && git commit -m "..."</run_command>\` — 절대 \`git add -A\` 금지 (시크릿 끌릴 수 있음).
- 사용자가 명시 요청 안 하면 push 절대 X.

## 키트 선택 (pack_apply 자동 매칭)
사용자가 사이트·앱 만들어달라 하면 자동 흐름:
1. web_init 으로 프로젝트 셋업
2. pack_apply 호출 시 **KIT_NAME 비우고 USER_INTENT 에 사용자 명령 그대로** → 시스템이 키워드 매칭으로 자동 선택
3. 시스템이 매칭 못 하면 fallback (landing-kit)

명시적 선택이 필요할 때만 KIT_NAME 직접 지정:
- "랜딩"·"홈페이지"·"SaaS"·"출시" → landing-kit
- "포트폴리오"·"프리랜서"·"자기소개" → portfolio-kit
- "대시보드"·"관리자"·"admin"·"분석" → dashboard-kit
- "모바일"·"앱"·"iOS"·"안드로이드" → mobile-kit (Expo)

여러 개 후보면 USER_INTENT 자동 매칭에 맡기는 게 안전. 잘못 골랐다 싶으면 다시 호출해서 KIT_NAME 명시.

## 코드 출력 포맷
- 작은 변경: \`<edit_file>\` + \`<find>/<replace>\` 정확한 매칭
- 새 파일: \`<create_file path="...">\` 전체 내용
- 멀티라인 변경 여러 곳: \`<edit_file>\` 한 블록 안에 \`<find>/<replace>\` 페어 여러 개
- 코드 설명할 땐 마크다운 \`\`\`lang ... \`\`\` 사용

## 절대 금지
- "이렇게 하시면 됩니다" 텍스트만 + 코드 없음 → 아무것도 안 한 거.
- \`<edit_file>\` 전 \`<read_file>\` 안 함 → 매칭 실패의 주범.
- 커밋 메시지 빈 채로 git commit → reject.
- 사용자 데이터·API 키를 코드에 그대로 박기.
- 테스트 안 돌려보고 "수정 완료했습니다" 출력 → 거짓말.
`,
  business: `# 💼 현빈 — 비즈니스 전략가 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 수익화 모델 1개 가설 검증 → 매출화
- 핵심 KPI 대시보드 운영

## 이번 주 목표
- 가격·번들 옵션 2~3안 비교 메모
- 경쟁사 3곳 ROI 분석

## 작업 원칙
- 결정 가능한 권고 (A/B 중 어느 쪽인지) + 근거 숫자
`,
  secretary: `# 🗂️ Secretary 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 데일리 브리핑·할 일 정리 루틴 자동화
- 다른 에이전트 산출물을 한 줄 요약으로 모아서 보고

## 이번 주 목표
- 매일 09:00 데일리 브리핑 정리
- 미해결 할 일 5건 추적 + 다음 액션 명시

## 작업 원칙
- "정리"보다 "다음 액션 1개" 명시가 우선
`,
  editor: `# 🎵 루나 — 사운드 감독 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 영상 톤별 BGM 라이브러리 구축 (cinematic·lo-fi·ambient·edm 등)
- 채널 시그니처 사운드 (오프닝/엔딩 BGM) 정착

## 이번 주 목표
- 최근 영상 1편에 어울리는 BGM 1곡 자동 생성 + 합성
- 다음 영상 5편의 무드 키워드(장르/BPM/분위기) 미리 잡아두기

## 작업 원칙
- 막연한 "신나는 곡" X — 장르·BPM·길이 명시
- 영상 길이에 맞춰 BGM loop/fade 자동 결정
`,
  writer: `# ✍️ Writer 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 후크·CTA 라이브러리 50개 운영
- 채널·인스타·블로그 톤앤매너 가이드 확정

## 이번 주 목표
- 영상 스크립트 초안 2편 (후크 3안 포함)
- 인스타 캡션 5개 + 블로그 글 1편

## 작업 원칙
- 한 산출물에 후크/본문/CTA를 명확히 분리
`,
  researcher: `# 🔍 Researcher 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 산업·경쟁사 트렌드 리포트 월 1회 발행
- 인용 가능한 1차 자료 라이브러리 구축

## 이번 주 목표
- 우리 분야 트렌드 5개 짧은 메모
- 경쟁사 2곳 최근 활동·성공 콘텐츠 정리

## 작업 원칙
- 출처 링크 필수, 의견과 사실 분리해서 표기
`,
};

export function readAgentGoal(agentId: string): string {
  try {
    const p = path.join(getCompanyDir(), '_agents', agentId, 'goal.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  } catch { return ''; }
}

export function writeAgentGoal(agentId: string, content: string) {
  const dir = path.join(getCompanyDir(), '_agents', agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'goal.md'), content);
}

/** Seed goal.md if missing. Called by ensureCompanyStructure. */
export function _seedAgentGoalIfMissing(agentId: string) {
  try {
    const p = path.join(getCompanyDir(), '_agents', agentId, 'goal.md');
    if (fs.existsSync(p)) return;
    const seed = DEFAULT_AGENT_GOALS[agentId] || '';
    if (seed) fs.writeFileSync(p, seed);
  } catch { /* ignore */ }
}
