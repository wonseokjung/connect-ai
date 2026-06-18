/* company/agents-state.ts — 에이전트 채용(hired)/활성(active) 상태 + 토글 + 코더모델 추천.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: vscode(Webview 타입)·fs·path·os + ../paths(회사 폴더). 본문 역참조 없음
 * (_maybeRecommendCoderModel 의 webview 는 호출처가 넘겨주는 파라미터). */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getCompanyDir } from '../paths';

/* v2.89.103 — 채용 잠금 시스템. 일부 에이전트(현재: editor=루나)는 기본 잠금
   상태로 시작하고, 사용자가 PIN(0000)을 입력해야 활성화됨. 이력서·게임적 보상감
   조성 + 출시 단계 분리(루나는 "입사 준비 중" 컨셉). */
export const LOCKED_AGENTS_DEFAULT: Record<string, boolean> = { editor: true };

/* v2.89.107 — 활성/비활성 토글 시스템 (Option B).
   Luna(editor) 외에 매일 안 쓰일 가능성 큰 specialist는 기본 비활성으로 시작.
   사용자가 직원 패널에서 카드 클릭 → 활성화 confirm → 사용 가능.
   ALWAYS_ON: 핵심 워크플로우용 — 항상 활성, 토글 불가.
   OPTIONAL: 기본 비활성, 사용자 opt-in 시 활성화 (PIN 안 받음 — Luna만 PIN).
   기존 사용자 migration: hired.json에 entry 있으면 모든 OPTIONAL 자동 활성화. */
/* v2.89.110 — 자율성 + 합리적 기본값 균형. 4-tier:
   1. ALWAYS_ON: 시스템 요구 (off 불가)
   2. DEFAULT_ON: 첫 진입 시 자동 활성화. 사용자가 언제든 OFF 가능.
   3. OPTIONAL (DEFAULT_OFF): 기본 비활성, 사용자 opt-in.
   4. LOCKED (Luna): PIN 필요.
   v2.89.109가 너무 보수적이어서 (CEO만 ON) 새 사용자가 회사 모드 켜고 "유튜브 분석해줘"
   하면 빈 plan 나오는 사고. 핵심 4명을 기본 ON으로 되돌려 첫 경험 회복. */
export const ALWAYS_ON_AGENTS: Set<string> = new Set(['ceo']);
/* v2.89.156 — 데모용·신규 사용자 첫 경험 회복. "유튜브 + 매출 종합 보고서" 같은 합성 명령에서
   현빈(business) 가 비활성이라 조용히 drop 되던 사고 차단. 옵션 전체를 기본 ON 으로. Luna 만 LOCKED 유지.
   사용자는 언제든 직원 패널에서 개별 OFF 가능. */
export const DEFAULT_ON_AGENTS: Set<string> = new Set(['secretary', 'youtube', 'writer', 'designer', 'instagram', 'business', 'developer', 'researcher']);
export const OPTIONAL_AGENTS_DEFAULT: Set<string> = new Set(['secretary', 'youtube', 'writer', 'designer', 'instagram', 'business', 'developer', 'researcher']);

export function _hiredJsonPath(): string {
  return path.join(getCompanyDir(), '_shared', 'hired.json');
}

export function _activeJsonPath(): string {
  return path.join(getCompanyDir(), '_shared', 'active.json');
}

export function readHiredAgents(): Record<string, { hiredAt: string }> {
  try {
    const p = _hiredJsonPath();
    if (!fs.existsSync(p)) return {};
    const data = JSON.parse(fs.readFileSync(p, 'utf-8') || '{}');
    return (data && typeof data === 'object') ? data : {};
  } catch { return {}; }
}

export function isAgentHired(id: string): boolean {
  /* 잠금 대상이 아니면 항상 채용된 상태(별도 표시 없음) */
  if (!LOCKED_AGENTS_DEFAULT[id]) return true;
  const map = readHiredAgents();
  return !!map[id];
}

