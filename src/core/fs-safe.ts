/* core/fs-safe.ts — 경로 안전 해석 잎 유틸.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: path·os·process 뿐. */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export const MAX_FILE_NAME_LEN = 200;

/** 파일 텍스트 읽기 — 실패(미존재·권한 등) 시 조용히 빈 문자열. 회사/에이전트
 *  메타데이터(identity.md·config.md·*.json)를 읽는 곳에서 광범위하게 쓰임. */
export function _safeReadText(p: string): string {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
}

/**
 * Resolve `relPath` against `root` and confirm the result stays within `root`.
 * Returns absolute path on success, null if traversal is detected.
 */
export function safeResolveInside(root: string, relPath: string): string | null {
    if (typeof relPath !== 'string' || relPath.length === 0) return null;
    const resolvedRoot = path.resolve(root);
    const abs = path.resolve(resolvedRoot, relPath);
    const rel = path.relative(resolvedRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return abs;
}

/* v2.89.93 — 자유로운 경로 해석. 사용자가 "~/Documents/foo.md", "$HOME/x",
   절대경로 모두 자연스럽게 사용할 수 있어야 함. 예전 safeResolveInside는
   워크스페이스 안에 갇혀서 "내 두뇌 폴더 편집해" 같은 자연스러운 요구를
   다 차단했음. 이제 expand → absolute → 시스템 보호경로만 차단.
   - "~" / "~/foo" → home 확장
   - "$HOME/x", "${HOME}/x" → env 확장 (안전 변수만)
   - 절대경로 그대로
   - 상대경로 → root 기준 resolve
   시스템 경로(/etc, /System, /usr/bin, /bin, /sbin, %WINDIR%) 만 차단. */
const _SYSTEM_PATH_BLOCKLIST = [
    '/etc', '/System', '/usr/bin', '/usr/sbin', '/bin', '/sbin', '/var/db',
    '/private/etc', '/private/var/db',
];
export function _resolveFlexiblePath(input: string, root: string): { abs: string; reason?: string } | null {
    if (typeof input !== 'string') return null;
    let s = input.trim();
    if (!s) return null;
    /* v2.89.101 — env var expansion. Windows에선 process.env.HOME이 비어있는
       경우가 흔해서, HOME을 os.homedir()로 강제 fallback. USER는 USERNAME에서
       읽고, TMP는 TMPDIR/TEMP/TMP 순으로 시도. */
    s = s.replace(/\$\{?(HOME|USER|USERNAME|TMPDIR|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|HOMEDRIVE|HOMEPATH)\}?/g, (_m, k) => {
        if (k === 'HOME') return process.env.HOME || os.homedir();
        if (k === 'USER' || k === 'USERNAME') return process.env.USER || process.env.USERNAME || os.userInfo().username || _m;
        if (k === 'TMPDIR' || k === 'TEMP' || k === 'TMP') return process.env.TMPDIR || process.env.TEMP || process.env.TMP || os.tmpdir();
        const v = process.env[k]; return v || _m;
    });
    /* tilde expansion */
    if (s === '~') s = os.homedir();
    else if (s.startsWith('~/') || s.startsWith('~\\')) s = path.join(os.homedir(), s.slice(2));
    /* absolute or relative — path.normalize로 혼재된 슬래시 통일 */
    let abs = path.isAbsolute(s) ? path.resolve(s) : path.resolve(root, s);
    abs = path.normalize(abs);
    /* 시스템 경로 차단 — 가벼운 보호. 사용자 홈·문서·외부 디스크는 자유. */
    for (const blocked of _SYSTEM_PATH_BLOCKLIST) {
        if (abs === blocked || abs.startsWith(blocked + path.sep)) {
            return { abs, reason: `시스템 보호 경로(${blocked})에는 쓰지 않습니다. 사용자 홈/워크스페이스 안의 경로를 지정해주세요.` };
        }
    }
    /* Windows: C:\Windows / C:\Program Files / C:\ProgramData 보호 */
    if (process.platform === 'win32') {
        const upper = abs.toUpperCase();
        const winDirs = [
            (process.env.WINDIR || 'C:\\WINDOWS').toUpperCase(),
            (process.env.PROGRAMFILES || 'C:\\PROGRAM FILES').toUpperCase(),
            (process.env['PROGRAMFILES(X86)'] || 'C:\\PROGRAM FILES (X86)').toUpperCase(),
            (process.env.PROGRAMDATA || 'C:\\PROGRAMDATA').toUpperCase(),
            (process.env.SYSTEMROOT || 'C:\\WINDOWS').toUpperCase(),
        ];
        for (const w of winDirs) {
            if (upper === w || upper.startsWith(w + path.sep)) {
                return { abs, reason: `시스템 보호 경로(${w})에는 쓰지 않습니다. Documents·Desktop·다른 사용자 폴더로 지정해주세요.` };
            }
        }
    }
    return { abs };
}

/**
 * Sanitize a filename: remove path separators / traversal segments / control chars.
 * Returns a safe basename (never a path) or null if nothing usable remains.
 */
export function safeBasename(name: string): string | null {
    if (typeof name !== 'string') return null;
    // Drop any path components — only the final segment is allowed.
    const base = path.basename(name).replace(/[\x00-\x1f\\/:*?"<>|]/g, '_').trim();
    if (!base || base === '.' || base === '..') return null;
    return base.slice(0, MAX_FILE_NAME_LEN);
}
