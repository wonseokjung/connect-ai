/* agent-tools.ts — 에이전트별 도구 카탈로그 + 도구 설정 + Python 도구 시딩.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: fs·path + paths(회사 폴더) + config(_loadToolSeed) + agents(AGENTS).
 * 순수 시딩/설정 레이어 — 본문(LLM·대화로그·스킬저장) 역참조 0 (검증 완료).
 * 개별 _seed<Tool> 함수는 _seedAgentToolsIfMissing 이 호출하는 내부전용. */
import * as fs from 'fs';
import * as path from 'path';
import { getCompanyDir } from './paths';
import { _loadToolSeed } from './config';
import { AGENTS } from './agents';

export interface AgentTool {
  name: string;          // e.g. "trend_sniper"
  displayName: string;   // human label
  description: string;   // short blurb for catalog
  scriptPath: string;    // absolute path to .py
  configPath: string;    // absolute path to .json
  readmePath: string;    // absolute path to .md
  config: Record<string, any>;   // parsed JSON values
  configSchema: ToolField[];     // inferred field schema for UI
  injectedAt?: string;   // ISO date — only set for skills injected via /api/skill-inject
  injectedFrom?: string; // origin tag (e.g. "ezer", "ai-university")
  enabled: boolean;      // user toggle — false hides tool from agent's prompt catalog
}

export interface ToolField {
  key: string;
  label: string;
  type: 'password' | 'text' | 'list' | 'number' | 'select';
  value: any;
  /** v2.89.72 — select 타입일 때 드롭다운 옵션 목록. JSON config의 `_schema[KEY].options`에서. */
  options?: { value: string; label: string }[];
  /** v2.89.72 — select/text/number 공통 — 사용자한테 보여줄 placeholder/도움말. `_schema[KEY].hint`. */
  hint?: string;
}

export function _inferToolFieldType(key: string, value: any, schema?: any): ToolField['type'] {
  // v2.89.72 — _schema에서 명시적 type 지정이 있으면 우선
  if (schema && schema[key] && schema[key].type) {
    const t = schema[key].type;
    if (['password', 'text', 'list', 'number', 'select'].includes(t)) return t;
  }
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number') return 'number';
  // any key with KEY/SECRET/TOKEN/PASS → password
  if (/(KEY|SECRET|TOKEN|PASS|API)/i.test(key)) return 'password';
  return 'text';
}

export function listAgentTools(agentId: string): AgentTool[] {
  const dir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
  if (!fs.existsSync(dir)) return [];
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  let names = entries
    .filter(f => f.endsWith('.py'))
    .map(f => f.slice(0, -3));
  /* v2.67 dedup: hide the iCal-only `google_calendar` tool whenever the
     OAuth tool `google_calendar_write` is present — they overlap entirely
     and users found two "Google Calendar" entries confusing. */
  if (names.includes('google_calendar') && names.includes('google_calendar_write')) {
    names = names.filter(n => n !== 'google_calendar');
  }
  const out: AgentTool[] = [];
  for (const name of names) {
    const scriptPath = path.join(dir, `${name}.py`);
    const configPath = path.join(dir, `${name}.json`);
    const readmePath = path.join(dir, `${name}.md`);
    let config: Record<string, any> = {};
    try {
      if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch { /* malformed JSON — leave empty */ }
    let readme = '';
    try { if (fs.existsSync(readmePath)) readme = fs.readFileSync(readmePath, 'utf-8'); } catch {}
    // Display name: first H1 in readme, or prettified file name
    const h1 = readme.match(/^#\s+(.+)$/m);
    const displayName = h1 ? h1[1].trim() : name.replace(/_/g, ' ');
    // Description: first non-heading paragraph
    const descMatch = readme.split('\n').find(l => l.trim() && !l.startsWith('#'));
    const description = (descMatch || '').slice(0, 200);
    // _injectedAt 등 메타 키는 사용자에게 노출되는 설정 폼에선 숨김 — 출처 추적용 내부 필드.
    // v2.89.72 — _schema 메타 필드로 select 옵션·hint·label override 가능.
    const schema = (config && typeof config._schema === 'object') ? config._schema : null;
    const configSchema: ToolField[] = Object.entries(config)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => {
        const t = _inferToolFieldType(key, value, schema);
        const fieldMeta = schema && schema[key] ? schema[key] : null;
        const field: ToolField = {
          key,
          label: (fieldMeta && fieldMeta.label) || key.replace(/_/g, ' '),
          type: t,
          value,
        };
        if (t === 'select' && fieldMeta && Array.isArray(fieldMeta.options)) {
          field.options = fieldMeta.options.map((o: any) =>
            typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label || o.value }
          );
        }
        if (fieldMeta && fieldMeta.hint) field.hint = fieldMeta.hint;
        return field;
      });
    const injectedAt = typeof config._injectedAt === 'string' ? config._injectedAt : undefined;
    const injectedFrom = typeof config._injectedFrom === 'string' ? config._injectedFrom : undefined;
    /* enabled defaults TRUE — explicit `_enabled: false` opts out, missing
       config or missing key both keep the tool active. Stored alongside
       other config keys so it round-trips through writeToolConfig untouched. */
    const enabled = config._enabled === false ? false : true;
    out.push({ name, displayName, description, scriptPath, configPath, readmePath, config, configSchema, injectedAt, injectedFrom, enabled });
  }
  return out;
}

export function writeToolConfig(agentId: string, toolName: string, config: Record<string, any>) {
  const p = path.join(getCompanyDir(), '_agents', agentId, 'tools', `${toolName}.json`);
  let existing: Record<string, any> = {};
  try {
    if (fs.existsSync(p)) existing = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* malformed — overwrite cleanly */ }
  fs.writeFileSync(p, JSON.stringify({ ...existing, ...config }, null, 2));
}

/** Toggle a single tool's enabled flag without disturbing other config values. */
export function setToolEnabled(agentId: string, toolName: string, enabled: boolean) {
  const p = path.join(getCompanyDir(), '_agents', agentId, 'tools', `${toolName}.json`);
  let config: Record<string, any> = {};
  try {
    if (fs.existsSync(p)) config = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* malformed — overwrite */ }
  if (enabled) {
    delete config._enabled; /* default is enabled, so absence === true */
  } else {
    config._enabled = false;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2));
}

