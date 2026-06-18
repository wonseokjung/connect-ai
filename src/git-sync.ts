/* git-sync.ts — 두뇌·회사 폴더의 GitHub 자동 동기화 (commit→fetch→ff-merge→push).
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: vscode·fs·path + core/git(원시 git 호출) + paths(폴더) + runtime-state(공유 락).
 *   - runtime.autoSyncRunning: 두뇌 sync 공유 락 (수동 동기화·상태 패널과 공유).
 *   - _companySyncRunning: 회사 sync 전용 락 (이 모듈 내부 전용 — 두뇌와 병렬 실행 허용).
 * provider 파라미터는 호출처가 넘기는 SidebarChatProvider (duck-typed: injectSystemMessage·
 * _syncSecondBrain). 본문 역참조 없음. */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { gitExecSafe, gitRun, isGitAvailable, validateGitRemoteUrl, classifyGitError, getRemoteDefaultBranch, ensureInitialCommit, ensureBrainGitignore } from './core/git';
import { _getBrainDir, getCompanyDir } from './paths';
import { runtime } from './runtime-state';

/* 회사 폴더 sync 전용 락 — 두뇌 sync(runtime.autoSyncRunning)와 병렬 실행 가능하게 분리. */
let _companySyncRunning = false;

export async function _safeGitAutoSync(brainDir: string, commitMsg: string, provider: any = null) {
    if (runtime.autoSyncRunning) return; // dedup: another auto-sync (or manual sync) is already running
    runtime.autoSyncRunning = true;

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
        runtime.autoSyncRunning = false;
    }
}

/* Company-folder git sync (separate from brain). Only meaningful when the
   company is DETACHED (lives outside <brain>/_company/) AND the user has
   set `connectAiLab.companyRepo`. Otherwise no-op — company is already
   covered by brain sync (nested) or user hasn't asked for backup. Uses
   its own lock so it can run in parallel with brain sync. */
export async function _safeGitAutoSyncCompany(commitMsg: string, provider: any = null) {
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
