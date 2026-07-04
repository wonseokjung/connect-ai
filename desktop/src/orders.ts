// v0.4.9 — 신규 오더 파이프라인 추적 모듈 (데스크톱).
//
// 확장(src/orders.ts)과 동일한 데이터 모델·5단계 매핑. vscode 의존만 제거.
// 회사 폴더는 데스크톱이 app.getPath('userData') 기반이라 호출처(main.ts)에서
// companyDir 을 주입받는 구조 — getCompanyDir() 대신 경로를 함수 인자로 받음.
//
// 사용처: desktop/src/engine/company.ts 의 runOrderPipeline + main.ts 의 order:* IPC.

import * as fs from 'fs';
import * as path from 'path';

// ───────────────────────── Types ─────────────────────────

export type OrderStage = 'idea' | 'design' | 'build' | 'develop' | 'operate';

export const STAGE_AGENTS: Record<OrderStage, string[]> = {
  idea: ['researcher', 'business'],
  design: ['designer', 'writer'],
  build: ['developer'],
  develop: ['developer'],
  operate: ['business', 'secretary'],
};

export const STAGE_LABEL: Record<OrderStage, string> = {
  idea: '① 아이디어 도출',
  design: '② 화면 기획',
  build: '③ 화면 구현',
  develop: '④ 개발',
  operate: '⑤ 운영',
};

export const STAGE_OUTPUT_FILE: Record<OrderStage, string> = {
  idea: 'idea.md',
  design: 'design.md',
  build: 'build.md',
  develop: 'develop.md',
  operate: 'operate.md',
};

export const STAGE_ORDER: OrderStage[] = ['idea', 'design', 'build', 'develop', 'operate'];

/* v0.4.9 — 요건#5: 다음 단계 핸드오프 산출물 최대 길이(자). 단계 의존도 차등.
   design→build 가 가장 넉넉 (와이어프레임이 구현의 핵심). */
export const STAGE_HANDOFF_CAP: Record<OrderStage, number> = {
  idea: 4000, design: 8000, build: 6000, develop: 6000, operate: 4000,
};

export type StageStatus = 'pending' | 'running' | 'done' | 'failed';

export interface OrderStageState {
  stage: OrderStage;
  status: StageStatus;
  agentIds: string[];
  output: string;
  sessionDir?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  attempts: number;
}

export type OrderStatus = 'active' | 'completed' | 'aborted';

export interface WorkOrder {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
  status: OrderStatus;
  stages: Record<OrderStage, OrderStageState>;
  sessionRoot: string;
  /** v0.4.11 — 배포 성공 시 공개 URL (Vercel/Netlify). 멀티사이트 대시보드의 기반. */
  liveUrl?: string;
  currentStage?: OrderStage;
  completedAt?: string;
  finalReport?: string;
}

// ───────────────────────── Storage (companyDir 주입) ─────────────────────────

export function ordersPath(companyDir: string): string {
  return path.join(companyDir, '_shared', 'orders.json');
}

export function orderSessionRoot(companyDir: string, orderId: string): string {
  return path.join(companyDir, 'orders', orderId);
}

function _newOrderId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
}

function _readOrders(companyDir: string): WorkOrder[] {
  try {
    const raw = fs.readFileSync(ordersPath(companyDir), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/* v0.4.9 — 원자적 쓰기. tmp → rename (반쪽 파일 방지). brain.ts/tasks.ts 패턴.
   직전 본을 .bak 로 보존. */
function _writeOrders(companyDir: string, orders: WorkOrder[]): void {
  const target = ordersPath(companyDir);
  try {
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
    try {
      const cur = fs.readFileSync(target, 'utf8');
      JSON.parse(cur);
      fs.writeFileSync(target + '.bak', cur);
    } catch { /* 직전 본 없음/손상 → 백업 생략 */ }
    fs.renameSync(tmp, target);
  } catch (e) {
    console.error('[orders] write 실패:', (e as Error)?.message || e);
  }
}

/* v0.4.9 — read-modify-write 경합 보호용 lockfile (O_EXCL 원자적 생성).
   launchd 자율사이클·/order 동시 실행 시 orders.json 덮어쓰기 race 차단. */
const ORDERS_LOCK_TTL_MS = 10_000;
const ORDERS_LOCK_RETRY_MS = 100;
const ORDERS_LOCK_MAX_TRIES = 50;

function _ordersLockPath(companyDir: string): string {
  return ordersPath(companyDir) + '.lock';
}

function _acquireOrdersLock(companyDir: string): boolean {
  const lockPath = _ordersLockPath(companyDir);
  const now = Date.now();
  try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch { /* ignore */ }
  try {
    const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8') || '{}');
    if (typeof data.heartbeat === 'number' && now - data.heartbeat > ORDERS_LOCK_TTL_MS) {
      try { fs.unlinkSync(lockPath); } catch { /* 경합으로 이미 지워짐 */ }
    }
  } catch { /* 락 없음 또는 손상 — 무시 */ }
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, heartbeat: now }));
    fs.closeSync(fd);
    return true;
  } catch { return false; }
}

function _releaseOrdersLock(companyDir: string): void {
  try { fs.unlinkSync(_ordersLockPath(companyDir)); } catch { /* 이미 없음 */ }
}

