const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const fmt = (n) => { n = Number(n)||0; if(n>=1e9) return (n/1e9).toFixed(1)+'B'; if(n>=1e6) return (n/1e6).toFixed(1)+'M'; if(n>=1e3) return (n/1e3).toFixed(1)+'K'; return String(n); };

/* Animated count-up — eases from current displayed number to target. */
function animateNum(el, targetRaw) {
  if (!el) return;
  const target = Number(targetRaw) || 0;
  const start  = Number(el.dataset.target) || 0;
  if (start === target) { el.textContent = fmt(target); el.dataset.target = String(target); return; }
  const dur = 700;
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3); /* easeOutCubic */
    const v = Math.round(start + (target - start) * e);
    el.textContent = fmt(v);
    if (p < 1) requestAnimationFrame(tick);
    else el.dataset.target = String(target);
  }
  requestAnimationFrame(tick);
}

/* Ambient bg — slow particles drifting. Honors prefers-reduced-motion. */
(function ambientBg() {
  const c = document.getElementById('bgCanvas');
  if (!c) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = c.getContext('2d');
  let w, h, particles;
  function resize() {
    w = c.width = innerWidth * devicePixelRatio;
    h = c.height = innerHeight * devicePixelRatio;
    c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px';
    particles = Array.from({length: 24}, () => ({
      x: Math.random()*w, y: Math.random()*h,
      r: (Math.random()*1.5 + 0.5) * devicePixelRatio,
      vx: (Math.random()-0.5)*0.15, vy: (Math.random()-0.5)*0.15,
      a: Math.random()*0.4 + 0.1
    }));
  }
  resize(); addEventListener('resize', resize);
  function frame() {
    ctx.clearRect(0,0,w,h);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(251,191,36,'+p.a+')';
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  frame();
})();

/* Today label */
$('todayLabel').textContent = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

/* Toast */
function toast(text, err) {
  const t = $('toast');
  t.textContent = text; t.classList.toggle('err', !!err); t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

/* Buttons */
$('refreshBtn').onclick = () => vscode.postMessage({ type: 'refresh' });
$('briefBtn').onclick   = () => vscode.postMessage({ type: 'fireBriefing' });
$('queueBtn').onclick   = () => vscode.postMessage({ type: 'queueComments' });
/* v2.89.24 — 보고 스케줄 모달 */
$('scheduleBtn').onclick = () => { vscode.postMessage({ type: 'getReportSchedule' }); };
/* v2.89.26 — 에이전트별 모델 라우팅 모달 */
$('modelsBtn').onclick = () => { vscode.postMessage({ type: 'getAgentModelRouting' }); };
/* v2.83: removed competitor add/input wiring — section gone. */

/* Render — main state handler */
function render(s) {
  $('companyName').textContent = s.company;
  $('briefPill').textContent = '🌅 매일 ' + (s.briefingTime || '09:00');
  $('convCount').textContent = s.conversationsToday || 0;

  /* KPI strip */
  if (s.yt && s.yt.configured) {
    animateNum($('kSubs'), s.yt.my.subs);
    animateNum($('kViews'), s.yt.my.views);
    $('kEng').textContent = s.yt.engagementPct + '%';
  } else {
    $('kSubs').textContent = '–';
    $('kViews').textContent = '–';
    $('kEng').textContent = '–';
  }
  animateNum($('kOpen'), s.tasks.open);
  $('kUrgent').textContent = s.tasks.urgent > 0 ? ('🔴 긴급 ' + s.tasks.urgent) : '';
  animateNum($('kApr'), s.approvals.length);

  /* YouTube cards — only show the whole 📺 cluster when channel is connected.
     Keeps the dashboard simple for users who haven't set up YouTube yet. */
  const ytConfigured = !!(s.yt && s.yt.configured);
  document.querySelectorAll('.yt-cond').forEach(el => { el.style.display = ytConfigured ? '' : 'none'; });
  const ytBody = $('ytBody');
  if (!ytConfigured) {
    /* No-op: cards are hidden. */
  } else {
    const my = s.yt.my;
    /* Visual YT card — bigger thumbnail, channel name, stats with icons. */
    ytBody.innerHTML = ''
      + '<div class="yt-channel">'
      +   '<div class="yt-thumb" style="background-image:url(' + esc(my.thumb) + ')"></div>'
      +   '<div class="yt-channel-name">' + esc(my.title) + '</div>'
      + '</div>'
      + '<div class="yt-stats">'
      +   '<div class="yt-stat"><div class="yt-stat-icon">👥</div><div class="num">' + fmt(my.subs) + '</div></div>'
      +   '<div class="yt-stat"><div class="yt-stat-icon">👁</div><div class="num">' + fmt(my.views) + '</div></div>'
      +   '<div class="yt-stat"><div class="yt-stat-icon">🎬</div><div class="num">' + my.videos + '</div></div>'
      + '</div>';
  }

  /* Tasks — visual tiles. Big agent emoji, priority color border, due-date
     as floating badge, title as 2-line caption. No id, no status text. */
  $('taskBadge').textContent = s.tasks.open;
  const tBody = $('tasksBody');
  if (!s.tasks.top || s.tasks.top.length === 0) {
    tBody.innerHTML = '<div class="empty subtle" style="text-align:center;padding:20px;font-size:32px;opacity:.5">✨</div>';
  } else {
    tBody.innerHTML = '<div class="task-list">' + s.tasks.top.map(t => {
      const dueBadge = t.dueLabel ? '<div class="task-due-badge">' + esc(t.dueLabel) + '</div>' : '';
      const recur = t.recurrence ? '<div class="task-recurrence-mark" title="' + esc(t.recurrence) + '">🔁</div>' : '';
      /* v2.88.4 — 취소 버튼 (✕). 멈춰있거나 잘못 들어간 작업 즉시 정리. */
      return '<div class="task-row ' + esc(t.priority) + '" data-task-id="' + esc(t.shortId) + '" title="' + esc(t.title) + ' (id ' + esc(t.shortId) + ')">'
        + dueBadge
        + recur
        + '<div class="task-emoji-big">' + esc(t.agentEmoji) + '</div>'
        + '<div class="task-title">' + esc(t.title) + '</div>'
        + '<button class="task-cancel-btn" data-act="cancel-task" data-id="' + esc(t.shortId) + '" title="이 작업 취소">✕</button>'
        + '</div>';
    }).join('') + '</div>';
    /* 취소 버튼 클릭 → 백엔드로 메시지 전송 */
    tBody.querySelectorAll('[data-act="cancel-task"]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if(id) vscode.postMessage({ type: 'cancelTask', id });
      };
    });
  }

  /* Approvals — visual queue. Emoji tile + title + icon-only action buttons.
     No "승인/거부/상세" text labels — the icons tell the story. */
  $('aprBadge').textContent = s.approvals.length;
  const aBody = $('aprBody');
  if (s.approvals.length === 0) {
    aBody.innerHTML = '<div class="empty subtle" style="text-align:center;padding:20px;font-size:32px;opacity:.5">✓</div>';
  } else {
    aBody.innerHTML = '<div class="apr-list">' + s.approvals.map(a => {
      const summaryHtml = esc(a.summary || '').replace(/\\n/g, ' ').replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
      return '<div class="apr-card" title="' + esc(a.title) + '">'
        + '<div class="apr-emoji-tile">' + a.emoji + '</div>'
        + '<div class="apr-title-block">'
        +   '<div class="apr-title">' + esc(a.title) + '</div>'
        +   '<div class="apr-summary">' + summaryHtml + '</div>'
        + '</div>'
        + '<div class="apr-actions">'
        +   '<div class="apr-icon-btn approve" data-act="approve" data-id="' + esc(a.shortId) + '" title="승인">✓</div>'
        +   '<div class="apr-icon-btn reject"  data-act="reject"  data-id="' + esc(a.shortId) + '" title="거부">✕</div>'
        +   '<div class="apr-icon-btn detail"  data-act="open"    data-id="' + esc(a.shortId) + '" title="상세 보기">⋯</div>'
        + '</div></div>';
    }).join('') + '</div>';
    aBody.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = () => {
        const act = btn.dataset.act, id = btn.dataset.id;
        if (act === 'open') vscode.postMessage({ type: 'openApproval', id });
        else vscode.postMessage({ type: act, id });
      };
    });
  }

  /* Analytics */
  const anaBadge = $('anaBadge'); const anaBody = $('anaBody');
  anaBadge.textContent = s.oauthConnected ? 'OAuth ✅' : 'API key';
  anaBadge.classList.toggle('ok', !!s.oauthConnected);
  if (!s.oauthConnected) {
    anaBody.innerHTML = '<div class="ana-empty"><div class="icon">🔐</div><div class="msg">시청 지속률·트래픽 소스·시청자 국가는 OAuth 연결 후 보입니다.</div><button class="btn primary small" id="oauthBtnA">YouTube OAuth 연결</button></div>';
    const ob = document.getElementById('oauthBtnA'); if (ob) ob.onclick = () => vscode.postMessage({ type: 'connectOAuth' });
  } else if (s.yt && s.yt.analytics && !s.yt.analytics.error) {
    const a = s.yt.analytics;
    const dur = a.avgViewDurationSec ? Math.floor(a.avgViewDurationSec / 60) + ':' + ('0' + (a.avgViewDurationSec % 60)).slice(-2) : '–';
    /* Visual-first analytics — big numbers with emoji icons replace text
       labels. Section titles become single emoji headers. */
    let html = '<div class="ana-totals">'
      + '<div class="ana-cell"><div class="ana-icon">👁</div><div class="num">' + fmt(a.views || 0) + '</div></div>'
      + '<div class="ana-cell"><div class="ana-icon">⏱</div><div class="num">' + dur + '</div></div>'
      + '<div class="ana-cell"><div class="ana-icon">📈</div><div class="num">' + (a.avgViewPercentage ? a.avgViewPercentage.toFixed(0) + '%' : '–') + '</div></div>'
      + '<div class="ana-cell"><div class="ana-icon">＋</div><div class="num">' + fmt(a.subscribersGained || 0) + '</div></div>'
      + '</div>';
    if (Array.isArray(a.topSources) && a.topSources.length > 0) {
      const max = Math.max(...a.topSources.map(t => t.views));
      html += '<div class="ana-section-title"><span class="ana-section-icon">🎯</span></div>';
      html += a.topSources.slice(0, 5).map(t => {
        const pct = max > 0 ? (t.views/max*100).toFixed(0) : 0;
        return '<div class="ana-bar-row"><span class="nm">' + esc(t.source) + '</span><span class="vl">' + fmt(t.views) + '</span></div>'
          + '<div class="ana-bar"><span style="width:' + pct + '%"></span></div>';
      }).join('');
    }
    if (Array.isArray(a.topCountries) && a.topCountries.length > 0) {
      const max = Math.max(...a.topCountries.map(t => t.views));
      html += '<div class="ana-section-title"><span class="ana-section-icon">🌏</span></div>';
      html += a.topCountries.slice(0, 5).map(t => {
        const pct = max > 0 ? (t.views/max*100).toFixed(0) : 0;
        return '<div class="ana-bar-row"><span class="nm">' + esc(t.country) + '</span><span class="vl">' + fmt(t.views) + '</span></div>'
          + '<div class="ana-bar"><span style="width:' + pct + '%"></span></div>';
      }).join('');
    }
    anaBody.innerHTML = html;
  } else {
    anaBody.innerHTML = '<div class="ana-empty"><div class="icon">⏳</div><div class="msg">Analytics 데이터를 불러오는 중...</div></div>';
  }

  /* Videos */
  const vBody = $('vidBody');
  if (s.yt && s.yt.configured && s.yt.myVideos && s.yt.myVideos.length > 0) {
    vBody.innerHTML = s.yt.myVideos.map(v =>
      '<a class="video-card" target="_blank" href="https://www.youtube.com/watch?v=' + esc(v.id) + '">'
      + '<div class="video-thumb" style="background-image:url(' + esc(v.thumb) + ')"></div>'
      + '<div class="video-meta"><div class="video-title">' + esc(v.title) + '</div>'
      + '<div class="video-stats">👁 ' + fmt(v.views) + ' · 👍 ' + fmt(v.likes) + ' · 💬 ' + fmt(v.comments) + '</div></div>'
      + '</a>'
    ).join('');
  } else {
    vBody.innerHTML = '<div class="empty subtle">최근 영상이 없거나 채널이 연결되지 않았어요.</div>';
  }

  /* Competitors + activity log sections removed in v2.83. */

  /* v2.77 — Visual-first team. Each card is a character tile: the photo
     IS the card. Name overlaid bottom, task count floats top-right (only
     when nonzero), specialty appears on hover. No more text-heavy meta
     pills crowding the card — those live in the agent's panel for users
     who want to drill in. */
  const teamBody = $('teamBody');
  const teamBadge = $('teamBadge');
  if (s.agentTeam && s.agentTeam.length > 0) {
    /* v2.89.103+107 — 진행 카운트.
       기준은 active (실제 사용 가능) 으로 변경. ONLINE = active=true. */
    const total = (typeof s.totalAgents === 'number') ? s.totalAgents : s.agentTeam.length;
    const activeN = (typeof s.activeCount === 'number') ? s.activeCount
                  : (typeof s.hiredCount === 'number') ? s.hiredCount : s.agentTeam.length;
    teamBadge.textContent = activeN + ' / ' + total + ' ONLINE';
    /* v2.89.108 — 범례 카운트 + 필터 칩 */
    const lockedCount = s.agentTeam.filter(a => a.lockable && !a.hired).length;
    const optionalOff = s.agentTeam.filter(a => !a.lockable && a.togglable && !a.active).length;
    const onCount = s.agentTeam.filter(a => a.active && !(a.lockable && !a.hired)).length;
    const setText = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    setText('tlAll', total);
    setText('tlOn', onCount);
    setText('tlOpt', optionalOff);
    setText('tlLock', lockedCount);
    teamBody.innerHTML = s.agentTeam.map(a => {
      const isLocked = (a.lockable && !a.hired);
      const isInactive = (!isLocked && a.togglable && !a.active);
      const photoHtml = a.profileImageUri
        ? '<div class="agent-photo" style="background-image:url(\'' + esc(a.profileImageUri) + '\')"></div>'
        : '<div class="agent-photo no-photo">' + esc(a.emoji) + '</div>';
      const taskBadge = (a.openTasks > 0)
        ? '<div class="agent-task-badge" title="' + a.openTasks + '건 진행 중">' + a.openTasks + '</div>'
        : '';
      const activeDot = a.lastActivity
        ? '<div class="agent-active-dot" title="최근 활동 있음"></div>'
        : '';
      const tooltip = (a.tagline || a.specialty)
        ? '<div class="agent-hover-info">' + esc((a.tagline || a.specialty || '').slice(0, 90)) + '</div>'
        : '';
      /* 잠긴 에이전트: 사진 영역에 글리치 오버레이 + 락 배지 + 이름 가림 */
      if (isLocked) {
        const lockTitle = '🔒 ' + esc(a.name) + ' — 입사 준비 중 (클릭: 채용 인증)';
        return '<div class="agent-card agent-card-locked" data-agent="' + esc(a.id) + '" style="--agent-color:' + esc(a.color || '#00ff8b') + '" title="' + lockTitle + '">'
          +   photoHtml
          +   '<div class="agent-overlay"></div>'
          +   '<div class="agent-glitch"></div>'
          +   '<div class="agent-lock-badge">🔒</div>'
          +   '<div class="agent-hover-info">CLEARANCE REQUIRED · 클릭해서 채용 인증</div>'
          +   '<div class="agent-name-strip">'
          +     '<div>??? ??? ???</div>'
          +     '<div class="agent-role-mini">[ ENCRYPTED ]</div>'
          +   '</div>'
          + '</div>';
      }
      /* v2.89.107 — 비활성 에이전트: 페이드 + 토글 배지 (PIN 안 필요) */
      if (isInactive) {
        const inactiveTitle = '⏸ ' + esc(a.name) + ' — 비활성 (클릭: 활성화)';
        return '<div class="agent-card agent-card-inactive" data-agent="' + esc(a.id) + '" style="--agent-color:' + esc(a.color || '#00ff8b') + '" title="' + inactiveTitle + '">'
          +   photoHtml
          +   '<div class="agent-overlay"></div>'
          +   '<div class="agent-inactive-badge">⏸</div>'
          +   '<div class="agent-hover-info">OFFLINE · 클릭해서 활성화</div>'
          +   '<div class="agent-name-strip">'
          +     '<div>' + esc(a.name) + '</div>'
          +     '<div class="agent-role-mini">' + esc(a.role || '') + ' · OFFLINE</div>'
          +   '</div>'
          + '</div>';
      }
      return '<div class="agent-card" data-agent="' + esc(a.id) + '" style="--agent-color:' + esc(a.color || '#00ff8b') + '" title="' + esc(a.name + ' — ' + (a.role||'') + ' (클릭: 상세)') + '">'
        +   photoHtml
        +   '<div class="agent-overlay"></div>'
        +   activeDot
        +   taskBadge
        +   tooltip
        +   '<div class="agent-name-strip">'
        +     '<div>' + esc(a.name) + '</div>'
        +     '<div class="agent-role-mini">' + esc(a.role || '') + '</div>'
        +   '</div>'
        + '</div>';
    }).join('');
    /* v2.89.103+107 — 카드 클릭 분기:
       1. locked (Luna PIN 미통과) → openHirePinModal
       2. inactive (OPTIONAL OFF) → openActivateModal
       3. 그 외 (active) → showAgentDetailModal */
    teamBody.querySelectorAll('.agent-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-agent');
        if(!id) return;
        const a = (s.agentTeam || []).find(x => x.id === id);
        if(!a) return;
        if (a.lockable && !a.hired) { openHirePinModal(a); return; }
        if (a.togglable && !a.active && !a.lockable) { openActivateModal(a); return; }
        showAgentDetailModal(a);
      });
      card.style.cursor = 'pointer';
    });
    /* v2.89.108 — 필터 칩 동작 */
    const chips = document.querySelectorAll('.team-legend .tl-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('tl-active'));
        chip.classList.add('tl-active');
        const filter = chip.getAttribute('data-filter') || 'all';
        teamBody.querySelectorAll('.agent-card').forEach(card => {
          const id = card.getAttribute('data-agent');
          const a = (s.agentTeam || []).find(x => x.id === id);
          if (!a) return;
          let show = true;
          if (filter === 'online') show = !!a.active && !(a.lockable && !a.hired);
          else if (filter === 'optional') show = !a.lockable && a.togglable && !a.active;
          else if (filter === 'locked') show = a.lockable && !a.hired;
          card.style.display = show ? '' : 'none';
        });
      });
    });
  } else {
    teamBody.innerHTML = '<div class="empty subtle">에이전트 정보를 불러오는 중...</div>';
  }

  /* v2.83: activity log section removed — raw conversation log lives in
     the brain folder for power users; daily summary is in 텔레그램 브리핑. */
}

