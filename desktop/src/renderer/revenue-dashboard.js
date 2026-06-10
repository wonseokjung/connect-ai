// v2.89.137 — Revenue Dashboard webview script.
// state schema: {
//   loading: bool, error: string|null,
//   data: {
//     totals: { by_currency: {USD: {gross, refunds, fees, count}}, by_period: {today, week, month} },
//     by_project: { 'neon-survivor': {gross, count, currency, items: {...}} },
//     by_day: { '2026-05-12': {USD: {gross, count}} },
//     transactions: [{id, ts, ts_epoch, value, currency, subject, event_code, is_refund}]
//   }
// }

// Electron 데스크톱 브리지 — VS Code postMessage 대신 window.connect IPC 사용
const vscode = { postMessage: (m) => {
  const t = m && m.type;
  if (t === 'refresh') window.connect.revRefresh();
  else if (t === 'openSettings') window.connect.revOpenSettings();
  else window.connect.revReady();
} };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const fmtNum = (n) => Number(n||0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtInt = (n) => Number(n||0).toLocaleString();

let lastData = null;
let firstRender = true;

// ───────── Glyph rain (background) ─────────
function spawnGlyphRain() {
  const wrap = $('glyphRain');
  if (!wrap) return;
  const W = window.innerWidth;
  const cols = Math.min(40, Math.floor(W / 28));
  const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ$01_-アエ◆◇⬢⬡';
  for (let i = 0; i < cols; i++) {
    const col = document.createElement('div');
    col.className = 'col';
    col.style.left = (i / cols * 100) + '%';
    col.style.animationDuration = (10 + Math.random() * 25) + 's';
    col.style.animationDelay = (-Math.random() * 20) + 's';
    let txt = '';
    for (let r = 0; r < 30; r++) txt += glyphs[Math.floor(Math.random()*glyphs.length)] + '\n';
    col.textContent = txt;
    wrap.appendChild(col);
  }
}

// ───────── Count-up animation ─────────
// 💱 통화 깔끔하게 — ₩는 소수점 0, $는 2자리, 기호 붙임. 큰 수는 그대로(쉼표).
const CUR_SYM = { USD: '$', KRW: '₩', JPY: '¥', EUR: '€', GBP: '£', CNY: '¥' };
const curDec = (c) => (c === 'KRW' || c === 'JPY' || c === 'CNY') ? 0 : 2;
const fmtMoney = (n, cur) => { const d = curDec(cur), sym = CUR_SYM[cur] || ''; const s = Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); return sym ? `${sym}${s}` : `${s}${cur ? ' ' + cur : ''}`; };

function countUp(el, target, opts = {}) {
  const duration = opts.duration || 1100;
  const cur = opts.cur;
  const decimals = opts.decimals != null ? opts.decimals : (cur ? curDec(cur) : 2);
  const sym = cur ? (CUR_SYM[cur] || '') : '';
  const suffix = (cur && !sym) ? ` ${cur}` : '';
  const startVal = parseFloat(el.dataset.last || '0');
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    const v = startVal + (target - startVal) * eased;
    el.textContent = sym + v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    if (p < 1) requestAnimationFrame(tick);
    else {
      el.dataset.last = String(target);
      // v2.89.150 — 완료 시 부모 .kpi 카드에 burst 효과
      if (target > 0 && target !== startVal) {
        const card = el.closest('.kpi');
        if (card) {
          card.classList.add('complete-burst');
          setTimeout(() => card.classList.remove('complete-burst'), 800);
        }
      }
    }
  }
  requestAnimationFrame(tick);
}