export function markAgentHired(id: string): boolean {
  try {
    const dir = path.join(getCompanyDir(), '_shared');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
    const f = _hiredJsonPath();
    let cur: Record<string, any> = {};
    try { cur = JSON.parse(fs.readFileSync(f, 'utf-8') || '{}'); } catch { /* malformed */ }
    cur[id] = { hiredAt: new Date().toISOString() };
    fs.writeFileSync(f, JSON.stringify(cur, null, 2));
    /* PIN 통과한 에이전트는 자동으로 active 등록 */
    setAgentActive(id, true);
    return true;
  } catch { return false; }
}

/* v2.89.107 — 활성 상태 영구 저장. active.json 의 형식:
   {
     "_migrated": true,       // 기존 사용자 migration 완료 표시
     "instagram": {activatedAt: ISO},
     "business": {activatedAt: ISO},
     ...
   } */
export function readActiveAgents(): Record<string, { activatedAt: string }> {
  try {
    const p = _activeJsonPath();
    if (!fs.existsSync(p)) {
      /* 첫 실행 + hired.json 에 entry 있으면 → 기존 사용자로 간주, 모든 OPTIONAL 자동 활성화 */
      const hired = readHiredAgents();
      const isExistingUser = Object.keys(hired).filter(k => !k.startsWith('_')).length > 0;
      if (isExistingUser) {
        const seed: Record<string, any> = { _migrated: true };
        for (const id of OPTIONAL_AGENTS_DEFAULT) {
          seed[id] = { activatedAt: new Date().toISOString() };
        }
        try {
          const dir = path.join(getCompanyDir(), '_shared');
          try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
          fs.writeFileSync(p, JSON.stringify(seed, null, 2));
        } catch { /* readonly fs */ }
        return seed;
      }
      /* v2.89.110 — 새 사용자: DEFAULT_ON 4명을 시드로 활성화. 첫 진입에 회사 모드
         쓸 수 있는 기본 팀을 갖춤 (사용자가 원하면 언제든 비활성화 가능). */
      const seed: Record<string, any> = { _migrated: true, _migrated_v2: true };
      for (const id of DEFAULT_ON_AGENTS) {
        seed[id] = { activatedAt: new Date().toISOString(), seeded: true };
      }
      try {
        const dir = path.join(getCompanyDir(), '_shared');
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
        fs.writeFileSync(p, JSON.stringify(seed, null, 2));
      } catch { /* readonly fs */ }
      return seed;
    }
    const data = JSON.parse(fs.readFileSync(p, 'utf-8') || '{}');
    if (!data || typeof data !== 'object') return {};
    /* v2.89.109 — ALWAYS_ON 축소(CEO만)에 따른 2차 마이그레이션. v2.89.107 사용자는
       active.json에 _migrated:true 만 있고 OPTIONAL 4명만 활성화돼있을 수 있음. 그 경우
       이전엔 ALWAYS_ON 이었던 secretary·youtube·writer·designer 도 자동 활성화 (사용자
       경험 유지). 한 번만 실행: _migrated_v2 플래그로 표시. */
    if (data._migrated && !data._migrated_v2) {
      const carryOver = ['secretary', 'youtube', 'writer', 'designer'];
      let touched = false;
      for (const id of carryOver) {
        if (!data[id]) {
          data[id] = { activatedAt: new Date().toISOString() };
          touched = true;
        }
      }
      data._migrated_v2 = true;
      if (touched) {
        try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch { /* ignore */ }
      }
    }
    /* v2.89.156 — 모든 OPTIONAL agents 기본 ON. 종합 보고서 (유튜브+매출) 같은 합성 명령
       에서 옵션 에이전트가 silently drop 되던 문제 해결. 한 번만 실행: _migrated_v3 플래그. */
    if (data._migrated && !data._migrated_v3) {
      let touched = false;
      for (const id of OPTIONAL_AGENTS_DEFAULT) {
        if (!data[id]) {
          data[id] = { activatedAt: new Date().toISOString(), seeded_v3: true };
          touched = true;
        }
      }
      data._migrated_v3 = true;
      if (touched) {
        try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch { /* ignore */ }
      } else {
        try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch { /* ignore */ }
      }
    }
    return data;
  } catch { return {}; }
}

/* 핵심 헬퍼: 에이전트가 현재 사용 가능한지.
   - ALWAYS_ON: 무조건 true
   - LOCKED (Luna): hired.json 에 entry 있으면 true (PIN 통과)
   - OPTIONAL: active.json 에 entry 있으면 true
   - 그 외 (정의 안 된 에이전트): true (기본값) */
