// 📧 이메일 채널 — SMTP(nodemailer) 발송 + IMAP(imapflow) 수신. 에이전트가 받은 메일에 답장 초안을 짜게.
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface SmtpCfg { host?: string; port?: string; user?: string; pass?: string; from?: string; }
export interface ImapCfg { host?: string; port?: string; user?: string; pass?: string; }
export interface IncomingMail { uid: number; from: string; fromName: string; subject: string; text: string; date: string; messageId: string; }

// 📥 안 읽은 메일 가져오기(읽음 처리는 안 함 — 받은편지함에 그대로 둠)
export async function fetchUnseen(cfg: ImapCfg, limit = 5): Promise<{ ok: boolean; mails?: IncomingMail[]; error?: string }> {
  if (!cfg.host || !cfg.user || !cfg.pass) return { ok: false, error: 'IMAP 미설정' };
  const client = new ImapFlow({ host: cfg.host, port: Number(cfg.port) || 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const mails: IncomingMail[] = [];
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of uids.slice(-limit)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const p = await simpleParser(msg.source as Buffer);
        const f = (p.from as any)?.value?.[0] || {};
        mails.push({ uid: Number(uid), from: f.address || '', fromName: f.name || '', subject: p.subject || '(제목 없음)', text: (p.text || '').replace(/\r/g, '').trim().slice(0, 4000), date: p.date ? p.date.toISOString() : '', messageId: p.messageId || `uid-${uid}` });
      }
    } finally { lock.release(); }
    await client.logout();
    return { ok: true, mails };
  } catch (e: any) { try { await client.close(); } catch { /* */ } return { ok: false, error: e?.message || String(e) }; }
}

export async function sendEmail(s: SmtpCfg, to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!s.host || !s.user || !s.pass) return { ok: false, error: '이메일(SMTP) 미설정 — 🗂️ 연동에서 먼저 연결하세요.' };
  if (!to) return { ok: false, error: '받는 사람(to)이 없어요.' };
  const port = Number(s.port) || 587;
  try {
    const t = nodemailer.createTransport({ host: s.host, port, secure: port === 465, auth: { user: s.user, pass: s.pass } });
    await t.sendMail({ from: s.from || s.user, to, subject: subject || '(제목 없음)', text: body || '' });
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}
