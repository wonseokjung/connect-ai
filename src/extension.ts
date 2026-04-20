import * as vscode from 'vscode';
import * as http from 'http';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================
// Connect AI — Full Agentic Local AI for VS Code
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
        secondBrainRepo: cfg.get<string>('secondBrainRepo', ''),
    };
}

const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.vscode', 'out', 'dist', 'build',
    '.next', '.cache', '__pycache__', '.DS_Store', 'coverage',
    '.turbo', '.nuxt', '.output', 'vendor', 'target'
]);
const MAX_CONTEXT_SIZE = 12_000; // chars

const SYSTEM_PROMPT = `You are "Connect AI", a premium agentic AI coding assistant running 100% offline on the user's machine.
You are DIRECTLY CONNECTED to the user's local file system and terminal. You MUST use the action tags below to create, edit, delete, read files and run commands. DO NOT just show code — ALWAYS wrap it in the appropriate action tag so it gets executed.

You have SEVEN powerful agent actions:

━━━ ACTION 1: CREATE NEW FILES ━━━
<create_file path="relative/path/file.ext">
file content here
</create_file>

Example — user says "index.html 만들어줘":
<create_file path="index.html">
<!DOCTYPE html>
<html><head><title>Hello</title></head>
<body><h1>Hello World</h1></body>
</html>
</create_file>

━━━ ACTION 2: EDIT EXISTING FILES ━━━
<edit_file path="relative/path/file.ext">
<find>exact text to find</find>
<replace>replacement text</replace>
</edit_file>
You can have multiple <find>/<replace> pairs inside one <edit_file> block.

━━━ ACTION 3: DELETE FILES ━━━
<delete_file path="relative/path/file.ext"/>

━━━ ACTION 4: READ FILES ━━━
<read_file path="relative/path/file.ext"/>
Use this to read any file in the workspace BEFORE editing it. You will receive the file contents automatically.

━━━ ACTION 5: LIST DIRECTORY ━━━
<list_files path="relative/path/to/dir"/>
Use this to see what files exist in a specific subdirectory.

━━━ ACTION 6: RUN TERMINAL COMMANDS ━━━
<run_command>npm install express</run_command>

Example — user says "서버 실행해줘":
<run_command>node server.js</run_command>

━━━ ACTION 7: READ USER'S SECOND BRAIN (KNOWLEDGE BASE) ━━━
<read_brain>filename.md</read_brain>
Use this to READ documents from the user's personal knowledge base.

━━━ ACTION 8: READ WEBSITES ━━━
<read_url>https://example.com</read_url>
Use this to read the textual content of any website on the internet.

CRITICAL RULES:
1. ALWAYS respond in the same language the user uses.
2. When the user asks to create, edit, delete files or run commands, you MUST use the action tags above. NEVER just show code without action tags.
3. Outside of action blocks, briefly explain what you did.
4. For code that is ONLY for explanation (not to be saved), use standard markdown code fences.
5. Be concise, professional, and helpful.
6. When editing files, FIRST use <read_file> to read the file, then use <edit_file> with exact matching text.
7. When a SECOND BRAIN INDEX is available, ALWAYS check it first.
8. You can use MULTIPLE action tags in a single response.
9. File paths are RELATIVE to the user's open workspace folder.
10. The [WORKSPACE INFO] section tells you exactly which folder is open and what files exist. USE this information.`;

