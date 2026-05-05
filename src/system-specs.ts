/* v2.89.65 — 시스템 사양 감지 + 모델 메모리 추정 모듈.
 *
 * 자동 오케스트레이션이 사용자 머신이 실제로 로드 가능한 모델만 할당하기 위해 RAM·CPU·
 * 플랫폼을 측정. 16GB RAM 머신에 70B 모델 할당해서 LM Studio가 "model failed to load
 * (7.06 GB)" 에러로 죽던 문제를 사전 차단.
 *
 * 사용처:
 * - extension.ts에서 자동 모델 매핑 시 호출
 * - 모델 오케스트레이션 webview에 사양 정보 표시
 *
 * 캐시: 한 번 측정 후 재사용 (시스템 RAM은 런타임 중 변하지 않음).
 */

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
  /* 보수적 메모리 예산. Apple Silicon은 0.65, 그 외는 0.5 (OS·브라우저·VS Code 자체가
     꽤 잡음). 16GB Mac이면 ~10.4GB가 모델용으로 사용 가능. */
  const ratio = isAppleSilicon ? 0.65 : 0.5;
  const safeModelBudgetGB = Math.max(2, Math.floor(totalRamGB * ratio));
  const summary = `${platform === 'darwin' ? 'macOS' : platform} · ${arch}${isAppleSilicon ? ' (Apple Silicon)' : ''} · RAM ${totalRamGB.toFixed(0)}GB · CPU ${cpuModel.slice(0, 40)} (${cpus.length} cores)`;
  _cachedSpecs = {
    totalRamGB, freeRamGB, cpuModel, cpuCount: cpus.length,
    platform, arch, isAppleSilicon, safeModelBudgetGB, summary,
  };
  return _cachedSpecs;
}

/* 모델 메모리 사용량 추정. 모델 ID에서 파라미터 수 추출해서 4-bit GGUF 기준 환산.
   - 1B 파라미터 ≈ 0.6GB (4-bit 양자화 + KV 캐시 약간 + 오버헤드 1GB).
   - MoE 모델은 활성 파라미터 기준이지만 실제로는 전체가 메모리에 로드되니 둘 다 본다.
   - 사이즈 못 읽으면 기본 7B 가정. */
export function estimateModelMemoryGB(modelId: string): number {
  const id = modelId.toLowerCase();
  const paramM = id.match(/(\d+(?:\.\d+)?)\s*b\b/);
  const totalB = paramM ? parseFloat(paramM[1]) : 7; /* 미확인 시 7B 기본값 */
  /* 양자화 단서: q4·q5·q6·q8 / 4bit / awq / gguf */
  let bytesPerParam = 0.6; /* 4-bit 기본 */
  if (/q8|8bit|fp8/i.test(id)) bytesPerParam = 1.0;
  if (/q5|5bit/i.test(id)) bytesPerParam = 0.7;
  if (/q6|6bit/i.test(id)) bytesPerParam = 0.8;
  if (/fp16|f16|bf16/i.test(id)) bytesPerParam = 2.0;
  return totalB * bytesPerParam + 1.0; /* +1GB 오버헤드 (KV 캐시·런타임) */
}