/** Catalog of tools each specialist owns or is planned to own. Drives the
 *  `tools.md` manifest the user reads. Items marked `planned: true` are
 *  roadmap-only — they don't actually exist as .py seeds yet. The LLM never
 *  sees this list (it sees `listAgentTools()` from disk instead), so this is
 *  purely user-facing documentation.
 *
 *  v2.89.82 — 미구현 도구를 명확히 구분. 이전엔 instagram/designer/developer/
 *  business/writer/researcher 의 카탈로그 도구가 모두 "있는 것처럼" 표시돼서
 *  사용자가 _agents/<id>/tools.md 열고 "왜 작동 안 하지?" 혼란 발생. */
export const AGENT_TOOLS_CATALOG: Record<string, { tool: string; desc: string; planned?: boolean }[]> = {
    ceo: [
        { tool: 'approval_gate', desc: '위험 액션(deploy/post/send/rm) 사용자 승인 게이트', planned: true },
        { tool: 'team_briefing', desc: '주간 전체 회의 자동 진행 + 회의록 정리', planned: true },
        { tool: 'router', desc: '사용자 명령 → 적합한 specialist로 분배 (CEO 클래시파이어 내장)' }
    ],
    youtube: [
        { tool: 'youtube_account', desc: 'YouTube Data API v3 + OAuth 연결' },
        { tool: 'trend_sniper', desc: '키워드 기반 떡상 영상 패턴 분석' },
        { tool: 'auto_planner', desc: '트렌드 스나이퍼 무인 반복 실행 (24시간 자율)' },
        { tool: 'my_videos_check', desc: '내 채널 영상 성과 종합 분석' },
        { tool: 'channel_full_analysis', desc: '채널 전체 그림 — 메타·업로드 패턴·참여율' },
        { tool: 'comment_harvester', desc: '감시 채널 댓글 → memory.md 누적' },
        { tool: 'competitor_brief', desc: '경쟁 채널 → 지시문 형식 다음 액션' },
        { tool: 'telegram_notify', desc: '다른 도구 보고를 메신저로 자동 푸시' },
        { tool: 'comment_replier', desc: '댓글 분류 + 답글 초안 (Draft 레벨)', planned: true },
        { tool: 'video_uploader', desc: '제목·태그·썸네일·예약발행 업로드', planned: true },
        { tool: 'analytics_pull', desc: '주간 인사이트 (조회수·시청 지속률·구독 전환)', planned: true }
    ],
    instagram: [
        { tool: 'instagram_account', desc: 'Meta Graph API OAuth (비즈니스 계정)', planned: true },
        { tool: 'feed_poster', desc: '피드/스토리/릴스 게시 (Draft → 승인 → 게시)', planned: true },
        { tool: 'dm_responder', desc: 'DM·댓글 분류 + 답글 초안', planned: true },
        { tool: 'insights_pull', desc: '도달·참여·팔로워 추이', planned: true }
    ],
    designer: [
        { tool: 'image_local', desc: '로컬 SDXL/FLUX 이미지 생성 (오프라인 정체성)', planned: true },
        { tool: 'image_cloud', desc: 'DALL-E/Replicate (Connected 모드 토글)', planned: true },
        { tool: 'brand_check', desc: '브랜드 색상 팔레트·타이포 일관성 검증', planned: true },
        { tool: 'asset_library', desc: '_company/assets/ 자동 정리·태깅', planned: true }
    ],
    developer: [
        { tool: 'web_init', desc: '5개 템플릿 자동 시작 — vite·next·astro·expo·vanilla' },
        { tool: 'pack_apply', desc: '두뇌의 키트 (landing·portfolio·dashboard·mobile)를 프로젝트에 자동 적용 + npm install + App.tsx 업데이트' },
        { tool: 'web_preview', desc: 'dev server 백그라운드 실행 + URL 자동 추출' },
        { tool: 'pwa_setup', desc: '웹사이트 → PWA 변환 (manifest·sw·아이콘 자동 생성)' },
        { tool: 'lint_test', desc: '코드 수정 후 자가 검증 — tsc·py_compile·npm scripts 자동 실행 + 결과 리포트' },
        { tool: 'git_committer', desc: '작업 단위 자동 커밋 (의미 단위 + git add -A 금지)', planned: true },
        { tool: 'deploy_cli', desc: 'Vercel/Netlify/Cloudflare 배포 (deploy --prod는 항상 승인)', planned: true },
    ],
    business: [
        { tool: 'paypal_revenue', desc: '내 PayPal 매출 자동 분석 — 일/주/월별 + 통화별 + 환불율' },
        { tool: 'revenue_pull', desc: 'Stripe/Toss 매출 데이터 (PayPal은 paypal_revenue 별도)', planned: true },
        { tool: 'analytics_pull', desc: 'Google Analytics / Plausible 트래픽', planned: true },
        { tool: 'pnl_generator', desc: '월별 P&L 마크다운 자동 생성', planned: true }
    ],
    secretary: [
        { tool: 'telegram_setup', desc: '텔레그램 양방향 봇 (Bot Token + Chat ID)' },
        { tool: 'google_calendar_write', desc: 'Google Calendar OAuth 읽기·쓰기' },
        { tool: 'calendar_local', desc: '_agents/secretary/calendar.md (Lv.1 오프라인)', planned: true },
        { tool: 'calendar_caldav', desc: 'CalDAV (iCloud/Google 호환)', planned: true },
        { tool: 'kakao_alert', desc: '카카오톡 "나에게 보내기" 단방향 알림', planned: true },
        { tool: 'email_triage', desc: 'IMAP/Gmail 분류 + 답장 초안', planned: true }
    ],
    editor: [
        { tool: 'music_studio_setup', desc: '음악 모델 설치 (MusicGen / ACE-Step)' },
        { tool: 'music_generate', desc: 'BGM 자동 생성 (장르·길이 지정)' },
        { tool: 'music_to_video', desc: '생성된 BGM을 영상에 합성 (loop/fade)' }
    ],
    writer: [
        { tool: 'tone_learner', desc: '사용자 과거 글 학습 → 톤 복제', planned: true },
        { tool: 'multi_platform_adapt', desc: '하나의 스크립트 → YouTube/IG/블로그 자동 변환', planned: true },
        { tool: 'hook_library', desc: '후크·CTA 라이브러리 운영', planned: true }
    ],
    researcher: [
        { tool: 'web_search', desc: 'Brave/DuckDuckGo 검색 (Connected)', planned: true },
        { tool: 'page_fetcher', desc: '본문 추출 + 출처 인용', planned: true },
        { tool: 'monitor_daily', desc: '매일 내 분야 뉴스 → CEO 브리핑', planned: true }
    ]
};

