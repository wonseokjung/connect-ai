/* conversation-log.ts — 회사 대화 로그 (append/read) 헬퍼.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: fs·path + paths(회사 폴더)뿐. 순수 파일 IO — 본문 역참조 0.
 * approvals·telegram·schedulers·scaffold·sidebar 등 다수가 공유하는 공통 헬퍼. */
import * as fs from 'fs';
import * as path from 'path';
import { getCompanyDir } from './paths';

/** Resolve the conversation log directory inside the user's brain folder.
 *  Lives at `<brain>/00_Raw/conversations/` so it joins the existing
 *  Second-Brain raw-knowledge convention — visible to the brain graph,
 *  synced by GitHub auto-sync, browsable in the user's note-taking app. */
export function getConversationsDir(): string {
  const brain = getCompanyDir(); // unified with brain folder
  return path.join(brain, '00_Raw', 'conversations');
}

/** Append one entry to the day's running conversation log. Living transcript
 *  of every interaction in the company — user commands, CEO briefs, each
 *  agent's output, confer turns, final reports. Stored in 00_Raw alongside
 *  other raw knowledge so it participates in brain queries. */
export function appendConversationLog(entry: { speaker: string; emoji?: string; section?: string; body: string }) {
  try {
    const convDir = getConversationsDir();
    fs.mkdirSync(convDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const dayFile = path.join(convDir, `${today}.md`);
    if (!fs.existsSync(dayFile)) {
      fs.writeFileSync(dayFile, `# 📜 ${today} 회사 대화록\n\n_모든 명령·분배·산출물·대화가 시간순으로 누적됩니다. 두뇌가 자동 인덱싱·동기화합니다._\n`);
    }
    const ts = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const emoji = entry.emoji || '🗨️';
    const sectionLine = entry.section ? ` · _${entry.section}_` : '';
    const block = `\n## [${ts}] ${emoji} **${entry.speaker}**${sectionLine}\n\n${entry.body}\n`;
    fs.appendFileSync(dayFile, block);
  } catch { /* logging must never break the flow */ }
}

/** Read the last N chars (across today + yesterday) of the conversation log
 *  for use as system-prompt context. Lets CEO recall what the company has
 *  recently been working on without needing the full file. */
export function readRecentConversations(maxChars = 2500): string {
  try {
    const convDir = getConversationsDir();
    if (!fs.existsSync(convDir)) return '';
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let combined = '';
    for (const day of [yesterday, today]) {
      const f = path.join(convDir, `${day}.md`);
      if (fs.existsSync(f)) {
        try { combined += fs.readFileSync(f, 'utf-8'); } catch { /* ignore */ }
      }
    }
    if (!combined) return '';
    const tail = combined.slice(-maxChars);
    return `\n\n[최근 회사 대화 요약 (참고용)]\n${tail}\n`;
  } catch {
    return '';
  }
}
