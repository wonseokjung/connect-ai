
module.exports = {
  workspace: { getConfiguration: () => ({ get: (k, d) => d }) },
  window: { showInformationMessage:()=>{}, showErrorMessage:()=>{}, showWarningMessage:()=>{}, showInputBox:()=>Promise.resolve(''), showOpenDialog:()=>Promise.resolve(undefined), createWebviewPanel:()=>({ webview:{ html:'', postMessage:()=>{} }, dispose:()=>{}, onDidDispose:()=>{}, reveal:()=>{} }), withProgress:(o,fn)=>fn({report:()=>{}},{onCancellationRequested:()=>{}}), showQuickPick:()=>Promise.resolve(undefined), showInformationMessage:()=>Promise.resolve(undefined) },
  commands: { registerCommand:()=>({ dispose:()=>{} }), executeCommand:()=>Promise.resolve() },
  Uri: { file: (s) => ({ fsPath: s, with: () => ({}) }), parse: (s) => ({ toString: () => s }) },
  ConfigurationTarget: { Global: 1 },
  ProgressLocation: { Notification: 15 },
  env: { openExternal: ()=>Promise.resolve() },
  ExtensionContext: function(){},
  EventEmitter: function(){this.event=()=>{};this.fire=()=>{};},
};