/** Seed `_agents/<id>/tools.md` — declares the agent's tool roster + autonomy
 *  level toggle (0~3). Idempotent. Educational toggle: user picks how much
 *  authority each agent has, in the same file the agent reads its persona from. */
export function _seedAgentToolsManifestIfMissing(agentId: string) {
    try {
        const p = path.join(getCompanyDir(), '_agents', agentId, 'tools.md');
        if (fs.existsSync(p)) return;
        const a = AGENTS[agentId];
        if (!a) return;
        const tools = AGENT_TOOLS_CATALOG[agentId] || [];
        /* v2.89.82 — 실제 시드된 도구와 미구현(planned) 도구를 시각적으로 분리.
           이전엔 모든 도구를 enabled:true로 광고해서 미구현 도구도 동작하는 것처럼 보였음. */
        const ready = tools.filter(t => !t.planned);
        const planned = tools.filter(t => t.planned);
        const renderTool = (t: { tool: string; desc: string }) =>
            `### \`${t.tool}\`\n${t.desc}\n\n- \`enabled\`: true\n- \`requires_credentials\`: \`config.md\` 참조\n`;
        const renderPlanned = (t: { tool: string; desc: string }) =>
            `### \`${t.tool}\` _(예정)_\n${t.desc}\n\n- 아직 구현되지 않은 도구입니다. 로드맵에 있으며 향후 버전에서 추가 예정.\n`;
        let toolsBody: string;
        if (tools.length === 0) {
            toolsBody = '_(이 에이전트는 아직 등록된 도구가 없습니다. 추후 추가 예정.)_';
        } else if (ready.length === 0) {
            toolsBody = '_⚠️ 이 에이전트의 도구는 모두 로드맵 단계입니다. 현재 LLM 추론만 가능하고, 외부 API 호출이나 파일 생성은 아직 동작하지 않습니다._\n\n## 로드맵 (예정)\n\n' + planned.map(renderPlanned).join('\n');
        } else {
            toolsBody = ready.map(renderTool).join('\n');
            if (planned.length > 0) {
                toolsBody += '\n\n---\n\n## 로드맵 (예정)\n\n_아래 도구들은 향후 버전에서 추가 예정. 지금은 카탈로그에만 있음._\n\n' + planned.map(renderPlanned).join('\n');
            }
        }

        const body = `# ${a.emoji} ${a.name} — 도구 매니페스트

_${a.name} 에이전트가 어떤 도구를 어디까지 자율적으로 쓸 수 있는지 정의합니다._
_매번 시스템 프롬프트로 주입되며, 텔레그램에서 \`/tools\`로 현재 상태 확인 가능._

---

## 자율도 레벨

AUTONOMY_LEVEL: 2

| 값 | 의미 |
|---|---|
| 0 | Off — 도구 전체 비활성 (이 에이전트는 채팅만) |
| 1 | Read-only — 읽기·분석·보고만, 외부에 쓰기 X |
| 2 | Draft — 초안 작성 후 사용자 승인 게이트 통과해야 실행 ⭐ 권장 기본값 |
| 3 | Auto — 화이트리스트 안에서 사용자 승인 없이 실행 |

> 위 \`AUTONOMY_LEVEL\` 줄의 숫자(0~3)를 직접 바꾸면 다음 호출부터 적용됩니다.

---

## 사용 가능한 도구

${toolsBody}

---

## 안전 규칙 (모든 레벨 공통, 절대 우회 X)

- **삭제·배포·발송**(rm, deploy --prod, send, publish) 류는 자율도와 무관하게 **항상 승인 게이트**.
- 외부 API 호출 전 \`config.md\`의 토큰 존재 여부 확인.
- 모든 외부 행동은 \`_agents/${agentId}/activity.log\`에 한 줄 기록 (감사용).
- 승인 대기 액션은 \`approvals/pending/\` 에 저장 → 텔레그램 \`/approvals\` 로 조회.

---

_레벨을 어떻게 골라야 할지 모르겠다면 \`2 (Draft)\`가 안전한 시작점입니다._
`;
        fs.writeFileSync(p, body);
    } catch { /* ignore */ }
}

/** Seed each agent's starter tools. Idempotent — only writes files that
 *  don't already exist, so users can edit/delete freely without us clobbering.
 *  YouTube has the deepest tool catalog. Secretary owns telegram credentials
 *  (architecturally the messenger) so non-developers can input via the UI. */
export function _seedAgentToolsIfMissing(agentId: string) {
  try {
    if (agentId === 'youtube') {
      const toolsDir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
      fs.mkdirSync(toolsDir, { recursive: true });
      _seedYouTubeAccount(toolsDir);
      _seedYouTubeTrendSniper(toolsDir);
      _seedYouTubeAutoPlanner(toolsDir);
      _seedYouTubeMyVideosCheck(toolsDir);
      _seedYouTubeChannelFullAnalysis(toolsDir);
      _seedYouTubeCommentHarvester(toolsDir);
      _seedYouTubeCompetitorBrief(toolsDir);
      _seedYouTubeTelegramNotify(toolsDir);
    } else if (agentId === 'secretary') {
      const toolsDir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
      fs.mkdirSync(toolsDir, { recursive: true });
      _seedSecretaryTelegram(toolsDir);
      /* v2.67: drop iCal-only tool from new installs — OAuth covers reading
         too, and having two "Google Calendar" entries was confusing. The
         iCal helper still exists for users on older installs (their files
         remain), but listAgentTools hides it whenever the OAuth tool is
         present so they only see ONE calendar entry. */
      _seedSecretaryGoogleCalendarWrite(toolsDir);
    } else if (agentId === 'editor') {
      /* v2.89.68 — 사운드/음악 에이전트 도구. ACE-Step 1.5 로컬 음악 생성 모델 사용. */
      const toolsDir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
      fs.mkdirSync(toolsDir, { recursive: true });
      _seedEditorMusicStudioSetup(toolsDir);
      _seedEditorMusicGenerate(toolsDir);
      _seedEditorMusicToVideo(toolsDir);
    } else if (agentId === 'developer') {
      /* v2.89.112+122 — 코다리 도구. 웹·모바일 셋업 + PWA + dev server + 키트 적용. */
      const toolsDir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
      fs.mkdirSync(toolsDir, { recursive: true });
      _seedDeveloperWebInit(toolsDir);
      _seedDeveloperWebPreview(toolsDir);
      _seedDeveloperPwaSetup(toolsDir);
      _seedDeveloperPackApply(toolsDir);
      _seedDeveloperLintTest(toolsDir);
    } else if (agentId === 'business') {
      /* v2.89.121 — 비즈니스 에이전트 도구. PayPal 매출 자동 분석. */
      const toolsDir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
      fs.mkdirSync(toolsDir, { recursive: true });
      _seedBusinessPaypalRevenue(toolsDir);
    }
  } catch { /* ignore */ }
}