/* v2.87.7 — 에이전트 상세 모달. 카드 클릭 시 사진·역할·스킬·검증된 지식
   카운트·최근 활동을 한 화면에서. 폴더 안 뒤지고도 안에 뭐가 있는지 초보자가
   한 눈에 파악. ESC 또는 백드롭 클릭으로 닫기. */
/* v2.89.12 — 스킬 상세 미니 모달. 사용자가 에이전트 카드 → 스킬 타일을 클릭하면
   그 스킬만 풀화면으로 보여주고 ▶ 실행 / ⚙️ 설정 버튼 제공. 출력은 모달 안에
   라이브 표시. 스킬 한 개를 빠르게 시도해볼 수 있는 UX. */
let _adminSkillBackdrop = null;
function showSkillDetail(agent, skill){
  if(_adminSkillBackdrop)return;
  const bd = document.createElement('div');
  bd.className = 'adm-skill-detail-overlay';
  bd.style.setProperty('--ag', agent.color || '#FBBF24');
  bd.style.setProperty('--ag-glow', (agent.color||'#FBBF24')+'33');
  const statusCls = skill.locked ? 'locked' : (skill.enabled ? 'on' : 'off');
  const statusText = skill.locked ? '🔒 설정 필요' : (skill.enabled ? '✅ 자동 사용 중' : '⏸ 꺼짐');
  const desc = skill.description || '';
  const display = skill.label || skill.name || '';
  const runDisabled = skill.locked ? 'disabled' : '';
  const runLabel = skill.locked ? '🔒 먼저 설정 필요' : '▶ 이것만 실행';
  /* v2.89.17 — 인앱 설정 폼. 도구의 .json + 공유 .json (youtube_account.json 등)
     을 단일 폼으로 합쳐서 비기술자도 편집 가능. 저장 시 백엔드가 알아서 어느 파일에
     쓸지 분기. 폼은 ⚙️ 토글로 펼침/접힘. */
  const configFields = [];
  const cfg = skill.config || {};
  /* v2.89.81 — _schema를 통과 받아 hint·label·options 메타로 사용.
     v2.89.85 — _schema 가 정의된 도구는 schema 에 등록된 키만 폼에 노출.
     이전엔 도구가 실행 중에 자동으로 채워넣은 메타 (INSTALLED_MODEL,
     VENV_PYTHON, HF_ID, INSTALLED_AT 등) 가 폼에 같이 노출돼서 사용자가
     "이걸 내가 편집해야 하나?" 헷갈렸음. 이제 _schema 있으면 화이트리스트
     모드 — schema 에 명시한 키만 보임. */
  const toolSchema = (cfg && typeof cfg._schema === 'object' && cfg._schema) || {};
  const sharedSchema = (skill.sharedConfig && typeof skill.sharedConfig._schema === 'object' && skill.sharedConfig._schema) || {};
  const toolHasSchema = Object.keys(toolSchema).length > 0;
  const sharedHasSchema = Object.keys(sharedSchema).length > 0;
  for (const [k, v] of Object.entries(cfg)) {
    if (k === '_schema' || k.startsWith('_')) continue;
    if (toolHasSchema && !(k in toolSchema)) continue; /* 화이트리스트 */
    configFields.push({ key: k, value: v, source: 'tool', meta: toolSchema[k] || null });
  }
  if (skill.sharedConfig) {
    for (const [k, v] of Object.entries(skill.sharedConfig)) {
      if (k.startsWith('_')) continue;
      if (sharedHasSchema && !(k in sharedSchema)) continue; /* 화이트리스트 */
      /* 도구 자체 config에 같은 키 있으면 도구 우선 */
      if (configFields.find(f => f.key === k)) continue;
      configFields.push({ key: k, value: v, source: 'shared', meta: sharedSchema[k] || null });
    }
  }
  function renderConfigForm() {
    if (configFields.length === 0) return '';
    return '<div class="adm-skill-detail-form" id="admSkillForm">'
      + '<div class="adm-skill-detail-form-head">⚙️ 도구 설정 <span class="adm-skill-detail-form-sub">바로 편집 후 저장 → 다음 실행에 반영</span></div>'
      + configFields.map((f, i) => {
          const meta = f.meta || {};
          const lower = String(f.key).toLowerCase();
          const isSecret = /key|token|secret|password/.test(lower);
          const isList = Array.isArray(f.value);
          const isSelect = meta.type === 'select' && Array.isArray(meta.options);
          const isMultiline = isList || (!isSelect && typeof f.value === 'string' && f.value.length > 60);
          let valStr = '';
          if (isList) valStr = (f.value || []).join('\n');
          else if (typeof f.value === 'string') valStr = f.value;
          else if (f.value == null) valStr = '';
          else valStr = String(f.value);
          /* v2.89.81 — meta.hint 우선. 없으면 list 기본 안내. */
          const helpHint = meta.hint || (isList ? '한 줄에 한 개씩 (예: @channel_a 다음 줄에 @channel_b)' : '');
          const labelText = meta.label || f.key;
          const sharedTag = f.source === 'shared' ? '<span class="adm-skill-detail-form-shared" title="공유 파일 (다른 YouTube 도구도 함께 사용): '+esc(skill.sharedConfigName||'shared')+'">🔗 공유</span>' : '';
          let inputHtml = '';
          if (isSelect) {
            const opts = meta.options.map(function(o){
              const ov = (typeof o === 'object' && o !== null) ? o.value : o;
              const ol = (typeof o === 'object' && o !== null) ? (o.label || o.value) : o;
              const sel = String(ov) === String(valStr) ? ' selected' : '';
              return '<option value="'+esc(String(ov))+'"'+sel+'>'+esc(String(ol))+'</option>';
            }).join('');
            inputHtml = '<select class="adm-skill-detail-form-input">'+opts+'</select>';
          } else if (isMultiline) {
            inputHtml = '<textarea class="adm-skill-detail-form-input" rows="3">'+esc(valStr)+'</textarea>';
          } else {
            inputHtml = '<input class="adm-skill-detail-form-input" type="'+(isSecret?'password':'text')+'" value="'+esc(valStr)+'" />';
          }
          return '<div class="adm-skill-detail-form-field" data-key="'+esc(f.key)+'" data-source="'+f.source+'" data-list="'+(isList?'1':'0')+'" data-select="'+(isSelect?'1':'0')+'">'
            + '<label class="adm-skill-detail-form-label">'+esc(labelText)+sharedTag+'</label>'
            + inputHtml
            + (helpHint ? '<div class="adm-skill-detail-form-help">'+esc(helpHint)+'</div>' : '')
            + '</div>';
        }).join('')
      + '<div class="adm-skill-detail-form-actions">'
      +   '<button class="adm-skill-detail-form-save" data-act="save-config" type="button">💾 저장</button>'
      +   '<button class="adm-skill-detail-form-cancel" data-act="cancel-config" type="button">취소</button>'
      + '</div>'
      + '</div>';
  }
  bd.innerHTML = ''
    + '<div class="adm-skill-detail">'
    +   '<button class="adm-skill-detail-close" type="button">×</button>'
    +   '<div class="adm-skill-detail-head">'
    +     '<div class="adm-skill-detail-emoji">'+esc(skill.emoji||'🛠')+'</div>'
    +     '<div>'
    +       '<div class="adm-skill-detail-name">'+esc(display)+'</div>'
    +       '<div class="adm-skill-detail-status '+statusCls+'">'+statusText+'</div>'
    +     '</div>'
    +   '</div>'
    +   (desc ? '<div class="adm-skill-detail-desc">'+esc(desc)+'</div>' : '')
    +   '<div class="adm-skill-detail-actions">'
    +     '<button class="adm-skill-detail-run" data-act="run" '+runDisabled+' type="button">'+esc(runLabel)+'</button>'
    +     (configFields.length > 0 ? '<button class="adm-skill-detail-config" data-act="toggle-config" type="button">⚙️ 설정</button>' : '')
    +   '</div>'
    +   renderConfigForm()
    +   '<div class="adm-skill-detail-output" id="admSkillOut"></div>'
    + '</div>';
  document.body.appendChild(bd);
  _adminSkillBackdrop = bd;
  function close(){
    if(!_adminSkillBackdrop)return;
    bd.style.opacity='0';
    setTimeout(()=>{bd.remove(); _adminSkillBackdrop = null;}, 180);
    document.removeEventListener('keydown', escH);
  }
  function escH(e){ if(e.key==='Escape') close(); }
  bd.querySelector('.adm-skill-detail-close').addEventListener('click', close);
  bd.addEventListener('click', e => { if(e.target === bd) close(); });
  document.addEventListener('keydown', escH);
  /* ▶ 실행 — 백엔드로 스킬 단독 실행 요청 */
  const runBtn = bd.querySelector('[data-act="run"]');
  const out = bd.querySelector('#admSkillOut');
  function triggerRun(){
    if(!runBtn || skill.locked) return;
    runBtn.disabled = true;
    runBtn.textContent = '⏳ 실행 중...';
    out.textContent = '';
    out.classList.add('show', 'running');
    vscode.postMessage({ type: 'runSingleSkill', agentId: agent.id, skillName: skill.name });
  }
  if(runBtn){ runBtn.addEventListener('click', triggerRun); }
  /* v2.89.13 — 자동 실행 (잠긴 스킬은 제외). 사용자가 스킬 클릭한 의도 = 실행 */
  if(!skill.locked){
    setTimeout(triggerRun, 80);
  }
  /* ⚙️ 설정 토글 — 인앱 폼 펼침/접힘 */
  const formEl = bd.querySelector('#admSkillForm');
  if (formEl) formEl.style.display = 'none';
  const cfgBtn = bd.querySelector('[data-act="toggle-config"]');
  if (cfgBtn) {
    cfgBtn.addEventListener('click', () => {
      if (!formEl) return;
      const visible = formEl.style.display !== 'none';
      formEl.style.display = visible ? 'none' : '';
    });
  }
  /* 취소 — 폼 닫기 (값 변경은 인풋에만 있고 디스크엔 안 갔으니 자동 무효) */
  const cancelBtn = bd.querySelector('[data-act="cancel-config"]');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (formEl) formEl.style.display = 'none';
    });
  }
  /* 저장 — 모든 input/textarea 값 모아서 백엔드로 전송 */
  const saveBtn = bd.querySelector('[data-act="save-config"]');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const updates = { tool: {}, shared: {} };
      bd.querySelectorAll('.adm-skill-detail-form-field').forEach(field => {
        const key = field.getAttribute('data-key');
        const source = field.getAttribute('data-source');
        const isList = field.getAttribute('data-list') === '1';
        const inp = field.querySelector('.adm-skill-detail-form-input');
        if (!inp || !key) return;
        let val = inp.value || '';
        if (isList) {
          val = val.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        }
        updates[source === 'shared' ? 'shared' : 'tool'][key] = val;
      });
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ 저장 중...';
      vscode.postMessage({ type: 'saveSkillConfig', agentId: agent.id, skillName: skill.name, updates });
    });
  }
}

