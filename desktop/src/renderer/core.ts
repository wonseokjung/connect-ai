// 🌀 JARVIS 코어 — 캔버스 기반 시네마틱 AI 비주얼라이저.
// 회전 HUD 링 + 발광 코어 + 오디오 반응 방사형 파형 + 궤도 파티클.
// 상태별 색/모션 전환. 마이크 analyser 를 붙이면 실제 음성에 반응.

export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Palette { a: string; b: string; glow: string; }
// 매트릭스 컨셉 — 형광 그린 팔레트
const PALETTES: Record<CoreState, Palette> = {
  idle:      { a: '#00d24a', b: '#04772f', glow: 'rgba(0,210,74,0.5)' },
  listening: { a: '#39ff14', b: '#00b341', glow: 'rgba(57,255,20,0.65)' },
  thinking:  { a: '#00ffa3', b: '#06a85a', glow: 'rgba(0,255,163,0.6)' },
  speaking:  { a: '#7dff5e', b: '#16c33a', glow: 'rgba(125,255,94,0.7)' },
};

interface Particle { ang: number; rad: number; spd: number; size: number; }

export class JarvisCore {
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  private t = 0;
  private state: CoreState = 'idle';
  private pal = PALETTES.idle;
  private palTarget = PALETTES.idle;
  private level = 0;          // 현재 오디오 레벨 0..1 (스무딩됨)
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array | null = null;
  private particles: Particle[] = [];
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 56; i++) {
      this.particles.push({ ang: Math.random() * Math.PI * 2, rad: 0.7 + Math.random() * 0.9, spd: (Math.random() * 0.4 + 0.2) * (Math.random() < 0.5 ? 1 : -1), size: Math.random() * 1.8 + 0.6 });
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  start() { if (!this.raf) this.loop(); }
  setState(s: CoreState) { this.state = s; this.palTarget = PALETTES[s]; }
  getLevel() { return this.level; }

  attachAnalyser(a: AnalyserNode) { this.analyser = a; this.freq = new Uint8Array(a.frequencyBinCount); }
  detachAnalyser() { this.analyser = null; this.freq = null; }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private sampleLevel() {
    let target = 0;
    if (this.analyser && this.freq) {
      this.analyser.getByteFrequencyData(this.freq as any);
      let sum = 0; for (let i = 0; i < this.freq.length; i++) sum += this.freq[i];
      target = Math.min(1, (sum / this.freq.length) / 130);
    } else if (this.state === 'speaking') {
      target = 0.35 + Math.abs(Math.sin(this.t * 6)) * 0.4;        // TTS 출력 직접 못 받아 합성 펄스
    } else if (this.state === 'thinking') {
      target = 0.25 + Math.abs(Math.sin(this.t * 3)) * 0.15;
    } else {
      target = 0.12 + Math.abs(Math.sin(this.t * 1.3)) * 0.06;     // idle 호흡
    }
    this.level += (target - this.level) * 0.18;
  }

  private lerpColor(c1: string, c2: string, k: number) {
    const p = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const [r1, g1, b1] = p(c1), [r2, g2, b2] = p(c2);
    const r = Math.round(r1 + (r2 - r1) * k), g = Math.round(g1 + (g2 - g1) * k), b = Math.round(b1 + (b2 - b1) * k);
    return `rgb(${r},${g},${b})`;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.t += 0.016;
    this.sampleLevel();

    // 팔레트 부드러운 전환
    const k = 0.06;
    this.pal = {
      a: this.lerpColor(rgbToHex(this.pal.a), this.palTarget.a, k),
      b: this.lerpColor(rgbToHex(this.pal.b), this.palTarget.b, k),
      glow: this.palTarget.glow,
    };

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const cx = this.w / 2, cy = this.h / 2;
    const base = Math.min(this.w, this.h) * 0.5;
    const R = base * 0.34;                          // 코어 반경 기준
    const lvl = this.level;

    // 0) 배경 더스트
    ctx.save();
    for (const p of this.particles) {
      p.ang += p.spd * 0.004;
      const rr = base * p.rad;
      const x = cx + Math.cos(p.ang) * rr, y = cy + Math.sin(p.ang * 1.02) * rr * 0.5;
      ctx.globalAlpha = 0.18 + 0.3 * (1 - p.rad / 1.6);
      ctx.fillStyle = this.pal.a;
      ctx.beginPath(); ctx.arc(x, y, Math.max(0, p.size), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // 1) 외곽 HUD 틱 링 (느린 회전)
    this.ring(cx, cy, R * 2.05, this.t * 0.12, 72, R * 0.05, this.pal.b, 0.5, true);
    // 2) 분절 아크 (반대 회전)
    this.arcs(cx, cy, R * 1.7, -this.t * 0.35, [0.0, 0.18, 0.4, 0.55, 0.78, 0.9], 0.12, this.pal.a, 2.2);
    // 3) 중간 회전 링
    this.ring(cx, cy, R * 1.45, this.t * 0.5, 3, R * 0.03, this.pal.a, 0.9, false);

    // 4) 오디오 반응 방사형 파형
    if ((this.state === 'listening' || this.state === 'speaking') && (this.analyser || this.state === 'speaking')) {
      const N = 96;
      ctx.save();
      ctx.translate(cx, cy);
      for (let i = 0; i < N; i++) {
        let amp = lvl;
        if (this.freq) amp = (this.freq[Math.floor(i / N * this.freq.length)] / 255);
        const len = R * (0.18 + amp * 0.9);
        const ang = (i / N) * Math.PI * 2 + this.t * 0.2;
        const r0 = R * 1.12;
        const x0 = Math.cos(ang) * r0, y0 = Math.sin(ang) * r0;
        const x1 = Math.cos(ang) * (r0 + len), y1 = Math.sin(ang) * (r0 + len);
        ctx.strokeStyle = this.lerpColor(this.pal.a, this.pal.b, amp);
        ctx.globalAlpha = 0.35 + amp * 0.6;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.restore();
    }

    // 5) 코어 글로우 + 구체
    const coreR = R * (0.62 + lvl * 0.5);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
    glow.addColorStop(0, this.pal.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, coreR * 2.4, 0, Math.PI * 2); ctx.fill();

    const g = ctx.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.3, coreR * 0.1, cx, cy, coreR);
    g.addColorStop(0, '#d8ffe2');
    g.addColorStop(0.35, this.pal.a);
    g.addColorStop(1, this.pal.b);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();

    // 6) 코어 내부 회전 아이리스
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(this.t * 0.6);
    ctx.globalAlpha = 0.5; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath(); ctx.moveTo(coreR * 0.2, 0); ctx.lineTo(coreR * 0.72, 0); ctx.stroke();
    }
    ctx.restore();
  };

  private ring(cx: number, cy: number, r: number, rot: number, ticks: number, tickLen: number, color: string, alpha: number, dashed: boolean) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    if (ticks > 0) {
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2;
        if (dashed && i % 2) continue;
        const x0 = Math.cos(a) * r, y0 = Math.sin(a) * r;
        const x1 = Math.cos(a) * (r + tickLen), y1 = Math.sin(a) * (r + tickLen);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
    ctx.restore();
  }

  private arcs(cx: number, cy: number, r: number, rot: number, starts: number[], len: number, color: string, lw: number) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.globalAlpha = 0.8; ctx.lineCap = 'round';
    for (const s of starts) {
      const a0 = s * Math.PI * 2, a1 = a0 + len * Math.PI * 2;
      ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
    }
    ctx.restore();
  }
}

// 내부 lerp 이 rgb() 문자열을 다시 받을 수 있게 hex 변환 보조
function rgbToHex(c: string): string {
  if (c.startsWith('#')) return c;
  const m = c.match(/\d+/g); if (!m) return '#00d24a';
  const h = (n: string) => (+n).toString(16).padStart(2, '0');
  return `#${h(m[0])}${h(m[1])}${h(m[2])}`;
}
