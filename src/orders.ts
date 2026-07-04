/* v2.89.158 — 신규 오더 파이프라인 추적 모듈.
 *
 * 사용자가 "/order <명령>" 을 내리면 시스템이 5단계 파이프라인을 순차 실행:
 *   ① idea    (아이디어 도출)    → researcher + business
 *   ② design  (화면 기획)        → designer + writer
 *   ③ build   (화면 구현)        → developer
 *   ④ develop (개발)             → developer
 *   ⑤ operate (운영)             → business + secretary
 *
 * 각 단계의 산출물은 다음 단계로 명시적 핸드오프되고, 진행 상태가 orders.json 에
 * 영속된다. tracker.json(단발성 할 일) 과는 별개 — 오더는 "하나의 제품/서비스를
 * 끝까지(운영까지) 만드는 연쇄 파이프라인" 단위.
 *
 * 관용: tracker.json 의 read/write/id 패턴(addTrackerTask / writeTracker / _trackerNewId)
 * 과 동일한 구조. getCompanyDir() 은 ./paths 에서 import.
 *
 * 사용처: extension.ts 의 /order 진입점 + src/pipeline.ts 실행 엔진.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCompanyDir } from './paths';

// ───────────────────────── Types ─────────────────────────

/** 파이프라인 단계 식별자. 순서가 곧 실행 순서. */
export type OrderStage = 'idea' | 'design' | 'build' | 'develop' | 'operate';

/** 단계별 에이전트 배정 (고정 매핑 — 사용자가 한 명령에 대해 일관된 흐름 보장). */
export const STAGE_AGENTS: Record<OrderStage, string[]> = {
  idea: ['researcher', 'business'],
  design: ['designer', 'writer'],
  build: ['developer'],
  develop: ['developer'],
  operate: ['business', 'secretary'],
};

/** 단계 한국어 라벨 (UI 표시·로그용). */
export const STAGE_LABEL: Record<OrderStage, string> = {
  idea: '① 아이디어 도출',
  design: '② 화면 기획',
  build: '③ 화면 구현',
  develop: '④ 개발',
  operate: '⑤ 운영',
};

/** 단계별 산출물 파일명 (orders/<orderId>/ 아래). */
export const STAGE_OUTPUT_FILE: Record<OrderStage, string> = {
  idea: 'idea.md',
  design: 'design.md',
  build: 'build.md',
  develop: 'develop.md',
  operate: 'operate.md',
};

/** 파이프라인 단계의 정의 순서 — iteration 시 항상 이 배열 기준. */
export const STAGE_ORDER: OrderStage[] = ['idea', 'design', 'build', 'develop', 'operate'];

/** v2.89.159 — 요건#5: 다음 단계로 넘길 산출물의 최대 길이(자). 단계 의존도 차등.
 *  design→build 는 와이어프레임이 핵심이라 가장 넉넉히, idea→design 은 콘셉트 요약이라 짧게.
 *  기존엔 무조건 6000자로 잘랐는데 design(4500자+)이 잘려 build 품질이 떨어지던 문제 해결. */
export const STAGE_HANDOFF_CAP: Record<OrderStage, number> = {
  idea: 4000,      /* idea→design: 콘셉트·차별점 요약 */
  design: 8000,    /* design→build: 와이어프레임·카피 전문 (가장 중요) */
  build: 6000,     /* build→develop: 생성된 파일 구조 */
  develop: 6000,   /* develop→operate: 검증 결과·로직 */
  operate: 4000,   /* operate: 종착지라 핸드오프 없음 (참조용) */
};

export type StageStatus = 'pending' | 'running' | 'done' | 'failed';

export interface OrderStageState {
  stage: OrderStage;
  status: StageStatus;
  /** 이 단계를 담당하는 에이전트 ID 목록 (STAGE_AGENTS 복제 — 오버라이드 가능). */
  agentIds: string[];
  /** 단계 산출물 전문 (다음 단계 userMsg 에 주입됨). */
  output: string;
  /** 산출물 저장 디렉토리 (orders/<orderId>/). */
  sessionDir?: string;
  startedAt?: string;
  completedAt?: string;
  /** 실패 시 사유. */
  error?: string;
  /** 재시도 횟수 (최대 1회 자동 재시도). */
  attempts: number;
}

export type OrderStatus = 'active' | 'completed' | 'aborted';

export interface WorkOrder {
  id: string;
  /** 사용자 친화적 제목 (첫 줄 또는 prompt 요약). */
  title: string;
  /** 원본 사용자 명령. */
  prompt: string;
  createdAt: string;
  status: OrderStatus;
  /** 5단계 상태. */
  stages: Record<OrderStage, OrderStageState>;
  /** 오더 산출물 루트 디렉토리 (<companyDir>/orders/<id>/). */
  sessionRoot: string;
  /** v2.89.161 — 배포 성공 시 공개 URL (Vercel/Netlify). 멀티사이트 대시보드의 기반. */
  liveUrl?: string;
  /** 현재 실행 중인 단계 (없으면 마지막 완료 단계). */
  currentStage?: OrderStage;
  completedAt?: string;
  /** 최종 종합 보고서 (5단계 끝난 후). */
  finalReport?: string;
}