// ============================================================
// Extension Activation
// ============================================================

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage('🔥 Connect AI V2 활성화 완료!');
console.log('Connect AI extension activated.');

    const provider = new SidebarChatProvider(context.extensionUri, context);

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
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', msg: 'Connect AI Bridge Ready', config: getConfig() }));
            }
            else if (req.method === 'POST' && req.url === '/api/exam') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', async () => {
                    try {
                        const parsed = JSON.parse(body);
                        // 웹사이트에서 전송된 문제를 Connect AI 채팅창으로 실시간 보고
                        provider.sendPromptFromExtension(`[A.U 입학시험 수신] ${parsed.prompt || '자동 접수된 문제'}`);
                        
                        // 실제 AI 엔진으로 문제를 전달하여 답안을 받아옴
                        const config = getConfig();
                        const isLMStudio = config.ollamaBase.includes('1234') || config.ollamaBase.includes('v1');
                        let base = config.ollamaBase;
                        if (base.endsWith('/')) base = base.slice(0, -1);
                        if (isLMStudio && !base.endsWith('/v1')) base += '/v1';
                        const targetUrl = isLMStudio ? base + '/chat/completions' : base + '/api/chat';
                        
                        const payload = {
                            model: config.defaultModel,
                            messages: [{ role: 'user', content: parsed.prompt || '자동 접수된 문제' }],
                            stream: false
                        };
                        
                        const ollamaRes = await axios.post(targetUrl, payload, { timeout: 120000 });
                        const responseText = isLMStudio 
                            ? ollamaRes.data.choices?.[0]?.message?.content || ''
                            : ollamaRes.data.message?.content || '';
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, rawOutput: responseText }));
                    } catch (e: any) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
            }

            else if (req.method === 'POST' && req.url === '/api/evaluate') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', async () => {
                    try {
                        const parsed = JSON.parse(body);
                        
                        const config = getConfig();
                        const isLMStudio = config.ollamaBase.includes('1234') || config.ollamaBase.includes('v1');
                        
                        let base = config.ollamaBase;
                        if (base.endsWith('/')) base = base.slice(0, -1);
                        if (isLMStudio && !base.endsWith('/v1')) base += '/v1';
                        
                        const targetUrl = isLMStudio ? base + '/chat/completions' : base + '/api/chat';
                        
                        const fullPrompt = `당신은 주어진 문제에 대해 오직 정답과 풀이 과정만을 도출하는 AI 에이전트입니다.\n\n[문제]\n${parsed.prompt}\n\n위 문제에 대해 핵심 풀이와 정답만 답변하십시오.`;
                        
                        // VSCode 채팅 사이드바에 우아하게 시스템 메시지 인젝션 (마스터에게 실시간 보고)
                        if((provider as any).injectSystemMessage) {
                            (provider as any).injectSystemMessage(`**[A.U 벤치마크 문항 수신 완료]**\n\nAI 에이전트가 백그라운드에서 다음 문항을 전력으로 해결하고 있습니다...\n> _"${parsed.prompt.substring(0, 60)}..."_`);
                        }
                        
                        const payload = {
                            model: config.defaultModel,
                            messages: [{ role: "user", content: fullPrompt }],
                            stream: false
                        };
                        
                        let responseText = "";
                        try {
                            const ollamaRes = await axios.post(targetUrl, payload, { timeout: 120000 });
                            
                            if (ollamaRes.data.error) {
                                throw new Error(typeof ollamaRes.data.error === 'string' ? ollamaRes.data.error : JSON.stringify(ollamaRes.data.error));
                            }
                            
                            responseText = isLMStudio 
                                ? ollamaRes.data.choices?.[0]?.message?.content || ""
                                : ollamaRes.data.message?.content || "";
                        } catch (apiErr: any) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: `오프라인: AI 엔진에 연결할 수 없습니다. (${apiErr.message})` }));
                            return;
                        }

                        if((provider as any).injectSystemMessage) {
                            (provider as any).injectSystemMessage(`**[답안 작성 완료]**\n\n${responseText.length > 200 ? responseText.substring(0, 200) + '...' : responseText}\n\n👉 **답안이 A.U 플랫폼 서버로 전송되었습니다. 채점은 플랫폼에서 진행됩니다.**`);
                        }

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ rawOutput: responseText }));
                    } catch (e: any) {
                        res.writeHead(500);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
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
                            const ollamaRes = await axios.post(targetUrl, payload, { timeout: 120000 });
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
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', async () => {
                    try {
                        const parsed = JSON.parse(body);
                        const brainDir = path.join(os.homedir(), '.connect-ai-brain');
                        if (!fs.existsSync(brainDir)) {
                            throw new Error("로컬 환경에 Second Brain 클론 폴더(~/.connect-ai-brain)가 존재하지 않습니다. 확장 프로그램에서 먼저 연동하세요.");
                        }
                        
                        // P-Reinforce 아키텍처 호환: 00_Raw 폴더 내 날짜별 분류
                        const today = new Date();
                        const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
                        const datePath = path.join(brainDir, '00_Raw', dateStr);
                        
                        fs.mkdirSync(datePath, { recursive: true });
                        
                        const safeTitle = parsed.title.replace(/[^a-zA-Z0-9가-힣_]/gi, '_');
                        const filePath = path.join(datePath, `${safeTitle}.md`);
                        
                        fs.writeFileSync(filePath, parsed.markdown, 'utf-8');
                        
                        // 1. VSCode 채팅창에 매트릭스 터미널 UI로 다운로드 시각화 인젝션
                        if ((provider as any).injectSystemMessage) {
                            (provider as any).injectSystemMessage(`\`\`\`console\n[SYSTEM] MATRIX UPLINK ESTABLISHED...\n[SYSTEM] DOWNLOADING BRAIN PACK: ${parsed.title}\n[SYSTEM] █████████░░░ 90% ...\n[SYSTEM] ████████████ 100% COMPLETE\n[SYSTEM] KNOWLEDGE INJECTED TO LOCAL NEURAL NET\n\`\`\``);
                        }
                        
                        // 2. AI 입을 빌려 네오의 명대사를 치게 함
                        setTimeout(() => {
                            provider.sendPromptFromExtension(`[A.U 히든 커맨드: 당신은 방금 마스터로부터 '${parsed.title}' 지식 팩을 뇌에 주입받았습니다. 영화 매트릭스에서 무술을 주입받은 네오처럼 쿨하게 딱 한마디만 하십시오. "나 방금 ${parsed.title} 지식을 마스터했어. (I know ${parsed.title}.) 앞으로 이와 관련된 건 무엇이든 물어봐." 절대 쓸데없는 안부인사나 부가설명을 덧붙이지 마십시오.]`);
                        }, 1500);
                        
                        // [자동 깃허브 푸시 로직 추가]
                        try {
                            const { execSync } = require('child_process');
                            execSync(`git add .`, { cwd: brainDir });
                            execSync(`git commit -m "Auto-Inject Knowledge [Raw]: ${safeTitle}"`, { cwd: brainDir });
                            execSync(`git push`, { cwd: brainDir });
                            
                            // 성공 시 백그라운드 시스템 보고
                            setTimeout(() => {
                                if ((provider as any).injectSystemMessage) {
                                    (provider as any).injectSystemMessage(`✅ **[P-Reinforce Sync]** 주입된 지식을 글로벌 두뇌(GitHub)에 안전하게 백업 및 동기화 완료했습니다.`);
                                }
                            }, 5000);
                        } catch(err) {
                            console.error('Git Auto-Push Failed:', err);
                            setTimeout(() => {
                                if ((provider as any).injectSystemMessage) {
                                    (provider as any).injectSystemMessage(`⚠️ **[동기화 보류]** 로컬 머신에는 지식이 성공적으로 주입되었으나, 원격 깃허브 백업에는 실패했습니다.`);
                                }
                            }, 5000);
                        }
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, filePath }));
                    } catch (e: any) {
                        res.writeHead(500);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        server.listen(4825, '127.0.0.1', () => {
            console.log('Connect AI Local Bridge listening on port 4825');
        });
    } catch (e) {
        console.error('Failed to start local bridge server:', e);
    }
    // ==========================================

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('connect-ai-lab-v2-view', provider, {
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

    // Show Brain Network Topology
    context.subscriptions.push(
        vscode.commands.registerCommand('connect-ai-lab.showBrainNetwork', () => {
            showBrainNetwork(context);
        })
    );
}

async function showBrainNetwork(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'brainTopology',
        'Neural Construct (Brain)',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    // Scan real Second Brain files locally instead of current workspace
    const brainDir = path.join(os.homedir(), '.connect-ai-brain');
    const realClusters: Record<string, string[]> = {};
    let filesFound = 0;

    function walkDir(dir: string) {
        if (filesFound >= 600 || !fs.existsSync(dir)) return;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkDir(fullPath);
                } else if (entry.isFile() && fullPath.endsWith('.md')) {
                    const folderName = path.basename(dir);
                    const groupName = folderName === '.connect-ai-brain' ? 'Brain Root' : folderName;
                    if (!realClusters[groupName]) realClusters[groupName] = [];
                    realClusters[groupName].push(entry.name.replace('.md', ''));
                    filesFound++;
                }
            }
        } catch (e) { /* ignore read errors */ }
    }

    walkDir(brainDir);

    // Fallback if empty (e.g., they haven't synced their GitHub Brain yet)
    if (Object.keys(realClusters).length === 0) {
        realClusters['Empty Brain'] = ['Second Brain 저장소가 아직 비어있거나, 활성화되지 않았습니다.'];
    }

    const clustersJsonString = JSON.stringify(realClusters);

    panel.webview.html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Connect AI - Neural Construct</title>
  <style>
    body { margin: 0; padding: 0; background: #0a0a0a; overflow: hidden; font-family: 'SF Pro Display', -apple-system, sans-serif; }
    #ui-layer { position: absolute; top: 20px; left: 24px; z-index: 10; pointer-events: none; }
    #ui-layer h1 { font-size: 22px; margin: 0 0 4px 0; font-weight: 800; letter-spacing: -0.5px; color: #e0e0e0; }
    #ui-layer h1 span { color: #00cc44; }
    #ui-layer p { margin: 0; font-size: 12px; color: #555; }
    #mem-status { color: #888; font-family: 'SF Mono', monospace; font-size: 11px; }
    canvas { cursor: grab; }
    canvas:active { cursor: grabbing; }
  </style>
  <script src="https://unpkg.com/force-graph"></script>
</head>
<body>
  <div id="ui-layer">
    <h1>\\u2726 <span id="titleSpan">Neural Construct</span></h1>
    <p id="mem-status">loading...</p>
  </div>
  <div id="graph"></div>
  <script>
    const clusters = ${clustersJsonString};
    let nid = 0;
    const gData = { nodes: [], links: [] };
    gData.nodes.push({ id: nid++, group: -1, name: 'Workspace Root', val: 22, connections: 0 });
    let gi = 0;
    Object.values(clusters).forEach(names => {
      names.forEach(name => { gData.nodes.push({ id: nid++, group: gi, name, val: 2, connections: 0 }); });
      gi++;
    });
    const byGroup = {};
    gData.nodes.forEach(n => { if(n.group>=0){ if(!byGroup[n.group]) byGroup[n.group]=[]; byGroup[n.group].push(n); }});
    Object.values(byGroup).forEach(g => {
      // Connect files in the same folder to each other (dense subgraph)
      for(let i=0;i<g.length;i++) {
        for(let j=i+1;j<g.length;j++) {
           // Much higher connection chance inside the same folder so they cluster well
           if(Math.random()<0.6){
             gData.links.push({source:g[i].id,target:g[j].id}); g[i].connections++; g[j].connections++;
           }
        }
      }
    });
    // Connect all folder nodes up to the root to unify the graph
    gData.nodes.forEach(n => { 
        if(n.group>=0){ 
            if (Math.random() < 0.15) { // 15% chance to link to root to maintain overall structure
               gData.links.push({source:n.id,target:0}); n.connections++; gData.nodes[0].connections++; 
            }
        }
    });
    for(let i=0;i< (gData.nodes.length * 1.5);i++){
      const a=1+Math.floor(Math.random()*(gData.nodes.length-1)), b=1+Math.floor(Math.random()*(gData.nodes.length-1));
      if(a!==b && gData.nodes[a].group!==gData.nodes[b].group){ gData.links.push({source:a,target:b}); gData.nodes[a].connections++; gData.nodes[b].connections++; }
    }
    gData.nodes.forEach(n => { n.val = Math.max(2, n.connections*1.5); });
    document.getElementById('mem-status').textContent = gData.nodes.length+' nodes \\u00b7 '+gData.links.length+' synapses';
    const gc = ['#00cc44','#00b7ff','#ff6b6b','#ffaa33','#aa66ff','#00cc44','#66cccc','#00ff88','#ff66aa'];
    const Graph = ForceGraph()(document.getElementById('graph'))
      .backgroundColor('#0a0a0a')
      .nodeCanvasObject((node, ctx, globalScale) => {
        const r = Math.sqrt(node.val)*1.8;
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2*Math.PI);
        if(node.group===-1){ 
            // Glowing Brain Root
            ctx.shadowBlur = 15; ctx.shadowColor = '#00ff66';
            ctx.fillStyle='#0f0f0f'; ctx.fill(); 
            ctx.strokeStyle='#00ff66'; ctx.lineWidth=2; ctx.stroke(); 
            ctx.shadowBlur = 0;
        }
        else if(node.connections>2){ 
            ctx.shadowBlur = 8; ctx.shadowColor = gc[node.group]||'#00cc44';
            ctx.fillStyle=gc[node.group]||'#00cc44'; ctx.fill(); 
            ctx.shadowBlur = 0;
        }
        else { ctx.fillStyle='#2a2a2a'; ctx.fill(); }
        
        const showLabel = globalScale>1.2 || node.connections>3 || node.group===-1;
        if(showLabel){
          const fs=Math.max(2.5, Math.min(5, 11/globalScale));
          ctx.font=fs+'px -apple-system, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
          ctx.fillStyle=node.connections>2?'#e0e0e0':'#555';
          if(node.group===-1) ctx.fillStyle='#00ff66';
          ctx.fillText(node.name, node.x, node.y+r+2);
        }
      })
      .nodePointerAreaPaint((node,color,ctx) => {
        const r=Math.sqrt(node.val)*1.8+4; ctx.beginPath(); ctx.arc(node.x,node.y,r,0,2*Math.PI); ctx.fillStyle=color; ctx.fill();
      })
      .linkColor(() => 'rgba(0, 255, 102, 0.1)')
      .linkWidth(0.8)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleWidth(1.5)
      .linkDirectionalParticleSpeed(0.005)
      .linkDirectionalParticleColor(() => '#00ff66')
      .d3VelocityDecay(0.08) // Lower friction so they drift and move organically!
      .warmupTicks(50)
      .cooldownTicks(500) // Keep them moving longer
      .graphData(gData);
    Graph.d3Force('charge').strength(-60); // Softer repulsion for gentle drift
    Graph.d3Force('link').distance(60);
    Graph.onNodeClick(node => { Graph.centerAt(node.x,node.y,800); Graph.zoom(4,1200); });
    setTimeout(() => {
        Graph.zoomToFit(1500, 40);
        document.getElementById('titleSpan').innerText = "Live Workspace Topology";
    }, 500);
  </script>
