// 💰 PayPal 매출 조회 — 실거래를 가져와 매출 대시보드 데이터 형태로 변환.
import axios from 'axios';

export interface RevenueState { type: 'state'; loading: boolean; error: string | null; data: any | null; }
const err = (m: string): RevenueState => ({ type: 'state', loading: false, error: m, data: null });

export async function fetchRevenue(clientId: string, secret: string, opts: { sandbox?: boolean; days?: number } = {}): Promise<RevenueState> {
  if (!clientId || !secret) return err('PayPal Client ID/Secret이 설정되지 않았어요. 관리(🗂️) → 연동에서 입력하세요.');
  const base = opts.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const days = Math.min(opts.days || 30, 31);  // PayPal 거래 검색은 1회 최대 31일
  try {
    // 1) access token (client_credentials)
    const tok = await axios.post(`${base}/v1/oauth2/token`, 'grant_type=client_credentials', {
      auth: { username: clientId, password: secret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000,
    });
    const access = tok.data?.access_token;
    if (!access) return err('PayPal 인증 실패 (access token 없음)');
    // 2) transactions (reporting API) — T+3시간 지연된 데이터, 최대 31일
    const end = new Date();
    const start = new Date(end.getTime() - days * 864e5);
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '-0000');  // PayPal는 offset 형식 요구
    const all: any[] = [];
    let page = 1, totalPages = 1;
    do {
      const r = await axios.get(`${base}/v1/reporting/transactions`, {
        headers: { Authorization: `Bearer ${access}` }, timeout: 30000,
        params: { start_date: iso(start), end_date: iso(end), fields: 'transaction_info', page_size: 100, page },
      });
      all.push(...(r.data?.transaction_details || []));
      totalPages = r.data?.total_pages || 1;
      page++;
    } while (page <= totalPages && page <= 10);
    return { type: 'state', loading: false, error: null, data: transform(all) };
  } catch (e: any) {
    const msg = e?.response?.data?.error_description || e?.response?.data?.message || e?.message || String(e);
    return err(`PayPal 호출 실패: ${msg}`);
  }
}

function transform(details: any[]) {
  const byCurrency: Record<string, any> = {}, byProject: Record<string, any> = {}, byDay: Record<string, any> = {};
  const txs: any[] = [];
  const now = Date.now();
  for (const d of details) {
    const ti = d.transaction_info || {};
    const amt = ti.transaction_amount || {};
    const value = parseFloat(amt.value || '0');
    const cur = amt.currency_code || 'USD';
    const feeVal = parseFloat((ti.fee_amount && ti.fee_amount.value) || '0');  // PayPal 수수료는 음수
    const ts = ti.transaction_initiation_date || ti.transaction_updated_date || '';
    const code = ti.transaction_event_code || '';
    const isRefund = value < 0 || /^T11/.test(code);
    const subject = ti.transaction_subject || ti.transaction_note || ti.invoice_id || '(설명 없음)';
    const id = ti.transaction_id || `${ts}_${value}`;
    const c = byCurrency[cur] || (byCurrency[cur] = { gross: 0, refunds: 0, fees: 0, count: 0, today: 0, week: 0, month: 0 });
    if (value >= 0) c.gross += value; else c.refunds += value;
    c.fees += feeVal; c.count += 1;
    const t = ts ? Date.parse(ts) : 0;
    if (t) {
      const age = (now - t) / 864e5;
      if (value > 0) { if (age < 1) c.today += value; if (age < 7) c.week += value; if (age < 30) c.month += value; }   // 통화별로 (섞지 않게)
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
    txs.push({ id, ts, ts_epoch: Math.floor(t / 1000), value, currency: cur, subject, event_code: code, is_refund: isRefund });
  }
  txs.sort((a, b) => (b.ts_epoch || 0) - (a.ts_epoch || 0));
  // 기간 합계는 통화를 섞으면 안 됨 → 주 통화(매출 최대)의 기간을 by_period 로
  const primaryEntry = Object.entries(byCurrency).sort((a, b) => ((b[1] as any).gross || 0) - ((a[1] as any).gross || 0))[0];
  const pc: any = primaryEntry ? primaryEntry[1] : { today: 0, week: 0, month: 0 };
  return {
    generated_at: new Date().toISOString(), currency_filter: '',
    totals: { by_currency: byCurrency, by_period: { today: pc.today || 0, week: pc.week || 0, month: pc.month || 0 }, primary_currency: primaryEntry ? primaryEntry[0] : 'USD' },
    by_project: byProject, by_day: byDay, transactions: txs.slice(0, 100),
  };
}
