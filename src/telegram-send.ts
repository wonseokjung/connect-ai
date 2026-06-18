/* telegram-send.ts — 텔레그램 발신 코어 (설정 읽기 + 메시지/타이핑 전송).
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: axios·path + paths(회사 폴더) + core/fs-safe(_safeReadText). 순수 발신 — provider/LLM 결합 없음.
 * 텔레그램 폴링·핸들러(provider 양방향 결합)는 본문 잔류, 발신만 분리해 schedulers·approvals·scaffold 가 공유. */
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { getCompanyDir } from './paths';
import { _safeReadText } from './core/fs-safe';

export function readTelegramConfig(): { token: string; chatId: string } {
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

/* v2.89.157 — Telegram legacy Markdown 은 ## / ### 헤더·- 리스트·표를 지원 안 함.
   원본 마크다운을 Telegram 이 렌더 가능한 *bold* + 깔끔한 indent 로 변환. */
export function _markdownToTelegram(src: string): string {
  let s = src || '';
  s = s.replace(/^#{4,6}\s+(.+)$/gm, '*$1*');
  s = s.replace(/^###\s+(.+)$/gm, '*$1*');
  s = s.replace(/^##\s+(.+)$/gm, '\n*━━ $1 ━━*');
  s = s.replace(/^#\s+(.+)$/gm, '\n*『$1』*');
  s = s.replace(/^\s*\|.*\|\s*$/gm, line => {
    const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.every(c => /^[-:\s]+$/.test(c))) return '';
    return '• ' + cells.join(' · ');
  });
  s = s.replace(/\n\n+/g, '\n\n');
  return s.trim();
}

export async function sendTelegramReport(text: string): Promise<boolean> {
  const { token, chatId } = readTelegramConfig();
  if (!token || !chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text: _markdownToTelegram(text).slice(0, 4000),
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
export async function sendTelegramLong(text: string): Promise<boolean> {
  const { token, chatId } = readTelegramConfig();
  if (!token || !chatId) return false;
  const clean = _markdownToTelegram((text || '').trim());
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
export async function sendTelegramTyping(): Promise<void> {
  const { token, chatId } = readTelegramConfig();
  if (!token || !chatId) return;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendChatAction`, {
      chat_id: chatId, action: 'typing'
    }, { timeout: 4000, validateStatus: () => true });
  } catch { /* ignore */ }
}
