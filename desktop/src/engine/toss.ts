// 💳 토스페이먼츠 매출 조회 — 실거래를 가져와 PayPal과 '같은 형태'의 매출 데이터로 변환.
//   인증: Basic (시크릿키:공백) · 거래조회 API: GET /v1/transactions (KRW, 커서 페이지네이션)
//   → paypal.ts 의 RevenueState 형태를 그대로 맞춰, 대시보드·자산분석이 코드 변경 없이 토스도 인식한다.
import axios from 'axios';
import type { RevenueState } from './paypal';

const err = (m: string): RevenueState => ({ type: 'state', loading: false, error: m, data: null });
const ymd = (d: Date) => d.toISOString().slice(0, 10);   // yyyy-MM-dd

export async function fetchTossRevenue(secretKey: string, opts: { days?: number } = {}): Promise<RevenueState> {
  if (!secretKey) return err('토스 시크릿 키가 없어요. 관리(🗂️) → 연동에서 입력하세요.');
  const days = Math.min(opts.days || 30, 90);
  const auth = 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');   // 시크릿키를 username, 비밀번호는 공백
  const end = new Date(), start = new Date(Date.now() - days * 864e5);
  try {
    const all: any[] = [];
    let startingAfter: string | undefined; let page = 0;
    do {
      const r: any = await axios.get('https://api.tosspayments.com/v1/transactions', {
        headers: { Authorization: auth }, timeout: 30000,
        params: { startDate: ymd(start), endDate: ymd(end), limit: 100, ...(startingAfter ? { startingAfter } : {}) },
      });
      const rows: any[] = Array.isArray(r.data) ? r.data : (r.data?.transactions || []);
      all.push(...rows);
      startingAfter = rows.length ? (rows[rows.length - 1].transactionKey || rows[rows.length - 1].paymentKey) : undefined;
      page++;
      if (rows.length < 100) break;   // 마지막 페이지
    } while (startingAfter && page < 12);
    return { type: 'state', loading: false, error: null, data: transform(all) };
  } catch (e: any) {
    const d = e?.response?.data;
    const msg = d?.message || d?.code || e?.message || String(e);
    const hint = e?.response?.status === 401 ? ' (시크릿 키 확인 — live_sk_… / test_sk_…)' : '';
    return err(`토스 호출 실패: ${msg}${hint}`);
  }
}

// 토스 거래배열 → PayPal과 동일한 data 형태 { totals, by_project, by_day, transactions }
function transform(rows: any[]) {
  const byCurrency: Record<string, any> = {}, byProject: Record<string, any> = {}, byDay: Record<string, any> = {};
  const txs: any[] = [];
  const now = Date.now();
  for (const r of rows) {
    const cur = r.currency || 'KRW';
    const status = String(r.status || '');
    const isRefund = /CANCEL/i.test(status);             // CANCELED · PARTIAL_CANCELED
    const raw = Math.abs(parseFloat(r.amount ?? r.totalAmount ?? 0)) || 0;
    const value = isRefund ? -raw : raw;
    const ts = r.transactionAt || r.approvedAt || '';
    const subject = (r.orderName || r.orderId || '(설명 없음)').toString();
    const id = r.transactionKey || r.paymentKey || `${ts}_${value}`;
    const c = byCurrency[cur] || (byCurrency[cur] = { gross: 0, refunds: 0, fees: 0, count: 0, today: 0, week: 0, month: 0 });
    if (value >= 0) c.gross += value; else c.refunds += value;
    c.count += 1;   // 토스 수수료는 거래조회에 없음(정산조회 API) → fees=0
    const t = ts ? Date.parse(ts) : 0;
    if (t) {
      const age = (now - t) / 864e5;
      if (value > 0) { if (age < 1) c.today += value; if (age < 7) c.week += value; if (age < 30) c.month += value; }
      const key = new Date(t).toISOString().slice(0, 10);
      const dd = byDay[key] || (byDay[key] = {});
      const dc = dd[cur] || (dd[cur] = { gross: 0, count: 0 });
      if (value > 0) { dc.gross += value; dc.count += 1; }
    }
    if (value > 0) {
      const proj = ((subject.split(/\s[—–-]\s/)[0]) || '기타').slice(0, 40).trim() || '기타';
      const p = byProject[proj] || (byProject[proj] = { gross: 0, count: 0, currency: cur, items: {} });
      p.gross += value; p.count += 1;
      const m = subject.match(/\s[—–-]\s(.+)$/);
      const item = (m ? m[1] : '(기본)').slice(0, 40).trim() || '(기본)';
      const it = p.items[item] || (p.items[item] = { gross: 0, count: 0 });
      it.gross += value; it.count += 1;
    }
    txs.push({ id, ts, ts_epoch: Math.floor(t / 1000), value, currency: cur, subject, event_code: status, is_refund: isRefund, source: 'toss' });
  }
  txs.sort((a, b) => (b.ts_epoch || 0) - (a.ts_epoch || 0));
  const primaryEntry = Object.entries(byCurrency).sort((a, b) => ((b[1] as any).gross || 0) - ((a[1] as any).gross || 0))[0];
  const pc: any = primaryEntry ? primaryEntry[1] : { today: 0, week: 0, month: 0 };
  return {
    generated_at: new Date().toISOString(), currency_filter: '',
    totals: { by_currency: byCurrency, by_period: { today: pc.today || 0, week: pc.week || 0, month: pc.month || 0 }, primary_currency: primaryEntry ? primaryEntry[0] : 'KRW' },
    by_project: byProject, by_day: byDay, transactions: txs.slice(0, 100),
  };
}