/* v2.89.26 — 에이전트별 모델 라우팅 모달. 각 에이전트가 다른 LLM 모델 쓸 수
   있게 드롭다운으로 선택. 비어있으면 기본 모델 사용. 설치된 모델만 노출. */
let _agentModelRoutingBackdrop = null;
function showAgentModelRoutingModal(data){
  if(_agentModelRoutingBackdrop) return;
  const installed = data.installed || [];
  const map = data.map || {};
  const defaultModel = data.defaultModel || '(자동 선택)';
  const agents = data.agents || [];
  const specs = data.specs || null;
  const bd = document.createElement('div');
  bd.className = 'adm-backdrop amr-backdrop';
  bd.style.setProperty('--ag','#A78BFA');
  bd.style.setProperty('--ag-glow','rgba(167,139,250,.22)');
  function modelOptions(curId){
    const opts = ['<option value="">기본 (' + esc(defaultModel) + ')</option>'];
    for (const m of installed) {
      const sel = m.id === curId ? ' selected' : '';
      /* v2.89.36 — 메모리 부족 모델은 ⚠️로 표시. 사용자가 무심코 큰 모델 골랐다가
         "model failed to load" 만나기 전에 시각적 경고. */
      const memTag = (m.estMemGB != null) ? (' · ~' + m.estMemGB.toFixed(1) + 'GB') : '';
      const warn = (m.safe === false) ? ' ⚠️ 메모리 부족 가능' : '';
      opts.push('<option value="' + esc(m.id) + '"' + sel + '>' + esc(m.id) + ' [' + m.backend + ']' + memTag + warn + '</option>');
    }
    return opts.join('');
  }
  const noModels = installed.length === 0;
  /* v2.89.28 — 분산 진단: 현재 매핑에서 실제 사용 중인 distinct 모델 수.
     1개면 "단일 모델" 상태 — 사용자한테 더 다양한 모델 다운로드 추천. */
  const distinctModels = new Set(Object.values(map).filter(v => v).map(String));
  const distinctCount = distinctModels.size;
  const installedCount = installed.length;
  let diagnosticBlock = '';
  if (installedCount === 0) {
    /* 빈 케이스 — 기존 helpBlock에서 처리 */
  } else if (installedCount === 1) {
    diagnosticBlock = '<div class="amr-diag warn">설치된 모델 1개 — 모든 에이전트가 동일 모델 사용. 분산 추론을 위해 다른 사이즈 모델 추가 권장:<br/><code>ollama pull llama3.2:3b</code> (라우팅)<br/><code>ollama pull qwen2.5:7b</code> (분석)</div>';
  } else if (distinctCount <= 1 && installedCount >= 2) {
    diagnosticBlock = '<div class="amr-diag warn">모델 ' + installedCount + '개 설치됨, 현재 매핑은 단일 모델만 사용 중. <strong>자동 오케스트레이션</strong> 버튼 누르면 역할별 분배.</div>';
  } else if (distinctCount >= 2) {
    diagnosticBlock = '<div class="amr-diag ok">' + distinctCount + '개의 distinct 모델로 분산 추론 활성</div>';
  }
  /* v3.0 — SPEC-04: 슬롯 요약 바. fast/worker/external 각 슬롯의 모델 + 상태. */
  const ls = data.llmStatus;
  const sa = data.slotByAgent || {};
  let slotBar = '';
  if (ls && ls.slots) {
    const slotBadge = (slot, icon, label) => {
      const s = ls.slots[slot];
      if (!s) return '<div class="amr-slot empty">' + icon + ' ' + label + ': <span class="muted">⚪ 미설정</span></div>';
      if (slot === 'external') {
        const limit = ls.externalDailyLimit > 0 ? ls.externalDailyLimit : '∞';
        return '<div class="amr-slot ext">' + icon + ' ' + label + ': <span class="ok">🔵 외부 · ' + esc(s.model) + ' · 오늘 ' + ls.externalToday + '/' + limit + '</span></div>';
      }
      return '<div class="amr-slot">' + icon + ' ' + label + ': <span class="ok">🟢 로컬 · ' + esc(s.model) + '</span></div>';
    };
    if (!ls.slots.external) {
      slotBar = slotBadge('fast','🚀','Fast') + slotBadge('worker','🏗️','Worker') + '<div class="amr-slot empty">🧠 External: <span class="muted">⚪ 미연결 — "Connect AI: 외부 두뇌 연결" 명령으로 연결</span></div>';
    } else {
      slotBar = slotBadge('fast','🚀','Fast') + slotBadge('worker','🏗️','Worker') + slotBadge('external','🧠','External');
    }
    slotBar = '<div class="amr-slots" style="display:flex;gap:12px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px">' + slotBar + '</div>';
    /* slottag 인라인 스타일 */
  }
  const slotIcon = (aid) => { const sl = sa[aid]; return sl === 'fast' ? '🚀' : sl === 'external' ? '🧠' : '🏗️'; };
  const rows = agents.map(a => {
    const cur = map[a.id] || '';
    return '<div class="amr-row" data-agent="' + esc(a.id) + '">'
      + '<div class="amr-agent">'
      +   '<span class="amr-emoji">' + esc(a.emoji) + '</span>'
      +   '<span class="amr-name">' + esc(a.name) + '</span>'
      +   '<span class="amr-slottag" title="슬롯: ' + esc(sa[a.id]||'worker') + '">' + slotIcon(a.id) + '</span>'
      +   '<span class="amr-role">' + esc(a.role) + '</span>'
      + '</div>'
      + '<select class="amr-select" data-agent="' + esc(a.id) + '">' + modelOptions(cur) + '</select>'
      + '</div>';
  }).join('');
  const helpBlock = noModels
    ? '<div class="amr-empty">설치된 모델이 0개입니다.<br/><br/>터미널에서 한 번 실행:<br/><code>ollama pull qwen2.5:7b</code><br/>또는 LM Studio에서 모델 다운로드 후 모델 로드.</div>'
    : '<div class="amr-help">비워두면 기본 모델 사용. 작은 모델(3B)은 라우팅에, 큰 모델(32B+)은 분석·창작에 적합. 모델 전환 시 첫 호출이 2~5초 느려집니다.</div>';
  /* v2.89.36 — 시스템 사양 배너. 사용자 머신이 어떤 모델까지 안전한지 한 눈에. */
  let specsBlock = '';
  if (specs) {
    const memColor = specs.totalRamGB >= 32 ? 'ok' : (specs.totalRamGB >= 16 ? '' : 'warn');
    const tierHint = specs.safeModelBudgetGB >= 30 ? '대형 모델(32B+) 가능'
      : specs.safeModelBudgetGB >= 12 ? '중형 모델(7~14B) 적합'
      : specs.safeModelBudgetGB >= 5 ? '소형 모델(3~7B) 권장'
      : '초소형 모델(1~3B)만 안전';
    specsBlock = '<div class="amr-diag ' + memColor + '">'
      + '🖥️ <strong>내 머신 자동 감지</strong> · ' + esc(specs.summary)
      + '<br/>안전 모델 한도 <strong>~' + specs.safeModelBudgetGB + 'GB</strong> · ' + esc(tierHint)
      + (specs.isAppleSilicon ? ' · Apple Silicon은 통합 메모리라 더 효율적' : '')
      + '</div>';
  }
  bd.innerHTML = ''
    + '<div class="amr-modal">'
    +   '<button class="adm-close amr-close" type="button">×</button>'
    +   '<div class="amr-head">'
    +     '<div class="amr-title">모델 오케스트레이션</div>'
    +     '<div class="amr-sub">설치 모델 ' + installed.length + '개 감지 · 에이전트별 최적 LLM 자동 분배 · 추론 워크로드 분산</div>'
    +   '</div>'
    +   specsBlock
    +   helpBlock
    +   slotBar
    +   diagnosticBlock
    +   '<div class="amr-rows">' + rows + '</div>'
    +   '<div class="amr-actions">'
    +     '<button type="button" class="amr-trending" title="내 PC에 받아서 쓸 수 있는 로컬 LLM 목록 — HuggingFace 공개 데이터(다운로드 수·태그) 기반">로컬 LLM 카탈로그</button>'
    +     '<button type="button" class="amr-auto" title="시스템이 설치된 모델 + 에이전트 역할 분석해서 최적 매핑 자동 배정">자동 오케스트레이션</button>'
    +     '<button type="button" class="amr-save">저장</button>'
    +     '<button type="button" class="amr-cancel">취소</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(bd);
  _agentModelRoutingBackdrop = bd;
  function close(){ bd.style.opacity='0'; setTimeout(() => { bd.remove(); _agentModelRoutingBackdrop = null; }, 180); document.removeEventListener('keydown', escH); }
  function escH(e){ if(e.key==='Escape') close(); }
  document.addEventListener('keydown', escH);
  bd.querySelector('.amr-close').addEventListener('click', close);
  bd.querySelector('.amr-cancel').addEventListener('click', close);
  bd.addEventListener('click', e => { if(e.target === bd) close(); });
  bd.querySelector('.amr-save').addEventListener('click', () => {
    const newMap = {};
    bd.querySelectorAll('.amr-select').forEach(sel => {
      const aid = sel.getAttribute('data-agent');
      const v = sel.value || '';
      if(v) newMap[aid] = v;
    });
    const sb = bd.querySelector('.amr-save');
    sb.disabled = true; sb.textContent = '⏳ 저장 중...';
    vscode.postMessage({ type: 'saveAgentModelRouting', map: newMap });
    setTimeout(close, 600);
  });
  /* v2.89.27 — 자동 추천 버튼: 백엔드에서 매핑 받아서 드롭다운 갱신 */
  const autoBtn = bd.querySelector('.amr-auto');
  if(autoBtn){
    autoBtn.addEventListener('click', () => {
      autoBtn.disabled = true; autoBtn.textContent = '워크로드 분석 중...';
      vscode.postMessage({ type: 'autoOrchestrateModels' });
    });
  }
  /* v2.89.30 — 인기 모델 탐색: HuggingFace API 호출 */
  const trendingBtn = bd.querySelector('.amr-trending');
  if(trendingBtn){
    trendingBtn.addEventListener('click', () => {
      trendingBtn.disabled = true; trendingBtn.textContent = 'HuggingFace 조회 중...';
      vscode.postMessage({ type: 'fetchTrendingModels', limit: 25 });
    });
  }
}

