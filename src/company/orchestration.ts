/* company/orchestration.ts — 에이전트별 모델 배정 저장 + 설치모델 조회 + 자동 오케스트레이션.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: fs·path·axios + ../paths(회사 폴더) + ../config(getConfig·엔진감지)
 *       + ../system-specs(메모리 안전 필터). 본문 역참조 없음. */
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { getCompanyDir } from '../paths';
import { getConfig, _isLMStudioEngine } from '../config';
import { getSystemSpecs, estimateModelMemoryGB } from '../system-specs';

/* v2.89.26 — 에이전트별 모델 라우팅. CEO·YouTube·디자이너 등 각자 다른
   로컬 LLM 사용 (작은 모델은 라우팅·결정에, 큰 모델은 분석·창작에).
   설정 파일: _shared/agent_models.json. 비어있으면 default 모델 사용. */
export function _agentModelsPath(): string {
  return path.join(getCompanyDir(), '_shared', 'agent_models.json');
}
export function readAgentModelMap(): Record<string, string> {
  try {
    const p = _agentModelsPath();
    if (!fs.existsSync(p)) return {};
    const data = JSON.parse(fs.readFileSync(p, 'utf-8') || '{}');
    return (data && typeof data === 'object') ? data : {};
  } catch { return {}; }
}
export function writeAgentModelMap(map: Record<string, string>) {
  try {
    const p = _agentModelsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(map, null, 2));
  } catch (e: any) {
    console.warn('[agentModels] write failed:', e?.message || e);
  }
}
export function getAgentModel(agentId: string, fallback: string): string {
  const map = readAgentModelMap();
  return (map[agentId] || '').trim() || fallback;
}
/* v2.89.27 — 모델 자동 오케스트레이션. 설치된 모델 + 에이전트 역할을 매칭해서
   최적 배정 추천. 사용자는 "✨ 자동 추천" 버튼 한 번으로 완성된 매핑 받음. */
type ModelTier = 'tiny' | 'small' | 'medium' | 'large' | 'vision' | 'coder';
export function _classifyModel(modelId: string): ModelTier[] {
  const id = modelId.toLowerCase();
  const tiers: ModelTier[] = [];
  /* 비전 모델 — 이미지 입력 가능 */
  if (/vision|llava|vl\b|glm.*v|gemma.?4.*e|qwen.?2.?vl|moondream/i.test(id)) tiers.push('vision');
  /* 코드 특화 */
  if (/coder|code-?(?:llama|qwen)/i.test(id)) tiers.push('coder');
  /* 사이즈 — 우선순위: 명시된 파라미터 → 모델 이름 패턴 */
  const paramM = id.match(/(\d+(?:\.\d+)?)\s*b\b/);
  let paramB = paramM ? parseFloat(paramM[1]) : 0;
  /* MoE 모델은 활성 파라미터 기준으로 분류 (예: "24b a2b" = 활성 2B) */
  const moeM = id.match(/a(\d+(?:\.\d+)?)b/);
  if (moeM) paramB = parseFloat(moeM[1]);
  /* LFM 패밀리 + Phi + Gemma E2B 같이 작은 모델 패턴 */
  const isExplicitlyTiny = /lfm2\.?5|gemma.?4.?e2b|phi-?3|llama.?3\.?2.?(?:1b|3b)|qwen.?2\.?5.?(?:0\.5b|1\.5b|3b)/i.test(id);
  if (isExplicitlyTiny || (paramB > 0 && paramB <= 3)) tiers.push('tiny');
  else if (paramB <= 8) tiers.push('small');
  else if (paramB <= 14) tiers.push('medium');
  else if (paramB > 14) tiers.push('large');
  else tiers.push('small'); /* 사이즈 알 수 없으면 small로 안전 폴백 */
  return tiers;
}
export function _autoOrchestrateModelMap(installed: { id: string; backend: string }[]): Record<string, string> {
  if (installed.length === 0) return {};
  /* v2.89.36 — 메모리 안전 필터. 사용자 머신이 못 돌리는 큰 모델은 후보에서 제외.
     이전엔 16GB Mac에 70B 모델 할당해서 LM Studio가 죽었음. */
  const specs = getSystemSpecs();
  const safeInstalled = installed.filter(m => {
    const need = estimateModelMemoryGB(m.id);
    return need <= specs.safeModelBudgetGB;
  });
  /* 안전 필터로 다 잘려나가면 제일 작은 1개라도 남기기 (그래야 사용자가 일단 돌릴 수 있음) */
  const candidates = safeInstalled.length > 0 ? safeInstalled : (
    installed.length > 0
      ? [installed.slice().sort((a, b) => estimateModelMemoryGB(a.id) - estimateModelMemoryGB(b.id))[0]]
      : []
  );
  /* 모델별 tier 분류 + 우선순위 정렬 */
  const byTier: Record<ModelTier, string[]> = { tiny: [], small: [], medium: [], large: [], vision: [], coder: [] };
  for (const m of candidates) {
    const tiers = _classifyModel(m.id);
    for (const t of tiers) byTier[t].push(m.id);
  }
  /* 에이전트별 선호 tier 순서 — 첫번째가 best, 못 찾으면 다음으로 폴백 */
  const ROLE_PREFERENCES: Record<string, ModelTier[]> = {
    ceo: ['tiny', 'small', 'medium'],         /* 라우팅 결정 — 빠른 게 최우선 */
    secretary: ['small', 'tiny', 'medium'],   /* 일정·대화 — 균형 */
    youtube: ['large', 'medium', 'small'],    /* 데이터 분석 — 큰 모델 */
    researcher: ['large', 'medium', 'small'], /* 리서치 — 큰 모델 */
    business: ['medium', 'large', 'small'],   /* KPI·전략 — 추론 */
    writer: ['medium', 'small', 'large'],     /* 창작 — 중간 */
    editor: ['medium', 'small'],              /* 영상 디렉션 */
    designer: ['vision', 'medium', 'small'],  /* 비전 우선 */
    developer: ['coder', 'large', 'medium'],  /* 코드 우선 */
    instagram: ['medium', 'small'],
  };
  const map: Record<string, string> = {};
  for (const agentId of Object.keys(ROLE_PREFERENCES)) {
    const prefs = ROLE_PREFERENCES[agentId];
    for (const tier of prefs) {
      const candidates = byTier[tier];
      if (candidates && candidates.length > 0) {
        map[agentId] = candidates[0];
        break;
      }
    }
  }
  return map;
}