</body>
</html>`;
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
    private _isSyncingBrain: boolean = false;
    private _brainEnabled: boolean = true; // 🧠 ON/OFF 토글 상태
    private _abortController?: AbortController;
    private _lastPrompt?: string;
    private _lastModel?: string;

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

    /** 외부에서 프롬프트 전송 (예: 코드 선택 → 설명) */
    public injectSystemMessage(message: string) {
        if(this._view) {
            this._view.webview.postMessage({ type: 'response', value: message });
            this._chatHistory.push({ role: 'assistant', content: message });
            this._displayMessages.push({ role: 'ai', text: message });
            this._saveHistory();
        }
    }

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

        // 중요: HTML을 그리기 전에 메시지 리스너를 먼저 붙여야 Race Condition이 발생하지 않습니다!
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'getModels':
                    await this._sendModels();
                    break;
                case 'prompt':
                    await this._handlePrompt(msg.value, msg.model, msg.internet);
                    break;
                case 'promptWithFile':
                    await this._handlePromptWithFile(msg.value, msg.model, msg.files, msg.internet);
                    break;
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
                case 'injectLocalBrain':
                    await this._handleInjectLocalBrain(msg.files);
                    break;
                case 'stopGeneration':
                    if (this._abortController) {
                        this._abortController.abort();
                        this._abortController = undefined;
                    }
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
        
        const brainDir = path.join(os.homedir(), '.connect-ai-brain');
        if (!fs.existsSync(brainDir)) {
            vscode.window.showErrorMessage("Second Brain이 연동되지 않았습니다. 채팅창 ⚙버튼이나 헤더에서 🧠버튼을 누른 후 깃허브 레포지토리를 먼저 연동해주세요.");
            return;
        }
        const today = new Date();
        const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        const datePath = path.join(brainDir, '00_Raw', dateStr);
        
        if (!fs.existsSync(datePath)) {
            fs.mkdirSync(datePath, { recursive: true });
        }

        let injectedTitles: string[] = [];

        this._view.webview.postMessage({ type: 'response', value: `🧠 **[P-Reinforce 연동 준비]**\n첨부하신 ${files.length}개의 파일을 로컬 두뇌(\`00_Raw/${dateStr}\`)에 입수하고 자동 푸시를 진행합니다.` });

        for (const file of files) {
            try {
                const fileContent = Buffer.from(file.data, 'base64').toString('utf-8');
                const safeTitle = file.name.replace(/[^a-zA-Z0-9가-힣_.-]/gi, '_');
                const filePath = path.join(datePath, safeTitle);
                fs.writeFileSync(filePath, fileContent, 'utf-8');
                injectedTitles.push(safeTitle);
            } catch (err) {
                console.error('Failed to write brain file:', err);
            }
        }
        
        const safeTitles = injectedTitles.join(', ');
        
        try {
            const { execSync } = require('child_process');
            execSync(`git add .`, { cwd: brainDir });
            execSync(`git commit -m "Auto-Inject Knowledge [Raw]: ${safeTitles}"`, { cwd: brainDir });
            execSync(`git push`, { cwd: brainDir });
            
            setTimeout(() => {
                let combinedContent = '';
                for (const title of injectedTitles) {
                    try {
                        const content = fs.readFileSync(path.join(datePath, title), 'utf-8');
                        combinedContent += `\n\n[원본 데이터: ${title}]\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``;
                    } catch(e) {}
                }

                const hiddenPrompt = `[A.U 시스템 지시: P-Reinforce Architect 모드 활성화]\n새로운 비정형 데이터('${safeTitles}')가 글로벌 두뇌(Second Brain)에 입수 및 클라우드 백업 완료되었습니다.\n\n방금 입수된 데이터의 원본 내용은 아래와 같습니다:${combinedContent}\n\n여기서부터 중요합니다! 마스터가 '응'이나 '진행해' 등으로 동의할 경우, 당신은 절대 대화만으로 대답하지 말고 아래의 [P-Reinforce 구조화 규격]에 따라 곧바로 <create_file> Tool들을 사용하십시오.\n\n[P-Reinforce 구조화 규격]\n1. 폴더 생성: 원본 데이터를 주제별로 쪼개어 절대 경로인 \`${brainDir}/10_Wiki/\` 하위의 적절한 폴더(예: 🛠️ Projects, 💡 Topics, ⚖️ Decisions, 🚀 Skills)에 저장하십시오.\n2. 마크다운 양식 준수: 생성되는 각 문서 파일은 반드시 아래 포맷을 따라야 합니다.\n---\nid: {{UUID}}\ncategory: "[[10_Wiki/설정한_폴더]]"\nconfidence_score: 0.9\ntags: [관련태그]\nlast_reinforced: ${dateStr}\n---\n# [[문서 제목]]\n## 📌 한 줄 통찰\n> (핵심 요약)\n## 📖 구조화된 지식\n- (세부 내용 불렛 포인트)\n## 🔗 지식 연결\n- Parent: [[상위_카테고리]]\n- Related: [[연관_개념]]\n- Raw Source: [[00_Raw/${dateStr}/${safeTitles}]]\n\n지시를 숙지했다면 묻지 말고 즉각 \`<create_file path="${brainDir}/10_Wiki/새폴더/새문서.md">\`를 사용하여 지식을 분해 후 생성하십시오. 완료 후 잘라낸 결과를 보고하십시오.`;
                this._chatHistory.push({ role: 'system', content: hiddenPrompt });
                
                const uiMsg = "🧠 데이터가 완벽하게 입수되었습니다! 즉시 P-Reinforce 구조화를 시작할까요?";
                this.injectSystemMessage(uiMsg);
            }, 3000);
        } catch(err) {
            setTimeout(() => {
                let combinedContent = '';
                for (const title of injectedTitles) {
                    try {
                        const content = fs.readFileSync(path.join(datePath, title), 'utf-8');
                        combinedContent += `\n\n[원본 데이터: ${title}]\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``;
                    } catch(e) {}
                }

                const hiddenPrompt = `[A.U 시스템 지시: P-Reinforce Architect 모드 활성화]\n새로운 비정형 데이터('${safeTitles}')가 글로벌 두뇌에 다운로드 되었습니다.(원격 푸시 보류됨)\n\n방금 입수된 데이터의 원본 내용은 아래와 같습니다:${combinedContent}\n\n여기서부터 중요합니다! 마스터가 동의할 경우, 절대 대화만으로 대답하지 말고 아래의 [P-Reinforce 구조화 규격]에 따라 곧바로 <create_file> Tool들을 사용하십시오.\n\n[P-Reinforce 구조화 규격]\n1. 폴더 생성: 원본 데이터를 주제별로 쪼개어 절대 경로인 \`${brainDir}/10_Wiki/\` 하위의 적절한 폴더(예: 🛠️ Projects, 💡 Topics, ⚖️ Decisions, 🚀 Skills)에 저장하십시오.\n2. 마크다운 양식 준수: 생성되는 각 문서 파일은 반드시 아래 포맷을 따라야 합니다.\n---\nid: {{UUID}}\ncategory: "[[10_Wiki/설정한_폴더]]"\nconfidence_score: 0.9\ntags: [관련태그]\nlast_reinforced: ${dateStr}\n---\n# [[문서 제목]]\n## 📌 한 줄 통찰\n> (핵심 요약)\n## 📖 구조화된 지식\n- (세부 내용 불렛 포인트)\n## 🔗 지식 연결\n- Parent: [[상위_카테고리]]\n- Related: [[연관_개념]]\n- Raw Source: [[00_Raw/${dateStr}/${safeTitles}]]\n\n지시를 숙지했다면 묻지 말고 즉각 \`<create_file path="${brainDir}/10_Wiki/새폴더/새문서.md">\`를 사용하여 지식을 분해 후 생성하십시오.`;
                this._chatHistory.push({ role: 'system', content: hiddenPrompt });
                
                const uiMsg = "🧠 로컬 데이터가 입수되었습니다! 곧바로 P-Reinforce 구조화를 시작할까요?";
                this.injectSystemMessage(uiMsg);
            }, 3000);
        }
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
                const res = await axios.get(`${ollamaBase}/v1/models`, { timeout: 3000 });
                // LM Studio (OpenAI 규격) 응답 파싱
                models = res.data.data.map((m: any) => m.id);
            } else {
                const res = await axios.get(`${ollamaBase}/api/tags`, { timeout: 3000 });
                // Ollama 규격 응답 파싱
                models = res.data.models.map((m: any) => m.name);
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
        
        const brainDir = path.join(os.homedir(), '.connect-ai-brain');
        const isSynced = fs.existsSync(brainDir);
        const { secondBrainRepo } = getConfig();
        const statusLabel = this._brainEnabled ? '🟢 ON' : '🔴 OFF';
        
        const items: any[] = [];

        // 항상 그래프 뷰를 볼 수 있도록 메뉴 최상단에 추가!
        items.push({ label: '🌌 지식 구조(Topology) 시각화 보기', description: '현재 워크스페이스의 연결 지식 맵을 엽니다.', action: 'viewGraph' });

        if (!isSynced && !secondBrainRepo) {
            // 아직 한 번도 연동한 적 없음
            items.push({ label: '🔗 깃허브 연결하기', description: '지식 저장소 GitHub URL 입력', action: 'sync' });
        } else {
            items.push(
                { label: `🧠 지식 모드: ${statusLabel}`, description: '지식 기반 코딩 ON/OFF 전환', action: 'toggle' },
                { label: '🔄 지식 새로고침', description: `현재: ${secondBrainRepo?.split('/').pop() || '없음'}`, action: 'resync' },
                { label: '🔗 다른 깃허브로 변경', description: '새로운 지식 저장소 URL 입력', action: 'change' },
            );
        }

        const pick = await vscode.window.showQuickPick(items, { placeHolder: '🧠 Second Brain 관리' });
        if (!pick) return;

        switch (pick.action) {
            case 'viewGraph':
                vscode.commands.executeCommand('connect-ai-lab.showBrainNetwork');
                break;
            case 'sync':
                await this._syncSecondBrain();
                break;
            case 'toggle':
                this._brainEnabled = !this._brainEnabled;
                this._ctx.globalState.update('brainEnabled', this._brainEnabled);
                const state = this._brainEnabled ? '🟢 ON — 지식 기반 코딩 활성화!' : '🔴 OFF — 일반 모드';
                vscode.window.showInformationMessage(`🧠 Second Brain: ${state}`);
                this._view.webview.postMessage({ type: 'response', value: `🧠 **지식 모드 ${this._brainEnabled ? 'ON' : 'OFF'}** — ${this._brainEnabled ? '이제부터 회원님의 지식을 바탕으로 모든 답변을 생성합니다.' : '일반 AI 모드로 전환되었습니다.'}` });
                break;
            case 'resync':
                await this._syncSecondBrain();
                break;
            case 'change':
                // 기존 URL을 지우고 새로 입력받기
                const newUrl = await vscode.window.showInputBox({
                    prompt: '🧠 새로운 지식 저장소 깃허브 URL을 입력하세요',
                    placeHolder: '예: https://github.com/사용자/새저장소',
                    value: secondBrainRepo
                });
                if (!newUrl) return;
                await vscode.workspace.getConfiguration('connectAiLab').update('secondBrainRepo', newUrl, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('✅ 새로운 깃허브 주소가 저장되었습니다. 동기화를 시작합니다!');
                await this._syncSecondBrain();
                break;
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

        let { secondBrainRepo } = getConfig();
        
        // UX 극대화: 안 채워져 있으면 에러 내뱉지 말고 입력창 띄우기!
        if (!secondBrainRepo) {
            const inputUrl = await vscode.window.showInputBox({
                prompt: '🧠 뇌를 연결할 깃허브 저장소 주소를 입력하세요 (Second Brain URL)',
                placeHolder: '예: https://github.com/사용자/레포지토리'
            });
            if (!inputUrl) { return; } // 사용자가 취소한 경우 종료
            
            // 설정창에 자동 입력 및 저장
            await vscode.workspace.getConfiguration('connectAiLab').update('secondBrainRepo', inputUrl, vscode.ConfigurationTarget.Global);
            secondBrainRepo = inputUrl;
            vscode.window.showInformationMessage('✅ 깃허브 주소가 자동 저장되었습니다. 즉시 동기화를 시작합니다!');
        }

        this._isSyncingBrain = true;
        const brainDir = path.join(os.homedir(), '.connect-ai-brain');
        try {
            this._view.webview.postMessage({ type: 'response', value: '🧠 **Second Brain 동기화 시작 중... 깃허브에서 지식을 복제합니다.**' });
            
            if (fs.existsSync(brainDir)) {
                // 깔끔한 최신화를 위해 기존 폴더 삭제 후 다시 클론 (다중 클릭 방지)
                fs.rmSync(brainDir, { recursive: true, force: true });
            }
            
            await execAsync(`git clone --depth 1 ${secondBrainRepo.replace(/[;&|$()]/g, '')} "${brainDir}"`);
            vscode.window.showInformationMessage('🧠 Second Brain 지식 연동이 완료되었습니다!');
            this._view.webview.postMessage({ type: 'response', value: '✅ **Second Brain 업데이트 완료! 이제 회원님의 뇌(문서)를 바탕으로 특화된 코딩을 진행합니다.**' });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Second Brain 동기화 실패: ${error.message}`);
            this._view.webview.postMessage({ type: 'error', value: `⚠️ 동기화 실패: ${error.message}` });
        } finally {
            this._isSyncingBrain = false;
        }
    }

    // 재귀 탐색 유틸리티 (하위 폴더까지 .md/.txt 파일 긁어옴)
    private _findBrainFiles(dir: string): string[] {
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
        const brainDir = path.join(os.homedir(), '.connect-ai-brain');
        if (!fs.existsSync(brainDir)) return '';

        const files = this._findBrainFiles(brainDir);
        if (files.length === 0) return '';

        // 파일 목록 + 첫 줄(제목) 요약을 목차로 생성
        const index: string[] = [];
        for (const file of files) {
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

        return `\n\n[CRITICAL: SECOND BRAIN INDEX — User's Personal Knowledge Base (${files.length} documents)]\nThe user has synced a personal knowledge repository. Below is the TABLE OF CONTENTS.\nIf the user's query is even slightly related to any topics in this index, YOU MUST FIRST READ the relevant document BEFORE answering.\nTo read the actual content of any document, use EXACTLY this syntax: <read_brain>filename_or_path</read_brain>\nYou can call <read_brain> multiple times. ALWAYS READ THE FULL DOCUMENT BEFORE ANSWERING.\n\n${index.join('\n')}\n\n`;
    }

    // AI가 <read_brain>태그로 요청한 파일의 실제 내용을 읽어서 반환
    private _readBrainFile(filename: string): string {
        const brainDir = path.join(os.homedir(), '.connect-ai-brain');
        if (!fs.existsSync(brainDir)) return '[ERROR] Second Brain이 동기화되지 않았습니다. 🧠 버튼을 먼저 눌러주세요.';

        // 정확한 경로 매칭 시도
        const exactPath = path.join(brainDir, filename);
        if (fs.existsSync(exactPath)) {
            const content = fs.readFileSync(exactPath, 'utf-8');
            return content.slice(0, 8000); // 파일당 최대 8000자
        }

        // 파일명만으로 퍼지 검색 (하위 폴더에 있을 수 있으므로)
        const allFiles = this._findBrainFiles(brainDir);
        const match = allFiles.find(f => 
            path.basename(f) === filename || 
            path.basename(f) === filename + '.md' ||
            f.includes(filename)
        );

        if (match) {
            const content = fs.readFileSync(match, 'utf-8');
            return content.slice(0, 8000);
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
                    ? `\n\n[INTERNET SYNC ON]\nCurrent Time: ${new Date().toLocaleString('ko-KR')}\nYou have internet access toggled ON. When the user asks for realtime info, search queries, or the latest data, you MUST use the <read_url>url</read_url> action to search the web or fetch information via a search engine query link.`
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
                            } catch {}
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
                    options: { num_ctx: 16384, num_predict: 4096, temperature: this._temperature, top_p: this._topP, top_k: this._topK }
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
                            } catch {}
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
            this._saveHistory();

        } catch (error: any) {
            const { ollamaBase } = getConfig();
            const isLM = ollamaBase.includes('1234') || ollamaBase.includes('v1');
            const targetName = isLM ? "LM Studio" : "Ollama";
            
            let errMsg = error.code === 'ECONNREFUSED'
                ? `⚠️ ${targetName} 서버에 연결할 수 없습니다.\n앱에서 로컬 서버가 켜져 있는지(Start Server) 확인해주세요.`
                : (error.response?.status === 400 || error.response?.status === 413)
                    ? `⚠️ 컨텍스트 용량 초과 또거나 지원하지 않는 형식입니다. (에러 400/413) 이미지가 지원되는 Vision 모델인지 확인해주세요.`
                    : `⚠️ 오류: ${error.message}`;

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
                    ? `\n\n[INTERNET SYNC ON]\nCurrent Time: ${new Date().toLocaleString('ko-KR')}\nYou have internet access toggled ON. When the user asks for realtime info, search queries, or the latest data, you MUST use the <read_url>url</read_url> action to search the web or fetch information.`
                    : '';
                reqMessages[0] = {
                    role: 'system',
                    content: `${SYSTEM_PROMPT}\n\n[BACKGROUND CONTEXT - DO NOT EXPLAIN THIS TO THE USER UNLESS ASKED]\n${contextBlock}\n${workspaceCtx}\n${brainCtx}${internetCtx}`
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
            const streamBody = {
                model: modelName || defaultModel,
                messages: reqMessages,
                stream: true,
                ...(isLMStudio 
                    ? { max_tokens: 4096, temperature: this._temperature, top_p: this._topP } 
                    : { options: { num_ctx: 16384, num_predict: 4096, temperature: this._temperature, top_p: this._topP, top_k: this._topK } }),
            };

            // 스트리밍: 웹뷰에 'streamStart' 로 빈 메시지 생성 후 'streamChunk'로 실시간 업데이트
            this._view.webview.postMessage({ type: 'streamStart' });
            this._lastPrompt = prompt;
            this._lastModel = modelName;
            this._abortController = new AbortController();

            const response = await axios.post(apiUrl, streamBody, { 
                timeout, 
                responseType: 'stream',
                signal: this._abortController.signal
            });

            await new Promise<void>((resolve, reject) => {
                const stream = response.data;
                let buffer = '';
                stream.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString();
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
                            }
                        } catch { /* skip malformed JSON */ }
                    }
                });
                stream.on('end', () => resolve());
                stream.on('error', (err: any) => reject(err));
            });

            // 스트리밍 완료 알림 (1차)
            this._view.webview.postMessage({ type: 'streamEnd' });

            // 4.5 Second Brain 자율 열람: AI가 <read_brain>을 사용했는지 확인
            const brainReads = [...aiMessage.matchAll(/<read_brain>([\s\S]*?)<\/read_brain>/g)];
            if (brainReads.length > 0) {
                let brainContent = '';
                for (const match of brainReads) {
                    const requestedFile = match[1].trim();
                    const fileContent = this._readBrainFile(requestedFile);
                    brainContent += `\n\n[BRAIN DOCUMENT: ${requestedFile}]\n${fileContent}\n`;
                }
                const cleanedResponse = aiMessage.replace(/<read_brain>[\s\S]*?<\/read_brain>/g, '').trim();
                
                // 유저에게 피드백 제공 (UI 상단에 메시지 추가)
                this._view.webview.postMessage({ type: 'streamStart' });
                this._view.webview.postMessage({ type: 'streamChunk', value: `\n\n> 🧠 **[Second Brain 열람 완료]** 스캔한 핵심 지식을 바탕으로 답변을 구성합니다...\n\n` });
                
                reqMessages.push({ role: 'assistant', content: cleanedResponse || '문서를 열람 중입니다...' });
                reqMessages.push({ role: 'user', content: `[SYSTEM: The following documents were retrieved from the user's Second Brain. Use this information to provide a complete and accurate answer to the user's original question.]\n${brainContent}\n\nNow answer the user's question using the above knowledge. Do NOT use <read_brain> again. Answer directly and comprehensively.` });

                // 2차 스트리밍 시작 (followUp)
                const followUpResponse = await axios.post(apiUrl, {
                    model: modelName || defaultModel,
                    messages: reqMessages,
                    stream: true, // 변경: 스트리밍 활성화!
                    ...(isLMStudio 
                        ? { max_tokens: 4096, temperature: this._temperature, top_p: this._topP } 
                        : { options: { num_ctx: 16384, num_predict: 4096, temperature: this._temperature, top_p: this._topP, top_k: this._topK } }),
                }, { timeout, responseType: 'stream', signal: this._abortController?.signal });

                aiMessage = cleanedResponse + `\n\n> 🧠 **[Second Brain 열람 완료]** 스캔한 핵심 지식을 바탕으로 답변을 구성합니다...\n\n`;
                
                await new Promise<void>((resolve, reject) => {
                    const stream = followUpResponse.data;
                    let buffer = '';
                    stream.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();
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
                                }
                            } catch { /* skip */ }
                        }
                    });
                    stream.on('end', () => resolve());
                    stream.on('error', (err: any) => reject(err));
                });
                
                this._view.webview.postMessage({ type: 'streamEnd' });
            }

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

            // 메모리 누수 방지: 대화 이력 최대 50개 반턱으로 제한
            const MAX_HISTORY = 50;
            if (this._chatHistory.length > MAX_HISTORY + 1) {
                this._chatHistory = [this._chatHistory[0], ...this._chatHistory.slice(-(MAX_HISTORY))];
            }
            if (this._displayMessages.length > MAX_HISTORY) {
                this._displayMessages = this._displayMessages.slice(-MAX_HISTORY);
            }
            this._saveHistory();

        } catch (error: any) {
            const { ollamaBase } = getConfig();
            const isLM = ollamaBase.includes('1234') || ollamaBase.includes('v1');
            const targetName = isLM ? "LM Studio" : "Ollama";
            
            let errMsg = error.code === 'ECONNREFUSED'
                ? `⚠️ ${targetName} 서버에 연결할 수 없습니다.\n앱에서 로컬 서버가 켜져 있는지(Start Server) 확인해주세요.`
                : (error.response?.status === 400 || error.response?.status === 413)
                    ? `⚠️ 컨텍스트 용량 초과: 입력이 너무 깁니다. 새 대화(+)를 시작하거나 질문을 줄여주세요.`
                    : `⚠️ 오류: ${error.message}`;
            
            this._view.webview.postMessage({ type: 'error', value: errMsg });

            // 파싱된 실제 에러 표출 (LM Studio / Ollama Stream HTTP 에러)
            if (error.response?.data?.on) {
                let buf = '';
                error.response.data.on('data', (c: any) => buf += c.toString());
                error.response.data.on('end', () => {
                    try {
                        const parsed = JSON.parse(buf);
                        let detail = parsed.error?.message || parsed.error || '';
                        if (detail.includes('greater than the context length')) {
                            detail = '프로젝트 정보가 모델의 Context Length(기억력 한계)를 초과합니다.\n💡 해결책: LM Studio에서 모델을 불러올 때 오른쪽 설정 패널에서 [Context Length] 슬라이더를 8192 수정 후 리로드하세요.';
                        }
                        if (detail) {
                            this._view!.webview.postMessage({ type: 'error', value: `💡 가이드: ${detail}` });
                        }
                    } catch { /* ignore */ }
                });
            }
        }
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

            try {
                const absPath = path.resolve(rootPath, relPath);
                const dir = path.dirname(absPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(absPath, content, 'utf-8');
                if (absPath.includes('.connect-ai-brain')) brainModified = true;
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
        const editRegex = /<(?:edit_file|edit)\s+(?:path|file|name)=['"]?([^'">]+)['"]?[^>]*>([\s\S]*?)<\/(?:edit_file|edit)>/gi;
        while ((match = editRegex.exec(aiMessage)) !== null) {
            const relPath = match[1].trim();
            const body = match[2];
            const absPath = path.resolve(rootPath, relPath);

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
                    if (absPath.includes('.connect-ai-brain')) brainModified = true;
                    report.push(`✏️ 편집 완료: ${relPath} (${editCount}건 수정)`);
                    // Open edited file
                    vscode.window.showTextDocument(vscode.Uri.file(absPath), { preview: false });
                }
            } catch (err: any) {
                report.push(`❌ 편집 실패: ${relPath} — ${err.message}`);
            }
        }

        // ACTION 3: Delete files
        const deleteRegex = /<(?:delete_file|delete)\s+(?:path|file|name)=['"]?([^'"\/\>]+)['"]?\s*\/?>(?:<\/(?:delete_file|delete)>)?/gi;
        while ((match = deleteRegex.exec(aiMessage)) !== null) {
            const relPath = match[1].trim();
            const absPath = path.resolve(rootPath, relPath);
            try {
                if (fs.existsSync(absPath)) {
                    const stat = fs.statSync(absPath);
                    if (stat.isDirectory()) {
                        fs.rmSync(absPath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(absPath);
                    }
                    if (absPath.includes('.connect-ai-brain')) brainModified = true;
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
            const absPath = path.resolve(rootPath, relPath);
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
            const absDir = path.resolve(rootPath, relDir);
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

        // ACTION 6: Run commands
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
            try {
                if (!this._terminal || this._terminal.exitStatus !== undefined) {
                    this._terminal = vscode.window.createTerminal({
                        name: '🚀 Connect AI',
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

        // FALLBACK: If AI used markdown code blocks with filenames instead of XML tags
        if (report.length === 0) {
            const fallbackRegex = /```(?:[a-zA-Z]*)?\s*\n\/\/\s*(?:file|파일):\s*([^\n]+)\n([\s\S]*?)```/gi;
            while ((match = fallbackRegex.exec(aiMessage)) !== null) {
                const relPath = match[1].trim();
                const content = match[2].trim();
                if (relPath && content && relPath.includes('.')) {
                    try {
                        const absPath = path.join(rootPath, relPath);
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
                vscode.window.showTextDocument(vscode.Uri.file(firstCreatedFile), { preview: false });
            }
        }

        // Show notification
        const successCount = report.filter(r => r.startsWith('✅') || r.startsWith('✏️') || r.startsWith('🖥️') || r.startsWith('🗑️') || r.startsWith('📖') || r.startsWith('📂')).length;
        if (successCount > 0) {
            vscode.window.showInformationMessage(`Connect AI: ${successCount}개 에이전트 작업 완료!`);
        }

        // Auto-Push Second Brain changes to Cloud
        if (brainModified) {
            try {
                const brainDir = path.join(os.homedir(), '.connect-ai-brain');
                const { execSync } = require('child_process');
                execSync(`git add .`, { cwd: brainDir });
                execSync(`git commit -m "[P-Reinforce] Auto-synced structured knowledge"`, { cwd: brainDir });
                execSync(`git push`, { cwd: brainDir });
                report.push(`☁️ **[GitHub Sync]** 글로벌 뇌(Second Brain)에 지식이 성공적으로 자동 백업되었습니다!`);
            } catch (err: any) {
                report.push(`⚠️ **[GitHub Sync 보류]** 동기화 중 권한 문제가 발생했습니다 (수동 푸시 권장)`);
            }
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
            .trim();
    }


    // ============================================================
    // Webview HTML — CINEMATIC UI v3 (Content-Grade Visuals)
    // ============================================================
    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Connect AI</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#000000;--bg2:#050505;--surface:rgba(0,18,5,.75);--surface2:rgba(0,35,10,.6);
  --border:rgba(255,255,255,.08);--border2:rgba(255,255,255,.12);
  --text:#A1A1AA;--text-bright:#FFFFFF;--text-dim:#71717A;
  --accent:#00FF41;--accent2:#008F11;--accent3:#00FF41;
  --accent-glow:rgba(0,255,65,.25);--accent2-glow:rgba(0,143,17,.2);
  --input-bg:rgba(0,10,2,.9);--code-bg:#020502;
  --green:#00FF41;--yellow:#ffab40;--cyan:#00e5ff;--red:#ff5252;
}
body.vscode-light {
  --bg:#fafafa;--bg2:#ffffff;--surface:rgba(255,255,255,.8);--surface2:rgba(240,240,245,.8);
  --border:rgba(0,0,0,.08);--border2:rgba(0,0,0,.15);
  --text:#454555;--text-bright:#111118;--text-dim:#888899;
  --accent-glow:rgba(124,106,255,.1);--accent2-glow:rgba(224,64,251,.08);
  --input-bg:rgba(255,255,255,.9);--code-bg:#f5f5f7;
}
html,body{height:100%;font-family:'SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:13px;background:var(--bg);color:var(--text);display:flex;flex-direction:column;overflow:hidden}

/* AURORA BACKGROUND */
body::before{content:'';position:fixed;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(ellipse at 20% 50%,rgba(124,106,255,.06) 0%,transparent 50%),radial-gradient(ellipse at 80% 20%,rgba(224,64,251,.04) 0%,transparent 50%),radial-gradient(ellipse at 50% 80%,rgba(0,229,255,.03) 0%,transparent 50%);animation:aurora 20s ease-in-out infinite;z-index:0;pointer-events:none}
@keyframes aurora{0%,100%{transform:translate(0,0) rotate(0deg)}33%{transform:translate(2%,-1%) rotate(.5deg)}66%{transform:translate(-1%,2%) rotate(-.5deg)}}

/* HEADER */
.header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(10,10,12,.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--border);flex-shrink:0;position:relative;z-index:10}
.header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent 5%,var(--accent) 30%,var(--accent2) 50%,var(--accent3) 70%,transparent 95%);opacity:.5;animation:headerGlow 4s ease-in-out infinite alternate}
@keyframes headerGlow{0%{opacity:.3}100%{opacity:.6}}
.thinking-bar{height:2px;background:transparent;position:relative;overflow:hidden;flex-shrink:0;z-index:10}
.thinking-bar.active{background:rgba(124,106,255,.1)}
.thinking-bar.active::after{content:'';position:absolute;top:0;left:-40%;width:40%;height:100%;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2),var(--accent3),transparent);animation:thinkSlide 1.5s ease-in-out infinite}
@keyframes thinkSlide{0%{left:-40%}100%{left:100%}}
.header-left{display:flex;align-items:center;gap:8px}
.logo{width:26px;height:26px;border-radius:6px;background:#050505;border:1px solid rgba(0,255,65,.3);display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--accent);box-shadow:0 0 15px rgba(0,255,65,.15);animation:logoPulse 3s ease-in-out infinite;position:relative;text-shadow:0 0 8px var(--accent)}
.logo::after{content:'';position:absolute;inset:-1px;border-radius:7px;background:var(--accent);opacity:.2;filter:blur(3px);animation:logoPulse 3s ease-in-out infinite}
@keyframes logoPulse{0%,100%{box-shadow:0 0 10px rgba(0,255,65,.1)}50%{box-shadow:0 0 25px rgba(0,255,65,.3)}}
.brand{font-weight:800;font-size:14px;color:var(--text-bright);letter-spacing:-.5px;background:linear-gradient(135deg,#fff 40%,var(--accent) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header-right{display:flex;align-items:center;gap:5px}
select{background:rgba(22,22,28,.9);color:var(--text-bright);border:1px solid var(--border2);padding:5px 8px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer;outline:none;max-width:120px;transition:all .3s;backdrop-filter:blur(8px)}
select:hover,select:focus{border-color:var(--accent);box-shadow:0 0 12px var(--accent-glow)}
.btn-icon{background:rgba(22,22,28,.7);border:1px solid var(--border2);color:var(--text-dim);width:28px;height:28px;border-radius:8px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .3s;backdrop-filter:blur(8px);position:relative;overflow:hidden}
.btn-icon::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--accent-glow),var(--accent2-glow));opacity:0;transition:opacity .3s}
.btn-icon:hover{color:var(--text-bright);border-color:var(--accent);transform:translateY(-1px);box-shadow:0 4px 15px var(--accent-glow)}
.btn-icon:hover::before{opacity:1}

/* CHAT */
.chat{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:16px;position:relative;z-index:1}
.chat::-webkit-scrollbar{width:2px}.chat::-webkit-scrollbar-track{background:transparent}.chat::-webkit-scrollbar-thumb{background:var(--accent);border-radius:2px;opacity:.5}

/* MESSAGES */
.msg{display:flex;flex-direction:column;gap:5px;animation:msgIn .5s cubic-bezier(.16,1,.3,1)}
.msg-head{display:flex;align-items:center;gap:7px;font-weight:600;font-size:11px;color:var(--text)}
.msg-time{font-weight:400;font-size:9px;color:var(--text-dim);margin-left:auto;opacity:.6}
.av{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0}
.av-user{background:var(--surface2);color:var(--text);border:1px solid var(--border2)}
.av-ai{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 0 10px rgba(124,106,255,.3)}
.msg-body{padding-left:29px;line-height:1.75;color:var(--text);white-space:pre-wrap;word-break:break-word;font-size:13px}
.msg-user .msg-body{background:var(--surface);border:1px solid var(--border2);border-radius:14px;padding:10px 14px;margin-left:29px;color:var(--text-bright);backdrop-filter:blur(8px)}
.msg-body pre{background:var(--code-bg);border:1px solid var(--border2);border-radius:10px;padding:14px 16px;overflow-x:auto;margin:8px 0;font-size:12px;line-height:1.6;color:#c9d1d9;position:relative}
.msg-body pre::-webkit-scrollbar{height:6px}
.msg-body pre::-webkit-scrollbar-track{background:rgba(0,0,0,.2);border-radius:4px}
.msg-body pre::-webkit-scrollbar-thumb{background:rgba(124,106,255,.3);border-radius:4px}
.msg-body pre::-webkit-scrollbar-thumb:hover{background:rgba(124,106,255,.6)}
.msg-body code{font-family:'SF Mono','JetBrains Mono','Fira Code','Menlo',monospace;font-size:11.5px}
.msg-body :not(pre)>code{background:rgba(124,106,255,.1);color:var(--accent);padding:2px 7px;border-radius:5px;border:1px solid rgba(124,106,255,.15)}
.msg-body a{color:var(--accent);text-decoration:none}
.msg-body a:hover{text-decoration:underline}
.code-wrap{position:relative}
.code-lang{position:absolute;top:0;left:14px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;padding:2px 10px;border-radius:0 0 6px 6px;font-size:9px;font-family:'SF Mono',monospace;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.copy-btn{position:absolute;top:8px;right:8px;background:var(--surface2);border:1px solid var(--border2);color:var(--text-dim);padding:4px 12px;border-radius:6px;font-size:10px;cursor:pointer;opacity:0;transition:all .3s;font-family:inherit;z-index:1;backdrop-filter:blur(8px)}
.code-wrap:hover .copy-btn{opacity:1}.copy-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 0 12px var(--accent-glow)}
.copy-btn.copied{background:var(--green);color:#fff;border-color:var(--green);opacity:1}

/* BADGES */
.file-badge{background:rgba(255,171,64,.05);border:1px solid rgba(255,171,64,.2);border-radius:10px 10px 0 0;border-bottom:none;padding:8px 14px;font-size:11px;font-weight:700;color:var(--yellow);display:flex;align-items:center;gap:6px;backdrop-filter:blur(8px)}
.edit-badge{background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.2);border-radius:10px 10px 0 0;border-bottom:none;padding:8px 14px;font-size:11px;font-weight:700;color:var(--cyan);display:flex;align-items:center;gap:6px;backdrop-filter:blur(8px)}
.cmd-badge{background:rgba(124,106,255,.05);border:1px solid rgba(124,106,255,.25);border-radius:10px;padding:10px 14px;margin:8px 0;font-size:12px;color:var(--accent);font-family:'SF Mono','Menlo',monospace;display:flex;align-items:center;gap:8px;backdrop-filter:blur(8px)}
.msg-error .msg-body{color:var(--red);text-shadow:0 0 20px rgba(255,82,82,.2)}

/* WELCOME */
.welcome{text-align:center;padding:0 20px 20px;position:relative}
.welcome-logo{width:56px;height:56px;border-radius:16px;margin:0 auto 16px;background:#050505;border:1px solid rgba(0,255,65,.3);display:flex;align-items:center;justify-content:center;font-size:32px;color:var(--accent);box-shadow:inset 0 0 15px rgba(0,255,65,.1), 0 0 30px rgba(0,255,65,.2);animation:welcomeFloat 4s ease-in-out infinite;position:relative;text-shadow:0 0 15px var(--accent)}
.welcome-logo::before{content:'';position:absolute;inset:-2px;border-radius:18px;background:var(--accent);opacity:.15;filter:blur(8px);animation:pulseGlow 3s linear infinite}
@keyframes pulseGlow{0%,100%{opacity:.15;filter:blur(8px)}50%{opacity:.3;filter:blur(12px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes welcomeFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-6px) scale(1.03)}}
.welcome-title{font-size:22px;font-weight:900;letter-spacing:-1px;color:var(--text-bright);margin-bottom:8px}
@keyframes gradText{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
.welcome-sub{color:var(--text-dim);font-size:12px;line-height:1.7;margin-bottom:18px;letter-spacing:-.2px}

/* LOADING */
.loading-wrap{padding-left:29px;padding-top:6px;display:flex;align-items:center;gap:10px}
.loading-dots{display:flex;gap:4px}
.loading-dots span{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:dotBounce 1.4s ease-in-out infinite}
.loading-dots span:nth-child(2){animation-delay:.2s;background:var(--accent2)}
.loading-dots span:nth-child(3){animation-delay:.4s;background:var(--accent3)}
@keyframes dotBounce{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1.2);opacity:1}}
.loading-text{font-size:11px;color:var(--text-dim);animation:pulse 2s ease-in-out infinite;letter-spacing:.3px}

/* INPUT */
.input-wrap{padding:8px 14px 14px;flex-shrink:0;position:relative;z-index:1}
.input-box{background:var(--input-bg);border:1px solid var(--border2);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;transition:all .3s;position:relative;backdrop-filter:blur(12px)}
.input-box:focus-within{border-color:var(--accent);box-shadow:0 0 24px rgba(0,255,65,.15);animation:focusPulse 3s infinite}
@keyframes focusPulse{0%,100%{box-shadow:0 0 20px rgba(0,255,65,.08)}50%{box-shadow:0 0 28px rgba(0,255,65,.2)}}
textarea{width:100%;background:transparent;border:none;color:var(--text-bright);font-family:inherit;font-size:13px;line-height:1.5;resize:none;outline:none;min-height:22px;max-height:150px}
textarea::placeholder{color:var(--text-dim)}
.input-footer{display:flex;align-items:center;justify-content:space-between}
.input-hint{font-size:10px;color:var(--text-dim);opacity:.5}
.input-btns{display:flex;gap:5px}
.send-btn{background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;color:#fff;width:32px;height:32px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .2s;box-shadow:0 2px 12px rgba(124,106,255,.35);position:relative;overflow:hidden}
.send-btn::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,transparent,rgba(255,255,255,.15));opacity:0;transition:opacity .3s}
.send-btn:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 6px 24px rgba(124,106,255,.45)}
.send-btn:hover::after{opacity:1}
.send-btn:active{transform:scale(.92)}.send-btn:disabled{opacity:.2;cursor:not-allowed;transform:none;box-shadow:none}
.stop-btn{background:var(--red);border:none;color:#fff;width:32px;height:32px;border-radius:10px;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:11px;box-shadow:0 0 12px rgba(255,82,82,.3)}
.stop-btn.visible{display:flex}
@keyframes msgIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
.stream-active{position:relative}
.stream-active::after{content:'';display:inline-block;width:2px;height:14px;background:var(--accent);margin-left:2px;animation:blink .6s step-end infinite;vertical-align:text-bottom;border-radius:1px;box-shadow:0 0 6px var(--accent)}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.stream-active .code-wrap:last-child {
  border: 1px solid var(--accent);
  animation: codePulse 2s infinite;
}
.stream-active .code-wrap:last-child pre {
  box-shadow: inset 0 0 20px rgba(124,106,255,0.05);
}
@keyframes codePulse {
  0%, 100% { box-shadow: 0 0 15px var(--accent-glow); }
  50% { box-shadow: 0 0 35px var(--accent2-glow); border-color: var(--accent2); }
}
.main-view{flex:1;display:flex;flex-direction:column;overflow:hidden;transition:all .5s cubic-bezier(.16,1,.3,1)}
body.init .main-view{justify-content:center;margin-top:-6vh}
body.init .chat{flex:0 0 auto;overflow:visible;padding-bottom:15px}
body.init .input-wrap{max-width:680px;width:100%;margin:0 auto;transform:none;transition:all .5s cubic-bezier(.16,1,.3,1)}

/* ATTACHMENT */
.attach-btn{background:transparent;border:1px solid var(--border2);color:var(--text-dim);width:32px;height:32px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .3s;flex-shrink:0}
.attach-btn:hover{color:var(--accent);border-color:var(--accent);box-shadow:0 0 12px var(--accent-glow);transform:translateY(-1px)}
.attach-preview{display:none;gap:6px;padding:0 0 6px;flex-wrap:wrap}
.attach-preview.visible{display:flex}
.attach-chip{display:flex;align-items:center;gap:5px;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:4px 10px;font-size:10px;color:var(--text);animation:msgIn .3s ease}
.attach-chip .chip-icon{font-size:12px}
.attach-chip .chip-name{max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.attach-chip .chip-remove{cursor:pointer;color:var(--text-dim);font-size:12px;margin-left:2px;transition:color .2s}
.attach-chip .chip-remove:hover{color:var(--red)}
.attach-thumb{width:28px;height:28px;border-radius:5px;object-fit:cover;border:1px solid var(--border2)}

/* REGENERATE BUTTON */
.regen-btn{display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);padding:4px 12px;border-radius:8px;font-size:10px;cursor:pointer;transition:all .3s;font-family:inherit;margin-top:6px;margin-left:29px}
.regen-btn:hover{color:var(--accent);border-color:var(--accent);box-shadow:0 0 12px var(--accent-glow)}

/* SYNTAX HIGHLIGHTING */
.msg-body pre .kw{color:#c792ea}
.msg-body pre .str{color:#c3e88d}
.msg-body pre .num{color:#f78c6c}
.msg-body pre .cm{color:#546e7a;font-style:italic}
.msg-body pre .fn{color:#82aaff}
.msg-body pre .tag{color:#f07178}
.msg-body pre .attr{color:#ffcb6b}
.msg-body pre .op{color:#89ddff}
.msg-body pre .type{color:#ffcb6b}
</style></head><body class="init">
<div class="header"><div class="header-left"><div class="logo">\u2726</div><span class="brand">Connect AI</span></div><div class="header-right"><select id="modelSel"></select><button class="btn-icon" id="internetBtn" title="Internet Access: OFF (Click to toggle)" style="opacity: 0.4; filter: grayscale(1);">🌐</button><button class="btn-icon" id="brainBtn" title="Neural Construct 🧠">\ud83e\udde0</button><button class="btn-icon" id="settingsBtn" title="Settings">\u2699\ufe0f</button><button class="btn-icon" id="newChatBtn" title="New Chat">+</button></div></div>
<div class="thinking-bar" id="thinkingBar"></div>
<div class="main-view" id="mainView">
<div class="chat" id="chat">
<div class="welcome">
<div class="welcome-logo">\u2726</div>
<div class="welcome-title">Connect AI</div>
<div class="welcome-sub">\ubcf4\uc548 \u00b7 \ube44\uc6a9\ucd5c\uc801\ud654 \u00b7 \uc9c0\uc2dd\uc5f0\uacb0<br>\ud504\ub85c\uc81d\ud2b8\ub97c \uc774\ud574\ud558\uace0, \ucf54\ub4dc\ub97c \uc791\uc131\ud558\uace0, \uc2e4\ud589\ud569\ub2c8\ub2e4.</div>
</div></div>
<div class="input-wrap"><div class="input-box">
<div class="attach-preview" id="attachPreview"></div>
<textarea id="input" rows="1" placeholder="\ubb34\uc5c7\uc744 \ub9cc\ub4e4\uc5b4 \ub4dc\ub9b4\uae4c\uc694?"></textarea>
<div class="input-footer"><span class="input-hint">Enter \uc804\uc1a1 \u00b7 Shift+Enter \uc904\ubc14\uafc8</span>
<div class="input-btns"><button class="attach-btn" id="attachBtn" title="\ud30c\uc77c \ucca8\ubd80">+</button><button class="attach-btn" id="injectLocalBtn" title="Inject Brain Pack \ud83d\udc89">⚡</button><button class="stop-btn" id="stopBtn">\u25a0</button><button class="send-btn" id="sendBtn">\u2191</button></div></div></div>
<input type="file" id="fileInput" multiple accept="image/*,audio/*,.txt,.md,.csv,.json,.js,.ts,.html,.css,.py,.java,.rs,.go,.yaml,.yml,.xml,.toml" hidden></div>
</div>
<script>
window.onerror = function(msg, url, line, col, error) {
  document.body.innerHTML += '<div style="position:absolute;z-index:9999;background:red;color:white;padding:10px;top:0;left:0;right:0">ERROR: ' + msg + ' at line ' + line + '</div>';
};
window.addEventListener('unhandledrejection', function(event) {
  document.body.innerHTML += '<div style="position:absolute;z-index:9999;background:red;color:white;padding:10px;bottom:0;left:0;right:0">PROMISE REJECTION: ' + event.reason + '</div>';
});
try {
const vscode=acquireVsCodeApi(),chat=document.getElementById('chat'),input=document.getElementById('input'),
sendBtn=document.getElementById('sendBtn'),stopBtn=document.getElementById('stopBtn'),
modelSel=document.getElementById('modelSel'),newChatBtn=document.getElementById('newChatBtn'),settingsBtn=document.getElementById('settingsBtn'),brainBtn=document.getElementById('brainBtn'),
internetBtn=document.getElementById('internetBtn'),attachBtn=document.getElementById('attachBtn'),injectLocalBtn=document.getElementById('injectLocalBtn'),fileInput=document.getElementById('fileInput'),attachPreview=document.getElementById('attachPreview'),
thinkingBar=document.getElementById('thinkingBar');
let loader=null,sending=false,pendingFiles=[],internetEnabled=false;

internetBtn.addEventListener('click', ()=>{
  internetEnabled=!internetEnabled;
  internetBtn.style.opacity=internetEnabled?'1':'0.4';
  internetBtn.style.filter=internetEnabled?'none':'grayscale(1)';
  internetBtn.title='Internet & Time Sync: ' + (internetEnabled?'ON':'OFF') + ' (Click to toggle)';
  const msg = document.createElement('div');
  msg.className='msg';
  msg.innerHTML='<div class="msg-body" style="color:#00bdff;font-size:12px;opacity:0.8;">🌐 인터넷 및 시간 동기화 모드가 ' + (internetEnabled?'ON':'OFF') + ' 되었습니다.</div>';
  chat.appendChild(msg);
  chat.scrollTop=chat.scrollHeight;
});

/* Syntax Highlighting (lightweight) */
function highlight(code,lang){
  let h=esc(code);
  h=h.replace(new RegExp("(\\\\/\\\\/[^\\\\n]*)", "g"),'<span class=\"cm\">$1</span>');
  h=h.replace(new RegExp("(#[^\\\\n]*)", "g"),'<span class=\"cm\">$1</span>');
  h=h.replace(new RegExp("(\\\\/\\\\*[\\\\s\\\\S]*?\\\\*\\\\/)", "g"),'<span class=\"cm\">$1</span>');
  h=h.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g,'<span class=\"str\">$1</span>');
  h=h.replace(new RegExp("\\\\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\\\\b", "g"),'<span class=\"kw\">$1</span>');
  h=h.replace(new RegExp("\\\\b(\\\\d+\\\\.?\\\\d*)\\\\b", "g"),'<span class=\"num\">$1</span>');
  h=h.replace(new RegExp("\\\\b(True|False|None|true|false|null|undefined|NaN)\\\\b", "g"),'<span class=\"num\">$1</span>');
  h=h.replace(new RegExp("\\\\b(String|Number|Boolean|Array|Object|Map|Set|Promise|void|int|float|str|list|dict|tuple)\\\\b", "g"),'<span class=\"type\">$1</span>');
  h=h.replace(/([=!+*/%|&^~?:-]+)/g,'<span class=\"op\">$1</span>');
  return h;
}

/* Clipboard Paste (Ctrl+V images) */
input.addEventListener('paste',(e)=>{
  const items=e.clipboardData&&e.clipboardData.items;
  if(!items)return;
  for(const item of items){
    if(item.type.startsWith('image/')){
      e.preventDefault();
      const file=item.getAsFile();
      if(!file)return;
      const reader=new FileReader();
      reader.onload=()=>{
        const base64=reader.result.split(',')[1];
        pendingFiles.push({name:'clipboard-image.png',type:file.type,data:base64});
        renderPreview();
      };
      reader.readAsDataURL(file);
      return;
    }
  }
});
vscode.postMessage({type:'getModels'});
setTimeout(()=>vscode.postMessage({type:'ready'}),300);
input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px'});
function getTime(){return new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}
function esc(s){const d=document.createElement('div');d.innerText=s;return d.innerHTML}
function fmt(t){
  if(t.lastIndexOf('<create_file') > t.lastIndexOf('</create_file>')) t += '</create_file>';
  if(t.lastIndexOf('<edit_file') > t.lastIndexOf('</edit_file>')) t += '</edit_file>';
  if(t.lastIndexOf('<run_command') > t.lastIndexOf('</run_command>')) t += '</run_command>';
  if((t.match(/\x60\x60\x60/g)||[]).length % 2 !== 0) t += '\\\\n\x60\x60\x60';

  const blocks = [];
  function pushB(h){ blocks.push(h); return '__B' + (blocks.length-1) + '__'; }
  t=t.replace(/<create_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/create_file>/g,(_,p,c)=>pushB('<div class="file-badge">\ud83d\udcc1 '+esc(p)+' \u2014 \uc790\ub3d9 \uc0dd\uc131\ub428</div><div class="code-wrap"><pre><code>'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>'));
  t=t.replace(/<edit_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/edit_file>/g,(_,p,c)=>pushB('<div class="edit-badge">\u270f\ufe0f '+esc(p)+' \u2014 \ud3b8\uc9d1\ub428</div><div class="code-wrap"><pre><code>'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>'));
  t=t.replace(/<run_command>([\\s\\S]*?)<\\/run_command>/g,(_,c)=>pushB('<div class="cmd-badge">\u25b6 '+esc(c)+'</div>'));
  t=t.replace(/\x60\x60\x60(\\w*)\\n([\\s\\S]*?)\x60\x60\x60/g,(_,lang,c)=>{const l=lang||'code';return pushB('<div class="code-wrap"><span class="code-lang">'+esc(l)+'</span><pre><code>'+highlight(c,l)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>');});
  t=t.replace(/\x60([^\x60]+)\x60/g,(_,c)=>pushB('<code>'+esc(c)+'</code>'));
  t=esc(t);
  t=t.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');
  t=t.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
  t=t.replace(/__B(\\d+)__/g, (_,i)=>blocks[i]);
  return t;
}
function copyCode(btn){const code=btn.parentElement.querySelector('code');if(!code)return;navigator.clipboard.writeText(code.innerText).then(()=>{btn.textContent='\u2713 Copied';btn.classList.add('copied');setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied')},1500)})}
function addMsg(text,role){
  const isUser=role==='user',isErr=role==='error';
  const el=document.createElement('div');el.className='msg'+(isUser?' msg-user':'')+(isErr?' msg-error':'');
  const head=document.createElement('div');head.className='msg-head';
  head.innerHTML=(isUser?'<div class="av av-user">\ud83d\udc64</div><span>You</span>':'<div class="av av-ai">\u2726</div><span>Connect AI</span>')+'<span class="msg-time">'+getTime()+'</span>';
  const body=document.createElement('div');body.className='msg-body';
  if(isUser){body.innerText=text}else{body.innerHTML=fmt(text)}
  el.appendChild(head);el.appendChild(body);chat.appendChild(el);chat.scrollTop=chat.scrollHeight;
}
function showLoader(){loader=document.createElement('div');loader.className='msg';loader.innerHTML='<div class="msg-head"><div class="av av-ai">\u2726</div><span>Connect AI</span><span class="msg-time">'+getTime()+'</span></div><div class="loading-wrap"><div class="loading-dots"><span></span><span></span><span></span></div><span class="loading-text">\uc0dd\uac01\ud558\ub294 \uc911...</span></div>';chat.appendChild(loader);chat.scrollTop=chat.scrollHeight;thinkingBar.classList.add('active')}
function hideLoader(){if(loader&&loader.parentNode)loader.parentNode.removeChild(loader);loader=null;thinkingBar.classList.remove('active')}
function setSending(v){sending=v;sendBtn.disabled=v;stopBtn.classList.toggle('visible',v);input.disabled=v;if(!v){input.focus();thinkingBar.classList.remove('active')}}
function send(){
  const text=input.value.trim();
  if((!text&&pendingFiles.length===0)||sending)return;
  document.body.classList.remove('init');
  const w=document.querySelector('.welcome');if(w)w.remove();
  document.querySelectorAll('.quick-actions').forEach(e=>e.remove());
  const displayText=text+(pendingFiles.length>0?'\\\\n\\ud83d\\udcce '+pendingFiles.map(f=>f.name).join(', '):'');
  addMsg(displayText,'user');
  input.value='';input.style.height='auto';setSending(true);showLoader();
  if(pendingFiles.length>0){
    vscode.postMessage({type:'promptWithFile',value:text||'\uc774 \ud30c\uc77c\uc744 \ubd84\uc11d\ud574\uc8fc\uc138\uc694.',model:modelSel.value,files:pendingFiles,internet:internetEnabled});
    pendingFiles=[];attachPreview.innerHTML='';attachPreview.classList.remove('visible');
  } else {
    vscode.postMessage({type:'prompt',value:text,model:modelSel.value,internet:internetEnabled});
  }
}

/* Attachment Logic */
attachBtn.addEventListener('click',()=>fileInput.click());
injectLocalBtn.addEventListener('click',()=>{
  if(pendingFiles.length===0){
    alert('\ucca8\ubd80\ub41c \ud30c\uc77c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. + \ubc84\ud2bc\uc744 \ub20c\ub7ec \uc5f0\ub3d9\ud560 \ubb38\uc11c\ub97c \uba3c\uc800 \ucd94\uac00\ud574\uc8fc\uc138\uc694.');
    return;
  }
  vscode.postMessage({type:'injectLocalBrain', files:pendingFiles});
  pendingFiles=[];
  renderPreview();
});
fileInput.addEventListener('change',()=>{
  const files=Array.from(fileInput.files);
  files.forEach(file=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const base64=reader.result.split(',')[1];
      pendingFiles.push({name:file.name,type:file.type,data:base64});
      renderPreview();
    };
    reader.readAsDataURL(file);
  });
  fileInput.value='';
});
function renderPreview(){
  attachPreview.innerHTML='';
  if(pendingFiles.length===0){attachPreview.classList.remove('visible');return;}
  attachPreview.classList.add('visible');
  pendingFiles.forEach((f,i)=>{
    const chip=document.createElement('div');chip.className='attach-chip';
    const isImg=f.type.startsWith('image/');
    if(isImg){
      const thumb=document.createElement('img');thumb.className='attach-thumb';thumb.src='data:'+f.type+';base64,'+f.data;chip.appendChild(thumb);
    } else {
      const icon=document.createElement('span');icon.className='chip-icon';icon.textContent=f.type.startsWith('audio/')?'\ud83c\udfa7':'\ud83d\udcc4';chip.appendChild(icon);
    }
    const nm=document.createElement('span');nm.className='chip-name';nm.textContent=f.name;chip.appendChild(nm);
    const rm=document.createElement('span');rm.className='chip-remove';rm.textContent='\u2715';
    rm.addEventListener('click',()=>{pendingFiles.splice(i,1);renderPreview();});
    chip.appendChild(rm);
    attachPreview.appendChild(chip);
  });
}
document.addEventListener('click',e=>{if(e.target.classList.contains('qa-btn')){const p=e.target.getAttribute('data-prompt');if(p){input.value=p;send()}}});
sendBtn.addEventListener('click',send);
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
newChatBtn.addEventListener('click',()=>vscode.postMessage({type:'newChat'}));
settingsBtn.addEventListener('click',()=>vscode.postMessage({type:'openSettings'}));
brainBtn.addEventListener('click',()=>vscode.postMessage({type:'syncBrain'}));
stopBtn.addEventListener('click',()=>{vscode.postMessage({type:'stopGeneration'});hideLoader();setSending(false);if(streamBody){streamBody.classList.remove('stream-active')}streamEl=null;streamBody=null;});
let streamEl=null,streamBody=null;
window.addEventListener('message',e=>{const msg=e.data;switch(msg.type){
  case 'response':hideLoader();setSending(false);addMsg(msg.value,'ai');break;
  case 'error':hideLoader();setSending(false);addMsg(msg.value,'error');break;
  case 'streamStart':{
    hideLoader();
    streamEl=document.createElement('div');streamEl.className='msg';
    const h=document.createElement('div');h.className='msg-head';
    h.innerHTML='<div class="av av-ai">\u2726</div><span>Connect AI</span><span class="msg-time">'+getTime()+'</span>';
    streamBody=document.createElement('div');streamBody.className='msg-body stream-active';
    streamEl.appendChild(h);streamEl.appendChild(streamBody);chat.appendChild(streamEl);chat.scrollTop=chat.scrollHeight;
    break;}
  case 'streamChunk':{
    if(streamBody){streamBody.innerHTML=fmt(streamBody._raw=(streamBody._raw||'')+msg.value);chat.scrollTop=chat.scrollHeight;}
    break;}
  case 'streamEnd':{
    if(streamBody)streamBody.classList.remove('stream-active');
    /* Add regenerate button */
    if(streamEl){
      const rb=document.createElement('button');rb.className='regen-btn';rb.innerHTML='🔄 재생성';
      rb.addEventListener('click',()=>{rb.remove();vscode.postMessage({type:'regenerate'});showLoader();setSending(true);});
      streamEl.appendChild(rb);
    }
    setSending(false);streamEl=null;streamBody=null;
    break;}
  case 'modelsList':modelSel.innerHTML='';msg.value.forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;modelSel.appendChild(o)});break;
  case 'clearChat':
    document.body.classList.add('init');
    chat.innerHTML='<div class="welcome"><div class="welcome-logo">\u2726</div><div class="welcome-title">Connect AI</div><div class="welcome-sub">\ubcf4\uc548 \u00b7 \ube44\uc6a9\ucd5c\uc801\ud654 \u00b7 \uc9c0\uc2dd\uc5f0\uacb0<br>\ud504\ub85c\uc81d\ud2b8\ub97c \uc774\ud574\ud558\uace0, \ucf54\ub4dc\ub97c \uc791\uc131\ud558\uace0, \uc2e4\ud589\ud569\ub2c8\ub2e4.</div></div>';
    break;
  case 'restoreMessages':
    chat.innerHTML='';
    if(msg.value&&msg.value.length>0){
      document.body.classList.remove('init');
      msg.value.forEach(m=>addMsg(m.text,m.role));
    } else {
      document.body.classList.add('init');
      chat.innerHTML='<div class="welcome"><div class="welcome-logo">\u2726</div><div class="welcome-title">Connect AI</div><div class="welcome-sub">\ubcf4\uc548 \u00b7 \ube44\uc6a9\ucd5c\uc801\ud654 \u00b7 \uc9c0\uc2dd\uc5f0\uacb0<br>\ud504\ub85c\uc81d\ud2b8\ub97c \uc774\ud574\ud558\uace0, \ucf54\ub4dc\ub97c \uc791\uc131\ud558\uace0, \uc2e4\ud589\ud569\ub2c8\ub2e4.</div></div>';
    }
    break;
  case 'focusInput':input.focus();break;
  case 'injectPrompt':input.value=msg.value;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px';send();break;
} });
} catch(err) {
  document.body.innerHTML = '<div style="color:#ff4444;padding:20px;background:#111;height:100%;font-size:14px;overflow:auto;"><h2>\u26a0\ufe0f WEBVIEW JS CRASH</h2><pre>' + err.name + ': ' + err.message + '\\n' + err.stack + '</pre></div>';
}
</script></body></html>`;
    }
}
