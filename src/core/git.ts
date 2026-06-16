/* core/git.ts — git 호출 잎 유틸.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: child_process·fs·path 뿐. vscode/extension 내부 상태 참조 없음(순수 잎). */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Run a git subcommand with argv form (no shell interpolation).
 * Returns stdout on success, throws on failure. Never blocks longer than `timeout`.
 */
export function gitExec(args: string[], cwd: string, timeout = 15000): string {
    const res = spawnSync('git', args, {
        cwd,
        encoding: 'utf-8',
        timeout,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } // never block on credential prompt
    });
    if (res.error) throw res.error;
    if (res.status !== 0) {
        const err: any = new Error(`git ${args[0]} failed: ${res.stderr?.trim() || 'unknown'}`);
        err.code = res.status;
        err.stderr = res.stderr;
        throw err;
    }
    return res.stdout || '';
}

/** Same as gitExec but swallows errors and returns null. */
export function gitExecSafe(args: string[], cwd: string, timeout = 15000): string | null {
    try { return gitExec(args, cwd, timeout); }
    catch { return null; }
}

/**
 * Validate a remote git URL. Only http(s) and git@host:owner/repo forms are accepted.
 * Returns the cleaned URL or null when unsafe.
 */
export function validateGitRemoteUrl(url: string): string | null {
    if (typeof url !== 'string') return null;
    // 사용자가 흔히 붙여넣는 잡음 제거: 공백, 끝 슬래시, 쿼리스트링/프래그먼트
    let trimmed = url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (!trimmed || trimmed.length > 500) return null;
    // Allowed: https://host/path, http://host/path, git@host:path  (host에는 :포트 허용)
    const httpsLike = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._\-/]+?(\.git)?$/;
    const sshLike = /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._\-/]+?(\.git)?$/;
    if (!httpsLike.test(trimmed) && !sshLike.test(trimmed)) return null;
    return trimmed;
}

/** Detect whether `git` is on PATH. Cached after first call. */
let _gitAvailableCache: boolean | null = null;
export function isGitAvailable(): boolean {
    if (_gitAvailableCache !== null) return _gitAvailableCache;
    try {
        const res = spawnSync('git', ['--version'], { encoding: 'utf-8', timeout: 5000 });
        _gitAvailableCache = res.status === 0;
    } catch {
        _gitAvailableCache = false;
    }
    return _gitAvailableCache;
}

export type GitErrorKind = 'auth' | 'not_found' | 'rejected' | 'merge_conflict' | 'network' | 'unknown';

/** Translate raw git stderr into a user-actionable Korean message + machine-readable kind. */
export function classifyGitError(stderr: string): { kind: GitErrorKind; message: string } {
    const s = (stderr || '').toLowerCase();
    if (
        s.includes('authentication failed') ||
        s.includes('could not read username') ||
        s.includes('terminal prompts disabled') ||
        s.includes('invalid credentials') ||
        s.includes('403')
    ) {
        return {
            kind: 'auth',
            message: 'GitHub 인증이 필요해요. 터미널에서 한 번 `git push`로 로그인 후 다시 시도해주세요.'
        };
    }
    if (s.includes('repository not found') || s.includes('does not appear to be a git repository') || s.includes('404')) {
        return { kind: 'not_found', message: '그 GitHub 저장소를 못 찾았어요. 주소가 정확한지 확인해주세요. (Private 저장소면 토큰 권한도 필요해요)' };
    }
    if (s.includes('rejected') && (s.includes('non-fast-forward') || s.includes('fetch first'))) {
        return { kind: 'rejected', message: 'GitHub에 새로운 내용이 있어요. 먼저 받아온 후 다시 시도해주세요.' };
    }
    if (s.includes('merge conflict') || s.includes('automatic merge failed') || s.includes('overwritten by merge')) {
        return { kind: 'merge_conflict', message: '같은 줄을 양쪽에서 다르게 고쳐서 자동으로 합칠 수 없어요. 동기화 메뉴에서 직접 골라주세요.' };
    }
    if (s.includes('could not resolve host') || s.includes('connection refused') || s.includes('network is unreachable') || s.includes('timed out')) {
        return { kind: 'network', message: '인터넷 연결을 확인해주세요.' };
    }
    return { kind: 'unknown', message: (stderr || '알 수 없는 오류').slice(0, 240) };
}

/** Detect remote default branch ("main" / "master" / etc). Returns "main" as fallback. */
export function getRemoteDefaultBranch(cwd: string): string {
    const out = gitExecSafe(['ls-remote', '--symref', 'origin', 'HEAD'], cwd, 10000);
    if (out) {
        const m = out.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/);
        if (m) return m[1];
    }
    return 'main';
}

/** Ensure brain folder has at least one commit so `push` has something to ship. */
export function ensureInitialCommit(cwd: string) {
    if (gitExecSafe(['log', '-1'], cwd) !== null) return; // already has commits
    const placeholder = path.join(cwd, '.gitkeep');
    if (!fs.existsSync(placeholder)) fs.writeFileSync(placeholder, '');
    gitExecSafe(['add', '.'], cwd);
    // --allow-empty handles the edge case where everything is gitignored
    gitExecSafe(['commit', '--allow-empty', '-m', 'Initial brain commit'], cwd);
}

/** Auto-create a sensible .gitignore in the brain folder so junk files don't pollute the remote. */
export function ensureBrainGitignore(brainDir: string) {
    const gi = path.join(brainDir, '.gitignore');
    if (fs.existsSync(gi)) return;
    const lines = [
        '# Connect AI auto-generated',
        '.DS_Store',
        '.obsidian/',
        '.trash/',
        'node_modules/',
        '*.tmp',
        '*.log',
        '.cache/',
        'Thumbs.db'
    ];
    try { fs.writeFileSync(gi, lines.join('\n') + '\n'); }
    catch { /* non-fatal */ }
}

/** Run a git subcommand and return stdout/stderr/status — used when we need to inspect failures. */
export function gitRun(args: string[], cwd: string, timeout = 30000): { status: number | null; stdout: string; stderr: string; error?: Error } {
    const res = spawnSync('git', args, {
        cwd,
        encoding: 'utf-8',
        timeout,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return {
        status: res.status,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        error: res.error
    };
}