/* v2.89.121 — 비즈니스 에이전트 도구 시드. PayPal Developer API 직결. */
export function _seedBusinessPaypalRevenue(toolsDir: string) {
  const py = _loadToolSeed('business/paypal_revenue.py');
  const md = _loadToolSeed('business/paypal_revenue.md');
  const json = JSON.stringify({
    MODE: 'sandbox',
    CLIENT_ID: '',
    CLIENT_SECRET: '',
    LOOKBACK_DAYS: 30,
    CURRENCY: '',
    _schema: {
      MODE: {
        type: 'select',
        label: '🔧 모드',
        hint: '처음엔 sandbox (테스트 계정). 실제 매출 보려면 live.',
        options: [
          { value: 'sandbox', label: '🧪 Sandbox — 테스트 (가짜 계정·가짜 돈)' },
          { value: 'live',    label: '🚀 Live — 실제 운영 (진짜 돈)' },
        ],
      },
      CLIENT_ID: {
        type: 'text',
        label: '🔑 Client ID',
        hint: 'PayPal Developer Dashboard → Apps & Credentials 에서 발급',
      },
      CLIENT_SECRET: {
        type: 'password',
        label: '🔒 Client Secret',
        hint: '같은 곳에서 발급. 절대 외부 노출 금지 (도구 JSON은 .gitignore 적용됨)',
      },
      LOOKBACK_DAYS: {
        type: 'text',
        label: '📅 분석 기간 (일)',
        hint: '분석할 과거 일수. 30, 90, 365 등. 기본 30.',
      },
      CURRENCY: {
        type: 'text',
        label: '💱 기본 통화 (선택)',
        hint: 'USD / KRW / EUR 등. 비우면 모든 통화 표시.',
      },
    },
  }, null, 2);
  _seedFileForceUpgrade(path.join(toolsDir, 'paypal_revenue.py'), py, 'paypal_revenue_v3');
  _mergeSchemaIntoJson(path.join(toolsDir, 'paypal_revenue.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'paypal_revenue.md'), md, 'paypal_revenue_v1');
}

/* v2.89.112 — 코다리 도구 시드 함수들 */
export function _seedDeveloperWebInit(toolsDir: string) {
  const py = _loadToolSeed('developer/web_init.py');
  const md = _loadToolSeed('developer/web_init.md');
  const json = JSON.stringify({
    TEMPLATE: 'vite-react',
    PROJECT_NAME: 'my-app',
    OUTPUT_DIR: '',
    _schema: {
      TEMPLATE: {
        type: 'select',
        label: '🎨 템플릿',
        hint: '프로젝트 종류. vite-react는 SPA, nextjs는 풀스택, astro는 콘텐츠, expo는 모바일 앱, vanilla는 단순 HTML.',
        options: [
          { value: 'vite-react', label: '⚡ Vite + React + TS + Tailwind (SPA · 추천)' },
          { value: 'nextjs',     label: '▲ Next.js 14 + TS + Tailwind (풀스택)' },
          { value: 'astro',      label: '🚀 Astro + Tailwind (블로그 · 콘텐츠)' },
          { value: 'expo',       label: '📱 Expo (iOS/Android 모바일 앱)' },
          { value: 'vanilla',    label: '📄 Vanilla HTML+CSS+JS (단순)' },
        ],
      },
      PROJECT_NAME: {
        type: 'text',
        label: '📁 프로젝트 이름',
        hint: '소문자·숫자·하이픈만. 공백·한글 X. 예: my-blog, dashboard, portfolio',
      },
      OUTPUT_DIR: {
        type: 'text',
        label: '🗂️ 부모 폴더',
        hint: '비우면 ~/connect-ai-projects/. 다른 위치 원하면 절대경로.',
      },
    },
  }, null, 2);
  _seedFileForceUpgrade(path.join(toolsDir, 'web_init.py'), py, 'web_init_v3');
  _mergeSchemaIntoJson(path.join(toolsDir, 'web_init.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'web_init.md'), md, 'web_init_v1');
}

export function _seedDeveloperWebPreview(toolsDir: string) {
  const py = _loadToolSeed('developer/web_preview.py');
  const md = _loadToolSeed('developer/web_preview.md');
  const json = JSON.stringify({
    PROJECT_PATH: '',
    DEV_CMD: '',
    AUTO_OPEN: 'true',
    _schema: {
      PROJECT_PATH: { type: 'text', label: '📁 프로젝트 경로', hint: '비우면 web_init이 마지막에 만든 프로젝트 자동 사용' },
      DEV_CMD: { type: 'text', label: '▶️ dev 명령', hint: '비우면 package.json scripts.dev 자동 감지 (npm run dev)' },
      AUTO_OPEN: {
        type: 'select', label: '🌐 브라우저 자동 열기',
        options: [
          { value: 'true', label: 'O — URL 감지하면 브라우저 자동 오픈' },
          { value: 'false', label: 'X — 출력만, 브라우저 수동' },
        ],
      },
    },
  }, null, 2);
  _seedFileForceUpgrade(path.join(toolsDir, 'web_preview.py'), py, 'web_preview_v1');
  _mergeSchemaIntoJson(path.join(toolsDir, 'web_preview.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'web_preview.md'), md, 'web_preview_v1');
}

export function _seedDeveloperLintTest(toolsDir: string) {
  const py = _loadToolSeed('developer/lint_test.py');
  const md = _loadToolSeed('developer/lint_test.md');
  const json = JSON.stringify({
    PROJECT_PATH: '',
    STRICT: 'false',
    _schema: {
      PROJECT_PATH: { type: 'text', label: '📁 프로젝트 경로', hint: '비우면 web_init 마지막 결과 사용' },
      STRICT: {
        type: 'select', label: '⚙️ 엄격 모드',
        options: [
          { value: 'false', label: '느슨 — 모든 검증 시도 (기본)' },
          { value: 'true',  label: '엄격 — 첫 실패 시 중단' },
        ],
      },
    },
  }, null, 2);
  _seedFileForceUpgrade(path.join(toolsDir, 'lint_test.py'), py, 'lint_test_v1');
  _mergeSchemaIntoJson(path.join(toolsDir, 'lint_test.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'lint_test.md'), md, 'lint_test_v1');
}

export function _seedDeveloperPackApply(toolsDir: string) {
  const py = _loadToolSeed('developer/pack_apply.py');
  const md = _loadToolSeed('developer/pack_apply.md');
  const json = JSON.stringify({
    KIT_NAME: '',
    USER_INTENT: '',
    PROJECT_PATH: '',
    _schema: {
      KIT_NAME: {
        type: 'select',
        label: '🧩 키트 (명시 선택, 선택 사항)',
        hint: '비우면 USER_INTENT 로 자동 추론. 명시하면 무조건 그 키트 사용.',
        options: [
          { value: '',              label: '(자동 추론 — USER_INTENT 사용)' },
          { value: 'landing-kit',   label: '🏠 Landing Kit — SaaS 랜딩 (6 섹션)' },
          { value: 'portfolio-kit', label: '👤 Portfolio Kit — 1인 크리에이터 (5 섹션)' },
          { value: 'dashboard-kit', label: '📊 Dashboard Kit — SaaS 관리자' },
          { value: 'mobile-kit',    label: '📱 Mobile Kit — Expo 모바일 앱 (3 화면)' },
        ],
      },
      USER_INTENT: {
        type: 'text',
        label: '🎯 사용자 의도 (자연어, 자동 매칭용)',
        hint: '예: "다이어트 SaaS 랜딩" → 자동으로 landing-kit. "내 작품 모음" → portfolio-kit.',
      },
      PROJECT_PATH: {
        type: 'text',
        label: '📁 적용할 프로젝트 경로',
        hint: '비우면 web_init 이 마지막에 만든 프로젝트 자동 사용',
      },
    },
  }, null, 2);
  _seedFileForceUpgrade(path.join(toolsDir, 'pack_apply.py'), py, 'pack_apply_v7_1');
  _mergeSchemaIntoJson(path.join(toolsDir, 'pack_apply.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'pack_apply.md'), md, 'pack_apply_v1');
}

export function _seedDeveloperPwaSetup(toolsDir: string) {
  const py = _loadToolSeed('developer/pwa_setup.py');
  const md = _loadToolSeed('developer/pwa_setup.md');
  const json = JSON.stringify({
    PROJECT_PATH: '',
    APP_NAME: '',
    APP_SHORT_NAME: '',
    THEME_COLOR: '#667eea',
    BACKGROUND_COLOR: '#ffffff',
    ICON_EMOJI: '✦',
    _schema: {
      PROJECT_PATH: { type: 'text', label: '📁 프로젝트 경로', hint: '비우면 web_init 결과 자동 사용' },
      APP_NAME: { type: 'text', label: '📱 앱 이름', hint: '홈 화면에 표시될 풀 이름. 비우면 폴더명.' },
      APP_SHORT_NAME: { type: 'text', label: '🏷️ 짧은 이름', hint: '12자 이하. 비우면 앱 이름 잘라서.' },
      THEME_COLOR: { type: 'text', label: '🎨 테마 색', hint: '상단 바 색. #RRGGBB' },
      BACKGROUND_COLOR: { type: 'text', label: '🖼️ 스플래시 배경', hint: '앱 시작 화면 배경. #RRGGBB' },
      ICON_EMOJI: { type: 'text', label: '✨ 아이콘 이모지', hint: '아이콘에 쓸 이모지 (예: 📚 ✦ 🎯)' },
    },
  }, null, 2);
  _seedFileForceUpgrade(path.join(toolsDir, 'pwa_setup.py'), py, 'pwa_setup_v1');
  _mergeSchemaIntoJson(path.join(toolsDir, 'pwa_setup.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'pwa_setup.md'), md, 'pwa_setup_v1');
}

/* v2.89.68 — Editor (사운드) 에이전트 시드 함수들. assets/tool-seeds/editor/ 의 .py·.md 파일을
   회사 폴더의 _agents/editor/tools/ 로 복사. sentinel은 'music_v3' — 향후 ACE-Step XL 지원
   추가 시 'music_v3'로 올려서 자동 업그레이드. */
export function _seedEditorMusicStudioSetup(toolsDir: string) {
  const py = _loadToolSeed('editor/music_studio_setup.py');
  const md = _loadToolSeed('editor/music_studio_setup.md');
  /* v2.89.72 — _schema 메타로 MODEL을 드롭다운으로 노출. 사용자가 텍스트 입력 안 하고 클릭으로 선택. */
  const json = JSON.stringify({
    MODEL: '',
    INSTALL_DIR: '',
    _schema: {
      MODEL: {
        type: 'select',
        label: '🎵 음악 모델',
        hint: '비워두면 small 자동 선택 (모든 기기 안전). 큰 모델은 명시 RAM의 1.5~2배 실제 압박',
        options: [
          { value: '', label: '(자동 — 항상 small, 가장 안전)' },
          { value: 'musicgen-small',  label: '⚡ MusicGen Small  (300MB · 4GB+ RAM · 빠름)' },
          { value: 'musicgen-medium', label: '⚖️ MusicGen Medium (1.5GB · 8GB+ RAM · 균형)' },
          { value: 'musicgen-large',  label: '🎼 MusicGen Large  (3.3GB · 16GB+ RAM · 좋음)' },
          { value: 'acestep-base',    label: '🎹 ACE-Step Base   (10GB · 16GB+ Mac · 우수)' },
          { value: 'acestep-xl',      label: '🎻 ACE-Step XL     (15GB · 32GB+ 머신 · 최고)' },
        ],
      },
      INSTALL_DIR: {
        type: 'text',
        label: '📁 설치 위치',
        hint: '비워두면 ~/connect-ai-music/. 외장 디스크 등 변경 가능',
      },
    },
  }, null, 2);
  _seedFileForceUpgrade(path.join(toolsDir, 'music_studio_setup.py'), py, 'music_v5');
  // v2.89.85 — _seedFile → _mergeSchemaIntoJson. 기존 설치자의 json 에는
  // _schema 가 없어서 폼에 드롭다운이 안 떴음. 머지 헬퍼가 사용자 입력값
  // (MODEL/INSTALL_DIR) 과 도구가 자동 채워넣은 메타 (INSTALLED_·VENV_·
  // HF_ID·INSTALLED_AT) 는 그대로 보존하면서 _schema 만 최신화.
  _mergeSchemaIntoJson(path.join(toolsDir, 'music_studio_setup.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'music_studio_setup.md'), md, 'music_v5');
}

export function _seedEditorMusicGenerate(toolsDir: string) {
  const py = _loadToolSeed('editor/music_generate.py');
  const md = _loadToolSeed('editor/music_generate.md');
  const json = JSON.stringify({
    PROMPT: 'calm korean YouTube intro music, gentle piano, hopeful',
    DURATION_SEC: 30,
    GENRE: '',
    OUTPUT_DIR: '',
  }, null, 2);
  _seedFileForceUpgrade(path.join(toolsDir, 'music_generate.py'), py, 'music_v4');
  _seedFile(path.join(toolsDir, 'music_generate.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'music_generate.md'), md, 'music_v4');
}

export function _seedEditorMusicToVideo(toolsDir: string) {
  const py = _loadToolSeed('editor/music_to_video.py');
  const md = _loadToolSeed('editor/music_to_video.md');
  const json = JSON.stringify({
    VIDEO_PATH: '',
    MUSIC_PATH: '',
    BGM_VOLUME: 0.3,
    OUTPUT_PATH: '',
  }, null, 2);
  _seedFileForceUpgrade(path.join(toolsDir, 'music_to_video.py'), py, 'music_v3');
  _seedFile(path.join(toolsDir, 'music_to_video.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'music_to_video.md'), md, 'music_v3');
}

export function _seedFile(p: string, content: string) {
  if (fs.existsSync(p)) return;
  fs.writeFileSync(p, content);
}

/* Like _seedFile but force-overwrites if the existing file is missing a
   sentinel string. Use for autogenerated tool scripts when we ship a new
   version that needs to replace the old one — sentinel changes per version. */
export function _seedFileForceUpgrade(p: string, content: string, sentinel: string) {
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, content);
    return;
  }
  try {
    const cur = fs.readFileSync(p, 'utf-8');
    if (!cur.includes(sentinel)) {
      fs.writeFileSync(p, content);
    }
  } catch { /* ignore */ }
}

export function _seedYouTubeTrendSniper(toolsDir: string) {
  const py = _loadToolSeed('youtube/trend_sniper.py');
  const json = JSON.stringify({
    TARGET_KEYWORDS: ['유튜브 자동화', 'AI 비즈니스', '마케팅 트렌드', '생산성 툴'],
  }, null, 2);
  const md = _loadToolSeed('youtube/trend_sniper.md');
  /* v2.89.70 sentinel — LM Studio + Ollama 자동 감지 추가됨. 이전 사용자는 자동 업그레이드. */
  _seedFileForceUpgrade(path.join(toolsDir, 'trend_sniper.py'), py, 'is_lm_studio');
  _seedFile(path.join(toolsDir, 'trend_sniper.json'), json);
  _seedFile(path.join(toolsDir, 'trend_sniper.md'), md);
}

/* v2.89.70 sentinel — Auto Planner에 첫 실행 검증 + blocking 명확 안내 추가. 자동 업그레이드. */
export function _seedYouTubeAutoPlanner(toolsDir: string) {
  const py = _loadToolSeed('youtube/auto_planner.py');
  /* v2.89.72 — 사용자가 드롭다운으로 모드 선택. INTERVAL과 TOTAL 둘 다 select. */
  const json = JSON.stringify({
    INTERVAL_HOURS: 6,
    TOTAL_RUN_HOURS: 0,
    _schema: {
      INTERVAL_HOURS: {
        type: 'select',
        label: '⏰ 실행 간격',
        hint: 'YouTube API 일일 quota 한도(10,000 unit) 고려. 6시간이 안전권.',
        options: [
          { value: 1,  label: '1시간 — 너무 빠름, quota 초과 위험' },
          { value: 2,  label: '2시간 — 빠른 모니터링 (12회/일)' },
          { value: 3,  label: '3시간 — 활발 (8회/일)' },
          { value: 6,  label: '⭐ 6시간 — 권장 (4회/일, 안전)' },
          { value: 12, label: '12시간 — 보수적 (2회/일)' },
          { value: 24, label: '24시간 — 일일 1회' },
        ],
      },
      TOTAL_RUN_HOURS: {
        type: 'select',
        label: '🌙 가동 모드',
        hint: '0(무한) = 24시간 자율 모드. 양수 = 그 시간만 돌고 종료 (테스트용).',
        options: [
          { value: 0,  label: '⭐ 0 (무한) — 24시간 자율, 사용자가 멈출 때까지' },
          { value: 8,  label: '8시간 — 하룻밤 동안 (테스트용)' },
          { value: 24, label: '24시간 — 하루 동안' },
          { value: 72, label: '72시간 — 3일 동안' },
          { value: 168, label: '168시간 — 1주일 동안' },
        ],
      },
    },
  }, null, 2);
  const md = _loadToolSeed('youtube/auto_planner.md');
  /* v2.89.71 sentinel — 24시간 자율 모드 (TOTAL_RUN_HOURS=0 무한). 자동 업그레이드. */
  _seedFileForceUpgrade(path.join(toolsDir, 'auto_planner.py'), py, '24시간 자율 모드');
  _seedFile(path.join(toolsDir, 'auto_planner.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'auto_planner.md'), md, '24시간 자율 모드');
}

/* ─── Shared YouTube account/channel config ────────────────────────────────
   The other tools (trend_sniper, my_videos_check, comment_harvester,
   competitor_brief, telegram_notify) all read this single file so the user
   only enters their API key / channels / Telegram once. */
export function _seedYouTubeAccount(toolsDir: string) {
  const py = _loadToolSeed('youtube/youtube_account.py');
  /* v2.89.81 — _schema 추가. 폼 렌더가 hint를 자동으로 표시. */
  const json = JSON.stringify({
    YOUTUBE_API_KEY: '',
    MY_CHANNEL_HANDLE: '',
    MY_CHANNEL_ID: '',
    WATCHED_CHANNELS: [],
    COMPETITOR_CHANNELS: [],
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    OLLAMA_URL: 'http://127.0.0.1:11434',
    MODEL: '',
    _schema: {
      YOUTUBE_API_KEY: { label: '🔑 YouTube Data API 키', hint: 'Google Cloud Console → API & Services → 사용자 인증 정보에서 발급. 트렌드/통계 조회용 (일일 quota 10,000).' },
      MY_CHANNEL_HANDLE: { label: '📺 내 채널 핸들', hint: '@로 시작하는 채널 핸들 (예: @leoyt). 안 적어도 ID만 있으면 동작.' },
      MY_CHANNEL_ID: { label: '🆔 내 채널 ID', hint: 'UC로 시작하는 24자 ID. studio.youtube.com → 설정 → 채널 → 고급 설정에서 확인.' },
      WATCHED_CHANNELS: { label: '👀 모니터링 채널들', hint: '내가 정기적으로 추적하고 싶은 채널 핸들. 트렌드 스나이퍼가 새 영상을 잡아옴.' },
      COMPETITOR_CHANNELS: { label: '🎯 경쟁 채널들', hint: '벤치마킹할 채널 핸들. 비교 분석에 사용.' },
      TELEGRAM_BOT_TOKEN: { label: '🤖 Telegram Bot 토큰', hint: '@BotFather에서 /newbot으로 발급. 형식: 123456789:AAH...' },
      TELEGRAM_CHAT_ID: { label: '💬 Telegram Chat ID', hint: '봇과 첫 대화 시작 후 자동 채워짐. 직접 입력하지 않아도 됨.' },
      OLLAMA_URL: { label: '🧠 LLM 서버 주소', hint: '로컬 Ollama/LM Studio 엔드포인트. 보통 그대로 두면 됨.' },
      MODEL: { label: '🎚 사용할 모델', hint: '비워두면 설치된 모델 중 가장 작은 것 자동. 직접 지정하려면 모델명 (예: gemma2:2b).' },
      YOUTUBE_OAUTH_CLIENT_ID: { label: '🔓 OAuth Client ID', hint: 'Google Cloud → OAuth 2.0 클라이언트 ID. 댓글 답글·통계 등 인증 필요한 기능에 사용.' },
      YOUTUBE_OAUTH_CLIENT_SECRET: { label: '🔐 OAuth Client Secret', hint: 'OAuth 클라이언트 ID와 같이 발급되는 비밀 키. Authorized redirect URI: http://127.0.0.1:5814/yt-oauth-callback' },
    },
  }, null, 2);
  const md = _loadToolSeed('youtube/youtube_account.md');
  _seedFile(path.join(toolsDir, 'youtube_account.py'), py);
  /* Force-upgrade JSON so existing users get the new _schema. 사용자가 이미 입력한
     값은 보존하고 _schema만 머지하는 게 이상적이지만, _schema는 사용자가 편집하지
     않는 메타라 통째 덮어써도 안전. 단, 사용자 값이 있으면 보존해야 함 — 여기서
     _seedFileForceUpgrade는 sentinel 없으면 통째 덮어쓰니까 사용자 값이 날아감.
     그래서 별도 머지 함수 호출. */
  _mergeSchemaIntoJson(path.join(toolsDir, 'youtube_account.json'), json);
  /* Force-upgrade to surface the new Secretary-canonical guidance to users
     on older versions. Sentinel = the new section header. */
  _seedFileForceUpgrade(path.join(toolsDir, 'youtube_account.md'), md, '비서(Secretary)에 입력');
}

/* JSON 시드 파일에 새 _schema를 머지. 사용자가 입력한 값은 절대 건드리지 않고,
   _schema만 항상 최신으로 갱신. fresh에 새로 추가된 키는 빈 값으로 추가하고,
   existing에만 있는 키도 보존 (예: 나중에 OAuth flow가 추가한 토큰). */
export function _mergeSchemaIntoJson(p: string, freshJson: string) {
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, freshJson);
    return;
  }
  try {
    const fresh = JSON.parse(freshJson);
    const existing = JSON.parse(fs.readFileSync(p, 'utf-8') || '{}');
    /* 1) existing의 모든 키 그대로 보존 (OAuth 토큰처럼 동적으로 추가된 값 포함) */
    const merged: Record<string, any> = { ...existing };
    /* 2) fresh에만 있는 새 키는 빈 값으로 추가 */
    for (const k of Object.keys(fresh)) {
      if (k === '_schema') continue;
      if (!(k in merged)) merged[k] = fresh[k];
    }
    /* 3) _schema는 항상 최신 fresh로 덮어쓰기 (사용자가 편집하지 않는 메타) */
    merged['_schema'] = fresh['_schema'];
    fs.writeFileSync(p, JSON.stringify(merged, null, 2));
  } catch {
    fs.writeFileSync(p, freshJson);
  }
}

/* ─── My Videos Check — own channel performance (pro_v1) ────────────────────
   v2.89.43 — 전문 유튜브 분석가 수준의 종합 보고서. 이전엔 중간값 1줄 + 영상 목록만
   출력해서 "전문 에이전트답지 못함"이라는 사용자 피드백. 이제 채널 메타·요일별 성과·
   참여율·제목 키워드·인기 댓글·구체 액션 추천까지 포함. */
export function _seedYouTubeMyVideosCheck(toolsDir: string) {
  const py = _loadToolSeed('youtube/my_videos_check.py');
  const json = JSON.stringify({ LOOKBACK_DAYS: 30, TOP_N: 15, COMMENT_SAMPLES: 5 }, null, 2);
  const md = _loadToolSeed('youtube/my_videos_check.md');
  /* Force-upgrade the .py — older users on pre-telegram_v2 versions need
     the Secretary fallback so token doesn't have to be duplicated. */
  /* v2.89.43 — sentinel 'pro_v1' = 종합 분석 버전. 기존 사용자도 자동 업그레이드. */
  /* sentinel pro_v4 — HTML entity 디코드 + 빈 영상 시 stderr로. 기존 설치자 자동 업그레이드. */
  _seedFileForceUpgrade(path.join(toolsDir, 'my_videos_check.py'), py, 'pro_v4');
  _seedFile(path.join(toolsDir, 'my_videos_check.json'), json);
  /* v2.89.20 — Force upgrade .md heading from old "내 영상 체크" to "내 유튜브 채널 분석"
     for existing users. Sentinel = the new heading text. */
  _seedFileForceUpgrade(path.join(toolsDir, 'my_videos_check.md'), md, '내 유튜브 채널 분석');
}

/* ─── 📈 채널 완전 분석 — v2.89.21 ──────────────────────────────────────────
   API 키 + 채널 ID 만 있으면 돌아가는 통합 분석 도구. my_videos_check 는
   "이번 달 영상 떡상/부진 보기" 같은 단순 비교라면, 이건 채널 전체 그림:
   - 채널 메타 (구독자·총조회·영상수·가입일·평균 조회)
   - 최근 30일 업로드 패턴 (요일·시간대·길이)
   - 영상별 참여율 (좋아요/조회, 댓글/조회)
   - 인기 영상 vs 부진 영상의 제목·길이 패턴 비교
   - 다음 액션 자동 추천 (LLM 호출 없이 통계만으로)
   추가 입력 필요 없음. */
export function _seedYouTubeChannelFullAnalysis(toolsDir: string) {
  const py = _loadToolSeed('youtube/channel_full_analysis.py');
  const json = JSON.stringify({}, null, 2); /* 추가 입력 없음 */
  const md = _loadToolSeed('youtube/channel_full_analysis.md');
  _seedFile(path.join(toolsDir, 'channel_full_analysis.py'), py);
  _seedFile(path.join(toolsDir, 'channel_full_analysis.json'), json);
  _seedFile(path.join(toolsDir, 'channel_full_analysis.md'), md);
}

/* ─── Comment Harvester — pulls comments from watched channels ───────────── */
export function _seedYouTubeCommentHarvester(toolsDir: string) {
  const py = _loadToolSeed('youtube/comment_harvester.py');
  const json = JSON.stringify({
    VIDEOS_PER_CHANNEL: 5,
    COMMENTS_PER_VIDEO: 20,
    LOOKBACK_DAYS: 14,
  }, null, 2);
  const md = _loadToolSeed('youtube/comment_harvester.md');
  _seedFile(path.join(toolsDir, 'comment_harvester.py'), py);
  _seedFile(path.join(toolsDir, 'comment_harvester.json'), json);
  _seedFile(path.join(toolsDir, 'comment_harvester.md'), md);
}

/* ─── Competitor Brief — prescriptive next-actions from rivals ───────────── */
export function _seedYouTubeCompetitorBrief(toolsDir: string) {
  const py = _loadToolSeed('youtube/competitor_brief.py');
  const json = JSON.stringify({ TOP_N_PER_CHANNEL: 5, LOOKBACK_DAYS: 30 }, null, 2);
  const md = _loadToolSeed('youtube/competitor_brief.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'competitor_brief.py'), py, 'telegram_v3');
  _seedFile(path.join(toolsDir, 'competitor_brief.json'), json);
  _seedFile(path.join(toolsDir, 'competitor_brief.md'), md);
}

/* ─── Telegram Notify — sender + connectivity check ─────────────────────── */
export function _seedYouTubeTelegramNotify(toolsDir: string) {
  /* telegram_v3 — Secretary's tools/telegram_setup.json is canonical for
     telegram credentials (UI-managed). config.md and youtube_account.json
     remain as back-compat fallbacks. */
  const py = _loadToolSeed('youtube/telegram_notify.py');
  const json = JSON.stringify({}, null, 2);
  const md = _loadToolSeed('youtube/telegram_notify.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'telegram_notify.py'), py, 'telegram_v3');
  _seedFile(path.join(toolsDir, 'telegram_notify.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'telegram_notify.md'), md, 'Secretary 비서가 정답');
}

/* ─── Secretary · Telegram 연결 도구 ────────────────────────────────────────
   Secretary is the canonical home for Telegram credentials. This seeds a
   telegram_setup tool so non-developer users can input bot token + chat_id
   via the Skills section's standard ⚙️ tool config modal — no markdown
   editing required. The .json field names match what _resolve_telegram
   looks for, and the .py runs a connectivity test on ▶ click. */
export function _seedSecretaryTelegram(toolsDir: string) {
  const py = _loadToolSeed('secretary/telegram_setup.py');
  /* JSON keys are inferred as password by _inferToolFieldType because they
     match KEY|SECRET|TOKEN|API regex. CHAT_ID falls into 'text' because no
     match — exactly what we want. */
  const jsonStr = JSON.stringify({
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
  }, null, 2);
  const md = _loadToolSeed('secretary/telegram_setup.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'telegram_setup.py'), py, 'secretary_telegram_v2');
  _seedFile(path.join(toolsDir, 'telegram_setup.json'), jsonStr);
  _seedFileForceUpgrade(path.join(toolsDir, 'telegram_setup.md'), md, '⚙️ 버튼을 누르고 폼에 입력');
}

/* ─── Secretary · Google Calendar (iCal 읽기 전용) ──────────────────────────
   비서가 사용자의 Google Calendar 일정을 읽어서 데일리 브리핑/시간 비교에
   활용. v1은 OAuth 없이 iCal Secret URL 한 줄로 끝나는 read-only 모델.
   ▶ 실행하면 다가오는 N일치 일정을 _shared/calendar_cache.md 에 저장하고
   다른 에이전트가 readAgentSharedContext에서 자동 참조하게 됩니다. */
export function _seedSecretaryGoogleCalendar(toolsDir: string) {
  const py = _loadToolSeed('secretary/google_calendar.py');
  const jsonStr = JSON.stringify({
    ICAL_URL: '',
    DAYS_AHEAD: 14,
  }, null, 2);
  const md = _loadToolSeed('secretary/google_calendar.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'google_calendar.py'), py, 'secretary_calendar_v1');
  _seedFile(path.join(toolsDir, 'google_calendar.json'), jsonStr);
  _seedFileForceUpgrade(path.join(toolsDir, 'google_calendar.md'), md, '가벼운 읽기, iCal');
}

/* ─── Secretary · Google Calendar Write (OAuth 자동 일정 등록) ────────────
   The actual OAuth dance + event creation is driven from TypeScript (host
   has axios + can spin up a loopback HTTP server). This Python is purely a
   status/diagnostic tool: ▶ shows whether the connection is alive. */
export function _seedSecretaryGoogleCalendarWrite(toolsDir: string) {
  const py = _loadToolSeed('secretary/google_calendar_write.py');
  /* Empty-ish JSON — actual values come from the wizard. CALENDAR_ID and
     DEFAULT_DURATION_MINUTES are user-tunable via the standard ⚙️ form. */
  const jsonStr = JSON.stringify({
    CLIENT_ID: '',
    CLIENT_SECRET: '',
    REFRESH_TOKEN: '',
    CALENDAR_ID: 'primary',
    DEFAULT_DURATION_MINUTES: 60,
  }, null, 2);
  const md = _loadToolSeed('secretary/google_calendar_write.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'google_calendar_write.py'), py, 'secretary_calendar_write_v1');
  _seedFile(path.join(toolsDir, 'google_calendar_write.json'), jsonStr);
  _seedFileForceUpgrade(path.join(toolsDir, 'google_calendar_write.md'), md, '비서가 본인의 Google Calendar와 양방향 연결');
}