// ───────────────────────── Storage path ─────────────────────────

/** orders.json 경로 — tracker.json 과 같은 _shared 폴더. */
export function ordersPath(): string {
  return path.join(getCompanyDir(), '_shared', 'orders.json');
}

/** 특정 오더의 산출물 루트 디렉토리. */
export function orderSessionRoot(orderId: string): string {
  return path.join(getCompanyDir(), 'orders', orderId);
}

// ───────────────────────── ID generation ─────────────────────────

function _newOrderId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
}

// ───────────────────────── Read / Write ─────────────────────────

function _readOrders(): WorkOrder[] {
  try {
    const raw = fs.readFileSync(ordersPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* v2.89.159 — 원자적 쓰기. tmp 파일 작성 후 rename (반쪽 파일 방지).
   데스크톱 brain.ts/tasks.ts 의 패턴과 동일. 직전 본을 .bak 로 보존. */
function _writeOrders(orders: WorkOrder[]): void {
  const target = ordersPath();
  try {
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
    /* 직전 본이 유효한 JSON이면 .bak 로 보존 (손상 시 복구용). */
    try {
      const cur = fs.readFileSync(target, 'utf8');
      JSON.parse(cur);
      fs.writeFileSync(target + '.bak', cur);
    } catch { /* 직전 본 없음/손상 → 백업 생략 */ }
    fs.renameSync(tmp, target);
  } catch (e) {
    /* 오더 저장 실패가 파이프라인 실행을 막으면 안 됨 — 로그만. */
    console.error('[orders] write 실패:', (e as Error)?.message || e);
  }
}

/* v2.89.159 — orders.json read-modify-write 경합 보호용 lockfile.
   fs.openSync(path, 'wx') 는 O_EXCL — 파일이 이미 있으면 실패하므로 두 프로세스가
   동시에 호출해도 한 명만 락 잡음 (extension.ts 의 telegram lock 과 동일 패턴).
   launchd 자율 사이클(cycle.js 가 decisions.md 건드림)과 /order 동시 실행 시
   orders.json 이 마지막 쓰기에 의해 덮여쓰여지는 race 를 차단. */
const ORDERS_LOCK_TTL_MS = 10_000;   /* 살아있는 락의 최대 수명 — 이보다 오래되면 stale 로 간주 */
const ORDERS_LOCK_RETRY_MS = 100;
const ORDERS_LOCK_MAX_TRIES = 50;    /* 최대 ~5초 대기 */

function _ordersLockPath(): string {
  return ordersPath() + '.lock';
}

function _acquireOrdersLock(): boolean {
  const lockPath = _ordersLockPath();
  const now = Date.now();
  try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch { /* ignore */ }
  /* stale 락 정리 — 다른 프로세스가 죽어서 남은 락 */
  try {
    const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8') || '{}');
    if (typeof data.heartbeat === 'number' && now - data.heartbeat > ORDERS_LOCK_TTL_MS) {
      try { fs.unlinkSync(lockPath); } catch { /* 경합으로 이미 지워짐 */ }
    }
  } catch { /* 락 없음 또는 손상 — 무시 */ }
  /* atomic 생성 시도 */
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, heartbeat: now }));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;   /* 이미 누가 잡고 있음 */
  }
}

function _releaseOrdersLock(): void {
  try { fs.unlinkSync(_ordersLockPath()); } catch { /* 이미 없음 */ }
}

/* read-modify-write 를 한 블록으로 감싸는 헬퍼. 락 획득 실패 시 재시도, 최대 시도
   초과시 락 없이 진행(저장 안 되는 것보다 나음 — 데드락 회피). */
async function withOrdersLock<T>(fn: () => Promise<T> | T): Promise<T> {
  for (let attempt = 0; attempt < ORDERS_LOCK_MAX_TRIES; attempt++) {
    if (_acquireOrdersLock()) {
      try { return await fn(); }
      finally { _releaseOrdersLock(); }
    }
    await new Promise(r => setTimeout(r, ORDERS_LOCK_RETRY_MS));
  }
  /* 락 획득 실패 — 데드락 방지 위해 그냥 진행 (최선 노력). */
  console.warn('[orders] 락 획득 타임아웃 — 락 없이 진행 (race 위험 감수)');
  return fn();
}

// ───────────────────────── Public API ─────────────────────────

/** 사용자 명령으로 새 오더 생성. 5단계 모두 pending 초기화.
 *  v2.89.159 — read-modify-write 를 lockfile 로 보호 (동시 /order·자율사이클 경합). */
