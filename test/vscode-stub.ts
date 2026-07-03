// test/vscode-stub.ts — src/orders.ts 가 import 하는 vscode 의 테스트용 stub.
// orders.ts → paths.ts 가 vscode.workspace.getConfiguration 을 쓰므로, 테스트 시
// brain 폴더를 가리키는 stub 으로 대체. 각 테스트에서 setBrainDir() 로 경로 주입.
let _brainDir = '';

export function setBrainDir(p: string) { _brainDir = p; }

const noop = () => {};
export const workspace = {
  getConfiguration: () => ({
    get: (key: string, def: any) => key === 'localBrainPath' ? _brainDir : (key === 'companyDir' ? '' : def),
    update: noop,
  }),
  fs: { exists: noop },
};
export const window = { showInformationMessage: noop, showErrorMessage: noop, showInputBox: noop, showQuickPick: noop };
export const commands = { registerCommand: noop, executeCommand: noop };
export const Uri = { file: (p: string) => ({ fsPath: p }) };
export const ConfigurationTarget = { Global: 1 };
export default { workspace, window, commands, Uri, ConfigurationTarget };
