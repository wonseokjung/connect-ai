// 🧠 두뇌 — 캔버스 3D 뉴럴 네트워크. 뇌 모양(주름·좌우반구) + 신경 신호 펄스.
//   평소: 천천히 회전. 말할 때(energy↑): 신호 폭증 + 발광 + 출렁.
type P = { x: number; y: number; z: number; nb: number[] };

export class BrainViz {
  private ctx: CanvasRenderingContext2D;
  private pts: P[] = [];
  private edges: [number, number][] = [];
  private pulses: { a: number; b: number; t: number; sp: number }[] = [];
  private w = 0; private h = 0; private dpr = 1;
  private rot = 0; private tilt = 0; private t = 0;
  private energy = 0; private target = 0;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement, private N = 620) {
    this.ctx = canvas.getContext('2d')!;
    this.build();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // 레이아웃 변경(사이드바 토글 등)으로 캔버스 크기가 바뀔 때도 리사이즈 — 안 그러면 찌그러짐
    try { new ResizeObserver(() => this.resize()).observe(this.canvas); } catch { /* */ }
  }
  setEnergy(v: number) { this.target = Math.max(0, Math.min(1, v)); }
  start() { if (!this.raf) this.loop(); }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  private build() {
    const N = this.N, gold = Math.PI * (3 - Math.sqrt(5)), pts: P[] = [];
    for (let i = 0; i < N; i++) {
      const y0 = 1 - (i / (N - 1)) * 2, r0 = Math.sqrt(1 - y0 * y0), th = gold * i;
      let ux = Math.cos(th) * r0, uy = y0, uz = Math.sin(th) * r0;
      // 🧠 주름(gyri/sulci) — 표면을 울퉁불퉁하게
      const fold = 1 + 0.075 * Math.sin(uy * Math.PI * 5) * Math.sin(Math.atan2(uz, ux) * 4) + 0.05 * Math.sin(ux * 7 + uz * 3) + 0.03 * Math.sin(uy * 11);
      let x = ux * fold, y = uy * fold, z = uz * fold;
      // 뇌 비율: 가로로 넓고 약간 납작
      x *= 1.24; y *= 0.8; z *= 1.04;
      // 좌우 반구 사이 틈(대뇌 종렬)
      x += Math.sign(x || 1) * 0.08;
      pts.push({ x, y, z, nb: [] });
    }
    // 시냅스(가까운 이웃 연결)
    const edges: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const d: { j: number; v: number }[] = [];
      for (let j = 0; j < pts.length; j++) { if (i === j) continue; const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z; d.push({ j, v: dx * dx + dy * dy + dz * dz }); }
      d.sort((a, b) => a.v - b.v);
      pts[i].nb = d.slice(0, 3).map(x => x.j);
      for (const j of pts[i].nb) if (j > i) edges.push([i, j]);
    }
    this.pts = pts; this.edges = edges;
  }
  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.floor(this.w * this.dpr); this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.t += 0.016;
    this.energy += (this.target - this.energy) * 0.06;
    this.rot += 0.0013 + this.energy * 0.0007;  // 말해도 회전 거의 일정 (차분)
    this.tilt = -0.12 + Math.sin(this.t * 0.22) * 0.1;

    const ctx = this.ctx, cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w * 0.62, this.h * 0.92) * 0.5;
    const breathe = 1 + Math.sin(this.t * 1.5) * 0.012 + this.energy * 0.05;
    const cosR = Math.cos(this.rot), sinR = Math.sin(this.rot), cosT = Math.cos(this.tilt), sinT = Math.sin(this.tilt);
    const proj = this.pts.map(p => {
      let x = p.x * cosR - p.z * sinR; let z = p.x * sinR + p.z * cosR;
      const y = p.y * cosT - z * sinT; z = p.y * sinT + z * cosT;
      const persp = 1.7 / (2.0 - z);
      return { sx: cx + x * R * persp * breathe, sy: cy + y * R * persp * breathe, z, persp };
    });

    ctx.clearRect(0, 0, this.w, this.h);
    // 외곽 아우라
    const aura = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.5);
    aura.addColorStop(0, `rgba(0,255,140,${0.05 + this.energy * 0.13})`);
    aura.addColorStop(0.6, `rgba(0,120,255,${0.02 + this.energy * 0.05})`);
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura; ctx.fillRect(0, 0, this.w, this.h);

    // 시냅스(선) — 뒤→앞 순서로
    const order = proj.map((p, i) => i).sort((a, b) => proj[a].z - proj[b].z);
    for (const [i, j] of this.edges) {
      const a = proj[i], b = proj[j], depth = (a.z + b.z) / 2, front = (depth + 1) / 2;
      const glow = this.energy * (0.7 + 0.3 * Math.sin(this.t * 1.8 + i * 0.2)); // 부드러운 글로우
      const alpha = (0.035 + front * 0.1 + glow * 0.16) * (0.35 + front);
      // 앞=초록, 뒤=파랑 (깊이감)
      ctx.strokeStyle = `rgba(${30 + glow * 80},${185 + front * 70},${200 - front * 80},${alpha})`;
      ctx.lineWidth = 0.45 + front * 0.65 + this.energy * 0.3;
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }

    // ⚡ 신경 신호 펄스 — 시냅스를 타고 흐르는 빛 (차분하게)
    const spawn = 0.05 + this.energy * 0.3;
    if (this.edges.length && Math.random() < spawn) {
      const e = this.edges[(Math.random() * this.edges.length) | 0];
      this.pulses.push({ a: e[0], b: e[1], t: 0, sp: 0.012 + Math.random() * 0.014 + this.energy * 0.008 });
    }
    for (let k = this.pulses.length - 1; k >= 0; k--) {
      const pu = this.pulses[k]; pu.t += pu.sp;
      if (pu.t >= 1) { this.pulses.splice(k, 1); continue; }
      const a = proj[pu.a], b = proj[pu.b], px = a.sx + (b.sx - a.sx) * pu.t, py = a.sy + (b.sy - a.sy) * pu.t;
      ctx.fillStyle = `rgba(180,255,210,${0.9 * (1 - pu.t)})`;
      ctx.shadowColor = '#5dffb0'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (this.pulses.length > 140) this.pulses.splice(0, this.pulses.length - 140);

    // 노드 — 앞쪽이 크고 밝게
    for (const i of order) {
      const p = proj[i], front = (p.z + 1) / 2;
      const fire = this.energy * Math.max(0, Math.sin(this.t * 2.6 + i * 0.5));
      const rad = (0.3 + front * 0.8) * (1 + fire * 0.5);
      const bright = 0.25 + front * 0.55 + fire * 0.4;
      ctx.fillStyle = `rgba(${110 + fire * 145},255,${180 - front * 40},${bright})`;
      ctx.shadowColor = '#00ff99'; ctx.shadowBlur = 2 + front * 3 + fire * 6;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  };
}