/* v2.89.30 — 인기 모델 탐색 모달. HuggingFace 다운로드 순위로 텍스트 LLM
   리스트업. 각 항목엔 다운로드 수·태그·HF 링크 + Ollama pull 명령 복사 버튼. */
let _trendingModelsBackdrop = null;
function showTrendingModelsModal(models, error){
  if(_trendingModelsBackdrop) return;
  const bd = document.createElement('div');
  bd.className = 'adm-backdrop tmd-backdrop';
  bd.style.setProperty('--ag','#A78BFA');
  function fmtDownloads(n){
    if(!n) return '-';
    if(n >= 1_000_000) return (n/1_000_000).toFixed(1) + 'M';
    if(n >= 1_000) return (n/1_000).toFixed(1) + 'K';
    return String(n);
  }
  /* HuggingFace 모델 ID에서 Ollama pull용 추측 변환:
     "meta-llama/Llama-3.3-70B-Instruct" → 사용자한테 "ollama 라이브러리에서 검색" 안내 */
  function buildRows(){
    if(error) return '<div class="tmd-error">조회 실패: ' + esc(error) + '</div>';
    if(!models || models.length === 0) return '<div class="tmd-empty">결과 없음</div>';
    return models.map((m, i) => {
      const tagBadges = (m.tags || []).filter(t => /text-generation|llama|qwen|mistral|gemma|phi|coder|instruct|chat|gguf/i.test(t)).slice(0, 4)
        .map(t => '<span class="tmd-tag">' + esc(t) + '</span>').join('');
      const lastMod = m.lastModified ? new Date(m.lastModified).toISOString().slice(0, 10) : '';
      return '<div class="tmd-row">'
        + '<div class="tmd-rank">#' + (i+1) + '</div>'
        + '<div class="tmd-info">'
        +   '<div class="tmd-id">' + esc(m.id) + '</div>'
        +   '<div class="tmd-meta">'
        +     '⬇ ' + fmtDownloads(m.downloads) + ' · ♥ ' + fmtDownloads(m.likes)
        +     (lastMod ? ' · 수정 ' + esc(lastMod) : '')
        +   '</div>'
        +   (tagBadges ? '<div class="tmd-tags">' + tagBadges + '</div>' : '')
        + '</div>'
        + '<div class="tmd-actions">'
        +   '<a class="tmd-link" href="https://huggingface.co/' + esc(m.id) + '" target="_blank" rel="noopener">HF</a>'
        + '</div>'
        + '</div>';
    }).join('');
  }
  bd.innerHTML = ''
    + '<div class="tmd-modal">'
    +   '<button class="adm-close tmd-close" type="button">×</button>'
    +   '<div class="tmd-head">'
    +     '<div class="tmd-title">로컬 LLM 카탈로그</div>'
    +     '<div class="tmd-sub">내 PC에 받아서 오프라인으로 쓸 수 있는 텍스트 모델 — 다운로드 많은 순</div>'
    +   '</div>'
    +   '<div class="tmd-info-block">받는 법: <code>ollama.com/library</code>에서 모델 이름으로 검색 후 <code>ollama pull &lt;name&gt;</code>. HuggingFace ID와 Ollama 라이브러리 이름은 살짝 다를 수 있어요 (예: <code>meta-llama/Llama-3.3</code> → <code>llama3.3</code>).</div>'
    +   '<div class="tmd-list">' + buildRows() + '</div>'
    +   '<div class="tmd-actions-bottom">'
    +     '<button type="button" class="tmd-cancel">닫기</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(bd);
  _trendingModelsBackdrop = bd;
  function close(){ bd.style.opacity='0'; setTimeout(() => { bd.remove(); _trendingModelsBackdrop = null; }, 180); document.removeEventListener('keydown', escH); }
  function escH(e){ if(e.key==='Escape') close(); }
  document.addEventListener('keydown', escH);
  bd.querySelector('.tmd-close').addEventListener('click', close);
  bd.querySelector('.tmd-cancel').addEventListener('click', close);
  bd.addEventListener('click', e => { if(e.target === bd) close(); });
  /* 부모 모델 라우팅 모달의 "로컬 LLM 카탈로그" 버튼 복원 */
  const tb = document.querySelector('.amr-trending');
  if(tb){ tb.disabled = false; tb.textContent = '로컬 LLM 카탈로그'; }
}