// ───────── Sparkline (daily revenue) ─────────
function renderSparkline(byDay, primaryCur) {
  const svg = $('sparkSvg');
  if (!svg) return;
  const days = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const day = byDay[key];
    const v = day && day[primaryCur] ? day[primaryCur].gross : 0;
    days.push({ key, value: v, date: d });
  }
  const maxV = Math.max(...days.map(d => d.value), 1);
  const W = 800, H = 160, padL = 36, padR = 8, padT = 16, padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xOf = (i) => padL + (i / (days.length - 1)) * innerW;
  const yOf = (v) => padT + innerH - (v / maxV) * innerH;

  // 부드러운 곡선(베지어) — 밋밋한 직선 대신
  const P = days.map((d, i) => ({ x: xOf(i), y: yOf(d.value) }));
  const smooth = (p) => { if (p.length < 2) return ''; let s = `M ${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}`; for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1], mx = (a.x + b.x) / 2; s += ` C ${mx.toFixed(1)},${a.y.toFixed(1)} ${mx.toFixed(1)},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`; } return s; };
  const linePath = smooth(P);
  const baseY = padT + innerH;
  const areaPath = `${linePath} L ${xOf(days.length - 1).toFixed(1)},${baseY} L ${padL},${baseY} Z`;
  const peakIdx = days.reduce((acc, d, i) => d.value > days[acc].value ? i : acc, 0);
  const dots = days.map((d, i) => {
    if (d.value <= 0) return '';
    const isPeak = i === peakIdx;
    return `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(d.value).toFixed(1)}" r="${isPeak ? 5.5 : 2.6}" fill="${isPeak ? '#eaffef' : '#00ff7a'}" filter="url(#sparkGlow)">${isPeak ? '<animate attributeName="r" values="5.5;7;5.5" dur="1.8s" repeatCount="indefinite"/>' : ''}</circle>`;
  }).join('');
  const yLabels = [maxV, maxV / 2, 0].map((v) => `<text class="spark-label" x="${padL - 6}" y="${(yOf(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v).toLocaleString()}</text>`).join('');
  const xTicks = [0, Math.floor(days.length / 2), days.length - 1].map(i => { const d = days[i].date; return `<text class="spark-label" x="${xOf(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${(d.getMonth() + 1)}/${d.getDate()}</text>`; }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#00ff7a" stop-opacity="0.55"></stop>
        <stop offset="55%" stop-color="#00ff7a" stop-opacity="0.14"></stop>
        <stop offset="100%" stop-color="#00ff7a" stop-opacity="0"></stop>
      </linearGradient>
      <filter id="sparkGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path d="${areaPath}" fill="url(#gradArea)" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.9s" begin="0.6s" fill="freeze"/></path>
    <path d="${linePath}" fill="none" stroke="#00ff7a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#sparkGlow)" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" values="1;0" dur="1.3s" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" fill="freeze"/></path>
    ${dots}
    ${yLabels}
    ${xTicks}
  `;
}

// ───────── Donut (project mix) ─────────
const PROJECT_COLORS = ['#00ff7a', '#2ee6c0', '#34d399', '#a0ffcf', '#00b359', '#7dffd6', '#fbbf24'];

function renderDonut(byProject, primaryCur) {
  const svg = $('donutSvg');
  const legend = $('donutLegend');
  const centerVal = $('donutCenterVal');
  if (!svg || !legend) return;

  const entries = Object.entries(byProject || {})
    .map(([name, p]) => ({ name, gross: p.gross || 0, count: p.count || 0 }))
    .filter(p => p.gross > 0)
    .sort((a, b) => b.gross - a.gross);

  const total = entries.reduce((s, p) => s + p.gross, 0);
  if (centerVal) {
    centerVal.dataset.last = centerVal.dataset.last || '0';
    countUp(centerVal, total, { decimals: 2 });
  }

  if (entries.length === 0) {
    svg.innerHTML = `<circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="18"></circle>`;
    legend.innerHTML = '<div style="color: var(--text-3); font-size: 0.85rem; padding: 10px 0;">결제 0건</div>';
    return;
  }

  const R = 80, CX = 100, CY = 100;
  const C = 2 * Math.PI * R;
  let accum = 0;
  const segs = entries.map((p, i) => {
    const frac = p.gross / total;
    const dash = C * frac;
    const gap = C - dash;
    const offset = -accum * C;
    accum += frac;
    return `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none"
            stroke="${PROJECT_COLORS[i % PROJECT_COLORS.length]}"
            stroke-width="18"
            stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}"
            transform="rotate(-90 ${CX} ${CY})"
            style="filter: drop-shadow(0 0 6px ${PROJECT_COLORS[i % PROJECT_COLORS.length]}); transition: stroke-dashoffset 0.6s ease;"></circle>`;
  }).join('');

  svg.setAttribute('viewBox', '0 0 200 200');
  svg.innerHTML = segs;

  legend.innerHTML = entries.map((p, i) => {
    const pct = (p.gross / total * 100).toFixed(1);
    const color = PROJECT_COLORS[i % PROJECT_COLORS.length];
    return `<div class="item">
      <div class="swatch" style="background:${color}; color:${color};"></div>
      <div class="name">${esc(p.name)}</div>
      <div class="pct">${pct}%</div>
    </div>`;
  }).join('');
}

// ───────── Project bars (detailed breakdown) ─────────
function renderProjectBars(byProject) {
  const wrap = $('projBars');
  if (!wrap) return;
  const entries = Object.entries(byProject || {})
    .map(([name, p]) => ({ name, gross: p.gross || 0, count: p.count || 0, items: p.items || {} }))
    .filter(p => p.gross > 0)
    .sort((a, b) => b.gross - a.gross);

  if (entries.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  const maxV = Math.max(...entries.map(p => p.gross), 1);
  wrap.innerHTML = entries.map(p => {
    const w = (p.gross / maxV * 100).toFixed(1);
    const items = Object.entries(p.items || {}).sort((a,b) => b[1].gross - a[1].gross).slice(0, 3);
    const itemsTxt = items.map(([k,v]) => `${esc(k)} ×${v.count}`).join(' · ');
    return `<div class="proj-bar">
      <div class="name">${esc(p.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
      <div class="val">${fmtNum(p.gross)}</div>
    </div>
    <div style="font-size: 0.72rem; color: var(--text-3); padding: 0 0 8px 154px;">${itemsTxt}</div>`;
  }).join('');
}

// ───────── Transaction feed ─────────
const KNOWN_TX_IDS = new Set();
function renderTransactions(txs) {
  const feed = $('feed');
  if (!feed) return;
  if (!txs || txs.length === 0) {
    feed.innerHTML = `<div class="empty">
      <div class="emoji">📭</div>
      <h3>아직 거래가 없어요</h3>
      <p>EZER 카탈로그를 공유하고 첫 결제를 기다리는 중...</p>
    </div>`;
    return;
  }

  feed.innerHTML = txs.slice(0, 30).map(tx => {
    const isNew = !firstRender && !KNOWN_TX_IDS.has(tx.id);
    KNOWN_TX_IDS.add(tx.id);
    const cls = tx.is_refund ? 'refund' : 'payment';
    const icon = tx.is_refund ? '↩' : '＄';
    const sign = tx.is_refund ? '-' : '+';
    const subj = tx.subject || '(설명 없음)';
    const ts = tx.ts ? new Date(tx.ts) : null;
    const tsStr = ts ? `${ts.getMonth()+1}/${ts.getDate()} ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}` : '?';
    return `<div class="tx${isNew?' new':''}" data-id="${esc(tx.id)}">
      <div class="tx-icon ${cls}">${icon}</div>
      <div class="tx-body">
        <div class="tx-subject">${esc(subj)}</div>
        <div class="tx-meta">${tsStr} · ${esc(tx.currency)} · ${esc(tx.event_code || '')}</div>
      </div>
      <div class="tx-amount ${cls}">${sign}${fmtNum(Math.abs(tx.value))}</div>
    </div>`;
  }).join('');

  if (!firstRender) {
    // 새 거래가 있으면 burst alert
    const newOnes = txs.slice(0, 30).filter(tx => {
      const known = feed.querySelector(`[data-id="${tx.id}"]`);
      return known && known.classList.contains('new');
    });
    if (newOnes.length > 0) showBurst(newOnes[0]);
  }
}

// ───────── New payment burst alert ─────────
function showBurst(tx) {
  const burst = $('burst');
  if (!burst) return;
  const isRefund = tx.is_refund;
  const sign = isRefund ? '-' : '+';
  burst.innerHTML = `
    <div class="big">${sign}$${Math.abs(tx.value).toFixed(2)}</div>
    <div class="sub">${esc(tx.subject || '새 결제')}</div>
  `;
  burst.classList.remove('show');
  void burst.offsetWidth;
  burst.classList.add('show');
}

// ───────── KPI strip render ─────────
function renderKPI(data) {
  const totals = data?.totals || {};
  const period = totals.by_period || { today: 0, week: 0, month: 0 };
  const byCur = totals.by_currency || {};

  // primary currency (largest gross)
  const primaryCur = Object.entries(byCur).sort((a,b) => (b[1].gross||0)-(a[1].gross||0))[0]?.[0] || 'USD';
  $('curLabel').textContent = primaryCur;

  const cur = byCur[primaryCur] || {gross:0, refunds:0, fees:0, count:0};
  const net = cur.gross + cur.refunds + cur.fees;   // refunds·fees 는 이미 음수 → 더하면 차감됨 (이전엔 빼서 거꾸로 됐음)
  const txCount = cur.count || 0;

  countUp($('kpiToday'), period.today, { cur: primaryCur });
  countUp($('kpiWeek'), period.week, { cur: primaryCur });
  countUp($('kpiMonth'), period.month, { cur: primaryCur });
  countUp($('kpiNet'), net, { cur: primaryCur });
  countUp($('kpiCount'), txCount, { decimals: 0 });

  $('kpiMonthSub').textContent = `${txCount}건 · 환불 ${fmtMoney(cur.refunds, primaryCur)} · 수수료 ${fmtMoney(cur.fees, primaryCur)}`;
  // 💱 통화 2개 이상이면 다른 통화도 한 줄 (원화·달러 같이)
  const others = Object.entries(byCur).filter(([c]) => c !== primaryCur);
  const curEl = $('curLabel');
  if (curEl) curEl.textContent = others.length
    ? `${primaryCur}  +  ${others.map(([c, v]) => fmtMoney((v.gross || 0) + (v.refunds || 0) + (v.fees || 0), c)).join('  ')}`
    : primaryCur;

  return primaryCur;
}

// ───────── Master render ─────────
// 🧭 내 비즈니스 — 등록 웹사이트/채널 라이브 카드
function renderServices(list) {
  const grid = $('bizGrid'), sec = $('bizSection');
  if (!grid) return;
  if (!list || !list.length) { if (sec) sec.classList.add('hidden'); return; }
  if (sec) sec.classList.remove('hidden');
  grid.innerHTML = list.map((s, i) => `<div class="biz-card ${esc(s.type || 'web')}" style="animation-delay:${i * 0.08}s">
    ${s.image ? `<div class="biz-banner" style="background-image:url('${esc(s.image)}')"></div>` : `<div class="biz-banner biz-banner-fallback ${esc(s.type || 'web')}"><span>${s.type === 'youtube' ? '📺' : '🌐'}</span></div>`}
    <div class="biz-body">
      <div class="biz-card-head">${s.favicon ? `<img class="biz-fav" src="${esc(s.favicon)}" alt="" />` : `<div class="biz-ic">${s.type === 'youtube' ? '📺' : '🌐'}</div>`}<div class="biz-name">${esc(s.name || '')}</div><span class="biz-dot"></span></div>
      <div class="biz-url">${esc(s.url || '')}</div>
      <div class="biz-snap">${esc(s.snapshot || '읽는 중…')}</div>
    </div>
  </div>`).join('');
}

// ───────── 📺 YouTube + ⚡ GitHub (사령부 확장) ─────────
const fmtN = (n) => Number(n || 0).toLocaleString();
function timeAgo(iso) {
  const t = Date.parse(iso); if (!t) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return Math.max(1, m) + '분 전'; const h = Math.floor(m / 60);
  if (h < 24) return h + '시간 전'; return Math.floor(h / 24) + '일 전';
}
function renderYoutube(yt) {
  const sec = $('ytSection'); if (!sec) return;
  if (!yt || !yt.ok || !yt.channel) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  const ch = yt.channel;
  if ($('ytTitle')) $('ytTitle').textContent = ch.title || '유튜브 채널';
  countUp($('ytSubs'), ch.subs || 0, { decimals: 0 });
  countUp($('ytViews'), ch.views || 0, { decimals: 0 });
  countUp($('ytVideos'), ch.videos || 0, { decimals: 0 });
  countUp($('ytAvgPct'), yt.analytics ? Math.round(yt.analytics.avgViewPercentage || 0) : 0, { decimals: 0 });
  $('ytVids').innerHTML = (yt.videos || []).slice(0, 4).map((v) => `<a class="yt-vid" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noreferrer">${v.thumb ? `<img src="${esc(v.thumb)}" alt="" />` : ''}<div class="yt-vmeta"><div class="yt-vt">${esc(v.title || '')}</div><div class="yt-vs">👁 ${fmtN(v.views)} · 👍 ${fmtN(v.likes)}</div></div></a>`).join('');
}
function renderGithub(gh) {
  const sec = $('ghSection'); if (!sec) return;
  if (!gh || !gh.ok || !gh.commits || !gh.commits.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  const commits = gh.commits;
  const byDay = {};
  commits.forEach((c) => { const d = (c.date || '').slice(0, 10); if (d) byDay[d] = (byDay[d] || 0) + 1; });
  drawCommitBars(byDay);
  $('ghFeed').innerHTML = commits.slice(0, 7).map((c) => `<div class="gh-commit"><span class="gh-sha">${esc(c.sha)}</span><span class="gh-msg">${esc(c.msg)}</span><span class="gh-when">${esc(timeAgo(c.date))}</span></div>`).join('');
}
function drawCommitBars(byDay) {
  const svg = $('ghSpark'); if (!svg) return;
  const days = Object.keys(byDay).sort().slice(-14);
  if (!days.length) { svg.innerHTML = ''; return; }
  const max = Math.max(1, ...days.map((d) => byDay[d]));
  const W = 800, H = 120, bw = W / days.length;
  svg.innerHTML = '<defs><linearGradient id="ghGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#39ff14"/><stop offset="1" stop-color="#0a8a3a"/></linearGradient></defs>' + days.map((d, i) => {
    const h = (byDay[d] / max) * (H - 14), x = i * bw + bw * 0.18, w = bw * 0.64, y = H - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="url(#ghGrad)"><animate attributeName="height" from="0" to="${h.toFixed(1)}" dur="0.6s" fill="freeze"/><animate attributeName="y" from="${H}" to="${y.toFixed(1)}" dur="0.6s" fill="freeze"/></rect>`;
  }).join('');
}

// 🤖 자율 운영 — 지금 일하는 에이전트 · 오늘의 작전
const OPS_AGENTS = {
  business: { emoji: '💼', name: '비즈니스', color: '#00ff7a' },
  youtube: { emoji: '📺', name: '콘텐츠', color: '#ff5d6c' },
  developer: { emoji: '⚡', name: '개발', color: '#7c9cff' },
  designer: { emoji: '🎨', name: '디자인', color: '#ff9ec7' },
  secretary: { emoji: '📋', name: '비서', color: '#ffd166' },
  human: { emoji: '🙋', name: '사장님', color: '#ffd166' },
};
function opsRel(ts) { if (!ts) return ''; const s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return '방금'; const m = Math.floor(s / 60); if (m < 60) return m + '분 전'; return Math.floor(m / 60) + '시간 전'; }
const OPS_ROSTER = ['business', 'youtube', 'developer', 'designer', 'secretary'];
function renderOps(ops) {
  const sec = $('opsLive'); if (!sec) return;
  const shippedAll = (ops && ops.shipped) || [];
  // 운영 중이 아니어도 지난 성과가 있으면 보여준다 — "내가 뭘 했는가"가 한눈에
  if (!ops || (!ops.running && !shippedAll.length)) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  const busy = !!ops.busy || ops.phase === 'planning';
  const exec = !!ops.executing || ops.phase === 'executing';
  sec.classList.toggle('busy', busy || exec);
  const PH = { planning: '분석 중…', review: '작전 검토 — 메인 창에서 선택', executing: '작전 수행 중…', done: '사이클 완료', idle: '대기' };
  const okShips = shippedAll.filter((s) => s.ok !== false && (s.artifacts || []).length);
  const artCount = shippedAll.reduce((n, s) => n + ((s.artifacts || []).length), 0);
  $('oplState').textContent = ops.running ? ('운영 사이클 #' + (ops.cycle || 1)) : '🏆 운영 성과';
  $('oplRuns').textContent = ops.running ? (PH[ops.phase] || '대기') : `누적 ${ops.runs || 0}사이클 · 완수 ${okShips.length}건 · 산출물 ${artCount}개`;
  $('oplNext').textContent = ops.lastRun ? opsRel(ops.lastRun) + ' 분석' : '';
  const stopBtn = $('oplStop'); if (stopBtn) stopBtn.style.display = ops.running ? '' : 'none';
  const sm = $('oplSummary');
  const msg = ops.summary ? '“' + ops.summary + '”' : (busy ? '💼 비즈니스 에이전트가 매출·유튜브·코드를 읽고 작전을 짜는 중…' : '');
  sm.textContent = msg; sm.style.display = msg ? '' : 'none';
  // 에이전트 — scan이 없어도 기본 5인 로스터를 보여줘서 '0명'이 안 뜨게
  const scan = (ops.scan && ops.scan.length) ? ops.scan : OPS_ROSTER.map((a) => ({ agent: a, label: busy ? '데이터 읽는 중…' : '대기', ok: false }));
  $('oplAgents').innerHTML = scan.map((s) => {
    const a = OPS_AGENTS[s.agent] || { emoji: '▸', name: s.agent, color: '#39ff14' };
    const stat = s.ok ? '● 분석 완료' : (busy ? '◌ 분석 중' : '○ 대기');
    return `<div class="opl-agent ${s.ok ? 'on' : 'off'}${busy && !s.ok ? ' working' : ''}" style="--ag:${a.color}"><span class="opl-ava">${a.emoji}</span><span class="opl-info"><span class="opl-name">${a.name}<i class="opl-stat">${stat}</i></span><span class="opl-task">${esc(s.label)}</span></span></div>`;
  }).join('');
  $('oplActions').innerHTML = (ops.actions || []).map((x, i) => {
    const risky = x.risk && x.risk !== 'safe';
    return `<div class="opl-action"><span class="opl-n">0${i + 1}</span><span class="opl-at">${esc(x.title)}</span>${risky ? '<span class="opl-risk">승인 필요</span>' : '<span class="opl-ok">자동</span>'}</div>`;
  }).join('') || `<div class="opl-empty">${busy ? '에이전트가 작전을 짜는 중…' : '곧 작전이 올라옵니다'}</div>`;
  // 🚀 지금 실행 중인 작업
  const act = $('oplActivity');
  if (ops.executing && ops.activity) { act.classList.remove('hidden'); act.innerHTML = `<span class="opl-spin"></span><span>${esc(ops.activity)}</span>`; }
  else act.classList.add('hidden');
  // 🚀 실제로 처리한 일 (SHIPPED)
  const ships = ops.shipped || [];
  const sw = $('oplShippedWrap');
  if (ships.length) {
    sw.classList.remove('hidden');
    $('oplShipped').innerHTML = ships.map((s) => {
      const a = OPS_AGENTS[s.agent] || { emoji: '🤖', color: '#39ff14' };
      const arts = s.artifacts || [];
      const ok = s.ok !== false && arts.length > 0;
      const chips = arts.length ? `<div class="opl-ship-arts">${arts.map((x) => `<span class="opl-art">${esc(x)}</span>`).join('')}</div>` : '';
      const body = chips || `<div class="opl-ship-r fail">결과물 없음 — 다음 사이클에서 다시 시도해요</div>`;
      const badge = ok ? '<span class="opl-ship-ok">✓ 산출물</span>' : '<span class="opl-ship-fail">미완</span>';
      return `<div class="opl-ship ${ok ? '' : 'isfail'}" style="--ag:${a.color}"><div class="opl-ship-top"><span class="opl-ship-ico">${a.emoji}</span><span class="opl-ship-t">${esc(s.title)}</span>${badge}<span class="opl-ship-when">${opsRel(s.ts)}</span></div>${body}</div>`;
    }).join('');
  } else sw.classList.add('hidden');
}

function render(state) {
  if (state.loading) { $('emptyArea')?.classList.add('hidden'); return; }
  renderOps(state.ops);                     // 🤖 자율 운영 현황 (맨 위 — 페이팔 없어도)
  renderServices(state.services || []);   // 페이팔 없어도 서비스는 항상 화려하게
  renderYoutube(state.youtube);            // 📺 유튜브 (페이팔 없어도 표시)
  renderGithub(state.github);              // ⚡ 깃허브 개발 활동
  if (state.error || !state.data) {
    $('emptyArea').classList.remove('hidden');
    $('emptyArea').innerHTML = `<div class="empty">
      <div class="emoji">💳</div>
      <h3>PayPal을 연결하면 매출이 여기 표시돼요</h3>
      <p>${state.error ? esc(state.error) : '🗂️ 연동 → PayPal에 Client ID + Secret 입력 후 새로고침'}</p>
    </div>`;
    return;
  }
  const data = state.data;
  $('emptyArea').classList.add('hidden');
  lastData = data;
  $('emptyArea').classList.add('hidden');

  const primaryCur = renderKPI(data);
  renderSparkline(data.by_day || {}, primaryCur);
  renderDonut(data.by_project || {}, primaryCur);
  renderProjectBars(data.by_project || {});
  renderTransactions(data.transactions || []);

  $('generated').textContent = data.generated_at ? new Date(data.generated_at).toLocaleString() : '';
  firstRender = false;
}

// ───────── Wire UI ─────────
$('refreshBtn')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'refresh' });
  $('refreshBtn').textContent = '⏳ 새로고침 중...';
  setTimeout(() => $('refreshBtn').textContent = '🔄 새로고침', 800);
});
$('settingsBtn')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'openSettings' });
});

$('oplStop')?.addEventListener('click', async () => {
  if (!window.connect.opsStop) return;
  await window.connect.opsStop();
  renderOps({ running: false });
});
window.connect.onRevenueState((m) => { if (m && m.type === 'state') render(m); });
// 🤖 자율 운영 라이브 업데이트(24시간 루프가 도는 동안 패널만 갱신)
window.connect.onOpsUpdate?.((s) => renderOps(s));

// 🎙️ AI 비서 브리핑 — 실데이터로 음성 브리핑(선희) + 타자기 자막 (홍보 쇼케이스)
let briefAudio = null;
$('briefBtn')?.addEventListener('click', async () => {
  const btn = $('briefBtn'); btn.textContent = '⏳ 브리핑 준비 중…'; btn.disabled = true;
  try {
    const r = await window.connect.reportBriefing();
    if (!r || !r.ok) { btn.textContent = '🎙️ AI 브리핑'; btn.disabled = false; showBrief('⚠️ ' + ((r && r.error) || '브리핑 생성 실패 — 모델을 켜주세요.'), false); return; }
    btn.textContent = '🎙️ AI 브리핑'; btn.disabled = false;
    // 음성 먼저 요청(선희), 받으면 재생 시작에 맞춰 타자기
    const voice = await window.connect.reportSpeak(r.text);
    showBrief(r.text, true);
    if (voice && voice.ok && voice.dataUri) {
      if (briefAudio) { try { briefAudio.pause(); } catch (e) {} }
      briefAudio = new Audio(voice.dataUri);
      const orb = $('abOrb');
      briefAudio.onplay = () => orb && orb.classList.add('speaking');
      briefAudio.onended = () => orb && orb.classList.remove('speaking');
      briefAudio.play().catch(() => {});
    }
  } catch (e) { btn.textContent = '🎙️ AI 브리핑'; btn.disabled = false; }
});
function showBrief(text, typing) {
  const panel = $('aiBrief'), el = $('abText'); if (!panel || !el) return;
  panel.classList.remove('hidden'); el.textContent = '';
  if (!typing) { el.textContent = text; return; }
  let i = 0;
  const iv = setInterval(() => { el.textContent = text.slice(0, i++); el.scrollTop = el.scrollHeight; if (i > text.length) clearInterval(iv); }, 32);
}

spawnGlyphRain();
vscode.postMessage({ type: 'ready' });
// 라이브 — 90초마다 자동 새로고침
setInterval(() => vscode.postMessage({ type: 'refresh' }), 90000);
