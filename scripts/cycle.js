#!/usr/bin/env node
/**
 * Standalone 24h autonomous cycle for Connect AI Lab.
 *
 * Runs OUTSIDE the VS Code extension lifecycle so the company keeps working
 * even when the IDE is closed. Reads the brain folder, asks the local LLM to
 * decide one priority task, executes it as a CEO planner round, writes the
 * output to <brain>/sessions/<ts>/, and appends to the daily conversation log.
 *
 * Schedule via macOS launchd / Linux cron / Windows Task Scheduler. Examples
 * at the bottom of this file.
 *
 * Requirements:
 *   - Node 18+
 *   - Ollama OR LM Studio running locally
 *   - axios (npm i axios)
 *
 * Usage:
 *   node cycle.js                          # uses defaults
 *   BRAIN_DIR=~/my-brain node cycle.js     # custom brain folder
 *   OLLAMA_URL=http://127.0.0.1:11434 MODEL=gemma4:e2b node cycle.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

// ───────────────────────── Config (env-overridable) ─────────────────────────
const BRAIN_DIR = (process.env.BRAIN_DIR || path.join(os.homedir(), '.connect-ai-brain')).replace(/^~/, os.homedir());
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const LMSTUDIO_URL = process.env.LMSTUDIO_URL || 'http://127.0.0.1:1234';
const MODEL = process.env.MODEL || 'gemma4:e2b';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '180000', 10);

// ───────────────────────── Helpers ─────────────────────────
const safeRead = (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } };
const today = () => new Date().toISOString().slice(0, 10);
const nowTs = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

async function detectEngine() {
    try { await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 1500 }); return { kind: 'ollama', url: OLLAMA_URL }; } catch {}
    try { await axios.get(`${LMSTUDIO_URL}/v1/models`, { timeout: 1500 }); return { kind: 'lmstudio', url: LMSTUDIO_URL }; } catch {}
    throw new Error('No local LLM detected. Ensure Ollama or LM Studio is running.');
}

async function callLLM(engine, system, user) {
    if (engine.kind === 'lmstudio') {
        const r = await axios.post(`${engine.url}/v1/chat/completions`, {
            model: MODEL, stream: false, max_tokens: 2048, temperature: 0.6,
            messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
        }, { timeout: TIMEOUT_MS });
        return r.data.choices?.[0]?.message?.content || '';
    }
    const r = await axios.post(`${engine.url}/api/chat`, {
        model: MODEL, stream: false,
        messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
        options: { num_ctx: 8192, num_predict: 2048, temperature: 0.6 },
    }, { timeout: TIMEOUT_MS });
    return r.data.message?.content || '';
}

// ───────────────────────── Cycle body ─────────────────────────
async function runCycle() {
    if (!fs.existsSync(path.join(BRAIN_DIR, '_shared'))) {
        console.error(`✗ Brain folder not initialized at ${BRAIN_DIR}. Open the IDE extension once to set up.`);
        process.exit(1);
    }
    const engine = await detectEngine();
    console.log(`✓ Engine: ${engine.kind} @ ${engine.url} · model: ${MODEL}`);

    const identity = safeRead(path.join(BRAIN_DIR, '_shared', 'identity.md')).slice(0, 1500);
    const goals = safeRead(path.join(BRAIN_DIR, '_shared', 'goals.md')).slice(0, 2000);
    const decisions = safeRead(path.join(BRAIN_DIR, '_shared', 'decisions.md')).slice(-2000);

    const sysPrompt = `당신은 자율적으로 운영되는 1인 AI 기업의 CEO입니다. 사용자가 자리에 없는 동안 회사를 가치 있는 방향으로 한 걸음 진전시키는 단일 작업을 결정하고 실행합니다.

[회사 정체성]
${identity}

[공동 목표]
${goals}

[최근 의사결정]
${decisions}

지금 가장 가치 있는 작업 1개를 선택해서 직접 수행하세요. 출력은 마크다운으로:

# 🌙 자율 사이클 — ${today()} ${new Date().toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'})}

## 선택한 작업
(왜 이 작업이 가장 가치 있는지)

## 실행 결과
(실제 산출물 — 영상 기획서·카피·전략 분석 등 즉시 사용 가능한 형태)

## 다음 사이클 추천
(다음에 할 가치 있는 1~2가지)`;

    const userMsg = `현재 시각: ${new Date().toISOString()}. 사용자가 자리를 비웠습니다. 회사 가치를 높이는 한 걸음을 진행하세요.`;

    console.log('· Calling LLM...');
    const out = await callLLM(engine, sysPrompt, userMsg);
    if (!out.trim()) throw new Error('Empty LLM response.');

    // Save to a session folder
    const sessionDir = path.join(BRAIN_DIR, 'sessions', `auto-${nowTs()}`);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, '_report.md'), out);

    // Append to daily conversation log so the IDE-side timeline picks it up
    const convDir = path.join(BRAIN_DIR, '00_Raw', 'conversations');
    fs.mkdirSync(convDir, { recursive: true });
    const dayFile = path.join(convDir, `${today()}.md`);
    if (!fs.existsSync(dayFile)) {
        fs.writeFileSync(dayFile, `# 📜 ${today()} 회사 대화록\n\n_모든 명령·분배·산출물·대화가 시간순으로 누적됩니다._\n`);
    }
    const ts = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const block = `\n## [${ts}] 🌙 **자율 사이클** · _IDE 외부_\n\n${out}\n`;
    fs.appendFileSync(dayFile, block);

    console.log(`✓ Cycle complete. Output saved: ${sessionDir}/_report.md`);
    console.log(`✓ Conversation log: ${dayFile}`);
}

// ───────────────────────── Run + error handling ─────────────────────────
runCycle().catch((e) => {
    console.error('✗ Cycle failed:', e.message);
    process.exit(1);
});

/* ─── Scheduling examples ─────────────────────────────────────────────────

# macOS launchd — every 30 minutes
# Save as ~/Library/LaunchAgents/com.connectai.cycle.plist
# <?xml version="1.0" encoding="UTF-8"?>
# <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
# <plist version="1.0">
# <dict>
#   <key>Label</key><string>com.connectai.cycle</string>
#   <key>ProgramArguments</key>
#   <array>
#     <string>/usr/local/bin/node</string>
#     <string>/path/to/cycle.js</string>
#   </array>
#   <key>StartInterval</key><integer>1800</integer>
#   <key>StandardOutPath</key><string>/tmp/connectai.cycle.log</string>
#   <key>StandardErrorPath</key><string>/tmp/connectai.cycle.err</string>
# </dict>
# </plist>
# Then: launchctl load ~/Library/LaunchAgents/com.connectai.cycle.plist

# Linux/macOS cron — every 30 minutes
# */30 * * * * /usr/local/bin/node /path/to/cycle.js >> ~/.connect-ai-brain/cycle.log 2>&1

# Windows Task Scheduler — create a task that runs node.exe with this script as arg
# every 30 min, with working directory set to the brain folder.

──────────────────────────────────────────────────────────────────────────── */
