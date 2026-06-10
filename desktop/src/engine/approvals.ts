// ✅ 승인 큐 — 에이전트가 중요한 행동 전에 사장님 승인을 요청. <approve>제목 | 상세</approve>
import * as fs from 'fs';

export interface ApprovalAction { kind: 'run' | 'write' | 'telegram' | 'email' | 'github' | 'ytmeta'; payload: string; path?: string; }   // github=콘텐츠 발행(레포 푸시), ytmeta=유튜브 제목·설명 수정
export interface Approval {
  id: string; title: string; summary: string; agentEmoji: string;
  status: 'pending' | 'approved' | 'rejected'; createdAt: number;
  action?: ApprovalAction; result?: string;
}

let FILE = '';
let items: Approval[] = [];

export function setApprovalFile(p: string) {
  FILE = p;
  try { items = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { items = []; }
}
function save() { try { fs.writeFileSync(FILE, JSON.stringify(items, null, 2)); } catch { /* */ } }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function listApprovals(): Approval[] { return items.slice().sort((a, b) => b.createdAt - a.createdAt); }
export function pendingApprovals(): Approval[] { return listApprovals().filter(a => a.status === 'pending'); }
export function approvalCount(): number { return pendingApprovals().length; }

export function addApproval(title: string, summary = '', agentEmoji = '🤖', action?: ApprovalAction): Approval {
  const a: Approval = { id: uid(), title: (title || '').trim().slice(0, 160), summary: (summary || '').trim().slice(0, 400), agentEmoji, status: 'pending', createdAt: Date.now(), action };
  items.push(a); save(); return a;
}
export function getApproval(id: string): Approval | undefined { return items.find(x => x.id === id); }
// 초안 수정(텔레그램에서 "수정 …") — 액션 내용을 갈아끼우고 저장
export function updateApprovalAction(id: string, action: ApprovalAction): Approval | undefined {
  const a = items.find(x => x.id === id); if (a) { a.action = action; save(); } return a;
}
export function setApprovalStatus(id: string, status: Approval['status'], result?: string): Approval | undefined {
  const a = items.find(x => x.id === id); if (a) { a.status = status; if (result != null) a.result = result; save(); } return a;
}