/* v2.89.24 — 보고 스케줄 편집 모달. 시각·요일·액션을 행 단위로 추가/제거.
   저장 시 disk에 쓰여서 백엔드 분 단위 스케줄러가 자동 발동. */
let _reportScheduleBackdrop = null;
function showReportScheduleModal(entries){
  if(_reportScheduleBackdrop) return;
  const bd = document.createElement('div');
  bd.className = 'adm-backdrop rps-backdrop';
  bd.style.setProperty('--ag','#FBBF24');
  bd.style.setProperty('--ag-glow','rgba(251,191,36,.22)');
  /* state copy — 저장 누르기 전엔 disk에 안 씀 */
  const state = (entries || []).map(e => ({...e}));
  function dayBtns(selected){
    const labels = ['일','월','화','수','목','금','토'];
    return labels.map((lbl, idx) => '<button type="button" class="rps-day '+(selected.includes(idx)?'on':'')+'" data-day="'+idx+'">'+lbl+'</button>').join('');
  }
  function actionSelect(curAction, curTool, curAgentId){
    return '<select class="rps-action">'
      + '<option value="briefing"'+(curAction==='briefing'?' selected':'')+'>🌅 모닝 브리핑</option>'
      + '<option value="tool"'+(curAction==='tool'?' selected':'')+'>🛠 도구 실행</option>'
      + '</select>';
  }
  function toolSelect(curTool, curAgentId){
    /* 현재는 YouTube + Secretary만 — 사용자가 추가하면 자동으로 늘어남. */
    const tools = [
      { agentId: 'youtube', tool: 'my_videos_check', label: '📊 내 유튜브 채널 분석' },
      { agentId: 'youtube', tool: 'channel_full_analysis', label: '📈 채널 완전 분석' },
      { agentId: 'secretary', tool: 'google_calendar_write', label: '📅 캘린더 (오늘 일정 보기)' },
    ];
    return '<select class="rps-tool">'
      + '<option value="">— 선택 —</option>'
      + tools.map(t => {
          const v = t.agentId+'/'+t.tool;
          const cur = curAgentId+'/'+curTool;
          return '<option value="'+v+'"'+(v===cur?' selected':'')+'>'+t.label+'</option>';
        }).join('')
      + '</select>';
  }
  function rowHtml(e, idx){
    return '<div class="rps-row" data-idx="'+idx+'">'
      + '<input type="checkbox" class="rps-on"'+(e.enabled?' checked':'')+' />'
      + '<input class="rps-label" placeholder="라벨 (예: 모닝 브리핑)" value="'+esc(e.label||'')+'" />'
      + '<input class="rps-time" type="time" value="'+String(e.hour||0).padStart(2,'0')+':'+String(e.minute||0).padStart(2,'0')+'" />'
      + '<div class="rps-days">'+dayBtns(e.days||[1,2,3,4,5])+'</div>'
      + '<div class="rps-action-wrap">'+actionSelect(e.action||'briefing')+'</div>'
      + '<div class="rps-tool-wrap"'+(e.action==='tool'?'':' style="display:none"')+'>'+toolSelect(e.tool||'', e.agentId||'')+'</div>'
      + '<button type="button" class="rps-del" title="삭제">✕</button>'
      + '</div>';
  }
  function renderRows(){
    return state.map((e, i) => rowHtml(e, i)).join('') || '<div class="rps-empty">아직 등록된 보고 일정이 없어요. + 버튼으로 추가해주세요.</div>';
  }
  bd.innerHTML = ''
    + '<div class="rps-modal">'
    +   '<button class="adm-close rps-close" type="button">×</button>'
    +   '<div class="rps-head">'
    +     '<div class="rps-title">리포트 자동화</div>'
    +     '<div class="rps-sub">정해놓은 시각·요일에 시스템이 자동으로 리포트 발송 (텔레그램 + 사이드바)</div>'
    +   '</div>'
    +   '<div class="rps-rows" id="rpsRows">'+renderRows()+'</div>'
    +   '<button type="button" class="rps-add">+ 일정 추가</button>'
    +   '<div class="rps-actions">'
    +     '<button type="button" class="rps-save">저장</button>'
    +     '<button type="button" class="rps-cancel">취소</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(bd);
  _reportScheduleBackdrop = bd;
  function close(){
    bd.style.opacity='0';
    setTimeout(() => { bd.remove(); _reportScheduleBackdrop = null; }, 180);
    document.removeEventListener('keydown', escH);
  }
  function escH(e){ if(e.key==='Escape') close(); }
  document.addEventListener('keydown', escH);
  bd.querySelector('.rps-close').addEventListener('click', close);
  bd.querySelector('.rps-cancel').addEventListener('click', close);
  bd.addEventListener('click', e => { if(e.target === bd) close(); });
  function rerender(){ document.getElementById('rpsRows').innerHTML = renderRows(); attachRowHandlers(); }
  function attachRowHandlers(){
    bd.querySelectorAll('.rps-row').forEach(row => {
      const idx = parseInt(row.getAttribute('data-idx'),10);
      const e = state[idx];
      row.querySelector('.rps-on').addEventListener('change', ev => { e.enabled = ev.target.checked; });
      row.querySelector('.rps-label').addEventListener('input', ev => { e.label = ev.target.value; });
      row.querySelector('.rps-time').addEventListener('input', ev => {
        const [h, m] = (ev.target.value || '0:0').split(':').map(x => parseInt(x,10) || 0);
        e.hour = h; e.minute = m;
      });
      row.querySelectorAll('.rps-day').forEach(b => {
        b.addEventListener('click', () => {
          const d = parseInt(b.getAttribute('data-day'),10);
          if(!e.days) e.days = [];
          if(e.days.includes(d)) e.days = e.days.filter(x => x !== d);
          else e.days.push(d);
          b.classList.toggle('on');
        });
      });
      row.querySelector('.rps-action').addEventListener('change', ev => {
        e.action = ev.target.value;
        const wrap = row.querySelector('.rps-tool-wrap');
        if(wrap) wrap.style.display = e.action === 'tool' ? '' : 'none';
      });
      const toolSel = row.querySelector('.rps-tool');
      if(toolSel){
        toolSel.addEventListener('change', ev => {
          const v = ev.target.value;
          if(v){ const [a, t] = v.split('/'); e.agentId = a; e.tool = t; }
          else { e.agentId = ''; e.tool = ''; }
        });
      }
      row.querySelector('.rps-del').addEventListener('click', () => {
        state.splice(idx, 1);
        rerender();
      });
    });
  }
  attachRowHandlers();
  bd.querySelector('.rps-add').addEventListener('click', () => {
    const newId = 'sched-' + Date.now();
    state.push({
      id: newId, label: '새 일정', hour: 9, minute: 0, days: [1,2,3,4,5],
      action: 'briefing', enabled: true,
    });
    rerender();
  });
  bd.querySelector('.rps-save').addEventListener('click', () => {
    /* 빈 라벨/액션 검증 */
    const valid = state.filter(e => e.label && e.label.trim() && (e.action !== 'tool' || (e.tool && e.agentId)));
    vscode.postMessage({ type: 'saveReportSchedule', entries: valid });
    close();
  });
}

