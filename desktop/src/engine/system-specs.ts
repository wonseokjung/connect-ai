// v0.4.10 — 시스템 사양 감지 + 모델 메모리 추정 (데스크톱용).
// 확장(src/system-specs.ts)을 복제 — vscode 의존 없는 순수 로직.
// 사용처: hfmodels recommendedForRam (모델 추천), 자율 사이클 (컨텍스트 크기 조정).

import * as os from 'os';

export type SystemSpecs = {
  totalRamGB: number;
  freeRamGB: number;
  cpuModel: string;
  cpuCount: number;
  platform: NodeJS.Platform;
  arch: string;
  isAppleSilicon: boolean;
  /* LLM 모델 로드에 안전하게 쓸 수 있는 메모리 한도(GB).
     Apple Silicon은 unified memory로 GPU 가속이 RAM 직접 접근이라 더 후하게 잡음.
     OS·다른 앱이 쓰는 메모리 고려해서 보수적 비율 적용. */
  safeModelBudgetGB: number;
  /* 사람용 한 줄 요약 — UI 표시·로그용 */
  summary: string;
};

let _cachedSpecs: SystemSpecs | null = null;

export function getSystemSpecs(): SystemSpecs {
  if (_cachedSpecs) return _cachedSpecs;
  const totalRamGB = os.totalmem() / (1024 ** 3);
  const freeRamGB = os.freemem() / (1024 ** 3);
  const cpus = os.cpus() || [];
  const cpuModel = (cpus[0]?.model || 'unknown').replace(/\s+/g, ' ').trim();
  const platform = os.platform();
  const arch = os.arch();
  /* Apple Silicon 감지: macOS arm64 + cpu.model에 "Apple M" 접두사 */
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64' && /Apple\s+M/i.test(cpuModel);
  /* 보수적 메모리 예산. Apple Silicon은 0.65, 그 외는 0.5 (OS·앱이 꽤 잡음). */
  const ratio = isAppleSilicon ? 0.65 : 0.5;
  const safeModelBudgetGB = Math.max(2, Math.floor(totalRamGB * ratio));
  const summary = `${platform === 'darwin' ? 'macOS' : platform} · ${arch}${isAppleSilicon ? ' (Apple Silicon)' : ''} · RAM ${totalRamGB.toFixed(0)}GB · CPU ${cpuModel.slice(0, 40)} (${cpus.length} cores)`;
  _cachedSpecs = {
    totalRamGB, freeRamGB, cpuModel, cpuCount: cpus.length,
    platform, arch, isAppleSilicon, safeModelBudgetGB, summary,
  };
  return _cachedSpecs;
}

/* 모델 메모리 사용량 추정. 모델 ID(또는 repo명)에서 파라미터 수 추출해서 4-bit GGUF 기준 환산. */
export function estimateModelMemoryGB(modelId: string): number {
  const id = modelId.toLowerCase();
  const paramM = id.match(/(\d+(?:\.\d+)?)\s*b\b/);
  const totalB = paramM ? parseFloat(paramM[1]) : 7;
  let bytesPerParam = 0.6; /* 4-bit 기본 */
  if (/q8|8bit|fp8/i.test(id)) bytesPerParam = 1.0;
  if (/q5|5bit/i.test(id)) bytesPerParam = 0.7;
  if (/q6|6bit/i.test(id)) bytesPerParam = 0.8;
  if (/fp16|f16|bf16/i.test(id)) bytesPerParam = 2.0;
  return totalB * bytesPerParam + 1.0; /* +1GB 오버헤드 (KV 캐시·런타임) */
}
