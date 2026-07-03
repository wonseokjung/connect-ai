// src/orders.test.ts — 오더 파이프라인 추적 모듈 단위 테스트.
// src/orders.ts 의 순수 로직 + 동시성(요건#1) + 상태 전이 검증.
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { setBrainDir } from '../test/vscode-stub';
import {
  createOrder, getOrder, listOrders, listActiveOrders,
  updateStage, completeOrder, abortOrder, saveStageOutput,
  orderSummary, nextPendingStage,
  STAGE_ORDER, STAGE_LABEL, STAGE_AGENTS, STAGE_HANDOFF_CAP,
} from './orders';

// 각 테스트마다 독립 임시 brain 폴더 사용 (병렬 안전)
let tmpBrain: string;
beforeEach(() => {
  tmpBrain = path.join(os.tmpdir(), 'orders-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(path.join(tmpBrain, '_company', '_shared'), { recursive: true });
  setBrainDir(tmpBrain);
});

describe('STAGE 상수', () => {
  it('5단계가 올바른 순서로 정의됨', () => {
    expect(STAGE_ORDER).toEqual(['idea', 'design', 'build', 'develop', 'operate']);
  });

  it('각 단계에 에이전트 배정됨', () => {
    expect(STAGE_AGENTS.idea).toContain('researcher');
    expect(STAGE_AGENTS.idea).toContain('business');
    expect(STAGE_AGENTS.build).toEqual(['developer']);
    expect(STAGE_AGENTS.operate).toContain('secretary');
  });

  it('design→build 핸드오프 캡이 가장 큼 (요건#5)', () => {
    expect(STAGE_HANDOFF_CAP.design).toBeGreaterThan(STAGE_HANDOFF_CAP.idea);
    expect(STAGE_HANDOFF_CAP.design).toBe(8000);
  });

  it('모든 단계에 라벨 있음', () => {
    for (const s of STAGE_ORDER) {
      expect(STAGE_LABEL[s].length).toBeGreaterThan(0);
    }
  });
});

describe('createOrder', () => {
  it('오더 생성 — 5단계 pending 초기화, sessionRoot 폴더 생성', async () => {
    const order = await createOrder('테스트 오더');
    expect(order.id).toMatch(/^\d{14}-[a-z0-9]{4}$/);
    expect(order.status).toBe('active');
    expect(order.title).toBe('테스트 오더');
    expect(order.currentStage).toBe('idea');
    for (const s of STAGE_ORDER) {
      expect(order.stages[s].status).toBe('pending');
      expect(order.stages[s].agentIds).toEqual(STAGE_AGENTS[s]);
    }
    expect(fs.existsSync(order.sessionRoot)).toBe(true);
  });

  it('여러 줄 prompt 의 title 은 첫 줄', async () => {
    const order = await createOrder('첫 줄 제목\n둘째 줄 내용');
    expect(order.title).toBe('첫 줄 제목');
  });

  it('ID 가 매번 유일', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add((await createOrder('o' + i)).id);
    }
    expect(ids.size).toBe(20);
  });
});

describe('updateStage 상태 전이', () => {
  it('pending → running → done 전이 + currentStage 동기화', async () => {
    const order = await createOrder('전이 테스트');
    await updateStage(order.id, 'idea', { status: 'running' });
    let got = getOrder(order.id)!;
    expect(got.stages.idea.status).toBe('running');
    expect(got.currentStage).toBe('idea');

    await updateStage(order.id, 'idea', { status: 'done' });
    got = getOrder(order.id)!;
    expect(got.stages.idea.status).toBe('done');
    expect(got.currentStage).toBe('design'); // 다음 단계로
  });

  it('존재하지 않는 오더 → null', async () => {
    const r = await updateStage('없는id', 'idea', { status: 'running' });
    expect(r).toBeNull();
  });
});