export function isAgentActive(id: string): boolean {
  if (ALWAYS_ON_AGENTS.has(id)) return true;
  if (LOCKED_AGENTS_DEFAULT[id]) return isAgentHired(id);
  if (OPTIONAL_AGENTS_DEFAULT.has(id)) {
    const map = readActiveAgents();
    return !!map[id];
  }
  return true;
}

export function setAgentActive(id: string, active: boolean): boolean {
  try {
    const dir = path.join(getCompanyDir(), '_shared');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
    const f = _activeJsonPath();
    let cur: Record<string, any> = {};
    try { cur = JSON.parse(fs.readFileSync(f, 'utf-8') || '{}'); } catch { /* malformed */ }
    if (active) {
      cur[id] = { activatedAt: new Date().toISOString() };
    } else {
      delete cur[id];
    }
    cur._migrated = true;
    fs.writeFileSync(f, JSON.stringify(cur, null, 2));
    return true;
  } catch { return false; }
}

/* 에이전트가 사용자 토글 가능한지 (UI에서 설명용) */
export function isAgentTogglable(id: string): boolean {
  return OPTIONAL_AGENTS_DEFAULT.has(id) || !!LOCKED_AGENTS_DEFAULT[id];
}

/* v2.89.112 — 코다리(developer) 활성화 시 시니어 코더 모델 추천. 한 번만 표시 (active.json
   에 _coder_recommended 플래그 기록). 사용자 시스템 메모리 추측해서 적합한 모델 추천:
   < 8GB → qwen2.5-coder:1.5b 또는 7b
   8~16GB → qwen2.5-coder:14b
   > 16GB → deepseek-coder-v2:16b 또는 qwen2.5-coder:32b */
export function _maybeRecommendCoderModel(webview: vscode.Webview) {
  try {
    const active = readActiveAgents();
    if (active._coder_recommended) return;
    let recommendation: { name: string; size: string; reason: string };
    try {
      const totalGB = Math.round(os.totalmem() / (1024 ** 3));
      if (totalGB >= 32) {
        recommendation = { name: 'deepseek-coder-v2:16b', size: '10GB', reason: `시스템 RAM ${totalGB}GB — 최고급 코더 모델 가능` };
      } else if (totalGB >= 16) {
        recommendation = { name: 'qwen2.5-coder:14b', size: '9GB', reason: `시스템 RAM ${totalGB}GB — 권장 코더 모델` };
      } else if (totalGB >= 8) {
        recommendation = { name: 'qwen2.5-coder:7b', size: '4.4GB', reason: `시스템 RAM ${totalGB}GB — 균형 잡힌 코더 모델` };
      } else {
        recommendation = { name: 'qwen2.5-coder:1.5b', size: '1GB', reason: `시스템 RAM ${totalGB}GB — 작은 코더 모델 (메모리 절약)` };
      }
    } catch {
      recommendation = { name: 'qwen2.5-coder:14b', size: '9GB', reason: '권장 코더 모델' };
    }
    const note =
      `\n💻 **코다리 코딩 능력 강화 팁**\n` +
      `현재 일반 모델로 동작합니다. 코딩 전용 모델로 바꾸면 결과 품질이 크게 올라가요.\n\n` +
      `**추천: \`${recommendation.name}\`** (${recommendation.size}) — ${recommendation.reason}\n\n` +
      `설치:\n` +
      `\`\`\`\nollama pull ${recommendation.name}\n\`\`\`\n` +
      `설치 후 사이드바 위 모델 선택 메뉴에서 고르세요. (이 안내는 한 번만 표시됩니다)`;
    try { webview.postMessage({ type: 'systemNote', value: note }); } catch { /* ignore */ }
    /* 플래그 기록 — active.json 은 사실 mixed type (메타 키 _migrated 등) 보관 가능 */
    (active as any)._coder_recommended = true;
    try {
      const dir = path.join(getCompanyDir(), '_shared');
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
      fs.writeFileSync(_activeJsonPath(), JSON.stringify(active, null, 2));
    } catch { /* readonly fs */ }
  } catch { /* never block */ }
}
