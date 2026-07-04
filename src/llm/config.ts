/* v3.0 — LLM 설정·시크릿. src/llm/ 트리에서 유일하게 vscode 를 import 하는
   파일. API 키는 절대 설정(JSON)에 넣지 않고 SecretStorage 만 사용. */
import * as vscode from 'vscode';
import { ProviderKind, stripSlash } from './types';

const SECRET_KEY = 'connectAiLab.externalApiKey';

let _context: vscode.ExtensionContext | undefined;

export function setLLMContext(context: vscode.ExtensionContext) {
  _context = context;
}

export interface LLMSettings {
  /* 기존 설정 (legacy 엔진) */
  ollamaBase: string;
  defaultModel: string;
  timeoutMs: number;
  /* 신규 슬롯 설정 */
  fastModel: string;
  workerModel: string;
  externalKind: ProviderKind | 'none';
  externalBaseUrl: string;
  externalModel: string;
  externalDailyLimit: number;
}

export function getLLMSettings(): LLMSettings {
  const cfg = vscode.workspace.getConfiguration('connectAiLab');
  let ollamaBase = (cfg.get<string>('ollamaUrl', 'http://127.0.0.1:11434') || '').trim();
  if (!/^https?:\/\//i.test(ollamaBase)) ollamaBase = 'http://127.0.0.1:11434';
  const rawTimeout = cfg.get<number>('requestTimeout', 300);
  const timeoutSec = (typeof rawTimeout === 'number' && isFinite(rawTimeout))
    ? Math.min(1800, Math.max(5, rawTimeout)) : 300;
  const kindRaw = (cfg.get<string>('llm.externalKind', 'none') || 'none').trim();
  const kind: ProviderKind | 'none' =
    kindRaw === 'openai-compat' || kindRaw === 'anthropic-compat' ? kindRaw : 'none';
  return {
    ollamaBase: stripSlash(ollamaBase),
    defaultModel: (cfg.get<string>('defaultModel', '') || '').trim(),
    timeoutMs: timeoutSec * 1000,
    fastModel: (cfg.get<string>('llm.fastModel', '') || '').trim(),
    workerModel: (cfg.get<string>('llm.workerModel', '') || '').trim(),
    externalKind: kind,
    externalBaseUrl: stripSlash(cfg.get<string>('llm.externalBaseUrl', '') || ''),
    externalModel: (cfg.get<string>('llm.externalModel', '') || '').trim(),
    externalDailyLimit: cfg.get<number>('llm.externalDailyLimit', 200) ?? 200
  };
}

export async function getExternalApiKey(): Promise<string> {
  if (!_context) return '';
  return (await _context.secrets.get(SECRET_KEY)) || '';
}

export async function setExternalApiKey(key: string): Promise<void> {
  if (!_context) throw new Error('[llm:config] context not initialized');
  if (key) await _context.secrets.store(SECRET_KEY, key);
  else await _context.secrets.delete(SECRET_KEY);
}

/* v3.0 — 외부 두뇌 연결 마법사. 프리셋 URL은 예시이며 사용자가 수정 가능.
   흐름: 프리셋 선택 → baseUrl/model 확인 → 키 입력(password) → 저장 */
const PRESETS: { label: string; kind: ProviderKind; baseUrl: string; modelHint: string }[] = [
  { label: '💠 GLM Coding Plan (Anthropic 호환)', kind: 'anthropic-compat', baseUrl: 'https://api.z.ai/api/anthropic', modelHint: 'glm-4.7' },
  { label: '🪽 Nous Hermes (OpenAI 호환)', kind: 'openai-compat', baseUrl: 'https://inference-api.nousresearch.com/v1', modelHint: 'Hermes-4-405B' },
  { label: '🌐 OpenRouter (OpenAI 호환)', kind: 'openai-compat', baseUrl: 'https://openrouter.ai/api/v1', modelHint: 'anthropic/claude-sonnet-4' },
  { label: '⚙️ 직접 입력 (OpenAI 호환)', kind: 'openai-compat', baseUrl: '', modelHint: '' },
  { label: '⚙️ 직접 입력 (Anthropic 호환)', kind: 'anthropic-compat', baseUrl: '', modelHint: '' }
];

export function registerExternalBrainCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand('connect-ai-lab.connectExternalBrain', async () => {
    const pick = await vscode.window.showQuickPick(
      [...PRESETS.map(p => p.label), '🗑️ 외부 두뇌 연결 해제'],
      { placeHolder: '외부 두뇌(코딩 플랜/API) 프로바이더를 선택하세요' }
    );
    if (!pick) return;
    if (pick.startsWith('🗑️')) {
      await setExternalApiKey('');
      await vscode.workspace.getConfiguration('connectAiLab').update('llm.externalKind', 'none', vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('외부 두뇌 연결 해제됨 — 100% 로컬 모드로 동작합니다.');
      return;
    }
    const preset = PRESETS.find(p => p.label === pick)!;
    const baseUrl = await vscode.window.showInputBox({
      prompt: 'API Base URL', value: preset.baseUrl, ignoreFocusOut: true
    });
    if (!baseUrl) return;
    const model = await vscode.window.showInputBox({
      prompt: '모델 ID', value: preset.modelHint, ignoreFocusOut: true
    });
    if (!model) return;
    const key = await vscode.window.showInputBox({
      prompt: 'API 키 (SecretStorage에 암호화 저장 — 파일/설정에 남지 않음)',
      password: true, ignoreFocusOut: true
    });
    if (key === undefined) return;
    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    await cfg.update('llm.externalKind', preset.kind, vscode.ConfigurationTarget.Global);
    await cfg.update('llm.externalBaseUrl', baseUrl.trim(), vscode.ConfigurationTarget.Global);
    await cfg.update('llm.externalModel', model.trim(), vscode.ConfigurationTarget.Global);
    await setExternalApiKey(key.trim());
    /* 연결 확인 */
    const { buildProvider } = await import('./router');
    const p = buildProvider({ id: 'external', kind: preset.kind, baseUrl: baseUrl.trim(), model: model.trim(), apiKey: key.trim() });
    const h = await p.health();
    if (h.ok) {
      vscode.window.showInformationMessage(`🧠 외부 두뇌 연결 완료 (${model.trim()}, ${h.latencyMs}ms) — 개발자·리서처 에이전트가 이 두뇌를 사용합니다.`);
    } else {
      vscode.window.showWarningMessage(`외부 두뇌 저장은 됐지만 연결 확인 실패: ${h.error || '알 수 없음'} — URL/키를 확인하세요.`);
    }
  }));
}
