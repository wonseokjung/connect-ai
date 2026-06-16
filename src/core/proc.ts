/* core/proc.ts — 프로세스 실행·Python 감지·OS 파일열기 잎 유틸.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: child_process·fs·path·os·vscode(설정 읽기만). extension 내부 상태 참조 없음. */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';

/* v2.89.93 — OS 파일 익스플로러로 파일/폴더 열기 (Finder · Windows Explorer ·
   Linux GNOME Files). 결과 메시지를 반환해서 호출처가 사용자에게 보여줄 수 있게. */
export function _revealInOsExplorer(targetPath: string): { ok: boolean; message: string } {
    try {
        if (!fs.existsSync(targetPath)) {
            return { ok: false, message: `존재하지 않는 경로: ${targetPath}` };
        }
        if (process.platform === 'darwin') {
            spawn('open', ['-R', targetPath], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'win32') {
            spawn('explorer.exe', ['/select,', targetPath], { detached: true, stdio: 'ignore' }).unref();
        } else {
            const dir = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
            spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
        }
        return { ok: true, message: `🗂 익스플로러 열림: ${targetPath}` };
    } catch (e: any) {
        return { ok: false, message: `익스플로러 열기 실패: ${e?.message || e}` };
    }
}

/* v2.89.93 — 기본 앱으로 파일 열기 (이미지·PDF·웹페이지·.docx 등). */
export function _openInDefaultApp(targetPath: string): { ok: boolean; message: string } {
    try {
        if (!fs.existsSync(targetPath)) {
            return { ok: false, message: `존재하지 않는 경로: ${targetPath}` };
        }
        if (process.platform === 'darwin') {
            spawn('open', [targetPath], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'win32') {
            spawn('cmd.exe', ['/c', 'start', '', targetPath], { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' }).unref();
        }
        return { ok: true, message: `🚀 기본 앱으로 열림: ${targetPath}` };
    } catch (e: any) {
        return { ok: false, message: `파일 열기 실패: ${e?.message || e}` };
    }
}

/* v2.89.152 — 크로스플랫폼 + 자동 감지 + 사용자 override.
   이전 v2.89.88 은 단순 `python3` (맥) / `python` (윈도우) 분기였는데:
     - 윈도우 사용자가 `py` 또는 `python3` 으로 설치한 경우 fail
     - 맥에서 `python3` 미설치 (신규 macOS, Xcode CLT 없음) 시 fail
     - venv/pyenv 환경 무시
     - PATH 미동기화 (Anti-Gravity 가 시스템 PATH 못 잡음) 시 spawn 실패
   해결:
     1. 사용자 설정 connectAiLab.pythonPath 가장 강함
     2. 후보 cmd 순차 시도 (which/where 로 실제 존재 확인) — 첫 성공한 거 캐시
     3. 캐시 못 찾으면 fallback 명령 (사용자에게 안내)
*/
let _pythonCmdCache: string | null = null;

export function _detectPythonCmd(): string {
    /* 1. 사용자 명시 경로 — 절대 경로 또는 명령 이름. 가장 강함. */
    try {
        const cfg = vscode.workspace.getConfiguration('connectAiLab');
        const override = (cfg.get<string>('pythonPath') || '').trim();
        if (override) {
            /* 절대 경로면 그대로, 명령 이름이면 PATH 검색 */
            try {
                const cp = require('child_process');
                const r = cp.spawnSync(override, ['--version'], { encoding: 'utf-8', timeout: 4000 });
                if (r.status === 0 || /python\s/i.test((r.stdout || '') + (r.stderr || ''))) {
                    return override;
                }
            } catch { /* fall through */ }
        }
    } catch { /* config 못 읽어도 진행 */ }

    /* 2. 플랫폼별 후보 순차 시도 — which/where 로 실재 확인. */
    const candidates = process.platform === 'win32'
        ? ['py -3', 'python3', 'python', 'py']
        : ['python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'];
    const cp = require('child_process');
    for (const cand of candidates) {
        try {
            /* `py -3` 같은 경우 spawn 시 args 분리 필요. spawnSync 로 직접 시도. */
            const parts = cand.split(' ');
            const r = cp.spawnSync(parts[0], parts.slice(1).concat(['--version']), {
                encoding: 'utf-8', timeout: 4000
            });
            const out = (r.stdout || '') + (r.stderr || '');
            if (r.status === 0 && /python\s+3/i.test(out)) {
                return cand;
            }
            /* 일부 환경에선 status non-zero 인데 --version 출력은 정상. */
            if (/python\s+3\.\d/i.test(out)) return cand;
        } catch { /* 다음 후보 시도 */ }
    }
    /* 3. 다 실패 — 기존 동작 (사용자가 메시지 보고 진단) */
    return process.platform === 'win32' ? 'python' : 'python3';
}

export function _pythonCmd(): string {
    if (_pythonCmdCache) return _pythonCmdCache;
    _pythonCmdCache = _detectPythonCmd();
    return _pythonCmdCache;
}

/* 사용자가 설정 변경하면 캐시 무효화 — 다음 호출 시 재감지. */
export function _invalidatePythonCmdCache() {
    _pythonCmdCache = null;
}

/* 9009 (Windows command-not-found) 또는 "Python was not found" 스텁 메시지를
   감지해서 명확한 한국어 안내로 바꿔줌. */
export function _isPythonMissing(exitCode: number, output: string): boolean {
    if (exitCode === 9009) return true;
    if (/Python was not found/i.test(output)) return true;
    if (/command not found.*python/i.test(output)) return true;
    if (/No such file or directory.*python/i.test(output)) return true;
    if (/ENOENT/i.test(output) && /python/i.test(output)) return true;
    return false;
}
export function _pythonMissingHint(): string {
    const detected = _pythonCmd();
    const platformHint = process.platform === 'win32'
        ? 'https://www.python.org/downloads/ 에서 Python 3 설치 (Add Python to PATH 체크박스 필수!)'
        : (process.platform === 'darwin' ? '`brew install python3`' : '`sudo apt install python3`');
    return `⚠️ Python 3 명령 실행 실패 (시도한 명령: \`${detected}\`).\n` +
           `🔧 해결:\n` +
           `  1. ${platformHint}\n` +
           `  2. 설치 후 안티그래비티/VS Code 완전 종료 → 재실행 (PATH 새로고침 필요)\n` +
           `  3. 또는 명령 팔레트 → "⚙️ 설정 열기" → \`connectAiLab.pythonPath\` 에 절대 경로 입력 (예: \`/usr/local/bin/python3\` 또는 \`C:\\\\Python311\\\\python.exe\`)\n` +
           `🔍 본인 PC 의 Python 경로 확인:\n` +
           (process.platform === 'win32' ? '  - PowerShell: \`Get-Command python, python3, py\`' : '  - 터미널: \`which python3 python py\`');
}

/**
 * Run a shell command and capture stdout+stderr live so the AI can act on the result.
 * - Streams output to onChunk for live display in the chat
 * - Returns combined output (capped to 15KB) + exit code
 * - Hard timeout to prevent hung processes (default 60s)
 * - Uses default shell ($SHELL or sh) for natural command parsing (npm install, cd && ls, etc.)
 */
export function runCommandCaptured(
    cmd: string,
    cwd: string,
    onChunk: (text: string) => void,
    timeoutMs = 60000,
    captureStream: 'both' | 'stdout' = 'both'
): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
    return new Promise((resolve) => {
        const child = spawn(cmd, {
            cwd,
            shell: true,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let buf = '';
        let timedOut = false;
        const append = (s: string) => {
            buf += s;
            // Hard cap so a runaway log never explodes memory
            if (buf.length > 30000) buf = buf.slice(-30000);
            onChunk(s);
        };
        child.stdout?.on('data', (d: Buffer) => append(d.toString()));
        /* v2.89.50 — captureStream='stdout' 일 때 stderr는 무시. 스크립트가 진행 메시지·
           로그·DeprecationWarning을 stderr로 보내도 채팅창엔 안 새서 깔끔. */
        if (captureStream === 'both') {
            child.stderr?.on('data', (d: Buffer) => append(d.toString()));
        }
        const killTimer = setTimeout(() => {
            timedOut = true;
            /* v2.89.101 — Windows는 SIGTERM/SIGKILL을 무시할 수 있음. taskkill /F 로
               자식 프로세스 트리 전체 강제 종료. macOS/Linux는 기존대로 SIGTERM → SIGKILL. */
            if (process.platform === 'win32' && child.pid) {
                try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).unref(); }
                catch { try { child.kill(); } catch { /* gone */ } }
            } else {
                try { child.kill('SIGTERM'); } catch { /* already dead */ }
                setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000);
            }
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(killTimer);
            resolve({ exitCode: code ?? -1, output: buf.slice(-15000), timedOut });
        });
        child.on('error', (e) => {
            clearTimeout(killTimer);
            resolve({ exitCode: -1, output: `[실행 오류] ${e.message}`, timedOut: false });
        });
    });
}