/* v2.89.67 — 사용자가 선택한 AI 엔진(설정의 ollamaUrl 포트로 판별)만 쿼리.
   이전엔 Ollama+LM Studio 둘 다 무조건 쿼리해서 한 엔진만 쓰는 사용자한테
   다른 엔진 모델이 오케스트레이션 드롭다운에 섞여 나옴 → 모델 선택해도
   "model not found" 에러. 이제 활성 엔진의 모델만 보여줌.

   엔진 판별: ollamaUrl 설정 포트로
   - 1234 또는 'v1' 경로 포함 → LM Studio
   - 11434 또는 그 외 → Ollama (default)

   양 엔진 둘 다 띄운 사용자(드물지만) 위해 fallback: 활성 엔진이 비어있으면
   다른 엔진도 시도. */
export async function listInstalledModels(): Promise<{ id: string; backend: 'ollama' | 'lmstudio' }[]> {
  const out: { id: string; backend: 'ollama' | 'lmstudio' }[] = [];
  const { ollamaBase } = getConfig();
  const isLMStudio = _isLMStudioEngine(ollamaBase);
  const queryOllama = async () => {
    try {
      const r = await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 1500 });
      const models = r.data?.models || [];
      for (const m of models) {
        if (m?.name) out.push({ id: m.name, backend: 'ollama' });
      }
    } catch { /* ollama not running */ }
  };
  const queryLMStudio = async () => {
    try {
      const r = await axios.get('http://127.0.0.1:1234/v1/models', { timeout: 1500 });
      const models = r.data?.data || [];
      for (const m of models) {
        if (m?.id) out.push({ id: m.id, backend: 'lmstudio' });
      }
    } catch { /* LM Studio not running */ }
  };
  /* 활성 엔진만 쿼리. */
  if (isLMStudio) {
    await queryLMStudio();
    /* LM Studio가 비어있고 Ollama가 살아있으면 fallback (양쪽 다 써본 사용자 케이스) */
    if (out.length === 0) await queryOllama();
  } else {
    await queryOllama();
    if (out.length === 0) await queryLMStudio();
  }
  return out;
}