/* v2.89.103 — 채용 PIN 모달. 잠긴 에이전트(현재 루나) 카드 클릭 시 등장.
   힌트는 절대 노출 X — placeholder는 ••••, label은 "AUTHORIZATION CODE"만.
   4자리 입력 시 자동 검증, 정답이면 글리치 효과 + 환영 시퀀스 → 백엔드 영구 저장. */
let _hirePinBackdrop = null;
function openHirePinModal(a){
  if (_hirePinBackdrop) return;
  const bd = document.createElement('div');
  bd.className = 'hire-pin-backdrop';
  bd.style.setProperty('--ag', a.color || '#A78BFA');
  bd.style.setProperty('--ag-glow', (a.color||'#A78BFA')+'55');
  bd.innerHTML =
    '<div class="hire-pin-card">'+
      '<div class="hire-pin-eyebrow">▣ INCOMING TRANSMISSION</div>'+
      '<div class="hire-pin-portrait">'+
        (a.profileImageUri
          ? '<div class="hp-photo" style="background-image:url(\''+esc(a.profileImageUri)+'\')"></div>'
          : '<div class="hp-photo hp-emoji">'+esc(a.emoji||'❓')+'</div>'
        )+
        '<div class="hp-glitch"></div>'+
      '</div>'+
      '<div class="hire-pin-meta">'+
        '<div class="hp-row"><span class="hp-key">CANDIDATE</span><span class="hp-val">'+esc(a.emoji||'')+' '+esc(a.name||'???')+'</span></div>'+
        '<div class="hp-row"><span class="hp-key">ROLE</span><span class="hp-val">'+esc(a.role||'CLASSIFIED')+'</span></div>'+
        '<div class="hp-row"><span class="hp-key">STATUS</span><span class="hp-val hp-status">AWAITING CLEARANCE</span></div>'+
      '</div>'+
      '<div class="hire-pin-prompt">▓▓▓ AUTHORIZATION CODE ▓▓▓</div>'+
      '<div class="hire-pin-row">'+
        '<input class="hp-digit" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" />'+
        '<input class="hp-digit" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" />'+
        '<input class="hp-digit" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" />'+
        '<input class="hp-digit" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" />'+
      '</div>'+
      '<div class="hire-pin-status" id="hpStatus">SYSTEM IDLE</div>'+
      '<div class="hire-pin-actions">'+
        '<button class="hp-btn hp-cancel" id="hpCancel">CANCEL</button>'+
        '<button class="hp-btn hp-confirm" id="hpConfirm">AUTHORIZE →</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(bd);
  _hirePinBackdrop = bd;
  const digits = bd.querySelectorAll('.hp-digit');
  const status = bd.querySelector('#hpStatus');
  const close = () => { try { bd.remove(); } catch {} _hirePinBackdrop = null; };
  digits.forEach((d, i) => {
    d.addEventListener('input', (e) => {
      const v = (e.target.value || '').replace(/\D/g, '').slice(-1);
      e.target.value = v;
      if (v) {
        e.target.classList.add('filled');
        if (i < digits.length - 1) digits[i+1].focus();
        else verify();
      } else {
        e.target.classList.remove('filled');
      }
    });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && i > 0) {
        digits[i-1].focus();
        digits[i-1].value = '';
        digits[i-1].classList.remove('filled');
      } else if (e.key === 'Escape') {
        close();
      } else if (e.key === 'Enter') {
        verify();
      }
    });
  });
  function verify(){
    const code = Array.from(digits).map(d => d.value).join('');
    if (code.length < 4) {
      status.textContent = '⚠ 4자리 코드를 모두 입력하세요';
      status.className = 'hire-pin-status err';
      return;
    }
    /* PIN은 frontend에서 1차 검증, 백엔드에서 재검증. 여기선 즉각적 시각 피드백만. */
    if (code === '0000') {
      status.textContent = '✓ AUTHORIZATION GRANTED · ENROLLING…';
      status.className = 'hire-pin-status ok';
      digits.forEach(d => d.disabled = true);
      bd.querySelector('.hire-pin-card').classList.add('hp-success');
      try { vscode.postMessage({ type: 'hireAgent', agent: a.id, pin: code }); } catch {}
      setTimeout(close, 1400);
    } else {
      status.textContent = '⨯ ACCESS DENIED · INVALID CODE';
      status.className = 'hire-pin-status err';
      digits.forEach(d => { d.classList.add('error'); d.value = ''; d.classList.remove('filled'); });
      bd.querySelector('.hire-pin-card').classList.add('hp-shake');
      setTimeout(() => {
        digits.forEach(d => d.classList.remove('error'));
        bd.querySelector('.hire-pin-card').classList.remove('hp-shake');
        digits[0].focus();
        status.textContent = 'RETRY · 다시 시도';
        status.className = 'hire-pin-status';
      }, 700);
    }
  }
  bd.querySelector('#hpCancel').addEventListener('click', close);
  bd.querySelector('#hpConfirm').addEventListener('click', verify);
  bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
  setTimeout(() => digits[0].focus(), 80);
}

