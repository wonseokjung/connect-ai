/* core/bridge.ts — 포트 4825 로컬 브리지 관련 잎 유틸 (HTTP 본문 읽기·버전·인계).
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: http·axios·child_process 뿐. extension 내부 상태 참조 없음.
 * ⚠️ _CONNECT_AI_VERSION 은 package.json 의 version 과 동기 유지. */
import * as http from 'http';
import axios from 'axios';
import { spawnSync } from 'child_process';

export const MAX_HTTP_BODY = 5 * 1024 * 1024; // 5MB cap on /api/* request bodies

/* v2.89.154 — 현재 익스텐션 버전. /ping 응답에 포함시켜서 다른 인스턴스가 우리 거인지
   식별 + 옛 버전인지 판단. package.json 의 version 과 동기 유지. */
export const _CONNECT_AI_VERSION = '2.89.156';

/**
 * Drain an http request body with a hard size cap. Resolves to the body string,
 * or rejects with an Error("BODY_TOO_LARGE") if the cap is exceeded.
 */
export function readRequestBody(req: http.IncomingMessage, maxBytes = MAX_HTTP_BODY): Promise<string> {
    return new Promise((resolve, reject) => {
        let received = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > maxBytes) {
                reject(new Error('BODY_TOO_LARGE'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

/* v2.89.127 — semver 비교. true 이면 a < b (a 가 옛 버전). */
export function _versionLessThan(a: string, b: string): boolean {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const ai = pa[i] || 0, bi = pb[i] || 0;
        if (ai !== bi) return ai < bi;
    }
    return false;
}

/* v2.89.127 — 포트 4825에 이미 떠있는 Bridge가 우리 것인지 식별.
   - ours: connect-ai-bridge 식별자
   - version: 그 인스턴스 버전 (옛 버전이면 자동 인계 대상)
   - pid: 종료 대상 PID */
export async function _probeExistingBridge(): Promise<{ ours: boolean; version: string; pid: number }> {
    try {
        const r = await axios.get('http://127.0.0.1:4825/ping', { timeout: 1500 });
        const d = r.data;
        if (d && d.app === 'connect-ai-bridge') {
            return { ours: true, version: String(d.version || ''), pid: Number(d.pid || 0) };
        }
    } catch { /* not running or different app */ }
    return { ours: false, version: '', pid: 0 };
}

/* v2.89.120 — 특정 TCP 포트 점유 프로세스 강제 종료 (cross-platform).
   "이걸 메인으로 하기" UX 에 사용: 다른 Anti-Gravity 인스턴스가 4825 잡고 있을 때
   해당 PID 찾아 SIGKILL. 종료된 PID 배열 반환 (빈 배열이면 미발견).
   - macOS/Linux: `lsof -ti:<port>` → 한 줄당 PID → `kill -9 <pid>`
   - Windows: `netstat -ano` 파싱 → LISTENING 행의 마지막 컬럼 PID → `taskkill /F /PID`
   본인 PID는 안 죽임 (자기 자신 자살 방지). */
export function _killProcessesOnPort(port: number): number[] {
    const ourPid = process.pid;
    const killed: number[] = [];
    try {
        if (process.platform === 'win32') {
            const r = spawnSync('netstat', ['-ano'], { encoding: 'utf-8', timeout: 5000 });
            const lines = (r.stdout || '').split(/\r?\n/);
            const pidSet = new Set<number>();
            for (const line of lines) {
                /* LISTENING 행만, 포트 매칭 */
                if (!/LISTENING/i.test(line)) continue;
                if (!new RegExp(`[:.]${port}\\b`).test(line)) continue;
                const m = line.trim().split(/\s+/);
                const pid = parseInt(m[m.length - 1], 10);
                if (!isNaN(pid) && pid > 0 && pid !== ourPid) pidSet.add(pid);
            }
            for (const pid of pidSet) {
                const k = spawnSync('taskkill', ['/F', '/PID', String(pid)], { encoding: 'utf-8', timeout: 3000 });
                if (k.status === 0) killed.push(pid);
            }
        } else {
            /* macOS / Linux: lsof -ti:<port> */
            const r = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf-8', timeout: 5000 });
            const pids = (r.stdout || '').split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(p => !isNaN(p) && p > 0 && p !== ourPid);
            for (const pid of pids) {
                const k = spawnSync('kill', ['-9', String(pid)], { encoding: 'utf-8', timeout: 3000 });
                if (k.status === 0) killed.push(pid);
            }
        }
    } catch (e) {
        console.error('[Connect AI] _killProcessesOnPort 실패:', e);
    }
    return killed;
}
