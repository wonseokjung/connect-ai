// 🟩 매트릭스 디지털 레인 — 전체 배경 캔버스.
// 떨어지는 글리프(카타카나+숫자+라틴), 선두 글자는 밝은 흰녹색 + 글로우, 꼬리는 페이드.
// 음성 레벨(0..1)을 주면 레인이 살짝 가속/발광한다.

const GLYPHS = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズヅブプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン0123456789:.=*+-<>¦|╌ｱｲｳｴｵｶｷｸｹｺ'.split('');

export class MatrixRain {
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  private fontSize = 16;
  private cols = 0;
  private drops: number[] = [];
  private speed: number[] = [];
  private raf = 0;
  private level = 0;
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  start() { if (!this.raf) this.loop(); }
  setLevel(v: number) { this.level = Math.max(0, Math.min(1, v)); }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.fontSize = this.w < 600 ? 13 : 16;
    this.cols = Math.ceil(this.w / this.fontSize);
    this.drops = new Array(this.cols).fill(0).map(() => Math.random() * -40);
    this.speed = new Array(this.cols).fill(0).map(() => 0.5 + Math.random() * 0.9);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.frame++;
    const ctx = this.ctx;

    // 잔상 페이드 (검정 반투명 덮기)
    ctx.fillStyle = 'rgba(2, 6, 4, 0.085)';
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.font = `${this.fontSize}px "SFMono-Regular", Menlo, Consolas, monospace`;
    const boost = 1 + this.level * 1.6;

    for (let i = 0; i < this.cols; i++) {
      const x = i * this.fontSize;
      const y = this.drops[i] * this.fontSize;
      const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];

      // 선두 글자 — 밝은 흰녹색 + 글로우
      if (y > 0) {
        ctx.fillStyle = `rgba(190,255,200,${0.85})`;
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 8 + this.level * 10;
        ctx.fillText(ch, x, y);
        ctx.shadowBlur = 0;

        // 꼬리 한 칸 — 형광 그린
        const ch2 = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        ctx.fillStyle = 'rgba(0, 230, 80, 0.55)';
        ctx.fillText(ch2, x, y - this.fontSize);
      }

      // 낙하
      this.drops[i] += this.speed[i] * boost;
      if (y > this.h && Math.random() > 0.975) this.drops[i] = Math.random() * -20;
    }
  };
}
