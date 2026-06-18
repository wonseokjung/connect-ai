/* core/search.ts — 파일 내용 검색(glob/grep)·diff 렌더 잎 유틸.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: fs·path 뿐. 에이전트 도구 레이어(<glob>/<grep>/edit_file diff)에서 사용. */
import * as fs from 'fs';
import * as path from 'path';

/* v2.89.104 — Claude 익스텐션 호환 unified diff. edit_file 후 변경 hunk를
   ±3줄 컨텍스트로 표시. 변경 없으면 빈 문자열 반환.
   알고리즘: line-by-line LCS는 비용 큼 → 단순 chunk 비교(Patience 스타일 간소화).
   대부분 edit_file은 작은 영역만 바꾸므로 충분히 정확. 너무 길면 첫 50줄만. */
export function _renderUnifiedDiff(before: string, after: string, ctx: number = 3): string {
    if (before === after) return '';
    const a = before.split('\n');
    const b = after.split('\n');
    /* 공통 prefix·suffix 짧게 식별 */
    let prefixLen = 0;
    while (prefixLen < a.length && prefixLen < b.length && a[prefixLen] === b[prefixLen]) prefixLen++;
    let suffixLen = 0;
    while (
        suffixLen < a.length - prefixLen &&
        suffixLen < b.length - prefixLen &&
        a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]
    ) suffixLen++;
    const aChanged = a.slice(prefixLen, a.length - suffixLen);
    const bChanged = b.slice(prefixLen, b.length - suffixLen);
    const ctxStart = Math.max(0, prefixLen - ctx);
    const ctxEndA = Math.min(a.length, a.length - suffixLen + ctx);
    const ctxEndB = Math.min(b.length, b.length - suffixLen + ctx);
    const out: string[] = [];
    out.push(`@@ -${ctxStart + 1},${ctxEndA - ctxStart} +${ctxStart + 1},${ctxEndB - ctxStart} @@`);
    /* 앞 컨텍스트 */
    for (let i = ctxStart; i < prefixLen; i++) out.push(' ' + a[i]);
    /* 변경 부분: 삭제 → 추가 */
    for (const line of aChanged) out.push('-' + line);
    for (const line of bChanged) out.push('+' + line);
    /* 뒤 컨텍스트 */
    for (let i = a.length - suffixLen; i < ctxEndA; i++) out.push(' ' + a[i]);
    /* 50줄 cap */
    if (out.length > 52) {
        return out.slice(0, 52).join('\n') + '\n... (' + (out.length - 52) + '줄 더 있음)';
    }
    return out.join('\n');
}

/* v2.89.104 — glob 매칭 (간단 버전). `*`, `**`, `?` 지원. node-glob 의존성 안 추가.
   `**`는 0개 이상의 디렉토리, `*`는 슬래시 제외 0+, `?`는 단일 문자.
   재귀 디렉토리 워크 + 패턴 매칭. 결과는 최대 200개. */
export function _globMatch(pattern: string, root: string, maxResults: number = 200): string[] {
    const re = _globToRegex(pattern);
    const results: string[] = [];
    const skipDirs = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'build', '.cache', '__pycache__', '.venv', 'venv', '.idea', '.vscode']);
    function walk(dir: string, depth: number) {
        if (results.length >= maxResults || depth > 12) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (results.length >= maxResults) return;
            if (e.name.startsWith('.git')) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (skipDirs.has(e.name)) continue;
                walk(full, depth + 1);
            } else if (e.isFile()) {
                const rel = path.relative(root, full).split(path.sep).join('/');
                if (re.test(rel)) results.push(rel);
            }
        }
    }
    walk(root, 0);
    return results;
}
export function _globToRegex(pattern: string): RegExp {
    /* `**`를 placeholder로 escape, 나머지 변환 후 복원 */
    let re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*\//g, '__GLOBSTAR_SLASH__');
    re = re.replace(/\*\*/g, '__GLOBSTAR__');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/\?/g, '[^/]');
    re = re.replace(/__GLOBSTAR_SLASH__/g, '(?:.*/)?');
    re = re.replace(/__GLOBSTAR__/g, '.*');
    return new RegExp('^' + re + '$', 'i');
}

/* v2.89.104 — grep: 파일 내용에서 패턴 검색. case-insensitive 기본.
   결과는 파일별로 묶어서 line:N 매치라인 반환. 최대 50파일·파일당 10매치. */
export function _grepFiles(pattern: string, root: string, fileGlob?: string): { file: string; matches: { line: number; text: string }[] }[] {
    let regex: RegExp;
    try { regex = new RegExp(pattern, 'i'); }
    catch { return []; }
    const fileRe = fileGlob ? _globToRegex(fileGlob) : null;
    const results: { file: string; matches: { line: number; text: string }[] }[] = [];
    const skipDirs = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'build', '.cache', '__pycache__', '.venv', 'venv', '.idea', '.vscode']);
    const MAX_FILES = 50;
    const MAX_PER_FILE = 10;
    const MAX_FILE_BYTES = 1024 * 1024;  /* 1MB 초과 파일 스킵 */
    function walk(dir: string, depth: number) {
        if (results.length >= MAX_FILES || depth > 12) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (results.length >= MAX_FILES) return;
            if (e.name.startsWith('.git')) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (skipDirs.has(e.name)) continue;
                walk(full, depth + 1);
            } else if (e.isFile()) {
                const rel = path.relative(root, full).split(path.sep).join('/');
                if (fileRe && !fileRe.test(rel)) continue;
                try {
                    const stat = fs.statSync(full);
                    if (stat.size > MAX_FILE_BYTES) continue;
                    const buf = fs.readFileSync(full);
                    /* 바이너리 빠른 체크 */
                    if (buf.slice(0, 512).includes(0)) continue;
                    const content = buf.toString('utf-8');
                    const lines = content.split('\n');
                    const matches: { line: number; text: string }[] = [];
                    for (let i = 0; i < lines.length; i++) {
                        if (regex.test(lines[i])) {
                            matches.push({ line: i + 1, text: lines[i].slice(0, 200) });
                            if (matches.length >= MAX_PER_FILE) break;
                        }
                    }
                    if (matches.length > 0) results.push({ file: rel, matches });
                } catch { /* skip */ }
            }
        }
    }
    walk(root, 0);
    return results;
}
