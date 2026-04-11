import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Connect AI LAB — Full Agentic Local AI for VS Code
// 100% Offline · File Create · File Edit · Terminal · Multi-file Context
// ============================================================

// Settings are read from VS Code configuration (File > Preferences > Settings)
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    return {
        ollamaBase: cfg.get<string>('ollamaUrl', 'http://127.0.0.1:11434'),
        defaultModel: cfg.get<string>('defaultModel', 'gemma4:e2b'),
        maxTreeFiles: cfg.get<number>('maxContextFiles', 200),
        timeout: cfg.get<number>('requestTimeout', 300) * 1000,
    };
}

const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.vscode', 'out', 'dist', 'build',
    '.next', '.cache', '__pycache__', '.DS_Store', 'coverage',
    '.turbo', '.nuxt', '.output', 'vendor', 'target'
]);
const MAX_CONTEXT_SIZE = 40_000; // chars

const SYSTEM_PROMPT = `You are "Connect AI LAB", a premium agentic AI coding assistant running 100% offline on the user's machine.

You have THREE powerful agent actions. Use them whenever appropriate:

━━━ ACTION 1: CREATE NEW FILES ━━━
<create_file path="relative/path/file.ext">
file content here
</create_file>

━━━ ACTION 2: EDIT EXISTING FILES ━━━
<edit_file path="relative/path/file.ext">
<find>exact text to find in the file</find>
<replace>replacement text</replace>
</edit_file>
You can have multiple <find>/<replace> pairs inside one <edit_file> block.

━━━ ACTION 3: RUN TERMINAL COMMANDS ━━━
<run_command>npm install express</run_command>

RULES:
1. ALWAYS respond in the same language the user uses.
2. Use agent actions automatically when the user's request requires creating, editing files, or running commands.
3. Outside of action blocks, briefly explain what you did.
4. For code that is just for explanation (not to be saved), use standard markdown code fences.
5. Be concise, professional, and helpful.
6. When editing files, the <find> text must EXACTLY match existing content in the file.`;

// ============================================================
// Extension Activation
// ============================================================

