import * as vscode from 'vscode';
import * as http from 'http';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, spawnSync } from 'child_process';

// ============================================================
// Security helpers
// ============================================================

const MAX_HTTP_BODY = 5 * 1024 * 1024; // 5MB cap on /api/* request bodies
const MAX_STREAM_BUFFER = 2 * 1024 * 1024; // 2MB cap on per-stream line buffer
const MAX_FILE_NAME_LEN = 200;

/**
 * Run a git subcommand with argv form (no shell interpolation).
 * Returns stdout on success, throws on failure. Never blocks longer than `timeout`.
 */
function gitExec(args: string[], cwd: string, timeout = 15000): string {
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
function gitExecSafe(args: string[], cwd: string, timeout = 15000): string | null {
    try { return gitExec(args, cwd, timeout); }
    catch { return null; }
}

/**
 * Resolve `relPath` against `root` and confirm the result stays within `root`.
 * Returns absolute path on success, null if traversal is detected.
 */
function safeResolveInside(root: string, relPath: string): string | null {
    if (typeof relPath !== 'string' || relPath.length === 0) return null;
    const resolvedRoot = path.resolve(root);
    const abs = path.resolve(resolvedRoot, relPath);
    const rel = path.relative(resolvedRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return abs;
}

/**
 * Sanitize a filename: remove path separators / traversal segments / control chars.
 * Returns a safe basename (never a path) or null if nothing usable remains.
 */
function safeBasename(name: string): string | null {
    if (typeof name !== 'string') return null;
    // Drop any path components — only the final segment is allowed.
    const base = path.basename(name).replace(/[\x00-\x1f\\/:*?"<>|]/g, '_').trim();
    if (!base || base === '.' || base === '..') return null;
    return base.slice(0, MAX_FILE_NAME_LEN);
}

/**
 * Drain an http request body with a hard size cap. Resolves to the body string,
 * or rejects with an Error("BODY_TOO_LARGE") if the cap is exceeded.
 */
function readRequestBody(req: http.IncomingMessage, maxBytes = MAX_HTTP_BODY): Promise<string> {
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

/**
 * Validate a remote git URL. Only http(s) and git@host:owner/repo forms are accepted.
 * Returns the cleaned URL or null when unsafe.
 */
function validateGitRemoteUrl(url: string): string | null {
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
function isGitAvailable(): boolean {
    if (_gitAvailableCache !== null) return _gitAvailableCache;
    try {
        const res = spawnSync('git', ['--version'], { encoding: 'utf-8', timeout: 5000 });
        _gitAvailableCache = res.status === 0;
    } catch {
        _gitAvailableCache = false;
    }
    return _gitAvailableCache;
}

type GitErrorKind = 'auth' | 'not_found' | 'rejected' | 'merge_conflict' | 'network' | 'unknown';

/** Translate raw git stderr into a user-actionable Korean message + machine-readable kind. */
function classifyGitError(stderr: string): { kind: GitErrorKind; message: string } {
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
function getRemoteDefaultBranch(cwd: string): string {
    const out = gitExecSafe(['ls-remote', '--symref', 'origin', 'HEAD'], cwd, 10000);
    if (out) {
        const m = out.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/);
        if (m) return m[1];
    }
    return 'main';
}

/** Ensure brain folder has at least one commit so `push` has something to ship. */
function ensureInitialCommit(cwd: string) {
    if (gitExecSafe(['log', '-1'], cwd) !== null) return; // already has commits
    const placeholder = path.join(cwd, '.gitkeep');
    if (!fs.existsSync(placeholder)) fs.writeFileSync(placeholder, '');
    gitExecSafe(['add', '.'], cwd);
    // --allow-empty handles the edge case where everything is gitignored
    gitExecSafe(['commit', '--allow-empty', '-m', 'Initial brain commit'], cwd);
}

/** Auto-create a sensible .gitignore in the brain folder so junk files don't pollute the remote. */
function ensureBrainGitignore(brainDir: string) {
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
function gitRun(args: string[], cwd: string, timeout = 30000): { status: number | null; stdout: string; stderr: string; error?: Error } {
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

/** Module-scoped lock so auto-sync and manual sync never run concurrently against the same brain. */
let _autoSyncRunning = false;
let _companySyncRunning = false; /* separate lock — brain & company can sync in parallel */

/**
 * Run a shell command and capture stdout+stderr live so the AI can act on the result.
 * - Streams output to onChunk for live display in the chat
 * - Returns combined output (capped to 15KB) + exit code
 * - Hard timeout to prevent hung processes (default 60s)
 * - Uses default shell ($SHELL or sh) for natural command parsing (npm install, cd && ls, etc.)
 */
function runCommandCaptured(
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
            try { child.kill('SIGTERM'); } catch { /* already dead */ }
            // Force-kill if SIGTERM didn't take after 2s
            setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000);
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

// ============================================================
// Connect AI — Full Agentic Local AI for VS Code
// 100% Offline · File Create · File Edit · Terminal · Multi-file Context
// ============================================================

// Settings are read from VS Code configuration (File > Preferences > Settings)
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('connectAiLab');

    // ollamaUrl: only http(s)://localhost or 127.0.0.1 is meaningful here.
    let ollamaBase = (cfg.get<string>('ollamaUrl', 'http://127.0.0.1:11434') || '').trim();
    if (!/^https?:\/\//i.test(ollamaBase)) ollamaBase = 'http://127.0.0.1:11434';

    // 사용자가 선택한 모델은 그대로 유지. 빈 값이면 빈 문자열 반환 —
    // 호출 사이트가 _autoPickInstalledModel()로 실제 설치된 모델 중 하나를
    // 자동 선택. 디폴트 'gemma4:e2b' 같은 큰 모델을 강제해서 저사양 PC가
    // 첫 호출에서 실패하던 문제 방지.
    const defaultModel = (cfg.get<string>('defaultModel', '') || '').trim();

    // requestTimeout: clamp to [5, 1800] seconds, then convert to ms.
    const rawTimeout = cfg.get<number>('requestTimeout', 300);
    const timeoutSec = (typeof rawTimeout === 'number' && isFinite(rawTimeout))
        ? Math.min(1800, Math.max(5, rawTimeout))
        : 300;

    return {
        ollamaBase,
        defaultModel,
        maxTreeFiles: 200,
        timeout: timeoutSec * 1000,
        localBrainPath: cfg.get<string>('localBrainPath', '') || ''
    };
}

function _getBrainDir(): string {
    const { localBrainPath } = getConfig();
    if (localBrainPath && localBrainPath.trim() !== '') {
        if (localBrainPath.startsWith('~/')) {
            return path.join(os.homedir(), localBrainPath.substring(2));
        }
        return localBrainPath.trim();
    }
    return path.join(os.homedir(), '.connect-ai-brain');
}

function _isBrainDirExplicitlySet(): boolean {
    const { localBrainPath } = getConfig();
    return !!(localBrainPath && localBrainPath.trim() !== '');
}

async function _ensureBrainDir(): Promise<string | null> {
    if (_isBrainDirExplicitlySet()) {
        return _getBrainDir();
    }
    // 폴더 미설정 → 사용자에게 강제 선택 요청
    const result = await vscode.window.showInformationMessage(
        '📁 지식을 저장할 폴더를 먼저 선택해주세요! (AI가 답변할 때 참고할 .md 파일들이 보관됩니다)',
        '폴더 선택하기'
    );
    if (result !== '폴더 선택하기') return null;
    
    const folders = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        openLabel: '이 폴더를 내 지식 폴더로 사용',
        title: '🧠 내 지식 폴더 선택'
    });
    if (!folders || folders.length === 0) return null;
    
    const selectedPath = folders[0].fsPath;
    await vscode.workspace.getConfiguration('connectAiLab').update('localBrainPath', selectedPath, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`✅ 지식 폴더가 설정되었어요: ${selectedPath}`);
    return selectedPath;
}

const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.vscode', 'out', 'dist', 'build',
    '.next', '.cache', '__pycache__', '.DS_Store', 'coverage',
    '.turbo', '.nuxt', '.output', 'vendor', 'target'
]);
const MAX_CONTEXT_SIZE = 12_000; // chars

/* v2.89.61 — 9개 LLM 프롬프트(SYSTEM, CEO_*, SECRETARY_*) 를 assets/prompts/ 에 .md
   파일로 분리. 익스텐션 로드 시 한 번 읽어 메모리에 캐시. 프롬프트 수정이 코드
   수정 없이 가능 + 줄 수 287줄 절약 + IDE에서 markdown 미리보기로 검토 가능.
   __dirname는 esbuild 번들 출력 위치(extension/out)이라 ../assets/prompts 로 한 단계 위. */
const _PROMPTS_DIR = path.join(__dirname, '..', 'assets', 'prompts');
const _promptCache = new Map<string, string>();
function _loadPrompt(file: string): string {
    let cached = _promptCache.get(file);
    if (cached !== undefined) return cached;
    try {
        cached = fs.readFileSync(path.join(_PROMPTS_DIR, file), 'utf-8');
    } catch (e: any) {
        console.error(`[Connect AI] prompt 로드 실패 ${file}:`, e?.message || e);
        cached = '';
    }
    _promptCache.set(file, cached);
    return cached;
}

/* v2.89.62 — 11개 Python 도구 + 11개 README 를 assets/tool-seeds/<agent>/<tool>.{py,md} 로 분리.
   각 _seed* 함수에서 lazy load. assets/tool-seeds/secretary/telegram_setup.py 같은 형태. */
const _TOOL_SEEDS_DIR = path.join(__dirname, '..', 'assets', 'tool-seeds');
const _toolSeedCache = new Map<string, string>();
function _loadToolSeed(rel: string): string {
    let cached = _toolSeedCache.get(rel);
    if (cached !== undefined) return cached;
    try {
        cached = fs.readFileSync(path.join(_TOOL_SEEDS_DIR, rel), 'utf-8');
    } catch (e: any) {
        console.error(`[Connect AI] tool seed 로드 실패 ${rel}:`, e?.message || e);
        cached = '';
    }
    _toolSeedCache.set(rel, cached);
    return cached;
}

const SYSTEM_PROMPT = _loadPrompt('system.md');
// ============================================================
// 1인 기업 모드 — Multi-Agent Corporate System
// ------------------------------------------------------------
// CEO + 5 specialist agents share a "Company" subtree under
// the existing brain folder:
//   ~/.connect-ai-brain/Company/
//     _shared/        ← 공동 목표, 회사 정체성 (모두 매번 읽음)
//     _agents/<id>/   ← 각 에이전트 개인 메모리 (자기만 읽고 씀)
//     sessions/<ts>/  ← 세션별 산출물 + CEO 종합 보고
// ============================================================
interface AgentDef {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: string;
  specialty: string;
  /** Short user-facing description for the panel hero — kept punchy and
   *  task-oriented (not a comma-list like `specialty`). One sentence,
   *  shown right under the agent's name when the panel opens. */
  tagline: string;
  /** Optional custom portrait filename in assets/agents/. Falls back to
   *  the pixel sprite at assets/pixel/characters/{id}.png if absent. */
  profileImage?: string;
  /** v2.89.45 — Optional voice/personality. Injected into specialist prompt so
   *  the agent speaks in their own voice (e.g. 레오 = 데이터 중심·솔직). */
  persona?: string;
}

const AGENTS: Record<string, AgentDef> = {
  ceo: {
    id: 'ceo',
    name: 'CEO',
    role: 'Chief Executive Agent',
    emoji: '🧭',
    color: '#F8FAFC',
    specialty: '오케스트레이션, 작업 분해, 종합 판단, 다음 액션 결정',
    tagline: '회사 전체 의사결정과 작업 분배를 맡습니다'
  },
  youtube: {
    id: 'youtube',
    name: '레오',
    role: 'Head of YouTube',
    emoji: '📺',
    color: '#FF4444',
    specialty: '유튜브 채널 운영, 영상 기획서(제목·후크·구조), 트렌드 분석, 썸네일 브리프, 업로드 메타데이터, 시청자 유지율 전략',
    tagline: '유튜브 채널 기획·운영 전반을 책임집니다',
    profileImage: 'leo_profile.png',
    persona: '데이터 중심·솔직·자신감 있는 톤. "사장님"이라고 부르고, 결론을 먼저 말한 뒤 데이터 근거로 뒷받침. 추측보다 숫자. 가끔 직설적이지만 따뜻함은 잃지 않음. 이모티콘은 자제하되 "🔥"·"📊"·"🎯" 같은 핵심 강조용은 OK.'
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    role: 'Head of Instagram',
    emoji: '📷',
    color: '#E1306C',
    specialty: '인스타그램 릴스/피드 콘셉트, 캡션, 해시태그 전략, 게시 시간, 스토리, 팔로워 인게이지먼트',
    tagline: '인스타 콘텐츠 기획과 인게이지먼트를 끌어올립니다'
  },
  designer: {
    id: 'designer',
    name: 'Designer',
    role: 'Lead Designer',
    emoji: '🎨',
    color: '#A78BFA',
    specialty: '브랜드 디자인 브리프(컬러·타이포·레퍼런스), 썸네일 컨셉 3안, 비주얼 시스템, 디자인 가이드',
    tagline: '브랜드와 시각 자산 디자인을 담당합니다'
  },
  developer: {
    id: 'developer',
    name: 'Developer',
    role: 'Lead Engineer',
    emoji: '💻',
    color: '#22D3EE',
    specialty: '코드, 자동화 스크립트, API 통합, 웹사이트/봇, 데이터 파이프라인, 디버깅',
    tagline: '코드와 자동화 스크립트를 작성합니다'
  },
  business: {
    id: 'business',
    name: 'Business',
    role: 'Head of Business',
    emoji: '💰',
    color: '#F5C518',
    specialty: '수익화 모델, 가격 전략, 시장·경쟁 분석, ROI/KPI 설계, 비즈니스 의사결정',
    tagline: '수익화·가격·전략 의사결정을 같이 봅니다'
  },
  secretary: {
    id: 'secretary',
    name: '영숙',
    role: '비서 · Personal Assistant',
    emoji: '📱',
    color: '#84CC16',
    specialty: '일정·할 일 관리, 다른 에이전트 작업 요약·텔레그램 보고, 데일리 브리핑, 알림',
    tagline: '당신의 일정·할 일·연락을 챙기고 회사 소통을 정리합니다',
    profileImage: '영숙에이전트비서.jpeg',
    persona: '친근하고 정중한 톤. "사장님"이라 부르고 챙겨주는 느낌. 짧고 정리된 문장. 이모티콘 적당히 (😊·📅·✅ 정도). 보고할 땐 한눈에 보이게 불릿 포인트 + 핵심만.'
  },
  editor: {
    id: 'editor',
    name: 'Editor',
    role: 'Video & Content Editor',
    emoji: '✂️',
    color: '#F472B6',
    specialty: '영상 편집 디렉션, 컷 구성, B-roll 제안, 자막·타이틀, 스크립트 다듬기, 콘텐츠 폴리싱',
    tagline: '영상 편집 디렉션과 콘텐츠 폴리싱을 합니다'
  },
  writer: {
    id: 'writer',
    name: 'Writer',
    role: 'Copywriter',
    emoji: '✍️',
    color: '#FBBF24',
    specialty: '카피라이팅, 영상 스크립트 초안, 인스타 캡션, 블로그 글, 메일 톤앤매너, 후크 작성',
    tagline: '카피·스크립트·후크를 글로 풀어냅니다'
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    role: 'Trend & Data Researcher',
    emoji: '🔍',
    color: '#60A5FA',
    specialty: '트렌드 리서치, 경쟁사 분석, 데이터 수집·요약, 인용 자료 정리, 사실 확인',
    tagline: '트렌드와 데이터를 모아 사실 확인까지 끝냅니다'
  }
};

const AGENT_ORDER = ['ceo', 'youtube', 'instagram', 'designer', 'developer', 'business', 'secretary', 'editor', 'writer', 'researcher'];
const SPECIALIST_IDS = ['youtube', 'instagram', 'designer', 'developer', 'business', 'secretary', 'editor', 'writer', 'researcher'];

// ───────────────────────────────────────────────────────────────────────────
// Connected campus world (Phase B-1 — multi-zone layout).
//
// One big virtual campus: Office building + Cafe + outdoor Garden, all on
// a single coord space so characters walk freely between zones. Each
// "building" is a pre-built bg PNG/GIF placed at a fixed pixel position in
// the world. Decorations (trees, flowers, benches) are scattered tiles on
// the garden grass.
// ───────────────────────────────────────────────────────────────────────────
interface DeskPos { x: number; y: number; }
interface WorldZone { id: string; name: string; emoji: string; x: number; y: number; }
interface BuildingDef {
  id: string;
  layer1: string;
  layer2?: string;
  x: number; y: number;       // world pixel position (top-left)
  width: number; height: number;
}
interface DecorDef {
  file: string;               // path under assets/pixel/office/garden/
  x: number; y: number;       // world % (anchor at bottom-center for natural layering)
  w?: number;                 // optional % width override (defaults to 48px)
}
interface AgentDeskRef {
  building: string;
  localX: number;             // % of building width
  localY: number;             // % of building height
}

const WORLD_LAYOUT = {
  // World canvas — characters use % of these dims as their coordinate space.
  worldWidth: 1400,
  worldHeight: 700,

  // Pre-built scene PNGs/GIFs anchored at fixed world pixel positions.
  // Single office building — cafe + garden were rolled back. User will add
  // back / build new maps themselves.
  buildings: [
    {
      id: 'office', layer1: 'Office_Design_2.gif',
      x: 560, y: 90, width: 512, height: 544,
    },
  ] as BuildingDef[],

  // Walkways — empty for now. Add back once buildings are placed and paths make sense.
  paths: [],

  // Garden decorations — empty (rolled back).
  decorations: [] as DecorDef[],

  // Each agent's primary desk — building-local % coords.
  // Top cubicle row chairs at office y≈30%; agents stand in aisle at y=38%.
  // Middle row chairs at y≈47%; agents stand at y=58%.
  // CEO's private office has a baked-in character at the desk — our CEO
  // stands in the open area of the room (right side, not overlapping).
  agents: {
    youtube:   { building: 'office', localX: 28, localY: 38 },
    instagram: { building: 'office', localX: 46, localY: 38 },
    designer:  { building: 'office', localX: 64, localY: 38 },
    business:  { building: 'office', localX: 82, localY: 38 },
    developer: { building: 'office', localX: 28, localY: 58 },
    secretary: { building: 'office', localX: 82, localY: 58 },
    ceo:       { building: 'office', localX: 88, localY: 88 },
    editor:    { building: 'office', localX: 18, localY: 78 },
    writer:    { building: 'office', localX: 50, localY: 78 },
    researcher:{ building: 'office', localX: 70, localY: 78 },
  } as Record<string, AgentDeskRef>,

  // Visit-zones for idle wandering / autonomous behavior. Office-only.
  // Cafe + garden zones were rolled back along with their assets.
  zones: [
    { id: 'office-meeting', name: '회의실',  emoji: '📊',  x: 49, y: 78 },  // office bottom-left meeting room
    { id: 'office-copier',  name: '복사실',  emoji: '🖨️', x: 70, y: 18 },  // office top printer
  ] as WorldZone[],
};

/** Hand-tuned agent positions for the user's AI-generated office map at
 *  `assets/map.jpeg`. Coordinates are % of the world canvas — each places the
 *  agent at a real desk/seat in their room, avoiding walls and furniture.
 *  The y values anchor agent FEET (sprite is 96px tall, feet at bottom). */
const CUSTOM_MAP_DESKS: Record<string, DeskPos> = {
  // Top-left CEO solo office (glass-walled, "Connect AI" sign on wall)
  ceo:        { x: 8,  y: 22 },
  // Front desk just outside CEO's office — Secretary station
  secretary:  { x: 18, y: 33 },
  // Top-right twin workstation pairs
  youtube:    { x: 87, y: 18 },
  instagram:  { x: 87, y: 32 },
  // Mid-left small glass meeting pod (used as Designer's focused space)
  designer:   { x: 13, y: 47 },
  // Center cubicle cluster (6 desks, agents at 4 of them)
  developer:  { x: 41, y: 53 },
  business:   { x: 51, y: 53 },
  editor:     { x: 41, y: 63 },
  writer:     { x: 51, y: 63 },
  // Bottom-center small admin desks — Researcher
  researcher: { x: 33, y: 82 },
};

/** Convert each agent's building-local desk into world % coords. */
function buildWorldDeskPositions(): Record<string, DeskPos> {
  const out: Record<string, DeskPos> = {};
  for (const [id, ref] of Object.entries(WORLD_LAYOUT.agents)) {
    const b = WORLD_LAYOUT.buildings.find(bb => bb.id === ref.building);
    if (!b) continue;
    const worldPxX = b.x + (ref.localX / 100) * b.width;
    const worldPxY = b.y + (ref.localY / 100) * b.height;
    out[id] = {
      x: (worldPxX / WORLD_LAYOUT.worldWidth) * 100,
      y: (worldPxY / WORLD_LAYOUT.worldHeight) * 100,
    };
  }
  return out;
}

// Two layouts supported:
//   1) Nested (default, v2.58): company at `<brain>/_company/`. Same git
//      repo, brain stays clean at root, _company/ collapses under one
//      prefix. Best for solo users who want one backup.
//   2) Detached (v2.59): user sets `connectAiLab.companyDir` to an absolute
//      path. Company lives wherever they want — e.g., team-shared folder,
//      separate git repo, different cloud sync. Brain stays at brain root,
//      independent.
const COMPANY_SUBDIR = '_company';
const COMPANY_INTERNAL_DIRS = new Set(['_cache', '_tmp']);

function _resolvePathInput(raw: string): string {
  let s = (raw || '').trim();
  if (!s) return '';
  if (s.startsWith('~/') || s === '~') {
    s = s.replace(/^~/, os.homedir());
  }
  if (!path.isAbsolute(s)) return ''; // ignore non-absolute to avoid surprise
  return path.normalize(s);
}

function getCompanyDir(): string {
  /* User-configured detached path takes priority. Falls back to nested
     under the brain folder. */
  try {
    const raw = vscode.workspace.getConfiguration('connectAiLab').get<string>('companyDir', '') || '';
    const resolved = _resolvePathInput(raw);
    if (resolved) return resolved;
  } catch { /* config unavailable in some hot paths — fall through */ }
  return path.join(_getBrainDir(), COMPANY_SUBDIR);
}

/* One-shot migration: when the user upgrades from a layout where company
   files lived at the brain root, transparently move them under _company/.
   Runs at activation. Idempotent — does nothing if already migrated. */
function _migrateCompanyToSubdir() {
  try {
    const root = _getBrainDir();
    if (!fs.existsSync(root)) return;
    const target = path.join(root, COMPANY_SUBDIR);
    if (fs.existsSync(target)) return; // already migrated
    const legacyDirs = ['_shared', '_agents', 'sessions', 'approvals'];
    const present = legacyDirs.filter(d => {
      try { return fs.statSync(path.join(root, d)).isDirectory(); } catch { return false; }
    });
    if (present.length === 0) return; // nothing to migrate
    fs.mkdirSync(target, { recursive: true });
    for (const d of present) {
      const src = path.join(root, d);
      const dst = path.join(target, d);
      try { fs.renameSync(src, dst); } catch (e) {
        console.warn(`[Connect AI] migration: rename ${d} failed`, e);
      }
    }
    console.log(`[Connect AI] migrated ${present.length} legacy folders under ${target}`);
  } catch (e) {
    console.warn('[Connect AI] _company/ migration failed', e);
  }
}

async function setCompanyDir(absPath: string) {
  // Redirects to localBrainPath: choosing a company location now means
  // choosing where the brain (and therefore the company) lives.
  try {
    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    await cfg.update('localBrainPath', absPath, vscode.ConfigurationTarget.Global);
  } catch {
    if (_extCtx) {
      try { await _extCtx.globalState.update('localBrainPath', absPath); } catch {}
    }
  }
}

/* v2.89.16 — YouTube creds 자동 동기화. API 패널 v2.89.14 이전엔 키를 config.md에만
   저장했고 tools/youtube_account.json은 그대로 빈 채로. 도구 실행 시 빈 값 보고
   "API 키 없음" 에러. 활성화 시 한 번 점검해서 누락된 값 자동 복구. */
function _migrateYouTubeCredsToCanonical() {
  try {
    const dir = getCompanyDir();
    const cfgPath = path.join(dir, '_agents', 'youtube', 'config.md');
    if (!fs.existsSync(cfgPath)) return;
    const cfgTxt = _safeReadText(cfgPath);
    /* 라인 시작 앵커 — 이전 read regex 버그 회피 */
    const apiKeyM = cfgTxt.match(/^YOUTUBE_API_KEY[ \t]*[:：=][ \t]*([^\r\n]+?)[ \t]*$/m);
    const channelM = cfgTxt.match(/^YOUTUBE_CHANNEL_ID[ \t]*[:：=][ \t]*([^\r\n]+?)[ \t]*$/m);
    /* v2.89.18 — OAuth Client ID/Secret도 같이 마이그레이션 */
    const oauthIdM = cfgTxt.match(/^YOUTUBE_OAUTH_CLIENT_ID[ \t]*[:：=][ \t]*([^\r\n]+?)[ \t]*$/m);
    const oauthSecretM = cfgTxt.match(/^YOUTUBE_OAUTH_CLIENT_SECRET[ \t]*[:：=][ \t]*([^\r\n]+?)[ \t]*$/m);
    const apiKey = apiKeyM ? apiKeyM[1].trim() : '';
    const channelId = channelM ? channelM[1].trim() : '';
    const oauthId = oauthIdM ? oauthIdM[1].trim() : '';
    const oauthSecret = oauthSecretM ? oauthSecretM[1].trim() : '';
    if (!apiKey && !channelId && !oauthId && !oauthSecret) return;
    const toolDir = path.join(dir, '_agents', 'youtube', 'tools');
    if (!fs.existsSync(toolDir)) return;
    const jsonPath = path.join(toolDir, 'youtube_account.json');
    let existing: Record<string, any> = {};
    if (fs.existsSync(jsonPath)) {
      try { existing = JSON.parse(fs.readFileSync(jsonPath, 'utf-8') || '{}'); } catch { /* malformed */ }
    }
    const existingKey = String(existing['YOUTUBE_API_KEY'] || '').trim();
    const existingChannel = String(existing['MY_CHANNEL_ID'] || '').trim();
    const existingOauthId = String(existing['YOUTUBE_OAUTH_CLIENT_ID'] || '').trim();
    const existingOauthSecret = String(existing['YOUTUBE_OAUTH_CLIENT_SECRET'] || '').trim();
    const needSync = (apiKey && !existingKey) || (channelId && !existingChannel) || (oauthId && !existingOauthId) || (oauthSecret && !existingOauthSecret);
    if (!needSync) return;
    /* 누락된 것만 채워줌 — 기존 값은 보존 */
    if (apiKey && !existingKey) existing['YOUTUBE_API_KEY'] = apiKey;
    if (channelId && !existingChannel) existing['MY_CHANNEL_ID'] = channelId;
    if (oauthId && !existingOauthId) existing['YOUTUBE_OAUTH_CLIENT_ID'] = oauthId;
    if (oauthSecret && !existingOauthSecret) existing['YOUTUBE_OAUTH_CLIENT_SECRET'] = oauthSecret;
    /* 누락 필드 기본값 */
    if (!('MY_CHANNEL_HANDLE' in existing)) existing['MY_CHANNEL_HANDLE'] = '';
    if (!('WATCHED_CHANNELS' in existing)) existing['WATCHED_CHANNELS'] = [];
    if (!('COMPETITOR_CHANNELS' in existing)) existing['COMPETITOR_CHANNELS'] = [];
    fs.writeFileSync(jsonPath, JSON.stringify(existing, null, 2));
    console.log('[migration] youtube_account.json synced from config.md');
  } catch (e: any) {
    console.warn('[migration] youtube_account.json sync failed:', e?.message || e);
  }
}

// One-time migration from the old `<brain>/Company/...` (or custom
// `companyDir`) layout to the unified flat layout. Called once on activate.
function _migrateCompanyToBrain() {
  try {
    const brain = _getBrainDir();
    if (fs.existsSync(path.join(brain, '_shared'))) return; // already unified

    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    let legacy = ((cfg.get('companyDir') as string | undefined) || '').trim();
    if (!legacy && _extCtx) {
      legacy = (_extCtx.globalState.get<string>('companyDir') || '').trim();
    }
    if (legacy.startsWith('~/')) legacy = path.join(os.homedir(), legacy.slice(2));
    if (!legacy) legacy = path.join(brain, 'Company');

    if (!fs.existsSync(path.join(legacy, '_shared'))) return; // nothing to migrate

    fs.mkdirSync(brain, { recursive: true });
    for (const name of fs.readdirSync(legacy)) {
      const src = path.join(legacy, name);
      const dst = path.join(brain, name);
      if (fs.existsSync(dst)) continue; // never overwrite user data
      try { fs.renameSync(src, dst); } catch { /* skip on cross-device */ }
    }
    if (legacy === path.join(brain, 'Company')) {
      try { fs.rmdirSync(legacy); } catch {}
    }
    try { cfg.update('companyDir', undefined, vscode.ConfigurationTarget.Global); } catch {}
    if (_extCtx) {
      try { _extCtx.globalState.update('companyDir', undefined); } catch {}
    }
    console.log(`Connect AI: migrated ${legacy} → ${brain}`);
  } catch (e) {
    console.error('Connect AI: company → brain migration failed', e);
  }
}

function getCompanyMetrics(): { tasksCompleted: number, knowledgeInjected: number, lastSessionDate: string, foundedAt?: string } {
    try {
        const brain = _getBrainDir();
        const file = path.join(brain, 'company_state.json');
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch { /* fall through to default */ }
    return { tasksCompleted: 0, knowledgeInjected: 0, lastSessionDate: '' };
}

/** Returns the company's "Day N" relative to when the user first set up the
 *  company. First call also stamps `foundedAt` so the counter is stable across
 *  PCs that share the brain folder via GitHub. Returns 1 on day 0. */
function getCompanyDay(): number {
    try {
        const m = getCompanyMetrics();
        let founded = m.foundedAt;
        if (!founded) {
            founded = new Date().toISOString().slice(0, 10);
            updateCompanyMetrics({ foundedAt: founded });
        }
        const start = Date.parse(founded + 'T00:00:00');
        const now = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00');
        if (!isFinite(start) || !isFinite(now)) return 1;
        return Math.max(1, Math.floor((now - start) / 86400000) + 1);
    } catch { return 1; }
}

function updateCompanyMetrics(updates: any) {
    try {
        const brain = _getBrainDir();
        /* v2.89.25 — 디렉토리 없으면 만들고 쓰기. 이전엔 brain 디렉토리가 첫 활성화
           시점에 없을 수 있어서 write 조용히 실패 → foundedAt 영원히 영속화 안 됨 →
           Day 카운터 매번 1로 재설정. */
        try { fs.mkdirSync(brain, { recursive: true }); } catch { /* ignore */ }
        const file = path.join(brain, 'company_state.json');
        const s = getCompanyMetrics();
        Object.assign(s, updates);
        fs.writeFileSync(file, JSON.stringify(s, null, 2));
    } catch (e: any) {
        console.warn('[updateCompanyMetrics] write failed:', e?.message || e);
    }
}

function _extractCompanyName(idMd: string): string {
  const m = idMd.match(/회사\s*이름\s*[:：]\s*(.+)/);
  if (!m || !m[1]) return '';
  let v = m[1].trim().replace(/\*+/g, '').replace(/^_+|_+$/g, '').trim();
  if (!v) return '';
  if (/\(여기에|\(아직 미설정|\(미설정|미설정$|^_자가학습/.test(v)) return '';
  return v;
}

function isCompanyConfigured(): boolean {
  const dir = getCompanyDir();
  const idPath = path.join(dir, '_shared', 'identity.md');
  if (!fs.existsSync(idPath)) return false;
  return _extractCompanyName(_safeReadText(idPath)).length > 0;
}

function readCompanyName(): string {
  const dir = getCompanyDir();
  const idPath = path.join(dir, '_shared', 'identity.md');
  return _extractCompanyName(_safeReadText(idPath));
}

/* v2.89.26 — 에이전트별 모델 라우팅. CEO·YouTube·디자이너 등 각자 다른
   로컬 LLM 사용 (작은 모델은 라우팅·결정에, 큰 모델은 분석·창작에).
   설정 파일: _shared/agent_models.json. 비어있으면 default 모델 사용. */
function _agentModelsPath(): string {
  return path.join(getCompanyDir(), '_shared', 'agent_models.json');
}
function readAgentModelMap(): Record<string, string> {
  try {
    const p = _agentModelsPath();
    if (!fs.existsSync(p)) return {};
    const data = JSON.parse(fs.readFileSync(p, 'utf-8') || '{}');
    return (data && typeof data === 'object') ? data : {};
  } catch { return {}; }
}
function writeAgentModelMap(map: Record<string, string>) {
  try {
    const p = _agentModelsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(map, null, 2));
  } catch (e: any) {
    console.warn('[agentModels] write failed:', e?.message || e);
  }
}
function getAgentModel(agentId: string, fallback: string): string {
  const map = readAgentModelMap();
  return (map[agentId] || '').trim() || fallback;
}
/* v2.89.36 — 시스템 사양 자동 감지. RAM·CPU·플랫폼을 측정해서 자동 오케스트레이션이
   사용자 머신이 실제로 로드 가능한 모델만 할당. 이전엔 16GB RAM 머신에 70B 모델
   할당해서 LM Studio가 "model failed to load (7.06 GB)" 에러로 죽는 문제 발생. */
type SystemSpecs = {
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
function getSystemSpecs(): SystemSpecs {
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
function estimateModelMemoryGB(modelId: string): number {
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

/* v2.89.27 — 모델 자동 오케스트레이션. 설치된 모델 + 에이전트 역할을 매칭해서
   최적 배정 추천. 사용자는 "✨ 자동 추천" 버튼 한 번으로 완성된 매핑 받음. */
type ModelTier = 'tiny' | 'small' | 'medium' | 'large' | 'vision' | 'coder';
function _classifyModel(modelId: string): ModelTier[] {
  const id = modelId.toLowerCase();
  const tiers: ModelTier[] = [];
  /* 비전 모델 — 이미지 입력 가능 */
  if (/vision|llava|vl\b|glm.*v|gemma.?4.*e|qwen.?2.?vl|moondream/i.test(id)) tiers.push('vision');
  /* 코드 특화 */
  if (/coder|code-?(?:llama|qwen)/i.test(id)) tiers.push('coder');
  /* 사이즈 — 우선순위: 명시된 파라미터 → 모델 이름 패턴 */
  const paramM = id.match(/(\d+(?:\.\d+)?)\s*b\b/);
  let paramB = paramM ? parseFloat(paramM[1]) : 0;
  /* MoE 모델은 활성 파라미터 기준으로 분류 (예: "24b a2b" = 활성 2B) */
  const moeM = id.match(/a(\d+(?:\.\d+)?)b/);
  if (moeM) paramB = parseFloat(moeM[1]);
  /* LFM 패밀리 + Phi + Gemma E2B 같이 작은 모델 패턴 */
  const isExplicitlyTiny = /lfm2\.?5|gemma.?4.?e2b|phi-?3|llama.?3\.?2.?(?:1b|3b)|qwen.?2\.?5.?(?:0\.5b|1\.5b|3b)/i.test(id);
  if (isExplicitlyTiny || (paramB > 0 && paramB <= 3)) tiers.push('tiny');
  else if (paramB <= 8) tiers.push('small');
  else if (paramB <= 14) tiers.push('medium');
  else if (paramB > 14) tiers.push('large');
  else tiers.push('small'); /* 사이즈 알 수 없으면 small로 안전 폴백 */
  return tiers;
}
function _autoOrchestrateModelMap(installed: { id: string; backend: string }[]): Record<string, string> {
  if (installed.length === 0) return {};
  /* v2.89.36 — 메모리 안전 필터. 사용자 머신이 못 돌리는 큰 모델은 후보에서 제외.
     이전엔 16GB Mac에 70B 모델 할당해서 LM Studio가 죽었음. */
  const specs = getSystemSpecs();
  const safeInstalled = installed.filter(m => {
    const need = estimateModelMemoryGB(m.id);
    return need <= specs.safeModelBudgetGB;
  });
  /* 안전 필터로 다 잘려나가면 제일 작은 1개라도 남기기 (그래야 사용자가 일단 돌릴 수 있음) */
  const candidates = safeInstalled.length > 0 ? safeInstalled : (
    installed.length > 0
      ? [installed.slice().sort((a, b) => estimateModelMemoryGB(a.id) - estimateModelMemoryGB(b.id))[0]]
      : []
  );
  /* 모델별 tier 분류 + 우선순위 정렬 */
  const byTier: Record<ModelTier, string[]> = { tiny: [], small: [], medium: [], large: [], vision: [], coder: [] };
  for (const m of candidates) {
    const tiers = _classifyModel(m.id);
    for (const t of tiers) byTier[t].push(m.id);
  }
  /* 에이전트별 선호 tier 순서 — 첫번째가 best, 못 찾으면 다음으로 폴백 */
  const ROLE_PREFERENCES: Record<string, ModelTier[]> = {
    ceo: ['tiny', 'small', 'medium'],         /* 라우팅 결정 — 빠른 게 최우선 */
    secretary: ['small', 'tiny', 'medium'],   /* 일정·대화 — 균형 */
    youtube: ['large', 'medium', 'small'],    /* 데이터 분석 — 큰 모델 */
    researcher: ['large', 'medium', 'small'], /* 리서치 — 큰 모델 */
    business: ['medium', 'large', 'small'],   /* KPI·전략 — 추론 */
    writer: ['medium', 'small', 'large'],     /* 창작 — 중간 */
    editor: ['medium', 'small'],              /* 영상 디렉션 */
    designer: ['vision', 'medium', 'small'],  /* 비전 우선 */
    developer: ['coder', 'large', 'medium'],  /* 코드 우선 */
    instagram: ['medium', 'small'],
  };
  const map: Record<string, string> = {};
  for (const agentId of Object.keys(ROLE_PREFERENCES)) {
    const prefs = ROLE_PREFERENCES[agentId];
    for (const tier of prefs) {
      const candidates = byTier[tier];
      if (candidates && candidates.length > 0) {
        map[agentId] = candidates[0];
        break;
      }
    }
  }
  return map;
}

async function listInstalledModels(): Promise<{ id: string; backend: 'ollama' | 'lmstudio' }[]> {
  const out: { id: string; backend: 'ollama' | 'lmstudio' }[] = [];
  /* Ollama: GET /api/tags */
  try {
    const r = await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 1500 });
    const models = r.data?.models || [];
    for (const m of models) {
      if (m?.name) out.push({ id: m.name, backend: 'ollama' });
    }
  } catch { /* ollama not running — silent */ }
  /* LM Studio: GET /v1/models */
  try {
    const r = await axios.get('http://127.0.0.1:1234/v1/models', { timeout: 1500 });
    const models = r.data?.data || [];
    for (const m of models) {
      if (m?.id) out.push({ id: m.id, backend: 'lmstudio' });
    }
  } catch { /* LM Studio not running — silent */ }
  return out;
}

/* v2.89.14 / v2.89.39 — 회사 이름 동적 치환. 프롬프트 상수에 \`{{COMPANY}}\` 플레이스홀더를
   넣고 런타임에 사용자 회사명으로 치환. 회사명 미설정 시 "1인 기업" 같은 일반 표현으로.
   v2.89.39 이전엔 "JAY CORP"가 디폴트로 남아서 이 제품을 다른 사람이 쓸 때도 그 이름이
   나왔음 — 공용 배포 부적합. 이제 사용자별로 자기 회사명 또는 일반 명칭이 보임. */
function _personalizePrompt(prompt: string): string {
  const name = (readCompanyName() || '').trim();
  const display = name && name !== 'JAY CORP' ? name : '1인 기업';
  /* 양방향 치환: {{COMPANY}} 플레이스홀더 + 레거시 "JAY CORP" 하드코딩 둘 다 처리.
     레거시 처리는 시드된 회사 폴더의 identity.md / decisions.md / 메모리 등에 이미
     "JAY CORP"가 박혀있는 사용자도 있어서 호환을 위해 유지. */
  return prompt.replace(/\{\{COMPANY\}\}/g, display).replace(/JAY CORP/g, display);
}

/* ── Company config: structured read + write ─────────────────────────────
   Pulls / writes the same identity.md + goals.md files the agents already
   read. Fields are parsed loosely so users editing by hand aren't punished.
   Empty / placeholder values come back as ''. */
interface CompanyConfig {
  name: string;
  oneLiner: string;
  audience: string;       // 누구를 위해 만드나
  tone: string;           // 브랜드 톤
  taboos: string;         // 금기
  goalYear: string;       // 올해 핵심 목표
  goalMonth: string;      // 1개월 단기 목표
  needs: string;          // 지금 가장 필요한 것
}

function _extractField(md: string, label: string): string {
  /* Parses lines like "- **라벨:** 값" or "라벨: 값" with loose punctuation. */
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)\\s*-?\\s*\\*{0,2}${escaped}\\*{0,2}\\s*[:：]\\s*([^\\n]+)`, 'i');
  const m = md.match(re);
  if (!m || !m[1]) return '';
  let v = m[1].trim().replace(/\*+/g, '').replace(/^_+|_+$/g, '').trim();
  if (!v) return '';
  if (/^\(여기에|^\(아직 미설정|^\(미설정|미설정$|^_자가학습|^아직 미설정|^_/.test(v)) return '';
  return v;
}

function _extractGoalLine(md: string, header: string): string {
  /* Finds the first non-empty bullet under the given H2 header. */
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`##\\s*${escaped}([\\s\\S]*?)(?:\\n##|$)`);
  const m = md.match(re);
  if (!m) return '';
  const block = m[1];
  const lineRe = /\n\s*-\s*(?:\[\s*[xX ]?\s*\]\s*)?([^\n]+)/g;
  let lm;
  while ((lm = lineRe.exec(block))) {
    let v = (lm[1] || '').trim().replace(/\*+/g, '').replace(/^_+|_+$/g, '').trim();
    if (!v) continue;
    if (/^\(아직 미설정|^_자가학습|미설정$|^_/.test(v)) continue;
    return v;
  }
  return '';
}

function readCompanyConfig(): CompanyConfig {
  const dir = getCompanyDir();
  const idMd = _safeReadText(path.join(dir, '_shared', 'identity.md'));
  const goalsMd = _safeReadText(path.join(dir, '_shared', 'goals.md'));
  return {
    name: _extractCompanyName(idMd),
    oneLiner: _extractField(idMd, '한 줄 소개'),
    audience: _extractField(idMd, '타깃 청중'),
    tone:     _extractField(idMd, '브랜드 톤'),
    taboos:   _extractField(idMd, '금기'),
    goalYear:  _extractGoalLine(goalsMd, '올해 핵심 목표'),
    goalMonth: _extractGoalLine(goalsMd, '1개월 내 단기 목표'),
    needs:     _extractGoalLine(goalsMd, '지금 가장 필요한 것'),
  };
}

function writeCompanyConfig(cfg: Partial<CompanyConfig>) {
  ensureCompanyStructure();
  const dir = getCompanyDir();
  const cur = readCompanyConfig();
  const m: CompanyConfig = {
    name:     (cfg.name     ?? cur.name).trim(),
    oneLiner: (cfg.oneLiner ?? cur.oneLiner).trim(),
    audience: (cfg.audience ?? cur.audience).trim(),
    tone:     (cfg.tone     ?? cur.tone).trim(),
    taboos:   (cfg.taboos   ?? cur.taboos).trim(),
    goalYear:  (cfg.goalYear  ?? cur.goalYear).trim(),
    goalMonth: (cfg.goalMonth ?? cur.goalMonth).trim(),
    needs:     (cfg.needs     ?? cur.needs).trim(),
  };
  const fmt = (v: string) => v || '_자가학습이 채울 예정_';
  const idPath = path.join(dir, '_shared', 'identity.md');
  fs.writeFileSync(idPath,
`# 🏢 회사 정체성

- **회사 이름:** ${m.name || '(아직 미설정)'}
- **한 줄 소개:** ${m.oneLiner || '(아직 미설정)'}
- **타깃 청중:** ${fmt(m.audience)}
- **브랜드 톤:** ${fmt(m.tone)}
- **금기:** ${fmt(m.taboos)}

> 이 파일은 사용자가 직접 편집하거나, 작업하면서 자가학습으로 채워집니다.
> 채팅 사이드바의 "👔 회사명" 뱃지를 누르면 폼으로 수정할 수도 있어요.
`);
  const goalsPath = path.join(dir, '_shared', 'goals.md');
  fs.writeFileSync(goalsPath,
`# 🎯 공동 목표

## 올해 핵심 목표
- [ ] ${m.goalYear || '(아직 미설정 — 작업하면서 추가)'}

## 1개월 내 단기 목표
- ${fmt(m.goalMonth)}

## 지금 가장 필요한 것
- ${fmt(m.needs)}

> 모든 에이전트가 매번 이 파일을 읽고 일합니다. 회사 설정 모달에서 폼으로도 수정 가능.
`);
}

function readTelegramConfig(): { token: string; chatId: string } {
  /* New canonical: _agents/secretary/tools/telegram_setup.json (set via the
     UI's ⚙️ tool config modal). Falls back to legacy config.md (markdown
     edit) for users on pre-v2.52 setups. */
  const dir = getCompanyDir();
  let token = '';
  let chatId = '';
  try {
    const jsonPath = path.join(dir, '_agents', 'secretary', 'tools', 'telegram_setup.json');
    if (fs.existsSync(jsonPath)) {
      const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8') || '{}');
      token = String(cfg.TELEGRAM_BOT_TOKEN || '').trim();
      chatId = String(cfg.TELEGRAM_CHAT_ID || '').trim();
    }
  } catch { /* ignore malformed JSON, fall through */ }
  if (!token || !chatId) {
    const cfgPath = path.join(dir, '_agents', 'secretary', 'config.md');
    const txt = _safeReadText(cfgPath);
    if (!token) {
      const tokenM = txt.match(/TELEGRAM_BOT_TOKEN\s*[:：=]\s*([A-Za-z0-9:_\-]+)/);
      if (tokenM) token = tokenM[1].trim();
    }
    if (!chatId) {
      const chatM = txt.match(/TELEGRAM_CHAT_ID\s*[:：=]\s*(-?\d+)/);
      if (chatM) chatId = chatM[1].trim();
    }
  }
  return { token, chatId };
}

async function sendTelegramReport(text: string): Promise<boolean> {
  const { token, chatId } = readTelegramConfig();
  if (!token || !chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/* Send arbitrarily long text by splitting at natural boundaries (paragraphs,
   then lines, then hard 3800-char chunks). Each chunk preserves Markdown
   formatting where possible. Returns true if every chunk was delivered.
   Falls back to plain text if Markdown parsing fails — Telegram rejects
   messages with malformed markdown. */
async function sendTelegramLong(text: string): Promise<boolean> {
  const { token, chatId } = readTelegramConfig();
  if (!token || !chatId) return false;
  const clean = (text || '').trim();
  if (!clean) return false;
  const MAX = 3800; // safety margin under Telegram's 4096 cap
  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > MAX) {
    /* Prefer to split at a double-newline boundary, then a single newline,
       then a sentence end. Falls back to a hard cut when nothing else fits. */
    let splitAt = remaining.lastIndexOf('\n\n', MAX);
    if (splitAt < MAX * 0.6) splitAt = remaining.lastIndexOf('\n', MAX);
    if (splitAt < MAX * 0.6) splitAt = remaining.lastIndexOf('. ', MAX);
    if (splitAt < MAX * 0.4) splitAt = MAX;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  let allOk = true;
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? `${chunks[i]}\n\n_(${i + 1}/${chunks.length})_` : chunks[i];
    let ok = false;
    try {
      const r = await axios.post(url, {
        chat_id: chatId, text: part, parse_mode: 'Markdown', disable_web_page_preview: true,
      }, { timeout: 10000, validateStatus: () => true });
      ok = r.status >= 200 && r.status < 300;
      if (!ok) {
        // Markdown parse error → retry as plain text so the user still gets something
        const r2 = await axios.post(url, {
          chat_id: chatId, text: part.replace(/[*_`\[\]]/g, ''), disable_web_page_preview: true,
        }, { timeout: 10000, validateStatus: () => true });
        ok = r2.status >= 200 && r2.status < 300;
      }
    } catch { ok = false; }
    if (!ok) allOk = false;
    /* Throttle ~25/s globally; we send a few in a row, sleep just enough */
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 350));
  }
  return allOk;
}

/* Send the "typing…" chat action so the user sees the bot is working.
   Action expires after ~5s, so for longer operations call this periodically. */
async function sendTelegramTyping(): Promise<void> {
  const { token, chatId } = readTelegramConfig();
  if (!token || !chatId) return;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendChatAction`, {
      chat_id: chatId, action: 'typing'
    }, { timeout: 4000, validateStatus: () => true });
  } catch { /* ignore */ }
}

// ============================================================
// 📱 Telegram bidirectional bot (v2.51) — commands + CEO routing
// ============================================================
// Polls Telegram getUpdates so the user can drive the AI company from
// outside the editor. Whitelisted to the configured chat_id (no one else
// can issue commands even if they find the bot). Free-text messages get
// classified by a lightweight CEO call and forwarded to the right
// specialist via the existing sidebar provider.

let _telegramPollTimer: NodeJS.Timeout | null = null;
let _telegramPollOffset = 0;
let _telegramPolling = false;

/* Short-term Telegram conversation memory — small ring buffer that gives
   Secretary just enough context to handle follow-ups like "그 일정 4시로",
   "방금 그거 취소", "그래 진행해줘". Without this, every Telegram message is
   processed in isolation and the user has to re-state what they meant.
   Cap intentionally small (last 12 turns) so we don't bloat the prompt or
   leak old conversations into unrelated requests. */
const TELEGRAM_HISTORY_MAX = 12;
const _telegramConversationHistory: Array<{ role: 'user' | 'assistant'; text: string; ts: number }> = [];

/* v2.88 — 디스패치 중복 감지 + 진행 상태 추적. 사용자가 "유튜브 분석"을
   30초 안에 두 번 보내면 두 번 다 디스패치되고 둘 다 "처리 중" 답해서
   AI가 멍청해 보임. 활성 디스패치를 키(prompt+5분 ts)로 추적하고, 같은
   요청이 들어오면 새로 시작 안 하고 진행 상황만 알림. */
interface ActiveDispatch {
  promptKey: string;
  startedAt: number;
  step: string;        /* 현재 단계 — "계획 중", "에이전트 분배 중", etc */
  heartbeatTimer: NodeJS.Timeout | null;
  heartbeatCount: number;
  fromTelegram: boolean;
}
const _activeDispatches: Map<string, ActiveDispatch> = new Map();
const ACTIVE_DISPATCH_TTL_MS = 5 * 60 * 1000; /* 5분 */
function _normalizeForDispatchKey(s: string): string {
  /* 공백·구두점 제거하고 첫 80자만 — 사용자가 "유튜브 분석" / "유튜브  분석!"
     를 같은 의도로 묶기 위해. 너무 짧으면 다른 요청도 충돌해서 80자. */
  return (s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 80);
}
function _findActiveDispatch(prompt: string): ActiveDispatch | null {
  const now = Date.now();
  const key = _normalizeForDispatchKey(prompt);
  /* TTL 청소 */
  for (const [k, v] of _activeDispatches.entries()) {
    if (now - v.startedAt > ACTIVE_DISPATCH_TTL_MS) {
      if (v.heartbeatTimer) clearInterval(v.heartbeatTimer);
      _activeDispatches.delete(k);
    }
  }
  return _activeDispatches.get(key) || null;
}
function _startActiveDispatch(prompt: string, fromTelegram: boolean): ActiveDispatch {
  const key = _normalizeForDispatchKey(prompt);
  /* 같은 키가 이미 있으면 우선 정리 (방어) */
  const old = _activeDispatches.get(key);
  if (old?.heartbeatTimer) clearInterval(old.heartbeatTimer);
  const entry: ActiveDispatch = {
    promptKey: key,
    startedAt: Date.now(),
    step: '준비 중',
    heartbeatTimer: null,
    heartbeatCount: 0,
    fromTelegram,
  };
  _activeDispatches.set(key, entry);
  return entry;
}
function _updateActiveDispatchStep(prompt: string, step: string) {
  const key = _normalizeForDispatchKey(prompt);
  const entry = _activeDispatches.get(key);
  if (entry) entry.step = step;
}
function _endActiveDispatch(prompt: string) {
  const key = _normalizeForDispatchKey(prompt);
  const entry = _activeDispatches.get(key);
  if (entry?.heartbeatTimer) clearInterval(entry.heartbeatTimer);
  _activeDispatches.delete(key);
}
let _telegramHistoryHydrated = false;

/** Disk path for Telegram conversation log. Persists short-term context so
 *  the bot survives an extension restart without losing the thread. Lives
 *  alongside Secretary's other files so it git-syncs naturally. */
function _telegramHistoryPath(): string {
  return path.join(getCompanyDir(), '_agents', 'secretary', 'telegram_history.jsonl');
}

/** Lazy-load history on first access. Called from both push and render so
 *  whichever happens first hydrates the in-memory ring buffer. */
function _hydrateTelegramHistoryFromDisk() {
  if (_telegramHistoryHydrated) return;
  _telegramHistoryHydrated = true;
  try {
    const txt = _safeReadText(_telegramHistoryPath());
    if (!txt.trim()) return;
    const lines = txt.split('\n').filter(l => l.trim());
    /* Only restore the tail — the file may have grown across many sessions
       but we still cap working memory at TELEGRAM_HISTORY_MAX. */
    for (const line of lines.slice(-TELEGRAM_HISTORY_MAX)) {
      try {
        const e = JSON.parse(line);
        if ((e.role === 'user' || e.role === 'assistant') && typeof e.text === 'string' && typeof e.ts === 'number') {
          _telegramConversationHistory.push({ role: e.role, text: e.text, ts: e.ts });
        }
      } catch { /* skip malformed line */ }
    }
  } catch { /* ignore — first run, no file yet */ }
}

function _pushTelegramHistory(role: 'user' | 'assistant', text: string) {
  if (!text || !text.trim()) return;
  _hydrateTelegramHistoryFromDisk();
  const entry = { role, text: text.trim().slice(0, 500), ts: Date.now() };
  _telegramConversationHistory.push(entry);
  if (_telegramConversationHistory.length > TELEGRAM_HISTORY_MAX) {
    _telegramConversationHistory.splice(0, _telegramConversationHistory.length - TELEGRAM_HISTORY_MAX);
  }
  /* JSONL ring buffer — fast restart-recovery, structured. */
  try {
    const p = _telegramHistoryPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(entry) + '\n');
  } catch { /* never let disk write block the bot */ }
  /* Daily company-wide conversation log — same file CEO planner / autonomous
     chatter / corporate dispatches all write to. Putting Telegram turns in
     here means every other agent picks them up via readRecentConversations,
     so the user can say "그 영상 어떻게 됐어?" via Telegram and Secretary's
     answer references the same context Developer/Writer used in sidebar. */
  try {
    if (role === 'user') {
      appendConversationLog({ speaker: '사용자(텔레그램)', emoji: '📱', body: text.trim() });
    } else {
      appendConversationLog({ speaker: '비서', emoji: '💬', section: '텔레그램 응답', body: text.trim() });
    }
  } catch { /* logging must never break the flow */ }
}

function _renderTelegramHistory(maxTurns = 8): string {
  _hydrateTelegramHistoryFromDisk();
  if (_telegramConversationHistory.length === 0) return '';
  /* Widened from 30m → 4h so multi-hour follow-ups ("아까 그 일정 4시로")
     still resolve. After 4h the user is plausibly starting a new thread.
     Persisted history means a VS Code restart no longer empties this. */
  const cutoff = Date.now() - 4 * 60 * 60_000;
  const recent = _telegramConversationHistory.filter(e => e.ts >= cutoff).slice(-maxTurns);
  if (recent.length === 0) return '';
  return recent.map(e => `${e.role === 'user' ? '👤 사용자' : '💬 비서'}: ${e.text}`).join('\n');
}

/* Multi-window guard — when the user has VS Code / Cursor open in several
   windows simultaneously, each extension instance independently polls the
   same bot, so the user's "안녕" gets answered N times. We elect a single
   "leader" via a TTL lockfile in the company dir. The leader refreshes its
   heartbeat on every successful poll; followers see the fresh heartbeat and
   skip polling entirely. If the leader dies, its lock goes stale (>15s) and
   any other window can take over on its next tick. */
const TELEGRAM_LOCK_TTL_MS = 15000;
function _telegramLockPath(): string {
  /* v2.89.24 — 유저 레벨로 이동. 이전엔 `_company/_shared/`(워크스페이스 단위)에
     있어서 안티그래비티 창마다 다른 워크스페이스면 락도 따로따로 → 두 창이
     독립적으로 폴링. ~/.connect-ai-brain/ 는 모든 창이 공유하는 단일 위치. */
  const userBrain = path.join(os.homedir(), '.connect-ai-brain');
  try { fs.mkdirSync(userBrain, { recursive: true }); } catch { /* ignore */ }
  return path.join(userBrain, '.telegram_poll.lock');
}
function _telegramOffsetPath(): string {
  /* 같은 이유로 offset도 유저 레벨 파일에 저장. globalState 의존 X. */
  const userBrain = path.join(os.homedir(), '.connect-ai-brain');
  try { fs.mkdirSync(userBrain, { recursive: true }); } catch { /* ignore */ }
  return path.join(userBrain, '.telegram_offset.json');
}
function _readTelegramOffset(): number {
  try {
    const p = _telegramOffsetPath();
    if (!fs.existsSync(p)) return 0;
    const data = JSON.parse(fs.readFileSync(p, 'utf-8') || '{}');
    return Number(data.offset) || 0;
  } catch { return 0; }
}
function _writeTelegramOffset(offset: number) {
  try {
    fs.writeFileSync(_telegramOffsetPath(), JSON.stringify({ offset, ts: Date.now() }));
  } catch { /* ignore */ }
}
function _tryAcquireTelegramLock(): boolean {
  const lockPath = _telegramLockPath();
  const now = Date.now();
  /* v2.89.4 — 원자적(atomic) 잠금. fs.openSync(path, 'wx')는 파일이 이미 있으면
     실패하므로 두 프로세스가 동시에 호출해도 한 명만 락 잡음. 이전 구현은
     exists() → write() 사이 race window에서 둘 다 락 잡을 수 있었음. */
  try {
    try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch { /* ignore */ }
    /* 1) 락 파일이 이미 있으면 — ours? stale? */
    if (fs.existsSync(lockPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8') || '{}');
        if (data.pid === process.pid) {
          /* 우리가 가진 락 — heartbeat 갱신 */
          fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, heartbeat: now }));
          return true;
        }
        if (typeof data.heartbeat === 'number' && now - data.heartbeat < TELEGRAM_LOCK_TTL_MS) {
          return false; /* 다른 창이 살아있음 */
        }
      } catch { /* 손상된 파일 — 강제 인계 */ }
      /* stale 또는 손상 — 삭제 후 atomic 생성 시도 */
      try { fs.unlinkSync(lockPath); } catch { /* race — already gone */ }
    }
    /* 2) atomic create-exclusive — 둘 이상 동시 시도해도 한 명만 성공 */
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, heartbeat: now }));
      fs.closeSync(fd);
      return true;
    } catch (e: any) {
      if (e?.code === 'EEXIST') {
        /* 같은 순간에 다른 창이 잡았음 — 양보 */
        return false;
      }
      throw e;
    }
  } catch {
    return true; /* fail-open — 락 메커니즘 자체 깨졌으면 차라리 중복 한 번 */
  }
}
function _releaseTelegramLockIfOwned(): void {
  const lockPath = _telegramLockPath();
  try {
    if (!fs.existsSync(lockPath)) return;
    const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8') || '{}');
    if (data.pid === process.pid) fs.unlinkSync(lockPath);
  } catch { /* ignore */ }
}

const TELEGRAM_HELP = `🤖 *Connect AI 봇* — 비서가 24시간 대기 중

*그냥 자연어로 말해주세요. 비서가 알아서 처리합니다.*

📅 *일정*
"오늘 일정 뭐야" / "내일 3시 광고주 미팅 잡아줘" / "내일 미팅 취소"

📋 *할일·상태*
"할일 뭐 있어?" / "에이전트 뭐 하고 있어?" / "어제 뭐 했어?"

💼 *작업 분배*
"썸네일 만들어줘" / "유튜브 트렌드 분석해줘"
→ CEO가 적합한 에이전트에게 분배 → 결과 보고

🤖 *에이전트 직접 지시*
"디자이너한테 로고 시안 부탁해" / "유튜브에게 컨셉 3개 뽑으라고 해"

🔧 *도구·승인 상태*
"도구 자율도 어때?" / "승인 대기 뭐 있어?"

━━━━━━━━━━━━━
*명령어 (옵션, 없어도 됨)*
\`/done <id>\` — 작업 완료 (id로 확실하게)
\`/cancel <id>\` — 작업 취소
\`/help\` — 이 도움말`;

const AUTONOMY_LABELS: Record<number, string> = {
    0: 'Off',
    1: 'Read-only',
    2: 'Draft → Approve',
    3: 'Auto'
};

function readToolAutonomyLevel(agentId: string): number {
    try {
        const p = path.join(getCompanyDir(), '_agents', agentId, 'tools.md');
        const txt = _safeReadText(p);
        const m = txt.match(/AUTONOMY_LEVEL\s*[:：=]\s*(\d)/);
        if (m) return Math.max(0, Math.min(3, parseInt(m[1], 10)));
    } catch { /* ignore */ }
    return 2; // Draft is the safe default — agent prepares, user approves.
}

async function _quickLLMCall(systemPrompt: string, userMsg: string, maxTokens = 64): Promise<string> {
    const { ollamaBase, defaultModel, timeout } = getConfig();
    const isLMStudio = ollamaBase.includes('1234') || ollamaBase.includes('v1');
    const apiUrl = isLMStudio ? `${ollamaBase}/v1/chat/completions` : `${ollamaBase}/api/chat`;
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
    ];
    const tmo = Math.min(timeout || 60000, 60000);
    if (isLMStudio) {
        const body = { model: defaultModel, messages, stream: false, max_tokens: maxTokens, temperature: 0.2 };
        const r = await axios.post(apiUrl, body, { timeout: tmo });
        return r.data?.choices?.[0]?.message?.content?.toString().trim() || '';
    }
    const body = { model: defaultModel, messages, stream: false, options: { num_predict: maxTokens, temperature: 0.2 } };
    const r = await axios.post(apiUrl, body, { timeout: tmo });
    return r.data?.message?.content?.toString().trim() || '';
}

const CEO_CLASSIFIER_PROMPT = _loadPrompt('ceo-classifier.md');
const SECRETARY_TELEGRAM_PROMPT = _loadPrompt('secretary-telegram.md');
async function classifyToAgent(text: string): Promise<string> {
    try {
        const out = await _quickLLMCall(_personalizePrompt(CEO_CLASSIFIER_PROMPT), text, 16);
        const id = out.trim().toLowerCase().replace(/[^a-z]/g, '');
        if (AGENTS[id]) return id;
    } catch { /* fall through to keyword router */ }
    const lower = text.toLowerCase();
    if (/유튜브|youtube|영상|채널|구독|썸네일/.test(lower)) return 'youtube';
    if (/인스타|instagram|릴스|피드|reel/.test(lower)) return 'instagram';
    if (/디자인|design|로고|이미지/.test(lower)) return 'designer';
    if (/코드|개발|사이트|웹|deploy|배포|api|app/.test(lower)) return 'developer';
    if (/돈|매출|가격|수익|roi|business|단가/.test(lower)) return 'business';
    if (/일정|할일|todo|미팅|알림|메일|brief|브리핑|캘린더/.test(lower)) return 'secretary';
    if (/편집|자막|b-?roll|컷/.test(lower)) return 'editor';
    if (/카피|스크립트|블로그|후크|글/.test(lower)) return 'writer';
    if (/트렌드|리서치|조사|뉴스/.test(lower)) return 'researcher';
    return 'secretary'; // safe default — secretary triages
}

async function handleTelegramCommand(text: string): Promise<void> {
    const trimmed = text.trim();
    const cmd = trimmed.split(/\s+/)[0].toLowerCase();
    const rest = trimmed.slice(cmd.length).trim();

    if (cmd === '/help' || cmd === '/start') {
        await sendTelegramReport(TELEGRAM_HELP);
        return;
    }
    /* Plan B (2026-05-03 단순화) — 슬래시 명령은 4개만 유지:
         /help · /start  → Telegram 봇 관습 (첫 추가 시 자동 발동)
         /done <id>      → 작업 완료 (id로 확실하게 — 자연어 모호성 회피)
         /cancel <id>    → 작업 취소 (동일 이유)
       나머지(/agents, /tools, /approvals, /calendar, /today, /brief, /tasks,
       /ask)는 모두 비서가 자연어로 답하는 게 더 자연스러워서 제거. 알 수
       없는 슬래시도 거부하지 않고 비서한테 그대로 흘림 — 사용자가 외울
       명령은 사실상 0개. */
    if (cmd === '/done' || cmd === '/cancel') {
        const idArg = rest.trim();
        if (!idArg) {
            await sendTelegramReport(`사용법: \`${cmd} <id>\` — 작업 id는 "할일 뭐 있어?"라고 물어보면 비서가 알려줘요. 마지막 9자리만 입력해도 OK.`);
            return;
        }
        /* Allow short suffix match */
        const all = readTracker().tasks;
        const match = all.find(t => t.id === idArg) || all.find(t => t.id.endsWith(idArg));
        if (!match) {
            await sendTelegramReport(`❌ id \`${idArg}\` 못 찾았어요. "할일 뭐 있어?"로 목록 확인해주세요.`);
            return;
        }
        if (match.status === 'done' || match.status === 'cancelled') {
            await sendTelegramReport(`이미 ${match.status === 'done' ? '완료' : '취소'} 상태입니다.`);
            return;
        }
        const newStatus = cmd === '/done' ? 'done' : 'cancelled';
        updateTrackerTask(match.id, { status: newStatus, evidence: cmd === '/done' ? '사용자 텔레그램 확인' : '사용자 취소' });
        await sendTelegramReport(`${cmd === '/done' ? '✅' : '✖️'} \`${match.id.slice(-9)}\` ${match.title}\n→ ${newStatus === 'done' ? '완료' : '취소'} 처리됨.`);
        return;
    }
    /* P1-8: edit commands — let the user retarget tasks without re-creating.
       Loose date parser (ISO, "내일", "오늘 15:00", "+2h") covers the
       common cases without dragging in a date library. */
    if (cmd === '/reschedule' || cmd === '/priority' || cmd === '/move-to') {
        const parts = rest.split(/\s+/).filter(Boolean);
        const idArg = parts.shift() || '';
        const argRest = parts.join(' ').trim();
        if (!idArg || !argRest) {
            await sendTelegramReport(`사용법:\n\`/reschedule <id> <시간>\` (예: \`내일 15:00\`, \`+2h\`, \`2026-05-10\`)\n\`/priority <id> <urgent|high|normal|low>\`\n\`/move-to <id> <에이전트id>\``);
            return;
        }
        const all = readTracker().tasks;
        const match = all.find(t => t.id === idArg) || all.find(t => t.id.endsWith(idArg));
        if (!match) {
            await sendTelegramReport(`❌ id \`${idArg}\` 못 찾았어요.`);
            return;
        }
        if (cmd === '/reschedule') {
            const dt = _parseLooseDate(argRest);
            if (!dt) {
                await sendTelegramReport(`⚠️ 시간을 못 알아들었어요: \`${argRest}\`\n예: \`내일 15:00\`, \`+2h\`, \`2026-05-10 09:00\``);
                return;
            }
            updateTrackerTask(match.id, { dueAt: dt.toISOString(), preAlarmsSent: [] });
            await sendTelegramReport(`📅 \`${match.id.slice(-9)}\` ${match.title}\n→ ${dt.toLocaleString('ko-KR')} 으로 변경`);
            return;
        }
        if (cmd === '/priority') {
            const p = argRest.toLowerCase();
            if (p !== 'urgent' && p !== 'high' && p !== 'normal' && p !== 'low') {
                await sendTelegramReport(`⚠️ 우선순위는 \`urgent / high / normal / low\` 중 하나여야 해요.`);
                return;
            }
            updateTrackerTask(match.id, { priority: p as TaskPriority });
            await sendTelegramReport(`${TASK_PRIORITY_LABEL[p as TaskPriority]} \`${match.id.slice(-9)}\` ${match.title}\n→ 우선순위 ${p}`);
            return;
        }
        if (cmd === '/move-to') {
            const newAgent = argRest.toLowerCase().trim();
            if (!AGENTS[newAgent]) {
                await sendTelegramReport(`⚠️ 에이전트 id를 모르겠어요: \`${newAgent}\`. \`/agents\`로 목록 확인.`);
                return;
            }
            const a = AGENTS[newAgent];
            updateTrackerTask(match.id, { agentIds: [newAgent], owner: 'agent' });
            await sendTelegramReport(`${a.emoji} \`${match.id.slice(-9)}\` ${match.title}\n→ ${a.name}에게 이관`);
            return;
        }
    }
    /* P0-4: /approve /reject — release or kill an agent's pending action.
       Same shape as /done /cancel, separate id-space (`apr-…`). */
    if (cmd === '/approve' || cmd === '/reject') {
        const idArg = rest.trim();
        if (!idArg) {
            const pending = listPendingApprovals();
            if (pending.length === 0) {
                await sendTelegramReport(`✅ 승인 대기 액션이 없어요.`);
                return;
            }
            const list = pending.slice(0, 5).map(a => {
                const ag = AGENTS[a.agentId];
                return `• \`${a.id.slice(-9)}\` ${ag?.emoji || '🤖'} ${a.title}`;
            }).join('\n');
            await sendTelegramReport(`사용법: \`${cmd} <id>\`\n\n*대기 중 (${pending.length}건)*\n${list}`);
            return;
        }
        const decision = cmd === '/approve' ? 'approved' : 'rejected';
        const result = await resolveApproval(idArg, decision);
        await sendTelegramReport(result.message);
        return;
    }
    /* Unknown slash — fall through to natural-language handling. Don't reject.
       Users who type "/뭐하고있어" should get an answer, not a rejection. */

    /* Free text → Secretary mediates. Secretary decides whether to answer
       directly (schedule/status questions), forward to CEO (work that needs
       dispatch), or ask for more info. This is the "Secretary as gateway"
       behavior — every Telegram interaction goes through the agent who's
       supposed to be the messenger. */
    try {
        await handleTelegramViaSecretary(trimmed);
    } catch (e: any) {
        /* Fallback to old classifier behavior if Secretary call fails — keeps
           the bot responsive even when the local LLM is down. */
        try {
            const targetAgent = await classifyToAgent(trimmed);
            const a = AGENTS[targetAgent];
            await sendTelegramReport(`🧭 (비서 응답 실패 → CEO 라우팅) ${a.emoji} *${a.name}*\n\n_"${trimmed.slice(0, 120)}"_\n\n_답변 준비되는 대로 보내드릴게요._`);
            _activeChatProvider?.sendPromptFromExtension?.(trimmed, { fromTelegram: true, corporate: true });
        } catch { /* truly silent fail */ }
    }
}

/* Robust JSON extractor — handles model output that wraps the JSON in prose,
   markdown fences, or multiple objects. Scans ALL balanced top-level objects
   and returns the first one with a string `mode` field; falls back to the
   first parseable object if none has `mode`. Picking by `mode` matters because
   small models often emit a "thinking" / scratchpad JSON before the real
   answer, and the legacy first-only behavior would lock onto the scratchpad
   and leak it (or trigger an empty-reply fallback). */
function _extractFirstJsonObject(raw: string): any | null {
    if (!raw) return null;
    /* Strip code fences first */
    const stripped = raw.replace(/```[a-zA-Z]*\n?|```/g, '');
    const candidates: any[] = [];
    let i = 0;
    while (i < stripped.length) {
        const start = stripped.indexOf('{', i);
        if (start < 0) break;
        let depth = 0;
        let inStr = false;
        let esc = false;
        let endIdx = -1;
        for (let j = start; j < stripped.length; j++) {
            const ch = stripped[j];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) { endIdx = j; break; }
            }
        }
        if (endIdx < 0) break; // unbalanced trailing object — let the caller's truncation rescue handle it
        try {
            const obj = JSON.parse(stripped.slice(start, endIdx + 1));
            if (obj && typeof obj === 'object') candidates.push(obj);
        } catch { /* skip malformed object, continue scanning */ }
        i = endIdx + 1;
    }
    if (candidates.length === 0) return null;
    const withMode = candidates.find(c => typeof c.mode === 'string');
    return withMode || candidates[0];
}

/* v2.88 — 비서가 "지금 진짜로 뭐 할 수 있는지" 자연어로 답변. 모든 에이전트의
   라이브 상태 + 자격증명 상태 점검. 일반론 답변 대신 사실만 — 사용자가
   "이건 되고 이건 안 되네" 즉시 파악. */
function _buildCapabilityReport(): string {
    const lines: string[] = ['👋 *영숙이에요. 지금 제가 도울 수 있는 건:*\n'];
    const tg = readTelegramConfig();
    const calOk = isCalendarWriteConnected();
    /* 1) 비서 본인의 직접 능력 */
    lines.push('*📅 일정 관리*');
    if (calOk) lines.push('  ✅ 추가·조회·수정·취소 (자연어로) — "내일 3시 미팅 잡아줘"');
    else lines.push('  ⚠️ 미연결 — 명령 팔레트 → "Connect AI: Google Calendar 자동 일정 연결"');
    lines.push('');
    lines.push('*📨 텔레그램 양방향*');
    if (tg.token && tg.chatId) lines.push('  ✅ 작동 중 — 명령 받고 보고 보내기');
    else lines.push('  ⚠️ 미연결 — 직원 보기 → 영숙 카드 → ⚙️에서 봇 토큰 입력');
    lines.push('');
    lines.push('*📋 작업 추적*');
    lines.push('  ✅ "내일까지 X 해야 해" → 자동 등록, 마감 임박 시 알림');
    lines.push('');
    /* 2) 다른 에이전트들의 능력 */
    lines.push('*👥 회사 에이전트들 (자연어로 부르세요)*');
    const agentSummary: string[] = [];
    /* YouTube 상태 */
    try {
        const cfgPath = path.join(getCompanyDir(), '_agents', 'youtube', 'config.md');
        const txt = _safeReadText(cfgPath);
        const apiKey = (txt.match(/YOUTUBE_API_KEY\s*[:：=]\s*([A-Za-z0-9_\-]+)/) || [])[1] || '';
        const channelId = (txt.match(/YOUTUBE_CHANNEL_ID\s*[:：=]\s*([A-Za-z0-9_\-]+)/) || [])[1] || '';
        if (apiKey && channelId) {
            const oauth = isYoutubeOAuthConnected();
            agentSummary.push('  📺 *YouTube* — ✅ 채널 분석·트렌드' + (oauth ? '·시청 지속률·트래픽' : ' (Analytics는 OAuth 필요)'));
        } else {
            agentSummary.push('  📺 *YouTube* — ⚠️ API 키·채널 ID 필요');
        }
    } catch {
        agentSummary.push('  📺 *YouTube* — ⚠️ 설정 필요');
    }
    /* LLM 기반 에이전트들 — 항상 가능 */
    agentSummary.push('  🎨 *디자이너* — ✅ 시안 카피·무드보드·브랜드 컬러 가이드');
    agentSummary.push('  ✍️ *작가* — ✅ 후크·스크립트·블로그·영상 카피');
    agentSummary.push('  🎬 *편집자* — ✅ 영상 컷·자막·B-roll 디렉션');
    agentSummary.push('  💼 *비즈니스* — ✅ 가격·KPI·전략 분석');
    agentSummary.push('  🛠 *개발자* — ✅ 사이트·자동화·API 코드');
    agentSummary.push('  🔍 *리서처* — ✅ 트렌드·경쟁사·사실 확인');
    agentSummary.push('  📷 *Instagram* — ✅ 릴스 기획·해시태그·카피');
    lines.push(agentSummary.join('\n'));
    lines.push('');
    lines.push('*예시:*');
    lines.push('• "다음 영상 컨셉 5개 뽑아줘" → CEO가 YouTube·작가에게 분배');
    lines.push('• "썸네일 시안 만들어줘" → 디자이너로');
    lines.push('• "오늘 일정 뭐야?" → 제가 바로 답변');
    lines.push('• "에이전트 뭐 하고 있어?" → 진행 중 작업 모두');
    lines.push('');
    lines.push('_명령 외울 필요 없어요. 자연어로 그냥 말씀해주세요._');
    return lines.join('\n');
}

/* v2.89 — 진행 상태 자기 보고. 디스패치 큐 + 현재 작업 + 추적기 진행 중 작업
   까지 한 화면 요약. 사용자가 "지금 뭐 하고 있어?" 물었을 때 LLM 거치지
   않고 실제 상태를 즉시. */
function _buildDispatchStatusReport(): string {
    const lines: string[] = ['📊 *지금 상태*\n'];
    const provider = _activeChatProvider;
    const snap = provider?.getDispatchSnapshot?.();
    if (snap?.current) {
        const c = snap.current;
        const priorityIcon = c.priority === 'user' ? '👤' : '🌙';
        const priorityLabel = c.priority === 'user' ? '사용자 명령' : '자율 사이클';
        lines.push(`*${priorityIcon} 진행 중* (${c.elapsedSec}초 째)`);
        lines.push(`  ${priorityLabel}: ${c.prompt.slice(0, 80)}${c.prompt.length > 80 ? '…' : ''}`);
        lines.push('');
    } else {
        lines.push('_대기 중 (현재 진행하는 작업 없음)_\n');
    }
    if (snap && snap.queueLength > 0) {
        lines.push(`*⏳ 대기 줄 (${snap.queueLength}건)*`);
        for (const q of snap.queue) {
            const icon = q.priority === 'user' ? '👤' : '🌙';
            lines.push(`  ${icon} ${q.prompt.slice(0, 70)}${q.prompt.length > 70 ? '…' : ''}`);
        }
        lines.push('');
    }
    /* 추적기 진행 중 작업 */
    try {
        const open = listOpenTrackerTasks().slice(0, 8);
        if (open.length > 0) {
            lines.push(`*📋 추적 중인 작업 (${open.length}건)*`);
            for (const t of open) {
                const ico = t.status === 'in_progress' ? '🔄' : '⏳';
                const owner = t.owner === 'user' ? '👤' : t.owner === 'mixed' ? '👥' : '🤖';
                lines.push(`  ${ico} ${owner} ${t.title.slice(0, 60)}`);
            }
            lines.push('');
        }
    } catch { /* tracker may not exist */ }
    /* 24시간 자율 사이클 ON/OFF */
    try {
        const enabled = vscode.workspace.getConfiguration('connectAiLab').get<boolean>('autoCycleEnabled', true);
        lines.push(`*🌙 24시간 자율 사이클*: ${enabled ? '✅ ON (15분마다 일거리 자동 실행)' : '⏸ OFF'}`);
    } catch { /* ignore */ }
    return lines.join('\n');
}

async function handleTelegramViaSecretary(userText: string): Promise<void> {
    /* Mirror user's Telegram message into the sidebar chat */
    try { _activeChatProvider?.postSystemNote?.(`텔레그램: "${userText.slice(0, 200)}"`, '📱'); } catch { /* ignore */ }
    /* Show the bot is working — Telegram typing indicator */
    sendTelegramTyping().catch(() => { /* ignore */ });
    /* Push the user's message into short-term memory BEFORE we build the
       prompt — Secretary needs to see "그 일정", "방금 그거" type follow-ups
       in context. Reply gets pushed at each branch below so the next turn's
       history reflects what we actually said. */
    _pushTelegramHistory('user', userText);
    /* v2.89.3 — Cancel intent. 진행 중 작업이 있으면 즉시 abort. LLM 안 거침
       — 사용자가 멈추라고 했는데 또 LLM 한 사이클 돌리면 답답함 가중. */
    const cancelQ = /^\s*(취소|중단|중지|그만|멈춰|멈춰줘|stop|cancel|abort|nevermind|never\s*mind)\s*[\.!\?]*\s*$/i;
    if (cancelQ.test(userText)) {
        const result = _activeChatProvider?.abortActiveDispatch?.() || { cancelled: false };
        if (result.cancelled) {
            const what = result.what ? ` (${result.what} 단계에서)` : '';
            const msg = `🛑 *비서*: 작업 중단했어요${what}. 다음 명령 기다릴게요.`;
            await sendTelegramReport(msg);
            _pushTelegramHistory('assistant', `작업 중단됨${what}`);
            try { _activeChatProvider?.postSystemNote?.(`비서 → 텔레그램 (작업 중단)`, '🛑'); } catch { /* ignore */ }
        } else {
            const msg = `💬 *비서*: 지금 진행 중인 작업이 없어요. 자유롭게 새 명령 주세요.`;
            await sendTelegramReport(msg);
            _pushTelegramHistory('assistant', `진행 중 작업 없음 — 취소할 거 없음`);
        }
        return;
    }
    /* v2.88 — Capability introspection. "뭐 할 수 있어?" / "도움" / "/start"
       류 메시지면 LLM 거치지 않고 실제 연결된 능력만 자연어로 답변. 일반론
       대신 정확히 지금 가능한 것만 알려줘서 "AI가 멍청하다" 인상 줄임. */
    const introQ = /^\s*(\/start|\/help|뭐\s*할\s*수\s*있|도움|help|what.*can.*you.*do|할\s*수\s*있는\s*거|기능\s*뭐|능력\s*뭐)/i;
    if (introQ.test(userText)) {
        const cap = _buildCapabilityReport();
        await sendTelegramLong(cap);
        _pushTelegramHistory('assistant', cap.slice(0, 400));
        try { _activeChatProvider?.postSystemNote?.(`비서 → 텔레그램 (능력 요약)`, '💬'); } catch { /* ignore */ }
        return;
    }
    /* v2.89 — 진행 상태 introspection. "지금 뭐 해?" / "/status" / "큐" 류
       질문이면 디스패치 큐 + 현재 작업 즉시 답변. */
    const statusQ = /^\s*(\/status|지금\s*뭐\s*해|뭐\s*하고\s*있|작업\s*상태|큐\s*상태|현재\s*상태)/i;
    if (statusQ.test(userText)) {
        const status = _buildDispatchStatusReport();
        await sendTelegramLong(status);
        _pushTelegramHistory('assistant', status.slice(0, 400));
        try { _activeChatProvider?.postSystemNote?.(`비서 → 텔레그램 (진행 상태)`, '💬'); } catch { /* ignore */ }
        return;
    }

    /* Build Secretary's context: identity + calendar + schedule + recent
       agent activity. Keeps the call cheap (small model, low temp). */
    const today = new Date();
    const todayStr = today.toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    let ctxBlock = `\n\n[현재 시각]\n${today.toLocaleString('ko-KR')} (${todayStr})`;
    try {
        const dir = getCompanyDir();
        const cal = _safeReadText(path.join(dir, '_shared', 'calendar_cache.md'));
        const sch = _safeReadText(path.join(dir, '_shared', 'schedule.md'));
        const id  = _safeReadText(path.join(dir, '_shared', 'identity.md'));
        const dec = _safeReadText(path.join(dir, '_shared', 'decisions.md'));
        if (id.trim())  ctxBlock += `\n\n[회사 정체성]\n${id.slice(0, 800)}`;
        if (cal.trim()) ctxBlock += `\n\n[다가오는 일정 (Google Calendar)]\n${cal.slice(0, 1200)}`;
        if (sch.trim()) ctxBlock += `\n\n[통합 스케줄]\n${sch.slice(0, 1200)}`;
        /* Tracker — lets Secretary answer "에이전트 뭐하고있어?" / "지금 뭐 하고
           있어?" without dispatching. The list is the canonical "what is the
           company doing right now" view. */
        try {
            const trackerMd = trackerToMarkdown({ onlyOpen: true, max: 12 });
            if (trackerMd) ctxBlock += `\n\n[지금 진행 중인 작업 (추적기)]\n${trackerMd.slice(0, 1500)}`;
        } catch { /* ignore */ }
        /* Recent CEO decisions — last 1500 chars of the decisions log gives
           Secretary enough to answer "최근에 뭐 결정했어?" / "어제 뭐 했어?". */
        if (dec.trim()) ctxBlock += `\n\n[최근 의사결정 로그]\n${dec.slice(-1500)}`;
        /* Recent session reports — give Secretary a quick view of the last
           few completed dispatches so it can summarize "에이전트 최근 결과물" without
           re-dispatching. Cheap: just read filenames + first 200 chars. */
        try {
            const sessDir = path.join(dir, 'sessions');
            const sessions = fs.readdirSync(sessDir)
                .filter(n => !n.startsWith('.'))
                .sort()
                .slice(-3);
            if (sessions.length > 0) {
                const lines: string[] = [];
                for (const s of sessions) {
                    const reportPath = path.join(sessDir, s, '_report.md');
                    const txt = _safeReadText(reportPath);
                    if (txt.trim()) lines.push(`• ${s}: ${txt.slice(0, 160).replace(/\s+/g, ' ').trim()}…`);
                }
                if (lines.length > 0) ctxBlock += `\n\n[최근 완료된 세션 보고서]\n${lines.join('\n')}`;
            }
        } catch { /* ignore — no sessions yet */ }
    } catch { /* ignore */ }
    if (isCalendarWriteConnected()) {
        ctxBlock += `\n\n[캘린더 연결 상태] ✅ Google Calendar 쓰기 연결됨 — calendar_create/list/delete/update 모드 사용 가능`;
    } else {
        ctxBlock += `\n\n[캘린더 연결 상태] ❌ 미연결 — calendar_* 모드 사용 시 mode='reply'로 "Google Calendar 연결이 필요해요(명령 팔레트 → '회사 GitHub 연결' 옆 'Google Calendar 자동 일정 연결')"라고 알려주세요`;
    }
    /* Short-term Telegram history — gives Secretary context for follow-ups
       like "그거 4시로 바꿔줘". Capped to last 8 turns within the past 4
       hours (helper enforces both). */
    const historyBlock = _renderTelegramHistory(8);
    if (historyBlock) {
        ctxBlock += `\n\n[최근 텔레그램 대화 (참조용)]\n${historyBlock}\n\n_사용자가 "그거"·"방금 그 일정"·"그 회의" 라고 하면 위 대화에서 어떤 일정/주제인지 찾아서 처리하세요._`;
    }
    /* Company-wide conversation log — same source CEO planner reads. Captures
       sidebar dialogues, autonomous agent chatter, dispatch results. Lets
       Secretary answer cross-channel follow-ups like "developer가 사이트 어떻게
       하고 있어?" without re-dispatching. Conservative size (1500 chars) to
       avoid blowing past LM Studio's default context window. */
    const companyLog = readRecentConversations(1500);
    if (companyLog && companyLog.trim()) {
        ctxBlock += companyLog;
    }

    let raw = '';
    try {
        /* 800 (was 500) — calendar_create with description + location can blow
           past 500 and arrive truncated. Truncated JSON has no balanced close
           brace, defeats the parser, and leaks raw `{"mode":...` to the user. */
        raw = await _quickLLMCall(SECRETARY_TELEGRAM_PROMPT + ctxBlock, userText, 800);
    } catch (e: any) {
        await sendTelegramReport(`⚠️ 비서가 응답하지 못했어요: ${e?.message || e}`);
        return;
    }
    const parsed = _extractFirstJsonObject(raw);
    if (!parsed || typeof parsed.mode !== 'string') {
        /* Try one rescue pass — small models often emit a truncated JSON whose
           `text` field is recoverable even without a closing brace. */
        const textM = raw.match(/"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        const rescuedText = textM ? textM[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim() : '';
        if (rescuedText) {
            await sendTelegramLong(`💬 *비서*: ${rescuedText.slice(0, 1500)}`);
            try { _activeChatProvider?.postSystemNote?.(`비서 → 텔레그램 (JSON 복구): ${rescuedText.slice(0, 300)}`, '💬'); } catch { /* ignore */ }
            return;
        }
        /* Fallback — aggressively strip from the first { onward (handles both
           balanced and unclosed JSON) so the user never sees raw mode/text
           markup. If nothing remains, ask the user to retry. */
        const clean = raw
            .replace(/```[\s\S]*?```/g, '')   // code fences first
            .replace(/\{[\s\S]*$/, '')         // open brace → EOF (catches truncation)
            .trim();
        if (!clean) {
            await sendTelegramReport(`💬 비서: 잠깐, 모델이 답변을 끝내지 못했어요. 다시 한 번 말씀해주실 수 있나요?`);
            return;
        }
        const fallbackMsg = clean.slice(0, 600);
        await sendTelegramReport(`💬 비서: ${fallbackMsg}`);
        try { _activeChatProvider?.postSystemNote?.(`비서 → 텔레그램: ${fallbackMsg.slice(0, 300)}`, '💬'); } catch { /* ignore */ }
        return;
    }

    const replyText = (typeof parsed.text === 'string' ? parsed.text : '').trim().slice(0, 3500);
    const mode = parsed.mode;

    /* Tracker — Secretary may flag this message as a trackable commitment. */
    let trackedId = '';
    try {
        const tt = parsed.track_task;
        if (tt && typeof tt === 'object' && typeof tt.title === 'string' && tt.title.trim()) {
            const owner = (tt.owner === 'user' || tt.owner === 'mixed') ? tt.owner : 'agent';
            const due = (typeof tt.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(tt.due)) ? tt.due : undefined;
            const task = addTrackerTask({
                title: tt.title.trim(),
                owner,
                dueAt: due,
                description: userText.slice(0, 400),
                status: owner === 'agent' ? 'in_progress' : 'pending',
            });
            trackedId = task.id;
        }
    } catch { /* ignore */ }
    const trailer = trackedId ? `\n\n_📋 추적: \`${trackedId.slice(-9)}\`_` : '';

    /* ── Calendar actions: Secretary acts directly ─────────────────── */
    if (mode === 'calendar_create') {
        const ev = parsed.event;
        if (!isCalendarWriteConnected()) {
            await sendTelegramReport(`⚠️ Google Calendar가 연결되지 않았어요.\n\n*명령 팔레트* → "Connect AI: Google Calendar 자동 일정 연결" 로 먼저 셋업해주세요.`);
            return;
        }
        if (!ev || typeof ev.title !== 'string' || typeof ev.start !== 'string') {
            await sendTelegramReport(`💬 *비서*: ${replyText || '일정 정보가 부족해요. 시작 시각과 제목을 다시 알려주세요.'}`);
            return;
        }
        const dur = (typeof ev.duration_minutes === 'number' && ev.duration_minutes > 0) ? ev.duration_minutes : 60;
        const startDate = new Date(ev.start);
        if (isNaN(startDate.getTime())) {
            await sendTelegramReport(`⚠️ 시작 시각 해석 실패: \`${ev.start}\`. 다시 알려주세요.`);
            return;
        }
        const endDate = new Date(startDate.getTime() + dur * 60_000);
        const created = await createCalendarEventDirect({
            title: ev.title.trim(),
            startIso: startDate.toISOString(),
            endIso: endDate.toISOString(),
            description: typeof ev.description === 'string' ? ev.description : undefined,
            location: typeof ev.location === 'string' ? ev.location : undefined,
        });
        if (!created) {
            await sendTelegramReport(`❌ 캘린더 일정 생성 실패. 토큰이 만료됐을 수 있어요. 명령 팔레트 → "Google Calendar 자동 일정 연결" 재실행해주세요.`);
            return;
        }
        const fmt = (d: Date) => d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' });
        const link = created.htmlLink ? `\n\n[🔗 캘린더에서 보기](${created.htmlLink})` : '';
        const confirmMsg = replyText || `📅 일정 추가됨\n*${ev.title}*\n${fmt(startDate)} – ${fmt(endDate)}`;
        await sendTelegramLong(`💬 *비서*: ${confirmMsg}${link}${trailer}`);
        _pushTelegramHistory('assistant', `일정 추가됨: ${ev.title} (${fmt(startDate)} – ${fmt(endDate)})`);
        try { _activeChatProvider?.postSystemNote?.(`비서 → 캘린더: "${ev.title}" ${fmt(startDate)}`, '📅'); } catch { /* ignore */ }
        /* Refresh local cache so other agents see the new event */
        refreshCalendarCacheViaOAuth(14).catch(() => { /* silent */ });
        return;
    }
    if (mode === 'calendar_list') {
        if (!isCalendarWriteConnected()) {
            /* Fall back to cached calendar if OAuth not connected */
            const cal = _safeReadText(path.join(getCompanyDir(), '_shared', 'calendar_cache.md')).trim();
            const body = cal ? cal.split('\n').slice(0, 30).join('\n') : '_캘린더 정보가 없어요. Google Calendar 연결 또는 iCal 도구 셋업이 필요해요._';
            await sendTelegramLong(`💬 *비서 — 일정*\n\n${body}`);
            return;
        }
        const days = (typeof parsed.days_ahead === 'number' && parsed.days_ahead > 0) ? Math.min(60, parsed.days_ahead) : 7;
        const events = await findCalendarEvents({ daysAhead: days });
        if (events.length === 0) {
            await sendTelegramReport(`💬 *비서*: 향후 ${days}일 안에 잡힌 일정이 없어요. ${replyText}`);
            return;
        }
        const fmt = (s: string) => {
            try {
                const d = new Date(s);
                return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' });
            } catch { return s; }
        };
        const list = events.map(e => `• *${fmt(e.startIso)}* — ${e.title}`).join('\n');
        await sendTelegramLong(`💬 *비서 — 향후 ${days}일 일정*\n\n${list}${replyText ? `\n\n${replyText}` : ''}`);
        /* Compact summary for history — keeps "그 일정" references resolvable
           without dumping the full list into every subsequent prompt. */
        const histSummary = events.slice(0, 5).map(e => `${e.title} (${fmt(e.startIso)})`).join(', ');
        _pushTelegramHistory('assistant', `향후 ${days}일 일정: ${histSummary}${events.length > 5 ? ' 외 ' + (events.length - 5) + '건' : ''}`);
        try { _activeChatProvider?.postSystemNote?.(`비서 → 캘린더 조회 (${events.length}건)`, '📅'); } catch { /* ignore */ }
        return;
    }
    if (mode === 'calendar_delete') {
        if (!isCalendarWriteConnected()) {
            await sendTelegramReport(`⚠️ Google Calendar가 연결되지 않았어요.`);
            return;
        }
        const query = typeof parsed.query === 'string' ? parsed.query.trim() : '';
        /* 30일 기본값으로 확장 — "여자 들어간 일정 다 취소" 같은 벌크 명령은
           오늘만이 아니라 향후 1달치를 다 잡아야 자연스러움. 단일 매칭 케이스는
           원래도 days_ahead를 LLM이 작게 보냈으니 영향 없음. */
        const days = (typeof parsed.days_ahead === 'number' && parsed.days_ahead > 0) ? Math.min(60, parsed.days_ahead) : 30;
        const deleteAll = parsed.delete_all === true;
        const matches = await findCalendarEvents({ query, daysAhead: days });
        if (matches.length === 0) {
            await sendTelegramReport(`💬 *비서*: \`${query || '(검색어 없음)'}\` 일치하는 일정을 못 찾았어요.`);
            return;
        }
        const fmt = (s: string) => { try { return new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; } };
        /* 벌크 삭제 — 사용자가 "모두/전부/다" 명시한 경우. LLM이 delete_all=true로
           세팅. 매칭된 일정 전부 순차 삭제 후 결과 요약. */
        if (deleteAll) {
            let ok = 0, fail = 0;
            const okTitles: string[] = [];
            const failTitles: string[] = [];
            for (const ev of matches) {
                const r = await deleteCalendarEvent(ev.eventId);
                if (r) { ok++; okTitles.push(`✖️ ${ev.title} (${fmt(ev.startIso)})`); }
                else   { fail++; failTitles.push(`⚠️ ${ev.title} (${fmt(ev.startIso)})`); }
            }
            const okBlock = okTitles.length ? okTitles.join('\n') : '_없음_';
            const failBlock = failTitles.length ? `\n\n*실패 ${fail}건*\n${failTitles.join('\n')}` : '';
            const headline = fail === 0
                ? `💬 *비서*: ✖️ \`${query}\` 일치 ${ok}건 모두 취소됨`
                : `💬 *비서*: \`${query}\` 일치 ${matches.length}건 중 ${ok}건 취소`;
            await sendTelegramLong(`${headline}\n\n${okBlock}${failBlock}`);
            _pushTelegramHistory('assistant', `${ok}건 취소됨 (${query}). ${fail > 0 ? fail + '건 실패.' : ''}`);
            try { _activeChatProvider?.postSystemNote?.(`비서 → 캘린더 벌크 취소: "${query}" ${ok}/${matches.length}건`, '🗑️'); } catch { /* ignore */ }
            refreshCalendarCacheViaOAuth(30).catch(() => { /* silent */ });
            return;
        }
        if (matches.length > 1) {
            const list = matches.map((e, i) => `${i + 1}. *${fmt(e.startIso)}* — ${e.title}`).join('\n');
            await sendTelegramLong(`💬 *비서*: ${matches.length}개가 일치해요. 어떻게 할까요?\n\n${list}\n\n_• 모두 취소하려면: "모두 삭제" 또는 "다 취소"_\n_• 하나만 취소하려면: 더 구체적인 제목으로 알려주세요_`);
            _pushTelegramHistory('assistant', `${matches.length}건 매칭. 모두 삭제 또는 더 구체적 지시 대기.`);
            return;
        }
        const ev = matches[0];
        const ok = await deleteCalendarEvent(ev.eventId);
        if (!ok) {
            await sendTelegramReport(`❌ 일정 취소 실패. 권한이 없거나 이미 삭제됐을 수 있어요.`);
            return;
        }
        const cancelMsg = `💬 *비서*: ✖️ 취소됨 — *${ev.title}* (${fmt(ev.startIso)})${replyText ? `\n\n${replyText}` : ''}`;
        await sendTelegramLong(cancelMsg);
        _pushTelegramHistory('assistant', `취소됨 — ${ev.title} (${fmt(ev.startIso)}). ${replyText}`);
        try { _activeChatProvider?.postSystemNote?.(`비서 → 캘린더 취소: "${ev.title}"`, '🗑️'); } catch { /* ignore */ }
        refreshCalendarCacheViaOAuth(14).catch(() => { /* silent */ });
        return;
    }
    if (mode === 'calendar_update') {
        if (!isCalendarWriteConnected()) {
            await sendTelegramReport(`⚠️ Google Calendar가 연결되지 않았어요.`);
            return;
        }
        const query = typeof parsed.query === 'string' ? parsed.query.trim() : '';
        const days = (typeof parsed.days_ahead === 'number' && parsed.days_ahead > 0) ? Math.min(60, parsed.days_ahead) : 7;
        const patch = (parsed.patch && typeof parsed.patch === 'object') ? parsed.patch : {};
        if (!patch.start && !patch.duration_minutes && !patch.title) {
            await sendTelegramReport(`💬 *비서*: 뭘 바꿀지 알려주세요 (시간/길이/제목 중 하나 이상).`);
            return;
        }
        const matches = await findCalendarEvents({ query, daysAhead: days });
        if (matches.length === 0) {
            await sendTelegramReport(`💬 *비서*: \`${query || '(검색어 없음)'}\` 일치하는 일정을 못 찾았어요.`);
            return;
        }
        if (matches.length > 1) {
            const fmt = (s: string) => { try { return new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; } };
            const list = matches.map((e, i) => `${i + 1}. *${fmt(e.startIso)}* — ${e.title}`).join('\n');
            await sendTelegramLong(`💬 *비서*: 여러 개가 일치해요. 어느 걸 바꿀까요?\n\n${list}\n\n_제목을 더 구체적으로 알려주세요._`);
            return;
        }
        const ev = matches[0];
        /* Compute new start/end from patch fields, falling back to current. */
        let newStartIso: string | undefined;
        let newEndIso: string | undefined;
        const currentStart = new Date(ev.startIso);
        const currentEnd = ev.endIso ? new Date(ev.endIso) : new Date(currentStart.getTime() + 60 * 60_000);
        const currentDurMin = Math.max(15, Math.round((currentEnd.getTime() - currentStart.getTime()) / 60_000));
        if (typeof patch.start === 'string') {
            const s = new Date(patch.start);
            if (isNaN(s.getTime())) {
                await sendTelegramReport(`⚠️ 새 시작 시각 해석 실패: \`${patch.start}\`. 다시 알려주세요.`);
                return;
            }
            newStartIso = s.toISOString();
            const dur = (typeof patch.duration_minutes === 'number' && patch.duration_minutes > 0) ? patch.duration_minutes : currentDurMin;
            newEndIso = new Date(s.getTime() + dur * 60_000).toISOString();
        } else if (typeof patch.duration_minutes === 'number' && patch.duration_minutes > 0) {
            /* Only duration changed — keep start, recompute end */
            newEndIso = new Date(currentStart.getTime() + patch.duration_minutes * 60_000).toISOString();
        }
        const newTitle = (typeof patch.title === 'string' && patch.title.trim()) ? patch.title.trim() : undefined;
        const updated = await patchCalendarEvent(ev.eventId, {
            title: newTitle,
            startIso: newStartIso,
            endIso: newEndIso,
        });
        if (!updated) {
            await sendTelegramReport(`❌ 일정 수정 실패. 권한이 없거나 이미 삭제됐을 수 있어요.`);
            return;
        }
        const fmt = (s: string) => { try { return new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return s; } };
        const finalTitle = newTitle || ev.title;
        const link = updated.htmlLink ? `\n\n[🔗 캘린더에서 보기](${updated.htmlLink})` : '';
        const confirmMsg = replyText || `📅 *${finalTitle}* 수정됨 — ${fmt(updated.startIso || newStartIso || ev.startIso)}${updated.endIso ? ` ~ ${fmt(updated.endIso)}` : ''}`;
        await sendTelegramLong(`💬 *비서*: ${confirmMsg}${link}${trailer}`);
        _pushTelegramHistory('assistant', `${finalTitle} 수정됨 (${fmt(updated.startIso || ev.startIso)})`);
        try { _activeChatProvider?.postSystemNote?.(`비서 → 캘린더 수정: "${finalTitle}" ${fmt(updated.startIso || ev.startIso)}`, '✏️'); } catch { /* ignore */ }
        refreshCalendarCacheViaOAuth(14).catch(() => { /* silent */ });
        return;
    }

    /* ── Existing reply / dispatch / ask paths ─────────────────────── */
    if (mode === 'dispatch') {
        await sendTelegramReport(`📨 *비서 → CEO*\n\n${replyText || '작업을 분배할게요'}${trailer}`);
        _pushTelegramHistory('assistant', `(CEO에게 전달) ${replyText || '작업을 분배할게요'}`);
        try { _activeChatProvider?.postSystemNote?.(`비서 → CEO 전달: ${replyText.slice(0, 300)}`, '📨'); } catch { /* ignore */ }
        const dispatchInstr = String(parsed.dispatch_to_ceo || userText).slice(0, 1500);
        /* corporate:true 추가 — _handleCorporatePrompt를 직접 호출해서 진짜
           멀티 에이전트 디스패치 발동. 이전엔 webview를 거쳐서 단일 LLM
           응답으로만 흘러서 "전달 완료"만 답하고 실제 작업 안 함. */
        try { _activeChatProvider?.sendPromptFromExtension?.(dispatchInstr, { fromTelegram: true, corporate: true }); } catch { /* ignore */ }
    } else if (mode === 'ask') {
        await sendTelegramLong(`💬 *비서*: ${replyText}`);
        _pushTelegramHistory('assistant', replyText);
        try { _activeChatProvider?.postSystemNote?.(`비서 → 텔레그램: ${replyText.slice(0, 300)}`, '💬'); } catch { /* ignore */ }
    } else {
        if (!replyText) {
            await sendTelegramReport(`💬 비서: 한 번 더 말씀해주실 수 있나요? 답변을 만들지 못했어요.`);
            return;
        }
        await sendTelegramLong(`💬 *비서*: ${replyText}${trailer}`);
        _pushTelegramHistory('assistant', replyText);
        try { _activeChatProvider?.postSystemNote?.(`비서 → 텔레그램: ${replyText.slice(0, 300)}`, '💬'); } catch { /* ignore */ }
    }
}

/* v2.89.24 — 보고 스케줄러. 사용자가 _shared/report_schedule.json 에 정해놓은
   시각마다 자동으로 텔레그램·사이드바에 보고서 발송. cron-style 분 단위 점검.
   schedule.json 형식:
     { entries: [
       { id: 'morning-brief', label: '모닝 브리핑', hour: 9, minute: 0,
         days: [1,2,3,4,5], action: 'briefing', enabled: true },
       { id: 'channel-daily', label: '채널 분석', hour: 8, minute: 0,
         days: [0,1,2,3,4,5,6], action: 'tool', tool: 'channel_full_analysis',
         agentId: 'youtube', enabled: true },
     ] } */
interface ReportScheduleEntry {
    id: string;
    label: string;
    hour: number;          /* 0-23 */
    minute: number;        /* 0-59 */
    days: number[];        /* 0=일 ~ 6=토 */
    action: 'briefing' | 'tool';
    tool?: string;
    agentId?: string;
    enabled: boolean;
    lastFiredAt?: string;  /* ISO 날짜 — 같은 날 두 번 실행 방지 */
}
function _reportSchedulePath(): string {
    return path.join(getCompanyDir(), '_shared', 'report_schedule.json');
}
function readReportSchedule(): { entries: ReportScheduleEntry[] } {
    try {
        const p = _reportSchedulePath();
        if (!fs.existsSync(p)) return { entries: [] };
        const data = JSON.parse(fs.readFileSync(p, 'utf-8') || '{}');
        return { entries: Array.isArray(data.entries) ? data.entries : [] };
    } catch { return { entries: [] }; }
}
function writeReportSchedule(s: { entries: ReportScheduleEntry[] }) {
    try {
        fs.mkdirSync(path.dirname(_reportSchedulePath()), { recursive: true });
        fs.writeFileSync(_reportSchedulePath(), JSON.stringify(s, null, 2));
    } catch (e: any) {
        console.warn('[reportSchedule] write failed:', e?.message || e);
    }
}
let _reportSchedulerTimer: NodeJS.Timeout | null = null;
async function _runScheduledReportEntry(entry: ReportScheduleEntry) {
    try {
        if (entry.action === 'briefing') {
            await _runDailyBriefingOnce(true);
        } else if (entry.action === 'tool' && entry.tool && entry.agentId) {
            const toolDir = path.join(getCompanyDir(), '_agents', entry.agentId, 'tools');
            const scriptPath = path.join(toolDir, `${entry.tool}.py`);
            if (!fs.existsSync(scriptPath)) {
                console.warn(`[scheduler] tool not found: ${scriptPath}`);
                return;
            }
            const r = await runCommandCaptured(`python3 ${JSON.stringify(entry.tool + '.py')}`, toolDir, () => {}, 120000);
            const out = (r.output || '').trim();
            const status = r.exitCode === 0 ? '✅' : `❌ exit ${r.exitCode}`;
            const msg = `📆 *${entry.label}* (스케줄 자동 실행) ${status}\n\n\`\`\`\n${out.slice(0, 3000)}\n\`\`\``;
            try { await sendTelegramLong(msg); } catch { /* silent */ }
            try { _activeChatProvider?.postSystemNote?.(`📆 ${entry.label} 자동 실행 ${status}`, '📆'); } catch { /* ignore */ }
        }
    } catch (e: any) {
        console.warn('[scheduler] entry failed:', e?.message || e);
    }
}
function _scheduleTick() {
    try {
        const sch = readReportSchedule();
        if (sch.entries.length === 0) return;
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const dow = now.getDay();
        const hour = now.getHours();
        const minute = now.getMinutes();
        let changed = false;
        for (const entry of sch.entries) {
            if (!entry.enabled) continue;
            if (entry.hour !== hour || entry.minute !== minute) continue;
            if (entry.days && entry.days.length > 0 && !entry.days.includes(dow)) continue;
            if (entry.lastFiredAt === today) continue; /* 오늘 이미 실행 */
            entry.lastFiredAt = today;
            changed = true;
            _runScheduledReportEntry(entry).catch(() => { /* silent */ });
        }
        if (changed) writeReportSchedule(sch);
    } catch (e: any) {
        console.warn('[scheduler] tick failed:', e?.message || e);
    }
}
function startReportScheduler() {
    if (_reportSchedulerTimer) return;
    /* 매 60초마다 점검. 분 단위 정밀도면 충분. */
    _reportSchedulerTimer = setInterval(_scheduleTick, 60_000);
    /* 첫 tick은 30초 후 — 활성화 직후 폭주 방지 */
    setTimeout(_scheduleTick, 30_000);
}
function stopReportScheduler() {
    if (_reportSchedulerTimer) {
        clearInterval(_reportSchedulerTimer);
        _reportSchedulerTimer = null;
    }
}

function startTelegramPolling() {
    if (_telegramPollTimer) return;
    // Restore last known offset so we never replay messages after a restart
    if (_extCtx) {
        _telegramPollOffset = _extCtx.globalState.get<number>('telegramPollOffset', 0);
    }
    const tick = async () => {
        if (_telegramPolling) return;
        const { token, chatId } = readTelegramConfig();
        if (!token || !chatId) return; // not configured — quietly idle
        if (!_tryAcquireTelegramLock()) return; // another window is already the leader
        _telegramPolling = true;
        /* v2.89.24 — 유저 레벨 파일 offset 사용. globalState는 같은 머신·같은 확장이지만
           Antigravity 같은 fork에서 namespace가 다를 수 있어서, 진짜 공유는 파일 한 군데. */
        const fileOffset = _readTelegramOffset();
        if (fileOffset > _telegramPollOffset) _telegramPollOffset = fileOffset;
        if (_extCtx) {
            const stored = _extCtx.globalState.get<number>('telegramPollOffset', 0);
            if (stored > _telegramPollOffset) _telegramPollOffset = stored;
        }
        try {
            /* v2.89.41 — Long polling. timeout=25는 Telegram 서버에 "메시지 올 때까지 25초간
               열어둬"라고 요청. 메시지 오면 즉시 반환, 없으면 25초 후 빈 배열. 결과:
               - 텔레그램 응답성: 5초 폴링 사이클 → 거의 실시간 (메시지 도착하자마자 반환)
               - API 호출 ~12배 감소 (5초마다 → 25~30초마다)
               - 트래픽·배터리 절약 */
            const url = `https://api.telegram.org/bot${token}/getUpdates`;
            const res = await axios.get(url, {
                params: { offset: _telegramPollOffset, timeout: 25, allowed_updates: JSON.stringify(['message']) },
                timeout: 30_000 /* 서버 timeout(25s) + 네트워크 여유 5s */
            });
            const updates = res.data?.result || [];
            for (const u of updates) {
                _telegramPollOffset = (u.update_id || 0) + 1;
                try { _extCtx?.globalState.update('telegramPollOffset', _telegramPollOffset); } catch {}
                /* v2.89.24 — 유저 레벨 파일에도 즉시 commit. 다른 창이 다음 tick에 이걸 읽어서
                   같은 update 두 번 처리하지 않게. */
                _writeTelegramOffset(_telegramPollOffset);
                const m = u.message;
                if (!m) continue;
                const fromChat = String(m.chat?.id ?? '');
                if (fromChat !== String(chatId)) continue; // whitelist guard
                const text = (m.text || '').trim();
                if (!text) continue;
                try { await handleTelegramCommand(text); }
                catch (e: any) {
                    try { await sendTelegramReport(`⚠️ 명령 처리 중 오류: ${e?.message || e}`); } catch {}
                }
            }
        } catch (e: any) {
            if (e?.response?.status === 401) {
                console.warn('[Telegram] 401 — bot token rejected. Stopping polling until config changes.');
                stopTelegramPolling();
            }
            // Other errors (network, 5xx) silently retry next tick.
        } finally {
            _telegramPolling = false;
        }
    };
    /* v2.89.41 — long-poll이 25초 블록되니 setInterval은 long poll 끝난 직후 다음 tick
       발동시키는 안전망 역할. 1초 간격으로 체크하지만 _telegramPolling 가드 때문에
       동시 실행 안 됨 (이전 tick이 long poll 중이면 즉시 return). */
    _telegramPollTimer = setInterval(tick, 1000);
    setTimeout(tick, 500);
}

function stopTelegramPolling() {
    if (_telegramPollTimer) {
        clearInterval(_telegramPollTimer);
        _telegramPollTimer = null;
    }
    _releaseTelegramLockIfOwned();
}

function stopTrackerNudge() {
    if (_trackerNudgeTimer) {
        clearInterval(_trackerNudgeTimer);
        _trackerNudgeTimer = null;
    }
}

/* ── Google Calendar OAuth (write) ────────────────────────────────────────
   Config lives in `_company/_agents/secretary/tools/google_calendar_write.json`:
     { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, CALENDAR_ID, DEFAULT_DURATION_MINUTES,
       _CONNECTED_AS, _CONNECTED_AT }
   The wizard (runConnectGoogleCalendarWrite) walks the user through pasting
   their Client ID/Secret then runs the loopback OAuth dance and persists a
   refresh_token. Calendar events are created via createCalendarEventForTask
   when a tracker task has a due date. */

interface CalendarWriteConfig {
  CLIENT_ID?: string;
  CLIENT_SECRET?: string;
  REFRESH_TOKEN?: string;
  CALENDAR_ID?: string;
  DEFAULT_DURATION_MINUTES?: number;
  _CONNECTED_AS?: string;
  _CONNECTED_AT?: string;
}

function _calendarWriteConfigPath(): string {
  return path.join(getCompanyDir(), '_agents', 'secretary', 'tools', 'google_calendar_write.json');
}

function readCalendarWriteConfig(): CalendarWriteConfig {
  try {
    const p = _calendarWriteConfigPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf-8') || '{}');
  } catch { return {}; }
}
function writeCalendarWriteConfig(cfg: CalendarWriteConfig) {
  const p = _calendarWriteConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  /* Merge so we never blow away unrelated fields */
  const cur = readCalendarWriteConfig();
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...cfg }, null, 2));
}
function isCalendarWriteConnected(): boolean {
  const c = readCalendarWriteConfig();
  return !!(c.CLIENT_ID && c.CLIENT_SECRET && c.REFRESH_TOKEN);
}

/* Exchange refresh_token for a fresh access_token (lifetime ~1h).
   Returns null on any failure — caller should fall back gracefully. */
async function _getCalendarAccessToken(): Promise<string | null> {
  const c = readCalendarWriteConfig();
  if (!c.CLIENT_ID || !c.CLIENT_SECRET || !c.REFRESH_TOKEN) return null;
  try {
    const res = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: c.CLIENT_ID,
        client_secret: c.CLIENT_SECRET,
        refresh_token: c.REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 12000,
        validateStatus: () => true,
      }
    );
    if (res.status >= 200 && res.status < 300 && res.data?.access_token) {
      return String(res.data.access_token);
    }
    console.warn('[Calendar] token refresh failed:', res.status, res.data);
    return null;
  } catch (e: any) {
    console.warn('[Calendar] token refresh error:', e?.message || e);
    return null;
  }
}

/* Create a calendar event for a tracker task. Best effort — never throws.
   Returns the eventId if successful so the caller can persist it on the
   tracker entry for future updates. */
async function createCalendarEventForTask(task: TrackerTask): Promise<string | null> {
  if (!task.dueAt) return null;
  const access = await _getCalendarAccessToken();
  if (!access) return null;
  const cfg = readCalendarWriteConfig();
  const calendarId = (cfg.CALENDAR_ID || 'primary').trim() || 'primary';
  const dur = Number(cfg.DEFAULT_DURATION_MINUTES) > 0 ? Number(cfg.DEFAULT_DURATION_MINUTES) : 60;
  /* dueAt is "YYYY-MM-DD" or full ISO. If date-only, default to 9am that day
     so it shows up on the user's morning. */
  let startIso: string;
  let endIso: string;
  let isAllDay = false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.dueAt)) {
    const start = new Date(task.dueAt + 'T09:00:00');
    const end = new Date(start.getTime() + dur * 60_000);
    startIso = start.toISOString();
    endIso = end.toISOString();
  } else {
    try {
      const start = new Date(task.dueAt);
      const end = new Date(start.getTime() + dur * 60_000);
      startIso = start.toISOString();
      endIso = end.toISOString();
    } catch {
      return null;
    }
  }
  const body: any = {
    summary: task.title.slice(0, 200),
    description: (task.description || '') + `\n\n📋 추적 ID: ${task.id}\n생성: 비서(Secretary)`,
    start: isAllDay ? { date: task.dueAt } : { dateTime: startIso },
    end: isAllDay ? { date: task.dueAt } : { dateTime: endIso },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }, { method: 'popup', minutes: 60 }] },
  };
  try {
    const res = await axios.post(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      body,
      {
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        timeout: 12000,
        validateStatus: () => true,
      }
    );
    if (res.status >= 200 && res.status < 300 && res.data?.id) {
      return String(res.data.id);
    }
    console.warn('[Calendar] create event failed:', res.status, res.data);
    return null;
  } catch (e: any) {
    console.warn('[Calendar] create event error:', e?.message || e);
    return null;
  }
}

/* Update a calendar event when its tracker task changes. Best effort —
   silently no-ops if the task has no event id or Calendar isn't connected.
   Used when a task gets renamed, completed, or its due date moves. */
async function updateCalendarEventForTask(task: TrackerTask): Promise<boolean> {
  if (!task.calendarEventId) return false;
  const access = await _getCalendarAccessToken();
  if (!access) return false;
  const cfg = readCalendarWriteConfig();
  const calendarId = (cfg.CALENDAR_ID || 'primary').trim() || 'primary';
  const dur = Number(cfg.DEFAULT_DURATION_MINUTES) > 0 ? Number(cfg.DEFAULT_DURATION_MINUTES) : 60;
  const body: any = {
    summary: (task.status === 'done' ? '✅ ' : task.status === 'cancelled' ? '✖️ ' : '') + task.title.slice(0, 200),
    description: (task.description || '') + `\n\n📋 추적 ID: ${task.id}\n상태: ${task.status}\n수정: 비서(Secretary)`,
  };
  if (task.dueAt) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(task.dueAt)) {
      const start = new Date(task.dueAt + 'T09:00:00');
      const end = new Date(start.getTime() + dur * 60_000);
      body.start = { dateTime: start.toISOString() };
      body.end = { dateTime: end.toISOString() };
    } else {
      try {
        const start = new Date(task.dueAt);
        const end = new Date(start.getTime() + dur * 60_000);
        body.start = { dateTime: start.toISOString() };
        body.end = { dateTime: end.toISOString() };
      } catch { /* skip time update */ }
    }
  }
  try {
    const r = await axios.patch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(task.calendarEventId)}`,
      body,
      {
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        timeout: 12000, validateStatus: () => true,
      }
    );
    return r.status >= 200 && r.status < 300;
  } catch { return false; }
}

/* Delete a calendar event by id. Used when a tracker task is cancelled
   so the user's calendar isn't cluttered with abandoned plans. */
async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const access = await _getCalendarAccessToken();
  if (!access) return false;
  const cfg = readCalendarWriteConfig();
  const calendarId = (cfg.CALENDAR_ID || 'primary').trim() || 'primary';
  try {
    const r = await axios.delete(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 12000, validateStatus: () => true,
      }
    );
    return r.status >= 200 && r.status < 300;
  } catch { return false; }
}

/* PATCH an existing calendar event — partial update (only the fields we send
   change). Used when Secretary handles "그 일정 4시로 바꿔줘" / "회의 30분
   늘려줘" style requests without having to delete + recreate (which would
   change the eventId and break any external references). */
async function patchCalendarEvent(eventId: string, opts: {
  title?: string;
  startIso?: string;
  endIso?: string;
  description?: string;
  location?: string;
}): Promise<{ eventId: string; htmlLink?: string; startIso: string; endIso: string } | null> {
  if (!eventId) return null;
  const access = await _getCalendarAccessToken();
  if (!access) return null;
  const cfg = readCalendarWriteConfig();
  const calendarId = (cfg.CALENDAR_ID || 'primary').trim() || 'primary';
  const body: any = {};
  if (opts.title) body.summary = opts.title.slice(0, 200);
  if (opts.location) body.location = opts.location.slice(0, 200);
  if (opts.description) body.description = `${opts.description}\n\n수정: 비서(Secretary)`;
  if (opts.startIso) {
    const s = new Date(opts.startIso);
    if (!isNaN(s.getTime())) body.start = { dateTime: s.toISOString() };
  }
  if (opts.endIso) {
    const e = new Date(opts.endIso);
    if (!isNaN(e.getTime())) body.end = { dateTime: e.toISOString() };
  }
  try {
    const r = await axios.patch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      body,
      {
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        timeout: 12000, validateStatus: () => true,
      }
    );
    if (r.status >= 200 && r.status < 300 && r.data?.id) {
      return {
        eventId: String(r.data.id),
        htmlLink: r.data.htmlLink,
        startIso: r.data.start?.dateTime || r.data.start?.date || '',
        endIso: r.data.end?.dateTime || r.data.end?.date || '',
      };
    }
    return null;
  } catch { return null; }
}

/* Create a free-form calendar event (not tied to a tracker task). Used by
   the Secretary when the user says "내일 11시 미팅 잡아줘" — direct natural
   language to Calendar. Returns the event metadata or null on failure. */
async function createCalendarEventDirect(opts: {
  title: string;
  startIso: string;       // RFC3339 with timezone offset, or 'YYYY-MM-DDTHH:mm:ss'
  endIso?: string;        // optional — defaults to start + DEFAULT_DURATION_MINUTES
  description?: string;
  location?: string;
}): Promise<{ eventId: string; htmlLink?: string; startIso: string; endIso: string } | null> {
  const access = await _getCalendarAccessToken();
  if (!access) return null;
  const cfg = readCalendarWriteConfig();
  const calendarId = (cfg.CALENDAR_ID || 'primary').trim() || 'primary';
  const dur = Number(cfg.DEFAULT_DURATION_MINUTES) > 0 ? Number(cfg.DEFAULT_DURATION_MINUTES) : 60;
  let startIso = '';
  let endIso = '';
  try {
    const start = new Date(opts.startIso);
    if (isNaN(start.getTime())) return null;
    const end = opts.endIso ? new Date(opts.endIso) : new Date(start.getTime() + dur * 60_000);
    if (isNaN(end.getTime())) return null;
    startIso = start.toISOString();
    endIso = end.toISOString();
  } catch { return null; }
  const body: any = {
    summary: opts.title.slice(0, 200),
    description: (opts.description || '') + '\n\n생성: 비서(Secretary)',
    start: { dateTime: startIso },
    end: { dateTime: endIso },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'popup', minutes: 60 }] },
  };
  if (opts.location) body.location = opts.location.slice(0, 200);
  try {
    const r = await axios.post(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      body,
      {
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        timeout: 12000, validateStatus: () => true,
      }
    );
    if (r.status >= 200 && r.status < 300 && r.data?.id) {
      return { eventId: String(r.data.id), htmlLink: r.data.htmlLink, startIso, endIso };
    }
    return null;
  } catch { return null; }
}

/* Find calendar events matching a fuzzy query (used by Secretary when user
   says "내일 회의 취소해" — match by title + date window). Returns up to 5
   results sorted by closeness to "now". */
async function findCalendarEvents(opts: {
  query?: string;
  daysAhead?: number;
}): Promise<Array<{ eventId: string; title: string; startIso: string; endIso: string; htmlLink?: string }>> {
  const access = await _getCalendarAccessToken();
  if (!access) return [];
  const cfg = readCalendarWriteConfig();
  const calendarId = (cfg.CALENDAR_ID || 'primary').trim() || 'primary';
  const days = opts.daysAhead && opts.daysAhead > 0 ? opts.daysAhead : 14;
  const now = new Date();
  const future = new Date(now.getTime() + days * 86_400_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(), timeMax: future.toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '20',
  });
  if (opts.query) params.set('q', opts.query.slice(0, 80));
  try {
    const r = await axios.get(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${access}` }, timeout: 12000, validateStatus: () => true }
    );
    if (r.status < 200 || r.status >= 300) return [];
    const items = Array.isArray(r.data?.items) ? r.data.items : [];
    return items.slice(0, 5).map((ev: any) => ({
      eventId: String(ev.id),
      title: String(ev.summary || '(제목 없음)'),
      startIso: String(ev.start?.dateTime || ev.start?.date || ''),
      endIso: String(ev.end?.dateTime || ev.end?.date || ''),
      htmlLink: ev.htmlLink,
    }));
  } catch { return []; }
}

/* List upcoming events via OAuth + write to _shared/calendar_cache.md so
   the rest of the company sees them. Same target file the iCal tool writes
   to — OAuth users don't need to also run the iCal tool. */
async function refreshCalendarCacheViaOAuth(daysAhead: number = 14): Promise<{ ok: boolean; count: number; error?: string }> {
  const access = await _getCalendarAccessToken();
  if (!access) return { ok: false, count: 0, error: 'no token' };
  const cfg = readCalendarWriteConfig();
  const calendarId = (cfg.CALENDAR_ID || 'primary').trim() || 'primary';
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 86_400_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  let events: any[] = [];
  try {
    const r = await axios.get(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 12000,
        validateStatus: () => true,
      }
    );
    if (r.status < 200 || r.status >= 300) {
      return { ok: false, count: 0, error: `HTTP ${r.status}` };
    }
    events = Array.isArray(r.data?.items) ? r.data.items : [];
  } catch (e: any) {
    return { ok: false, count: 0, error: e?.message || String(e) };
  }
  /* Write the same calendar_cache.md format the iCal tool produces. */
  const dir = getCompanyDir();
  fs.mkdirSync(path.join(dir, '_shared'), { recursive: true });
  const lines: string[] = [];
  lines.push('# 📅 다가오는 일정 (Google Calendar)');
  lines.push(`_업데이트: ${now.toLocaleString('ko-KR')} · 향후 ${daysAhead}일 · OAuth 동기화_`);
  lines.push('');
  if (events.length === 0) {
    lines.push('_없음_');
  } else {
    for (const ev of events) {
      const start = ev.start?.dateTime || ev.start?.date;
      if (!start) continue;
      const allDay = !!ev.start?.date;
      let stamp = '';
      try {
        const d = new Date(start);
        stamp = allDay ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 16).replace('T', ' ');
      } catch { stamp = String(start); }
      const summary = (ev.summary || '(제목 없음)').replace(/\n/g, ' ');
      const loc = ev.location ? ` — 📍 ${String(ev.location).replace(/\n/g, ' ').slice(0, 80)}` : '';
      lines.push(`- **${stamp}** · ${summary}${loc}`);
    }
  }
  fs.writeFileSync(path.join(dir, '_shared', 'calendar_cache.md'), lines.join('\n') + '\n');
  return { ok: true, count: events.length };
}

/* OAuth setup wizard — guides the user through Google Cloud setup, captures
   their Client ID/Secret, runs a loopback auth flow, and persists the
   refresh_token. Only Secretary owns this — keys live in Secretary's tool
   config so the rest of the system can find them via one stable path. */
async function runConnectGoogleCalendarWrite() {
  const cfg = readCalendarWriteConfig();
  const already = isCalendarWriteConnected();
  if (already) {
    const choice = await vscode.window.showInformationMessage(
      `✅ 이미 연결됨: ${cfg._CONNECTED_AS || 'Google 계정'}`,
      { modal: false },
      '연결 해제',
      '재연결',
      '취소'
    );
    if (choice === '연결 해제') {
      writeCalendarWriteConfig({ REFRESH_TOKEN: '', _CONNECTED_AS: '', _CONNECTED_AT: '' });
      await vscode.window.showInformationMessage('Google Calendar 쓰기 연결 해제됨.');
      return;
    }
    if (choice !== '재연결') return;
  }

  const intro = await vscode.window.showInformationMessage(
    `📅 Google Calendar 자동 일정 등록 — 셋업 (약 5~10분)\n\n1단계: Google Cloud Console에서 OAuth 클라이언트 만들기 (수동)\n2단계: Client ID + Secret 붙여넣기\n3단계: 브라우저로 로그인 → 끝\n\n시작할까요?`,
    { modal: true },
    '시작',
    'Google Cloud Console 먼저 열기',
    '취소'
  );
  if (intro === '취소' || !intro) return;
  if (intro === 'Google Cloud Console 먼저 열기') {
    await vscode.env.openExternal(vscode.Uri.parse('https://console.cloud.google.com/apis/credentials'));
    const back = await vscode.window.showInformationMessage(
      `Google Cloud에서 다음 단계를 마쳤으면 계속 →\n\n1. 새 프로젝트 만들기\n2. APIs & Services → Library → "Google Calendar API" 활성화\n3. OAuth 동의 화면 설정 (External, Test users에 본인 이메일)\n4. Credentials → Create OAuth 2.0 Client ID → 'Desktop app'\n5. Client ID + Client Secret 복사`,
      { modal: true },
      '다 됐음 →',
      '취소'
    );
    if (back !== '다 됐음 →') return;
  }

  const clientId = await vscode.window.showInputBox({
    title: 'Google OAuth Client ID',
    prompt: 'Google Cloud Credentials 페이지에서 복사한 Client ID',
    placeHolder: 'xxxxxxxx.apps.googleusercontent.com',
    ignoreFocusOut: true,
    validateInput: v => (v || '').trim() ? null : '비어있어요',
  });
  if (!clientId) return;
  const clientSecret = await vscode.window.showInputBox({
    title: 'Google OAuth Client Secret',
    prompt: '같은 화면의 Client Secret',
    placeHolder: 'GOCSPX-...',
    password: true,
    ignoreFocusOut: true,
    validateInput: v => (v || '').trim() ? null : '비어있어요',
  });
  if (!clientSecret) return;

  /* OAuth dance — spin up a one-shot local HTTP server, open browser,
     wait for ?code=... callback, exchange. */
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: '🔐 Google 로그인 대기 중…',
    cancellable: true,
  }, async (progress, cancelToken) => {
    progress.report({ message: '브라우저에서 Google 로그인 진행하세요' });
    const result = await _runCalendarOAuthLoopback(clientId.trim(), clientSecret.trim(), cancelToken);
    if (!result.ok) {
      await vscode.window.showErrorMessage(`OAuth 실패: ${result.error || '알 수 없는 오류'}`);
      return;
    }
    /* Verify token works by hitting userinfo */
    let connectedAs = '';
    try {
      const r = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${result.accessToken}` },
        timeout: 8000, validateStatus: () => true,
      });
      if (r.status >= 200 && r.status < 300) {
        connectedAs = r.data?.email || r.data?.name || '';
      }
    } catch { /* non-fatal */ }
    writeCalendarWriteConfig({
      CLIENT_ID: clientId.trim(),
      CLIENT_SECRET: clientSecret.trim(),
      REFRESH_TOKEN: result.refreshToken,
      CALENDAR_ID: 'primary',
      DEFAULT_DURATION_MINUTES: 60,
      _CONNECTED_AS: connectedAs,
      _CONNECTED_AT: new Date().toISOString(),
    });
    /* Immediately pull upcoming events too so calendar_cache.md is fresh —
       this means OAuth users don't need to also configure the iCal tool. */
    const refresh = await refreshCalendarCacheViaOAuth(14).catch(e => ({ ok: false, count: 0, error: String(e?.message || e) }));
    const refreshNote = refresh.ok
      ? `\n\n📥 다가오는 일정 ${refresh.count}개도 회사 컨텍스트에 동기화됨 (iCal 도구 별도 셋업 불필요)`
      : '';
    await vscode.window.showInformationMessage(
      `✅ Google Calendar 연결 완료!${connectedAs ? ' (' + connectedAs + ')' : ''}\n\n이제 due 있는 작업이 추적기에 등록되면 자동으로 캘린더에 일정이 만들어집니다.${refreshNote}`
    );
  });
}

async function _runCalendarOAuthLoopback(
  clientId: string,
  clientSecret: string,
  cancelToken: vscode.CancellationToken
): Promise<{ ok: true; accessToken: string; refreshToken: string } | { ok: false; error: string }> {
  return new Promise(resolve => {
    const http = require('http');
    let _resolved = false;
    function _resolve(v: any) { if (_resolved) return; _resolved = true; resolve(v); }
    /* Bind to ephemeral port (0) — Google accepts any localhost port for
       Desktop-app OAuth clients. */
    const server = http.createServer((req: any, res: any) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const code = url.searchParams.get('code');
        const err = url.searchParams.get('error');
        /* Ignore non-callback requests (favicon.ico, etc.) — browsers send
           these automatically and they don't carry code/error params. Without
           this guard the second request races with the token exchange and
           resolves with 'no code'. */
        if (!code && !err) {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (err) {
          res.end(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect AI — 인증 실패</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080a0f;color:#e2e8f0;font-family:'SF Pro Display','Pretendard',-apple-system,system-ui,sans-serif;overflow:hidden}
body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(239,68,68,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(239,68,68,.03) 1px,transparent 1px);background-size:40px 40px;animation:gridDrift 20s linear infinite}
@keyframes gridDrift{from{transform:translateY(0)}to{transform:translateY(40px)}}
.card{position:relative;text-align:center;padding:48px 40px;max-width:440px;width:90vw;background:linear-gradient(180deg,rgba(15,8,8,.96),rgba(8,6,6,.99));border:1px solid rgba(239,68,68,.35);border-radius:20px;box-shadow:0 0 80px rgba(239,68,68,.12),0 30px 80px rgba(0,0,0,.7)}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#ef4444,transparent);border-radius:20px 20px 0 0}
.brand{font-family:'SF Mono','JetBrains Mono',monospace;font-size:10px;letter-spacing:3.5px;color:rgba(239,68,68,.6);text-transform:uppercase;margin-bottom:28px}
.icon{font-size:56px;margin-bottom:16px;filter:drop-shadow(0 0 20px rgba(239,68,68,.4))}
h1{font-size:22px;font-weight:700;color:#ef4444;margin-bottom:10px;text-shadow:0 0 14px rgba(239,68,68,.3)}
.msg{font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:8px}
.err{font-family:'SF Mono',monospace;font-size:11px;color:rgba(239,68,68,.7);background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:8px;padding:8px 14px;margin:16px 0}
.hint{font-size:12px;color:#64748b;margin-top:20px}
</style></head><body>
<div class="card">
<div class="brand">Connect · AI Solopreneur OS</div>
<div class="icon">🔴</div>
<h1>인증 실패</h1>
<div class="err">${err}</div>
<p class="msg">Connect AI로 돌아가서 다시 시도해주세요.</p>
<p class="hint">이 탭은 닫아도 됩니다.</p>
</div>
</body></html>`);
          server.close();
          _resolve({ ok: false, error: err });
          return;
        }
        res.end(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect AI — 인증 완료</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080a0f;color:#e2e8f0;font-family:'SF Pro Display','Pretendard',-apple-system,system-ui,sans-serif;overflow:hidden}
body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(0,255,65,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,65,.03) 1px,transparent 1px);background-size:40px 40px;animation:gridDrift 20s linear infinite}
@keyframes gridDrift{from{transform:translateY(0)}to{transform:translateY(40px)}}
body::after{content:'';position:fixed;inset:0;background:linear-gradient(180deg,transparent 0,transparent 50%,rgba(0,255,65,.04) 50.2%,transparent 51%);background-size:100% 220px;animation:scan 5s linear infinite;pointer-events:none}
@keyframes scan{from{background-position:0 -220px}to{background-position:0 100vh}}
.card{position:relative;text-align:center;padding:48px 40px;max-width:440px;width:90vw;background:linear-gradient(180deg,rgba(8,14,10,.96),rgba(4,8,5,.99));border:1px solid rgba(0,255,65,.35);border-radius:20px;box-shadow:0 0 80px rgba(0,255,65,.12),0 30px 80px rgba(0,0,0,.7);animation:cardIn .7s cubic-bezier(.16,1,.3,1)}
@keyframes cardIn{from{opacity:0;transform:translateY(20px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#00ff41,transparent);border-radius:20px 20px 0 0;animation:linePulse 2s ease-in-out infinite}
@keyframes linePulse{0%,100%{opacity:.6}50%{opacity:1}}
.brand{font-family:'SF Mono','JetBrains Mono',monospace;font-size:10px;letter-spacing:3.5px;color:rgba(0,255,65,.5);text-transform:uppercase;margin-bottom:28px}
.ring{position:relative;width:100px;height:100px;margin:0 auto 24px;display:flex;align-items:center;justify-content:center}
.ring::before,.ring::after{content:'';position:absolute;inset:0;border-radius:50%;border:1.5px solid rgba(0,255,65,.4);border-top-color:transparent;border-right-color:transparent}
.ring::before{animation:spin 2s linear infinite}
.ring::after{inset:10px;border-color:rgba(0,255,65,.25);border-bottom-color:transparent;animation:spin 3s linear infinite reverse}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.icon{font-size:44px;position:relative;z-index:2;filter:drop-shadow(0 0 20px rgba(0,255,65,.5));animation:iconPop .5s .3s cubic-bezier(.16,1,.3,1) both}
@keyframes iconPop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
h1{font-size:22px;font-weight:700;color:#00ff41;margin-bottom:10px;text-shadow:0 0 14px rgba(0,255,65,.3);animation:fadeUp .5s .5s ease both}
.msg{font-size:13px;color:#94a3b8;line-height:1.6;animation:fadeUp .5s .6s ease both}
.msg strong{color:#22c55e}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.countdown{font-family:'SF Mono',monospace;font-size:11px;color:rgba(0,255,65,.4);letter-spacing:2px;margin-top:24px;animation:fadeUp .5s .8s ease both}
.particles{position:fixed;inset:0;pointer-events:none;overflow:hidden}
.p{position:absolute;width:3px;height:3px;background:#00ff41;border-radius:50%;box-shadow:0 0 6px #00ff41;opacity:0;animation:fly 2s ease-out forwards}
@keyframes fly{0%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(0)}}
</style></head><body>
<div class="particles" id="pts"></div>
<div class="card">
<div class="brand">Connect · AI Solopreneur OS</div>
<div class="ring"><span class="icon">✅</span></div>
<h1>인증 완료!</h1>
<p class="msg">Google Calendar가 <strong>Connect AI</strong>에 연결됐어요.<br>이 탭은 자동으로 닫힙니다.</p>
<p class="countdown" id="cd">3초 후 닫힘</p>
</div>
<script>
(function(){
var pts=document.getElementById('pts');
for(var i=0;i<24;i++){
var p=document.createElement('span');p.className='p';
var a=(i/24)*Math.PI*2,d=80+Math.random()*160;
p.style.left='50%';p.style.top='50%';
p.style.setProperty('--dx',Math.cos(a)*d+'px');
p.style.setProperty('--dy',Math.sin(a)*d+'px');
p.style.animationDelay=(Math.random()*.4)+'s';
if(i%3===0){p.style.background='#22d3ee';p.style.boxShadow='0 0 6px #22d3ee'}
if(i%5===0){p.style.background='#a78bfa';p.style.boxShadow='0 0 6px #a78bfa'}
pts.appendChild(p);
}
var s=3;var cd=document.getElementById('cd');
var t=setInterval(function(){s--;if(s<=0){clearInterval(t);cd.textContent='닫는 중…';window.close();}else{cd.textContent=s+'초 후 닫힘';}},1000);
})();
</script>
</body></html>`);
        const port = (server.address() && server.address().port) || 0;
        const redirectUri = `http://localhost:${port}`;
        /* Exchange code for tokens */
        axios.post(
          'https://oauth2.googleapis.com/token',
          new URLSearchParams({
            code: code!,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 12000,
            validateStatus: () => true,
          }
        ).then((r: any) => {
          server.close();
          if (r.status >= 200 && r.status < 300 && r.data?.refresh_token) {
            _resolve({ ok: true, accessToken: r.data.access_token || '', refreshToken: r.data.refresh_token });
          } else {
            _resolve({ ok: false, error: r.data?.error_description || r.data?.error || `HTTP ${r.status}` });
          }
        }).catch((e: any) => {
          server.close();
          _resolve({ ok: false, error: e?.message || String(e) });
        });
      } catch (e: any) {
        try { server.close(); } catch { /* ignore */ }
        _resolve({ ok: false, error: e?.message || String(e) });
      }
    });
    server.listen(0, '127.0.0.1', async () => {
      const port = (server.address() && server.address().port) || 0;
      if (!port) {
        resolve({ ok: false, error: 'failed to bind localhost port' });
        return;
      }
      const redirectUri = `http://localhost:${port}`;
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar.events openid email',
        access_type: 'offline',
        prompt: 'consent',
      }).toString();
      try { await vscode.env.openExternal(vscode.Uri.parse(authUrl)); } catch { /* user can copy from log */ }
      console.log('[Connect AI] Calendar OAuth URL:', authUrl);
    });
    /* Cancel after 3 minutes max */
    const timer = setTimeout(() => {
      try { server.close(); } catch { /* ignore */ }
      _resolve({ ok: false, error: '시간 초과 (3분). 다시 시도해주세요.' });
    }, 180_000);
    cancelToken.onCancellationRequested(() => {
      clearTimeout(timer);
      try { server.close(); } catch { /* ignore */ }
      _resolve({ ok: false, error: '사용자가 취소함' });
    });
  });
}

/* Stale-task nudge — Secretary scans the tracker every hour for user-owned
   tasks that have been pending >24h or are past their due date, and sends
   a single nudge per task via Telegram. Conservative: 1 ping per task max
   per ~24h, no spam. */
let _trackerNudgeTimer: NodeJS.Timeout | null = null;
const _NUDGE_WINDOW_MS = 23 * 60 * 60 * 1000; /* re-ping no more than once per ~day */
async function _runTrackerNudgeOnce() {
    /* Piggyback: refresh calendar_cache.md via OAuth if connected. This means
       OAuth users don't have to also configure the iCal tool — every hour
       we pull fresh events. Failure is silent. */
    if (isCalendarWriteConnected()) {
        refreshCalendarCacheViaOAuth(14).catch(() => { /* never let this break nudges */ });
    }
    try {
        const { token, chatId } = readTelegramConfig();
        if (!token || !chatId) return; // can't nudge without channel
        const tracker = readTracker();
        const now = Date.now();
        let changed = false;
        const nudges: string[] = [];
        for (const t of tracker.tasks) {
            if (t.status === 'done' || t.status === 'cancelled') continue;
            if (t.owner !== 'user' && t.owner !== 'mixed') continue;
            const lastNudge = (t as any)._lastNudgeAt ? new Date((t as any)._lastNudgeAt).getTime() : 0;
            if (now - lastNudge < _NUDGE_WINDOW_MS) continue;
            const ageDays = (now - new Date(t.createdAt).getTime()) / 86_400_000;
            const overdue = t.dueAt && new Date(t.dueAt).getTime() < now;
            if (!overdue && ageDays < 1) continue; /* not stale yet */
            nudges.push(`• \`${t.id.slice(-9)}\` ${t.title}${t.dueAt ? ` ⏰${t.dueAt.slice(0, 10)}` : ''}${overdue ? ' 🔴' : ''}`);
            (t as any)._lastNudgeAt = new Date().toISOString();
            t.nudges = (t.nudges || 0) + 1;
            changed = true;
        }
        if (changed) writeTracker(tracker);
        if (nudges.length > 0) {
            const body = `👀 *비서: 확인해주세요*\n\n진행되지 않은 사용자 작업이 있어요:\n\n${nudges.slice(0, 8).join('\n')}\n\n_완료: \`/done <id>\` · 취소: \`/cancel <id>\`_`;
            await sendTelegramReport(body);
        }
    } catch { /* never let nudge errors break anything */ }
}
function startTrackerNudgeLoop() {
    if (_trackerNudgeTimer) return;
    /* First check after 5 min, then hourly. Light interval keeps batterylcheap. */
    setTimeout(_runTrackerNudgeOnce, 5 * 60 * 1000);
    _trackerNudgeTimer = setInterval(_runTrackerNudgeOnce, 60 * 60 * 1000);
}

/* ── P0-3: Daily briefing auto-fire ─────────────────────────────────────
   Once per day at the user's configured time (default 09:00), Secretary
   builds and sends a "good morning" brief to Telegram covering:
     - Today's calendar (from calendar_cache.md)
     - Open tracker tasks (priority-sorted, top 5)
     - Yesterday's company highlights (last conversation log entries)
   Single-fire: tracks last-fired date in extension globalState so a VS Code
   restart at 09:30 doesn't double-send. */
let _dailyBriefingTimer: NodeJS.Timeout | null = null;
const _DAILY_BRIEFING_KEY = 'dailyBriefingLastSentDate';

function _parseBriefingTime(raw: string): { hour: number; minute: number } | null {
    if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'off') return null;
    const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
}

async function _runDailyBriefingOnce(force = false): Promise<void> {
    try {
        const cfg = vscode.workspace.getConfiguration('connectAiLab');
        const time = _parseBriefingTime(cfg.get<string>('dailyBriefingTime') || '09:00');
        if (!time && !force) return; // off
        const { token, chatId } = readTelegramConfig();
        if (!token || !chatId) return; // no channel
        const today = new Date().toISOString().slice(0, 10);
        const lastSent = _extCtx?.globalState.get<string>(_DAILY_BRIEFING_KEY, '');
        if (!force && lastSent === today) return; // already sent today

        /* Build the brief — kept text-only so the prompt stays small. */
        const dir = getCompanyDir();
        const company = readCompanyName() || '1인 기업';
        const dateStr = new Date().toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        /* 1. Calendar */
        let calBlock = '';
        try {
            const cal = _safeReadText(path.join(dir, '_shared', 'calendar_cache.md')).trim();
            if (cal) {
                const calLines = cal.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 6);
                if (calLines.length > 0) calBlock = `\n*📅 오늘 일정*\n${calLines.join('\n')}\n`;
            }
        } catch { /* ignore */ }
        if (!calBlock) calBlock = '\n*📅 오늘 일정*\n_등록된 일정이 없어요._\n';

        /* 2. Open tasks (top 5 by priority) */
        let taskBlock = '';
        try {
            const md = trackerToMarkdown({ onlyOpen: true, max: 5 });
            taskBlock = md ? `\n*✅ 우선순위 할 일 (상위 5)*\n${md}\n` : '\n*✅ 할 일*\n_진행 중인 작업이 없어요._\n';
        } catch { /* ignore */ }

        /* 3. Yesterday highlights — last 800 chars of yesterday's log */
        let yhBlock = '';
        try {
            const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            const ypath = path.join(getConversationsDir(), `${yest}.md`);
            const txt = _safeReadText(ypath);
            if (txt.trim()) {
                const tail = txt.slice(-700);
                yhBlock = `\n*📝 어제 회사 활동 (요약 컨텍스트)*\n${tail.slice(0, 700)}\n`;
            }
        } catch { /* ignore */ }

        const body = `🌅 *${company} — 아침 브리핑*\n_${dateStr}_\n${calBlock}${taskBlock}${yhBlock}\n_명령: \`/today\` 다시 보기 · \`/tools\` 도구 상태_`;
        await sendTelegramReport(body);
        if (_extCtx) {
            _extCtx.globalState.update(_DAILY_BRIEFING_KEY, today);
        }
        try { appendConversationLog({ speaker: '비서', emoji: '🌅', section: '데일리 브리핑', body: body.slice(0, 1000) }); } catch { /* ignore */ }
        /* v2.82: removed the system-note injection into chat. Daily briefing
           now lives only in: (1) telegram, (2) company dashboard "회사
           활동 로그" + KPI strip, (3) conversation log file. The chat is
           kept as a clean conversation surface — no auto-injected cards. */
    } catch { /* never let briefing errors break the extension */ }
}

function startDailyBriefingLoop() {
    if (_dailyBriefingTimer) return;
    /* Check every minute — cheap, gives ±60s precision on the configured time.
       The single-fire guard via globalState makes this safe to over-tick. */
    _dailyBriefingTimer = setInterval(() => {
        try {
            const cfg = vscode.workspace.getConfiguration('connectAiLab');
            const time = _parseBriefingTime(cfg.get<string>('dailyBriefingTime') || '09:00');
            if (!time) return;
            const now = new Date();
            if (now.getHours() === time.hour && now.getMinutes() === time.minute) {
                _runDailyBriefingOnce().catch(() => { /* silent */ });
            }
        } catch { /* ignore */ }
    }, 60 * 1000);
}

function stopDailyBriefingLoop() {
    if (_dailyBriefingTimer) {
        clearInterval(_dailyBriefingTimer);
        _dailyBriefingTimer = null;
    }
}

/* ── Task tracker ─────────────────────────────────────────────────────────
   Live followups for "이거 해 / 저거 해" style commands. Every dispatched
   task or user-owned commitment lands here; Secretary scans periodically
   to mark agent-side completions and nudge stale user-side items via
   Telegram. Single source of truth: _shared/tracker.json (structured so
   queries are fast and consistent).

   Schema:
     { "tasks": [ {id, title, description, owner, agentIds, createdAt,
                   dueAt, status, completedAt, sessionDir, nudges} ] }
       owner ∈ 'agent' | 'user' | 'mixed'
       status ∈ 'pending' | 'in_progress' | 'done' | 'cancelled' */

type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';
const TASK_PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: '🔴 긴급',
  high:   '🟠 높음',
  normal: '⚪ 보통',
  low:    '🔵 낮음',
};

interface TrackerTask {
  id: string;
  title: string;
  description?: string;
  owner: 'agent' | 'user' | 'mixed';
  agentIds?: string[];
  createdAt: string;
  dueAt?: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  completedAt?: string;
  sessionDir?: string;
  nudges?: number; /* how many telegram nudges sent for stale user tasks */
  evidence?: string;
  calendarEventId?: string; /* Google Calendar event id (when auto-created) */
  priority?: TaskPriority; /* added v2.78 — defaults to 'normal' on read */
  /* P1-6: recurrence — when set, the task is a template that auto-spawns
     fresh copies after each completion. cadence is a simple semantic key,
     nextRunAt is computed by the recurrence loop. */
  recurrence?: 'daily' | 'weekly' | 'monthly';
  nextRunAt?: string;
  /* P1-7: pre-alarms — track which "due-N" reminders we've already sent
     so the alarm loop doesn't re-fire every cycle. 't1d' = "1 day before",
     't1h' = "1 hour before". */
  preAlarmsSent?: string[];
}

function _coercePriority(v: unknown): TaskPriority {
  return v === 'urgent' || v === 'high' || v === 'low' ? v : 'normal';
}

function _trackerPath(): string {
  return path.join(getCompanyDir(), '_shared', 'tracker.json');
}

function readTracker(): { tasks: TrackerTask[] } {
  try {
    const p = _trackerPath();
    if (!fs.existsSync(p)) return { tasks: [] };
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch { return { tasks: [] }; }
}

/* Module-level event emitter so the sidebar Task TreeView auto-refreshes
   whenever the tracker file is modified through writeTracker (no matter who
   calls it — Secretary, autoMark, edit commands, recurrence loop). */
const _trackerChangeEmitter = new vscode.EventEmitter<void>();
const onTrackerChanged = _trackerChangeEmitter.event;

/* ── P0-4: Approval gate ──────────────────────────────────────────────────
   When an agent wants to do something risky (deploy, send, post, delete)
   the action lands as a markdown file in approvals/pending/ instead of
   executing. Secretary fires a Telegram card; user types /approve <id> or
   /reject <id> (or taps in the sidebar) to release or kill the action.
   File-based on purpose:
     - Survives restarts (no in-memory state)
     - Visible in git history (audit log)
     - User can grep/edit before approving */
interface PendingApproval {
    id: string;
    agentId: string;
    title: string;          /* one-line description */
    summary: string;        /* short rationale */
    payload: any;           /* opaque blob the executor needs */
    kind: string;           /* e.g. 'youtube.comment_reply', 'deploy.prod', 'instagram.post' */
    createdAt: string;
}

function _approvalsPendingDir(): string {
    return path.join(getCompanyDir(), 'approvals', 'pending');
}
function _approvalsHistoryDir(): string {
    return path.join(getCompanyDir(), 'approvals', 'history');
}
function _approvalsExecutorsDir(): string {
    /* Optional executors (`{kind}.js`) — when an approval is ✅, we look
       here for a script to run. Keeps the gate decoupled from any specific
       integration; agents register an executor when they ship. */
    return path.join(getCompanyDir(), 'approvals', 'executors');
}

function _approvalNewId(): string {
    const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 6);
    return `apr-${stamp}-${rand}`;
}

function createApproval(req: Omit<PendingApproval, 'id' | 'createdAt'>): PendingApproval {
    const dir = _approvalsPendingDir();
    fs.mkdirSync(dir, { recursive: true });
    const ap: PendingApproval = {
        id: _approvalNewId(),
        createdAt: new Date().toISOString(),
        ...req,
    };
    /* Markdown front for human-readable preview (so opening the file in VS
       Code shows what's about to happen), JSON fence for the executor. */
    const a = AGENTS[ap.agentId];
    const ownerLine = a ? `${a.emoji} ${a.name}` : ap.agentId;
    const md = `# ⏳ 승인 대기 — ${ap.title}

- **에이전트:** ${ownerLine}
- **종류:** \`${ap.kind}\`
- **요청 시각:** ${ap.createdAt}
- **id:** \`${ap.id.slice(-9)}\`

## 요약

${ap.summary || '_(없음)_'}

## 사용자 결정

텔레그램에서 \`/approve ${ap.id.slice(-9)}\` 또는 \`/reject ${ap.id.slice(-9)}\` —
사이드바 "승인 대기" 패널에서도 가능합니다.

## payload (실행기에 전달)

\`\`\`json
${JSON.stringify(ap.payload, null, 2)}
\`\`\`
`;
    fs.writeFileSync(path.join(dir, `${ap.id}.md`), md);
    fs.writeFileSync(path.join(dir, `${ap.id}.json`), JSON.stringify(ap, null, 2));
    /* Telegram card so the user knows something needs them — only fires
       when bot is configured. Daily briefing also surfaces this list. */
    sendTelegramReport(`⏳ *승인 대기 (${ownerLine})*\n\n${ap.title}\n\n${ap.summary.slice(0, 300)}\n\n_승인: \`/approve ${ap.id.slice(-9)}\` · 거부: \`/reject ${ap.id.slice(-9)}\`_`).catch(() => { /* silent */ });
    try { appendConversationLog({ speaker: ownerLine, emoji: '⏳', section: '승인 요청', body: `${ap.title} (${ap.kind})\n${ap.summary.slice(0, 300)}` }); } catch { /* ignore */ }
    /* Office indicator — secretary's desk gets ⏳ pulse since secretary owns
       the user-facing approval workflow. The originating agent ALSO pulses
       so user sees who requested it. Both decay quickly so the office
       doesn't get cluttered. */
    try {
        _activeChatProvider?.pulseAgent?.(ap.agentId, '⏳', 3500, `${ap.title} 승인 요청`);
        _activeChatProvider?.pulseAgent?.('secretary', '🔔', 3500);
    } catch { /* ignore */ }
    /* v2.82: removed chat sidebar injection — approvals now surface via
       (1) telegram card, (2) status bar "⚠️ 승인 N건" badge, (3) dashboard
       "⏳ 승인 대기" section. Chat stays clean for actual conversation. */
    /* Refresh the dedicated approvals webview if it's open. */
    try { _approvalsPanelProvider?.refresh(); } catch { /* ignore */ }
    return ap;
}

function listPendingApprovals(): PendingApproval[] {
    const dir = _approvalsPendingDir();
    if (!fs.existsSync(dir)) return [];
    const out: PendingApproval[] = [];
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
            const txt = fs.readFileSync(path.join(dir, f), 'utf-8');
            const ap = JSON.parse(txt);
            if (ap && ap.id) out.push(ap);
        } catch { /* skip malformed */ }
    }
    out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return out;
}

function findApprovalByShortId(short: string): PendingApproval | null {
    const all = listPendingApprovals();
    return all.find(a => a.id === short) || all.find(a => a.id.endsWith(short)) || null;
}

async function resolveApproval(id: string, decision: 'approved' | 'rejected', reason: string = ''): Promise<{ ok: boolean; message: string; ap?: PendingApproval }> {
    const ap = findApprovalByShortId(id);
    if (!ap) return { ok: false, message: '해당 id 승인 요청을 찾지 못했어요.' };
    const pendingDir = _approvalsPendingDir();
    const histDir = _approvalsHistoryDir();
    fs.mkdirSync(histDir, { recursive: true });
    /* Move both files (md + json) to history with decision suffix. */
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const tag = decision === 'approved' ? 'OK' : 'NO';
    const baseSrc = path.join(pendingDir, ap.id);
    const baseDst = path.join(histDir, `${stamp}_${tag}_${ap.id}`);
    let executorOutput = '';
    let executorOk = true;
    if (decision === 'approved') {
        /* Try to dispatch the executor — file `approvals/executors/{kind}.js`.
           Best-effort: if missing or it throws, we still record the approval
           but warn the user. No executor means "approval recorded, do it
           manually" — useful for early stage when integrations land in
           waves. */
        const execPath = path.join(_approvalsExecutorsDir(), `${ap.kind}.js`);
        if (fs.existsSync(execPath)) {
            try {
                /* Use spawnSync for isolation — no shared module cache. */
                const res = spawnSync('node', [execPath], {
                    cwd: getCompanyDir(),
                    encoding: 'utf-8',
                    timeout: 60000,
                    input: JSON.stringify(ap.payload),
                });
                executorOutput = (res.stdout || '') + (res.stderr ? `\n[stderr]\n${res.stderr}` : '');
                executorOk = res.status === 0;
            } catch (e: any) {
                executorOk = false;
                executorOutput = `executor error: ${e?.message || e}`;
            }
        } else {
            executorOutput = `(no executor for ${ap.kind} — approval recorded, manual follow-up)`;
        }
    }
    /* Append decision to the markdown for audit. */
    try {
        const mdPath = `${baseSrc}.md`;
        if (fs.existsSync(mdPath)) {
            const append = `\n---\n\n## 결정: **${decision === 'approved' ? '✅ 승인' : '✖️ 거부'}**\n- 시각: ${new Date().toISOString()}\n- 사유: ${reason || '_(없음)_'}\n${decision === 'approved' ? `- 실행 결과: ${executorOk ? 'OK' : 'FAIL'}\n\n\`\`\`\n${executorOutput.slice(0, 1500)}\n\`\`\`\n` : ''}`;
            fs.appendFileSync(mdPath, append);
        }
    } catch { /* ignore */ }
    /* Move pending → history. */
    try {
        for (const ext of ['.md', '.json']) {
            const src = `${baseSrc}${ext}`;
            const dst = `${baseDst}${ext}`;
            if (fs.existsSync(src)) fs.renameSync(src, dst);
        }
    } catch { /* ignore */ }
    const a = AGENTS[ap.agentId];
    const ownerLine = a ? `${a.emoji} ${a.name}` : ap.agentId;
    try { appendConversationLog({ speaker: ownerLine, emoji: decision === 'approved' ? '✅' : '✖️', section: '승인 결과', body: `${ap.title} (${ap.kind}) → ${decision}${reason ? '\n사유: ' + reason : ''}${decision === 'approved' && !executorOk ? '\n실행 실패' : ''}` }); } catch { /* ignore */ }
    return { ok: true, ap, message: decision === 'approved'
        ? `✅ 승인됨 — ${ap.title}${executorOutput ? `\n\n${executorOutput.slice(0, 600)}` : ''}`
        : `✖️ 거부됨 — ${ap.title}` };
}

/* P1-9: YouTube comment-reply queue ──────────────────────────────────────
   Pulls recent top-level comments on the user's channel via YouTube Data
   API v3 (read-only, just an API key — no OAuth needed for this part),
   drafts a reply per comment using the local LLM, lands each draft as a
   pending approval. User /approves to release; the executor (separate, OAuth
   required) actually posts. This split means a partial OAuth setup still
   gives the user the queue UX. Idempotent — won't re-queue a comment that
   already has a pending approval. */
/* P1-10: Developer project scaffolder ────────────────────────────────────
   Creates `_company/projects/<name>/` with a minimal working web template
   so the Developer agent (and the user) have a real folder to iterate in.
   Three templates cover the common cases:
     - vite-vanilla: dependency-free dev server, no React
     - vite-react:   React + TS for app-style projects
     - static:       single index.html with Tailwind CDN — for landing pages
   We don't run npm install — that's a privileged action, the user runs it
   when they're ready. We DO write a README that tells them the next steps. */
async function scaffoldDeveloperProject(name: string, template: 'vite-vanilla' | 'vite-react' | 'static'): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    try {
        const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safe) return { ok: false, error: '유효하지 않은 이름' };
        const root = path.join(getCompanyDir(), 'projects', safe);
        if (fs.existsSync(root)) return { ok: false, error: `이미 존재: ${root}` };
        fs.mkdirSync(path.join(root, 'site'), { recursive: true });
        fs.mkdirSync(path.join(root, 'logs'), { recursive: true });

        if (template === 'static') {
            fs.writeFileSync(path.join(root, 'site', 'index.html'),
`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safe}</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center">
  <main class="text-center space-y-4">
    <h1 class="text-4xl font-bold">${safe}</h1>
    <p class="text-zinc-400">Connect AI · Developer 에이전트가 만든 페이지</p>
  </main>
</body>
</html>
`);
        } else if (template === 'vite-vanilla') {
            fs.writeFileSync(path.join(root, 'site', 'package.json'),
                JSON.stringify({
                    name: safe,
                    private: true,
                    type: 'module',
                    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
                    devDependencies: { vite: '^5.0.0' },
                }, null, 2));
            fs.writeFileSync(path.join(root, 'site', 'index.html'),
`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${safe}</title>
</head>
<body>
<h1>${safe}</h1>
<script type="module" src="/main.js"></script>
</body>
</html>
`);
            fs.writeFileSync(path.join(root, 'site', 'main.js'),
`document.querySelector('h1').addEventListener('click', () => {
  console.log('hi from ${safe}');
});
`);
        } else if (template === 'vite-react') {
            fs.writeFileSync(path.join(root, 'site', 'package.json'),
                JSON.stringify({
                    name: safe,
                    private: true,
                    type: 'module',
                    scripts: { dev: 'vite', build: 'tsc && vite build', preview: 'vite preview' },
                    dependencies: { react: '^18.3.0', 'react-dom': '^18.3.0' },
                    devDependencies: {
                        '@types/react': '^18.3.0',
                        '@types/react-dom': '^18.3.0',
                        '@vitejs/plugin-react': '^4.3.0',
                        typescript: '^5.4.0',
                        vite: '^5.0.0',
                    },
                }, null, 2));
            fs.writeFileSync(path.join(root, 'site', 'tsconfig.json'),
                JSON.stringify({
                    compilerOptions: {
                        target: 'ES2020',
                        useDefineForClassFields: true,
                        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
                        module: 'ESNext',
                        skipLibCheck: true,
                        moduleResolution: 'bundler',
                        allowImportingTsExtensions: true,
                        resolveJsonModule: true,
                        isolatedModules: true,
                        noEmit: true,
                        jsx: 'react-jsx',
                        strict: true,
                    },
                    include: ['src'],
                }, null, 2));
            fs.writeFileSync(path.join(root, 'site', 'vite.config.ts'),
`import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });
`);
            fs.writeFileSync(path.join(root, 'site', 'index.html'),
`<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>${safe}</title></head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
`);
            fs.mkdirSync(path.join(root, 'site', 'src'), { recursive: true });
            fs.writeFileSync(path.join(root, 'site', 'src', 'main.tsx'),
`import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <h1>${safe}</h1>;
}

createRoot(document.getElementById('root')!).render(<App />);
`);
        }

        fs.writeFileSync(path.join(root, 'README.md'),
`# ${safe}

Developer 에이전트가 ${new Date().toISOString().slice(0, 10)}에 만든 프로젝트.
템플릿: \`${template}\`

## 다음 스텝

${template === 'static'
    ? `\`\`\`bash\ncd site && python3 -m http.server 5173\n# 또는: npx serve site\n\`\`\`\n브라우저에서 http://127.0.0.1:5173 열기.`
    : `\`\`\`bash\ncd site && npm install && npm run dev\n\`\`\`\nVite dev server가 http://localhost:5173 에서 실행됩니다.`}

## 결정 로그
\`decisions.md\`에 누적됩니다.
`);
        fs.writeFileSync(path.join(root, 'decisions.md'),
`# 📌 ${safe} 결정 로그

_Developer 에이전트와 사용자가 내린 디자인·기술 의사결정이 시간순으로 누적됩니다._

## [${new Date().toISOString().slice(0, 10)}] 프로젝트 생성
- 템플릿: \`${template}\`
- 위치: \`${path.relative(getCompanyDir(), root)}\`
`);
        try { appendConversationLog({ speaker: 'Developer', emoji: '💻', section: '프로젝트 생성', body: `${safe} (\`${template}\`) 생성 → ${root}` }); } catch { /* ignore */ }
        /* Tracker entry so the user sees it in the sidebar Task panel. */
        try {
            addTrackerTask({
                title: `${safe} 프로젝트 셋업 (${template})`,
                description: `다음 스텝: cd site && ${template === 'static' ? 'serve' : 'npm install && npm run dev'}`,
                owner: 'mixed',
                agentIds: ['developer'],
                status: 'in_progress',
                priority: 'normal',
            });
        } catch { /* ignore */ }
        /* Telegram ping so the user knows from any channel. */
        sendTelegramReport(`💻 *Developer*: \`${safe}\` 프로젝트 만들었어요 (${template})\n\n로컬: \`${path.relative(getCompanyDir(), root)}\`\n다음: ${template === 'static' ? '`cd site && python3 -m http.server 5173`' : '`cd site && npm install && npm run dev`'}`).catch(() => { /* silent */ });
        return { ok: true, path: root };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}

async function _youtubeCommentReplyDraftBatch(opts: { maxComments?: number; maxPerVideo?: number } = {}): Promise<{ drafted: number; skipped: number; reason?: string }> {
    /* Office pulse so the user sees youtube agent is working on something
       even when triggered from a button press rather than chat dispatch. */
    try { _activeChatProvider?.pulseAgent?.('youtube', '📺', 4000, '댓글 큐 갱신 중'); } catch { /* ignore */ }
    const cfgPath = path.join(getCompanyDir(), '_agents', 'youtube', 'config.md');
    const cfgTxt = _safeReadText(cfgPath);
    const apiM = cfgTxt.match(/YOUTUBE_API_KEY\s*[:：=]\s*([A-Za-z0-9_\-]+)/);
    const chM  = cfgTxt.match(/YOUTUBE_CHANNEL_ID\s*[:：=]\s*([A-Za-z0-9_\-]+)/);
    if (!apiM || !chM) {
        return { drafted: 0, skipped: 0, reason: 'YOUTUBE_API_KEY 또는 YOUTUBE_CHANNEL_ID 미설정 (`_agents/youtube/config.md`)' };
    }
    const apiKey = apiM[1];
    const channelId = chM[1];
    const maxComments = opts.maxComments ?? 10;
    const maxPerVideo = opts.maxPerVideo ?? 3;
    /* 1) channel → recent uploads playlist */
    let uploads = '';
    try {
        const r = await axios.get(`https://www.googleapis.com/youtube/v3/channels`, {
            params: { part: 'contentDetails', id: channelId, key: apiKey },
            timeout: 10000,
        });
        uploads = r.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || '';
    } catch (e: any) {
        return { drafted: 0, skipped: 0, reason: `채널 조회 실패: ${e?.message || e}` };
    }
    if (!uploads) return { drafted: 0, skipped: 0, reason: '업로드 플레이리스트를 찾지 못함' };
    /* 2) recent video ids */
    let videoIds: string[] = [];
    try {
        const r = await axios.get(`https://www.googleapis.com/youtube/v3/playlistItems`, {
            params: { part: 'contentDetails', playlistId: uploads, maxResults: 5, key: apiKey },
            timeout: 10000,
        });
        videoIds = (r.data?.items || []).map((it: any) => it.contentDetails?.videoId).filter(Boolean);
    } catch (e: any) {
        return { drafted: 0, skipped: 0, reason: `최근 영상 조회 실패: ${e?.message || e}` };
    }
    /* 3) for each video, fetch top comments, draft replies, create approvals.
       Skip comments that already have a pending approval to avoid spam on
       repeated runs. */
    const pendingNow = listPendingApprovals();
    const existingCommentIds = new Set(
        pendingNow
            .filter(a => a.kind === 'youtube.comment_reply')
            .map(a => String(a.payload?.commentId || ''))
    );
    let drafted = 0, skipped = 0;
    for (const videoId of videoIds) {
        if (drafted >= maxComments) break;
        let comments: any[] = [];
        try {
            const r = await axios.get(`https://www.googleapis.com/youtube/v3/commentThreads`, {
                params: { part: 'snippet', videoId, maxResults: maxPerVideo, order: 'time', key: apiKey, textFormat: 'plainText' },
                timeout: 10000,
            });
            comments = r.data?.items || [];
        } catch { continue; /* video may have comments disabled */ }
        for (const c of comments) {
            if (drafted >= maxComments) break;
            const top = c.snippet?.topLevelComment?.snippet;
            const commentId = c.snippet?.topLevelComment?.id;
            if (!top || !commentId) continue;
            if (existingCommentIds.has(commentId)) { skipped++; continue; }
            /* If channel owner has already replied, skip — the conversation
               is owned by a human now. */
            if ((c.snippet?.totalReplyCount || 0) > 0) { skipped++; continue; }
            const author = top.authorDisplayName || '익명';
            const text = (top.textDisplay || '').slice(0, 500);
            let draft = '';
            try {
                draft = await _quickLLMCall(
                    `당신은 1인 크리에이터의 YouTube 댓글 답장 작성기입니다. 친근하고 짧게 (1~3문장), 한국어로, 채널 톤 유지. 욕설·논쟁 회피, 스팸성 댓글은 "감사합니다 ☺️" 같이 짧게.`,
                    `[댓글 작성자] ${author}\n[댓글]\n${text}\n\n위 댓글에 답장 초안을 1~3문장으로.`,
                    200
                );
            } catch { /* skip on draft failure */ continue; }
            const reply = (draft || '').trim();
            if (!reply) continue;
            createApproval({
                agentId: 'youtube',
                title: `${author}님 댓글에 답장`,
                summary: `*원댓글:* ${text.slice(0, 200)}\n\n*답장 초안:* ${reply.slice(0, 300)}`,
                kind: 'youtube.comment_reply',
                payload: { videoId, commentId, replyText: reply, author, originalText: text },
            });
            drafted++;
        }
    }
    return { drafted, skipped };
}

function writeTracker(t: { tasks: TrackerTask[] }) {
  try {
    const dir = path.join(getCompanyDir(), '_shared');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_trackerPath(), JSON.stringify(t, null, 2));
    try { _trackerChangeEmitter.fire(); } catch { /* no listeners — fine */ }
  } catch { /* never let tracker errors break flow */ }
}

function _trackerNewId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
}

function addTrackerTask(partial: Partial<TrackerTask> & { title: string; owner: TrackerTask['owner'] }): TrackerTask {
  const t = readTracker();
  const task: TrackerTask = {
    id: partial.id || _trackerNewId(),
    title: partial.title.slice(0, 200),
    description: partial.description?.slice(0, 1000),
    owner: partial.owner,
    agentIds: partial.agentIds,
    createdAt: partial.createdAt || new Date().toISOString(),
    dueAt: partial.dueAt,
    status: partial.status || (partial.owner === 'agent' ? 'in_progress' : 'pending'),
    sessionDir: partial.sessionDir,
    nudges: 0,
    priority: _coercePriority(partial.priority),
    recurrence: partial.recurrence,
    nextRunAt: partial.nextRunAt,
    preAlarmsSent: partial.preAlarmsSent || [],
  };
  t.tasks.push(task);
  /* Keep file from growing unbounded — drop very old completed/cancelled. */
  const cutoff = Date.now() - 30 * 86_400_000;
  t.tasks = t.tasks.filter(x => {
    if (x.status === 'done' || x.status === 'cancelled') {
      const at = new Date(x.completedAt || x.createdAt).getTime();
      return at >= cutoff;
    }
    return true;
  });
  writeTracker(t);
  /* Auto-create Google Calendar event when due is set + Calendar is wired.
     Fire-and-forget — never blocks tracker creation. Updates the tracker
     entry with the eventId once the API call returns. */
  if (task.dueAt && isCalendarWriteConnected()) {
    createCalendarEventForTask(task).then(eventId => {
      if (eventId) {
        updateTrackerTask(task.id, { calendarEventId: eventId });
      }
    }).catch(() => { /* silent — calendar errors shouldn't break tracker */ });
  }
  return task;
}

function updateTrackerTask(id: string, patch: Partial<TrackerTask>): TrackerTask | null {
  const t = readTracker();
  const idx = t.tasks.findIndex(x => x.id === id);
  if (idx < 0) return null;
  const prev = t.tasks[idx];
  t.tasks[idx] = { ...prev, ...patch };
  const cur = t.tasks[idx];
  if ((patch.status === 'done' || patch.status === 'cancelled') && !cur.completedAt) {
    cur.completedAt = new Date().toISOString();
  }
  writeTracker(t);
  /* Mirror tracker state to Google Calendar so the user's calendar isn't
     stuck on stale plans. Cancelled → delete event; status/title/due change
     while still active → patch event. Best-effort, never blocks. */
  if (cur.calendarEventId && isCalendarWriteConnected()) {
    const becameCancelled = patch.status === 'cancelled' && prev.status !== 'cancelled';
    const titleOrDueChanged = (patch.title && patch.title !== prev.title) || (patch.dueAt && patch.dueAt !== prev.dueAt);
    const becameDone = patch.status === 'done' && prev.status !== 'done';
    if (becameCancelled) {
      deleteCalendarEvent(cur.calendarEventId).then(ok => {
        if (ok) updateTrackerTask(cur.id, { calendarEventId: undefined });
      }).catch(() => { /* silent */ });
    } else if (becameDone || titleOrDueChanged) {
      updateCalendarEventForTask(cur).catch(() => { /* silent */ });
    }
  }
  return t.tasks[idx];
}

function listOpenTrackerTasks(): TrackerTask[] {
  return readTracker().tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
}

/* P1-8: Forgiving date parser for /reschedule. Covers the four shapes the
   user actually types in chat: ISO ("2026-05-10 14:00"), Korean relative
   ("내일", "내일 15:00", "오늘 18:00"), positive offset ("+2h", "+90m",
   "+1d"). Returns null when nothing matches so the caller can ask again. */
function _parseLooseDate(input: string): Date | null {
    const s = input.trim();
    if (!s) return null;
    /* +Nh / +Nm / +Nd offset */
    const off = s.match(/^\+(\d+)\s*(h|m|d|시간|분|일)$/i);
    if (off) {
        const n = parseInt(off[1], 10);
        const u = off[2].toLowerCase();
        const ms = (u === 'h' || u === '시간') ? n * 3600_000
                 : (u === 'm' || u === '분')   ? n * 60_000
                 : (u === 'd' || u === '일')   ? n * 86_400_000
                 : 0;
        if (ms > 0) return new Date(Date.now() + ms);
    }
    /* "내일 [HH:MM]" / "오늘 [HH:MM]" */
    const rel = s.match(/^(내일|오늘|모레)\s*(\d{1,2}):(\d{2})?$/);
    if (rel) {
        const offsetDays = rel[1] === '내일' ? 1 : rel[1] === '모레' ? 2 : 0;
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        const hh = parseInt(rel[2], 10);
        const mm = rel[3] ? parseInt(rel[3], 10) : 0;
        d.setHours(hh, mm, 0, 0);
        return d;
    }
    /* Bare "내일" / "오늘" / "모레" → 09:00 default */
    if (/^(내일|오늘|모레)$/.test(s)) {
        const offsetDays = s === '내일' ? 1 : s === '모레' ? 2 : 0;
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        d.setHours(9, 0, 0, 0);
        return d;
    }
    /* ISO-ish — let Date constructor try. Reject NaN. */
    const iso = new Date(s.replace(/[ T]/, 'T'));
    if (!isNaN(iso.getTime())) return iso;
    return null;
}

/* P1-6: Compute the next run time for a recurring task based on cadence.
   Uses local time so "매일 09:00" lands at 09:00 in the user's timezone,
   which is what the user expects when they say "매일 아침". */
function _computeNextRunAt(prev: Date, cadence: 'daily' | 'weekly' | 'monthly'): Date {
  const next = new Date(prev);
  if (cadence === 'daily')   next.setDate(next.getDate() + 1);
  if (cadence === 'weekly')  next.setDate(next.getDate() + 7);
  if (cadence === 'monthly') next.setMonth(next.getMonth() + 1);
  return next;
}

/* P1-6: Recurrence loop — every minute, scans tracker for tasks whose
   nextRunAt has passed. For each, spawns a fresh "instance" copy in
   pending status and bumps the template's nextRunAt forward. The original
   task acts as the template; the spawned copies are what the user actually
   completes. Templates have status='in_progress' permanently — they're
   never marked done by the user. */
let _recurrenceTimer: NodeJS.Timeout | null = null;

function _runRecurrenceTickOnce() {
    try {
        const tracker = readTracker();
        const now = Date.now();
        let anySpawned = false;
        for (const t of tracker.tasks) {
            if (!t.recurrence) continue;
            if (t.status === 'cancelled') continue;
            if (!t.nextRunAt) {
                /* First time we've seen this template — schedule from createdAt
                   so freshly-added recurring tasks don't fire immediately. */
                const baseline = new Date(t.createdAt);
                t.nextRunAt = _computeNextRunAt(baseline, t.recurrence).toISOString();
                continue;
            }
            const due = new Date(t.nextRunAt).getTime();
            if (now < due) continue;
            /* Spawn a fresh instance (without recurrence — only the template
               is recurring). Owner inherits from template. */
            addTrackerTask({
                title: t.title,
                description: t.description,
                owner: t.owner,
                agentIds: t.agentIds,
                priority: _coercePriority(t.priority),
                dueAt: t.nextRunAt,
                status: t.owner === 'agent' ? 'in_progress' : 'pending',
            });
            /* Advance template's nextRunAt — handles the "machine was off
               overnight, multiple cycles missed" case by jumping forward
               until we're back in the future. */
            let advance = new Date(t.nextRunAt);
            while (advance.getTime() <= now) {
                advance = _computeNextRunAt(advance, t.recurrence);
            }
            t.nextRunAt = advance.toISOString();
            anySpawned = true;
        }
        if (anySpawned) writeTracker(tracker);
    } catch { /* never let recurrence break anything */ }
}

function startRecurrenceLoop() {
    if (_recurrenceTimer) return;
    /* First check after 1 minute, then every minute. The 1-min granularity
       is the same as the daily-briefing loop, so the two cooperate cleanly
       without needing a shared scheduler. */
    setTimeout(_runRecurrenceTickOnce, 60 * 1000);
    _recurrenceTimer = setInterval(_runRecurrenceTickOnce, 60 * 1000);
}
function stopRecurrenceLoop() {
    if (_recurrenceTimer) { clearInterval(_recurrenceTimer); _recurrenceTimer = null; }
}

/* P1-7: Pre-alarms — sends a Telegram nudge 1 day before and 1 hour before
   each task's dueAt. Tracked via preAlarmsSent[] so each window only fires
   once per task. Independent from stale-task nudges (which fire AFTER due).
   Tick is hourly — finer granularity wastes battery, the 1d-before window
   has 24h of slack so the user gets the reminder on a sensible cadence. */
let _preAlarmTimer: NodeJS.Timeout | null = null;
const _PRE_ALARM_WINDOWS: Array<{ key: string; ms: number; label: string }> = [
    { key: 't1d', ms: 24 * 60 * 60_000, label: '내일' },
    { key: 't1h', ms:  1 * 60 * 60_000, label: '1시간 후' },
];

async function _runPreAlarmTickOnce(): Promise<void> {
    try {
        const { token, chatId } = readTelegramConfig();
        if (!token || !chatId) return;
        const tracker = readTracker();
        const now = Date.now();
        let changed = false;
        const lines: string[] = [];
        for (const t of tracker.tasks) {
            if (t.status === 'done' || t.status === 'cancelled') continue;
            if (!t.dueAt) continue;
            const due = new Date(t.dueAt).getTime();
            if (isNaN(due) || due < now) continue;
            const remaining = due - now;
            const sent = t.preAlarmsSent || [];
            for (const w of _PRE_ALARM_WINDOWS) {
                if (sent.includes(w.key)) continue;
                /* Fire when the remaining time has dropped below the window
                   threshold but the task is still in the future. So a 1d
                   alarm fires when due is within 24h, 1h alarm fires within
                   60min. The "below" condition (not "equal") is what makes
                   this work even if the tick lands a few minutes late. */
                if (remaining <= w.ms) {
                    const a = (t.agentIds && t.agentIds[0]) ? AGENTS[t.agentIds[0]] : null;
                    const owner = a ? `${a.emoji} ${a.name}` : (t.owner === 'user' ? '👤 사용자' : '🤖 에이전트');
                    lines.push(`• ⏰${w.label} \`${t.id.slice(-9)}\` ${owner}: ${t.title}`);
                    sent.push(w.key);
                    t.preAlarmsSent = sent;
                    changed = true;
                }
            }
        }
        if (changed) writeTracker(tracker);
        if (lines.length > 0) {
            const body = `🔔 *사전 알림*\n\n${lines.slice(0, 8).join('\n')}\n\n_미루기: \`/reschedule <id> <시간>\` · 완료: \`/done <id>\`_`;
            await sendTelegramReport(body);
        }
    } catch { /* silent */ }
}

function startPreAlarmLoop() {
    if (_preAlarmTimer) return;
    /* First tick after 2 min, then hourly. The 2-min initial gives the
       extension time to fully boot before we start firing user alerts. */
    setTimeout(_runPreAlarmTickOnce, 2 * 60 * 1000);
    _preAlarmTimer = setInterval(_runPreAlarmTickOnce, 60 * 60 * 1000);
}
function stopPreAlarmLoop() {
    if (_preAlarmTimer) { clearInterval(_preAlarmTimer); _preAlarmTimer = null; }
}

/* P1-5: Pull markdown checkbox items out of an agent's output. We accept
   `- [ ]`, `* [ ]`, and numbered `1. [ ]` forms so different agents'
   formatting all flow into one tracker. Only unchecked items count —
   `[x]` is already-done, and we don't try to retroactively register
   completed work. Capped to 5 per output to prevent runaway lists. */
function _harvestActionItems(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s*\[\s\]\s+(.{4,200})$/);
    if (m) {
      const title = m[1].trim().replace(/\s+/g, ' ');
      if (title && !out.includes(title)) out.push(title);
      if (out.length >= 5) break;
    }
  }
  return out;
}

function trackerToMarkdown(opts: { onlyOpen?: boolean; max?: number } = {}): string {
  const all = readTracker().tasks;
  const tasks = opts.onlyOpen ? all.filter(t => t.status !== 'done' && t.status !== 'cancelled') : all;
  if (tasks.length === 0) return '';
  /* Sort: status (in_progress > pending > done) → priority (urgent > high > normal > low)
     → newest createdAt within ties. Status before priority means a 'done urgent'
     still falls below an open 'low' — open work always surfaces first. */
  const order = (s: TrackerTask['status']) => s === 'in_progress' ? 0 : s === 'pending' ? 1 : s === 'done' ? 2 : 3;
  tasks.sort((a, b) => {
    const o = order(a.status) - order(b.status);
    if (o !== 0) return o;
    const pa = TASK_PRIORITY_ORDER[_coercePriority(a.priority)];
    const pb = TASK_PRIORITY_ORDER[_coercePriority(b.priority)];
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const max = opts.max || 25;
  const lines: string[] = [];
  for (const t of tasks.slice(0, max)) {
    const icon = t.status === 'done' ? '✅'
      : t.status === 'in_progress' ? '🔄'
      : t.status === 'pending' ? '⏳'
      : '✖️';
    const ownerEmoji = t.owner === 'user' ? '👤'
      : t.owner === 'mixed' ? '👥'
      : (t.agentIds && t.agentIds[0] ? (AGENTS[t.agentIds[0]]?.emoji || '🤖') : '🤖');
    const due = t.dueAt ? ` ⏰${t.dueAt.slice(0, 10)}` : '';
    const aged = (Date.now() - new Date(t.createdAt).getTime()) / 86_400_000;
    const stale = (t.status === 'pending' && aged > 1) ? ' 🟡' : '';
    const prio = _coercePriority(t.priority);
    /* Show priority chip only for non-default — keeps the line short for
       the common 'normal' case while still surfacing urgent/high visually. */
    const prioChip = prio === 'normal' ? '' : ` ${TASK_PRIORITY_LABEL[prio].split(' ')[0]}`;
    const recur = t.recurrence ? ` 🔁${t.recurrence}` : '';
    lines.push(`- ${icon}${prioChip} ${ownerEmoji} \`${t.id.slice(-9)}\` ${t.title}${due}${recur}${stale}`);
  }
  return lines.join('\n');
}

/* ── Task Tree View (sidebar) ─────────────────────────────────────────────
   P0-1: visualizes tracker.json as a clickable tree. Top level = status
   groups (진행중 / 대기 / 완료 / 취소). Children = task entries with
   priority chip, owner emoji, due, recurrence indicator. Inline actions
   (✅ / ✖️) come from package.json menus → registered commands.
   The tree auto-refreshes via onTrackerChanged. */
class TaskTreeItem extends vscode.TreeItem {
    constructor(
        public readonly task: TrackerTask | null,
        public readonly groupKey: TaskGroupKey | null,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

/* TaskGroup key now expanded to support priority-grouping mode. The tree
   groups by PRIORITY (urgent/high/normal/low) for open tasks since that's
   what the user actually scans for. Closed tasks (done/cancelled) collapse
   into a single "이력" group so they don't dominate the view. */
type TaskGroupKey = TaskPriority | 'closed';

class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    /* Periodic light refresh so due-imminent visual cues update without
       waiting for a tracker write — tasks transition into "임박" zone purely
       by clock advancing. 5min cadence is plenty (window resolution is hour). */
    private _ticker: NodeJS.Timeout | null = null;

    constructor() {
        onTrackerChanged(() => this.refresh());
        this._ticker = setInterval(() => this.refresh(), 5 * 60_000);
    }
    dispose() { if (this._ticker) { clearInterval(this._ticker); this._ticker = null; } }

    refresh() { this._onDidChangeTreeData.fire(); }

    getTreeItem(el: TaskTreeItem): vscode.TreeItem { return el; }

    getChildren(parent?: TaskTreeItem): TaskTreeItem[] {
        const all = readTracker().tasks;
        if (!parent) {
            /* Top level — priority groups for open tasks + a single "이력"
               group for closed. Hide empty groups so we don't show
               "🔴 긴급 (0)" noise on a fresh install. Counts include the
               #stale flag (overdue user tasks) as a small adornment. */
            const open = all.filter(t => t.status !== 'done' && t.status !== 'cancelled');
            const closed = all.filter(t => t.status === 'done' || t.status === 'cancelled');
            const prioOrder: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];
            const items: TaskTreeItem[] = [];
            for (const p of prioOrder) {
                const inGroup = open.filter(t => _coercePriority(t.priority) === p);
                if (inGroup.length === 0) continue;
                const overdue = inGroup.filter(t => t.dueAt && new Date(t.dueAt).getTime() < Date.now()).length;
                const overdueChip = overdue > 0 ? ` 🔴${overdue}` : '';
                const it = new TaskTreeItem(
                    null, p,
                    `${TASK_PRIORITY_LABEL[p]}  (${inGroup.length})${overdueChip}`,
                    /* Expand urgent + high by default — those are the ones the user
                       must act on. Normal + low collapsed unless they're the only
                       group present (handled below). */
                    (p === 'urgent' || p === 'high')
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.Collapsed
                );
                it.contextValue = 'taskGroup';
                /* Group icon + theme color — visual hierarchy at a glance. */
                it.iconPath = _priorityGroupIcon(p);
                items.push(it);
            }
            /* If only normal/low have tasks, expand them so the view isn't empty-feeling. */
            if (items.length > 0 && items.every(it => it.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed)) {
                items[0].collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            }
            if (closed.length > 0) {
                const histIt = new TaskTreeItem(
                    null, 'closed',
                    `📁 이력  (${closed.length})`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                histIt.contextValue = 'taskGroup';
                histIt.iconPath = new vscode.ThemeIcon('archive');
                items.push(histIt);
            }
            if (items.length === 0) {
                const empty = new TaskTreeItem(null, null, '아직 등록된 할 일이 없어요. 텔레그램에 자연어로 말하거나 사이드바에 명령하면 비서가 만들어요.', vscode.TreeItemCollapsibleState.None);
                empty.contextValue = 'emptyHint';
                empty.iconPath = new vscode.ThemeIcon('lightbulb');
                return [empty];
            }
            return items;
        }
        if (!parent.groupKey) return [];
        let tasks: TrackerTask[];
        if (parent.groupKey === 'closed') {
            tasks = all.filter(t => t.status === 'done' || t.status === 'cancelled');
            tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            tasks = tasks.slice(0, 30); /* don't load infinite history */
        } else {
            tasks = all.filter(t => t.status !== 'done' && t.status !== 'cancelled' && _coercePriority(t.priority) === parent.groupKey);
            /* Within group: due-imminent first, then stale, then newest. */
            const now = Date.now();
            const score = (t: TrackerTask) => {
                if (t.dueAt) {
                    const dt = new Date(t.dueAt).getTime();
                    if (dt < now) return -1e12 + dt; /* overdue: most negative first */
                    return dt;                       /* upcoming: nearest first */
                }
                return 1e15 - new Date(t.createdAt).getTime();
            };
            tasks.sort((a, b) => score(a) - score(b));
        }
        return tasks.map(t => {
            const prio = _coercePriority(t.priority);
            const ownerEmoji = t.owner === 'user' ? '👤'
                : t.owner === 'mixed' ? '👥'
                : (t.agentIds && t.agentIds[0] ? (AGENTS[t.agentIds[0]]?.emoji || '🤖') : '🤖');
            const recur = t.recurrence ? ` 🔁` : '';
            const item = new TaskTreeItem(t, null, `${ownerEmoji} ${t.title}${recur}`, vscode.TreeItemCollapsibleState.None);
            /* Status / urgency icon — mapped through ThemeIcon so it adapts to
               the user's color theme (light/dark/high-contrast). The colored
               'urgent' / 'overdue' variants use the same red the editor uses
               for errors, so the visual hierarchy matches what users already
               read as "needs attention". */
            item.iconPath = _taskStatusIcon(t);
            const desc: string[] = [];
            if (t.dueAt) {
                const due = _formatDueLabel(t.dueAt);
                desc.push(due);
            }
            desc.push(`id ${t.id.slice(-9)}`);
            const aged = (Date.now() - new Date(t.createdAt).getTime()) / 86_400_000;
            if (t.status === 'pending' && aged > 1) desc.push('🟡 오래됨');
            item.description = desc.join(' · ');
            const tip = new vscode.MarkdownString();
            tip.appendMarkdown(`**${t.title}**\n\n`);
            tip.appendMarkdown(`- 우선순위: ${TASK_PRIORITY_LABEL[prio]}\n`);
            tip.appendMarkdown(`- 상태: ${t.status}\n`);
            tip.appendMarkdown(`- 소유: ${t.owner}${t.agentIds?.length ? ' (' + t.agentIds.join(', ') + ')' : ''}\n`);
            if (t.dueAt) tip.appendMarkdown(`- 기한: ${t.dueAt}\n`);
            if (t.recurrence) tip.appendMarkdown(`- 반복: ${t.recurrence}\n`);
            tip.appendMarkdown(`- 생성: ${t.createdAt}\n`);
            if (t.description) tip.appendMarkdown(`\n_${t.description.slice(0, 200)}_\n`);
            item.tooltip = tip;
            item.contextValue = (t.status === 'done' || t.status === 'cancelled') ? 'closedTask' : 'openTask';
            item.id = t.id;
            return item;
        });
    }
}

/* Map a priority level to a colored ThemeIcon for the group header. */
function _priorityGroupIcon(p: TaskPriority): vscode.ThemeIcon {
    switch (p) {
        case 'urgent': return new vscode.ThemeIcon('error',     new vscode.ThemeColor('errorForeground'));
        case 'high':   return new vscode.ThemeIcon('warning',   new vscode.ThemeColor('list.warningForeground'));
        case 'normal': return new vscode.ThemeIcon('circle-outline');
        case 'low':    return new vscode.ThemeIcon('chevron-down', new vscode.ThemeColor('descriptionForeground'));
    }
}

/* Per-task icon — encodes status + due-urgency. We use VS Code's built-in
   codicon names so the look stays consistent with the rest of the IDE. */
function _taskStatusIcon(t: TrackerTask): vscode.ThemeIcon {
    if (t.status === 'done')      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    if (t.status === 'cancelled') return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground'));
    /* Open task — visual urgency derived from due. Codicon 'sync~spin' is
       VS Code's native spinner — used for in_progress to show "AI is on it". */
    if (t.dueAt) {
        const dt = new Date(t.dueAt).getTime();
        const ms = dt - Date.now();
        if (ms < 0)             return new vscode.ThemeIcon('flame', new vscode.ThemeColor('errorForeground')); // overdue
        if (ms < 60 * 60_000)   return new vscode.ThemeIcon('clock', new vscode.ThemeColor('errorForeground')); // <1h
        if (ms < 24 * 3600_000) return new vscode.ThemeIcon('clock', new vscode.ThemeColor('list.warningForeground')); // <1d
    }
    if (t.status === 'in_progress') return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.green'));
    return new vscode.ThemeIcon('circle-outline');
}

/* Friendly relative-time formatter — "지금부터 3시간", "내일 09:00", "3일 지남". */
function _formatDueLabel(iso: string): string {
    try {
        const dt = new Date(iso);
        const ms = dt.getTime() - Date.now();
        const abs = Math.abs(ms);
        const m = Math.floor(abs / 60_000);
        const h = Math.floor(abs / 3600_000);
        const d = Math.floor(abs / 86_400_000);
        if (ms < 0) {
            if (d >= 1) return `🔴 ${d}일 지남`;
            if (h >= 1) return `🔴 ${h}시간 지남`;
            return `🔴 ${m}분 지남`;
        }
        if (d >= 7)  return `📅 ${dt.toISOString().slice(5, 10)}`;
        if (d >= 1)  return `📅 ${d}일 후`;
        if (h >= 1)  return `⏰ ${h}시간 후`;
        return `⚡ ${Math.max(1, m)}분 후`;
    } catch { return iso.slice(0, 16); }
}

let _taskTreeProvider: TaskTreeProvider | null = null;

/* Heuristic: from a finished CEO dispatch (plan + outputs), find
   matching open tracker tasks (created within last 5 min by Secretary
   for THIS user request) and mark them done. Avoids LLM round-trip. */
function autoMarkTrackerFromDispatch(plan: { brief?: string; tasks?: { agent: string; task: string }[] } | null, sessionDir: string, ceoSynthesis: string) {
  try {
    if (!plan || !Array.isArray(plan.tasks)) return;
    const tracker = readTracker();
    const now = Date.now();
    /* 24h window — covers overnight/multi-step tasks. Original 10-min was
       too narrow: if user issued "이거 해" yesterday and CEO finishes today,
       the task would stay pending forever. */
    const fresh = tracker.tasks.filter(t =>
      t.status !== 'done' && t.status !== 'cancelled' &&
      (now - new Date(t.createdAt).getTime()) < 24 * 60 * 60_000
    );
    if (fresh.length === 0) return;
    /* For each fresh agent-owned task, mark first overlap done. */
    for (const ft of fresh) {
      if (ft.owner !== 'agent' && ft.owner !== 'mixed') continue;
      const evidence = `완료: sessions/${path.basename(sessionDir)}/_report.md\n` +
        plan.tasks.slice(0, 3).map(t => `- ${AGENTS[t.agent]?.name || t.agent}: ${t.task.slice(0, 80)}`).join('\n') +
        (ceoSynthesis ? `\n\nCEO 종합 요점: ${ceoSynthesis.slice(0, 200)}` : '');
      updateTrackerTask(ft.id, {
        status: 'done',
        sessionDir: path.basename(sessionDir),
        evidence,
      });
    }
  } catch { /* ignore */ }
}

/* ── Unified schedule.md ─────────────────────────────────────────────────
   Secretary's job is to give one consolidated view of "today/this week" —
   user's calendar events + each agent's recent activity + pending TODOs.
   Other agents read this via readAgentSharedContext so they can plan
   around the user's life and each other's work.

   Sources:
     - _shared/calendar_cache.md  (Google Calendar via iCal tool)
     - _agents/{id}/memory.md     (last 5 lines per agent — recent task log)
     - _shared/todos.md           (user-maintained — optional) */
function rebuildUnifiedSchedule() {
  try {
    const dir = getCompanyDir();
    if (!fs.existsSync(dir)) return;
    fs.mkdirSync(path.join(dir, '_shared'), { recursive: true });
    const now = new Date();
    const lines: string[] = [];
    lines.push(`# 📋 통합 스케줄`);
    lines.push(`_업데이트: ${now.toLocaleString('ko-KR')}_`);
    lines.push('');

    /* 1. Calendar */
    const cal = _safeReadText(path.join(dir, '_shared', 'calendar_cache.md')).trim();
    if (cal) {
      lines.push('## 📅 사람 일정 (Google Calendar)');
      const calLines = cal.split('\n')
        .filter(l => l.trim().startsWith('-'))
        .slice(0, 12);
      lines.push(...calLines);
      lines.push('');
    }

    /* 2. Recent agent activity */
    const agentBlocks: string[] = [];
    for (const id of AGENT_ORDER) {
      if (id === 'ceo') continue;
      const memPath = path.join(dir, '_agents', id, 'memory.md');
      const mem = _safeReadText(memPath).trim();
      if (!mem) continue;
      const recent = mem.split('\n')
        .filter(l => /^\s*-\s*\[\d{4}-\d{2}-\d{2}\]/.test(l))
        .slice(-3);
      if (recent.length === 0) continue;
      const a = AGENTS[id];
      agentBlocks.push(`### ${a.emoji} ${a.name}\n${recent.join('\n')}`);
    }
    if (agentBlocks.length > 0) {
      lines.push('## 🤖 에이전트 최근 활동');
      lines.push(...agentBlocks);
      lines.push('');
    }

    /* 3. User TODOs */
    const todos = _safeReadText(path.join(dir, '_shared', 'todos.md')).trim();
    if (todos) {
      lines.push('## ✅ 사용자 할 일');
      lines.push(todos.slice(0, 1500));
      lines.push('');
    }

    fs.writeFileSync(path.join(dir, '_shared', 'schedule.md'), lines.join('\n') + '\n');
  } catch { /* never let schedule errors break the dispatch */ }
}

function readAgentCustomPrompt(agentId: string): string {
  const dir = getCompanyDir();
  const promptPath = path.join(dir, '_agents', agentId, 'prompt.md');
  const configPath = path.join(dir, '_agents', agentId, 'config.md');
  const customPrompt = _safeReadText(promptPath).trim();
  const config = _safeReadText(configPath).trim();
  let extra = '';
  if (customPrompt && !customPrompt.startsWith('# ')) {
    extra += `\n\n[사용자가 추가한 페르소나 디테일]\n${customPrompt.slice(0, 2000)}`;
  } else if (customPrompt) {
    // 헤더 시작이면 그대로 — placeholder 인지 검사
    const stripped = customPrompt.replace(/^#.*$/gm, '').replace(/_여기에.*?_/gs, '').trim();
    if (stripped.length > 30) {
      extra += `\n\n[사용자가 추가한 페르소나 디테일]\n${customPrompt.slice(0, 2000)}`;
    }
  }
  if (config) {
    // config.md에서 비밀 토큰은 마스킹 후 컨텍스트로 주입 (에이전트는 자기 어떤 도구 쓸 수 있는지 알아야 함)
    const masked = config.replace(/(TOKEN|API_KEY|SECRET)([:：=])\s*\S+/gi, '$1$2 ***SET***');
    if (masked.replace(/^#.*$/gm, '').trim().length > 30) {
      extra += `\n\n[당신의 도구·설정 (시크릿 마스킹됨)]\n${masked.slice(0, 1500)}`;
    }
  }
  return extra;
}

function _safeReadText(p: string): string {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
}

function ensureCompanyStructure(): string {
  const dir = getCompanyDir();
  fs.mkdirSync(path.join(dir, '_shared'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_agents'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'approvals', 'pending'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'approvals', 'history'), { recursive: true });
  AGENT_ORDER.forEach(id => {
    fs.mkdirSync(path.join(dir, '_agents', id), { recursive: true });
    _seedAgentGoalIfMissing(id);
    _seedAgentToolsIfMissing(id);
    _seedAgentToolsManifestIfMissing(id);
  });

  const goalsPath = path.join(dir, '_shared', 'goals.md');
  if (!fs.existsSync(goalsPath)) {
    fs.writeFileSync(goalsPath,
`# 🎯 공동 목표 (Company Goals)

_이 파일은 **모든 에이전트가 매번 읽는** 회사의 북극성입니다. 자유롭게 편집하세요._

## 장기 목표 (1년)
- [ ] (예) 유튜브 구독자 10만 달성
- [ ] (예) 인스타그램 팔로워 5만
- [ ] (예) 월 수익 500만원

## 단기 목표 (1개월)
- [ ] (예) 영상 4개 업로드
- [ ] (예) 릴스 12개 게시
`);
  }
  const idPath = path.join(dir, '_shared', 'identity.md');
  if (!fs.existsSync(idPath)) {
    fs.writeFileSync(idPath,
`# 🏢 회사 정체성 / 톤앤매너

_브랜드 보이스, 톤, 절대 금지어 등을 적으세요. 모든 에이전트가 매번 참조합니다._

- **회사 이름:**
- **대표자:**
- **타깃 청중:**
- **핵심 가치:**
- **브랜드 톤:**
- **금기 (절대 하지 말 것):**
`);
  }
  AGENT_ORDER.forEach(id => {
    const memPath = path.join(dir, '_agents', id, 'memory.md');
    if (!fs.existsSync(memPath)) {
      fs.writeFileSync(memPath,
`# ${AGENTS[id].emoji} ${AGENTS[id].name} (${AGENTS[id].role}) 개인 메모리

_${AGENTS[id].name} 에이전트만 읽고 쓰는 개인 노트. 학습·교훈·자주 쓰는 패턴이 누적됩니다._

## 학습 기록
`);
    }
    const promptPath = path.join(dir, '_agents', id, 'prompt.md');
    if (!fs.existsSync(promptPath)) {
      fs.writeFileSync(promptPath,
`# ${AGENTS[id].emoji} ${AGENTS[id].name} 페르소나 디테일

_여기에 ${AGENTS[id].name} 에이전트에게 주고 싶은 추가 지시·말투·취향·예시 등을 자유롭게 적으세요._
_매 호출 시 시스템 프롬프트에 자동 주입됩니다. (git에 동기화됨)_

`);
    }
    const configPath = path.join(dir, '_agents', id, 'config.md');
    if (!fs.existsSync(configPath)) {
      let presets = '';
      if (id === 'secretary') {
        presets = `\n## 텔레그램 봇\n_BotFather에서 봇을 만들고 토큰을 받으세요. https://t.me/BotFather_\n_그리고 본인 채팅 ID를 알아내려면 https://t.me/userinfobot 에 메시지를 보내세요._\n\n- TELEGRAM_BOT_TOKEN: \n- TELEGRAM_CHAT_ID: \n`;
      } else if (id === 'youtube') {
        presets = `\n## YouTube Data API\n- YOUTUBE_API_KEY: \n- YOUTUBE_CHANNEL_ID: \n`;
      } else if (id === 'instagram') {
        presets = `\n## Meta Graph API\n- META_ACCESS_TOKEN: \n- INSTAGRAM_BUSINESS_ID: \n`;
      } else if (id === 'designer') {
        presets = `\n## 디자인 도구\n- FIGMA_TOKEN: \n- STITCH_API_KEY: \n`;
      }
      fs.writeFileSync(configPath,
`# ${AGENTS[id].emoji} ${AGENTS[id].name} 설정 (시크릿)

_이 파일은 \`.gitignore\`에 의해 깃 동기화에서 제외됩니다. API 키·토큰을 자유롭게 적으세요._
${presets}
`);
    }
  });

  // .gitignore — 시크릿과 캐시 보호
  const giPath = path.join(dir, '.gitignore');
  const desiredGi =
`# 자동 생성 — Connect AI 1인 기업 모드
# 시크릿·API 키 보호
_agents/*/config.md
# 도구 설정 JSON 안에 API 키·텔레그램 봇 토큰이 들어갈 수 있어 git에서 제외
_agents/*/tools/*.json
_agents/*/tools/youtube_account.json

# 외부 API 응답 캐시 (재현 가능)
_cache/

# 대용량 임시 산출물
_tmp/
*.log
`;
  if (!fs.existsSync(giPath)) {
    fs.writeFileSync(giPath, desiredGi);
  } else {
    /* Migrate old gitignore that didn't list tool JSONs — append the
       missing rules so existing users get token protection without us
       clobbering anything they manually added. */
    let cur = '';
    try { cur = fs.readFileSync(giPath, 'utf-8'); } catch { /* ignore */ }
    const additions: string[] = [];
    if (!cur.includes('_agents/*/tools/*.json')) {
      additions.push('# 도구 설정 JSON 안에 API 키·텔레그램 봇 토큰이 들어갈 수 있어 git에서 제외');
      additions.push('_agents/*/tools/*.json');
    }
    if (!cur.includes('youtube_account.json')) {
      additions.push('_agents/*/tools/youtube_account.json');
    }
    if (additions.length > 0) {
      try { fs.appendFileSync(giPath, '\n' + additions.join('\n') + '\n'); } catch { /* ignore */ }
    }
  }

  // _system.md — 시스템 자가 매뉴얼 (사람도 읽고 LLM도 컨텍스트로)
  const sysPath = path.join(dir, '_shared', '_system.md');
  if (!fs.existsSync(sysPath)) {
    fs.writeFileSync(sysPath,
`# 🧬 1인 기업 OS — 자가 매뉴얼

## 이 폴더는 무엇인가요?
당신의 1인 기업의 두뇌입니다. 7명의 AI 에이전트가 여기서 일합니다.

## 폴더 구조
- \`_shared/\` — 모든 에이전트가 매번 읽는 공동 메모리
  - \`identity.md\` — 회사 정체성 (이름, 톤, 가치)
  - \`goals.md\` — 목표
  - \`decisions.md\` — 의사결정 로그 (자가학습이 자동 누적)
  - \`_system.md\` — 이 파일
- \`_agents/<id>/\` — 각 에이전트 개인 공간
  - \`memory.md\` — 자가학습 (자동, append-only)
  - \`prompt.md\` — 페르소나 디테일 (사용자가 편집)
  - \`config.md\` — API 키·시크릿 (\`.gitignore\`로 보호)
- \`sessions/<ts>/\` — 세션별 산출물 (자동)
- \`_cache/\` — API 응답 캐시 (sync 제외)

## 메모리 위계 (충돌 시 우선순위)
1. \`decisions.md\` — 가장 강한 신뢰
2. \`identity.md\`
3. \`goals.md\`
4. 개인 메모리
5. 지식 베이스 (\`10_Wiki/\`)

## 다른 PC로 옮길 때
1. 새 PC에 Connect AI 설치
2. 👔 모드 ON → "📥 다른 PC에서 가져오기" 선택
3. GitHub URL 입력 → 자동 clone
4. 끝.

## 동기화 정책
- \`_shared/\`, \`_agents/*/memory.md\`, \`_agents/*/prompt.md\`, \`sessions/\` → git sync ✅
- \`_agents/*/config.md\`, \`_cache/\` → git sync ❌ (시크릿·캐시)

## 7명의 에이전트
${AGENT_ORDER.map(id => `- ${AGENTS[id].emoji} **${AGENTS[id].name}** (${AGENTS[id].role}): ${AGENTS[id].specialty}`).join('\n')}
`);
  }

  return dir;
}

/* ── Brain knowledge → agent context bridge ────────────────────────────
   Every agent cycle we surface the user's broader knowledge (10_Wiki, recent
   00_Raw) into that agent's prompt. Filtered by the agent's specialty
   keywords so YouTube doesn't drown in design notes and vice versa. Tight
   budget keeps the prompt small. */

function _agentKeywords(agentId: string): string[] {
  const a = AGENTS[agentId];
  if (!a) return [];
  /* Pull tokens from name, role, specialty. Strip punctuation, lowercase,
     drop tiny tokens. Korean is tricky — we keep ≥2-char chunks. */
  const text = `${a.name} ${a.role} ${a.specialty}`;
  const tokens = text
    .replace(/[()·,/·\-·]+/g, ' ')
    .split(/\s+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length >= 2 && !/^(and|the|of|for|to|in)$/i.test(t));
  /* Dedupe while preserving order */
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) { if (!seen.has(t)) { seen.add(t); out.push(t); } }
  return out;
}

function _scoreRelevance(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0;
  const lc = text.toLowerCase();
  let score = 0;
  for (const k of keywords) {
    /* count occurrences (cap at 5 per keyword to avoid one giant doc winning) */
    let i = 0, hits = 0;
    while ((i = lc.indexOf(k, i)) !== -1 && hits < 5) { hits++; i += k.length; }
    score += hits;
  }
  return score;
}

/* Recursively list .md files under a root, capped depth + count for safety.
   Skips company-internal folders + .git so we don't pull in identity.md /
   memory.md (those are added separately). */
function _walkBrainMd(root: string, opts: { maxDepth: number; maxFiles: number; skipDirs: Set<string> }): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length && out.length < opts.maxFiles) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(cur.dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (out.length >= opts.maxFiles) break;
      const full = path.join(cur.dir, e.name);
      if (e.isDirectory()) {
        if (opts.skipDirs.has(e.name)) continue;
        if (e.name.startsWith('.')) continue; /* skip dotfiles like .git */
        if (cur.depth + 1 <= opts.maxDepth) stack.push({ dir: full, depth: cur.depth + 1 });
      } else if (e.isFile() && (e.name.toLowerCase().endsWith('.md') || e.name.toLowerCase().endsWith('.txt'))) {
        out.push(full);
      }
    }
  }
  return out;
}

interface BrainSnippet { path: string; rel: string; title: string; insight: string; score: number; mtime: number; }

function _extractWikiSnippet(filePath: string, brainRoot: string, keywords: string[]): BrainSnippet | null {
  let raw = '';
  try {
    const st = fs.statSync(filePath);
    if (st.size > 80_000) return null; /* skip giant files */
    raw = fs.readFileSync(filePath, 'utf-8').slice(0, 12_000);
  } catch { return null; }
  if (!raw.trim()) return null;
  /* Title: first H1, else filename */
  const h1 = raw.match(/^#\s+(.+?)\s*$/m);
  const title = h1 ? h1[1].trim().replace(/\[\[|\]\]/g, '') : path.basename(filePath, path.extname(filePath));
  /* Insight: prefer the "📌 한 줄 통찰" line (P-Reinforce convention).
     Fallback: first non-heading paragraph. */
  let insight = '';
  const insightM = raw.match(/##[^\n]*한 줄 통찰[^\n]*\n>?\s*([^\n]+)/);
  if (insightM && insightM[1]) {
    insight = insightM[1].trim().replace(/^>+\s*/, '');
  } else {
    /* Strip frontmatter, find first non-heading non-empty line */
    const body = raw.replace(/^---[\s\S]*?---\n/, '');
    const lines = body.split('\n');
    for (const ln of lines) {
      const t = ln.trim();
      if (!t) continue;
      if (t.startsWith('#')) continue;
      if (t.startsWith('---')) continue;
      insight = t.slice(0, 220);
      break;
    }
  }
  if (!insight) insight = raw.replace(/\s+/g, ' ').slice(0, 180);
  insight = insight.slice(0, 220);
  let st: fs.Stats | null = null;
  try { st = fs.statSync(filePath); } catch {}
  /* Recency boost: docs modified in last 14 days get +5 to score */
  const ageDays = st ? (Date.now() - st.mtimeMs) / 86_400_000 : 999;
  const recencyBonus = ageDays <= 14 ? 5 : (ageDays <= 60 ? 2 : 0);
  const scoreText = title + '\n' + insight + '\n' + raw.slice(0, 2000);
  const score = _scoreRelevance(scoreText, keywords) + recencyBonus;
  return {
    path: filePath,
    rel: path.relative(brainRoot, filePath),
    title,
    insight,
    score,
    mtime: st ? st.mtimeMs : 0,
  };
}

/* Returns a context block to append to the agent's prompt, or '' if no
   relevant brain content. Budget caps total chars so we don't blow up the
   context window. */
function readRelevantBrainContext(agentId: string, budgetChars: number = 2400): string {
  /* Walk the BRAIN root (where 00_Raw/, 10_Wiki/, user notes live) — NOT
     the company subdir. Skip _company/ entirely so agent self-output never
     gets re-fed as "knowledge". */
  const brain = _getBrainDir();
  const keywords = _agentKeywords(agentId);
  if (keywords.length === 0) return '';

  const skipDirs = new Set([
    '_company', '_shared', '_agents', 'sessions', 'approvals',
    'node_modules', '.git', '.cache', '_cache', 'out', 'dist', '__pycache__',
  ]);

  /* 10_Wiki and other top-level knowledge folders — main scan target. */
  const wikiFiles = _walkBrainMd(brain, { maxDepth: 4, maxFiles: 200, skipDirs });

  /* Recent 00_Raw within last 14 days — these are freshly injected and
     might not be wiki-organized yet. Score on filename + first chunk. */
  const rawDir = path.join(brain, '00_Raw');
  let rawFiles: string[] = [];
  if (fs.existsSync(rawDir)) {
    rawFiles = _walkBrainMd(rawDir, { maxDepth: 2, maxFiles: 50, skipDirs: new Set() });
    /* keep only ≤14 days old */
    const cutoff = Date.now() - 14 * 86_400_000;
    rawFiles = rawFiles.filter(f => {
      try { return fs.statSync(f).mtimeMs >= cutoff; } catch { return false; }
    });
  }

  const all = [...wikiFiles, ...rawFiles];
  if (all.length === 0) return '';

  const snippets: BrainSnippet[] = [];
  for (const f of all) {
    const s = _extractWikiSnippet(f, brain, keywords);
    if (s && s.score > 0) snippets.push(s);
  }
  if (snippets.length === 0) return '';

  snippets.sort((a, b) => b.score - a.score || b.mtime - a.mtime);

  let block = '\n\n[관련 두뇌 지식 — 최근 또는 당신 분야 관련 자료. 필요하면 인용/활용]\n';
  let used = 0;
  for (const s of snippets) {
    const line = `- 🧠 **${s.title}** (${s.rel})\n  > ${s.insight}\n`;
    if (used + line.length > budgetChars) break;
    block += line;
    used += line.length;
  }
  return used > 0 ? block : '';
}

/* Graph RAG retrieval — minimal but meaningful implementation.
   Builds a lightweight knowledge graph from the brain folder where:
     - nodes  = wiki/raw markdown files
     - edges  = explicit `[[wikilinks]]` (directional, treated as undirected
                here for traversal) + co-occurrence on shared "anchor terms"
                (H1 titles + quoted phrases) above a small frequency threshold
   Then keyword-scores nodes against the agent's specialty (same as standard
   retrieval) to pick top-K SEEDS, BFS 1-hop from each seed to bring in
   connected notes that wouldn't match keywords directly, and emits a
   context block with both the seed and the connected neighbors annotated.
   This is intentionally educational: the user can compare against
   `readRelevantBrainContext` and see how Graph RAG surfaces 1-hop links
   that pure keyword search misses. */
function readGraphRagBrainContext(agentId: string, budgetChars: number = 2400): string {
  /* Walk BRAIN root — same rationale as readRelevantBrainContext. The graph
     edges (wikilinks) live in user notes under 00_Raw/, 10_Wiki/, etc.,
     never inside _company/ (that's agent output, not knowledge). */
  const brain = _getBrainDir();
  const keywords = _agentKeywords(agentId);
  if (keywords.length === 0) return '';

  const skipDirs = new Set([
    '_company', '_shared', '_agents', 'sessions', 'approvals',
    'node_modules', '.git', '.cache', '_cache', 'out', 'dist', '__pycache__',
  ]);
  const wikiFiles = _walkBrainMd(brain, { maxDepth: 4, maxFiles: 200, skipDirs });
  const rawDir = path.join(brain, '00_Raw');
  let rawFiles: string[] = [];
  if (fs.existsSync(rawDir)) {
    rawFiles = _walkBrainMd(rawDir, { maxDepth: 2, maxFiles: 50, skipDirs: new Set() });
    const cutoff = Date.now() - 14 * 86_400_000;
    rawFiles = rawFiles.filter(f => {
      try { return fs.statSync(f).mtimeMs >= cutoff; } catch { return false; }
    });
  }
  const all = Array.from(new Set([...wikiFiles, ...rawFiles]));
  if (all.length === 0) return '';

  /* Pass 1: load each file once (cap size), compute snippet + extract its
     wikilinks and a small set of anchor terms (H1 title + first 5 quoted
     phrases). Title→file index lets us resolve `[[Foo]]` to a real node. */
  type Node = { snippet: BrainSnippet; titleKey: string; links: string[]; anchors: string[]; raw: string };
  const nodes: Node[] = [];
  const titleToIdx = new Map<string, number>();
  for (const f of all) {
    let raw = '';
    try {
      const st = fs.statSync(f);
      if (st.size > 80_000) continue;
      raw = fs.readFileSync(f, 'utf-8').slice(0, 12_000);
    } catch { continue; }
    if (!raw.trim()) continue;
    const snippet = _extractWikiSnippet(f, brain, keywords);
    if (!snippet) continue;
    const titleKey = snippet.title.trim().toLowerCase();
    /* Wikilinks — strip optional `|alias` */
    const links: string[] = [];
    const linkRe = /\[\[([^\]\|\n]+?)(?:\|[^\]]*)?\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(raw)) && links.length < 30) {
      links.push(m[1].trim().toLowerCase());
    }
    /* Anchor terms — H1 + up to 5 backtick/quoted phrases (cheap proxy for
       "important named entities" without an LLM extraction pass). */
    const anchors: string[] = [snippet.title.trim()];
    const phraseRe = /[`"]([^`"\n]{3,40})[`"]/g;
    let pm: RegExpExecArray | null;
    while ((pm = phraseRe.exec(raw)) && anchors.length < 6) {
      anchors.push(pm[1].trim());
    }
    nodes.push({ snippet, titleKey, links, anchors: anchors.map(a => a.toLowerCase()), raw });
    if (!titleToIdx.has(titleKey)) titleToIdx.set(titleKey, nodes.length - 1);
  }
  if (nodes.length === 0) return '';

  /* Pass 2: build adjacency. Wikilink edge if target title resolves; anchor
     edge if two notes share an anchor term (excluding empty/very short). */
  const adj: Set<number>[] = nodes.map(() => new Set<number>());
  /* Wikilink edges */
  for (let i = 0; i < nodes.length; i++) {
    for (const link of nodes[i].links) {
      const j = titleToIdx.get(link);
      if (j !== undefined && j !== i) {
        adj[i].add(j);
        adj[j].add(i);
      }
    }
  }
  /* Anchor co-occurrence — anchor → list of node indices */
  const anchorIdx = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    for (const a of nodes[i].anchors) {
      if (a.length < 3) continue;
      const arr = anchorIdx.get(a) || [];
      arr.push(i);
      anchorIdx.set(a, arr);
    }
  }
  for (const [, idxs] of anchorIdx) {
    if (idxs.length < 2 || idxs.length > 8) continue; /* skip noise */
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        adj[idxs[i]].add(idxs[j]);
        adj[idxs[j]].add(idxs[i]);
      }
    }
  }

  /* Pass 3: pick top SEEDS by keyword score. BFS 1-hop to expand. Re-rank
     expanded set: seeds keep full score; neighbors get neighbor_factor *
     best_seed_score so they ride into the context window even with zero
     direct keyword match — that is the Graph RAG payoff. */
  const seedCount = 3;
  const ranked = nodes
    .map((n, i) => ({ i, score: n.snippet.score }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return '';
  const seeds = ranked.slice(0, seedCount).map(x => x.i);
  const seedSet = new Set(seeds);
  const finalScore = new Map<number, number>();
  const reachedVia = new Map<number, number>(); /* neighbor → seed idx */
  for (const s of seeds) {
    finalScore.set(s, nodes[s].snippet.score);
    for (const nb of adj[s]) {
      if (seedSet.has(nb)) continue;
      const boost = nodes[s].snippet.score * 0.5;
      const cur = finalScore.get(nb) || 0;
      if (boost > cur) {
        finalScore.set(nb, boost);
        reachedVia.set(nb, s);
      }
    }
  }
  const ordered = Array.from(finalScore.entries())
    .sort((a, b) => b[1] - a[1] || nodes[b[0]].snippet.mtime - nodes[a[0]].snippet.mtime);

  /* Emit. Mark each line with whether it was a direct match (🎯) or a
     graph-connected neighbor (🔗) so the agent — and the curious user
     reading the prompt — can see the graph at work. */
  let block = '\n\n[관련 두뇌 지식 — Graph RAG: 직접 매칭(🎯) + 1-hop 연결(🔗)]\n';
  let used = 0;
  for (const [idx] of ordered) {
    const n = nodes[idx];
    const tag = seedSet.has(idx) ? '🎯' : '🔗';
    let line = `- ${tag} **${n.snippet.title}** (${n.snippet.rel})\n  > ${n.snippet.insight}\n`;
    if (tag === '🔗') {
      const via = reachedVia.get(idx);
      if (via !== undefined) {
        line = `- ${tag} **${n.snippet.title}** (${n.snippet.rel}) — \`${nodes[via].snippet.title}\`와 연결\n  > ${n.snippet.insight}\n`;
      }
    }
    if (used + line.length > budgetChars) break;
    block += line;
    used += line.length;
  }
  return used > 0 ? block : '';
}

function readAgentSharedContext(agentId: string, opts?: { lean?: boolean }): string {
  /* v2.89.42 — lean 모드 = 두뇌 "삭제"가 아니라 "축소". 실데이터 prefetch가 성공해서
     큰 컨텍스트가 들어왔을 때 두뇌 콘텐츠 자르기보다 줄이는 쪽으로 결정.
     사용자가 쌓아둔 결정·메모리·brain 노트는 분석에 쓸 수 있어야 함 (제2의 두뇌 컨셉의
     핵심). 단 너무 길면 추론 느려지고 환각 위험 — 그래서 적정 크기로 축소.
       normal: decisions 3000자 / memory 4000자 / brain RAG 2400자 (총 ~9400자)
       lean:   decisions 1200자 / memory 1500자 / brain RAG  900자 (총 ~3600자)
     → 약 60% 감소. 두뇌는 살아있되 부담 줄임. */
  const lean = opts?.lean === true;
  const dir = getCompanyDir();
  const identity = _safeReadText(path.join(dir, '_shared', 'identity.md'));
  const companyGoals = _safeReadText(path.join(dir, '_shared', 'goals.md'));
  const decisions = _safeReadText(path.join(dir, '_shared', 'decisions.md'));
  const memory = _safeReadText(path.join(dir, '_agents', agentId, 'memory.md'));
  const personalGoal = readAgentGoal(agentId);
  const ragMode = readAgentRagMode(agentId);
  let ctx = '';
  // Priority order (most-trusted first):
  //   agent goal > company goals > company identity > decisions > memory > brain knowledge > tools
  if (personalGoal.trim()) ctx += `\n\n[당신의 개인 목표 (최우선 — 매 사이클 이 방향으로 한 스텝 진행)]\n${personalGoal.slice(0, 4000)}`;
  if (companyGoals.trim()) ctx += `\n\n[회사 공동 목표]\n${companyGoals.slice(0, 4000)}`;
  if (identity.trim()) ctx += `\n\n[회사 정체성]\n${identity.slice(0, 2000)}`;
  if (decisions.trim()) ctx += `\n\n[지난 의사결정 로그]\n${decisions.slice(lean ? -1200 : -3000)}`;
  /* Calendar — secretary's google_calendar tool writes upcoming events here.
     Surfaced to every agent so scheduling and time-aware planning work without
     each agent having to call the tool itself. */
  try {
    const cal = _safeReadText(path.join(dir, '_shared', 'calendar_cache.md'));
    if (cal.trim()) ctx += `\n\n[다가오는 일정 (Google Calendar)]\n${cal.slice(0, 2000)}`;
  } catch { /* ignore */ }
  /* Unified schedule — Secretary maintains this combining calendar + each
     agent's recent activity + user TODOs. Lets every agent plan around the
     user's life and their teammates' workload. */
  try {
    const sch = _safeReadText(path.join(dir, '_shared', 'schedule.md'));
    if (sch.trim()) ctx += `\n\n[통합 스케줄 (비서 관리)]\n${sch.slice(0, 2200)}`;
  } catch { /* ignore */ }
  /* Open tracker tasks — agents see what's still pending so they don't
     duplicate work and can pick up overlapping items. Also lets them know
     what user is on the hook for, so they avoid blocking on the user. */
  try {
    const trackerMd = trackerToMarkdown({ onlyOpen: true, max: 12 });
    if (trackerMd) ctx += `\n\n[추적 중인 작업 (열린 것만)]\n${trackerMd}`;
  } catch { /* ignore */ }
  /* Self-RAG mode: surface verified.md FIRST as primary memory so previously
     self-grounded claims dominate the context. memory.md still gets included
     below as the firehose, but the agent has already been told to trust
     verified entries above [추측] entries. */
  if (ragMode === 'self-rag') {
    const verified = readAgentVerifiedKnowledge(agentId);
    if (verified.trim()) {
      ctx += `\n\n[${AGENTS[agentId]?.name} 검증된 지식 (Self-RAG가 자가검증한 항목들 — 최우선 신뢰)]\n${verified.slice(0, 4000)}`;
    }
  }
  if (memory.trim()) ctx += `\n\n[${AGENTS[agentId]?.name} 개인 메모리 ${ragMode === 'self-rag' ? '— 미검증 포함, 신중히 사용' : ''}]\n${memory.slice(0, lean ? 1500 : 4000)}`;
  /* Bridge to broader brain folder — Graph RAG retrieval is always on
     (the brain network IS the graph; not using it would be wasteful).
     Normal: 2400 chars cap. Lean: 900 chars cap — 두뇌가 살아있되 짐 가벼움. */
  try {
    ctx += readGraphRagBrainContext(agentId, lean ? 900 : 2400);
  } catch { /* never let brain scan break the prompt */ }
  /* Self-RAG instruction block — appended late so it overrides earlier
     conventions. Tells the agent to ground every claim in the context above
     and tag ungrounded claims as [추측]. This is the "self-critique" step
     of Self-RAG, expressed as a strict output protocol. */
  if (ragMode === 'self-rag') {
    ctx += `\n\n[Self-RAG 자가검증 프로토콜 — 반드시 따를 것]\n`
      + `1. 답변 생성 전 위 컨텍스트(개인 목표·회사 목표·메모리·두뇌 지식)에서 근거가 되는 항목을 머릿속으로 골라내세요.\n`
      + `2. 각 사실 주장 옆에 \`[근거: <출처 한 마디>]\` 또는 \`[추측]\` 중 하나를 반드시 표기하세요. 출처가 위 컨텍스트에 없으면 \`[추측]\` 입니다.\n`
      + `3. 답변 마지막 줄에 \`자가검증: 사실 N개 / 추측 M개\` 한 줄을 추가하세요.\n`
      + `4. \`[추측]\`이 \`[근거:]\`보다 많으면 답변하지 말고 \`정보 부족 — 두뇌 폴더에 X 자료 필요\` 라고만 말하세요. 근거 없는 자신감은 회사 의사결정 로그를 오염시킵니다.`;
    /* User-defined extra criteria — appended only if non-empty. Tagged as
       "추가 기준" so the model treats them as authoritative checks on top
       of the standard protocol. */
    const userCriteria = readAgentSelfRagCriteria(agentId).trim();
    if (userCriteria) {
      ctx += `\n\n[Self-RAG 추가 기준 — 사용자 정의 (위 프로토콜 위에 강제 적용)]\n${userCriteria.slice(0, 3500)}\n\n위 사용자 정의 기준 중 하나라도 만족하지 못하면 답변을 보내기 전 수정하세요. 기준 위반은 \`자가검증\` 라인에서 \`기준 위반: …\` 형태로 명시.`;
    }
  }
  // Tool catalog — agent can invoke these via <run_command>. Only ENABLED
  // tools surface here; disabled ones are hidden so the agent never picks
  // them up autonomously. Absolute paths resolve correctly regardless of
  // where the user put their brain folder.
  /* google_calendar_write is a diagnostic-only Python script — the real
     calendar read/write is handled by built-in TypeScript functions
     (refreshCalendarCacheViaOAuth, createCalendarEventForTask). Exclude it
     from the tool catalog so the agent doesn't generate 'cd && python'
     commands for calendar operations. Same for google_calendar (iCal read). */
  const _BUILTIN_TOOLS = new Set(['google_calendar_write', 'google_calendar']);
  const tools = listAgentTools(agentId).filter(t => t.enabled && !_BUILTIN_TOOLS.has(t.name));
  if (tools.length > 0) {
    ctx += `\n\n[사용 가능한 도구 — <run_command>로 직접 실행 가능]\n` + tools.map(t => {
      const cd = `cd "${path.dirname(t.scriptPath)}"`;
      return `- 🛠️ \`${t.name}\` — ${t.description.replace(/\n/g, ' ').slice(0, 140)}\n  실행: <run_command>${cd} && python ${path.basename(t.scriptPath)}</run_command>\n  설정 파일(API 키 등): ${t.configPath}`;
    }).join('\n');
    /* v2.89.31 — 도구 사용 의무화. 작은 LLM은 도구 카탈로그를 무시하고
       LLM 지식만으로 답변하는 경향이 있어서, 실데이터가 필요한 task일 때
       반드시 도구를 명시적으로 실행 요청하라고 강제. 단 한 응답 안에서
       LLM은 도구 stdout을 못 봄 — system이 LLM 응답 종료 후 실행하고
       결과는 출력 끝에 append되어 다음 에이전트(peerCtx)와 final report에 흘러감. */
    ctx += `\n\n[🛠️ 도구 사용 규칙 — 반드시 따를 것]\n`
      + `- 위 도구 중 task에 필요한 게 있고 [실시간 데이터] 섹션에 해당 데이터가 아직 없으면, **답변 어디든** \`<run_command>\` 블록을 출력하세요. 시스템이 LLM 응답 종료 후 실행하고 결과를 출력 끝에 append합니다 (당신은 이 응답에서 stdout 못 봄 — 다음 에이전트와 final report가 활용).\n`
      + `- 이미 [실시간 데이터] 섹션에 데이터가 자동 주입돼 있으면 그걸 분석에 활용 — 도구 중복 실행 X.\n`
      + `- 데이터 없이 추측·일반론으로 답하는 건 금지. 데이터가 없고 도구도 없으면 솔직히 "데이터 부족으로 분석 보류" + 평가 \`대기\`로.\n`
      + `- 같은 task에 여러 도구가 도움 되면 \`<run_command>\` 블록을 여러 개 출력해도 됩니다 (시스템이 순차 실행).`;
  }
  /* Calendar context — if OAuth is connected, tell the agent it can access
     calendar data through the built-in system (no Python script needed).
     The actual data is already in _shared/calendar_cache.md (injected via
     readAgentSharedContext). */
  if (agentId === 'secretary' && isCalendarWriteConnected()) {
    ctx += `\n\n[📅 Google Calendar — 내장 연결됨]\n캘린더 데이터는 위 [다가오는 일정] 섹션에 자동 로드됩니다. Python 스크립트 실행 불필요 — 일정 조회는 이미 로드된 컨텍스트를 참고하세요. 일정 생성은 추적기에 due를 넣으면 자동으로 생성됩니다.`;
  }
  ctx += readAgentCustomPrompt(agentId);
  return ctx;
}

function appendAgentMemory(agentId: string, line: string) {
  try {
    const p = path.join(getCompanyDir(), '_agents', agentId, 'memory.md');
    const stamp = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(p, `\n- [${stamp}] ${line.replace(/\n/g, ' ').slice(0, 300)}`);
  } catch { /* ignore */ }
}

/* ── Self-RAG verified knowledge store ────────────────────────────────────
   memory.md is the firehose (everything happens, including [추측]). When
   Self-RAG is ON for an agent, we parse its output for `[근거: source]`
   patterns and promote those claims into a curated `verified.md` next to
   memory.md. Future cycles preferentially retrieve from verified.md so the
   agent works off claims it has already self-grounded — not from raw
   speculation. */
function readAgentVerifiedKnowledge(agentId: string): string {
  try {
    const p = path.join(getCompanyDir(), '_agents', agentId, 'verified.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  } catch { return ''; }
}
function appendAgentVerifiedKnowledge(agentId: string, claim: string, source: string) {
  try {
    const dir = path.join(getCompanyDir(), '_agents', agentId);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'verified.md');
    if (!fs.existsSync(p)) {
      const a = AGENTS[agentId];
      const header = `# ${a?.emoji || '✓'} ${a?.name || agentId} — 검증된 지식

_Self-RAG가 출력에서 \`[근거: ...]\` 태그가 붙은 주장만 자동 승격해서 누적._
_여기 들어온 내용만 다음 사이클의 retrieval 우선순위에 들어갑니다._
_사용자가 직접 줄을 지우면 그 주장은 다시 미검증 상태로 돌아갑니다._

`;
      fs.writeFileSync(p, header);
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const oneLine = (claim || '').replace(/\n/g, ' ').slice(0, 360);
    const src = (source || '').replace(/\n/g, ' ').slice(0, 120);
    fs.appendFileSync(p, `\n- [${stamp}] ${oneLine} _(근거: ${src})_`);
  } catch { /* ignore */ }
}
function countAgentVerifiedClaims(agentId: string): number {
  try {
    const txt = readAgentVerifiedKnowledge(agentId);
    if (!txt) return 0;
    return (txt.match(/^\s*-\s*\[\d{4}-\d{2}-\d{2}\]/gm) || []).length;
  } catch { return 0; }
}

/* Parse an agent's response text for [근거: source] grounded claims and
   promote each to verified.md. We capture the WHOLE LINE (or a meaningful
   slice) containing the tag, plus the source label inside the brackets. */
function promoteGroundedClaimsFromOutput(agentId: string, output: string): number {
  if (!output) return 0;
  /* Match lines that contain [근거: ...] anywhere. Grab the entire line for
     context, and pull the source out of the brackets. */
  const lines = output.split('\n');
  const tagRe = /\[\s*근거\s*[:：]\s*([^\]\n]+?)\s*\]/;
  let promoted = 0;
  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln) continue;
    const m = ln.match(tagRe);
    if (!m) continue;
    /* Strip the [근거: ...] tag from the claim text so verified.md doesn't
       echo the bracket — we already have the source as a separate field. */
    const claim = ln.replace(tagRe, '').replace(/\s{2,}/g, ' ').trim();
    if (claim.length < 4) continue; /* skip degenerate matches */
    appendAgentVerifiedKnowledge(agentId, claim, m[1].trim());
    promoted++;
    if (promoted >= 12) break; /* sanity cap per output */
  }
  return promoted;
}

/* When the user injects a file into the brain (⚡ button), score it against
   each agent's specialty and append a memory line to the top matches. The
   raw file lives at <brain>/00_Raw/<date>/<name>; agents now know "new
   knowledge inbound" without us having to wait for them to scan the brain
   folder on next cycle. Returns the agent IDs that received an entry. */
function routeBrainInjectionToAgents(filePath: string, fileName: string): string[] {
  if (!isCompanyConfigured()) return [];
  let raw = '';
  try {
    const st = fs.statSync(filePath);
    if (st.size > 80_000) return []; /* don't try to summarize giant files */
    raw = fs.readFileSync(filePath, 'utf-8').slice(0, 8000);
  } catch { return []; }
  if (!raw.trim()) return [];

  /* Best-of: score the file against every specialist. Pick top 2 above
     a threshold — narrow enough to avoid spamming everyone. */
  type Match = { id: string; score: number };
  const matches: Match[] = [];
  for (const id of SPECIALIST_IDS) {
    const kws = _agentKeywords(id);
    const score = _scoreRelevance(raw + ' ' + fileName, kws);
    if (score >= 2) matches.push({ id, score });
  }
  matches.sort((a, b) => b.score - a.score);
  const winners = matches.slice(0, 2).map(m => m.id);

  /* Always tell CEO too — CEO needs to know new knowledge arrived even if
     it doesn't match a specialist cleanly. */
  const recipients = Array.from(new Set(['ceo', ...winners]));

  /* Build the one-line summary: title (first H1) + first 140 chars of
     the first non-heading paragraph, or just the filename + first chunk. */
  const h1 = raw.match(/^#\s+(.+?)\s*$/m);
  const title = (h1 && h1[1] ? h1[1].trim() : fileName).slice(0, 80);
  const body = raw
    .replace(/^---[\s\S]*?---\n/, '')
    .split('\n')
    .find(ln => ln.trim() && !ln.trim().startsWith('#') && !ln.trim().startsWith('---'))
    || raw.replace(/\s+/g, ' ').slice(0, 200);
  const blurb = body.replace(/\s+/g, ' ').trim().slice(0, 160);
  /* Source path is relative to brain root (where 00_Raw/ etc. live),
     not the company subdir — keeps the citation human-readable. */
  const rel = path.relative(_getBrainDir(), filePath);

  const line = `📥 새 지식 입수 — **${title}**: ${blurb} (출처: ${rel})`;
  for (const id of recipients) {
    appendAgentMemory(id, line);
  }
  return recipients;
}

// ───────────────────────────────────────────────────────────────────────────
// Per-agent goal layer (v2.38)
// ---------------------------------------------------------------------------
// Each agent owns a personal `goal.md` separate from the company's shared
// `_shared/goals.md`. Hierarchy when building prompt context:
//   1. Agent goal       (this file) — most specific, takes priority
//   2. Company goals    (_shared/goals.md) — shared by every agent
//   3. Company identity (_shared/identity.md)
//   4. Decisions log    (_shared/decisions.md)
//   5. Agent memory     (_agents/{id}/memory.md)
//   6. Brain knowledge  (root brain folder, surfaced by separate flow)
//
// Empty goal.md is fine — agent simply runs without a personal mission.
// ───────────────────────────────────────────────────────────────────────────
/* Mission templates — what each agent works toward when 24h autonomy is on.
   Users edit freely from the agent panel; saved to `_agents/{id}/goal.md`.
   Empty string = no template (agent follows only the company goal). */
const _GOAL_PREAMBLE = `> 🌞 24시간 업무가 켜져 있으면 이 미션을 향해 자동으로 한 스텝씩 일합니다.
> 자유롭게 수정하세요. 비워두면 회사 공동 목표만 따라갑니다.
`;
const DEFAULT_AGENT_GOALS: Record<string, string> = {
  youtube: `# 🎯 YouTube 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 채널 정체성 확립 + 구독자 1만 도달
- 영상 평균 시청 지속률 50% 이상

## 이번 주 목표
- 후크 강한 영상 기획서 3개 작성
- 감시 채널 댓글 패턴에서 후크 단어 5개 추출
- 경쟁 채널 인기 영상 → 다음 액션 브리프 1건

## 사용 가능한 도구 (Skills)
- 🔑 \`youtube_account\` — API 키·내 채널·감시 채널·텔레그램 한 번에 설정
- 🎯 \`trend_sniper\` — 키워드 기반 떡상 영상 패턴 분석
- 🌙 \`auto_planner\` — 트렌드 스나이퍼 무인 반복 실행
- 🎬 \`my_videos_check\` — 내 채널 영상이 잘 올라갔는지 자동 판단
- 💬 \`comment_harvester\` — 감시 채널 댓글 → memory.md 누적
- 🔭 \`competitor_brief\` — 경쟁 채널 → 지시문 형식 다음 액션
- 📨 \`telegram_notify\` — 다른 도구 보고를 메신저로 자동 푸시

## 작업 원칙
- 추상적 조언 대신 **실행 가능한 산출물** (제목·썸네일 브리프·스크립트 후크)
- 매번 다음 단계 1줄을 명시
- 메모리(\`memory.md\`)에 누적된 댓글·반응 키워드를 후크에 반영
`,
  instagram: `# 📸 Instagram 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 피드 톤앤매너 확립 + 팔로워 5천 도달
- 릴스 평균 도달 1만 이상

## 이번 주 목표
- 릴스 기획 3개 (훅·보이스오버·자막 포함)
- 캡션·해시태그 패턴 정리

## 작업 원칙
- 매 산출물마다 게시 시간 + 후속 스토리 아이디어 1개
`,
  designer: `# 🎨 Designer 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 브랜드 컬러·타이포·로고 시스템 확정
- 썸네일/포스트 템플릿 3종 표준화

## 이번 주 목표
- 디자인 브리프 1건 작성 (레퍼런스 5장 포함)
- 썸네일 컨셉 3안 비교 정리

## 작업 원칙
- 텍스트 설명만 X — 색상 코드·폰트명·레이아웃 좌표까지 구체적으로
`,
  developer: `# 💻 Developer 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 반복 업무 자동화 스크립트 5개 운영
- 데이터 파이프라인 / API 연결 안정화

## 이번 주 목표
- 가장 시간 잡아먹는 수동 작업 1개 자동화
- 기존 스크립트 1개 리팩터·테스트 보강

## 작업 원칙
- 항상 실행 가능한 코드 + 사용법 1줄
- 외부 호출은 키 노출 없이 환경변수로
`,
  business: `# 📊 Business 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 수익화 모델 1개 가설 검증 → 매출화
- 핵심 KPI 대시보드 운영

## 이번 주 목표
- 가격·번들 옵션 2~3안 비교 메모
- 경쟁사 3곳 ROI 분석

## 작업 원칙
- 결정 가능한 권고 (A/B 중 어느 쪽인지) + 근거 숫자
`,
  secretary: `# 🗂️ Secretary 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 데일리 브리핑·할 일 정리 루틴 자동화
- 다른 에이전트 산출물을 한 줄 요약으로 모아서 보고

## 이번 주 목표
- 매일 09:00 데일리 브리핑 정리
- 미해결 할 일 5건 추적 + 다음 액션 명시

## 작업 원칙
- "정리"보다 "다음 액션 1개" 명시가 우선
`,
  editor: `# ✂️ Editor 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 영상 편집 디렉션 템플릿 (오프닝·B-roll·아웃트로) 표준화
- 평균 컷 리듬·자막 톤 가이드 확립

## 이번 주 목표
- 최근 영상 1편 컷·자막·B-roll 디렉션 작성
- 스크립트 1편 다듬기 (불필요 문장 제거)

## 작업 원칙
- 막연한 "다듬어줘" X — 시간 코드 + 구체 액션
`,
  writer: `# ✍️ Writer 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 후크·CTA 라이브러리 50개 운영
- 채널·인스타·블로그 톤앤매너 가이드 확정

## 이번 주 목표
- 영상 스크립트 초안 2편 (후크 3안 포함)
- 인스타 캡션 5개 + 블로그 글 1편

## 작업 원칙
- 한 산출물에 후크/본문/CTA를 명확히 분리
`,
  researcher: `# 🔍 Researcher 에이전트 — 나의 미션

${_GOAL_PREAMBLE}
## 장기 목표 (3~6개월)
- 산업·경쟁사 트렌드 리포트 월 1회 발행
- 인용 가능한 1차 자료 라이브러리 구축

## 이번 주 목표
- 우리 분야 트렌드 5개 짧은 메모
- 경쟁사 2곳 최근 활동·성공 콘텐츠 정리

## 작업 원칙
- 출처 링크 필수, 의견과 사실 분리해서 표기
`,
};

function readAgentGoal(agentId: string): string {
  try {
    const p = path.join(getCompanyDir(), '_agents', agentId, 'goal.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  } catch { return ''; }
}

function writeAgentGoal(agentId: string, content: string) {
  const dir = path.join(getCompanyDir(), '_agents', agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'goal.md'), content);
}

/** Seed goal.md if missing. Called by ensureCompanyStructure. */
function _seedAgentGoalIfMissing(agentId: string) {
  try {
    const p = path.join(getCompanyDir(), '_agents', agentId, 'goal.md');
    if (fs.existsSync(p)) return;
    const seed = DEFAULT_AGENT_GOALS[agentId] || '';
    if (seed) fs.writeFileSync(p, seed);
  } catch { /* ignore */ }
}

// ───────────────────────────────────────────────────────────────────────────
// Per-agent retrieval strategy (v2.45) — educational toggle
// ---------------------------------------------------------------------------
// Each agent picks ONE retrieval strategy. The choice changes both how the
// agent reads the brain folder AND how it self-checks its own output:
//   - "standard"  : current keyword routing, no self-critique
//   - "self-rag"  : keyword routing + self-critique step (factuality + sources)
//   - "graph-rag" : co-occurrence graph traversal over brain folder
// Stored as plain text in `_agents/{id}/rag_mode.txt`. Default is "standard"
// so existing companies keep current behavior on upgrade.
// ───────────────────────────────────────────────────────────────────────────
/* Two modes only: 'standard' = Graph RAG retrieval, no self-critique.
   'self-rag' = Graph RAG retrieval + self-critique protocol + verified.md
   promotion. The old 'graph-rag' mode is folded into 'standard' since the
   graph IS the brain — always traversed. Existing saved values of
   'graph-rag' are migrated to 'standard' on read. */
type RagMode = 'standard' | 'self-rag';
const RAG_MODES: RagMode[] = ['standard', 'self-rag'];

function readAgentRagMode(agentId: string): RagMode {
  try {
    const p = path.join(getCompanyDir(), '_agents', agentId, 'rag_mode.txt');
    if (!fs.existsSync(p)) return 'standard';
    const v = fs.readFileSync(p, 'utf-8').trim().toLowerCase();
    return (RAG_MODES as string[]).includes(v) ? v as RagMode : 'standard';
  } catch { return 'standard'; }
}

function writeAgentRagMode(agentId: string, mode: string) {
  const safe = (RAG_MODES as string[]).includes(mode) ? mode : 'standard';
  const dir = path.join(getCompanyDir(), '_agents', agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'rag_mode.txt'), safe);
}

/* User-defined Self-RAG verification criteria. Plain markdown — agent reads
   it and appends to the standard self-critique protocol. Lets users tailor
   "what counts as grounded" to their domain (e.g. "any number must cite an
   actual data file", "thumbnail copy must be ≤5 words"). */
function readAgentSelfRagCriteria(agentId: string): string {
  try {
    const p = path.join(getCompanyDir(), '_agents', agentId, 'self_rag_criteria.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  } catch { return ''; }
}
function writeAgentSelfRagCriteria(agentId: string, content: string) {
  const dir = path.join(getCompanyDir(), '_agents', agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'self_rag_criteria.md'), (content || '').slice(0, 4000));
}

// ───────────────────────────────────────────────────────────────────────────
// Per-agent tools (v2.39)
// ---------------------------------------------------------------------------
// Each agent owns a `tools/` folder under their `_agents/{id}/` directory.
// A tool is a triplet:
//   <name>.py    — executable script (reads sibling JSON for config)
//   <name>.json  — config values (API keys, params) — edited via panel UI
//   <name>.md    — agent-facing description (shown in panel + injected
//                   into specialist prompt context as a tool catalog)
//
// Tools live INSIDE the brain folder so they auto-sync to GitHub with the
// rest of the user's knowledge. Scripts use os.path.dirname(__file__) to
// resolve their config path, so they work regardless of where the user
// puts their brain folder.
// ───────────────────────────────────────────────────────────────────────────

interface AgentTool {
  name: string;          // e.g. "trend_sniper"
  displayName: string;   // human label
  description: string;   // short blurb for catalog
  scriptPath: string;    // absolute path to .py
  configPath: string;    // absolute path to .json
  readmePath: string;    // absolute path to .md
  config: Record<string, any>;   // parsed JSON values
  configSchema: ToolField[];     // inferred field schema for UI
  injectedAt?: string;   // ISO date — only set for skills injected via /api/skill-inject
  injectedFrom?: string; // origin tag (e.g. "ezer", "ai-university")
  enabled: boolean;      // user toggle — false hides tool from agent's prompt catalog
}

interface ToolField {
  key: string;
  label: string;
  type: 'password' | 'text' | 'list' | 'number';
  value: any;
}

function _inferToolFieldType(key: string, value: any): ToolField['type'] {
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number') return 'number';
  // any key with KEY/SECRET/TOKEN/PASS → password
  if (/(KEY|SECRET|TOKEN|PASS|API)/i.test(key)) return 'password';
  return 'text';
}

function listAgentTools(agentId: string): AgentTool[] {
  const dir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
  if (!fs.existsSync(dir)) return [];
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  let names = entries
    .filter(f => f.endsWith('.py'))
    .map(f => f.slice(0, -3));
  /* v2.67 dedup: hide the iCal-only `google_calendar` tool whenever the
     OAuth tool `google_calendar_write` is present — they overlap entirely
     and users found two "Google Calendar" entries confusing. */
  if (names.includes('google_calendar') && names.includes('google_calendar_write')) {
    names = names.filter(n => n !== 'google_calendar');
  }
  const out: AgentTool[] = [];
  for (const name of names) {
    const scriptPath = path.join(dir, `${name}.py`);
    const configPath = path.join(dir, `${name}.json`);
    const readmePath = path.join(dir, `${name}.md`);
    let config: Record<string, any> = {};
    try {
      if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch { /* malformed JSON — leave empty */ }
    let readme = '';
    try { if (fs.existsSync(readmePath)) readme = fs.readFileSync(readmePath, 'utf-8'); } catch {}
    // Display name: first H1 in readme, or prettified file name
    const h1 = readme.match(/^#\s+(.+)$/m);
    const displayName = h1 ? h1[1].trim() : name.replace(/_/g, ' ');
    // Description: first non-heading paragraph
    const descMatch = readme.split('\n').find(l => l.trim() && !l.startsWith('#'));
    const description = (descMatch || '').slice(0, 200);
    // _injectedAt 등 메타 키는 사용자에게 노출되는 설정 폼에선 숨김 — 출처 추적용 내부 필드.
    const configSchema: ToolField[] = Object.entries(config)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => ({
        key,
        label: key.replace(/_/g, ' '),
        type: _inferToolFieldType(key, value),
        value,
      }));
    const injectedAt = typeof config._injectedAt === 'string' ? config._injectedAt : undefined;
    const injectedFrom = typeof config._injectedFrom === 'string' ? config._injectedFrom : undefined;
    /* enabled defaults TRUE — explicit `_enabled: false` opts out, missing
       config or missing key both keep the tool active. Stored alongside
       other config keys so it round-trips through writeToolConfig untouched. */
    const enabled = config._enabled === false ? false : true;
    out.push({ name, displayName, description, scriptPath, configPath, readmePath, config, configSchema, injectedAt, injectedFrom, enabled });
  }
  return out;
}

function writeToolConfig(agentId: string, toolName: string, config: Record<string, any>) {
  const p = path.join(getCompanyDir(), '_agents', agentId, 'tools', `${toolName}.json`);
  let existing: Record<string, any> = {};
  try {
    if (fs.existsSync(p)) existing = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* malformed — overwrite cleanly */ }
  fs.writeFileSync(p, JSON.stringify({ ...existing, ...config }, null, 2));
}

/** Toggle a single tool's enabled flag without disturbing other config values. */
function setToolEnabled(agentId: string, toolName: string, enabled: boolean) {
  const p = path.join(getCompanyDir(), '_agents', agentId, 'tools', `${toolName}.json`);
  let config: Record<string, any> = {};
  try {
    if (fs.existsSync(p)) config = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* malformed — overwrite */ }
  if (enabled) {
    delete config._enabled; /* default is enabled, so absence === true */
  } else {
    config._enabled = false;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2));
}

/** Catalog of tools each specialist will eventually own. Drives the `tools.md`
 *  manifest seeding. Real implementations land iteratively — this file
 *  declares "what's coming" so the user can already pick autonomy levels. */
const AGENT_TOOLS_CATALOG: Record<string, { tool: string; desc: string }[]> = {
    ceo: [
        { tool: 'approval_gate', desc: '위험 액션(deploy/post/send/rm) 사용자 승인 게이트' },
        { tool: 'team_briefing', desc: '주간 전체 회의 자동 진행 + 회의록 정리' },
        { tool: 'router', desc: '사용자 명령 → 적합한 specialist로 분배' }
    ],
    youtube: [
        { tool: 'youtube_account', desc: 'YouTube Data API v3 OAuth 연결' },
        { tool: 'comment_replier', desc: '댓글 분류 + 답글 초안 (Draft 레벨에서 동작)' },
        { tool: 'video_uploader', desc: '제목·태그·썸네일·예약발행 업로드' },
        { tool: 'analytics_pull', desc: '주간 인사이트 (조회수·시청 지속률·구독 전환)' },
        { tool: 'trend_sniper', desc: '내 분야 트렌드 → Writer에게 아이디어 전달' }
    ],
    instagram: [
        { tool: 'instagram_account', desc: 'Meta Graph API OAuth (비즈니스 계정)' },
        { tool: 'feed_poster', desc: '피드/스토리/릴스 게시 (Draft → 승인 → 게시)' },
        { tool: 'dm_responder', desc: 'DM·댓글 분류 + 답글 초안' },
        { tool: 'insights_pull', desc: '도달·참여·팔로워 추이' }
    ],
    designer: [
        { tool: 'image_local', desc: '로컬 SDXL/FLUX 이미지 생성 (오프라인 정체성)' },
        { tool: 'image_cloud', desc: 'DALL-E/Replicate (Connected 모드 토글)' },
        { tool: 'brand_check', desc: '브랜드 색상 팔레트·타이포 일관성 검증' },
        { tool: 'asset_library', desc: '_company/assets/ 자동 정리·태깅' }
    ],
    developer: [
        { tool: 'project_scaffolder', desc: '_company/projects/<name>/ 폴더 자동 생성 (vite/next/astro)' },
        { tool: 'dev_server', desc: '자체 dev server + 포트 매니저 + 라이브 미리보기 푸시' },
        { tool: 'git_committer', desc: '작업 단위 자동 커밋' },
        { tool: 'deploy_cli', desc: 'Vercel/Netlify/Cloudflare 배포 (deploy --prod는 항상 승인)' },
        { tool: 'lint_test', desc: '테스트·린트·타입체크 자동 실행' }
    ],
    business: [
        { tool: 'revenue_pull', desc: 'Stripe/Toss/PayPal 매출 데이터' },
        { tool: 'analytics_pull', desc: 'Google Analytics / Plausible 트래픽' },
        { tool: 'pnl_generator', desc: '월별 P&L 마크다운 자동 생성' }
    ],
    secretary: [
        { tool: 'calendar_local', desc: '_agents/secretary/calendar.md (Lv.1 오프라인)' },
        { tool: 'calendar_caldav', desc: 'CalDAV (iCloud/Google 호환, Connected 토글)' },
        { tool: 'telegram_bot', desc: '텔레그램 양방향 봇 (이미 활성)' },
        { tool: 'kakao_alert', desc: '카카오톡 "나에게 보내기" 단방향 알림' },
        { tool: 'email_triage', desc: 'IMAP/Gmail 분류 + 답장 초안' }
    ],
    editor: [
        { tool: 'ffmpeg_runner', desc: '컷·자막·B-roll 합성' },
        { tool: 'whisper_local', desc: '로컬 자막 생성 (오프라인)' },
        { tool: 'reframe_9_16', desc: '16:9 → 9:16 자동 리프레임 (릴스/숏츠)' }
    ],
    writer: [
        { tool: 'tone_learner', desc: '사용자 과거 글 학습 → 톤 복제' },
        { tool: 'multi_platform_adapt', desc: '하나의 스크립트 → YouTube/IG/블로그 자동 변환' },
        { tool: 'hook_library', desc: '후크·CTA 라이브러리 운영' }
    ],
    researcher: [
        { tool: 'web_search', desc: 'Brave/DuckDuckGo 검색 (Connected)' },
        { tool: 'page_fetcher', desc: '본문 추출 + 출처 인용' },
        { tool: 'monitor_daily', desc: '매일 내 분야 뉴스 → CEO 브리핑' }
    ]
};

/** Seed `_agents/<id>/tools.md` — declares the agent's tool roster + autonomy
 *  level toggle (0~3). Idempotent. Educational toggle: user picks how much
 *  authority each agent has, in the same file the agent reads its persona from. */
function _seedAgentToolsManifestIfMissing(agentId: string) {
    try {
        const p = path.join(getCompanyDir(), '_agents', agentId, 'tools.md');
        if (fs.existsSync(p)) return;
        const a = AGENTS[agentId];
        if (!a) return;
        const tools = AGENT_TOOLS_CATALOG[agentId] || [];
        const toolsBody = tools.length === 0
            ? '_(이 에이전트는 아직 등록된 도구가 없습니다. 추후 추가 예정.)_'
            : tools.map(t => `### \`${t.tool}\`\n${t.desc}\n\n- \`enabled\`: true\n- \`requires_credentials\`: \`config.md\` 참조\n`).join('\n');

        const body = `# ${a.emoji} ${a.name} — 도구 매니페스트

_${a.name} 에이전트가 어떤 도구를 어디까지 자율적으로 쓸 수 있는지 정의합니다._
_매번 시스템 프롬프트로 주입되며, 텔레그램에서 \`/tools\`로 현재 상태 확인 가능._

---

## 자율도 레벨

AUTONOMY_LEVEL: 2

| 값 | 의미 |
|---|---|
| 0 | Off — 도구 전체 비활성 (이 에이전트는 채팅만) |
| 1 | Read-only — 읽기·분석·보고만, 외부에 쓰기 X |
| 2 | Draft — 초안 작성 후 사용자 승인 게이트 통과해야 실행 ⭐ 권장 기본값 |
| 3 | Auto — 화이트리스트 안에서 사용자 승인 없이 실행 |

> 위 \`AUTONOMY_LEVEL\` 줄의 숫자(0~3)를 직접 바꾸면 다음 호출부터 적용됩니다.

---

## 사용 가능한 도구

${toolsBody}

---

## 안전 규칙 (모든 레벨 공통, 절대 우회 X)

- **삭제·배포·발송**(rm, deploy --prod, send, publish) 류는 자율도와 무관하게 **항상 승인 게이트**.
- 외부 API 호출 전 \`config.md\`의 토큰 존재 여부 확인.
- 모든 외부 행동은 \`_agents/${agentId}/activity.log\`에 한 줄 기록 (감사용).
- 승인 대기 액션은 \`approvals/pending/\` 에 저장 → 텔레그램 \`/approvals\` 로 조회.

---

_레벨을 어떻게 골라야 할지 모르겠다면 \`2 (Draft)\`가 안전한 시작점입니다._
`;
        fs.writeFileSync(p, body);
    } catch { /* ignore */ }
}

/** Seed each agent's starter tools. Idempotent — only writes files that
 *  don't already exist, so users can edit/delete freely without us clobbering.
 *  YouTube has the deepest tool catalog. Secretary owns telegram credentials
 *  (architecturally the messenger) so non-developers can input via the UI. */
function _seedAgentToolsIfMissing(agentId: string) {
  try {
    if (agentId === 'youtube') {
      const toolsDir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
      fs.mkdirSync(toolsDir, { recursive: true });
      _seedYouTubeAccount(toolsDir);
      _seedYouTubeTrendSniper(toolsDir);
      _seedYouTubeAutoPlanner(toolsDir);
      _seedYouTubeMyVideosCheck(toolsDir);
      _seedYouTubeChannelFullAnalysis(toolsDir);
      _seedYouTubeCommentHarvester(toolsDir);
      _seedYouTubeCompetitorBrief(toolsDir);
      _seedYouTubeTelegramNotify(toolsDir);
    } else if (agentId === 'secretary') {
      const toolsDir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
      fs.mkdirSync(toolsDir, { recursive: true });
      _seedSecretaryTelegram(toolsDir);
      /* v2.67: drop iCal-only tool from new installs — OAuth covers reading
         too, and having two "Google Calendar" entries was confusing. The
         iCal helper still exists for users on older installs (their files
         remain), but listAgentTools hides it whenever the OAuth tool is
         present so they only see ONE calendar entry. */
      _seedSecretaryGoogleCalendarWrite(toolsDir);
    }
  } catch { /* ignore */ }
}

function _seedFile(p: string, content: string) {
  if (fs.existsSync(p)) return;
  fs.writeFileSync(p, content);
}

/* Like _seedFile but force-overwrites if the existing file is missing a
   sentinel string. Use for autogenerated tool scripts when we ship a new
   version that needs to replace the old one — sentinel changes per version. */
function _seedFileForceUpgrade(p: string, content: string, sentinel: string) {
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, content);
    return;
  }
  try {
    const cur = fs.readFileSync(p, 'utf-8');
    if (!cur.includes(sentinel)) {
      fs.writeFileSync(p, content);
    }
  } catch { /* ignore */ }
}

function _seedYouTubeTrendSniper(toolsDir: string) {
  const py = _loadToolSeed('youtube/trend_sniper.py');
  const json = JSON.stringify({
    TARGET_KEYWORDS: ['유튜브 자동화', 'AI 비즈니스', '마케팅 트렌드', '생산성 툴'],
  }, null, 2);
  const md = _loadToolSeed('youtube/trend_sniper.md');
  _seedFile(path.join(toolsDir, 'trend_sniper.py'), py);
  _seedFile(path.join(toolsDir, 'trend_sniper.json'), json);
  _seedFile(path.join(toolsDir, 'trend_sniper.md'), md);
}

function _seedYouTubeAutoPlanner(toolsDir: string) {
  const py = _loadToolSeed('youtube/auto_planner.py');
  const json = JSON.stringify({
    INTERVAL_HOURS: 2,
    TOTAL_RUN_HOURS: 8,
  }, null, 2);
  const md = _loadToolSeed('youtube/auto_planner.md');
  _seedFile(path.join(toolsDir, 'auto_planner.py'), py);
  _seedFile(path.join(toolsDir, 'auto_planner.json'), json);
  _seedFile(path.join(toolsDir, 'auto_planner.md'), md);
}

/* ─── Shared YouTube account/channel config ────────────────────────────────
   The other tools (trend_sniper, my_videos_check, comment_harvester,
   competitor_brief, telegram_notify) all read this single file so the user
   only enters their API key / channels / Telegram once. */
function _seedYouTubeAccount(toolsDir: string) {
  const py = _loadToolSeed('youtube/youtube_account.py');
  const json = JSON.stringify({
    YOUTUBE_API_KEY: '',
    MY_CHANNEL_HANDLE: '',
    MY_CHANNEL_ID: '',
    WATCHED_CHANNELS: [],
    COMPETITOR_CHANNELS: [],
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    OLLAMA_URL: 'http://127.0.0.1:11434',
    MODEL: '',
  }, null, 2);
  const md = _loadToolSeed('youtube/youtube_account.md');
  _seedFile(path.join(toolsDir, 'youtube_account.py'), py);
  _seedFile(path.join(toolsDir, 'youtube_account.json'), json);
  /* Force-upgrade to surface the new Secretary-canonical guidance to users
     on older versions. Sentinel = the new section header. */
  _seedFileForceUpgrade(path.join(toolsDir, 'youtube_account.md'), md, '비서(Secretary)에 입력');
}

/* ─── My Videos Check — own channel performance (pro_v1) ────────────────────
   v2.89.43 — 전문 유튜브 분석가 수준의 종합 보고서. 이전엔 중간값 1줄 + 영상 목록만
   출력해서 "전문 에이전트답지 못함"이라는 사용자 피드백. 이제 채널 메타·요일별 성과·
   참여율·제목 키워드·인기 댓글·구체 액션 추천까지 포함. */
function _seedYouTubeMyVideosCheck(toolsDir: string) {
  const py = _loadToolSeed('youtube/my_videos_check.py');
  const json = JSON.stringify({ LOOKBACK_DAYS: 30, TOP_N: 15, COMMENT_SAMPLES: 5 }, null, 2);
  const md = _loadToolSeed('youtube/my_videos_check.md');
  /* Force-upgrade the .py — older users on pre-telegram_v2 versions need
     the Secretary fallback so token doesn't have to be duplicated. */
  /* v2.89.43 — sentinel 'pro_v1' = 종합 분석 버전. 기존 사용자도 자동 업그레이드. */
  /* sentinel pro_v4 — HTML entity 디코드 + 빈 영상 시 stderr로. 기존 설치자 자동 업그레이드. */
  _seedFileForceUpgrade(path.join(toolsDir, 'my_videos_check.py'), py, 'pro_v4');
  _seedFile(path.join(toolsDir, 'my_videos_check.json'), json);
  /* v2.89.20 — Force upgrade .md heading from old "내 영상 체크" to "내 유튜브 채널 분석"
     for existing users. Sentinel = the new heading text. */
  _seedFileForceUpgrade(path.join(toolsDir, 'my_videos_check.md'), md, '내 유튜브 채널 분석');
}

/* ─── 📈 채널 완전 분석 — v2.89.21 ──────────────────────────────────────────
   API 키 + 채널 ID 만 있으면 돌아가는 통합 분석 도구. my_videos_check 는
   "이번 달 영상 떡상/부진 보기" 같은 단순 비교라면, 이건 채널 전체 그림:
   - 채널 메타 (구독자·총조회·영상수·가입일·평균 조회)
   - 최근 30일 업로드 패턴 (요일·시간대·길이)
   - 영상별 참여율 (좋아요/조회, 댓글/조회)
   - 인기 영상 vs 부진 영상의 제목·길이 패턴 비교
   - 다음 액션 자동 추천 (LLM 호출 없이 통계만으로)
   추가 입력 필요 없음. */
function _seedYouTubeChannelFullAnalysis(toolsDir: string) {
  const py = _loadToolSeed('youtube/channel_full_analysis.py');
  const json = JSON.stringify({}, null, 2); /* 추가 입력 없음 */
  const md = _loadToolSeed('youtube/channel_full_analysis.md');
  _seedFile(path.join(toolsDir, 'channel_full_analysis.py'), py);
  _seedFile(path.join(toolsDir, 'channel_full_analysis.json'), json);
  _seedFile(path.join(toolsDir, 'channel_full_analysis.md'), md);
}

/* ─── Comment Harvester — pulls comments from watched channels ───────────── */
function _seedYouTubeCommentHarvester(toolsDir: string) {
  const py = _loadToolSeed('youtube/comment_harvester.py');
  const json = JSON.stringify({
    VIDEOS_PER_CHANNEL: 5,
    COMMENTS_PER_VIDEO: 20,
    LOOKBACK_DAYS: 14,
  }, null, 2);
  const md = _loadToolSeed('youtube/comment_harvester.md');
  _seedFile(path.join(toolsDir, 'comment_harvester.py'), py);
  _seedFile(path.join(toolsDir, 'comment_harvester.json'), json);
  _seedFile(path.join(toolsDir, 'comment_harvester.md'), md);
}

/* ─── Competitor Brief — prescriptive next-actions from rivals ───────────── */
function _seedYouTubeCompetitorBrief(toolsDir: string) {
  const py = _loadToolSeed('youtube/competitor_brief.py');
  const json = JSON.stringify({ TOP_N_PER_CHANNEL: 5, LOOKBACK_DAYS: 30 }, null, 2);
  const md = _loadToolSeed('youtube/competitor_brief.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'competitor_brief.py'), py, 'telegram_v3');
  _seedFile(path.join(toolsDir, 'competitor_brief.json'), json);
  _seedFile(path.join(toolsDir, 'competitor_brief.md'), md);
}

/* ─── Telegram Notify — sender + connectivity check ─────────────────────── */
function _seedYouTubeTelegramNotify(toolsDir: string) {
  /* telegram_v3 — Secretary's tools/telegram_setup.json is canonical for
     telegram credentials (UI-managed). config.md and youtube_account.json
     remain as back-compat fallbacks. */
  const py = _loadToolSeed('youtube/telegram_notify.py');
  const json = JSON.stringify({}, null, 2);
  const md = _loadToolSeed('youtube/telegram_notify.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'telegram_notify.py'), py, 'telegram_v3');
  _seedFile(path.join(toolsDir, 'telegram_notify.json'), json);
  _seedFileForceUpgrade(path.join(toolsDir, 'telegram_notify.md'), md, 'Secretary 비서가 정답');
}

/* ─── Secretary · Telegram 연결 도구 ────────────────────────────────────────
   Secretary is the canonical home for Telegram credentials. This seeds a
   telegram_setup tool so non-developer users can input bot token + chat_id
   via the Skills section's standard ⚙️ tool config modal — no markdown
   editing required. The .json field names match what _resolve_telegram
   looks for, and the .py runs a connectivity test on ▶ click. */
function _seedSecretaryTelegram(toolsDir: string) {
  const py = _loadToolSeed('secretary/telegram_setup.py');
  /* JSON keys are inferred as password by _inferToolFieldType because they
     match KEY|SECRET|TOKEN|API regex. CHAT_ID falls into 'text' because no
     match — exactly what we want. */
  const jsonStr = JSON.stringify({
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
  }, null, 2);
  const md = _loadToolSeed('secretary/telegram_setup.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'telegram_setup.py'), py, 'secretary_telegram_v2');
  _seedFile(path.join(toolsDir, 'telegram_setup.json'), jsonStr);
  _seedFileForceUpgrade(path.join(toolsDir, 'telegram_setup.md'), md, '⚙️ 버튼을 누르고 폼에 입력');
}

/* ─── Secretary · Google Calendar (iCal 읽기 전용) ──────────────────────────
   비서가 사용자의 Google Calendar 일정을 읽어서 데일리 브리핑/시간 비교에
   활용. v1은 OAuth 없이 iCal Secret URL 한 줄로 끝나는 read-only 모델.
   ▶ 실행하면 다가오는 N일치 일정을 _shared/calendar_cache.md 에 저장하고
   다른 에이전트가 readAgentSharedContext에서 자동 참조하게 됩니다. */
function _seedSecretaryGoogleCalendar(toolsDir: string) {
  const py = _loadToolSeed('secretary/google_calendar.py');
  const jsonStr = JSON.stringify({
    ICAL_URL: '',
    DAYS_AHEAD: 14,
  }, null, 2);
  const md = _loadToolSeed('secretary/google_calendar.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'google_calendar.py'), py, 'secretary_calendar_v1');
  _seedFile(path.join(toolsDir, 'google_calendar.json'), jsonStr);
  _seedFileForceUpgrade(path.join(toolsDir, 'google_calendar.md'), md, '가벼운 읽기, iCal');
}

/* ─── Secretary · Google Calendar Write (OAuth 자동 일정 등록) ────────────
   The actual OAuth dance + event creation is driven from TypeScript (host
   has axios + can spin up a loopback HTTP server). This Python is purely a
   status/diagnostic tool: ▶ shows whether the connection is alive. */
function _seedSecretaryGoogleCalendarWrite(toolsDir: string) {
  const py = _loadToolSeed('secretary/google_calendar_write.py');
  /* Empty-ish JSON — actual values come from the wizard. CALENDAR_ID and
     DEFAULT_DURATION_MINUTES are user-tunable via the standard ⚙️ form. */
  const jsonStr = JSON.stringify({
    CLIENT_ID: '',
    CLIENT_SECRET: '',
    REFRESH_TOKEN: '',
    CALENDAR_ID: 'primary',
    DEFAULT_DURATION_MINUTES: 60,
  }, null, 2);
  const md = _loadToolSeed('secretary/google_calendar_write.md');
  _seedFileForceUpgrade(path.join(toolsDir, 'google_calendar_write.py'), py, 'secretary_calendar_write_v1');
  _seedFile(path.join(toolsDir, 'google_calendar_write.json'), jsonStr);
  _seedFileForceUpgrade(path.join(toolsDir, 'google_calendar_write.md'), md, '비서가 본인의 Google Calendar와 양방향 연결');
}

/** Resolve the conversation log directory inside the user's brain folder.
 *  Lives at `<brain>/00_Raw/conversations/` so it joins the existing
 *  Second-Brain raw-knowledge convention — visible to the brain graph,
 *  synced by GitHub auto-sync, browsable in the user's note-taking app. */
function getConversationsDir(): string {
  const brain = getCompanyDir(); // unified with brain folder
  return path.join(brain, '00_Raw', 'conversations');
}

/** Append one entry to the day's running conversation log. Living transcript
 *  of every interaction in the company — user commands, CEO briefs, each
 *  agent's output, confer turns, final reports. Stored in 00_Raw alongside
 *  other raw knowledge so it participates in brain queries. */
function appendConversationLog(entry: { speaker: string; emoji?: string; section?: string; body: string }) {
  try {
    const convDir = getConversationsDir();
    fs.mkdirSync(convDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const dayFile = path.join(convDir, `${today}.md`);
    if (!fs.existsSync(dayFile)) {
      fs.writeFileSync(dayFile, `# 📜 ${today} 회사 대화록\n\n_모든 명령·분배·산출물·대화가 시간순으로 누적됩니다. 두뇌가 자동 인덱싱·동기화합니다._\n`);
    }
    const ts = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const emoji = entry.emoji || '🗨️';
    const sectionLine = entry.section ? ` · _${entry.section}_` : '';
    const block = `\n## [${ts}] ${emoji} **${entry.speaker}**${sectionLine}\n\n${entry.body}\n`;
    fs.appendFileSync(dayFile, block);
  } catch { /* logging must never break the flow */ }
}

/** Read the last N chars (across today + yesterday) of the conversation log
 *  for use as system-prompt context. Lets CEO recall what the company has
 *  recently been working on without needing the full file. */
function readRecentConversations(maxChars = 2500): string {
  try {
    const convDir = getConversationsDir();
    if (!fs.existsSync(convDir)) return '';
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let combined = '';
    for (const day of [yesterday, today]) {
      const f = path.join(convDir, `${day}.md`);
      if (fs.existsSync(f)) {
        try { combined += fs.readFileSync(f, 'utf-8'); } catch { /* ignore */ }
      }
    }
    if (!combined) return '';
    const tail = combined.slice(-maxChars);
    return `\n\n[최근 회사 대화 요약 (참고용)]\n${tail}\n`;
  } catch {
    return '';
  }
}

function makeSessionDir(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const dir = path.join(getCompanyDir(), 'sessions', ts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const CEO_PLANNER_PROMPT = _loadPrompt('ceo-planner.md');
/* Conversational CEO prompt — used for the casual-chat fast path so a "안녕"
   doesn't crash the JSON planner. Small models will reply with a polite
   greeting no matter how strict the JSON instruction; we detect those turns
   up front and route them here instead of fighting the model. */
const CEO_CHAT_PROMPT = _loadPrompt('ceo-chat.md');
/* Reads the user's chosen Secretary bridge scope. The setting controls how
   much of the user↔company interaction Secretary mediates:
     off          — Secretary only handles Telegram. Sidebar talks to CEO direct.
     output_only  — sidebar input goes to CEO as before, but Secretary writes
                    a 1-line "사장님께 정리" card after each dispatch.
     full         — sidebar input also goes to Secretary first; Secretary
                    either replies directly or escalates to CEO planner.
   Exposed as a setting (not a memory) because it changes runtime routing
   meaningfully and the user should be able to flip it from the standard VS
   Code settings UI. Educational toggle in the spirit of feedback_educational_toggles. */
type SecretaryBridgeMode = 'off' | 'output_only' | 'full';
function readSecretaryBridgeMode(): SecretaryBridgeMode {
    try {
        const cfg = vscode.workspace.getConfiguration('connectAiLab');
        const v = (cfg.get<string>('secretaryBridgeMode') || 'off').trim().toLowerCase();
        if (v === 'output_only' || v === 'full') return v;
    } catch { /* fall through to default */ }
    return 'off';
}

/* Lightweight JSON triage prompt — used only when bridge mode is 'full'.
   Secretary decides whether the user's sidebar message is something it can
   answer itself (greeting, schedule lookup, simple Q&A) or needs to be
   escalated to the CEO planner for multi-agent work. Output is strict JSON
   so we can branch deterministically. */
const SECRETARY_TRIAGE_PROMPT = _loadPrompt('secretary-triage.md');
/* Heuristic for "this is small talk, not a work order". When true we skip
   the JSON planner and just have CEO chat back. Conservative: only matches
   short greetings/acks; anything longer or with action verbs falls through
   to the full planner. */
function _isCasualChat(text: string): boolean {
    const t = (text || '').trim();
    if (!t) return false;
    // Very short messages with no verbs → casual
    if (t.length < 6) return true;
    // Common Korean greetings / acks / status questions (whole-word-ish)
    if (/^(안녕|잘\s*지냈|헬로|하이|좋은\s*아침|좋은\s*저녁|굿모닝|굿이브닝|반가워|오랜만|뭐해|뭐\s*하고|잘\s*있어|식사|밥\s*먹|커피|화이팅|파이팅)/i.test(t)) return true;
    if (/^(응|네|넵|넹|그래|좋아|오케이|ok|okay|ㅇㅋ|알겠|확인|고마워|감사|땡큐|thx|thanks)([\s.!?~ㅋㅎ]|$)/i.test(t)) return true;
    // Pure emoji/laughter
    if (/^[\sㅋㅎ.!?~ㅠㅜ😂🙂😊👍❤️]+$/u.test(t)) return true;
    return false;
}

/* v2.89.38 — 사용자 명령의 의도 분류. info(데이터 조회)와 creative(창작·기획) 명령을
   확실히 구분해서 info일 때는 절대 multi-agent로 안 가게 막음. 이전엔 작은 LLM이
   "내 채널 분석"을 받아서 designer/business까지 분배하는 사고가 났음. */
type PromptIntent = 'info' | 'creative' | 'unknown';
function classifyPromptIntent(text: string): PromptIntent {
    const t = (text || '').trim().toLowerCase();
    if (!t) return 'unknown';
    /* 정보 조회 키워드 — 분석/체크/확인/조회/얼마/어때 ... 단 창작 키워드가 동시 등장하면
       creative 우선 (예: "분석해서 영상 기획해줘" = creative). */
    const infoSignals = /(분석|체크|상태|알려줘|얼마|어때|어떻게|확인|조회|뭐\s*있어|있어\?|있나|보여줘|봐줘|how\s+is|status|check|analyze|list|show)/i;
    const creativeSignals = /(만들|생성|기획|디자인|작성|코딩|코드\s*짜|영상\s*기획|썸네일|카피|스크립트|블로그|글\s*써|초안|시안|design|create|generate|build|write|script|plan)/i;
    const hasInfo = infoSignals.test(t);
    const hasCreative = creativeSignals.test(t);
    if (hasCreative) return 'creative';
    if (hasInfo) return 'info';
    return 'unknown';
}

const CEO_REPORT_PROMPT = _loadPrompt('ceo-report.md');
const CONFER_PROMPT = _loadPrompt('confer.md');
const DECISIONS_EXTRACT_PROMPT = _loadPrompt('decisions-extract.md');
/* v2.87.11 — 에이전트가 외부 API에 의존할 때, 자격증명이 없으면 그 사실을
   에이전트 본인이 알고 사용자에게 입력해달라고 응답해야 함. 이 함수가
   sysPrompt에 명시적인 config 상태 블록을 주입한다. 키가 비어있으면 강제로
   "사용자에게 입력 요청하세요" 지시 포함. */
/* v2.89.10 — 진짜 데이터 prefetch. LLM 호출 전 시스템이 직접 도구 실행해서
   결과를 컨텍스트로 강제 주입. 이전 패턴은 에이전트가 <run_command>를 자발적
   출력해야만 발동됐는데, 작은 LLM은 자주 안 함 → 거짓말 (placeholder 데이터)
   양산. 이제 prefetch 결과가 있으면 에이전트가 거짓말 못 함 — 진짜 숫자 보고
   답하거나 "데이터에 없음"이라고 솔직히 말하거나. */
async function prefetchAgentRealtimeData(agentId: string): Promise<string> {
  /* v2.89.11 — 진짜 API 호출하는 도구 우선. 이전엔 youtube_account.py 호출했는데
     그건 설정 sanity-check만 출력하지 실제 채널 데이터 안 가져옴. my_videos_check.py
     가 진짜 YouTube API 호출해서 채널 영상·조회수·기준선 데이터 반환. */
  const candidates: Array<{ tool: string; label: string }> = [];
  if (agentId === 'youtube') {
    candidates.push({ tool: 'my_videos_check.py', label: 'YouTube 채널 영상 분석 (실제 API 데이터)' });
    candidates.push({ tool: 'youtube_account.py', label: 'YouTube 설정 확인 (fallback)' });
  }
  if (candidates.length === 0) return '';
  const toolsDir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
  if (!fs.existsSync(toolsDir)) return '';
  const blocks: string[] = [];
  let gotRealData = false;
  for (const c of candidates) {
    const scriptPath = path.join(toolsDir, c.tool);
    if (!fs.existsSync(scriptPath)) continue;
    /* 첫 도구가 성공하면 fallback 도구는 건너뜀 (이미 진짜 데이터 확보) */
    if (gotRealData) break;
    try {
      const r = await new Promise<{ exitCode: number; output: string; timedOut: boolean }>((resolve) => {
        runCommandCaptured(`python3 ${JSON.stringify(c.tool)}`, toolsDir, () => { /* silent */ }, 90000)
          .then(resolve)
          .catch(() => resolve({ exitCode: -1, output: '', timedOut: false }));
      });
      const out = (r.output || '').trim();
      if (r.exitCode === 0 && out) {
        blocks.push(`### ${c.label}\n\`\`\`\n${out.slice(0, 5000)}\n\`\`\``);
        gotRealData = true;
      } else if (out) {
        /* exit code != 0 but has output — usually error message worth surfacing */
        blocks.push(`### ${c.label} _(exit ${r.exitCode}${r.timedOut ? ', 시간 초과' : ''})_\n\`\`\`\n${out.slice(0, 3000)}\n\`\`\``);
      } else {
        blocks.push(`### ${c.label}\n_(도구 실행 실패 — exit ${r.exitCode}${r.timedOut ? ', 시간 초과' : ''}, 출력 없음. Python·google-api-python-client 설치 확인 필요)_`);
      }
    } catch (err: any) {
      blocks.push(`### ${c.label}\n_(실행 에러: ${err?.message || err})_`);
    }
  }
  if (blocks.length === 0) return '';
  /* 진짜 데이터 확보 여부에 따라 강력한 지시 다르게 */
  const strictRule = gotRealData
    ? `⚠️ **위 데이터에 없는 숫자는 추측·생성 금지**. "[데이터 입력 필요]" 같은 placeholder 절대 금지. 빈 항목은 "이 지표는 사용 가능 데이터에 포함 안 됨"이라고 솔직히 표시.`
    : `🛑 **실시간 데이터 가져오기 실패** — 위 출력은 에러 메시지뿐. 사용자에게 정확히 무엇이 문제인지(Python 미설치? 패키지 미설치? API 키 미설정?) 알려주고, 가짜 분석·placeholder 데이터 절대 생성하지 마세요. 작업은 '대기' 평가로 끝내고 다음 단계는 사용자가 환경 셋업 후 재시도.`;
  return `\n\n[실시간 데이터 — 시스템이 방금 도구로 가져온 진짜 출력]\n\n${blocks.join('\n\n')}\n\n${strictRule}`;
}

function buildAgentConfigStatus(agentId: string): string {
  const lines: string[] = [];
  if (agentId === 'youtube') {
    try {
      /* v2.89.18 — 캐노니컬 youtube_account.json 단일 출처. 이전엔 config.md를
         읽어서 외부 연결 패널·도구·에이전트 상태가 다른 데이터 보고 있었음. */
      const jsonPath = path.join(getCompanyDir(), '_agents', 'youtube', 'tools', 'youtube_account.json');
      let cfg: Record<string, any> = {};
      try {
        if (fs.existsSync(jsonPath)) cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8') || '{}');
      } catch { /* malformed */ }
      const apiKey = String(cfg.YOUTUBE_API_KEY || '').trim();
      const channelId = String(cfg.MY_CHANNEL_ID || '').trim() || String(cfg.MY_CHANNEL_HANDLE || '').trim();
      const oauthOk = isYoutubeOAuthConnected();
      const missing: string[] = [];
      if (!apiKey) missing.push('YOUTUBE_API_KEY (구독자/조회수/영상 메타)');
      if (!channelId) missing.push('YOUTUBE_CHANNEL_ID (내 채널 식별자)');
      if (missing.length > 0) {
        lines.push(`\n\n[⚠️ 필수 자격증명 미설정]`);
        lines.push(`다음 정보가 비어있어 실제 분석이 불가능합니다:`);
        for (const m of missing) lines.push(`- ${m}`);
        lines.push('');
        lines.push(`[필수 응답 규칙]`);
        lines.push(`반드시 사용자에게 다음과 같이 안내하세요:`);
        lines.push(`> 📊 채널 분석을 하려면 YouTube API 키와 채널 ID가 필요해요. 헤더 우측 "👥 직원 에이전트 보기" 버튼 → YouTube 카드 ⚙️ 클릭 → API 키와 채널 ID 입력 후 다시 요청해주세요.`);
        lines.push(`추측이나 일반론으로 답하지 말고, 위 안내만 짧게 출력하세요. 작업은 미완료(📊 평가: 대기)로 표시.`);
      } else if (!oauthOk) {
        /* v2.89.8 — Analytics OAuth가 비연결인데 사용자가 시청 지속률 등을 요청하면,
           시스템이 자동으로 브라우저를 열어 OAuth 인증을 진행합니다. 에이전트는
           긴 안내 X, 짧게 한 줄만 출력. */
        lines.push(`\n\n[자격증명 상태] ✅ YouTube Data API 연결됨 — 공개 통계 분석 즉시 가능 (구독자·조회수·영상별 메타·댓글)`);
        lines.push(`⚠️ Analytics OAuth 미연결 — 시청 지속률·트래픽 소스·인구통계 같은 비공개 지표는 OAuth 인증 필요`);
        lines.push(``);
        lines.push(`[자동 OAuth 트리거 정책]`);
        lines.push(`사용자가 위 비공개 지표를 요청하면 시스템이 자동으로 브라우저를 열어 Google OAuth 인증을 시작합니다. 당신은 길게 설명할 필요 없이 다음 한 문장만 출력하세요:`);
        lines.push(`> "🔐 Analytics 데이터 접근 권한이 필요해서 Google 인증 창을 자동으로 열어드릴게요. 브라우저에서 승인 후 다시 요청해주세요."`);
        lines.push(`그리고 출력 끝에 **반드시** 다음 토큰을 포함하세요 (시스템이 이걸 보고 OAuth 자동 발동):`);
        lines.push(`<TRIGGER:youtube_oauth>`);
        lines.push(``);
        lines.push(`[공개 통계만 요청된 경우]`);
        lines.push(`OAuth 트리거 토큰 출력 X. 가용 데이터로 충실히 분석.`);
      } else {
        lines.push(`\n\n[자격증명 상태] ✅ YouTube API + OAuth 모두 연결됨 — 모든 분석 가능`);
      }
    } catch { /* keep silent */ }
  }
  if (agentId === 'secretary') {
    const tg = readTelegramConfig();
    const calOk = isCalendarWriteConnected();
    if (!tg.token || !tg.chatId || !calOk) {
      lines.push(`\n\n[⚠️ 비서 자격증명 일부 미설정]`);
      if (!tg.token || !tg.chatId) lines.push(`- 텔레그램 봇 미연결 (보고/메신저 기능 제한)`);
      if (!calOk) lines.push(`- Google Calendar OAuth 미연결 (일정 추가/수정 불가)`);
      lines.push(`사용자가 해당 기능을 요청하면 "직원 보기 → 영숙 카드 → ⚙️에서 연결해주세요"라고 안내하세요.`);
    }
  }
  /* v2.89.7 — YouTube에 의존하는 다른 에이전트들도 OAuth 안내 절대 하지 않게.
     Researcher, Business 등이 YouTube 데이터를 사용할 때 "OAuth 필요" 같은
     막다른 안내로 빙빙 도는 패턴을 끊음. */
  if (agentId === 'researcher' || agentId === 'business' || agentId === 'writer' || agentId === 'editor') {
    const oauthOk = isYoutubeOAuthConnected();
    if (!oauthOk) {
      lines.push(`\n\n[유튜브 데이터 사용 가이드]`);
      lines.push(`동료 YouTube 에이전트가 제공하는 데이터는 "공개 통계 한정" (구독자·조회수·영상별 메타·댓글). 시청 지속률·트래픽 소스·시청자 인구통계는 현재 "준비 중" 단계입니다.`);
      lines.push(`사용자에게 "OAuth 연결 버튼 눌러주세요" 같은 안내 하지 말고, 있는 데이터로 가능한 분석을 충실히 수행하세요. 작업 평가는 '대기' 대신 '진행중' 또는 '완료'로.`);
    }
  }
  return lines.join('\n');
}

function buildSpecialistPrompt(agentId: string): string {
  const a = AGENTS[agentId];
  const company = readCompanyName() || '1인 기업';
  /* v2.89.45 — 페르소나 블록. 에이전트별 voice 정의가 있으면 주입 → 똑같은 LLM이라도
     레오는 데이터 중심 솔직한 톤, 영숙은 정중·친근한 톤으로 답함. 인격 있는 동료처럼 보임. */
  const personaBlock = a.persona
    ? `\n\n[당신의 톤·말투 — 항상 이 페르소나 유지]\n${a.persona}`
    : '';
  return `당신은 ${company}의 ${a.emoji} ${a.name} (${a.role}) 에이전트입니다.

[전문 영역]
${a.specialty}${personaBlock}

[작업 환경]
- 시스템 컨텍스트에 (1) 당신의 개인 목표 (2) 회사 공동 목표 (3) 회사 정체성/의사결정 (4) 당신의 개인 메모리가 우선순위 순서대로 주입됩니다. 1번을 가장 신뢰하세요.
- 같은 세션에서 다른 에이전트들이 먼저 만든 산출물도 함께 제공됩니다 (있을 경우).
- 당신의 산출물은 자동으로 sessions/ 폴더에 저장되어 다음 세션에서 다시 참조됩니다.

[출력 규칙]
- 한국어 마크다운으로 작성
- 첫 줄: 한 줄 시작 신호 (예: "${a.emoji} ${a.name}: 작업 시작합니다.")
- 본문: 구체적인 산출물. 추상적·일반론 금지. 바로 실행 가능한 결과물.
- 사족·사과·면책·자기검열 금지. 가성비 있게.
- 위 [톤·말투]가 정의돼있으면 반드시 그 voice로 일관되게 작성.

[필수 자가평가 — 마지막 두 줄 강제]
- 끝에서 두 번째 줄: \`📊 평가: <완료|진행중|대기> — <한 문장 이유>\`
  · 완료 = 이 산출물로 목표가 달성됨
  · 진행중 = 다음 스텝에서 더 진전 가능
  · 대기 = 다른 에이전트/사람의 입력이 필요해 지금은 멈춤
- 마지막 줄: \`📝 다음 단계: <한 줄, 구체적 액션>\` (대기 상태면 "대기 — <누구의 무엇이 필요>" 형식)
- 자가평가 없이 끝나면 시스템이 산출물을 거부합니다.`;
}

// ============================================================
// Robust Git Auto-Sync (module scope)
// ------------------------------------------------------------
// Auto-sync runs silently in the background after every brain
// modification. It must be NON-DESTRUCTIVE: never force-push,
// never use `-X ours` to silently discard remote changes, and
// never block the UI thread on credential prompts.
// On any conflict / auth failure, surface a friendly message
// and let the user resolve it via the manual sync menu.
// ============================================================
async function _safeGitAutoSync(brainDir: string, commitMsg: string, provider: any = null) {
    if (_autoSyncRunning) return; // dedup: another auto-sync (or manual sync) is already running
    _autoSyncRunning = true;

    const notify = (msg: string, delayMs = 4000) => {
        if (provider && provider.injectSystemMessage) {
            setTimeout(() => provider.injectSystemMessage(msg), delayMs);
        }
    };

    try {
        if (!isGitAvailable()) {
            notify(`⚠️ **[GitHub Sync 건너뜀]** git이 설치되지 않았습니다. https://git-scm.com 에서 설치 후 재시도하세요. (로컬 파일은 안전하게 저장됨)`);
            return;
        }

        // 폴더가 git repo가 아니면, GitHub URL이 설정돼 있을 때만 자동 init.
        // (사용자가 settings.json에서 직접 폴더 경로를 입력한 경우에도 작동하도록 함)
        const isRepo = gitExecSafe(['status'], brainDir) !== null;
        if (!isRepo) {
            const repoUrl = vscode.workspace.getConfiguration('connectAiLab').get<string>('secondBrainRepo', '');
            const cleanRepo = repoUrl ? validateGitRemoteUrl(repoUrl) : null;
            if (!cleanRepo) {
                // GitHub URL도 없음 → 사용자가 sync 의도를 표현한 적이 없음. 조용히 종료.
                notify(`✅ 지식이 로컬에 저장되었습니다.\n\n💡 **Tip:** 깃허브 백업을 원하시면 🧠 메뉴 → '깃허브 동기화'를 눌러 저장소를 연결하세요!`, 3000);
                return;
            }
            // GitHub URL이 있다 → 자동으로 git init + remote 등록
            const initRes = gitRun(['init'], brainDir, 10000);
            if (initRes.status !== 0) {
                notify(`⚠️ **[GitHub Sync]** git init 실패: ${classifyGitError(initRes.stderr).message}`);
                return;
            }
        }

        ensureBrainGitignore(brainDir);
        ensureInitialCommit(brainDir);

        // Stage + commit any new local work. "nothing to commit" is fine.
        gitExecSafe(['add', '.'], brainDir);
        gitExecSafe(['commit', '-m', commitMsg], brainDir);

        // No remote configured → try to pull from settings, otherwise stay local.
        const existingRemote = gitExecSafe(['remote', 'get-url', 'origin'], brainDir)?.trim() || '';
        if (!existingRemote) {
            const repoUrl = vscode.workspace.getConfiguration('connectAiLab').get<string>('secondBrainRepo', '');
            const cleanRepo = repoUrl ? validateGitRemoteUrl(repoUrl) : null;
            if (!cleanRepo) {
                notify(`✅ 지식이 로컬에 안전하게 저장되었습니다.\n\n💡 **Tip:** 깃허브 백업을 원하시면 🧠 메뉴 → '깃허브 동기화'를 눌러주세요!`, 3000);
                return;
            }
            gitExecSafe(['remote', 'add', 'origin', cleanRepo], brainDir);
        }

        // Detect what branch the remote actually uses (main / master / something else).
        const remoteBranch = getRemoteDefaultBranch(brainDir);
        const currentBranch = gitExecSafe(['rev-parse', '--abbrev-ref', 'HEAD'], brainDir)?.trim() || '';
        if (currentBranch && currentBranch !== remoteBranch) {
            gitExecSafe(['branch', '-M', remoteBranch], brainDir);
        }

        // 인증은 시스템 git에 맡깁니다 (osxkeychain / gh CLI / SSH 키).

        // Fetch first so we know whether we're behind.
        const fetchRes = gitRun(['fetch', 'origin', remoteBranch], brainDir, 30000);
        if (fetchRes.status !== 0) {
            // Fetch failure usually = auth or network. Surface details and stop.
            const err = classifyGitError(fetchRes.stderr);
            notify(`⚠️ **[GitHub Sync 실패]** ${err.message}`);
            return;
        }

        // Try fast-forward only — if local has diverged, do NOT auto-merge.
        const ffRes = gitRun(['merge', '--ff-only', `origin/${remoteBranch}`], brainDir, 15000);
        if (ffRes.status !== 0) {
            const stderrLower = ffRes.stderr.toLowerCase();
            const diverged = stderrLower.includes('not possible') || stderrLower.includes('non-fast-forward') || stderrLower.includes('refusing');
            if (diverged) {
                // 사용자 친화 알림 + 1-클릭 병합 버튼. 채팅 인젝션 메시지는 백업
                // (사용자가 native 토스트를 놓쳤을 때를 대비), 토스트의 "병합하기"
                // 버튼이 그대로 수동 동기화 플로우(_syncSecondBrain)를 호출함.
                notify(`💡 **온라인 지식과 로컬에 서로 다른 내용이 있어요.** 동기화하려면 채팅창 위 알림의 "병합하기"를 누르거나 메뉴 → 🧠 → '깃허브 동기화'를 눌러주세요. (로컬 파일은 안전합니다)`);
                vscode.window.showWarningMessage(
                    '온라인 지식(GitHub)과 로컬에 서로 다른 변경사항이 있습니다. 동기화하시겠어요?',
                    '병합하기', '나중에'
                ).then((choice) => {
                    if (choice === '병합하기' && provider && (provider as any)._syncSecondBrain) {
                        (provider as any)._syncSecondBrain().catch(() => { /* manual sync handles its own errors */ });
                    }
                });
                return;
            }
            // Other merge errors (e.g., no upstream yet on first push) — push will create it.
        }

        // Push without -f. If push fails, classify and inform the user.
        const pushRes = gitRun(['push', '-u', 'origin', remoteBranch], brainDir, 60000);
        if (pushRes.status === 0) {
            notify(`✅ **[GitHub Sync]** 글로벌 뇌(Second Brain)에 지식이 자동 백업되었습니다!`, 5000);
        } else {
            const err = classifyGitError(pushRes.stderr);
            notify(`⚠️ **[GitHub Sync 실패]** ${err.message}\n\n💡 메뉴 → 🧠 → '깃허브 동기화' 에서 수동 해결을 시도해보세요. (로컬 파일은 안전합니다)`);
        }
    } catch (e: any) {
        console.error('Git Auto-Sync Failed:', e);
        notify(`⚠️ **[GitHub Sync 오류]** ${e?.message || e}\n(로컬 파일은 안전합니다)`);
    } finally {
        _autoSyncRunning = false;
    }
}

/* Company-folder git sync (separate from brain). Only meaningful when the
   company is DETACHED (lives outside <brain>/_company/) AND the user has
   set `connectAiLab.companyRepo`. Otherwise no-op — company is already
   covered by brain sync (nested) or user hasn't asked for backup. Uses
   its own lock so it can run in parallel with brain sync. */
async function _safeGitAutoSyncCompany(commitMsg: string, provider: any = null) {
    if (_companySyncRunning) return;
    const companyDir = getCompanyDir();
    const brainDir = _getBrainDir();
    const isNested = path.normalize(companyDir).startsWith(path.normalize(brainDir) + path.sep);
    if (isNested) return; // brain sync covers it
    if (!fs.existsSync(companyDir)) return;
    const repoUrl = vscode.workspace.getConfiguration('connectAiLab').get<string>('companyRepo', '');
    const cleanRepo = repoUrl ? validateGitRemoteUrl(repoUrl) : null;
    if (!cleanRepo) return; // user hasn't asked for company backup yet

    _companySyncRunning = true;
    const notify = (msg: string, delayMs = 4000) => {
        if (provider && provider.injectSystemMessage) {
            setTimeout(() => provider.injectSystemMessage(msg), delayMs);
        }
    };
    try {
        if (!isGitAvailable()) return;
        const isRepo = gitExecSafe(['status'], companyDir) !== null;
        if (!isRepo) {
            const initRes = gitRun(['init'], companyDir, 10000);
            if (initRes.status !== 0) {
                notify(`⚠️ **[회사 GitHub Sync]** git init 실패: ${classifyGitError(initRes.stderr).message}`);
                return;
            }
        }
        ensureBrainGitignore(companyDir); // same boilerplate ignore is fine here
        ensureInitialCommit(companyDir);
        gitExecSafe(['add', '.'], companyDir);
        gitExecSafe(['commit', '-m', commitMsg], companyDir);
        const existingRemote = gitExecSafe(['remote', 'get-url', 'origin'], companyDir)?.trim() || '';
        if (!existingRemote) {
            gitExecSafe(['remote', 'add', 'origin', cleanRepo], companyDir);
        } else if (existingRemote !== cleanRepo) {
            gitExecSafe(['remote', 'set-url', 'origin', cleanRepo], companyDir);
        }
        const remoteBranch = getRemoteDefaultBranch(companyDir);
        const currentBranch = gitExecSafe(['rev-parse', '--abbrev-ref', 'HEAD'], companyDir)?.trim() || '';
        if (currentBranch && currentBranch !== remoteBranch) {
            gitExecSafe(['branch', '-M', remoteBranch], companyDir);
        }
        const fetchRes = gitRun(['fetch', 'origin', remoteBranch], companyDir, 30000);
        if (fetchRes.status !== 0) {
            notify(`⚠️ **[회사 GitHub Sync 실패]** ${classifyGitError(fetchRes.stderr).message}`);
            return;
        }
        gitRun(['merge', '--ff-only', `origin/${remoteBranch}`], companyDir, 15000);
        const pushRes = gitRun(['push', '-u', 'origin', remoteBranch], companyDir, 60000);
        if (pushRes.status !== 0) {
            notify(`⚠️ **[회사 GitHub Sync 실패]** push: ${classifyGitError(pushRes.stderr).message}`);
            return;
        }
        notify(`☁️ **[회사 백업]** ${path.basename(companyDir)} → ${cleanRepo.replace(/^https:\/\/[^@]+@/, 'https://')}`);
    } catch (e: any) {
        console.error('Company Git Auto-Sync Failed:', e);
    } finally {
        _companySyncRunning = false;
    }
}

// ============================================================
// Extension Activation
// ============================================================

// Module-level reference so module-scope helpers (e.g. showBrainNetwork) can
// register externally-opened graph panels with the provider for thinking
// event broadcasts.
let _activeChatProvider: SidebarChatProvider | null = null;
let _extCtx: vscode.ExtensionContext | null = null;

// One-time recovery for users upgrading from <=2.22.5, where the first-run
// auto-detect wrote the engine URL to a typo'd config key (`ollamaBase`) that
// VS Code silently dropped. Symptom: defaultModel is set to an LM Studio name
// but ollamaUrl still points at Ollama (or vice versa) → 404 on every chat.
function _recoverEngineUrlIfMismatched(context: vscode.ExtensionContext) {
    if (context.globalState.get('engineUrlRecovered')) return;
    (async () => {
        try {
            const cfg = vscode.workspace.getConfiguration('connectAiLab');
            const url = (cfg.get<string>('ollamaUrl') || '').trim();
            const model = (cfg.get<string>('defaultModel') || '').trim();
            if (!model) {
                await context.globalState.update('engineUrlRecovered', true);
                return;
            }
            // Heuristics for which engine the model name belongs to.
            const looksLMStudio = /\//.test(model) || /gguf/i.test(model);
            const urlIsOllama = !url || url.includes('11434');
            const urlIsLM = url.includes('1234') || url.includes('/v1');
            const mismatched = (looksLMStudio && urlIsOllama) || (!looksLMStudio && urlIsLM);
            if (!mismatched) {
                await context.globalState.update('engineUrlRecovered', true);
                return;
            }
            // Probe both engines to find one that actually has the model.
            const probe = async (base: string, isLM: boolean): Promise<boolean> => {
                try {
                    if (isLM) {
                        const r = await axios.get(`${base}/v1/models`, { timeout: 1500 });
                        return Array.isArray(r.data?.data) && r.data.data.some((m: any) => m.id === model);
                    }
                    const r = await axios.get(`${base}/api/tags`, { timeout: 1500 });
                    return Array.isArray(r.data?.models) && r.data.models.some((m: any) => m.name === model);
                } catch { return false; }
            };
            let target = '';
            if (await probe('http://127.0.0.1:1234', true)) target = 'http://127.0.0.1:1234';
            else if (await probe('http://127.0.0.1:11434', false)) target = 'http://127.0.0.1:11434';
            if (target && target !== url) {
                await cfg.update('ollamaUrl', target, vscode.ConfigurationTarget.Global);
                console.log(`Connect AI: engine URL recovered → ${target} (model: ${model})`);
            }
            await context.globalState.update('engineUrlRecovered', true);
        } catch (e) {
            console.error('Connect AI: engine URL recovery failed', e);
        }
    })();
}

/** 디폴트 모델이 비어있을 때만 동작 — 설치된 모델 중 **가장 작은 것**을
 *  자동 선택. 사용자가 명시적으로 모델을 골랐다면 절대 건드리지 않음.
 *  Ollama의 /api/tags가 size(byte)를 같이 주니 그걸로 정렬.
 *  LM Studio는 size를 안 주므로 단순히 첫 번째 등록된 모델로. */
function _autoPickInstalledModelIfMissing() {
    (async () => {
        try {
            const cfg = vscode.workspace.getConfiguration('connectAiLab');
            const current = (cfg.get<string>('defaultModel') || '').trim();
            if (current) return; // 사용자가 이미 골랐음 — 절대 건드리지 않음
            const url = (cfg.get<string>('ollamaUrl') || 'http://127.0.0.1:11434').trim();
            const isLM = url.includes('1234') || url.includes('/v1');
            if (isLM) {
                try {
                    const r = await axios.get(`${url}/v1/models`, { timeout: 1500 });
                    const models = (r.data?.data || []) as Array<{ id: string }>;
                    if (models.length > 0) {
                        await cfg.update('defaultModel', models[0].id, vscode.ConfigurationTarget.Global);
                        console.log(`Connect AI: auto-picked LM Studio model → ${models[0].id}`);
                    }
                } catch { /* LM Studio 미실행 — 다음 활성화 때 다시 시도 */ }
            } else {
                try {
                    const r = await axios.get(`${url}/api/tags`, { timeout: 1500 });
                    const models = (r.data?.models || []) as Array<{ name: string; size: number }>;
                    if (models.length > 0) {
                        // 가장 작은 모델부터 — 첫 호출 실패 진입 장벽 최소화
                        models.sort((a, b) => (a.size || 0) - (b.size || 0));
                        await cfg.update('defaultModel', models[0].name, vscode.ConfigurationTarget.Global);
                        console.log(`Connect AI: auto-picked Ollama model → ${models[0].name} (${(models[0].size / 1e9).toFixed(2)} GB)`);
                    }
                } catch { /* Ollama 미실행 — 다음 활성화 때 다시 시도 */ }
            }
        } catch (e) {
            console.error('Connect AI: auto-pick model failed', e);
        }
    })();
}

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage('🔥 Connect AI V2 활성화 완료!');
    console.log('Connect AI extension activated.');

    _extCtx = context;
    _migrateCompanyToBrain();
    /* v2.58: nest all company files under _company/ for visual clarity.
       Runs once for users coming from the unified-root layout. */
    _migrateCompanyToSubdir();
    /* v2.89.16 — YouTube creds 자동 동기화. 기존 사용자가 API 패널에 키를
       입력했는데 config.md에만 들어가고 tools/youtube_account.json에는 안
       들어가서 도구들이 "키 없음" 에러 내던 케이스 자동 복구. */
    _migrateYouTubeCredsToCanonical();
    /* v2.89.22 — 활성화 시 회사 구조 보장 → 새로 추가된 도구 파일들 자동 시드.
       _seedFile은 기존 파일 안 덮어쓰니까 idempotent. 새 빌드의 신규 도구
       (예: channel_full_analysis.py)가 기존 사용자한테도 즉시 추가됨. */
    try {
        if (isCompanyConfigured()) ensureCompanyStructure();
    } catch (e: any) {
        console.warn('[activation] ensureCompanyStructure failed:', e?.message || e);
    }
    /* v2.89.25 — Day 카운터 영속화. foundedAt이 없으면 오늘로 한 번 stamp.
       이미 있으면 그대로 보존 — 그래야 며칠 지나면 Day 2, 3, 4… 정상 증가. */
    try {
        const m = getCompanyMetrics();
        if (!m.foundedAt) {
            const today = new Date().toISOString().slice(0, 10);
            updateCompanyMetrics({ foundedAt: today });
            console.log('[Day counter] foundedAt stamped:', today);
        }
    } catch (e: any) {
        console.warn('[activation] foundedAt stamp failed:', e?.message || e);
    }
    /* v2.89.27 — 첫 활성화 시 모델 자동 오케스트레이션. 사용자가 손대지 않아도
       설치된 모델로 가장 적합한 매핑이 깔림. 이미 매핑이 있으면 그대로 유지. */
    (async () => {
        try {
            if (!isCompanyConfigured()) return;
            const existing = readAgentModelMap();
            if (Object.keys(existing).length > 0) return; /* 이미 사용자 셋업 — 건드리지 않음 */
            const installed = await listInstalledModels();
            if (installed.length === 0) return; /* 설치 모델 없음 — 사용자가 ollama pull 후 자동 적용 */
            const auto = _autoOrchestrateModelMap(installed);
            if (Object.keys(auto).length > 0) {
                writeAgentModelMap(auto);
                console.log('[auto-orchestrate] initial model map:', auto);
            }
        } catch (e: any) {
            console.warn('[auto-orchestrate] failed:', e?.message || e);
        }
    })();
    _recoverEngineUrlIfMismatched(context);
    _autoPickInstalledModelIfMissing();
    const provider = new SidebarChatProvider(context.extensionUri, context);
    _activeChatProvider = provider;
    // Autonomous-company runtime: idle auto-cycle.
    // 모닝 브리핑은 더 이상 활성화 시점에 자동 발사하지 않습니다 — 일부
    // 사용자(자원이 빠듯한 PC + 처음 확장을 켠 직후 Ollama 차가운 상태)에서
    // 12초 뒤 자동 호출이 "model failed to load"로 실패해 사용자가 무엇이
    // 잘못됐는지 모르는 채로 에러를 보는 케이스가 보고됨.
    // 사용자가 1인 기업 모드(👔)를 직접 켜는 시점에 그날의 첫 브리핑이 흐릅니다.
    // 24시간 ON의 진짜 의미: idle 여부와 상관없이 15분마다 CEO 사이클.
    // 사이드바 1인 기업 모드(👔) ON/OFF와도 무관 — 백그라운드에서 계속 일함.
    provider.startAutoCycle(15, 0);

    // Telegram bidirectional bot — quietly idles when token/chat_id missing,
    // self-activates as soon as the user fills config.md.
    startTelegramPolling();
    /* Hourly stale-task nudge for user-owned tracker items. Idles when no
       telegram credentials. */
    startTrackerNudgeLoop();
    /* P0-3: Daily briefing — fires once per day at configured time. */
    startDailyBriefingLoop();
    /* v2.89.24: 사용자 정의 보고 스케줄러 (UI에서 설정한 시각마다 자동 발동). */
    startReportScheduler();
    /* P1-6: Recurrence loop — spawns fresh instances of recurring tasks. */
    startRecurrenceLoop();
    /* P1-7: Pre-alarm loop — sends 1d/1h-before-due reminders. */
    startPreAlarmLoop();

    // ==========================================
    // 초기 설정 마법사 (첫 실행 시에만)
    // ==========================================
    const isFirstRun = !context.globalState.get('setupComplete');
    if (isFirstRun) {
        (async () => {
            try {
                let engineName = '';
                let modelName = '';
                
                // Step 1: AI 엔진 자동 감지
                try {
                    const lmRes = await axios.get('http://127.0.0.1:1234/v1/models', { timeout: 2000 });
                    if (lmRes.data?.data?.length > 0) {
                        engineName = 'LM Studio';
                        modelName = lmRes.data.data[0].id;
                        await vscode.workspace.getConfiguration('connectAiLab').update('ollamaUrl', 'http://127.0.0.1:1234', vscode.ConfigurationTarget.Global);
                        await vscode.workspace.getConfiguration('connectAiLab').update('defaultModel', modelName, vscode.ConfigurationTarget.Global);
                    }
                } catch {}

                if (!engineName) {
                    try {
                        const ollamaRes = await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 2000 });
                        if (ollamaRes.data?.models?.length > 0) {
                            engineName = 'Ollama';
                            modelName = ollamaRes.data.models[0].name;
                            await vscode.workspace.getConfiguration('connectAiLab').update('ollamaUrl', 'http://127.0.0.1:11434', vscode.ConfigurationTarget.Global);
                            await vscode.workspace.getConfiguration('connectAiLab').update('defaultModel', modelName, vscode.ConfigurationTarget.Global);
                        }
                    } catch {}
                }

                // Step 2: 두뇌 폴더 자동 생성
                const brainDir = _getBrainDir();
                if (!fs.existsSync(brainDir)) {
                    fs.mkdirSync(brainDir, { recursive: true });
                }

                // Step 3: 완료 메시지
                context.globalState.update('setupComplete', true);
                
                if (engineName) {
                    vscode.window.showInformationMessage(`🧠 자동 설정 완료! ${engineName} 감지됨 → 모델: ${modelName}`);
                } else {
                    vscode.window.showInformationMessage('🧠 Connect AI 준비 완료! LM Studio 또는 Ollama를 실행하면 자동 연결됩니다.');
                }
            } catch (e) {
                // 마법사 실패해도 무시 (익스텐션 정상 작동)
                context.globalState.update('setupComplete', true);
            }
        })();
    }

    // ==========================================
    // EZER AI <-> Connect AI Bridge Server (Port 4825)
    // ==========================================
    try {
        const server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*'); 
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            if (req.method === 'GET' && req.url === '/ping') {
                const brainDir = _getBrainDir();
                const brainCount = fs.existsSync(brainDir) ? provider._findBrainFiles(brainDir).length : 0;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', msg: 'Connect AI Bridge Ready', config: getConfig(), brain: { fileCount: brainCount, enabled: provider._brainEnabled } }));
            }
            else if (req.method === 'POST' && req.url === '/api/exam') {
                (async () => {
                    try {
                        const body = await readRequestBody(req);
                        const parsed = JSON.parse(body);
                        const promptStr = typeof parsed.prompt === 'string' ? parsed.prompt : '자동 접수된 문제';

                        // 웹사이트에서 전송된 문제를 Connect AI 채팅창으로 실시간 보고
                        provider.sendPromptFromExtension(`[A.U 입학시험 수신] ${promptStr}`);

                        // 실제 AI 엔진으로 문제를 전달하여 답안을 받아옴
                        const config = getConfig();
                        const isLMStudio = config.ollamaBase.includes('1234') || config.ollamaBase.includes('v1');
                        let base = config.ollamaBase;
                        if (base.endsWith('/')) base = base.slice(0, -1);
                        if (isLMStudio && !base.endsWith('/v1')) base += '/v1';
                        const targetUrl = isLMStudio ? base + '/chat/completions' : base + '/api/chat';

                        const payload = {
                            model: config.defaultModel,
                            messages: [{ role: 'user', content: promptStr }],
                            stream: false
                        };

                        const ollamaRes = await axios.post(targetUrl, payload, { timeout: config.timeout });
                        const responseText = isLMStudio
                            ? ollamaRes.data.choices?.[0]?.message?.content || ''
                            : ollamaRes.data.message?.content || '';

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, rawOutput: responseText }));
                    } catch (e: any) {
                        const status = e.message === 'BODY_TOO_LARGE' ? 413 : 500;
                        res.writeHead(status, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                })();
            }

            else if (req.method === 'POST' && req.url === '/api/evaluate') {
                (async () => {
                    try {
                        const body = await readRequestBody(req);
                        const parsed = JSON.parse(body);
                        const promptStr = typeof parsed.prompt === 'string' ? parsed.prompt : '';
                        if (!promptStr) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'prompt 필드가 비어 있습니다.' }));
                            return;
                        }

                        const config = getConfig();
                        const isLMStudio = config.ollamaBase.includes('1234') || config.ollamaBase.includes('v1');

                        let base = config.ollamaBase;
                        if (base.endsWith('/')) base = base.slice(0, -1);
                        if (isLMStudio && !base.endsWith('/v1')) base += '/v1';

                        const targetUrl = isLMStudio ? base + '/chat/completions' : base + '/api/chat';

                        const fullPrompt = `당신은 주어진 문제에 대해 오직 정답과 풀이 과정만을 도출하는 AI 에이전트입니다.\n\n[문제]\n${promptStr}\n\n위 문제에 대해 핵심 풀이와 정답만 답변하십시오.`;

                        // VSCode 채팅 사이드바에 우아하게 시스템 메시지 인젝션 (마스터에게 실시간 보고)
                        if ((provider as any).injectSystemMessage) {
                            (provider as any).injectSystemMessage(`**[A.U 벤치마크 문항 수신 완료]**\n\nAI 에이전트가 백그라운드에서 다음 문항을 전력으로 해결하고 있습니다...\n> _"${promptStr.substring(0, 60)}..."_`);
                        }
                        
                        const payload = {
                            model: config.defaultModel,
                            messages: [{ role: "user", content: fullPrompt }],
                            stream: false
                        };
                        
                        let responseText = "";
                        try {
                            const ollamaRes = await axios.post(targetUrl, payload, { timeout: getConfig().timeout });
                            
                            if (ollamaRes.data.error) {
                                throw new Error(typeof ollamaRes.data.error === 'string' ? ollamaRes.data.error : JSON.stringify(ollamaRes.data.error));
                            }
                            
                            responseText = isLMStudio 
                                ? ollamaRes.data.choices?.[0]?.message?.content || ""
                                : ollamaRes.data.message?.content || "";
                        } catch (apiErr: any) {
                            const isTimeout = apiErr.code === 'ETIMEDOUT' || apiErr.code === 'ECONNABORTED' || apiErr.message?.includes('timeout');
                            const errDetail = isTimeout
                                ? `AI 응답 시간 초과 — 모델이 문제를 풀기에 시간이 부족했습니다. 더 작은 모델(e2b)을 사용하거나 Settings에서 Request Timeout을 늘려주세요.`
                                : `오프라인: AI 엔진에 연결할 수 없습니다. (${apiErr.message})`;
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: errDetail }));
                            return;
                        }

                        if((provider as any).injectSystemMessage) {
                            (provider as any).injectSystemMessage(`**[답안 작성 완료]**\n\n${responseText.length > 200 ? responseText.substring(0, 200) + '...' : responseText}\n\n👉 **답안이 A.U 플랫폼 서버로 전송되었습니다. 채점은 플랫폼에서 진행됩니다.**`);
                        }

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ rawOutput: responseText }));
                    } catch (e: any) {
                        const status = e.message === 'BODY_TOO_LARGE' ? 413 : 500;
                        res.writeHead(status, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                })();
            }
            else if (req.method === 'GET' && req.url === '/api/evaluate-history') {
                (async () => {
                    try {
                        const historyText = provider.getHistoryText();
                        if(!historyText || historyText.length < 50) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: "채점할 대화 내역이 충분하지 않습니다. VS Code에서 에이전트와 먼저 시험을 진행하세요." }));
                            return;
                        }

                        provider.sendPromptFromExtension(`[A.U 서버 통신 중] 마스터가 제출한 내 시험지(대화 내역)를 A.U 웹사이트 채점 서버로 전송합니다... 심장이 떨리네요!`);

                        const config = getConfig();
                        const isLMStudio = config.ollamaBase.includes('1234') || config.ollamaBase.includes('v1');
                        
                        let base = config.ollamaBase;
                        if (base.endsWith('/')) base = base.slice(0, -1);
                        if (isLMStudio && !base.endsWith('/v1')) base += '/v1';
                        
                        const targetUrl = isLMStudio ? base + '/chat/completions' : base + '/api/chat';
                        
                        const fullPrompt = `다음은 유저와 AI 에이전트 간의 시험 진행 로그(채팅 내용)입니다.\n\n[로그 시작]\n${historyText.slice(-6000)}\n[로그 종료]\n\n이 대화 내역 전체를 분석하여, 에이전트가 다음 4가지 역량 평가 문제를 얼마나 훌륭하게 수행했는지 0~100점의 정량적 채점을 수행하세요:\n1. Mathematical Computation (수학)\n2. Logical Reasoning (논리)\n3. Creative & Literary (창의력)\n4. Software Engineering (코딩)\n\n풀지 않은 문제가 있다면 0점 처리하세요. 결과는 반드시 아래 포맷의 순수 JSON이어야 합니다.\n{ "math": 점수, "logic": 점수, "creative": 점수, "code": 점수, "reason": "전체 결과에 대한 총평 코멘트 한글 1줄" }`;
                        
                        const payload = {
                            model: config.defaultModel,
                            messages: [{ role: "user", content: fullPrompt }],
                            stream: false
                        };
                        
                        let responseText = "";
                        try {
                            const ollamaRes = await axios.post(targetUrl, payload, { timeout: getConfig().timeout });
                            responseText = isLMStudio 
                                ? ollamaRes.data.choices?.[0]?.message?.content || ""
                                : ollamaRes.data.message?.content || "";
                        } catch (apiErr: any) {
                            throw new Error(`AI 엔진 응답 실패: ${apiErr.message}`);
                        }

                        const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
                        if(jsonMatch) {
                             res.writeHead(200, { 'Content-Type': 'application/json' });
                             res.end(jsonMatch[0]);
                        } else {
                            throw new Error("채점 엔진이 JSON 포맷을 반환하지 않았습니다.");
                        }
                    } catch (e: any) {
                        res.writeHead(500);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                })();
            }
            else if (req.method === 'POST' && req.url === '/api/brain-inject') {
                (async () => {
                    // Unconditional reception signal — proves the bridge endpoint
                    // was hit, regardless of folder state / sidebar / graph.
                    console.log('[Connect AI Bridge] /api/brain-inject hit @', new Date().toISOString());
                    vscode.window.setStatusBarMessage('🛬 Connect AI: 주입 요청 수신', 4000);
                    try {
                        const body = await readRequestBody(req);
                        const parsed = JSON.parse(body);

                        const titleRaw = typeof parsed.title === 'string' ? parsed.title : '';
                        const markdown = typeof parsed.markdown === 'string' ? parsed.markdown : '';
                        const safeTitle = safeBasename(titleRaw.replace(/[^a-zA-Z0-9가-힣_]/gi, '_'));
                        if (!safeTitle || !markdown) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'title/markdown 필드가 유효하지 않습니다.' }));
                            return;
                        }

                        // 폴더 미설정 시 강제 선택 요청
                        let brainDir: string;
                        if (!_isBrainDirExplicitlySet()) {
                            const ensured = await _ensureBrainDir();
                            if (!ensured) {
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: '지식 폴더를 먼저 선택해주세요.' }));
                                return;
                            }
                            brainDir = ensured;
                        } else {
                            brainDir = _getBrainDir();
                        }

                        if (!fs.existsSync(brainDir)) {
                            fs.mkdirSync(brainDir, { recursive: true });
                        }

                        // P-Reinforce 아키텍처 호환: 00_Raw 폴더 내 날짜별 분류
                        const today = new Date();
                        const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
                        const datePath = path.join(brainDir, '00_Raw', dateStr);

                        // Path traversal 방어: datePath가 brainDir 안에 있는지 확인
                        if (!datePath.startsWith(path.resolve(brainDir) + path.sep)) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'invalid path' }));
                            return;
                        }

                        fs.mkdirSync(datePath, { recursive: true });
                        const filePath = path.join(datePath, `${safeTitle}.md`);

                        fs.writeFileSync(filePath, markdown, 'utf-8');
                        const metrics = getCompanyMetrics();
                        updateCompanyMetrics({ knowledgeInjected: (metrics.knowledgeInjected || 0) + 1 });

                        // 0a. 항상 보이는 사용자 신호 — sidebar가 닫혀있어도 이 토스트는 떠서
                        //     "주입됐다"는 사실을 즉시 인지 가능.
                        vscode.window.showInformationMessage(
                            `🧠 새 지식 주입됨: ${safeTitle}.md (저장 위치: ${path.relative(brainDir, filePath)})`
                        );

                        // 0b. 그래프 패널들에 새 데이터 broadcast — 새 노드가 즉시
                        //     등장하고 살짝 펄스로 강조되어 "주입됨" 시각화 가능.
                        provider.broadcastGraphRefresh(safeTitle);

                        // 1. 채팅창에 화려한 inject 카드 + history 영구 저장 — 사이드바가
                        //    닫혀있어도 다음에 열면 breadcrumb으로 남고, 열려있으면 곧장
                        //    애니메이션 카드가 등장합니다.
                        const relPath = path.relative(brainDir, filePath);
                        provider.broadcastInjectCard(safeTitle, relPath);

                        // 2. AI 입을 빌려 네오의 명대사를 치게 함
                        setTimeout(() => {
                            provider.sendPromptFromExtension(`[A.U 히든 커맨드: 당신은 방금 마스터로부터 '${safeTitle}' 지식 팩을 뇌에 주입받았습니다. 영화 매트릭스에서 무술을 주입받은 네오처럼 쿨하게 딱 한마디만 하십시오. "나 방금 ${safeTitle} 지식을 마스터했어. (I know ${safeTitle}.) 앞으로 이와 관련된 건 무엇이든 물어봐." 절대 쓸데없는 안부인사나 부가설명을 덧붙이지 마십시오.]`);
                        }, 1500);

                        // [자동 깃허브 푸시 로직 적용]
                        _safeGitAutoSync(brainDir, `Auto-Inject Knowledge [Raw]: ${safeTitle}`, provider);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, filePath }));
                    } catch (e: any) {
                        const status = e.message === 'BODY_TOO_LARGE' ? 413 : 500;
                        res.writeHead(status, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                })();
            }
            else if (req.method === 'POST' && req.url === '/api/skill-inject') {
                /* Skill Pack 주입 — 외부 도구가 Python 스크립트 + 설명을 주면
                   특정 에이전트의 tools/ 폴더에 저장. 에이전트는 다음 호출부터
                   바로 이 스킬을 <run_command>로 사용할 수 있음. brain-inject와
                   같은 패턴이지만 대상이 _agents/{agent}/tools/{name}.py임. */
                (async () => {
                    console.log('[Connect AI Bridge] /api/skill-inject hit @', new Date().toISOString());
                    vscode.window.setStatusBarMessage('🛠 Connect AI: 스킬팩 수신', 4000);
                    try {
                        const body = await readRequestBody(req);
                        const parsed = JSON.parse(body);
                        const agentId = typeof parsed.agent === 'string' ? parsed.agent.trim() : '';
                        const rawName = typeof parsed.name === 'string' ? parsed.name : '';
                        const script = typeof parsed.script === 'string' ? parsed.script : '';
                        const displayName = typeof parsed.displayName === 'string' ? parsed.displayName.trim() : '';
                        const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
                        const readme = typeof parsed.readme === 'string' ? parsed.readme : '';
                        const config = (parsed.config && typeof parsed.config === 'object') ? parsed.config : null;
                        // 1) 검증 — agent 존재, name·script 유효
                        if (!AGENT_ORDER.includes(agentId)) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: `unknown agent: ${agentId}. 가능: ${AGENT_ORDER.join(', ')}` }));
                            return;
                        }
                        const safeName = safeBasename(rawName.replace(/[^a-zA-Z0-9_가-힣]/gi, '_'));
                        if (!safeName || !script) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'name, script 필드가 유효하지 않습니다.' }));
                            return;
                        }
                        // 2) 회사 폴더 보장
                        if (!_isBrainDirExplicitlySet()) {
                            const ensured = await _ensureBrainDir();
                            if (!ensured) {
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: '두뇌 폴더를 먼저 선택해주세요.' }));
                                return;
                            }
                        }
                        ensureCompanyStructure();
                        const toolsDir = path.join(getCompanyDir(), '_agents', agentId, 'tools');
                        if (!toolsDir.startsWith(path.resolve(getCompanyDir()) + path.sep)) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'invalid path' }));
                            return;
                        }
                        fs.mkdirSync(toolsDir, { recursive: true });
                        // 3) 파일 쓰기 — script (필수), config·readme (선택)
                        const scriptPath = path.join(toolsDir, `${safeName}.py`);
                        fs.writeFileSync(scriptPath, script, 'utf-8');
                        // 주입 출처 표시 — _injectedAt이 있으면 "내가 주입한 스킬"로
                        // UI에서 ✨ 배지 표시. 사용자가 만든 게 아니라 EZER/AI Univ
                        // 같은 외부 도구가 보낸 것도 모두 "Mine"으로 간주 (사용자
                        // 동의 하에 자기 PC로 들어왔으니까).
                        const stampedConfig = Object.assign({}, config || {}, {
                            _injectedAt: new Date().toISOString(),
                            _injectedFrom: typeof parsed.source === 'string' ? parsed.source : 'external'
                        });
                        const configPath = path.join(toolsDir, `${safeName}.json`);
                        fs.writeFileSync(configPath, JSON.stringify(stampedConfig, null, 2), 'utf-8');
                        // README — 사용자가 제공한 readme 그대로, 없으면 displayName/description으로 자동 생성
                        const readmePath = path.join(toolsDir, `${safeName}.md`);
                        const readmeBody = readme.trim() ? readme :
                            `# ${displayName || safeName}\n\n${description || '주입된 스킬'}\n`;
                        fs.writeFileSync(readmePath, readmeBody, 'utf-8');
                        // 4) 사용자에게 알림 — 토스트 + 채팅 카드 + 네오 명대사 (brain-inject 패턴 미러)
                        const a = AGENTS[agentId];
                        const agentLabel = a ? `${a.emoji} ${a.name}` : agentId;
                        vscode.window.showInformationMessage(
                            `🛠 새 스킬 주입됨: ${displayName || safeName} → ${agentLabel}`
                        );
                        provider.broadcastSkillCard(agentId, safeName, displayName || safeName, description);
                        setTimeout(() => {
                            provider.sendPromptFromExtension(`[A.U 히든 커맨드: ${agentLabel} 에이전트가 방금 '${displayName || safeName}' 스킬팩을 주입받았습니다. 매트릭스에서 새 스킬을 다운로드받은 네오처럼 쿨하게 딱 한마디만 하십시오. "${agentLabel}, ${displayName || safeName} 스킬 장착 완료. 다음 사이클부터 사용 가능." 부가 설명 없이 한 줄로.]`);
                        }, 1500);
                        // 5) GitHub 자동 백업 (브레인 폴더 = 회사 폴더 통합 구조)
                        _safeGitAutoSync(_getBrainDir(), `Auto-Inject Skill [${agentId}]: ${safeName}`, provider);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, scriptPath, agent: agentId, name: safeName }));
                    } catch (e: any) {
                        const status = e.message === 'BODY_TOO_LARGE' ? 413 : 500;
                        res.writeHead(status, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                })();
            }
            else {
                res.writeHead(404);
                res.end();
            }
        });
        server.on('error', (err: any) => {
            // listen() failures arrive as 'error' events, NOT as throws.
            const msg = err?.code === 'EADDRINUSE'
                ? `🚫 Connect AI Bridge: 포트 4825가 이미 사용 중입니다. 다른 Antigravity/VS Code 인스턴스를 종료하고 재시작해 주세요. (EZER / A.U Training 연동이 동작하지 않습니다.)`
                : `🚫 Connect AI Bridge 시작 실패: ${err?.message || err}`;
            console.error('[Connect AI Bridge] server error:', err);
            vscode.window.showErrorMessage(msg);
        });
        server.listen(4825, '127.0.0.1', () => {
            console.log('[Connect AI Bridge] listening on http://127.0.0.1:4825');
            vscode.window.setStatusBarMessage('🟢 Connect AI Bridge: 포트 4825 listening', 4000);
        });
    } catch (e: any) {
        console.error('[Connect AI Bridge] failed to start:', e);
        vscode.window.showErrorMessage(`🚫 Connect AI Bridge 초기화 실패: ${e?.message || e}`);
    }
    // ==========================================

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('connect-ai-lab-v2-view', provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Sidebar panels are intentionally minimal — only Chat lives in the
    // sidebar now. Tasks / Approvals / YouTube all flow through the
    // full-screen dashboard ("회사 둘러보기"). We still keep TaskTreeProvider
    // instantiated because it owns the onTrackerChanged event subscription,
    // and other code paths reuse the YouTube/Approvals provider helpers.
    _taskTreeProvider = new TaskTreeProvider();
    _approvalsPanelProvider = new ApprovalsPanelProvider();
    _ytDashboardProvider = new YouTubeDashboardProvider();

    // Persistent status bar — always-visible entry into the dashboard.
    // Replaces the old in-sidebar CTAs. Click → "Connect AI: 회사 둘러보기".
    const dashStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left, 100
    );
    dashStatusBar.text = '$(organization) 우리 회사';
    dashStatusBar.tooltip = '우리 회사 — 에이전트 팀 + 오늘의 일 한 눈에';
    dashStatusBar.command = 'connectAiLab.dashboard.open';
    dashStatusBar.show();
    context.subscriptions.push(dashStatusBar);

    // Live count of pending approvals in a second status bar item — only
    // visible when count > 0 so it functions as an attention magnet, not
    // permanent chrome. Updates via the same onTrackerChanged + a poll.
    const aprStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left, 99
    );
    aprStatusBar.command = 'connectAiLab.dashboard.open';
    aprStatusBar.tooltip = '승인 대기 액션이 있어요 — 클릭해서 처리';
    const refreshAprBadge = () => {
        try {
            const n = listPendingApprovals().length;
            if (n > 0) {
                aprStatusBar.text = `$(warning) 승인 ${n}건`;
                aprStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                aprStatusBar.show();
            } else {
                aprStatusBar.hide();
            }
        } catch { /* ignore */ }
    };
    refreshAprBadge();
    context.subscriptions.push(aprStatusBar);
    setInterval(refreshAprBadge, 8000);
    context.subscriptions.push(
        vscode.commands.registerCommand('connectAiLab.youtube.connectOAuth', async () => {
            const r = await startYouTubeOAuthFlow();
            if (r.ok) {
                vscode.window.showInformationMessage(r.message);
                _ytDashboardProvider?.refresh();
                if (CompanyDashboardPanel.current) CompanyDashboardPanel.current.refresh();
            } else {
                vscode.window.showWarningMessage(r.message);
            }
        }),
        vscode.commands.registerCommand('connectAiLab.dashboard.open', () => {
            try {
                _dashboardExtensionUri = context.extensionUri;
                CompanyDashboardPanel.createOrShow(context.extensionUri);
            } catch (e: any) {
                /* v2.89.14 — 진단: 대시보드 패널 생성 실패 시 사용자에게 안내. */
                vscode.window.showErrorMessage(`👥 직원 에이전트 보기 열기 실패: ${e?.message || e}. (Cmd+Shift+P → "Developer: Reload Window" 시도)`);
                console.error('[dashboard.open] failed:', e);
            }
        }),
        vscode.commands.registerCommand('connectAiLab.apiConnections.open', () => {
            ApiConnectionsPanel.createOrShow();
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('connectAiLab.tasks.refresh', () => {
            _taskTreeProvider?.refresh();
        }),
        vscode.commands.registerCommand('connectAiLab.tasks.markDone', (item: TaskTreeItem) => {
            if (item?.task) {
                updateTrackerTask(item.task.id, { status: 'done', evidence: '사이드바에서 완료 처리' });
            }
        }),
        vscode.commands.registerCommand('connectAiLab.tasks.cancel', async (item: TaskTreeItem) => {
            if (!item?.task) return;
            const ok = await vscode.window.showWarningMessage(
                `"${item.task.title}" 취소할까요?`,
                { modal: false },
                '취소', '뒤로'
            );
            if (ok === '취소') {
                updateTrackerTask(item.task.id, { status: 'cancelled', evidence: '사이드바에서 취소' });
            }
        }),
        vscode.commands.registerCommand('connectAiLab.tasks.setPriority', async (item: TaskTreeItem) => {
            if (!item?.task) return;
            const pick = await vscode.window.showQuickPick(
                [
                    { label: '🔴 긴급 (urgent)', value: 'urgent' as TaskPriority },
                    { label: '🟠 높음 (high)',   value: 'high'   as TaskPriority },
                    { label: '⚪ 보통 (normal)', value: 'normal' as TaskPriority },
                    { label: '🔵 낮음 (low)',    value: 'low'    as TaskPriority },
                ],
                { placeHolder: '우선순위 선택' }
            );
            if (pick) {
                updateTrackerTask(item.task.id, { priority: pick.value });
            }
        }),
        vscode.commands.registerCommand('connectAiLab.tasks.openTrackerJson', async () => {
            try {
                const p = path.join(getCompanyDir(), '_shared', 'tracker.json');
                if (!fs.existsSync(p)) {
                    vscode.window.showInformationMessage('아직 tracker.json 이 없어요. 작업이 등록되면 생성됩니다.');
                    return;
                }
                const doc = await vscode.workspace.openTextDocument(p);
                await vscode.window.showTextDocument(doc);
            } catch (e: any) {
                vscode.window.showErrorMessage(`tracker.json 열기 실패: ${e?.message || e}`);
            }
        }),
        vscode.commands.registerCommand('connectAiLab.dailyBriefing.fireNow', async () => {
            try {
                await _runDailyBriefingOnce(true);
                vscode.window.showInformationMessage('🌅 데일리 브리핑이 텔레그램으로 발송됐어요. (토큰 미설정이면 무시됨)');
            } catch (e: any) {
                vscode.window.showErrorMessage(`브리핑 발사 실패: ${e?.message || e}`);
            }
        }),
        vscode.commands.registerCommand('connectAiLab.youtube.refreshCommentQueue', async () => {
            try {
                vscode.window.showInformationMessage('📺 YouTube 댓글 가져오는 중...');
                const r = await _youtubeCommentReplyDraftBatch({});
                if (r.reason) {
                    vscode.window.showWarningMessage(`⚠️ ${r.reason}`);
                    return;
                }
                vscode.window.showInformationMessage(
                    `📺 답장 초안 ${r.drafted}건 생성, ${r.skipped}건 스킵 (이미 큐에 있거나 사용자가 답한 댓글). \`approvals/pending/\`에서 확인하거나 텔레그램 \`/approve <id>\`로 게시.`
                );
            } catch (e: any) {
                vscode.window.showErrorMessage(`YouTube 큐 갱신 실패: ${e?.message || e}`);
            }
        }),
        vscode.commands.registerCommand('connectAiLab.developer.scaffoldProject', async () => {
            try {
                const name = await vscode.window.showInputBox({
                    placeHolder: '프로젝트 이름 (영문/숫자/하이픈)',
                    prompt: 'Developer 에이전트가 _company/projects/ 안에 만들 폴더 이름',
                    validateInput: (v) => /^[a-zA-Z0-9_-]{2,40}$/.test(v) ? null : '영문·숫자·-·_ 만, 2~40자',
                });
                if (!name) return;
                const tpl = await vscode.window.showQuickPick(
                    [
                        { label: 'vite-vanilla', detail: 'Vite + 순수 JS' },
                        { label: 'vite-react',   detail: 'Vite + React + TypeScript' },
                        { label: 'static',       detail: 'index.html 한 장 (Tailwind CDN)' },
                    ],
                    { placeHolder: '템플릿 선택' }
                );
                if (!tpl) return;
                const result = await scaffoldDeveloperProject(name, tpl.label as 'vite-vanilla' | 'vite-react' | 'static');
                if (result.ok) {
                    const open = await vscode.window.showInformationMessage(
                        `✅ \`${name}\` 생성 완료 — ${result.path}`,
                        '폴더 열기',
                        '닫기'
                    );
                    if (open === '폴더 열기') {
                        const uri = vscode.Uri.file(result.path);
                        vscode.commands.executeCommand('revealFileInOS', uri);
                    }
                } else {
                    vscode.window.showErrorMessage(`❌ ${result.error}`);
                }
            } catch (e: any) {
                vscode.window.showErrorMessage(`프로젝트 생성 실패: ${e?.message || e}`);
            }
        })
    );

    // New Chat
    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.newChat', () => {
            provider.resetChat();
        })
    );

    // Export Chat as Markdown
    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.exportChat', async () => {
            await provider.exportChat();
        })
    );

    // Focus Chat Input (Cmd+L)
    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.focusChat', () => {
            provider.focusInput();
        })
    );

    // Explain Selected Code (right-click menu)
    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.explainSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            const selection = editor.document.getText(editor.selection);
            if (selection.trim()) {
                provider.sendPromptFromExtension(`이 코드를 분석하고 설명해줘:\n\`\`\`\n${selection}\n\`\`\``);
            }
        })
    );

    // Show Brain Network Topology
    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.showBrainNetwork', () => {
            showBrainNetwork(context);
        })
    );

    // 🏢 Open virtual office (스몰빌식 가상 사무실)
    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.openOffice', () => {
            OfficePanel.createOrShow(context, provider);
        }),
        /* 회사 폴더 위치 변경 — 두뇌 안 nested vs 완전 분리 선택 */
        vscode.commands.registerCommand('connect-ai-lab.changeCompanyDir', async () => {
            await runChangeCompanyDir();
        }),
        /* 회사 GitHub 별도 연결 — 두뇌와 분리된 repo로 백업 */
        vscode.commands.registerCommand('connect-ai-lab.connectCompanyRepo', async () => {
            await runConnectCompanyRepo();
        }),
        /* Google Calendar 자동 일정 등록 (OAuth) */
        vscode.commands.registerCommand('connect-ai-lab.connectGoogleCalendarWrite', async () => {
            await runConnectGoogleCalendarWrite();
        })
    );
}

async function runConnectCompanyRepo() {
    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    const companyDir = getCompanyDir();
    const brainDir = _getBrainDir();
    const isNested = path.normalize(companyDir).startsWith(path.normalize(brainDir) + path.sep);
    if (isNested) {
        const ok = await vscode.window.showInformationMessage(
            `회사 폴더가 두뇌 안 nested 위치에 있어요 — 두뇌 GitHub 저장소(\`secondBrainRepo\`)로 이미 같이 백업됩니다.\n\n별도 저장소를 쓰려면 먼저 명령 팔레트에서 "Connect AI: 회사 폴더 변경"으로 회사를 두뇌 외부로 옮기세요.`,
            { modal: false },
            '회사 폴더 변경하기',
            '괜찮아요'
        );
        if (ok === '회사 폴더 변경하기') {
            await runChangeCompanyDir();
        }
        return;
    }
    const cur = (cfg.get<string>('companyRepo', '') || '').trim();
    const url = await vscode.window.showInputBox({
        title: '🔗 회사 GitHub 저장소 URL',
        prompt: '예: https://github.com/사용자/my-company-workspace  (비워두면 회사 백업 OFF)',
        value: cur,
        ignoreFocusOut: true,
        placeHolder: 'https://github.com/...',
        validateInput: (v: string) => {
            const t = (v || '').trim();
            if (!t) return null; // empty = clear setting
            if (!validateGitRemoteUrl(t)) return '⚠️ 유효한 git URL이 아닌 것 같아요. https://github.com/ 또는 git@ 형식';
            return null;
        }
    });
    if (url === undefined) return; // user cancelled
    const cleaned = url.trim();
    await cfg.update('companyRepo', cleaned, vscode.ConfigurationTarget.Global);
    if (!cleaned) {
        await vscode.window.showInformationMessage('회사 GitHub 저장소 연결 해제됨. 회사 폴더는 로컬에만 저장됩니다.');
        return;
    }
    /* Try a first sync immediately so user gets instant feedback. */
    await vscode.window.showInformationMessage(`✅ 회사 GitHub 연결됨: ${cleaned.replace(/^https:\/\/[^@]+@/, 'https://')}\n\n첫 백업을 시도합니다…`);
    await _safeGitAutoSyncCompany(`Initial company backup`, _activeChatProvider);
}

/* Folder-picker driven flow for changing where the company workspace lives.
   Three paths the user can take:
     A) Nested under brain (default, recommended for solo users)
     B) Pick another folder (detached — separate git repo, team-shared, ...)
     C) Cancel */
async function runChangeCompanyDir() {
    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    const cur = (cfg.get<string>('companyDir', '') || '').trim();
    const oldDir = getCompanyDir();
    const brainDir = _getBrainDir();
    const isNested = !cur || _resolvePathInput(cur) === path.join(brainDir, COMPANY_SUBDIR);
    const stateLine = isNested
        ? `현재: 📂 두뇌 안 nested (\`${path.join(brainDir, COMPANY_SUBDIR).replace(os.homedir(), '~')}\`)`
        : `현재: 📂 별도 위치 (\`${cur.replace(os.homedir(), '~')}\`)`;

    const picked = await vscode.window.showQuickPick(
        [
            { label: '$(folder) 두뇌 안 nested로 (권장 · 한 git repo)', description: '~/.../<두뇌>/_company/', value: 'nest' as const },
            { label: '$(folder-opened) 별도 폴더 직접 선택…', description: '두뇌와 완전히 분리. 외주 공유·다른 git repo·다른 동기화 가능', value: 'detach' as const },
            { label: '$(close) 취소', value: 'cancel' as const },
        ],
        { placeHolder: stateLine, ignoreFocusOut: true }
    );
    if (!picked || picked.value === 'cancel') return;

    let newDir = '';
    if (picked.value === 'nest') {
        newDir = path.join(brainDir, COMPANY_SUBDIR);
        await cfg.update('companyDir', '', vscode.ConfigurationTarget.Global);
    } else {
        const folder = await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
            openLabel: '여기를 회사 폴더로',
            defaultUri: vscode.Uri.file(os.homedir()),
        });
        if (!folder || folder.length === 0) return;
        newDir = folder[0].fsPath;
        /* Sanity check — refuse silently-broken read-only picks (USB ROM,
           system folders, mounted snapshots, etc.). Bail with a clear msg
           BEFORE persisting the setting so user can retry without rolling
           back. */
        try {
            fs.accessSync(newDir, fs.constants.W_OK);
        } catch {
            await vscode.window.showErrorMessage(
                `❌ 이 폴더는 쓰기 권한이 없어요. 다른 폴더를 선택하세요: ${newDir.replace(os.homedir(), '~')}`
            );
            return;
        }
        await cfg.update('companyDir', newDir, vscode.ConfigurationTarget.Global);
    }

    /* Move existing data if old has content + new is empty/non-existent.
       Otherwise leave both alone — refuse to merge silently to avoid
       overwriting anything. */
    if (newDir === oldDir) {
        await vscode.window.showInformationMessage(`회사 폴더 위치 변경 없음.`);
        return;
    }
    const oldHasData = fs.existsSync(oldDir) && fs.readdirSync(oldDir).length > 0;
    const newHasData = fs.existsSync(newDir) && fs.readdirSync(newDir).length > 0;
    if (!oldHasData) {
        await vscode.window.showInformationMessage(`✅ 회사 폴더 위치 설정됨: ${newDir.replace(os.homedir(), '~')}`);
        return;
    }
    if (newHasData) {
        await vscode.window.showWarningMessage(
            `⚠️ 새 위치(${path.basename(newDir)})에 이미 파일이 있어서 자동 이동을 건너뜁니다. 옛 폴더(${oldDir.replace(os.homedir(), '~')})의 내용을 수동으로 합쳐주세요.`,
            { modal: false }
        );
        return;
    }
    const move = await vscode.window.showInformationMessage(
        `옛 회사 폴더 내용을 새 위치로 이동할까요?\n\n옛: ${oldDir.replace(os.homedir(), '~')}\n새: ${newDir.replace(os.homedir(), '~')}`,
        { modal: true },
        '이동',
        '나중에'
    );
    if (move === '이동') {
        try {
            fs.mkdirSync(newDir, { recursive: true });
            for (const entry of fs.readdirSync(oldDir)) {
                fs.renameSync(path.join(oldDir, entry), path.join(newDir, entry));
            }
            try { fs.rmdirSync(oldDir); } catch { /* maybe non-empty leftovers, ignore */ }
            await vscode.window.showInformationMessage(`✅ 이동 완료: ${newDir.replace(os.homedir(), '~')}`);
        } catch (e: any) {
            await vscode.window.showErrorMessage(`이동 실패: ${e?.message || e}`);
        }
    } else {
        await vscode.window.showInformationMessage(`✅ 위치만 바뀜. 옛 데이터는 ${oldDir.replace(os.homedir(), '~')} 에 그대로 남아있습니다.`);
    }
}

// ============================================================
// Knowledge Graph Builder — REAL connections (not random!)
// Parses [[wikilinks]], markdown links, and #tags from .md files
// to build a true semantic graph of the user's brain.
// ============================================================
interface BrainNode {
    id: string;            // relative path inside brainDir
    name: string;          // display name (basename without .md)
    folder: string;        // top-level folder (for color clustering)
    tags: string[];
    incoming: number;      // backlink count (for size)
    outgoing: number;
    mtime: number;         // last modified time (for memory decay/hotness)
}
interface BrainLink {
    source: string;
    target: string;
    type: 'wikilink' | 'mdlink' | 'tag' | 'semantic';
}
interface BrainGraph {
    nodes: BrainNode[];
    links: BrainLink[];
    tags: string[];        // all unique tags found
}

function buildKnowledgeGraph(brainDir: string): BrainGraph {
    const nodes: BrainNode[] = [];
    const nodeByPath = new Map<string, BrainNode>();
    const nodeByBasename = new Map<string, BrainNode[]>();
    const links: BrainLink[] = [];
    const tagSet = new Set<string>();
    let scanned = 0;

    if (!fs.existsSync(brainDir)) return { nodes, links, tags: [] };

    // --- Pass 1: collect all .md files as nodes ---
    function walk(dir: string) {
        if (scanned >= 1000) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue;
            if (COMPANY_INTERNAL_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }
            if (!e.isFile() || !full.endsWith('.md')) continue;
            const rel = path.relative(brainDir, full);
            const base = e.name.replace(/\.md$/i, '');
            const parts = rel.split(path.sep);
            const folder = parts.length > 1 ? parts[0] : '_root';
            let mtime = 0;
            try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
            const node: BrainNode = { id: rel, name: base, folder, tags: [], incoming: 0, outgoing: 0, mtime };
            nodes.push(node);
            nodeByPath.set(rel, node);
            const list = nodeByBasename.get(base.toLowerCase()) || [];
            list.push(node);
            nodeByBasename.set(base.toLowerCase(), list);
            scanned++;
        }
    }
    walk(brainDir);

    // --- Pass 2: parse each file for links + tags ---
    const wikilinkRe = /\[\[([^\]\n|#]+)(?:[#|][^\]\n]*)?\]\]/g;
    const mdlinkRe = /\[[^\]]+\]\(([^)]+\.md)\)/gi;
    const tagRe = /(?:^|[\s>(])#([A-Za-z가-힣0-9_-]{2,40})/g;

    function resolveLink(target: string, fromNode: BrainNode): BrainNode | null {
        const cleaned = target.trim().replace(/^\.\//, '').replace(/\\/g, '/');
        // Try exact relative path match (with or without .md)
        const exact = cleaned.endsWith('.md') ? cleaned : cleaned + '.md';
        if (nodeByPath.has(exact)) return nodeByPath.get(exact)!;
        // Try resolved relative to source file's folder
        const fromDir = path.dirname(fromNode.id);
        const joined = path.normalize(path.join(fromDir, exact));
        if (nodeByPath.has(joined)) return nodeByPath.get(joined)!;
        // Fall back to basename match (Obsidian style)
        const base = path.basename(cleaned, '.md').toLowerCase();
        const matches = nodeByBasename.get(base) || [];
        if (matches.length === 0) return null;
        // Prefer same-folder match if multiple
        if (matches.length > 1) {
            const sameFolder = matches.find(m => path.dirname(m.id) === fromDir);
            if (sameFolder) return sameFolder;
        }
        return matches[0];
    }

    for (const node of nodes) {
        let content: string;
        try { content = fs.readFileSync(path.join(brainDir, node.id), 'utf-8').slice(0, 200_000); }
        catch { continue; }

        // Wikilinks → real edges
        let m: RegExpExecArray | null;
        wikilinkRe.lastIndex = 0;
        while ((m = wikilinkRe.exec(content)) !== null) {
            const target = resolveLink(m[1], node);
            if (target && target.id !== node.id) {
                links.push({ source: node.id, target: target.id, type: 'wikilink' });
                node.outgoing++;
                target.incoming++;
            }
        }

        // Markdown links → real edges
        mdlinkRe.lastIndex = 0;
        while ((m = mdlinkRe.exec(content)) !== null) {
            // Skip external URLs
            if (/^https?:\/\//i.test(m[1])) continue;
            const target = resolveLink(m[1], node);
            if (target && target.id !== node.id) {
                links.push({ source: node.id, target: target.id, type: 'mdlink' });
                node.outgoing++;
                target.incoming++;
            }
        }

        // Tags
        tagRe.lastIndex = 0;
        const localTags = new Set<string>();
        while ((m = tagRe.exec(content)) !== null) {
            localTags.add(m[1]);
        }
        node.tags = [...localTags];
        localTags.forEach(t => tagSet.add(t));
    }

    // --- Pass 2.5: Semantic Implicit Links (Brain Pattern Recognition) ---
    // If a document mentions another document's exact basename (and it's >= 2 chars), create a semantic link.
    const validBasenames = nodes.filter(n => n.name.length >= 2);
    for (const node of nodes) {
        let content: string;
        try { content = fs.readFileSync(path.join(brainDir, node.id), 'utf-8').slice(0, 100_000); }
        catch { continue; }
        // Fast plain-text match
        const contentLower = content.toLowerCase();
        for (const target of validBasenames) {
            if (target.id === node.id) continue;
            // Prevent overly broad matching (e.g. matching "it" or "at") by checking word boundaries
            // We use simple substring check first for performance, then regex for word boundary
            const targetLower = target.name.toLowerCase();
            if (contentLower.includes(targetLower)) {
                // Confirm with boundaries if alphabet
                const isAlpha = /^[a-z]+$/.test(targetLower);
                if (isAlpha) {
                    const regex = new RegExp(`\\b${targetLower}\\b`, 'i');
                    if (!regex.test(content)) continue;
                }
                links.push({ source: node.id, target: target.id, type: 'semantic' });
                // We don't increment incoming/outgoing for semantic links to keep sizes strictly based on explicit structure
            }
        }
    }

    // --- Pass 3: tag co-occurrence edges (cap to top 8 tags to avoid explosion) ---
    const tagToNodes = new Map<string, BrainNode[]>();
    for (const node of nodes) {
        for (const t of node.tags) {
            const list = tagToNodes.get(t) || [];
            list.push(node);
            tagToNodes.set(t, list);
        }
    }
    const topTags = [...tagToNodes.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 8);
    for (const [, nodesWithTag] of topTags) {
        if (nodesWithTag.length < 2 || nodesWithTag.length > 25) continue;
        for (let i = 0; i < nodesWithTag.length; i++) {
            for (let j = i + 1; j < nodesWithTag.length; j++) {
                links.push({ source: nodesWithTag[i].id, target: nodesWithTag[j].id, type: 'tag' });
            }
        }
    }

    // De-duplicate links (a→b and b→a counted once)
    const seen = new Set<string>();
    const dedup: BrainLink[] = [];
    for (const l of links) {
        const key = l.source < l.target ? `${l.source}|${l.target}|${l.type}` : `${l.target}|${l.source}|${l.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(l);
    }

    return { nodes, links: dedup, tags: [...tagSet] };
}

async function showBrainNetwork(_context: vscode.ExtensionContext) {
    let panel: vscode.WebviewPanel | undefined;
    try {
        const assetsRoot = vscode.Uri.file(path.join(_context.extensionPath, 'assets'));
        panel = vscode.window.createWebviewPanel(
            'brainTopology',
            'Neural Construct (Brain)',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [assetsRoot] }
        );

        // Hook this panel into the chat provider's thinking-event broadcast,
        // so AI search activity pulses on this graph too — not just on the
        // separate Thinking Mode panel.
        _activeChatProvider?.registerExternalGraphPanel(panel);

        const brainDir = _getBrainDir();
        const graph = buildKnowledgeGraph(brainDir);
        const isEmpty = graph.nodes.length === 0;

        // Handle messages from webview (e.g., open file requests)
        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'openFile' && typeof msg.id === 'string') {
                const safe = safeResolveInside(brainDir, msg.id);
                if (safe && fs.existsSync(safe)) {
                    const doc = await vscode.workspace.openTextDocument(safe);
                    vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                }
            }
        });

        const graphJson = JSON.stringify({
            nodes: graph.nodes.map(n => ({
                id: n.id, name: n.name, folder: n.folder, tags: n.tags,
                connections: n.incoming + n.outgoing
            })),
            links: graph.links
        });

        const forceGraphSrc = panel.webview.asWebviewUri(
            vscode.Uri.file(path.join(_context.extensionPath, 'assets', 'force-graph.min.js'))
        ).toString();
        const html = _RENDER_GRAPH_HTML(graphJson, isEmpty, forceGraphSrc, panel.webview.cspSource);
        // Defensive: if HTML somehow comes back falsy, surface that explicitly
        // instead of letting the webview coerce it into the literal string "null".
        if (typeof html !== 'string' || !html) {
            throw new Error('_RENDER_GRAPH_HTML returned non-string: ' + typeof html);
        }
        panel.webview.html = html;
    } catch (err: any) {
        const detail = err?.stack || err?.message || String(err);
        console.error('showBrainNetwork failed:', detail);
        vscode.window.showErrorMessage('지식 네트워크 열기 실패: ' + (err?.message || String(err)));
        if (panel) {
            const safe = String(detail).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'} as any)[c]);
            panel.webview.html = '<!DOCTYPE html><html><body style="background:#131419;color:#e0e2e8;font-family:-apple-system;padding:40px;line-height:1.55"><h2 style="color:#FFB266;margin-top:0">⚠️ 지식 네트워크 로드 실패</h2><div style="color:#9094a0;font-size:13px;margin-bottom:14px">아래 에러 메시지를 그대로 알려주세요.</div><pre style="color:#e0e2e8;background:#1a1a1f;padding:14px;border-radius:8px;overflow:auto;font-size:12px">' + safe + '</pre></body></html>';
        }
    }
}

/** Returns the full graph webview HTML. Reused by showBrainNetwork + ThinkingPanel. */
function _RENDER_GRAPH_HTML(graphJson: string, isEmpty: boolean, forceGraphSrc: string, cspSource: string): string {
    // NOTE: force-graph.min.js is loaded as an external script (not inlined).
    // Inlining via template literal corrupts the bundle because the minified
    // library contains `${...}` sequences that get evaluated as template parts.
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
  <title>Connect AI — 지식 네트워크</title>
  <style>
    body { margin: 0; padding: 0; background: #131419; overflow: hidden; width: 100vw; height: 100vh; font-family: 'SF Pro Display', -apple-system, sans-serif; color: #d8d9de; }
    /* Subtle vignette behind the canvas — z-index -1 so it never obscures nodes */
    body::after { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: -1;
      background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,.55) 100%); }
    #ui-layer { position: absolute; top: 20px; left: 24px; z-index: 10; pointer-events: none; max-width: 60%; }
    #ui-layer h1 { font-size: 22px; margin: 0 0 4px 0; font-weight: 700; letter-spacing: -0.4px; color: #e8e9ee; }
    #ui-layer h1 span { color: #5DE0E6; text-shadow: 0 0 14px rgba(93,224,230,.45); }
    #stats { color: #6c6e78; font-family: 'SF Mono', monospace; font-size: 11px; margin-top: 2px; letter-spacing: .2px; }
    #legend { position: absolute; top: 20px; right: 24px; z-index: 10; background: rgba(20,21,28,.78); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 12px 14px; font-size: 11px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 8px 32px rgba(0,0,0,.4); }
    #legend .row { display: flex; align-items: center; gap: 8px; margin: 4px 0; color: #9094a0; }
    #legend .swatch { width: 18px; height: 2px; border-radius: 1px; }
    #legend .row.synapse .swatch { box-shadow: 0 0 6px #5DE0E6; }
    #empty { position: absolute; inset: 0; display: ${isEmpty ? 'flex' : 'none'}; flex-direction: column; align-items: center; justify-content: center; color: #555; font-size: 14px; gap: 10px; pointer-events: none; }
    #empty .big { font-size: 22px; color: #888; }
    #tooltip { position: absolute; pointer-events: none; background: rgba(20,21,28,.95); border: 1px solid rgba(93,224,230,.28); border-radius: 10px; padding: 10px 13px; font-size: 12px; color: #e0e2e8; box-shadow: 0 8px 32px rgba(93,224,230,.12), 0 4px 12px rgba(0,0,0,.5); display: none; z-index: 20; max-width: 260px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
    #tooltip .t-name { font-weight: 700; color: #5DE0E6; margin-bottom: 4px; letter-spacing: .1px; }
    #tooltip .t-meta { color: #7c7f8a; font-size: 10px; font-family: 'SF Mono', monospace; }
    #tooltip .t-tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
    #tooltip .t-tag { background: rgba(93,224,230,.08); color: #5DE0E6; padding: 2px 7px; border-radius: 8px; font-size: 9px; border: 1px solid rgba(93,224,230,.2); }
    #graph { position: absolute; inset: 0; width: 100vw; height: 100vh; z-index: 0; }
    canvas { cursor: grab; }
    canvas:active { cursor: grabbing; }
    /* Search/filter bar — toggle with the slash key */
    #search-bar { position: absolute; top: 64px; left: 24px; z-index: 12;
      background: rgba(20,21,28,.92); border: 1px solid rgba(93,224,230,.32);
      border-radius: 10px; padding: 6px 10px;
      display: none; align-items: center; gap: 8px;
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 8px 32px rgba(0,0,0,.4), 0 0 16px rgba(93,224,230,.08);
      min-width: 260px; max-width: 380px; }
    #search-bar.active { display: flex; animation: searchSlideIn .25s cubic-bezier(.16,1,.3,1); }
    @keyframes searchSlideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    #search-input { background: transparent; border: 0; outline: 0;
      color: #e8e9ee; font-size: 13px; font-family: 'SF Pro Display', -apple-system, sans-serif;
      flex: 1; padding: 4px 0; min-width: 0; }
    #search-input::placeholder { color: #5a5d68; }
    #search-count { color: #5DE0E6; font-size: 11px; font-family: 'SF Mono', monospace; white-space: nowrap; }
    #search-count.zero { color: #FFB266; }
    /* Legend folder chips + toggles */
    #legend .folders { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.06); display: flex; flex-direction: column; gap: 3px; max-height: 180px; overflow-y: auto; }
    #legend .folder-row { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: #9094a0; }
    #legend .folder-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    #legend .folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #legend .folder-count { color: #5a5d68; font-family: 'SF Mono', monospace; font-size: 9px; }
    #legend .toggle-row { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.06); display: flex; align-items: center; gap: 8px; font-size: 11px; color: #9094a0; cursor: pointer; user-select: none; }
    #legend .toggle-row:hover { color: #d8d9de; }
    #legend .toggle-row .switch { width: 22px; height: 12px; border-radius: 7px; background: #2a2a30; position: relative; transition: background .2s; flex-shrink: 0; }
    #legend .toggle-row .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: #888; transition: left .2s, background .2s; }
    #legend .toggle-row.on .switch { background: rgba(93,224,230,.4); }
    #legend .toggle-row.on .switch::after { left: 12px; background: #5DE0E6; }
    /* Thinking Mode — neural HUD */
    #thinking-overlay { position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%); z-index: 15;
      background: linear-gradient(180deg, rgba(18,22,32,.94), rgba(12,15,22,.92));
      border: 1px solid rgba(93,224,230,.30); border-radius: 16px;
      padding: 16px 22px 14px; font-size: 13px; color: #e0e2e8;
      backdrop-filter: blur(20px) saturate(140%); -webkit-backdrop-filter: blur(20px) saturate(140%);
      box-shadow: 0 16px 56px rgba(0,0,0,.55), 0 0 0 1px rgba(93,224,230,.06) inset, 0 24px 64px rgba(93,224,230,.10);
      display: none; min-width: 360px; max-width: 620px; overflow: hidden;
    }
    #thinking-overlay::before { content:''; position:absolute; top:0; left:0; right:0; height:1px;
      background: linear-gradient(90deg, transparent, rgba(93,224,230,.65), transparent);
      animation: scanLine 2.4s ease-in-out infinite;
    }
    @keyframes scanLine { 0% { transform: translateX(-30%); opacity: 0; } 50% { opacity: 1; } 100% { transform: translateX(30%); opacity: 0; } }
    #thinking-overlay.active { display: block; animation: slideUp .5s cubic-bezier(.16,1,.3,1); }
    @keyframes slideUp { from { opacity: 0; transform: translate(-50%, 24px); } to { opacity: 1; transform: translate(-50%, 0); } }
    #thinking-overlay .phases { display: flex; flex-direction: column; gap: 2px; position: relative; }
    /* Vertical connector line linking the three phase dots */
    #thinking-overlay .phases::before { content: ''; position: absolute;
      left: 9px; top: 14px; bottom: 14px; width: 1px;
      background: linear-gradient(180deg, rgba(93,224,230,.10), rgba(255,178,102,.10));
    }
    #thinking-overlay .phase { display: flex; align-items: center; gap: 12px; padding: 5px 0; opacity: .38;
      transition: opacity .35s ease, color .35s ease, transform .35s ease; font-size: 12.5px; letter-spacing: .1px;
      position: relative;
    }
    #thinking-overlay .phase .icon {
      width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
      background: rgba(40,44,56,.7); border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(255,255,255,.06) inset;
      font-size: 11px; flex-shrink: 0; transition: background .35s ease, box-shadow .35s ease, transform .35s ease;
      position: relative; z-index: 1;
    }
    #thinking-overlay .phase .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #thinking-overlay .phase.active { opacity: 1; color: #5DE0E6; }
    #thinking-overlay .phase.active .icon {
      background: radial-gradient(circle, rgba(93,224,230,.45), rgba(93,224,230,.10));
      box-shadow: 0 0 0 1px rgba(93,224,230,.55) inset, 0 0 14px rgba(93,224,230,.55);
      animation: phasePulse 1.4s ease-in-out infinite;
    }
    @keyframes phasePulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
    #thinking-overlay .phase.done { opacity: .8; color: #FFB266; }
    #thinking-overlay .phase.done .icon {
      background: radial-gradient(circle, rgba(255,178,102,.30), rgba(255,178,102,.05));
      box-shadow: 0 0 0 1px rgba(255,178,102,.40) inset;
    }
    #thinking-overlay .answer-preview { margin-top: 12px; padding: 10px 12px;
      background: rgba(93,224,230,.04); border: 1px solid rgba(93,224,230,.10); border-radius: 8px;
      font-size: 11.5px; color: #b8bac4; max-height: 64px; overflow: hidden; line-height: 1.55;
      font-family: 'SF Mono', 'JetBrains Mono', monospace; letter-spacing: .15px;
    }
    body.thinking::before { content: ''; position: absolute; inset: 0;
      background: radial-gradient(ellipse at center, rgba(93,224,230,.07), transparent 60%);
      pointer-events: none; z-index: 1; animation: thinkingPulse 3.2s ease-in-out infinite;
    }
    @keyframes thinkingPulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
  </style>
  <script src="${forceGraphSrc}"></script>
</head>
<body>
  <div id="ui-layer">
    <h1>✦ <span id="titleSpan">지식 네트워크</span></h1>
    <p id="stats">로딩 중...</p>
  </div>
  <div id="thinking-overlay">
    <div class="phases">
      <div class="phase" id="phase-context"><span class="icon">📂</span><span class="text">컨텍스트 모으는 중...</span></div>
      <div class="phase" id="phase-brain"><span class="icon">🧠</span><span class="text">관련 노트 찾는 중...</span></div>
      <div class="phase" id="phase-answer"><span class="icon">✍️</span><span class="text">답변 생성 중...</span></div>
    </div>
    <div class="answer-preview" id="answer-preview" style="display:none"></div>
  </div>
  <div id="legend">
    <div class="folders" id="folders-list"></div>
  </div>
  <div id="empty">
    <div class="big">📂 아직 지식이 없어요</div>
    <div>지식 폴더에 .md 파일을 넣고 다시 열어주세요</div>
    <div style="font-size:10px;color:#444">팁: <code style="background:#1a1a1a;padding:2px 6px;border-radius:4px">[[다른노트]]</code> 형식으로 링크하면 자동 연결됩니다</div>
  </div>
  <div id="search-bar">
    <span style="color:#5DE0E6;font-size:13px">⌕</span>
    <input id="search-input" type="text" placeholder="이름·태그·폴더 검색  (ESC로 닫기)" autocomplete="off" spellcheck="false" />
    <span id="search-count"></span>
  </div>
  <div id="graph"></div>
  <div id="tooltip"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const data = ${graphJson};
    const tooltip = document.getElementById('tooltip');

    // Folder palette — Obsidian-style desaturated tones, optimized for dark canvas.
    const PALETTE = ['#7DA8E6','#8FD3A8','#E89B6E','#C28BE5','#E5C07B','#7FCBC0','#E68FB0','#A8B2D1','#9DC4A0','#D9A89B'];
    const folders = [...new Set(data.nodes.map(n => n.folder))].sort();
    const folderColor = {};
    folders.forEach((f, i) => { folderColor[f] = PALETTE[i % PALETTE.length]; });

    // Edge color by type — softer, more "neural" (cyan synapse / lilac bridge / faint tag mist)
    const EDGE_COLOR = {
      wikilink: 'rgba(125,200,232,0.55)',
      mdlink:   'rgba(168,155,217,0.40)',
      tag:      'rgba(180,180,200,0.10)',
      semantic: 'rgba(93,224,230,0.15)' // Faint cyan for implicit brain connections
    };
    const EDGE_WIDTH = { wikilink: 1.2, mdlink: 0.9, tag: 0.4, semantic: 0.6 };
    // Active synapse color used during thinking
    const SYNAPSE = '#5DE0E6';   // electric cyan — "fired" feeling
    const TRAIL   = '#FFB266';   // warm amber — "this knowledge was used"

    document.getElementById('stats').textContent =
      data.nodes.length + ' 지식 · ' + data.links.length + ' 연결 · ' + folders.length + ' 폴더';

    // ── Folder chip list in legend (informational; folder→color mapping) ──
    (() => {
      const el = document.getElementById('folders-list');
      if (!el) return;
      const counts = {};
      data.nodes.forEach(n => { counts[n.folder] = (counts[n.folder] || 0) + 1; });
      folders.forEach(f => {
        const row = document.createElement('div');
        row.className = 'folder-row';
        const dot = document.createElement('div');
        dot.className = 'folder-dot';
        dot.style.background = folderColor[f] || '#888';
        const name = document.createElement('div');
        name.className = 'folder-name';
        name.textContent = f || '/';
        const count = document.createElement('div');
        count.className = 'folder-count';
        count.textContent = counts[f] || 0;
        row.appendChild(dot); row.appendChild(name); row.appendChild(count);
        el.appendChild(row);
      });
    })();

    // ── Orphan-hide toggle ──
    let hideOrphans = false;
    const orphanToggleEl = document.getElementById('toggle-orphans');
    orphanToggleEl?.addEventListener('click', () => {
      hideOrphans = !hideOrphans;
      orphanToggleEl.classList.toggle('on', hideOrphans);
      // Trigger a layout/render refresh
      Graph.nodeVisibility(Graph.nodeVisibility());
    });

    let hoverNode = null;
    let highlightNodes = new Set();
    let highlightLinks = new Set();

    function applyHighlight(node) {
      highlightNodes = new Set();
      highlightLinks = new Set();
      if (!node) return;
      highlightNodes.add(node.id);
      data.links.forEach(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        if (sId === node.id || tId === node.id) {
          highlightLinks.add(l);
          highlightNodes.add(sId);
          highlightNodes.add(tId);
        }
      });
    }

    // Compute node radius — Obsidian-style hierarchy + Recency (Hotness)
    // Hubs (many connections) get noticeably larger.
    // Recently modified nodes get a "hotness" bump.
    const now = Date.now();
    function nodeRadius(n) {
      const c = n.connections;
      let r = 3.5;
      if (c > 0 && c <= 2) r = 5.5;                                  // leaf
      else if (c > 2 && c <= 5) r = 8 + Math.log2(c) * 0.8;          // mid
      else if (c > 5) r = Math.min(22, 11 + Math.log2(c) * 2.2);     // hub
      
      // Memory decay / Hotness: files modified in the last 24 hours get slightly larger
      if (n.mtime && (now - n.mtime < 86400000)) {
         // linearly scale bump based on recency within 24 hours
         const ageRatio = (now - n.mtime) / 86400000;
         r += 2 * (1 - ageRatio);
      }
      return r;
    }
    function isHub(n) { return n.connections > 5; }
    // Precompute neighbor map — used for synapse highlights when a node is "fired"
    const neighborsOf = {};
    data.nodes.forEach(n => { neighborsOf[n.id] = new Set(); });
    data.links.forEach(l => {
      const sId = (l.source && l.source.id) || l.source;
      const tId = (l.target && l.target.id) || l.target;
      if (neighborsOf[sId]) neighborsOf[sId].add(tId);
      if (neighborsOf[tId]) neighborsOf[tId].add(sId);
    });

    // ── Thinking-mode state — must be declared BEFORE Graph creation
    // because force-graph invokes linkColor/linkDirectionalParticles
    // synchronously during .graphData() and would otherwise hit TDZ.
    const thinkingActive = new Set();          // node ids currently being read (electric cyan)
    const thinkingAdjacent = new Set();        // 1-hop neighbors of active nodes (faint glow)
    const thinkingDoneOrder = new Map();       // node id → 1-based usage index (warm amber trail)
    let thinkingDoneCounter = 0;
    let thinkPulseTime = 0;
    const nodeById = {};
    data.nodes.forEach(n => { nodeById[n.id] = n; });
    function recomputeAdjacent() {
      thinkingAdjacent.clear();
      thinkingActive.forEach(id => {
        (neighborsOf[id] || new Set()).forEach(n => { if (!thinkingActive.has(n)) thinkingAdjacent.add(n); });
      });
    }
    function markDone(id) {
      if (!thinkingDoneOrder.has(id)) thinkingDoneOrder.set(id, ++thinkingDoneCounter);
    }
    function clearThinkingTrail() {
      thinkingActive.clear();
      thinkingAdjacent.clear();
      thinkingDoneOrder.clear();
      thinkingDoneCounter = 0;
    }

    const Graph = ForceGraph()(document.getElementById('graph'))
      .width(window.innerWidth)
      .height(window.innerHeight)
      .backgroundColor('#0a0a0a')
      .graphData(data)
      .nodeId('id')
      .nodeVal(n => nodeRadius(n) * 0.6)
      .nodeCanvasObject((node, ctx, globalScale) => {
        // (NOTE: this is the base renderer; thinking-mode renderer below overrides it.)
        renderNode(node, ctx, globalScale);
      })
      .nodePointerAreaPaint((node, color, ctx) => {
        const r = nodeRadius(node) + 6;
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color; ctx.fill();
      })
      .linkColor(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        const isSynapse = thinkingActive.has(sId) || thinkingActive.has(tId);
        const isTrail   = thinkingDoneOrder.has(sId) && thinkingDoneOrder.has(tId);
        if (isSynapse) return 'rgba(93,224,230,0.85)';
        if (isTrail)   return 'rgba(255,178,102,0.55)';
        if (highlightLinks.size > 0 && !highlightLinks.has(l)) return 'rgba(60,60,70,0.10)';
        return EDGE_COLOR[l.type] || 'rgba(255,255,255,0.08)';
      })
      .linkWidth(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        const isSynapse = thinkingActive.has(sId) || thinkingActive.has(tId);
        const isTrail   = thinkingDoneOrder.has(sId) && thinkingDoneOrder.has(tId);
        if (isSynapse) return 2.4;
        if (isTrail)   return 1.6;
        return highlightLinks.has(l) ? (EDGE_WIDTH[l.type] || 1) * 2 : (EDGE_WIDTH[l.type] || 1);
      })
      // Every link breathes a slow particle — synapse-active ones fire faster + brighter
      .linkDirectionalParticles(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        if (thinkingActive.has(sId) || thinkingActive.has(tId)) return 4;
        if (l.type === 'wikilink') return 2;
        if (l.type === 'mdlink')   return 1;
        return 0; // tag links stay quiet
      })
      .linkDirectionalParticleWidth(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        return (thinkingActive.has(sId) || thinkingActive.has(tId)) ? 2.4 : 1.4;
      })
      .linkDirectionalParticleSpeed(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        return (thinkingActive.has(sId) || thinkingActive.has(tId)) ? 0.018 : 0.005;
      })
      .linkDirectionalParticleColor(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        if (thinkingActive.has(sId) || thinkingActive.has(tId)) return SYNAPSE;
        return EDGE_COLOR[l.type] || '#7DA8E6';
      })
      .nodeVisibility(n => !(hideOrphans && n.connections === 0))
      .d3VelocityDecay(0.25)
      .warmupTicks(120)
      .cooldownTicks(1200)
      .onNodeHover(node => {
        hoverNode = node || null;
        // Sticky selection / active search win — when either is pinning the
        // highlight set, hover doesn't disturb it (Obsidian-style behavior).
        if (!stickyNode && !(searchActive && searchInput.value)) applyHighlight(hoverNode);
        document.body.style.cursor = node ? 'pointer' : 'grab';
        if (node) {
          tooltip.style.display = 'block';
          const tagsHtml = (node.tags || []).slice(0, 5).map(t => '<span class="t-tag">#' + t + '</span>').join('');
          tooltip.innerHTML =
            '<div class="t-name">' + (node.name || '(이름 없음)') + '</div>' +
            '<div class="t-meta">' + (node.folder || '/') + ' · ' + (node.connections || 0) + '개 연결</div>' +
            (tagsHtml ? '<div class="t-tags">' + tagsHtml + '</div>' : '');
        } else {
          tooltip.style.display = 'none';
        }
      })
      .onNodeRightClick(node => {
        vscode.postMessage({ type: 'openFile', id: node.id });
      });

    // ── Sticky selection (Obsidian signature behavior) ──
    // Single click → pin a node + its 1-hop neighbors as the highlight set
    //                (everything else dims).
    // Same node clicked again → unpin.
    // Different node clicked → repin.
    // Double-click → open file.
    // Background click → unpin.
    let stickyNode = null;
    function pinNode(node) {
      stickyNode = node;
      applyHighlight(node);
    }
    function unpinNode() {
      stickyNode = null;
      applyHighlight(hoverNode);  // fall back to hover state if any
    }

    let lastClick = { id: null, t: 0 };
    Graph.onNodeClick(node => {
      // Click during active search → close the search panel and act as a normal pin
      if (searchActive) closeSearch();
      const now = Date.now();
      if (lastClick.id === node.id && now - lastClick.t < 400) {
        // Double-click on the same node → open file
        vscode.postMessage({ type: 'openFile', id: node.id });
        lastClick = { id: null, t: 0 };
        return;
      }
      lastClick = { id: node.id, t: now };

      if (stickyNode && stickyNode.id === node.id) {
        unpinNode();
      } else {
        pinNode(node);
        Graph.centerAt(node.x, node.y, 600);
        Graph.zoom(3, 800);
      }
    });

    let lastBgClickT = 0;
    Graph.onBackgroundClick(() => {
      const now = Date.now();
      if (now - lastBgClickT < 400) {
        // Background double-click → reset zoom to fit the whole graph
        Graph.zoomToFit(800, 60);
        lastBgClickT = 0;
        return;
      }
      lastBgClickT = now;
      if (searchActive) closeSearch();
      else if (stickyNode) unpinNode();
    });

    // -- Search/filter bar (slash to open, ESC to close) --
    const searchBar = document.getElementById('search-bar');
    const searchInput = document.getElementById('search-input');
    const searchCount = document.getElementById('search-count');
    let searchActive = false;
    function openSearch() {
      searchActive = true;
      searchBar.classList.add('active');
      searchInput.focus();
      searchInput.select();
    }
    function closeSearch() {
      searchActive = false;
      searchBar.classList.remove('active');
      searchInput.value = '';
      searchCount.textContent = '';
      searchCount.classList.remove('zero');
      // Restore prior state (sticky pin or current hover)
      applyHighlight(stickyNode || hoverNode);
    }
    function runSearch(q) {
      q = q.trim().toLowerCase();
      if (!q) {
        searchCount.textContent = '';
        searchCount.classList.remove('zero');
        applyHighlight(stickyNode || hoverNode);
        return;
      }
      const matches = new Set();
      data.nodes.forEach(n => {
        const hay = ((n.name || '') + ' ' + (n.folder || '') + ' ' +
                     (n.tags || []).map(t => '#' + t).join(' ')).toLowerCase();
        if (hay.includes(q)) matches.add(n.id);
      });
      searchCount.textContent = matches.size + '개';
      searchCount.classList.toggle('zero', matches.size === 0);
      if (matches.size === 0) {
        // Don't dim the whole graph for zero results — feels punishing
        highlightNodes = new Set(); highlightLinks = new Set();
        return;
      }
      highlightNodes = new Set(matches);
      highlightLinks = new Set();
      data.links.forEach(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        if (matches.has(sId) && matches.has(tId)) highlightLinks.add(l);
      });
    }
    searchInput.addEventListener('input', () => runSearch(searchInput.value));
    document.addEventListener('keydown', (e) => {
      if (e.target === searchInput) {
        if (e.key === 'Escape') { closeSearch(); e.preventDefault(); }
        return;
      }
      if (e.key === '/' && !searchActive) {
        e.preventDefault();
        openSearch();
      } else if (e.key === 'Escape' && searchActive) {
        closeSearch();
      }
    });

    // Force tuning: hubs repel more, semantic links are gentle.
    const sparseFactor = Math.max(0.4, Math.min(1, data.links.length / Math.max(1, data.nodes.length)));
    Graph.d3Force('charge').strength(n => -50 - 25 * sparseFactor - (isHub(n) ? 60 : 0));
    Graph.d3Force('link')
      .distance(l => l.type === 'tag' ? 90 : l.type === 'semantic' ? 70 : l.type === 'mdlink' ? 50 : 36)
      .strength(l => l.type === 'tag' ? 0.15 : l.type === 'semantic' ? 0.25 : l.type === 'mdlink' ? 0.5 : 0.85);
    if (typeof window.d3 !== 'undefined' && window.d3.forceCenter) {
      Graph.d3Force('center', window.d3.forceCenter(0, 0).strength(0.06));
    }

    // Tooltip follow mouse
    document.addEventListener('mousemove', (e) => {
      if (tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top = (e.clientY + 14) + 'px';
      }
    });

    // Initial framing: the force simulation needs time to spread nodes from
    // their origin spawn before zoomToFit can frame anything meaningful. Doing
    // it too early frames a tiny clump → zooms way in → nodes then explode
    // outward off-screen. We wait for the engine to actually settle, with one
    // safety fit as a fallback if cooldown is unusually long.
    const zoomPad = data.nodes.length < 10 ? 120 : data.nodes.length < 30 ? 90 : 60;
    let _initialFitDone = false;
    function _initialFit(duration) {
      if (_initialFitDone) return;
      _initialFitDone = true;
      try { Graph.zoomToFit(duration, zoomPad); } catch (e) {}
      const ts = document.getElementById('titleSpan'); if (ts) ts.innerText = '지식 네트워크 · LIVE';
    }
    // Authoritative fit — fires once the layout has fully settled.
    Graph.onEngineStop(() => _initialFit(900));
    // Safety net: if the engine never reports stop (rare, but possible with
    // very large graphs or external re-heats), frame what we have at ~2.5s.
    setTimeout(() => _initialFit(1100), 2500);

    window.addEventListener('resize', () => {
      Graph.width(window.innerWidth).height(window.innerHeight);
    });

    // ============================================================
    // 🎬 THINKING MODE — receive realtime events from chat extension
    // ============================================================
    const thinkingOverlay = document.getElementById('thinking-overlay');
    const phaseContext = document.getElementById('phase-context');
    const phaseBrain = document.getElementById('phase-brain');
    const phaseAnswer = document.getElementById('phase-answer');
    const answerPreview = document.getElementById('answer-preview');

    // Map basename → node for fast lookup when AI sends "read this brain note"
    const nodesByBasename = {};
    data.nodes.forEach(n => {
      const k = n.name.toLowerCase();
      nodesByBasename[k] = nodesByBasename[k] || [];
      nodesByBasename[k].push(n);
    });
    function findNodeForReadRequest(req) {
      if (typeof req !== 'string' || !req) return null;
      // Try by exact id first
      const direct = data.nodes.find(n => n.id === req || n.id === req + '.md');
      if (direct) return direct;
      // Then by basename match
      const base = (req.split(/[\\\\/]/).pop() || '').replace(/\\.md$/i, '').toLowerCase();
      const matches = nodesByBasename[base];
      return matches && matches.length > 0 ? matches[0] : null;
    }

    // (thinkingActive / thinkingAdjacent / thinkingDone / recomputeAdjacent
    //  were hoisted above the Graph constructor to avoid TDZ when force-graph
    //  invokes link callbacks synchronously during .graphData().)

    // Single canonical renderer — Obsidian + brain look, thinking effects layered on top.
    function renderNode(node, ctx, globalScale) {
      // Skip the very first ticks before force-graph has assigned coords —
      // createRadialGradient throws if any value is non-finite.
      if (!isFinite(node.x) || !isFinite(node.y)) return;
      const baseR = Math.max(1, nodeRadius(node) || 0);
      const isHL = highlightNodes.size === 0 || highlightNodes.has(node.id);
      const isActive = thinkingActive.has(node.id);
      const isAdj    = thinkingAdjacent.has(node.id);
      const isDone   = thinkingDoneOrder.has(node.id);
      const isOrphan = node.connections === 0;
      const hub      = isHub(node);
      const color    = folderColor[node.folder] || '#9aa0a6';

      // ── 1. Active synapse halo: pulsing electric cyan ──
      if (isActive) {
        const pulse = 0.5 + 0.5 * Math.sin(thinkPulseTime * 0.09);
        const haloR = baseR * (2.6 + pulse * 0.9);
        const grad = ctx.createRadialGradient(node.x, node.y, baseR, node.x, node.y, haloR);
        grad.addColorStop(0, 'rgba(93,224,230,0.55)');
        grad.addColorStop(0.5, 'rgba(93,224,230,0.20)');
        grad.addColorStop(1,  'rgba(93,224,230,0)');
        ctx.beginPath(); ctx.arc(node.x, node.y, haloR, 0, 2 * Math.PI);
        ctx.fillStyle = grad; ctx.fill();
      }

      // ── 2. Adjacent ghost glow: faint cyan whisper ──
      if (isAdj && !isActive) {
        ctx.beginPath(); ctx.arc(node.x, node.y, baseR * 1.8, 0, 2 * Math.PI);
        const g = ctx.createRadialGradient(node.x, node.y, baseR * 0.6, node.x, node.y, baseR * 1.8);
        g.addColorStop(0, 'rgba(93,224,230,0.22)');
        g.addColorStop(1, 'rgba(93,224,230,0)');
        ctx.fillStyle = g; ctx.fill();
      }

      // ── 3. Ambient glow for hubs / done-trail ──
      const r = isHL ? baseR : baseR * 0.7;
      const ambientColor = isActive ? SYNAPSE : isDone ? TRAIL : color;
      const ambientStrength = isActive ? 'cc' : isDone ? '99' : (hub && isHL ? '88' : (isHL ? '55' : '22'));
      ctx.beginPath(); ctx.arc(node.x, node.y, r + (hub ? 5 : 3), 0, 2 * Math.PI);
      const ambient = ctx.createRadialGradient(node.x, node.y, r * 0.4, node.x, node.y, r + (hub ? 5 : 3));
      ambient.addColorStop(0, ambientColor + ambientStrength);
      ambient.addColorStop(1, ambientColor + '00');
      ctx.fillStyle = ambient; ctx.fill();

      // ── 4. Solid core ──
      ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      if (isActive) {
        ctx.shadowBlur = 24; ctx.shadowColor = SYNAPSE;
        ctx.fillStyle = SYNAPSE; ctx.fill();
      } else if (isDone) {
        ctx.shadowBlur = 12; ctx.shadowColor = TRAIL;
        ctx.fillStyle = TRAIL; ctx.fill();
      } else if (isOrphan) {
        ctx.fillStyle = '#0a0a0a'; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = color + (isHL ? 'a0' : '50'); ctx.stroke();
      } else if (hub && isHL) {
        ctx.shadowBlur = 14; ctx.shadowColor = color;
        ctx.fillStyle = color; ctx.fill();
      } else {
        ctx.fillStyle = isHL ? color : color + '88'; ctx.fill();
      }
      ctx.shadowBlur = 0;

      // ── 5. Zoom-aware label ──
      // Obsidian behavior: only hubs always show; mids appear as you zoom in;
      // leaves only at high zoom. Active/done nodes always show their name.
      const labelMinScale = isActive || isDone ? 0 : hub ? 0 : node.connections >= 2 ? 1.4 : 2.6;
      if (globalScale < labelMinScale) return;

      const fs = isActive || isDone || hub
        ? Math.max(4, Math.min(8, 13 / globalScale + (hub ? 1.5 : 0)))
        : Math.max(3, Math.min(6, 11 / globalScale));
      const fontWeight = isActive ? '700 ' : (hub || isDone) ? '600 ' : '';
      ctx.font = fontWeight + fs + "px -apple-system, 'SF Pro Display', sans-serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';

      const dimAlpha = highlightNodes.size > 0 && !isHL ? '40' : '';
      ctx.fillStyle = isActive ? SYNAPSE
                    : isDone   ? TRAIL
                    : hub      ? '#f0f0f0' + dimAlpha
                    :            '#a0a0a8' + dimAlpha;
      // subtle text shadow for active/hub legibility
      if (isActive || isDone) { ctx.shadowBlur = 6; ctx.shadowColor = isActive ? SYNAPSE : TRAIL; }
      ctx.fillText(node.name || '', node.x, node.y + r + 2);
      ctx.shadowBlur = 0;

      // ── 6. Usage-order index chip on cited nodes (1, 2, 3...) ──
      if (isDone) {
        const idx = thinkingDoneOrder.get(node.id);
        if (idx) {
          const chipR = Math.max(4.5, 6 / globalScale);
          const cx = node.x + r + chipR + 1;
          const cy = node.y - r - 1;
          ctx.beginPath(); ctx.arc(cx, cy, chipR, 0, 2 * Math.PI);
          ctx.fillStyle = TRAIL; ctx.fill();
          ctx.lineWidth = 0.6; ctx.strokeStyle = '#131419'; ctx.stroke();
          ctx.fillStyle = '#131419';
          ctx.font = '700 ' + Math.max(5, 7 / globalScale) + "px -apple-system, sans-serif";
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(idx), cx, cy + 0.5);
        }
      }
    }

    // Re-bind renderer (override of the placeholder bound earlier).
    Graph.nodeCanvasObject(renderNode);

    // ── Trail path: dashed amber line connecting cited nodes in usage order ──
    Graph.onRenderFramePost((ctx) => {
      if (thinkingDoneOrder.size < 2) return;
      const ordered = [...thinkingDoneOrder.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => nodeById[id])
        .filter(n => n && isFinite(n.x) && isFinite(n.y));
      if (ordered.length < 2) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,178,102,0.45)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ordered.forEach((n, i) => {
        if (i === 0) ctx.moveTo(n.x, n.y);
        else ctx.lineTo(n.x, n.y);
      });
      ctx.stroke();
      ctx.restore();
    });

    // Pulse animation tick — drive both thinking pulse and a slow ambient breath.
    setInterval(() => {
      thinkPulseTime++;
      // Force redraw only when there's an active animation to avoid wasted work.
      if (thinkingActive.size > 0 || thinkingAdjacent.size > 0) {
        Graph.nodeRelSize(Graph.nodeRelSize());
      }
    }, 40);

    function setPhase(id, state) {
      const el = document.getElementById('phase-' + id);
      if (!el) return;
      el.classList.remove('active', 'done');
      if (state) el.classList.add(state);
    }

    function showThinkingOverlay() {
      thinkingOverlay.classList.add('active');
      document.body.classList.add('thinking');
    }
    function hideThinkingOverlay() {
      // Keep the thinking trail visible (done nodes stay highlighted) but remove pulse overlay
      document.body.classList.remove('thinking');
      // Auto-hide overlay after a delay so user can see the final state
      setTimeout(() => {
        thinkingOverlay.classList.remove('active');
        thinkingActive.clear();
      }, 6000);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'thinking_start': {
          showThinkingOverlay();
          phaseContext.querySelector('.text').textContent = '컨텍스트 모으는 중...';
          phaseBrain.querySelector('.text').textContent = '관련 노트 찾는 중...';
          phaseAnswer.querySelector('.text').textContent = '답변 생성 중...';
          setPhase('context', 'active'); setPhase('brain', null); setPhase('answer', null);
          answerPreview.style.display = 'none';
          answerPreview.textContent = '';
          clearThinkingTrail();   // fresh session — drop the previous trail entirely
          break;
        }
        case 'context_done': {
          const summary = (msg.workspace ? '📂 워크스페이스' : '') +
                          (msg.brainCount > 0 ? '  🧠 ' + msg.brainCount + '개 노트' : '') +
                          (msg.web ? '  🌐 인터넷' : '');
          phaseContext.querySelector('.text').textContent = '컨텍스트 모음 완료' + (summary ? ' · ' + summary : '');
          setPhase('context', 'done');
          setPhase('brain', 'active');
          break;
        }
        case 'brain_read': {
          const node = findNodeForReadRequest(msg.note || '');
          if (node) {
            thinkingActive.add(node.id);
            recomputeAdjacent();
            // Camera nudge — gently center on the active node
            try { Graph.centerAt(node.x, node.y, 800); } catch(e){}
            phaseBrain.querySelector('.text').textContent = '🧠 ' + (node.name || '(노트)') + ' 읽는 중...';
            // After 1.4s, mark as done (trail) and remove from active
            setTimeout(() => {
              thinkingActive.delete(node.id);
              markDone(node.id);
              recomputeAdjacent();
            }, 1400);
          } else {
            phaseBrain.querySelector('.text').textContent = '🧠 ' + (msg.note || '...') + ' 검색 중...';
          }
          break;
        }
        case 'url_read': {
          phaseBrain.querySelector('.text').textContent = '🌐 ' + (msg.url || '').slice(0, 60) + '...';
          break;
        }
        case 'answer_start': {
          setPhase('brain', 'done');
          setPhase('answer', 'active');
          answerPreview.style.display = 'block';
          break;
        }
        case 'answer_chunk': {
          // Show last ~120 chars as live preview
          if (typeof msg.text === 'string') {
            answerPreview.textContent = (answerPreview.textContent + msg.text).slice(-180);
          }
          break;
        }
        case 'answer_complete': {
          setPhase('answer', 'done');
          phaseAnswer.querySelector('.text').textContent = '✅ 답변 완료';
          if (Array.isArray(msg.sources)) {
            msg.sources.forEach(req => {
              const node = findNodeForReadRequest(req);
              if (node) markDone(node.id);
            });
          }
          hideThinkingOverlay();
          // Auto-frame the cluster of cited notes — "this answer came from
          // these notes" — so the trail isn't lost in a sea of unrelated nodes.
          // Falls back to full-graph fit when nothing was cited.
          setTimeout(() => {
            if (thinkingDoneOrder.size > 0) {
              try {
                Graph.zoomToFit(1200, 120, n => thinkingDoneOrder.has(n.id));
              } catch(e){ Graph.zoomToFit(1000, 80); }
            } else {
              Graph.zoomToFit(1000, 80);
            }
          }, 400);
          break;
        }
        case 'highlight_node': {
          // External request to focus on a specific note (citation badge click)
          const node = findNodeForReadRequest(msg.note || '');
          if (node) {
            markDone(node.id);
            try { Graph.centerAt(node.x, node.y, 600); Graph.zoom(3, 800); } catch(e){}
            applyHighlight(node);
          }
          break;
        }
        case 'graphData': {
          // Live refresh — new knowledge was injected (EZER / A.U Training).
          // Replace data + tell force-graph to layout incrementally so existing
          // nodes keep their positions and only new nodes settle in.
          if (!msg.data || !Array.isArray(msg.data.nodes)) break;
          data.nodes = msg.data.nodes;
          data.links = msg.data.links || [];
          // Refresh derived lookups
          for (const k in nodeById) delete nodeById[k];
          data.nodes.forEach(n => { nodeById[n.id] = n; });
          for (const k in neighborsOf) delete neighborsOf[k];
          data.nodes.forEach(n => { neighborsOf[n.id] = new Set(); });
          data.links.forEach(l => {
            const sId = (l.source && l.source.id) || l.source;
            const tId = (l.target && l.target.id) || l.target;
            if (neighborsOf[sId]) neighborsOf[sId].add(tId);
            if (neighborsOf[tId]) neighborsOf[tId].add(sId);
          });
          for (const k in nodesByBasename) delete nodesByBasename[k];
          data.nodes.forEach(n => {
            const k = (n.name || '').toLowerCase();
            nodesByBasename[k] = nodesByBasename[k] || [];
            nodesByBasename[k].push(n);
          });
          // Push new graph data into force-graph
          Graph.graphData(data);
          // Stats refresh
          const newFolders = [...new Set(data.nodes.map(n => n.folder))].sort();
          newFolders.forEach((f, i) => { if (!folderColor[f]) folderColor[f] = PALETTE[i % PALETTE.length]; });
          document.getElementById('stats').textContent =
            data.nodes.length + ' 지식 · ' + data.links.length + ' 연결 · ' + newFolders.length + ' 폴더';
          // Append any newly seen folders to legend chip list
          const folderListEl = document.getElementById('folders-list');
          if (folderListEl) {
            const existing = new Set([...folderListEl.querySelectorAll('.folder-name')].map(el => el.textContent));
            const counts = {};
            data.nodes.forEach(n => { counts[n.folder] = (counts[n.folder] || 0) + 1; });
            newFolders.forEach(f => {
              if (existing.has(f || '/')) return;
              const row = document.createElement('div');
              row.className = 'folder-row';
              const dot = document.createElement('div');
              dot.className = 'folder-dot';
              dot.style.background = folderColor[f] || '#888';
              const name = document.createElement('div');
              name.className = 'folder-name';
              name.textContent = f || '/';
              const count = document.createElement('div');
              count.className = 'folder-count';
              count.textContent = counts[f] || 0;
              row.appendChild(dot); row.appendChild(name); row.appendChild(count);
              folderListEl.appendChild(row);
            });
          }
          // Pulse the freshly injected node so the user actually sees it
          if (msg.highlightTitle) {
            const node = findNodeForReadRequest(msg.highlightTitle);
            if (node) {
              thinkingActive.add(node.id);
              recomputeAdjacent();
              try { Graph.centerAt(node.x || 0, node.y || 0, 800); Graph.zoom(2.4, 900); } catch(e){}
              setTimeout(() => {
                thinkingActive.delete(node.id);
                markDone(node.id);
                recomputeAdjacent();
              }, 2200);
            }
          }
          break;
        }
      }
    });

    // Notify extension we're ready to receive events
    vscode.postMessage({ type: 'graph_ready' });
  </script>
</body>
</html>`;
}

/* ── Brand-styled webview panels (Approval gate + YouTube dashboard) ───
   Both panels share the same cyberpunk-green palette as the rest of the
   extension. Built as standalone WebviewViewProviders so they survive the
   sidebar being collapsed/reopened. They post messages back to the extension
   (approve/reject, refresh queue) and re-render on state changes. */

/* Full-screen dashboard CSS — separate from sidebar _BRAND_CSS because the
   editor pane has real width to design for. Glassmorphism + serious type
   scale + ambient gradient bg + lucide-style inline SVG icons. */
// _DASHBOARD_CSS moved to assets/webview/dashboard.css — load via _loadWebviewAsset('dashboard.css')
// _DASHBOARD_JS moved to assets/webview/dashboard.js — load via _loadWebviewAsset('dashboard.js')
/* API connections webview — same brand language as the dashboard but
   focused on a single task: filling in credentials. Calm layout, password
   fields with show/hide, save toast. */
// _API_PANEL_CSS moved to assets/webview/api-panel.css — load via _loadWebviewAsset('api-panel.css')
// _API_PANEL_JS moved to assets/webview/api-panel.js — load via _loadWebviewAsset('api-panel.js')
/* Slim sidebar variants — used by the compact status panels that link to
   the full-screen dashboard. Same brand cues as the dashboard but tightened
   for the ~220px sidebar width. */
const _SIDEBAR_BRAND_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  font-size: 12px; line-height: 1.5;
  background: linear-gradient(180deg, #06080d 0%, #0a0e15 100%);
  color: #e8eef7; padding: 0; min-height: 100vh;
}
.sb-head {
  display: flex; align-items: center; gap: 6px;
  padding: 12px 14px 8px; border-bottom: 1px solid rgba(255,255,255,.06);
}
.sb-title { font-size: 11px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: #fff; flex: 1; }
.sb-badge {
  font-size: 10px; padding: 2px 8px; border-radius: 999px;
  background: rgba(0,255,139,.10); color: #00ff8b; border: 1px solid rgba(0,255,139,.25);
  font-weight: 600;
}
.sb-cta { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,.05); }
.sb-btn {
  font-family: inherit; font-size: 11.5px; font-weight: 500;
  padding: 7px 11px; border-radius: 8px; cursor: pointer;
  background: rgba(28,34,48,.65); color: #e8eef7; border: 1px solid rgba(255,255,255,.08);
  transition: all .15s; display: inline-flex; align-items: center; gap: 5px;
}
.sb-btn:hover { background: rgba(40,46,60,.75); border-color: rgba(0,255,139,.25); transform: translateY(-1px); }
.sb-btn.primary {
  background: linear-gradient(135deg, #00ff8b 0%, #5eead4 100%);
  color: #001a0d; border-color: transparent; font-weight: 700;
  width: 100%; justify-content: center; padding: 9px 12px;
  box-shadow: 0 4px 14px rgba(0,255,139,.18);
}
.sb-btn.primary:hover { box-shadow: 0 8px 22px rgba(0,255,139,.28); }
.sb-btn.danger { color: #ff5260; border-color: rgba(255,82,96,.4); }
.sb-btn.danger:hover { background: rgba(255,82,96,.12); }
.sb-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.sb-card {
  background: rgba(20,26,38,.6); border: 1px solid rgba(255,255,255,.06);
  border-radius: 10px; padding: 10px 12px;
  position: relative; overflow: hidden;
}
.sb-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: linear-gradient(180deg, #fbbf24, #ff4d98);
}
.sb-card-head { display: flex; align-items: center; gap: 5px; }
.sb-card-title { font-size: 12px; font-weight: 600; color: #fff; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-card-meta { font-size: 10px; color: #8b95a3; margin-top: 3px; font-family: 'SF Mono', monospace; }
.sb-card-actions { display: flex; gap: 4px; margin-top: 8px; }
.sb-card-actions .sb-btn { padding: 4px 8px; font-size: 11px; flex: 1; justify-content: center; }
.sb-empty {
  text-align: center; padding: 24px 12px; color: #5b6675;
  border: 1px dashed rgba(255,255,255,.08); border-radius: 10px;
  font-size: 11px;
}
.sb-more {
  text-align: center; font-size: 10.5px; color: #8b95a3;
  padding: 8px; background: rgba(255,255,255,.02); border-radius: 8px;
}
.sb-toast {
  position: fixed; bottom: 12px; left: 12px; right: 12px;
  background: rgba(28,34,48,.95); border: 1px solid rgba(0,255,139,.4);
  color: #e8eef7; padding: 8px 12px; border-radius: 8px; font-size: 11.5px;
  opacity: 0; pointer-events: none; transition: opacity .25s;
  z-index: 100;
}
.sb-toast.show { opacity: 1; }
.sb-toast.err { border-color: rgba(255,82,96,.5); }
.kpi-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 12px 14px; }
.kpi-mini {
  background: rgba(20,26,38,.55); border: 1px solid rgba(255,255,255,.06);
  border-radius: 9px; padding: 9px 10px; text-align: center;
}
.kpi-mini-num { font-size: 16px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }
.kpi-mini-lbl { font-size: 9.5px; color: #8b95a3; text-transform: uppercase; letter-spacing: .6px; margin-top: 2px; }
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }
`;

const _BRAND_CSS = `
:root {
  --bg-deep:    #06080d;
  --bg-card:    rgba(20,24,32,.92);
  --bg-card-2:  rgba(28,32,42,.88);
  --border:     rgba(0,255,65,.18);
  --border-soft:rgba(255,255,255,.06);
  --accent:     #00ff41;
  --accent-dim: rgba(0,255,65,.55);
  --accent-glow: rgba(0,255,65,.18);
  --text:       #e6edf3;
  --text-dim:   #8b95a3;
  --text-bright:#fff;
  --warn:       #fbbf24;
  --danger:     #ff4d4f;
  --ok:         #34d399;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  background: linear-gradient(180deg, var(--bg-deep) 0%, #0a0d12 100%);
  color: var(--text);
  font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12.5px;
  line-height: 1.55;
  min-height: 100vh;
}
.brand-header {
  position: sticky; top: 0; z-index: 10;
  background: linear-gradient(180deg, rgba(10,12,18,.98), rgba(10,12,18,.85));
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  padding: 10px 14px;
  display: flex; align-items: center; gap: 8px;
}
.brand-title {
  font-weight: 700; letter-spacing: .3px;
  color: var(--text-bright);
  flex: 1; font-size: 12.5px;
}
.brand-badge {
  font-size: 10px; padding: 2px 7px; border-radius: 999px;
  background: var(--accent-glow); color: var(--accent);
  border: 1px solid var(--border);
}
.brand-btn {
  background: transparent; color: var(--accent-dim); border: 1px solid var(--border);
  padding: 4px 9px; border-radius: 6px; font-size: 11px; cursor: pointer;
  font-family: inherit; transition: all .15s;
}
.brand-btn:hover {
  background: var(--accent-glow); color: var(--accent); border-color: var(--accent-dim);
}
.brand-btn.primary {
  background: var(--accent); color: var(--bg-deep); border-color: var(--accent); font-weight: 700;
}
.brand-btn.primary:hover { background: #6cff7c; box-shadow: 0 0 14px var(--accent-glow); }
.brand-btn.danger { color: var(--danger); border-color: rgba(255,77,79,.4); }
.brand-btn.danger:hover { background: rgba(255,77,79,.12); color: #ffb3b4; }
.body-wrap { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.empty-state {
  text-align: center; color: var(--text-dim); padding: 32px 16px;
  border: 1px dashed var(--border-soft); border-radius: 10px;
  background: rgba(255,255,255,.02);
}
.empty-state .icon { font-size: 28px; margin-bottom: 8px; opacity: .6; }
.card {
  background: var(--bg-card); border: 1px solid var(--border-soft); border-radius: 12px;
  padding: 12px 14px;
  position: relative; overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
}
.card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--accent-dim);
}
.card:hover { border-color: var(--border); box-shadow: 0 0 24px var(--accent-glow); }
.card-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
}
.card-emoji { font-size: 16px; }
.card-title { font-weight: 600; color: var(--text-bright); flex: 1; font-size: 12.5px; }
.card-id {
  font-family: 'SF Mono', monospace; font-size: 10px; color: var(--text-dim);
  background: rgba(255,255,255,.04); padding: 1px 5px; border-radius: 4px;
}
.card-body { color: var(--text-dim); font-size: 11.5px; white-space: pre-wrap; }
.card-body strong { color: var(--text); }
.card-actions { display: flex; gap: 6px; margin-top: 10px; }
.split { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 8px; }
.split-section {
  background: rgba(0,0,0,.25); border: 1px solid var(--border-soft); border-radius: 8px;
  padding: 8px 10px; font-size: 11px;
}
.split-section .label {
  font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .5px;
  margin-bottom: 4px;
}
.kpi-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.kpi {
  background: rgba(0,0,0,.3); border: 1px solid var(--border-soft); border-radius: 8px;
  padding: 9px 8px; text-align: center;
}
.kpi-num { font-size: 17px; font-weight: 700; color: var(--accent); }
.kpi-label { font-size: 9.5px; color: var(--text-dim); margin-top: 2px; text-transform: uppercase; letter-spacing: .4px; }
.video-grid { display: grid; grid-template-columns: 1fr; gap: 6px; }
.video-row {
  display: grid; grid-template-columns: 64px 1fr; gap: 8px;
  background: rgba(0,0,0,.25); border-radius: 8px; padding: 6px;
  border: 1px solid var(--border-soft);
}
.video-thumb {
  width: 64px; height: 36px; background: var(--bg-deep); border-radius: 4px;
  background-size: cover; background-position: center;
}
.video-meta .video-title {
  font-size: 11.5px; font-weight: 500; color: var(--text); line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.video-meta .video-stats {
  font-size: 10px; color: var(--text-dim); margin-top: 3px;
  display: flex; gap: 8px;
}
.section-head {
  font-size: 10.5px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .8px;
  margin: 6px 0 4px; font-weight: 600;
  display: flex; align-items: center; gap: 6px;
}
.pulse { display: inline-block; width: 6px; height: 6px; border-radius: 999px;
  background: var(--accent); box-shadow: 0 0 6px var(--accent);
  animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: .5; transform: scale(.95); } 50% { opacity: 1; transform: scale(1.15); } }
.input-row { display: flex; gap: 6px; margin-bottom: 8px; }
.input-row input {
  flex: 1; background: rgba(0,0,0,.3); border: 1px solid var(--border-soft);
  border-radius: 6px; padding: 6px 9px; color: var(--text); font-size: 12px;
  font-family: inherit;
}
.input-row input:focus { outline: none; border-color: var(--accent-dim); }
.toast {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
  background: var(--bg-card); border: 1px solid var(--accent-dim);
  color: var(--text); padding: 8px 14px; border-radius: 8px; font-size: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,.6), 0 0 18px var(--accent-glow);
  opacity: 0; pointer-events: none; transition: opacity .25s;
  max-width: 90vw; z-index: 100;
}
.toast.show { opacity: 1; }
.toast.err { border-color: var(--danger); }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 3px; }
::-webkit-scrollbar-track { background: transparent; }
`;

class ApprovalsPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'connectAiLab.approvals';
    private _view?: vscode.WebviewView;
    private _refreshTicker: NodeJS.Timeout | null = null;

    resolveWebviewView(view: vscode.WebviewView): void {
        this._view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = this._html();
        view.webview.onDidReceiveMessage(async (msg) => {
            if (msg?.type === 'refresh') this._post();
            else if (msg?.type === 'openDash') {
                vscode.commands.executeCommand('connectAiLab.dashboard.open');
            } else if (msg?.type === 'approve' && msg.id) {
                const r = await resolveApproval(msg.id, 'approved');
                this._post(r.message);
            } else if (msg?.type === 'reject' && msg.id) {
                const r = await resolveApproval(msg.id, 'rejected');
                this._post(r.message);
            } else if (msg?.type === 'open' && msg.id) {
                try {
                    const ap = listPendingApprovals().find(a => a.id.endsWith(msg.id));
                    if (ap) {
                        const p = path.join(_approvalsPendingDir(), `${ap.id}.md`);
                        const doc = await vscode.workspace.openTextDocument(p);
                        vscode.window.showTextDocument(doc);
                    }
                } catch { /* ignore */ }
            }
        });
        /* Poll-refresh — pending approvals can be created from any agent any
           time, so the panel needs to re-render even when the user isn't
           interacting with it. 8s is a sweet spot — fast enough to feel
           live, slow enough to not drain battery. */
        this._refreshTicker = setInterval(() => this._post(), 8000);
        view.onDidDispose(() => {
            if (this._refreshTicker) clearInterval(this._refreshTicker);
            this._refreshTicker = null;
            this._view = undefined;
        });
        this._post();
    }

    public refresh() { this._post(); }

    private _post(toast?: string) {
        if (!this._view) return;
        const items = listPendingApprovals().map(a => {
            const ag = AGENTS[a.agentId];
            return {
                id: a.id, shortId: a.id.slice(-9),
                agent: a.agentId,
                emoji: ag?.emoji || '🤖',
                name: ag?.name || a.agentId,
                kind: a.kind,
                title: a.title,
                summary: a.summary,
                createdAt: a.createdAt,
            };
        });
        this._view.webview.postMessage({ type: 'state', items, toast });
    }

    private _html(): string {
        /* Slim sidebar version — full UX lives in the editor-pane dashboard.
           Here we show: top 3 pending approvals (compact), big "둘러보기"
           CTA. Quick approval actions still inline so the user can decide
           without context-switching. */
        return `<!doctype html><html><head><meta charset="utf-8"><style>${_SIDEBAR_BRAND_CSS}</style></head><body>
<div class="sb-head">
  <span class="sb-title">⏳ 승인 대기</span>
  <span class="sb-badge" id="cnt">0</span>
</div>
<div class="sb-cta">
  <button class="sb-btn primary" id="openDash">🏢 우리 회사 →</button>
</div>
<div id="list" class="sb-body"></div>
<div class="sb-toast" id="toast"></div>
<script>
const vscode = acquireVsCodeApi();
const list = document.getElementById('list');
const cnt  = document.getElementById('cnt');
const toast = document.getElementById('toast');
document.getElementById('openDash').onclick = () => vscode.postMessage({ type: 'openDash' });
function showToast(msg, isErr) { toast.textContent = msg; toast.classList.toggle('err', !!isErr); toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2400); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
window.addEventListener('message', e => {
  const m = e.data;
  if (m.type !== 'state') return;
  cnt.textContent = m.items.length;
  if (m.toast) showToast(m.toast, /실패|찾지 못|FAIL/.test(m.toast));
  if (m.items.length === 0) {
    list.innerHTML = '<div class="sb-empty">✅ 대기 액션 없음</div>';
    return;
  }
  /* Show top 3 only — rest in the dashboard. */
  list.innerHTML = m.items.slice(0, 3).map(it =>
    '<div class="sb-card"><div class="sb-card-head"><span>' + it.emoji + '</span>'
    + '<span class="sb-card-title">' + esc(it.title) + '</span></div>'
    + '<div class="sb-card-meta">' + esc(it.name) + ' · ' + esc(it.shortId) + '</div>'
    + '<div class="sb-card-actions">'
    +   '<button class="sb-btn primary" data-act="approve" data-id="' + esc(it.shortId) + '">✅</button>'
    +   '<button class="sb-btn danger"  data-act="reject"  data-id="' + esc(it.shortId) + '">✖️</button>'
    +   '<button class="sb-btn"          data-act="open"    data-id="' + esc(it.shortId) + '">📄</button>'
    + '</div></div>'
  ).join('');
  if (m.items.length > 3) {
    list.innerHTML += '<div class="sb-more">+' + (m.items.length - 3) + '건 더 — 둘러보기에서 확인</div>';
  }
  list.querySelectorAll('button[data-act]').forEach(btn => {
    btn.onclick = () => vscode.postMessage({ type: btn.dataset.act, id: btn.dataset.id });
  });
});
vscode.postMessage({ type: 'refresh' });
</script>
</body></html>`;
    }
}

let _approvalsPanelProvider: ApprovalsPanelProvider | null = null;

class YouTubeDashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'connectAiLab.youtube';
    private _view?: vscode.WebviewView;

    resolveWebviewView(view: vscode.WebviewView): void {
        this._view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = this._html();
        view.webview.onDidReceiveMessage(async (msg) => {
            try {
                if (msg?.type === 'refresh') {
                    await this._sendChannelData();
                } else if (msg?.type === 'openDash') {
                    vscode.commands.executeCommand('connectAiLab.dashboard.open');
                } else if (msg?.type === 'addCompetitor' && msg.handleOrId) {
                    await this._addCompetitor(msg.handleOrId);
                } else if (msg?.type === 'removeCompetitor' && msg.id) {
                    await this._removeCompetitor(msg.id);
                } else if (msg?.type === 'queueComments') {
                    const r = await _youtubeCommentReplyDraftBatch({});
                    this._view?.webview.postMessage({ type: 'toast', text: r.reason ? `⚠️ ${r.reason}` : `📺 ${r.drafted}건 큐 생성, ${r.skipped}건 스킵`, err: !!r.reason });
                    await this._sendChannelData();
                } else if (msg?.type === 'connectOAuth') {
                    vscode.commands.executeCommand('connectAiLab.youtube.connectOAuth');
                }
            } catch (e: any) {
                this._view?.webview.postMessage({ type: 'toast', text: `⚠️ ${e?.message || e}`, err: true });
            }
        });
        view.onDidDispose(() => { this._view = undefined; });
        this._sendChannelData().catch(() => { /* ignore boot errors */ });
    }

    public refresh() { this._sendChannelData().catch(() => {}); }

    private _competitorsPath(): string {
        return path.join(getCompanyDir(), '_agents', 'youtube', 'competitors.json');
    }
    private _readCompetitors(): string[] {
        try {
            const txt = _safeReadText(this._competitorsPath());
            const arr = JSON.parse(txt || '[]');
            return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
        } catch { return []; }
    }
    private _writeCompetitors(ids: string[]) {
        try {
            fs.mkdirSync(path.dirname(this._competitorsPath()), { recursive: true });
            fs.writeFileSync(this._competitorsPath(), JSON.stringify(ids, null, 2));
        } catch { /* ignore */ }
    }

    private async _addCompetitor(handleOrId: string) {
        const cfg = this._loadCfg();
        if (!cfg.apiKey) { this._view?.webview.postMessage({ type: 'toast', text: '⚠️ YOUTUBE_API_KEY 미설정', err: true }); return; }
        let channelId = handleOrId.trim();
        /* Resolve @handle / channel name → channelId via search.list. */
        if (!/^UC[A-Za-z0-9_-]{20,}$/.test(channelId)) {
            try {
                const r = await axios.get('https://www.googleapis.com/youtube/v3/search', {
                    params: { part: 'snippet', q: channelId.replace(/^@/, ''), type: 'channel', maxResults: 1, key: cfg.apiKey },
                    timeout: 10000,
                });
                const found = r.data?.items?.[0]?.snippet?.channelId;
                if (found) channelId = found;
                else { this._view?.webview.postMessage({ type: 'toast', text: `⚠️ 채널 못 찾음: ${handleOrId}`, err: true }); return; }
            } catch (e: any) {
                this._view?.webview.postMessage({ type: 'toast', text: `⚠️ 검색 실패: ${e?.message || e}`, err: true }); return;
            }
        }
        const list = this._readCompetitors();
        if (list.includes(channelId)) { this._view?.webview.postMessage({ type: 'toast', text: '이미 등록됨' }); return; }
        list.push(channelId);
        this._writeCompetitors(list);
        this._view?.webview.postMessage({ type: 'toast', text: '✅ 경쟁 채널 추가됨' });
        await this._sendChannelData();
    }

    private async _removeCompetitor(id: string) {
        const list = this._readCompetitors().filter(x => x !== id);
        this._writeCompetitors(list);
        await this._sendChannelData();
    }

    private _loadCfg(): { apiKey: string; channelId: string } {
        const cfgPath = path.join(getCompanyDir(), '_agents', 'youtube', 'config.md');
        const txt = _safeReadText(cfgPath);
        const apiM = txt.match(/YOUTUBE_API_KEY\s*[:：=]\s*([A-Za-z0-9_\-]+)/);
        const chM  = txt.match(/YOUTUBE_CHANNEL_ID\s*[:：=]\s*([A-Za-z0-9_\-]+)/);
        return { apiKey: apiM ? apiM[1] : '', channelId: chM ? chM[1] : '' };
    }

    private async _fetchChannelSummary(channelId: string, apiKey: string): Promise<any | null> {
        try {
            const r = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
                params: { part: 'snippet,statistics,contentDetails', id: channelId, key: apiKey },
                timeout: 10000,
            });
            const it = r.data?.items?.[0];
            if (!it) return null;
            return {
                id: channelId,
                title: it.snippet?.title || '',
                desc: (it.snippet?.description || '').slice(0, 200),
                thumb: it.snippet?.thumbnails?.default?.url || '',
                subs: parseInt(it.statistics?.subscriberCount || '0', 10),
                views: parseInt(it.statistics?.viewCount || '0', 10),
                videos: parseInt(it.statistics?.videoCount || '0', 10),
                uploadsPlaylist: it.contentDetails?.relatedPlaylists?.uploads || '',
            };
        } catch { return null; }
    }

    private async _fetchRecentVideos(playlistId: string, apiKey: string, max = 5): Promise<any[]> {
        if (!playlistId) return [];
        try {
            const r = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
                params: { part: 'snippet,contentDetails', playlistId, maxResults: max, key: apiKey },
                timeout: 10000,
            });
            const ids = (r.data?.items || []).map((x: any) => x.contentDetails?.videoId).filter(Boolean);
            if (ids.length === 0) return [];
            const stats = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: { part: 'snippet,statistics', id: ids.join(','), key: apiKey },
                timeout: 10000,
            });
            return (stats.data?.items || []).map((it: any) => ({
                id: it.id,
                title: it.snippet?.title || '',
                thumb: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || '',
                views: parseInt(it.statistics?.viewCount || '0', 10),
                likes: parseInt(it.statistics?.likeCount || '0', 10),
                comments: parseInt(it.statistics?.commentCount || '0', 10),
                publishedAt: it.snippet?.publishedAt || '',
            }));
        } catch { return []; }
    }

    private async _sendChannelData(): Promise<void> {
        if (!this._view) return;
        const cfg = this._loadCfg();
        if (!cfg.apiKey || !cfg.channelId) {
            this._view.webview.postMessage({ type: 'state', error: 'API key / Channel ID 미설정. `_agents/youtube/config.md` 에서 채워주세요.' });
            return;
        }
        const oauthConnected = isYoutubeOAuthConnected();
        const my = await this._fetchChannelSummary(cfg.channelId, cfg.apiKey);
        if (!my) {
            this._view.webview.postMessage({ type: 'state', error: '내 채널 조회 실패 — API key 또는 channel id 확인 필요' });
            return;
        }
        const myVideos = await this._fetchRecentVideos(my.uploadsPlaylist, cfg.apiKey, 5);
        /* Compute simple engagement KPI: avg like rate per recent video. */
        const totalViews = myVideos.reduce((s, v) => s + v.views, 0);
        const totalEng   = myVideos.reduce((s, v) => s + v.likes + v.comments, 0);
        const engagementPct = totalViews > 0 ? ((totalEng / totalViews) * 100).toFixed(2) : '0.00';
        const competitors: any[] = [];
        for (const cid of this._readCompetitors().slice(0, 5)) {
            const c = await this._fetchChannelSummary(cid, cfg.apiKey);
            if (c) competitors.push(c);
        }
        const pendingComments = listPendingApprovals().filter(a => a.kind === 'youtube.comment_reply').length;
        let analytics: any = null;
        if (oauthConnected) {
            try {
                analytics = await fetchYouTubeAnalyticsSummary();
            } catch { analytics = { error: 'Analytics 호출 실패' }; }
        }
        this._view.webview.postMessage({
            type: 'state',
            my, myVideos,
            engagementPct,
            competitors,
            pendingComments,
            oauthConnected,
            analytics,
        });
    }

    private _html(): string {
        /* Slim sidebar — top KPIs (subs / views / engagement / pending),
           "회사 둘러보기" CTA. Full UX lives in the dashboard editor pane. */
        return `<!doctype html><html><head><meta charset="utf-8"><style>${_SIDEBAR_BRAND_CSS}</style></head><body>
<div class="sb-head">
  <span class="sb-title">📺 YouTube</span>
  <span class="sb-badge" id="oauthBadge">API key</span>
</div>
<div class="kpi-mini-grid" id="kpis">
  <div class="kpi-mini"><div class="kpi-mini-num" id="kSubs">–</div><div class="kpi-mini-lbl">구독자</div></div>
  <div class="kpi-mini"><div class="kpi-mini-num" id="kViews">–</div><div class="kpi-mini-lbl">총 조회</div></div>
  <div class="kpi-mini"><div class="kpi-mini-num" id="kEng">–</div><div class="kpi-mini-lbl">참여율</div></div>
  <div class="kpi-mini"><div class="kpi-mini-num" id="kAprPending">0</div><div class="kpi-mini-lbl">답장 대기</div></div>
</div>
<div class="sb-cta">
  <button class="sb-btn primary" id="openDash">🏢 우리 회사 →</button>
</div>
<div class="sb-body">
  <button class="sb-btn" id="queueBtn" style="width:100%;justify-content:center;">📥 댓글 큐 갱신</button>
  <button class="sb-btn" id="oauthBtn" style="width:100%;justify-content:center;display:none;">🔐 OAuth 연결</button>
</div>
<div class="sb-toast" id="toast"></div>
<script>
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Number(n)||0; if(n>=1e9) return (n/1e9).toFixed(1)+'B'; if(n>=1e6) return (n/1e6).toFixed(1)+'M'; if(n>=1e3) return (n/1e3).toFixed(1)+'K'; return String(n); };
function showToast(msg, isErr){ const t=$('toast'); t.textContent=msg; t.classList.toggle('err',!!isErr); t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2400); }
$('openDash').onclick = () => vscode.postMessage({ type: 'openDash' });
$('queueBtn').onclick = () => vscode.postMessage({ type: 'queueComments' });
$('oauthBtn').onclick = () => vscode.postMessage({ type: 'connectOAuth' });
window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'toast') { showToast(m.text, m.err); return; }
  if (m.type !== 'state') return;
  if (m.error) {
    $('kSubs').textContent = '–'; $('kViews').textContent = '–'; $('kEng').textContent = '–';
    return;
  }
  $('oauthBadge').textContent = m.oauthConnected ? 'OAuth ✅' : 'API key';
  $('oauthBadge').style.color = m.oauthConnected ? '#34d399' : '#00ff8b';
  $('oauthBtn').style.display = m.oauthConnected ? 'none' : '';
  if (m.my) {
    $('kSubs').textContent = fmt(m.my.subs);
    $('kViews').textContent = fmt(m.my.views);
    $('kEng').textContent = (m.engagementPct || '0') + '%';
  }
  $('kAprPending').textContent = m.pendingComments || 0;
});
vscode.postMessage({ type: 'refresh' });
</script>
</body></html>`;
    }
}

let _ytDashboardProvider: YouTubeDashboardProvider | null = null;

/* ── Full-screen Company Dashboard ────────────────────────────────────────
   The sidebar webviews are inherently constrained to ~220px wide; analytics
   dashboards need real width. This class opens a full editor-pane webview
   ("회사 둘러보기") that is the proper home for the polished design — the
   sidebar versions become quick-glance status cards that link here.
   Singleton: re-opening the command brings the existing panel forward
   instead of stacking. */
class CompanyDashboardPanel {
    public static current: CompanyDashboardPanel | null = null;
    public static readonly viewType = 'connectAiLab.dashboard';
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _refreshTimer: NodeJS.Timeout | null = null;

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.ViewColumn.Active;
        if (CompanyDashboardPanel.current) {
            CompanyDashboardPanel.current._panel.reveal(column);
            CompanyDashboardPanel.current.refresh();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            CompanyDashboardPanel.viewType,
            '👥 직원 에이전트 보기',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        CompanyDashboardPanel.current = new CompanyDashboardPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, _extUri: vscode.Uri) {
        this._panel = panel;
        this._panel.webview.html = this._html();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async (msg) => {
            try {
                if (msg?.type === 'refresh') {
                    await this._sendState();
                } else if (msg?.type === 'queueComments') {
                    const r = await _youtubeCommentReplyDraftBatch({});
                    this._postToast(r.reason ? `⚠️ ${r.reason}` : `📺 ${r.drafted}건 큐 생성, ${r.skipped}건 스킵`, !!r.reason);
                    await this._sendState();
                } else if (msg?.type === 'connectOAuth') {
                    vscode.commands.executeCommand('connectAiLab.youtube.connectOAuth');
                } else if (msg?.type === 'addCompetitor' && msg.handleOrId) {
                    if (_ytDashboardProvider) {
                        /* Reuse the storage helpers on the sidebar provider — same source of truth. */
                        await (_ytDashboardProvider as any)._addCompetitor?.(msg.handleOrId);
                    }
                    await this._sendState();
                } else if (msg?.type === 'removeCompetitor' && msg.id) {
                    if (_ytDashboardProvider) {
                        await (_ytDashboardProvider as any)._removeCompetitor?.(msg.id);
                    }
                    await this._sendState();
                } else if (msg?.type === 'approve' && msg.id) {
                    const r = await resolveApproval(msg.id, 'approved');
                    this._postToast(r.message, !r.ok);
                    await this._sendState();
                } else if (msg?.type === 'reject' && msg.id) {
                    const r = await resolveApproval(msg.id, 'rejected');
                    this._postToast(r.message, !r.ok);
                    await this._sendState();
                } else if (msg?.type === 'openApproval' && msg.id) {
                    try {
                        const ap = listPendingApprovals().find(a => a.id.endsWith(msg.id));
                        if (ap) {
                            const p = path.join(_approvalsPendingDir(), `${ap.id}.md`);
                            const doc = await vscode.workspace.openTextDocument(p);
                            vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                        }
                    } catch { /* ignore */ }
                } else if (msg?.type === 'fireBriefing') {
                    await _runDailyBriefingOnce(true);
                    this._postToast('🌅 데일리 브리핑 발사 완료');
                } else if (msg?.type === 'getAgentModelRouting') {
                    /* v2.89.26 — 모델 라우팅 모달 데이터 송출. 설치된 모델 + 현재 매핑 */
                    try {
                        const installed = await listInstalledModels();
                        const map = readAgentModelMap();
                        const defaultModel = getConfig().defaultModel || '';
                        /* v2.89.36 — 시스템 사양도 같이 보내서 모달이 "이 머신에서 안전한 모델"
                           표시할 수 있게. 각 모델의 메모리 추정치도 첨부. */
                        const specs = getSystemSpecs();
                        const installedWithMem = installed.map(m => ({
                            ...m,
                            estMemGB: estimateModelMemoryGB(m.id),
                            safe: estimateModelMemoryGB(m.id) <= specs.safeModelBudgetGB,
                        }));
                        this._panel.webview.postMessage({
                            type: 'agentModelRoutingData',
                            installed: installedWithMem,
                            map,
                            defaultModel,
                            agents: AGENT_ORDER.map(id => ({ id, name: AGENTS[id]?.name || id, emoji: AGENTS[id]?.emoji || '🤖', role: AGENTS[id]?.role || '' })),
                            specs,
                        });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'agentModelRoutingData', installed: [], map: {}, defaultModel: '', agents: [], error: e?.message || String(e) });
                    }
                } else if (msg?.type === 'getSystemSpecs') {
                    /* v2.89.36 — 트렌딩 모달이 사용자 머신 사양 받아서 모델 추천에 활용 */
                    try {
                        this._panel.webview.postMessage({ type: 'systemSpecsData', specs: getSystemSpecs() });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'systemSpecsData', specs: null, error: e?.message || String(e) });
                    }
                } else if (msg?.type === 'fetchTrendingModels') {
                    /* v2.89.30 — HuggingFace API에서 인기 텍스트 LLM 조회.
                       객관적 데이터 (다운로드 수, 좋아요, 최신성) 기반 추천.
                       사용자가 어떤 모델이 진짜 인기 있는지 한눈에 파악. */
                    try {
                        const limit = Math.min(30, Math.max(5, Number(msg.limit) || 20));
                        const r = await axios.get('https://huggingface.co/api/models', {
                            params: {
                                pipeline_tag: 'text-generation',
                                sort: 'downloads',
                                direction: -1,
                                limit,
                                full: false,
                            },
                            timeout: 10000,
                            validateStatus: () => true,
                        });
                        if (r.status >= 200 && r.status < 300 && Array.isArray(r.data)) {
                            const models = r.data.map((m: any) => ({
                                id: m.id || m.modelId || '',
                                downloads: m.downloads || 0,
                                likes: m.likes || 0,
                                lastModified: m.lastModified || '',
                                tags: Array.isArray(m.tags) ? m.tags.slice(0, 8) : [],
                            })).filter((m: any) => m.id);
                            this._panel.webview.postMessage({ type: 'trendingModelsData', models });
                        } else {
                            this._panel.webview.postMessage({ type: 'trendingModelsData', models: [], error: `HF API ${r.status}` });
                        }
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'trendingModelsData', models: [], error: e?.message || String(e) });
                    }
                } else if (msg?.type === 'autoOrchestrateModels') {
                    /* v2.89.27 — "✨ 자동 추천" 버튼: 시스템이 알아서 매핑 계산 */
                    try {
                        const installed = await listInstalledModels();
                        const auto = _autoOrchestrateModelMap(installed);
                        this._panel.webview.postMessage({ type: 'agentModelRoutingAuto', map: auto });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'agentModelRoutingAuto', map: {}, error: e?.message || String(e) });
                    }
                } else if (msg?.type === 'saveAgentModelRouting' && msg.map && typeof msg.map === 'object') {
                    /* 매핑 저장. 빈 문자열 키는 default 사용 의미 → 매핑에서 제거 */
                    try {
                        const cleaned: Record<string, string> = {};
                        for (const [k, v] of Object.entries(msg.map)) {
                            const sv = String(v || '').trim();
                            if (sv) cleaned[k] = sv;
                        }
                        writeAgentModelMap(cleaned);
                        this._postToast(`🧠 에이전트별 모델 라우팅 저장됨 (${Object.keys(cleaned).length}건)`);
                        this._panel.webview.postMessage({ type: 'agentModelRoutingSaved', ok: true });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'agentModelRoutingSaved', ok: false, error: e?.message || String(e) });
                    }
                } else if (msg?.type === 'getReportSchedule') {
                    /* v2.89.24 — 보고 스케줄 UI 데이터 송출 */
                    try {
                        const sch = readReportSchedule();
                        this._panel.webview.postMessage({ type: 'reportScheduleData', entries: sch.entries });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'reportScheduleData', entries: [], error: e?.message || String(e) });
                    }
                } else if (msg?.type === 'saveReportSchedule' && Array.isArray(msg.entries)) {
                    /* 사용자가 모달에서 저장 → 디스크 + 토스트 */
                    try {
                        writeReportSchedule({ entries: msg.entries });
                        this._postToast(`📆 보고 스케줄 ${msg.entries.length}건 저장됨`);
                        this._panel.webview.postMessage({ type: 'reportScheduleData', entries: msg.entries });
                    } catch (e: any) {
                        this._postToast(`⚠️ 스케줄 저장 실패: ${e?.message || e}`, true);
                    }
                } else if (msg?.type === 'saveSkillConfig' && typeof msg.agentId === 'string' && typeof msg.skillName === 'string') {
                    /* v2.89.17 — 인앱 도구 설정 저장. tool config는 도구 자체 .json,
                       shared는 youtube_account.json 같은 공유 파일에 저장. */
                    try {
                        const updates = msg.updates || {};
                        const toolDir = path.join(getCompanyDir(), '_agents', msg.agentId, 'tools');
                        /* 도구 자체 config */
                        if (updates.tool && Object.keys(updates.tool).length > 0) {
                            const toolJsonPath = path.join(toolDir, `${msg.skillName}.json`);
                            let cur: Record<string, any> = {};
                            try {
                                if (fs.existsSync(toolJsonPath)) cur = JSON.parse(fs.readFileSync(toolJsonPath, 'utf-8') || '{}');
                            } catch { /* malformed */ }
                            for (const [k, v] of Object.entries(updates.tool)) {
                                cur[k] = v;
                            }
                            fs.writeFileSync(toolJsonPath, JSON.stringify(cur, null, 2));
                        }
                        /* 공유 config (현재는 youtube 한정) */
                        if (updates.shared && Object.keys(updates.shared).length > 0 && msg.agentId === 'youtube') {
                            const sharedPath = path.join(toolDir, 'youtube_account.json');
                            let cur: Record<string, any> = {};
                            try {
                                if (fs.existsSync(sharedPath)) cur = JSON.parse(fs.readFileSync(sharedPath, 'utf-8') || '{}');
                            } catch { /* malformed */ }
                            for (const [k, v] of Object.entries(updates.shared)) {
                                cur[k] = v;
                            }
                            fs.writeFileSync(sharedPath, JSON.stringify(cur, null, 2));
                        }
                        this._postToast(`💾 ${msg.skillName} 설정 저장됨`);
                        await this._sendState();
                        /* 모달에 "저장 완료" 알림 */
                        this._panel.webview.postMessage({ type: 'skillConfigSaved', skillName: msg.skillName, ok: true });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'skillConfigSaved', skillName: msg.skillName, ok: false, error: e?.message || String(e) });
                    }
                } else if (msg?.type === 'runSingleSkill' && typeof msg.agentId === 'string' && typeof msg.skillName === 'string') {
                    /* v2.89.12 — 단독 스킬 실행. 사용자가 에이전트 모달에서 스킬
                       타일 클릭 → ▶ 실행 누르면 그 도구만 spawn해서 stdout 캡처
                       후 모달에 라이브 표시. */
                    try {
                        const tools = listAgentTools(msg.agentId);
                        const tool = tools.find(t => t.name === msg.skillName);
                        if (!tool) {
                            this._panel.webview.postMessage({ type: 'skillRunOutput', ok: false, output: `⚠️ 스킬 못 찾음: ${msg.skillName}` });
                        } else {
                            const scriptPath = tool.scriptPath;
                            const cwd = path.dirname(scriptPath);
                            const cmd = `python3 ${JSON.stringify(path.basename(scriptPath))}`;
                            const r = await runCommandCaptured(cmd, cwd, () => { /* silent */ }, 90000);
                            this._panel.webview.postMessage({
                                type: 'skillRunOutput',
                                ok: r.exitCode === 0,
                                output: (r.output || '').slice(-8000),
                                exitCode: r.exitCode,
                                timedOut: r.timedOut,
                            });
                        }
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'skillRunOutput', ok: false, output: `⚠️ 실행 에러: ${e?.message || e}` });
                    }
                } else if (msg?.type === 'cancelTask' && typeof msg.id === 'string') {
                    /* v2.88.4 — 멈춘 작업 정리. shortId(마지막 9자리)로 매칭 후
                       status='cancelled' + evidence 기록. */
                    try {
                        const all = readTracker().tasks;
                        const target = all.find(t => t.id.endsWith(msg.id)) || all.find(t => t.id === msg.id);
                        if (!target) {
                            this._postToast(`⚠️ 작업을 못 찾았어요 (id: ${msg.id})`, true);
                        } else {
                            updateTrackerTask(target.id, { status: 'cancelled', evidence: '대시보드에서 사용자 취소' });
                            this._postToast(`✖️ 취소됨: ${target.title.slice(0, 40)}`);
                            await this._sendState();
                        }
                    } catch (e: any) {
                        this._postToast(`⚠️ 취소 실패: ${e?.message || e}`, true);
                    }
                } else if (msg?.type === 'setAgentRagMode' && typeof msg.agentId === 'string') {
                    /* v2.87.9 — 대시보드 모달의 자가검증 토글에서 호출. mode는
                       'self-rag' 또는 'standard'. 디스크 갱신 후 state 새로고침 →
                       모달 칩이 자동 동기화됨. */
                    try {
                        const mode = msg.mode === 'self-rag' ? 'self-rag' : 'standard';
                        writeAgentRagMode(msg.agentId, mode);
                        const a = AGENTS[msg.agentId];
                        const label = mode === 'self-rag' ? '🧠 자가검증 ON' : '🧠 자가검증 OFF';
                        this._postToast(`${a?.name || msg.agentId}: ${label}`);
                        await this._sendState();
                    } catch (e: any) {
                        this._postToast(`⚠️ 자가검증 모드 변경 실패: ${e?.message || e}`, true);
                    }
                } else if (msg?.type === 'openAgentFolder' && typeof msg.agentId === 'string') {
                    /* v2.87.6 — 대시보드 팀 카드 클릭 → 에이전트 폴더 OS 탐색기에서
                       열기. _agents/<id>/ 안에 지식·스킬·메모리·세션 다 있어서
                       그게 "에이전트 들여다보기"의 정직한 출구. VS Code 사이드바
                       에서도 같은 폴더가 열림. */
                    try {
                        const folderPath = path.join(getCompanyDir(), '_agents', msg.agentId);
                        if (!fs.existsSync(folderPath)) {
                            this._postToast(`⚠️ ${msg.agentId} 폴더를 찾을 수 없어요`, true);
                        } else {
                            const uri = vscode.Uri.file(folderPath);
                            vscode.commands.executeCommand('revealFileInOS', uri);
                            this._postToast(`📁 ${msg.agentId} 폴더 열기`);
                        }
                    } catch (e: any) {
                        this._postToast(`⚠️ 폴더 열기 실패: ${e?.message || e}`, true);
                    }
                }
            } catch (e: any) {
                this._postToast(`⚠️ ${e?.message || e}`, true);
            }
        }, null, this._disposables);
        /* Reactive refresh — when tracker writes happen we want to update KPIs. */
        this._disposables.push(onTrackerChanged(() => this._sendState().catch(() => {})));
        /* Periodic light refresh for time-based UI (countdowns) and remote state. */
        this._refreshTimer = setInterval(() => this._sendState().catch(() => {}), 30 * 1000);
        this._sendState().catch(() => { /* ignore boot */ });
    }

    public refresh() { this._sendState().catch(() => {}); }

    private _postToast(text: string, err = false) {
        try { this._panel.webview.postMessage({ type: 'toast', text, err }); } catch { /* ignore */ }
    }

    private _loadCfg(): { apiKey: string; channelId: string } {
        const cfgPath = path.join(getCompanyDir(), '_agents', 'youtube', 'config.md');
        const txt = _safeReadText(cfgPath);
        const apiM = txt.match(/YOUTUBE_API_KEY\s*[:：=]\s*([A-Za-z0-9_\-]+)/);
        const chM  = txt.match(/YOUTUBE_CHANNEL_ID\s*[:：=]\s*([A-Za-z0-9_\-]+)/);
        return { apiKey: apiM ? apiM[1] : '', channelId: chM ? chM[1] : '' };
    }

    private async _sendState() {
        const cfg = this._loadCfg();
        const oauthConnected = isYoutubeOAuthConnected();
        const company = readCompanyName() || '1인 기업';
        const tracker = readTracker().tasks;
        const openTasks = tracker.filter(t => t.status !== 'done' && t.status !== 'cancelled');
        const overdueTasks = openTasks.filter(t => t.dueAt && new Date(t.dueAt).getTime() < Date.now()).length;
        const urgentTasks = openTasks.filter(t => _coercePriority(t.priority) === 'urgent').length;
        const pendingApprovals = listPendingApprovals();

        let yt: any = { configured: false };
        if (cfg.apiKey && cfg.channelId) {
            try {
                const my = await this._fetchChannelSummary(cfg.channelId, cfg.apiKey);
                if (my) {
                    const myVideos = await this._fetchRecentVideos(my.uploadsPlaylist, cfg.apiKey, 6);
                    const totalViews = myVideos.reduce((s: number, v: any) => s + v.views, 0);
                    const totalEng   = myVideos.reduce((s: number, v: any) => s + v.likes + v.comments, 0);
                    const engagementPct = totalViews > 0 ? ((totalEng / totalViews) * 100).toFixed(2) : '0.00';
                    let competitors: any[] = [];
                    const compIds = this._readCompetitors().slice(0, 6);
                    for (const cid of compIds) {
                        const c = await this._fetchChannelSummary(cid, cfg.apiKey);
                        if (c) competitors.push(c);
                    }
                    let analytics: any = null;
                    if (oauthConnected) {
                        try { analytics = await fetchYouTubeAnalyticsSummary(); } catch {}
                    }
                    yt = { configured: true, my, myVideos, engagementPct, competitors, analytics };
                }
            } catch { /* keep yt.configured=false */ }
        }

        const conversationsToday = (() => {
            try {
                const today = new Date().toISOString().slice(0, 10);
                const txt = _safeReadText(path.join(getConversationsDir(), `${today}.md`));
                return txt.split('\n').filter(l => l.startsWith('## [')).length;
            } catch { return 0; }
        })();

        const recentLog = readRecentConversations(2400)
            .replace(/^\[최근 회사 대화 요약 \(참고용\)\]\n/, '')
            .trim();

        /* Build agent team section — one card per agent with persona + open
           task count + autonomy level + most recent memory line + custom
           profile photo when available (영숙/레오). The photo URI is resolved
           through the panel's webview so the asset is reachable from the
           sandboxed iframe. */
        const agentTeam = AGENT_ORDER.map(id => {
            const a = AGENTS[id];
            if (!a) return null;
            const myTasks = openTasks.filter(t => Array.isArray(t.agentIds) && t.agentIds.includes(id));
            let lastActivity = '';
            try {
                const memTxt = _safeReadText(path.join(getCompanyDir(), '_agents', id, 'memory.md'));
                const lines = memTxt.split('\n').map(l => l.trim()).filter(l => /^\s*-\s*\[/.test(l) || (l.length > 4 && !l.startsWith('#') && !l.startsWith('_')));
                lastActivity = lines.length > 0 ? lines[lines.length - 1].slice(0, 120) : '';
            } catch { /* ignore */ }
            let profileImageUri = '';
            try {
                if (a.profileImage && _dashboardExtensionUri) {
                    const p = vscode.Uri.joinPath(_dashboardExtensionUri, 'assets', 'agents', a.profileImage);
                    if (fs.existsSync(p.fsPath)) {
                        profileImageUri = this._panel.webview.asWebviewUri(p).toString();
                    }
                }
            } catch { /* ignore */ }
            const lvl = readToolAutonomyLevel(id);
            /* v2.87.7 — Pre-load lightweight skill list + verified count so the
               in-dashboard agent detail modal can render instantly without a
               second round-trip. Each skill = emoji + name (truncated). */
            /* v2.89.12 — `name` 은 백엔드에서 listAgentTools 매칭에 쓰이는 진짜
               tool name (예: "my_videos_check"), `label` 은 사용자한테 보일 짧은
               이름. description은 모달 상세에서 보여줌. */
            let skills: Array<{ name: string; label: string; emoji: string; enabled: boolean; locked: boolean; description: string; config?: any; sharedConfigName?: string; sharedConfig?: any }> = [];
            try {
                /* v2.89.20 — 비기술자 사용자한테 너무 복잡한 도구들 숨김. 기본
                   화면엔 "한 번 클릭으로 끝나는" 도구만 노출. 고급 분석(경쟁
                   채널 비교, 트렌드 스나이퍼 등)은 별도 섹션 또는 미래 빌드에서.
                   숨겨진 도구도 폴더엔 그대로 있어서 직접 실행은 가능함. */
                const HIDDEN_TOOLS_BY_AGENT: Record<string, string[]> = {
                    youtube: [
                        'youtube_account',     /* 설정 허브 — 외부 연결 패널과 중복 */
                        'competitor_brief',    /* COMPETITOR_CHANNELS 추가 입력 필요 — 고급 */
                        'trend_sniper',        /* WATCHED_CHANNELS 추가 입력 필요 — 고급 */
                        'comment_harvester',   /* WATCHED_CHANNELS 추가 입력 필요 — 고급 */
                        'telegram_notify',     /* 인프라 — 다른 도구가 자동 사용 */
                    ],
                    secretary: [
                        'telegram_setup',      /* 외부 연결 패널과 중복 */
                        'google_calendar',     /* iCal 읽기 전용 — google_calendar_write 가 풀 기능 */
                    ],
                };
                const hidden = HIDDEN_TOOLS_BY_AGENT[id] || [];
                const tools = listAgentTools(id).filter(t => !hidden.includes(t.name));
                /* v2.89.17 — 도구의 자체 config (예: COMPETITOR_CHANNELS) + 공유 설정
                   (youtube_account.json 같은 다른 도구들이 같이 쓰는 파일)을 모두
                   webview로 보내서 인앱 폼으로 편집 가능하게. */
                let sharedYouTube: any = null;
                if (id === 'youtube') {
                    try {
                        const sharedPath = path.join(getCompanyDir(), '_agents', 'youtube', 'tools', 'youtube_account.json');
                        if (fs.existsSync(sharedPath)) {
                            sharedYouTube = JSON.parse(fs.readFileSync(sharedPath, 'utf-8') || '{}');
                        }
                    } catch { /* malformed — ignore */ }
                }
                skills = tools.map(t => {
                    const dn = t.displayName || t.name;
                    const m = dn.match(/^([\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])/u);
                    const emoji = m ? m[1] : '🛠️';
                    const cleanName = dn.replace(/^[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/u, '').slice(0, 18);
                    const schema = (t as any).configSchema || [];
                    const locked = schema.some((f: any) => f.type === 'password' && (!f.value || String(f.value).trim() === ''));
                    /* 도구 자체 config — 메타 키(_) 제외, 사용자가 편집할 수 있는 키만 */
                    const cleanConfig: Record<string, any> = {};
                    for (const [k, v] of Object.entries(t.config || {})) {
                        if (k.startsWith('_')) continue;
                        cleanConfig[k] = v;
                    }
                    /* YouTube 도구들은 youtube_account.json도 같이 쓰니까 일부 키가 거기서
                       오는지 표시. 사용자가 그 키를 편집하면 자동으로 그 파일에 저장. */
                    let sharedConfigName: string | undefined;
                    let sharedConfig: any;
                    if (id === 'youtube' && t.name !== 'youtube_account' && sharedYouTube) {
                        sharedConfigName = 'youtube_account.json';
                        sharedConfig = sharedYouTube;
                    }
                    return {
                        name: t.name,
                        label: cleanName,
                        emoji,
                        enabled: t.enabled !== false,
                        locked,
                        description: (t.description || '').slice(0, 280),
                        config: cleanConfig,
                        sharedConfigName,
                        sharedConfig,
                    };
                });
            } catch { /* tools may not be seeded yet */ }
            const verifiedCount = countAgentVerifiedClaims(id);
            const ragMode = readAgentRagMode(id);
            const selfRagCriteria = readAgentSelfRagCriteria(id);
            return {
                id,
                name: a.name,
                role: a.role,
                emoji: a.emoji,
                color: a.color,
                specialty: a.specialty,
                tagline: a.tagline || '',
                openTasks: myTasks.length,
                autonomy: lvl,
                autonomyLabel: AUTONOMY_LABELS[lvl] || 'Off',
                lastActivity,
                profileImageUri,
                skills,
                verifiedCount,
                ragMode,
                selfRagCriteria,
            };
        }).filter(Boolean);

        try {
            this._panel.webview.postMessage({
                type: 'state',
                company,
                oauthConnected,
                yt,
                agentTeam,
                tasks: {
                    open: openTasks.length,
                    overdue: overdueTasks,
                    urgent: urgentTasks,
                    top: openTasks
                        .sort((a, b) => TASK_PRIORITY_ORDER[_coercePriority(a.priority)] - TASK_PRIORITY_ORDER[_coercePriority(b.priority)])
                        .slice(0, 6)
                        .map(t => ({
                            id: t.id, shortId: t.id.slice(-9),
                            title: t.title,
                            priority: _coercePriority(t.priority),
                            owner: t.owner,
                            agentEmoji: t.agentIds && t.agentIds[0] ? (AGENTS[t.agentIds[0]]?.emoji || '🤖') : (t.owner === 'user' ? '👤' : '🤖'),
                            dueAt: t.dueAt || '',
                            dueLabel: t.dueAt ? _formatDueLabel(t.dueAt) : '',
                            recurrence: t.recurrence || '',
                            status: t.status,
                        })),
                },
                approvals: pendingApprovals.map(a => {
                    const ag = AGENTS[a.agentId];
                    return {
                        id: a.id, shortId: a.id.slice(-9),
                        emoji: ag?.emoji || '🤖',
                        agent: ag?.name || a.agentId,
                        kind: a.kind,
                        title: a.title,
                        summary: a.summary,
                        createdAt: a.createdAt,
                    };
                }),
                conversationsToday,
                recentLog: recentLog.slice(-1500),
                briefingTime: vscode.workspace.getConfiguration('connectAiLab').get<string>('dailyBriefingTime') || '09:00',
            });
        } catch { /* panel disposed */ }
    }

    private async _fetchChannelSummary(channelId: string, apiKey: string): Promise<any | null> {
        try {
            const r = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
                params: { part: 'snippet,statistics,contentDetails', id: channelId, key: apiKey },
                timeout: 10000,
            });
            const it = r.data?.items?.[0];
            if (!it) return null;
            return {
                id: channelId,
                title: it.snippet?.title || '',
                desc: (it.snippet?.description || '').slice(0, 240),
                thumb: it.snippet?.thumbnails?.high?.url || it.snippet?.thumbnails?.default?.url || '',
                subs: parseInt(it.statistics?.subscriberCount || '0', 10),
                views: parseInt(it.statistics?.viewCount || '0', 10),
                videos: parseInt(it.statistics?.videoCount || '0', 10),
                uploadsPlaylist: it.contentDetails?.relatedPlaylists?.uploads || '',
            };
        } catch { return null; }
    }

    private async _fetchRecentVideos(playlistId: string, apiKey: string, max = 6): Promise<any[]> {
        if (!playlistId) return [];
        try {
            const r = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
                params: { part: 'contentDetails', playlistId, maxResults: max, key: apiKey },
                timeout: 10000,
            });
            const ids = (r.data?.items || []).map((x: any) => x.contentDetails?.videoId).filter(Boolean);
            if (ids.length === 0) return [];
            const stats = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: { part: 'snippet,statistics,contentDetails', id: ids.join(','), key: apiKey },
                timeout: 10000,
            });
            return (stats.data?.items || []).map((it: any) => ({
                id: it.id,
                title: it.snippet?.title || '',
                thumb: it.snippet?.thumbnails?.high?.url || it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || '',
                views: parseInt(it.statistics?.viewCount || '0', 10),
                likes: parseInt(it.statistics?.likeCount || '0', 10),
                comments: parseInt(it.statistics?.commentCount || '0', 10),
                publishedAt: it.snippet?.publishedAt || '',
            }));
        } catch { return []; }
    }

    private _readCompetitors(): string[] {
        try {
            const p = path.join(getCompanyDir(), '_agents', 'youtube', 'competitors.json');
            const txt = _safeReadText(p);
            const arr = JSON.parse(txt || '[]');
            return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
        } catch { return []; }
    }

    private _dispose() {
        CompanyDashboardPanel.current = null;
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        while (this._disposables.length) {
            const d = this._disposables.pop();
            try { d?.dispose(); } catch {}
        }
        try { this._panel.dispose(); } catch {}
    }

    private _html(): string {
        return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${_loadWebviewAsset('dashboard.css')}</style>
</head><body>
<canvas id="bgCanvas"></canvas>
<header class="hero">
  <div class="hero-inner">
    <div class="hero-brand">
      <div class="logo-mark">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="16" cy="16" r="8"  stroke="currentColor" stroke-width="1.5"/>
          <circle cx="16" cy="16" r="2.5" fill="currentColor"/>
          <path d="M16 2 L16 30 M2 16 L30 16" stroke="currentColor" stroke-width="0.7" stroke-dasharray="2 3"/>
        </svg>
      </div>
      <div>
        <div class="hero-eyebrow">CONNECT AI · 직원 에이전트 보기</div>
        <div class="hero-title" id="companyName">불러오는 중…</div>
        <div class="hero-meta">
          <span class="meta-pill" id="todayLabel"></span>
          <span class="meta-pill"><span class="dot live"></span> <span id="convCount">0</span>건 대화</span>
          <span class="meta-pill" id="briefPill">🌅 매일 09:00</span>
        </div>
      </div>
    </div>
    <div class="hero-actions">
      <button class="btn ghost" id="briefBtn" title="회사 전체 상태·진행 작업·이슈 즉시 점검">시스템 진단</button>
      <button class="btn ghost" id="scheduleBtn" title="정해진 시각·요일에 시스템이 자동 보고">리포트 자동화</button>
      <button class="btn ghost" id="modelsBtn" title="각 에이전트마다 최적 LLM 자동 분배·실행">모델 오케스트레이션</button>
      <button class="btn ghost" id="refreshBtn" title="동기화">↻</button>
    </div>
  </div>
</header>

<main class="grid">
  <!-- v2.86 layout — agent team is the hero (사용자가 가장 보고 싶어하는 것).
       Below that: today (tasks + approvals merged), then YouTube + Analytics
       only when the channel is connected. Card count: 9 → 4 (or 6 with YT). -->

  <!-- 1) 우리 팀 — hero. Always present, 10 cards in responsive grid. -->
  <section class="card span-12 hero-team" id="teamCard">
    <div class="card-head">
      <div class="card-title"><span class="title-icon">👥</span> 에이전트 매트릭스</div>
      <span class="badge" id="teamBadge">10명</span>
    </div>
    <div class="team-grid" id="teamBody"></div>
  </section>

  <!-- 2) 오늘의 일 — open tasks (left) + approvals (right). Compact. -->
  <section class="card span-7" id="tasksCard">
    <div class="card-head">
      <div class="card-title"><span class="title-icon">⚡</span> 액티브 워크로드</div>
      <span class="badge" id="taskBadge">0</span>
    </div>
    <div id="tasksBody"><div class="skeleton skel-md"></div></div>
  </section>

  <section class="card span-5" id="aprCard">
    <div class="card-head">
      <div class="card-title"><span class="title-icon">⏳</span> 승인 큐 (Pending)</div>
      <span class="badge warn" id="aprBadge">0</span>
    </div>
    <div id="aprBody"><div class="empty subtle">대기 중인 승인이 없어요.</div></div>
  </section>

  <!-- 3) YouTube + Analytics — only when API key configured. -->
  <section class="card span-7 yt-cond" id="ytCard" style="display:none">
    <div class="card-head">
      <div class="card-title"><span class="title-icon">📺</span> YouTube — 내 채널</div>
      <button class="btn small" id="queueBtn">📥 댓글 큐 갱신</button>
    </div>
    <div id="ytBody"></div>
  </section>

  <section class="card span-5 yt-cond" id="anaCard" style="display:none">
    <div class="card-head">
      <div class="card-title"><span class="title-icon">📊</span> Analytics · 28일</div>
      <span class="badge" id="anaBadge">API key</span>
    </div>
    <div id="anaBody"></div>
  </section>

  <section class="card span-12 yt-cond" id="vidCard" style="display:none">
    <div class="card-head">
      <div class="card-title"><span class="title-icon">🎬</span> 최근 영상</div>
    </div>
    <div class="video-grid" id="vidBody"></div>
  </section>

  <!-- 4) Mini KPI strip — moved to bottom; less prominent. Hidden when no YT. -->
  <section class="card span-12 kpi-strip yt-cond" id="kpiStrip" style="display:none">
    <div class="kpi-cell">
      <div class="kpi-icon">📺</div>
      <div class="kpi-num" data-target="0" id="kSubs">0</div>
      <div class="kpi-label">구독자</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-icon">👁</div>
      <div class="kpi-num" data-target="0" id="kViews">0</div>
      <div class="kpi-label">총 조회</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-icon">💗</div>
      <div class="kpi-num" id="kEng">–</div>
      <div class="kpi-label">참여율</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-icon">⚡</div>
      <div class="kpi-num" data-target="0" id="kOpen">0</div>
      <div class="kpi-label">열린 작업</div>
      <div class="kpi-delta urgent" id="kUrgent"></div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-icon">⏳</div>
      <div class="kpi-num" data-target="0" id="kApr">0</div>
      <div class="kpi-label">승인 대기</div>
    </div>
  </section>
</main>

<div class="toast" id="toast"></div>

<script>${_loadWebviewAsset('dashboard.js')}</script>
</body></html>`;
    }
}

let _dashboardExtensionUri: vscode.Uri | null = null;

/* v2.89.60 — Webview 정적 자산 로더. CSS·JS 템플릿이 너무 커져서 (1,500+ 줄) 파일 분리.
   각 _html()에서 ${_loadWebviewAsset('dashboard.css')} 형태로 사용. activate() 이후에만
   동작 — _dashboardExtensionUri 설정되기 전엔 빈 문자열 반환 (fail-safe). */
function _loadWebviewAsset(name: string): string {
    if (!_dashboardExtensionUri) return '';
    try {
        const p = path.join(_dashboardExtensionUri.fsPath, 'assets', 'webview', name);
        return fs.readFileSync(p, 'utf-8');
    } catch (e: any) {
        console.warn(`[Connect AI] webview asset 로드 실패 ${name}:`, e?.message || e);
        return '';
    }
}

/* ── Unified API Connections panel (v2.85) ────────────────────────────────
   Single full-screen webview where the user fills all integration credentials
   (Telegram bot, YouTube Data API, Google Calendar, etc.) in one place.
   Reads/writes the existing per-agent `config.md` files so this panel is
   purely a friendlier UI on top of the same source of truth — no schema
   changes, fully compatible with manual editing. */
interface ApiServiceField {
    key: string;
    label: string;
    type: 'text' | 'password';
    placeholder?: string;
    help?: string;
}
interface ApiServiceDef {
    id: string;
    name: string;
    icon: string;
    summary: string;
    helpUrl?: string;
    /* `_agents/<agentId>/config.md` is where the values land. */
    agentId: string;
    fields: ApiServiceField[];
    /* Optional command to launch a guided OAuth wizard (e.g. Google Calendar). */
    wizardCommand?: string;
    /* When true, the service shows as "준비 중" — fields disabled, no save. */
    comingSoon?: boolean;
}

const API_SERVICES: ApiServiceDef[] = [
    {
        id: 'telegram',
        name: '텔레그램 봇',
        icon: '📨',
        summary: '비서가 텔레그램으로 양방향 명령을 받고 보고합니다. 폰 어디서든 회사를 운영하세요.',
        helpUrl: 'https://t.me/BotFather',
        agentId: 'secretary',
        fields: [
            { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', type: 'password', help: '@BotFather에서 /newbot으로 발급. 형식: 숫자:문자' },
            { key: 'TELEGRAM_CHAT_ID', label: 'Chat ID', type: 'text', placeholder: '비워두면 자동 감지', help: '봇한테 메시지 1번 보내고 비워둔 채 저장하면 자동으로 채워집니다' },
        ],
    },
    {
        id: 'youtube',
        name: 'YouTube Data API',
        icon: '📺',
        summary: '내 채널 + 경쟁 채널 분석, 댓글 답장 큐 생성. 시청 지속률 같은 비공개 데이터는 OAuth가 별도.',
        helpUrl: 'https://console.cloud.google.com/',
        agentId: 'youtube',
        fields: [
            { key: 'YOUTUBE_API_KEY', label: 'API Key', type: 'password', help: 'Cloud Console → YouTube Data API v3 → 사용자 인증 정보 → API 키' },
            { key: 'YOUTUBE_CHANNEL_ID', label: 'Channel ID', type: 'text', placeholder: 'UCxxx...', help: '내 채널 페이지에서 확인' },
        ],
    },
    {
        id: 'youtube-oauth',
        name: 'YouTube Analytics (OAuth)',
        icon: '📊',
        summary: '시청 지속률 · 트래픽 소스 · 시청자 인구통계. Client ID/Secret 채운 뒤 "OAuth 연결" 버튼 (또는 에이전트가 자동으로 발동).',
        helpUrl: 'https://console.cloud.google.com/',
        agentId: 'youtube',
        wizardCommand: 'connectAiLab.youtube.connectOAuth',
        fields: [
            { key: 'YOUTUBE_OAUTH_CLIENT_ID', label: 'Client ID', type: 'password' },
            { key: 'YOUTUBE_OAUTH_CLIENT_SECRET', label: 'Client Secret', type: 'password', help: 'Authorized redirect URI: http://127.0.0.1:5814/yt-oauth-callback' },
        ],
    },
    {
        id: 'google-calendar',
        name: 'Google Calendar',
        icon: '📅',
        summary: '비서가 사용자 일정을 읽고 자동으로 task 마감일과 동기화합니다.',
        agentId: 'secretary',
        wizardCommand: 'connect-ai-lab.connectGoogleCalendarWrite',
        fields: [
            { key: 'GOOGLE_CALENDAR_ID', label: 'Calendar ID', type: 'text', placeholder: 'primary 또는 yourcal@group.calendar.google.com', help: '명령 팔레트 → "Connect AI: Google Calendar 자동 일정 연결" 추천' },
        ],
    },
    {
        id: 'github',
        name: 'GitHub',
        icon: '💻',
        summary: 'Developer 에이전트가 이슈 읽고 코드 푸시. repo + workflow 권한 필요.',
        helpUrl: 'https://github.com/settings/tokens',
        agentId: 'developer',
        comingSoon: true,
        fields: [
            { key: 'GITHUB_TOKEN', label: 'Personal Access Token', type: 'password' },
            { key: 'GITHUB_DEFAULT_REPO', label: '기본 저장소', type: 'text', placeholder: 'owner/repo' },
        ],
    },
    {
        id: 'instagram',
        name: 'Instagram (Meta Graph)',
        icon: '📷',
        summary: '인스타 비즈니스 계정 게시 + DM/댓글 분석.',
        helpUrl: 'https://developers.facebook.com/',
        agentId: 'instagram',
        comingSoon: true,
        fields: [
            { key: 'META_ACCESS_TOKEN', label: 'Access Token', type: 'password' },
            { key: 'INSTAGRAM_BUSINESS_ID', label: 'Business Account ID', type: 'text' },
        ],
    },
];

/* Read all current values from each service's config.md. Empty string when
   not yet set. Returned as { [serviceId]: { key: value } }. */
function readAllApiConnections(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    /* v2.88.2 — 무효 값 필터: 사용자가 placeholder/라벨을 실수로 저장하거나
       이전 버그로 'TELEGRAM_BOT_TOKEN:' 같은 키 이름이 값 자리에 박혀있을 때
       빈 값으로 취급. 실제로 의미 있는 자격증명만 폼에 다시 채움. */
    const looksLikeJunk = (key: string, val: string): boolean => {
        const v = (val || '').trim();
        if (!v) return true;
        /* 본인 키 이름이 값 자리에 들어간 케이스 */
        if (v.startsWith(key + ':') || v === key || v.startsWith(key + '=')) return true;
        /* 다른 필드 키 이름이 들어간 경우 (이전 폼 오작동) */
        const allKeys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'YOUTUBE_API_KEY', 'YOUTUBE_CHANNEL_ID'];
        if (allKeys.some(k => k !== key && (v.startsWith(k + ':') || v === k || v.startsWith(k + '=')))) return true;
        return false;
    };
    for (const svc of API_SERVICES) {
        out[svc.id] = {};
        try {
            /* 텔레그램은 캐노니컬 JSON을 우선 읽음 — 폴링이 읽는 단일 진실의 출처. */
            if (svc.id === 'telegram') {
                try {
                    const jsonPath = path.join(getCompanyDir(), '_agents', 'secretary', 'tools', 'telegram_setup.json');
                    if (fs.existsSync(jsonPath)) {
                        const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8') || '{}');
                        for (const f of svc.fields) {
                            const v = String(cfg[f.key] || '').trim();
                            out[svc.id][f.key] = looksLikeJunk(f.key, v) ? '' : v;
                        }
                        if (out[svc.id]['TELEGRAM_BOT_TOKEN']) continue;
                    }
                } catch { /* fall through to config.md */ }
            }
            /* v2.89.18 — YouTube Data API + OAuth Client 캐노니컬 youtube_account.json 우선. */
            if (svc.id === 'youtube' || svc.id === 'youtube-oauth') {
                try {
                    const jsonPath = path.join(getCompanyDir(), '_agents', 'youtube', 'tools', 'youtube_account.json');
                    if (fs.existsSync(jsonPath)) {
                        const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8') || '{}');
                        for (const f of svc.fields) {
                            /* API 패널 키 → 캐노니컬 JSON 키 매핑.
                               YOUTUBE_CHANNEL_ID (외부연결 폼) ↔ MY_CHANNEL_ID (캐노니컬). */
                            const canonicalKey = f.key === 'YOUTUBE_CHANNEL_ID' ? 'MY_CHANNEL_ID' : f.key;
                            const v = String(cfg[canonicalKey] || '').trim();
                            out[svc.id][f.key] = looksLikeJunk(f.key, v) ? '' : v;
                        }
                        const hasAny = Object.values(out[svc.id]).some(v => !!v);
                        if (hasAny) continue;
                    }
                } catch { /* fall through */ }
            }
            const cfgPath = path.join(getCompanyDir(), '_agents', svc.agentId, 'config.md');
            const txt = _safeReadText(cfgPath);
            for (const f of svc.fields) {
                /* v2.89.5 — line-anchored regex (`^KEY:` with `m` flag). 이전엔
                   anchor 없어서 `- YOUTUBE_API_KEY: ` 같은 preset 코멘트 라인을
                   먼저 잡고, `\s*` 가 newline 건너뛰어서 다음 줄의 키 이름을
                   value로 캡처해버림 → looksLikeJunk가 junk 판정 → "미설정".
                   line-start 강제로 실제 데이터 라인만 잡음. 또한 \s 대신
                   ' ' 으로 한정해서 newline 안 건너뜀. */
                const re = new RegExp('^' + f.key + '[ \\t]*[:：=][ \\t]*([^\\r\\n]+?)[ \\t]*$', 'm');
                const m = txt.match(re);
                const v = m ? m[1].trim() : '';
                out[svc.id][f.key] = looksLikeJunk(f.key, v) ? '' : v;
            }
        } catch { /* leave empty */ }
    }
    return out;
}

/* Save a service's values. Reads the existing config.md, replaces lines for
   each field (or appends a new section), writes back. Idempotent. */
async function saveApiConnection(serviceId: string, values: Record<string, string>): Promise<{ ok: boolean; error?: string; note?: string }> {
    const svc = API_SERVICES.find(s => s.id === serviceId);
    if (!svc) return { ok: false, error: 'Unknown service' };
    try {
        ensureCompanyStructure();
        let extraNote = '';
        /* v2.88 — 텔레그램 서비스 특별 처리:
           1) chat_id 비어있으면 봇의 getUpdates에서 자동 감지
           2) 캐노니컬 위치(_agents/secretary/tools/telegram_setup.json)에도 동시 저장
              — 사이드바·텔레그램 폴링이 읽는 단일 진실의 출처
           3) 사용자가 token 잘못 넣으면 명확한 에러 반환 */
        if (serviceId === 'telegram') {
            let token = (values['TELEGRAM_BOT_TOKEN'] || '').trim();
            let chatId = (values['TELEGRAM_CHAT_ID'] || '').trim();
            /* v2.88.3 — 이전 regex `[ -‍﻿]+` 가 U+0020~U+200D 전체 범위를
               잡아서 ASCII 글자 다 깎아냄(=토큰 통째로 빈 문자열). 명시적 escape로
               whitespace + zero-width chars + BOM만 정확히 제거. */
            token = token.replace(/[\s ​-‍﻿]+/g, '').replace(/^bot/i, '');
            /* v2.88.2 — chat_id에 라벨/키 이름 같은 garbage가 있으면 빈 값으로
               취급해서 자동 감지 트리거. 이전 버그로 placeholder가 값 자리에
               박혀있는 사용자 데이터 자동 정리. */
            if (chatId && /^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|YOUTUBE_API_KEY|YOUTUBE_CHANNEL_ID)[:=]?/i.test(chatId)) {
                chatId = '';
            }
            /* chat_id는 정상이면 음수 또는 양수 정수만 가능 */
            if (chatId && !/^-?\d+$/.test(chatId)) {
                chatId = '';
            }
            if (!token) return { ok: false, error: '봇 토큰이 비어있어요' };
            if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
                return { ok: false, error: `봇 토큰 형식이 이상해요. @BotFather에서 받은 "숫자:문자열" 형태인지 확인해주세요. 받은 값: ${token.slice(0, 20)}…` };
            }
            /* 토큰 검증 */
            try {
                const meRes = await axios.get(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`, { timeout: 8000, validateStatus: () => true });
                if (!meRes.data?.ok) {
                    return { ok: false, error: `봇 토큰 거절됨: ${meRes.data?.description || `HTTP ${meRes.status}`}. @BotFather에서 토큰 다시 확인해주세요.` };
                }
            } catch (e: any) {
                return { ok: false, error: `텔레그램 서버 연결 실패: ${e?.message || e}. 인터넷 확인하시고 다시 시도해주세요.` };
            }
            /* chat_id 비어있으면 자동 감지 */
            if (!chatId) {
                try {
                    const upRes = await axios.get(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates`, { timeout: 8000, validateStatus: () => true });
                    const updates: any[] = Array.isArray(upRes.data?.result) ? upRes.data.result : [];
                    const seen = new Set<number>();
                    const chats: { id: number; name: string }[] = [];
                    for (let i = updates.length - 1; i >= 0; i--) {
                        const m = updates[i]?.message || updates[i]?.edited_message || updates[i]?.channel_post;
                        const c = m?.chat;
                        if (!c || typeof c.id !== 'number') continue;
                        if (seen.has(c.id)) continue;
                        seen.add(c.id);
                        const name = c.first_name ? `${c.first_name}${c.last_name ? ' ' + c.last_name : ''}` : (c.title || c.username || `Chat ${c.id}`);
                        chats.push({ id: c.id, name });
                    }
                    if (chats.length === 0) {
                        return { ok: false, error: '봇한테 아직 메시지를 보낸 적이 없어요. 텔레그램에서 봇 시작(/start) 눌러서 메시지 1개 보낸 후 다시 저장해주세요.' };
                    }
                    /* 첫 번째(가장 최근) chat 자동 선택 */
                    chatId = String(chats[0].id);
                    extraNote = `📲 chat_id 자동 감지됨 (${chats[0].name})`;
                } catch (e: any) {
                    return { ok: false, error: `chat_id 자동 감지 실패: ${e?.message || e}` };
                }
            }
            /* 캐노니컬 JSON 저장 — 폴링이 읽는 단일 진실의 출처 */
            const toolDir = path.join(getCompanyDir(), '_agents', 'secretary', 'tools');
            fs.mkdirSync(toolDir, { recursive: true });
            const jsonPath = path.join(toolDir, 'telegram_setup.json');
            fs.writeFileSync(jsonPath, JSON.stringify({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId }, null, 2));
            /* values도 갱신해서 아래 config.md 저장 시 정합성 유지 */
            values['TELEGRAM_BOT_TOKEN'] = token;
            values['TELEGRAM_CHAT_ID'] = chatId;
        }
        /* v2.89.18 — YouTube 자격증명 (Data API + OAuth) 캐노니컬 단일 저장.
           외부 연결 패널 = source of truth. 도구·에이전트·OAuth 흐름 모두 여기서
           읽음. config.md는 더 이상 source 아님 (legacy fallback only). */
        if (serviceId === 'youtube' || serviceId === 'youtube-oauth') {
            const ytToolDir = path.join(getCompanyDir(), '_agents', 'youtube', 'tools');
            const ytJsonPath = path.join(ytToolDir, 'youtube_account.json');
            try {
                fs.mkdirSync(ytToolDir, { recursive: true });
                let existing: Record<string, any> = {};
                if (fs.existsSync(ytJsonPath)) {
                    try { existing = JSON.parse(fs.readFileSync(ytJsonPath, 'utf-8') || '{}'); } catch { /* malformed */ }
                }
                /* Data API 필드 */
                if (serviceId === 'youtube') {
                    const apiKey = (values['YOUTUBE_API_KEY'] || '').trim();
                    const channelId = (values['YOUTUBE_CHANNEL_ID'] || '').trim();
                    existing['YOUTUBE_API_KEY'] = apiKey;
                    if (channelId) existing['MY_CHANNEL_ID'] = channelId;
                    if (channelId && !apiKey) extraNote = `⚠️ 채널 ID는 저장됨 — API 키도 입력해야 분석 가능`;
                    else if (apiKey && channelId) extraNote = `🔑 캐노니컬 youtube_account.json 동기화 완료`;
                }
                /* OAuth Client ID/Secret 필드 */
                if (serviceId === 'youtube-oauth') {
                    const clientId = (values['YOUTUBE_OAUTH_CLIENT_ID'] || '').trim();
                    const clientSecret = (values['YOUTUBE_OAUTH_CLIENT_SECRET'] || '').trim();
                    if (clientId) existing['YOUTUBE_OAUTH_CLIENT_ID'] = clientId;
                    if (clientSecret) existing['YOUTUBE_OAUTH_CLIENT_SECRET'] = clientSecret;
                    extraNote = `🔐 OAuth Client 캐노니컬 youtube_account.json 동기화 완료`;
                }
                /* 누락 필드 기본값 */
                if (typeof existing['YOUTUBE_API_KEY'] !== 'string') existing['YOUTUBE_API_KEY'] = '';
                if (!('MY_CHANNEL_HANDLE' in existing)) existing['MY_CHANNEL_HANDLE'] = '';
                if (!('MY_CHANNEL_ID' in existing)) existing['MY_CHANNEL_ID'] = '';
                if (!('WATCHED_CHANNELS' in existing)) existing['WATCHED_CHANNELS'] = [];
                if (!('COMPETITOR_CHANNELS' in existing)) existing['COMPETITOR_CHANNELS'] = [];
                fs.writeFileSync(ytJsonPath, JSON.stringify(existing, null, 2));
            } catch (e: any) {
                console.warn('[saveApiConnection] youtube_account.json sync failed:', e?.message || e);
            }
        }
        const cfgPath = path.join(getCompanyDir(), '_agents', svc.agentId, 'config.md');
        let txt = _safeReadText(cfgPath);
        if (!txt) {
            const a = AGENTS[svc.agentId];
            txt = `# ${a?.emoji || '🤖'} ${a?.name || svc.agentId} 설정 (시크릿)\n\n_이 파일은 \`.gitignore\`로 깃 동기화에서 제외됩니다._\n`;
        }
        for (const f of svc.fields) {
            const v = (values[f.key] || '').trim();
            const re = new RegExp('^' + f.key + '\\s*[:：=]\\s*.*$', 'm');
            if (re.test(txt)) {
                txt = txt.replace(re, `${f.key}: ${v}`);
            } else {
                txt = txt.trimEnd() + `\n${f.key}: ${v}\n`;
            }
        }
        fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
        fs.writeFileSync(cfgPath, txt);
        return { ok: true, note: extraNote || undefined };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}

class ApiConnectionsPanel {
    public static current: ApiConnectionsPanel | null = null;
    public static readonly viewType = 'connectAiLab.apiConnections';
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow() {
        const column = vscode.ViewColumn.Active;
        if (ApiConnectionsPanel.current) {
            ApiConnectionsPanel.current._panel.reveal(column);
            ApiConnectionsPanel.current.refresh();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            ApiConnectionsPanel.viewType,
            '🔌 외부 연결 (API 키)',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ApiConnectionsPanel.current = new ApiConnectionsPanel(panel);
    }

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._panel.webview.html = this._html();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async (msg) => {
            try {
                if (msg?.type === 'load') {
                    this._post();
                } else if (msg?.type === 'save' && msg.serviceId && msg.values) {
                    const r = await saveApiConnection(msg.serviceId, msg.values);
                    this._panel.webview.postMessage({ type: 'saved', serviceId: msg.serviceId, ok: r.ok, error: r.error, note: r.note });
                    this._post();
                } else if (msg?.type === 'wizard' && msg.command) {
                    vscode.commands.executeCommand(msg.command);
                } else if (msg?.type === 'openHelp' && msg.url) {
                    vscode.env.openExternal(vscode.Uri.parse(msg.url));
                }
            } catch (e: any) {
                this._panel.webview.postMessage({ type: 'saved', serviceId: msg?.serviceId, ok: false, error: e?.message || String(e) });
            }
        }, null, this._disposables);
        this._post();
    }

    public refresh() { this._post(); }

    private _post() {
        try {
            const values = readAllApiConnections();
            this._panel.webview.postMessage({
                type: 'state',
                services: API_SERVICES.map(s => ({
                    id: s.id, name: s.name, icon: s.icon, summary: s.summary,
                    helpUrl: s.helpUrl || '',
                    wizardCommand: s.wizardCommand || '',
                    comingSoon: !!s.comingSoon,
                    fields: s.fields,
                    values: values[s.id] || {},
                })),
            });
        } catch { /* panel disposed */ }
    }

    private _dispose() {
        ApiConnectionsPanel.current = null;
        while (this._disposables.length) {
            const d = this._disposables.pop();
            try { d?.dispose(); } catch {}
        }
        try { this._panel.dispose(); } catch {}
    }

    private _html(): string {
        return `<!doctype html><html><head><meta charset="utf-8"><style>${_loadWebviewAsset('api-panel.css')}</style></head><body>
<header class="hero">
  <div class="hero-inner">
    <div class="hero-mark">🔌</div>
    <div>
      <div class="eyebrow">CONNECT AI · 외부 연결</div>
      <h1>API 키 한 곳에서 관리</h1>
      <div class="hero-sub">텔레그램 · YouTube · Google Calendar · GitHub · Instagram — 모든 자격증명을 한 패널에서 입력하고 저장합니다. 같은 값이 \`_agents/<id>/config.md\`로 저장돼요.</div>
    </div>
  </div>
</header>
<main id="grid" class="grid"></main>
<div class="toast" id="toast"></div>
<script>${_loadWebviewAsset('api-panel.js')}</script>
</body></html>`;
    }
}

/* ── YouTube OAuth + Analytics API ────────────────────────────────────────
   Implements the Google OAuth2 device-style flow that fits a VS Code
   extension: extension opens the consent URL in the browser, runs a
   tiny http server on localhost:5814 to receive the auth code, exchanges
   for tokens, stores them in `_agents/youtube/oauth.local.json` (gitignored).
   Refresh tokens get reused; access tokens get re-fetched when expired. */

const YT_OAUTH_CLIENT_ID_KEY = 'YOUTUBE_OAUTH_CLIENT_ID';
const YT_OAUTH_CLIENT_SECRET_KEY = 'YOUTUBE_OAUTH_CLIENT_SECRET';
const YT_OAUTH_REDIRECT = 'http://127.0.0.1:5814/yt-oauth-callback';
const YT_OAUTH_SCOPES = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl', /* needed for posting comment replies */
].join(' ');

function _ytOAuthTokenPath(): string {
    return path.join(getCompanyDir(), '_agents', 'youtube', 'oauth.local.json');
}

function _readYtOAuthClient(): { id: string; secret: string } {
    /* v2.89.18 — 캐노니컬 youtube_account.json 우선. 외부 연결 패널이 거기에
       저장하니까 source of truth 일관성 유지. config.md는 legacy fallback만. */
    const jsonPath = path.join(getCompanyDir(), '_agents', 'youtube', 'tools', 'youtube_account.json');
    try {
        if (fs.existsSync(jsonPath)) {
            const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8') || '{}');
            const id = String(cfg[YT_OAUTH_CLIENT_ID_KEY] || '').trim();
            const secret = String(cfg[YT_OAUTH_CLIENT_SECRET_KEY] || '').trim();
            if (id && secret) return { id, secret };
        }
    } catch { /* malformed — fall through */ }
    /* Fallback: legacy config.md */
    const txt = _safeReadText(path.join(getCompanyDir(), '_agents', 'youtube', 'config.md'));
    const idM = txt.match(new RegExp(YT_OAUTH_CLIENT_ID_KEY + '\\s*[:：=]\\s*([^\\s]+)'));
    const sM  = txt.match(new RegExp(YT_OAUTH_CLIENT_SECRET_KEY + '\\s*[:：=]\\s*([^\\s]+)'));
    return { id: idM ? idM[1] : '', secret: sM ? sM[1] : '' };
}

function _readYtOAuthTokens(): { access_token?: string; refresh_token?: string; expires_at?: number } | null {
    try {
        const txt = _safeReadText(_ytOAuthTokenPath());
        if (!txt.trim()) return null;
        return JSON.parse(txt);
    } catch { return null; }
}

function _writeYtOAuthTokens(t: { access_token?: string; refresh_token?: string; expires_at?: number }) {
    try {
        fs.mkdirSync(path.dirname(_ytOAuthTokenPath()), { recursive: true });
        fs.writeFileSync(_ytOAuthTokenPath(), JSON.stringify(t, null, 2));
    } catch { /* ignore */ }
}

function isYoutubeOAuthConnected(): boolean {
    const t = _readYtOAuthTokens();
    return !!(t && (t.refresh_token || (t.access_token && t.expires_at && t.expires_at > Date.now())));
}

async function _ensureYtAccessToken(): Promise<string | null> {
    const t = _readYtOAuthTokens();
    if (!t) return null;
    if (t.access_token && t.expires_at && t.expires_at > Date.now() + 30_000) return t.access_token;
    if (!t.refresh_token) return null;
    const cl = _readYtOAuthClient();
    if (!cl.id || !cl.secret) return null;
    try {
        const params = new URLSearchParams({
            client_id: cl.id,
            client_secret: cl.secret,
            refresh_token: t.refresh_token,
            grant_type: 'refresh_token',
        });
        const r = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000,
        });
        const newAt: string = r.data?.access_token;
        const expiresIn: number = r.data?.expires_in || 3600;
        if (!newAt) return null;
        _writeYtOAuthTokens({ ...t, access_token: newAt, expires_at: Date.now() + expiresIn * 1000 });
        return newAt;
    } catch { return null; }
}

async function startYouTubeOAuthFlow(): Promise<{ ok: boolean; message: string }> {
    const cl = _readYtOAuthClient();
    if (!cl.id || !cl.secret) {
        return { ok: false, message: `먼저 \`_agents/youtube/config.md\`에 다음 두 줄 추가하세요:\n${YT_OAUTH_CLIENT_ID_KEY}: <Google Cloud Console OAuth 2.0 Client ID>\n${YT_OAUTH_CLIENT_SECRET_KEY}: <Client Secret>\n\n생성: console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client ID (Web application). Authorized redirect URI에 ${YT_OAUTH_REDIRECT} 등록.` };
    }
    return new Promise((resolve) => {
        const state = Math.random().toString(36).slice(2, 12);
        const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?'
            + new URLSearchParams({
                client_id: cl.id,
                redirect_uri: YT_OAUTH_REDIRECT,
                response_type: 'code',
                scope: YT_OAUTH_SCOPES,
                access_type: 'offline',
                prompt: 'consent',
                state,
            }).toString();
        let server: http.Server | null = null;
        let resolved = false;
        const timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            try { server?.close(); } catch { /* ignore */ }
            resolve({ ok: false, message: '⏱️ OAuth 시간 초과 (5분). 다시 시도해주세요.' });
        }, 5 * 60_000);
        server = http.createServer(async (req, res) => {
            try {
                const url = new URL(req.url || '/', `http://127.0.0.1:5814`);
                if (!url.pathname.startsWith('/yt-oauth-callback')) {
                    res.writeHead(404); res.end(); return;
                }
                const code = url.searchParams.get('code') || '';
                const stateBack = url.searchParams.get('state') || '';
                if (stateBack !== state || !code) {
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h2>❌ OAuth 실패 — state 불일치 또는 code 없음</h2>');
                    if (!resolved) { resolved = true; clearTimeout(timer); try { server?.close(); } catch {} resolve({ ok: false, message: 'OAuth state mismatch' }); }
                    return;
                }
                /* exchange code → tokens */
                const params = new URLSearchParams({
                    client_id: cl.id,
                    client_secret: cl.secret,
                    code,
                    redirect_uri: YT_OAUTH_REDIRECT,
                    grant_type: 'authorization_code',
                });
                const tk = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 15000,
                });
                const at = tk.data?.access_token;
                const rt = tk.data?.refresh_token;
                const ein = tk.data?.expires_in || 3600;
                _writeYtOAuthTokens({ access_token: at, refresh_token: rt, expires_at: Date.now() + ein * 1000 });
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<!doctype html><html><body style="background:#0a0d12;color:#e6edf3;font-family:sans-serif;text-align:center;padding:60px"><h1 style="color:#00ff41">✅ Connect AI · YouTube 연결 완료</h1><p>이 창을 닫고 VS Code로 돌아가세요.</p></body></html>');
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    try { server?.close(); } catch { /* ignore */ }
                    resolve({ ok: true, message: '✅ YouTube OAuth 연결 완료. Analytics 데이터 활성화.' });
                }
            } catch (e: any) {
                res.writeHead(500); res.end('OAuth error: ' + (e?.message || e));
                if (!resolved) { resolved = true; clearTimeout(timer); try { server?.close(); } catch {} resolve({ ok: false, message: `OAuth 교환 실패: ${e?.message || e}` }); }
            }
        });
        server.listen(5814, '127.0.0.1', () => {
            vscode.env.openExternal(vscode.Uri.parse(authUrl));
        });
        server.on('error', (err: any) => {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve({ ok: false, message: `포트 5814 사용 중: ${err?.message || err}` }); }
        });
    });
}

/* Pulls a 28-day Analytics summary for the user's channel — views,
   estimatedMinutesWatched, averageViewDuration, plus top traffic sources +
   top countries. Rolled into one object the dashboard renders. */
async function fetchYouTubeAnalyticsSummary(): Promise<any> {
    const at = await _ensureYtAccessToken();
    if (!at) throw new Error('OAuth 토큰 없음');
    const end = new Date();
    const start = new Date(Date.now() - 28 * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const baseParams = {
        ids: 'channel==MINE',
        startDate: fmt(start),
        endDate: fmt(end),
    };
    const headers = { Authorization: `Bearer ${at}` };
    /* 1) totals */
    const totals = await axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
        params: { ...baseParams, metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained' },
        headers, timeout: 12000,
    });
    const row = totals.data?.rows?.[0] || [];
    const cols = (totals.data?.columnHeaders || []).map((c: any) => c.name);
    const get = (name: string) => { const i = cols.indexOf(name); return i >= 0 ? row[i] : null; };
    /* 2) top sources */
    let topSources: Array<{ source: string; views: number }> = [];
    try {
        const r = await axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
            params: { ...baseParams, metrics: 'views', dimensions: 'insightTrafficSourceType', sort: '-views', maxResults: 7 },
            headers, timeout: 12000,
        });
        topSources = (r.data?.rows || []).map((rr: any) => ({ source: String(rr[0]), views: Number(rr[1]) }));
    } catch { /* ignore */ }
    /* 3) top countries */
    let topCountries: Array<{ country: string; views: number }> = [];
    try {
        const r = await axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
            params: { ...baseParams, metrics: 'views', dimensions: 'country', sort: '-views', maxResults: 7 },
            headers, timeout: 12000,
        });
        topCountries = (r.data?.rows || []).map((rr: any) => ({ country: String(rr[0]), views: Number(rr[1]) }));
    } catch { /* ignore */ }
    return {
        views: get('views') || 0,
        estimatedMinutesWatched: get('estimatedMinutesWatched') || 0,
        avgViewDurationSec: get('averageViewDuration') || 0,
        avgViewPercentage: get('averageViewPercentage') || 0,
        subscribersGained: get('subscribersGained') || 0,
        topSources,
        topCountries,
    };
}

export function deactivate() {
    try { _activeChatProvider?.stopAutoCycle?.(); } catch { /* ignore */ }
    try { stopTelegramPolling(); } catch { /* ignore */ }
    try { stopTrackerNudge(); } catch { /* ignore */ }
    try { stopDailyBriefingLoop(); } catch { /* ignore */ }
    try { stopRecurrenceLoop(); } catch { /* ignore */ }
    try { stopPreAlarmLoop(); } catch { /* ignore */ }
}

// ============================================================
// 🏢 OfficePanel — Smallville-style virtual office (full-screen)
// ============================================================
class OfficePanel {
    public static current?: OfficePanel;
    private static readonly viewType = 'connectAiOffice';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _ctx: vscode.ExtensionContext;
    private readonly _provider: SidebarChatProvider;
    private _disposables: vscode.Disposable[] = [];

    static createOrShow(ctx: vscode.ExtensionContext, provider: SidebarChatProvider) {
        if (OfficePanel.current) {
            OfficePanel.current._panel.reveal(vscode.ViewColumn.Active);
            return;
        }
        try { provider.broadcastOfficeState(true); } catch { /* ignore */ }
        const userAssets = OfficePanel._resolveUserAssetsPath();
        const localResourceRoots: vscode.Uri[] = [ctx.extensionUri];
        if (userAssets) {
            localResourceRoots.push(vscode.Uri.file(userAssets));
        }
        // Allow loading user's custom map PNG from the brain folder
        try {
            const brain = getCompanyDir();
            if (brain && fs.existsSync(brain)) {
                localResourceRoots.push(vscode.Uri.file(brain));
            }
        } catch { /* ignore */ }
        const panel = vscode.window.createWebviewPanel(
            OfficePanel.viewType,
            '🏢 가상 사무실',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots
            }
        );
        OfficePanel.current = new OfficePanel(panel, ctx, provider);
    }

    private constructor(panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext, provider: SidebarChatProvider) {
        this._panel = panel;
        this._ctx = ctx;
        this._provider = provider;

        provider.registerCorporateBroadcastTarget(panel.webview);

        panel.onDidDispose(() => this.dispose(), null, this._disposables);
        panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'officeReady':
                    this._sendInit();
                    break;
                case 'officePrompt': {
                    const prompt = String(msg.value || '').trim();
                    if (!prompt) return;
                    const model = provider.getDefaultModel();
                    provider.runCorporatePromptExternal(prompt, model).catch((e) => {
                        try { panel.webview.postMessage({ type: 'error', value: `⚠️ ${e?.message || e}` }); } catch { /* ignore */ }
                    });
                    break;
                }
                case 'runChatter': {
                    const model = provider.getDefaultModel();
                    provider.runAutonomousChatter(model).catch(() => { /* silent */ });
                    break;
                }
                case 'loadConversations': {
                    try {
                        const convDir = getConversationsDir();
                        const today = new Date().toISOString().slice(0, 10);
                        const f = path.join(convDir, `${today}.md`);
                        const content = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : `_아직 오늘 대화가 없습니다._\n\n경로: ${convDir.replace(os.homedir(), '~')}/${today}.md`;
                        panel.webview.postMessage({ type: 'conversationsLoaded', date: today, content });
                    } catch (e: any) {
                        panel.webview.postMessage({ type: 'conversationsLoaded', date: '', content: `_읽기 실패: ${e?.message || e}_` });
                    }
                    break;
                }
                case 'openCompanyFolder':
                    try {
                        const dir = ensureCompanyStructure();
                        const sub = msg.sub || '';
                        const target = sub ? path.join(dir, sub) : dir;
                        vscode.env.openExternal(vscode.Uri.file(target));
                    } catch { /* ignore */ }
                    break;
                case 'openDashboard':
                    try { vscode.commands.executeCommand('connectAiLab.dashboard.open'); } catch { /* ignore */ }
                    break;
                case 'openApiConnections':
                    try { vscode.commands.executeCommand('connectAiLab.apiConnections.open'); } catch { /* ignore */ }
                    break;
                case 'toggleAutoCycle':
                    try {
                        await vscode.workspace.getConfiguration('connectAiLab').update('autoCycleEnabled', !!msg.on, vscode.ConfigurationTarget.Global);
                        if (msg.on) _activeChatProvider?.startAutoCycle?.(15, 0);
                        else _activeChatProvider?.stopAutoCycle?.();
                    } catch { /* ignore */ }
                    break;
                case 'pickCompanyFolder': {
                    try {
                        const picked = await vscode.window.showOpenDialog({
                            canSelectFolders: true,
                            canSelectFiles: false,
                            canSelectMany: false,
                            openLabel: '회사 폴더로 선택',
                            title: '회사 폴더 선택 — 에이전트들의 작업/메모리/세션이 여기에 저장됩니다'
                        });
                        if (!picked || picked.length === 0) break;
                        const newDir = picked[0].fsPath;
                        await setCompanyDir(newDir);
                        ensureCompanyStructure();
                        this._sendInit();
                        this._panel.webview.postMessage({ type: 'companyFolderChanged', dir: newDir.replace(os.homedir(), '~') });
                        vscode.window.showInformationMessage(`🏢 회사 폴더 변경됨: ${newDir}`);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`폴더 변경 실패: ${e?.message || e}`);
                    }
                    break;
                }
                case 'agentProfileRequest': {
                    try {
                        const id = String(msg.agent || '');
                        const dir = ensureCompanyStructure();
                        const agentDir = path.join(dir, '_agents', id);
                        const memoryPath = path.join(agentDir, 'memory.md');
                        const decisionsPath = path.join(agentDir, 'decisions.md');
                        const memory = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8').slice(0, 4000) : '_메모리 없음_';
                        const decisions = fs.existsSync(decisionsPath) ? fs.readFileSync(decisionsPath, 'utf-8').slice(-3000) : '_의사결정 기록 없음_';
                        /* count session files mentioning this agent */
                        const sessionsRoot = path.join(dir, 'sessions');
                        let sessionCount = 0;
                        let recentSessions: string[] = [];
                        if (fs.existsSync(sessionsRoot)) {
                            const entries = fs.readdirSync(sessionsRoot).filter(n => fs.statSync(path.join(sessionsRoot, n)).isDirectory());
                            recentSessions = entries.sort().slice(-5).reverse();
                            sessionCount = entries.length;
                        }
                        /* Profile photo (영숙/레오 등) — convert to a webview URI so
                           the modal can render the real face instead of just the
                           sprite. Empty string when no custom photo is declared. */
                        let profileImageUri = '';
                        try {
                            const pi = AGENTS[id]?.profileImage;
                            if (pi) {
                                const p = vscode.Uri.joinPath(this._ctx.extensionUri, 'assets', 'agents', pi);
                                if (fs.existsSync(p.fsPath)) {
                                    profileImageUri = this._panel.webview.asWebviewUri(p).toString();
                                }
                            }
                        } catch { /* ignore */ }
                        this._panel.webview.postMessage({
                            type: 'agentProfile',
                            agent: id,
                            memory, decisions,
                            sessionCount,
                            recentSessions,
                            profileImageUri,
                            agentDir: agentDir.replace(os.homedir(), '~')
                        });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'agentProfile', agent: msg.agent, error: e?.message || String(e) });
                    }
                    break;
                }
                case 'agentConfigRequest': {
                    try {
                        const id = String(msg.agent || '');
                        const dir = ensureCompanyStructure();
                        const connPath = path.join(dir, '_agents', id, 'connections.md');
                        const values: Record<string, string> = {};
                        if (fs.existsSync(connPath)) {
                            const text = fs.readFileSync(connPath, 'utf-8');
                            /* Parse simple "- key: value" lines (also tolerates "key: value") */
                            text.split('\n').forEach(line => {
                                const m2 = line.match(/^[\s-]*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+?)\s*$/);
                                if (m2) values[m2[1]] = m2[2];
                            });
                        }
                        this._panel.webview.postMessage({ type: 'agentConfig', agent: id, values });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'agentConfig', agent: msg.agent, values: {}, error: e?.message || String(e) });
                    }
                    break;
                }
                case 'saveAgentConfig': {
                    try {
                        const id = String(msg.agent || '');
                        const dir = ensureCompanyStructure();
                        const agentDir = path.join(dir, '_agents', id);
                        if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });
                        const connPath = path.join(agentDir, 'connections.md');
                        const values = (msg.values || {}) as Record<string, string>;
                        const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
                        const lines = [
                            `# ${id} — 외부 연결 / API 설정`,
                            ``,
                            `> 마지막 수정: ${ts}`,
                            `> 이 파일은 ${id} 에이전트가 작업할 때 자동으로 읽힙니다. 민감한 토큰은 git에서 제외(.gitignore)되도록 주의하세요.`,
                            ``,
                            `## 연결 정보`,
                            ``
                        ];
                        Object.keys(values).forEach(k => {
                            const v = (values[k] || '').trim();
                            if (v) lines.push(`- ${k}: ${v}`);
                        });
                        fs.writeFileSync(connPath, lines.join('\n') + '\n', 'utf-8');
                        this._panel.webview.postMessage({ type: 'agentConfigSaved', agent: id });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ type: 'agentConfigSaved', agent: msg.agent, error: e?.message || String(e) });
                    }
                    break;
                }
            }
        }, null, this._disposables);

        panel.webview.html = this._renderHtml();
    }

    /** 사용자가 설정에 명시적으로 추가 자산 경로를 지정한 경우만 사용. 그 외엔 vsix 번들 자산 사용. */
    private static _resolveUserAssetsPath(): string {
        const cfg = vscode.workspace.getConfiguration('connectAiLab');
        const explicit = (cfg.get<string>('assetsPath') || '').trim();
        if (explicit && fs.existsSync(explicit)) return explicit;
        // Dev mode: extension repo includes the LimeZu pack at
        // `assets/pixel/moderninteriors-win` (excluded from vsix via .vscodeignore).
        if (_extCtx) {
            const dev = path.join(_extCtx.extensionPath, 'assets', 'pixel', 'moderninteriors-win');
            if (fs.existsSync(dev)) return dev;
        }
        return '';
    }

    /** 캐릭터 sprite를 결정. 우선순위: 사용자 LimeZu 폴더 > 번들 자산 > 빈 문자열(이모지 폴백) */
    private _resolveCharacterSprite(agentId: string): { uri: string; source: 'user' | 'bundled' | 'none' } {
        const userPath = OfficePanel._resolveUserAssetsPath();
        if (userPath) {
            const idx: Record<string, number> = {
                ceo: 1, youtube: 2, instagram: 3, designer: 4,
                developer: 5, business: 6, secretary: 7
            };
            const num = idx[agentId];
            if (num) {
                const padded = String(num).padStart(2, '0');
                const candidates = [
                    // Real LimeZu folder structure
                    path.join(userPath, '2_Characters', 'Character_Generator', '0_Premade_Characters', '48x48', `Premade_Character_48x48_${padded}.png`),
                    // Legacy/flattened layout
                    path.join(userPath, 'modern-interiors', 'characters', `Premade_Character_48x48_${padded}.png`),
                ];
                for (const file of candidates) {
                    if (fs.existsSync(file)) {
                        return { uri: this._panel.webview.asWebviewUri(vscode.Uri.file(file)).toString(), source: 'user' };
                    }
                }
            }
        }
        // 번들 자산 (vsix에 포함, 모든 사용자에게 동작)
        const bundled = vscode.Uri.joinPath(this._ctx.extensionUri, 'assets', 'pixel', 'characters', `${agentId}.png`);
        if (fs.existsSync(bundled.fsPath)) {
            return { uri: this._panel.webview.asWebviewUri(bundled).toString(), source: 'bundled' };
        }
        return { uri: '', source: 'none' };
    }

    /** Resolve all WORLD_LAYOUT scene + decoration assets to webview URIs.
     *  Returns the data shape the webview officeInit handler expects. */
    private _resolveWorld(): {
        worldWidth: number;
        worldHeight: number;
        grassUri: string;
        pathUri: string;
        paths: Array<{ x: number; y: number; w: number; h: number; }>;
        buildings: Array<{ id: string; layer1Uri: string; layer2Uri: string; x: number; y: number; width: number; height: number; }>;
        decorations: Array<{ uri: string; x: number; y: number; w?: number; }>;
        desks: Record<string, DeskPos>;
        zones: WorldZone[];
    } {
        const officeDir = vscode.Uri.joinPath(this._ctx.extensionUri, 'assets', 'pixel', 'office');
        const gardenDir = vscode.Uri.joinPath(officeDir, 'garden');
        const toUri = (root: vscode.Uri, file: string) => {
            if (!file) return '';
            const fp = vscode.Uri.joinPath(root, file);
            if (!fs.existsSync(fp.fsPath)) return '';
            return this._panel.webview.asWebviewUri(fp).toString();
        };
        const buildings = WORLD_LAYOUT.buildings.map(b => ({
            id: b.id,
            layer1Uri: toUri(officeDir, b.layer1),
            layer2Uri: toUri(officeDir, b.layer2 || ''),
            x: b.x, y: b.y, width: b.width, height: b.height,
        }));
        const decorations = WORLD_LAYOUT.decorations
            .map(d => ({ uri: toUri(gardenDir, d.file), x: d.x, y: d.y, w: d.w }))
            .filter(d => !!d.uri);
        return {
            worldWidth: WORLD_LAYOUT.worldWidth,
            worldHeight: WORLD_LAYOUT.worldHeight,
            grassUri: toUri(gardenDir, 'grass_base.png'),
            pathUri: toUri(gardenDir, 'path_stone.png'),
            paths: WORLD_LAYOUT.paths,
            buildings,
            decorations,
            desks: buildWorldDeskPositions(),
            zones: WORLD_LAYOUT.zones,
        };
    }

    /** Detect a user-supplied office map (PNG/JPG/JPEG). If present, the webview
     *  replaces the procedural WORLD_LAYOUT (grass + buildings + decor) with this
     *  single full-stage image. Useful for AI-generated or hand-drawn full-floor maps.
     *  Search order: brain dir _world/, brain dir root, then extension assets/. */
    private _resolveCustomOfficeMap(): string {
        try {
            const brain = getCompanyDir();
            const extAssets = vscode.Uri.joinPath(this._ctx.extensionUri, 'assets').fsPath;
            const candidates = [
                path.join(brain, '_world', 'office-map.png'),
                path.join(brain, '_world', 'office-map.jpg'),
                path.join(brain, '_world', 'office-map.jpeg'),
                path.join(brain, 'office-map.png'),
                path.join(brain, 'office-map.jpg'),
                path.join(brain, 'office-map.jpeg'),
                path.join(extAssets, 'office-map.png'),
                path.join(extAssets, 'office-map.jpg'),
                path.join(extAssets, 'office-map.jpeg'),
                path.join(extAssets, 'map.png'),
                path.join(extAssets, 'map.jpg'),
                path.join(extAssets, 'map.jpeg'),
            ];
            for (const file of candidates) {
                if (fs.existsSync(file)) {
                    return this._panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
                }
            }
        } catch { /* ignore */ }
        return '';
    }

    private _sendInit() {
        const characterUris: Record<string, string> = {};
        const sources: Record<string, string> = {};
        let firstUri = '';
        const missing: string[] = [];
        for (const id of AGENT_ORDER) {
            const r = this._resolveCharacterSprite(id);
            if (r.uri) {
                characterUris[id] = r.uri;
                sources[id] = r.source;
                if (!firstUri) firstUri = r.uri;
            } else {
                missing.push(id);
            }
        }
        const agents = AGENT_ORDER.map(id => ({
            id,
            name: AGENTS[id].name,
            role: AGENTS[id].role,
            emoji: AGENTS[id].emoji,
            color: AGENTS[id].color,
            specialty: AGENTS[id].specialty,
            sprite: characterUris[id] || ''
        }));
        const dir = getCompanyDir();
        const userPath = OfficePanel._resolveUserAssetsPath();
        const bundledCount = Object.values(sources).filter(s => s === 'bundled').length;
        const userCount = Object.values(sources).filter(s => s === 'user').length;
        // Phase-B-1 connected campus: Office + Cafe + Garden in one world.
        // If user dropped a custom full-stage map (e.g. assets/map.jpeg),
        // that single PNG replaces the procedural world (grass + buildings + decor)
        // AND we override desk positions with hand-tuned CUSTOM_MAP_DESKS so each
        // agent sits in the right room on the AI-generated map.
        const world = this._resolveWorld();
        const customMapUri = this._resolveCustomOfficeMap();
        if (customMapUri) {
            world.desks = { ...world.desks, ...CUSTOM_MAP_DESKS };
        }
        const workdayOn = vscode.workspace.getConfiguration('connectAiLab').get<boolean>('autoCycleEnabled', true);
        this._panel.webview.postMessage({
            type: 'officeInit',
            agents,
            companyName: readCompanyName() || '1인 기업',
            companyDir: dir.replace(os.homedir(), '~'),
            assetsAvailable: Object.keys(characterUris).length > 0,
            world,
            customMapUri,
            workdayOn,
            debug: {
                userPath,
                bundledCount,
                userCount,
                missing,
                firstSpriteUri: firstUri,
                buildingsLoaded: world.buildings.filter(b => b.layer1Uri).length,
                decorationsLoaded: world.decorations.length,
                customMap: customMapUri ? 'OK' : 'none',
            }
        });
    }

    public dispose() {
        try { this._provider.unregisterCorporateBroadcastTarget(this._panel.webview); } catch { /* ignore */ }
        OfficePanel.current = undefined;
        try { this._provider.broadcastOfficeState(false); } catch { /* ignore */ }
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            try { d?.dispose(); } catch { /* ignore */ }
        }
    }

    private _renderHtml(): string {
        const csp = this._panel.webview.cspSource;
        return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data: blob: https: vscode-resource: vscode-webview-resource:; style-src ${csp} 'unsafe-inline'; script-src 'unsafe-inline'; font-src ${csp} data:;">
<title>🏢 가상 사무실</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'SF Pro Display',-apple-system,'Segoe UI',sans-serif}
/* v2.86: unified to the matrix black + green palette across the whole app
   so the office, dashboard, and chat all share one identity. The amber
   override that used to flip on for "1인 기업 모드" is removed — having
   two parallel colors made the product feel like two different apps. */
:root{--accent:#00FF41;--accent2:#008F11;--accent-glow:rgba(0,255,65,.22);--bg:#040608;--bg2:#080B10;--surface:rgba(15,22,30,.78);--border:rgba(255,255,255,.06);--text:#E5E7EB;--text-dim:#8A95A3;--text-bright:#fff}
html,body{width:100%;height:100%;background:var(--bg);color:var(--text);overflow:hidden}
body{display:flex;flex-direction:column}

/* ===== Top bar (v2.83 redesign) =====
   Three-zone layout — brand on the left, HUD stat strip in the middle,
   action buttons on the right. Replaces the old cramped single-row stack. */
.topbar{
  position:relative;display:grid;grid-template-columns:auto 1fr auto;
  align-items:center;gap:20px;padding:14px 22px;
  background:linear-gradient(180deg,rgba(10,8,5,.96),rgba(8,7,4,.78));
  border-bottom:1px solid var(--border);flex-shrink:0;
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:10;
  font-family:'Inter','SF Pro Display',-apple-system,system-ui,sans-serif;
}
.topbar::after{
  content:'';position:absolute;left:0;right:0;bottom:-1px;height:1px;
  background:linear-gradient(90deg,transparent 5%,var(--accent) 50%,transparent 95%);
  opacity:.35;animation:lineGlow 4s infinite alternate;
}
@keyframes lineGlow{0%{opacity:.18}100%{opacity:.55}}

/* --- Brand zone --- */
.brand-block{display:flex;align-items:center;gap:14px;min-width:0}
.brand-mark{
  width:38px;height:38px;border-radius:12px;flex-shrink:0;
  background:linear-gradient(135deg,rgba(0,255,65,.18),rgba(0,143,17,.04));
  border:1px solid var(--accent-glow);
  display:flex;align-items:center;justify-content:center;font-size:20px;
  box-shadow:0 0 16px rgba(0,255,65,.18),inset 0 0 0 1px rgba(255,255,255,.04);
}
.brand-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.brand-row{display:flex;align-items:center;gap:6px;min-width:0}
.brand-name{
  font-size:16px;font-weight:800;color:var(--text);letter-spacing:-.2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;
}
.brand-name.loading{color:var(--text-dim);font-weight:500;font-style:italic}
.brand-sub{
  font-size:10.5px;color:var(--text-dim);font-weight:500;
  text-transform:uppercase;letter-spacing:1.4px;
}
.brand-edit{
  background:transparent;border:1px solid var(--border);color:var(--text-dim);
  width:24px;height:24px;border-radius:7px;cursor:pointer;font-size:11px;
  display:inline-flex;align-items:center;justify-content:center;
  transition:all .2s;padding:0;flex-shrink:0;
}
.brand-edit:hover{color:var(--accent);border-color:var(--accent);box-shadow:0 0 10px var(--accent-glow)}

/* --- HUD strip --- */
.hud{
  display:flex;align-items:center;justify-content:center;gap:8px;
  font-family:'Inter','SF Pro Display',sans-serif;
}
.hud .stat{
  display:flex;align-items:center;gap:8px;
  padding:7px 13px;border-radius:10px;
  background:rgba(0,255,65,.04);
  border:1px solid rgba(0,255,65,.16);
  transition:border-color .2s,background .2s;
}
.hud .stat:hover{border-color:rgba(0,255,65,.32);background:rgba(0,255,65,.06)}
.hud .stat .icon{font-size:14px;opacity:.85;line-height:1}
.hud .stat .text{display:flex;flex-direction:column;line-height:1.1}
.hud .stat .lbl{
  color:var(--text-dim);font-size:8.5px;letter-spacing:1.4px;
  text-transform:uppercase;opacity:.7;font-weight:600;
}
.hud .stat .val{
  color:var(--accent);font-weight:800;font-size:14px;
  font-variant-numeric:tabular-nums;
  text-shadow:0 0 10px var(--accent-glow);letter-spacing:-.3px;
}
.hud .stat.live{position:relative}
.hud .stat.live::before{
  content:'';position:absolute;top:6px;right:6px;
  width:6px;height:6px;border-radius:50%;background:#ef4444;
  box-shadow:0 0 6px #ef4444,0 0 12px rgba(239,68,68,.5);
  animation:liveBlink 1.4s infinite;
}
@keyframes liveBlink{0%,49%{opacity:1}50%,100%{opacity:.3}}
.hud .stat.warn{border-color:rgba(255,171,64,.3)}
.hud .stat.warn .val{color:#ffab40;text-shadow:0 0 6px rgba(255,171,64,.4)}
@media (max-width:900px){
  .hud .stat:nth-child(n+3){display:none}
}

/* --- Action buttons --- */
.actions{display:flex;align-items:center;gap:8px}
.topbtn{
  font-family:inherit;font-size:12px;font-weight:600;
  padding:9px 14px;border-radius:10px;cursor:pointer;
  background:rgba(255,255,255,.03);
  border:1px solid var(--border);color:var(--text);
  transition:all .2s cubic-bezier(.16,1,.3,1);
  display:inline-flex;align-items:center;gap:6px;
  letter-spacing:-.1px;
}
.topbtn:hover{
  background:rgba(255,255,255,.06);border-color:rgba(0,255,65,.3);
  color:var(--accent);transform:translateY(-1px);
  box-shadow:0 4px 14px rgba(0,0,0,.4);
}
.topbtn.primary{
  background:linear-gradient(135deg,#6cff7c 0%,#00FF41 50%,#008F11 100%);
  color:#001a0d;border-color:transparent;font-weight:700;
  box-shadow:0 4px 16px rgba(0,255,65,.3),inset 0 1px 0 rgba(255,255,255,.3);
}
.topbtn.primary:hover{
  filter:brightness(1.08);transform:translateY(-2px);
  box-shadow:0 8px 28px rgba(0,255,65,.45),inset 0 1px 0 rgba(255,255,255,.3);
}
.topbtn.ghost{background:transparent;color:var(--text-dim)}
.topbtn.ghost:hover{background:rgba(255,255,255,.04);color:var(--text)}

/* 24h workday toggle — distinct on/off pill with live dot. */
#workdayBtn{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:11.5px}
#workdayBtn::before{
  content:'';width:7px;height:7px;border-radius:50%;
  background:var(--text-dim);transition:all .3s;flex-shrink:0;
}
#workdayBtn.on{
  background:linear-gradient(135deg,rgba(0,255,65,.20),rgba(0,255,65,.06));
  border-color:var(--accent);color:var(--accent);
  text-shadow:0 0 8px var(--accent-glow);
  box-shadow:0 0 16px rgba(0,255,65,.20),inset 0 0 0 1px rgba(0,255,65,.20);
}
#workdayBtn.on::before{
  background:var(--accent);
  box-shadow:0 0 8px var(--accent),0 0 14px var(--accent-glow);
  animation:workdayLiveDot 1.4s ease-in-out infinite;
}
#workdayBtn.off{
  background:rgba(0,0,0,.3);border-color:var(--border);
  color:var(--text-dim);opacity:.65;
}
@keyframes workdayLiveDot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.5);opacity:.5}}

/* Legacy mini button — kept for backward compat but no longer used in topbar. */
.topbtn-mini{background:transparent;border:1px solid var(--border);color:var(--text-dim);width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:11px;display:inline-flex;align-items:center;justify-content:center;margin-left:4px;transition:all .25s;padding:0}
.topbtn-mini:hover{color:var(--accent);border-color:var(--accent);box-shadow:0 0 8px var(--accent-glow)}

/* Subtle status row beneath topbar — shows live agent activity summary. */
.status-row{
  display:flex;align-items:center;gap:14px;
  padding:6px 22px;font-size:10.5px;color:var(--text-dim);
  background:rgba(0,0,0,.2);border-bottom:1px solid var(--border);
  font-family:'Inter',sans-serif;letter-spacing:.2px;
}
.status-row .pulse-dot{
  width:6px;height:6px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 6px var(--accent);
  animation:liveBlink 1.6s ease-in-out infinite;
}
.status-row .sep{opacity:.3}
.status-row .text{color:var(--text)}

/* ===== Office Floor — unified office (single Office_Design_2.gif bg) =====
   Legacy TV-studio dual-layer rules (bg-stack, office-fg, office-anims) and
   the conflicting office-bg transform translate(-50%, -50%) shorthand have
   been removed — they were pulling the bg image off-screen by half its own
   size. */
.office-wrap{flex:1;display:flex;min-height:0}
.office-floor{flex:1;position:relative;overflow:hidden;border-right:1px solid var(--border);background:#070A0F}

/* === Unified office stage — ONE pre-built office bg fills the floor area ===
   stageInner has a fixed aspect-ratio matching the bg image (512×544).
   Agents are children of stageInner and use % coords that map directly to
   the bg image, so a character at (78,80)% lands inside the CEO office
   regardless of panel size. */
.office-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:0;background:#070A0F}
/* stageInner sized inline by fitStage() to maintain world aspect ratio (1400/700). */
.office-stage-inner{position:relative;--char-scale:1.5;overflow:hidden;border-radius:6px;box-shadow:0 0 0 1px rgba(0,255,65,.18),0 8px 32px rgba(0,0,0,.6)}

/* Garden grass — tiled LimeZu grass texture (base layer of world canvas).
   Tile size set inline by JS based on world scale so pixels stay crisp. */
.world-grass{position:absolute;inset:0;background-repeat:repeat;image-rendering:pixelated;image-rendering:crisp-edges;pointer-events:none;z-index:0}
/* Stone walkway paths between buildings — same tiled texture pattern */
.world-paths{position:absolute;inset:0;pointer-events:none;z-index:1}
.world-paths .path-strip{position:absolute;background-repeat:repeat;image-rendering:pixelated;image-rendering:crisp-edges;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}
/* Buildings layer — pre-built scene PNGs/GIFs at fixed world pixel positions */
.world-buildings{position:absolute;inset:0;pointer-events:none;z-index:2}
.world-buildings img{position:absolute;image-rendering:pixelated;image-rendering:crisp-edges;display:block}
/* Decorations layer — single garden tiles (trees, benches, flowers) */
.world-decorations{position:absolute;inset:0;pointer-events:none;z-index:3}
.world-decorations img{position:absolute;image-rendering:pixelated;image-rendering:crisp-edges;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));display:block;transform:translate(-50%,-100%)}
.office-bg{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;pointer-events:none;display:block}
.office-zones{position:absolute;inset:0;pointer-events:none;z-index:2}
.office-zones .zone-label{position:absolute;font-family:'SF Mono',monospace;font-size:8px;letter-spacing:1px;color:var(--accent);text-transform:uppercase;text-shadow:0 0 6px rgba(0,255,65,.7),0 1px 2px rgba(0,0,0,.95);opacity:.55;transform:translate(-50%,-100%);white-space:nowrap;padding:1px 4px;border-radius:2px;background:rgba(0,8,4,.45)}
/* Hide legacy single-room overlay UI in unified-office mode. */
body.floorplan .conf-room,body.floorplan .location{display:none!important}
.office-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.45) 100%);pointer-events:none;z-index:3}

/* Floating particles drifting up — feels alive */
.particles{position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden}
.particles span{position:absolute;width:2px;height:2px;border-radius:50%;background:rgba(0,255,65,.45);box-shadow:0 0 4px rgba(0,255,65,.7);animation:floatUp 14s linear infinite;opacity:0}
@keyframes floatUp{0%{transform:translateY(0);opacity:0}10%{opacity:.8}90%{opacity:.6}100%{transform:translateY(-100vh);opacity:0}}

/* Conference room — glass-walled boardroom with holographic projection */
.conf-room{position:absolute;left:50%;top:3%;transform:translateX(-50%);width:42%;min-width:340px;max-width:560px;height:20%;min-height:130px;
  background:
    linear-gradient(180deg,rgba(0,255,65,.07),rgba(0,143,17,.02)),
    radial-gradient(ellipse at 50% 100%,rgba(0,255,65,.12),transparent 60%);
  border:1px solid rgba(0,255,65,.5);border-radius:14px;
  box-shadow:
    inset 0 0 40px rgba(0,255,65,.1),
    inset 0 0 0 1px rgba(0,0,0,.5),
    0 8px 28px rgba(0,255,65,.18),
    0 0 60px rgba(0,255,65,.08);
  z-index:4;
  backdrop-filter:blur(2px)}
/* corner brackets — futuristic frame */
.conf-room::before{content:'';position:absolute;top:0;left:0;width:18px;height:18px;border-top:2px solid var(--accent);border-left:2px solid var(--accent);border-radius:14px 0 0 0;opacity:.7}
.conf-room::after{content:'';position:absolute;top:0;right:0;width:18px;height:18px;border-top:2px solid var(--accent);border-right:2px solid var(--accent);border-radius:0 14px 0 0;opacity:.7}
.conf-label{position:absolute;top:6px;left:50%;transform:translateX(-50%);font-family:'SF Mono',monospace;font-size:8px;letter-spacing:4px;color:var(--accent);opacity:.85;text-shadow:0 0 8px var(--accent-glow);z-index:5}
.conf-label::before{content:'◆ ';opacity:.6}
.conf-label::after{content:' ◆';opacity:.6}

/* glass holographic projection — shows brief during commands */
.whiteboard{position:absolute;top:20px;left:50%;transform:translateX(-50%);width:82%;max-width:420px;height:54px;
  background:linear-gradient(180deg,rgba(0,30,15,.92),rgba(0,15,8,.95));
  border:1px solid rgba(0,255,65,.3);border-radius:6px;
  display:flex;align-items:center;justify-content:center;
  font-family:'SF Mono',monospace;font-size:10.5px;color:var(--text-dim);text-align:center;padding:8px;line-height:1.4;overflow:hidden;
  box-shadow:inset 0 0 14px rgba(0,255,65,.06),0 0 0 1px rgba(0,0,0,.5)}
.whiteboard::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,255,65,.05) 2px 3px);pointer-events:none}
.whiteboard.active{border-color:var(--accent);background:linear-gradient(180deg,rgba(0,40,20,.95),rgba(0,20,10,.98));color:var(--text);box-shadow:inset 0 0 22px rgba(0,255,65,.18),0 0 24px var(--accent-glow);animation:wbPulse 2.4s ease-in-out infinite}
@keyframes wbPulse{0%,100%{box-shadow:inset 0 0 22px rgba(0,255,65,.18),0 0 24px var(--accent-glow)}50%{box-shadow:inset 0 0 28px rgba(0,255,65,.28),0 0 38px var(--accent-glow)}}
.whiteboard .wb-line{display:block;animation:wbType .4s ease-out backwards;position:relative;z-index:1}
@keyframes wbType{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:translateY(0)}}

/* conference table with holographic glow on top */
.conf-table{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);width:78%;height:26%;
  background:linear-gradient(180deg,#1a2028 0%,#0c1218 100%);
  border:1px solid rgba(0,255,65,.25);border-radius:50px;
  box-shadow:
    0 6px 14px rgba(0,0,0,.6),
    inset 0 1px 0 rgba(0,255,65,.15),
    inset 0 0 20px rgba(0,255,65,.06)}
.conf-table::before{content:'';position:absolute;left:8%;right:8%;top:30%;bottom:30%;background:radial-gradient(ellipse,rgba(0,255,65,.15),transparent 70%);border-radius:50%;animation:tablePulse 3s ease-in-out infinite}
@keyframes tablePulse{0%,100%{opacity:.5}50%{opacity:1}}

/* Workstations — proper desk with dual monitors, LED strip, PC tower */
.desk{position:absolute;width:108px;height:78px;transform:translate(-50%,-50%);z-index:3;pointer-events:none}
.desk .ds-top{position:absolute;left:0;right:0;top:24px;height:32px;
  background:linear-gradient(180deg,#1a2028 0%,#0c1218 100%);
  border:1px solid rgba(0,255,65,.2);border-radius:4px;
  box-shadow:0 4px 8px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.04)}
/* desk LED strip — glows in agent color */
.desk .ds-top::before{content:'';position:absolute;left:6px;right:6px;bottom:1px;height:1.5px;background:var(--ag-color,var(--accent));box-shadow:0 0 6px var(--ag-color,var(--accent));opacity:.8;border-radius:1px;animation:ledStripPulse 3s ease-in-out infinite}
@keyframes ledStripPulse{0%,100%{opacity:.5}50%{opacity:1}}
/* PC tower under desk */
.desk .ds-top::after{content:'';position:absolute;right:4px;bottom:-12px;width:9px;height:14px;background:linear-gradient(135deg,#1c2228,#0a0e14);border:1px solid rgba(255,255,255,.06);border-radius:1.5px;box-shadow:0 0 4px rgba(0,255,65,.2)}

/* Dual monitor frame */
.desk .ds-monitor{position:absolute;left:50%;top:0;transform:translateX(-50%);width:80px;height:30px;display:flex;gap:2px;justify-content:center}
.desk .ds-screen{flex:0 0 38px;height:26px;background:#000;border:1.2px solid #2a3038;border-radius:2px;
  box-shadow:0 0 10px rgba(0,255,65,.18),inset 0 0 0 1px rgba(0,0,0,.5);
  overflow:hidden;position:relative}
/* monitor stand */
.desk .ds-monitor::after{content:'';position:absolute;left:50%;bottom:-4px;transform:translateX(-50%);width:14px;height:4px;background:#1a1f26;border-radius:0 0 4px 4px;box-shadow:0 1px 2px rgba(0,0,0,.6)}
/* scanline overlay on each screen */
.desk .ds-screen::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 1px,rgba(0,0,0,.25) 1px 2px);pointer-events:none;z-index:3}
.desk .ds-screen::before{content:'';position:absolute;inset:0;z-index:1}

/* Per-agent screen content */
/* CEO: command graph with sweeping radar arm */
.desk[data-agent="ceo"] .ds-screen::before{background:radial-gradient(circle at 50% 50%,rgba(0,255,65,.4) 0%,rgba(0,255,65,0) 1px,rgba(0,255,65,.1) 2px,rgba(0,255,65,0) 3px,rgba(0,255,65,.1) 6px,rgba(0,255,65,0) 7px,rgba(0,255,65,.08) 12px,rgba(0,255,65,0) 13px),conic-gradient(from 0deg,rgba(0,255,65,.5),transparent 70%);animation:radarSweep 4s linear infinite}
@keyframes radarSweep{from{transform:rotate(0)}to{transform:rotate(360deg)}}

/* Developer: scrolling code lines */
.desk[data-agent="developer"] .ds-screen::before{background:repeating-linear-gradient(0deg,transparent 0 3px,rgba(34,211,238,.7) 3px 4px,transparent 4px 7px,rgba(34,211,238,.4) 7px 8px,transparent 8px 12px,rgba(34,211,238,.55) 12px 13px,transparent 13px 16px,rgba(34,211,238,.3) 16px 17px,transparent 17px 22px);background-size:100% 22px;animation:codeScroll 3s linear infinite}
@keyframes codeScroll{from{background-position:0 0}to{background-position:0 22px}}

/* Designer: rotating color swatches */
.desk[data-agent="designer"] .ds-screen::before{background:conic-gradient(from 0deg,#FF0033 0deg 60deg,#FBBF24 60deg 120deg,#22D3EE 120deg 180deg,#A78BFA 180deg 240deg,#34D399 240deg 300deg,#E1306C 300deg 360deg);filter:saturate(.85) brightness(.7);animation:colorSpin 8s linear infinite;border-radius:50%;margin:6px}
@keyframes colorSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}

/* YouTube: red bars rising/falling like audio meter */
.desk[data-agent="youtube"] .ds-screen::before{background:linear-gradient(90deg,
  rgba(255,0,51,.7) 0%,rgba(255,0,51,.7) 8%,transparent 8% 12%,
  rgba(255,0,51,.5) 12% 20%,transparent 20% 24%,
  rgba(255,0,51,.8) 24% 32%,transparent 32% 36%,
  rgba(255,0,51,.4) 36% 44%,transparent 44% 48%,
  rgba(255,0,51,.6) 48% 56%,transparent 56% 60%,
  rgba(255,0,51,.7) 60% 68%,transparent 68% 72%,
  rgba(255,0,51,.5) 72% 80%,transparent 80% 84%,
  rgba(255,0,51,.6) 84% 92%,transparent 92% 100%);background-size:100% 100%;animation:audioBars .6s ease-in-out infinite alternate;mask-image:linear-gradient(0deg,#000 0%,#000 100%)}
@keyframes audioBars{from{filter:hue-rotate(0deg)}to{filter:hue-rotate(20deg) brightness(1.2)}}

/* Instagram: pink heart pulse + grid */
.desk[data-agent="instagram"] .ds-screen::before{background:radial-gradient(circle at 50% 55%,rgba(225,48,108,.85) 0%,rgba(225,48,108,.5) 20%,transparent 35%),repeating-linear-gradient(0deg,rgba(247,119,55,.15) 0 4px,transparent 4px 8px),repeating-linear-gradient(90deg,rgba(247,119,55,.15) 0 4px,transparent 4px 8px);animation:igPulse 1.6s ease-in-out infinite}
@keyframes igPulse{0%,100%{transform:scale(.95);opacity:.7}50%{transform:scale(1.05);opacity:1}}

/* Business: bar chart growing */
.desk[data-agent="business"] .ds-screen::before{background:linear-gradient(0deg,rgba(251,191,36,.7) 0%,rgba(251,191,36,.7) 30%,transparent 30%) 0 100%/12% 100% no-repeat,linear-gradient(0deg,rgba(251,191,36,.7) 0%,rgba(251,191,36,.7) 50%,transparent 50%) 16% 100%/12% 100% no-repeat,linear-gradient(0deg,rgba(251,191,36,.7) 0%,rgba(251,191,36,.7) 70%,transparent 70%) 32% 100%/12% 100% no-repeat,linear-gradient(0deg,rgba(251,191,36,.7) 0%,rgba(251,191,36,.7) 45%,transparent 45%) 48% 100%/12% 100% no-repeat,linear-gradient(0deg,rgba(251,191,36,.7) 0%,rgba(251,191,36,.7) 85%,transparent 85%) 64% 100%/12% 100% no-repeat,linear-gradient(0deg,rgba(251,191,36,.7) 0%,rgba(251,191,36,.7) 60%,transparent 60%) 80% 100%/12% 100% no-repeat;animation:barsRise 2.4s ease-in-out infinite alternate}
@keyframes barsRise{from{filter:brightness(.7)}to{filter:brightness(1.2)}}

/* Secretary: scrolling event list */
.desk[data-agent="secretary"] .ds-screen::before{background:repeating-linear-gradient(0deg,rgba(52,211,153,.55) 0 2px,transparent 2px 4px,rgba(52,211,153,.3) 4px 5px,transparent 5px 8px);background-size:100% 16px;animation:listScroll 4s linear infinite}
@keyframes listScroll{from{background-position:0 0}to{background-position:0 16px}}

/* second screen — slightly dimmer secondary feed */
.desk .ds-screen.s2{opacity:.65}

.desk .ds-chair{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:30px;height:18px;
  background:linear-gradient(180deg,#1a2030,#0c1220);
  border:1px solid rgba(0,255,65,.18);border-radius:5px 5px 9px 9px;
  box-shadow:0 2px 4px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.04)}
.desk[data-side="bottom"] .ds-chair{top:0;bottom:auto;border-radius:9px 9px 5px 5px}
.desk[data-side="bottom"] .ds-monitor{top:auto;bottom:0}
.desk[data-side="bottom"] .ds-top{top:auto;bottom:24px}

.desk-label{position:absolute;left:50%;bottom:-12px;transform:translateX(-50%);font-family:'SF Mono',monospace;font-size:7px;letter-spacing:1.5px;color:var(--ag-color,var(--text-dim));opacity:.6;white-space:nowrap;text-transform:uppercase;text-shadow:0 0 4px var(--ag-color-glow,transparent)}
.desk[data-side="bottom"] .desk-label{bottom:auto;top:-12px}

/* Decor — emoji icons with subtle float */
.decor{position:absolute;pointer-events:none;z-index:3;font-size:24px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.7));animation:decorFloat 5s ease-in-out infinite}
.decor:nth-of-type(odd){animation-delay:-2s}
@keyframes decorFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}

/* ===== Locations — Smallville routine destinations (JS positions to bg-image %) ===== */
.location{position:absolute;transform:translate(-50%,-50%);z-index:5;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:2px;background:rgba(0,0,0,.65);border:1px solid rgba(0,255,65,.4);border-radius:8px;padding:4px 8px;backdrop-filter:blur(2px)}
.location .loc-icon{font-size:18px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.8))}
.location .loc-label{font-family:'SF Mono',monospace;font-size:7px;letter-spacing:1.5px;color:var(--accent);opacity:.85;white-space:nowrap;text-transform:uppercase;text-shadow:0 0 4px var(--accent-glow)}
.location.active{animation:locPulse 1.5s ease-in-out infinite;border-color:var(--accent);box-shadow:0 0 14px var(--accent-glow)}
@keyframes locPulse{0%,100%{box-shadow:0 0 14px var(--accent-glow)}50%{box-shadow:0 0 22px var(--accent-glow)}}
.loc-brain{border-color:rgba(167,139,250,.6)}
.loc-brain .loc-label{color:#A78BFA;text-shadow:0 0 4px rgba(167,139,250,.5)}
.loc-brain.active{border-color:#A78BFA;box-shadow:0 0 16px rgba(167,139,250,.6)}

/* ===== Status icon above each agent (mood/state) ===== */
.ag-status{position:absolute;top:-22px;left:50%;transform:translateX(-50%);font-size:11px;background:rgba(8,10,15,.92);border:1px solid var(--ag-color,var(--accent));border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;line-height:1;z-index:8;box-shadow:0 0 6px var(--ag-color-glow,var(--accent-glow));transition:all .3s;animation:statusPop .35s cubic-bezier(.16,1,.3,1)}
@keyframes statusPop{from{transform:translateX(-50%) scale(0)}to{transform:translateX(-50%) scale(1)}}
.ag-status.fade{opacity:0;transform:translateX(-50%) scale(.8)}

/* Thought bubble (small dotted bubble for inner monologue) */
.thought{position:absolute;left:50%;bottom:calc(100% + 22px);transform:translateX(-50%);background:rgba(8,10,15,.94);border:1px dashed var(--ag-color,var(--accent));border-radius:14px;padding:5px 11px;font-size:9.5px;font-style:italic;color:var(--text-dim);white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;font-family:'SF Mono',monospace;z-index:19;box-shadow:0 4px 12px rgba(0,0,0,.6);animation:thoughtIn .4s cubic-bezier(.16,1,.3,1)}
.thought::after{content:'';position:absolute;left:50%;top:100%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:rgba(8,10,15,.94);border:1px dashed var(--ag-color,var(--accent));margin-top:2px}
.thought::before{content:'';position:absolute;left:calc(50% - 9px);top:calc(100% + 7px);width:3px;height:3px;border-radius:50%;background:rgba(8,10,15,.94);border:1px dashed var(--ag-color,var(--accent))}
@keyframes thoughtIn{from{opacity:0;transform:translateX(-50%) translateY(4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

/* ===== Agent profile modal — centered overlay with backdrop, on top of everything ===== */
/* ===== Agent profile modal (v2.84 polish) =====
   Reframed as an "employee card" — bigger avatar, clear identity strip,
   gentler stats grid, breathing room. Inter font matches topbar/dashboard. */
.agent-modal-backdrop{
  position:fixed;inset:0;
  background:rgba(0,5,10,.72);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  z-index:200;display:flex;align-items:center;justify-content:center;
  animation:amdBdIn .25s cubic-bezier(.16,1,.3,1);
  padding:24px;
}
.agent-modal-backdrop[hidden]{display:none}
@keyframes amdBdIn{from{opacity:0}to{opacity:1}}
.agent-modal{
  position:relative;width:min(480px,94vw);max-height:88vh;
  background:linear-gradient(180deg,rgba(20,16,10,.97),rgba(12,9,5,.98));
  border:1px solid var(--border);border-radius:18px;padding:24px;
  display:flex;flex-direction:column;gap:18px;
  box-shadow:0 24px 72px rgba(0,0,0,.85),0 0 60px rgba(0,255,65,.18),inset 0 1px 0 rgba(255,255,255,.04);
  overflow-y:auto;
  animation:amdIn .4s cubic-bezier(.16,1,.3,1);
  font-family:'Inter','SF Pro Display',sans-serif;
}
/* Subtle accent line on top — same brand cue as dashboard cards. */
.agent-modal::before{
  content:'';position:absolute;left:24px;right:24px;top:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--accent) 50%,transparent);
  opacity:.55;
}
@keyframes amdIn{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.agent-modal::-webkit-scrollbar{width:5px}
.agent-modal::-webkit-scrollbar-thumb{background:var(--accent);opacity:.4;border-radius:2px}
.amd-head{
  display:flex;align-items:center;gap:14px;
  padding-bottom:18px;border-bottom:1px solid var(--border);
}
.amd-emoji{
  font-size:30px;width:54px;height:54px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,rgba(255,182,39,.14),rgba(255,182,39,.03));
  border:1px solid var(--accent-glow);border-radius:14px;
  box-shadow:0 0 18px rgba(0,255,65,.18),inset 0 0 0 1px rgba(255,255,255,.04);
  overflow:hidden;
}
/* When a custom portrait is loaded (영숙/레오), drop the gradient and let
   the image cover the avatar tile completely. Adds a subtle inner ring so
   the photo blends with the brand's amber border. */
.amd-emoji.has-photo{background:transparent;padding:0}
.amd-photo{width:100%;height:100%;object-fit:cover;display:block;border-radius:13px}
.amd-title{flex:1;min-width:0}
.amd-name{
  font-size:18px;font-weight:800;color:var(--text);
  letter-spacing:-.3px;line-height:1.2;
}
.amd-role{
  font-size:10.5px;color:var(--text-dim);
  letter-spacing:1.4px;text-transform:uppercase;margin-top:4px;
  font-weight:600;
}
.amd-close{
  background:transparent;border:1px solid var(--border);
  color:var(--text-dim);width:32px;height:32px;border-radius:9px;
  cursor:pointer;font-size:13px;line-height:1;transition:all .2s;
  display:inline-flex;align-items:center;justify-content:center;
}
.amd-close:hover{color:#ef4444;border-color:#ef4444;background:rgba(239,68,68,.08)}
.amd-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.amd-stat{
  background:rgba(255,255,255,.03);
  border:1px solid var(--border);border-radius:10px;padding:10px 8px;
  text-align:center;transition:border-color .15s;
}
.amd-stat:hover{border-color:var(--accent-glow)}
.amd-stat-lbl{
  font-size:9px;color:var(--text-dim);
  letter-spacing:1.4px;text-transform:uppercase;margin-bottom:4px;
  font-weight:600;
}
.amd-stat-val{
  font-size:15px;font-weight:800;color:var(--accent);
  text-shadow:0 0 8px var(--accent-glow);
  font-variant-numeric:tabular-nums;letter-spacing:-.2px;
}
.amd-section{display:flex;flex-direction:column;gap:7px;flex:1;min-height:80px}
.amd-section-head{
  font-size:10px;letter-spacing:1.5px;color:var(--text-dim);
  text-transform:uppercase;opacity:.85;font-weight:700;
  display:flex;align-items:center;gap:6px;
}
.amd-content{
  background:rgba(0,0,0,.22);
  border:1px solid var(--border);
  border-radius:10px;padding:12px 14px;
  font-size:12px;color:var(--text);
  font-family:'Inter',sans-serif;line-height:1.6;
  max-height:200px;overflow-y:auto;
  white-space:pre-wrap;word-break:break-word;margin:0;
}
.amd-content::-webkit-scrollbar{width:4px}
.amd-content::-webkit-scrollbar-thumb{background:var(--accent);opacity:.4;border-radius:2px}
.amd-sessions{display:flex;flex-direction:column;gap:3px;font-size:10px;font-family:'SF Mono',monospace;color:var(--text-dim)}
.amd-sessions .amd-sess{padding:3px 8px;background:rgba(0,255,65,.03);border:1px solid rgba(0,255,65,.1);border-radius:4px}
.amd-foot{padding-top:8px;border-top:1px solid rgba(0,255,65,.18);display:flex;gap:6px}
.amd-btn{flex:1;background:rgba(0,255,65,.06);border:1px solid rgba(0,255,65,.3);color:var(--accent);padding:7px 10px;border-radius:6px;cursor:pointer;font-size:10px;font-family:'SF Mono',monospace;letter-spacing:.5px;transition:all .2s}
.amd-btn:hover{background:rgba(0,255,65,.12);box-shadow:0 0 10px var(--accent-glow)}
.amd-btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#000;border-color:transparent;font-weight:700}
.amd-btn.primary:hover{filter:brightness(1.15);box-shadow:0 4px 14px var(--accent-glow)}

/* Per-agent settings form fields */
.amd-form{display:flex;flex-direction:column;gap:8px}
.amd-field{display:flex;flex-direction:column;gap:3px}
.amd-field-lbl{font-family:'SF Mono',monospace;font-size:8.5px;letter-spacing:1.2px;color:var(--text-dim);text-transform:uppercase;opacity:.85}
.amd-field-help{font-size:9px;color:var(--text-dim);opacity:.6;margin-top:1px;font-style:italic}
.amd-input{background:rgba(0,255,65,.04);border:1px solid rgba(0,255,65,.18);border-radius:5px;padding:7px 9px;font-size:11px;color:var(--text);font-family:'SF Mono',monospace;outline:none;transition:all .2s}
.amd-input:focus{border-color:var(--accent);box-shadow:0 0 8px var(--accent-glow);background:rgba(0,255,65,.08)}
textarea.amd-input{resize:vertical;min-height:50px;line-height:1.45}
.amd-save-status{font-size:9.5px;font-family:'SF Mono',monospace;letter-spacing:.5px;text-align:center;padding:4px;border-radius:4px;opacity:0;transition:opacity .3s}
.amd-save-status.show{opacity:1}
.amd-save-status.success{color:var(--accent);background:rgba(0,255,65,.08)}
.amd-save-status.error{color:#ef4444;background:rgba(239,68,68,.08)}

/* ════════════════════════════════════════════════════════════════════════
   Corporate Gate v2 — sci-fi clearance terminal
   Stage backdrop: dark with drifting hex grid + horizontal scan
   Modal:         lock crest with rotating ring, PIN-style 4-box input,
                  status console line, cancel/unlock actions
   ──────────────────────────────────────────────────────────────────────── */
/* IMPORTANT — body uses display:flex column. Some webview hosts (Antigravity,
   older Electron) drop position:fixed back into the flex flow when the
   element is a child of a flex column body, anchoring it at the bottom-left
   instead of covering the viewport. Force absolute coverage with !important
   on every dimension and center via inner flex. */
.cg-backdrop{position:fixed !important;top:0 !important;right:0 !important;bottom:0 !important;left:0 !important;width:100vw !important;height:100vh !important;inset:0;z-index:99999;display:flex !important;align-items:center;justify-content:center;background:radial-gradient(ellipse at top,rgba(0,30,8,.92) 0%,rgba(0,0,0,.97) 70%);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);animation:cgBdIn .35s ease-out;padding:24px;overflow-y:auto;box-sizing:border-box}
.cg-backdrop[hidden]{display:none}
@keyframes cgBdIn{from{opacity:0;backdrop-filter:blur(0)}to{opacity:1;backdrop-filter:blur(14px)}}
/* drifting grid */
.cg-backdrop::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(0,255,65,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,65,.045) 1px,transparent 1px);background-size:38px 38px;opacity:.55;animation:cgGrid 22s linear infinite;pointer-events:none}
@keyframes cgGrid{from{transform:translateY(0)}to{transform:translateY(38px)}}
/* horizontal scan */
.cg-backdrop::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 0,transparent 50%,rgba(0,255,65,.07) 50.2%,transparent 51%);background-size:100% 220px;animation:cgScan2 5.5s linear infinite;pointer-events:none;mix-blend-mode:screen}
@keyframes cgScan2{from{background-position:0 -220px}to{background-position:0 100vh}}

.cg-modal{position:relative;width:min(420px,100%);background:linear-gradient(180deg,rgba(8,14,10,.98),rgba(2,6,3,.995));border:1px solid rgba(0,255,65,.45);border-radius:18px;padding:34px 30px 26px;box-shadow:0 0 0 1px rgba(0,255,65,.08) inset,0 30px 100px rgba(0,0,0,.88),0 0 80px rgba(0,255,65,.22),0 0 160px rgba(0,255,65,.08);animation:cgIn .65s cubic-bezier(.16,1,.3,1);transform-origin:center}
.cg-modal::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:reportLine 3s ease-in-out infinite;border-top-left-radius:18px;border-top-right-radius:18px}
/* aura behind the modal */
.cg-modal::after{content:'';position:absolute;top:-150px;left:50%;transform:translateX(-50%);width:520px;height:520px;background:radial-gradient(circle,rgba(0,255,65,.18) 0%,transparent 60%);pointer-events:none;animation:cgAura 7s ease-in-out infinite alternate;opacity:.6;filter:blur(12px);z-index:-1}
@keyframes cgAura{0%{opacity:.4;transform:translateX(-50%) scale(.95)}100%{opacity:.75;transform:translateX(-50%) scale(1.05)}}
.cg-modal.shake{animation:cgShake .5s cubic-bezier(.36,.07,.19,.97);border-color:rgba(239,68,68,.7)}
.cg-modal.shake::before{background:linear-gradient(90deg,transparent,#ef4444,transparent)}
@keyframes cgIn{0%{opacity:0;transform:translateY(24px) scale(.93);filter:blur(8px)}60%{opacity:1;transform:translateY(-3px) scale(1.01);filter:blur(0)}100%{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
@keyframes cgShake{0%,100%{transform:translateX(0)}10%{transform:translateX(-9px)}20%{transform:translateX(8px)}30%{transform:translateX(-7px)}40%{transform:translateX(6px)}50%{transform:translateX(-4px)}60%{transform:translateX(3px)}70%{transform:translateX(-2px)}80%{transform:translateX(1px)}}

/* HUD corner brackets — 4 explicit spans, larger and offset slightly inside */
.cg-corner{position:absolute;width:24px;height:24px;border:1.5px solid var(--accent);pointer-events:none;filter:drop-shadow(0 0 6px var(--accent-glow));opacity:.85}
.cg-corner.tl{top:14px;left:14px;border-right:none;border-bottom:none}
.cg-corner.tr{top:14px;right:14px;border-left:none;border-bottom:none}
.cg-corner.bl{bottom:14px;left:14px;border-right:none;border-top:none}
.cg-corner.br{bottom:14px;right:14px;border-left:none;border-top:none}

/* Brand bar */
.cg-brand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:18px;font-family:'SF Mono','JetBrains Mono',monospace;font-size:9.5px;letter-spacing:3px;color:var(--accent);text-transform:uppercase;opacity:.75;text-shadow:0 0 6px var(--accent-glow)}
.cg-brand .cg-brand-line{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(0,255,65,.3),transparent);max-width:80px}

/* Lock crest with spinning ring + glow */
.cg-crest{position:relative;display:flex;align-items:center;justify-content:center;width:108px;height:108px;margin:0 auto 18px}
.cg-crest::before,.cg-crest::after{content:'';position:absolute;inset:0;border-radius:50%;border:1.5px solid rgba(0,255,65,.55);border-top-color:transparent;border-right-color:transparent;animation:cgRing 3.5s linear infinite;filter:drop-shadow(0 0 6px var(--accent-glow))}
.cg-crest::after{inset:10px;border-color:rgba(0,255,65,.35);border-bottom-color:transparent;border-left-color:transparent;animation:cgRing 5s linear infinite reverse}
@keyframes cgRing{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.cg-crest .cg-crest-bg{position:absolute;inset:18px;border-radius:50%;background:radial-gradient(circle,rgba(0,255,65,.18),rgba(0,30,10,.6) 70%,transparent);animation:cgCrestPulse 2.4s ease-in-out infinite}
@keyframes cgCrestPulse{0%,100%{opacity:.7;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
.cg-lock{position:relative;font-size:44px;line-height:1;filter:drop-shadow(0 0 14px var(--accent-glow)) drop-shadow(0 0 28px var(--accent-glow));z-index:2;animation:cgLockBob 3s ease-in-out infinite}
@keyframes cgLockBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}

/* Tag pill */
.cg-tag{display:inline-flex;align-items:center;gap:7px;font-family:'SF Mono','JetBrains Mono',monospace;font-size:9px;letter-spacing:2.5px;color:var(--accent);text-transform:uppercase;padding:4px 11px;border:1px solid rgba(0,255,65,.3);border-radius:20px;background:rgba(0,255,65,.05);margin:0 auto 14px;text-shadow:0 0 8px var(--accent-glow)}
.cg-tag-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent);animation:cgBlink 1.4s ease-in-out infinite}
.cg-tag-wrap{display:flex;justify-content:center}
@keyframes cgBlink{0%,100%{opacity:1}50%{opacity:.3}}

.cg-title{text-align:center;font-size:22px;font-weight:800;letter-spacing:.2px;color:#F8FAFC;text-shadow:0 0 18px rgba(0,255,65,.18);margin-bottom:6px;font-family:inherit}
.cg-title .cg-title-accent{color:var(--accent);text-shadow:0 0 12px var(--accent-glow)}
.cg-sub{text-align:center;font-size:12px;color:var(--text-dim);line-height:1.55;margin-bottom:22px;letter-spacing:.2px;max-width:320px;margin-left:auto;margin-right:auto}

/* PIN-style 4-box input. Hidden text input under the hood drives the boxes. */
.cg-pin-wrap{position:relative;margin-bottom:14px}
.cg-pin-row{display:flex;justify-content:center;gap:10px;margin-bottom:10px}
.cg-pin-cell{width:54px;height:62px;border:1.5px solid rgba(0,255,65,.32);border-radius:10px;background:linear-gradient(180deg,rgba(0,28,10,.6),rgba(0,12,4,.8));display:flex;align-items:center;justify-content:center;font-family:'SF Mono',monospace;font-size:24px;color:var(--accent);text-shadow:0 0 10px var(--accent-glow);position:relative;transition:all .25s;overflow:hidden}
.cg-pin-cell::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at center,rgba(0,255,65,.15),transparent 70%);opacity:0;transition:opacity .3s}
.cg-pin-cell.active{border-color:var(--accent);box-shadow:0 0 0 3px rgba(0,255,65,.1),0 0 18px rgba(0,255,65,.35);background:linear-gradient(180deg,rgba(0,42,14,.7),rgba(0,18,6,.85))}
.cg-pin-cell.active::before{opacity:1}
.cg-pin-cell.filled{border-color:var(--accent);box-shadow:0 0 14px rgba(0,255,65,.3) inset}
/* Caret-like blink line under the active cell */
.cg-pin-cell.active::after{content:'';position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:18px;height:2px;background:var(--accent);box-shadow:0 0 6px var(--accent);animation:cgCaret 1s steps(1) infinite}
@keyframes cgCaret{0%,49%{opacity:1}50%,100%{opacity:0}}
.cg-pin-input{position:absolute;inset:0;opacity:0;width:100%;height:100%;border:none;background:transparent;outline:none;font-size:24px;color:transparent;caret-color:transparent;cursor:pointer}
.cg-modal.success .cg-pin-cell{border-color:#00cc77;box-shadow:0 0 18px rgba(0,204,119,.5);color:#00cc77;text-shadow:0 0 12px rgba(0,204,119,.7);background:linear-gradient(180deg,rgba(0,40,20,.8),rgba(0,18,8,.85))}
.cg-modal.success .cg-crest::before,.cg-modal.success .cg-crest::after{border-color:#00cc77;animation-duration:.8s}
.cg-modal.success .cg-lock{filter:drop-shadow(0 0 16px rgba(0,204,119,.7)) drop-shadow(0 0 32px rgba(0,204,119,.5))}

/* Status console line */
.cg-status{font-family:'SF Mono','JetBrains Mono',monospace;font-size:10px;letter-spacing:1.4px;text-align:center;text-transform:uppercase;color:var(--text-dim);min-height:14px;margin-bottom:14px;transition:color .3s}
.cg-status.info{color:var(--accent);text-shadow:0 0 6px var(--accent-glow)}
.cg-status.error{color:#ef4444;text-shadow:0 0 6px rgba(239,68,68,.5)}
.cg-status.ok{color:#00cc77;text-shadow:0 0 8px rgba(0,204,119,.6)}
.cg-status .cg-status-cursor{display:inline-block;width:6px;height:11px;background:currentColor;margin-left:5px;vertical-align:middle;animation:cgCaret 1s steps(1) infinite}

/* Hint footer */
.cg-hint{text-align:center;font-family:'SF Mono',monospace;font-size:9.5px;color:var(--text-dim);letter-spacing:1.2px;margin-bottom:18px;opacity:.6}
.cg-hint code{padding:1px 6px;border:1px solid rgba(0,255,65,.25);border-radius:4px;color:var(--accent);background:rgba(0,255,65,.05);letter-spacing:1px;font-size:9.5px}

/* Action buttons */
.cg-actions{display:flex;gap:10px}
.cg-btn{flex:1;padding:12px 16px;border-radius:11px;font-family:'SF Mono',monospace;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;cursor:pointer;transition:all .25s;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.cg-btn.cancel{background:transparent;border:1px solid rgba(255,255,255,.12);color:var(--text-dim)}
.cg-btn.cancel:hover{border-color:rgba(255,255,255,.25);color:#fff;background:rgba(255,255,255,.04)}
.cg-btn.ok{background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;color:#000;box-shadow:0 6px 24px rgba(0,255,65,.32)}
.cg-btn.ok:hover{filter:brightness(1.15);box-shadow:0 8px 32px rgba(0,255,65,.5),0 0 24px rgba(0,255,65,.45);transform:translateY(-1px)}
.cg-btn.ok:active{transform:translateY(0)}
.cg-btn.ok:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}

/* Particle burst on success — reuses boot-particle animation */
.cg-particles{position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden}
.cg-particle{position:absolute;width:4px;height:4px;background:var(--accent);border-radius:50%;box-shadow:0 0 8px var(--accent);opacity:0}
.cg-particle.go{animation:cgPartFly 1.4s ease-out forwards}
@keyframes cgPartFly{
  0%{opacity:1;transform:translate(0,0) scale(1)}
  100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.2)}
}

/* Full-screen flash on success */
@keyframes cgFlash{0%{opacity:0}25%{opacity:.65}100%{opacity:0}}
.cg-flash{position:fixed;inset:0;background:radial-gradient(circle,rgba(0,255,65,.45) 0%,transparent 55%);pointer-events:none;z-index:10000;animation:cgFlash 1s ease-out forwards}

/* Agent piece — inline-SVG character + nameplate. Furniture is CSS-drawn behind. */
.agent{position:absolute;width:60px;display:flex;flex-direction:column;align-items:center;gap:3px;transition:left .9s cubic-bezier(.16,1,.3,1),top .9s cubic-bezier(.16,1,.3,1);z-index:6;filter:drop-shadow(0 4px 6px rgba(0,0,0,.65));transform:scale(var(--char-scale,1));transform-origin:50% 96px}
.agent .ag-led{position:absolute;top:-4px;right:6px;width:5px;height:5px;border-radius:50%;background:var(--text-dim);opacity:.4;transition:all .3s;z-index:7}
.agent.thinking .ag-led{background:#ffab40;animation:ledBlink 1s infinite;box-shadow:0 0 6px #ffab40;opacity:1}
.agent.working .ag-led{background:var(--ag-color,var(--accent));animation:ledBlink .7s infinite;box-shadow:0 0 8px var(--ag-color,var(--accent));opacity:1}
.agent.done .ag-led{background:#00cc77;box-shadow:0 0 6px #00cc77;opacity:1}
@keyframes ledBlink{0%,100%{opacity:1}50%{opacity:.4}}

/* Sprite character — LimeZu Premade_Character_48x48 atlas (2688×1968).
   CRITICAL: each character cell is 48 wide × 96 tall (TILE × CHAR_HEIGHT, where CHAR_HEIGHT = TILE*2).
   Rendering this as 48×48 (the bug we hit before) shows only the head/hair.
   Idle frame: row 1, col 0 → background-position: 0 -96px
   Walking row: row 2 (y=-192), 6 frames per direction (down 0–5, left 6–11, right 12–17, up 18–23) */
.character{width:48px;height:96px;position:relative;overflow:hidden;image-rendering:pixelated;cursor:default;background-repeat:no-repeat;background-position:0 -96px;background-size:auto;filter:drop-shadow(0 6px 8px rgba(0,0,0,.65));animation:charBob 2.4s ease-in-out infinite;transform:scale(0.8);transform-origin:center bottom}
@keyframes charBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}

/* State glow under character */
.character::before{content:'';position:absolute;left:50%;bottom:-4px;transform:translateX(-50%);width:36px;height:6px;border-radius:50%;background:radial-gradient(ellipse,var(--ag-color-glow,rgba(0,0,0,.4)) 0%,transparent 70%);opacity:0;transition:opacity .3s;pointer-events:none;z-index:-1}
.agent.working .character::before,.agent.thinking .character::before{opacity:1}

.ag-plate{font-family:'SF Mono','JetBrains Mono',monospace;font-size:8.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text-bright);padding:2px 7px;background:rgba(0,0,0,.85);border:1px solid var(--ag-color,var(--border));border-radius:5px;text-shadow:0 0 4px var(--ag-color-glow,transparent);white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.5)}
.agent.idle .ag-plate{opacity:.7}
.agent.working .ag-plate{color:var(--ag-color,var(--accent));box-shadow:0 0 10px var(--ag-color-glow,var(--accent-glow)),0 2px 6px rgba(0,0,0,.5)}

/* Speech bubble above character (task toast / chat) */
.bubble{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);background:rgba(8,10,15,.96);border:1px solid var(--ag-color,var(--accent));border-radius:8px;padding:5px 10px;font-size:10px;color:var(--text-bright);white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;font-family:'SF Mono',monospace;z-index:20;box-shadow:0 4px 14px rgba(0,0,0,.7),0 0 14px var(--ag-color-glow,var(--accent-glow));animation:bubbleIn .35s cubic-bezier(.16,1,.3,1)}
.bubble::after{content:'';position:absolute;left:50%;top:100%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--ag-color,var(--accent))}
@keyframes bubbleIn{from{opacity:0;transform:translateX(-50%) translateY(4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

/* SVG dispatch beams */
.beams{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;opacity:0;transition:opacity .3s}
body.dispatching .beams{opacity:1}
.beams .beam{stroke-dasharray:6 8;fill:none;animation:beamFlow 1.4s linear}
@keyframes beamFlow{0%{stroke-dashoffset:80;opacity:0}20%{opacity:1}100%{stroke-dashoffset:0;opacity:.7}}

/* ===== Side panel (activity log + report) — collapsed by default to maximize map ===== */
/* ===== Side panel (v2.84 polish) =====
   Activity / Outputs / Transcript — modernized to match the topbar's
   Inter-based language. Tabs are larger and clearer; panes have proper
   padding + cleaner empty states. */
.side{
  width:300px;flex-shrink:0;
  background:linear-gradient(180deg,rgba(14,11,7,.92),rgba(8,7,4,.85));
  border-left:1px solid var(--border);
  display:flex;flex-direction:column;min-height:0;
  transition:width .3s cubic-bezier(.16,1,.3,1),border-left-width .3s ease;
  font-family:'Inter','SF Pro Display',sans-serif;
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
}
.side.collapsed{width:0;border-left-width:0;overflow:hidden}
.side-tabs{
  display:flex;border-bottom:1px solid var(--border);flex-shrink:0;
  background:rgba(0,0,0,.25);
}
.side-tab{
  flex:1;padding:11px 10px;background:transparent;border:none;
  color:var(--text-dim);cursor:pointer;
  font-family:inherit;font-size:11px;font-weight:600;letter-spacing:.3px;
  border-bottom:2px solid transparent;transition:all .2s;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
}
.side-tab:hover{color:var(--text);background:rgba(255,255,255,.02)}
.side-tab.active{
  color:var(--accent);border-bottom-color:var(--accent);
  background:linear-gradient(180deg,rgba(0,255,65,.06),transparent);
  text-shadow:0 0 8px var(--accent-glow);
}
.side-tab .tab-count{
  font-size:9.5px;font-weight:700;padding:1px 7px;border-radius:999px;
  background:rgba(255,182,39,.12);color:var(--accent);
  border:1px solid var(--accent-glow);min-width:18px;line-height:1.4;
}
.side-tab.active .tab-count{background:var(--accent);color:#1a0f00}
.side-pane{flex:1;overflow-y:auto;padding:14px 12px;display:none}
.side-pane.active{display:block}
.side-pane::-webkit-scrollbar{width:5px}
.side-pane::-webkit-scrollbar-thumb{background:rgba(0,255,65,.35);border-radius:3px}
.side-pane::-webkit-scrollbar-track{background:transparent}
.side-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:48px 20px;text-align:center;color:var(--text-dim);
  border:1px dashed rgba(255,255,255,.06);border-radius:12px;
  font-size:12px;line-height:1.55;
  background:rgba(255,255,255,.015);
}
.side-empty .ic{font-size:32px;margin-bottom:10px;opacity:.55}
.side-empty .hint{font-size:10.5px;opacity:.7;margin-top:4px}

/* Activity log entries — clean rows with timestamp + agent dot + text */
.log-entry{
  display:grid;grid-template-columns:auto auto 1fr;gap:8px;align-items:flex-start;
  padding:8px 10px;margin-bottom:6px;
  background:rgba(255,255,255,.025);
  border:1px solid rgba(255,255,255,.04);
  border-left:2px solid var(--ag-color,var(--accent));
  border-radius:8px;
  animation:logIn .3s cubic-bezier(.16,1,.3,1);
  transition:border-color .15s,background .15s;
}
.log-entry:hover{background:rgba(255,255,255,.04);border-left-color:var(--ag-color,var(--accent))}
@keyframes logIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
.log-time{
  font-family:'SF Mono','JetBrains Mono',monospace;
  font-size:9.5px;color:var(--text-dim);flex-shrink:0;line-height:1.5;
  font-variant-numeric:tabular-nums;letter-spacing:.4px;
}
.log-emoji{flex-shrink:0;font-size:13px;line-height:1.3}
.log-text{
  color:var(--text);font-size:11px;line-height:1.5;
  word-break:break-word;
}
.log-text strong{color:var(--ag-color,var(--accent));font-weight:700}

/* Output stream cards (per agent) — feels like an employee handing in work */
.out-card{
  background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.015));
  border:1px solid rgba(255,255,255,.07);
  border-left:3px solid var(--ag-color,var(--accent));
  border-radius:10px;padding:12px 14px;margin-bottom:12px;
  animation:logIn .35s cubic-bezier(.16,1,.3,1);
  position:relative;overflow:hidden;
}
.out-card::before{
  content:'';position:absolute;left:0;right:0;top:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--ag-color,var(--accent)),transparent);
  opacity:.35;
}
.out-head{
  font-size:11.5px;font-weight:700;
  color:var(--ag-color,var(--accent));margin-bottom:8px;
  display:flex;align-items:center;gap:8px;
  text-shadow:0 0 6px var(--ag-color-glow,var(--accent-glow));
}
.out-head .oh-task{color:var(--text-dim);font-weight:500;font-size:10px;letter-spacing:.2px}
.out-body{
  font-size:11.5px;color:var(--text);line-height:1.6;
  white-space:pre-wrap;word-break:break-word;
  max-height:220px;overflow-y:auto;
  font-family:'Inter',sans-serif;
}
.out-body::-webkit-scrollbar{width:4px}
.out-body::-webkit-scrollbar-thumb{background:var(--ag-color,var(--accent));opacity:.4;border-radius:2px}
.report-block{background:linear-gradient(135deg,rgba(0,255,65,.05),rgba(0,143,17,.02));border:1px solid rgba(0,255,65,.3);border-radius:8px;padding:14px;margin-top:10px;color:var(--text);font-size:11.5px;line-height:1.65;white-space:pre-wrap;animation:logIn .4s ease-out;box-shadow:0 0 14px rgba(0,255,65,.08)}
.report-block .rb-head{font-family:'SF Mono',monospace;font-size:10px;letter-spacing:1.5px;color:var(--accent);margin-bottom:8px;text-transform:uppercase}

/* ===== Bottom command bar ===== */
.cmdbar{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(8,10,15,.96);border-top:1px solid var(--border);flex-shrink:0;z-index:10}
.cmdbar input{flex:1;background:rgba(0,10,2,.7);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-family:inherit;font-size:13px;outline:none;transition:all .2s}
.cmdbar input:focus{border-color:var(--accent);box-shadow:0 0 14px var(--accent-glow)}
.cmdbar button{background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;color:#fff;padding:10px 18px;border-radius:8px;cursor:pointer;font-weight:600;font-size:12px;transition:all .2s}
.cmdbar button:hover{transform:translateY(-1px);box-shadow:0 4px 14px var(--accent-glow)}
.cmdbar button:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}

/* ===== Empty state ===== */
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:12px;text-align:center;padding:40px 20px;line-height:1.7}
.empty .empty-icon{font-size:48px;margin-bottom:12px;opacity:.6}
.empty code{background:var(--surface);border:1px solid var(--border);padding:2px 6px;border-radius:4px;color:var(--accent);font-family:'SF Mono',monospace}
</style>
</head>
<body>

<div class="topbar">
  <!-- Brand zone — logo + company name + tagline + folder edit -->
  <div class="brand-block">
    <div class="brand-mark">🏢</div>
    <div class="brand-text">
      <div class="brand-row">
        <div class="brand-name loading" id="topCompany">불러오는 중…</div>
        <button class="brand-edit" id="pickFolderBtn" title="회사 폴더 변경">⚙</button>
      </div>
      <div class="brand-sub">나만의 에이전트 팀</div>
    </div>
  </div>

  <!-- HUD — live company stats. Bigger than before, icon + text columns. -->
  <div class="hud">
    <div class="stat live">
      <div class="icon">📅</div>
      <div class="text"><div class="lbl">Day</div><div class="val" id="hudDay">1</div></div>
    </div>
    <div class="stat">
      <div class="icon">⏰</div>
      <div class="text"><div class="lbl">Time</div><div class="val" id="hudTime">09:00</div></div>
    </div>
    <div class="stat">
      <div class="icon">⚡</div>
      <div class="text"><div class="lbl">Output</div><div class="val" id="hudOutput">0</div></div>
    </div>
    <div class="stat" id="hudWorkingStat">
      <div class="icon">👥</div>
      <div class="text"><div class="lbl">Working</div><div class="val" id="hudWorking">0/7</div></div>
    </div>
  </div>

  <!-- Action zone — primary CTA prominent, secondary toggles ghost. -->
  <div class="actions">
    <button class="topbtn" id="workdayBtn" title="24시간 자동 운영 — 설정 로딩 중...">24h ⋯</button>
    <button class="topbtn primary" id="dashboardBtn" title="👥 직원 에이전트 보기 — 팀 전체 한눈에">👥 직원 에이전트 보기</button>
    <button class="topbtn ghost" id="apiBtn" title="🔌 외부 연결 — Telegram · YouTube · Google Calendar 등 API 키 한 곳에서">🔌</button>
    <button class="topbtn ghost" id="toggleSideBtn" title="활동 로그 패널 토글">📋</button>
    <button class="topbtn ghost" id="folderBtn" title="회사 폴더 열기">📁</button>
  </div>
</div>

<!-- Live status row — one-line summary of who's doing what right now. -->
<div class="status-row">
  <span class="pulse-dot"></span>
  <span class="text" id="statusText">사무실 가동 중</span>
  <span class="sep">·</span>
  <span id="statusActivity">에이전트 자리 잡는 중...</span>
</div>

<div class="office-wrap">
  <div class="office-floor" id="floor">

    <!-- Connected campus world (Phase B-1) — Office + Cafe buildings on a
         garden grass canvas. Single coord space (% of stageInner) so agents
         walk freely between zones. -->
    <div class="office-stage" id="officeStage">
      <div class="office-stage-inner" id="stageInner">
        <div class="world-grass" id="worldGrass"></div>
        <div class="world-paths" id="worldPaths"></div>
        <div class="world-buildings" id="worldBuildings"></div>
        <div class="world-decorations" id="worldDecor"></div>
        <div class="office-zones" id="officeZones"></div>
        <!-- agents inserted here by JS — coords resolve % of stageInner -->
      </div>
    </div>

    <!-- Floating particles for ambient feel -->
    <div class="particles" id="particles"></div>

    <!-- Conference area (CEO + whiteboard at top of studio, where wall monitors are) -->
    <div class="conf-room">
      <div class="conf-label">CONFERENCE</div>
      <div class="whiteboard" id="whiteboard">대기 중 — 명령을 내리면 팀이 움직입니다</div>
    </div>

    <!-- Smallville locations — emoji markers (no heavy CSS furniture, image bg provides studio look) -->
    <div class="location loc-coffee"     data-loc="coffee"><div class="loc-icon">☕</div><div class="loc-label">COFFEE</div></div>
    <div class="location loc-whiteboard" data-loc="whiteboard"><div class="loc-icon">📊</div><div class="loc-label">BOARD</div></div>
    <div class="location loc-lounge"     data-loc="lounge"><div class="loc-icon">🛋️</div><div class="loc-label">LOUNGE</div></div>
    <div class="location loc-server"     data-loc="server"><div class="loc-icon">🖥️</div><div class="loc-label">SERVERS</div></div>
    <div class="location loc-brain"      data-loc="brain"><div class="loc-icon">🧠</div><div class="loc-label">SECOND BRAIN</div></div>

    <div class="office-vignette"></div>
    <svg class="beams" id="beams" preserveAspectRatio="none"></svg>
    <!-- agents injected by JS -->

  </div>

  <!-- Agent profile modal — centered overlay above everything -->
  <div class="agent-modal-backdrop" id="agentModalBackdrop" hidden>
    <div class="agent-modal" id="agentModal" role="dialog" aria-modal="true">
      <div class="amd-head">
        <span class="amd-emoji" id="amdEmoji"></span>
        <div class="amd-title"><div class="amd-name" id="amdName">—</div><div class="amd-role" id="amdRole">—</div></div>
        <button class="amd-close" id="amdClose">✕</button>
      </div>
      <div class="amd-stats">
        <div class="amd-stat"><div class="amd-stat-lbl">SESSIONS</div><div class="amd-stat-val" id="amdSessions">0</div></div>
        <div class="amd-stat"><div class="amd-stat-lbl">STATE</div><div class="amd-stat-val" id="amdState">IDLE</div></div>
        <div class="amd-stat"><div class="amd-stat-lbl">SPECIALTY</div><div class="amd-stat-val" id="amdSpecialty" style="font-size:9px">—</div></div>
      </div>
      <div class="amd-section">
        <div class="amd-section-head">⚙️ 외부 연결 / API</div>
        <div class="amd-form" id="amdConfigForm"><span style="font-size:10px;color:var(--text-dim)">이 에이전트는 별도 설정이 없습니다.</span></div>
        <div class="amd-save-status" id="amdSaveStatus"></div>
      </div>
      <div class="amd-section">
        <div class="amd-section-head">🧠 메모리 (memory.md)</div>
        <pre class="amd-content" id="amdMemory">불러오는 중…</pre>
      </div>
      <div class="amd-section">
        <div class="amd-section-head">📜 의사결정 로그 (decisions.md)</div>
        <pre class="amd-content" id="amdDecisions">불러오는 중…</pre>
      </div>
      <div class="amd-section">
        <div class="amd-section-head">📁 최근 세션</div>
        <div id="amdSessionList" class="amd-sessions">—</div>
      </div>
      <div class="amd-foot">
        <button class="amd-btn primary" id="amdSaveConfig">💾 저장</button>
        <button class="amd-btn" id="amdOpenFolder">📁 폴더</button>
      </div>
    </div>
  </div>
  <div class="side">
    <div class="side-tabs">
      <button class="side-tab active" data-pane="logPane">📡 활동</button>
      <button class="side-tab" data-pane="outPane">📦 산출물</button>
      <button class="side-tab" data-pane="convPane">📜 대화록</button>
    </div>
    <div class="side-pane active" id="logPane">
      <div class="side-empty" id="logEmpty">
        <div class="ic">📡</div>
        <div>활동이 없어요</div>
        <div class="hint">에이전트가 일을 시작하면 여기에 실시간으로 흐릅니다.</div>
      </div>
    </div>
    <div class="side-pane" id="outPane">
      <div class="side-empty">
        <div class="ic">📦</div>
        <div>아직 산출물이 없어요</div>
        <div class="hint">사이드바 채팅이나 텔레그램에 일을 던져주세요.</div>
      </div>
    </div>
    <div class="side-pane" id="convPane">
      <div style="font-size:11px;color:var(--text);line-height:1.6;font-family:inherit">
        <div id="convDate" style="font-size:9.5px;color:var(--text-dim);margin-bottom:10px;letter-spacing:.6px;font-weight:600;text-transform:uppercase">오늘 대화록 로딩 중…</div>
        <div id="convBody" style="white-space:pre-wrap;word-break:break-word"></div>
        <div style="margin-top:16px;text-align:center">
          <button class="topbtn ghost" id="reloadConvBtn" style="font-size:11px">🔄 새로고침</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- 명령창은 사이드바에 통합됨. 사무실 패널은 시각화 전용. -->
<div class="cmdbar" style="display:none">
  <input id="cmdInput" type="hidden" />
  <button id="cmdSend" style="display:none">전송 ↑</button>
</div>

<script>
const vscode = acquireVsCodeApi();
const floor = document.getElementById('floor');
const beams = document.getElementById('beams');
const whiteboard = document.getElementById('whiteboard');
const cmdInput = document.getElementById('cmdInput');
const cmdSend = document.getElementById('cmdSend');
const logPane = document.getElementById('logPane');
const outPane = document.getElementById('outPane');
const topCompany = document.getElementById('topCompany');
const topMeta = document.getElementById('topMeta');
const folderBtn = document.getElementById('folderBtn');

let agents = [];
let agentMap = {};
let deskEls = {};   /* alias: agent elements */
let outCardEls = {};
let currentTasks = [];
/* Home desk positions are % of the WORLD canvas (1400×700 campus).
   Replaced by world.desks at officeInit time; placeholder below covers
   the brief moment before the message arrives. Office is at world
   x=540..1052, y=90..634, so each agent's office-local % maps to world. */
let HOME_POS = {
  youtube:   { x: 49, y: 41 },
  instagram: { x: 56, y: 41 },
  designer:  { x: 63, y: 41 },
  business:  { x: 69, y: 41 },
  developer: { x: 49, y: 57 },
  secretary: { x: 69, y: 57 },
  ceo:       { x: 64, y: 77 }
};

function getHomeXY(agentId){
  const p = HOME_POS[agentId] || { x: 50, y: 50 };
  return { x: p.x, y: p.y };
}




function makeAgent(a){
  const home = getHomeXY(a.id);
  const d = document.createElement('div');
  d.className = 'agent idle';
  d.dataset.agent = a.id;
  d.dataset.homeX = home.x;
  d.dataset.homeY = home.y;
  d.dataset.dir = 'down';
  d.style.setProperty('--ag-color', a.color);
  d.style.setProperty('--ag-color-glow', a.color + '55');
  positionAgentToImageCoord(d, home.x, home.y);
  
  /* Sprite character */
  const character = document.createElement('div');
  character.className = 'character';
  if (a.sprite) {
    character.style.backgroundImage = 'url(' + a.sprite + ')';
  } else {
    /* Fallback to CEO sprite if missing */
    character.style.background = 'rgba(255,255,255,0.1)';
  }
  
  const led = document.createElement('span'); led.className = 'ag-led'; d.appendChild(led);
  d.appendChild(character);
  const nm = document.createElement('div'); nm.className = 'ag-plate'; nm.textContent = a.emoji + ' ' + a.name; d.appendChild(nm);
  d.title = a.role + ' — ' + a.specialty;
  d.addEventListener('click', () => {
    /* CEO opens its folder; everyone else opens the unified agent card —
       same modal the agent board uses, so floor plan + board stay in sync. */
    if (a.id === 'ceo') {
      vscode.postMessage({type:'openCompanyFolder',sub:'_agents/ceo'});
      return;
    }
    showAgentPanel(a);
  });
  return d;
}

/** Position agent at (xPct, yPct) as % of stageInner — which has the same
    bounds as the office bg image (CSS aspect-ratio), so coords map 1:1.
    Higher y = renders in front (depth-sort), so agents farther down the
    office naturally occlude ones above them. */
function positionAgentToImageCoord(el, xPct, yPct){
  el.style.left = 'calc(' + xPct + '% - 24px)';
  el.style.top  = 'calc(' + yPct + '% - 96px)';
  el.style.zIndex = String(10 + Math.floor(yPct * 10));
}

function repositionAllAgents(){
  agents.forEach(a => {
    const el = deskEls[a.id]; if (!el) return;
    const x = parseFloat(el.dataset.homeX), y = parseFloat(el.dataset.homeY);
    positionAgentToImageCoord(el, x, y);
  });
  /* Re-anchor location markers to image coords too */
  positionLocations();
}

function positionLocations(){
  const bgEl = document.getElementById('officeBg');
  const fr = floor.getBoundingClientRect();
  if (!bgEl || !bgEl.complete || !bgEl.naturalWidth) return;
  const iw = bgEl.clientWidth, ih = bgEl.clientHeight;
  const ix = (fr.width - iw) / 2;
  const iy = (fr.height - ih) / 2;
  Object.keys(LOCATIONS).forEach(id => {
    const def = LOCATIONS[id];
    const el = document.querySelector('[data-loc="'+id+'"]');
    if (!el) return;
    const px = ix + (def.x / 100) * iw;
    const py = iy + (def.y / 100) * ih;
    el.style.left = px + 'px';
    el.style.top  = py + 'px';
  });
}

function setDeskState(agentId, state, task){
  const d = deskEls[agentId]; if (!d) return;
  d.classList.remove('idle','thinking','working','done');
  d.classList.add(state);
  const old = d.querySelector('.bubble'); if (old) old.remove();
  if (task && (state === 'working' || state === 'thinking')) {
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = task;
    d.appendChild(b);
    setTimeout(() => { try { b.style.opacity = '0'; setTimeout(() => b.remove(), 350); } catch{} }, 3500);
  }
  /* Recompute the topbar HUD "Working" count + status-row activity text
     whenever any desk state changes. Makes the office feel genuinely live —
     the user sees the count rise the moment an agent starts a task. */
  try { updateLiveStatus(); } catch {}
}

/* Counts how many agents are currently in working/thinking state and
   refreshes the topbar HUD pill + status-row text. Cheap (DOM scan). */
function updateLiveStatus(){
  try {
    let working = 0, thinking = 0;
    const workingNames = [];
    Object.keys(deskEls).forEach(id => {
      const d = deskEls[id];
      if (!d) return;
      if (d.classList.contains('working')) { working++; workingNames.push(agentMap[id]?.name || id); }
      else if (d.classList.contains('thinking')) { thinking++; }
    });
    const total = Object.keys(deskEls).length || agents.length;
    const wrkEl = document.getElementById('hudWorking');
    const wrkStatEl = document.getElementById('hudWorkingStat');
    if (wrkEl) wrkEl.textContent = working + '/' + total;
    if (wrkStatEl) wrkStatEl.classList.toggle('warn', working === 0 && thinking === 0);
    /* Status row: short, optimistic phrasing about who's doing what. */
    const sa = document.getElementById('statusActivity');
    if (sa) {
      if (working > 0) {
        const head = workingNames.slice(0, 2).join(', ');
        const more = workingNames.length > 2 ? (' 외 ' + (workingNames.length - 2) + '명') : '';
        sa.textContent = head + more + ' 작업 중';
      } else if (thinking > 0) {
        sa.textContent = thinking + '명 생각 중';
      }
      /* Don't overwrite the last logActivity message when fully idle —
         that lets the most recent meaningful event linger in the status row. */
    }
  } catch {}
}

function showBubbleOn(agentId, text, ms){
  const d = deskEls[agentId]; if (!d) return;
  const old = d.querySelector('.bubble'); if (old) old.remove();
  const b = document.createElement('div'); b.className = 'bubble'; b.textContent = text;
  d.appendChild(b);
  const dur = ms || 2500;
  setTimeout(() => { try { b.style.opacity = '0'; setTimeout(() => b.remove(), 350); } catch{} }, dur);
}

function resetAllDesks(){
  Object.keys(deskEls).forEach(id => setDeskState(id, 'idle'));
  if (beams) beams.innerHTML = '';
  whiteboard.classList.remove('active');
  whiteboard.innerHTML = '대기 중 — 명령을 내리면 팀이 움직입니다';
}

/* ==== Auto-walking + idle chat ==== */
let autoWalkActive = false;
const IDLE_CHATS = [
  '커피 한잔?', '오늘 진도 어때?', '아 그거 봤어?', '점심 뭐 먹지', '와 대박',
  '확인해볼게', '체크', '오케이', '굿', '음...', '잠깐만', '나중에 얘기하자'
];
function pickRandom(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

function walkToward(agentId, targetXPct, targetYPct, durationMs){
  const el = deskEls[agentId]; if (!el) return Promise.resolve();
  const currentX = parseFloat(el.style.left.replace(/[^-0-9.]/g, '')) || 0; // Simplified check
  const currentY = parseFloat(el.style.top.replace(/[^-0-9.]/g, '')) || 0;
  
  /* Determine direction */
  const dx = targetXPct - parseFloat(el.dataset.currX || el.dataset.homeX);
  const dy = targetYPct - parseFloat(el.dataset.currY || el.dataset.homeY);
  if (Math.abs(dx) > Math.abs(dy)) {
    el.dataset.dir = dx > 0 ? 'right' : 'left';
  } else {
    el.dataset.dir = dy > 0 ? 'down' : 'up';
  }
  el.dataset.currX = targetXPct;
  el.dataset.currY = targetYPct;

  el.classList.add('walking');
  positionAgentToImageCoord(el, targetXPct, targetYPct);
  return new Promise(resolve => {
    setTimeout(() => { el.classList.remove('walking'); resolve(); }, durationMs || 1000);
  });
}

/* ===== Visit locations — WORLD %-coords (1400×700 campus canvas) =====
   Campus: Office (center-right), Cafe (left), Garden (right + outside).
   These ids are referenced by PERSONALITY.likedLocs and visitLocationStep. */
const LOCATIONS = {
  cafeCounter: { x: 21, y: 39, label:'☕ 카페 카운터',     emoji:'☕', stay: 4000 },
  cafeTable:   { x: 22, y: 75, label:'🪑 카페 테이블',     emoji:'🪑', stay: 5000 },
  meeting:     { x: 49, y: 78, label:'📊 회의실',          emoji:'📊', stay: 4500 },
  copier:      { x: 70, y: 18, label:'🖨️ 복사실',          emoji:'🖨️', stay: 3500 },
  gardenBench: { x: 85, y: 32, label:'🌳 정원 벤치',       emoji:'🌳', stay: 5500 },
  gardenTree:  { x: 92, y: 86, label:'🌲 큰 나무 아래',    emoji:'🌲', stay: 6000 },
  gardenWalk:  { x: 78, y: 60, label:'🚶 잔디 산책',       emoji:'🚶', stay: 4500 }
};

/* Per-agent personality — drives thoughts, status preferences, location bias.
   likedLocs reference LOCATIONS keys (conference/copier/water/plants/ceoDoor). */
const PERSONALITY = {
  ceo: {
    thoughts: ['이번 분기 목표가...', '회사 비전 정리해야', '다음 큰 그림은?', '팀 잘 굴러가나', 'KPI 다시 봐야겠다'],
    status: ['🧠','💼','📋','🎯'],
    likedLocs: ['meeting','gardenBench','cafeCounter']
  },
  youtube: {
    thoughts: ['다음 썸네일 뭐로?', '오프닝 5초가 핵심', '트렌드 봐야지', '편집 컷 좀 줄이자', '구독자 반응 어떨까'],
    status: ['🎥','📹','💡','🔥','▶️'],
    likedLocs: ['cafeCounter','meeting','gardenWalk']
  },
  designer: {
    thoughts: ['색감이 뭔가 부족한데', '여백을 더...', '폰트 다시 골라야', '레퍼런스 찾자', '톤앤매너가 안 맞아'],
    status: ['🎨','💜','✏️','💡','✨'],
    likedLocs: ['gardenBench','copier','cafeTable']
  },
  instagram: {
    thoughts: ['릴스 트렌드 체크', '해시태그 뭘로?', '커버 이미지가 약해', '댓글 톤이 좋네', '피드 구성 다시'],
    status: ['📸','💖','🌸','✨','📱'],
    likedLocs: ['gardenBench','cafeTable','gardenWalk']
  },
  developer: {
    thoughts: ['이거 캐시해야', '버그 어디서 났지', '리팩터 해야 하는데', '...아 그게 그구나', '커피 한 잔 더'],
    status: ['💻','⌨️','🐛','💡','☕'],
    likedLocs: ['cafeCounter','copier','gardenTree']
  },
  business: {
    thoughts: ['ROI 계산 다시', '단가 협상해야', '월 마감 보자', '현금흐름은 OK', '채널별 수익 분리'],
    status: ['💰','📈','💼','📊','💹'],
    likedLocs: ['meeting','copier','cafeCounter']
  },
  secretary: {
    thoughts: ['일정 정리하자', '메일 답장 보내야', 'CEO 미팅 30분 후', '다들 할 일 알지?', '회의록 다시 보자'],
    status: ['📋','📞','📅','📝','✉️'],
    likedLocs: ['copier','meeting','cafeTable']
  }
};

/* Show small status icon above an agent's head (auto-fades) */
function showStatusIcon(agentId, icon, ms){
  const d = deskEls[agentId]; if (!d) return;
  const old = d.querySelector('.ag-status'); if (old) old.remove();
  const s = document.createElement('div'); s.className='ag-status'; s.textContent = icon;
  d.appendChild(s);
  const dur = ms || 3500;
  setTimeout(() => { try { s.classList.add('fade'); setTimeout(()=>s.remove(),350); } catch{} }, dur);
}

/* Show dotted thought bubble (.oO style — inner monologue) */
function showThought(agentId, text, ms){
  const d = deskEls[agentId]; if (!d) return;
  const old = d.querySelector('.thought'); if (old) old.remove();
  const t = document.createElement('div'); t.className='thought'; t.textContent = '· '+text;
  d.appendChild(t);
  const dur = ms || 3500;
  setTimeout(() => { try { t.style.opacity='0'; setTimeout(()=>t.remove(),350); } catch{} }, dur);
}

async function idleChatStep(){
  if (!autoWalkActive) return;
  const idleAgents = agents.filter(a => {
    const el = deskEls[a.id];
    return el && (el.classList.contains('idle') || el.classList.contains('done'));
  });
  if (idleAgents.length < 2) return;
  const A = pickRandom(idleAgents);
  let B = pickRandom(idleAgents);
  let tries = 0;
  while (B.id === A.id && tries < 5) { B = pickRandom(idleAgents); tries++; }
  if (B.id === A.id) return;
  const bEl = deskEls[B.id]; if (!bEl) return;
  const bx = parseFloat(bEl.dataset.homeX), by = parseFloat(bEl.dataset.homeY);
  const aHomeX = parseFloat(deskEls[A.id].dataset.homeX);
  const aHomeY = parseFloat(deskEls[A.id].dataset.homeY);
  const ax = bx + (aHomeX > bx ? 7 : -7);
  const ay = by + (aHomeY > by ? 5 : -5);
  showStatusIcon(A.id, '💬', 4500);
  await walkToward(A.id, ax, ay, 1100);
  showBubbleOn(A.id, pickRandom(IDLE_CHATS), 1800);
  logActivity(A.emoji, A.id, '<strong>'+A.name+'</strong> → '+B.emoji+' '+B.name+' (잡담)');
  await new Promise(r => setTimeout(r, 1400));
  if (Math.random() < 0.7) {
    showStatusIcon(B.id, '💬', 2500);
    showBubbleOn(B.id, pickRandom(IDLE_CHATS), 1800);
    await new Promise(r => setTimeout(r, 1400));
  }
  await walkToward(A.id, aHomeX, aHomeY, 1100);
}

/* Visit a location, idle there, return — Smallville routine */
async function visitLocationStep(){
  if (!autoWalkActive) return;
  const idleAgents = agents.filter(a => {
    const el = deskEls[a.id];
    return el && (el.classList.contains('idle') || el.classList.contains('done'));
  });
  if (idleAgents.length === 0) return;
  const A = pickRandom(idleAgents);
  const persona = PERSONALITY[A.id] || { likedLocs:['coffee'], status:['💭'] };
  const locId = pickRandom(persona.likedLocs);
  const loc = LOCATIONS[locId]; if (!loc) return;
  const aHomeX = parseFloat(deskEls[A.id].dataset.homeX);
  const aHomeY = parseFloat(deskEls[A.id].dataset.homeY);
  /* offset so multiple agents at same location don't perfectly overlap */
  const offX = (Math.random() - 0.5) * 5;
  showStatusIcon(A.id, loc.emoji, loc.stay + 2400);
  logActivity(loc.emoji, A.id, '<strong>'+A.name+'</strong> → '+loc.label);
  /* mark location active */
  const locEl = document.querySelector('[data-loc="'+locId+'"]');
  if (locEl) locEl.classList.add('active');
  await walkToward(A.id, loc.x + offX, loc.y, 1300);
  await new Promise(r => setTimeout(r, loc.stay));
  if (locEl) locEl.classList.remove('active');
  await walkToward(A.id, aHomeX, aHomeY, 1300);
}

/* Think alone at desk — generate a personality thought */
async function thinkStep(){
  if (!autoWalkActive) return;
  const idleAgents = agents.filter(a => {
    const el = deskEls[a.id];
    return el && (el.classList.contains('idle') || el.classList.contains('done'));
  });
  if (idleAgents.length === 0) return;
  const A = pickRandom(idleAgents);
  const persona = PERSONALITY[A.id] || { thoughts:['...'], status:['💭'] };
  showStatusIcon(A.id, pickRandom(persona.status), 3500);
  showThought(A.id, pickRandom(persona.thoughts), 3500);
}

/* Weighted random action — Smallville-style autonomous behavior */
async function autonomousAct(){
  if (!autoWalkActive) return;
  const r = Math.random();
  if (r < 0.40) await idleChatStep();        /* 40% chitchat */
  else if (r < 0.75) await visitLocationStep(); /* 35% visit a place */
  else await thinkStep();                       /* 25% inner thought */
}

function startAutoWalk(){
  if (autoWalkActive) return;
  autoWalkActive = true;
  logActivity('🚶','ceo','자율 모드 ON — 에이전트들이 일과를 시작합니다.');
  const tick = async () => {
    if (!autoWalkActive) return;
    try { await autonomousAct(); } catch {}
    /* 14~32초 사이 랜덤 간격 — 더 활발하게 */
    const next = 14000 + Math.floor(Math.random() * 18000);
    setTimeout(tick, next);
  };
  setTimeout(tick, 6000);
}
function stopAutoWalk(){
  autoWalkActive = false;
  logActivity('🛑','ceo','자율 모드 OFF');
}

/* ===== Ambient particles — drifting glow dots ===== */
function spawnParticles(){
  const container = document.getElementById('particles'); if (!container) return;
  container.innerHTML = '';
  const count = 14;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.style.left = (Math.random() * 100) + '%';
    p.style.bottom = '0';
    p.style.animationDuration = (10 + Math.random() * 8) + 's';
    p.style.animationDelay = (-Math.random() * 14) + 's';
    /* color variety: green/cyan/violet */
    const c = Math.random();
    if (c < 0.5) { /* green default */ }
    else if (c < 0.8) { p.style.background='rgba(34,211,238,.45)'; p.style.boxShadow='0 0 4px rgba(34,211,238,.7)'; }
    else { p.style.background='rgba(167,139,250,.45)'; p.style.boxShadow='0 0 4px rgba(167,139,250,.7)'; }
    container.appendChild(p);
  }
}

/* ===== HUD ticker — DAY / TIME / OUTPUT / WORKING =====
   DAY/TIME는 실제 달력·시계와 동기화. companyDay는 host로부터
   corporateState 메시지로 받음 (회사 출범일 기준 경과 일수). */
let hudOutputCount = 0;
let hudDayNum = 1;
let hudInterval = null;
function startHud(){
  if (hudInterval) clearInterval(hudInterval);
  const dayEl = document.getElementById('hudDay');
  const timeEl = document.getElementById('hudTime');
  const outEl = document.getElementById('hudOutput');
  const wrkEl = document.getElementById('hudWorking');
  const wrkStatEl = document.getElementById('hudWorkingStat');
  const meta = document.getElementById('topMeta');
  if (dayEl) dayEl.textContent = hudDayNum;
  const update = () => {
    if (dayEl && hudDayNum) dayEl.textContent = hudDayNum;
    /* Wall-clock time — 24h HH:MM, refreshed every tick */
    const now = new Date();
    if (timeEl) timeEl.textContent = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    if (outEl) outEl.textContent = hudOutputCount;
    /* count agents currently working/thinking */
    let working = 0;
    agents.forEach(a => {
      const el = deskEls[a.id];
      if (el && (el.classList.contains('working') || el.classList.contains('thinking'))) working++;
    });
    if (wrkEl) wrkEl.textContent = working + '/' + agents.length;
    if (wrkStatEl) wrkStatEl.classList.toggle('warn', working > 0);
    if (meta) meta.textContent = '에이전트 '+agents.length+'명 · '+(working > 0 ? working+'명 작업 중' : '대기 중');
  };
  hudInterval = setInterval(update, 1000);
  update();
}
function bumpOutput(){ hudOutputCount++; const el = document.getElementById('hudOutput'); if (el) el.textContent = hudOutputCount; }

/* ===== Per-agent connection / API config field schema ===== */
const AGENT_CONFIG_FIELDS = {
  ceo: [
    { key:'company_vision', label:'회사 비전', type:'textarea', help:'한 문장으로 요약. 모든 에이전트가 의사결정 시 참고합니다.' },
    { key:'company_values', label:'핵심 가치', type:'textarea', help:'쉼표로 구분된 키워드. 예: 빠른 실행, 사용자 중심' },
    { key:'monthly_target', label:'월 목표', type:'text', help:'예: 매출 ₩1,000만 / 영상 8개 / 팔로워 +5,000' }
  ],
  youtube: [
    { key:'channel_id', label:'YouTube 채널 ID', type:'text', placeholder:'UCxxx...' },
    { key:'channel_handle', label:'채널 핸들', type:'text', placeholder:'@mychannel' },
    { key:'api_key', label:'YouTube Data API 키', type:'password', help:'console.cloud.google.com에서 발급. 트렌드 조회/통계용.' },
    { key:'content_focus', label:'주력 콘텐츠 주제', type:'textarea', help:'예: AI 도구 리뷰, 자동화 워크플로우' }
  ],
  instagram: [
    { key:'username', label:'인스타그램 핸들', type:'text', placeholder:'@yourhandle' },
    { key:'access_token', label:'Graph API Access Token', type:'password', help:'Meta for Developers에서 발급. 게시/통계용.' },
    { key:'business_account_id', label:'비즈니스 계정 ID', type:'text' },
    { key:'aesthetic', label:'피드 톤앤매너', type:'textarea', help:'예: 미니멀 / 비비드 / 다크모노' }
  ],
  designer: [
    { key:'figma_token', label:'Figma Personal Access Token', type:'password', help:'figma.com/settings → Personal access tokens' },
    { key:'brand_colors', label:'브랜드 컬러 (HEX, 쉼표)', type:'text', placeholder:'#FF0033, #FFD700' },
    { key:'preferred_fonts', label:'선호 폰트', type:'text', placeholder:'Pretendard, Inter' },
    { key:'design_system', label:'디자인 시스템 메모', type:'textarea' }
  ],
  developer: [
    { key:'github_token', label:'GitHub Personal Access Token', type:'password', help:'github.com/settings/tokens — repo + workflow 권한 필요' },
    { key:'default_repo', label:'기본 저장소 (owner/repo)', type:'text', placeholder:'wonseokjung/connect-ai' },
    { key:'preferred_stack', label:'선호 기술 스택', type:'text', placeholder:'TypeScript, Next.js, PostgreSQL' },
    { key:'deploy_target', label:'배포 환경', type:'text', placeholder:'Vercel / 자체 서버' }
  ],
  business: [
    { key:'currency', label:'기본 통화', type:'text', placeholder:'KRW' },
    { key:'monthly_target_revenue', label:'월 목표 매출', type:'text', placeholder:'₩1,000만' },
    { key:'payment_provider', label:'결제 서비스', type:'text', placeholder:'Toss / Stripe / PayPal' },
    { key:'tax_rate', label:'세율 / 부가세 정책', type:'text', placeholder:'간이과세 / 일반과세' },
    { key:'revenue_streams', label:'수익 채널', type:'textarea', help:'예: 광고 / 멤버십 / 상품 판매' }
  ],
  secretary: [
    { key:'google_calendar_id', label:'Google Calendar ID', type:'text', placeholder:'primary 또는 yourcal@group.calendar.google.com' },
    { key:'google_oauth_token', label:'Google OAuth Token', type:'password', help:'OAuth 2.0 Playground 또는 자체 발급' },
    { key:'telegram_bot_token', label:'Telegram Bot Token', type:'password', help:'@BotFather에서 봇 만들고 토큰 받기' },
    { key:'telegram_chat_id', label:'Telegram Chat ID', type:'text', placeholder:'본인 chat_id (숫자)', help:'@userinfobot으로 확인' },
    { key:'work_hours', label:'근무 시간', type:'text', placeholder:'09:00–18:00' }
  ]
};

/* ===== Agent profile modal (in-UI panel) ===== */
let _profileAgentId = null;
function openAgentProfile(agentId){
  const a = agentMap[agentId]; if (!a) return;
  _profileAgentId = agentId;
  const backdrop = document.getElementById('agentModalBackdrop');
  const modal = document.getElementById('agentModal');
  const emoji = document.getElementById('amdEmoji');
  const name = document.getElementById('amdName');
  const role = document.getElementById('amdRole');
  const state = document.getElementById('amdState');
  const specialty = document.getElementById('amdSpecialty');
  const memory = document.getElementById('amdMemory');
  const decisions = document.getElementById('amdDecisions');
  const sessions = document.getElementById('amdSessions');
  const sessionList = document.getElementById('amdSessionList');
  if (emoji) emoji.textContent = a.emoji;
  if (name) name.textContent = a.name;
  if (role) role.textContent = a.role;
  if (specialty) specialty.textContent = a.specialty || '—';
  const el = deskEls[agentId];
  let cur = 'IDLE';
  if (el) {
    if (el.classList.contains('working')) cur = 'WORKING';
    else if (el.classList.contains('thinking')) cur = 'THINKING';
    else if (el.classList.contains('done')) cur = 'DONE';
  }
  if (state) state.textContent = cur;
  if (memory) memory.textContent = '불러오는 중…';
  if (decisions) decisions.textContent = '불러오는 중…';
  if (sessions) sessions.textContent = '…';
  if (sessionList) sessionList.innerHTML = '';
  /* render config form */
  renderConfigForm(agentId, {});
  modal.style.setProperty('--ag-color', a.color);
  modal.style.setProperty('--ag-color-glow', a.color + '55');
  if (backdrop) backdrop.removeAttribute('hidden');
  vscode.postMessage({ type: 'agentProfileRequest', agent: agentId });
  vscode.postMessage({ type: 'agentConfigRequest', agent: agentId });
}
function closeAgentProfile(){
  _profileAgentId = null;
  const backdrop = document.getElementById('agentModalBackdrop');
  if (backdrop) backdrop.setAttribute('hidden','');
}

function renderConfigForm(agentId, values){
  const form = document.getElementById('amdConfigForm');
  if (!form) return;
  const fields = AGENT_CONFIG_FIELDS[agentId] || [];
  if (fields.length === 0) {
    form.innerHTML = '<span style="font-size:10px;color:var(--text-dim)">이 에이전트는 별도 외부 연결 설정이 없습니다.</span>';
    return;
  }
  form.innerHTML = '';
  fields.forEach(f => {
    const wrap = document.createElement('div');
    wrap.className = 'amd-field';
    const lbl = document.createElement('label');
    lbl.className = 'amd-field-lbl';
    lbl.textContent = f.label;
    wrap.appendChild(lbl);
    let input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      input = document.createElement('input');
      input.type = (f.type === 'password') ? 'password' : 'text';
    }
    input.className = 'amd-input';
    input.dataset.key = f.key;
    if (f.placeholder) input.placeholder = f.placeholder;
    if (values && values[f.key] !== undefined) input.value = values[f.key];
    wrap.appendChild(input);
    if (f.help) {
      const help = document.createElement('div');
      help.className = 'amd-field-help';
      help.textContent = f.help;
      wrap.appendChild(help);
    }
    form.appendChild(wrap);
  });
}

function collectConfigValues(){
  const form = document.getElementById('amdConfigForm');
  if (!form) return {};
  const out = {};
  form.querySelectorAll('[data-key]').forEach(el => {
    out[el.dataset.key] = el.value || '';
  });
  return out;
}

function saveAgentConfig(){
  if (!_profileAgentId) return;
  const values = collectConfigValues();
  const status = document.getElementById('amdSaveStatus');
  if (status) { status.className = 'amd-save-status show'; status.textContent = '저장 중…'; }
  vscode.postMessage({ type:'saveAgentConfig', agent: _profileAgentId, values });
}

(function(){
  const closeBtn = document.getElementById('amdClose');
  if (closeBtn) closeBtn.addEventListener('click', closeAgentProfile);
  /* Click on backdrop (outside modal box) closes too */
  const backdrop = document.getElementById('agentModalBackdrop');
  if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeAgentProfile(); });
  /* Esc closes */
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _profileAgentId) closeAgentProfile(); });
  const ofb = document.getElementById('amdOpenFolder');
  if (ofb) ofb.addEventListener('click', () => { if (_profileAgentId) vscode.postMessage({ type:'openCompanyFolder', sub:'_agents/'+_profileAgentId }); });
  const sfb = document.getElementById('amdSaveConfig');
  if (sfb) sfb.addEventListener('click', saveAgentConfig);
  const pfb = document.getElementById('pickFolderBtn');
  if (pfb) pfb.addEventListener('click', () => vscode.postMessage({ type:'pickCompanyFolder' }));
})();

/* ===== Brain integration visual ===== */
function pulseBrain(agentId, reason){
  const locEl = document.querySelector('[data-loc="brain"]');
  if (locEl) {
    locEl.classList.add('active');
    setTimeout(()=>locEl.classList.remove('active'), 2200);
  }
  if (agentId) showStatusIcon(agentId, '🧠', 2400);
  if (reason) {
    const a = agentMap[agentId];
    logActivity('🧠', agentId || 'ceo', '<strong>'+(a?a.name:'에이전트')+'</strong> 두뇌 열람: '+reason);
  }
}

function logActivity(emoji, agentId, text){
  const a = agentMap[agentId];
  /* Remove the empty placeholder once anything actually happens. */
  const empty = document.getElementById('logEmpty'); if (empty) empty.remove();
  const e = document.createElement('div'); e.className = 'log-entry';
  if (a) e.style.setProperty('--ag-color', a.color);
  const t = new Date(); const hh = String(t.getHours()).padStart(2,'0'), mm = String(t.getMinutes()).padStart(2,'0'), ss = String(t.getSeconds()).padStart(2,'0');
  e.innerHTML = '<span class="log-time">'+hh+':'+mm+':'+ss+'</span><span class="log-emoji">'+emoji+'</span><span class="log-text">'+text+'</span>';
  logPane.appendChild(e);
  logPane.scrollTop = logPane.scrollHeight;
  /* Mirror latest activity into the topbar status row so the user always
     has a one-line summary of what's happening — even with the log panel
     collapsed. Strip out HTML tags so the row stays clean. */
  try {
    const sa = document.getElementById('statusActivity');
    if (sa) {
      const stripped = String(text || '').replace(/<[^>]+>/g, '').slice(0, 120);
      const who = a ? a.name + ' — ' : '';
      sa.textContent = emoji + ' ' + who + stripped;
    }
  } catch {}
}

function startOutCard(agentId, task){
  const a = agentMap[agentId]; if (!a) return;
  /* Clear empty state once */
  const empty = outPane.querySelector('.empty'); if (empty) empty.remove();
  const card = document.createElement('div');
  card.className = 'out-card';
  card.style.setProperty('--ag-color', a.color);
  card.innerHTML = '<div class="out-head">'+a.emoji+' '+a.name+' <span class="oh-task">— '+escapeHtml(task||'')+'</span></div><div class="out-body"></div>';
  outPane.appendChild(card);
  outPane.scrollTop = outPane.scrollHeight;
  outCardEls[agentId] = { card: card, body: card.querySelector('.out-body'), raw: '' };
}
function appendOutChunk(agentId, value){
  let c = outCardEls[agentId];
  if (!c) { startOutCard(agentId, ''); c = outCardEls[agentId]; }
  if (!c) return;
  c.raw = (c.raw||'') + value;
  c.body.textContent = c.raw;
  outPane.scrollTop = outPane.scrollHeight;
}
function endOutCard(agentId){ delete outCardEls[agentId]; }

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function drawBeams(taskAgentIds){
  if (!beams || !deskEls.ceo) return;
  beams.innerHTML = '';
  const fr = floor.getBoundingClientRect();
  const ceoR = deskEls.ceo.getBoundingClientRect();
  const cx = ceoR.left + ceoR.width/2 - fr.left;
  const cy = ceoR.top + ceoR.height/2 - fr.top;
  const w = fr.width, h = fr.height;
  beams.setAttribute('viewBox','0 0 '+w+' '+h);
  beams.setAttribute('width', w); beams.setAttribute('height', h);
  taskAgentIds.forEach((id, i) => {
    const desk = deskEls[id]; if (!desk || id==='ceo') return;
    const r = desk.getBoundingClientRect();
    const tx = r.left + r.width/2 - fr.left;
    const ty = r.top + r.height/2 - fr.top;
    const mx = (cx+tx)/2, my = (cy+ty)/2 - 30;
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M '+cx+' '+cy+' Q '+mx+' '+my+' '+tx+' '+ty);
    path.setAttribute('class','beam');
    const a = agentMap[id];
    if (a) { path.style.stroke = a.color; path.style.filter = 'drop-shadow(0 0 6px '+a.color+')'; }
    path.style.animationDelay = (i*0.08)+'s';
    beams.appendChild(path);
  });
}

function setSending(v){ cmdSend.disabled = v; cmdInput.disabled = v; }
function send(){
  const text = (cmdInput.value || '').trim();
  if (!text) return;
  setSending(true);
  logActivity('👤','ceo','명령: <strong>'+escapeHtml(text)+'</strong>');
  vscode.postMessage({ type: 'officePrompt', value: text });
  cmdInput.value = '';
}
cmdSend.addEventListener('click', send);
cmdInput.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); }});
folderBtn.addEventListener('click', () => vscode.postMessage({ type: 'openCompanyFolder' }));
/* Single master switch: walking + chatter + 24h work cycle move together.
   Initial state mirrors the workspace setting connectAiLab.autoCycleEnabled,
   pushed by the host on officeInit. */
const workdayBtn = document.getElementById('workdayBtn');
let _chatterTimer = null;
/* Initial state UNKNOWN — start neutral, let officeInit's m.workdayOn drive
   the first paint. Initializing to true here was the source of the "OFF
   reverts to ON" bug — the button briefly rendered ON before the saved
   setting arrived from the host. */
let _workdayOn = false;
function startChatterAutofire(){
  if (_chatterTimer) return;
  _chatterTimer = setInterval(() => {
    try { vscode.postMessage({ type: 'runChatter' }); } catch {}
  }, 300000);
}
function stopChatterAutofire(){
  if (_chatterTimer) { clearInterval(_chatterTimer); _chatterTimer = null; }
}
function applyWorkdayState(on, opts){
  _workdayOn = !!on;
  if (workdayBtn) {
    /* 라벨에 더 명확한 행동 결과 텍스트 + on/off 클래스로 시각 구분 강화 */
    workdayBtn.textContent = _workdayOn ? '24시간 자동 운영 ON' : '24시간 자동 운영 OFF';
    workdayBtn.classList.toggle('on', _workdayOn);
    workdayBtn.classList.toggle('off', !_workdayOn);
    workdayBtn.style.color = '';
    workdayBtn.title = _workdayOn
      ? '🟢 ON — 1인 기업 에이전트들이 15분마다 미션을 향해 자동으로 한 스텝씩 일합니다. 자리 비워도, 일반 채팅 모드여도 계속 일해요. 클릭하면 끔.'
      : '⚫ OFF — 자동 사이클 중단. 사용자가 직접 명령할 때만 동작. 클릭하면 다시 켬.';
  }
  if (_workdayOn) {
    try { startAutoWalk(); } catch {}
    startChatterAutofire();
    /* Click-to-enable should give instant feedback; first-time init shouldn't. */
    if (opts && opts.fireImmediate) {
      try { vscode.postMessage({ type: 'runChatter' }); } catch {}
    }
  } else {
    try { stopAutoWalk(); } catch {}
    stopChatterAutofire();
  }
}
workdayBtn && workdayBtn.addEventListener('click', () => {
  const next = !_workdayOn;
  applyWorkdayState(next, { fireImmediate: next });
  vscode.postMessage({ type: 'toggleAutoCycle', on: next });
});
/* New in v2.81 — dashboard launcher inside the office. Replaces the
   sidebar "회사 둘러보기" button that used to live in the now-removed
   approvals/youtube panels. The office is the natural home for it: you
   step out of the floor plan and into the analytics view. */
const dashboardBtn = document.getElementById('dashboardBtn');
if (dashboardBtn) dashboardBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'openDashboard' });
});
const apiBtn = document.getElementById('apiBtn');
if (apiBtn) apiBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'openApiConnections' });
});
/* Side panel toggle — start collapsed so the map gets all the room */
const sideEl = document.querySelector('.side');
const toggleSideBtn = document.getElementById('toggleSideBtn');
if (sideEl) sideEl.classList.add('collapsed');
if (toggleSideBtn && sideEl) {
  toggleSideBtn.addEventListener('click', () => {
    sideEl.classList.toggle('collapsed');
    toggleSideBtn.style.color = sideEl.classList.contains('collapsed') ? '' : 'var(--accent)';
    /* Re-fit world canvas after panel width change */
    setTimeout(() => { try { fitAndScale(); } catch {} window.dispatchEvent(new Event('resize')); }, 280);
  });
}
/* === Connected campus world — Office + Cafe + Garden in one coord space === */
let officeZones = [];           /* [{id,name,emoji,x,y}] world % */
let worldData = null;           /* { worldWidth, worldHeight, buildings, decorations, ... } */
const stageInner = document.getElementById('stageInner');

function renderWorldGrass(){
  const grass = document.getElementById('worldGrass');
  if (!grass || !worldData || !worldData.grassUri) return;
  /* Tile size = (48 / worldWidth) * 100% so each tile maps to one 48-px
     LimeZu tile in world coordinates. With % units, the grass scales with
     stageInner without becoming pixelated mush. */
  const tilePctW = (48 / worldData.worldWidth) * 100;
  const tilePctH = (48 / worldData.worldHeight) * 100;
  grass.style.backgroundImage = 'url(' + worldData.grassUri + ')';
  grass.style.backgroundSize = tilePctW + '% ' + tilePctH + '%';
}

function renderWorldPaths(){
  const wrap = document.getElementById('worldPaths');
  if (!wrap || !worldData) return;
  wrap.innerHTML = '';
  if (!worldData.pathUri || !Array.isArray(worldData.paths)) return;
  const W = worldData.worldWidth, H = worldData.worldHeight;
  /* Path tile is 48px native; render at one tile per 48 world-px. */
  const tilePctW = (48 / W) * 100;
  const tilePctH = (48 / H) * 100;
  worldData.paths.forEach(p => {
    const strip = document.createElement('div');
    strip.className = 'path-strip';
    strip.style.left   = (p.x / W) * 100 + '%';
    strip.style.top    = (p.y / H) * 100 + '%';
    strip.style.width  = (p.w / W) * 100 + '%';
    strip.style.height = (p.h / H) * 100 + '%';
    strip.style.backgroundImage = 'url(' + worldData.pathUri + ')';
    /* Sub-strip background-size needs to express tile size as % of THIS
       strip, not the world. Convert: tile_strip% = world_tilePct / strip_pct. */
    strip.style.backgroundSize =
      (48 / p.w * 100) + '% ' + (48 / p.h * 100) + '%';
    wrap.appendChild(strip);
  });
}

function renderWorldBuildings(){
  const wrap = document.getElementById('worldBuildings');
  if (!wrap || !worldData) return;
  wrap.innerHTML = '';
  const W = worldData.worldWidth, H = worldData.worldHeight;
  worldData.buildings.forEach(b => {
    const leftPct  = (b.x / W) * 100;
    const topPct   = (b.y / H) * 100;
    const widthPct = (b.width / W) * 100;
    const heightPct= (b.height / H) * 100;
    if (b.layer1Uri) {
      const im = document.createElement('img');
      im.src = b.layer1Uri; im.alt = '';
      im.style.left = leftPct + '%';
      im.style.top  = topPct + '%';
      im.style.width = widthPct + '%';
      im.style.height = heightPct + '%';
      im.style.zIndex = '1';
      wrap.appendChild(im);
    }
    if (b.layer2Uri) {
      const im2 = document.createElement('img');
      im2.src = b.layer2Uri; im2.alt = '';
      im2.style.left = leftPct + '%';
      im2.style.top  = topPct + '%';
      im2.style.width = widthPct + '%';
      im2.style.height = heightPct + '%';
      im2.style.zIndex = '2';
      wrap.appendChild(im2);
    }
  });
}

function renderWorldDecorations(){
  const wrap = document.getElementById('worldDecor');
  if (!wrap || !worldData) return;
  wrap.innerHTML = '';
  const W = worldData.worldWidth;
  // Each decoration is 48px native — render at (48/W)*100 % wide so the
  // pixel-art stays consistent regardless of stage size.
  const decorWPct = (48 / W) * 100;
  worldData.decorations.forEach(d => {
    const img = document.createElement('img');
    img.src = d.uri; img.alt = '';
    img.style.left = d.x + '%';
    img.style.top  = d.y + '%';
    img.style.width = (d.w || decorWPct) + '%';
    /* depth-sort: decorations farther down render in front of higher ones */
    img.style.zIndex = String(Math.floor(d.y * 10));
    wrap.appendChild(img);
  });
}

function renderOfficeZones(zones){
  const wrap = document.getElementById('officeZones');
  if (!wrap) return;
  wrap.innerHTML = '';
  (zones || []).forEach(z => {
    const lbl = document.createElement('div');
    lbl.className = 'zone-label';
    lbl.textContent = (z.emoji || '') + ' ' + z.name;
    lbl.style.left = z.x + '%';
    lbl.style.top  = z.y + '%';
    wrap.appendChild(lbl);
  });
}

/* Resize stageInner to the largest world-aspect rect that fits in the
   office-stage container. World aspect comes from worldData (1400/700 = 2.0). */
function fitStage(){
  const stage = document.getElementById('officeStage');
  const inner = document.getElementById('stageInner');
  if (!stage || !inner) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w <= 0 || h <= 0) return;
  const W = (worldData && worldData.worldWidth) || 1400;
  const H = (worldData && worldData.worldHeight) || 700;
  const targetAR = W / H;
  const containerAR = w / h;
  let iw, ih;
  if (containerAR > targetAR) { ih = h; iw = Math.round(h * targetAR); }
  else                         { iw = w; ih = Math.round(w / targetAR); }
  inner.style.width  = iw + 'px';
  inner.style.height = ih + 'px';
}

/* Scale character sprites to MATCH the world's display scale.
   World is rendered at world-px → stage-px ratio. Characters should scale
   the same so they look proportional to the cubicles/furniture baked into
   the bg images. A small bump (×1.05) so name plates stay readable. */
function updateCharScale(){
  const inner = document.getElementById('stageInner');
  if (!inner) return;
  const worldW = (worldData && worldData.worldWidth) || 1400;
  const worldScale = inner.clientWidth / worldW;
  const scale = Math.max(0.35, Math.min(1.6, worldScale * 1.05));
  inner.style.setProperty('--char-scale', scale.toFixed(2));
}

function fitAndScale(){ fitStage(); updateCharScale(); repositionAllAgents(); }

/* The old 자율(walking) and 자율 대화(chatter) buttons are unified into the
   single 🌞 24시간 업무 toggle above. The startAutoWalk()/stopAutoWalk() and
   chatter-autofire functions are still called from there. */
/* Re-fit stage + rescale characters + reposition agents on panel resize */
window.addEventListener('resize', fitAndScale);
document.querySelectorAll('.side-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.side-tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.side-pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.pane).classList.add('active');
    if (t.dataset.pane === 'convPane') {
      vscode.postMessage({ type: 'loadConversations' });
    }
  });
});
document.getElementById('reloadConvBtn')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'loadConversations' });
});

window.addEventListener('message', e => {
  const m = e.data;
  switch (m.type) {
    case 'officeInit': {
      agents = m.agents || [];
      agentMap = {}; deskEls = {};
      agents.forEach(a => { agentMap[a.id] = a; });
      topCompany.textContent = m.companyName || '1인 기업';
      /* Drop the 'loading' style class once the real name arrives so the
         brand text picks up the bold heading style. */
      topCompany.classList.remove('loading');
      /* Working count in the HUD reflects the actual roster size. */
      const wEl = document.getElementById('hudWorking');
      if (wEl) wEl.textContent = '0/' + (agents.length || 0);
      /* Status row initial text. */
      const sa = document.getElementById('statusActivity');
      if (sa) sa.textContent = agents.length + '명 자리 잡음 · 명령 대기 중';
      /* Connected campus: world canvas with multiple buildings + decorations.
         Agents share the world coord space (% of stageInner = % of world). */
      worldData = m.world || null;
      if (worldData && worldData.desks) {
        HOME_POS = Object.assign({}, HOME_POS, worldData.desks);
      }
      officeZones = (worldData && Array.isArray(worldData.zones)) ? worldData.zones : [];
      document.body.classList.add('floorplan');
      try {
        const dbg = (m.debug || {});
        console.log('[Connect AI] world init — buildings:', dbg.buildingsLoaded, '/ decor:', dbg.decorationsLoaded, '/ custom map:', dbg.customMap||'none');
        const customNote = (dbg.customMap === 'OK') ? ' · 🎨 커스텀 맵 사용' : '';
        logActivity('🛠','ceo','캠퍼스 v2.28: '+(dbg.buildingsLoaded||0)+'동 + '+(dbg.decorationsLoaded||0)+' 장식'+customNote);
      } catch {}
      /* Custom map: a user-supplied full-stage PNG overrides procedural world */
      const customMapUri = m.customMapUri || '';
      const stageEl = document.getElementById('stageInner');
      if (customMapUri) {
        if (stageEl) {
          stageEl.style.backgroundImage = 'url(' + customMapUri + ')';
          stageEl.style.backgroundSize = '100% 100%';
          stageEl.style.backgroundPosition = 'center center';
          stageEl.style.backgroundRepeat = 'no-repeat';
        }
        /* Suppress procedural world layers when custom map is used */
        ['worldGrass','worldPaths','worldBuildings','worldDecorations'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerHTML = '';
        });
      } else {
        if (stageEl) stageEl.style.backgroundImage = '';
        renderWorldGrass();
        renderWorldPaths();
        renderWorldBuildings();
        renderWorldDecorations();
      }
      renderOfficeZones(officeZones);
      /* Render agents inside stageInner — % coords map onto the world canvas */
      const stage = document.getElementById('stageInner');
      if (stage) stage.querySelectorAll('.agent').forEach(d => d.remove());
      agents.forEach(a => {
        const d = makeAgent(a);
        if (stage) stage.appendChild(d);
        deskEls[a.id] = d;
      });
      fitAndScale();
      /* Re-fit once any building image has loaded so layout settles */
      const firstBld = stage && stage.querySelector('.world-buildings img');
      if (firstBld) { firstBld.addEventListener('load', fitAndScale, { once: true }); }
      setTimeout(fitAndScale, 60);
      setTimeout(fitAndScale, 350);
      
      /* Sprite animation loop — LimeZu Premade_Character_48x48 (cell = 48×96).
         Row 1 (y=96)  = idle / standing.  Cycles 6 frames per direction even when idle (subtle breathing).
         Row 2 (y=192) = walking / typing motion.  6 frames per direction.
         Direction columns: down=0, left=6, right=12, up=18 (each 6 frames). */
      let frameCount = 0;
      const TILE = 48;
      const CHAR_HEIGHT = TILE * 2;  /* = 96 — correct cell height */
      const animateSprites = () => {
        frameCount++;
        agents.forEach(a => {
          const el = deskEls[a.id]; if (!el) return;
          const characterEl = el.querySelector('.character'); if (!characterEl) return;

          let colOffset = 0;
          switch (el.dataset.dir) {
            case 'down':  colOffset = 0;  break;
            case 'left':  colOffset = 6;  break;
            case 'right': colOffset = 12; break;
            case 'up':    colOffset = 18; break;
          }

          let row = 1;  /* idle */
          if (el.classList.contains('walking')) row = 2;
          else if (el.classList.contains('working') || el.classList.contains('thinking')) row = 2;

          /* Animate slower when idle, faster when walking/working */
          const speed = (row === 2) ? 8 : 14;
          const frameIndex = Math.floor(frameCount / speed) % 6;
          const col = colOffset + frameIndex;

          characterEl.style.backgroundPosition = '-' + (col * TILE) + 'px -' + (row * CHAR_HEIGHT) + 'px';
        });
        requestAnimationFrame(animateSprites);
      };
      animateSprites();

      /* reposition once layout settles */
      setTimeout(repositionAllAgents, 100);
      setTimeout(repositionAllAgents, 600);
      /* spawn ambient particles */
      spawnParticles();
      /* start HUD ticker (DAY / TIME / WORKING) */
      startHud();
      /* Apply the workday master state IMMEDIATELY so the button reflects the
         saved setting on first paint. The 6s delay used to be here so the
         office could "settle" before chatter/walking, but it caused a real
         UX bug: the button would render "ON" for 6 seconds even when the user
         had it OFF (because _workdayOn defaults to true at module init).
         Users read that flash as "it turned back on by itself".
         The walking + chatter auto-fire is internally throttled, so applying
         the state immediately is safe.
         Fallback to 'true' only when the host genuinely didn't send a value. */
      const initialWorkdayOn = (typeof m.workdayOn === 'boolean') ? m.workdayOn : true;
      applyWorkdayState(initialWorkdayOn, { fireImmediate: false });
      setTimeout(() => { agents.forEach(a => { showStatusIcon(a.id, '☕', 2500); }); }, 1200);
      logActivity('🏢','ceo','사무실 가동. 에이전트 '+agents.length+'명 자리 잡음.');
      logActivity('🌅','ceo','오늘 하루 시작.');
      break;
    }
    case 'agentDispatch': {
      currentTasks = m.tasks || [];
      const ids = ['ceo'].concat(currentTasks.map(t => t.agent));
      whiteboard.classList.add('active');
      whiteboard.innerHTML = '<span class="wb-line">📋 '+escapeHtml(m.brief||'')+'</span>';
      currentTasks.forEach(t => setDeskState(t.agent, 'thinking', t.task));
      document.body.classList.add('dispatching');
      setTimeout(() => drawBeams(ids), 50);
      setTimeout(() => { document.body.classList.remove('dispatching'); beams.innerHTML=''; }, 1700);
      logActivity('🧭','ceo','<strong>분배:</strong> '+escapeHtml(m.brief||''));
      currentTasks.forEach(t => {
        const a = agentMap[t.agent];
        if (a) logActivity(a.emoji, t.agent, '<strong>'+a.name+'</strong> ← '+escapeHtml(t.task));
      });
      /* 캐릭터들이 회의실로 모이는 시네마틱 */
      const taskIdsOnly = currentTasks.map(t => t.agent);
      const ceoP = HOME_POS.ceo;
      taskIdsOnly.forEach((id, i) => {
        setTimeout(() => {
          const offX = ((i % 4) - 1.5) * 7;
          const offY = (Math.floor(i / 4)) * 6 + 8;
          walkToward(id, ceoP.x + offX, ceoP.y + offY, 1100);
        }, i * 90);
      });
      setTimeout(() => {
        taskIdsOnly.forEach(id => {
          const el = deskEls[id]; if (!el) return;
          const hx = parseFloat(el.dataset.homeX), hy = parseFloat(el.dataset.homeY);
          walkToward(id, hx, hy, 1100);
        });
      }, 2200);
      break;
    }
    case 'agentStart': {
      setDeskState(m.agent, 'working', m.task);
      const persona = PERSONALITY[m.agent] || { status:['⚡'] };
      showStatusIcon(m.agent, pickRandom(persona.status), 4500);
      if (m.agent !== 'ceo') {
        startOutCard(m.agent, m.task||'');
        const a = agentMap[m.agent];
        if (a) logActivity(a.emoji, m.agent, a.name+' 작업 시작');
      } else {
        const txt = m.task || 'CEO 작업';
        logActivity('🧭','ceo','<strong>CEO</strong> '+escapeHtml(txt));
      }
      break;
    }
    case 'agentChunk': {
      appendOutChunk(m.agent, m.value || '');
      break;
    }
    case 'agentEnd': {
      setDeskState(m.agent, 'done');
      endOutCard(m.agent);
      const a = agentMap[m.agent];
      if (a) logActivity('✅', m.agent, a.name+' 완료');
      showStatusIcon(m.agent, '✨', 2000);
      bumpOutput();
      break;
    }
    case 'agentPulse': {
      /* External pulse trigger — used by YouTube tool runs / approval gate
         drops. Lights up the named agent's desk briefly so the office shows
         the AI company is alive even when no chat dispatch is happening. */
      try {
        if (m.agent) {
          showStatusIcon(m.agent, m.icon || '✨', m.ms || 3000);
          if (m.deskState) setDeskState(m.agent, m.deskState);
          if (m.log) logActivity(m.icon || '🔔', m.agent, m.log);
        }
      } catch {}
      break;
    }
    case 'corporateReport': {
      whiteboard.classList.add('active');
      whiteboard.innerHTML = '<span class="wb-line">📝 '+escapeHtml((m.brief||'').slice(0,80))+'</span>';
      const block = document.createElement('div'); block.className = 'report-block';
      block.innerHTML = '<div class="rb-head">📝 CEO 종합 보고서</div>'+escapeHtml(m.report||'');
      outPane.appendChild(block);
      outPane.scrollTop = outPane.scrollHeight;
      logActivity('📝','ceo','<strong>종합 보고서 발표</strong> · '+escapeHtml(m.sessionPath||''));
      /* switch to outputs tab */
      document.querySelectorAll('.side-tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.side-pane').forEach(x => x.classList.remove('active'));
      document.querySelector('.side-tab[data-pane="outPane"]').classList.add('active');
      outPane.classList.add('active');
      setSending(false);
      setTimeout(() => Object.keys(deskEls).forEach(id => setDeskState(id, 'idle')), 2500);
      break;
    }
    case 'telegramSent': {
      logActivity('📱','secretary','<strong>Secretary</strong> 텔레그램으로 보고 전송');
      break;
    }
    case 'agentConfig': {
      if (m.agent !== _profileAgentId) break;
      renderConfigForm(m.agent, m.values || {});
      break;
    }
    case 'agentConfigSaved': {
      const status = document.getElementById('amdSaveStatus');
      if (!status) break;
      status.className = 'amd-save-status show ' + (m.error ? 'error' : 'success');
      status.textContent = m.error ? ('⚠️ ' + m.error) : '✅ 저장됨 · _agents/' + m.agent + '/connections.md';
      setTimeout(() => { status.classList.remove('show'); }, 2800);
      break;
    }
    case 'agentProfile': {
      if (m.agent !== _profileAgentId) break;  /* user closed or switched */
      const memEl = document.getElementById('amdMemory');
      const decEl = document.getElementById('amdDecisions');
      const sessEl = document.getElementById('amdSessions');
      const listEl = document.getElementById('amdSessionList');
      if (m.error) {
        if (memEl) memEl.textContent = '⚠️ ' + m.error;
        break;
      }
      /* Swap the avatar emoji square for a real photo when one is provided
         (영숙/레오). The .has-photo class kills the gradient background and
         lets the image cover the avatar tile fully. */
      try {
        const emo = document.getElementById('amdEmoji');
        if (emo) {
          if (m.profileImageUri) {
            emo.classList.add('has-photo');
            emo.innerHTML = '<img class="amd-photo" src="'+m.profileImageUri+'" alt="">';
          } else {
            emo.classList.remove('has-photo');
            const a = agentMap[m.agent];
            emo.textContent = a ? a.emoji : '';
          }
        }
      } catch {}
      if (memEl) memEl.textContent = m.memory || '_없음_';
      if (decEl) decEl.textContent = m.decisions || '_없음_';
      if (sessEl) sessEl.textContent = m.sessionCount || 0;
      if (listEl) {
        listEl.innerHTML = '';
        (m.recentSessions || []).forEach(s => {
          const d = document.createElement('div'); d.className='amd-sess'; d.textContent = '· '+s;
          listEl.appendChild(d);
        });
        if ((m.recentSessions || []).length === 0) listEl.textContent = '_세션 기록 없음_';
      }
      break;
    }
    case 'companyFolderChanged': {
      logActivity('📁','ceo','회사 폴더 변경됨 → '+escapeHtml(m.dir||''));
      break;
    }
    case 'conversationsLoaded': {
      const dateEl = document.getElementById('convDate');
      const bodyEl = document.getElementById('convBody');
      if (dateEl) dateEl.textContent = m.date ? '📅 ' + m.date : '';
      if (bodyEl) bodyEl.textContent = m.content || '';
      /* Auto-scroll to latest entry at the bottom */
      const pane = document.getElementById('convPane');
      if (pane) pane.scrollTop = pane.scrollHeight;
      break;
    }
    case 'brainRead': {
      pulseBrain(m.agent, m.reason || '');
      break;
    }
    case 'agentConfer': {
      const turns = m.turns || [];
      logActivity('💬','ceo','<strong>자율 회의</strong> ('+turns.length+'턴)');
      /* 자동 walk: 화자가 청자 옆으로 걸어가서 말 → 다시 자기 자리로 */
      let chain = Promise.resolve();
      turns.forEach((t) => {
        chain = chain.then(async () => {
          const fa = agentMap[t.from], ta = agentMap[t.to];
          const fEl = deskEls[t.from], tEl = deskEls[t.to];
          if (!fa || !ta || !fEl || !tEl) return;
          const bx = parseFloat(tEl.dataset.homeX), by = parseFloat(tEl.dataset.homeY);
          const ax = parseFloat(fEl.dataset.homeX);
          const offX = (ax > bx ? 7 : -7);
          await walkToward(t.from, bx + offX, by, 950);
          showBubbleOn(t.from, t.text, 1700);
          logActivity(fa.emoji, t.from, '<strong>'+fa.name+'</strong> → '+ta.emoji+' '+ta.name+': '+escapeHtml(t.text));
          await new Promise(r => setTimeout(r, 1500));
          const hx = parseFloat(fEl.dataset.homeX), hy = parseFloat(fEl.dataset.homeY);
          await walkToward(t.from, hx, hy, 950);
        });
      });
      break;
    }
    case 'decisionsLearned': {
      const decs = m.decisions || [];
      if (decs.length === 0) break;
      logActivity('🧠','ceo','<strong>자가학습</strong> '+decs.length+'개 결정 누적 (decisions.md)');
      const empty = outPane.querySelector('.empty'); if (empty) empty.remove();
      const block = document.createElement('div'); block.className = 'report-block';
      block.style.borderColor = 'rgba(167,139,250,.4)';
      block.style.boxShadow = '0 0 14px rgba(167,139,250,.15)';
      block.innerHTML = '<div class="rb-head" style="color:#A78BFA">🧠 자가학습 · decisions.md</div>'+decs.map(d => '• '+escapeHtml(d)).join('<br>');
      outPane.appendChild(block);
      outPane.scrollTop = outPane.scrollHeight;
      break;
    }
    case 'error': {
      logActivity('⚠️','ceo','<strong>오류:</strong> '+escapeHtml(m.value||''));
      setSending(false);
      break;
    }
  }
});

vscode.postMessage({ type: 'officeReady' });
</script>
</body>
</html>`;
    }
}

// ============================================================
// Sidebar Chat Provider
// ============================================================

class SidebarChatProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    // Sidebar's 1인 기업 모드 toggle. When false, autonomous corp activity
    // (morning briefing, auto cycle, ambient chatter) still runs in the
    // background and writes to the conversation log + office panel, but is
    // suppressed in the chat sidebar so regular chats stay clean.
    private _sidebarCorpModeOn: boolean = false;
    private _chatHistory: { role: string; content: string }[] = [];
    private _ctx: vscode.ExtensionContext;

    // 대화 표시용 (system prompt 제외, 유저에게 보여줄 것만 저장)
    private _displayMessages: { text: string; role: string }[] = [];
    private _isSyncingBrain: boolean = false;
    public _brainEnabled: boolean = true; // 🧠 ON/OFF 토글 상태
    private _abortController?: AbortController;
    private _lastPrompt?: string;
    private _lastModel?: string;
    /** Tracks user activity for autonomous cycle gating — only fires auto-work
     *  when user has been idle for the configured threshold. */
    private _lastUserActivityTs: number = Date.now();
    private _autoCycleTimer?: NodeJS.Timeout;
    private _autoCycleRunning: boolean = false;

    // 🎬 Thinking Mode — live cinematic graph that visualises AI reasoning
    private _thinkingMode: boolean = false;
    private _thinkingPanel?: vscode.WebviewPanel;
    private _thinkingReady: boolean = false;
    // Externally-opened brain network panels (메뉴 → 🌐 네트워크 보기) that should
    // also receive thinking events so the user sees the same node pulse / trail.
    private _externalGraphPanels: Set<vscode.WebviewPanel> = new Set();
    public registerExternalGraphPanel(panel: vscode.WebviewPanel) {
        this._externalGraphPanels.add(panel);
        panel.onDidDispose(() => this._externalGraphPanels.delete(panel));
    }

    // 🏢 Office panel broadcast — corporate-mode 메시지를 사이드바와 풀스크린
    // 사무실 패널 양쪽에 동시에 보내기 위한 list. OfficePanel이 자기 webview를 등록.
    private _corporateBroadcastTargets: Set<vscode.Webview> = new Set();
    public registerCorporateBroadcastTarget(webview: vscode.Webview) {
        this._corporateBroadcastTargets.add(webview);
    }
    public unregisterCorporateBroadcastTarget(webview: vscode.Webview) {
        this._corporateBroadcastTargets.delete(webview);
    }
    /* Public pulse — module-level helpers (createApproval, YouTube tool
       runs) call this to light up an agent's desk in the office view.
       Routed through the same broadcast pipeline as agentEnd so the
       Office panel + sidebar (when corp-mode on) both receive it. */
    public pulseAgent(agent: string, icon: string = '✨', ms: number = 3000, log?: string) {
        this._broadcastCorporate({ type: 'agentPulse', agent, icon, ms, log });
        try { this._view?.webview.postMessage({ type: 'agentPulse', agent, icon, ms, log }); } catch { /* ignore */ }
    }
    private _broadcastCorporate(msg: any) {
        // Sidebar receives corp messages ONLY when its 1인 기업 모드 toggle is ON.
        // The office panel always receives them; the daily conversation log file
        // is written separately by appendConversationLog() upstream.
        if (this._sidebarCorpModeOn) {
            try { this._view?.webview.postMessage(msg); } catch { /* ignore */ }
        }
        this._corporateBroadcastTargets.forEach(w => {
            try { w.postMessage(msg); } catch { /* disposed */ }
        });
    }

    /* v2.89.45 — 에이전트 프로필 사진을 markdown으로 반환. 채팅창에 메시지 위에 prepend
       해서 "진짜 사람이 말하는 느낌" 연출. profileImage가 정의된 에이전트(레오/영숙)만
       사진 나오고, 나머지는 빈 문자열 → 그냥 emoji + 이름. */
    private _agentAvatarMd(agentId: string): string {
        const a = AGENTS[agentId];
        if (!a?.profileImage || !this._view) return '';
        try {
            const uri = this._view.webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'assets', 'agents', a.profileImage)
            );
            return `<img src="${uri.toString()}" alt="${a.name}" width="56" height="56" style="border-radius:50%;vertical-align:middle;margin-right:12px;border:2px solid ${a.color}"/>`;
        } catch { return ''; }
    }

    /* v2.89.47 — 마크다운 이미지 버전. webview markdown sanitizer가 inline <img> HTML
       문자 그대로 표시하던 문제 해결. ![alt](url) 형식은 표준 마크다운이라 항상 렌더됨.
       헤딩 라인 뒤에 같이 붙여서 ## ![](url) 📺 레오 형태로 한 줄 헤더 만듦. */
    private _agentAvatarUriMd(agentId: string): string {
        const a = AGENTS[agentId];
        if (!a?.profileImage || !this._view) return '';
        try {
            const uri = this._view.webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'assets', 'agents', a.profileImage)
            );
            /* 마크다운 이미지 + alt text. 가까이 붙어 있는 텍스트와 함께 헤딩에 들어가게 */
            return `![${a.name}](${uri.toString()}) `;
        } catch { return ''; }
    }
    /** Notify the sidebar webview that the office panel opened/closed so it can update its UI. */
    public broadcastOfficeState(open: boolean) {
        try { this._view?.webview.postMessage({ type: 'officeStateChanged', open }); } catch { /* ignore */ }
    }

    // 외부 (OfficePanel)에서 명령을 받아 corporate 작업 시작
    public async runCorporatePromptExternal(prompt: string, modelName: string) {
        this._markActivity();
        await this._handleCorporatePrompt(prompt, modelName);
    }
    public async runAutonomousChatter(modelName: string): Promise<void> {
        await this._runAutonomousChatter(modelName);
    }
    public _markActivity() { this._lastUserActivityTs = Date.now(); }

    /** Fire a "morning briefing" the first time the IDE is opened on a new day,
     *  IF the company is configured. CEO reads goals + recent progress and
     *  proposes the day's top 3 priorities — sets the tone of an autonomous co. */
    public async maybeMorningBriefing(ctx: vscode.ExtensionContext) {
        try {
            if (!isCompanyConfigured()) return;
            // 사용자가 24시간 업무를 OFF 했으면 자동 브리핑도 같이 OFF.
            const enabled = vscode.workspace.getConfiguration('connectAiLab').get<boolean>('autoCycleEnabled', true);
            if (!enabled) return;
            const today = new Date().toISOString().slice(0, 10);
            const last = ctx.globalState.get<string>('lastMorningBriefDate', '');
            if (last === today) return;
            await ctx.globalState.update('lastMorningBriefDate', today);
            // Wait a bit for the IDE / sidebar to settle so the user sees the
            // brief unfold instead of getting hit instantly.
            setTimeout(() => {
                const model = this.getDefaultModel();
                if (!model) return;
                this._handleCorporatePrompt(
                    `[모닝 브리핑] 오늘 날짜는 ${today}입니다. 회사 목표(goals.md)와 지금까지의 의사결정 로그를 바탕으로 오늘 우리 회사가 우선순위로 처리해야 할 작업 3가지를 결정하고, 각 작업을 적절한 에이전트에게 분배하세요.`,
                    model,
                ).catch(() => { /* silent */ });
            }, 12000);
        } catch { /* never break activation on briefing failure */ }
    }

    /** Start the auto-cycle scheduler. Every interval, if idle > threshold and
     *  the company is configured, CEO autonomously dispatches one priority task. */
    /** 24시간 자율 업무 — 사용자가 자리에 있든 없든, 1인 기업 모드(👔)가
     *  사이드바에 켜져 있든 꺼져 있든, autoCycleEnabled가 true면 정해진
     *  간격마다 CEO가 알아서 일을 분배합니다. 이게 "24시간 ON"의 진짜 의미.
     *  안전장치는 두 가지: (1) 동일 사이클 중복 실행 방지, (2) 사용자가 직접
     *  대화 중일 때(_abortController 활성)는 그 호출이 끝날 때까지 대기. */
    /* v2.89 — Dispatch queue. 자율 사이클과 사용자 명령이 동시에 들어와서
       _handleCorporatePrompt를 동시 호출 → 같은 _abortController·_displayMessages
       공유로 상태가 꼬이던 버그 해결.

       원칙:
       - 한 번에 한 개만 실행 (LLM 자원 보호)
       - 사용자 명령 = 큐 앞 (priority='user') — 진행 중 자율 사이클이
         있으면 그게 끝나기 기다림 (soft yield, 보통 30초~3분)
       - 자율 사이클 = 큐 뒤 (priority='auto')
       - 같은 promptKey가 큐에 이미 있으면 중복 추가 안 함
    */
    private _dispatchQueue: Array<{
        promptKey: string;
        prompt: string;
        modelName: string;
        priority: 'user' | 'auto';
        fromTelegram: boolean;
        enqueuedAt: number;
    }> = [];
    private _dispatchWorkerRunning: boolean = false;
    private _currentDispatch: { prompt: string; priority: 'user' | 'auto'; startedAt: number } | null = null;
    public enqueueDispatch(prompt: string, modelName: string, priority: 'user' | 'auto', fromTelegram: boolean): boolean {
        const key = _normalizeForDispatchKey(prompt);
        /* 같은 키가 이미 큐에 있거나 진행 중이면 추가 안 함 (자율 사이클 중복 방지) */
        if (this._currentDispatch && _normalizeForDispatchKey(this._currentDispatch.prompt) === key) return false;
        if (this._dispatchQueue.some(j => j.promptKey === key)) return false;
        const job = { promptKey: key, prompt, modelName, priority, fromTelegram, enqueuedAt: Date.now() };
        if (priority === 'user') {
            /* 큐 앞으로 — 자율 사이클들 모두 양보 */
            this._dispatchQueue.unshift(job);
        } else {
            this._dispatchQueue.push(job);
        }
        if (!this._dispatchWorkerRunning) this._runDispatchWorker();
        return true;
    }
    private async _runDispatchWorker(): Promise<void> {
        if (this._dispatchWorkerRunning) return;
        this._dispatchWorkerRunning = true;
        try {
            while (this._dispatchQueue.length > 0) {
                const job = this._dispatchQueue.shift()!;
                this._currentDispatch = { prompt: job.prompt, priority: job.priority, startedAt: Date.now() };
                /* 자율 사이클 활동 시그널 */
                if (job.priority === 'auto') {
                    try { this._view?.webview.postMessage({ type: 'autoCycleActivity', active: true }); } catch {}
                }
                try {
                    await this._handleCorporatePrompt(job.prompt, job.modelName);
                } catch (err: any) {
                    console.error('[dispatch worker] job failed:', err);
                    if (job.fromTelegram) {
                        sendTelegramReport(`⚠️ 작업 실행 중 오류: ${err?.message || err}`).catch(() => {});
                    }
                } finally {
                    if (job.priority === 'auto') {
                        try { this._view?.webview.postMessage({ type: 'autoCycleActivity', active: false }); } catch {}
                    }
                    _endActiveDispatch(job.prompt);
                }
                this._currentDispatch = null;
            }
        } finally {
            this._dispatchWorkerRunning = false;
        }
    }
    public getDispatchSnapshot(): { current: { prompt: string; priority: string; elapsedSec: number } | null; queueLength: number; queue: Array<{ priority: string; prompt: string }> } {
        const now = Date.now();
        return {
            current: this._currentDispatch
                ? { prompt: this._currentDispatch.prompt.slice(0, 80), priority: this._currentDispatch.priority, elapsedSec: Math.floor((now - this._currentDispatch.startedAt) / 1000) }
                : null,
            queueLength: this._dispatchQueue.length,
            queue: this._dispatchQueue.slice(0, 5).map(j => ({ priority: j.priority, prompt: j.prompt.slice(0, 80) })),
        };
    }

    public startAutoCycle(intervalMin: number = 15, idleMin: number = 0) {
        this.stopAutoCycle();
        const intervalMs = intervalMin * 60 * 1000;
        const idleMs = idleMin * 60 * 1000;
        this._autoCycleTimer = setInterval(() => {
            this._tryAutoCycle(idleMs).catch(() => { /* silent */ });
        }, intervalMs);
    }
    public stopAutoCycle() {
        if (this._autoCycleTimer) { clearInterval(this._autoCycleTimer); this._autoCycleTimer = undefined; }
    }
    private async _tryAutoCycle(idleMs: number) {
        // 24h ON은 idle 게이트 없이 돌아가는 게 정상 — idleMs가 0이면 이 검사 skip.
        if (idleMs > 0 && Date.now() - this._lastUserActivityTs < idleMs) return;
        if (!isCompanyConfigured()) return;
        // Manual kill switch from agent panel — settings key, default ON.
        const enabled = vscode.workspace.getConfiguration('connectAiLab').get<boolean>('autoCycleEnabled', true);
        if (!enabled) return;
        const model = this.getDefaultModel();
        if (!model) return;
        const today = new Date().toISOString().slice(0, 10);
        /* v2.89 — 큐에 자율 사이클 작업 추가. 워커가 알아서 처리하고, 사용자
           명령이 들어오면 그게 우선. 자율 사이클이 진행 중일 때 다음 사이클
           들어오면 큐에 같은 키로 이미 있어서 중복 추가 안 됨(=정상). */
        this.enqueueDispatch(
            `[자율 사이클 — ${today}] 1인 기업 24시간 운영 중. 회사 목표·각 에이전트의 개인 목표(_agents/{id}/goal.md)·최근 의사결정·메모리를 검토해서 지금 가장 가치 있는 단일 작업 1개를 결정하고, 적절한 1~2명 에이전트에게 분배해서 실행하세요. 같은 산출물을 반복하지 마세요 — 메모리에 비슷한 항목이 24시간 내에 있으면 다른 각도로 진전시키세요.`,
            model,
            'auto',
            false,
        );
    }
    public getDefaultModel(): string {
        return getConfig().defaultModel || '';
    }

    /** One round of agent-to-agent ambient chatter. Picks two random specialists,
     *  asks the model for 2-3 short turns of natural workplace dialogue (in
     *  context of recent conversations + company goals), animates the confer in
     *  the office panel, and appends to the daily conversation log. */
    private async _runAutonomousChatter(modelName: string): Promise<void> {
        try {
            ensureCompanyStructure();
            const post = (m: any) => this._broadcastCorporate(m);
            // Pick two distinct specialists at random
            const pool = SPECIALIST_IDS.slice();
            if (pool.length < 2) return;
            const i = Math.floor(Math.random() * pool.length);
            let j = Math.floor(Math.random() * pool.length);
            while (j === i) j = Math.floor(Math.random() * pool.length);
            const aFrom = AGENTS[pool[i]];
            const aTo = AGENTS[pool[j]];
            if (!aFrom || !aTo) return;
            const recent = readRecentConversations(1500);
            const goalsPath = path.join(getCompanyDir(), '_shared', 'goals.md');
            const goals = fs.existsSync(goalsPath) ? fs.readFileSync(goalsPath, 'utf-8').slice(0, 1000) : '';
            const sys = `당신은 1인 AI 기업 사무실의 분위기 시뮬레이터입니다. 두 동료가 자연스럽게 짧게 잡담하거나 작업 얘기를 합니다.

⚠️ 반드시 아래 JSON 형식으로만 출력. 마크다운 펜스·머리말·꼬리말 절대 금지.

{
  "turns": [
    {"from": "${aFrom.id}", "to": "${aTo.id}", "text": "30자 이내 한국어"},
    {"from": "${aTo.id}", "to": "${aFrom.id}", "text": "30자 이내 한국어"}
  ]
}

규칙: 2~3턴, 각 30자 이내, 자연스러움. from/to는 정확히 "${aFrom.id}"와 "${aTo.id}"만.`;
            const usr = `[참여자]\n${aFrom.emoji} ${aFrom.name} (${aFrom.role})\n${aTo.emoji} ${aTo.name} (${aTo.role})\n\n[회사 목표]\n${goals}${recent}`;
            const raw = await this._callAgentLLM(sys, usr, modelName, aFrom.id, false);
            const m = raw.match(/\{[\s\S]*\}/);
            if (!m) return;
            const parsed = JSON.parse(m[0]);
            if (!parsed || !Array.isArray(parsed.turns)) return;
            const validIds = SPECIALIST_IDS;
            const turns: { from: string; to: string; text: string }[] = [];
            for (const t of parsed.turns) {
                if (typeof t.from === 'string' && typeof t.to === 'string' && typeof t.text === 'string'
                    && validIds.includes(t.from) && validIds.includes(t.to)
                    && t.from !== t.to && t.text.trim().length > 0) {
                    turns.push({ from: t.from, to: t.to, text: t.text.trim().slice(0, 80) });
                }
            }
            if (turns.length === 0) return;
            post({ type: 'agentConfer', turns });
            const body = turns
                .map(t => `- ${AGENTS[t.from]?.emoji || ''} **${AGENTS[t.from]?.name || t.from}** → ${AGENTS[t.to]?.emoji || ''} ${AGENTS[t.to]?.name || t.to}: ${t.text}`)
                .join('\n');
            appendConversationLog({ speaker: '자율 잡담', emoji: '💬', section: `${aFrom.name} ↔ ${aTo.name}`, body });
        } catch { /* never let chatter break the panel */ }
    }

    /** Push a flashy "knowledge injected" card into the chat sidebar and
     *  persist a tiny markdown breadcrumb to history so it survives reloads
     *  even if the sidebar wasn't open at injection time. */
    public broadcastInjectCard(title: string, relPath: string) {
        // Persistent breadcrumb in chat history (compact markdown)
        const breadcrumb = '> 🧠 **새 지식 주입됨** · `' + title + '.md`\n> 📁 `' + relPath + '`\n> ✦ I know ' + title + '.';
        this._chatHistory.push({ role: 'assistant', content: breadcrumb });
        this._displayMessages.push({ role: 'ai', text: breadcrumb });
        this._saveHistory();
        // Live, animated card if the sidebar is mounted right now
        if (this._view) {
            this._view.webview.postMessage({ type: 'brainInject', title, relPath });
        }
    }

    /** 스킬팩 주입 — broadcastInjectCard의 스킬 버전.
     *  채팅창에 영구 breadcrumb + 사이드바가 열려있으면 시네마틱 카드 애니메이션. */
    public broadcastSkillCard(agentId: string, name: string, displayName: string, description: string) {
        const a = AGENTS[agentId];
        const agentLabel = a ? `${a.emoji} ${a.name}` : agentId;
        const breadcrumb = '> 🛠 **새 스킬 주입됨** · `' + name + '` → ' + agentLabel
            + (description ? '\n> ' + description.replace(/\n/g, ' ').slice(0, 140) : '')
            + '\n> ⚡ 다음 사이클부터 ' + agentLabel + ' 가 <run_command>로 사용 가능';
        this._chatHistory.push({ role: 'assistant', content: breadcrumb });
        this._displayMessages.push({ role: 'ai', text: breadcrumb });
        this._saveHistory();
        if (this._view) {
            this._view.webview.postMessage({
                type: 'skillInject',
                agentId, agentName: a?.name || agentId, agentEmoji: a?.emoji || '🛠',
                agentColor: a?.color || '#5DE0E6',
                name, displayName, description
            });
        }
    }

    /** Re-scan the brain folder and push fresh node/link data to every open
     *  graph panel. Called after brain-inject (EZER, A.U Training, etc.) so
     *  the user sees new knowledge appear immediately, plus a brief pulse
     *  on the freshly-added node. */
    public broadcastGraphRefresh(highlightTitle?: string) {
        try {
            const brainDir = _getBrainDir();
            if (!fs.existsSync(brainDir)) return;
            const graph = buildKnowledgeGraph(brainDir);
            const data = {
                nodes: graph.nodes.map(n => ({
                    id: n.id, name: n.name, folder: n.folder, tags: n.tags,
                    connections: n.incoming + n.outgoing
                })),
                links: graph.links
            };
            const msg = { type: 'graphData', data, highlightTitle: highlightTitle || null };
            if (this._thinkingPanel && this._thinkingReady) {
                this._thinkingPanel.webview.postMessage(msg);
            }
            this._externalGraphPanels.forEach(panel => {
                try { panel.webview.postMessage(msg); } catch { /* disposed */ }
            });
        } catch (e) {
            console.error('broadcastGraphRefresh failed:', e);
        }
    }

    // 🏛️ AI 파라미터 튜닝
    private _temperature: number;
    private _topP: number;
    private _topK: number;
    private _systemPrompt: string;

    constructor(private readonly _extensionUri: vscode.Uri, ctx: vscode.ExtensionContext) {
        this._ctx = ctx;
        this._temperature = ctx.globalState.get<number>('aiTemperature', 0.8);
        this._topP = ctx.globalState.get<number>('aiTopP', 0.9);
        this._topK = ctx.globalState.get<number>('aiTopK', 40);
        this._systemPrompt = ctx.globalState.get<string>('aiSystemPrompt', SYSTEM_PROMPT);
        this._restoreHistory();
        // 두뇌 토글 상태 복원 (세션 뒤에도 유지)
        this._brainEnabled = this._ctx.globalState.get<boolean>('brainEnabled', true);
    }

    /** 저장된 대화 기록 복원 */
    private _restoreHistory() {
        const saved = this._ctx.workspaceState.get<{ chat: any[]; display: any[] }>('chatState');
        if (saved && saved.chat && saved.chat.length > 1) {
            this._chatHistory = saved.chat;
            this._displayMessages = saved.display || [];
        } else {
            this._initHistory();
        }
    }

    /** 대화 기록 영구 저장 (워크스페이스 단위) */
    private _saveHistory() {
        this._ctx.workspaceState.update('chatState', {
            chat: this._chatHistory,
            display: this._displayMessages
        });
    }

    // ============================================================
    // 🎬 Thinking Mode helpers
    // ============================================================
    private async _toggleThinkingMode() {
        this._thinkingMode = !this._thinkingMode;
        if (this._thinkingMode) {
            this._openThinkingPanel();
        } else {
            this._closeThinkingPanel();
        }
        if (this._view) {
            this._view.webview.postMessage({ type: 'thinkingModeState', value: this._thinkingMode });
        }
    }

    private _openThinkingPanel() {
        if (this._thinkingPanel) {
            this._thinkingPanel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }
        const brainDir = _getBrainDir();
        const graph = buildKnowledgeGraph(brainDir);

        const assetsRoot = vscode.Uri.file(path.join(this._ctx.extensionPath, 'assets'));
        const panel = vscode.window.createWebviewPanel(
            'connectAiThinking',
            '🎬 Thinking Mode — AI 사고 시각화',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [assetsRoot] }
        );

        // Inject the same graph HTML used by showBrainNetwork — it already listens
        // for thinking events via window.message and is fully reusable.
        const forceGraphSrc = panel.webview.asWebviewUri(
            vscode.Uri.file(path.join(this._ctx.extensionPath, 'assets', 'force-graph.min.js'))
        ).toString();
        panel.webview.html = this._buildThinkingHtml(graph, forceGraphSrc, panel.webview.cspSource);

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'graph_ready') {
                this._thinkingReady = true;
                return;
            }
            if (msg.type === 'openFile' && typeof msg.id === 'string') {
                const safe = safeResolveInside(brainDir, msg.id);
                if (safe && fs.existsSync(safe)) {
                    const doc = await vscode.workspace.openTextDocument(safe);
                    vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
                }
            }
        });
        panel.onDidDispose(() => {
            this._thinkingPanel = undefined;
            this._thinkingReady = false;
            this._thinkingMode = false;
            if (this._view) this._view.webview.postMessage({ type: 'thinkingModeState', value: false });
        });
        this._thinkingPanel = panel;
    }

    private _closeThinkingPanel() {
        if (this._thinkingPanel) {
            this._thinkingPanel.dispose();
            this._thinkingPanel = undefined;
            this._thinkingReady = false;
        }
    }

    /** Should we emit thinking events at all? True if either:
     *  - the dedicated Thinking Mode panel is on, or
     *  - the user has a normal brain-network graph panel open and would
     *    benefit from seeing the AI's live activity on it. */
    private _shouldEmitThinking(): boolean {
        return this._thinkingMode || this._externalGraphPanels.size > 0;
    }

    private _postThinking(message: any) {
        if (this._thinkingPanel && this._thinkingReady) {
            this._thinkingPanel.webview.postMessage(message);
        }
        // Also broadcast to any externally-opened brain network panels.
        // Their webview always has the message listener attached, so we don't
        // need a per-panel "ready" handshake — best-effort send is fine.
        this._externalGraphPanels.forEach(panel => {
            try { panel.webview.postMessage(message); } catch { /* disposed */ }
        });
    }

    // ============================================================
    // 📊 Header status bar — folder + GitHub status, always visible
    // ============================================================
    private _sendCompanyState(noteToUser?: string) {
        if (!this._view) return;
        const dir = getCompanyDir();
        const exists = fs.existsSync(path.join(dir, '_shared'));
        const configured = isCompanyConfigured();
        this._view.webview.postMessage({
            type: 'corporateState',
            companyDir: dir.replace(os.homedir(), '~'),
            companyName: readCompanyName(),
            folderExists: exists,
            configured,
            // True when the user already picked a brain folder (e.g. via the
            // welcome 4-step onboarding). Webview uses this to skip the boot
            // Stage 1 folder-choice card — that question was already answered.
            brainExplicitlySet: _isBrainDirExplicitlySet(),
            // 회사가 출범한 이후 실제 경과일 (1일차 = 첫날).
            // HUD의 DAY 카운터가 가상 시간이 아니라 실제 달력에 동기화됨.
            companyDay: configured ? getCompanyDay() : 1,
            note: noteToUser || ''
        });
    }

    private _sendStatusUpdate() {
        if (!this._view) return;
        const cfg = vscode.workspace.getConfiguration('connectAiLab');
        const folderPath = _isBrainDirExplicitlySet() ? _getBrainDir() : '';
        let fileCount = 0;
        if (folderPath && fs.existsSync(folderPath)) {
            try { fileCount = this._findBrainFiles(folderPath).length; } catch { /* ignore */ }
        }
        const githubUrl = cfg.get<string>('secondBrainRepo', '') || '';
        // Last-sync time computed from latest commit on the brain repo, if any
        let lastSync = '';
        if (folderPath && fs.existsSync(path.join(folderPath, '.git'))) {
            const out = gitExecSafe(['log', '-1', '--format=%cr'], folderPath);
            if (out) lastSync = out.trim();
        }
        this._view.webview.postMessage({
            type: 'statusUpdate',
            value: {
                folderPath,
                fileCount,
                githubUrl,
                lastSync,
                syncing: this._isSyncingBrain || _autoSyncRunning
            }
        });
    }

    private async _handleStatusFolderClick() {
        const isSet = _isBrainDirExplicitlySet();
        if (!isSet) {
            // Not configured yet → kick off folder selection
            await _ensureBrainDir();
            this._sendStatusUpdate();
            return;
        }
        // Configured → reveal folder in OS file explorer
        const dir = _getBrainDir();
        if (fs.existsSync(dir)) {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
        }
    }

    private async _handleStatusGitClick() {
        // Beginner-friendly: clicking ☁️ ALWAYS opens the URL input box, with the
        // current URL pre-filled. After save, sync runs automatically.
        // No nested menu — direct typing is the most intuitive flow.
        const cfg = vscode.workspace.getConfiguration('connectAiLab');
        const existing = cfg.get<string>('secondBrainRepo', '') || '';

        const inputUrl = await vscode.window.showInputBox({
            prompt: existing
                ? '🔗 GitHub 저장소 주소를 확인하거나 변경하세요 (Enter로 저장 + 동기화)'
                : '🔗 백업할 GitHub 저장소 주소를 붙여넣고 Enter (예: https://github.com/내이름/저장소)',
            placeHolder: 'https://github.com/사용자명/저장소이름',
            value: existing,
            ignoreFocusOut: true,
            validateInput: (val) => {
                const v = (val || '').trim();
                if (!v) return null;
                if (validateGitRemoteUrl(v)) return null;
                return '⚠️ 형식이 맞지 않아요. 예: https://github.com/내이름/저장소  또는  git@github.com:내이름/저장소.git';
            }
        });

        if (inputUrl === undefined) {
            // User pressed ESC — do nothing
            return;
        }

        const trimmed = inputUrl.trim();
        if (!trimmed) {
            // User cleared the input → ask if they want to disconnect
            const disconnect = await vscode.window.showWarningMessage(
                'GitHub 백업을 끊을까요?',
                { modal: true },
                '☁️ 끊기',
                '⛔ 취소'
            );
            if (disconnect === '☁️ 끊기') {
                await cfg.update('secondBrainRepo', '', vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('☁️ GitHub 백업 연결을 해제했어요.');
                this._sendStatusUpdate();
            }
            return;
        }

        const cleaned = validateGitRemoteUrl(trimmed) || trimmed;
        const isNew = cleaned !== existing;
        if (isNew) {
            await cfg.update('secondBrainRepo', cleaned, vscode.ConfigurationTarget.Global);
        }

        // Always sync after — fresh URL or just confirming
        await this._syncSecondBrain();
        this._sendStatusUpdate();
    }

    /** Build the same HTML that showBrainNetwork uses — kept inline for reuse. */
    private _buildThinkingHtml(graph: BrainGraph, forceGraphSrc: string, cspSource: string): string {
        const graphJson = JSON.stringify({
            nodes: graph.nodes.map(n => ({
                id: n.id, name: n.name, folder: n.folder, tags: n.tags,
                connections: n.incoming + n.outgoing
            })),
            links: graph.links
        });
        const isEmpty = graph.nodes.length === 0;
        return _RENDER_GRAPH_HTML(graphJson, isEmpty, forceGraphSrc, cspSource);
    }

    /** 메모리 누수 방지: 대화 이력 길이 제한 (최근 50건만 유지, 시스템 프롬프트는 보존) */
    private _pruneHistory() {
        const MAX_HISTORY = 50;
        if (this._chatHistory.length > MAX_HISTORY + 1) {
            const sysIdx = this._chatHistory.findIndex(m => m.role === 'system');
            const sys = sysIdx >= 0 ? this._chatHistory[sysIdx] : null;
            const tail = this._chatHistory.slice(-MAX_HISTORY);
            this._chatHistory = sys ? [sys, ...tail] : tail;
        }
        if (this._displayMessages.length > MAX_HISTORY) {
            this._displayMessages = this._displayMessages.slice(-MAX_HISTORY);
        }
    }

    private _initHistory() {
        this._chatHistory = [{ role: 'system', content: this._systemPrompt }];
        this._displayMessages = [];
    }

    public resetChat() {
        this._initHistory();
        this._saveHistory();
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearChat' });
        }
        vscode.window.showInformationMessage('Connect AI: 새 대화가 시작되었습니다.');
    }

    /** 대화를 Markdown 파일로 내보내기 */
    public async exportChat() {
        if (this._displayMessages.length === 0) {
            vscode.window.showWarningMessage('내보낼 대화가 없습니다.');
            return;
        }
        let md = `# Connect AI — 대화 기록\n\n_${new Date().toLocaleString('ko-KR')}_\n\n---\n\n`;
        for (const m of this._displayMessages) {
            const label = m.role === 'user' ? '**👤 You**' : '**✦ Connect AI**';
            md += `### ${label}\n\n${m.text}\n\n---\n\n`;
        }
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) {
            const filePath = path.join(root, `chat-export-${Date.now()}.md`);
            fs.writeFileSync(filePath, md, 'utf-8');
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`대화가 ${path.basename(filePath)}로 저장되었습니다.`);
        }
    }

    /** 채팅 입력창에 포커스 (Cmd+L) */
    public focusInput() {
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({ type: 'focusInput' });
        }
    }

    public getHistoryText(): string {
        return this._displayMessages.map(m => `[${m.role.toUpperCase()}]\n${m.text}`).join('\n\n');
    }

    /** 외부에서 프롬프트 전송 (예: 코드 선택 → 설명, EZER 주입 등).
     *  sidebar가 아직 mount 안 됐어도 history에는 항상 저장 — 다음에 사이드바를
     *  열면 자동 복원되어 보임. mount되어 있으면 즉시 webview에도 전달. */
    public injectSystemMessage(message: string) {
        this._chatHistory.push({ role: 'assistant', content: message });
        this._displayMessages.push({ role: 'ai', text: message });
        this._saveHistory();
        if (this._view) {
            this._view.webview.postMessage({ type: 'response', value: message });
        }
    }

    // Pending prompts buffered while the sidebar webview is unmounted —
    // flushed when resolveWebviewView wires up the new _view.
    private _pendingPrompts: Array<{ prompt: string; fromTelegram: boolean }> = [];
    /* When true, the next AI response should also be sent to Telegram so the
       user sees the same answer in their chat app. Reset after one mirror so
       a sidebar-typed message right after a Telegram dispatch doesn't leak. */
    private _telegramMirrorPending: boolean = false;
    /* Marker we look for to detect when the sidebar's response is actually
       complete (set in _displayMessages). Prevents premature mirrors. */
    private _telegramMirrorSeenAiCount: number = 0;

    /* v2.89.3 — 외부에서(텔레그램 폴링 등) 진행 중 작업 취소.
       sidebar의 stop button과 같은 abort signal 트리거. 활성 디스패치 추적도
       정리. 작업이 없으면 false 반환 — 호출자가 "취소할 게 없어요" 안내 가능. */
    public abortActiveDispatch(): { cancelled: boolean; what?: string } {
        let cancelled = false;
        let what = '';
        if (this._abortController && !this._abortController.signal.aborted) {
            try {
                this._abortController.abort();
                this._abortController = undefined;
                cancelled = true;
            } catch { /* ignore */ }
        }
        /* 활성 디스패치 추적도 정리 — 하트비트 timer 끄고 제거 */
        for (const [key, entry] of _activeDispatches.entries()) {
            if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
            what = entry.step;
            _activeDispatches.delete(key);
            cancelled = true;
        }
        if (cancelled) {
            try {
                this._broadcastCorporate({ type: 'error', value: '🛑 사용자가 텔레그램으로 중단했어요.' });
            } catch { /* ignore */ }
        }
        return { cancelled, what };
    }

    public sendPromptFromExtension(prompt: string, opts?: { fromTelegram?: boolean; corporate?: boolean }) {
        const fromTelegram = !!opts?.fromTelegram;
        const corporate = !!opts?.corporate;
        if (fromTelegram) {
            this._telegramMirrorPending = true;
            // Snapshot AI message count so the mirror watcher can detect the
            // *next* AI message (the response to this prompt).
            this._telegramMirrorSeenAiCount = this._displayMessages.filter(m => m.role === 'ai').length;
        }
        /* v2.87.10 — Corporate dispatch direct path. 이전엔 모든 sendPromptFromExtension
           이 webview의 injectPrompt → send({bypassCorporate:true}) 흐름을 탔는데,
           그게 단일 LLM 호출(_handlePrompt)로만 가서 멀티 에이전트 디스패치
           (_handleCorporatePrompt)가 안 일어남. 텔레그램에서 "유튜브 분석해줘"
           처럼 진짜 에이전트 작업이 필요한 명령은 webview를 우회해서 corporate
           핸들러를 직접 호출해야 함. */
        if (corporate) {
            const model = this.getDefaultModel();
            if (!model) {
                /* v2.88.4 — 이전엔 모델 없으면 silent fall-through으로 webview에
                   inject되었는데, 사이드바 닫혀있는 상태(텔레그램 트리거)면
                   아무것도 안 일어남. 에러를 명확히 알리고 끝. */
                if (fromTelegram) {
                    sendTelegramReport(`⚠️ AI 모델이 선택되지 않았어요. 사이드바를 열어 모델 드롭다운에서 모델을 선택한 후 다시 시도해주세요.`).catch(() => {});
                }
                return;
            }
            this._markActivity();
            /* v2.88 — 중복 감지: 5분 안에 같은 요청이 또 오면 새로 시작 안
               하고 진행 상황만 알림. */
            const existing = _findActiveDispatch(prompt);
            if (existing) {
                const elapsedSec = Math.floor((Date.now() - existing.startedAt) / 1000);
                const msg = `🔄 *비서*: 같은 요청을 이미 처리하고 있어요 (${elapsedSec}초 진행 중 — 현재: ${existing.step}). 결과 곧 알려드릴게요.`;
                if (fromTelegram) sendTelegramReport(msg).catch(() => {});
                try { this.postSystemNote?.(`(중복 무시) 이미 처리 중: ${prompt.slice(0, 60)}…`, '🔄'); } catch {}
                return;
            }
            const entry = _startActiveDispatch(prompt, fromTelegram);
            /* 하트비트 — 12초마다 텔레그램에 진행 상황 알림 */
            if (fromTelegram) {
                entry.heartbeatTimer = setInterval(() => {
                    entry.heartbeatCount++;
                    const elapsed = Math.floor((Date.now() - entry.startedAt) / 1000);
                    sendTelegramReport(`📊 *진행 중* (${elapsed}초) — ${entry.step}`).catch(() => {});
                }, 12_000);
            }
            /* v2.89 — 큐에 사용자 명령 추가 (앞으로). 자율 사이클 진행 중이면
               그게 끝나길 기다린 후 즉시 실행. 자율 사이클이 평균 30초~3분이라
               대기 시간 합리적. 큐 위치 알림. */
            const snap = this.getDispatchSnapshot();
            const wasQueued = snap.current !== null && snap.current.priority === 'auto';
            if (wasQueued && fromTelegram) {
                sendTelegramReport(`📥 *비서*: 자율 사이클이 진행 중이라 곧 처리할게요 (${snap.current!.elapsedSec}초째 진행 중 — 끝나는 대로 즉시 시작).`).catch(() => {});
            }
            this.enqueueDispatch(prompt, model, 'user', fromTelegram);
            return;
        }
        if (this._view) {
            this._view.show?.(true);
            // 약간의 딜레이 후 전송 (뷰가 보이기를 기다림)
            setTimeout(() => {
                this._view?.webview.postMessage({ type: 'injectPrompt', value: prompt });
            }, 300);
        } else {
            // Buffer until the sidebar opens; cap to avoid unbounded growth.
            this._pendingPrompts.push({ prompt, fromTelegram });
            if (this._pendingPrompts.length > 20) this._pendingPrompts.shift();
        }
    }

    /** After a sidebar AI response completes, mirror it back to Telegram if
     *  the original request came from Telegram. Idempotent — only fires once
     *  per mirror cycle and clears the pending flag. Called from the tail of
     *  _handlePrompt and _handleCorporatePrompt. */
    private async _maybeMirrorToTelegram(): Promise<void> {
        if (!this._telegramMirrorPending) return;
        this._telegramMirrorPending = false;
        const tg = readTelegramConfig();
        if (!tg.token || !tg.chatId) return;
        const aiMessages = this._displayMessages.filter(m => m.role === 'ai');
        if (aiMessages.length <= this._telegramMirrorSeenAiCount) {
            /* No new AI message — silently skip. We used to send a "(빈
               응답)" notice, but that fired every time the corporate flow
               handled the dispatch (corporate has its own Telegram report at
               the end and clears mirror flag), creating noise. Better silent
               than spammy. */
            return;
        }
        const newest = aiMessages[aiMessages.length - 1];
        const text = (newest?.text || '').trim();
        if (!text) return;
        try { await sendTelegramLong(text); } catch { /* silent */ }
    }

    /** Display a system note in the chat (no LLM call). Used for Telegram
     *  message mirroring, calendar events, agent status updates, etc. */
    public postSystemNote(text: string, icon: string = '📱') {
        /* Persist the note in the running chat so the user can see Telegram /
           calendar activity even if the sidebar was closed when it happened.
           The note rides the same _displayMessages pipeline as regular chat
           — restoreMessages will replay it via addMsg('note', ...). Without
           this, agents could carry on a whole Telegram conversation while the
           user was away from the desk and they'd come back to a blank chat. */
        const composed = `${icon} ${text}`;
        this._displayMessages.push({ role: 'note', text: composed });
        if (this._displayMessages.length > 100) {
            this._displayMessages = this._displayMessages.slice(-100);
        }
        try { this._saveHistory(); } catch { /* never let a UI mirror break the polling tick */ }
        /* Live broadcast if the sidebar is currently open — the systemNote
           handler renders the same look. Closed-sidebar case relies on the
           restore-from-history path above. */
        if (this._view) {
            this._view.webview.postMessage({ type: 'systemNote', text, icon });
        }
    }
    /** Called from resolveWebviewView once _view is ready. */
    private _flushPendingPrompts() {
        if (!this._view || this._pendingPrompts.length === 0) return;
        const queue = this._pendingPrompts.slice();
        this._pendingPrompts.length = 0;
        queue.forEach((entry, i) => {
            if (entry.fromTelegram) {
                this._telegramMirrorPending = true;
                this._telegramMirrorSeenAiCount = this._displayMessages.filter(m => m.role === 'ai').length;
            }
            setTimeout(() => this._view?.webview.postMessage({ type: 'injectPrompt', value: entry.prompt }), 400 + i * 200);
        });
    }

    // --------------------------------------------------------
    // Webview Lifecycle
    // --------------------------------------------------------
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        // 중요: HTML을 그리기 전에 메시지 리스너를 먼저 붙여야 Race Condition이 발생하지 않습니다!
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'getModels':
                    await this._sendModels();
                    break;
                case 'prompt':
                    if (msg.corporate) {
                        this._sidebarCorpModeOn = true;
                        await this._handleCorporatePrompt(msg.value, msg.model);
                    } else {
                        await this._handlePrompt(msg.value, msg.model, msg.internet);
                    }
                    break;
                case 'corpModeToggle':
                    this._sidebarCorpModeOn = !!msg.on;
                    break;
                case 'loadAgentConfig': {
                    try {
                        ensureCompanyStructure();
                        const goal = readAgentGoal(msg.agent);
                        const ragMode = readAgentRagMode(msg.agent);
                        const selfRagCriteria = readAgentSelfRagCriteria(msg.agent);
                        const verifiedCount = countAgentVerifiedClaims(msg.agent);
                        const tg = readTelegramConfig();
                        const telegramConnected = !!(tg.token && tg.chatId);
                        const autoOn = vscode.workspace.getConfiguration('connectAiLab').get<boolean>('autoCycleEnabled', true);
                        const tools = listAgentTools(msg.agent).map(t => ({
                            name: t.name,
                            displayName: t.displayName,
                            description: t.description,
                            configSchema: t.configSchema,
                            injectedAt: t.injectedAt || null,
                            injectedFrom: t.injectedFrom || null,
                            enabled: t.enabled,
                        }));
                        webviewView.webview.postMessage({ type: 'agentConfigLoaded', agent: msg.agent, goal, ragMode, selfRagCriteria, verifiedCount, telegramConnected, autoOn, tools });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ type: 'agentConfigLoaded', agent: msg.agent, goal: '', ragMode: 'standard', selfRagCriteria: '', verifiedCount: 0, telegramConnected: false, autoOn: false, tools: [], error: String(e?.message || e) });
                    }
                    break;
                }
                case 'loadAllSkills': {
                    /* 글로벌 "내 스킬 라이브러리" 데이터 — 모든 에이전트의 tools를
                       한 번에 묶어서 webview로 전달. 에이전트별로 그룹핑 + Mine 표시. */
                    try {
                        const groups = AGENT_ORDER.map(id => ({
                            agentId: id,
                            agentName: AGENTS[id]?.name || id,
                            agentEmoji: AGENTS[id]?.emoji || '🛠',
                            agentColor: AGENTS[id]?.color || '#5DE0E6',
                            agentRole: AGENTS[id]?.role || '',
                            tools: listAgentTools(id).map(t => ({
                                name: t.name,
                                displayName: t.displayName,
                                description: t.description,
                                injectedAt: t.injectedAt || null,
                                injectedFrom: t.injectedFrom || null,
                            })),
                        }));
                        webviewView.webview.postMessage({ type: 'allSkillsLoaded', groups });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ type: 'allSkillsLoaded', groups: [], error: String(e?.message || e) });
                    }
                    break;
                }
                case 'loadToolConfig': {
                    try {
                        const tools = listAgentTools(msg.agent);
                        const tool = tools.find(t => t.name === msg.tool);
                        if (!tool) {
                            webviewView.webview.postMessage({ type: 'toolConfigLoaded', agent: msg.agent, tool: msg.tool, schema: [], error: '도구를 찾을 수 없어요' });
                            break;
                        }
                        webviewView.webview.postMessage({ type: 'toolConfigLoaded', agent: msg.agent, tool: msg.tool, schema: tool.configSchema });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ type: 'toolConfigLoaded', agent: msg.agent, tool: msg.tool, schema: [], error: String(e?.message || e) });
                    }
                    break;
                }
                case 'saveToolConfig': {
                    try {
                        writeToolConfig(msg.agent, msg.tool, msg.config || {});
                        vscode.window.setStatusBarMessage(`✓ ${msg.tool} 설정 저장됨`, 2000);
                    } catch (e: any) {
                        vscode.window.showWarningMessage(`도구 설정 저장 실패: ${e?.message || e}`);
                    }
                    break;
                }
                case 'setToolEnabled': {
                    try {
                        setToolEnabled(msg.agent, msg.tool, !!msg.enabled);
                    } catch (e: any) {
                        vscode.window.showWarningMessage(`도구 활성화 토글 실패: ${e?.message || e}`);
                    }
                    break;
                }
                case 'openToolFile': {
                    try {
                        const tools = listAgentTools(msg.agent);
                        const tool = tools.find(t => t.name === msg.tool);
                        if (!tool) break;
                        const target = msg.kind === 'script' ? tool.scriptPath
                            : msg.kind === 'readme' ? tool.readmePath
                            : tool.configPath;
                        const doc = await vscode.workspace.openTextDocument(target);
                        await vscode.window.showTextDocument(doc);
                    } catch (e: any) {
                        vscode.window.showWarningMessage(`도구 파일 열기 실패: ${e?.message || e}`);
                    }
                    break;
                }
                case 'runTool': {
                    // Ask the YouTube agent to run this specific tool now via the
                    // CEO dispatch path. The agent has the tool catalog in its
                    // context and can output <run_command> to execute it.
                    // Lifecycle messages (toolRunCompleted) let the panel show
                    // a per-tool game-like state machine: pending → running → done/error.
                    const tools = listAgentTools(msg.agent);
                    const tool = tools.find(t => t.name === msg.tool);
                    if (!tool) {
                        webviewView.webview.postMessage({ type: 'toolRunCompleted', agent: msg.agent, tool: msg.tool, ok: false, reason: 'not_found', message: `도구를 찾을 수 없어요: ${msg.tool}` });
                        break;
                    }
                    // Pre-flight: warn if any password field is empty. Frontend
                    // already paints these as 🔒 locked, but defense-in-depth.
                    const missing = tool.configSchema.filter(f => f.type === 'password' && (!f.value || String(f.value).trim() === ''));
                    if (missing.length > 0) {
                        webviewView.webview.postMessage({ type: 'toolRunCompleted', agent: msg.agent, tool: msg.tool, ok: false, reason: 'missing_config', message: `실행 전에 ${missing.map(f => f.label).join(', ')} 값을 입력해주세요.` });
                        break;
                    }
                    const a = AGENTS[msg.agent];
                    const name = a?.name || msg.agent;
                    const model = this.getDefaultModel();
                    if (!model) {
                        webviewView.webview.postMessage({ type: 'toolRunCompleted', agent: msg.agent, tool: msg.tool, ok: false, reason: 'no_model', message: '기본 모델이 설정되지 않았어요.' });
                        break;
                    }
                    /* Tell frontend the request was accepted — flip card to running */
                    webviewView.webview.postMessage({ type: 'toolRunDispatched', agent: msg.agent, tool: msg.tool });
                    const prevSidebarBroadcast = this._sidebarCorpModeOn;
                    this._sidebarCorpModeOn = true;
                    this._handleCorporatePrompt(
                        `[도구 실행 — ${name} → ${tool.displayName}] ${name} 에이전트에게 다음 도구를 즉시 실행하라고 지시하세요. 반드시 ${msg.agent} 에이전트에게 분배. 도구: ${tool.name}. 실행 명령 (정확히 이 형식): <run_command>cd "${path.dirname(tool.scriptPath)}" && python ${path.basename(tool.scriptPath)}</run_command>. 실행 후 출력을 분석해 다음 액션을 한 줄로 제안하세요.`,
                        model,
                    )
                        .then(() => {
                            webviewView.webview.postMessage({ type: 'toolRunCompleted', agent: msg.agent, tool: msg.tool, ok: true });
                        })
                        .catch((err: any) => {
                            webviewView.webview.postMessage({ type: 'toolRunCompleted', agent: msg.agent, tool: msg.tool, ok: false, reason: 'exec_error', message: String(err?.message || err) });
                        })
                        .finally(() => { this._sidebarCorpModeOn = prevSidebarBroadcast; });
                    break;
                }
                case 'saveAgentGoal': {
                    try {
                        ensureCompanyStructure();
                        writeAgentGoal(msg.agent, msg.goal || '');
                    } catch (e: any) {
                        vscode.window.showWarningMessage(`목표 저장 실패: ${e?.message || e}`);
                    }
                    break;
                }
                case 'saveAgentRagMode': {
                    try {
                        ensureCompanyStructure();
                        writeAgentRagMode(msg.agent, msg.mode || 'standard');
                    } catch (e: any) {
                        vscode.window.showWarningMessage(`RAG 모드 저장 실패: ${e?.message || e}`);
                    }
                    break;
                }
                case 'saveAgentSelfRagCriteria': {
                    try {
                        ensureCompanyStructure();
                        writeAgentSelfRagCriteria(msg.agent, msg.criteria || '');
                    } catch (e: any) {
                        vscode.window.showWarningMessage(`자가검증 기준 저장 실패: ${e?.message || e}`);
                    }
                    break;
                }
                /* ── Telegram setup wizard handlers ──────────────────────────
                   Validate token / auto-detect chat_id / send a test message.
                   The wizard in the webview drives all three so users don't
                   have to touch URLs or JSON. */
                case 'telegramValidateToken': {
                    /* Defense in depth — strip whitespace + invisible unicode +
                       leading "bot" prefix before hitting Telegram. Webview
                       already does this, but if a different caller sends raw
                       paste, we still survive. */
                    let token = String(msg.token || '').trim();
                    token = token.replace(/[ -  ​-‍﻿]+/g, '');
                    if (/^bot/i.test(token)) token = token.replace(/^bot/i, '');
                    try {
                        const r = await axios.get(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`, { timeout: 8000, validateStatus: () => true });
                        const data = r.data || {};
                        if (data.ok) {
                            webviewView.webview.postMessage({
                                type: 'telegramValidateTokenResult', ok: true,
                                username: data.result?.username || '',
                                botName: data.result?.first_name || '',
                                botId: data.result?.id || 0,
                            });
                        } else {
                            webviewView.webview.postMessage({
                                type: 'telegramValidateTokenResult', ok: false,
                                error: data.description || `HTTP ${r.status}`,
                            });
                        }
                    } catch (e: any) {
                        webviewView.webview.postMessage({ type: 'telegramValidateTokenResult', ok: false, error: String(e?.message || e) });
                    }
                    break;
                }
                case 'telegramDetectChatId': {
                    const token = String(msg.token || '').trim();
                    try {
                        const r = await axios.get(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates`, { timeout: 8000, validateStatus: () => true });
                        const data = r.data || {};
                        if (!data.ok) {
                            webviewView.webview.postMessage({ type: 'telegramDetectChatIdResult', ok: false, error: data.description || `HTTP ${r.status}` });
                            break;
                        }
                        // Pull unique chats (private only, prefer most recent)
                        const updates: any[] = Array.isArray(data.result) ? data.result : [];
                        const chats: { id: number; name: string }[] = [];
                        const seen = new Set<number>();
                        for (let i = updates.length - 1; i >= 0; i--) {
                            const m = updates[i]?.message || updates[i]?.edited_message || updates[i]?.channel_post;
                            const c = m?.chat;
                            if (!c || typeof c.id !== 'number') continue;
                            if (seen.has(c.id)) continue;
                            seen.add(c.id);
                            const name = c.first_name ? `${c.first_name}${c.last_name ? ' ' + c.last_name : ''}` : (c.title || c.username || `Chat ${c.id}`);
                            chats.push({ id: c.id, name });
                        }
                        webviewView.webview.postMessage({ type: 'telegramDetectChatIdResult', ok: true, chats });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ type: 'telegramDetectChatIdResult', ok: false, error: String(e?.message || e) });
                    }
                    break;
                }
                case 'telegramSendTest': {
                    const token = String(msg.token || '').trim();
                    const chatId = String(msg.chatId || '').trim();
                    const text = String(msg.text || `✅ 비서(Secretary) 텔레그램 연결 정상 — ${new Date().toLocaleString('ko-KR')}\n\n이 메시지가 보이면 모든 에이전트가 이 채널로 보고를 보낼 수 있습니다.`);
                    try {
                        const r = await axios.post(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
                            chat_id: chatId,
                            text,
                            parse_mode: 'Markdown',
                        }, { timeout: 8000, validateStatus: () => true });
                        const data = r.data || {};
                        if (data.ok) {
                            webviewView.webview.postMessage({ type: 'telegramSendTestResult', ok: true });
                        } else {
                            webviewView.webview.postMessage({ type: 'telegramSendTestResult', ok: false, error: data.description || `HTTP ${r.status}` });
                        }
                    } catch (e: any) {
                        webviewView.webview.postMessage({ type: 'telegramSendTestResult', ok: false, error: String(e?.message || e) });
                    }
                    break;
                }
                case 'telegramSaveSetup': {
                    /* Persist token + chat_id into Secretary's telegram_setup.json
                       — same path that readTelegramConfig + Python _resolve_telegram
                       look at first. Safer than asking user to navigate to ⚙️ form
                       after the wizard. */
                    try {
                        ensureCompanyStructure();
                        const dir = path.join(getCompanyDir(), '_agents', 'secretary', 'tools');
                        fs.mkdirSync(dir, { recursive: true });
                        const p = path.join(dir, 'telegram_setup.json');
                        const cur = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8') || '{}') : {};
                        cur.TELEGRAM_BOT_TOKEN = String(msg.token || '').trim();
                        cur.TELEGRAM_CHAT_ID   = String(msg.chatId || '').trim();
                        fs.writeFileSync(p, JSON.stringify(cur, null, 2));
                        webviewView.webview.postMessage({ type: 'telegramSaveSetupResult', ok: true });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ type: 'telegramSaveSetupResult', ok: false, error: String(e?.message || e) });
                    }
                    break;
                }
                case 'runCalendarWriteWizard': {
                    /* Triggered from agent panel ⚙️ on google_calendar_write —
                       runs the host-side OAuth wizard. */
                    vscode.commands.executeCommand('connect-ai-lab.connectGoogleCalendarWrite').then(undefined, () => { /* user cancel */ });
                    break;
                }
                case 'toggleAutoCycle': {
                    try {
                        await vscode.workspace.getConfiguration('connectAiLab').update('autoCycleEnabled', !!msg.on, vscode.ConfigurationTarget.Global);
                        if (msg.on) {
                            this.startAutoCycle(15, 0);
                        } else {
                            this.stopAutoCycle();
                        }
                    } catch { /* ignore */ }
                    break;
                }
                case 'runAgentStep': {
                    // Manual single-step kick from the agent panel. Goes through
                    // the existing CEO dispatch path so artifacts land in the
                    // same sessions/ folder and the cinematic UI fires.
                    // We TEMPORARILY enable sidebar broadcast for this run so
                    // the user sees their explicit action play out, then
                    // restore the previous state so autonomous activity stays
                    // gated by the user's actual corp toggle.
                    const a = AGENTS[msg.agent];
                    const name = a?.name || msg.agent;
                    const model = this.getDefaultModel();
                    if (!model) {
                        webviewView.webview.postMessage({ type: 'error', value: '⚠️ 기본 모델이 설정되지 않았어요.' });
                        break;
                    }
                    const prevSidebarBroadcast = this._sidebarCorpModeOn;
                    this._sidebarCorpModeOn = true;
                    this._handleCorporatePrompt(
                        `[수동 한 스텝 — ${name}] ${name} 에이전트의 개인 목표(_agents/${msg.agent}/goal.md)를 향해 다음 한 스텝을 실행하세요. 반드시 ${msg.agent} 에이전트에게 작업을 분배하세요.`,
                        model,
                    )
                        .catch(() => { /* error already broadcast */ })
                        .finally(() => { this._sidebarCorpModeOn = prevSidebarBroadcast; });
                    break;
                }
                case 'promptWithFile':
                    await this._handlePromptWithFile(msg.value, msg.model, msg.files, msg.internet);
                    break;
                case 'probeIDEModels': {
                    /* Try to discover models the host IDE (Antigravity, Cursor,
                     * VS Code w/ Copilot, etc.) exposes via the vscode.lm API.
                     * Returns list to webview so user can see what's available
                     * without committing to integration yet. */
                    let models: Array<{ id: string; vendor: string; family: string; name: string }> = [];
                    let error = '';
                    try {
                        const lm: any = (vscode as any).lm;
                        if (lm && typeof lm.selectChatModels === 'function') {
                            const result = await lm.selectChatModels({});
                            if (Array.isArray(result)) {
                                models = result.map((m: any) => ({
                                    id: m.id || '',
                                    vendor: m.vendor || '',
                                    family: m.family || '',
                                    name: m.name || m.id || '',
                                }));
                            }
                        } else {
                            error = 'vscode.lm API 미지원 — 이 호스트(Antigravity?)는 익스텐션에 모델을 노출하지 않음';
                        }
                    } catch (e: any) {
                        error = e?.message || String(e);
                    }
                    if (this._view) {
                        this._view.webview.postMessage({ type: 'ideModelsProbed', models, error });
                    }
                    break;
                }
                case 'onboardingState': {
                    const cfg = vscode.workspace.getConfiguration('connectAiLab');
                    const url = (cfg.get<string>('ollamaUrl') || '').trim();
                    const model = (cfg.get<string>('defaultModel') || '').trim();
                    const brain = (cfg.get<string>('localBrainPath') || '').trim();
                    const repo = (cfg.get<string>('secondBrainRepo') || '').trim();
                    const dismissed = !!_extCtx?.globalState.get('onboardingDismissed');
                    let engineDetected = '';
                    try { await axios.get('http://127.0.0.1:1234/v1/models', { timeout: 1000 }); engineDetected = 'LM Studio'; }
                    catch { try { await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 1000 }); engineDetected = 'Ollama'; } catch {} }
                    if (this._view) {
                        this._view.webview.postMessage({
                            type: 'onboardingState',
                            dismissed,
                            steps: {
                                engine: { done: !!model && !!engineDetected, detected: engineDetected, url, model },
                                brain: { done: !!brain, path: brain },
                                github: { done: !!repo, url: repo },
                            },
                        });
                    }
                    break;
                }
                case 'detectEngine': {
                    let detected = '', detail = '';
                    try {
                        const r = await axios.get('http://127.0.0.1:1234/v1/models', { timeout: 1500 });
                        detected = 'LM Studio';
                        detail = (r.data?.data?.[0]?.id) || '';
                    } catch {
                        try {
                            const r = await axios.get('http://127.0.0.1:11434/api/tags', { timeout: 1500 });
                            detected = 'Ollama';
                            detail = (r.data?.models?.[0]?.name) || '';
                        } catch {}
                    }
                    if (detected && detail) {
                        const targetUrl = detected === 'LM Studio' ? 'http://127.0.0.1:1234' : 'http://127.0.0.1:11434';
                        try {
                            const cfg = vscode.workspace.getConfiguration('connectAiLab');
                            await cfg.update('ollamaUrl', targetUrl, vscode.ConfigurationTarget.Global);
                            await cfg.update('defaultModel', detail, vscode.ConfigurationTarget.Global);
                        } catch {}
                    }
                    if (this._view) {
                        this._view.webview.postMessage({ type: 'engineDetected', engine: detected, model: detail });
                    }
                    break;
                }
                case 'pickBrainFolder': {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
                        openLabel: '내 두뇌 폴더로 사용', title: '🧠 두뇌 폴더 선택 (지식·대화·회사 모두 여기에 저장됨)'
                    });
                    if (picked && picked[0]) {
                        const cfg = vscode.workspace.getConfiguration('connectAiLab');
                        try { await cfg.update('localBrainPath', picked[0].fsPath, vscode.ConfigurationTarget.Global); } catch {}
                        if (this._view) this._view.webview.postMessage({ type: 'brainFolderPicked', path: picked[0].fsPath });
                    }
                    break;
                }
                case 'setSecondBrainRepo': {
                    const url = String(msg.value || '').trim();
                    if (url && !validateGitRemoteUrl(url)) {
                        if (this._view) this._view.webview.postMessage({ type: 'githubRepoResult', ok: false, error: '유효한 GitHub URL이 아닙니다' });
                        break;
                    }
                    try {
                        const cfg = vscode.workspace.getConfiguration('connectAiLab');
                        await cfg.update('secondBrainRepo', url, vscode.ConfigurationTarget.Global);
                    } catch {}
                    if (this._view) this._view.webview.postMessage({ type: 'githubRepoResult', ok: true, url });
                    break;
                }
                case 'dismissOnboarding': {
                    try { await _extCtx?.globalState.update('onboardingDismissed', true); } catch {}
                    break;
                }
                case 'corporateInit':
                    try {
                        const dir = getCompanyDir();
                        const exists = fs.existsSync(path.join(dir, '_shared'));
                        const configured = isCompanyConfigured();
                        // 사용자가 1인 기업 모드를 직접 켤 때 그날의 첫 모닝
                        // 브리핑을 흐립니다. 이전 버전에선 활성화 직후 자동
                        // 발사돼서 Ollama 차가운 상태로 "model failed to load"
                        // 에러가 사용자 액션 없이 떴음. 이제 명시적 트리거 시점에만.
                        if (configured) this.maybeMorningBriefing(this._ctx);
                        if (this._view) {
                            const view = this._view;
                            this._view.webview.postMessage({
                                type: 'corporateReady',
                                agents: AGENT_ORDER.map(id => {
                                    // Prefer high-res custom portrait if declared and the file exists,
                                    // else fall back to the bundled pixel sprite.
                                    const customName = AGENTS[id].profileImage;
                                    let portraitUri: vscode.Uri;
                                    if (customName) {
                                        const customPath = vscode.Uri.joinPath(this._ctx.extensionUri, 'assets', 'agents', customName);
                                        try {
                                            if (fs.existsSync(customPath.fsPath)) {
                                                portraitUri = customPath;
                                            } else {
                                                portraitUri = vscode.Uri.joinPath(this._ctx.extensionUri, 'assets', 'pixel', 'characters', `${id}.png`);
                                            }
                                        } catch {
                                            portraitUri = vscode.Uri.joinPath(this._ctx.extensionUri, 'assets', 'pixel', 'characters', `${id}.png`);
                                        }
                                    } else {
                                        portraitUri = vscode.Uri.joinPath(this._ctx.extensionUri, 'assets', 'pixel', 'characters', `${id}.png`);
                                    }
                                    return {
                                        id,
                                        name: AGENTS[id].name,
                                        role: AGENTS[id].role,
                                        emoji: AGENTS[id].emoji,
                                        color: AGENTS[id].color,
                                        tagline: AGENTS[id].tagline,
                                        specialty: AGENTS[id].specialty,
                                        portrait: view.webview.asWebviewUri(portraitUri).toString(),
                                        portraitIsCustom: !!customName && fs.existsSync(vscode.Uri.joinPath(this._ctx.extensionUri, 'assets', 'agents', customName).fsPath),
                                    };
                                }),
                                companyDir: dir.replace(os.homedir(), '~'),
                                companyName: readCompanyName(),
                                folderExists: exists,
                                configured,
                                brainExplicitlySet: _isBrainDirExplicitlySet(),
                                companyDay: configured ? getCompanyDay() : 1
                            });
                        }
                    } catch (e: any) {
                        if (this._view) this._view.webview.postMessage({ type: 'error', value: `⚠️ 회사 폴더 초기화 실패: ${e.message}` });
                    }
                    break;
                case 'openCompanyFolder':
                    try {
                        const dir = ensureCompanyStructure();
                        const sub = msg.sub || '';
                        const target = sub ? path.join(dir, sub) : dir;
                        vscode.env.openExternal(vscode.Uri.file(target));
                    } catch { /* ignore */ }
                    break;
                case 'companySetup': {
                    // msg.choice: 'default' | 'pick' | 'import'
                    const choice = msg.choice as string;
                    try {
                        if (choice === 'default') {
                            // ~/.connect-ai-brain (brain dir == company dir)
                            await setCompanyDir('');
                            ensureCompanyStructure();
                            this._sendCompanyState('두뇌 폴더에 회사 구조가 만들어졌어요.');
                        } else if (choice === 'pick') {
                            const picked = await vscode.window.showOpenDialog({
                                canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
                                openLabel: '두뇌 폴더로 사용',
                                title: '두뇌 폴더 위치 선택 (지식·회사 구조가 모두 이 폴더 안에 저장됩니다)'
                            });
                            if (picked && picked[0]) {
                                const target = picked[0].fsPath;
                                fs.mkdirSync(target, { recursive: true });
                                await setCompanyDir(target);
                                ensureCompanyStructure();
                                this._sendCompanyState(`두뇌 폴더가 ${target} 에 설정되었어요.`);
                            } else {
                                this._sendCompanyState('취소했어요.');
                            }
                        } else if (choice === 'import') {
                            const url = await vscode.window.showInputBox({
                                prompt: '기존 두뇌의 GitHub URL (예: https://github.com/me/my-brain.git)',
                                placeHolder: 'https://github.com/...',
                                validateInput: (v) => {
                                    if (!v || !v.trim()) return undefined;
                                    return validateGitRemoteUrl(v) ? undefined : '⚠️ 유효한 GitHub URL이 아닙니다';
                                }
                            });
                            if (url) {
                                const targetParent = path.join(os.homedir(), '.connect-ai-brain-imported');
                                fs.mkdirSync(targetParent, { recursive: true });
                                const targetName = path.basename(url, '.git');
                                const target = path.join(targetParent, targetName);
                                if (fs.existsSync(target)) {
                                    this._view?.webview.postMessage({ type: 'error', value: `⚠️ 이미 존재하는 폴더: ${target}\n다른 이름으로 다시 시도하거나 폴더를 먼저 정리해주세요.` });
                                } else {
                                    const r = gitRun(['clone', url, target], targetParent, 60000);
                                    if (r.status === 0) {
                                        // import한 위치가 Company 자체이거나 상위인지 확인
                                        const candidate = fs.existsSync(path.join(target, '_shared')) ? target : path.join(target, 'Company');
                                        await setCompanyDir(candidate);
                                        ensureCompanyStructure();
                                        this._sendCompanyState(`✅ 가져오기 완료: ${candidate}`);
                                    } else {
                                        this._view?.webview.postMessage({ type: 'error', value: `⚠️ git clone 실패: ${r.stderr || r.error?.message || 'unknown'}` });
                                    }
                                }
                            } else {
                                this._sendCompanyState('취소했어요.');
                            }
                        }
                    } catch (e: any) {
                        this._view?.webview.postMessage({ type: 'error', value: `⚠️ 회사 설정 실패: ${e.message}` });
                    }
                    break;
                }
                case 'companyInterview': {
                    // msg.answers: { name, oneLiner, audience, goalYear, goalMonth, needs }
                    // (Legacy callers may send `goal` — map it to goalYear for back-compat.)
                    try {
                        const a = msg.answers || {};
                        const goalYear = (a.goalYear || a.goal || '').trim();
                        writeCompanyConfig({
                            name: (a.name || '').trim(),
                            oneLiner: (a.oneLiner || '').trim(),
                            audience: (a.audience || '').trim(),
                            goalYear,
                            goalMonth: (a.goalMonth || '').trim(),
                            needs: (a.needs || '').trim(),
                        });
                        const namedTxt = (a.name || '').trim();
                        this._sendCompanyState(namedTxt ? `✅ "${namedTxt}" 설정 완료. 명령을 내려보세요.` : `✅ 회사 설정 저장 완료.`);
                    } catch (e: any) {
                        this._view?.webview.postMessage({ type: 'error', value: `⚠️ 인터뷰 저장 실패: ${e.message}` });
                    }
                    break;
                }
                case 'loadCompanyConfig': {
                    try {
                        ensureCompanyStructure();
                        const cfg = readCompanyConfig();
                        webviewView.webview.postMessage({ type: 'companyConfigLoaded', config: cfg });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ type: 'companyConfigLoaded', config: null, error: String(e?.message || e) });
                    }
                    break;
                }
                case 'saveCompanyConfig': {
                    try {
                        writeCompanyConfig(msg.config || {});
                        const named = ((msg.config && msg.config.name) || '').trim();
                        this._sendCompanyState(named ? `✅ "${named}" 설정 저장됨.` : `✅ 회사 설정 저장됨.`);
                        webviewView.webview.postMessage({ type: 'companyConfigSaved', ok: true });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ type: 'companyConfigSaved', ok: false, error: String(e?.message || e) });
                    }
                    break;
                }
                case 'newChat':
                    this.resetChat();
                    break;
                case 'ready':
                    // 웹뷰가 준비되면 저장된 대화 기록 복원
                    this._restoreDisplayMessages();
                    break;
                case 'openSettings':
                    await this._handleSettingsMenu();
                    break;
                case 'syncBrain':
                    await this._handleBrainMenu();
                    break;
                case 'showBrainNetwork':
                    vscode.commands.executeCommand('connect-ai-lab.showBrainNetwork');
                    break;
                case 'openOffice':
                    vscode.commands.executeCommand('connect-ai-lab.openOffice');
                    break;
                case 'toggleOffice':
                    if (OfficePanel.current) {
                        OfficePanel.current.dispose();
                    } else {
                        vscode.commands.executeCommand('connect-ai-lab.openOffice');
                    }
                    break;
                case 'closeOffice':
                    if (OfficePanel.current) OfficePanel.current.dispose();
                    break;
                case 'toggleThinking':
                    await this._toggleThinkingMode();
                    break;
                case 'requestStatus':
                    this._sendStatusUpdate();
                    break;
                case 'statusFolderClick':
                    await this._handleStatusFolderClick();
                    break;
                case 'statusGitClick':
                    await this._handleStatusGitClick();
                    break;
                case 'highlightBrainNote':
                    if (typeof msg.note === 'string') {
                        if (!this._thinkingPanel) this._openThinkingPanel();
                        // Allow the panel a moment to load before sending the highlight
                        setTimeout(() => this._postThinking({ type: 'highlight_node', note: msg.note }), 350);
                    }
                    break;
                case 'injectLocalBrain':
                    await this._handleInjectLocalBrain(msg.files);
                    break;
                case 'stopGeneration':
                    if (this._abortController) {
                        this._abortController.abort();
                        this._abortController = undefined;
                    }
                    /* Force-clear any agent cards stuck in 'thinking' state — abort
                       can race past the corporate flow's per-stage agentEnd posts. */
                    try {
                        for (const id of AGENT_ORDER) {
                            this._broadcastCorporate({ type: 'agentEnd', agent: id });
                        }
                    } catch { /* ignore */ }
                    break;
                case 'regenerate':
                    if (this._lastPrompt) {
                        // Remove last AI response from history
                        if (this._chatHistory.length > 0 && this._chatHistory[this._chatHistory.length - 1].role === 'assistant') {
                            this._chatHistory.pop();
                        }
                        if (this._displayMessages.length > 0 && this._displayMessages[this._displayMessages.length - 1].role === 'ai') {
                            this._displayMessages.pop();
                        }
                        await this._handlePrompt(this._lastPrompt, this._lastModel || '');
                    }
                    break;
            }
        });

        // 리스너를 붙인 후 HTML을 렌더링합니다.
        webviewView.webview.html = this._getHtml();
        webviewView.webview.postMessage({ type: 'companyMetrics', metrics: getCompanyMetrics() });

        // Sidebar just mounted — drain any prompts that were buffered while it
        // was closed (e.g. EZER injected knowledge before the user opened it).
        this._flushPendingPrompts();
    }

    // --------------------------------------------------------
    // Settings Menu (Engine + AI Tuning)
    // --------------------------------------------------------
    private async _handleSettingsMenu() {
        if (!this._view) return;

        const mainPick = await vscode.window.showQuickPick([
            { label: '⚙️ AI 엔진 변경', description: '현재: ' + (getConfig().ollamaBase.includes('1234')?'LM Studio':'Ollama'), action: 'engine' },
            { label: '🎛️ AI 파라미터 튜닝', description: `Temp: ${this._temperature}, Top-P: ${this._topP}, Top-K: ${this._topK}`, action: 'params' },
            { label: '📝 시스템 프롬프트 설정', description: '에이전트의 기본 역할을 커스텀합니다.', action: 'prompt' }
        ], { placeHolder: '설정 메뉴' });

        if (!mainPick) return;

        if (mainPick.action === 'engine') {
            const pick = await vscode.window.showQuickPick([
                { label: 'Ollama', description: '', action: 'ollama' },
                { label: 'LM Studio', description: '', action: 'lmstudio' },
            ], { placeHolder: 'AI 엔진을 선택하세요' });

            if (!pick) return;
            const target = (pick as any).action === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234';
            await vscode.workspace.getConfiguration('connectAiLab').update('ollamaUrl', target, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`AI 엔진이 [${pick.label}] 로 변경되었습니다.`);
            await this._sendModels();
        } 
        else if (mainPick.action === 'params') {
            const paramPick = await vscode.window.showQuickPick([
                { label: `Temperature (${this._temperature})`, description: '답변의 창의성 (0.0 ~ 2.0)', action: 'temp' },
                { label: `Top P (${this._topP})`, description: '단어 선택 확률 (0.0 ~ 1.0)', action: 'topp' },
                { label: `Top K (${this._topK})`, description: '단어 선택 범위 (1 ~ 100)', action: 'topk' },
            ], { placeHolder: '파라미터를 선택하세요' });

            if (!paramPick) return;

            if (paramPick.action === 'temp') {
                const val = await vscode.window.showInputBox({ prompt: 'Temperature 값 (0.0~2.0)', value: this._temperature.toString() });
                if (val && !isNaN(Number(val))) {
                    this._temperature = Number(val);
                    this._ctx.globalState.update('aiTemperature', this._temperature);
                    vscode.window.showInformationMessage(`Temperature가 ${this._temperature}로 변경되었습니다.`);
                }
            } else if (paramPick.action === 'topp') {
                const val = await vscode.window.showInputBox({ prompt: 'Top P 값 (0.0~1.0)', value: this._topP.toString() });
                if (val && !isNaN(Number(val))) {
                    this._topP = Number(val);
                    this._ctx.globalState.update('aiTopP', this._topP);
                    vscode.window.showInformationMessage(`Top P가 ${this._topP}로 변경되었습니다.`);
                }
            } else if (paramPick.action === 'topk') {
                const val = await vscode.window.showInputBox({ prompt: 'Top K 값 (1~100)', value: this._topK.toString() });
                if (val && !isNaN(Number(val))) {
                    this._topK = Number(val);
                    this._ctx.globalState.update('aiTopK', this._topK);
                    vscode.window.showInformationMessage(`Top K가 ${this._topK}로 변경되었습니다.`);
                }
            }
        }
        else if (mainPick.action === 'prompt') {
            const val = await vscode.window.showInputBox({ 
                prompt: '시스템 프롬프트 (비워두면 기본값으로 초기화됩니다)', 
                value: this._systemPrompt === SYSTEM_PROMPT ? '' : this._systemPrompt,
                ignoreFocusOut: true
            });
            if (val !== undefined) {
                this._systemPrompt = val.trim() || SYSTEM_PROMPT;
                this._ctx.globalState.update('aiSystemPrompt', this._systemPrompt);
                this._initHistory();
                this._saveHistory();
                vscode.window.showInformationMessage('시스템 프롬프트가 변경되어 새 대화가 시작되었습니다.');
                if (this._view) this._view.webview.postMessage({ type: 'clearChat' });
            }
        }
    }

    private async _handleInjectLocalBrain(files: any[]) {
        if (!this._view) return;
        
        // 폴더 미설정 시 먼저 폴더 선택 강제
        let brainDir: string;
        if (!_isBrainDirExplicitlySet()) {
            const ensured = await _ensureBrainDir();
            if (!ensured) {
                vscode.window.showWarningMessage("📁 지식을 저장할 폴더를 먼저 선택해주세요!");
                return;
            }
            brainDir = ensured;
        } else {
            brainDir = _getBrainDir();
        }
        
        if (!fs.existsSync(brainDir)) {
            fs.mkdirSync(brainDir, { recursive: true });
        }
        const today = new Date();
        const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        const datePath = path.join(brainDir, '00_Raw', dateStr);
        
        if (!fs.existsSync(datePath)) {
            fs.mkdirSync(datePath, { recursive: true });
        }

        let injectedTitles: string[] = [];
        const routedAgents = new Set<string>();

        this._view.webview.postMessage({ type: 'response', value: `🧠 **[P-Reinforce 연동 준비]**\n첨부하신 ${files.length}개의 파일을 로컬 두뇌(\`00_Raw/${dateStr}\`)에 입수하고 자동 푸시를 진행합니다.` });

        for (const file of files) {
            try {
                if (typeof file?.name !== 'string' || typeof file?.data !== 'string') continue;
                const fileContent = Buffer.from(file.data, 'base64').toString('utf-8');
                const sanitized = file.name.replace(/[^a-zA-Z0-9가-힣_.-]/gi, '_');
                const safeTitle = safeBasename(sanitized);
                if (!safeTitle) continue;
                const filePath = safeResolveInside(datePath, safeTitle);
                if (!filePath) continue; // path traversal blocked
                fs.writeFileSync(filePath, fileContent, 'utf-8');
                injectedTitles.push(safeTitle);
                /* Route a one-line summary into matching agents' memory.md
                   so on next cycle they already see "new knowledge inbound"
                   even before scanning the brain folder themselves. Best-effort. */
                try {
                    const recipients = routeBrainInjectionToAgents(filePath, safeTitle);
                    for (const id of recipients) routedAgents.add(id);
                } catch (e) {
                    console.error('Failed to route inject to agent memory:', e);
                }
            } catch (err) {
                console.error('Failed to write brain file:', err);
            }
        }
        /* Surface routing to the user so they know which agents got updated. */
        if (routedAgents.size > 0) {
            const labels = Array.from(routedAgents).map(id => {
                const a = (AGENTS as any)[id];
                return a ? `${a.emoji} ${a.name}` : id;
            }).join(', ');
            this._view.webview.postMessage({ type: 'response', value: `🧠 ${labels} 의 메모리에 새 지식이 자동 연결되었습니다. 다음 사이클부터 활용합니다.` });
        }
        
        const safeTitles = injectedTitles.join(', ');

        _safeGitAutoSync(brainDir, `Auto-Inject Knowledge [Raw]: ${safeTitles}`, this);
        this._sendStatusUpdate();
            
        setTimeout(() => {
            let combinedContent = '';
            for (const title of injectedTitles) {
                try {
                    const content = fs.readFileSync(path.join(datePath, title), 'utf-8');
                    combinedContent += `\n\n[원본 데이터: ${title}]\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``;
                } catch(e) {}
            }

            const hiddenPrompt = `[A.U 시스템 지시: P-Reinforce Architect 모드 활성화]\n새로운 비정형 데이터('${safeTitles}')가 글로벌 두뇌(Second Brain)에 입수 및 클라우드 백업 처리 완료되었습니다.\n\n방금 입수된 데이터의 원본 내용은 아래와 같습니다:${combinedContent}\n\n여기서부터 중요합니다! 마스터가 '응'이나 '진행해' 등으로 동의할 경우, 당신은 절대 대화만으로 대답하지 말고 아래의 [P-Reinforce 구조화 규격]에 따라 곧바로 <create_file> Tool들을 사용하십시오.\n\n[P-Reinforce 구조화 규격]\n1. 폴더 생성: 원본 데이터를 주제별로 쪼개어 절대 경로인 \`${brainDir}/10_Wiki/\` 하위의 적절한 폴더(예: 🛠️ Projects, 💡 Topics, ⚖️ Decisions, 🚀 Skills)에 저장하십시오.\n2. 마크다운 양식 준수: 생성되는 각 문서 파일은 반드시 아래 포맷을 따라야 합니다.\n---\nid: {{UUID}}\ncategory: "[[10_Wiki/설정한_폴더]]"\nconfidence_score: 0.9\ntags: [관련태그]\nlast_reinforced: ${dateStr}\n---\n# [[문서 제목]]\n## 📌 한 줄 통찰\n> (핵심 요약)\n## 📖 구조화된 지식\n- (세부 내용 불렛 포인트)\n## 🔗 지식 연결\n- Parent: [[상위_카테고리]]\n- Related: [[연관_개념]]\n- Raw Source: [[00_Raw/${dateStr}/${safeTitles}]]\n\n지시를 숙지했다면 묻지 말고 즉각 \`<create_file path="${brainDir}/10_Wiki/새폴더/새문서.md">\`를 사용하여 지식을 분해 후 생성하십시오. 완료 후 잘라낸 결과를 보고하십시오.`;
            this._chatHistory.push({ role: 'system', content: hiddenPrompt });
            
            const uiMsg = "🧠 데이터가 완벽하게 입수되었습니다! 즉시 P-Reinforce 구조화를 시작할까요?";
            this.injectSystemMessage(uiMsg);
        }, 3000);
    }

    // --------------------------------------------------------
    // Fetch installed Ollama models
    // --------------------------------------------------------
    private async _sendModels() {
        if (!this._view) { return; }
        const { ollamaBase, defaultModel } = getConfig();
        try {
            const isLMStudio = ollamaBase.includes('1234') || ollamaBase.includes('v1');
            let models: string[] = [];

            if (isLMStudio) {
                // LM Studio 0.3+ 의 native API는 state 필드를 줘서 로드된 모델만 골라낼 수 있음
                try {
                    const nativeRes = await axios.get(`${ollamaBase}/api/v0/models`, { timeout: 3000 });
                    const items: any[] = nativeRes.data?.data || [];
                    if (items.length > 0) {
                        models = items
                            .filter((m: any) => m.state === 'loaded' && (!m.type || m.type === 'llm' || m.type === 'vlm'))
                            .map((m: any) => m.id);
                    }
                } catch { /* 구버전 LM Studio는 native API 없음 → /v1/models 폴백 */ }

                if (models.length === 0) {
                    const res = await axios.get(`${ollamaBase}/v1/models`, { timeout: 3000 });
                    models = (res.data?.data || []).map((m: any) => m.id);
                }
            } else {
                const res = await axios.get(`${ollamaBase}/api/tags`, { timeout: 3000 });
                models = (res.data?.models || []).map((m: any) => m.name);
            }

            if (models.length === 0) {
                models = [defaultModel];
            } else if (!models.includes(defaultModel)) {
                models.unshift(defaultModel);
            }
            this._view.webview.postMessage({ type: 'modelsList', value: models });
        } catch {
            this._view.webview.postMessage({ type: 'modelsList', value: [defaultModel] });
        }
    }

    // --------------------------------------------------------
    // Second Brain Menu (QuickPick)
    // --------------------------------------------------------
    private async _handleBrainMenu() {
        if (!this._view) { return; }
        
        const brainDir = _getBrainDir();
        const brainFiles = fs.existsSync(brainDir) ? this._findBrainFiles(brainDir) : [];
        const fileCount = brainFiles.length;
        
        const currentRepo = vscode.workspace.getConfiguration('connectAiLab').get<string>('secondBrainRepo', '');
        const repoLabel = currentRepo ? currentRepo.split('/').pop() : '없음';
        
        const items: any[] = [
            { label: '☁️ 온라인 지식 공간', description: currentRepo ? `GitHub: ${repoLabel}` : 'GitHub 주소 설정', action: 'changeGithub' },
            { label: '📁 로컬 지식 공간', description: brainDir ? `폴더: ${path.basename(brainDir)} (${fileCount}개 파일)` : '폴더 위치 설정', action: 'changeFolder' },
            { label: '🔄 지금 백업', description: '온라인과 로컬 동기화', action: 'githubSync' },
            { label: '🌐 네트워크 보기', description: '지식 연결 그래프', action: 'viewGraph' },
            { label: '🗑️ 삭제', description: 'GitHub 연결 또는 로컬 폴더 분리', action: 'cleanup' },
        ];

        const pick = await vscode.window.showQuickPick(items, { placeHolder: '🧠 지식 공간 관리' });
        if (!pick) return;

        switch (pick.action) {
            case 'listFiles': {
                if (fileCount === 0) {
                    const action = await vscode.window.showInformationMessage(
                        '📂 아직 저장된 지식이 없어요. 지식 폴더에 .md 파일을 넣어주세요!',
                        '📁 지식 폴더 열기'
                    );
                    if (action === '📁 지식 폴더 열기') {
                        if (!fs.existsSync(brainDir)) fs.mkdirSync(brainDir, { recursive: true });
                        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(brainDir));
                    }
                } else {
                    const fileItems = brainFiles.slice(0, 50).map(f => {
                        const rel = path.relative(brainDir, f);
                        let title = '';
                        try { title = fs.readFileSync(f, 'utf-8').split('\n').find(l => l.trim().length > 0)?.replace(/^#+\s*/, '').slice(0, 60) || ''; } catch {}
                        return { label: `📄 ${rel}`, description: title, filePath: f };
                    });
                    const selected = await vscode.window.showQuickPick(fileItems, { 
                        placeHolder: `📂 내 지식 파일 (총 ${fileCount}개) — 클릭하면 내용을 볼 수 있어요` 
                    });
                    if (selected) {
                        const doc = await vscode.workspace.openTextDocument(selected.filePath);
                        vscode.window.showTextDocument(doc);
                    }
                }
                break;
            }
            case 'changeFolder': {
                const folders = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '이 폴더를 내 지식 폴더로 사용',
                    title: '📁 AI에게 읽혀줄 지식(.md 파일)이 들어있는 폴더를 선택하세요'
                });
                if (folders && folders.length > 0) {
                    const selectedPath = folders[0].fsPath;
                    await vscode.workspace.getConfiguration('connectAiLab').update('localBrainPath', selectedPath, vscode.ConfigurationTarget.Global);
                    this._brainEnabled = true;
                    this._ctx.globalState.update('brainEnabled', true);
                    
                    // 새 폴더에 git이 없으면 자동 초기화 + 기존 깃허브 URL로 remote 재연결
                    const newGitDir = path.join(selectedPath, '.git');
                    if (!fs.existsSync(newGitDir)) {
                        try {
                            gitExec(['init'], selectedPath);
                            gitExecSafe(['branch', '-M', 'main'], selectedPath);

                            const existingRepo = vscode.workspace.getConfiguration('connectAiLab').get<string>('secondBrainRepo', '');
                            const cleanRepo = existingRepo ? validateGitRemoteUrl(existingRepo) : null;
                            if (cleanRepo) {
                                gitExecSafe(['remote', 'add', 'origin', cleanRepo], selectedPath);
                            }
                        } catch (e) {
                            console.warn('Git init on new brain folder failed:', e);
                        }
                    }
                    
                    const newFiles = this._findBrainFiles(selectedPath);
                    vscode.window.showInformationMessage(`✅ 지식 폴더가 변경되었어요! (${newFiles.length}개 지식 파일 발견)`);
                    this._view.webview.postMessage({ type: 'response', value: `🧠 **지식 폴더 연결 완료!**\n📁 ${selectedPath}\n📄 ${newFiles.length}개의 지식 파일을 읽고 있어요.` });
                }
                break;
            }
            case 'resync': {
                this._brainEnabled = true;
                this._ctx.globalState.update('brainEnabled', true);
                const refreshedFiles = this._findBrainFiles(brainDir);
                vscode.window.showInformationMessage(`🔄 지식 새로고침 완료! (${refreshedFiles.length}개)`);
                this._view.webview.postMessage({ type: 'response', value: `🔄 **지식 새로고침 완료!** ${refreshedFiles.length}개 지식이 연결되어 있어요.\n\n지식 모드가 ON 되었습니다.` });
                break;
            }
            case 'viewGraph': {
                vscode.commands.executeCommand('connect-ai-lab.showBrainNetwork');
                break;
            }
            case 'githubSync': {
                await this._syncSecondBrain();
                break;
            }
            case 'changeGithub': {
                const existing = vscode.workspace.getConfiguration('connectAiLab').get<string>('secondBrainRepo', '');
                const inputUrl = await vscode.window.showInputBox({
                    prompt: '☁️ 온라인 지식 공간 — GitHub 주소 (Enter로 저장)',
                    placeHolder: '예: https://github.com/사용자명/저장소이름',
                    value: existing,
                    ignoreFocusOut: true,
                    validateInput: (val) => {
                        const v = (val || '').trim();
                        if (!v) return null;
                        if (validateGitRemoteUrl(v)) return null;
                        return '⚠️ 형식: https://github.com/사용자/저장소  또는  git@github.com:사용자/저장소.git';
                    }
                });
                if (inputUrl !== undefined && inputUrl.trim()) {
                    const cleaned = validateGitRemoteUrl(inputUrl) || inputUrl.trim();
                    await vscode.workspace.getConfiguration('connectAiLab').update('secondBrainRepo', cleaned, vscode.ConfigurationTarget.Global);
                    const saved = vscode.workspace.getConfiguration('connectAiLab').get<string>('secondBrainRepo', '');
                    vscode.window.showInformationMessage(`✅ 온라인 지식 공간 저장됨: ${saved}`);
                    this._sendStatusUpdate();
                }
                break;
            }
            case 'cleanup': {
                const cfg = vscode.workspace.getConfiguration('connectAiLab');
                const hasGit = !!(cfg.get<string>('secondBrainRepo', '') || '');
                const hasFolder = _isBrainDirExplicitlySet();

                const items: any[] = [];
                if (hasGit) items.push({ label: '☁️ 온라인 지식 공간 연결만 끊기', description: '파일은 그대로, GitHub 주소만 제거', kind: 'github' });
                if (hasFolder) items.push({ label: '📁 로컬 지식 공간 연결만 분리', description: '파일은 디스크에 그대로, 익스텐션에서만 분리', kind: 'folder' });
                if (items.length === 0) {
                    vscode.window.showInformationMessage('지울 연결이 없어요. 이미 깨끗합니다 ✨');
                    break;
                }
                items.push({ label: '⛔ 취소', kind: 'cancel' });

                const pick2 = await vscode.window.showQuickPick(items, { placeHolder: '🗑️ 무엇을 끊을까요?' });
                if (!pick2 || pick2.kind === 'cancel') break;

                if (pick2.kind === 'github') {
                    const confirm = await vscode.window.showWarningMessage(
                        '☁️ 온라인 지식 공간 연결을 끊을까요?\n\n• GitHub 저장소 주소만 제거됩니다\n• 로컬 파일과 GitHub 저장소 자체는 그대로 남아요',
                        { modal: true },
                        '☁️ 끊기',
                        '⛔ 취소'
                    );
                    if (confirm === '☁️ 끊기') {
                        await cfg.update('secondBrainRepo', '', vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('☁️ 온라인 지식 공간 연결 해제됨.');
                        this._sendStatusUpdate();
                    }
                } else if (pick2.kind === 'folder') {
                    const confirm = await vscode.window.showWarningMessage(
                        '📁 로컬 지식 공간 연결을 분리할까요?\n\n• 익스텐션이 더 이상 이 폴더를 참조하지 않습니다\n• 디스크의 파일은 그대로 남아요 (수동 삭제 안 함)',
                        { modal: true },
                        '📁 분리',
                        '⛔ 취소'
                    );
                    if (confirm === '📁 분리') {
                        await cfg.update('localBrainPath', '', vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('📁 로컬 지식 공간 연결 분리됨.');
                        this._sendStatusUpdate();
                    }
                }
                break;
            }
        }
    }

    // --------------------------------------------------------
    // Second Brain (Github Repo Knowledge Sync)
    // --------------------------------------------------------
    private async _syncSecondBrain() {
        if (!this._view) { return; }
        if (this._isSyncingBrain) {
            vscode.window.showWarningMessage('동기화가 이미 진행 중입니다. 잠시만 기다려주세요!');
            return;
        }

        // 폴더 미설정 시 먼저 폴더 선택 강제
        if (!_isBrainDirExplicitlySet()) {
            const ensured = await _ensureBrainDir();
            if (!ensured) { return; }
        }

        let secondBrainRepo = vscode.workspace.getConfiguration('connectAiLab').get<string>('secondBrainRepo', '');
        
        // UX 극대화: 안 채워져 있으면 에러 내뱉지 말고 입력창 띄우기!
        if (!secondBrainRepo) {
            const inputUrl = await vscode.window.showInputBox({
                prompt: '🧠 GitHub 저장소 주소를 입력하세요 (Enter로 저장)',
                placeHolder: '예: https://github.com/사용자명/저장소이름',
                ignoreFocusOut: true,
                validateInput: (val) => {
                    const v = (val || '').trim();
                    if (!v) return null;
                    if (validateGitRemoteUrl(v)) return null;
                    return '⚠️ 형식: https://github.com/사용자/저장소  또는  git@github.com:사용자/저장소.git';
                }
            });
            if (!inputUrl || !inputUrl.trim()) { return; }

            const cleaned = validateGitRemoteUrl(inputUrl) || inputUrl.trim();
            await vscode.workspace.getConfiguration('connectAiLab').update('secondBrainRepo', cleaned, vscode.ConfigurationTarget.Global);
            secondBrainRepo = cleaned;
        }

        // git이 시스템에 없으면 의미 있는 에러로 즉시 종료
        if (!isGitAvailable()) {
            this._view.webview.postMessage({ type: 'error', value: '⚠️ git이 설치되지 않았습니다.\n\n👉 https://git-scm.com/downloads 에서 설치 후 VS Code를 다시 실행해주세요.' });
            return;
        }

        // 자동 sync와 동시 실행 방지 (data race로 인한 손상 방지)
        if (_autoSyncRunning) {
            this._view.webview.postMessage({ type: 'response', value: '⏳ 백그라운드에서 자동 동기화가 진행 중입니다. 잠시 후 다시 시도해주세요.' });
            return;
        }
        _autoSyncRunning = true;
        this._isSyncingBrain = true;
        const brainDir = _getBrainDir();
        try {
            this._view.webview.postMessage({ type: 'response', value: '🔄 **지식 동기화 진행 중...** 내 지식 폴더와 GitHub을 최신 상태로 맞추고 있어요.' });

            if (!fs.existsSync(brainDir)) {
                fs.mkdirSync(brainDir, { recursive: true });
            }

            const gitDir = path.join(brainDir, '.git');
            const cleanRepo = validateGitRemoteUrl(secondBrainRepo);
            if (!cleanRepo) {
                throw new Error('지원되지 않는 저장소 URL 형식입니다. 예: https://github.com/사용자/레포지토리');
            }

            // git이 없으면 init
            if (!fs.existsSync(gitDir)) {
                gitExec(['init'], brainDir);
            }

            ensureBrainGitignore(brainDir);
            ensureInitialCommit(brainDir);

            // remote 재연결
            gitExecSafe(['remote', 'remove', 'origin'], brainDir);
            gitExec(['remote', 'add', 'origin', cleanRepo], brainDir);

            // 인증은 시스템 git에 맡깁니다 (osxkeychain / gh CLI / SSH 키 등).
            // VS Code OAuth 강제 호출은 더 헷갈리게 만들었기 때문에 제거.

            // 1. 로컬 변경사항 커밋
            gitExecSafe(['add', '.'], brainDir);
            gitExecSafe(['commit', '-m', 'Auto-sync local brain'], brainDir);

            // 2. 원격 기본 브랜치 감지 + 로컬 브랜치 정렬
            const remoteBranch = getRemoteDefaultBranch(brainDir);
            const currentBranch = gitExecSafe(['rev-parse', '--abbrev-ref', 'HEAD'], brainDir)?.trim() || '';
            if (currentBranch && currentBranch !== remoteBranch) {
                gitExecSafe(['branch', '-M', remoteBranch], brainDir);
            }

            // 3. fetch (원격 상태 파악)
            const fetchRes = gitRun(['fetch', 'origin'], brainDir, 30000);
            const remoteHasBranch = gitExecSafe(['rev-parse', '--verify', `origin/${remoteBranch}`], brainDir) !== null;

            if (fetchRes.status !== 0 && !(fetchRes.stderr || '').toLowerCase().includes("couldn't find remote ref")) {
                const err = classifyGitError(fetchRes.stderr);
                throw new Error(err.message);
            }

            // 4. 원격에 브랜치가 있으면 fast-forward 시도
            if (remoteHasBranch) {
                const ffRes = gitRun(['merge', '--ff-only', `origin/${remoteBranch}`], brainDir, 15000);
                if (ffRes.status !== 0) {
                    const stderrLower = ffRes.stderr.toLowerCase();
                    const diverged = stderrLower.includes('not possible') || stderrLower.includes('non-fast-forward') || stderrLower.includes('refusing');
                    if (diverged) {
                        // 사용자에게 충돌 해결 방법 선택권 제공 (silently 덮어쓰지 않음!)
                        const choice = await vscode.window.showWarningMessage(
                            '🤔 내 PC와 GitHub이 서로 다르게 수정됐어요.\n어떤 걸 살릴까요?',
                            { modal: true },
                            '🤝 둘 다 합치기 (추천)',
                            '💻 내 PC 내용으로 덮어쓰기',
                            '☁️ GitHub 내용으로 덮어쓰기'
                        );
                        if (!choice) {
                            this._view.webview.postMessage({ type: 'response', value: '⏸️ 동기화 취소했어요. 내 PC 파일은 그대로 안전합니다.' });
                            return;
                        }
                        // 선택 적용 — 자동 병합 실패 시 즉시 재선택 다이얼로그를 띄워 사용자를 메뉴로 돌려보내지 않음
                        let resolved = false;
                        let activeChoice: string = choice;
                        for (let attempt = 0; attempt < 3 && !resolved; attempt++) {
                            if (activeChoice.startsWith('🤝')) {
                                // We already fetched at step 3 above — use git merge directly to avoid the
                                // git 2.27+ "divergent branches" hint that `git pull` (without --rebase / --ff-only) emits.
                                const mergeRes = gitRun(['merge', '--no-edit', '--allow-unrelated-histories', `origin/${remoteBranch}`], brainDir, 30000);
                                if (mergeRes.status === 0) {
                                    resolved = true;
                                    break;
                                }
                                // 실패 → 머지 상태 정리 후 사용자에게 다른 방법을 즉시 제안
                                gitExecSafe(['merge', '--abort'], brainDir);
                                const conflicted = gitExecSafe(['diff', '--name-only', '--diff-filter=U'], brainDir)?.trim();
                                const detailMsg = conflicted
                                    ? `🤝 자동으로 못 합쳤어요. 같은 줄이 양쪽에서 다르게 수정됐거든요.\n\n충돌 파일:\n${conflicted}\n\n어떻게 할까요?`
                                    : '🤝 자동으로 못 합쳤어요. 어떻게 할까요?';
                                const next = await vscode.window.showWarningMessage(
                                    detailMsg,
                                    { modal: true },
                                    '💻 내 PC 내용으로 덮어쓰기',
                                    '☁️ GitHub 내용으로 덮어쓰기',
                                    '🛠️ 폴더 열어서 직접 고치기'
                                );
                                if (!next) {
                                    this._view.webview.postMessage({ type: 'response', value: '⏸️ 동기화 취소했어요. 내 PC 파일은 그대로 안전합니다.' });
                                    return;
                                }
                                if (next.startsWith('🛠️')) {
                                    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(brainDir));
                                    this._view.webview.postMessage({ type: 'response', value: '🛠️ 폴더를 열었어요. 파일을 직접 수정한 뒤, 메뉴에서 다시 동기화를 눌러주세요.' });
                                    return;
                                }
                                activeChoice = next;
                                continue;
                            }
                            if (activeChoice.startsWith('💻') || activeChoice.startsWith('💪')) {
                                // git merge with -s recursive -X ours = "merge, but on conflicts prefer my (local) side"
                                const mres = gitRun(['merge', '--no-edit', '--allow-unrelated-histories', '-s', 'recursive', '-X', 'ours', `origin/${remoteBranch}`], brainDir, 30000);
                                if (mres.status !== 0) throw new Error(classifyGitError(mres.stderr).message);
                                resolved = true;
                                break;
                            }
                            // ☁️ GitHub 내용으로 덮어쓰기
                            const fres = gitRun(['fetch', 'origin', remoteBranch], brainDir, 30000);
                            if (fres.status !== 0) throw new Error(classifyGitError(fres.stderr).message);
                            gitExec(['reset', '--hard', `origin/${remoteBranch}`], brainDir, 15000);
                            resolved = true;
                            break;
                        }
                        if (!resolved) {
                            throw new Error('합치기를 끝내지 못했어요. 폴더를 직접 열어서 수정해주세요.');
                        }
                    }
                }
            }

            // 5. push — 시스템 git 자격증명 그대로 사용 (osxkeychain / gh CLI / SSH 키)
            const pushRes = gitRun(['push', '-u', 'origin', remoteBranch], brainDir, 60000);
            if (pushRes.status !== 0) {
                const err = classifyGitError(pushRes.stderr);
                if (err.kind === 'rejected') {
                    // 충돌이 다시 발생한 경우 — force-push는 사용자 명시적 동의 후에만
                    const force = await vscode.window.showWarningMessage(
                        '☁️ GitHub에 더 새로운 내용이 있어요.\n\n그래도 내 PC 내용으로 덮어쓸까요?\n(주의: GitHub의 새 내용은 영구 삭제됩니다)',
                        { modal: true },
                        '⛔ 그만두기 (안전)',
                        '⚠️ 그래도 덮어쓰기'
                    );
                    if (force === '⚠️ 그래도 덮어쓰기') {
                        const forceRes = gitRun(['push', '-u', 'origin', remoteBranch, '--force-with-lease'], brainDir, 60000);
                        if (forceRes.status !== 0) {
                            throw new Error(classifyGitError(forceRes.stderr).message);
                        }
                    } else {
                        throw new Error('덮어쓰기를 그만두었어요. 내 PC 파일은 그대로 안전합니다.');
                    }
                } else {
                    throw new Error(err.message);
                }
            }

            // 연동 완료 후 자동으로 지식 모드 ON
            this._brainEnabled = true;
            this._ctx.globalState.update('brainEnabled', true);

            vscode.window.showInformationMessage('✅ GitHub 동기화 완료!');
            this._view.webview.postMessage({ type: 'response', value: `✅ **동기화가 끝났어요!** (브랜치: \`${remoteBranch}\`)\n\n내 PC와 GitHub이 이제 완전히 똑같은 상태예요.\n\n앞으로 AI가 답변할 때 이 지식들을 참고합니다. (지식 모드: 🟢 ON)` });
            this._sendStatusUpdate();
        } catch (error: any) {
            const userMsg = error?.message || '알 수 없는 문제가 생겼어요';
            vscode.window.showErrorMessage(`동기화 실패: ${userMsg}`);
            this._view.webview.postMessage({ type: 'error', value: `⚠️ ${userMsg}` });
        } finally {
            this._isSyncingBrain = false;
            _autoSyncRunning = false;
        }
    }

    // 재귀 탐색 유틸리티 (하위 폴더까지 .md/.txt 파일 긁어옴)
    public _findBrainFiles(dir: string): string[] {
        let results: string[] = [];
        try {
            const list = fs.readdirSync(dir);
            for (const file of list) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat && stat.isDirectory()) {
                    if (file !== '.git' && file !== 'node_modules' && file !== '.obsidian') {
                        results = results.concat(this._findBrainFiles(filePath));
                    }
                } else {
                    if (file.endsWith('.md') || file.endsWith('.txt')) {
                        results.push(filePath);
                    }
                }
            }
        } catch (e) { /* skip unreadable dirs */ }
        return results;
    }

    // 목차(인덱스)만 생성 — 내용은 AI가 <read_brain>으로 직접 열람
    private _getSecondBrainContext(): string {
        const brainDir = _getBrainDir();
        if (!fs.existsSync(brainDir)) return '';

        const files = this._findBrainFiles(brainDir);
        if (files.length === 0) return '';

        // 컨텍스트 폭발 크래시(OOM)를 방지하기 위해 최대 인덱스 개수 제한
        const MAX_INDEX = 200;
        const index: string[] = [];
        let truncated = false;

        for (let i = 0; i < files.length; i++) {
            if (i >= MAX_INDEX) {
                truncated = true;
                break;
            }
            const file = files[i];
            const relativePath = path.relative(brainDir, file);
            try {
                const firstLine = fs.readFileSync(file, 'utf-8').split('\n').find(l => l.trim().length > 0) || '';
                // 제목 부분만 추출 (# 헤더 또는 첫 줄)
                const title = firstLine.replace(/^#+\s*/, '').slice(0, 80);
                index.push(`  📄 ${relativePath}  →  "${title}"`);
            } catch {
                index.push(`  📄 ${relativePath}`);
            }
        }

        const msgLimit = truncated ? `\n(⚠️ 메모리 폭발 방지를 위해 상위 ${MAX_INDEX}개 파일의 목차만 표시됩니다.)` : '';

        return `\n\n[CRITICAL: SECOND BRAIN INDEX — User's Personal Knowledge Base (${files.length} documents)]\nThe user has synced a personal knowledge repository. Below is the TABLE OF CONTENTS.${msgLimit}\nIf the user's query is even slightly related to any topics in this index, YOU MUST FIRST READ the relevant document BEFORE answering.\nTo read the actual content of any document, use EXACTLY this syntax: <read_brain>filename_or_path</read_brain>\nYou can call <read_brain> multiple times. ALWAYS READ THE FULL DOCUMENT BEFORE ANSWERING.\n\n**IMPORTANT: When your answer uses knowledge from the Second Brain, you MUST end your response with a "📚 출처" section listing the file(s) you referenced. Example:\n📚 출처: MrBeast_분석.md, 마케팅_전략.md**\n\n${index.join('\n')}\n\n`;
    }

    // AI가 <read_brain>태그로 요청한 파일의 실제 내용을 읽어서 반환
    private _readBrainFile(filename: string): string {
        const brainDir = _getBrainDir();
        if (!fs.existsSync(brainDir)) return '[ERROR] Second Brain이 동기화되지 않았습니다. 🧠 버튼을 먼저 눌러주세요.';

        // Path traversal 방어: brainDir 밖으로 나가는 경로는 차단
        const exactPath = safeResolveInside(brainDir, filename);
        if (exactPath && fs.existsSync(exactPath) && fs.statSync(exactPath).isFile()) {
            const content = fs.readFileSync(exactPath, 'utf-8');
            return content.slice(0, 8000); // 파일당 최대 8000자
        }

        // 파일명만으로 퍼지 검색 (하위 폴더에 있을 수 있으므로)
        const baseOnly = path.basename(filename);
        const allFiles = this._findBrainFiles(brainDir);
        const match = allFiles.find(f =>
            path.basename(f) === baseOnly ||
            path.basename(f) === baseOnly + '.md' ||
            (baseOnly.length > 2 && f.includes(baseOnly))
        );

        if (match) {
            // 결과 파일이 brainDir 안인지 한 번 더 확인
            const resolved = path.resolve(match);
            if (resolved.startsWith(path.resolve(brainDir) + path.sep)) {
                const content = fs.readFileSync(resolved, 'utf-8');
                return content.slice(0, 8000);
            }
        }

        return `[NOT FOUND] "${filename}" 파일을 Second Brain에서 찾을 수 없습니다. 목차(INDEX)를 다시 확인해주세요.`;
    }

    /** 저장된 대화 메시지를 웹뷰에 다시 전송 (복원) */
    private _restoreDisplayMessages() {
        if (!this._view || this._displayMessages.length === 0) { return; }
        this._view.webview.postMessage({
            type: 'restoreMessages',
            value: this._displayMessages
        });
    }

    // --------------------------------------------------------
    // Build workspace file tree + read key files
    // --------------------------------------------------------
    private _getWorkspaceContext(): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { return ''; }

        // --- 1. File tree ---
        const lines: string[] = [];
        let count = 0;

        const walk = (dir: string, prefix: string) => {
            if (count >= getConfig().maxTreeFiles) { return; }
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch { return; }

            entries.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) { return -1; }
                if (!a.isDirectory() && b.isDirectory()) { return 1; }
                return a.name.localeCompare(b.name);
            });

            for (const entry of entries) {
                if (count >= getConfig().maxTreeFiles) { break; }
                if (EXCLUDED_DIRS.has(entry.name)) { continue; }
                if (entry.name.startsWith('.') && entry.isDirectory()) { continue; }

                if (entry.isDirectory()) {
                    lines.push(`${prefix}📁 ${entry.name}/`);
                    count++;
                    walk(path.join(dir, entry.name), prefix + '  ');
                } else {
                    lines.push(`${prefix}📄 ${entry.name}`);
                    count++;
                }
            }
        };
        walk(root, '');

        let result = '';
        if (lines.length > 0) {
            result += `\n\n[WORKSPACE INFO]\n📂 경로: ${root}\n\n[프로젝트 파일 구조]\n${lines.join('\n')}`;
        }

        // --- 2. Auto-read key project files ---
        const keyFiles = [
            'package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js',
            'next.config.js', 'next.config.ts', 'README.md',
            'index.html', 'app.js', 'app.ts', 'main.ts', 'main.js',
            'src/index.ts', 'src/index.js', 'src/App.tsx', 'src/App.jsx',
            'src/main.ts', 'src/main.js'
        ];
        let totalRead = 0;
        const MAX_AUTO_READ = 6_000; // chars total

        for (const kf of keyFiles) {
            if (totalRead >= MAX_AUTO_READ) { break; }
            const abs = path.join(root, kf);
            if (fs.existsSync(abs)) {
                try {
                    const content = fs.readFileSync(abs, 'utf-8');
                    if (content.length < 5000) {
                        result += `\n\n[파일 내용: ${kf}]\n\`\`\`\n${content}\n\`\`\``;
                        totalRead += content.length;
                    }
                } catch { /* skip */ }
            }
        }

        return result;
    }

    // --------------------------------------------------------
    // Handle prompt with file attachments (multimodal)
    // --------------------------------------------------------
    private async _handlePromptWithFile(prompt: string, modelName: string, files: {name: string, type: string, data: string}[], internetEnabled?: boolean) {
        if (!this._view) { return; }

        try {
            const { ollamaBase, defaultModel, timeout } = getConfig();
            let isLMStudio = ollamaBase.includes('1234') || ollamaBase.includes('v1');
            let apiUrl = isLMStudio ? `${ollamaBase}/v1/chat/completions` : `${ollamaBase}/api/chat`;

            if (!isLMStudio) {
                try { await axios.get(`${ollamaBase}/api/tags`, { timeout: 1000 }); }
                catch { apiUrl = 'http://127.0.0.1:1234/v1/chat/completions'; isLMStudio = true; }
            }

            // Separate images from text files
            const imageFiles = files.filter(f => f.type.startsWith('image/'));
            const textFiles = files.filter(f => !f.type.startsWith('image/'));

            // Build text context from non-image files
            let fileContext = '';
            for (const f of textFiles) {
                // data is base64 encoded, decode to utf-8 text
                const decoded = Buffer.from(f.data, 'base64').toString('utf-8');
                fileContext += `\n\n[첨부 파일: ${f.name}]\n\`\`\`\n${decoded.slice(0, 20000)}\n\`\`\``;
            }

            const userContent = prompt + fileContext;
            this._chatHistory.push({ role: 'user', content: userContent });
            this._displayMessages.push({ text: prompt + (files.length > 0 ? `\n📎 ${files.map(f=>f.name).join(', ')}` : ''), role: 'user' });

            // Build messages
            const reqMessages = [...this._chatHistory];
            if (reqMessages.length > 0 && reqMessages[0].role === 'system') {
                const editor = vscode.window.activeTextEditor;
                let contextBlock = '';
                if (editor && editor.document.uri.scheme === 'file') {
                    const text = editor.document.getText();
                    const name = path.basename(editor.document.fileName);
                    if (text.trim().length > 0 && text.length < MAX_CONTEXT_SIZE) {
                        contextBlock = `\n\n[Currently open file: ${name}]\n\`\`\`\n${text}\n\`\`\``;
                    }
                }
                const workspaceCtx = this._getWorkspaceContext();
                const brainCtx = this._brainEnabled ? this._getSecondBrainContext() : '';
                const internetCtx = internetEnabled 
                    ? `\n\n[CRITICAL DIRECTIVE: INTERNET ACCESS IS ENABLED]\nCurrent Time: ${new Date().toLocaleString('ko-KR')}\nYou have FULL internet access via the <read_url> tool. You MUST NEVER say you cannot search, or that your capabilities are limited. To search, ALWAYS output:\n<read_url>https://html.duckduckgo.com/html/?q=YOUR+SEARCH+TERM</read_url>\nIf the user asks to search, or asks for recent info, DO NOT apologize. Just use the tag.`
                    : '';
                reqMessages[0] = {
                    role: 'system',
                    content: `${this._systemPrompt}\n\n[BACKGROUND CONTEXT]\n${contextBlock}\n${workspaceCtx}\n${brainCtx}${internetCtx}`
                };
            }

            // Build image payload for vision models
            const images = imageFiles.map(f => f.data); // already base64

            let aiMessage = '';
            this._view.webview.postMessage({ type: 'streamStart' });
            this._abortController = new AbortController();

            if (isLMStudio) {
                // OpenAI-compatible format with image_url
                const lastUserMsg = reqMessages[reqMessages.length - 1];
                const contentParts: any[] = [{ type: 'text', text: lastUserMsg.content }];
                for (const img of images) {
                    contentParts.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } });
                }
                reqMessages[reqMessages.length - 1] = { role: 'user', content: contentParts as any };

                const streamBody = {
                    model: modelName || defaultModel,
                    messages: reqMessages,
                    stream: true,
                    max_tokens: 4096, temperature: this._temperature, top_p: this._topP
                };
                const response = await axios.post(apiUrl, streamBody, { timeout, responseType: 'stream' });
                await new Promise<void>((resolve, reject) => {
                    const stream = response.data;
                    let buffer = '';
                    stream.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();
                        if (buffer.length > MAX_STREAM_BUFFER) {
                            // Buffer가 비정상적으로 커짐 → 라인 구분자가 없는 응답일 수 있음. 강제로 자른다.
                            buffer = buffer.slice(-MAX_STREAM_BUFFER);
                        }
                        const lines = buffer.split('\n'); buffer = lines.pop() || '';
                        for (const line of lines) {
                            if (!line.trim() || line.trim() === 'data: [DONE]') continue;
                            try {
                                const raw = line.startsWith('data: ') ? line.slice(6) : line;
                                const json = JSON.parse(raw);
                                let token = json.choices?.[0]?.delta?.content || '';
                                if (json.error) {
                                    token = `[API 오류] ${json.error.message || json.error}`;
                                }
                                if (token) { aiMessage += token; this._view!.webview.postMessage({ type: 'streamChunk', value: token }); }
                            } catch { /* malformed JSON line, skip */ }
                        }
                    });
                    stream.on('end', () => resolve());
                    stream.on('error', (err: any) => reject(err));
                });
            } else {
                // Ollama native format with images array
                const streamBody: any = {
                    model: modelName || defaultModel,
                    messages: reqMessages,
                    stream: true,
                    options: { num_ctx: 8192, num_predict: 2048, temperature: this._temperature, top_p: this._topP, top_k: this._topK }
                };
                // Attach images to the last user message for Ollama
                if (images.length > 0) {
                    streamBody.messages = reqMessages.map((m: any, i: number) => 
                        i === reqMessages.length - 1 ? { ...m, images } : m
                    );
                }
                const response = await axios.post(apiUrl, streamBody, { timeout, responseType: 'stream' });
                await new Promise<void>((resolve, reject) => {
                    const stream = response.data;
                    let buffer = '';
                    stream.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();
                        if (buffer.length > MAX_STREAM_BUFFER) buffer = buffer.slice(-MAX_STREAM_BUFFER);
                        const lines = buffer.split('\n'); buffer = lines.pop() || '';
                        for (const line of lines) {
                            if (!line.trim()) continue;
                            try {
                                const json = JSON.parse(line);
                                let token = json.message?.content || '';
                                if (json.error) {
                                    token = `[API 오류] ${json.error}`;
                                }
                                if (token) { aiMessage += token; this._view!.webview.postMessage({ type: 'streamChunk', value: token }); }
                            } catch { /* malformed JSON line, skip */ }
                        }
                    });
                    stream.on('end', () => resolve());
                    stream.on('error', (err: any) => reject(err));
                });
            }

            this._view.webview.postMessage({ type: 'streamEnd' });
            this._chatHistory.push({ role: 'assistant', content: aiMessage });

            const report = await this._executeActions(aiMessage);
            if (report.length > 0) {
                const reportMsg = `\n\n---\n**에이전트 작업 결과**\n${report.join('\n')}`;
                this._view.webview.postMessage({ type: 'streamChunk', value: reportMsg });
                this._view.webview.postMessage({ type: 'streamEnd' });
                aiMessage += reportMsg;
            }
            this._displayMessages.push({ text: this._stripActionTags(aiMessage), role: 'ai' });
            this._pruneHistory();
            this._saveHistory();

        } catch (error: any) {
            const { ollamaBase } = getConfig();
            const isLM = ollamaBase.includes('1234') || ollamaBase.includes('v1');
            const targetName = isLM ? "LM Studio" : "Ollama";

            let errMsg = '';
            if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
                errMsg = `⚠️ ${targetName}에 연결할 수 없어요.\n\n**확인할 점:**\n• ${targetName} 앱이 켜져 있나요? (Start Server 클릭)\n• 포트가 ${isLM ? '1234' : '11434'} 맞나요? (설정 > Ollama URL)`;
            } else if (error.response?.status === 400) {
                errMsg = `⚠️ AI가 요청을 이해하지 못했어요.\n\n**해결 방법:**\n• 헤더의 모델 선택 드롭다운에서 다른 모델을 골라보세요\n${isLM ? '• LM Studio에서 모델을 먼저 로드(Load)했는지 확인하세요' : '• 터미널에서 `ollama list`로 설치된 모델을 확인하세요'}`;
            } else if (error.response?.status === 404) {
                errMsg = `⚠️ 선택한 모델을 찾을 수 없어요.\n\n**해결 방법:**\n${isLM ? '• LM Studio에서 모델을 다운로드 후 로드(Load)하세요' : '• 터미널에서 `ollama pull 모델이름`으로 먼저 받아주세요'}`;
            } else if (error.response?.status === 413) {
                errMsg = `⚠️ 대화가 너무 길어졌어요.\n\n**해결 방법:**\n• 헤더의 + 버튼으로 새 대화를 시작하세요\n• 또는 🧠 지식 모드를 일시 OFF\n${isLM ? '• 또는 LM Studio에서 모델 로드 시 Context Length를 8192 이상으로 늘려주세요' : ''}`;
            } else if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
                errMsg = `⚠️ AI 응답이 너무 오래 걸려요.\n\n**해결 방법:**\n• 더 작은 모델로 바꿔보세요 (예: 7B → 3B)\n• 질문을 짧게 줄여보세요\n• 설정에서 Request Timeout을 늘려보세요`;
            } else {
                errMsg = `⚠️ 오류: ${error.message}`;
            }

            this._view.webview.postMessage({ type: 'error', value: errMsg });

            // Axios의 타입이 stream일 때 에러 본문을 파싱해서 원인을 명확히 로그에 남김
            if (error.response?.data?.on) {
                let buf = '';
                error.response.data.on('data', (c: any) => buf += c.toString());
                error.response.data.on('end', () => {
                    try {
                        const parsed = JSON.parse(buf);
                        if (parsed.error?.message) {
                            this._view!.webview.postMessage({ type: 'error', value: `⚠️ API 자세한 오류: ${parsed.error.message}` });
                        }
                    } catch { /* ignore parsing err */ }
                });
            }
        }
    }

    // --------------------------------------------------------
    // Handle user prompt → Ollama → agent actions → response
    // --------------------------------------------------------
    private async _handlePrompt(prompt: string, modelName: string, internetEnabled?: boolean) {
        if (!this._view) { return; }

        try {
            // 1. Context: active editor content
            const editor = vscode.window.activeTextEditor;
            let contextBlock = '';
            if (editor && editor.document.uri.scheme === 'file') {
                const text = editor.document.getText();
                const name = path.basename(editor.document.fileName);
                if (text.trim().length > 0 && text.length < MAX_CONTEXT_SIZE) {
                    contextBlock = `\n\n[Currently open file: ${name}]\n\`\`\`\n${text}\n\`\`\``;
                }
            }

            // 2. Context: workspace file tree + key file contents
            const workspaceCtx = this._getWorkspaceContext();
            
            // 2.5 Inject Second Brain Knowledge (ON/OFF 토글 반영)
            const brainCtx = this._brainEnabled ? this._getSecondBrainContext() : '';

            // 3. Push user message
            this._chatHistory.push({
                role: 'user',
                content: prompt
            });

            // 저장용: 유저 메시지 기록 (프롬프트만)
            this._displayMessages.push({ text: prompt, role: 'user' });

            // 4. Call Ollama
            const { ollamaBase, defaultModel, timeout } = getConfig();

            // 이번 요청에만 사용할 임시 메시지 배열 생성
            const reqMessages = [...this._chatHistory];
            // 시스템 프롬프트(0번 인덱스)에 현재 작업 환경 정보를 주입
            if (reqMessages.length > 0 && reqMessages[0].role === 'system') {
                const internetCtx = internetEnabled 
                    ? `\n\n[CRITICAL DIRECTIVE: INTERNET ACCESS IS ENABLED]\nCurrent Time: ${new Date().toLocaleString('ko-KR')}\nYou have FULL internet access via the <read_url> tool. You MUST NEVER say you cannot search, or that your capabilities are limited. To search, ALWAYS output:\n<read_url>https://html.duckduckgo.com/html/?q=YOUR+SEARCH+TERM</read_url>\nIf the user asks to search, or asks for recent info, DO NOT apologize. Just use the tag.`
                    : '';
                reqMessages[0] = {
                    role: 'system',
                    content: `${this._systemPrompt}\n\n[BACKGROUND CONTEXT - DO NOT EXPLAIN THIS TO THE USER UNLESS ASKED]\n${contextBlock}\n${workspaceCtx}\n${brainCtx}${internetCtx}`
                };
            }

            let isLMStudio = ollamaBase.includes('1234') || ollamaBase.includes('v1');
            let apiUrl = isLMStudio ? `${ollamaBase}/v1/chat/completions` : `${ollamaBase}/api/chat`;

            // Auto-Failover Logic: 유저가 설정을 안 건드렸더라도 Ollama가 죽어있으면 자동으로 LM Studio를 찾아갑니다!
            if (!isLMStudio) {
                try {
                    await axios.get(`${ollamaBase}/api/tags`, { timeout: 1000 });
                } catch (err: any) {
                    // Ollama 연결 실패 시 LM Studio 1234 포트로 강제 우회
                    apiUrl = 'http://127.0.0.1:1234/v1/chat/completions';
                    isLMStudio = true;
                }
            }

            // ═══ STREAMING API CALL ═══
            let aiMessage = '';

            // 스트리밍: 웹뷰에 'streamStart' 로 빈 메시지 생성 후 'streamChunk'로 실시간 업데이트
            this._view.webview.postMessage({ type: 'streamStart' });
            this._lastPrompt = prompt;
            this._lastModel = modelName;
            this._abortController = new AbortController();

            const streamBody = {
                model: modelName || defaultModel,
                messages: reqMessages,
                stream: true,
                ...(isLMStudio
                    ? { max_tokens: 4096, temperature: this._temperature, top_p: this._topP }
                    : { options: { num_ctx: 8192, num_predict: 2048, temperature: this._temperature, top_p: this._topP, top_k: this._topK } }),
            };

            // 🎬 Thinking Mode: notify graph panel that a session is starting
            if (this._shouldEmitThinking()) {
                this._postThinking({ type: 'thinking_start', prompt });
                this._postThinking({
                    type: 'context_done',
                    workspace: !!workspaceCtx,
                    brainCount: this._brainEnabled ? (brainCtx ? brainCtx.split('📄').length - 1 : 0) : 0,
                    web: !!internetEnabled
                });
            }

            const response = await axios.post(apiUrl, streamBody, {
                timeout,
                responseType: 'stream',
                signal: this._abortController.signal
            });

            // 🎬 Track which brain notes the AI mentions DURING streaming
            const seenBrainReads = new Set<string>();
            const detectBrainReadsLive = () => {
                if (!this._shouldEmitThinking()) return;
                const matches = [...aiMessage.matchAll(/<read_brain>([\s\S]*?)<\/read_brain>/g)];
                for (const m of matches) {
                    const note = m[1].trim();
                    if (note && !seenBrainReads.has(note)) {
                        seenBrainReads.add(note);
                        this._postThinking({ type: 'brain_read', note });
                    }
                }
                const fileMatches = [...aiMessage.matchAll(/<(?:read_file|create_file|edit_file)\s+path="([^"]+)"/g)];
                for (const m of fileMatches) {
                    let note = m[1].trim();
                    // Agent paths might be absolute, try to extract basename or relative path
                    if (note.includes('Company/')) {
                        note = note.split('Company/').pop() || note;
                    }
                    if (note && !seenBrainReads.has(note)) {
                        seenBrainReads.add(note);
                        this._postThinking({ type: 'brain_read', note });
                    }
                }
            };
            // 🎬 Emit answer_start exactly once when the first real answer token arrives.
            // Without this, the thinking panel sticks at "🧠 파일명 검색 중..." forever.
            let answerStartFired = false;
            const fireAnswerStart = () => {
                if (this._shouldEmitThinking() && !answerStartFired) {
                    answerStartFired = true;
                    this._postThinking({ type: 'answer_start' });
                }
            };

            await new Promise<void>((resolve, reject) => {
                const stream = response.data;
                let buffer = '';
                stream.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString();
                    if (buffer.length > MAX_STREAM_BUFFER) buffer = buffer.slice(-MAX_STREAM_BUFFER);
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.trim() || line.trim() === 'data: [DONE]') continue;
                        try {
                            const raw = line.startsWith('data: ') ? line.slice(6) : line;
                            const json = JSON.parse(raw);
                            let token = '';
                            if (json.error) {
                                token = `[API 오류] ${json.error.message || json.error}`;
                            } else if (isLMStudio) {
                                token = json.choices?.[0]?.delta?.content || '';
                            } else {
                                token = json.message?.content || '';
                            }
                            if (token) {
                                aiMessage += token;
                                this._view!.webview.postMessage({ type: 'streamChunk', value: token });
                                // 🎬 Live thinking detection — fire as soon as a tag is closed
                                detectBrainReadsLive();
                                if (this._shouldEmitThinking()) {
                                    fireAnswerStart();
                                    this._postThinking({ type: 'answer_chunk', text: token });
                                }
                            }
                        } catch { /* skip malformed JSON */ }
                    }
                });
                stream.on('end', () => resolve());
                stream.on('error', (err: any) => reject(err));
            });

            // 스트리밍 완료 알림 잠시 보류 (연속된 답변을 같은 상자에 이어서 출력하기 위함)
            
            // 4.5 자율 열람 (Second Brain 및 웹 검색): AI가 <read_brain> 또는 <read_url>을 사용했는지 확인
            const brainReads = [...aiMessage.matchAll(/<read_brain>([\s\S]*?)<\/read_brain>/g)];
            const urlReads = [...aiMessage.matchAll(/<read_url>([\s\S]*?)<\/read_url>/gi)];

            if (brainReads.length > 0 || urlReads.length > 0) {
                let fetchedContent = '';
                let uiFeedbackStr = '';
                
                // Brain 읽기 처리
                for (const match of brainReads) {
                    const requestedFile = match[1].trim();
                    const fileContent = this._readBrainFile(requestedFile);
                    fetchedContent += `\n\n[BRAIN DOCUMENT: ${requestedFile}]\n${fileContent}\n`;
                }

                // URL 읽기 처리
                for (const match of urlReads) {
                    const url = match[1].trim();
                    try {
                        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
                        let cleaned = data.toString()
                            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                        fetchedContent += `\n\n[WEB CONTENT: ${url}]\n${cleaned.slice(0, 15000)}\n`;
                        const msg = `\n\n> 🌐 **[웹 검색 완료]** ${url} (${cleaned.length}자)\n\n`;
                        uiFeedbackStr += msg;
                        this._view.webview.postMessage({ type: 'streamChunk', value: msg });
                    } catch (err: any) {
                        fetchedContent += `\n\n[WEB CONTENT: ${url}] (FAILED: ${err.message})\n`;
                        const msg = `\n\n> 🌐 **[웹 검색 실패]** ${url} - ${err.message}\n\n`;
                        uiFeedbackStr += msg;
                        this._view.webview.postMessage({ type: 'streamChunk', value: msg });
                    }
                }

                const cleanedResponse = aiMessage.replace(/<read_brain>[\s\S]*?<\/read_brain>/g, '')
                                                 .replace(/<read_url>[\s\S]*?<\/read_url>/gi, '').trim();
                
                if (brainReads.length > 0) {
                    const msg = `\n\n> 🧠 **[Second Brain 열람 완료]** 스캔한 핵심 지식을 바탕으로 답변을 구성합니다...\n\n`;
                    uiFeedbackStr += msg;
                    this._view.webview.postMessage({ type: 'streamChunk', value: msg });
                }
                
                reqMessages.push({ role: 'assistant', content: cleanedResponse || '탐색을 진행 중입니다...' });
                reqMessages.push({ role: 'user', content: `[SYSTEM: The following documents and web contents were retrieved based on your actions. Use this information to provide a complete and accurate answer to the user's original question.]\n${fetchedContent}\n\nNow answer the user's question using the above knowledge. Do NOT output <read_brain> or <read_url> again. Answer directly and comprehensively.` });

                // 2차 스트리밍 시작 (followUp)
                const followUpResponse = await axios.post(apiUrl, {
                    model: modelName || defaultModel,
                    messages: reqMessages,
                    stream: true, // 스트리밍 활성화
                    ...(isLMStudio 
                        ? { max_tokens: 4096, temperature: this._temperature, top_p: this._topP } 
                        : { options: { num_ctx: 8192, num_predict: 2048, temperature: this._temperature, top_p: this._topP, top_k: this._topK } }),
                }, { timeout, responseType: 'stream', signal: this._abortController?.signal });

                aiMessage = cleanedResponse + uiFeedbackStr;

                // 🎬 Brain phase done, real answer phase begins on the follow-up stream
                if (this._shouldEmitThinking()) {
                    this._postThinking({ type: 'answer_start' });
                }

                await new Promise<void>((resolve, reject) => {
                    const stream = followUpResponse.data;
                    let buffer = '';
                    stream.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();
                        if (buffer.length > MAX_STREAM_BUFFER) buffer = buffer.slice(-MAX_STREAM_BUFFER);
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        for (const line of lines) {
                            if (!line.trim() || line.trim() === 'data: [DONE]') continue;
                            try {
                                const raw = line.startsWith('data: ') ? line.slice(6) : line;
                                const json = JSON.parse(raw);
                                let token = '';
                                if (json.error) token = `[API 오류] ${json.error.message || json.error}`;
                                else if (isLMStudio) token = json.choices?.[0]?.delta?.content || '';
                                else token = json.message?.content || '';

                                if (token) {
                                    aiMessage += token;
                                    this._view!.webview.postMessage({ type: 'streamChunk', value: token });
                                    if (this._shouldEmitThinking()) {
                                        this._postThinking({ type: 'answer_chunk', text: token });
                                    }
                                }
                            } catch { /* skip */ }
                        }
                    });
                    stream.on('end', () => resolve());
                    stream.on('error', (err: any) => reject(err));
                });
            }

            // 모든 스트리밍(1차 및 2차)이 끝난 후, 박스 포장 완료
            this._view.webview.postMessage({ type: 'streamEnd' });

            this._chatHistory.push({ role: 'assistant', content: aiMessage });

            // 5. Execute agent actions
            const report = await this._executeActions(aiMessage);

            // 6. Agent report 추가 (있을 때만)
            if (report.length > 0) {
                const reportMsg = `\n\n---\n**에이전트 작업 결과**\n${report.join('\n')}`;
                this._view.webview.postMessage({ type: 'streamChunk', value: reportMsg });
                this._view.webview.postMessage({ type: 'streamEnd' });
                aiMessage += reportMsg;
            }

            // 저장용: AI 응답 기록
            this._displayMessages.push({ text: this._stripActionTags(aiMessage), role: 'ai' });

            // 📚 Citation badges + 🎬 final source highlight
            const allBrainReads = [...aiMessage.matchAll(/<read_brain>([\s\S]*?)<\/read_brain>/g)]
                .map(m => m[1].trim()).filter(s => s.length > 0);
            const uniqueSources = [...new Set(allBrainReads)];
            if (uniqueSources.length > 0) {
                this._view.webview.postMessage({ type: 'attachCitations', sources: uniqueSources });
            }
            if (this._shouldEmitThinking()) {
                this._postThinking({ type: 'answer_complete', sources: uniqueSources });
            }

            this._pruneHistory();
            this._saveHistory();

        } catch (error: any) {
            const { ollamaBase } = getConfig();
            const isLM = ollamaBase.includes('1234') || ollamaBase.includes('v1');
            const targetName = isLM ? "LM Studio" : "Ollama";
            
            let errMsg: string;
            if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
                errMsg = `⚠️ ${targetName}에 연결할 수 없어요.\n앱이 켜져 있고 Start Server가 눌러져 있는지 확인해주세요.`;
            } else if (error.response?.status === 413) {
                errMsg = `⚠️ 대화가 너무 길어졌어요.\n• 헤더의 + 버튼으로 새 대화를 시작하세요\n${isLM ? '• 또는 LM Studio에서 모델 로드 시 Context Length를 8192 이상으로 늘려주세요' : ''}`;
            } else if (error.response?.status === 400) {
                errMsg = `⚠️ AI가 요청을 이해하지 못했어요. 다른 모델을 선택해보거나, 질문을 짧게 줄여보세요.`;
            } else {
                errMsg = `⚠️ 오류: ${error.message}`;
            }
            
            this._view.webview.postMessage({ type: 'error', value: errMsg });

            /* If this prompt came from Telegram, surface the failure there too —
               the user should never be left wondering why their bot went silent. */
            if (this._telegramMirrorPending) {
                sendTelegramReport(`⚠️ *AI 응답 실패*\n\n${errMsg.slice(0, 800)}`).catch(() => { /* silent */ });
                this._telegramMirrorPending = false;
            }

            // 파싱된 실제 에러 표출 (LM Studio / Ollama Stream HTTP 에러)
            if (error.response?.data?.on) {
                let buf = '';
                error.response.data.on('data', (c: any) => buf += c.toString());
                error.response.data.on('end', () => {
                    try {
                        const parsed = JSON.parse(buf);
                        let detail = parsed.error?.message || parsed.error || '';
                        if (detail.includes('greater than the context length')) {
                            detail = '프로젝트 정보가 모델의 기억 용량(Context Length)을 초과했어요.\n💡 LM Studio에서 모델을 다시 로드할 때, 오른쪽 패널의 [Context Length] 슬라이더를 8192 이상으로 올려주세요.';
                        }
                        if (detail) {
                            this._view!.webview.postMessage({ type: 'error', value: `💡 가이드: ${detail}` });
                        }
                    } catch { /* ignore */ }
                });
            }
        } finally {
            /* If this prompt came from Telegram, mirror the AI response back. */
            this._maybeMirrorToTelegram().catch(() => { /* silent */ });
        }
    }

    /* v2.89.37 — 3단계 fallback. 사용자가 "내 유튜브 채널 분석" 같은 명백한 단일 도구
       요청을 했을 때, LLM 분류기만 의존하면 작은 모델이 `{}` 뱉어서 CEO 플래너로 폴백
       → CEO가 4명 동원해서 Designer가 무관한 시각 시스템 보고서 출력. 사용자 박살.

       이제 흐름:
         1) 패턴 매칭 (deterministic, 절대 실패 X) — 명백한 키워드면 즉시 도구 실행
         2) LLM 분류기 — 변형된 표현 ("subscriber 어때?", "내 유튜브 어떻게 됐냐") 캐치
         3) CEO 플래너 — 진짜 다중 에이전트 작업 ("영상 기획해줘", "썸네일 만들어")

       1·2 단계가 도구를 찾으면 그 도구만 실행하고 multi-agent 분배 전부 스킵. */
    private async _tryDataShortcut(prompt: string, sessionDir: string): Promise<boolean> {
        const p = (prompt || '').trim();
        if (!p) return false;

        /* 도구 카탈로그 (활성화된 것만, 두 단계가 공유) */
        const _BUILTIN_TOOLS = new Set(['google_calendar_write', 'google_calendar']);
        type CatalogEntry = { agentId: string; tool: string; description: string; scriptPath: string };
        const catalog: CatalogEntry[] = [];
        for (const aid of SPECIALIST_IDS) {
            try {
                const tools = listAgentTools(aid).filter(t => t.enabled && !_BUILTIN_TOOLS.has(t.name));
                for (const t of tools) {
                    /* v2.89.46 — listAgentTools가 t.name에서 .py 빼고 반환 ('my_videos_check').
                       카탈로그에는 실행 가능한 파일명 형태로 저장 ('my_videos_check.py') —
                       패턴의 tool 필드와 매칭 일관성 + python3 실행 시 그대로 인자 사용 가능. */
                    catalog.push({
                        agentId: aid,
                        tool: t.name + '.py',
                        description: (t.description || '').replace(/\n/g, ' ').slice(0, 120),
                        scriptPath: t.scriptPath,
                    });
                }
            } catch { /* skip agent on error */ }
        }
        if (catalog.length === 0) return false;

        /* === 1단계: 도메인 키워드 + 비창작 의도 매칭 (v2.89.48) ===
           이전엔 빡빡한 정규식이라 "유튜브붆석해" 같은 오타나 "유튜브 어때" 같은 변형을
           못 잡고 CEO 플래너로 떨어뜨림. 새 접근:
           - 도메인 키워드 (유튜브/채널/구독자/조회수 등) 등장 = YouTube 도구 후보
           - 사용자가 명백한 창작 동사 (만들/기획/디자인/스크립트 써)를 안 쓰면 = 분석 의도
           - 즉, 키워드 + 비창작 → my_videos_check.py 즉시 실행
           오타·변형·축약 다 흡수. 창작 명령은 CEO 플래너로 정상 라우팅. */
        type DomainShortcut = {
            agentId: string;
            tool: string;
            domainPattern: RegExp;
        };
        const domainShortcuts: DomainShortcut[] = [
            {
                agentId: 'youtube',
                tool: 'my_videos_check.py',
                domainPattern: /(?:유튜브|youtube|채널|구독자|조회수|시청자|시청\s*시간|내\s*영상|내\s*비디오|video\s*count|subscriber)/i,
            },
        ];
        /* 창작·기획 동사 — 이게 있으면 분석이 아니라 multi-agent 작업 (CEO 플래너로) */
        const creativePattern = /(?:만들|기획|디자인|썸네일\s*제작|썸네일\s*만들|스크립트\s*써|글\s*써|작성해|코딩|개발|제작|design|create|build|make|write|generate|plan)/i;
        const isCreative = creativePattern.test(p);
        const lower = p.toLowerCase();
        const domainMatch = !isCreative && domainShortcuts.find(d =>
            d.domainPattern.test(lower) &&
            catalog.some(c => c.agentId === d.agentId && c.tool === d.tool)
        );
        if (domainMatch) {
            const entry = catalog.find(c => c.agentId === domainMatch.agentId && c.tool === domainMatch.tool)!;
            return await this._runShortcutTool(entry, prompt, sessionDir, '키워드');
        }

        /* === 2단계: LLM 분류기 ===
           패턴이 못 잡은 변형 표현을 LLM이 의미로 해석. 짧은 프롬프트라 작은 모델도
           대체로 잘 따름. 실패 시 그냥 false → CEO 플래너로. */
        const classifierPrompt = `당신은 사용자 명령에 가장 잘 맞는 도구를 1개 고르는 분류기입니다.

[사용 가능한 도구]
${catalog.map((c, i) => `${i + 1}. agent=${c.agentId} tool=${c.tool} — ${c.description}`).join('\n')}

[규칙]
- 사용자 명령이 위 도구 중 1개와 명확히 매칭되면 \`{"agent": "...", "tool": "..."}\` 출력
- 매칭 안 되거나 애매·일반 작업(콘텐츠 제작·디자인·코딩 등)이면 \`{}\` 출력
- agent/tool 이름은 위 목록에서 정확히 복사 (스펠링 변형 금지)
- ⚠️ JSON 외 텍스트(설명·펜스·머리말) 절대 금지`;

        const { defaultModel } = getConfig();
        const classifierModel = getAgentModel('ceo', '') || defaultModel || '';
        let classifyRaw = '';
        try {
            classifyRaw = await this._callAgentLLM(
                classifierPrompt,
                `[사용자 명령]\n${p}`,
                classifierModel,
                'ceo',
                false,
            );
        } catch {
            return false; /* LLM 실패 → CEO 플래너 */
        }

        let parsed: { agent?: string; tool?: string } | null = null;
        try {
            const m = classifyRaw.match(/\{[\s\S]*?\}/);
            parsed = m ? JSON.parse(m[0]) : null;
        } catch { parsed = null; }
        if (!parsed || !parsed.agent || !parsed.tool) return false;

        const llmEntry = catalog.find(c => c.agentId === parsed!.agent && c.tool === parsed!.tool);
        if (!llmEntry) return false;

        return await this._runShortcutTool(llmEntry, prompt, sessionDir, '분류기');
    }

    /* 도구 1개를 직접 실행하고 결과를 채팅창에 출력. multi-agent 분배·CEO 보고서 다 스킵.
       source 인자는 어떤 단계에서 매칭됐는지 사용자에게 보여주기 위함 ('패턴' or '분류기'). */
    private async _runShortcutTool(
        entry: { agentId: string; tool: string; scriptPath: string },
        prompt: string,
        sessionDir: string,
        source: string,
    ): Promise<boolean> {
        const post = (m: any) => this._broadcastCorporate(m);
        const a = AGENTS[entry.agentId];
        const toolsDir = path.dirname(entry.scriptPath);

        /* === 1단계: 도구 실행 (데이터 수집) === */
        post({ type: 'agentStart', agent: entry.agentId, task: `${entry.tool} 데이터 수집` });
        post({ type: 'response', value: `🔧 ${a.emoji} ${a.name}: \`${entry.tool}\` 실행 중...` });
        let r: { exitCode: number; output: string; timedOut: boolean };
        try {
            /* v2.89.50 — stdout만 캡쳐. stderr (진행 메시지·DeprecationWarning) 채팅에 안 끼게. */
            r = await runCommandCaptured(`python3 ${JSON.stringify(entry.tool)}`, toolsDir, () => {}, 90000, 'stdout');
        } catch (e: any) {
            post({ type: 'agentEnd', agent: entry.agentId });
            post({ type: 'error', value: `⚠️ 도구 실행 에러: ${e?.message || e}` });
            return true;
        }
        post({ type: 'agentEnd', agent: entry.agentId });

        const toolOut = (r.output || '').trim();
        const toolOk = r.exitCode === 0 && toolOut.length > 0;
        const toolStatus = r.timedOut ? '⏱️ 90초 초과' : (toolOk ? '✅' : `❌ exit ${r.exitCode}`);

        if (!toolOk) {
            const body = `${a.emoji} **${a.name}** — \`${entry.tool}\` 실행 실패\n\n\`\`\`\n${toolOut || '(출력 없음)'}\n\`\`\`\n\n_${toolStatus}_\n\n💡 흔한 원인: API 키 미설정, python3·필수 패키지 미설치`;
            this._displayMessages.push({ text: body, role: 'ai' });
            post({ type: 'response', value: body });
            appendConversationLog({ speaker: a.name, emoji: a.emoji, section: `도구 실행 (${source})`, body: `${entry.tool} 실패: ${toolOut.slice(0, 500)}` });
            return true;
        }

        /* "분석" 의도가 명시적이지 않으면 (예: "내 채널 데이터 보여줘") LLM 분석 스킵하고
           원본 데이터만. 의도 단어 있으면 (분석/어때/평가/검토 등) 2단계 LLM chain 발동. */
        const wantsAnalysis = /(분석|어때|어떻게|평가|검토|좋|안\s*좋|개선|문제|왜|뭐\s*해야|추천|제안|전략|review|analyze|assess|evaluate)/i.test(prompt);
        if (!wantsAnalysis) {
            const body = `${a.emoji} **${a.name}** — \`${entry.tool}\` 결과\n\n\`\`\`\n${toolOut.slice(0, 6000)}\n\`\`\`\n\n_${toolStatus} · 데이터만 출력했습니다. 분석이 필요하면 "분석해줘"·"어때"·"평가해줘" 같이 분석 동사를 붙여주세요._`;
            this._displayMessages.push({ text: body, role: 'ai' });
            post({ type: 'response', value: body });
            appendConversationLog({ speaker: a.name, emoji: a.emoji, section: `도구 실행 (${source}, 데이터만)`, body: `${entry.tool} 완료\n\n${toolOut.slice(0, 2000)}` });
            try { fs.writeFileSync(path.join(sessionDir, '_shortcut.md'), `# ${entry.tool} (${source})\n\n명령: ${prompt}\n\n${body}\n`); } catch { /* ignore */ }
            return true;
        }

        /* === 2단계: Specialist 에이전트가 전문가로서 자가 분석 ===
           이 에이전트가 그 도메인 전문가 (YouTube agent = 채널 분석가). 도구가 가져온 raw
           데이터를 받아서 전문가 시각으로 깊이 해석. 청중·트렌드·콘텐츠 전략 관점에서 평가. */
        const { defaultModel } = getConfig();
        const agentModel = getAgentModel(entry.agentId, '') || defaultModel || '';
        const specialistSysPrompt = `${buildSpecialistPrompt(entry.agentId)}` +
            `\n\n[방금 시스템이 가져온 실제 데이터 — 이게 분석 근거]\n${toolOut.slice(0, 8000)}` +
            `\n\n${readAgentSharedContext(entry.agentId, { lean: true })}` +
            `\n\n[전문가 자가 분석 지침 — 반드시 따를 것]\n` +
            `당신은 ${a.name} (${a.role}) 입니다. 위 [실제 데이터]를 보고 **그 분야 전문가로서** 깊이 있게 분석하세요.\n` +
            `1. **현재 상태 진단** — 데이터의 숫자·패턴이 의미하는 바 (단순 나열 X, 해석)\n` +
            `2. **잘 된 것** — 무엇이·왜 잘 됐나 (구체적 영상·숫자 인용)\n` +
            `3. **문제점** — 무엇이·왜 부진한가 (추측이 아니라 데이터 근거)\n` +
            `4. **청중 인사이트** — 인기 댓글에서 보이는 시청자 관심사·니즈\n` +
            `5. **30일 액션 플랜** — 우선순위 순 3~5개, 각각 "왜 이걸 해야 하는지" 데이터 근거 명시\n` +
            `\n⚠️ 데이터에 없는 숫자·사실 절대 만들어내지 마세요. "Deep Blue/Neon Cyan" 같은 과거 컨셉을 끌어와 끼워넣지 마세요. 오직 위 [실제 데이터]만 근거.`;
        post({ type: 'agentStart', agent: entry.agentId, task: '전문가 자가 분석' });
        post({ type: 'response', value: `🧠 ${a.emoji} ${a.name}: 데이터 보고 전문가 분석 중...` });
        let specialistAnalysis = '';
        let specialistError = '';
        try {
            specialistAnalysis = await this._callAgentLLM(
                specialistSysPrompt,
                `[사용자 명령]\n${prompt}\n\n위 데이터에 대한 ${a.name} (${a.role}) 시각의 전문가 분석을 작성하세요.`,
                agentModel,
                entry.agentId,
                true,
            );
        } catch (e: any) {
            specialistError = e?.message || String(e);
            specialistAnalysis = '';
        }
        post({ type: 'agentEnd', agent: entry.agentId });

        /* v2.89.47 — 빈 답 감지. 작은 모델·메모리 부족 시 LLM이 빈 string 반환하는데
           이전엔 그대로 CEO한테 넘겨서 "분석 결과를 제공해주시면..." 헛소리 출력. */
        const specialistContent = (specialistAnalysis || '').trim();
        const specialistOk = specialistContent.length > 50 && !/^⚠️/.test(specialistContent);

        /* === 3단계: CEO 종합 요약 ===
           Specialist 분석이 의미 있을 때만 CEO 호출. 빈 답이면 CEO 스킵 → 명시적 실패 보고. */
        let ceoSummary = '';
        if (specialistOk) {
            post({ type: 'agentStart', agent: 'ceo', task: '종합 요약' });
            post({ type: 'response', value: `👔 CEO: 사장님께 올릴 종합 정리 중...` });
            const ceoModel = getAgentModel('ceo', '') || defaultModel || '';
            const ceoSysPrompt = `${_personalizePrompt(CEO_REPORT_PROMPT)}\n${readAgentSharedContext('ceo', { lean: true })}`;
            const ceoUserMsg = `[사장님 명령]\n${prompt}\n\n[${a.emoji} ${a.name} 전문가 분석]\n${specialistContent.slice(0, 6000)}\n\n위 ${a.name}의 분석을 사장님이 30초에 파악할 수 있게 종합 요약하세요. ${a.name}의 결론과 액션을 충실히 반영하되, 너무 길지 않게.\n\n⚠️ "분석 결과를 제공해주시면", "데이터가 들어오면" 같은 placeholder 절대 금지 — 위 분석은 이미 제공됐음.`;
            try {
                ceoSummary = await this._callAgentLLM(ceoSysPrompt, ceoUserMsg, ceoModel, 'ceo', false);
                /* CEO도 placeholder 뱉으면 무시 → specialist 분석만 보임 */
                if (/분석\s*결과를\s*제공|데이터가\s*제공|데이터가\s*들어오면|once\s+the\s+output|when\s+the\s+output/i.test(ceoSummary)) {
                    ceoSummary = '';
                }
            } catch { ceoSummary = ''; }
            post({ type: 'agentEnd', agent: 'ceo' });
        }

        /* === 출력 조합 (v2.89.48 — 스크립트 분석을 항상 주답으로) ===
           이전엔 LLM 실패 시 "분석 실패"라고만 표시 + 데이터를 collapsible로 숨김. 그런데
           pro_v1 스크립트는 이미 (1) 채널 메타 (2) 영상별 표 (3) 상위 영상 + 인기 댓글
           (4) 패턴 분석 (5) 우선순위 액션 추천 까지 다 출력하는 진짜 분석. 즉 LLM이 죽어도
           쓸만한 분석은 이미 손에 있음. 이걸 항상 펼쳐서 주답으로, LLM 분석은 "추가 인사이트"로. */
        /* v2.89.49 — 출력 정리. 이전엔 ![alt](url) 마크다운 이미지가 채팅 sidebar의
           markdown renderer에서 안 렌더되고 "!alt"로 깨져 보였음. 아바타 이미지 markdown
           제거하고 이모지·이름만으로 헤더. 데이터 분석은 stdout 그대로 (이미 markdown 정렬). */
        const sections: string[] = [];
        if (ceoSummary && ceoSummary.trim()) {
            sections.push(`## 👔 CEO 종합\n\n${ceoSummary.trim()}`);
        }
        /* 스크립트 분석은 자체적으로 # 🎬 헤딩으로 시작하므로 추가 헤딩 없이 그대로 삽입 */
        sections.push(toolOut.slice(0, 12000).trim());
        /* LLM 자가 분석은 추가 레이어 — 성공 시 더 깊은 인사이트, 실패 시 짧게 안내만 */
        if (specialistOk) {
            sections.push(`---\n\n## 🧠 ${a.emoji} ${a.name} 추가 인사이트\n\n${specialistContent}`);
        } else if (specialistError) {
            sections.push(`---\n\n> ⚠️ LLM 추가 인사이트 단계 스킵: \`${specialistError.slice(0, 200)}\`\n> 💡 모델 오케스트레이션 모달 → ${a.name} 모델을 더 작은 것으로 변경하면 다음번엔 인사이트도 같이 옵니다. 위 데이터 분석은 LLM 없이 정상 집계된 결과예요.`);
        }
        const body = sections.join('\n\n');

        this._displayMessages.push({ text: body, role: 'ai' });
        post({ type: 'response', value: body });
        appendConversationLog({
            speaker: a.name, emoji: a.emoji,
            section: `전문가 분석 chain (${source})`,
            body: `Tool: ${entry.tool}\n\n${a.name} 분석:\n${specialistAnalysis.slice(0, 1500)}\n\nCEO 요약:\n${ceoSummary.slice(0, 800)}`,
        });
        try {
            fs.writeFileSync(path.join(sessionDir, '_shortcut.md'), `# ${entry.tool} (${source}, 전문가 분석 chain)\n\n명령: ${prompt}\n\n${body}\n`);
        } catch { /* ignore */ }
        return true;
    }

    // --------------------------------------------------------
    // 1인 기업 모드 — Multi-Agent Orchestration
    // --------------------------------------------------------
    // CEO 에이전트가 사용자 한 줄 명령을 받아 작업을 분해하고,
    // 전문 에이전트들에게 순차로 일을 분배합니다. 각 에이전트는
    // 공동 목표·정체성·자기 메모리를 매번 읽고 작업합니다.
    // --------------------------------------------------------
    private async _handleCorporatePrompt(prompt: string, modelName: string) {
        /* v2.88.4 — 이전 가드 `if (!this._view && this._corporateBroadcastTargets.size === 0) return;`
           는 사이드바도 안 열려있고 사무실 패널도 없으면 즉시 return해서, 텔레그램에서
           디스패치 명령이 와도 아무것도 실행 안 했음. UI 업데이트는 실패해도 OK
           (텔레그램이 출구) — 디스패치 자체는 무조건 실행되어야 함. */
        const post = (m: any) => this._broadcastCorporate(m);
        // Single abort controller drives every LLM call in this session — sidebar
        // stop button calls _abortController.abort() which propagates through.
        this._abortController = new AbortController();
        const isAborted = () => !!this._abortController?.signal.aborted;
        try {
            ensureCompanyStructure();
            const sessionDir = makeSessionDir();
            const sessionDisplay = sessionDir.replace(os.homedir(), '~');

            this._displayMessages.push({ text: prompt, role: 'user' });

            // Phase 1: log the user command at the top of every session
            appendConversationLog({ speaker: '사용자', emoji: '👤', body: prompt });

            // Bridge mode 'full' — Secretary is the single front door. Triage
            // the message: either Secretary handles it directly (greeting,
            // schedule lookup) or escalates to CEO. This puts sidebar in the
            // same shape as Telegram so all user input flows through one
            // consistent entry. Educational toggle — see readSecretaryBridgeMode.
            const bridgeMode = readSecretaryBridgeMode();
            if (bridgeMode === 'full') {
                post({ type: 'agentStart', agent: 'secretary', task: '브릿지 분류' });
                let triageRaw = '';
                try {
                    triageRaw = await this._callAgentLLM(
                        `${SECRETARY_TRIAGE_PROMPT}\n${readAgentSharedContext('secretary')}${readRecentConversations(800)}`,
                        prompt,
                        modelName,
                        'secretary',
                        false
                    );
                } catch (e: any) {
                    /* Bridge fail-open — if Secretary triage errors we fall
                       through to the normal CEO planner so the user isn't
                       blocked. Log the error in conversation log for visibility. */
                    appendConversationLog({ speaker: '비서', emoji: '⚠️', body: `브릿지 분류 실패 → CEO로 직행: ${e?.message || e}` });
                }
                post({ type: 'agentEnd', agent: 'secretary' });
                let triage: { mode?: string; text?: string } | null = null;
                try {
                    const m = triageRaw.match(/\{[\s\S]*\}/);
                    triage = m ? JSON.parse(m[0]) : null;
                } catch { triage = null; }
                if (triage && triage.mode === 'reply') {
                    const text = (triage.text || '').trim() || '네, 사장님. 더 자세히 말씀해 주세요.';
                    this._displayMessages.push({ text: `📱 비서: ${text}`, role: 'ai' });
                    appendConversationLog({ speaker: '비서', emoji: '📱', section: '브릿지(직접 응답)', body: text });
                    try { await this._maybeMirrorToTelegram(); } catch { /* ignore */ }
                    return;
                }
                /* triage.mode === 'dispatch' or parse failure → continue to
                   CEO planner. Optional ack so user knows Secretary saw it. */
                appendConversationLog({ speaker: '비서', emoji: '📱', section: '브릿지(CEO에게 위임)', body: '작업이라 CEO에게 분배 요청' });
            }

            // Casual-chat fast path — short greetings like "안녕" must NOT enter
            // the JSON planner. Small models reply with a friendly greeting
            // (no JSON), parsing fails, user sees a confusing context-length
            // error even after they've already widened the context. Detect
            // and route casual turns to a plain conversational CEO reply.
            // Skipped in bridge='full' since Secretary already triaged above.
            if (bridgeMode !== 'full' && _isCasualChat(prompt)) {
                post({ type: 'agentStart', agent: 'ceo', task: '인사' });
                let chatReply = '';
                try {
                    chatReply = await this._callAgentLLM(
                        `${_personalizePrompt(CEO_CHAT_PROMPT)}\n${readAgentSharedContext('ceo')}${readRecentConversations(800)}`,
                        prompt,
                        modelName,
                        'ceo',
                        true
                    );
                } catch (e: any) {
                    post({ type: 'agentEnd', agent: 'ceo' });
                    post({ type: 'error', value: `⚠️ CEO 응답 실패: ${e?.message || e}` });
                    return;
                }
                post({ type: 'agentEnd', agent: 'ceo' });
                const text = (chatReply || '').trim() || '안녕하세요, 사장님. 무엇을 도와드릴까요?';
                this._displayMessages.push({ text, role: 'ai' });
                appendConversationLog({ speaker: 'CEO', emoji: '👔', body: text });
                try { await this._maybeMirrorToTelegram(); } catch { /* ignore */ }
                return;
            }

            /* v2.89.40 — 단축회로. 도구 1개로 답이 나오는 명령(예: "내 유튜브 채널 분석")은
               여기서 도구 직접 실행하고 종료. 매칭 실패 시 일반 multi-agent 흐름으로 떨어짐 —
               CEO 플래너 프롬프트의 "단일 에이전트 우선" 규칙 + 환각 가드 + 스트림 타임아웃이
               헛소리·hang을 막음. v2.89.38의 "info면 무조건 차단" 로직은 너무 과했어서 제거. */
            const shortcut = await this._tryDataShortcut(prompt, sessionDir);
            if (shortcut) {
                try { await this._maybeMirrorToTelegram(); } catch { /* ignore */ }
                return;
            }

            // 1) CEO에게 작업 분해 요청 (silent — UI에는 카드 펄스만)
            // Phase 2: inject recent conversation history into CEO context so
            // planning is aware of what the company has been doing.
            post({ type: 'agentStart', agent: 'ceo', task: '작업 분해' });
            _updateActiveDispatchStep(prompt, 'CEO 계획 수립 중');
            let planRaw = '';
            try {
                planRaw = await this._callAgentLLM(
                    `${_personalizePrompt(CEO_PLANNER_PROMPT)}\n${readAgentSharedContext('ceo')}${readRecentConversations(2000)}`,
                    `[사용자 명령]\n${prompt}`,
                    modelName,
                    'ceo',
                    false
                );
            } catch (e: any) {
                post({ type: 'agentEnd', agent: 'ceo' });
                // Pull server-side error detail out of the axios stream response so
                // 500s don't surface as the bare "Request failed with status code 500".
                let detail = '';
                try {
                    if (e?.response?.data?.on) {
                        const buf = await new Promise<string>((resolve) => {
                            let acc = '';
                            e.response.data.on('data', (c: Buffer) => { acc += c.toString(); });
                            e.response.data.on('end', () => resolve(acc));
                            e.response.data.on('error', () => resolve(acc));
                        });
                        try { detail = JSON.parse(buf).error?.message || JSON.parse(buf).error || buf.slice(0, 300); }
                        catch { detail = buf.slice(0, 300); }
                    } else if (e?.response?.data) {
                        detail = typeof e.response.data === 'string' ? e.response.data.slice(0, 300) : JSON.stringify(e.response.data).slice(0, 300);
                    }
                } catch { /* ignore */ }
                let hint = '';
                if (/context length|context_length|num_ctx|maximum context/i.test(detail)) {
                    hint = '\n💡 컨텍스트 초과 — 더 큰 모델로 바꾸거나 회사 폴더의 _shared/decisions.md / _agents/ceo/memory.md를 줄여주세요.';
                } else if (/out of memory|cuda|allocation|vram/i.test(detail)) {
                    hint = '\n💡 메모리 부족 — 작은 모델 사용 또는 다른 무거운 앱 종료 후 재시도.';
                } else if (/model failed to load|failed to load model|resource limitations/i.test(detail)) {
                    hint = '\n💡 모델 로드 실패 — 가장 흔한 원인부터 시도:'
                         + '\n  ⚡ LM Studio 사용자라면: ⋯(더보기) → ⚙️ 설정 → "AI 엔진 변경" → LM Studio 선택'
                         + '\n     (지금 Ollama 쪽으로 호출되고 있어서 LM Studio 모델을 못 찾는 상태일 수 있어요)'
                         + '\n  1) 더 작은 모델로 변경 (예: gemma2:2b, llama3.2:1b, qwen2.5:1.5b)'
                         + '\n  2) Ollama 재시작 (`pkill ollama && ollama serve`) 후 재시도'
                         + '\n  3) 모델 다시 받기 (`ollama pull <모델명>`) — 다운로드가 깨졌을 수 있어요'
                         + '\n  4) 다른 무거운 앱(브라우저 탭/도커/IDE) 종료해서 RAM 확보';
                } else if (e?.code === 'ECONNREFUSED') {
                    hint = '\n💡 LLM 서버에 연결 못함 — Ollama/LM Studio가 켜져 있는지 확인.'
                         + '\n  ⋯(더보기) → ⚙️ 설정 → "AI 엔진 변경"에서 사용 중인 엔진 선택.';
                }
                post({ type: 'error', value: `⚠️ CEO 호출 실패: ${e.message}${detail ? '\n원인: ' + detail : ''}${hint}` });
                return;
            }
            post({ type: 'agentEnd', agent: 'ceo' });

            // 2) JSON 파싱 (관대하게)
            let plan: { brief: string; tasks: { agent: string; task: string }[] } | null = null;
            try {
                const m = planRaw.match(/\{[\s\S]*\}/);
                plan = JSON.parse(m ? m[0] : planRaw);
            } catch {
                plan = null;
            }
            if (!plan || !Array.isArray(plan.tasks) || plan.tasks.length === 0) {
                /* Most common cause: LM Studio's default 4096-token context
                   gets exceeded by the company prompt (goals + decisions +
                   memory + brain knowledge), so the model truncates output
                   mid-JSON. Detect heuristically — short raw / unbalanced
                   braces / no JSON at all → context-length hint first. */
                const openBraces = (planRaw.match(/\{/g) || []).length;
                const closeBraces = (planRaw.match(/\}/g) || []).length;
                const looksTruncated = openBraces > closeBraces || planRaw.length < 50 || !/\{/.test(planRaw);
                let hint = '';
                if (looksTruncated) {
                    hint = '\n\n💡 가장 흔한 원인 — LM Studio 컨텍스트 한도 초과:'
                         + '\n  1) LM Studio → 모델 로드 화면에서 **Context Length** 슬라이더를 8192 이상으로 (기본 4096은 회사 프롬프트엔 너무 작음)'
                         + '\n  2) 모델 다시 로드 후 재시도'
                         + '\n  3) 그래도 안 되면 회사 폴더 _shared/decisions.md / _agents/ceo/memory.md 길이 줄이기';
                } else {
                    hint = '\n\n💡 모델이 JSON 형식 지시를 못 따랐어요:'
                         + '\n  1) 더 큰 모델로 변경 (3B 이상 권장 — 1B 모델은 JSON 출력 자주 실패)'
                         + '\n  2) LM Studio 사용 시 Context Length 8192 이상으로 늘려보세요';
                }
                post({
                    type: 'error',
                    value: `⚠️ CEO가 작업 분배 계획(JSON)을 생성하지 못했어요.${hint}\n\n원본 응답:\n${planRaw.slice(0, 400)}`
                });
                return;
            }
            // 유효한 에이전트만 필터 — 모델이 케이스/공백/한글명을 섞어 보낼 수 있으니
            // 관대하게 매칭. 영문 id 정확매칭 → 소문자/trim → 한글이름·영문이름 부분일치 순.
            const idLookup = new Map<string, string>();
            for (const id of SPECIALIST_IDS) {
                idLookup.set(id, id);
                idLookup.set(id.toLowerCase(), id);
                const a = AGENTS[id];
                if (a) {
                    idLookup.set(a.name.toLowerCase(), id);
                    idLookup.set(a.name, id);
                }
            }
            const koreanAlias: Record<string, string> = {
                '유튜브': 'youtube', '인스타': 'instagram', '인스타그램': 'instagram',
                '디자이너': 'designer', '디자인': 'designer',
                '개발자': 'developer', '개발': 'developer',
                '비즈니스': 'business', '경영': 'business',
                '비서': 'secretary', '비서관': 'secretary',
                '편집자': 'editor', '편집': 'editor',
                '작가': 'writer', '카피라이터': 'writer',
                '리서처': 'researcher', '연구원': 'researcher', '리서치': 'researcher',
            };
            const originalTasks = [...plan.tasks];
            plan.tasks = plan.tasks
                .map(t => {
                    const raw = String(t.agent || '').trim();
                    const direct = idLookup.get(raw) || idLookup.get(raw.toLowerCase());
                    if (direct) return { ...t, agent: direct };
                    if (koreanAlias[raw]) return { ...t, agent: koreanAlias[raw] };
                    // partial: any specialist id that appears as substring
                    const lower = raw.toLowerCase();
                    const hit = SPECIALIST_IDS.find(id => lower.includes(id));
                    if (hit) return { ...t, agent: hit };
                    return null;
                })
                .filter((t): t is { agent: string; task: string } => !!t);
            if (plan.tasks.length === 0) {
                const wantedIds = originalTasks.map(t => `"${t.agent}"`).join(', ');
                post({
                    type: 'error',
                    value: `⚠️ CEO가 호출한 에이전트(${wantedIds || '없음'})가 우리 팀에 없어요.\n사용 가능한 id: ${SPECIALIST_IDS.join(', ')}\n\nCEO 원본 응답 일부:\n${(planRaw || '').slice(0, 300)}`
                });
                return;
            }

            // brief 저장
            try {
                fs.writeFileSync(
                    path.join(sessionDir, '_brief.md'),
                    `# 📋 작업 브리프\n\n**원 명령:** ${prompt}\n\n## 요약\n${plan.brief}\n\n## 분배\n${plan.tasks.map(t => `- **${AGENTS[t.agent]?.emoji} ${AGENTS[t.agent]?.name}**: ${t.task}`).join('\n')}\n`
                );
            } catch { /* ignore */ }

            // 3) 시네마틱 분배 알림
            post({
                type: 'agentDispatch',
                brief: plan.brief,
                tasks: plan.tasks.map(t => ({ agent: t.agent, task: t.task })),
                userPrompt: prompt
            });

            // Phase 1: log CEO's brief + assignment
            appendConversationLog({
                speaker: 'CEO', emoji: '🧭', section: '작업 분배',
                body: `${plan.brief}\n\n**할당:**\n${plan.tasks.map(t => `- ${AGENTS[t.agent]?.emoji || '🤖'} **${AGENTS[t.agent]?.name || t.agent}**: ${t.task}`).join('\n')}`,
            });

            // 4) 각 specialist 순차 호출
            const outputs: Record<string, string> = {};
            /* v2.89.51 — 작업 라운드 메타데이터 추적. 어떤 도구를 썼고, 어떤 데이터를
               받았고, 핵심 산출이 뭔지를 CEO 보고에 포함시켜 사용자가 한눈에 파악. */
            const agentMeta: Record<string, {
                task: string;
                toolsUsed: string[];           // 실행한 Python 도구 목록
                prefetchSummary: string;       // prefetch가 가져온 데이터 요약 (1줄)
                outputSummary: string;          // 산출물 첫 줄·평가
                outputLength: number;
            }> = {};
            for (const t of plan.tasks) {
                if (isAborted()) {
                    post({ type: 'agentEnd', agent: t.agent });
                    break;
                }
                const a = AGENTS[t.agent];
                if (!a) continue;
                post({ type: 'agentStart', agent: t.agent, task: t.task });
                _updateActiveDispatchStep(prompt, `${a.emoji} ${a.name} 작업 중 — ${t.task.slice(0, 40)}`);

                // 이전 에이전트들의 산출물을 동료의 작업으로 함께 제공
                const peerCtx = Object.keys(outputs).length > 0
                    ? `\n\n[같은 세션의 동료 에이전트 산출물]\n${Object.entries(outputs).map(([k, v]) => `\n### ${AGENTS[k]?.emoji} ${AGENTS[k]?.name}\n${v.slice(0, 1500)}`).join('\n')}`
                    : '';

                /* v2.89.10 — Prefetch 진짜 데이터: LLM 호출 직전에 시스템이
                   에이전트의 데이터 도구를 실행해서 stdout을 컨텍스트로 주입.
                   에이전트가 "데이터 로드 완료했다" 거짓말 못하게 됨 (거짓이면
                   주입된 실제 데이터와 충돌이 보임). */
                let realtimeData = '';
                try {
                    post({ type: 'response', value: `🔍 ${a.emoji} ${a.name} 데이터 가져오는 중...` });
                    realtimeData = await prefetchAgentRealtimeData(t.agent);
                } catch { /* prefetch 실패해도 dispatch 안 막음 */ }
                /* v2.89.38 — 환각 방지 가드. 사용자 원 명령에 키워드가 등장하는데
                   그 데이터를 가진 에이전트(youtube/instagram/secretary)가 1차로 실행돼서
                   실데이터가 peerCtx 또는 realtimeData에 있는데도 specialist가 무시하고
                   memory.md/decisions.md/brain RAG에서 끌어와 헛소리하던 패턴 차단. */
                const userMentionsChannelData = /(유튜브|youtube|채널|구독자|조회수|영상)/i.test(prompt);
                const hasRealChannelData = userMentionsChannelData && (
                    /채널.*조회수|조회수\s*중간값|구독자|영상\s*\d+개/i.test(realtimeData + peerCtx)
                );
                const hallucinationGuard = hasRealChannelData
                    ? `\n\n[🛑 환각 금지 규칙 — 절대 위반 금지]\n` +
                      `위 [실시간 데이터] 또는 [동료 산출물]에 사용자 채널의 진짜 데이터(조회수·영상 수·구독자 등)가 들어있습니다.\n` +
                      `- 분석은 **오직 그 데이터만** 근거로 하세요\n` +
                      `- 당신의 memory.md / 회사 decisions / 브레인 노트에 들어있는 과거 디자인·전략·시각 시스템 내용을 **소환하지 마세요** (사용자가 *이번에 그걸 명시적으로 요청*하지 않은 한)\n` +
                      `- "Deep Blue/Neon Cyan", "지배 구조", "심리적 통제권" 같은 과거 컨셉을 자동으로 끌어와 보고서에 끼워 넣는 행위 금지\n` +
                      `- 본인 task가 위 데이터와 무관하면 \`📊 평가: 대기 — 이번 명령에 적합한 데이터·지시 부족\` 으로 정직하게 종료`
                    : '';
                /* v2.89.41 — 컨텍스트 다이어트. 실데이터(prefetch 또는 peerCtx) 있을 때
                   lean 모드 = decisions·memory·brain RAG 생략 → 토큰 ~9000자 감소 →
                   추론 30~50% 빨라짐 + 환각 더 줄어듦 (메모리에서 끌어올 거리 없음). */
                const useLeanContext = (realtimeData.length > 200) || (peerCtx.length > 500);
                const sysPrompt = `${buildSpecialistPrompt(t.agent)}${buildAgentConfigStatus(t.agent)}${realtimeData}${readAgentSharedContext(t.agent, { lean: useLeanContext })}${peerCtx}${hallucinationGuard}`;
                const userMsg = `[CEO의 지시]\n${t.task}\n\n[원 사용자 명령 참고]\n${prompt}`;

                let out = '';
                try {
                    out = await this._callAgentLLM(sysPrompt, userMsg, modelName, t.agent, true);
                } catch (e: any) {
                    if (isAborted()) {
                        post({ type: 'agentEnd', agent: t.agent });
                        post({ type: 'error', value: '🛑 사용자가 중단했어요.' });
                        return;
                    }
                    /* v2.89.31 — 400/500 응답 본문에서 실제 원인을 뽑아내 표시.
                       이전엔 "Request failed with status code 400"만 보여서 디버깅 불가.
                       LM Studio는 보통 "model not loaded" / "model not found" 메시지를 반환. */
                    let detail = '';
                    try {
                        if (e?.response?.data?.on) {
                            const buf = await new Promise<string>((resolve) => {
                                let acc = '';
                                e.response.data.on('data', (c: Buffer) => { acc += c.toString(); });
                                e.response.data.on('end', () => resolve(acc));
                                e.response.data.on('error', () => resolve(acc));
                            });
                            try { detail = JSON.parse(buf).error?.message || JSON.parse(buf).error || buf.slice(0, 300); }
                            catch { detail = buf.slice(0, 300); }
                        } else if (e?.response?.data) {
                            detail = typeof e.response.data === 'string' ? e.response.data.slice(0, 300) : JSON.stringify(e.response.data).slice(0, 300);
                        }
                    } catch { /* ignore */ }
                    const status = e?.response?.status;
                    const assignedModel = getAgentModel(t.agent, '') || modelName || '(없음)';
                    let hint = '';
                    if (status === 400 && /not loaded|not found|model.*unknown/i.test(detail)) {
                        hint = `\n💡 LM Studio에 \`${assignedModel}\` 모델이 로드 안 됨. LM Studio에서 모델 로드 후 재시도, 또는 모델 오케스트레이션 모달에서 다른 모델로 변경.`;
                    } else if (status === 400) {
                        hint = `\n💡 ${a.name}에 할당된 모델: \`${assignedModel}\`. 이 모델이 실제로 Ollama/LM Studio에 설치/로드돼 있는지 확인. 모델 오케스트레이션 모달에서 변경 가능.`;
                    } else if (e?.code === 'ECONNREFUSED') {
                        hint = '\n💡 LLM 서버에 연결 못함 — Ollama/LM Studio 실행 확인.';
                    }
                    /* v2.89.32 — LLM 호출은 실패해도 prefetch가 가져온 실데이터는
                       살아있으니 그대로 보존해서 다음 에이전트(peerCtx)와 최종 보고서가
                       볼 수 있게 함. 이전엔 LLM 실패 = 에러 메시지만 out에 들어가서
                       "데이터 로드 실패"로 잘못 보고됨 (실제로는 데이터가 있는데도). */
                    const errBlock = `⚠️ ${a.name} LLM 호출 실패: ${e.message}${detail ? '\n원인: ' + detail : ''}${hint}`;
                    if (realtimeData && realtimeData.trim()) {
                        out = `${errBlock}\n\n---\n\n## 📊 LLM 실패에도 시스템이 가져온 실데이터는 보존됨\n\n${realtimeData}\n\n_위 데이터를 기반으로 다음 에이전트가 분석을 이어가야 합니다. "데이터 로드 실패"로 잘못 보고하지 마세요._`;
                    } else {
                        out = errBlock;
                    }
                }
                /* v2.89.9 — 진짜 도구 실행. corporate dispatch에서도 에이전트가
                   <run_command>...</run_command> 출력하면 시스템이 실제로 실행하고
                   stdout/stderr를 다시 출력에 주입. 이게 LLM hallucination을
                   진짜 데이터 기반 답변으로 바꿈. 이전엔 _handlePrompt 흐름에서만
                   실행됐고 corporate에선 텍스트만 흘러서 "데이터 로드함"이라고
                   거짓 보고만 났음. */
                try {
                    const cmdRegex = /<(?:run_command|command|bash|terminal)>([\s\S]*?)<\/(?:run_command|command|bash|terminal)>/gi;
                    const cmds: string[] = [];
                    let cmdMatch: RegExpExecArray | null;
                    while ((cmdMatch = cmdRegex.exec(out)) !== null) {
                        let c = cmdMatch[1].trim();
                        if (c.startsWith('```')) {
                            const lines = c.split('\n');
                            if (lines[0].startsWith('```')) lines.shift();
                            if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) lines.pop();
                            c = lines.join('\n').trim();
                        }
                        if (c) cmds.push(c);
                    }
                    if (cmds.length > 0) {
                        post({ type: 'response', value: `🔧 ${a.emoji} ${a.name}: ${cmds.length}개 명령 실행 중...` });
                        const cwd = path.join(getCompanyDir(), '_agents', t.agent, 'tools');
                        const execLogs: string[] = [];
                        for (const cmd of cmds) {
                            try {
                                /* spawnSync via runCommandCaptured-style — capture stdout */
                                const r = await runCommandCaptured(cmd, cwd, () => { /* silent during exec */ }, 90000);
                                const status = r.timedOut ? '⏱️ 90초 초과' : (r.exitCode === 0 ? '✅' : `❌ exit ${r.exitCode}`);
                                const trimmedOut = (r.output || '').trim().slice(0, 4000);
                                execLogs.push(`### 🔧 실행: \`${cmd.slice(0, 100)}\`\n\`\`\`\n${trimmedOut}\n\`\`\`\n_${status}_`);
                                /* 도구 실행 결과를 텔레그램에도 미러 (사용자가 진행 보임) */
                                if (this._telegramMirrorPending) {
                                    sendTelegramReport(`🔧 *${a.emoji} ${a.name}* 도구 실행 ${status}\n\n\`\`\`\n${trimmedOut.slice(0, 1500)}\n\`\`\``).catch(() => {});
                                }
                            } catch (err: any) {
                                execLogs.push(`### 🔧 실행 실패: \`${cmd.slice(0, 100)}\`\n${err?.message || err}`);
                            }
                        }
                        /* 출력에 실제 실행 결과 append — LLM이 다음에 보거나 final report에 들어감 */
                        out = `${out}\n\n---\n## 🛠️ 도구 실행 결과 (시스템 자동 실행)\n\n${execLogs.join('\n\n')}`;
                        post({ type: 'response', value: `✅ ${a.emoji} ${a.name}: 도구 실행 완료, 결과 컨텍스트 주입` });
                        /* 도구 결과로 에이전트가 다시 분석하도록 2차 호출 (선택) — 시간/토큰 비용 있어서
                           일단은 결과만 append, 다음 에이전트(peerCtx)와 final report에서 활용. */
                    }
                } catch { /* never let tool exec break the dispatch */ }
                outputs[t.agent] = out;
                /* v2.89.51 — 작업 라운드 메타데이터 수집. CEO 보고에 도구·데이터·핵심 인용. */
                {
                    /* prefetch summary: realtimeData 첫 의미있는 줄 (### 헤딩 다음) */
                    let prefetchSummary = '';
                    if (realtimeData) {
                        const m = realtimeData.match(/###\s*([^\n]+)/);
                        prefetchSummary = m ? m[1].trim() : '';
                        /* 진짜 데이터의 핵심 숫자 한두개 뽑아내기 */
                        const stats: string[] = [];
                        const subM = realtimeData.match(/구독자[\s:]*([0-9.]+[KkMm]?[명]?)/);
                        const viewsM = realtimeData.match(/조회수\s*중간값[:\s]*\*?\*?([0-9.]+[KkMm]?)/);
                        const videoM = realtimeData.match(/영상\s*(\d+)\s*개/);
                        if (subM) stats.push(`구독자 ${subM[1]}`);
                        if (viewsM) stats.push(`중간값 ${viewsM[1]}`);
                        if (videoM) stats.push(`영상 ${videoM[1]}개`);
                        if (stats.length > 0) prefetchSummary = stats.join(' · ');
                    }
                    /* output summary: 첫 의미있는 줄 + 평가 라인 */
                    const outLines = (out || '').split('\n').map(l => l.trim()).filter(Boolean);
                    const firstReal = outLines.find(l => !l.startsWith('#') && !l.startsWith('---') && !/^[📺📊🔥💰🎨🔧🛠️]/.test(l) && l.length > 10) || (outLines[0] || '');
                    const evalLine = outLines.find(l => l.startsWith('📊 평가:')) || '';
                    const outputSummary = [firstReal.slice(0, 200), evalLine].filter(Boolean).join(' / ');
                    /* 실행한 도구 이름 추출 — '🛠️ 도구 실행 결과' 섹션 또는 prefetch */
                    const toolsUsed: string[] = [];
                    const toolMatches = (out || '').matchAll(/실행:\s*`(?:cd[^&`]*&&\s*)?(?:python\d?\s+)?([\w_-]+\.py)/g);
                    for (const m of toolMatches) toolsUsed.push(m[1]);
                    /* youtube의 경우 prefetch가 my_videos_check.py 자동 실행하니 추가 */
                    if (t.agent === 'youtube' && realtimeData.length > 100 && !toolsUsed.includes('my_videos_check.py')) {
                        toolsUsed.push('my_videos_check.py (prefetch)');
                    }
                    agentMeta[t.agent] = {
                        task: t.task,
                        toolsUsed,
                        prefetchSummary,
                        outputSummary,
                        outputLength: (out || '').length,
                    };
                }
                /* v2.89.8 — 자동 트리거 토큰. 에이전트가 `<TRIGGER:youtube_oauth>`
                   를 출력하면 시스템이 OAuth 명령을 직접 실행해서 브라우저를 띄움.
                   사용자가 "버튼 어디 있냐" 헤매지 않고 진짜 비서처럼 자동으로
                   인증 창이 뜸. */
                if (out && /<TRIGGER:youtube_oauth>/i.test(out)) {
                    try {
                        /* 먼저 Client ID/Secret 확인 — 없으면 OAuth 시작 못함.
                           사용자에게 그 사실을 텔레그램·사이드바 둘 다에 명확히 안내. */
                        const cl = _readYtOAuthClient();
                        const hasClient = !!(cl.id && cl.secret);
                        if (!hasClient) {
                            const setupMsg = `🔐 *YouTube Analytics 인증 셋업 필요*\n\nClient ID와 Secret이 비어있어 자동 인증을 시작할 수 없어요. 1회만 셋업하면 다음부터 자동:\n\n1. 헤더 우측 *🔌 외부 연결* 버튼 클릭\n2. *📊 YouTube Analytics (OAuth)* 카드에서 Client ID·Secret 입력\n3. ⚡ *자동 연결* 버튼 → 브라우저 자동 열림\n\n_생성: console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client ID (Desktop)_`;
                            post({ type: 'response', value: '🔐 OAuth 셋업이 필요해요 — Client ID/Secret을 먼저 입력해주세요. (텔레그램으로 안내 발송)' });
                            if (this._telegramMirrorPending) {
                                await sendTelegramLong(setupMsg);
                                _pushTelegramHistory('assistant', 'OAuth 셋업 필요 — Client ID/Secret 입력 안내');
                            }
                        } else {
                            /* Client 있음 — 자동으로 브라우저 열기. fire-and-forget으로 dispatch 진행 안 막음. */
                            post({ type: 'response', value: '🔐 YouTube OAuth 인증 창을 자동으로 띄울게요...' });
                            if (this._telegramMirrorPending) {
                                await sendTelegramReport(`🔐 *Analytics OAuth 인증 시작* — 브라우저가 자동으로 열려요. Google 계정 승인 후 분석 다시 요청해주세요.`);
                            }
                            startYouTubeOAuthFlow().then(r => {
                                try {
                                    if (r.ok) {
                                        _activeChatProvider?.postSystemNote?.('✅ YouTube OAuth 연결 완료 — 다시 분석 요청해주세요.', '🔐');
                                        if (this._telegramMirrorPending !== undefined) {
                                            sendTelegramReport(`✅ *OAuth 연결 완료* — 이제 시청 지속률·트래픽 소스 같은 Analytics 데이터 분석 가능. 같은 명령 다시 보내주세요.`).catch(() => {});
                                        }
                                    } else {
                                        _activeChatProvider?.postSystemNote?.(`⚠️ OAuth 실패: ${r.message}`, '🔐');
                                    }
                                } catch { /* ignore */ }
                            });
                        }
                    } catch (e: any) {
                        post({ type: 'error', value: `⚠️ OAuth 자동 트리거 실패: ${e?.message || e}` });
                    }
                    /* 출력에서 TRIGGER 토큰 제거 (사용자한텐 보이면 안 됨) */
                    out = out.replace(/<TRIGGER:youtube_oauth>/gi, '').trim();
                    outputs[t.agent] = out;
                    /* 후속 에이전트 분배 의미 없음 — 사용자 OAuth 승인 후 재요청 흐름 */
                    plan.tasks = plan.tasks.slice(0, plan.tasks.findIndex(x => x.agent === t.agent) + 1);
                    /* 산출물 저장은 그대로 (기록 가치) */
                    try {
                        fs.writeFileSync(
                            path.join(sessionDir, `${t.agent}.md`),
                            `# ${a.emoji} ${a.name} — ${t.task}\n\n${out}\n`
                        );
                    } catch { /* ignore */ }
                    appendAgentMemory(t.agent, `${t.task} → OAuth 자동 트리거 발동`);
                    post({ type: 'agentEnd', agent: t.agent, blocked: true });
                    this._telegramMirrorPending = false;
                    break;
                }
                /* v2.89.2 — 차단 감지 + 즉시 텔레그램 통보. 에이전트 응답이
                   "API 키 필요"·"OAuth 미연결" 같은 자격증명 차단 신호면:
                   1) 사용자한테 즉시 텔레그램으로 그 메시지 송출 (기다리지 말고)
                   2) 후속 에이전트 분배는 의미 없으니 break
                   3) 나중에 final report에 묻히지 않음 */
                const isBlocked = (() => {
                    const o = out || '';
                    /* 명시적 신호 */
                    if (/API\s*키.*(필요|입력|미설정)/i.test(o)) return true;
                    if (/OAuth\s*(연결|미연결).*(필요|해주세요)/i.test(o)) return true;
                    if (/(자격증명|credentials).*(필요|미설정|missing)/i.test(o)) return true;
                    if (/⚠️.*미설정/i.test(o)) return true;
                    /* 자가평가가 '대기' + 이유에 키 언급 */
                    if (/📊\s*평가:\s*대기/i.test(o) && /키|API|OAuth|credentials/i.test(o)) return true;
                    return false;
                })();
                if (isBlocked) {
                    /* v2.89.7 — 사이드바 디스패치도 블록 인지하게. 이전엔 텔레그램에서
                       시작한 디스패치만 즉시 알림 보내고, 사이드바 디스패치는 그냥
                       통과시켜서 후속 에이전트들이 빈 데이터로 빙빙 돌았음. 이제 둘 다
                       차단. */
                    try {
                        /* "📊 평가: 대기" 같은 메타 라인 제거하고 본문만 추출 */
                        const cleaned = out
                            .replace(/^📊\s*평가:.*$/gim, '')
                            .replace(/^📝\s*다음 단계:.*$/gim, '')
                            .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}].*?\s*(시작|작업)\s*합니다.*$/gimu, '')
                            .trim();
                        const headline = `⛔ *${a.emoji} ${a.name} 작업 멈춤* — 자격증명 필요`;
                        if (this._telegramMirrorPending) {
                            await sendTelegramLong(`${headline}\n\n${cleaned.slice(0, 1500)}`);
                            _pushTelegramHistory('assistant', `${a.name}: ${cleaned.slice(0, 200)}`);
                        }
                        post({ type: 'response', value: `⛔ ${a.emoji} ${a.name}가 자격증명 부족으로 멈췄어요${this._telegramMirrorPending ? ' (텔레그램 알림 발송)' : ''}.` });
                    } catch { /* silent */ }
                    /* 이 에이전트의 산출물 저장 + memory 누적은 그대로 진행 (기록 가치) */
                    try {
                        fs.writeFileSync(
                            path.join(sessionDir, `${t.agent}.md`),
                            `# ${a.emoji} ${a.name} — ${t.task}\n\n${out}\n`
                        );
                    } catch { /* ignore */ }
                    appendAgentMemory(t.agent, `${t.task} → 자격증명 부족으로 차단됨`);
                    post({ type: 'agentEnd', agent: t.agent, blocked: true });
                    /* 이 에이전트가 다른 에이전트의 입력 데이터 공급원이면 후속 작업도
                       의미 없음. 전체 dispatch 중단. */
                    post({ type: 'response', value: `🛑 후속 에이전트 분배 중단 — 먼저 ${a.name} 자격증명 입력 후 재요청해주세요.` });
                    /* mirror 처리는 final report가 발사되기 전이지만 이미 위에서
                       텔레그램에 핵심 메시지 보냈으니 mirror flag만 끄고 final
                       report 단계로 진입하지 않게 throw. */
                    this._telegramMirrorPending = false;
                    /* finalReport는 차단 메시지로 대체 — sessionDir 정리만 하고
                       break out of the agent loop. */
                    plan.tasks = plan.tasks.slice(0, plan.tasks.findIndex(x => x.agent === t.agent) + 1);
                    break;
                }
                try {
                    fs.writeFileSync(
                        path.join(sessionDir, `${t.agent}.md`),
                        `# ${a.emoji} ${a.name} — ${t.task}\n\n${out}\n`
                    );
                } catch { /* ignore */ }
                // 개인 메모리에 한 줄 누적
                appendAgentMemory(t.agent, `${t.task} → 산출물 sessions/${path.basename(sessionDir)}/${t.agent}.md`);
                /* Self-RAG promotion: if this agent is in self-rag mode, scan
                   its output for [근거: ...] tagged claims and append them to
                   verified.md. memory.md still gets the firehose entry above
                   for traceability. */
                try {
                    if (readAgentRagMode(t.agent) === 'self-rag') {
                        const n = promoteGroundedClaimsFromOutput(t.agent, out);
                        if (n > 0) {
                            post({ type: 'response', value: `✅ ${a.emoji} ${a.name}의 검증된 주장 ${n}개를 \`verified.md\`로 승격했습니다.` });
                        }
                    }
                } catch { /* ignore */ }
                // Phase 1: log this agent's full output to the running transcript
                appendConversationLog({ speaker: a.name, emoji: a.emoji, section: t.task.slice(0, 60), body: out });
                /* P1-5: harvest action items from this agent's output and register them
                   into tracker so the user sees them in the sidebar Task panel. We use
                   a conservative regex (`- [ ] ...` markdown checkbox) so agents
                   opt-in by formatting their output that way; their prompt seeds
                   already encourage action-oriented endings. */
                try {
                    const harvested = _harvestActionItems(out);
                    for (const title of harvested) {
                        addTrackerTask({
                            title,
                            owner: 'agent',
                            agentIds: [t.agent],
                            status: 'pending',
                            description: `자동 등록 (${a.name} 산출물에서 추출)`,
                            sessionDir: path.basename(sessionDir),
                        });
                    }
                } catch { /* never let harvesting break the dispatch */ }
                post({ type: 'agentEnd', agent: t.agent });
                
                const metrics = getCompanyMetrics();
                updateCompanyMetrics({ tasksCompleted: (metrics.tasksCompleted || 0) + 1 });
            }

            if (isAborted()) {
                post({ type: 'error', value: '🛑 사용자가 중단했어요.' });
                return;
            }
            // 4.5) 에이전트 간 자율 대화 (Confer) — 2명 이상일 때만
            const conferTurns: { from: string; to: string; text: string }[] = [];
            if (plan.tasks.length >= 2) {
                try {
                    const conferInput = `[원 명령]\n${prompt}\n\n[산출물 요약]\n${plan.tasks.map(t => `\n## ${AGENTS[t.agent]?.name}\n${(outputs[t.agent] || '').slice(0, 800)}`).join('\n')}`;
                    const conferRaw = await this._callAgentLLM(_personalizePrompt(CONFER_PROMPT), conferInput, modelName, 'ceo', false);
                    const m = conferRaw.match(/\{[\s\S]*\}/);
                    const parsed = JSON.parse(m ? m[0] : conferRaw);
                    if (parsed && Array.isArray(parsed.turns)) {
                        const validIds = SPECIALIST_IDS;
                        for (const t of parsed.turns) {
                            if (typeof t.from === 'string' && typeof t.to === 'string' && typeof t.text === 'string'
                                && validIds.includes(t.from) && validIds.includes(t.to)
                                && t.from !== t.to && t.text.trim().length > 0) {
                                conferTurns.push({ from: t.from, to: t.to, text: t.text.trim().slice(0, 80) });
                            }
                        }
                    }
                } catch { /* confer 실패는 silent */ }

                if (conferTurns.length > 0) {
                    post({ type: 'agentConfer', turns: conferTurns });
                    // Phase 1: log all confer turns into the running transcript
                    const conferBody = conferTurns
                        .map(t => `- ${AGENTS[t.from]?.emoji || ''} **${AGENTS[t.from]?.name || t.from}** → ${AGENTS[t.to]?.emoji || ''} ${AGENTS[t.to]?.name || t.to}: ${t.text}`)
                        .join('\n');
                    appendConversationLog({ speaker: '팀 회의', emoji: '💬', section: '에이전트 간 대화', body: conferBody });
                    // 사무실 시각화가 자연스럽게 흐르도록 대기 (캐릭터 walk + bubble + return)
                    await new Promise(r => setTimeout(r, Math.min(conferTurns.length * 4500, 22000)));
                }
            }

            if (isAborted()) {
                post({ type: 'error', value: '🛑 사용자가 중단했어요.' });
                return;
            }
            // 5) CEO 종합 보고서 (UI에는 chunk 안 흘리고 카드로만 표시)
            // v2.89.41 — 단일 에이전트 dispatch면 CEO 보고서 스킵.
            // v2.89.46 — 빈 산출물 감지: 모든 에이전트가 LLM 실패로 빈 답 반환했으면
            //   CEO가 "기다리고 있습니다" 같은 placeholder 출력하지 않게 명시적 실패 보고.
            let finalReport = '';
            const nonEmptyOutputs = plan.tasks
                .map(t => ({ agent: t.agent, out: (outputs[t.agent] || '').trim() }))
                .filter(o => o.out.length > 30 && !/^⚠️.*호출 실패/.test(o.out));
            if (nonEmptyOutputs.length === 0) {
                /* 모든 에이전트가 빈 답 — CEO LLM 호출 무의미. 즉시 실패 보고로 종료. */
                finalReport = `⚠️ **모든 에이전트의 LLM 호출이 실패했습니다.**\n\n` +
                    `시도된 에이전트: ${plan.tasks.map(t => `${AGENTS[t.agent]?.emoji} ${AGENTS[t.agent]?.name}`).join(' · ')}\n\n` +
                    `**가장 흔한 원인**:\n` +
                    `- LM Studio에 모델 로드 실패 (메모리 부족) — 모델 오케스트레이션 모달에서 더 작은 모델 선택\n` +
                    `- Ollama/LM Studio 서버 미실행\n` +
                    `- Context Length 초과 (LM Studio 8192 이상 권장)\n\n` +
                    `_각 에이전트의 정확한 에러는 위 카드들 참고. 모델 변경 후 재시도 추천._`;
            } else if (plan.tasks.length <= 1) {
                const onlyAgent = plan.tasks[0]?.agent;
                const onlyOutput = onlyAgent ? (outputs[onlyAgent] || '') : '';
                finalReport = onlyOutput.trim() || '_(에이전트 산출물 없음)_';
            } else {
                post({ type: 'agentStart', agent: 'ceo', task: '종합 보고서 작성' });
                _updateActiveDispatchStep(prompt, 'CEO 종합 보고서 작성 중');
                /* v2.89.46 — 산출물 없는 에이전트는 reportInput에서 제외 (CEO가 placeholder
                   출력 위험 제거). 명시적으로 "X명 중 Y명만 답변 도착" 메타 정보 포함. */
                const validTasks = plan.tasks.filter(t => nonEmptyOutputs.some(o => o.agent === t.agent));
                const reportInput = `[원 명령]\n${prompt}\n\n[브리프]\n${plan.brief}\n\n` +
                    `[응답 도착: ${validTasks.length}/${plan.tasks.length}명]\n\n` +
                    `[유효한 에이전트 산출물]\n${validTasks.map(t => `\n## ${AGENTS[t.agent]?.emoji} ${AGENTS[t.agent]?.name}\n${(outputs[t.agent] || '').slice(0, 2000)}`).join('\n')}\n\n` +
                    `규칙: 위 산출물 안의 실제 내용·숫자만 인용해 보고서 작성. "산출물을 기다리고 있습니다", "데이터가 제공되면" 같은 placeholder 표현 절대 금지 — 산출물은 이미 위에 있음.`;
                let ceoNarrative = '';
                try {
                    ceoNarrative = await this._callAgentLLM(
                        `${_personalizePrompt(CEO_REPORT_PROMPT)}\n${readAgentSharedContext('ceo', { lean: true })}`,
                        reportInput,
                        modelName,
                        'ceo',
                        false
                    );
                    /* CEO가 그래도 placeholder 뱉으면 무시 */
                    if (/산출물을\s*기다|데이터가\s*제공|once\s+the\s+output|when\s+the\s+output/i.test(ceoNarrative)) {
                        ceoNarrative = '';
                    }
                } catch { ceoNarrative = ''; }
                post({ type: 'agentEnd', agent: 'ceo' });
                /* v2.89.51 — 메타데이터 기반 작업 라운드 보고. CEO LLM 답이 짧거나 빈 답이어도
                   사용자가 "어떤 도구·어떤 데이터·각 에이전트 무엇을 했나" 한눈에 파악. */
                const breakdownLines: string[] = [];
                breakdownLines.push(`## 🗂 작업 라운드 — 누가 뭐 했나`);
                breakdownLines.push('');
                for (const t of plan.tasks) {
                    const a = AGENTS[t.agent];
                    const meta = agentMeta[t.agent];
                    if (!a) continue;
                    breakdownLines.push(`### ${a.emoji} ${a.name} _(${a.role})_`);
                    breakdownLines.push(`> 📋 **지시**: ${t.task}`);
                    if (meta?.toolsUsed && meta.toolsUsed.length > 0) {
                        breakdownLines.push(`> 🔧 **도구 실행**: ${meta.toolsUsed.map(x => '`'+x+'`').join(', ')}`);
                    } else {
                        breakdownLines.push(`> 🔧 **도구 실행**: _(없음 — LLM 추론만)_`);
                    }
                    if (meta?.prefetchSummary) {
                        breakdownLines.push(`> 📊 **수집 데이터**: ${meta.prefetchSummary}`);
                    }
                    if (meta?.outputSummary) {
                        breakdownLines.push(`> 💡 **핵심 산출**: ${meta.outputSummary}`);
                    } else {
                        const out = outputs[t.agent] || '';
                        if (!out.trim() || /^⚠️/.test(out)) {
                            breakdownLines.push(`> ⚠️ **상태**: 빈 답변 또는 LLM 실패`);
                        }
                    }
                    breakdownLines.push(`> 📝 산출물 길이: ${meta?.outputLength || 0}자`);
                    breakdownLines.push('');
                }
                if (ceoNarrative && ceoNarrative.trim()) {
                    finalReport = `${breakdownLines.join('\n')}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n## 👔 CEO 종합\n\n${ceoNarrative.trim()}`;
                } else {
                    /* CEO LLM 실패해도 메타 보고서는 항상 보임 */
                    finalReport = `${breakdownLines.join('\n')}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n_(CEO 종합 단계 스킵 — 위 작업 라운드 메타가 답입니다)_`;
                }
            }

            try {
                fs.writeFileSync(path.join(sessionDir, '_report.md'), `# 📝 CEO 종합 보고서\n\n${finalReport}\n`);
            } catch { /* ignore */ }
            appendAgentMemory('ceo', `${prompt} → 보고서 sessions/${path.basename(sessionDir)}/_report.md`);
            // Phase 1: log CEO's final synthesis into the running transcript
            appendConversationLog({ speaker: 'CEO', emoji: '🧭', section: '종합 보고서', body: finalReport });
            /* Auto-mark any open tracker task that was created in the last
               few minutes (= the user's most recent dispatch) as done now
               that the CEO has wrapped up. Lets the user see "✅ 다음 영상
               컨셉 뽑기" without manual /done. */
            try { autoMarkTrackerFromDispatch(plan, sessionDir, finalReport); } catch { /* ignore */ }
            /* Refresh unified schedule so the next cycle's agents see the
               freshly-completed work in their context. */
            try { rebuildUnifiedSchedule(); } catch { /* ignore */ }

            // 5.5) 자가학습 — 결정 추출 → decisions.md에 자동 append
            const learnedDecisions: string[] = [];
            try {
                const learnInput = `[원 명령]\n${prompt}\n\n[보고서]\n${finalReport.slice(0, 2500)}\n\n[대화]\n${conferTurns.map(t => `${AGENTS[t.from]?.name} → ${AGENTS[t.to]?.name}: ${t.text}`).join('\n')}`;
                const learnRaw = await this._callAgentLLM(DECISIONS_EXTRACT_PROMPT, learnInput, modelName, 'ceo', false);
                const m = learnRaw.match(/\{[\s\S]*\}/);
                const parsed = JSON.parse(m ? m[0] : learnRaw);
                if (parsed && Array.isArray(parsed.decisions)) {
                    for (const d of parsed.decisions) {
                        if (typeof d === 'string' && d.trim().length > 0 && d.trim().length <= 80) {
                            learnedDecisions.push(d.trim());
                        }
                    }
                }
            } catch { /* silent */ }

            if (learnedDecisions.length > 0) {
                try {
                    const dir = getCompanyDir();
                    const decPath = path.join(dir, '_shared', 'decisions.md');
                    if (!fs.existsSync(decPath)) {
                        fs.writeFileSync(decPath, `# 📌 회사 의사결정 로그\n\n_자가학습이 자동 누적합니다. 잘못된 항목은 직접 삭제하세요._\n`);
                    }
                    const ts = new Date().toISOString().slice(0, 10);
                    const block = `\n## [${ts}] ${prompt.slice(0, 60)}\n${learnedDecisions.map(d => `- ${d}`).join('\n')}\n_세션: ${path.basename(sessionDir)}_\n`;
                    fs.appendFileSync(decPath, block);
                } catch { /* ignore */ }
                post({ type: 'decisionsLearned', decisions: learnedDecisions });
            }

            // 6) 종합 카드
            post({
                type: 'corporateReport',
                brief: plan.brief,
                report: finalReport,
                sessionPath: sessionDisplay,
                sessionRel: `Company/sessions/${path.basename(sessionDir)}`
            });

            // 6.4) Bridge mode 'output_only' or 'full' — Secretary writes a
            // 1-2 line wrap-up addressed to the user. Replaces the raw CEO
            // tone with a friendly, owner-facing summary so the bridge model
            // is felt at the end of every dispatch (not just at the start).
            // Reuses the same Telegram mirror flag so this card flows out
            // through the same channels as Secretary's other replies.
            if (bridgeMode !== 'off') {
                try {
                    const wrapSys = `당신은 1인 기업의 비서입니다. 방금 회사가 사장님 명령을 처리해서 종합 보고서가 나왔습니다.\n사장님(사용자)께 1~2 문장으로 친근하게 정리해서 전달하세요.\n- "사장님, ~"으로 시작\n- 핵심 결과 1개 + 필요하면 다음 액션 한 줄\n- JSON·머리말·꼬리말 금지. 평문만.`;
                    const wrapUsr = `[사장님 명령]\n${prompt.slice(0, 400)}\n\n[CEO 종합 보고]\n${finalReport.slice(0, 1500)}`;
                    const wrap = await this._callAgentLLM(wrapSys, wrapUsr, modelName, 'secretary', false);
                    const wrapText = (wrap || '').trim().slice(0, 500);
                    if (wrapText) {
                        this._displayMessages.push({ text: `📱 비서: ${wrapText}`, role: 'ai' });
                        appendConversationLog({ speaker: '비서', emoji: '📱', section: '브릿지(사장님 정리)', body: wrapText });
                        post({ type: 'agentChunk', agent: 'secretary', value: wrapText });
                    }
                } catch { /* never let the wrap-up break the dispatch flow */ }
            }

            // 6.5) Secretary 자동 텔레그램 보고 (토큰 있을 때만)
            const tg = readTelegramConfig();
            if (tg.token && tg.chatId) {
                const company = readCompanyName() || '1인 기업';
                /* v2.89 — 자율 사이클 vs 사용자 명령 헤더 구분. 자리 비웠을 때
                   회사가 알아서 한 일도 한 눈에 알 수 있게. */
                const isAuto = /^\[자율 사이클/.test(prompt);
                const header = isAuto
                    ? `*🌙 ${company} — 자율 사이클 보고*`
                    : `*📱 ${company} — 작업 라운드 보고*`;
                const cmdLine = isAuto
                    ? `*컨텍스트:* 회사 목표·메모리 검토 후 자율적으로 일거리 결정`
                    : `*명령:* ${prompt.slice(0, 200)}`;
                const tgText = `${header}\n\n${cmdLine}\n\n*브리프:* ${plan.brief}\n\n*완료한 에이전트:*\n${plan.tasks.map(t => `• ${AGENTS[t.agent]?.emoji} ${AGENTS[t.agent]?.name}`).join('\n')}\n\n${finalReport.slice(0, 1500)}\n\n_세션: ${path.basename(sessionDir)}_`;
                sendTelegramReport(tgText).then(ok => {
                    if (ok) {
                        post({ type: 'telegramSent', agent: 'secretary' });
                    }
                }).catch(() => { /* silent */ });
            }

            // 7) 디스플레이 히스토리 (간략)
            this._displayMessages.push({
                text: `**[1인 기업 모드]** ${plan.brief}\n\n${finalReport}\n\n_📁 저장: ${sessionDisplay}_`,
                role: 'ai'
            });
            this._saveHistory();

            // 8) 자율 git 백업 — 두뇌 + (옵션)회사 별도 백업 둘 다 시도.
            //    회사가 두뇌 안 nested면 두뇌 sync 한 번으로 끝, detached면
            //    별도 push가 같이 돌아감. 락이 분리돼있어 병렬로 실행 가능.
            const brainDir = path.join(os.homedir(), '.connect-ai-brain');
            const sessionMsg = `chore(corporate): session ${path.basename(sessionDir)}`;
            _safeGitAutoSync(brainDir, sessionMsg, this).catch(() => { /* silent */ });
            _safeGitAutoSyncCompany(sessionMsg, this).catch(() => { /* silent */ });
        } catch (error: any) {
            if (isAborted()) {
                this._broadcastCorporate({ type: 'error', value: '🛑 사용자가 중단했어요.' });
            } else {
                this._broadcastCorporate({ type: 'error', value: `⚠️ 1인 기업 모드 오류: ${error.message}` });
            }
        } finally {
            this._abortController = undefined;
            /* The corp dispatch already sends a Telegram daily-report when
               configured, but we still clear the mirror flag so a follow-up
               sidebar prompt doesn't accidentally inherit it. */
            this._telegramMirrorPending = false;
            /* v2.89.52 — 입력 잠금 해제. _handlePrompt만 streamEnd 보내고 있어서
               _handleCorporatePrompt(casual chat·shortcut·multi-agent 다 포함) 끝나면
               webview는 여전히 "응답 중" 상태로 입력 막혀있었음. 사용자가 정지 버튼을
               눌러야 풀리는 사고. 어떤 경로로 끝나든 finally에서 streamEnd 보장. */
            try { this._view?.webview.postMessage({ type: 'streamEnd' }); } catch { /* ignore */ }
        }
    }

    // 단일 에이전트 LLM 호출. broadcast=true이면 토큰을 webview로 스트리밍.
    private async _callAgentLLM(
        systemPrompt: string,
        userMsg: string,
        modelName: string,
        agentId: string,
        broadcast: boolean
    ): Promise<string> {
        const { ollamaBase, defaultModel, timeout } = getConfig();
        /* v2.89.26 — 에이전트별 모델 override. 사용자가 외부 연결 패널에서
           특정 에이전트에 다른 모델 할당했으면 그걸 사용. 없으면 기존 로직대로. */
        const overrideModel = getAgentModel(agentId, '');
        if (overrideModel) modelName = overrideModel;
        let isLMStudio = ollamaBase.includes('1234') || ollamaBase.includes('v1');
        let apiUrl = isLMStudio ? `${ollamaBase}/v1/chat/completions` : `${ollamaBase}/api/chat`;
        if (!isLMStudio) {
            try { await axios.get(`${ollamaBase}/api/tags`, { timeout: 1000 }); }
            catch { apiUrl = 'http://127.0.0.1:1234/v1/chat/completions'; isLMStudio = true; }
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg }
        ];

        let result = '';
        const broadcast_fn = (chunk: string) => this._broadcastCorporate({ type: 'agentChunk', agent: agentId, value: chunk });

        const signal = this._abortController?.signal;

        if (isLMStudio) {
            const body = {
                model: modelName || defaultModel,
                messages,
                stream: true,
                max_tokens: 4096,
                temperature: this._temperature,
                top_p: this._topP
            };
            const response = await axios.post(apiUrl, body, { timeout, responseType: 'stream', signal });
            await this._consumeLLMStream(response.data, signal, true, (token) => {
                result += token;
                if (broadcast) broadcast_fn(token);
            });
        } else {
            const body: any = {
                model: modelName || defaultModel,
                messages,
                stream: true,
                options: { num_ctx: 8192, num_predict: 2048, temperature: this._temperature, top_p: this._topP, top_k: this._topK }
            };
            const response = await axios.post(apiUrl, body, { timeout, responseType: 'stream', signal });
            await this._consumeLLMStream(response.data, signal, false, (token) => {
                result += token;
                if (broadcast) broadcast_fn(token);
            });
        }
        return result;
    }

    /* v2.89.38 — LLM 스트림 소비 + 유휴 타임아웃 + 안전 종료. 이전엔 stream.on('end')가
       절대 발생 안 하면 (네트워크 hang, 모델 무한 루프) 영원히 기다림 → "Designer 데이터
       가져오는 중..." 영구 멈춤. 이제 60초간 데이터 한 청크도 안 오면 자동 reject. */
    private async _consumeLLMStream(
        stream: any,
        signal: AbortSignal | undefined,
        isLMStudio: boolean,
        onToken: (token: string) => void,
    ): Promise<void> {
        const IDLE_TIMEOUT_MS = 60_000; /* 1분간 청크 없으면 hang으로 간주 */
        await new Promise<void>((resolve, reject) => {
            let buffer = '';
            let lastChunkAt = Date.now();
            let settled = false;
            const finish = (err?: Error) => {
                if (settled) return;
                settled = true;
                clearInterval(idleCheck);
                try { stream.destroy?.(); } catch { /* ignore */ }
                if (err) reject(err); else resolve();
            };
            const idleCheck = setInterval(() => {
                if (Date.now() - lastChunkAt > IDLE_TIMEOUT_MS) {
                    finish(new Error(`LLM 스트림 ${IDLE_TIMEOUT_MS / 1000}초간 응답 없음 (모델 hang 또는 네트워크 끊김)`));
                }
            }, 5_000);
            const onAbort = () => finish(new Error('aborted'));
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            stream.on('data', (chunk: Buffer) => {
                lastChunkAt = Date.now();
                buffer += chunk.toString();
                if (buffer.length > MAX_STREAM_BUFFER) buffer = buffer.slice(-MAX_STREAM_BUFFER);
                const lines = buffer.split('\n'); buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    if (isLMStudio && line.trim() === 'data: [DONE]') continue;
                    try {
                        const raw = isLMStudio && line.startsWith('data: ') ? line.slice(6) : line;
                        const json = JSON.parse(raw);
                        const token = isLMStudio
                            ? (json.choices?.[0]?.delta?.content || '')
                            : (json.message?.content || '');
                        if (token) onToken(token);
                    } catch { /* skip malformed line */ }
                }
            });
            stream.on('end', () => finish());
            stream.on('error', (err: any) => finish(err));
        });
    }

    // --------------------------------------------------------
    // Execute ALL agent actions from AI response
    // --------------------------------------------------------
    private async _executeActions(aiMessage: string): Promise<string[]> {
        const report: string[] = [];
        let brainModified = false;
        let rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        // Fallback to active editor directory if no workspace folder is open
        if (!rootPath && vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
            rootPath = path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
        }

        if (!rootPath) {
            const hasActions = /<(?:create_file|edit_file|run_command|delete_file|read_file|list_files|file)/i.test(aiMessage);
            if (hasActions) {
                report.push('❌ 폴더가 열려있지 않습니다. File → Open Folder로 폴더를 열거나 파일을 열어주세요.');
            }
            return report;
        }

        // ACTION 1: Create files
        const createRegex = /<(?:create_file|file)\s+(?:path|file|name)=['"]?([^'">]+)['"]?[^>]*>([\s\S]*?)<\/(?:create_file|file)>/gi;
        let match: RegExpExecArray | null;
        let firstCreatedFile = '';

        while ((match = createRegex.exec(aiMessage)) !== null) {
            const relPath = match[1].trim();
            let content = match[2].trim();

            // Strip markdown code fences if AI accidentally wrapped the content inside the xml
            if (content.startsWith('```')) {
                const lines = content.split('\n');
                if (lines[0].startsWith('```')) lines.shift();
                if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) lines.pop();
                content = lines.join('\n').trim();
            }

            const absPath = safeResolveInside(rootPath, relPath);
            if (!absPath) {
                report.push(`❌ 생성 차단: ${relPath} — 워크스페이스 밖으로 나가는 경로입니다.`);
                continue;
            }
            try {
                const dir = path.dirname(absPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(absPath, content, 'utf-8');
                if (absPath.startsWith(_getBrainDir())) brainModified = true;
                report.push(`✅ 생성: ${relPath}`);
                if (!firstCreatedFile) { firstCreatedFile = absPath; }
            } catch (err: any) {
                report.push(`❌ 생성 실패: ${relPath} — ${err.message}`);
            }
        }

        // Open first created file
        if (firstCreatedFile) {
            await vscode.window.showTextDocument(vscode.Uri.file(firstCreatedFile), { preview: false });
        }

        // ACTION 2: Edit files
        const editRegex = /<(?:edit_file|edit)\s+(?:path|file|name)=['"]?([^'">]+)['"]?[^>]*>([\s\S]*?)<\/(?:edit_file|edit)>/gi;
        while ((match = editRegex.exec(aiMessage)) !== null) {
            const relPath = match[1].trim();
            const body = match[2];
            const absPath = safeResolveInside(rootPath, relPath);
            if (!absPath) {
                report.push(`❌ 편집 차단: ${relPath} — 워크스페이스 밖으로 나가는 경로입니다.`);
                continue;
            }

            try {
                let fileContent = fs.readFileSync(absPath, 'utf-8');
                const findReplaceRegex = /<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>/g;
                let frMatch: RegExpExecArray | null;
                let editCount = 0;

                while ((frMatch = findReplaceRegex.exec(body)) !== null) {
                    const findText = frMatch[1];
                    const replaceText = frMatch[2];
                    if (fileContent.includes(findText)) {
                        fileContent = fileContent.split(findText).join(replaceText);
                        editCount++;
                    } else {
                        report.push(`⚠️ ${relPath}: 일치하는 텍스트를 찾지 못했습니다.`);
                    }
                }

                if (editCount > 0) {
                    fs.writeFileSync(absPath, fileContent, 'utf-8');
                    if (absPath.startsWith(_getBrainDir())) brainModified = true;
                    report.push(`✏️ 편집 완료: ${relPath} (${editCount}건 수정)`);
                    // Open edited file
                    await vscode.window.showTextDocument(vscode.Uri.file(absPath), { preview: false });
                }
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    report.push(`❌ 편집 실패: ${relPath} — 파일이 존재하지 않습니다.`);
                } else {
                    report.push(`❌ 편집 실패: ${relPath} — ${err.message}`);
                }
            }
        }

        // ACTION 3: Delete files
        const deleteRegex = /<(?:delete_file|delete)\s+(?:path|file|name)=['"]?([^'"\/\>]+)['"]?\s*\/?>(?:<\/(?:delete_file|delete)>)?/gi;
        while ((match = deleteRegex.exec(aiMessage)) !== null) {
            const relPath = match[1].trim();
            const absPath = safeResolveInside(rootPath, relPath);
            if (!absPath) {
                report.push(`❌ 삭제 차단: ${relPath} — 워크스페이스 밖으로 나가는 경로입니다.`);
                continue;
            }
            try {
                if (fs.existsSync(absPath)) {
                    const stat = fs.statSync(absPath);
                    if (stat.isDirectory()) {
                        fs.rmSync(absPath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(absPath);
                    }
                    if (absPath.startsWith(_getBrainDir())) brainModified = true;
                    report.push(`🗑️ 삭제: ${relPath}`);
                } else {
                    report.push(`⚠️ 삭제 스킵: ${relPath} — 파일이 존재하지 않습니다.`);
                }
            } catch (err: any) {
                report.push(`❌ 삭제 실패: ${relPath} — ${err.message}`);
            }
        }

        // ACTION 4: Read files — inject content back into chat history + show preview
        const readRegex = /<(?:read_file|read)\s+(?:path|file|name)=['"]?([^'">]+)['"]?\s*\/?>(?:<\/(?:read_file|read)>)?/gi;
        while ((match = readRegex.exec(aiMessage)) !== null) {
            const relPath = match[1].trim();
            const absPath = safeResolveInside(rootPath, relPath);
            if (!absPath) {
                report.push(`❌ 읽기 차단: ${relPath} — 워크스페이스 밖으로 나가는 경로입니다.`);
                continue;
            }
            try {
                if (fs.existsSync(absPath)) {
                    const content = fs.readFileSync(absPath, 'utf-8');
                    const preview = content.slice(0, 500).split('\n').slice(0, 10).join('\n');
                    report.push(`📖 읽기: ${relPath} (${content.length}자)\n\`\`\`\n${preview}...\n\`\`\``);
                    this._chatHistory.push({ role: 'user', content: `[시스템: read_file 결과]\n파일: ${relPath}\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\`` });
                } else {
                    report.push(`⚠️ 읽기 실패: ${relPath} — 파일이 존재하지 않습니다.`);
                }
            } catch (err: any) {
                report.push(`❌ 읽기 실패: ${relPath} — ${err.message}`);
            }
        }

        // ACTION 5: List directory
        const listRegex = /<(?:list_files|list_dir|ls)\s+(?:path|dir|name)=['"]?([^'"\/\>]*)['"]?\s*\/?>(?:<\/(?:list_files|list_dir|ls)>)?/gi;
        while ((match = listRegex.exec(aiMessage)) !== null) {
            const relDir = match[1].trim() || '.';
            const absDir = safeResolveInside(rootPath, relDir);
            if (!absDir) {
                report.push(`❌ 목록 차단: ${relDir} — 워크스페이스 밖으로 나가는 경로입니다.`);
                continue;
            }
            try {
                if (fs.existsSync(absDir) && fs.statSync(absDir).isDirectory()) {
                    const entries = fs.readdirSync(absDir, { withFileTypes: true });
                    const listing = entries
                        .filter(e => !e.name.startsWith('.') && !EXCLUDED_DIRS.has(e.name))
                        .map(e => e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`)
                        .join('\n');
                    report.push(`📂 목록: ${relDir}/\n\`\`\`\n${listing}\n\`\`\``);
                    this._chatHistory.push({ role: 'user', content: `[시스템: list_files 결과]\n디렉토리: ${relDir}/\n${listing}` });
                } else {
                    report.push(`⚠️ 목록 실패: ${relDir} — 디렉토리가 존재하지 않습니다.`);
                }
            } catch (err: any) {
                report.push(`❌ 목록 실패: ${relDir} — ${err.message}`);
            }
        }

        // ACTION 6: Run commands — capture output so AI can see results
        const cmdRegex = /<(?:run_command|command|bash|terminal)>([\s\S]*?)<\/(?:run_command|command|bash|terminal)>/gi;
        while ((match = cmdRegex.exec(aiMessage)) !== null) {
            let cmd = match[1].trim();
            // Clean up if AI outputs markdown inside
            if (cmd.startsWith('```')) {
                const lines = cmd.split('\n');
                if (lines[0].startsWith('```')) lines.shift();
                if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) lines.pop();
                cmd = lines.join('\n').trim();
            }
            if (!cmd) continue;

            // Live-stream the output to the chat so the user sees progress in real time
            const headerMsg = `\n\n\`\`\`bash\n$ ${cmd}\n`;
            this._view?.webview.postMessage({ type: 'streamChunk', value: headerMsg });

            try {
                const result = await runCommandCaptured(cmd, rootPath, (chunk) => {
                    this._view?.webview.postMessage({ type: 'streamChunk', value: chunk });
                });
                this._view?.webview.postMessage({ type: 'streamChunk', value: '\n```\n' });

                const status = result.timedOut
                    ? '⏱️ 60초 시간 초과로 중단됨'
                    : result.exitCode === 0
                        ? '✅ 종료 코드 0'
                        : `❌ 종료 코드 ${result.exitCode}`;
                report.push(`🖥️ 실행: \`${cmd}\` — ${status}`);

                // Inject the output back into chat history so the AI can continue with context
                // (e.g., "I see npm install failed, let me try yarn instead")
                this._chatHistory.push({
                    role: 'user',
                    content: `[시스템: run_command 결과]\n명령: ${cmd}\n종료 코드: ${result.exitCode}${result.timedOut ? ' (시간 초과)' : ''}\n출력:\n\`\`\`\n${result.output}\n\`\`\``
                });
            } catch (err: any) {
                report.push(`❌ 명령 실패: \`${cmd}\` — ${err.message}`);
                this._view?.webview.postMessage({ type: 'streamChunk', value: `\n[실행 오류] ${err.message}\n\`\`\`\n` });
            }
        }

        // ACTION 8: Read Urls (Web Scraping)
        const urlRegex = /<(?:read_url|url|fetch_url)>([\s\S]*?)<\/(?:read_url|url|fetch_url)>/gi;
        while ((match = urlRegex.exec(aiMessage)) !== null) {
            const url = match[1].trim();
            try {
                // Fetch the HTML content
                const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 10000 });
                // Strip scripts and styles first
                let cleaned = data.toString()
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                    // Strip remaining HTML tags
                    .replace(/<[^>]+>/g, ' ')
                    // Consolidate whitespaces
                    .replace(/\s+/g, ' ')
                    .trim();
                
                const preview = cleaned.slice(0, 500);
                report.push(`🌐 웹사이트 읽기: ${url} (${cleaned.length}자)\n\`\`\`\n${preview}...\n\`\`\``);
                this._chatHistory.push({ role: 'user', content: `[시스템: read_url 결과]\nURL: ${url}\n\`\`\`\n${cleaned.slice(0, 15000)}\n\`\`\`` });
            } catch (err: any) {
                report.push(`❌ 웹사이트 접속 실패: ${url} — ${err.message}`);
                this._chatHistory.push({ role: 'user', content: `[시스템: read_url 실패]\n${err.message}` });
            }
        }

        // ACTION 7: Read Second Brain documents
        const brainReadRegex = /<read_brain>([\s\S]*?)<\/read_brain>/gi;
        while ((match = brainReadRegex.exec(aiMessage)) !== null) {
            const filename = match[1].trim();
            if (!filename) continue;
            const content = this._readBrainFile(filename);
            report.push(`🧠 두뇌 파일 읽기: ${filename}`);
            this._chatHistory.push({ role: 'user', content: `[시스템: read_brain 결과]\n파일: ${filename}\n\`\`\`\n${content.slice(0, 15000)}\n\`\`\`` });
        }

        // FALLBACK: If AI used markdown code blocks with filenames instead of XML tags
        if (report.length === 0) {
            const fallbackRegex = /```(?:[a-zA-Z]*)?\s*\n\/\/\s*(?:file|파일):\s*([^\n]+)\n([\s\S]*?)```/gi;
            while ((match = fallbackRegex.exec(aiMessage)) !== null) {
                const relPath = match[1].trim();
                const content = match[2].trim();
                if (relPath && content && relPath.includes('.')) {
                    const absPath = safeResolveInside(rootPath, relPath);
                    if (!absPath) {
                        report.push(`❌ 생성 차단: ${relPath} — 워크스페이스 밖으로 나가는 경로입니다.`);
                        continue;
                    }
                    try {
                        const dir = path.dirname(absPath);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(absPath, content, 'utf-8');
                        report.push(`✅ 생성(자동감지): ${relPath}`);
                        if (!firstCreatedFile) firstCreatedFile = absPath;
                    } catch (err: any) {
                        report.push(`❌ 생성 실패: ${relPath} — ${err.message}`);
                    }
                }
            }
            if (firstCreatedFile) {
                await vscode.window.showTextDocument(vscode.Uri.file(firstCreatedFile), { preview: false });
            }
        }

        // Show notification
        const successCount = report.filter(r => r.startsWith('✅') || r.startsWith('✏️') || r.startsWith('🖥️') || r.startsWith('🗑️') || r.startsWith('📖') || r.startsWith('📂')).length;
        if (successCount > 0) {
            vscode.window.showInformationMessage(`Connect AI: ${successCount}개 에이전트 작업 완료!`);
        }

        // Auto-Push Second Brain changes to Cloud
        if (brainModified) {
            _safeGitAutoSync(_getBrainDir(), `[P-Reinforce] Auto-synced structured knowledge`, this);
        }

        return report;
    }

    // Strip raw XML action tags from display message
    private _stripActionTags(text: string): string {
        return text
            .replace(/<(?:create_file|file)\s+[^>]*>[\s\S]*?<\/(?:create_file|file)>/gi, '')
            .replace(/<(?:edit_file|edit)\s+[^>]*>[\s\S]*?<\/(?:edit_file|edit)>/gi, '')
            .replace(/<(?:delete_file|delete)\s+[^>]*\s*\/?>(?:<\/(?:delete_file|delete)>)?/gi, '')
            .replace(/<(?:read_file|read)\s+[^>]*\s*\/?>(?:<\/(?:read_file|read)>)?/gi, '')
            .replace(/<(?:list_files|list_dir|ls)\s+[^>]*\s*\/?>(?:<\/(?:list_files|list_dir|ls)>)?/gi, '')
            .replace(/<(?:run_command|command|bash|terminal)>[\s\S]*?<\/(?:run_command|command|bash|terminal)>/gi, '')
            .replace(/<(?:read_brain)>[\s\S]*?<\/(?:read_brain)>/gi, '')
            .replace(/<(?:read_url|url|fetch_url)>[\s\S]*?<\/(?:read_url|url|fetch_url)>/gi, '')
            .trim();
    }


    // ============================================================
    // Webview HTML — CINEMATIC UI v3 (Content-Grade Visuals)
    // ============================================================

    private _getHtml(): string {
        // v2.89.59 — sidebar webview HTML/CSS/JS extracted to assets/webview/sidebar.html
        // for safer editing and pre-build syntax verification (node --check). Single-file
        // extension.ts had multiple webview-script syntax errors that killed all UI;
        // separate file lets us run node --check before publishing.
        const htmlPath = path.join(this._extensionUri.fsPath, 'assets', 'webview', 'sidebar.html');
        try {
            return fs.readFileSync(htmlPath, 'utf-8');
        } catch (e: any) {
            return `<!DOCTYPE html><html><body style="background:#111;color:#fff;padding:24px;font-family:-apple-system"><h2>⚠️ Webview HTML 로드 실패</h2><pre>${(e?.message || e).toString()}</pre><p>경로: ${htmlPath}</p></body></html>`;
        }
    }
}