export async function createOrder(prompt: string): Promise<WorkOrder> {
  return withOrdersLock(() => {
    const id = _newOrderId();
    const sessionRoot = orderSessionRoot(id);
    fs.mkdirSync(sessionRoot, { recursive: true });

    const title = prompt.trim().split('\n')[0].slice(0, 80) || '(제목 없음)';

    const stages = {} as Record<OrderStage, OrderStageState>;
    for (const stage of STAGE_ORDER) {
      stages[stage] = {
        stage,
        status: 'pending',
        agentIds: [...STAGE_AGENTS[stage]],
        output: '',
        attempts: 0,
      };
    }

    const order: WorkOrder = {
      id,
      title,
      prompt: prompt.slice(0, 4000),
      createdAt: new Date().toISOString(),
      status: 'active',
      stages,
      sessionRoot,
      currentStage: STAGE_ORDER[0],
    };

    const orders = _readOrders();
    /* 완료/중단된 오더 90일 이상 된 것 정리 (tracker의 30일 cutoff 보다 길게 —
       제품 단위라 더 오래 보관 가치). */
    const cutoff = Date.now() - 90 * 86_400_000;
    const kept = orders.filter(o => {
      if (o.status === 'completed' || o.status === 'aborted') {
        const at = new Date(o.completedAt || o.createdAt).getTime();
        return at >= cutoff;
      }
      return true;
    });
    kept.push(order);
    _writeOrders(kept);

    return order;
  });
}

export function getOrder(id: string): WorkOrder | null {
  return _readOrders().find(o => o.id === id) || null;
}

export function listOrders(): WorkOrder[] {
  return _readOrders();
}

export function listActiveOrders(): WorkOrder[] {
  return _readOrders().filter(o => o.status === 'active');
}

/** 단계 상태 갱신. 부분 패치 병합 후 영속. lockfile 보호. */
export async function updateStage(orderId: string, stage: OrderStage, patch: Partial<OrderStageState>): Promise<WorkOrder | null> {
  return withOrdersLock(() => {
    const orders = _readOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx < 0) return null;
    const order = orders[idx];
    order.stages[stage] = { ...order.stages[stage], ...patch };
    /* currentStage 동기화 — running/done 단계를 현재로. */
    if (patch.status === 'running') order.currentStage = stage;
    if (patch.status === 'done') {
      const nextIdx = STAGE_ORDER.indexOf(stage) + 1;
      order.currentStage = STAGE_ORDER[nextIdx] || stage;
    }
    _writeOrders(orders);
    return order;
  });
}

/** 오더 완료 처리 (5단계 끝). lockfile 보호. */
export async function completeOrder(orderId: string, finalReport: string): Promise<WorkOrder | null> {
  return withOrdersLock(() => {
    const orders = _readOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx < 0) return null;
    const order = orders[idx];
    order.status = 'completed';
    order.completedAt = new Date().toISOString();
    order.finalReport = finalReport.slice(0, 20_000);
    _writeOrders(orders);
    return order;
  });
}

/** v2.89.162 — 오더 메타 갱신 (liveUrl 등). lockfile 보호. deploy 출력 URL 저장용. */
export async function updateOrderMeta(orderId: string, patch: Partial<Pick<WorkOrder, 'liveUrl'>>): Promise<WorkOrder | null> {
  return withOrdersLock(() => {
    const orders = _readOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx < 0) return null;
    orders[idx] = { ...orders[idx], ...patch };
    _writeOrders(orders);
    return orders[idx];
  });
}

/** 오더 중단 (사용자 요청 또는 치명적 실패). lockfile 보호. */
export async function abortOrder(orderId: string, reason?: string): Promise<WorkOrder | null> {
  return withOrdersLock(() => {
    const orders = _readOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx < 0) return null;
    const order = orders[idx];
    order.status = 'aborted';
    order.completedAt = new Date().toISOString();
    if (reason) {
      const cs = order.currentStage;
      if (cs) order.stages[cs].error = reason;
    }
    _writeOrders(orders);
    return order;
  });
}

/** 단계 산출물을 파일로 저장 + order.stages[stage].output 에 캐시. */
export function saveStageOutput(orderId: string, stage: OrderStage, output: string): string | null {
  const order = getOrder(orderId);
  if (!order) return null;
  const file = path.join(order.sessionRoot, STAGE_OUTPUT_FILE[stage]);
  try {
    fs.mkdirSync(order.sessionRoot, { recursive: true });
    fs.writeFileSync(file, output);
  } catch (e) {
    console.error(`[orders] stage output 저장 실패 ${stage}:`, (e as Error)?.message || e);
  }
  return file;
}

/** 특정 오더의 진행 요약 (UI·보고용 1줄). */
export function orderSummary(order: WorkOrder): string {
  const done = STAGE_ORDER.filter(s => order.stages[s].status === 'done').length;
  const failed = STAGE_ORDER.filter(s => order.stages[s].status === 'failed').length;
  const statusEmoji = order.status === 'completed' ? '✅' : order.status === 'aborted' ? '⛔' : '🔄';
  return `${statusEmoji} ${order.title} — ${done}/${STAGE_ORDER.length}단계${failed ? ` (실패 ${failed})` : ''}`;
}

/** 파이프라인의 다음 미실행 단계 반환 (전부 끝이면 null). */
export function nextPendingStage(order: WorkOrder): OrderStage | null {
  for (const stage of STAGE_ORDER) {
    const st = order.stages[stage];
    if (st.status === 'pending' || st.status === 'failed') return stage;
  }
  return null;
}