/* v2.89.107 — 활성화 confirm 모달. PIN 없는 가벼운 토글.
   Luna PIN 모달과 같은 비주얼 언어, 코드 입력만 빠진 형태.
   사용자: "활성화" 클릭 → backend setAgentActive 호출 → 카드 색깔 펄스. */
let _activateBackdrop = null;
function openActivateModal(a){
  if (_activateBackdrop) return;
  const bd = document.createElement('div');
  bd.className = 'activate-backdrop';
  bd.style.setProperty('--ag', a.color || '#00ff8b');
  bd.style.setProperty('--ag-glow', (a.color||'#00ff8b')+'55');
  bd.innerHTML =
    '<div class="activate-card">'+
      '<div class="activate-eyebrow">▣ ACTIVATE EMPLOYEE</div>'+
      '<div class="activate-portrait">'+
        (a.profileImageUri
          ? '<div class="ap-photo" style="background-image:url(\''+esc(a.profileImageUri)+'\')"></div>'
          : '<div class="ap-photo ap-emoji">'+esc(a.emoji||'🤖')+'</div>'
        )+
      '</div>'+
      '<div class="activate-name">'+esc(a.emoji||'')+' '+esc(a.name||'')+'</div>'+
      '<div class="activate-role">'+esc(a.role||'')+'</div>'+
      '<div class="activate-tagline">'+esc((a.tagline||a.specialty||'').slice(0,140))+'</div>'+
      '<div class="activate-meta">'+
        '<div class="am-row"><span class="am-key">STATUS</span><span class="am-val am-status">OFFLINE</span></div>'+
        '<div class="am-row"><span class="am-key">ROLE</span><span class="am-val">'+esc(a.role||'')+'</span></div>'+
      '</div>'+
      '<div class="activate-prompt">이 에이전트를 활성화하면 CEO가 작업 분배 시 호출할 수 있습니다.<br>언제든 직원 카드 다시 클릭해서 비활성화 가능.</div>'+
      '<div class="activate-actions">'+
        '<button class="ap-btn ap-cancel" id="apCancel">CANCEL</button>'+
        '<button class="ap-btn ap-confirm" id="apConfirm">ACTIVATE →</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(bd);
  _activateBackdrop = bd;
  const close = () => { try { bd.remove(); } catch{} _activateBackdrop = null; };
  bd.querySelector('#apCancel').addEventListener('click', close);
  bd.querySelector('#apConfirm').addEventListener('click', () => {
    /* 시각 펄스 후 backend 호출 */
    bd.querySelector('.activate-card').classList.add('ap-success');
    try { vscode.postMessage({ type:'setAgentActive', agent: a.id, active: true }); } catch {}
    setTimeout(close, 700);
  });
  bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
  /* ESC 닫기 */
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

function showAgentDetailModal(a){
  if(document.querySelector('.adm-backdrop'))return;
  const bd = document.createElement('div');
  bd.className = 'adm-backdrop';
  bd.style.setProperty('--ag', a.color || '#FBBF24');
  bd.style.setProperty('--ag-glow', (a.color||'#FBBF24')+'33');
  const hero = a.profileImageUri
    ? '<div class="adm-hero" style="background-image:url(\''+esc(a.profileImageUri)+'\')"></div>'
    : '<div class="adm-hero adm-hero-emoji"><div class="adm-hero-emoji-glyph">'+esc(a.emoji)+'</div></div>';
  const skillsActive = (a.skills||[]).filter(s => s.enabled && !s.locked).length;
  const stats = ''
    + '<div class="adm-stat"><div class="adm-stat-icon">📚</div><div class="adm-stat-num">'+(a.verifiedCount||0)+'</div></div>'
    + '<div class="adm-stat"><div class="adm-stat-icon">🛠</div><div class="adm-stat-num">'+skillsActive+'</div></div>'
    + '<div class="adm-stat"><div class="adm-stat-icon">⚡</div><div class="adm-stat-num">'+(a.openTasks||0)+'</div></div>';
  const skillTiles = (a.skills && a.skills.length > 0)
    ? a.skills.map((sk, idx) => {
        const stateCls = sk.locked ? 'locked' : (sk.enabled ? 'on' : 'off');
        const display = sk.label || sk.name;
        const tooltip = display + (sk.locked ? ' (설정 필요 — 클릭)' : ' (클릭해서 실행)');
        return '<button class="adm-skill '+stateCls+'" data-skill-idx="'+idx+'" title="'+esc(tooltip)+'" type="button">'
          + '<div class="adm-skill-emoji">'+esc(sk.emoji)+'</div>'
          + '<div class="adm-skill-name">'+esc(display)+'</div>'
          + '</button>';
      }).join('')
    : '<div class="adm-empty">아직 스킬이 없어요.</div>';
  /* Self-RAG 자가검증 상태 — 토글 버튼. 클릭하면 즉시 rag_mode.txt 갱신 →
     state 새로고침 후 모달 다시 열림. */
  const selfRagOn = a.ragMode === 'self-rag';
  const ragChip = ''
    + '<button class="adm-rag-chip '+(selfRagOn?'on':'off')+'" data-act="toggle-rag" title="'
    +   (selfRagOn ? '클릭해서 끄기 — 기본 Graph RAG로 복귀' : '클릭해서 켜기 — [근거: ...] 통과한 주장만 verified.md로 승격')
    + '"><span class="adm-rag-chip-dot"></span>🧠 자가검증 '
    +   (selfRagOn ? 'ON' : 'OFF')
    + '</button>';
  const ragCriteriaBlock = (selfRagOn && a.selfRagCriteria && a.selfRagCriteria.trim())
    ? '<div class="adm-rag-criteria">'+esc(a.selfRagCriteria.trim().slice(0, 280))+(a.selfRagCriteria.length > 280 ? '…' : '')+'</div>'
    : '';
  const activity = a.lastActivity
    ? '<div class="adm-activity">'+esc(a.lastActivity)+'</div>'
    : '<div class="adm-empty subtle">아직 활동 기록이 없어요.</div>';
  bd.innerHTML = ''
    + '<div class="adm-modal">'
    +   '<button class="adm-close" aria-label="닫기">×</button>'
    +   hero
    +   '<div class="adm-name">'+esc(a.name)+'</div>'
    +   '<div class="adm-role">'+esc(a.role||'')+'</div>'
    +   (a.tagline ? '<div class="adm-tagline">'+esc(a.tagline)+'</div>' : '')
    +   '<div class="adm-stats">'+stats+'</div>'
    +   '<div class="adm-rag-row">'+ragChip+'</div>'
    +   ragCriteriaBlock
    +   '<div class="adm-skills">'+skillTiles+'</div>'
    +   '<div class="adm-section-title-mini">최근</div>'
    +   activity
    +   '<div class="adm-footer">'
    +     '<button class="adm-btn-folder" data-act="folder">📁 폴더 열기</button>'
    +     ((a.togglable && !a.alwaysOn && a.active) ? '<button class="adm-btn-deactivate" data-act="deactivate">⏸ 비활성화</button>' : '')
    +   '</div>'
    + '</div>';
  document.body.appendChild(bd);
  function close(){
    bd.style.opacity='0';
    setTimeout(()=>bd.remove(),200);
    document.removeEventListener('keydown', escH);
  }
  function escH(e){ if(e.key==='Escape') close(); }
  bd.querySelector('.adm-close').addEventListener('click', close);
  bd.addEventListener('click', e => { if(e.target === bd) close(); });
  bd.querySelector('[data-act="folder"]').addEventListener('click', () => {
    vscode.postMessage({ type: 'openAgentFolder', agentId: a.id });
  });
  /* v2.89.107 — 비활성화 버튼 (OPTIONAL 에이전트만 노출) */
  const deactBtn = bd.querySelector('[data-act="deactivate"]');
  if (deactBtn) {
    deactBtn.addEventListener('click', () => {
      if (!confirm(`${a.name||a.id} 를 비활성화할까요?\n언제든 다시 활성화할 수 있습니다.`)) return;
      try { vscode.postMessage({ type:'setAgentActive', agent: a.id, active: false }); } catch {}
      close();
    });
  }
  /* v2.89.12 — 스킬 타일 클릭 시 그것만 보이는 상세 패널 + 즉시 실행 버튼 */
  bd.querySelectorAll('[data-skill-idx]').forEach(tile => {
    tile.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(tile.getAttribute('data-skill-idx') || '0', 10);
      const sk = (a.skills || [])[idx];
      if (!sk) return;
      showSkillDetail(a, sk);
    });
  });
  /* Self-RAG 토글 — 클릭 시 즉시 디스크 갱신 + 칩 시각 상태 즉시 반영
     (서버 응답 기다리지 않음). state refresh 오면 자연스럽게 다시 동기화됨. */
  const ragBtn = bd.querySelector('[data-act="toggle-rag"]');
  if(ragBtn){
    ragBtn.addEventListener('click', () => {
      const wasOn = ragBtn.classList.contains('on');
      const newMode = wasOn ? 'standard' : 'self-rag';
      /* Optimistic UI update */
      ragBtn.classList.toggle('on', !wasOn);
      ragBtn.classList.toggle('off', wasOn);
      ragBtn.innerHTML = '<span class="adm-rag-chip-dot"></span>🧠 자가검증 ' + (wasOn ? 'OFF' : 'ON');
      a.ragMode = newMode; /* sync local copy */
      vscode.postMessage({ type: 'setAgentRagMode', agentId: a.id, mode: newMode });
    });
  }
  document.addEventListener('keydown', escH);
}

