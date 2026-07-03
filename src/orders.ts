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

function _writeOrders(orders: WorkOrder[]): void {
  try {
    const dir = path.join(getCompanyDir(), '_shared');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ordersPath(), JSON.stringify(orders, null, 2));
  } catch (e) {
    /* 오더 저장 실패가 파이프라인 실행을 막으면 안 됨 — 로그만. */
    console.error('[orders] write 실패:', (e as Error)?.message || e);
  }
}

// ───────────────────────── Public API ─────────────────────────

/** 사용자 명령으로 새 오더 생성. 5단계 모두 pending 초기화. */
export function createOrder(prompt: string): WorkOrder {
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

/** 단계 상태 갱신. 부분 패치 병합 후 영속. */
export function updateStage(orderId: string, stage: OrderStage, patch: Partial<OrderStageState>): WorkOrder | null {
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
}

/** 오더 완료 처리 (5단계 끝). */
export function completeOrder(orderId: string, finalReport: string): WorkOrder | null {
  const orders = _readOrders();
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx < 0) return null;
  const order = orders[idx];
  order.status = 'completed';
  order.completedAt = new Date().toISOString();
  order.finalReport = finalReport.slice(0, 20_000);
  _writeOrders(orders);
  return order;
}

/** 오더 중단 (사용자 요청 또는 치명적 실패). */
export function abortOrder(orderId: string, reason?: string): WorkOrder | null {
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
