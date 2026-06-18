/* config.ts — VS Code 설정 읽기 + 두뇌폴더 보장 + 프롬프트/툴시드 로더.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: vscode·fs·path + ./paths (두뇌폴더 경로). extension 내부 상태 참조 없음.
 * __dirname 은 esbuild 번들 출력 위치(out/)이라 ../assets 로 한 단계 위 — 분리 후에도 동일. */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { _getBrainDir, _isBrainDirExplicitlySet } from './paths';

// Settings are read from VS Code configuration (File > Preferences > Settings)
export function getConfig() {
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

/* v2.89.91 — 엔진 감지 헬퍼. 이전엔 `isLMStudio = ollamaBase.includes('1234')
   || ollamaBase.includes('v1')` 가 13군데 동일하게 박혀 있었음. LM Studio가
   포트나 경로 컨벤션을 바꾸면 13곳 모두 고쳐야 했고, 한 곳을 빠뜨리면
   다른 엔진으로 라우팅되는 사고. 한 함수로 통합. */
export function _isLMStudioEngine(ollamaBase: string): boolean {
    /* v2.89.98 — 진짜 원인 잡힘! v2.89.91 sed 일괄 치환이 이 함수의 본체까지
       `_isLMStudioEngine(ollamaBase)`로 바꿔버려 자기 자신을 무한 호출 →
       Maximum call stack. 사용자가 chat·corp 양쪽 모드에서 어떤 LLM 호출도
       이 헬퍼를 거치니 전 라인이 마비됐었음. 원래 로직 복원: 1234 포트 또는
       /v1 경로면 LM Studio. */
    return ollamaBase.includes('1234') || ollamaBase.includes('v1');
}

export async function _ensureBrainDir(): Promise<string | null> {
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

export const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.vscode', 'out', 'dist', 'build',
    '.next', '.cache', '__pycache__', '.DS_Store', 'coverage',
    '.turbo', '.nuxt', '.output', 'vendor', 'target'
]);
export const MAX_CONTEXT_SIZE = 12_000; // chars

/* v2.89.61 — 9개 LLM 프롬프트(SYSTEM, CEO_*, SECRETARY_*) 를 assets/prompts/ 에 .md
   파일로 분리. 익스텐션 로드 시 한 번 읽어 메모리에 캐시. 프롬프트 수정이 코드
   수정 없이 가능 + 줄 수 287줄 절약 + IDE에서 markdown 미리보기로 검토 가능.
   __dirname는 esbuild 번들 출력 위치(extension/out)이라 ../assets/prompts 로 한 단계 위. */
const _PROMPTS_DIR = path.join(__dirname, '..', 'assets', 'prompts');
const _promptCache = new Map<string, string>();
export function _loadPrompt(file: string): string {
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
export function _loadToolSeed(rel: string): string {
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
