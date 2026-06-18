/* runtime-state.ts — 교차 모듈 런타임 싱글톤 홀더.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존).
 *
 * 여러 모듈(company·telegram·schedulers·panels)이 공유하는 vscode.ExtensionContext 를
 * 한 곳에서 보관한다. getter 함수 대신 holder 객체로 노출하는 이유: TypeScript strict
 * 모드의 null-narrowing 을 보존하기 위함. `if (runtime.extCtx) { runtime.extCtx.x }` 는
 * 좁혀지지만 `if (getExtCtx()) { getExtCtx().x }` 는 좁혀지지 않아 컴파일 에러가 난다. */
import * as vscode from 'vscode';

/* SidebarChatProvider 의 공개 표면 중 다른 모듈(telegram·schedulers·approvals·panels·
 * brain-network 등)이 호출하는 메서드만 추린 구조적 인터페이스. SidebarChatProvider 는
 * extension.ts 에 정의돼 여기서 import 하면 순환이 되므로, 호출 표면만 인터페이스로 고정한다.
 * SidebarChatProvider 가 이 메서드들을 모두 가지므로 구조적으로 대입 가능(implements 불필요). */
export interface ChatProviderLike {
    postSystemNote(text: string, icon?: string): void;
    pulseAgent(agent: string, icon?: string, ms?: number, log?: string): void;
    startAutoCycle(intervalMin?: number, idleMin?: number): void;
    stopAutoCycle(): void;
    sendPromptFromExtension(prompt: string, opts?: { fromTelegram?: boolean; corporate?: boolean }): void;
    runCorporatePromptExternal(prompt: string, modelName: string): Promise<void>;
    registerExternalGraphPanel(panel: vscode.WebviewPanel): void;
    triggerAgentDockReload(): void;
    getDefaultModel(): string;
    abortActiveDispatch(): { cancelled: boolean; what?: string };
    getDispatchSnapshot(): { current: { prompt: string; priority: string; elapsedSec: number } | null; queueLength: number; queue: Array<{ priority: string; prompt: string }> };
}

/* 승인 패널 프로바이더의 호출 표면(refresh). approvals 모듈이 패널을 새로고침하는데, 패널 클래스는
 * extension.ts 에 남으므로 호출 표면만 인터페이스로 고정. */
export interface ApprovalsPanelLike {
    refresh(): void;
}

/* extCtx: 확장 컨텍스트 (activate 에서 1회 설정).
 * autoSyncRunning: 두뇌 git 자동/수동 동기화 동시 실행 방지 락. _safeGitAutoSync(git-sync)와
 *   SidebarChatProvider 수동 동기화·상태 패널이 공유하므로 holder 에 둔다.
 * activeChatProvider: 활성 사이드바 채팅 프로바이더. telegram·schedulers·approvals·패널 등
 *   거의 모든 서브시스템이 ?. 로 접근하므로 holder 로 공유 (38곳). */
export const runtime: {
    extCtx: vscode.ExtensionContext | null;
    autoSyncRunning: boolean;
    activeChatProvider: ChatProviderLike | null;
    approvalsPanelProvider: ApprovalsPanelLike | null;
} = { extCtx: null, autoSyncRunning: false, activeChatProvider: null, approvalsPanelProvider: null };
