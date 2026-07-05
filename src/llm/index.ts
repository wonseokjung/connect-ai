/* v3.0 — LLM 모듈 공개 API. extension.ts 는 이 파일만 import 한다. */
import { getLLMSettings, getExternalApiKey, setLLMContext, registerExternalBrainCommand } from './config';
import { routeChatWithEnv, RouteRequest, slotForAgent, resolveSlotConfigs, buildProvider } from './router';
import { readUsage } from './usage';
import { ChatResult, LLMSlot } from './types';

export { slotForAgent, buildProvider, resolveSlotConfigs, readUsage };
export * from './types';

export function initLLM(context: Parameters<typeof setLLMContext>[0]) {
  setLLMContext(context);
  registerExternalBrainCommand(context);
}

/** 설정·시크릿을 읽어 라우팅 호출. extension.ts 의 표준 진입점. */
export async function routeChat(req: RouteRequest): Promise<ChatResult> {
  const s = getLLMSettings();
  const externalApiKey = await getExternalApiKey();
  return routeChatWithEnv({ ...s, externalApiKey }, req);
}

/** UI 표시용 — 현재 슬롯 구성 + 오늘 외부 사용량 요약 */
export async function getLLMStatus() {
  const s = getLLMSettings();
  const externalApiKey = await getExternalApiKey();
  const cfgs = resolveSlotConfigs({ ...s, externalApiKey });
  const usage = readUsage();
  return {
    slots: {
      fast: cfgs.fast ? { model: cfgs.fast.model, kind: cfgs.fast.kind } : null,
      worker: cfgs.worker ? { model: cfgs.worker.model, kind: cfgs.worker.kind } : null,
      external: cfgs.external ? { model: cfgs.external.model, kind: cfgs.external.kind } : null
    },
    externalToday: usage.externalCalls,
    externalDailyLimit: s.externalDailyLimit
  };
}
