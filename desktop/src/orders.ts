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

function _writeOrders(companyDir: string, orders: WorkOrder[]): void {
  try {
    const dir = path.join(companyDir, '_shared');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ordersPath(companyDir), JSON.stringify(orders, null, 2));
  } catch (e) {
    console.error('[orders] write 실패:', (e as Error)?.message || e);
  }
}

export function createOrder(companyDir: string, prompt: string): WorkOrder {
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

export function updateStage(companyDir: string, orderId: string, stage: OrderStage, patch: Partial<OrderStageState>): WorkOrder | null {
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
}

export function completeOrder(companyDir: string, orderId: string, finalReport: string): WorkOrder | null {
  const orders = _readOrders(companyDir);
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx < 0) return null;
  const order = orders[idx];
  order.status = 'completed';
  order.completedAt = new Date().toISOString();
  order.finalReport = finalReport.slice(0, 20_000);
  _writeOrders(companyDir, orders);
  return order;
}

export function abortOrder(companyDir: string, orderId: string, reason?: string): WorkOrder | null {
  const orders = _readOrders(companyDir);
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx < 0) return null;
  const order = orders[idx];
  order.status = 'aborted';
  order.completedAt = new Date().toISOString();
  if (reason && order.currentStage) order.stages[order.currentStage].error = reason;
  _writeOrders(companyDir, orders);
  return order;
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
