// 📋 태스크 트래커 — 할 일을 파일에 저장. 사용자가 추가하거나, 에이전트가 <task>로 자동 생성.
import * as fs from 'fs';

export interface Task {
  id: string; title: string; priority: 'normal' | 'high' | 'urgent';
  owner: 'user' | 'agent'; agentEmoji: string; status: 'open' | 'done' | 'cancelled'; createdAt: number;
}

let TASK_FILE = '';
let tasks: Task[] = [];

export function setTaskFile(p: string) {
  TASK_FILE = p;
  try { tasks = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { try { tasks = JSON.parse(fs.readFileSync(p + '.bak', 'utf8')); } catch { tasks = []; } }   // 🛟 손상 → 백업 복구
}
function save() {
  try {
    const tmp = TASK_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));   // 원자적: tmp → rename
    try { const cur = fs.readFileSync(TASK_FILE, 'utf8'); JSON.parse(cur); fs.writeFileSync(TASK_FILE + '.bak', cur); } catch { /* 직전본 없음/손상 → 백업 생략 */ }
    fs.renameSync(tmp, TASK_FILE);
  } catch { /* */ }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function listTasks(): Task[] { return tasks.slice().sort((a, b) => b.createdAt - a.createdAt); }
export function openTasks(): Task[] { return listTasks().filter(t => t.status === 'open'); }
export function taskCount(): number { return openTasks().length; }

export function addTask(title: string, opts: Partial<Task> = {}): Task {
  const t: Task = {
    id: uid(), title: (title || '').trim().slice(0, 200), priority: opts.priority || 'normal',
    owner: opts.owner || 'user', agentEmoji: opts.agentEmoji || '', status: 'open', createdAt: Date.now(),
  };
  tasks.push(t); save(); return t;
}
export function setStatus(id: string, status: Task['status']): Task | undefined {
  const t = tasks.find(x => x.id === id); if (t) { t.status = status; save(); } return t;
}
