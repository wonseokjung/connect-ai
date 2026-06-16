/* runtime-state.ts — 교차 모듈 런타임 싱글톤 홀더.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존).
 *
 * 여러 모듈(company·telegram·schedulers·panels)이 공유하는 vscode.ExtensionContext 를
 * 한 곳에서 보관한다. getter 함수 대신 holder 객체로 노출하는 이유: TypeScript strict
 * 모드의 null-narrowing 을 보존하기 위함. `if (runtime.extCtx) { runtime.extCtx.x }` 는
 * 좁혀지지만 `if (getExtCtx()) { getExtCtx().x }` 는 좁혀지지 않아 컴파일 에러가 난다. */
import * as vscode from 'vscode';

/* extCtx: 확장 컨텍스트 (activate 에서 1회 설정).
 * autoSyncRunning: 두뇌 git 자동/수동 동기화 동시 실행 방지 락. _safeGitAutoSync(git-sync)와
 *   SidebarChatProvider 수동 동기화·상태 패널이 공유하므로 holder 에 둔다. */
export const runtime: {
    extCtx: vscode.ExtensionContext | null;
    autoSyncRunning: boolean;
} = { extCtx: null, autoSyncRunning: false };