// 🔗 여러 결제사(PayPal+토스) 데이터를 하나로 — 통화별로 합산. 대시보드·분석이 합쳐서 본다.
export function mergeRevenue(states: (RevenueState | null | undefined)[]): RevenueState {
  const datas = states.filter((s): s is RevenueState => !!s && !!s.data).map(s => s.data);
  if (!datas.length) {
    const e = states.find(s => s && s.error);
    return e ? e as RevenueState : err('결제 데이터 없음');
  }
  if (datas.length === 1) return { type: 'state', loading: false, error: null, data: datas[0] };
  const byCurrency: Record<string, any> = {}, byProject: Record<string, any> = {}, byDay: Record<string, any> = {};
  let txs: any[] = [];
  for (const d of datas) {
    for (const [cur, v] of Object.entries(d.totals?.by_currency || {})) {
      const a = byCurrency[cur] || (byCurrency[cur] = { gross: 0, refunds: 0, fees: 0, count: 0, today: 0, week: 0, month: 0 });
      for (const k of ['gross', 'refunds', 'fees', 'count', 'today', 'week', 'month']) a[k] += (v as any)[k] || 0;
    }
    for (const [proj, v] of Object.entries(d.by_project || {})) {
      const p = byProject[proj] || (byProject[proj] = { gross: 0, count: 0, currency: (v as any).currency, items: {} });
      p.gross += (v as any).gross || 0; p.count += (v as any).count || 0;
      for (const [it, iv] of Object.entries((v as any).items || {})) {
        const x = p.items[it] || (p.items[it] = { gross: 0, count: 0 });
        x.gross += (iv as any).gross || 0; x.count += (iv as any).count || 0;
      }
    }
    for (const [day, curs] of Object.entries(d.by_day || {})) {
      const dd = byDay[day] || (byDay[day] = {});
      for (const [cur, dv] of Object.entries(curs as any)) {
        const dc = dd[cur] || (dd[cur] = { gross: 0, count: 0 });
        dc.gross += (dv as any).gross || 0; dc.count += (dv as any).count || 0;
      }
    }
    txs.push(...(d.transactions || []));
  }
  txs.sort((a, b) => (b.ts_epoch || 0) - (a.ts_epoch || 0));
  const primaryEntry = Object.entries(byCurrency).sort((a, b) => (b[1].gross || 0) - (a[1].gross || 0))[0];
  const pc: any = primaryEntry ? primaryEntry[1] : { today: 0, week: 0, month: 0 };
  return {
    type: 'state', loading: false, error: null,
    data: {
      generated_at: new Date().toISOString(), currency_filter: '',
      totals: { by_currency: byCurrency, by_period: { today: pc.today || 0, week: pc.week || 0, month: pc.month || 0 }, primary_currency: primaryEntry ? primaryEntry[0] : 'KRW' },
      by_project: byProject, by_day: byDay, transactions: txs.slice(0, 100),
    },
  };
}