describe('completeOrder / abortOrder', () => {
  it('completeOrder → status=completed, completedAt 설정', async () => {
    const order = await createOrder('완료 테스트');
    const r = await completeOrder(order.id, '최종 보고서');
    expect(r!.status).toBe('completed');
    expect(r!.completedAt).toBeTruthy();
    expect(r!.finalReport).toBe('최종 보고서');
  });

  it('abortOrder → status=aborted, 진행 중 단계 error 기록', async () => {
    const order = await createOrder('중단 테스트');
    await updateStage(order.id, 'idea', { status: 'running' });
    const r = await abortOrder(order.id, '사용자 중단');
    expect(r!.status).toBe('aborted');
    expect(r!.stages.idea.error).toBe('사용자 중단');
  });

  it('abort 후 active 목록에서 제외 (요건#2)', async () => {
    const order = await createOrder('active 테스트');
    expect(listActiveOrders().length).toBe(1);
    await abortOrder(order.id);
    expect(listActiveOrders().length).toBe(0);
  });
});

describe('listOrders / orderSummary / nextPendingStage', () => {
  it('orderSummary — done 카운트 + 이모지', async () => {
    const order = await createOrder('요약 테스트');
    await updateStage(order.id, 'idea', { status: 'done' });
    const sum = orderSummary(getOrder(order.id)!);
    expect(sum).toContain('1/5');
    expect(sum).toContain('🔄'); // active
  });

  it('nextPendingStage — 첫 pending 단계 반환', async () => {
    const order = await createOrder('다음 단계 테스트');
    expect(nextPendingStage(order)).toBe('idea');
    await updateStage(order.id, 'idea', { status: 'done' });
    const updated = getOrder(order.id)!;
    expect(nextPendingStage(updated)).toBe('design');
  });

  it('전부 done 이면 null', async () => {
    const order = await createOrder('완전 완료');
    for (const s of STAGE_ORDER) await updateStage(order.id, s, { status: 'done' });
    expect(nextPendingStage(getOrder(order.id)!)).toBeNull();
  });
});

describe('saveStageOutput', () => {
  it('단계 산출물 파일 저장', async () => {
    const order = await createOrder('산출물 테스트');
    const file = saveStageOutput(order.id, 'idea', '# 아이디어\n내용');
    expect(file).toBeTruthy();
    expect(fs.existsSync(file!)).toBe(true);
    expect(fs.readFileSync(file!, 'utf-8')).toContain('아이디어');
  });
});

describe('90일 cutoff 정리', () => {
  it('90일+ 지난 완료 오더는 createOrder 시 제거', async () => {
    // 먼저 오더 하나 만들어 orders.json 이 존재하게 한 뒤 과거 완료 오더 주입
    await createOrder('초기');
    const ordersPath = path.join(tmpBrain, '_company/_shared/orders.json');
    const old = JSON.parse(fs.readFileSync(ordersPath, 'utf-8'));
    old.push({
      id: 'old-1', title: '오래된', prompt: '', status: 'completed',
      createdAt: '2020-01-01T00:00:00.000Z', completedAt: '2020-01-01T00:00:00.000Z',
      stages: {} as any, sessionRoot: '/tmp/x',
    });
    fs.writeFileSync(ordersPath, JSON.stringify(old));
    await createOrder('새 오더');
    const after = listOrders();
    expect(after.find(o => o.id === 'old-1')).toBeUndefined();
  });
});

describe('동시성 (요건#1: lockfile 보호)', () => {
  it('50개 createOrder 병렬 → 전부存活, ID 유일, 무손실', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => createOrder('동시-' + i))
    );
    const ids = results.map(r => r.id);
    expect(new Set(ids).size).toBe(50);          // ID 유일
    expect(results.every(r => r.status === 'active')).toBe(true);
    // orders.json 에 전부 저장됐는지
    expect(listOrders().length).toBe(50);
  });

  it('동시 updateStage 가 서로 덮어쓰지 않음 (lock 직렬화)', async () => {
    const order = await createOrder('동시 갱신');
    // 5개 단계를 동시에 running 으로 — 각각 독립적으로 반영되야
    await Promise.all(STAGE_ORDER.map(s => updateStage(order.id, s, { status: 'running' })));
    const got = getOrder(order.id)!;
    for (const s of STAGE_ORDER) {
      expect(got.stages[s].status).toBe('running');
    }
  });
});