window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'state') render(m);
  else if (m.type === 'toast') toast(m.text, m.err);
  else if (m.type === 'skillRunOutput') {
    /* v2.89.12 — 스킬 단독 실행 결과 라이브 표시 */
    const out = document.getElementById('admSkillOut');
    if(out){
      out.classList.remove('running');
      const status = m.ok ? '✅ 종료 코드 0' : ('❌ 종료 코드 ' + (m.exitCode!=null?m.exitCode:'?') + (m.timedOut?' (시간 초과)':''));
      out.textContent = (m.output||'') + '\n\n' + status;
    }
    const btn = document.querySelector('.adm-skill-detail-run');
    if(btn){ btn.disabled = false; btn.textContent = '▶ 다시 실행'; }
  }
  else if (m.type === 'reportScheduleData') {
    /* v2.89.24 — 보고 스케줄 모달 표시. 사용자가 시각·요일·액션 편집 후 저장. */
    showReportScheduleModal(m.entries || []);
  }
  else if (m.type === 'agentModelRoutingData') {
    /* v2.89.26 — 모델 라우팅 모달 표시 */
    showAgentModelRoutingModal(m);
  }
  else if (m.type === 'agentModelRoutingSaved') {
    const sb = document.querySelector('.amr-save');
    if(sb){ sb.disabled = false; sb.textContent = m.ok ? '저장됨' : '저장 실패'; setTimeout(() => { sb.textContent = '저장'; }, 1500); }
  }
  else if (m.type === 'agentModelRoutingAuto') {
    /* v2.89.27 — 자동 추천 결과를 드롭다운에 적용 */
    const map = m.map || {};
    document.querySelectorAll('.amr-select').forEach(sel => {
      const aid = sel.getAttribute('data-agent');
      if(aid && map[aid]){
        sel.value = map[aid];
        /* 드롭다운에 그 모델이 없으면 무시 (이미 선택된 게 그대로 유지) */
      }
    });
    const ab = document.querySelector('.amr-auto');
    if(ab){ ab.disabled = false; ab.textContent = '분배 완료 — 저장'; setTimeout(() => { ab.textContent = '자동 오케스트레이션'; }, 2500); }
  }
  else if (m.type === 'trendingModelsData') {
    /* v2.89.30 — HuggingFace 인기 모델 결과 모달 표시 */
    showTrendingModelsModal(m.models || [], m.error);
  }
  else if (m.type === 'skillConfigSaved') {
    /* v2.89.17 — 도구 설정 저장 결과: 저장 버튼 복원 + 폼 자동 닫음 */
    const sb = document.querySelector('.adm-skill-detail-form-save');
    if(sb){
      sb.disabled = false;
      sb.textContent = m.ok ? '✅ 저장됨' : '❌ 실패';
      setTimeout(() => { sb.textContent = '💾 저장'; }, 1500);
    }
    if(m.ok){
      const form = document.getElementById('admSkillForm');
      if(form) setTimeout(() => { form.style.display = 'none'; }, 800);
    }
  }
});
vscode.postMessage({ type: 'refresh' });
/* ───────── v2.89.142 — Revenue Card (회사 대시보드의 매출 위젯) ───────── */
(function setupRevenueCard() {
  const openBtn = document.getElementById('openRevDashBtn');
  const askBtn  = document.getElementById('askHyunbinBtn');
  if (openBtn) openBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'openRevenueDashboard' });
  });
  if (askBtn) askBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'askHyunbinRevenue' });
  });
  /* 데이터 요청 — extension 이 paypal_revenue.py 호출해서 미니 KPI + sparkline 회신 */
  vscode.postMessage({ type: 'requestRevenueMini' });
})();

function _fmtRevAmount(v, cur) {
  if (v == null) return '—';
  const n = Number(v);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function _animateNum(el, target, opts = {}) {
  if (!el) return;
  const dur = opts.duration || 900;
  const dec = opts.decimals != null ? opts.decimals : 0;
  const startVal = parseFloat(el.dataset.last || '0') || 0;
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = startVal + (target - startVal) * eased;
    if (opts.formatter) el.textContent = opts.formatter(v);
    else el.textContent = v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (p < 1) requestAnimationFrame(tick);
    else el.dataset.last = String(target);
  }
  requestAnimationFrame(tick);
}

function _renderRevMiniSpark(byDay, primaryCur) {
  const svg = document.getElementById('revSparkSvg');
  if (!svg) return;
  const days = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const day = byDay[key];
    const v = day && day[primaryCur] ? day[primaryCur].gross : 0;
    days.push(v);
  }
  const maxV = Math.max(...days, 1);
  const W = 280, H = 60, padT = 4, padB = 4;
  const innerH = H - padT - padB;
  const xOf = (i) => (i / (days.length - 1)) * W;
  const yOf = (v) => padT + innerH - (v / maxV) * innerH;
  const pts = days.map((v, i) => xOf(i).toFixed(1) + ',' + yOf(v).toFixed(1)).join(' ');
  const areaPts = '0,' + (padT + innerH) + ' ' + pts + ' ' + W + ',' + (padT + innerH);
  const peakIdx = days.reduce((acc, v, i) => v > days[acc] ? i : acc, 0);
  const peakDot = days[peakIdx] > 0
    ? '<circle class="peak" cx="' + xOf(peakIdx).toFixed(1) + '" cy="' + yOf(days[peakIdx]).toFixed(1) + '" r="3.5"></circle>'
    : '';
  svg.innerHTML =
    '<defs><linearGradient id="revSparkGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#22d3ee" stop-opacity="0.4"/>' +
    '<stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>' +
    '<polygon class="area" points="' + areaPts + '"></polygon>' +
    '<polyline class="line" points="' + pts + '"></polyline>' + peakDot;
}

function _renderRevenueMini(data) {
  const card = document.getElementById('revenueCard');
  if (!card) return;
  if (data?.error) {
    document.getElementById('revSubtitle').textContent = '⚠️ ' + (data.error || '연결 확인 필요');
    return;
  }
  if (!data || !data.totals) {
    document.getElementById('revSubtitle').textContent = '💡 외부 연결 패널에서 PayPal Client ID/Secret 입력 → 즉시 분석';
    return;
  }
  const totals = data.totals;
  const period = totals.by_period || {};
  const byCur = totals.by_currency || {};
  const primaryCur = Object.entries(byCur).sort((a,b) => (b[1].gross||0)-(a[1].gross||0))[0]?.[0] || 'USD';
  const cur = byCur[primaryCur] || { gross: 0, count: 0 };

  /* skeleton 제거 */
  card.querySelectorAll('.rev-skeleton').forEach(el => el.classList.remove('rev-skeleton'));
  document.getElementById('revSubtitle').textContent =
    primaryCur + ' 매출 실시간 분석 · ' + cur.count + '건 거래 · 클릭 → 풀스크린';

  _animateNum(document.getElementById('revMonth'), period.month || 0, {
    formatter: (v) => primaryCur === 'USD' ? '$' + _fmtRevAmount(v) : _fmtRevAmount(v) + ' ' + primaryCur
  });
  _animateNum(document.getElementById('revWeek'), period.week || 0, {
    formatter: (v) => primaryCur === 'USD' ? '$' + _fmtRevAmount(v) : _fmtRevAmount(v) + ' ' + primaryCur
  });
  _animateNum(document.getElementById('revCount'), cur.count || 0, { decimals: 0 });

  _renderRevMiniSpark(data.by_day || {}, primaryCur);
}

window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'revenueMini') _renderRevenueMini(m.data);
});