async function withOrdersLock<T>(companyDir: string, fn: () => Promise<T> | T): Promise<T> {
  for (let attempt = 0; attempt < ORDERS_LOCK_MAX_TRIES; attempt++) {
    if (_acquireOrdersLock(companyDir)) {
      try { return await fn(); }
      finally { _releaseOrdersLock(companyDir); }
    }
    await new Promise(r => setTimeout(r, ORDERS_LOCK_RETRY_MS));
  }
  console.warn('[orders] 락 획득 타임아웃 — 락 없이 진행 (race 위험 감수)');
  return fn();
}

export async function createOrder(companyDir: string, prompt: string): Promise<WorkOrder> {
  return withOrdersLock(companyDir, () => {
    const id = _newOrderId();
    const sessionRoot = orderSessionRoot(companyDir, id);
    fs.mkdirSync(sessionRoot, { recursive: true });
    const title = prompt.trim().split('\n')[0].slice(0, 80) || '(제목 없음)';
    const stages = {} as Record<OrderStage, OrderStageState>;
    for (const stage of STAGE_ORDER) {
      stages[stage] = { stage, status: 'pending', agentIds: [...STAGE_AGENTS[stage]], output: '', attempts: 0 };
    }
    const order: WorkOrder = {
      id, title, prompt: prompt.slice(0, 4000),
      createdAt: new Date().toISOString(), status: 'active',
      stages, sessionRoot, currentStage: STAGE_ORDER[0],
    };
    const orders = _readOrders(companyDir);
    const cutoff = Date.now() - 90 * 86_400_000;
    const kept = orders.filter(o => {
      if (o.status === 'completed' || o.status === 'aborted') {
        return new Date(o.completedAt || o.createdAt).getTime() >= cutoff;
      }
      return true;
    });
    kept.push(order);
    _writeOrders(companyDir, kept);
    return order;
  });
}

export function getOrder(companyDir: string, id: string): WorkOrder | null {
  return _readOrders(companyDir).find(o => o.id === id) || null;
}

export function listOrders(companyDir: string): WorkOrder[] {
  return _readOrders(companyDir);
}

export function listActiveOrders(companyDir: string): WorkOrder[] {
  return _readOrders(companyDir).filter(o => o.status === 'active');
}

export async function updateStage(companyDir: string, orderId: string, stage: OrderStage, patch: Partial<OrderStageState>): Promise<WorkOrder | null> {
  return withOrdersLock(companyDir, () => {
    const orders = _readOrders(companyDir);
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx < 0) return null;
    const order = orders[idx];
    order.stages[stage] = { ...order.stages[stage], ...patch };
    if (patch.status === 'running') order.currentStage = stage;
    if (patch.status === 'done') {
      const nextIdx = STAGE_ORDER.indexOf(stage) + 1;
      order.currentStage = STAGE_ORDER[nextIdx] || stage;
    }
    _writeOrders(companyDir, orders);
    return order;
  });
}

export async function completeOrder(companyDir: string, orderId: string, finalReport: string): Promise<WorkOrder | null> {
  return withOrdersLock(companyDir, () => {
    const orders = _readOrders(companyDir);
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx < 0) return null;
    const order = orders[idx];
    order.status = 'completed';
    order.completedAt = new Date().toISOString();
    order.finalReport = finalReport.slice(0, 20_000);
    _writeOrders(companyDir, orders);
    return order;
  });
}

/** v0.4.12 — 오더 메타 갱신 (liveUrl 등). lockfile 보호. deploy 출력 URL 저장용. */
export async function updateOrderMeta(companyDir: string, orderId: string, patch: Partial<Pick<WorkOrder, 'liveUrl'>>): Promise<WorkOrder | null> {
  return withOrdersLock(companyDir, () => {
    const orders = _readOrders(companyDir);
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx < 0) return null;
    orders[idx] = { ...orders[idx], ...patch };
    _writeOrders(companyDir, orders);
    return orders[idx];
  });
}

export async function abortOrder(companyDir: string, orderId: string, reason?: string): Promise<WorkOrder | null> {
  return withOrdersLock(companyDir, () => {
    const orders = _readOrders(companyDir);
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx < 0) return null;
    const order = orders[idx];
    order.status = 'aborted';
    order.completedAt = new Date().toISOString();
    if (reason && order.currentStage) order.stages[order.currentStage].error = reason;
    _writeOrders(companyDir, orders);
    return order;
  });
}

export function saveStageOutput(orderId: string, stage: OrderStage, output: string, sessionRoot: string): string | null {
  const file = path.join(sessionRoot, STAGE_OUTPUT_FILE[stage]);
  try { fs.mkdirSync(sessionRoot, { recursive: true }); fs.writeFileSync(file, output); } catch (e) {
    console.error(`[orders] stage output 저장 실패 ${stage}:`, (e as Error)?.message || e);
  }
  return file;
}

export function orderSummary(order: WorkOrder): string {
  const done = STAGE_ORDER.filter(s => order.stages[s].status === 'done').length;
  const failed = STAGE_ORDER.filter(s => order.stages[s].status === 'failed').length;
  const emoji = order.status === 'completed' ? '✅' : order.status === 'aborted' ? '⛔' : '🔄';
  return `${emoji} ${order.title} — ${done}/${STAGE_ORDER.length}단계${failed ? ` (실패 ${failed})` : ''}`;
}

export function nextPendingStage(order: WorkOrder): OrderStage | null {
  for (const stage of STAGE_ORDER) {
    const st = order.stages[stage];
    if (st.status === 'pending' || st.status === 'failed') return stage;
  }
  return null;
}