export function activate(context: vscode.ExtensionContext) {
    console.log('Connect AI LAB extension activated.');

    const provider = new SidebarChatProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('local-ai-chat-view', provider, {
            webviewOptions: { retainContextWhenHidden: true }
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
}

export function deactivate() {}

// ============================================================
// Sidebar Chat Provider
// ============================================================

class SidebarChatProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _chatHistory: { role: string; content: string }[] = [];
    private _terminal?: vscode.Terminal;
    private _ctx: vscode.ExtensionContext;

    // 대화 표시용 (system prompt 제외, 유저에게 보여줄 것만 저장)
    private _displayMessages: { text: string; role: string }[] = [];

    constructor(private readonly _extensionUri: vscode.Uri, ctx: vscode.ExtensionContext) {
        this._ctx = ctx;
        this._restoreHistory();
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

    private _initHistory() {
        this._chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
        this._displayMessages = [];
    }

    public resetChat() {
        this._initHistory();
        this._saveHistory();
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearChat' });
        }
        vscode.window.showInformationMessage('Connect AI LAB: 새 대화가 시작되었습니다.');
    }

    /** 대화를 Markdown 파일로 내보내기 */
    public async exportChat() {
        if (this._displayMessages.length === 0) {
            vscode.window.showWarningMessage('내보낼 대화가 없습니다.');
            return;
        }
        let md = `# Connect AI LAB — 대화 기록\n\n_${new Date().toLocaleString('ko-KR')}_\n\n---\n\n`;
        for (const m of this._displayMessages) {
            const label = m.role === 'user' ? '**👤 You**' : '**✦ Connect AI LAB**';
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

    /** 외부에서 프롬프트 전송 (예: 코드 선택 → 설명) */
    public sendPromptFromExtension(prompt: string) {
        if (this._view) {
            this._view.show?.(true);
            // 약간의 딜레이 후 전송 (뷰가 보이기를 기다림)
            setTimeout(() => {
                this._view?.webview.postMessage({ type: 'injectPrompt', value: prompt });
            }, 300);
        }
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
        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'prompt':
                    await this._handlePrompt(msg.value, msg.model);
                    break;
                case 'getModels':
                    await this._sendModels();
                    break;
                case 'newChat':
                    this.resetChat();
                    break;
                case 'ready':
                    // 웹뷰가 준비되면 저장된 대화 기록 복원
                    this._restoreDisplayMessages();
                    break;
            }
        });
    }

    // --------------------------------------------------------
    // Fetch installed Ollama models
    // --------------------------------------------------------
    private async _sendModels() {
        if (!this._view) { return; }
        const { ollamaBase, defaultModel } = getConfig();
        try {
            const res = await axios.get(`${ollamaBase}/api/tags`);
            const models: string[] = res.data.models.map((m: any) => m.name);
            this._view.webview.postMessage({ type: 'modelsList', value: models });
        } catch {
            this._view.webview.postMessage({ type: 'modelsList', value: [defaultModel] });
        }
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
            result += `\n\n[프로젝트 파일 구조]\n${lines.join('\n')}`;
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
        const MAX_AUTO_READ = 15_000; // chars total

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
    // Handle user prompt → Ollama → agent actions → response
    // --------------------------------------------------------
    private async _handlePrompt(prompt: string, modelName: string) {
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

            // 3. Push user message
            this._chatHistory.push({
                role: 'user',
                content: prompt + contextBlock + workspaceCtx
            });

            // 저장용: 유저 메시지 기록 (프롬프트만, 컨텍스트 제외)
            this._displayMessages.push({ text: prompt, role: 'user' });

            // 4. Call Ollama
            const { ollamaBase, defaultModel, timeout } = getConfig();
            const response = await axios.post(`${ollamaBase}/api/chat`, {
                model: modelName || defaultModel,
                messages: this._chatHistory,
                stream: false,
            }, { timeout });

            const aiMessage: string = response.data.message.content;
            this._chatHistory.push({ role: 'assistant', content: aiMessage });

            // 5. Execute agent actions
            const report = this._executeActions(aiMessage);

            // 6. Send to webview
            let output = aiMessage;
            if (report.length > 0) {
                output += `\n\n---\n📦 **에이전트 작업 결과**\n${report.join('\n')}`;
            }
            this._view.webview.postMessage({ type: 'response', value: output });

            // 저장용: AI 응답 기록
            this._displayMessages.push({ text: output, role: 'ai' });
            this._saveHistory();

        } catch (error: any) {
            const errMsg = error.code === 'ECONNREFUSED'
                ? '⚠️ Ollama 서버에 연결할 수 없습니다.\n터미널에서 `ollama serve`를 실행해주세요.'
                : `⚠️ 오류: ${error.message}`;
            this._view.webview.postMessage({ type: 'error', value: errMsg });
        }
    }

    // --------------------------------------------------------
    // Execute ALL agent actions from AI response
    // --------------------------------------------------------
    private _executeActions(aiMessage: string): string[] {
        const report: string[] = [];
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (!rootPath) {
            const hasActions = /<create_file|<edit_file|<run_command/.test(aiMessage);
            if (hasActions) {
                report.push('❌ 폴더가 열려있지 않습니다. File → Open Folder로 폴더를 먼저 열어주세요.');
            }
            return report;
        }

        // ACTION 1: Create files
        const createRegex = /<create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/g;
        let match: RegExpExecArray | null;
        let firstCreatedFile = '';

        while ((match = createRegex.exec(aiMessage)) !== null) {
            const relPath = match[1].trim();
            const content = match[2].replace(/^\n/, ''); // remove leading newline only
            try {
                const absPath = path.join(rootPath, relPath);
                const dir = path.dirname(absPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(absPath, content, 'utf-8');
                report.push(`✅ 생성: ${relPath}`);
                if (!firstCreatedFile) { firstCreatedFile = absPath; }
            } catch (err: any) {
                report.push(`❌ 생성 실패: ${relPath} — ${err.message}`);
            }
        }

        // Open first created file
        if (firstCreatedFile) {
            vscode.window.showTextDocument(vscode.Uri.file(firstCreatedFile), { preview: false });
        }

        // ACTION 2: Edit files
        const editRegex = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/g;
        while ((match = editRegex.exec(aiMessage)) !== null) {
            const relPath = match[1].trim();
            const body = match[2];
            const absPath = path.join(rootPath, relPath);

            if (!fs.existsSync(absPath)) {
                report.push(`❌ 편집 실패: ${relPath} — 파일이 존재하지 않습니다.`);
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
                        fileContent = fileContent.replace(findText, replaceText);
                        editCount++;
                    } else {
                        report.push(`⚠️ ${relPath}: 일치하는 텍스트를 찾지 못했습니다.`);
                    }
                }

                if (editCount > 0) {
                    fs.writeFileSync(absPath, fileContent, 'utf-8');
                    report.push(`✏️ 편집 완료: ${relPath} (${editCount}건 수정)`);
                    // Open edited file
                    vscode.window.showTextDocument(vscode.Uri.file(absPath), { preview: false });
                }
            } catch (err: any) {
                report.push(`❌ 편집 실패: ${relPath} — ${err.message}`);
            }
        }

        // ACTION 3: Run commands
        const cmdRegex = /<run_command>([\s\S]*?)<\/run_command>/g;
        while ((match = cmdRegex.exec(aiMessage)) !== null) {
            const cmd = match[1].trim();
            try {
                if (!this._terminal || this._terminal.exitStatus !== undefined) {
                    this._terminal = vscode.window.createTerminal({
                        name: '🚀 Connect AI LAB',
                        cwd: rootPath
                    });
                }
                this._terminal.show();
                this._terminal.sendText(cmd);
                report.push(`🖥️ 실행: ${cmd}`);
            } catch (err: any) {
                report.push(`❌ 명령 실패: ${cmd} — ${err.message}`);
            }
        }

        // Show notification
        const successCount = report.filter(r => r.startsWith('✅') || r.startsWith('✏️') || r.startsWith('🖥️')).length;
        if (successCount > 0) {
            vscode.window.showInformationMessage(`Connect AI LAB: ${successCount}개 에이전트 작업 완료!`);
        }

        return report;
    }


    // ============================================================
    // Webview HTML — Premium UI v2
    // ============================================================
    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Connect AI LAB</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark-dimmed.min.css">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#111113;--bg2:#18181b;--surface:#1e1e22;--surface2:#27272b;
  --border:rgba(255,255,255,.08);--border2:rgba(255,255,255,.12);
  --text:#a1a1aa;--text-bright:#fafafa;--text-dim:#52525b;
  --accent:#818cf8;--accent2:#c084fc;--accent-glow:rgba(129,140,248,.15);
  --input-bg:#1a1a1e;--code-bg:#0c0c0e;
  --green:#34d399;--yellow:#fbbf24;--cyan:#22d3ee;--red:#fb7185;
}
html,body{height:100%;font-family:'Inter',-apple-system,system-ui,sans-serif;font-size:13px;background:var(--bg);color:var(--text);display:flex;flex-direction:column;overflow:hidden}
.header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(17,17,19,.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);flex-shrink:0;position:relative;z-index:10}
.header::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2),transparent);opacity:.3}
.header-left{display:flex;align-items:center;gap:10px}
.logo{width:24px;height:24px;border-radius:6px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;box-shadow:0 0 12px rgba(129,140,248,.3)}
.brand{font-weight:700;font-size:13px;color:var(--text-bright);letter-spacing:-.3px}
.header-right{display:flex;align-items:center;gap:6px}
select{background:var(--surface);color:var(--text-bright);border:1px solid var(--border2);padding:5px 10px;border-radius:6px;font-size:11px;font-family:inherit;cursor:pointer;outline:none;max-width:140px;transition:border-color .2s}
select:hover,select:focus{border-color:var(--accent)}
.btn-icon{background:var(--surface);border:1px solid var(--border2);color:var(--text-dim);width:28px;height:28px;border-radius:6px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
.btn-icon:hover{background:var(--surface2);color:var(--text-bright);border-color:var(--accent);box-shadow:0 0 8px var(--accent-glow)}
.chat{flex:1;overflow-y:auto;padding:20px 16px;display:flex;flex-direction:column;gap:20px}
.chat::-webkit-scrollbar{width:3px}.chat::-webkit-scrollbar-track{background:transparent}.chat::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
.msg{display:flex;flex-direction:column;gap:6px;animation:msgIn .3s ease-out}
.msg-head{display:flex;align-items:center;gap:8px;font-weight:600;font-size:11.5px;color:var(--text)}
.msg-time{font-weight:400;font-size:10px;color:var(--text-dim);margin-left:auto}
.av{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.av-user{background:var(--surface2);color:var(--text)}.av-ai{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 0 8px rgba(129,140,248,.2)}
.msg-body{padding-left:30px;line-height:1.7;color:var(--text);white-space:pre-wrap;word-break:break-word;font-size:13px}
.msg-user .msg-body{background:var(--surface);border:1px solid var(--border2);border-radius:12px;padding:10px 14px;margin-left:30px;color:var(--text-bright)}
.msg-body pre{background:var(--code-bg);border:1px solid var(--border2);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:8px 0;font-size:12px;line-height:1.55}
.msg-body code{font-family:'SF Mono','Fira Code','Cascadia Code','Menlo',monospace;font-size:12px}
.msg-body :not(pre)>code{background:rgba(129,140,248,.1);color:var(--accent);padding:1px 6px;border-radius:4px;border:1px solid rgba(129,140,248,.15)}
.code-wrap{position:relative}
.code-lang{position:absolute;top:0;left:14px;background:var(--surface2);color:var(--text-dim);padding:1px 8px;border-radius:0 0 4px 4px;font-size:9px;font-family:'SF Mono',monospace;text-transform:uppercase;letter-spacing:.5px}
.copy-btn{position:absolute;top:6px;right:8px;background:var(--surface2);border:1px solid var(--border2);color:var(--text-dim);padding:3px 10px;border-radius:5px;font-size:10px;cursor:pointer;opacity:0;transition:all .2s;font-family:inherit;z-index:1}
.code-wrap:hover .copy-btn{opacity:1}.copy-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.copy-btn.copied{background:var(--green);color:#fff;border-color:var(--green);opacity:1}
.file-badge{background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.2);border-radius:8px 8px 0 0;border-bottom:none;padding:8px 14px;font-size:11px;font-weight:600;color:var(--yellow);display:flex;align-items:center;gap:6px}
.file-badge+.code-wrap pre{border-top-left-radius:0;border-top-right-radius:0;margin-top:0}
.edit-badge{background:rgba(34,211,238,.06);border:1px solid rgba(34,211,238,.2);border-radius:8px 8px 0 0;border-bottom:none;padding:8px 14px;font-size:11px;font-weight:600;color:var(--cyan);display:flex;align-items:center;gap:6px}
.edit-badge+.code-wrap pre{border-top-left-radius:0;border-top-right-radius:0;margin-top:0}
.cmd-badge{background:rgba(129,140,248,.06);border:1px solid rgba(129,140,248,.2);border-radius:8px;padding:10px 14px;margin:8px 0;font-size:12px;color:var(--accent);font-family:'SF Mono','Menlo',monospace;display:flex;align-items:center;gap:8px}
.agent-report{background:rgba(52,211,153,.06);border:1px solid rgba(52,211,153,.2);border-radius:8px;padding:12px 14px;margin-top:8px;font-size:12px;line-height:1.7}
.msg-error .msg-body{color:var(--red)}
.welcome{text-align:center;padding:30px 20px 10px}
.welcome-logo{width:48px;height:48px;border-radius:14px;margin:0 auto 14px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;box-shadow:0 0 30px rgba(129,140,248,.25)}
.welcome-title{font-size:18px;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
.welcome-sub{color:var(--text-dim);font-size:12px;line-height:1.6;margin-bottom:16px}
.welcome-features{display:flex;justify-content:center;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.wf{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text)}.wf-icon{font-size:14px}
.quick-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.qa-btn{background:var(--surface);border:1px solid var(--border2);color:var(--text);padding:8px 14px;border-radius:8px;font-size:11px;cursor:pointer;transition:all .2s;font-family:inherit}
.qa-btn:hover{border-color:var(--accent);color:var(--text-bright);background:var(--surface2);box-shadow:0 0 12px var(--accent-glow)}
.loading-wrap{padding-left:30px;padding-top:6px;display:flex;align-items:center;gap:8px}
.loading-bar{width:120px;height:3px;background:var(--surface2);border-radius:3px;overflow:hidden;position:relative}
.loading-bar::after{content:'';position:absolute;top:0;left:-40px;width:40px;height:100%;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2),transparent);animation:shimmer 1.2s ease-in-out infinite}
.loading-text{font-size:11px;color:var(--text-dim);animation:pulse 2s ease-in-out infinite}
.input-wrap{padding:10px 16px 16px;flex-shrink:0;position:relative}
.input-box{background:var(--input-bg);border:1px solid var(--border2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;transition:all .2s;position:relative}
.input-box::before{content:'';position:absolute;inset:-1px;border-radius:13px;background:linear-gradient(135deg,var(--accent),var(--accent2));opacity:0;transition:opacity .3s;z-index:-1}
.input-box:focus-within{border-color:transparent}.input-box:focus-within::before{opacity:.4}
textarea{width:100%;background:transparent;border:none;color:var(--text-bright);font-family:inherit;font-size:13px;line-height:1.5;resize:none;outline:none;min-height:22px;max-height:150px}
textarea::placeholder{color:var(--text-dim)}
.input-footer{display:flex;align-items:center;justify-content:space-between}
.input-hint{font-size:10px;color:var(--text-dim)}
.input-btns{display:flex;gap:5px}
.send-btn{background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;color:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .15s;box-shadow:0 2px 8px rgba(129,140,248,.25)}
.send-btn:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(129,140,248,.35)}.send-btn:active{transform:scale(.94)}.send-btn:disabled{opacity:.25;cursor:not-allowed;transform:none;box-shadow:none}
.stop-btn{background:var(--red);border:none;color:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:11px}
.stop-btn.visible{display:flex}
@keyframes msgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes shimmer{0%{left:-40px}100%{left:120px}}
@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
</style></head><body>
<div class="header"><div class="header-left"><div class="logo">\u2726</div><span class="brand">Connect AI LAB</span></div><div class="header-right"><select id="modelSel"></select><button class="btn-icon" id="newChatBtn" title="New Chat">+</button></div></div>
<div class="chat" id="chat">
<div class="welcome">
<div class="welcome-logo">\u2726</div>
<div class="welcome-title">Connect AI LAB</div>
<div class="welcome-sub">100% \ub85c\uceec \u00b7 100% \uc624\ud504\ub77c\uc778 \u00b7 100% \ubb34\ub8cc<br>\ud504\ub85c\uc81d\ud2b8\ub97c \uc774\ud574\ud558\uace0, \ucf54\ub4dc\ub97c \uc791\uc131\ud558\uace0, \uc2e4\ud589\ud569\ub2c8\ub2e4.</div>
<div class="welcome-features"><div class="wf"><span class="wf-icon">\ud83d\udcc1</span> \ud30c\uc77c \uc0dd\uc131</div><div class="wf"><span class="wf-icon">\u270f\ufe0f</span> \ucf54\ub4dc \ud3b8\uc9d1</div><div class="wf"><span class="wf-icon">\ud83d\udda5\ufe0f</span> \ud130\ubbf8\ub110</div><div class="wf"><span class="wf-icon">\ud83d\udd0d</span> \ubd84\uc11d</div></div>
<div class="quick-actions">
<button class="qa-btn" data-prompt="\uac04\ub2e8\ud55c \ud3ec\ud2b8\ud3f4\ub9ac\uc624 \uc6f9\uc0ac\uc774\ud2b8\ub97c \ub9cc\ub4e4\uc5b4\uc918">\ud83c\udf10 \uc6f9\uc0ac\uc774\ud2b8 \uc0dd\uc131</button>
<button class="qa-btn" data-prompt="Express API \uc11c\ubc84\ub97c \ub9cc\ub4e4\uc5b4\uc918">\u26a1 API \uc11c\ubc84</button>
<button class="qa-btn" data-prompt="\uc774 \ud504\ub85c\uc81d\ud2b8\uc758 \uad6c\uc870\ub97c \ubd84\uc11d\ud574\uc918">\ud83d\udd0d \ud504\ub85c\uc81d\ud2b8 \ubd84\uc11d</button>
<button class="qa-btn" data-prompt="README.md\ub97c \uc791\uc131\ud574\uc918">\ud83d\udcdd README</button>
</div></div></div>
<div class="input-wrap"><div class="input-box">
<textarea id="input" rows="1" placeholder="\ubb34\uc5c7\uc744 \ub9cc\ub4e4\uc5b4 \ub4dc\ub9b4\uae4c\uc694?"></textarea>
<div class="input-footer"><span class="input-hint">Enter \uc804\uc1a1 \u00b7 Shift+Enter \uc904\ubc14\uafc8</span>
<div class="input-btns"><button class="stop-btn" id="stopBtn">\u25a0</button><button class="send-btn" id="sendBtn">\u2191</button></div></div></div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
<script>
const vscode=acquireVsCodeApi(),chat=document.getElementById('chat'),input=document.getElementById('input'),
sendBtn=document.getElementById('sendBtn'),stopBtn=document.getElementById('stopBtn'),
modelSel=document.getElementById('modelSel'),newChatBtn=document.getElementById('newChatBtn');
let loader=null,sending=false;
vscode.postMessage({type:'getModels'});
setTimeout(()=>vscode.postMessage({type:'ready'}),300);
input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px'});
function getTime(){return new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}
function esc(s){const d=document.createElement('div');d.innerText=s;return d.innerHTML}
function fmt(t){
  t=t.replace(/<create_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/create_file>/g,(_,p,c)=>'<div class="file-badge">\ud83d\udcc1 '+esc(p)+' \u2014 \uc790\ub3d9 \uc0dd\uc131\ub428</div><div class="code-wrap"><pre><code>'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>');
  t=t.replace(/<edit_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/edit_file>/g,(_,p,c)=>'<div class="edit-badge">\u270f\ufe0f '+esc(p)+' \u2014 \ud3b8\uc9d1\ub428</div><div class="code-wrap"><pre><code>'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>');
  t=t.replace(/<run_command>([\\s\\S]*?)<\\/run_command>/g,(_,c)=>'<div class="cmd-badge">\u25b6 '+esc(c)+'</div>');
  t=t.replace(/---\\n\ud83d\udce6 \\*\\*\uc5d0\uc774\uc804\ud2b8 \uc791\uc5c5 \uacb0\uacfc\\*\\*\\n([\\s\\S]*?)$/,(_,c)=>'<div class="agent-report">\ud83d\udce6 <strong>\uc5d0\uc774\uc804\ud2b8 \uc791\uc5c5 \uacb0\uacfc</strong>\\n'+c+'</div>');
  t=t.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g,(_,lang,c)=>{const l=lang||'code';return '<div class="code-wrap"><span class="code-lang">'+l+'</span><pre><code class="language-'+lang+'">'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>'});
  t=t.replace(/\`([^\`]+)\`/g,(_,c)=>'<code>'+esc(c)+'</code>');
  t=t.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');
  return t;
}
function copyCode(btn){const code=btn.parentElement.querySelector('code');if(!code)return;navigator.clipboard.writeText(code.innerText).then(()=>{btn.textContent='\u2713 Copied';btn.classList.add('copied');setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied')},1500)})}
function addMsg(text,role){
  const isUser=role==='user',isErr=role==='error';
  const el=document.createElement('div');el.className='msg'+(isUser?' msg-user':'')+(isErr?' msg-error':'');
  const head=document.createElement('div');head.className='msg-head';
  head.innerHTML=(isUser?'<div class="av av-user">\ud83d\udc64</div><span>You</span>':'<div class="av av-ai">\u2726</div><span>Connect AI LAB</span>')+'<span class="msg-time">'+getTime()+'</span>';
  const body=document.createElement('div');body.className='msg-body';
  if(isUser){body.innerText=text}else{body.innerHTML=fmt(text)}
  el.appendChild(head);el.appendChild(body);chat.appendChild(el);chat.scrollTop=chat.scrollHeight;
  el.querySelectorAll('pre code').forEach(b=>{try{hljs.highlightElement(b)}catch(e){}});
}
function showLoader(){loader=document.createElement('div');loader.className='msg';loader.innerHTML='<div class="msg-head"><div class="av av-ai">\u2726</div><span>Connect AI LAB</span><span class="msg-time">'+getTime()+'</span></div><div class="loading-wrap"><div class="loading-bar"></div><span class="loading-text">\uc0dd\uac01\ud558\ub294 \uc911...</span></div>';chat.appendChild(loader);chat.scrollTop=chat.scrollHeight}
function hideLoader(){if(loader&&loader.parentNode)loader.parentNode.removeChild(loader);loader=null}
function setSending(v){sending=v;sendBtn.disabled=v;stopBtn.classList.toggle('visible',v);input.disabled=v;if(!v)input.focus()}
function send(){const text=input.value.trim();if(!text||sending)return;const w=document.querySelector('.welcome');if(w)w.remove();document.querySelectorAll('.quick-actions').forEach(e=>e.remove());addMsg(text,'user');input.value='';input.style.height='auto';setSending(true);showLoader();vscode.postMessage({type:'prompt',value:text,model:modelSel.value})}
document.addEventListener('click',e=>{if(e.target.classList.contains('qa-btn')){const p=e.target.getAttribute('data-prompt');if(p){input.value=p;send()}}});
sendBtn.addEventListener('click',send);
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
newChatBtn.addEventListener('click',()=>vscode.postMessage({type:'newChat'}));
window.addEventListener('message',e=>{const msg=e.data;switch(msg.type){
  case 'response':hideLoader();setSending(false);addMsg(msg.value,'ai');break;
  case 'error':hideLoader();setSending(false);addMsg(msg.value,'error');break;
  case 'modelsList':modelSel.innerHTML='';msg.value.forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;modelSel.appendChild(o)});break;
  case 'clearChat':chat.innerHTML='';addMsg('\uc0c8 \ub300\ud654\uac00 \uc2dc\uc791\ub418\uc5c8\uc2b5\ub2c8\ub2e4.','ai');break;
  case 'restoreMessages':chat.innerHTML='';if(msg.value&&msg.value.length>0){msg.value.forEach(m=>addMsg(m.text,m.role))}break;
  case 'focusInput':input.focus();break;
  case 'injectPrompt':input.value=msg.value;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px';send();break;
}});
<\/script></body></html>`;
    }
}
