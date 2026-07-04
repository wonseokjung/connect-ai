/* v3.0 — 외부 API 일일 사용량 카운터. 과금 폭주 방지 가드레일.
   저장 위치: ~/.connect-ai-lab/llm_usage.json  (vscode 비의존) */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface UsageFile { date: string; externalCalls: number; }

function _usagePath(): string {
  return path.join(os.homedir(), '.connect-ai-lab', 'llm_usage.json');
}

function _today(): string {
  return new Date().toISOString().slice(0, 10); /* YYYY-MM-DD */
}

export function readUsage(): UsageFile {
  try {
    const raw = JSON.parse(fs.readFileSync(_usagePath(), 'utf-8'));
    if (raw && raw.date === _today() && typeof raw.externalCalls === 'number') return raw;
  } catch { /* 파일 없음/파손 — 새로 시작 */ }
  return { date: _today(), externalCalls: 0 };
}

export function recordExternalCall(): void {
  const u = readUsage();
  u.externalCalls += 1;
  try {
    fs.mkdirSync(path.dirname(_usagePath()), { recursive: true });
    fs.writeFileSync(_usagePath(), JSON.stringify(u, null, 2));
  } catch (e: any) {
    console.warn('[llm:usage] write failed:', e?.message || e);
  }
}

/** dailyLimit <= 0 이면 무제한 */
export function externalBudgetLeft(dailyLimit: number): boolean {
  if (!dailyLimit || dailyLimit <= 0) return true;
  return readUsage().externalCalls < dailyLimit;
}
