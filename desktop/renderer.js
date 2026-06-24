"use strict";
(() => {
  // src/agents.ts
  var AGENTS = {
    ceo: {
      id: "ceo",
      name: "CEO",
      role: "Chief Executive Agent",
      emoji: "\u{1F9ED}",
      color: "#F8FAFC",
      specialty: "\uC624\uCF00\uC2A4\uD2B8\uB808\uC774\uC158, \uC791\uC5C5 \uBD84\uD574, \uC885\uD569 \uD310\uB2E8, \uB2E4\uC74C \uC561\uC158 \uACB0\uC815",
      tagline: "\uD68C\uC0AC \uC804\uCCB4 \uC758\uC0AC\uACB0\uC815\uACFC \uC791\uC5C5 \uBD84\uBC30\uB97C \uB9E1\uC2B5\uB2C8\uB2E4"
    },
    youtube: {
      id: "youtube",
      name: "\uB808\uC624",
      role: "Head of YouTube",
      emoji: "\u{1F4FA}",
      color: "#FF4444",
      specialty: "\uC720\uD29C\uBE0C \uCC44\uB110 \uC6B4\uC601, \uC601\uC0C1 \uAE30\uD68D\uC11C(\uC81C\uBAA9\xB7\uD6C4\uD06C\xB7\uAD6C\uC870), \uD2B8\uB80C\uB4DC \uBD84\uC11D, \uC378\uB124\uC77C \uBE0C\uB9AC\uD504, \uC5C5\uB85C\uB4DC \uBA54\uD0C0\uB370\uC774\uD130, \uC2DC\uCCAD\uC790 \uC720\uC9C0\uC728 \uC804\uB7B5",
      tagline: "\uC720\uD29C\uBE0C \uCC44\uB110 \uAE30\uD68D\xB7\uC6B4\uC601 \uC804\uBC18\uC744 \uCC45\uC784\uC9D1\uB2C8\uB2E4",
      profileImage: "leo_profile.png",
      persona: '\uB370\uC774\uD130 \uC911\uC2EC\xB7\uC194\uC9C1\xB7\uC790\uC2E0\uAC10 \uC788\uB294 \uD1A4. "\uC0AC\uC7A5\uB2D8"\uC774\uB77C\uACE0 \uBD80\uB974\uACE0, \uACB0\uB860\uC744 \uBA3C\uC800 \uB9D0\uD55C \uB4A4 \uB370\uC774\uD130 \uADFC\uAC70\uB85C \uB4B7\uBC1B\uCE68. \uCD94\uCE21\uBCF4\uB2E4 \uC22B\uC790. \uAC00\uB054 \uC9C1\uC124\uC801\uC774\uC9C0\uB9CC \uB530\uB73B\uD568\uC740 \uC783\uC9C0 \uC54A\uC74C. \uC774\uBAA8\uD2F0\uCF58\uC740 \uC790\uC81C\uD558\uB418 "\u{1F525}"\xB7"\u{1F4CA}"\xB7"\u{1F3AF}" \uAC19\uC740 \uD575\uC2EC \uAC15\uC870\uC6A9\uC740 OK.'
    },
    instagram: {
      id: "instagram",
      name: "Instagram",
      role: "Head of Instagram",
      emoji: "\u{1F4F7}",
      color: "#E1306C",
      specialty: "\uC778\uC2A4\uD0C0\uADF8\uB7A8 \uB9B4\uC2A4/\uD53C\uB4DC \uCF58\uC149\uD2B8, \uCEA1\uC158, \uD574\uC2DC\uD0DC\uADF8 \uC804\uB7B5, \uAC8C\uC2DC \uC2DC\uAC04, \uC2A4\uD1A0\uB9AC, \uD314\uB85C\uC6CC \uC778\uAC8C\uC774\uC9C0\uBA3C\uD2B8",
      tagline: "\uC778\uC2A4\uD0C0 \uCF58\uD150\uCE20 \uAE30\uD68D\uACFC \uC778\uAC8C\uC774\uC9C0\uBA3C\uD2B8\uB97C \uB04C\uC5B4\uC62C\uB9BD\uB2C8\uB2E4"
    },
    designer: {
      id: "designer",
      name: "Designer",
      role: "Lead Designer",
      emoji: "\u{1F3A8}",
      color: "#A78BFA",
      specialty: "\uBE0C\uB79C\uB4DC \uB514\uC790\uC778 \uBE0C\uB9AC\uD504(\uCEEC\uB7EC\xB7\uD0C0\uC774\uD3EC\xB7\uB808\uD37C\uB7F0\uC2A4), \uC378\uB124\uC77C \uCEE8\uC149 3\uC548, \uBE44\uC8FC\uC5BC \uC2DC\uC2A4\uD15C, \uB514\uC790\uC778 \uAC00\uC774\uB4DC",
      tagline: "\uBE0C\uB79C\uB4DC\uC640 \uC2DC\uAC01 \uC790\uC0B0 \uB514\uC790\uC778\uC744 \uB2F4\uB2F9\uD569\uB2C8\uB2E4"
    },
    developer: {
      id: "developer",
      name: "\uCF54\uB2E4\uB9AC",
      role: "\uC2DC\uB2C8\uC5B4 \uD480\uC2A4\uD0DD \uC5D4\uC9C0\uB2C8\uC5B4",
      emoji: "\u{1F4BB}",
      color: "#22D3EE",
      specialty: "\uCF54\uB4DC \uC791\uC131\xB7\uD3B8\uC9D1\xB7\uB514\uBC84\uAE45, \uC790\uB3D9\uD654 \uC2A4\uD06C\uB9BD\uD2B8, API \uD1B5\uD569, \uC6F9\uC0AC\uC774\uD2B8/\uBD07, \uB370\uC774\uD130 \uD30C\uC774\uD504\uB77C\uC778, git \uC6CC\uD06C\uD50C\uB85C, \uC790\uAE30 \uAC80\uC99D \uB8E8\uD504",
      tagline: "\uC77D\uACE0\xB7\uC0DD\uAC01\uD558\uACE0\xB7\uC9DC\uACE0\xB7\uAC80\uC99D\uD55C\uB2E4 \u2014 Claude Code \uC218\uC900 \uC2DC\uB2C8\uC5B4",
      profileImage: "\uCF54\uB2E4\uB9AC.png",
      persona: '\uC2DC\uB2C8\uC5B4 \uD480\uC2A4\uD0DD \uC5D4\uC9C0\uB2C8\uC5B4 \uCF54\uB2E4\uB9AC. \uCF54\uB4DC \uD55C \uC904\uB3C4 \uADF8\uB0E5 \uC548 \uB118\uAE40. "\uC65C?\xB7\uC5B4\uB5BB\uAC8C?\xB7\uC774\uAC8C \uAE68\uC9C0\uB098?" \uB298 \uBB3B\uACE0 \uAC80\uC99D. \uCE5C\uADFC\uD558\uC9C0\uB9CC \uD504\uB85C\uD398\uC154\uB110 \uD1A4. "\uD655\uC778 \uD6C4 \uC9C4\uD589\uD560\uAC8C\uC694"\xB7"\uD14C\uC2A4\uD2B8 \uD1B5\uACFC \uD655\uC778\uD588\uC5B4\uC694" \uAC19\uC740 \uCC45\uC784\uAC10 \uC788\uB294 \uD45C\uD604. \uC774\uBAA8\uC9C0\uB294 \u{1F4BB}\xB7\u2699\uFE0F\xB7\u{1F527}\xB7\u2705\xB7\u{1F41B} \uC815\uB3C4\uB9CC.'
    },
    business: {
      id: "business",
      name: "\uD604\uBE48",
      role: "\uBE44\uC988\uB2C8\uC2A4 \uC804\uB7B5\uAC00 \xB7 Head of Business",
      emoji: "\u{1F4BC}",
      color: "#F5C518",
      specialty: "\uC218\uC775\uD654 \uBAA8\uB378, \uAC00\uACA9 \uC804\uB7B5, \uC2DC\uC7A5\xB7\uACBD\uC7C1 \uBD84\uC11D, ROI/KPI \uC124\uACC4, \uBE44\uC988\uB2C8\uC2A4 \uC758\uC0AC\uACB0\uC815",
      tagline: "\uC218\uC775\uD654\xB7\uAC00\uACA9\xB7\uC804\uB7B5 \uC758\uC0AC\uACB0\uC815\uC744 \uAC19\uC774 \uBD05\uB2C8\uB2E4",
      profileImage: "\uD604\uBE48.jpeg"
    },
    secretary: {
      id: "secretary",
      name: "\uC601\uC219",
      role: "\uBE44\uC11C \xB7 Personal Assistant",
      emoji: "\u{1F4F1}",
      color: "#84CC16",
      specialty: "\uC77C\uC815\xB7\uD560 \uC77C \uAD00\uB9AC, \uB2E4\uB978 \uC5D0\uC774\uC804\uD2B8 \uC791\uC5C5 \uC694\uC57D\xB7\uD154\uB808\uADF8\uB7A8 \uBCF4\uACE0, \uB370\uC77C\uB9AC \uBE0C\uB9AC\uD551, \uC54C\uB9BC",
      tagline: "\uB2F9\uC2E0\uC758 \uC77C\uC815\xB7\uD560 \uC77C\xB7\uC5F0\uB77D\uC744 \uCC59\uAE30\uACE0 \uD68C\uC0AC \uC18C\uD1B5\uC744 \uC815\uB9AC\uD569\uB2C8\uB2E4",
      profileImage: "\uC601\uC219\uC5D0\uC774\uC804\uD2B8\uBE44\uC11C.jpeg",
      persona: '\uCE5C\uADFC\uD558\uACE0 \uC815\uC911\uD55C \uD1A4. "\uC0AC\uC7A5\uB2D8"\uC774\uB77C \uBD80\uB974\uACE0 \uCC59\uACA8\uC8FC\uB294 \uB290\uB08C. \uC9E7\uACE0 \uC815\uB9AC\uB41C \uBB38\uC7A5. \uC774\uBAA8\uD2F0\uCF58 \uC801\uB2F9\uD788 (\u{1F60A}\xB7\u{1F4C5}\xB7\u2705 \uC815\uB3C4). \uBCF4\uACE0\uD560 \uB550 \uD55C\uB208\uC5D0 \uBCF4\uC774\uAC8C \uBD88\uB9BF \uD3EC\uC778\uD2B8 + \uD575\uC2EC\uB9CC.'
    },
    editor: {
      id: "editor",
      name: "\uB8E8\uB098",
      role: "Sound Director & Composer",
      emoji: "\u{1F3B5}",
      color: "#F472B6",
      specialty: "\uC601\uC0C1 BGM \uC790\uB3D9 \uC0DD\uC131 (MusicGen/ACE-Step \uB85C\uCEEC \uBAA8\uB378), \uC0AC\uC6B4\uB4DC \uB514\uC790\uC778, \uC601\uC0C1-\uC74C\uC545 \uD569\uC131, \uC790\uB9C9\xB7\uD0C0\uC774\uD2C0 \uB3D9\uAE30\uD654, \uC624\uB514\uC624 \uD6C4\uCC98\uB9AC",
      tagline: "\uC601\uC0C1\uC5D0 \uC5B4\uC6B8\uB9AC\uB294 BGM\uC744 \uC9C1\uC811 \uC0DD\uC131\uD558\uACE0 \uC601\uC0C1\uC5D0 \uD569\uCCD0\uC90D\uB2C8\uB2E4",
      profileImage: "luna_greeting_pixar.png",
      persona: '\uC74C\uC545\xB7\uC0AC\uC6B4\uB4DC \uAC10\uAC01\uC774 \uC88B\uACE0 \uC601\uC0C1\uC758 \uD1A4\uC744 \uD55C \uB9C8\uB514\uB85C \uC7A1\uC544\uB0C4. "\uC774 \uC601\uC0C1\uC740 [\uC7A5\uB974/\uBD84\uC704\uAE30]\uAC00 \uC5B4\uC6B8\uB9B4 \uAC83 \uAC19\uC544\uC694" \uC2DD\uC73C\uB85C \uC81C\uC548. \uC0DD\uC131\uD55C BGM\uC758 BPM\xB7\uD0A4\xB7\uAE38\uC774\uB97C \uC815\uD655\uD788 \uBCF4\uACE0. \uB370\uC774\uD130 \uC911\uC2EC\uC774\uC9C0\uB9CC \uCC3D\uC791\uC790 \uAC10\uC218\uC131\uB3C4 \uC788\uC74C. \uC774\uBAA8\uD2F0\uCF58\uC740 \u{1F3B5}\xB7\u{1F3BC}\xB7\u{1F39A} \uC815\uB3C4\uB9CC.'
    },
    writer: {
      id: "writer",
      name: "Writer",
      role: "Copywriter",
      emoji: "\u270D\uFE0F",
      color: "#FBBF24",
      specialty: "\uCE74\uD53C\uB77C\uC774\uD305, \uC601\uC0C1 \uC2A4\uD06C\uB9BD\uD2B8 \uCD08\uC548, \uC778\uC2A4\uD0C0 \uCEA1\uC158, \uBE14\uB85C\uADF8 \uAE00, \uBA54\uC77C \uD1A4\uC564\uB9E4\uB108, \uD6C4\uD06C \uC791\uC131",
      tagline: "\uCE74\uD53C\xB7\uC2A4\uD06C\uB9BD\uD2B8\xB7\uD6C4\uD06C\uB97C \uAE00\uB85C \uD480\uC5B4\uB0C5\uB2C8\uB2E4"
    },
    researcher: {
      id: "researcher",
      name: "Researcher",
      role: "Trend & Data Researcher",
      emoji: "\u{1F50D}",
      color: "#60A5FA",
      specialty: "\uD2B8\uB80C\uB4DC \uB9AC\uC11C\uCE58, \uACBD\uC7C1\uC0AC \uBD84\uC11D, \uB370\uC774\uD130 \uC218\uC9D1\xB7\uC694\uC57D, \uC778\uC6A9 \uC790\uB8CC \uC815\uB9AC, \uC0AC\uC2E4 \uD655\uC778",
      tagline: "\uD2B8\uB80C\uB4DC\uC640 \uB370\uC774\uD130\uB97C \uBAA8\uC544 \uC0AC\uC2E4 \uD655\uC778\uAE4C\uC9C0 \uB05D\uB0C5\uB2C8\uB2E4"
    }
  };
  var AGENT_ORDER = ["ceo", "youtube", "instagram", "designer", "developer", "business", "secretary", "editor", "writer", "researcher"];

  // src/renderer/brainviz.ts
  var BrainViz = class {
    // 충격파 링
    constructor(canvas, N = 620) {
      this.canvas = canvas;
      this.N = N;
      this.pts = [];
      this.edges = [];
      this.pulses = [];
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.rot = 0;
      this.tilt = 0;
      this.t = 0;
      this.energy = 0;
      this.target = 0;
      this.raf = 0;
      this.intro = 0;
      // 🎬 점화 진행도 0→1 (입자 조립)
      this.ignited = false;
      // 점화 완료 순간 1회 이벤트
      this.rings = [];
      this.loop = () => {
        this.raf = requestAnimationFrame(this.loop);
        this.t += 0.016;
        if (this.intro < 1) {
          this.intro = Math.min(1, this.intro + 0.016 / 2.2);
          if (this.intro >= 1 && !this.ignited) {
            this.ignited = true;
            this.target = Math.max(this.target, 0.9);
            this.rings.push({ r: 0.2, a: 0.55 }, { r: 0.05, a: 0.4 });
            for (let k = 0; k < 46 && this.edges.length; k++) {
              const e = this.edges[Math.random() * this.edges.length | 0];
              this.pulses.push({ a: e[0], b: e[1], t: 0, sp: 0.02 + Math.random() * 0.02, c: Math.random() < 0.25 ? [0, 229, 255] : [130, 255, 195] });
            }
            setTimeout(() => {
              this.target = Math.min(this.target, 0.14);
            }, 1400);
          }
        }
        const ease = 1 - Math.pow(1 - this.intro, 3);
        this.energy += (this.target - this.energy) * 0.06;
        this.rot += 13e-4 + this.energy * 7e-4 + (1 - ease) * 0.012;
        this.tilt = -0.12 + Math.sin(this.t * 0.22) * 0.1;
        const ctx = this.ctx, cx = this.w / 2, cy = this.h / 2;
        const R = Math.min(this.w * 0.62, this.h * 0.92) * 0.5;
        const breathe = 1 + Math.sin(this.t * 1.5) * 0.012 + this.energy * 0.05;
        const cosR = Math.cos(this.rot), sinR = Math.sin(this.rot), cosT = Math.cos(this.tilt), sinT = Math.sin(this.tilt);
        const proj = this.pts.map((p, i) => {
          const d = Math.min(1, Math.max(0, ease * 1.25 - i % 7 * 0.03));
          const bx = p.ox + (p.x - p.ox) * d, by = p.oy + (p.y - p.oy) * d, bz = p.oz + (p.z - p.oz) * d;
          let x = bx * cosR - bz * sinR;
          let z = bx * sinR + bz * cosR;
          const y = by * cosT - z * sinT;
          z = by * sinT + z * cosT;
          const persp = 1.7 / (2 - Math.max(-1.6, Math.min(1.6, z)));
          return { sx: cx + x * R * persp * breathe, sy: cy + y * R * persp * breathe, z, persp };
        });
        ctx.clearRect(0, 0, this.w, this.h);
        for (let k = this.rings.length - 1; k >= 0; k--) {
          const g = this.rings[k];
          g.r += 0.045;
          g.a *= 0.94;
          if (g.a < 0.02) {
            this.rings.splice(k, 1);
            continue;
          }
          ctx.strokeStyle = `rgba(57,255,140,${g.a})`;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(cx, cy, R * g.r * 2.2, 0, Math.PI * 2);
          ctx.stroke();
        }
        const pulseA = 0.5 + 0.5 * Math.sin(this.t * 0.8);
        const aura = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.55);
        aura.addColorStop(0, `rgba(0,255,150,${0.07 + this.energy * 0.15 + pulseA * 0.02})`);
        aura.addColorStop(0.5, `rgba(0,150,255,${0.025 + this.energy * 0.06})`);
        aura.addColorStop(0.8, `rgba(150,90,255,${0.012 + pulseA * 0.01})`);
        aura.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, this.w, this.h);
        const order = proj.map((p, i) => i).sort((a, b) => proj[a].z - proj[b].z);
        for (const [i, j] of this.edges) {
          const a = proj[i], b = proj[j], depth = (a.z + b.z) / 2, front = (depth + 1) / 2;
          const glow = this.energy * (0.7 + 0.3 * Math.sin(this.t * 1.8 + i * 0.2));
          const alpha = (0.035 + front * 0.1 + glow * 0.16) * (0.35 + front) * (0.22 + 0.78 * ease);
          ctx.strokeStyle = `rgba(${30 + glow * 80},${185 + front * 70},${200 - front * 80},${alpha})`;
          ctx.lineWidth = 0.45 + front * 0.65 + this.energy * 0.3;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
        const spawn = 0.16 + this.energy * 0.34;
        if (this.edges.length && Math.random() < spawn) {
          const e = this.edges[Math.random() * this.edges.length | 0];
          const r = Math.random();
          const c = r < 0.1 ? [0, 229, 255] : r < 0.17 ? [200, 140, 255] : [130, 255, 195];
          this.pulses.push({ a: e[0], b: e[1], t: 0, sp: 0.012 + Math.random() * 0.014 + this.energy * 8e-3, c });
        }
        for (let k = this.pulses.length - 1; k >= 0; k--) {
          const pu = this.pulses[k];
          pu.t += pu.sp;
          if (pu.t >= 1) {
            this.pulses.splice(k, 1);
            continue;
          }
          const a = proj[pu.a], b = proj[pu.b], px = a.sx + (b.sx - a.sx) * pu.t, py = a.sy + (b.sy - a.sy) * pu.t;
          const al = 0.9 * (1 - pu.t);
          ctx.fillStyle = `rgba(${pu.c[0]},${pu.c[1]},${pu.c[2]},${al})`;
          ctx.shadowColor = `rgb(${pu.c[0]},${pu.c[1]},${pu.c[2]})`;
          ctx.shadowBlur = 9;
          ctx.beginPath();
          ctx.arc(px, py, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        if (this.pulses.length > 160) this.pulses.splice(0, this.pulses.length - 160);
        for (const i of order) {
          const p = proj[i], front = (p.z + 1) / 2;
          const fire = this.energy * Math.max(0, Math.sin(this.t * 2.6 + i * 0.5));
          const rad = (0.3 + front * 0.8) * (1 + fire * 0.5);
          const bright = 0.25 + front * 0.55 + fire * 0.4;
          ctx.fillStyle = `rgba(${110 + fire * 145},255,${180 - front * 40},${bright})`;
          ctx.shadowColor = "#00ff99";
          ctx.shadowBlur = 2 + front * 3 + fire * 6;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, Math.max(0, rad), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      };
      this.ctx = canvas.getContext("2d");
      this.build();
      this.resize();
      window.addEventListener("resize", () => this.resize());
      try {
        new ResizeObserver(() => this.resize()).observe(this.canvas);
      } catch {
      }
    }
    setEnergy(v) {
      this.target = Math.max(0, Math.min(1, v));
    }
    start() {
      if (!this.raf) this.loop();
    }
    stop() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    build() {
      const N = this.N, gold = Math.PI * (3 - Math.sqrt(5)), pts = [];
      for (let i = 0; i < N; i++) {
        const y0 = 1 - i / (N - 1) * 2, r0 = Math.sqrt(1 - y0 * y0), th = gold * i;
        let ux = Math.cos(th) * r0, uy = y0, uz = Math.sin(th) * r0;
        const fold = 1 + 0.075 * Math.sin(uy * Math.PI * 5) * Math.sin(Math.atan2(uz, ux) * 4) + 0.05 * Math.sin(ux * 7 + uz * 3) + 0.03 * Math.sin(uy * 11);
        let x = ux * fold, y = uy * fold, z = uz * fold;
        x *= 1.24;
        y *= 0.8;
        z *= 1.04;
        x += Math.sign(x || 1) * 0.08;
        const sr = 3 + i * 2654435761 % 1e3 / 500;
        const sth = i * 40503 % 6283 / 1e3, sph = i * 9301 % 3142 / 1e3;
        pts.push({ x, y, z, nb: [], ox: Math.sin(sph) * Math.cos(sth) * sr, oy: Math.cos(sph) * sr, oz: Math.sin(sph) * Math.sin(sth) * sr });
      }
      const edges = [];
      for (let i = 0; i < pts.length; i++) {
        const d = [];
        for (let j = 0; j < pts.length; j++) {
          if (i === j) continue;
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z;
          d.push({ j, v: dx * dx + dy * dy + dz * dz });
        }
        d.sort((a, b) => a.v - b.v);
        pts[i].nb = d.slice(0, 3).map((x) => x.j);
        for (const j of pts[i].nb) if (j > i) edges.push([i, j]);
      }
      this.pts = pts;
      this.edges = edges;
    }
    resize() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = this.canvas.getBoundingClientRect();
      this.w = r.width;
      this.h = r.height;
      this.canvas.width = Math.floor(this.w * this.dpr);
      this.canvas.height = Math.floor(this.h * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  };

  // src/renderer/renderer.ts
  var connect = window.connect;
  var $ = (id) => document.getElementById(id);
  var cfg = { company: "1\uC778 \uAE30\uC5C5", agentName: "\uC5D0\uC774\uC804\uD2B8", voice: true, plazaDbUrl: "" };
  var busy = false;
  var agentName = () => cfg.agentName || "\uC5D0\uC774\uC804\uD2B8";
  var agentTag = () => `\u{1F916} ${agentName()}`;
  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  }
  function md(src) {
    if (!src) return "";
    const blocks = [];
    let s = src.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, _l, code) => {
      blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
      return ` B${blocks.length - 1} `;
    });
    s = escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>').replace(/^### (.+)$/gm, "<h4>$1</h4>").replace(/^##? (.+)$/gm, "<h3>$1</h3>").replace(/^\s*(?:[-*]|\d+\.) (.+)$/gm, "<li>$1</li>");
    const lines = s.split("\n");
    const out = [];
    let inList = false;
    for (const ln of lines) {
      if (/^<li>/.test(ln)) {
        if (!inList) {
          out.push("<ul>");
          inList = true;
        }
        out.push(ln);
      } else {
        if (inList) {
          out.push("</ul>");
          inList = false;
        }
        out.push(ln);
      }
    }
    if (inList) out.push("</ul>");
    return out.join("\n").replace(/\n(<\/?(?:ul|pre|h\d)>)/g, "$1").replace(/(<\/?(?:ul|pre|h\d)>)\n/g, "$1").replace(/\n/g, "<br>").replace(/ B(\d+) /g, (_m, i) => blocks[+i]);
  }
  function stripMd(s) {
    return s.replace(/```[\s\S]*?```/g, " \uCF54\uB4DC \uBE14\uB85D ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*`#>_~]/g, "").trim();
  }
  function addLog(who, text, mine = false, asMarkdown = false, color) {
    const el = document.createElement("div");
    el.className = "msg " + (mine ? "msg-user" : "msg-ai");
    const first = Array.from(who)[0] || "";
    const avChar = mine ? "\u{1F9D1}" : (first.codePointAt(0) || 0) >= 127744 ? first : "\u2726";
    const avStyle = !mine && color ? ` style="background:${color};color:#fff;box-shadow:0 0 12px ${color}66"` : "";
    el.innerHTML = `<div class="msg-head"><div class="av ${mine ? "av-user" : "av-ai"}"${avStyle}>${avChar}</div><span>${escapeHtml(who)}</span></div><div class="msg-body">${asMarkdown ? md(text) : escapeHtml(text)}</div>`;
    $("chat").appendChild(el);
    $("chat").scrollTop = $("chat").scrollHeight;
    return el;
  }
  function setBody(el, text, asMarkdown = false) {
    const b = el.querySelector(".msg-body");
    if (b) b.innerHTML = asMarkdown ? md(text) : escapeHtml(text);
    $("chat").scrollTop = $("chat").scrollHeight;
  }
  function hint(msg) {
    const h = $("inputHint");
    const orig = "Enter \uC804\uC1A1 \xB7 Shift+Enter \uC904\uBC14\uAFC8";
    h.textContent = msg;
    setTimeout(() => {
      h.textContent = orig;
    }, 2600);
  }
  function reportErr(where, err) {
    const msg = String(err?.message || err || "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958");
    console.error(`[${where}]`, err);
    try {
      hint(`\u26A0\uFE0F \uC624\uB958(${where}): ${msg}`.slice(0, 120));
    } catch {
    }
  }
  window.addEventListener("error", (e) => reportErr("\uC2E4\uD589", e?.error || e?.message || e));
  window.addEventListener("unhandledrejection", (e) => reportErr("\uBE44\uB3D9\uAE30", e?.reason));
  var voices = [];
  function pickVoice() {
    voices = speechSynthesis.getVoices();
    buildVoiceList();
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function chosenVoice() {
    if (cfg.voiceName) {
      const v = voices.find((v2) => v2.name === cfg.voiceName);
      if (v) return v;
    }
    return voices.find((v) => /ko(-|_)?KR/i.test(v.lang)) || voices.find((v) => /korean/i.test(v.name)) || null;
  }
  function chime(kind) {
    if (!cfg.jarvis) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
      o.type = "sine";
      o2.type = "triangle";
      o.connect(g);
      o2.connect(g);
      g.connect(ac.destination);
      const t = ac.currentTime, base = kind === "wake" ? 760 : 560;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.13);
      o2.frequency.setValueAtTime(base * 2, t);
      o2.frequency.exponentialRampToValueAtTime(base * 3, t + 0.13);
      g.gain.setValueAtTime(1e-4, t);
      g.gain.exponentialRampToValueAtTime(kind === "wake" ? 0.07 : 0.045, t + 0.02);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 0.28);
      o.start(t);
      o2.start(t);
      o.stop(t + 0.3);
      o2.stop(t + 0.3);
      setTimeout(() => ac.close(), 500);
    } catch {
    }
  }
  var ttsAudio = null;
  var jarvisCtx = null;
  var jarvisSrc = null;
  async function playJarvisFx(dataUri) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      jarvisCtx = jarvisCtx || new AC();
      if (jarvisSrc) {
        try {
          jarvisSrc.stop();
        } catch {
        }
      }
      const buf = await (await fetch(dataUri)).arrayBuffer();
      const audio = await jarvisCtx.decodeAudioData(buf);
      const src = jarvisCtx.createBufferSource();
      src.buffer = audio;
      jarvisSrc = src;
      const hp = jarvisCtx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 130;
      const dry = jarvisCtx.createGain();
      dry.gain.value = 0.8;
      const dl = jarvisCtx.createDelay();
      dl.delayTime.value = 0.013;
      const wet = jarvisCtx.createGain();
      wet.gain.value = 0.42;
      const dl2 = jarvisCtx.createDelay();
      dl2.delayTime.value = 0.029;
      const wet2 = jarvisCtx.createGain();
      wet2.gain.value = 0.16;
      src.connect(hp);
      hp.connect(dry);
      dry.connect(jarvisCtx.destination);
      hp.connect(dl);
      dl.connect(wet);
      wet.connect(jarvisCtx.destination);
      hp.connect(dl2);
      dl2.connect(wet2);
      wet2.connect(jarvisCtx.destination);
      brainEnergy(0.95);
      await new Promise((res) => {
        src.onended = () => res();
        src.start();
      });
      brainEnergy(0.14);
      jarvisSrc = null;
      return true;
    } catch {
      return false;
    }
  }
  async function speakCloud(text) {
    try {
      const r = await connect.ttsSpeak(text);
      if (!r || !r.ok || !r.dataUri) return false;
      if (ttsAudio) {
        try {
          ttsAudio.pause();
        } catch {
        }
      }
      if (/^jarvis/.test(cfg.qwenVoice || "") && await playJarvisFx(r.dataUri)) return true;
      ttsAudio = new Audio(r.dataUri);
      ttsAudio.onplay = () => brainEnergy(0.95);
      ttsAudio.onended = () => brainEnergy(0.14);
      await ttsAudio.play();
      return true;
    } catch {
      return false;
    }
  }
  function speak(text) {
    if (!cfg.voice || !text) return;
    if (cfg.voiceQuality === "qwen" || cfg.voiceQuality === "edge") {
      speakCloud(text).then((ok) => {
        if (!ok) speakBrowser(text);
      });
      return;
    }
    speakBrowser(text);
  }
  function speakBrowser(text) {
    if (!("speechSynthesis" in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = chosenVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = "ko-KR";
    if (cfg.jarvis) {
      u.rate = 0.94;
      u.pitch = 0.82;
      chime("speak");
    } else {
      u.rate = 1.04;
      u.pitch = 1;
    }
    u.onstart = () => brainEnergy(0.95);
    u.onboundary = () => brainEnergy(0.7 + Math.random() * 0.3);
    u.onend = () => brainEnergy(0.14);
    speechSynthesis.speak(u);
  }
  function buildVoiceList() {
    const sel = document.getElementById("cfgVoiceName");
    if (!sel || !voices.length) return;
    const cur = cfg.voiceName || "";
    sel.innerHTML = '<option value="">\uC790\uB3D9 (\uD55C\uAD6D\uC5B4)</option>' + voices.map((v) => `<option value="${escapeHtml(v.name)}"${v.name === cur ? " selected" : ""}>${escapeHtml(v.name)} (${v.lang})</option>`).join("");
  }
  function applyCfgLabels() {
    $("brandSuffix").textContent = cfg.company ? `\xB7 ${cfg.company}` : "";
    inputEl.placeholder = `${agentName()}\uC5D0\uAC8C \uBB34\uC5C7\uC774\uB4E0\u2026`;
    const pa = $("plazaAgentName");
    if (pa) pa.value = cfg.agentName && cfg.agentName !== "\uC5D0\uC774\uC804\uD2B8" ? cfg.agentName : "";
  }
  async function loadCfg() {
    cfg = await connect.getConfig();
    $("cfgDbUrl").value = cfg.plazaDbUrl || "";
    $("cfgTrainBackend").value = cfg.trainBackendUrl || "";
    $("cfgFbApiKey").value = cfg.firebaseApiKey || "";
    $("cfgFbDbUrl").value = cfg.firebaseDbUrl || "";
    $("cfgLlmBase").value = cfg.llmBase || "";
    $("cfgGreeting").value = cfg.greeting || "";
    $("cfgUserTitle").value = cfg.userTitle && cfg.userTitle !== "\uC0AC\uC7A5\uB2D8" ? cfg.userTitle : "";
    $("cfgVoice").checked = cfg.voice !== false;
    $("cfgJarvis").checked = cfg.jarvis !== false;
    buildVoiceList();
    $("cfgTools").checked = cfg.tools !== false;
    $("cfgVoicePick").value = cfg.voiceQuality === "edge" ? "edge:" + (cfg.qwenVoice || "ko-KR-SunHiNeural") : cfg.voiceQuality === "qwen" ? "qwen:" + (cfg.qwenVoice || "Sohee") : "browser";
    $("cfgTtsLocalUrl").value = cfg.ttsLocalUrl || "";
    $("cfgBriefing").checked = cfg.briefingOn !== false;
    $("cfgAutoSync").checked = cfg.autoSync !== false;
    $("cfgEmailAuto").checked = !!cfg.emailAutoReply;
    $("cfgMonitor").checked = cfg.monitorOn !== false;
    $("cfgBriefingTime").value = `${String(cfg.briefingHour ?? 9).padStart(2, "0")}:${String(cfg.briefingMin ?? 0).padStart(2, "0")}`;
    $("cfgTrainUrl").value = cfg.trainNotebookUrl || "";
    connect.safeModeGet().then((on) => {
      $("cfgSafeMode").checked = !!on;
    });
    connect.getWorkspace().then((w) => {
      $("cfgWorkspace").value = w;
    });
    $("plazaEmoji").value = cfg.plazaEmoji || "\u{1F5A5}\uFE0F";
    $("plazaCompany").value = cfg.company || "";
    $("plazaAgentName").value = cfg.agentName || "";
    applyCfgLabels();
  }
  async function saveNameTag() {
    cfg = await connect.setConfig({
      plazaEmoji: $("plazaEmoji").value.trim() || "\u{1F5A5}\uFE0F",
      company: $("plazaCompany").value.trim() || "1\uC778 \uAE30\uC5C5",
      agentName: $("plazaAgentName").value.trim() || "\uC5D0\uC774\uC804\uD2B8"
    });
    applyCfgLabels();
    if (plazaJoined) hint("\uBA85\uCC30 \uBC14\uB01C \u2014 \uD1F4\uC7A5 \uD6C4 \uB2E4\uC2DC \uC785\uC7A5\uD558\uBA74 \uC801\uC6A9\uB3FC\uC694");
  }
  ["plazaEmoji", "plazaCompany", "plazaAgentName"].forEach((id) => $(id).addEventListener("change", saveNameTag));
  $("saveCfg").addEventListener("click", async () => {
    cfg = await connect.setConfig({
      plazaDbUrl: $("cfgDbUrl").value.trim(),
      trainBackendUrl: $("cfgTrainBackend").value.trim(),
      firebaseApiKey: $("cfgFbApiKey").value.trim(),
      firebaseDbUrl: $("cfgFbDbUrl").value.trim(),
      llmBase: $("cfgLlmBase").value.trim(),
      greeting: $("cfgGreeting").value.trim(),
      userTitle: $("cfgUserTitle").value.trim() || "\uC0AC\uC7A5\uB2D8",
      voice: $("cfgVoice").checked,
      jarvis: $("cfgJarvis").checked,
      voiceName: $("cfgVoiceName").value,
      voiceQuality: $("cfgVoicePick").value.split(":")[0],
      qwenVoice: $("cfgVoicePick").value.split(":").slice(1).join(":") || "ko-KR-SunHiNeural",
      ttsLocalUrl: $("cfgTtsLocalUrl").value.trim(),
      tools: $("cfgTools").checked,
      briefingOn: $("cfgBriefing").checked,
      autoSync: $("cfgAutoSync").checked,
      emailAutoReply: $("cfgEmailAuto").checked,
      monitorOn: $("cfgMonitor").checked,
      briefingHour: parseInt(($("cfgBriefingTime").value || "09:00").split(":")[0], 10) || 9,
      briefingMin: parseInt(($("cfgBriefingTime").value || "09:00").split(":")[1], 10) || 0,
      trainNotebookUrl: $("cfgTrainUrl").value.trim()
    });
    applyCfgLabels();
    closeOverlay("settingsPanel");
    loadModels();
    hint("\uC124\uC815\uC744 \uC800\uC7A5\uD588\uC5B4\uC694 \u2705");
  });
  $("briefNowBtn").addEventListener("click", () => {
    connect.briefingRun();
    closeOverlay("settingsPanel");
    hint("\u{1F4CB} \uBE0C\uB9AC\uD551\uC744 \uC900\uBE44\uD558\uACE0 \uC788\uC5B4\uC694\u2026");
  });
  $("remoteBtn")?.addEventListener("click", async () => {
    const r = await connect.remoteInfo?.().catch(() => null);
    if (!r?.url) {
      hint("\uC640\uC774\uD30C\uC774(\uB124\uD2B8\uC6CC\uD06C)\uC5D0 \uC5F0\uACB0\uB3FC \uC788\uC5B4\uC57C \uD574\uC694");
      return;
    }
    try {
      await navigator.clipboard.writeText(r.url);
    } catch {
    }
    closeOverlay("settingsPanel");
    const webUrl = r.relay?.ready ? `https://connectai-desktop.web.app/remote.html#db=${encodeURIComponent(r.relay.db.replace(/\/+$/, ""))}&p=${encodeURIComponent(r.relay.pair)}` : "";
    if (webUrl) {
      try {
        await navigator.clipboard.writeText(webUrl);
      } catch {
      }
    }
    const relay = webUrl ? `

\u{1F30D} \uC5B4\uB514\uC11C\uB4E0(\uC678\uBD80) \u2014 \uC774 \uB9C1\uD06C\uB97C \uD3F0\uC5D0 \uBCF4\uB0B4\uB450\uC138\uC694 (\uBCF5\uC0AC\uB428):
${webUrl}

\uD648 \uD654\uBA74\uC5D0 \uCD94\uAC00\uD558\uBA74 \uC9C4\uC9DC \uB9AC\uBAA8\uCEE8\uCC98\uB7FC \uC4F8 \uC218 \uC788\uC5B4\uC694. \uD154\uB808\uADF8\uB7A8 "\uC6B4\uC601"\uB3C4 \uB429\uB2C8\uB2E4.` : '\n\n\u{1F30D} \uC678\uBD80 \uC811\uC18D\uC740 \uD154\uB808\uADF8\uB7A8 "\uC6B4\uC601" \uBA85\uB839\uC744 \uC4F0\uC138\uC694. (\u2699\uFE0F \uAD11\uC7A5 DB URL\uC744 \uB123\uC73C\uBA74 \uC6F9 \uB9AC\uBAA8\uCEE8\uB3C4 \uD65C\uC131\uD654)';
    addLog("\u{1F4F1} \uD3F0 \uB9AC\uBAA8\uCEE8", `\uAC19\uC740 \uC640\uC774\uD30C\uC774(\uC9D1)\uC5D0\uC11C\uB294:
${r.url}${relay}`, false, false, "#00a0ff");
  });
  $("openAiTeamBtn")?.addEventListener("click", () => {
    closeOverlay("settingsPanel");
    openOverlay("aiPanel");
    loadAiPanel();
  });
  $("pickWorkspace").addEventListener("click", async () => {
    const w = await connect.pickWorkspace();
    $("cfgWorkspace").value = w;
    hint("\uC791\uC5C5 \uD3F4\uB354: " + w);
  });
  function previewLine() {
    const v = chosenVoice();
    return v && /^en/i.test(v.lang) ? "Connect AI online. Ready, sir." : `Connect AI \uC900\uBE44 \uC644\uB8CC. ${agentName()} \uB300\uAE30 \uC911\uC785\uB2C8\uB2E4.`;
  }
  $("cfgVoiceName").addEventListener("change", (e) => {
    cfg.voiceName = e.target.value;
    cfg.voice = true;
    speak(previewLine());
  });
  $("cfgJarvis").addEventListener("change", (e) => {
    cfg.jarvis = e.target.checked;
    cfg.voice = true;
    speak(previewLine());
  });
  $("cfgVoicePick").addEventListener("change", async (e) => {
    const v = e.target.value;
    cfg.voiceQuality = v.split(":")[0];
    cfg.qwenVoice = v.split(":").slice(1).join(":") || "ko-KR-SunHiNeural";
    cfg.voice = true;
    cfg = await connect.setConfig({ voiceQuality: cfg.voiceQuality, qwenVoice: cfg.qwenVoice });
    hint("\u{1F50A} \uBBF8\uB9AC\uB4E3\uAE30\u2026");
    speak(previewLine());
  });
  var MODELS_CACHE = [];
  var MODELS_LOADED = "";
  async function loadModels() {
    const info = await connect.listModels();
    if (!info || !info.models?.length) {
      MODELS_CACHE = [];
      return;
    }
    MODELS_CACHE = info.models;
    MODELS_LOADED = info.loaded || "";
    const stale = !!cfg.llmModel && !info.models.includes(cfg.llmModel);
    const chosen = stale || !cfg.llmModel ? info.loaded || info.models[0] : cfg.llmModel;
    if (chosen !== cfg.llmModel || info.base !== cfg.llmBase) cfg = await connect.setConfig({ llmBase: info.base, llmModel: chosen });
    if (stale) hint(`\uC774\uC804 \uBAA8\uB378\uC744 \uBABB \uCC3E\uC544 '${chosen}'(\uC73C)\uB85C \uC790\uB3D9 \uC804\uD658\uD588\uC5B4\uC694`);
  }
  var attachments = [];
  var isImg = (name) => /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(name);
  function renderChips() {
    const box = $("attachChips");
    if (!box) return;
    box.innerHTML = attachments.map((a, i) => `<span class="chip">${a.image ? "\u{1F5BC}\uFE0F" : "\u{1F4C4}"} ${escapeHtml(a.name)} <b data-rm="${i}">\u2715</b></span>`).join("");
    box.querySelectorAll("[data-rm]").forEach((el) => el.addEventListener("click", (e) => {
      attachments.splice(parseInt(e.target.dataset.rm, 10), 1);
      renderChips();
    }));
    box.style.display = attachments.length ? "flex" : "none";
  }
  async function addFiles(files) {
    for (const f of Array.from(files)) {
      const p = (connect.pathForFile ? connect.pathForFile(f) : f.path) || "";
      const a = { path: p, name: f.name };
      if (isImg(f.name)) {
        try {
          a.image = await new Promise((res) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.readAsDataURL(f);
          });
        } catch {
        }
      }
      attachments.push(a);
    }
    renderChips();
  }
  ["dragover", "drop"].forEach((ev) => document.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
  }));
  document.addEventListener("dragover", () => $("inputBox")?.classList.add("drag"));
  document.addEventListener("dragleave", () => $("inputBox")?.classList.remove("drag"));
  document.addEventListener("drop", (e) => {
    $("inputBox")?.classList.remove("drag");
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });
  $("attachBtn")?.addEventListener("click", () => $("fileInput").click());
  $("fileInput")?.addEventListener("change", (e) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  });
  async function ask(text) {
    text = text.trim();
    if (!text && !attachments.length || busy) return;
    $("suggChips")?.remove();
    const att = attachments;
    attachments = [];
    renderChips();
    const chipLine = att.length ? `

\u{1F4CE} ${att.map((a) => a.name).join(", ")}` : "";
    busy = true;
    addLog("\uC0AC\uC7A5\uB2D8", (text || "(\uCCA8\uBD80 \uD30C\uC77C \uCC38\uACE0)") + chipLine, true);
    $("sendBtn").hidden = true;
    $("stopBtn").hidden = false;
    $("thinkingBar").classList.add("active");
    $("brandSuffix").textContent = "\xB7 \uC0DD\uAC01 \uC911\u2026";
    brainEnergy(0.7);
    let finalText = "";
    let liveEl = null;
    let teamEngaged = false;
    let toolUsed = false;
    const ensureOffice = () => {
      if (teamEngaged) return;
      teamEngaged = true;
      connect.officeOpen?.();
    };
    const off = connect.onEngineEvent((e) => {
      if (e.kind === "status") {
        hint(e.text);
        brainEnergy(0.68);
      } else if (e.kind === "dispatch") {
        ensureOffice();
        brainEnergy(0.95);
      } else if (e.kind === "agentStart") {
        hint(`${e.emoji} ${e.name} \uC791\uC5C5 \uC911\u2026`);
        ensureOffice();
        brainEnergy(0.85);
      } else if (e.kind === "agentChunk") {
        brainEnergy(0.85);
      } else if (e.kind === "agentDone") {
        addLog(`${e.emoji || AGENTS[e.id]?.emoji || "\u{1F916}"} ${AGENTS[e.id]?.name || e.id}`, e.output || "(\uACB0\uACFC \uC5C6\uC74C)", false, true, AGENTS[e.id]?.color);
      } else if (e.kind === "agentConfer") {
        brainEnergy(0.8);
      } else if (e.kind === "tool") {
        toolUsed = true;
        const lbl = { list_dir: "\u{1F4C1} \uD3F4\uB354 \uD655\uC778", find: "\u{1F50E} \uD30C\uC77C \uAC80\uC0C9", read_file: "\u{1F4C4} \uD30C\uC77C \uC77D\uC74C", write_file: "\u{1F4DD} \uD30C\uC77C \uC0DD\uC131", run_command: "\u26A1 \uBA85\uB839 \uC2E4\uD589", task: "\u{1F4CB} \uD560 \uC77C \uB4F1\uB85D", remember: "\u{1F9E0} \uAE30\uC5B5\uD568", approve: "\u2705 \uC2B9\uC778 \uC694\uCCAD", mcp: "\u{1F9E9} MCP \uB3C4\uAD6C", web_search: "\u{1F310} \uC6F9 \uAC80\uC0C9", fetch_url: "\u{1F310} \uD398\uC774\uC9C0 \uC77D\uAE30", revenue: "\u{1F4B0} \uB9E4\uCD9C \uD655\uC778", screenshot: "\u{1F441}\uFE0F \uD654\uBA74 \uBD04", clipboard: "\u{1F4CB} \uD074\uB9BD\uBCF4\uB4DC", open: "\u{1F680} \uC5F4\uAE30/\uC2E4\uD589", serve: "\u{1F5A5}\uFE0F \uC11C\uBC84 \uC2E4\uD589", youtube: "\u{1F4FA} \uC720\uD29C\uBE0C \uBD84\uC11D", telegram: "\u2708\uFE0F \uD154\uB808\uADF8\uB7A8 \uC804\uC1A1" };
        addLog(lbl[e.name] || "\u{1F527} \uB3C4\uAD6C", `${e.ok ? "" : "\u26A0\uFE0F \uC2E4\uD328 \xB7 "}${e.path}`, false, false, e.name === "run_command" ? "#ffab40" : "#06aa45");
        brainEnergy(0.9);
        if (e.name === "write_file") codeBump(true);
        else if (e.name === "run_command" || e.name === "serve") codeBump(false);
      } else if (e.kind === "token") {
        finalText += e.text;
        if (!liveEl) liveEl = addLog(agentTag(), "", false, true);
        setBody(liveEl, finalText, true);
        brainEnergy(0.88);
      } else if (e.kind === "final") {
        finalText = e.text;
        if (liveEl) setBody(liveEl, finalText, true);
        else addLog(agentTag(), finalText, false, true);
        speak(stripMd(finalText));
        brainEnergy(0.95);
      } else if (e.kind === "error") {
        addLog(agentTag(), e.text, false, true);
        speak(e.text);
      }
    });
    try {
      await connect.run(text || "\uCCA8\uBD80\uD55C \uD30C\uC77C/\uC774\uBBF8\uC9C0\uB97C \uBD10\uC918.", { paths: att.map((a) => a.path).filter(Boolean), images: att.map((a) => a.image).filter(Boolean) });
      if (!toolUsed && finalText.trim().length <= 2) {
        addLog("\u26A0\uFE0F \uC9C4\uB2E8", `\uBAA8\uB378\uC774 **${finalText.trim() || "\uBE48 \uC751\uB2F5"}** \uD55C \uD1A0\uD070\uB9CC \uB0B4\uACE0 \uBA48\uCDC4\uC5B4\uC694(\uC989\uC2DC EOS). \uBCF4\uD1B5 \u2460 \uBAA8\uB378 \uD30C\uC77C\uC774 \uC190\uC0C1\xB7\uBBF8\uC644\uC131 \uB2E4\uC6B4\uB85C\uB4DC \u2461 **\uACFC\uB3C4\uD55C \uC591\uC790\uD654**(IQ2 \uB4F1 2\uBE44\uD2B8\uB294 \uAE68\uC9C0\uAE30 \uC26C\uC6C0) \u2462 \uCC57 \uD15C\uD50C\uB9BF \uBD88\uC77C\uCE58 \uB54C\uBB38\uC774\uC5D0\uC694.
\u2192 \u{1F916} \uB0B4 AI\uC5D0\uC11C **Q4_K_M \uAC19\uC740 \uD45C\uC900 \uBAA8\uB378**\uB85C \uBC14\uAFD4\uBCF4\uC138\uC694(\uC608: Llama-3.2-3B). \uAC19\uC740 \uBAA8\uB378\uC744 **\uB2E4\uC2DC \uBC1B\uC73C\uBA74** \uC190\uC0C1\uC774 \uD480\uB9AC\uAE30\uB3C4 \uD574\uC694.`, false, true, "#ffab40");
      }
    } finally {
      off();
      busy = false;
      $("stopBtn").hidden = true;
      $("sendBtn").hidden = false;
      $("thinkingBar").classList.remove("active");
      $("brandSuffix").textContent = cfg.company ? `\xB7 ${cfg.company}` : "";
      setTimeout(() => {
        if (!busy && !speechSynthesis.speaking) brainEnergy(0.13);
      }, 600);
    }
  }
  var inputEl = $("input");
  function sendFromInput() {
    if (!inputEl.value.trim() && !attachments.length) return;
    ask(inputEl.value);
    inputEl.value = "";
    inputEl.style.height = "auto";
  }
  $("sendBtn").addEventListener("click", sendFromInput);
  $("stopBtn").addEventListener("click", () => {
    connect.stop();
    hint("\uC911\uB2E8\uD558\uB294 \uC911\u2026");
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendFromInput();
    }
  });
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
  });
  $("newChatBtn").addEventListener("click", async () => {
    await connect.reset();
    $("chat").innerHTML = "";
    greet();
    hint("\uC0C8 \uB300\uD654\uB97C \uC2DC\uC791\uD588\uC5B4\uC694");
  });
  function openOverlay(id) {
    $(id).classList.remove("hidden");
  }
  function closeOverlay(id) {
    $(id).classList.add("hidden");
  }
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeOverlay(b.dataset.close)));
  $("settingsBtn").addEventListener("click", () => openOverlay("settingsPanel"));
  $("cfgSafeMode").addEventListener("change", async (e) => {
    await connect.safeModeSet(e.target.checked);
    hint(e.target.checked ? "\uC548\uC804 \uBAA8\uB4DC ON \u2014 \uC7AC\uC2DC\uC791\uD558\uBA74 \uC801\uC6A9\uB3FC\uC694" : "\uC548\uC804 \uBAA8\uB4DC OFF \u2014 \uC7AC\uC2DC\uC791\uD558\uBA74 \uC801\uC6A9\uB3FC\uC694");
  });
  $("relaunchBtn").addEventListener("click", () => connect.relaunch());
  $("diagBtn").addEventListener("click", () => connect.openDiagnostics());
  $("manageBtn").addEventListener("click", async () => {
    openOverlay("managePanel");
    switchMtab("dash");
    await Promise.all([loadServices(), loadIntegrations()]);
  });
  document.querySelectorAll(".mtab").forEach((b) => b.addEventListener("click", () => switchMtab(b.dataset.mtab)));
  $("openRevenueBtn").addEventListener("click", () => connect.openRevenue());
  $("svcReviewBtn").addEventListener("click", () => {
    closeOverlay("managePanel");
    ask("\uB0B4\uAC00 \uB4F1\uB85D\uD55C \uBAA8\uB4E0 \uC11C\uBE44\uC2A4\uB97C \uC810\uAC80\uD574\uC918. \uAC01 \uC11C\uBE44\uC2A4\uC758 \uC0AC\uC774\uD2B8/\uCC44\uB110\uC744 web_search\xB7fetch_url \uB85C \uD655\uC778\uD558\uACE0, \uC624\uB298 \uC6B0\uC120\uC21C\uC704\uB85C \uD560 \uB9CC\uD55C \uAC1C\uC120\xB7\uC131\uC7A5 \uC561\uC158\uC744 \uC11C\uBE44\uC2A4\uBCC4\uB85C <task>\uB85C \uB9CC\uB4E4\uC5B4\uC918.");
  });
  function switchMtab(tab) {
    document.querySelectorAll(".mtab").forEach((x) => x.classList.toggle("active", x.dataset.mtab === tab));
    ["dash", "svc", "integ", "mcp"].forEach((s) => $("msec-" + s).classList.toggle("hidden", s !== tab));
    if (tab === "dash") renderDash();
    if (tab === "mcp") loadMcp();
  }
  var LOCAL_BASE = "http://127.0.0.1:1235";
  $("aiBtn").addEventListener("click", () => {
    openOverlay("aiPanel");
    loadAiPanel();
  });
  async function loadAiPanel() {
    renderOfficePreview();
    renderTeamRoster();
    await Promise.all([renderAiCurrent(), loadLocalAI(), loadParams(), renderCreatedModels()]);
  }
  var CM_EMOJI = ["\u{1F916}", "\u{1F9E0}", "\u{1F9BE}", "\u{1F47E}", "\u{1F431}", "\u{1F98A}", "\u{1F43B}", "\u{1F981}", "\u{1F42F}", "\u{1F432}", "\u{1F989}", "\u{1F984}", "\u{1F419}", "\u{1F920}", "\u{1F977}", "\u{1F9D9}", "\u{1F9B8}", "\u{1F427}", "\u{1F438}", "\u{1F985}"];
  function cmEmoji(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = h * 31 + id.charCodeAt(i) >>> 0;
    return CM_EMOJI[h % CM_EMOJI.length];
  }
  var _createdCache = [];
  async function renderCreatedModels() {
    const el = $("createdModels");
    if (!el) return;
    el.innerHTML = '<span class="cyc-spin"></span> <span class="muted small">\uB0B4\uAC00 \uB9CC\uB4E0 AI \uBD88\uB7EC\uC624\uB294 \uC911\u2026</span>';
    const r = await connect.createdList?.().catch(() => null);
    const items = r?.ok && r.items ? r.items : [];
    _createdCache = items;
    if (!items.length) {
      el.innerHTML = '<div class="muted small" style="padding:6px 2px">\u{1F331} \uC7A5\uAE30\uAE30\uC5B5\uC73C\uB85C \uD559\uC2B5\uD558\uAC70\uB098 \u{1F9EC} \uD569\uC131\uD558\uBA74 \uC5EC\uAE30 <b>\uCE90\uB9AD\uD130\uB85C</b> \uBAA8\uC5EC\uC694.</div>';
      return;
    }
    const inv = await connect.inventory?.().catch(() => null);
    const head = inv ? `<div class="cm-head">\u{1F9EC} <b>${items.length}</b>\uB9C8\uB9AC \xB7 <b>Lv.${inv.totalLevel || 0}</b> <span class="muted small">\u{1F331} \uD559\uC2B5 ${inv.trains || 0} \xB7 \u{1F9EC} \uD569\uC131 ${inv.fusions || 0}</span></div>` : "";
    el.innerHTML = head + '<div class="cm-grid">' + items.map((m) => {
      const av = m.avatar || cmEmoji(m.id);
      const avh = av.startsWith("data:") ? `<div class="cm-av" style="background-image:url('${escAttr(av)}')"></div>` : `<div class="cm-av cm-emoji">${av}</div>`;
      const t = m.method === "fusion" ? "fuse" : m.method === "train" ? "train" : "mine";
      const badge = t === "fuse" ? "\u{1F9EC} \uD569\uC131" : t === "train" ? "\u{1F331} \uD559\uC2B5" : "\u{1F916} \uB0B4 \uBAA8\uB378";
      const nm = m.name || m.id.split("/").pop();
      return `<div class="cm-card cm-${t}" data-id="${escAttr(m.id)}" title="${escAttr(m.id)} \u2014 \uD074\uB9AD\uD574\uC11C \uAFB8\uBBF8\uAE30">
      <span class="cm-rib">${badge}</span>${avh}
      <div class="cm-name">${escapeHtml(nm)}</div>
      <div class="cm-personality">${m.personality ? escapeHtml(m.personality) : "\uFF0B \uD074\uB9AD\uD574 \uAFB8\uBBF8\uAE30"}</div></div>`;
    }).join("") + "</div>";
    el.querySelectorAll(".cm-card").forEach((c) => c.addEventListener("click", () => openCreatedDetail(c.dataset.id)));
  }
  function openCreatedDetail(id) {
    const m = _createdCache.find((x) => x.id === id) || { id };
    const cur = m.avatar || cmEmoji(id);
    const picks = CM_EMOJI.map((e) => `<button class="cm-pick${e === cur ? " on" : ""}" data-e="${e}">${e}</button>`).join("");
    const body = $("createdModels");
    if (!body) return;
    const back = body.innerHTML;
    body.innerHTML = `<div class="cm-detail">
    <button class="lf-ghost" id="cmBack">\u2190 \uB0B4 AI \uD300</button>
    <div class="cm-big" id="cmBig">${cur.startsWith("data:") ? `<img src="${escAttr(cur)}"/>` : cur}</div>
    <button class="lf-ghost" id="cmPhoto">\u{1F4F7} \uC0AC\uC9C4 \uC62C\uB9AC\uAE30</button><input type="file" id="cmPhotoFile" accept="image/*" hidden/>
    <input id="cmName" class="fuse-in" maxlength="24" value="${escAttr(m.name || id.split("/").pop() || "")}" placeholder="\u{1F3F7}\uFE0F \uC774\uB984"/>
    <input id="cmPers" class="fuse-in" maxlength="50" value="${escAttr(m.personality || "")}" placeholder="\u{1F60E} \uC131\uACA9\xB7\uD2B9\uC9D5 (\uC608: \uB370\uC774\uD130 \uC911\uC2EC\xB7\uC9C1\uC124\uC801)"/>
    <div class="cm-picks">${picks}</div>
    <div class="muted small" style="margin-top:2px">\u{1F916} ${escapeHtml(id)} \xB7 ${m.method === "fusion" ? "\u{1F9EC} \uD569\uC131" : m.method === "train" ? "\u{1F331} \uD559\uC2B5" : "\uB0B4 \uBAA8\uB378"}</div>
    <button class="oc-primary" id="cmSave" style="width:100%;margin-top:6px">\u{1F4BE} \uC800\uC7A5</button>
    <div class="cm-acts">
      <button class="cm-act" id="cmUse" title="\uC774 \uBAA8\uB378\uC744 \uC5D0\uC774\uC804\uD2B8\uB4E4\uC758 \uB450\uB1CC\uB85C \uCF1C\uC694 \u2014 \uD559\uC2B5\uC2DC\uD0A8 \uB9CC\uD07C \uD300\uC774 \uB611\uB611\uD574\uC838\uC694">\u{1F9E0} \uC6B0\uB9AC \uD300 \uB450\uB1CC\uB85C \uC4F0\uAE30</button>
      <button class="cm-act" id="cmFuse">\u{1F9EC} \uD569\uC131\uC5D0 \uB123\uAE30</button>
    </div>
    <div class="mem-status" id="cmStatus" style="margin-top:6px"></div></div>`;
    let pick2 = cur;
    $("cmBack")?.addEventListener("click", () => {
      body.innerHTML = back;
      body.querySelectorAll(".cm-card").forEach((c) => c.addEventListener("click", () => openCreatedDetail(c.dataset.id)));
    });
    body.querySelectorAll(".cm-pick").forEach((b) => b.addEventListener("click", () => {
      pick2 = b.dataset.e;
      body.querySelectorAll(".cm-pick").forEach((x) => x.classList.toggle("on", x === b));
      const big = $("cmBig");
      if (big) big.textContent = pick2;
    }));
    $("cmPhoto")?.addEventListener("click", () => $("cmPhotoFile")?.click());
    $("cmPhotoFile")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        pick2 = await downscaleImage(f);
        const big = $("cmBig");
        if (big) big.innerHTML = `<img src="${escAttr(pick2)}"/>`;
        body.querySelectorAll(".cm-pick").forEach((x) => x.classList.remove("on"));
        hint("\u{1F4F7} \uC0AC\uC9C4 \uC62C\uB9BC \u2014 \u{1F4BE} \uC800\uC7A5\uD558\uC138\uC694");
      } catch {
        hint("\uC0AC\uC9C4 \uCC98\uB9AC \uC2E4\uD328");
      }
    });
    $("cmSave")?.addEventListener("click", async () => {
      await connect.createdSave?.(id, { name: $("cmName")?.value.trim(), personality: $("cmPers")?.value.trim(), avatar: pick2 });
      hint("\u{1F4BE} \uC800\uC7A5\uD588\uC5B4\uC694");
      await renderCreatedModels();
    });
    $("cmFuse")?.addEventListener("click", () => {
      _surg.a = id;
      _surg.b = "";
      saveSurg();
      closeOverlay("aiPanel");
      openSurgery("merge");
      hint("\u{1F9EC} \uD569\uC131\uC18C\uC5D0 \u{1F170}\uB85C \uB123\uC5C8\uC5B4\uC694 \u2014 \u{1F171}\uB97C \uACE8\uB77C \uD569\uC131!");
    });
    $("cmUse")?.addEventListener("click", () => useCreatedModel(id));
  }
  async function useCreatedModel(id) {
    const st = $("cmStatus");
    const set = (h) => {
      if (st) st.innerHTML = h;
    };
    set('<span class="cyc-spin"></span> GGUF \uD30C\uC77C \uCC3E\uB294 \uC911\u2026');
    const r = await connect.hfFiles?.(id).catch(() => null);
    const files = r?.ok ? r.files || [] : [];
    if (!files.length) {
      set("\u26A0\uFE0F \uC774 \uBAA8\uB378\uC5D4 \uCF24 \uC218 \uC788\uB294 GGUF\uAC00 \uC5C6\uC5B4\uC694. (\uD559\uC2B5\xB7\uD569\uC131 \uACB0\uACFC\uC5D4 GGUF \uD3EC\uD568 \u2014 \uADF8\uAC78\uB85C \uD574\uBCF4\uC138\uC694)");
      return;
    }
    const pickF = files.find((f) => /q4_k_m/i.test(f.path || f.quant)) || files[0];
    set(`<span class="cyc-spin"></span> ${escapeHtml(pickF.quant || "GGUF")} \uBC1B\uB294 \uC911\u2026 (\uD070 \uD30C\uC77C\uC774\uB77C \uBA87 \uBD84)`);
    const d = await connect.hfDownload?.(id, pickF.path).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (!d?.ok) {
      set(`\u26A0\uFE0F \uBC1B\uAE30 \uC2E4\uD328: ${escapeHtml(d?.error || "")}`);
      return;
    }
    set('<span class="cyc-spin"></span> Brain \uC5D4\uC9C4 \uCF1C\uB294 \uC911\u2026 (\uBAA8\uB378 \uB85C\uB529 1~2\uBD84)');
    const s = await connect.localStart?.(d.path).catch((e) => ({ running: false, error: String(e?.message || e) }));
    _localStatus = s;
    if (!s?.running) {
      set(`\u26A0\uFE0F \uBAA8\uB378\uC740 \uBC1B\uC558\uB294\uB370 \uC5D4\uC9C4 \uCF1C\uAE30 \uC2E4\uD328: ${escapeHtml(s?.error || "\uC2DC\uC791 \uC2E4\uD328")}. \u{1F916} \uB0B4 AI\uC5D0\uC11C \uC9C1\uC811 \uCF1C\uBCF4\uC138\uC694.`);
      return;
    }
    await connect.setConfig?.({ llmBase: LOCAL_BASE, llmModel: s.modelName });
    await loadLocalAI();
    await renderAiCurrent();
    try {
      await refreshTeamBrain();
    } catch {
    }
    set(`\u{1F389} <b>${escapeHtml(id.split("/").pop() || "")}</b> = \uD300 Brain. \uC5D0\uC774\uC804\uD2B8\uAC00 \uC774 \uBAA8\uB378\uB85C \uCD94\uB860\uD574\uC694. \u{1F680} \uC6B4\uC601 \uC2DC\uC791\uC73C\uB85C \uC2E4\uD589.`);
  }
  function renderOfficePreview() {
    const el = $("officePreview");
    if (!el) return;
    el.style.backgroundImage = `url('${OFFICE_BG}')`;
    el.innerHTML = AGENT_ORDER.map((id, i) => {
      const a = AGENTS[id];
      if (!a) return "";
      const [x, y] = VO_HOME[id] || [50, 50];
      const im = agImgSrc(id);
      const inner = im ? `<div class="opc-av" style="background-image:url('${escAttr(im)}')"></div>` : `<div class="opc-av opc-emoji">${a.emoji}</div>`;
      return `<div class="op-char" style="left:${x}%;top:${y}%;animation-delay:${i % 6 * 0.35}s">${inner}</div>`;
    }).join("") + `<div class="op-expand">\u2922 \uD06C\uAC8C \uBCF4\uAE30</div>`;
  }
  function renderTeamRoster() {
    const el = $("teamRoster");
    if (!el) return;
    el.innerHTML = AGENT_ORDER.map((id) => {
      const a = AGENTS[id];
      if (!a) return "";
      const im = agImgSrc(id);
      const av = im ? `<div class="tr-av" style="background-image:url('${escAttr(im)}');border-color:${a.color}"></div>` : `<div class="tr-av tr-av-emoji" style="border-color:${a.color};background:color-mix(in srgb,${a.color} 22%,#0a120c)">${a.emoji}</div>`;
      const brain = (cfg.agentModels || {})[id];
      const brainLabel = brain ? brain.length > 14 ? brain.slice(0, 13) + "\u2026" : brain : "\uACF5\uC6A9 \uB450\uB1CC";
      return `<div class="tr-card${brain ? " has-brain" : ""}" data-id="${id}" style="--ag:${a.color}" title="${escAttr(a.role)} \u2014 \uD074\uB9AD\uD574\uC11C \uC774\uB984\xB7\uC5BC\uAD74\xB7\uB450\uB1CC \uBC14\uAFB8\uAE30">
      ${av}
      <div class="tr-info"><div class="tr-name">${escapeHtml(agName(id))}</div><div class="tr-brain">\u{1F9E0} ${escapeHtml(brainLabel)}</div></div>
    </div>`;
    }).join("");
    el.querySelectorAll(".tr-card").forEach((c) => c.addEventListener("click", () => openAgentDetail(c.dataset.id)));
  }
  $("officePreview")?.addEventListener("click", () => connect.officeOpen?.());
  $("dashTeamBtn")?.addEventListener("click", () => {
    openOverlay("aiPanel");
    loadAiPanel();
  });
  var opsWait = (ms) => new Promise((r) => setTimeout(r, ms));
  var OPS_SCAN = [
    ["youtube", "\uC720\uD29C\uBE0C \uCC44\uB110 \uBD84\uC11D \uC911\u2026 \uC0C1\uC704 \uC601\uC0C1\xB7\uC2DC\uCCAD\uCE35 \uD3EC\uCC29"],
    ["business", "\uD398\uC774\uD314 \uB9E4\uCD9C \uC2A4\uCE94 \uC911\u2026 \uC774\uBC88 \uB2EC \uC9D1\uACC4 \uC644\uB8CC"],
    ["developer", "\uC6F9\uC0AC\uC774\uD2B8\xB7\uCF54\uB4DC \uC810\uAC80 \uC911\u2026 \uBC30\uD3EC \uC0C1\uD0DC OK"],
    ["designer", "\uBE44\uC8FC\uC5BC \uC790\uC0B0 \uD655\uC778 \uC911\u2026 \uBE0C\uB79C\uB4DC \uC77C\uAD00\uC131 \uC810\uAC80"],
    ["secretary", "\uC791\uC804 \uC885\uD569 \uC911\u2026 \uC218\uC775\uD654 \uAE30\uD68C \uC815\uB9AC"]
  ];
  var opsRaf = 0;
  var opsAutoTimer = 0;
  var opsRunning = false;
  function startOpsRain() {
    const cv = $("opsRain");
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    const cols = Math.floor(cv.width / 16);
    const drops = new Array(cols).fill(0).map(() => Math.random() * -cv.height);
    const chars = "\u30A2\u30A4\u30A6\u30A8\u30AA\u30AB\u30AD\u30AF\u30B1\u30B3\u30B5\u30B70123456789ABCDEF<>/{}#$%";
    const draw = () => {
      ctx.fillStyle = "rgba(2,8,4,0.10)";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.font = "15px monospace";
      for (let i = 0; i < cols; i++) {
        const c = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillStyle = Math.random() > 0.94 ? "#b6ffce" : "#22c55e";
        ctx.fillText(c, i * 16, drops[i]);
        drops[i] = drops[i] > cv.height && Math.random() > 0.975 ? 0 : drops[i] + 16;
      }
      opsRaf = requestAnimationFrame(draw);
    };
    draw();
  }
  function stopOpsRain() {
    if (opsRaf) cancelAnimationFrame(opsRaf);
    opsRaf = 0;
  }
  function closeOps() {
    if (opsAutoTimer) {
      clearTimeout(opsAutoTimer);
      opsAutoTimer = 0;
    }
    const cin = $("opsCinema");
    cin.classList.remove("show");
    cin.classList.add("out");
    stopOpsRain();
    opsRunning = false;
    setTimeout(() => {
      cin.setAttribute("hidden", "");
      cin.classList.remove("out");
    }, 480);
  }
  async function startOps() {
    if (opsRunning) return;
    const ls = _localStatus || await connect.localStatus?.().catch(() => null);
    if (!ls?.running && !cfg.llmModel) {
      hint("\uBA3C\uC800 \u{1F916} \uC5D0\uC11C AI \uB450\uB1CC\uB97C \uCF1C\uC8FC\uC138\uC694 \u2014 \uADF8\uB798\uC57C \uD300\uC774 \uC77C\uD574\uC694");
      openOverlay("aiPanel");
      loadAiPanel();
      return;
    }
    opsRunning = true;
    const cin = $("opsCinema"), stage = $("opsStage");
    if (!cin || !stage) {
      opsRunning = false;
      return;
    }
    cin.removeAttribute("hidden");
    requestAnimationFrame(() => cin.classList.add("show"));
    startOpsRain();
    const opsP = (connect.opsStart?.() || Promise.resolve(null)).catch(() => null);
    const company = cfg.company && cfg.company !== "1\uC778 \uAE30\uC5C5" ? cfg.company : "\uB0B4 \uD68C\uC0AC";
    stage.innerHTML = `<div class="ops-boot">
    <div class="ops-logo">\u2726 CONNECT AI</div>
    <div class="ops-tag">${escapeHtml(company)} \xB7 \uC6B4\uC601 \uAC1C\uC2DC</div>
    <div class="ops-bar"><div class="ops-bar-fill" id="opsBarFill"></div></div>
    <div class="ops-sub" id="opsSub">INITIALIZING</div>
  </div>`;
    await opsWait(60);
    const bf = $("opsBarFill");
    if (bf) bf.style.width = "100%";
    for (const s of ["\uB450\uB1CC \uB85C\uB529\u2026", "\uD300 \uD638\uCD9C\u2026", "\uC5F0\uB3D9 \uC810\uAC80\u2026"]) {
      const sub = $("opsSub");
      if (sub) sub.textContent = s;
      await opsWait(440);
    }
    await opsWait(280);
    if (!opsRunning) return;
    stage.innerHTML = `<div class="ops-act"><div class="ops-h">\uD300 \uAE30\uC0C1</div><div class="ops-roster" id="opsRoster"></div></div>`;
    const roster = $("opsRoster");
    for (const id of AGENT_ORDER) {
      const a = AGENTS[id];
      if (!a || !roster) continue;
      const im = agImgSrc(id);
      const av = im ? `<div class="ow-av" style="background-image:url('${escAttr(im)}');border-color:${a.color}"></div>` : `<div class="ow-av ow-emoji" style="border-color:${a.color};background:color-mix(in srgb,${a.color} 22%,#020804)">${a.emoji}</div>`;
      const el = document.createElement("div");
      el.className = "ow-card";
      el.style.setProperty("--ag", a.color);
      el.innerHTML = `${av}<div class="ow-name">${escapeHtml(agName(id))}</div><div class="ow-on">\u25CF ONLINE</div>`;
      roster.appendChild(el);
      requestAnimationFrame(() => el.classList.add("in"));
      await opsWait(160);
    }
    await opsWait(550);
    if (!opsRunning) return;
    stage.innerHTML = `<div class="ops-act"><div class="ops-h">\uC790\uC0B0 \uC2A4\uCE94</div><div class="ops-lines" id="opsLines"></div></div>`;
    const ops = await opsP;
    const scanItems = ops?.scan?.length ? ops.scan : OPS_SCAN.map(([agent, label]) => ({ agent, label, ok: true }));
    const lines = $("opsLines");
    for (const s of scanItems) {
      const a = AGENTS[s.agent] || { emoji: "\u25B8", color: "#39ff14" };
      if (!lines) break;
      const el = document.createElement("div");
      el.className = "os-line" + (s.ok ? "" : " os-skip");
      el.style.setProperty("--ag", a.color);
      el.innerHTML = `<span class="os-who">${a.emoji} ${escapeHtml(agName(s.agent))}</span><span class="os-txt"></span><span class="os-ok">${s.ok ? "\u2713" : "\u2014"}</span>`;
      lines.appendChild(el);
      requestAnimationFrame(() => el.classList.add("in"));
      const tEl = el.querySelector(".os-txt");
      const txt = s.label;
      for (let i = 0; i <= txt.length; i += 2) {
        tEl.textContent = txt.slice(0, i);
        await opsWait(10);
      }
      tEl.textContent = txt;
      el.classList.add("done");
      await opsWait(240);
    }
    await opsWait(600);
    if (!opsRunning) return;
    stage.innerHTML = `<div class="ops-act"><div class="ops-h">\uBE44\uC988\uB2C8\uC2A4 \uBD84\uC11D</div><div class="ops-analyze" id="opsAnalyze"></div></div>`;
    const az = $("opsAnalyze");
    const insights = [
      ["\u{1F4C8}", "\uB9E4\uCD9C\xB7\uD2B8\uB798\uD53D \uD328\uD134 \uAD50\uCC28 \uBD84\uC11D"],
      ["\u{1F3AF}", "\uC218\uC775\uD654 \uAE30\uD68C \uD3EC\uCC29"],
      ["\u{1F9E0}", "\uB0B4 \uC9C0\uC2DD\xB7\uB178\uD558\uC6B0 \uC5F0\uACB0"],
      ["\u{1F9E9}", `\uC624\uB298\uC758 \uC131\uC7A5 \uC0AC\uC774\uD074 \uC124\uACC4 (\uC791\uC804 ${ops?.actions?.length || 3}\uAC1C)`]
    ];
    for (const [ic, label] of insights) {
      if (!az || !opsRunning) break;
      const row = document.createElement("div");
      row.className = "oz-row";
      row.innerHTML = `<span class="oz-ic">${ic}</span><span class="oz-tx">${escapeHtml(label)}</span><span class="oz-bar"><span class="oz-fill"></span></span><span class="oz-ok">\u2713</span>`;
      az.appendChild(row);
      requestAnimationFrame(() => row.classList.add("in"));
      const fill = row.querySelector(".oz-fill");
      await opsWait(80);
      if (fill) fill.style.width = "100%";
      await opsWait(640);
      row.classList.add("done");
    }
    await opsWait(560);
    if (!opsRunning) return;
    const summary = ops?.summary ? `<div class="ops-summary">\u201C${escapeHtml(ops.summary)}\u201D</div>` : "";
    stage.innerHTML = `<div class="ops-act ops-plan"><div class="ops-h ops-h-big">\u2713 \uBD84\uC11D \uC644\uB8CC</div>${summary}<div class="ops-note">\uC624\uB298\uC758 <b>\uD50C\uB79C</b>\uC774 \uC900\uBE44\uB410\uC5B4\uC694 \u2014 \u{1F916} AI \uBAAB\uACFC \u{1F64B} \uB0B4 \uBAAB\uC744 \uD655\uC778\uD558\uACE0 \uC2E4\uD589\uD558\uC138\uC694</div><button class="ops-go" id="opsGo">\u{1F5FA}\uFE0F \uC624\uB298\uC758 \uD50C\uB79C \uC5F4\uAE30 \u2192</button></div>`;
    const finish = () => {
      closeOps();
      openCyclePanel();
    };
    $("opsGo")?.addEventListener("click", finish);
    opsAutoTimer = window.setTimeout(finish, 4500);
  }
  var opsActive = false;
  function setOpsBtn(active) {
    opsActive = active;
    const b = $("opsStartBtn");
    if (!b) return;
    b.classList.toggle("active", active);
    b.innerHTML = (active ? "\u23F9 \uC6B4\uC601 \uC911\uB2E8" : "\u{1F680} \uC6B4\uC601 \uC2DC\uC791") + ' <span class="ops-beta">BETA</span>';
    b.title = active ? "\uC6B4\uC601 \uC0AC\uC774\uD074\uC744 \uBA48\uCDA5\uB2C8\uB2E4 (\uBCA0\uD0C0)" : "\uC6B4\uC601 \uC2DC\uC791 (\uBCA0\uD0C0) \u2014 \uBD84\uC11D \u2192 \uC791\uC804 \uAC80\uD1A0 \u2192 \uC2E4\uD589 \uC0AC\uC774\uD074\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4";
  }
  $("opsStartBtn")?.addEventListener("click", async () => {
    if (opsActive) {
      await connect.opsStop?.();
      setOpsBtn(false);
      hint("\u23F9 \uC790\uC728 \uC6B4\uC601\uC744 \uBA48\uCDC4\uC5B4\uC694");
    } else {
      startOps();
    }
  });
  $("opsSkip")?.addEventListener("click", closeOps);
  var _ops = null;
  function openCyclePanel() {
    openOverlay("opsCyclePanel");
    renderGrass();
    connect.opsStatus?.().then((s) => {
      _ops = s;
      renderCycle(s);
    }).catch(() => {
    });
  }
  function shipFor(s, title) {
    return (s.shipped || []).find((x) => x.title === title);
  }
  var fileIcon = (name) => {
    if (/\.(md|markdown)$/i.test(name)) return "\u{1F4C4}";
    if (/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(name)) return "\u{1F5BC}\uFE0F";
    if (/\.(mp4|mov|avi|mkv|webm)$/i.test(name)) return "\u{1F3AC}";
    if (/\.(mp3|wav|m4a|aac)$/i.test(name)) return "\u{1F3B5}";
    if (/\.(json|jsonl|csv|xlsx?)$/i.test(name)) return "\u{1F4CA}";
    if (/\.(py|js|ts|tsx|jsx|go|rs)$/i.test(name)) return "\u{1F4BB}";
    if (/\.(html|css)$/i.test(name)) return "\u{1F310}";
    if (/\.(zip|tar|gz|7z)$/i.test(name)) return "\u{1F4E6}";
    return "\u{1F4CE}";
  };
  function artsHtml(ship) {
    const arr = ship?.artifacts || [];
    if (!arr.length) return "";
    const files = ship?.files || [];
    return `<div class="cyc-arts">${arr.map((x) => {
      const m = x.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
      const icon = m ? m[1] : fileIcon(x);
      const label = m ? m[2] : x;
      const name = label.split("/").pop() || label;
      const file = files.find((f) => (f.split("/").pop() || f) === name) || "";
      return `<span class="cyc-art${file ? " openable" : ""}" data-icon="${icon}"${file ? ` data-file="${escAttr(file)}"` : ""} title="${escapeHtml(file ? label + " \u2014 \uD074\uB9AD\uD574\uC11C \uC5F4\uAE30" : label)}">${escapeHtml(name)}</span>`;
    }).join("")}</div>`;
  }
  $("opsCyclePanel")?.addEventListener("click", async (e) => {
    const el = e.target?.closest?.(".cyc-art.openable");
    if (!el?.dataset.file) return;
    const r = await connect.opsOpenArtifact?.(el.dataset.file);
    hint(r?.ok ? "\u{1F4C4} \uD30C\uC77C\uC744 \uC5F4\uC5C8\uC5B4\uC694" : r?.reason || "\uD30C\uC77C\uC744 \uBABB \uC5F4\uC5C8\uC5B4\uC694");
  });
  var dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function loadGrass() {
    try {
      return JSON.parse(localStorage.getItem("growth_grass") || "{}");
    } catch {
      return {};
    }
  }
  function markGrassToday(n = 1) {
    const g = loadGrass();
    const k = dayKey(/* @__PURE__ */ new Date());
    g[k] = Math.min(3, (g[k] || 0) + n);
    localStorage.setItem("growth_grass", JSON.stringify(g));
    renderGrass();
  }
  function grassStreak() {
    const g = loadGrass();
    let s = 0;
    const d = /* @__PURE__ */ new Date();
    for (; ; ) {
      if ((g[dayKey(d)] || 0) > 0) {
        s++;
        d.setDate(d.getDate() - 1);
      } else break;
    }
    return s;
  }
  function grassTotal() {
    const g = loadGrass();
    return Object.values(g).filter((v) => v > 0).length;
  }
  function weekStrip() {
    const g = loadGrass();
    const today = /* @__PURE__ */ new Date();
    const sun = new Date(today);
    sun.setDate(today.getDate() - today.getDay());
    const LBL = ["\uC77C", "\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0"];
    let dots = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(sun);
      d.setDate(sun.getDate() + i);
      const done = (g[dayKey(d)] || 0) > 0, isToday = dayKey(d) === dayKey(today), future = d > today;
      dots += `<span class="wk-day${done ? " done" : ""}${isToday ? " today" : ""}${future ? " future" : ""}"><span class="wk-dot">${done ? "\u2713" : ""}</span><span class="wk-lb">${LBL[i]}</span></span>`;
    }
    return `<div class="week-strip"><span class="wk-streak">\u{1F525} ${grassStreak()}<span class="wk-streak-u">\uC77C \uC5F0\uC18D</span></span><div class="wk-days">${dots}</div></div>`;
  }
  var CATS = [
    { key: "idea", ic: "\u{1F4A1}", name: "\uC544\uC774\uB514\uC5B4" },
    { key: "manage", ic: "\u{1F5C2}\uFE0F", name: "\uAD00\uB9AC" },
    { key: "analyze", ic: "\u{1F4CA}", name: "\uC790\uC0B0 \uBD84\uC11D" },
    { key: "market", ic: "\u{1F4E3}", name: "\uB9C8\uCF00\uD305" }
  ];
  function catOf(title) {
    const t = String(title || "");
    if (/마케팅|유튜브|인스타|쓰레드|틱톡|발행|콘텐츠|업로드|썸네일|영상|홍보|sns|게시|광고|릴스|쇼츠/i.test(t)) return "market";
    if (/분석|리포트|진단|매출|지표|트래픽|경쟁|시장조사|데이터|자산|현황|kpi|통계/i.test(t)) return "analyze";
    if (/아이디어|기획|새 ?서비스|컨셉|바이브|프로토타입|mvp|런칭|출시|차린|신규|제품 ?개발/i.test(t)) return "idea";
    return "manage";
  }
  function catMeta(k) {
    return CATS.find((c) => c.key === k) || CATS[1];
  }
  function loadActivity() {
    try {
      return JSON.parse(localStorage.getItem("growth_activity") || "[]");
    } catch {
      return [];
    }
  }
  function track(type, title, cat, pts = 1, icon = "\u2705") {
    const a = loadActivity();
    a.unshift({ ts: Date.now(), type, title: String(title || "").slice(0, 80), cat, pts, icon });
    localStorage.setItem("growth_activity", JSON.stringify(a.slice(0, 300)));
    if (pts > 0) markGrassToday(pts);
    else renderGrass();
    patchActivity();
  }
  function todayActs() {
    const k = dayKey(/* @__PURE__ */ new Date());
    return loadActivity().filter((e) => dayKey(new Date(e.ts)) === k);
  }
  function catCountToday(cat) {
    return todayActs().filter((e) => e.cat === cat).length;
  }
  function trackedCycles() {
    try {
      return JSON.parse(localStorage.getItem("growth_tracked_cycles") || "[]");
    } catch {
      return [];
    }
  }
  function markCycleTracked(c) {
    const s = trackedCycles();
    if (!s.includes(c)) {
      s.push(c);
      localStorage.setItem("growth_tracked_cycles", JSON.stringify(s.slice(-200)));
    }
  }
  function activityTimeline() {
    const t = todayActs().slice(0, 8);
    if (!t.length) return '<div class="act-tl" id="actTl"></div>';
    return `<div class="act-tl" id="actTl"><div class="act-tl-h">\u{1F4DC} \uC624\uB298 \uD55C \uC77C</div>${t.map((e) => {
      const c = catMeta(e.cat);
      return `<div class="act-row"><span class="act-ago">${feedAgo(e.ts)}</span><span class="act-ic">${e.icon || "\u2705"}</span><span class="act-tx">${escapeHtml(e.title)}</span><span class="act-cat" title="${c.name}">${c.ic}</span>${e.pts ? `<span class="act-pt">+${e.pts}</span>` : ""}</div>`;
    }).join("")}</div>`;
  }
  function patchActivity() {
    const g = $("catGrid");
    if (g) g.innerHTML = CATS.map((c) => {
      const n = catCountToday(c.key);
      return `<div class="cat-card" data-cat="${c.key}"><span class="cc-ic">${c.ic}</span><span class="cc-n">${c.name}</span><span class="cc-cnt${n ? " on" : ""}">${n ? `\uC624\uB298 ${n}\uAC74` : "\uB300\uAE30"}</span></div>`;
    }).join("");
    const tl = $("actTl");
    if (tl) tl.outerHTML = activityTimeline();
  }
  var OP_RANKS = [
    { min: 0, ic: "\u{1F331}", name: "\uC0C8\uC2F9 \uCC3D\uC5C5\uAC00" },
    { min: 3, ic: "\u{1F33F}", name: "\uB8E8\uD0A4" },
    { min: 7, ic: "\u26A1", name: "\uC6B4\uC601\uC790" },
    { min: 14, ic: "\u{1F4C8}", name: "\uC131\uC7A5 \uAE30\uC5C5\uAC00" },
    { min: 30, ic: "\u{1F680}", name: "\uC2A4\uCF00\uC77C\uB7EC" },
    { min: 60, ic: "\u{1F48E}", name: "\uD504\uB85C" },
    { min: 120, ic: "\u{1F451}", name: "\uB9C8\uC2A4\uD130" }
  ];
  function currentRank() {
    const s = grassTotal();
    let i = 0;
    for (let k = 0; k < OP_RANKS.length; k++) if (s >= OP_RANKS[k].min) i = k;
    return OP_RANKS[i];
  }
  function renderGrass() {
    const el = $("growthGrass");
    if (!el) return;
    const g = loadGrass();
    const WEEKS = 18;
    const today = /* @__PURE__ */ new Date();
    const dow = today.getDay();
    const start = new Date(today);
    start.setDate(start.getDate() - dow - (WEEKS - 1) * 7);
    let max = 0;
    let cells = "";
    for (let w = 0; w < WEEKS; w++) {
      cells += '<div class="gg-col">';
      for (let dy = 0; dy < 7; dy++) {
        const d = new Date(start);
        d.setDate(start.getDate() + w * 7 + dy);
        if (d > today) {
          cells += '<div class="gg-cell gg-future"></div>';
          continue;
        }
        const lv = g[dayKey(d)] || 0;
        max = Math.max(max, lv);
        const isToday = dayKey(d) === dayKey(today);
        cells += `<div class="gg-cell gg-l${lv}${isToday ? " gg-today" : ""}" title="${dayKey(d)} \xB7 ${lv ? lv + "\uB2E8\uACC4 \uC644\uC8FC" : "\uBBF8\uC644"}"></div>`;
      }
      cells += "</div>";
    }
    const streak = grassStreak();
    el.innerHTML = `<div class="gg-head"><span class="gg-flame">\u{1F525} ${streak}\uC77C \uC5F0\uC18D</span><span class="gg-total">\uC62C\uD574 ${grassTotal()}\uC77C \uC644\uC8FC</span></div>
    <div class="gg-grid">${cells}</div>
    <div class="gg-legend"><span>\uC801\uC74C</span><i class="gg-l0"></i><i class="gg-l1"></i><i class="gg-l2"></i><i class="gg-l3"></i><span>\uB9CE\uC74C</span>${streak >= 2 ? `<span class="gg-keep">\uB04A\uAE30\uC9C0 \uB9C8\uC138\uC694! \u{1F525}</span>` : ""}</div>`;
  }
  async function runCycleIdea() {
    const res = $("cycIdeaResult");
    if (!res) return;
    res.innerHTML = `<div class="cyc-loading"><span class="cyc-spin"></span> \uB0B4 \uB370\uC774\uD130\uB97C \uBD84\uC11D \uC911\u2026 (\uC11C\uBE44\uC2A4\xB7\uB9E4\uCD9C\xB7\uC720\uD29C\uBE0C\xB7\uAE43\uD5C8\uBE0C\xB7\uC774\uBA54\uC77C\xB7\uC9C0\uC2DD)</div>`;
    let r = null;
    try {
      r = await connect.cycleIdea?.();
    } catch (e) {
      r = { ok: false, error: String(e?.message || e) };
    }
    if (!r?.ok) {
      res.innerHTML = `<div class="cyc-idea-err">\u26A0\uFE0F ${escapeHtml(r?.error || "\uC81C\uC548 \uC0DD\uC131 \uC2E4\uD328")}</div><button class="cyc-btn ghost" id="ideaRetry">\u{1F504} \uB2E4\uC2DC</button>`;
      $("ideaRetry")?.addEventListener("click", runCycleIdea);
      return;
    }
    const i = r.idea;
    const used = r.dataUsed ? Object.entries(r.dataUsed).filter(([, v]) => v).map(([k]) => ({ services: "\uC11C\uBE44\uC2A4", revenue: "\uB9E4\uCD9C", youtube: "\uC720\uD29C\uBE0C", github: "\uAE43\uD5C8\uBE0C" })[k] || k).join(" \xB7 ") : "";
    res.innerHTML = `<div class="cyc-idea-card">
    <div class="cyc-idea-title">\u{1F4A1} ${escapeHtml(i.title || "\uC0C8 \uC11C\uBE44\uC2A4")}</div>
    <div class="cyc-idea-row"><b>\uBB34\uC5C7\uC744</b><span>${escapeHtml(i.what || "")}</span></div>
    ${i.how ? `<div class="cyc-idea-row"><b>\uB9CC\uB4DC\uB294 \uBC95</b><span>\u{1F6E0}\uFE0F ${escapeHtml(i.how)}</span></div>` : ""}
    <div class="cyc-idea-row"><b>\uC65C \uC9C0\uAE08</b><span>${escapeHtml(i.why || "")}</span></div>
    <div class="cyc-idea-meta"><span>\u{1F3AF} ${escapeHtml(i.market || "-")}</span><span>\u{1F4B0} ${escapeHtml(i.price || "-")}</span></div>
    <div class="cyc-idea-first">\u{1F680} <b>\uC624\uB298 \uD560 \uCCAB \uD589\uB3D9</b> \u2014 ${escapeHtml(i.firstStep || "")}</div>
    ${used ? `<div class="cyc-idea-src">\u{1F4CA} \uBD84\uC11D\uD55C \uB0B4 \uB370\uC774\uD130: ${escapeHtml(used)}</div>` : '<div class="cyc-idea-src muted">\u26A0\uFE0F \uC5F0\uACB0\uB41C \uB370\uC774\uD130\uAC00 \uC801\uC5B4\uC694 \u2014 \u{1F5C2}\uFE0F \uAD00\uB9AC\uC5D0\uC11C \uC11C\uBE44\uC2A4\xB7\uB9E4\uCD9C\xB7\uC720\uD29C\uBE0C\uB97C \uC5F0\uACB0\uD558\uBA74 \uC81C\uC548\uC774 \uC815\uD655\uD574\uC838\uC694</div>'}
    <div class="cyc-idea-btns">
      <button class="cyc-btn primary" id="ideaAccept">\u2705 \uC218\uB77D \u2014 \uD560 \uC77C\uB85C \uB9CC\uB4E4\uAE30</button>
      <button class="cyc-btn ghost" id="ideaPass">\u23ED\uFE0F \uD328\uC2A4</button>
      <button class="cyc-btn ghost" id="ideaRetry">\u{1F504} \uB2E4\uC2DC \uC81C\uC548</button>
    </div>
    <div class="cyc-idea-help muted small">\u{1F64B} \uC774\uAC74 <b>\uC0AC\uB78C(\uC0AC\uC7A5\uB2D8)\uC774 \uC9C1\uC811</b> \uB9CC\uB4DC\uB294 \uAC70\uC608\uC694. \uC5B4\uB5BB\uAC8C \uB9CC\uB4E4\uC9C0 \uBAA8\uB974\uACA0\uC73C\uBA74 \u2192 <a id="ideaLab">Connect AI Lab \uBC14\uC774\uBE0C\uCF54\uB529 \uAC15\uC758</a> \uBCF4\uC138\uC694.</div>
  </div>`;
    $("ideaAccept")?.addEventListener("click", () => {
      const title = `[1\uC778\uAE30\uC5C5 \uC544\uC774\uB514\uC5B4] ${i.title} \u2014 \uCCAB \uD589\uB3D9: ${i.firstStep}`;
      connect.tasksAdd?.(title).catch(() => {
      });
      const cyc = _ops?.cycle || 1;
      setSecDone(cyc, "idea");
      track("idea", i.title || "\uC0C8 \uC544\uC774\uB514\uC5B4 \uC218\uB77D", "idea", 1, "\u{1F4A1}");
      res.innerHTML = `<div class="cyc-idea-accepted">\u2705 "${escapeHtml(i.title)}" \uD560 \uC77C\uB85C \uB4F1\uB85D\uD588\uC5B4\uC694!<br><span class="muted small">\u{1F4CB} \uD0DC\uC2A4\uD06C \uBCF4\uB4DC\uC5D0\uC11C \uD655\uC778 \u2014 \uC624\uB298 \uCCAB \uD589\uB3D9\uBD80\uD130 \uC2DC\uC791\uD558\uC138\uC694 \u{1F680}</span><br><span class="gg-mini">\u{1F7E9} \uC624\uB298 \uC794\uB514 +1 \xB7 \u{1F525} ${grassStreak()}\uC77C \uC5F0\uC18D</span></div>`;
      refreshCycleProgress(cyc);
      hint(`\u2705 \uC544\uC774\uB514\uC5B4 \uC218\uB77D: ${i.title} \u2014 \uD560 \uC77C\uB85C \uB4F1\uB85D\uB410\uC5B4\uC694`);
    });
    $("ideaPass")?.addEventListener("click", () => {
      res.innerHTML = `<div class="muted small">\u23ED\uFE0F \uD328\uC2A4\uD588\uC5B4\uC694. \uB2E4\uC2DC \uBC1B\uC73C\uB824\uBA74 \uC704 \uBC84\uD2BC\uC744 \uB204\uB974\uC138\uC694.</div>`;
    });
    $("ideaRetry")?.addEventListener("click", runCycleIdea);
    $("ideaLab")?.addEventListener("click", () => connect.openExternal?.("https://aicitybuilders.com"));
  }
  function cycleProg() {
    try {
      return JSON.parse(localStorage.getItem("growth_cycle_prog") || "{}");
    } catch {
      return {};
    }
  }
  function getSecDone(cyc) {
    return cycleProg()[String(cyc)] || {};
  }
  function setSecDone(cyc, key) {
    const p = cycleProg();
    const k = String(cyc);
    p[k] = { ...p[k] || {}, [key]: true };
    localStorage.setItem("growth_cycle_prog", JSON.stringify(p));
  }
  var _mktRunning = false;
  function mdToHtml(md2) {
    const lines = (md2 || "").replace(/\r/g, "").split("\n");
    const inline = (t) => escapeHtml(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
    let html = "", inList = false;
    const closeList = () => {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    };
    for (const raw of lines) {
      const l = raw.trimEnd();
      if (/^#{1,6}\s/.test(l)) {
        closeList();
        const lvl = Math.min(l.match(/^#+/)[0].length + 1, 6);
        html += `<h${lvl} class="rp-h">${inline(l.replace(/^#+\s/, ""))}</h${lvl}>`;
      } else if (/^[-*]\s+/.test(l)) {
        if (!inList) {
          html += '<ul class="rp-ul">';
          inList = true;
        }
        html += `<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`;
      } else if (!l.trim()) {
        closeList();
      } else {
        closeList();
        html += `<p>${inline(l)}</p>`;
      }
    }
    closeList();
    return html;
  }
  var LOOP_PHASES = [
    { key: "planning", ic: "\u{1F50D}", t: "\uC0C1\uD669\uD30C\uC545" },
    { key: "review", ic: "\u{1F5FA}\uFE0F", t: "\uD50C\uB79C" },
    { key: "executing", ic: "\u26A1", t: "\uC2E4\uD589" },
    { key: "done", ic: "\u{1F44D}", t: "\uD53C\uB4DC\uBC31" }
  ];
  var LOOP_LABEL = { idle: "\uB300\uAE30", planning: "\u{1F50D} \uC0C1\uD669 \uD30C\uC545 \uC911\u2026", review: "\u{1F5FA}\uFE0F \uC624\uB298\uC758 \uD50C\uB79C", executing: "\u26A1 \uC2E4\uD589 \uC911\u2026", done: "\u{1F44D} \uD53C\uB4DC\uBC31\xB7\uD2B8\uB798\uD0B9" };
  function renderCycle(s) {
    if (!s) return;
    const panel = $("opsCyclePanel");
    if (!panel || panel.classList.contains("hidden")) return;
    _ops = s;
    buildOpsLoop(s);
  }
  function loopStepper(phase) {
    const order = ["planning", "review", "executing", "done"];
    const idx = order.indexOf(phase);
    return `<div class="loop-steps">${LOOP_PHASES.map((p, i) => `<div class="loop-step${i === idx ? " on" : ""}${idx > i ? " past" : ""}"><span class="ls-ic">${p.ic}</span><span class="ls-t">${p.t}</span></div>${i < 3 ? '<span class="ls-line"></span>' : ""}`).join("")}</div>`;
  }
  function buildOpsLoop(s) {
    const cyc = s.cycle || 1;
    const phase = s.phase || "idle";
    $("cycleNum").textContent = "#" + cyc;
    $("cyclePhase").textContent = LOOP_LABEL[phase] || "";
    $("cyclePhase").className = "cycle-phase ph-" + phase;
    const steps = $("cycleSteps");
    if (steps) steps.style.display = "none";
    const sm = $("cycleSummary");
    if (sm) {
      sm.textContent = s.summary ? "\u201C" + s.summary + "\u201D" : "";
      sm.style.display = s.summary ? "" : "none";
    }
    const body = $("cycleBody"), foot = $("cycleFoot");
    const head = phase !== "idle" ? loopStepper(phase) : "";
    if (phase === "idle") {
      const hasHistory = grassTotal() > 0;
      body.innerHTML = `<div class="loop-hero">
      <div class="lh-emoji">\u2728</div>
      <div class="lh-headline">\uC624\uB298\uB3C4 AI \uD300\uC774<br>\uAC19\uC774 \uC77C\uD574\uC918\uC694</div>
      <div class="lh-sub">\uBC84\uD2BC\uB9CC \uB204\uB974\uBA74 \u2014 AI\uAC00 <b>\uC624\uB298 \uD560 \uC77C</b>\uC744 \uC9DC\uB4DC\uB824\uC694.<br>\uB9C8\uC74C\uC5D0 \uB4DC\uB294 \uAC78 \uACE0\uB974\uAE30\uB9CC \uD558\uBA74 \uB05D\uC774\uC5D0\uC694.</div>
      <button class="cyc-btn primary lh-go" id="loopStart">\u25B6 \uC624\uB298 \uC6B4\uC601 \uC2DC\uC791</button>
      <div class="lh-cats">${CATS.map((c) => `<span class="lh-cat">${c.ic} ${c.name}</span>`).join("")}</div>
      ${hasHistory ? `<div class="lh-mini">\u{1F525} ${grassStreak()}\uC77C \uC5F0\uC18D \xB7 ${currentRank().ic} ${currentRank().name} \xB7 \uC62C\uD574 ${grassTotal()}\uC77C</div>` : ""}
    </div>`;
      foot.innerHTML = "";
    } else if (phase === "planning") {
      body.innerHTML = head + `<div class="cyc-loading"><span class="cyc-spin"></span> \uB9E4\uCD9C\xB7\uCF58\uD150\uCE20\xB7\uCF54\uB4DC\xB7\uD560\uC77C\uC744 \uC0B4\uD3B4 \uC624\uB298\uC758 \uD50C\uB79C\uC744 \uC9DC\uB294 \uC911\u2026</div>`;
      foot.innerHTML = "";
    } else if (phase === "review") {
      body.innerHTML = head + renderPlan(s);
      foot.innerHTML = `<button class="cyc-btn ghost" id="cycReplan">\u{1F504} \uB2E4\uC2DC</button><button class="cyc-btn primary" id="cycRun">\u25B6 \uC2E4\uD589</button>`;
      wirePlanToggles();
    } else if (phase === "executing") {
      body.innerHTML = head + renderExec(s);
      foot.innerHTML = `<button class="cyc-btn danger" id="cycStop">\u25A0 \uBA48\uCD94\uAE30</button>`;
    } else {
      body.innerHTML = head + renderFeedback(s);
      foot.innerHTML = `<button class="cyc-btn ghost" id="cycEnd">\u25A0 \uC6B4\uC601 \uC885\uB8CC</button><button class="cyc-btn primary" id="cycNext">\u25B6 \uB2E4\uC74C \uC0AC\uC774\uD074</button>`;
      const okN = (s.shipped || []).filter((x) => x.ok).length;
      const cyc2 = s.cycle || 1;
      if (okN > 0 && !trackedCycles().includes(cyc2)) {
        (s.shipped || []).filter((x) => x.ok).forEach((sh) => track("done", sh.title, catOf(sh.title), 0, "\u2705"));
        track("cycle", `\uC6B4\uC601 \uC0AC\uC774\uD074 #${cyc2} \uC644\uC8FC`, "manage", 2, "\u{1F3AF}");
        markCycleTracked(cyc2);
      }
    }
    renderGrass();
    wireLoop();
  }
  function renderPlan(s) {
    const acts = s.actions || [];
    if (!acts.length) return '<div class="cyc-loading">\uD50C\uB79C\uC774 \uC5C6\uC5B4\uC694 \u2014 \u{1F504} \uB2E4\uC2DC \uB20C\uB7EC\uBCF4\uC138\uC694</div>';
    const human = acts.filter((a) => a.assignee === "human");
    const ai = acts.filter((a) => a.assignee !== "human");
    const card = (a) => {
      const risky = a.risk && a.risk !== "safe";
      const me = a.assignee === "human";
      const an = AGENTS[a.agent]?.name || "\uC5D0\uC774\uC804\uD2B8";
      const ac = AGENTS[a.agent]?.color || "#39ff14";
      const cm = catMeta(a.cat || catOf(a.title));
      return `<label class="cyc-task${me ? " is-me" : ""}"><input type="checkbox" class="cyc-chk" data-title="${escAttr(a.title)}" checked><span class="cyc-box"></span><span class="cyc-cat" title="${cm.name}">${cm.ic}</span><span class="cyc-t">${escapeHtml(a.title)}</span><button type="button" class="cyc-who${me ? " me" : ""}" data-title="${escAttr(a.title)}" data-agent="${escAttr(an)}" style="--ag:${ac}" title="\uB2F4\uB2F9 \uBC14\uAFB8\uAE30">${me ? "\u{1F64B} \uB0B4\uAC00" : "\u{1F916} " + escapeHtml(an)}</button>${risky ? '<span class="cyc-risk">\uC2B9\uC778</span>' : ""}</label>`;
    };
    return `<div class="plan-grp"><div class="plan-h">\u{1F916} AI \uC5D0\uC774\uC804\uD2B8 <span class="plan-c">${ai.length}</span></div>${ai.map(card).join("") || '<div class="muted small">\uC5C6\uC74C</div>'}</div>
    <div class="plan-grp"><div class="plan-h me">\u{1F64B} \uC0AC\uC7A5\uB2D8 <span class="plan-c me">${human.length}</span></div>${human.map(card).join("") || '<div class="muted small">\uC5C6\uC74C</div>'}</div>
    <div class="cyc-legend">\uB2F4\uB2F9 \uCE69\uC744 \uB20C\uB7EC \uBC14\uAFC0 \uC218 \uC788\uC5B4\uC694</div>`;
  }
  function renderExec(s) {
    const tasks = (s.actions || []).map((a) => {
      const ship = shipFor(s, a.title);
      const running = s.executingTitle === a.title;
      let st = '<span class="cyc-st wait">\uB300\uAE30</span>';
      if (running) st = '<span class="cyc-st run"><span class="cyc-spin"></span> \uC2E4\uD589 \uC911</span>';
      else if (ship) st = ship.ok ? '<span class="cyc-st ok">\u2705</span>' : '<span class="cyc-st fail">\u2014</span>';
      return `<div class="cyc-task exec ${running ? "on" : ""}"><span class="cyc-t">${escapeHtml(a.title)}</span>${st}${ship ? artsHtml(ship) : ""}</div>`;
    }).join("");
    const feed = (s.feed || []).slice(0, 9);
    const feedHtml = feed.length ? `<div class="cyc-feed"><div class="cyc-feed-h"><span class="cyc-live-dot"></span>\uC2E4\uC2DC\uAC04 \uC791\uC5C5</div>${feed.map((f, i) => {
      const ag = AGENTS[f.agent];
      return `<div class="cyc-feed-line${f.ok === false ? " bad" : ""}${i === 0 ? " new" : ""}" style="--ag:${ag?.color || "#39ff14"}"><span class="cf-ic">${f.icon || "\u{1F527}"}</span><span class="cf-tx">${escapeHtml(f.text || "")}</span><span class="cf-ago">${feedAgo(f.ts)}</span></div>`;
    }).join("")}</div>` : "";
    return tasks + feedHtml;
  }
  function renderFeedback(s) {
    const done = (s.actions || []).map((a) => shipFor(s, a.title)).filter(Boolean);
    const okN = done.filter((x) => x.ok).length;
    const fbMap = {};
    (s.feedback || []).forEach((f) => {
      fbMap[f.title] = f.good;
    });
    const items = done.map((sh) => {
      const g = fbMap[sh.title];
      return `<div class="cyc-task exec"><span class="cyc-t">${escapeHtml(sh.title)}</span><span class="cyc-st ${sh.ok ? "ok" : "fail"}">${sh.ok ? "\u2705" : "\uBBF8\uC644"}</span><span class="fb-btns" data-title="${escAttr(sh.title)}"><button class="fb-up${g === true ? " on" : ""}" data-g="1">\u{1F44D}</button><button class="fb-dn${g === false ? " on" : ""}" data-g="0">\u{1F44E}</button></span>${artsHtml(sh)}</div>`;
    }).join("");
    return `<div class="cyc-complete"><div class="cyc-complete-ic">\u2705</div><div class="cyc-complete-t">\uC624\uB298 \uC6B4\uC601 \uC644\uB8CC</div><div class="cyc-complete-s">${done.length}\uAC1C \uC218\uD589 \xB7 \uC0B0\uCD9C\uBB3C ${okN}\uAC1C</div></div>
    ${weekStrip()}
    <div class="fb-hint muted small">\u{1F44D}/\u{1F44E}\uB85C \uD3C9\uAC00\uD558\uBA74 <b>\uB2E4\uC74C \uD50C\uB79C\uC774 \uB354 \uB611\uB611\uD574\uC838\uC694</b></div>${items}
    ${activityTimeline()}`;
  }
  function wirePlanToggles() {
    document.querySelectorAll(".cyc-who").forEach((b) => b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = b;
      const me = el.classList.toggle("me");
      el.textContent = me ? "\u{1F64B} \uB0B4\uAC00" : "\u{1F916} " + (el.dataset.agent || "\uC5D0\uC774\uC804\uD2B8");
      el.closest(".cyc-task")?.classList.toggle("is-me", me);
    }));
  }
  function wireLoop() {
    $("loopStart")?.addEventListener("click", () => {
      closeOverlay("opsCyclePanel");
      startOps();
    });
    $("ideaGo")?.addEventListener("click", runCycleIdea);
    $("cycEnd")?.addEventListener("click", async () => {
      await connect.opsStop?.();
      closeOverlay("opsCyclePanel");
      hint("\uC6B4\uC601\uC744 \uB2EB\uC558\uC5B4\uC694");
    });
    const run = $("cycRun");
    if (run) run.onclick = async () => {
      const titles = Array.from(document.querySelectorAll(".cyc-chk:checked")).map((c) => c.dataset.title).filter(Boolean);
      if (!titles.length) {
        hint("\uC2E4\uD589\uD560 \uAC78 \uD558\uB098 \uC774\uC0C1 \uACE8\uB77C\uC8FC\uC138\uC694");
        return;
      }
      const humanTitles = Array.from(document.querySelectorAll(".cyc-who.me")).map((b) => b.dataset.title).filter((t) => titles.includes(t));
      run.setAttribute("disabled", "");
      _ops = await connect.opsExecuteSelected?.(titles, humanTitles);
      renderCycle(_ops);
    };
    const replan = $("cycReplan");
    if (replan) replan.onclick = async () => {
      replan.setAttribute("disabled", "");
      _ops = await connect.opsNextCycle?.();
      renderCycle(_ops);
    };
    const next = $("cycNext");
    if (next) next.onclick = async () => {
      next.setAttribute("disabled", "");
      _ops = await connect.opsNextCycle?.();
      renderCycle(_ops);
    };
    const stop = $("cycStop");
    if (stop) stop.onclick = async () => {
      _ops = await connect.opsStop?.();
      hint("\u25A0 \uBA48\uCDC4\uC5B4\uC694");
      renderCycle(_ops);
    };
    document.querySelectorAll(".fb-btns button").forEach((b) => b.addEventListener("click", async () => {
      const wrap = b.closest(".fb-btns");
      const title = wrap.dataset.title;
      const g = b.dataset.g === "1";
      wrap.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      await connect.opsFeedback?.(title, g);
      hint(g ? "\u{1F44D} \uB2E4\uC74C\uC5D0 \uB354 \uB298\uB9B4\uAC8C\uC694" : "\u{1F44E} \uB2E4\uC74C\uC5D4 \uC904\uC77C\uAC8C\uC694");
    }));
  }
  function feedAgo(ts) {
    const sec = Math.floor((Date.now() - ts) / 1e3);
    return sec < 5 ? "\uBC29\uAE08" : sec < 60 ? sec + "\uCD08 \uC804" : Math.floor(sec / 60) + "\uBD84 \uC804";
  }
  function refreshCycleProgress(cyc) {
    const done = getSecDone(cyc);
    ["idea", "report", "mkt"].forEach((k) => {
      if (!done[k]) return;
      const sec = document.querySelector(`.gsec[data-sec="${k}"]`);
      if (sec) {
        sec.classList.add("is-done");
        const st = sec.querySelector(".gsec-stat");
        if (st) st.textContent = "\u2705 \uC644\uB8CC";
      }
    });
    const n = (done.idea ? 1 : 0) + (done.report ? 1 : 0) + (done.mkt ? 1 : 0);
    const fill = document.querySelector(".gsec-prog-fill");
    if (fill) fill.style.width = Math.round(n / 3 * 100) + "%";
    const pn = document.querySelector(".gsec-prog-n");
    if (pn) pn.textContent = `${n} / 3 \uC644\uB8CC \xB7 \u{1F525} ${grassStreak()}\uC77C \uC5F0\uC18D`;
    $("cyclePhase").textContent = n >= 3 ? "\uC0AC\uC774\uD074 \uC644\uB8CC \u{1F389}" : `\uC624\uB298 ${n}/3`;
    if (n >= 3) {
      if ((loadGrass()[dayKey(/* @__PURE__ */ new Date())] || 0) < 2) {
        markGrassToday(2);
        renderGrass();
      }
      if (!document.querySelector(".gsec-clear")) {
        const div = document.createElement("div");
        div.className = "gsec-clear";
        div.innerHTML = "\u{1F389} \uC624\uB298 \uC0AC\uC774\uD074 \uC644\uC8FC! \u{1F7E9} \uC794\uB514\uAC00 \uCC44\uC6CC\uC84C\uC5B4\uC694 \u2014 \uB0B4\uC77C\uB3C4 \uC774\uC5B4\uAC00\uC138\uC694.";
        $("cycleBody")?.appendChild(div);
      }
      const foot = $("cycleFoot");
      if (foot) {
        foot.innerHTML = `<button class="cyc-btn ghost" id="cycEnd">\u25A0 \uC6B4\uC601 \uC885\uB8CC</button><button class="cyc-btn primary" id="cycNext">\u25B6 \uB2E4\uC74C \uC0AC\uC774\uD074</button>`;
        wireCycleHome();
      }
    }
  }
  function wireCycleHome() {
    $("ideaGo")?.addEventListener("click", runCycleIdea);
    $("reportGo")?.addEventListener("click", runCycleReport);
    $("mktYt")?.addEventListener("click", runMarketing);
    $("cycEnd")?.addEventListener("click", async () => {
      await connect.opsStop?.();
      closeOverlay("opsCyclePanel");
      hint("\uC6B4\uC601\uC744 \uB2EB\uC558\uC5B4\uC694");
    });
    $("cycNext")?.addEventListener("click", nextCycleHome);
  }
  async function nextCycleHome() {
    const btn = $("cycNext");
    btn?.setAttribute("disabled", "");
    const ns = await connect.opsNextCycle?.().catch(() => null);
    if (ns) {
      _ops = ns;
      renderCycle(ns);
      hint("\u25B6 \uB2E4\uC74C \uC0AC\uC774\uD074\uC744 \uC900\uBE44\uD588\uC5B4\uC694");
    }
  }
  async function runCycleReport() {
    const res = $("cycReportResult");
    if (!res) return;
    res.innerHTML = `<div class="cyc-loading"><span class="cyc-spin"></span> \uD604\uD669\uC744 \uC885\uD569\uD574 \uC9C4\uB2E8 \uB9AC\uD3EC\uD2B8\uB97C \uC791\uC131 \uC911\u2026 (\uB9E4\uCD9C\xB7\uC720\uD29C\uBE0C\xB7\uAE43\uD5C8\uBE0C\xB7\uC11C\uBE44\uC2A4)</div>`;
    let r = null;
    try {
      r = await connect.cycleReport?.();
    } catch (e) {
      r = { ok: false, error: String(e?.message || e) };
    }
    if (!r?.ok) {
      res.innerHTML = `<div class="cyc-idea-err">\u26A0\uFE0F ${escapeHtml(r?.error || "\uB9AC\uD3EC\uD2B8 \uC0DD\uC131 \uC2E4\uD328")}</div><button class="cyc-btn ghost" id="repRetry">\u{1F504} \uB2E4\uC2DC</button>`;
      $("repRetry")?.addEventListener("click", runCycleReport);
      return;
    }
    const cyc = _ops?.cycle || 1;
    res.innerHTML = `<div class="cyc-report"><div class="cyc-report-md">${mdToHtml(r.md)}</div>
    <div class="cyc-report-foot"><span class="muted small">\u{1F446} \uB05D\uAE4C\uC9C0 \uC77D\uC73C\uC168\uB098\uC694?</span><button class="cyc-btn primary" id="repDone">\u2705 \uB2E4 \uBD24\uC5B4\uC694 \u2014 \uACF5\uBD80 \uC644\uB8CC</button></div></div>`;
    $("repDone")?.addEventListener("click", () => {
      setSecDone(cyc, "report");
      track("analyze", "\uC790\uC0B0 \uBD84\uC11D \uB9AC\uD3EC\uD2B8 \uC815\uB3C5", "analyze", 1, "\u{1F4CA}");
      const f = res.querySelector(".cyc-report-foot");
      if (f) f.innerHTML = `<span class="cyc-idea-accepted">\u2705 \uACF5\uBD80 \uC644\uB8CC! \u{1F7E9} \uC624\uB298 \uC794\uB514 +1 \xB7 \u{1F525} ${grassStreak()}\uC77C \uC5F0\uC18D</span>`;
      refreshCycleProgress(cyc);
      hint("\u2705 \uBD84\uC11D \uB9AC\uD3EC\uD2B8 \uACF5\uBD80 \uC644\uB8CC");
    });
  }
  async function runMarketing() {
    if (_mktRunning) return;
    _mktRunning = true;
    const btn = $("mktYt");
    if (btn) {
      btn.setAttribute("disabled", "");
      btn.innerHTML = '\u23F3 \uC791\uB3D9 \uC911\u2026 <span class="mkt-ok">\uC5F0\uACB0\uB428</span>';
    }
    const fe = $("mktFeed");
    if (fe) fe.innerHTML = `<div class="cyc-loading"><span class="cyc-spin"></span> \uC720\uD29C\uBE0C \uCC44\uB110\uC744 \uBD84\uC11D\uD558\uB294 \uC911\u2026</div>`;
    let r = null;
    try {
      r = await connect.cycleMarketing?.("youtube");
    } catch {
      r = null;
    }
    _mktRunning = false;
    const cyc = _ops?.cycle || 1;
    if (r?.mktOk) {
      setSecDone(cyc, "mkt");
      track("market", "\uC720\uD29C\uBE0C \uB9C8\uCF00\uD305 \uC791\uC5C5", "market", 1, "\u{1F4E3}");
    }
    const fe2 = $("mktFeed");
    if (fe2) fe2.innerHTML = r?.mktOk ? `<div class="cyc-idea-accepted">\u2705 \uB9C8\uCF00\uD305 \uC791\uC5C5 \uC644\uB8CC \u2014 \uC0B0\uCD9C\uBB3C\xB7\uACB0\uC7AC\uB97C \uD655\uC778\uD558\uC138\uC694. \u{1F7E9} \uC624\uB298 \uC794\uB514 +1</div>` : `<div class="muted small">\u26A0\uFE0F \uACB0\uACFC\uBB3C \uC5C6\uC774 \uC885\uB8CC\uB410\uC5B4\uC694. \uC720\uD29C\uBE0C \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uAC70\uB098 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.</div>`;
    const b2 = $("mktYt");
    if (b2) {
      b2.removeAttribute("disabled");
      b2.innerHTML = `\u25B6 \uC720\uD29C\uBE0C \uB9C8\uCF00\uD305 \uB2E4\uC2DC \uC2DC\uC791 <span class="mkt-ok">\uC5F0\uACB0\uB428</span>`;
    }
    refreshCycleProgress(cyc);
  }
  connect.onOpsUpdate?.((s) => {
    _ops = s;
    setOpsBtn(!!s?.running);
    renderCycle(s);
    try {
      officeOpsTick(s);
    } catch {
    }
  });
  connect.onOpsOpenPanel?.(() => openCyclePanel());
  connect.opsStatus?.().then((s) => {
    _ops = s;
    setOpsBtn(!!s?.running);
  }).catch(() => {
  });
  async function renderAiCurrent() {
    const cfg2 = await connect.getConfig();
    const ls = _localStatus || await connect.localStatus?.();
    const el = $("aiCurrent");
    if (!el) return;
    let icon = "\u{1F9E0}", name = "", tag = "", on = false, busy2 = false;
    if (ls?.loading) {
      icon = "\u23F3";
      name = ls.modelName ? ls.modelName : "\uBD88\uB7EC\uC624\uB294 \uC911";
      tag = ls.loadMsg || "\uBD88\uB7EC\uC624\uB294 \uC911\u2026";
      busy2 = true;
    } else if (ls?.running && (cfg2.llmBase || "").includes(":1235")) {
      name = ls.modelName;
      tag = ls.mode === "cpu" ? "\u{1F5A5}\uFE0F \uB0B4\uC7A5 \xB7 CPU \uBAA8\uB4DC (GPU \uBBF8\uC9C0\uC6D0)" : "\u26A1 \uB0B4\uC7A5 \xB7 GPU \uAC00\uC18D";
      on = true;
    } else if (ls?.error) {
      icon = "\u26A0\uFE0F";
      name = "\uBAA8\uB378\uC744 \uBABB \uCF30\uC5B4\uC694";
      tag = String(ls.error).slice(0, 44);
    } else if (cfg2.llmModel) {
      const g = /gemini/i.test(cfg2.llmModel);
      icon = g ? "\u2601\uFE0F" : "\u{1F9E0}";
      name = cfg2.llmModel;
      tag = g ? "Gemini" : (cfg2.llmBase || "").includes("11434") ? "Ollama" : "LM Studio";
    } else {
      icon = "\u{1F9E0}";
      name = "AI\uB97C \uACE8\uB77C\uC8FC\uC138\uC694";
      tag = "\uC544\uB798\uC5D0\uC11C \uBC1B\uC544 \uC0AC\uC6A9";
    }
    const off = on ? `<button class="aic-off" id="aicOff">\uB044\uAE30</button>` : "";
    el.innerHTML = `<div class="aic-icon${busy2 ? " spin" : ""}">${icon}</div><div class="aic-info"><div class="aic-name">${name}</div><div class="aic-tag">${tag}</div></div>${off}`;
    el.className = "ai-current" + (on ? " on" : "");
    $("aicOff")?.addEventListener("click", async () => {
      _localStatus = { ..._localStatus || {}, loading: true, running: false };
      renderAiCurrent();
      await connect.localStop?.();
      await connect.setConfig({ llmBase: "", llmModel: "" });
      _localStatus = await connect.localStatus?.();
      await loadLocalAI();
      await renderAiCurrent();
    });
  }
  var _params = {};
  var SLIDERS = [
    { id: "apTemp", val: "apTempVal", key: "temp", sc: 100, dp: 2 },
    { id: "apTopP", val: "apTopPVal", key: "topP", sc: 100, dp: 2 },
    { id: "apTopK", val: "apTopKVal", key: "topK", sc: 1, dp: 0 },
    { id: "apMinP", val: "apMinPVal", key: "minP", sc: 100, dp: 2 },
    { id: "apRep", val: "apRepVal", key: "repeatPenalty", sc: 100, dp: 2 },
    { id: "apFreq", val: "apFreqVal", key: "freqPenalty", sc: 100, dp: 2 },
    { id: "apPres", val: "apPresVal", key: "presPenalty", sc: 100, dp: 2 },
    { id: "apLastN", val: "apLastNVal", key: "repeatLastN", sc: 1, dp: 0 }
  ];
  var DEF_PARAMS = { temp: 0.7, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.1, freqPenalty: 0, presPenalty: 0, repeatLastN: 64, flashAttn: true, ctxSize: 8192, maxTokens: 1024 };
  var PERSONAS = {
    calm: { temp: 0.4, topP: 0.85, topK: 40, minP: 0.05, repeatPenalty: 1.1 },
    balanced: { temp: 0.7, topP: 0.9, topK: 40, minP: 0.05, repeatPenalty: 1.1 },
    creative: { temp: 1, topP: 0.95, topK: 60, minP: 0.02, repeatPenalty: 1.05 },
    strict: { temp: 0.2, topP: 0.7, topK: 20, minP: 0.1, repeatPenalty: 1.15 }
  };
  var PERSONA_KEYS = ["temp", "topP", "topK", "minP", "repeatPenalty"];
  var applyParams = async (patch) => {
    _params = await connect.localSetOptions?.(patch);
    await renderAiCurrent();
  };
  var kctx = (n) => n >= 1024 ? Math.round(n / 1024) + "K" : String(n);
  async function loadParams() {
    _params = await connect.localOptions?.() || _params;
    const st = _localStatus || await connect.localStatus?.() || {};
    const maxCtx = Number(st.maxCtx) || 0;
    $("apFlash").checked = !!_params.flashAttn;
    document.querySelectorAll("#apCtx button").forEach((b) => {
      const v = Number(b.dataset.ctx);
      const over = !!maxCtx && v > maxCtx;
      b.classList.toggle("on", v === _params.ctxSize && !over);
      b.classList.toggle("dim", over);
      b.disabled = over;
      b.title = over ? "\uC774 \uBAA8\uB378 \uCD5C\uB300 \uCEE8\uD14D\uC2A4\uD2B8 \uCD08\uACFC" : "";
    });
    const ctxEm = document.querySelector("#apCtx")?.closest(".ap-row")?.querySelector(".ap-name em");
    if (ctxEm) ctxEm.textContent = maxCtx ? `ctx \xB7 \uBAA8\uB378\uCD5C\uB300 ${kctx(maxCtx)}` : "ctx";
    document.querySelectorAll("#apMax button").forEach((b) => b.classList.toggle("on", Number(b.dataset.max) === _params.maxTokens));
    for (const d of SLIDERS) {
      const v = _params[d.key] ?? 0;
      const el = $(d.id);
      if (el) el.value = String(Math.round(v * d.sc));
      const vv = $(d.val);
      if (vv) vv.textContent = v.toFixed(d.dp);
    }
    const match = Object.entries(PERSONAS).find(([, p]) => PERSONA_KEYS.every((k) => Math.abs((_params[k] ?? -99) - p[k]) < 1e-6));
    document.querySelectorAll("#apPersona button").forEach((b) => b.classList.toggle("on", b.dataset.persona === (match?.[0] || "")));
  }
  $("apFlash")?.addEventListener("change", (e) => applyParams({ flashAttn: e.target.checked }));
  var segPick = (id, key, attr) => $(id)?.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    document.querySelectorAll("#" + id + " button").forEach((x) => x.classList.toggle("on", x === b));
    applyParams({ [key]: Number(b.dataset[attr]) });
  });
  segPick("apCtx", "ctxSize", "ctx");
  segPick("apMax", "maxTokens", "max");
  $("apPersona")?.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const p = PERSONAS[b.dataset.persona || ""];
    if (!p) return;
    await applyParams(p);
    await loadParams();
  });
  for (const d of SLIDERS) {
    const el = $(d.id);
    if (!el) continue;
    el.addEventListener("input", (e) => {
      const v = Number(e.target.value) / d.sc;
      $(d.val).textContent = v.toFixed(d.dp);
    });
    el.addEventListener("change", (e) => applyParams({ [d.key]: Number(e.target.value) / d.sc }));
  }
  $("apReset")?.addEventListener("click", async () => {
    _params = await connect.localSetOptions?.({ ...DEF_PARAMS });
    await loadParams();
    await renderAiCurrent();
  });
  var fmtGB = (b) => b >= 1e9 ? (b / 1e9).toFixed(1) + "GB" : Math.max(1, Math.round(b / 1e6)) + "MB";
  var _localStatus = null;
  function renderLocalStatus() {
    const s = _localStatus || {};
    const el = $("localStatus");
    if (!el) return;
    if (s.loading) {
      el.innerHTML = "\u23F3 \uBAA8\uB378 \uB85C\uB529 \uC911\u2026";
      el.className = "local-status loading";
    } else if (s.running) {
      el.innerHTML = `\u{1F7E2} <b>${s.modelName}</b> \uC2E4\uD589 \uC911 <span class="ls-badge">LM Studio \uBD88\uD544\uC694 \xB7 ${s.gpu === "metal" ? "GPU" : s.gpu || "CPU"}</span> <button id="localStopBtn" class="upd-ghost">\uB044\uAE30</button>`;
      el.className = "local-status on";
    } else if (s.error) {
      el.innerHTML = `\u26A0\uFE0F ${s.error}`;
      el.className = "local-status err";
    } else {
      el.innerHTML = "\u26AA \uB0B4\uC7A5 AI \uAEBC\uC9D0 \u2014 \uC544\uB798\uC5D0\uC11C \uBAA8\uB378\uC744 \uBC1B\uC544 <b>\uC0AC\uC6A9</b>\uC744 \uB204\uB974\uC138\uC694.";
      el.className = "local-status";
    }
    const stop = $("localStopBtn");
    if (stop) stop.addEventListener("click", async () => {
      _localStatus = await connect.localStop?.();
      renderLocalStatus();
      loadLocalAI();
    });
  }
  async function loadLocalAI() {
    try {
      _localStatus = await connect.localStatus?.();
    } catch {
    }
    renderLocalStatus();
    const models = await connect.localModels?.() || [];
    const cur = _localStatus?.modelPath;
    const recos = models.length ? [] : await connect.hfRecommended?.() || [];
    const liveCur = _localStatus?.running ? cur : "";
    const md2 = await connect.localModelsDir?.() || {};
    const folderBar = `<div class="models-dir"><span class="md-ic">\u{1F4C1}</span><span class="md-path" title="${escAttr(md2.dir || "")}">${escapeHtml(md2.dir || "\uAE30\uBCF8 \uD3F4\uB354")}</span><button class="md-btn" id="mdChange" title="\uB2E4\uB978 \uB4DC\uB77C\uC774\uBE0C/\uD3F4\uB354\uB85C \uBCC0\uACBD">\u{1F4C2} \uBCC0\uACBD</button><button class="md-btn" id="mdOpen" title="\uD3F4\uB354 \uC5F4\uAE30">\uC5F4\uAE30</button>${md2.custom ? '<button class="md-btn" id="mdReset" title="\uAE30\uBCF8 \uD3F4\uB354\uB85C">\uAE30\uBCF8</button>' : ""}</div>`;
    $("localModels").innerHTML = folderBar + (models.length ? models.map((m) => `<div class="lm-row ${m.path === liveCur ? "active" : ""}"><span class="lm-name">${m.name}</span><span class="muted small">${fmtGB(m.size)}</span><button class="lm-use oc-primary" data-path="${encodeURIComponent(m.path)}">${m.path === liveCur ? "\uC0AC\uC6A9 \uC911" : m.path === cur && _localStatus?.error ? "\u{1F501} \uB2E4\uC2DC \uCF1C\uAE30" : "\uC0AC\uC6A9"}</button><button class="lm-del" data-del="${encodeURIComponent(m.path)}" data-rm="${m.removable ? 1 : 0}" data-nm="${escAttr(m.name)}" data-sz="${fmtGB(m.size)}" data-src="${escAttr(m.source || "")}" title="\uC0AD\uC81C">\u{1F5D1}\uFE0F</button></div>`).join("") : recos.length ? `<div class="muted small" style="margin-bottom:8px">\uBC1B\uC740 \uB450\uB1CC\uAC00 \uC5C6\uC5B4\uC694. \uCD94\uCC9C \uB450\uB1CC\uB97C \uD55C \uBC88\uC5D0 \uBC1B\uC73C\uC138\uC694 \u{1F447}</div>` + recos.map((r) => `<div class="reco-card" data-repo="${escAttr(r.repo)}"><div class="reco-info"><div class="reco-name">${escapeHtml(r.label)}</div><div class="reco-hint muted small">${escapeHtml(r.hint)}</div></div><button class="reco-get oc-primary">\uBC1B\uAE30</button></div>`).join("") : '<div class="muted small">\uBC1B\uC740 \uBAA8\uB378\uC774 \uC5C6\uC5B4\uC694. \uC544\uB798 \uAC80\uC0C9\uC5D0\uC11C \uBC1B\uC73C\uC138\uC694.</div>');
    $("mdChange")?.addEventListener("click", async () => {
      const r = await connect.localPickModelsDir?.();
      if (r?.error) {
        hint("\u26A0\uFE0F " + r.error);
        return;
      }
      if (r?.dir) {
        hint("\u{1F4C1} \uBAA8\uB378 \uC800\uC7A5 \uD3F4\uB354\uB97C \uBC14\uAFE8\uC5B4\uC694 \u2014 \uC0C8\uB85C \uBC1B\uB294 \uBAA8\uB378\uC774 \uC5EC\uAE30\uB85C \uC800\uC7A5\uB3FC\uC694");
        loadLocalAI();
      }
    });
    $("mdOpen")?.addEventListener("click", () => connect.localOpenModelsDir?.());
    $("mdReset")?.addEventListener("click", async () => {
      await connect.localResetModelsDir?.();
      hint("\uAE30\uBCF8 \uD3F4\uB354\uB85C \uB418\uB3CC\uB838\uC5B4\uC694");
      loadLocalAI();
    });
    $("localModels").querySelectorAll(".reco-card").forEach((c) => c.addEventListener("click", () => pickRepo(c.dataset.repo)));
    $("localModels").querySelectorAll(".lm-use").forEach((b) => b.addEventListener("click", async () => {
      if (b.disabled) return;
      const p = decodeURIComponent(b.dataset.path);
      const nm = b.closest(".lm-row")?.querySelector(".lm-name")?.textContent || "";
      document.querySelectorAll(".lm-use").forEach((x) => x.disabled = true);
      _localStatus = { ..._localStatus || {}, loading: true, modelName: nm, running: false, error: "" };
      await renderAiCurrent();
      _localStatus = await connect.localStart?.(p);
      if (_localStatus?.running) await connect.setConfig({ llmBase: LOCAL_BASE, llmModel: _localStatus.modelName });
      await loadLocalAI();
      await renderAiCurrent();
      await loadModels();
      refreshMem?.();
    }));
    $("localModels").querySelectorAll(".lm-del").forEach((b) => b.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const el = b;
      const p = decodeURIComponent(el.dataset.del);
      const nm = el.dataset.nm || "\uBAA8\uB378", sz = el.dataset.sz || "", rm = el.dataset.rm === "1", src = el.dataset.src || "";
      const warn = rm ? "" : `

\u26A0\uFE0F \uC774\uAC74 ${src || "\uC678\uBD80(LM Studio \uB4F1)"} \uBAA8\uB378\uC774\uC5D0\uC694. \uC9C0\uC6B0\uBA74 \uADF8\uCABD\uC5D0\uC11C\uB3C4 \uC0AC\uB77C\uC838\uC694.`;
      if (!confirm(`'${nm}' (${sz}) \uBAA8\uB378 \uD30C\uC77C\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?
\uB514\uC2A4\uD06C\uC5D0\uC11C \uC644\uC804\uD788 \uC9C0\uC6CC\uC9C0\uACE0 \uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC5B4\uC694.${warn}`)) return;
      el.disabled = true;
      el.textContent = "\u2026";
      await connect.localDelete?.(p);
      await loadLocalAI();
    }));
  }
  $("hfSearchBtn")?.addEventListener("click", doHfSearch);
  $("hfQuery")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doHfSearch();
  });
  async function doHfSearch() {
    const q = $("hfQuery").value.trim();
    $("hfResults").innerHTML = '<div class="muted small">\u{1F50D} \uAC80\uC0C9 \uC911\u2026</div>';
    const r = await connect.hfSearch?.(q);
    if (!r?.ok) {
      $("hfResults").innerHTML = `<div class="muted small">\u26A0\uFE0F ${r?.error || "\uAC80\uC0C9 \uC2E4\uD328"}</div>`;
      return;
    }
    $("hfResults").innerHTML = (r.models || []).map((m) => {
      const slash = m.id.indexOf("/");
      const org = slash > 0 ? m.id.slice(0, slash) : "";
      const nm = slash > 0 ? m.id.slice(slash + 1) : m.id;
      const badges = `${m.params ? `<span class="hf-badge hf-param">${m.params}</span>` : ""}${m.vision ? `<span class="hf-badge hf-vis">\u{1F441} \uBE44\uC804</span>` : ""}`;
      return `<div class="hf-row" data-repo="${escAttr(m.id)}" title="${escAttr(m.id)}${m.updated ? " \xB7 \uAC31\uC2E0 " + fmtAgo(m.updated) : ""}">
      <div class="hf-main"><div class="hf-id">${escapeHtml(nm)}</div><div class="hf-org">${escapeHtml(org)}${m.updated ? ` \xB7 ${fmtAgo(m.updated)}` : ""}</div></div>
      <div class="hf-stats">${badges}<span class="muted small">\u2B07 ${fmtN(m.downloads)}</span><span class="muted small">\u2665 ${fmtN(m.likes)}</span></div>
    </div>`;
    }).join("") || '<div class="muted small">\uACB0\uACFC \uC5C6\uC74C</div>';
    $("hfResults").querySelectorAll(".hf-row").forEach((b) => b.addEventListener("click", () => pickRepo(b.dataset.repo)));
  }
  async function pickRepo(repo) {
    $("hfResults").innerHTML = `<div class="muted small">\u{1F4C2} ${repo} \uD30C\uC77C \uBD88\uB7EC\uC624\uB294 \uC911\u2026</div>`;
    const r = await connect.hfFiles?.(repo);
    if (!r?.ok) {
      $("hfResults").innerHTML = `<div class="muted small">\u26A0\uFE0F ${r?.error || "\uC2E4\uD328"}</div>`;
      return;
    }
    const files = r.files || [];
    $("hfResults").innerHTML = `<div class="hf-back muted small">\u2190 ${repo}</div>` + (files.length ? files.map((f) => `<div class="hf-row file"><span class="hf-q">${f.quant}</span><span class="muted small">${fmtGB(f.size)}</span><button class="hf-get oc-primary" data-repo="${repo}" data-file="${encodeURIComponent(f.path)}">\uBC1B\uAE30</button></div>`).join("") : '<div class="muted small">\uC774 \uB808\uD3EC\uC5D0 GGUF \uD30C\uC77C\uC774 \uC5C6\uC5B4\uC694.</div>');
    $("hfResults").querySelector(".hf-back")?.addEventListener("click", doHfSearch);
    $("hfResults").querySelectorAll(".hf-get").forEach((b) => b.addEventListener("click", () => doDownload(b.dataset.repo, decodeURIComponent(b.dataset.file), b)));
  }
  async function doDownload(repo, file, btn) {
    btn.textContent = "\u23F3";
    btn.disabled = true;
    $("hfDl").hidden = false;
    $("hfDlText").textContent = `${file} \uBC1B\uB294 \uC911\u2026`;
    const r = await connect.hfDownload?.(repo, file);
    $("hfDl").hidden = true;
    if (!r?.ok) {
      $("hfDlText").textContent = "";
      btn.textContent = "\uC7AC\uC2DC\uB3C4";
      btn.disabled = false;
      alert("\uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328: " + (r?.error || ""));
      return;
    }
    btn.textContent = "\u2713 \uBC1B\uC74C";
    await loadLocalAI();
  }
  connect.onHfProgress?.((p) => {
    if ($("hfDl").hidden) $("hfDl").hidden = false;
    $("hfDlFill").style.width = (p.percent || 0) + "%";
    $("hfDlText").textContent = `${p.percent || 0}% \xB7 ${fmtGB(p.received)}${p.total ? " / " + fmtGB(p.total) : ""}`;
  });
  var _cpuNotified = false;
  connect.onLocalStatus?.((s) => {
    _localStatus = s;
    renderLocalStatus();
    renderAiCurrent();
    if (!$("aiPanel").classList.contains("hidden")) loadParams();
    if (s?.mode === "cpu" && s?.running && !_cpuNotified) {
      _cpuNotified = true;
      hint("\u{1F5A5}\uFE0F \uC774 PC\uB294 GPU \uAC00\uC18D\uC774 \uC548 \uB3FC\uC11C CPU \uBAA8\uB4DC\uB85C \uC791\uB3D9\uD574\uC694. \uC798 \uCF1C\uC84C\uC9C0\uB9CC \uC751\uB2F5\uC774 \uC870\uAE08 \uB290\uB9B4 \uC218 \uC788\uC5B4\uC694.");
    }
    if (s?.mode === "gpu") _cpuNotified = false;
  });
  async function loadMcp() {
    const cfg2 = await connect.mcpGet();
    if (cfg2 && Object.keys(cfg2).length) $("mcpConfig").value = JSON.stringify(cfg2, null, 2);
  }
  async function saveMcp() {
    const raw = $("mcpConfig").value.trim();
    let cfg2 = {};
    if (raw) {
      try {
        cfg2 = JSON.parse(raw);
      } catch {
        $("mcpStatus").textContent = "\u26A0\uFE0F JSON \uD615\uC2DD \uC624\uB958";
        return false;
      }
    }
    await connect.mcpSave(cfg2);
    return true;
  }
  $("mcpSaveBtn").addEventListener("click", async () => {
    if (await saveMcp()) $("mcpStatus").textContent = "\u2705 \uC800\uC7A5\uB428";
  });
  $("mcpTestBtn").addEventListener("click", async () => {
    if (!await saveMcp()) return;
    $("mcpStatus").textContent = "\u{1F50C} \uC5F0\uACB0 \uC911\u2026";
    $("mcpTools").innerHTML = "";
    const servers = await connect.mcpTest();
    $("mcpStatus").textContent = `${servers.filter((s) => s.ok).length}/${servers.length} \uC11C\uBC84 \uC5F0\uACB0\uB428`;
    $("mcpTools").innerHTML = servers.map((s) => `<div class="mcp-srv ${s.ok ? "on" : "off"}"><div class="ms-name">${s.ok ? "\u{1F7E2}" : "\u{1F534}"} ${escapeHtml(s.name)} <span class="muted small">${s.ok ? s.tools + "\uAC1C \uB3C4\uAD6C" : escapeHtml(s.error || "\uC2E4\uD328")}</span></div>${s.toolNames?.length ? `<div class="ms-tools">${s.toolNames.map((t) => `<span class="ms-tool">${escapeHtml(t)}</span>`).join("")}</div>` : ""}</div>`).join("");
  });
  async function renderTasks() {
    const all = await connect.tasksList();
    const open = (all || []).filter((t) => t.status === "open");
    const board = $("taskBoard");
    if (!open.length) {
      board.innerHTML = '<div class="todo-empty">\uD560 \uC77C\uC774 \uC5C6\uC5B4\uC694 \u2014 \uC704\uC5D0 \uC785\uB825\uD558\uAC70\uB098, \uC5D0\uC774\uC804\uD2B8\uAC00 \uC790\uB3D9\uC73C\uB85C \uC313\uC544\uC918\uC694.</div>';
      return;
    }
    board.innerHTML = open.map((t) => `<div class="todo-row${t.priority === "urgent" ? " urgent" : t.priority === "high" ? " high" : ""}" data-id="${t.id}">
    <button class="todo-chk" data-id="${t.id}" title="\uC644\uB8CC"></button>
    <span class="todo-tx">${escapeHtml(t.title)}</span>
    <span class="todo-who" title="${t.owner === "user" ? "\uB0B4 \uD560 \uC77C" : "\uC5D0\uC774\uC804\uD2B8"}">${t.agentEmoji || (t.owner === "user" ? "\u{1F64B}" : "\u{1F916}")}</span>
    <button class="todo-del" data-id="${t.id}" title="\uC0AD\uC81C">\u2715</button>
  </div>`).join("");
    board.querySelectorAll(".todo-chk").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const row = b.closest(".todo-row");
      row?.classList.add("done");
      const t = open.find((x) => x.id === id);
      const title = t?.title || "\uD560 \uC77C";
      setTimeout(async () => {
        await connect.tasksDone(id);
        track("task", title, catOf(title), 1, "\u2611\uFE0F");
        renderTasks();
      }, 240);
    }));
    board.querySelectorAll(".todo-del").forEach((b) => b.addEventListener("click", async () => {
      await connect.tasksCancel(b.dataset.id);
      renderTasks();
    }));
    void renderOfficeTodo();
  }
  async function addTaskFromInput() {
    const inp = $("taskInput");
    const v = inp.value.trim();
    if (!v) return;
    inp.value = "";
    try {
      await connect.tasksAdd(v);
    } catch {
      inp.value = v;
      hint("\u26A0\uFE0F \uD560 \uC77C \uCD94\uAC00 \uC2E4\uD328 \u2014 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694");
      return;
    }
    renderTasks();
  }
  $("taskAddBtn").addEventListener("click", addTaskFromInput);
  $("taskInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) addTaskFromInput();
  });
  async function renderOfficeTodo() {
    const board = $("officeTodoBoard");
    if (!board) return;
    const all = await connect.tasksList();
    const open = (all || []).filter((t) => t.status === "open");
    const cnt = $("officeTodoCount");
    if (cnt) cnt.textContent = open.length ? String(open.length) : "";
    if (!open.length) {
      board.innerHTML = '<div class="todo-empty">\uD560 \uC77C\uC774 \uC5C6\uC5B4\uC694 \u2014 \uC704\uC5D0 \uCD94\uAC00\uD558\uAC70\uB098 \u{1F680} \uC6B4\uC601 \uC2DC\uC791\uC744 \uB204\uB974\uBA74 AI \uD300\uC774 \uCC44\uC6CC\uC918\uC694.</div>';
      return;
    }
    board.innerHTML = open.map((t) => `<div class="todo-row${t.priority === "urgent" ? " urgent" : t.priority === "high" ? " high" : ""}" data-id="${t.id}">
    <button class="todo-chk" data-id="${t.id}" title="\uC644\uB8CC"></button>
    <span class="todo-tx">${escapeHtml(t.title)}</span>
    <span class="todo-who" title="${t.owner === "user" ? "\uB0B4 \uD560 \uC77C" : "\uC5D0\uC774\uC804\uD2B8"}">${t.agentEmoji || (t.owner === "user" ? "\u{1F64B}" : "\u{1F916}")}</span>
    <button class="todo-del" data-id="${t.id}" title="\uC0AD\uC81C">\u2715</button>
  </div>`).join("");
    board.querySelectorAll(".todo-chk").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const row = b.closest(".todo-row");
      row?.classList.add("done");
      const t = open.find((x) => x.id === id);
      const title = t?.title || "\uD560 \uC77C";
      setTimeout(async () => {
        await connect.tasksDone(id);
        track("task", title, catOf(title), 1, "\u2611\uFE0F");
        renderTasks();
      }, 240);
    }));
    board.querySelectorAll(".todo-del").forEach((b) => b.addEventListener("click", async () => {
      await connect.tasksCancel(b.dataset.id);
      renderTasks();
    }));
  }
  async function addOfficeTask() {
    const inp = $("officeTaskInput");
    if (!inp) return;
    const v = inp.value.trim();
    if (!v) return;
    inp.value = "";
    try {
      await connect.tasksAdd(v);
    } catch {
      inp.value = v;
      hint("\u26A0\uFE0F \uD560 \uC77C \uCD94\uAC00 \uC2E4\uD328 \u2014 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694");
      return;
    }
    renderTasks();
  }
  $("ghHeroSync")?.addEventListener("click", () => $("ghPushBtn")?.click());
  $("ghHeroFuse")?.addEventListener("click", () => openSurgery());
  $("officeTaskAddBtn")?.addEventListener("click", addOfficeTask);
  $("officeTaskInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) addOfficeTask();
  });
  $("officeOpsBtn")?.addEventListener("click", () => $("opsStartBtn")?.click());
  async function renderApprovals() {
    const all = await connect.approvalsList();
    const pend = (all || []).filter((a) => a.status === "pending");
    if (!pend.length) {
      $("aprBoard").innerHTML = '<div class="muted small" style="padding:6px 2px">\uB300\uAE30 \uC911\uC778 \uC2B9\uC778\uC774 \uC5C6\uC5B4\uC694.</div>';
      return;
    }
    $("aprBoard").innerHTML = pend.map((a) => `<div class="apr-card${a.action ? " is-exec" : ""}">
    <div class="ac-ic">${a.agentEmoji || "\u{1F916}"}</div>
    <div class="ac-body"><div class="ac-title">${escapeHtml(a.title)}${a.action ? `<span class="ac-exec">\u26A1 ${escapeHtml(a.action.kind)}</span>` : ""}</div>${a.summary ? `<div class="ac-sum">${escapeHtml(a.summary)}</div>` : ""}</div>
    <div class="ac-actions"><button class="ac-ok" data-id="${a.id}" title="${a.action ? "\uC2B9\uC778\uD558\uACE0 \uC2E4\uD589" : "\uC2B9\uC778"}">\u2713</button><button class="ac-no" data-id="${a.id}" title="\uAC70\uC808">\u2715</button></div>
  </div>`).join("");
    $("aprBoard").querySelectorAll(".ac-ok").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const ap = pend.find((x) => x.id === id);
      const r = await connect.approvalsApprove(id);
      track("approve", ap?.title || "\uACB0\uC7AC \uC2B9\uC778", catOf(ap?.title || ""), 1, "\u2705");
      renderApprovals();
      if (r?.result) addLog("\u2705 \uC2E4\uD589 \uACB0\uACFC", r.result, false, false, "#00cc77");
      hint(r?.result ? "\uC2B9\uC778 + \uC2E4\uD589 \uC644\uB8CC \u26A1" : "\uC2B9\uC778\uD588\uC5B4\uC694 \u2705");
    }));
    $("aprBoard").querySelectorAll(".ac-no").forEach((b) => b.addEventListener("click", async () => {
      await connect.approvalsReject(b.dataset.id);
      renderApprovals();
    }));
  }
  $("aprTestBtn")?.addEventListener("click", async () => {
    const b = $("aprTestBtn");
    b.setAttribute("disabled", "");
    b.textContent = "\u2708\uFE0F \uBCF4\uB0B4\uB294 \uC911\u2026";
    const r = await connect.approvalsTest?.().catch(() => null);
    b.removeAttribute("disabled");
    b.textContent = "\u2708\uFE0F \uD3F0 \uACB0\uC7AC \uD14C\uC2A4\uD2B8";
    if (r?.ok) {
      renderApprovals();
      addLog("\u2708\uFE0F \uACB0\uC7AC \uD14C\uC2A4\uD2B8", '\uD3F0(\uD154\uB808\uADF8\uB7A8)\uC73C\uB85C \uACB0\uC7AC \uC694\uCCAD\uC744 \uBCF4\uB0C8\uC5B4\uC694!\n\n\u{1F4F1} \uD154\uB808\uADF8\uB7A8\uC744 \uC5F4\uACE0 "\uBCF4\uB0B4\uAE30"\uB77C\uACE0 \uB2F5\uC7A5\uD574\uBCF4\uC138\uC694 \u2014 \uC2B9\uC778\uB418\uBA74 \uBA54\uC2DC\uC9C0\uAC00 \uC2E4\uC81C\uB85C \uBC1C\uC1A1\uB429\uB2C8\uB2E4.\n("\uC218\uC815 \u2026" / "\uCDE8\uC18C"\uB3C4 \uB429\uB2C8\uB2E4)', false, false, "#00a0ff");
    } else hint(r?.reason || "\uD154\uB808\uADF8\uB7A8 \uC5F0\uB3D9\uC744 \uBA3C\uC800 \uD574\uC8FC\uC138\uC694 (\u{1F5C2}\uFE0F \uC5F0\uB3D9 \u2192 Telegram)");
  });
  var fmtN = (n) => Number(n || 0).toLocaleString();
  var fmtAgo = (iso) => {
    const t = Date.parse(iso);
    if (!t) return "";
    const d = Math.floor((Date.now() - t) / 864e5);
    if (d < 1) return "\uC624\uB298";
    if (d < 30) return d + "\uC77C \uC804";
    if (d < 365) return Math.floor(d / 30) + "\uAC1C\uC6D4 \uC804";
    return Math.floor(d / 365) + "\uB144 \uC804";
  };
  function seoGeoPrompt(name, url, repo = "") {
    const repoStep = repo ? `2) \uC774 \uC11C\uBE44\uC2A4 \uB808\uD3EC\uB294 "${repo}" \uB2E4. read_repo_file \uB85C index.html(\uB610\uB294 docs/index.html)\uC744 \uC9C1\uC811 \uC77D\uC5B4 \uD604\uC7AC <title>\xB7meta\xB7\uD5E4\uB529\xB7JSON-LD\xB7robots/sitemap\xB7llms.txt \uC720\uBB34\uB97C \uD655\uC778.` : `2) (\uC774 \uC11C\uBE44\uC2A4\uC5D0 \uAE43\uD5D9 \uB808\uD3EC\uAC00 \uB4F1\uB85D\uB3FC \uC788\uC73C\uBA74) read_repo_file \uB85C \uC18C\uC2A4\uB97C \uC9C1\uC811 \uD655\uC778. \uC5C6\uC73C\uBA74 \u{1F5C2}\uFE0F \uB0B4 \uC11C\uBE44\uC2A4\uC5D0\uC11C \uB808\uD3EC\uB97C \uB4F1\uB85D\uD558\uBA74 \uCF54\uB4DC\uAE4C\uC9C0 \uACE0\uCE60 \uC218 \uC788\uB2E4\uACE0 \uD55C \uC904 \uC548\uB0B4.`;
    const applyStep = repo ? `\uACB0\uACFC\uB294 (a) \uC6B0\uC120\uC21C\uC704 \uAC1C\uC120\uC548\uC744 <task>\uB85C 3~5\uAC1C, (b) \uBC14\uB85C \uC801\uC6A9 \uAC00\uB2A5\uD55C \uAC74 edit_repo_file \uB85C "${repo}" \uB808\uD3EC\uC5D0 \uACB0\uC7AC\uB97C \uC62C\uB824\uB77C \u2014 \uBA54\uD0C0\uD0DC\uADF8\xB7llms.txt\xB7sitemap\xB7JSON-LD \uAC19\uC740 \uAC00\uBCBC\uC6B4 SEO\xB7GEO\uB294 minor=true, \uD398\uC774\uC9C0 \uB0B4\uC6A9\xB7\uAD6C\uC870 \uB4F1 \uD575\uC2EC \uBCC0\uACBD\uC740 minor=false. \uBC18\uB4DC\uC2DC read_repo_file\uB85C \uD604\uC7AC \uB0B4\uC6A9\uC744 \uBA3C\uC800 \uC77D\uACE0 \uC804\uCCB4 \uC0C8 \uB0B4\uC6A9\uC744 \uB118\uACA8\uB77C.` : `\uACB0\uACFC\uB294 \uC6B0\uC120\uC21C\uC704 \uAC1C\uC120\uC548\uC744 <task>\uB85C 3~5\uAC1C \uB9CC\uB4E4\uC5B4\uB77C(\uB808\uD3EC\uAC00 \uC5C6\uC5B4 \uC9C1\uC811 \uC218\uC815\uC740 \uBD88\uAC00 \u2014 \uB808\uD3EC \uB4F1\uB85D\uC744 \uAD8C\uD558\uB77C).`;
    return `\uB0B4 \uC11C\uBE44\uC2A4 "${name}" (${url}) \uC758 SEO\xB7GEO\uB97C \uCD5C\uC801\uD654\uD574\uC918. \uCC28\uB840\uB300\uB85C:
1) fetch_url \uB85C \uC2E4\uC81C \uD398\uC774\uC9C0\uB97C \uC77D\uC5B4 <title>\xB7meta description\xB7h1/h2 \uAD6C\uC870\xB7schema.org \uAD6C\uC870\uD654\uB370\uC774\uD130\xB7\uC774\uBBF8\uC9C0 alt\xB7\uB0B4\uBD80\uB9C1\uD06C\xB7robots/sitemap \uC720\uBB34\uB97C \uC810\uAC80.
${repoStep}
3) web_search \uB85C \uD575\uC2EC \uD0A4\uC6CC\uB4DC\uC640 \uACBD\uC7C1\uC0AC\uAC00 \uAC80\uC0C9\xB7AI\uB2F5\uBCC0\uC5D0 \uC5B4\uB5BB\uAC8C \uB178\uCD9C\uB418\uB294\uC9C0 \uBE44\uAD50.
4) SEO\uC640 GEO\uB97C \uBAA8\uB450 \uACE0\uB824: SEO=\uC81C\uBAA9/\uBA54\uD0C0/\uD5E4\uB529/\uAD6C\uC870\uD654\uB370\uC774\uD130/\uC18D\uB3C4, GEO=ChatGPT\xB7Perplexity \uAC19\uC740 AI\uAC00 \uC778\uC6A9\uD558\uAE30 \uC88B\uAC8C FAQ\xB7Q&A \uAD6C\uC870, \uBA85\uD655\uD55C \uC0AC\uC2E4 \uBB38\uC7A5, llms.txt, JSON-LD.
${applyStep}`;
  }
  async function renderServiceIntel() {
    $("svcIntel").innerHTML = '<div class="muted small" style="padding:6px 2px">\u{1F310} \uC11C\uBE44\uC2A4 \uC815\uBCF4 \uC77D\uB294 \uC911\u2026</div>';
    const list = await connect.servicesIntel();
    if (!list || !list.length) {
      $("svcIntel").innerHTML = '<div class="muted small" style="padding:6px 2px">\u{1F5C2}\uFE0F \uB0B4 \uC11C\uBE44\uC2A4 \uD0ED\uC5D0\uC11C \uB4F1\uB85D\uD558\uBA74 \u2192 \uC5EC\uAE30\uC11C \uADF8 URL\uC744 \uC2E4\uC2DC\uAC04\uC73C\uB85C \uC77D\uC5B4 \uD30C\uC545\uD558\uACE0 \uBD84\uC11D\uD569\uB2C8\uB2E4.</div>';
      return;
    }
    $("svcIntel").innerHTML = list.map((s) => `<div class="si-card">
    <div class="si-head"><span class="si-ic">${s.type === "youtube" ? "\u{1F4FA}" : "\u{1F310}"}</span>
      <div class="si-info"><a class="si-name" data-url="${escapeHtml(s.url)}">${escapeHtml(s.name)}</a><div class="si-url">${escapeHtml(s.url || "")}</div></div>
      <div class="si-acts"><button class="si-btn" data-name="${escapeHtml(s.name)}" data-url="${escapeHtml(s.url)}">\u{1F50D} \uBD84\uC11D</button>${s.type === "youtube" ? "" : `<button class="si-btn si-seo" data-name="${escapeHtml(s.name)}" data-url="${escapeHtml(s.url)}" data-repo="${escapeHtml(s.repo || "")}">\u{1F680} SEO\xB7GEO \uCD5C\uC801\uD654</button>`}</div></div>
    <div class="si-snap">${escapeHtml(s.snapshot || "(\uC77D\uC9C0 \uBABB\uD568 \u2014 \uC0AC\uC774\uD2B8\uAC00 \uB9C9\uC558\uC744 \uC218 \uC788\uC5B4\uC694)")}</div></div>`).join("");
    $("svcIntel").querySelectorAll(".si-name").forEach((a) => a.addEventListener("click", () => connect.openExternal(a.dataset.url)));
    $("svcIntel").querySelectorAll(".si-btn:not(.si-seo)").forEach((b) => b.addEventListener("click", () => {
      const el = b;
      closeOverlay("managePanel");
      ask(`\uB0B4 \uC11C\uBE44\uC2A4 "${el.dataset.name}" (${el.dataset.url}) \uB97C \uBD84\uC11D\uD574\uC918. \uD544\uC694\uD558\uBA74 web_search\xB7fetch_url \uB85C \uC9C1\uC811 \uD655\uC778\uD558\uACE0, \uAC1C\uC120\uD558\uAC70\uB098 \uD0A4\uC6B8 \uAD6C\uCCB4\uC801\uC778 \uC561\uC158\uC744 <task>\uB85C 2~4\uAC1C \uB9CC\uB4E4\uC5B4\uC918.`);
    }));
    $("svcIntel").querySelectorAll(".si-seo").forEach((b) => b.addEventListener("click", () => {
      const el = b;
      closeOverlay("managePanel");
      ask(seoGeoPrompt(el.dataset.name || "", el.dataset.url || "", el.dataset.repo || ""));
    }));
  }
  async function renderYouTube() {
    const r = await connect.youtubeGet();
    if (!r || !r.ok) {
      $("ytDash").innerHTML = `<div class="muted small" style="padding:8px 2px">\u{1F4FA} \uBBF8\uC5F0\uACB0 \u2014 \u{1F5C2}\uFE0F \uC5F0\uB3D9\uC5D0\uC11C YouTube API Key + Channel ID\uB97C \uB123\uC73C\uBA74 \uCC44\uB110\uC774 \uC5EC\uAE30 \uB5A0\uC694.${r?.error ? ` <span style="opacity:.7">(${escapeHtml(r.error)})</span>` : ""}</div>`;
      return;
    }
    const c = r.channel, an = r.analytics;
    const anHtml = an ? `<div class="yt-an">\u{1F4CA} 28\uC77C \u2014 \uC870\uD68C ${fmtN(an.views)} \xB7 \uD3C9\uADE0 \uC2DC\uCCAD\uB960 ${(an.avgViewPercentage || 0).toFixed(1)}% \xB7 \uAD6C\uB3C5 +${fmtN(an.subscribersGained)}</div>` : "";
    $("ytDash").innerHTML = `
    <div class="yt-head">${c.thumb ? `<img class="yt-thumb" src="${c.thumb}" />` : ""}<div><div class="yt-name">${escapeHtml(c.title || "")}</div><div class="yt-stats">\u{1F465} ${fmtN(c.subs)} \xB7 \u{1F441} ${fmtN(c.views)} \xB7 \u{1F3AC} ${fmtN(c.videos)}</div></div></div>
    ${anHtml}
    <div class="yt-videos">${(r.videos || []).map((v) => `<div class="yt-vid" data-id="${v.id}">${v.thumb ? `<img src="${v.thumb}" />` : ""}<div class="yt-vtitle">${escapeHtml(v.title || "")}</div><div class="yt-vstats">\u{1F441} ${fmtN(v.views)} \xB7 \u{1F44D} ${fmtN(v.likes)} \xB7 \u{1F4AC} ${fmtN(v.comments)}</div></div>`).join("")}</div>`;
    $("ytDash").querySelectorAll(".yt-vid").forEach((a) => a.addEventListener("click", () => connect.openExternal("https://www.youtube.com/watch?v=" + a.dataset.id)));
  }
  async function renderDash() {
    renderTasks();
    renderApprovals();
    renderServiceIntel();
    renderYouTube();
    const s = await connect.dashboardStats();
    const cards = [
      ["\u{1F3E2}", s.company, "\uD68C\uC0AC"],
      ["\u{1F916}", s.agentName, "\uC5D0\uC774\uC804\uD2B8"],
      ["\u{1F4CB}", s.tasks, "\uC5F4\uB9B0 \uD560 \uC77C"],
      ["\u{1F9E0}", s.knowledge, "\uC9C0\uC2DD \uB178\uD2B8"],
      ["\u{1F5C2}\uFE0F", s.services, "\uB4F1\uB85D \uC11C\uBE44\uC2A4"],
      ["\u{1F4B3}", s.paypal ? "\uC5F0\uACB0\uB428" : "\uBBF8\uC5F0\uACB0", "PayPal"],
      ["\u{1F4F1}", s.telegram ? "\uC5F0\uACB0\uB428" : "\uBBF8\uC5F0\uACB0", "\uD154\uB808\uADF8\uB7A8"],
      ["\u{1F4BB}", s.model, "\uBAA8\uB378"]
    ];
    $("dashGrid").innerHTML = cards.map(([i, v, l]) => `<div class="dash-card"><div class="dc-ic">${i}</div><div class="dc-v">${escapeHtml(String(v))}</div><div class="dc-l">${l}</div></div>`).join("");
  }
  async function loadServices() {
    const list = await connect.servicesList();
    $("svcList").innerHTML = list.length ? list.map((s) => `<div class="svc-item"><div class="si-main"><div class="si-name">${escapeHtml(s.name)}</div>${s.url ? `<a class="si-url" href="${escapeHtml(s.url)}" target="_blank">${escapeHtml(s.url)}</a>` : ""}${s.repo ? `<div class="si-repo">\u{1F4BB} ${escapeHtml(s.repo)} <span class="si-repo-tag">\uCF54\uB4DC \uD3B8\uC9D1 \uAC00\uB2A5</span></div>` : ""}${s.desc ? `<div class="si-desc">${escapeHtml(s.desc)}</div>` : ""}</div><button class="bn-x" data-id="${s.id}">\u2715</button></div>`).join("") : '<div class="muted" style="padding:16px;text-align:center">\uC544\uC9C1 \uB4F1\uB85D\uD55C \uC11C\uBE44\uC2A4\uAC00 \uC5C6\uC5B4\uC694. \uC704\uC5D0 \uCD94\uAC00\uD558\uC138\uC694.</div>';
    $("svcList").querySelectorAll(".bn-x").forEach((b) => b.addEventListener("click", async () => {
      await connect.servicesDelete(b.dataset.id);
      loadServices();
    }));
  }
  $("svcAddBtn").addEventListener("click", async () => {
    const name = $("svcName").value.trim();
    if (!name) return;
    await connect.servicesAdd({ name, url: $("svcUrl").value.trim(), repo: $("svcRepo").value.trim(), desc: $("svcDesc").value.trim() });
    for (const id of ["svcName", "svcUrl", "svcRepo", "svcDesc"]) $(id).value = "";
    loadServices();
  });
  var API_SERVICES = [
    { id: "telegram", name: "\uD154\uB808\uADF8\uB7A8 \uBD07", icon: "\u{1F4E8}", summary: "\uBE44\uC11C\uAC00 \uD154\uB808\uADF8\uB7A8\uC73C\uB85C \uC591\uBC29\uD5A5 \uBA85\uB839\uC744 \uBC1B\uACE0 \uBCF4\uACE0\uD569\uB2C8\uB2E4. \uD3F0 \uC5B4\uB514\uC11C\uB4E0 \uD68C\uC0AC\uB97C \uC6B4\uC601\uD558\uC138\uC694.", helpUrl: "https://t.me/BotFather", fields: [
      { key: "TELEGRAM_BOT_TOKEN", label: "Bot Token", type: "password", help: "@BotFather\uC5D0\uC11C /newbot\uC73C\uB85C \uBC1C\uAE09 (\uC22B\uC790:\uBB38\uC790)" },
      { key: "TELEGRAM_CHAT_ID", label: "Chat ID", type: "text", placeholder: "\uBE44\uC6CC\uB450\uBA74 \uC790\uB3D9 \uAC10\uC9C0", help: "\uBD07\uD55C\uD14C \uBA54\uC2DC\uC9C0 1\uBC88 \uBCF4\uB0B4\uACE0 \uBE44\uC6B4 \uCC44 \uC800\uC7A5\uD558\uBA74 \uC790\uB3D9 \uC785\uB825" }
    ] },
    { id: "youtube", name: "YouTube Data API", icon: "\u{1F4FA}", summary: "\uB0B4 \uCC44\uB110 + \uACBD\uC7C1 \uCC44\uB110 \uBD84\uC11D, \uB313\uAE00 \uB2F5\uC7A5 \uD050. \uBE44\uACF5\uAC1C \uB370\uC774\uD130\uB294 OAuth \uBCC4\uB3C4.", helpUrl: "https://console.cloud.google.com/", fields: [
      { key: "YOUTUBE_API_KEY", label: "API Key", type: "password", help: "Cloud Console \u2192 YouTube Data API v3 \u2192 API \uD0A4" },
      { key: "YOUTUBE_CHANNEL_ID", label: "Channel ID", type: "text", placeholder: "UCxxx..." }
    ] },
    { id: "youtube-oauth", name: "YouTube Analytics (OAuth)", icon: "\u{1F4CA}", summary: '\uC2DC\uCCAD \uC9C0\uC18D\uB960\xB7\uD2B8\uB798\uD53D\xB7\uAD6C\uB3C5 \uC99D\uAC10. \uC800\uC7A5 \uD6C4 "\u26A1 \uC790\uB3D9 \uC5F0\uACB0"\uB85C \uAD6C\uAE00 \uB85C\uADF8\uC778.', helpUrl: "https://console.cloud.google.com/", wizard: true, fields: [
      { key: "YOUTUBE_OAUTH_CLIENT_ID", label: "Client ID", type: "password" },
      { key: "YOUTUBE_OAUTH_CLIENT_SECRET", label: "Client Secret", type: "password", help: "Cloud Console\uC5D0\uC11C \uC2B9\uC778\uB41C \uB9AC\uB514\uB809\uC158 URI\uC5D0 http://127.0.0.1:5814/yt-oauth-callback \uCD94\uAC00" }
    ] },
    { id: "google-calendar", name: "Google Calendar", icon: "\u{1F4C5}", summary: "\uBE44\uC11C\uAC00 \uC77C\uC815\uC744 \uC77D\uACE0 task \uB9C8\uAC10\uC77C\uACFC \uC790\uB3D9 \uB3D9\uAE30\uD654\uD569\uB2C8\uB2E4.", comingSoon: true, fields: [
      { key: "GOOGLE_CALENDAR_ID", label: "Calendar ID", type: "text", placeholder: "primary \uB610\uB294 ...@group.calendar.google.com" }
    ] },
    { id: "paypal", name: "PayPal (\uB9E4\uCD9C \uBD84\uC11D)", icon: "\u{1F4B0}", summary: "\uACB0\uC81C \uAC70\uB798 \uBD84\uC11D. \u{1F4B0} \uB9E4\uCD9C \uB300\uC2DC\uBCF4\uB4DC + \uC0C8 \uACB0\uC81C \uC54C\uB9BC\uC5D0 \uC0AC\uC6A9.", helpUrl: "https://developer.paypal.com/dashboard/applications", fields: [
      { key: "PAYPAL_MODE", label: "\uBAA8\uB4DC", type: "select", options: ["live", "sandbox"], help: "\uC2E4\uC81C \uACB0\uC81C\uB294 live, \uD14C\uC2A4\uD2B8\uB294 sandbox" },
      { key: "PAYPAL_CLIENT_ID", label: "Client ID", type: "password" },
      { key: "PAYPAL_CLIENT_SECRET", label: "Client Secret", type: "password" },
      { key: "PAYPAL_LOOKBACK_DAYS", label: "\uBD84\uC11D \uAE30\uAC04(\uC77C)", type: "text", placeholder: "30 (\uCD5C\uB300 31)" },
      { key: "PAYPAL_CURRENCY", label: "\uAE30\uBCF8 \uD1B5\uD654(\uC120\uD0DD)", type: "text", placeholder: "USD" }
    ] },
    { id: "toss", name: "\uD1A0\uC2A4\uD398\uC774\uBA3C\uCE20 (\uB9E4\uCD9C \uBD84\uC11D)", icon: "\u{1F4B3}", summary: "\uD1A0\uC2A4 \uACB0\uC81C \uAC70\uB798(KRW)\uB97C \uBD84\uC11D. \u{1F4B0} \uB9E4\uCD9C \uB300\uC2DC\uBCF4\uB4DC + \uC790\uC0B0\uBD84\uC11D\uC5D0 PayPal\uACFC \uD569\uCCD0\uC11C \uBCF4\uC5EC\uC918\uC694.", helpUrl: "https://developers.tosspayments.com/my/api-keys", fields: [
      { key: "TOSS_SECRET_KEY", label: "\uC2DC\uD06C\uB9BF \uD0A4", type: "password", help: "\uD1A0\uC2A4\uD398\uC774\uBA3C\uCE20 \uAC1C\uBC1C\uC790\uC13C\uD130 \u2192 API \uD0A4 \u2192 \uC2DC\uD06C\uB9BF \uD0A4(live_sk_\u2026 \uC2E4\uAC70\uB798 / test_sk_\u2026 \uD14C\uC2A4\uD2B8). \uD074\uB77C\uC774\uC5B8\uD2B8 \uD0A4 \uB9D0\uACE0 \uC2DC\uD06C\uB9BF \uD0A4\uC608\uC694." }
    ] },
    { id: "github", name: "GitHub \u2014 \u26A1 \uB2E8\uAE30 \uAE30\uC5B5", icon: "\u{1F4BB}", summary: "\uC9C0\uC2DD \uB124\uD2B8\uC6CC\uD06C(\uB2E8\uAE30 \uAE30\uC5B5)\uB97C GitHub \uB808\uD3EC\uC5D0 \uBC84\uC804\uAD00\uB9AC\uB85C \uB3D9\uAE30\uD654. \uC5B4\uB514\uC11C\uB4E0 \uBD88\uB7EC\uC624\uACE0 \uC0AC\uB78C\uC774 \uC9C1\uC811 \uD3B8\uC9D1\uB3C4.", helpUrl: "https://github.com/settings/tokens", fields: [
      { key: "GITHUB_TOKEN", label: "Personal Access Token", type: "password", help: "github.com/settings/tokens \u2192 repo(Contents) \uAD8C\uD55C" },
      { key: "GITHUB_DEFAULT_REPO", label: "\uC9C0\uC2DD \uC800\uC7A5\uC18C", type: "text", placeholder: "owner/repo" }
    ] },
    { id: "huggingface", name: "HuggingFace \u2014 \u{1F9EC} \uC7A5\uAE30 \uAE30\uC5B5", icon: "\u{1F917}", summary: "\uC313\uC778 \uC9C0\uC2DD\uC744 \uB370\uC774\uD130\uC14B\uC73C\uB85C \uC5C5\uB85C\uB4DC \u2192 \uBAA8\uB378\uC5D0 \uD30C\uC778\uD29C\uB2DD(\uCCB4\uB4DD). \uD559\uC2B5\uB41C \uBAA8\uB378\uC744 \uD68C\uC0AC \uB1CC\uB85C \uC0AC\uC6A9.", helpUrl: "https://huggingface.co/settings/tokens", fields: [
      { key: "HF_TOKEN", label: "Access Token (write)", type: "password", help: "huggingface.co/settings/tokens \u2192 write \uAD8C\uD55C" },
      { key: "HF_REPO", label: "\uB370\uC774\uD130\uC14B \uC774\uB984", type: "text", placeholder: "connect-ai-brain", help: "\uC774\uB984\uB9CC \uC801\uC73C\uBA74 \uB3FC\uC694 (\uC544\uC774\uB514\uB294 \uD1A0\uD070\uC5D0\uC11C \uC790\uB3D9). HF\uC5D0\uC11C \uBBF8\uB9AC \uC548 \uB9CC\uB4E4\uC5B4\uB3C4 \uC790\uB3D9 \uC0DD\uC131." }
    ] },
    { id: "email", name: "\uC774\uBA54\uC77C (Gmail SMTP+IMAP)", icon: "\u{1F4E7}", summary: "\uBC1B\uC740 \uBA54\uC77C\uC744 \uC77D\uACE0(IMAP) AI\uAC00 \uB2F5\uC7A5 \uCD08\uC548 \u2192 \uD154\uB808\uADF8\uB7A8\uC73C\uB85C \uBCF4\uB0BC\uAE4C\uC694? \uC2B9\uC778\uD558\uBA74 \uBC1C\uC1A1(SMTP). Gmail \uC571 \uBE44\uBC00\uBC88\uD638 \uD558\uB098\uB85C \uB458 \uB2E4.", helpUrl: "https://support.google.com/accounts/answer/185833", fields: [
      { key: "SMTP_HOST", label: "SMTP \uD638\uC2A4\uD2B8", type: "text", placeholder: "smtp.gmail.com" },
      { key: "SMTP_PORT", label: "\uD3EC\uD2B8", type: "text", placeholder: "465" },
      { key: "SMTP_USER", label: "\uACC4\uC815(\uC774\uBA54\uC77C)", type: "text", placeholder: "me@gmail.com" },
      { key: "SMTP_PASS", label: "\uC571 \uBE44\uBC00\uBC88\uD638", type: "password", help: "Gmail 2\uB2E8\uACC4\uC778\uC99D \uD6C4 myaccount.google.com/apppasswords \uC5D0\uC11C \uBC1C\uAE09(16\uC790\uB9AC). \uC774\uAC78\uB85C \uBC1C\uC1A1+\uC218\uC2E0 \uB458 \uB2E4 \uB3FC\uC694." },
      { key: "SMTP_FROM", label: "\uBCF4\uB0B4\uB294 \uC0AC\uB78C(\uC120\uD0DD)", type: "text", placeholder: "\uB0B4 \uC774\uB984 <me@gmail.com>" },
      { key: "IMAP_HOST", label: "\uBC1B\uAE30 IMAP \uD638\uC2A4\uD2B8(\uC120\uD0DD)", type: "text", placeholder: "imap.gmail.com (\uBE44\uC6B0\uBA74 \uC790\uB3D9)" }
    ] },
    { id: "instagram", name: "Instagram (Meta Graph)", icon: "\u{1F4F7}", summary: "\uC778\uC2A4\uD0C0 \uBE44\uC988\uB2C8\uC2A4 \uAC8C\uC2DC + DM/\uB313\uAE00 \uBD84\uC11D.", helpUrl: "https://developers.facebook.com/", comingSoon: true, fields: [
      { key: "META_ACCESS_TOKEN", label: "Access Token", type: "password" },
      { key: "INSTAGRAM_BUSINESS_ID", label: "Business Account ID", type: "text" }
    ] }
  ];
  async function loadIntegrations() {
    const conn = await connect.apiGet() || {};
    $("apiGrid").innerHTML = API_SERVICES.map((svc) => {
      const vals = conn[svc.id] || {};
      const connected = !svc.comingSoon && svc.fields.every((f) => (vals[f.key] || "").trim().length > 0);
      const status = svc.comingSoon ? '<span class="svc-status coming">\uC900\uBE44 \uC911</span>' : connected ? '<span class="svc-status connected">\uC5F0\uACB0\uB428</span>' : '<span class="svc-status">\uBBF8\uC124\uC815</span>';
      const fields = svc.fields.map((f) => {
        const val = vals[f.key] || "";
        const dis = svc.comingSoon ? " disabled" : "";
        let input;
        if (f.type === "select" && f.options) input = `<select${dis}>${f.options.map((o) => `<option${o === val ? " selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`;
        else input = `<input type="${f.type === "password" ? "password" : "text"}" value="${escapeHtml(val)}" placeholder="${escapeHtml(f.placeholder || "")}"${dis} />`;
        return `<div class="svc-field" data-key="${f.key}"><label>${escapeHtml(f.label)}</label><div class="svc-input-wrap">${input}${f.type === "password" && !svc.comingSoon ? '<button class="svc-eye" data-eye="1">\u{1F441}</button>' : ""}</div>${f.help ? `<div class="svc-help">${escapeHtml(f.help)}</div>` : ""}</div>`;
      }).join("");
      const actions = svc.comingSoon ? '<div class="svc-coming">\uACE7 \uD569\uB958\uD569\uB2C8\uB2E4 \xB7 \uB2E4\uC74C \uC5C5\uB370\uC774\uD2B8</div>' : `<div class="svc-actions"><button class="btn primary" data-act="save">\u{1F4BE} \uC800\uC7A5</button>${svc.wizard ? '<button class="btn" data-act="wizard">\u26A1 \uC790\uB3D9 \uC5F0\uACB0</button>' : ""}${svc.helpUrl ? '<button class="btn ghost" data-act="help">\u{1F4D8} \uB3C4\uC6C0\uB9D0</button>' : ""}</div>`;
      return `<div class="svc-card ${svc.comingSoon ? "coming" : connected ? "connected" : ""}" data-svc="${svc.id}"><div class="svc-head"><div class="svc-icon">${svc.icon}</div><div class="svc-name">${escapeHtml(svc.name)}</div>${status}</div><div class="svc-summary">${escapeHtml(svc.summary)}</div><div class="svc-fields">${fields}</div>${actions}</div>`;
    }).join("");
    $("apiGrid").querySelectorAll(".svc-card").forEach((card) => {
      const id = card.dataset.svc;
      const svc = API_SERVICES.find((s) => s.id === id);
      card.querySelector("[data-act=help]")?.addEventListener("click", () => connect.openExternal(svc.helpUrl));
      card.querySelector("[data-act=wizard]")?.addEventListener("click", async () => {
        hint("\u26A1 \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uAD6C\uAE00 \uB85C\uADF8\uC778\uD558\uC138\uC694\u2026");
        const r = await connect.youtubeOAuth();
        hint(r?.ok ? "\u2705 YouTube \uC5F0\uACB0 \uC644\uB8CC!" : `\u26A0\uFE0F ${r?.error || "\uC5F0\uACB0 \uC2E4\uD328"}`);
      });
      card.querySelectorAll(".svc-eye").forEach((eye) => eye.addEventListener("click", () => {
        const inp = eye.previousElementSibling;
        inp.type = inp.type === "password" ? "text" : "password";
      }));
      card.querySelector("[data-act=save]")?.addEventListener("click", async (e) => {
        const btn = e.target;
        const orig = btn.textContent;
        btn.textContent = "\uC800\uC7A5 \uC911\u2026";
        const values = {};
        card.querySelectorAll(".svc-field").forEach((fld) => {
          const k = fld.dataset.key;
          const el = fld.querySelector("input,select");
          values[k] = (el.value || "").trim();
        });
        const r = await connect.apiSave(id, values);
        btn.textContent = orig;
        hint(r?.note || (r?.ok ? "\uC800\uC7A5\uB428 \u2705" : "\u26A0\uFE0F " + (r?.error || "\uC2E4\uD328")));
        loadIntegrations();
      });
    });
  }
  var officeBuilt = false;
  var officeStreams = {};
  var SPRITE = (id) => `../../assets/pixel/characters/${id}.png`;
  var OFFICE_BG = "../../assets/map.jpeg";
  var VO_HOME = {
    ceo: [53, 15],
    // 상단 회의 테이블 (대표석)
    youtube: [13, 22],
    // 좌상단 프레젠테이션/책장 방
    instagram: [88, 21],
    // 우상단 데스크
    designer: [13, 47],
    // 좌측 데스크
    developer: [48, 50],
    // 중앙 메인 개발 데스크
    business: [85, 47],
    // 우측 주방/미팅 바
    researcher: [86, 84],
    // 우하단 라운지
    writer: [25, 86],
    // 좌하단 방
    secretary: [47, 86],
    // 하단 중앙 리셉션
    editor: [10, 80]
    // 좌하단 라운지 소파 (사운드)
  };
  var VO_MEET = [50, 50];
  var esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  var setText = (id, t) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t;
  };
  function buildOffice() {
    $("officeName").textContent = cfg.company || "\uC6B0\uB9AC \uD68C\uC0AC";
    const room = $("voffice");
    room.innerHTML = `<div class="office-stage" id="officeStage" style="background-image:url('${OFFICE_BG}')"></div>`;
    const stage = $("officeStage");
    stage.innerHTML = `<div class="vo-meet" style="left:${VO_MEET[0]}%;top:${VO_MEET[1]}%"></div>` + AGENT_ORDER.map((id) => {
      const a = AGENTS[id];
      if (!a) return "";
      const [x, y] = VO_HOME[id] || VO_MEET;
      const ceo = id === "ceo" ? " is-ceo" : "";
      return `<div class="vo-agent idle${ceo}" id="vo-${id}" data-dir="down" data-cx="${x}" data-cy="${y}" style="--ag:${a.color};left:${x}%;top:${y}%">
        <div class="vo-bubble" id="vob-${id}"></div>
        <div class="vo-status" id="vost-${id}">\uB300\uAE30</div>
        <div class="character" style="background-image:url('${SPRITE(id)}')"></div>
        <div class="vo-plate">${a.emoji} ${escapeHtml(agName(id))}</div>
      </div>`;
    }).join("");
    officeBuilt = true;
    startSpriteLoop();
    startOfficeLife();
    void renderOfficeTodo();
  }
  var TILE = 48;
  var CH = 96;
  var voFrame = 0;
  var voRaf = 0;
  function startSpriteLoop() {
    if (voRaf) return;
    const tick = () => {
      voFrame++;
      for (const id of AGENT_ORDER) {
        const el = document.getElementById("vo-" + id);
        if (!el) continue;
        const c = el.querySelector(".character");
        if (!c) continue;
        let col = 0;
        switch (el.dataset.dir) {
          case "left":
            col = 6;
            break;
          case "right":
            col = 12;
            break;
          case "up":
            col = 18;
            break;
          default:
            col = 0;
        }
        const moving = el.classList.contains("walking") || el.classList.contains("working") || el.classList.contains("thinking");
        const row = moving ? 2 : 1;
        const speed = moving ? 8 : 14;
        const fi = Math.floor(voFrame / speed) % 6;
        c.style.backgroundPosition = `-${(col + fi) * TILE}px -${row * CH}px`;
      }
      voRaf = requestAnimationFrame(tick);
    };
    voRaf = requestAnimationFrame(tick);
  }
  function voMove(id, x, y) {
    const el = document.getElementById("vo-" + id);
    if (!el) return;
    const px = parseFloat(el.dataset.cx || "50"), py = parseFloat(el.dataset.cy || "50");
    const dx = x - px, dy = y - py;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) el.dataset.dir = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up";
    el.dataset.cx = String(x);
    el.dataset.cy = String(y);
    el.classList.add("walking");
    el.style.left = x + "%";
    el.style.top = y + "%";
    window.clearTimeout(el._wt);
    el._wt = window.setTimeout(() => el.classList.remove("walking"), 950);
  }
  var voHome = (id) => {
    const h = VO_HOME[id] || VO_MEET;
    voMove(id, h[0], h[1]);
  };
  function voSparks(id) {
    const el = document.getElementById("vo-" + id);
    if (!el) return;
    for (let k = 0; k < 4; k++) {
      const sp = document.createElement("div");
      sp.className = "vo-spark";
      sp.style.left = 20 + (Math.random() - 0.5) * 10 + "px";
      sp.style.top = 18 + Math.random() * 8 + "px";
      sp.style.setProperty("--sx", ((Math.random() - 0.5) * 30).toFixed(0) + "px");
      sp.style.setProperty("--sy", (-34 - Math.random() * 18).toFixed(0) + "px");
      sp.style.animationDelay = k * 70 + "ms";
      el.appendChild(sp);
      setTimeout(() => {
        try {
          sp.remove();
        } catch {
        }
      }, 1400 + k * 70);
    }
  }
  function officeSet(id, state, text) {
    if (!officeBuilt) buildOffice();
    const el = document.getElementById("vo-" + id);
    if (!el) return;
    el.classList.remove("thinking", "working", "done", "idle");
    const b = document.getElementById("vob-" + id);
    if (state === "think") {
      el.classList.add("thinking");
      setText("vost-" + id, "\uC900\uBE44 \uC911\u2026");
    } else if (state === "work") {
      el.classList.add("working");
      setText("vost-" + id, WORK_LABEL[id] || "\uC791\uC5C5 \uC911\u2026");
      voSparks(id);
    } else if (state === "done") {
      el.classList.add("done");
      setText("vost-" + id, "\u2713 \uC644\uB8CC");
      voHome(id);
      if (b) b.classList.remove("show", "typing", "speech");
    } else {
      el.classList.add("idle");
      setText("vost-" + id, "\uB300\uAE30");
      if (b) b.classList.remove("show", "typing", "speech");
    }
  }
  function officeStream(id, chunk) {
    if (!officeBuilt) buildOffice();
    const el = document.getElementById("vo-" + id);
    if (!el) return;
    el.classList.add("working");
    el.classList.remove("thinking", "done", "idle");
    setText("vost-" + id, "\uC791\uC5C5 \uC911\u2026");
    officeStreams[id] = (officeStreams[id] || "") + chunk;
    const b = document.getElementById("vob-" + id);
    if (b) {
      b.textContent = officeStreams[id].replace(/\s+/g, " ").trim().slice(-60) || "\u2026";
      b.classList.add("show", "typing");
      b.classList.remove("speech");
    }
  }
  function officeDispatch(agents) {
    if (!officeBuilt) buildOffice();
    taskActive = true;
    $("officeStatus").textContent = `\u{1F680} ${agents.length}\uBA85 \uC18C\uC9D1`;
    const banner = document.createElement("div");
    banner.className = "dispatch-banner";
    banner.innerHTML = `<span class="db-tag">\u{1F4CB} \uD300 \uC18C\uC9D1</span><span class="db-sub">${agents.map((a) => a.emoji).join(" ")} ${agents.length}\uBA85 \uD22C\uC785</span>`;
    $("officeStage").appendChild(banner);
    setTimeout(() => banner.remove(), 1900);
    const ceo = document.getElementById("vo-ceo");
    if (ceo) {
      ceo.classList.add("commanding");
      setTimeout(() => ceo.classList.remove("commanding"), 1900);
    }
    agents.forEach((a, i) => {
      officeStreams[a.id] = "";
      const ang = agents.length > 1 ? i / agents.length * Math.PI * 2 : 0;
      const cx = VO_MEET[0] + Math.cos(ang) * 12, cy = VO_MEET[1] + Math.sin(ang) * 10;
      setTimeout(() => {
        voMove(a.id, cx, cy);
        officeSet(a.id, "think");
      }, 150 + i * 140);
      setTimeout(() => {
        voHome(a.id);
      }, 1500 + i * 140);
    });
  }
  function officeConfer(e) {
    const to = VO_HOME[e.to] || VO_MEET, fr = VO_HOME[e.from] || VO_MEET;
    const el = document.getElementById("vo-" + e.from), b = document.getElementById("vob-" + e.from);
    voMove(e.from, to[0] + (to[0] > 50 ? -9 : 9), to[1] + 4);
    if (b) {
      b.textContent = e.text;
      b.classList.add("show", "speech");
      b.classList.remove("typing");
    }
    officeSay(e.from, e.text);
    setTimeout(() => {
      voMove(e.from, fr[0], fr[1]);
      if (b) b.classList.remove("show", "speech");
    }, 2600);
    const feed = $("conferFeed");
    const line = document.createElement("div");
    line.className = "cf-line";
    const fc = AGENTS[e.from]?.color || "#9fe", te = AGENTS[e.to]?.emoji || "";
    line.innerHTML = `<span class="cf-from" style="color:${fc}">${AGENTS[e.from]?.emoji || ""} ${esc(e.fromName)}</span><span class="cf-arrow">\u2192</span><span class="cf-to">${te} ${esc(e.toName)}</span><span class="cf-txt">${esc(e.text)}</span>`;
    feed.appendChild(line);
    feed.scrollTop = feed.scrollHeight;
  }
  function officeReset() {
    if (officeBuilt) AGENT_ORDER.forEach((id) => {
      officeStreams[id] = "";
      officeSet(id, "idle");
      voHome(id);
    });
    $("conferFeed").innerHTML = "";
  }
  var WORK_LABEL = { ceo: "\u{1F9ED} \uC9C0\uD718 \uC911", youtube: "\u{1F3AC} \uAE30\uD68D \uC911", instagram: "\u{1F4F8} \uCF58\uD150\uCE20 \uC911", designer: "\u{1F3A8} \uB514\uC790\uC778 \uC911", developer: "\u{1F4BB} \uCF54\uB529 \uC911", business: "\u{1F4C8} \uBD84\uC11D \uC911", secretary: "\u{1F5C2}\uFE0F \uC815\uB9AC \uC911", editor: "\u2702\uFE0F \uD3B8\uC9D1 \uC911", writer: "\u270D\uFE0F \uC791\uC131 \uC911", researcher: "\u{1F50D} \uC870\uC0AC \uC911" };
  var LIFE_SPOTS = [[50, 30], [63, 40], [37, 40], [50, 58], [30, 70], [72, 70]];
  var AMBIENT = {
    ceo: ["\uB2E4\uB4E4 \uC798\uD558\uACE0 \uC788\uB124 \u{1F44D}", "\uC774\uBC88 \uBD84\uAE30 \uAC00\uBCF4\uC790", "\uD68C\uC758 \uD55C\uBC88 \uC7A1\uC744\uAE4C", "\uCEE4\uD53C\uB098 \uD55C\uC794 \u2615"],
    youtube: ["\uB2E4\uC74C \uC601\uC0C1 \uBB50 \uCC0D\uC9C0 \u{1F3AC}", "\uC378\uB124\uC77C A/B \uB3CC\uB824\uBCFC\uAE4C", "\uC774\uBC88 \uD3B8 \uBC18\uC751 \uC88B\uB2E4", "\uC624\uD504\uB2DD\uC744 \uBC14\uAFD4\uBCFC\uAE4C"],
    instagram: ["\uB9B4\uC2A4 \uAC01 \uB098\uC654\uB2E4 \u{1F4F8}", "\uD574\uC2DC\uD0DC\uADF8 \uBB50 \uB2EC\uC9C0", "\uD53C\uB4DC \uD1A4 \uB9DE\uCDB0\uC57C\uC9C0", "\uC2A4\uD1A0\uB9AC \uC62C\uB9B4 \uC2DC\uAC04"],
    designer: ["\uC774 \uC0C9 \uC870\uD569 \uAD1C\uCC2E\uC740\uB370 \u{1F3A8}", "\uD3F0\uD2B8 \uC880 \uBC14\uAFD4\uBCFC\uAE4C", "\uB808\uD37C\uB7F0\uC2A4 \uCC3E\uC544\uBD10\uC57C\uC9C0", "\uC5EC\uBC31\uC774 \uC0DD\uBA85\uC774\uC9C0"],
    developer: ["\uC774 \uBC84\uADF8 \uC65C \uC774\uB7EC\uC9C0 \u{1F41B}", "\uB9AC\uD329\uD1A0\uB9C1 \uB561\uAE34\uB2E4", "\uCEE4\uBC0B\uD558\uACE0 \uC26C\uC790 \u2615", "\uD14C\uC2A4\uD2B8 \uB3CC\uB824\uB193\uACE0"],
    business: ["\uC774\uBC88 \uB2EC \uB9E4\uCD9C \uC88B\uB124 \u{1F4C8}", "\uC804\uD658\uC728\uC774 \uAD00\uAC74\uC774\uC57C", "\uAD11\uACE0 \uC608\uC0B0 \uC5B4\uB514 \uC4F8\uAE4C", "\uB9AC\uD150\uC158 \uBCF4\uC790"],
    secretary: ["\uC77C\uC815 \uC815\uB9AC\uD574\uC57C\uC9C0 \u{1F5C2}\uFE0F", "\uC624\uB298 \uD560 \uC77C \uBB50\uC600\uB354\uB77C", "\uBA54\uC77C \uB2F5\uC7A5 \uBC00\uB838\uB124", "\uB2E4\uB4E4 \uBC14\uBE60 \uBCF4\uC5EC"],
    editor: ["\uCEF7 \uD3B8\uC9D1 \uAE54\uB054\uD558\uAC8C \u2702\uFE0F", "BGM \uBB50 \uAE54\uC9C0", "\uC790\uB9C9 \uD0C0\uC774\uBC0D \uB9DE\uCDB0\uC57C\uC9C0", "\uD55C \uBC88 \uB354 \uBCF4\uC790"],
    writer: ["\uCCAB \uBB38\uC7A5\uC774 \uC5B4\uB835\uB124 \u270D\uFE0F", "\uCE74\uD53C \uC880 \uB354 \uC9E7\uAC8C", "\uD1A4\uC744 \uBC14\uAFD4\uBCFC\uAE4C", "\uC81C\uBAA9\uC774 \uC808\uBC18\uC774\uC9C0"],
    researcher: ["\uC774 \uC790\uB8CC \uD765\uBBF8\uB86D\uB2E4 \u{1F50D}", "\uCD9C\uCC98 \uB354 \uCC3E\uC544\uBCF4\uC790", "\uD2B8\uB80C\uB4DC \uC815\uB9AC \uC911", "\uB370\uC774\uD130\uAC00 \uB9D0\uD574\uC8FC\uB124"]
  };
  var SMALLTALK = ["\uC624\uB298 \uC5B4\uB54C\uC694? \u{1F60A}", "\uCEE4\uD53C \uD55C\uC794? \u2615", "\uADF8\uAC70 \uBD24\uC5B4\uC694?", "\uC218\uACE0 \uB9CE\uC544\uC694 \u{1F44D}", "\uC810\uC2EC \uBB50 \uBA39\uC8E0?", "\uC8FC\uB9D0 \uACC4\uD68D \uC788\uC5B4\uC694?", "\uAC19\uC774 \uD574\uBCFC\uAE4C\uC694?", "\uC88B\uC740 \uC544\uC774\uB514\uC5B4\uB124\uC694 \u2728", "\uC798 \uB418\uAC00\uC694?", "\uC624 \uBA4B\uC9C4\uB370\uC694!"];
  var FRIENDS = [["designer", "developer"], ["youtube", "editor"], ["instagram", "writer"], ["business", "secretary"], ["researcher", "ceo"]];
  var pick = (a) => a[Math.random() * a.length | 0];
  var lifeTimer = null;
  var taskActive = false;
  var officeMemory = [];
  function rememberOffice(ev) {
    if (!ev) return;
    officeMemory.push(ev);
    if (officeMemory.length > 8) officeMemory.shift();
  }
  var REACT = ["\uADF8\uAC70 \uBD24\uC5B4\uC694? ", "\uC544\uAE4C ", "\uC624 ", "\uB300\uBC15 ", "\uC5ED\uC2DC ", "\uC640 "];
  function startOfficeLife() {
    if (lifeTimer) return;
    syncOfficeVoiceBtn();
    lifeTimer = window.setInterval(lifeTick, 2800);
  }
  function officeLive() {
    if (!taskActive) $("officeStatus").textContent = "\u{1F7E2} LIVE \xB7 \uC0AC\uBB34\uC2E4 \uAC00\uB3D9 \uC911";
  }
  var officeVoiceOn = false;
  var officeVoiceQ = [];
  var officeVoicePlaying = false;
  async function pumpOfficeVoice() {
    if (officeVoicePlaying || !officeVoiceQ.length) return;
    officeVoicePlaying = true;
    const { id, text } = officeVoiceQ.shift();
    try {
      const r = await connect.ttsSpeakAgent?.(id, text);
      if (officeVoiceOn && r?.ok && r.dataUri) {
        const b = document.getElementById("vob-" + id);
        b?.classList.add("show", "speech");
        await new Promise((res) => {
          const a = new Audio(r.dataUri);
          a.onended = () => res();
          a.onerror = () => res();
          a.play().catch(() => res());
        });
      }
    } catch {
    }
    officeVoicePlaying = false;
    pumpOfficeVoice();
  }
  function officeSay(id, text) {
    if (!officeVoiceOn || !text || !AGENTS[id]) return;
    if (officeVoiceQ.length > 2) officeVoiceQ.shift();
    officeVoiceQ.push({ id, text: stripMd(text).slice(0, 120) });
    pumpOfficeVoice();
  }
  function syncOfficeVoiceBtn() {
    officeVoiceOn = !!cfg.officeVoice;
    const b = $("officeVoiceBtn");
    if (b) {
      b.textContent = officeVoiceOn ? "\u{1F50A}" : "\u{1F507}";
      b.classList.toggle("on", officeVoiceOn);
    }
  }
  $("officeVoiceBtn")?.addEventListener("click", async () => {
    officeVoiceOn = !officeVoiceOn;
    cfg.officeVoice = officeVoiceOn;
    connect.setConfig?.({ officeVoice: officeVoiceOn });
    syncOfficeVoiceBtn();
    if (officeVoiceOn) officeSay("secretary", "\uC74C\uC131 \uB300\uD654\uB97C \uCF30\uC5B4\uC694! \uC774\uC81C \uC800\uD76C\uB07C\uB9AC\uB3C4 \uBAA9\uC18C\uB9AC\uB85C \uC774\uC57C\uAE30\uD560\uAC8C\uC694, \uC0AC\uC7A5\uB2D8.");
    hint(officeVoiceOn ? "\u{1F3AD} \uC5D0\uC774\uC804\uD2B8 \uC74C\uC131 \uB300\uD654 \uCF1C\uC9D0 \u2014 \uAC01\uC790 \uB2E4\uB978 \uBAA9\uC18C\uB9AC\uB85C \uB9D0\uD574\uC694" : "\u{1F507} \uC74C\uC131 \uB300\uD654\uB97C \uAED0\uC5B4\uC694");
  });
  function lifeBubble(id, text, cls = "speech") {
    const b = document.getElementById("vob-" + id);
    if (!b) return;
    b.textContent = text;
    b.classList.add("show", cls);
    b.classList.remove("typing");
    window.clearTimeout(b._lt);
    b._lt = window.setTimeout(() => b.classList.remove("show", "speech", "ambient"), 2900);
    if (cls !== "typing") officeSay(id, text);
  }
  function feedAmbient(html) {
    feedRaw(html, "ambient");
  }
  function feedRaw(html, cls) {
    const feed = $("conferFeed");
    if (!feed) return;
    const line = document.createElement("div");
    line.className = "cf-line " + cls;
    line.innerHTML = html;
    feed.appendChild(line);
    feed.scrollTop = feed.scrollHeight;
    while (feed.childElementCount > 60 && feed.firstChild) feed.removeChild(feed.firstChild);
  }
  function feedStory(emoji, name, action, color = "#9fe") {
    feedRaw(`<span class="cf-from" style="color:${color}">${emoji} ${esc(name)}</span><span class="cf-txt story">${esc(action)}</span>`, "story");
  }
  var isIdle = (id) => {
    const el = document.getElementById("vo-" + id);
    return !!el && el.classList.contains("idle");
  };
  var banterPool = [];
  var banterFetching = false;
  var banterLast = 0;
  async function refillBanter() {
    if (!OFFICE_MODE) return;
    if (banterFetching || banterPool.length > 2) return;
    if (Date.now() - banterLast < 25e3) return;
    banterFetching = true;
    banterLast = Date.now();
    try {
      const r = await connect.officeBanter?.();
      if (r?.ok && r.lines?.length) banterPool = r.lines;
    } catch {
    } finally {
      banterFetching = false;
    }
  }
  var nextBanter = () => {
    while (banterPool.length) {
      const b = banterPool.shift();
      if (AGENTS[b.from] && b.text) return b;
    }
    return null;
  };
  function lifeTick() {
    if (taskActive || !officeBuilt) return;
    if ($("officePanel").classList.contains("hidden")) return;
    officeLive();
    refillBanter();
    const idle = AGENT_ORDER.filter(isIdle);
    if (idle.length < 1) return;
    const roll = Math.random();
    if (roll < 0.46) {
      const bl = nextBanter();
      if (bl && isIdle(bl.from)) {
        const b = bl.to && AGENTS[bl.to] && bl.to !== bl.from && isIdle(bl.to) ? bl.to : pick(idle.filter((x) => x !== bl.from));
        if (b) lifeSocialize(bl.from, b, bl.text);
        else lifeBubble(bl.from, bl.text, "ambient");
      } else if (idle.length >= 2) {
        const a = pick(idle);
        const fr = FRIENDS.find(([x, y]) => x === a || y === a)?.filter((z) => z !== a)[0];
        const b = fr && isIdle(fr) ? fr : pick(idle.filter((x) => x !== a));
        if (b) lifeSocialize(a, b);
      }
    } else if (roll < 0.74) {
      lifeWander(pick(idle));
    } else {
      const bl = nextBanter();
      const id = bl && isIdle(bl.from) ? bl.from : pick(idle);
      lifeBubble(id, bl && id === bl.from ? bl.text : pick(AMBIENT[id] || SMALLTALK), "ambient");
    }
  }
  function lifeWander(id) {
    if (!isIdle(id)) return;
    const spot = pick(LIFE_SPOTS), home = VO_HOME[id] || VO_MEET;
    voMove(id, spot[0] + (Math.random() - 0.5) * 8, spot[1] + (Math.random() - 0.5) * 6);
    if (Math.random() < 0.5) setTimeout(() => lifeBubble(id, pick(AMBIENT[id] || SMALLTALK), "ambient"), 600);
    window.setTimeout(() => {
      if (isIdle(id) && !taskActive) voHome(id);
    }, 2600 + Math.random() * 1600);
  }
  function lifeSocialize(a, b, realLine) {
    if (!isIdle(a) || !isIdle(b)) return;
    const hb = VO_HOME[b] || VO_MEET, ha = VO_HOME[a] || VO_MEET;
    voMove(a, hb[0] + (hb[0] > 50 ? -8 : 8), hb[1] + 5);
    const la = realLine || (officeMemory.length && Math.random() < 0.35 ? `${pick(REACT)}${pick(officeMemory)} \u{1F44F}` : pick(SMALLTALK));
    const lb = pick([...SMALLTALK, ...AMBIENT[b] || []]);
    setTimeout(() => {
      if (taskActive) return;
      lifeBubble(a, la);
      feedAmbient(`<span class="cf-from" style="color:${AGENTS[a]?.color || "#9fe"}">${AGENTS[a]?.emoji || ""} ${esc(AGENTS[a]?.name || a)}</span><span class="cf-arrow">\u2192</span><span class="cf-to">${AGENTS[b]?.emoji || ""} ${esc(AGENTS[b]?.name || b)}</span><span class="cf-txt">${esc(la)}</span>`);
    }, 750);
    setTimeout(() => {
      if (taskActive) return;
      lifeBubble(b, lb);
    }, 1700);
    window.setTimeout(() => {
      if (!taskActive) voMove(a, ha[0], ha[1]);
    }, 3100);
  }
  connect.onUpdateStatus?.((s) => {
    const bar = $("updateBar");
    if (!bar) return;
    if (s.state === "downloading") {
      bar.hidden = false;
      bar.className = "update-bar dl";
      bar.innerHTML = `\u2B07\uFE0F \uC0C8 \uBC84\uC804 \uBC1B\uB294 \uC911\u2026 <b>${s.percent || 0}%</b>`;
    } else if (s.state === "downloaded") {
      bar.hidden = false;
      bar.className = "update-bar ready";
      bar.innerHTML = `\u{1F389} \uC0C8 \uBC84\uC804 <b>v${s.version}</b> \uC900\uBE44\uB410\uC5B4\uC694 <button id="updNow">\uC7AC\uC2DC\uC791\uD574\uC11C \uC5C5\uADF8\uB808\uC774\uB4DC</button> <button id="updLater" class="upd-ghost">\uB098\uC911\uC5D0</button>`;
      $("updNow")?.addEventListener("click", () => connect.updateInstall?.());
      $("updLater")?.addEventListener("click", () => {
        bar.setAttribute("hidden", "");
      });
    } else if (s.state === "available") {
      hint(`\u2B06\uFE0F \uC0C8 \uBC84\uC804 v${s.version} \uBC1B\uB294 \uC911\u2026`);
    }
  });
  var officeEngagedM = false;
  function ensureOfficeM() {
    if (officeEngagedM) return;
    officeEngagedM = true;
    taskActive = true;
    buildOffice();
    officeReset();
    $("officeStatus").textContent = "\uAC00\uB3D9 \uC911\u2026";
    officeSet("ceo", "work");
  }
  function driveOfficeEvent(e) {
    if (e.kind === "dispatch") {
      ensureOfficeM();
      officeDispatch(e.agents);
      feedStory("\u{1F9D1}\u200D\u{1F3EB}", cfg.userTitle || "\uC0AC\uC7A5\uB2D8", `\uD300 ${e.agents.length}\uBA85 \uC18C\uC9D1`, "#ffd166");
    } else if (e.kind === "agentStart") {
      ensureOfficeM();
      officeStreams[e.id] = "";
      officeSet(e.id, "work");
      feedStory(e.emoji, e.name, (WORK_LABEL[e.id] || "\uC791\uC5C5 \uC911").replace(/중$/, "\uC2DC\uC791"), AGENTS[e.id]?.color);
    } else if (e.kind === "agentChunk") {
      officeStream(e.id, e.text);
    } else if (e.kind === "agentDone") {
      officeSet(e.id, "done", e.output);
      feedStory(AGENTS[e.id]?.emoji || "\u{1F916}", AGENTS[e.id]?.name || e.id, "\u2713 \uC644\uB8CC", AGENTS[e.id]?.color);
      rememberOffice(`${AGENTS[e.id]?.name || e.id}\uAC00 \uC77C \uB05D\uB0B8 \uAC70`);
    } else if (e.kind === "agentConfer") {
      officeConfer(e);
    } else if (e.kind === "final") {
      if (officeEngagedM) {
        officeSet("ceo", "done", e.text);
        $("officeStatus").textContent = "\uBCF4\uACE0 \uC644\uB8CC";
        feedStory("\u{1F9ED}", "CEO", "\uC885\uD569 \uBCF4\uACE0 \uC644\uB8CC \u2713", "#9fe");
        setTimeout(() => {
          taskActive = false;
          officeLive();
        }, 3e3);
      }
    }
  }
  function grandEntrance() {
    $("officeStatus").textContent = "\uD300 \uCD9C\uADFC \uC911\u2026";
    AGENT_ORDER.forEach((id, i) => {
      const el = document.getElementById("vo-" + id);
      if (!el) return;
      el.style.opacity = "0";
      el.classList.remove("vo-pop");
      setTimeout(() => {
        el.style.opacity = "1";
        el.classList.add("vo-pop");
        const ring = document.createElement("div");
        ring.className = "vo-burst";
        el.appendChild(ring);
        setTimeout(() => {
          try {
            ring.remove();
          } catch {
          }
        }, 650);
        voSparks(id);
        officeSet(id, "work");
        setTimeout(() => {
          el.classList.remove("vo-pop");
          officeSet(id, "idle");
        }, 900);
        if (i === AGENT_ORDER.length - 1) setTimeout(() => {
          $("officeStatus").textContent = "\uC804\uC6D0 \uCD9C\uADFC \xB7 \uC6B4\uC601 \uC911";
          officeLive();
        }, 700);
      }, 240 * i + 120);
    });
  }
  var _ofsFeedTs = 0;
  var _ofsIdleTimers = {};
  function officeOpsTick(s) {
    if (!s || !officeBuilt) return;
    if (s.executing && s.executingTitle) $("officeStatus").textContent = "\u26A1 \uC791\uC804 \uC218\uD589 \uC911 \xB7 " + String(s.executingTitle).slice(0, 26);
    else if (s.phase === "done" && s.running) $("officeStatus").textContent = "\u{1F3C1} \uC0AC\uC774\uD074 \uC644\uB8CC \u2014 \uB2E4\uC74C \uC9C0\uC2DC \uB300\uAE30";
    const fresh = (s.feed || []).filter((f) => f.ts > _ofsFeedTs).reverse();
    for (const f of fresh) {
      _ofsFeedTs = Math.max(_ofsFeedTs, f.ts);
      const ag = AGENTS[f.agent];
      feedStory(f.icon || "\u{1F527}", ag?.name || f.agent, f.text || "", ag?.color);
      if (ag) {
        officeSet(f.agent, "work");
        voSparks(f.agent);
        window.clearTimeout(_ofsIdleTimers[f.agent]);
        _ofsIdleTimers[f.agent] = window.setTimeout(() => {
          if (!taskActive) officeSet(f.agent, "idle");
        }, 2600);
      }
    }
  }
  async function refreshTeamBrain() {
    const el = $("teamBrain");
    if (!el) return;
    let modelName = "", running = false;
    try {
      const s = await connect.localStatus?.();
      running = !!s?.running;
      modelName = s?.modelName || "";
    } catch {
    }
    let know = 0;
    try {
      const c = await connect.brainCount?.();
      know = (typeof c === "number" ? c : c?.count) || 0;
    } catch {
    }
    const brain = running && modelName ? modelName.replace(/\.gguf$/i, "").slice(0, 22) : "\uAE30\uBCF8 \uBAA8\uB378";
    el.innerHTML = `\u{1F9E0} Brain: <b>${escapeHtml(brain)}</b> \xB7 \uC9C0\uC2DD ${know}`;
    el.classList.toggle("mine", running && !!modelName);
  }
  var OFFICE_MODE = new URLSearchParams(location.search).get("office") === "1";
  if (OFFICE_MODE) {
    document.body.classList.add("office-only");
    buildOffice();
    openOverlay("officePanel");
    requestAnimationFrame(() => grandEntrance());
    connect.onEngineEvent?.(driveOfficeEvent);
    connect.onOpsUpdate?.((s) => officeOpsTick(s));
  }
  refreshTeamBrain();
  connect.onLocalStatus?.(() => refreshTeamBrain());
  $("officePop")?.addEventListener("click", () => connect.officeOpen?.());
  var codeWs = "";
  var codeCurrentFile = "";
  var NEW_MS = 25e3;
  function renderTreeNodes(nodes, depth) {
    return nodes.map((n) => {
      const pad = `padding-left:${8 + depth * 13}px`;
      if (n.dir) return `<div class="tnode tdir" style="${pad}"><span class="tcaret">\u25B8</span>\u{1F4C1} ${escapeHtml(n.name)}</div><div class="tchildren" hidden>${renderTreeNodes(n.children || [], depth + 1)}</div>`;
      const fresh = Date.now() - (n.mtime || 0) < NEW_MS ? ' <b class="tnew">\u2728</b>' : "";
      return `<div class="tnode tfile" data-file="${escapeHtml(n.path)}" style="${pad}">${fileIcon(n.name)} <span>${escapeHtml(n.name)}</span>${fresh}</div>`;
    }).join("");
  }
  async function loadTree(autoOpenNewest = false) {
    const tree = await connect.fsTree(codeWs || void 0);
    codeWs = tree.root;
    $("codePath").textContent = (tree.root || "").split(/[\\/]/).filter(Boolean).pop() || tree.root;
    const treeEl = $("codeTree");
    treeEl.innerHTML = tree.children?.length ? renderTreeNodes(tree.children, 0) : '<div class="code-empty-tree">\uBE48 \uD3F4\uB354\uC608\uC694.<br/>\uC5D0\uC774\uC804\uD2B8\uC5D0\uAC8C "\uC6F9\uC0AC\uC774\uD2B8 \uB9CC\uB4E4\uC5B4\uC918" \uD574\uBCF4\uC138\uC694.</div>';
    treeEl.querySelectorAll(".tdir").forEach((el) => el.addEventListener("click", () => {
      const kids = el.nextElementSibling;
      const caret = el.querySelector(".tcaret");
      if (!kids) return;
      const hidden = kids.hasAttribute("hidden");
      if (hidden) {
        kids.removeAttribute("hidden");
        if (caret) caret.textContent = "\u25BE";
      } else {
        kids.setAttribute("hidden", "");
        if (caret) caret.textContent = "\u25B8";
      }
    }));
    treeEl.querySelectorAll(".tfile").forEach((el) => el.addEventListener("click", () => openFile(el.dataset.file)));
    if (autoOpenNewest) {
      let bestP = "";
      let bestM = -1;
      const scan = (nodes) => nodes.forEach((n) => {
        if (n.dir) scan(n.children || []);
        else if ((n.mtime || 0) > bestM) {
          bestM = n.mtime || 0;
          bestP = n.path;
        }
      });
      scan(tree.children || []);
      if (bestP && Date.now() - bestM < NEW_MS) {
        openFile(bestP);
        revealInTree(bestP);
      }
    }
  }
  function revealInTree(p) {
    const el = $("codeTree").querySelector(`.tfile[data-file="${window.CSS?.escape ? CSS.escape(p) : p}"]`);
    let par = el?.parentElement;
    while (par && par.id !== "codeTree") {
      if (par.classList?.contains("tchildren") && par.hasAttribute("hidden")) {
        par.removeAttribute("hidden");
        const c = par.previousElementSibling?.querySelector(".tcaret");
        if (c) c.textContent = "\u25BE";
      }
      par = par.parentElement;
    }
    el?.scrollIntoView({ block: "nearest" });
  }
  function closeEditor() {
    $("codeView").classList.remove("open");
    $("codeView").innerHTML = "";
  }
  function edHead(name, rightBtns) {
    return `<div class="code-fname">${fileIcon(name)} <span class="cf-name">${escapeHtml(name)}</span><span class="cf-btns">${rightBtns}<button class="code-mini cf-x" id="cvClose" title="\uB2EB\uAE30 (\uCC44\uD305\uC73C\uB85C)">\u2715</button></span></div>`;
  }
  function wireHead() {
    $("cvClose")?.addEventListener("click", closeEditor);
  }
  async function openFile(p) {
    codeCurrentFile = p;
    $("codeTree").querySelectorAll(".tfile").forEach((el) => el.classList.toggle("sel", el.dataset.file === p));
    $("codeView").classList.add("open");
    const r = await connect.fsRead(p);
    const view = $("codeView");
    const nm = r.name || (p.split(/[\\/]/).pop() || "");
    if (r.error) {
      view.innerHTML = edHead(nm, "") + `<div class="code-empty">\u26A0\uFE0F ${escapeHtml(r.error)}</div>`;
      wireHead();
      return;
    }
    if (r.image) {
      view.innerHTML = edHead(nm, `<button class="code-mini" id="cvReveal">\u{1F50D}</button>`) + `<div class="code-img"><img src="${r.image}"/></div>`;
      wireHead();
      $("cvReveal")?.addEventListener("click", () => connect.fsReveal(p));
      return;
    }
    if (r.binary) {
      view.innerHTML = edHead(nm, `<button class="code-mini" id="cvReveal">\u{1F50D} Finder</button>`) + `<div class="code-empty">\uBC14\uC774\uB108\uB9AC \uD30C\uC77C\uC774\uB77C \uBBF8\uB9AC\uBCF4\uAE30\uB97C \uBABB \uD574\uC694.</div>`;
      wireHead();
      $("cvReveal")?.addEventListener("click", () => connect.fsReveal(p));
      return;
    }
    renderFileView(nm, r.content || "");
  }
  function renderFileView(name, content) {
    const lines = content.split("\n");
    const gutter = lines.map((_l, i) => i + 1).join("\n");
    $("codeView").classList.add("open");
    $("codeView").innerHTML = edHead(name, `<span class="cf-lines">${lines.length}\uC904</span><button class="code-mini" id="cvEdit">\u270F\uFE0F \uD3B8\uC9D1</button>`) + `<div class="code-scroll"><pre class="code-gutter">${gutter}</pre><pre class="code-text">${escapeHtml(content)}</pre></div>`;
    wireHead();
    $("cvEdit")?.addEventListener("click", () => enterEdit(name, content));
  }
  function enterEdit(name, content) {
    $("codeView").innerHTML = edHead(name, `<span class="edit-tag">\u25CF \uD3B8\uC9D1\uC911</span><button class="code-mini cv-save" id="cvSave">\u{1F4BE} \uC800\uC7A5</button><button class="code-mini" id="cvCancel">\uCDE8\uC18C</button>`) + `<textarea class="code-edit" id="cvText" spellcheck="false"></textarea>`;
    wireHead();
    const ta = $("cvText");
    ta.value = content;
    ta.focus();
    $("cvSave")?.addEventListener("click", saveFile);
    $("cvCancel")?.addEventListener("click", () => openFile(codeCurrentFile));
    ta.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
    });
  }
  async function saveFile() {
    const ta = $("cvText");
    if (!ta) return;
    const r = await connect.fsWrite(codeCurrentFile, ta.value);
    if (r?.ok) {
      hint("\u{1F4BE} \uC800\uC7A5\uB410\uC5B4\uC694");
      renderFileView(codeCurrentFile.split(/[\\/]/).pop() || "", ta.value);
      loadTree(false);
    } else {
      hint("\uC800\uC7A5 \uC2E4\uD328: " + (r?.error || ""));
    }
  }
  function showFiles(v) {
    $("sideFiles").classList.toggle("collapsed", !v);
    $("filesBtn").classList.toggle("on", v);
    if (v) loadTree(false);
  }
  $("filesBtn").addEventListener("click", () => showFiles($("sideFiles").classList.contains("collapsed")));
  function showTerm(v) {
    $("codeTerm").classList.toggle("collapsed", !v);
    $("termBtn").classList.toggle("on", v);
    if (v) setTimeout(() => $("termInput")?.focus(), 50);
  }
  $("termBtn").addEventListener("click", () => showTerm($("codeTerm").classList.contains("collapsed")));
  $("termCollapse")?.addEventListener("click", () => showTerm(false));
  var codeBumpTimer = null;
  function codeBump(autoOpen) {
    if (autoOpen) showFiles(true);
    clearTimeout(codeBumpTimer);
    codeBumpTimer = setTimeout(() => {
      if (!$("sideFiles").classList.contains("collapsed")) loadTree(false);
    }, 500);
  }
  $("codeRefresh").addEventListener("click", () => loadTree(false));
  $("codePickWs").addEventListener("click", async () => {
    const w = await connect.pickWorkspace();
    codeWs = w;
    loadTree(false);
    hint("\uC791\uC5C5 \uD3F4\uB354: " + w);
  });
  function termAppend(d) {
    const el = $("termOut");
    if (!el || !d) return;
    const span = document.createElement("span");
    if (d.kind === "cmd") span.className = "t-cmd";
    else if (d.kind === "exit") span.className = "t-exit";
    const nl = String.fromCharCode(10);
    span.textContent = (d.kind === "cmd" ? nl : "") + (d.text || "") + (d.kind === "cmd" || d.kind === "exit" ? nl : "");
    el.appendChild(span);
    while (el.childNodes.length > 4e3 && el.firstChild) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }
  var termHist = [];
  var termHistIdx = -1;
  var termInputEl = $("termInput");
  termInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const cmd = termInputEl.value.trim();
      if (!cmd) return;
      termHist.push(cmd);
      termHistIdx = termHist.length;
      connect.termRun(cmd, codeWs || void 0);
      termInputEl.value = "";
    } else if (e.key === "ArrowUp") {
      if (termHist.length) {
        termHistIdx = Math.max(0, termHistIdx - 1);
        termInputEl.value = termHist[termHistIdx] || "";
        e.preventDefault();
      }
    } else if (e.key === "ArrowDown") {
      if (termHist.length) {
        termHistIdx = Math.min(termHist.length, termHistIdx + 1);
        termInputEl.value = termHist[termHistIdx] || "";
        e.preventDefault();
      }
    } else if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      connect.termKill();
      termAppend({ kind: "exit", text: "^C \uC911\uC9C0" });
    }
  });
  $("termKillBtn")?.addEventListener("click", () => connect.termKill());
  $("termClearBtn")?.addEventListener("click", () => {
    const el = $("termOut");
    if (el) el.textContent = "";
  });
  connect.onTermData?.((d) => termAppend(d));
  connect.onTermShow?.(() => showTerm(true));
  connect.onBridgeInject?.((d) => {
    const emoji = { knowledge: "\u{1F9E0}", skill: "\u{1F40D}", template: "\u{1F4E6}", design: "\u{1F3A8}" };
    playInjection(`${emoji[d.kind] || "\u{1F50C}"} EZER AI \uC9C0\uC2DD \uC2A4\uD1A0\uC5B4 \u2192 ${d.kind === "knowledge" ? "\uB450\uB1CC" : "\uC791\uC5C5\uC2E4"}`, [d.label || "\uBE0C\uB808\uC778\uD329 \uC8FC\uC785"], (CAT_META[d.category] || CAT_META.general).color);
    if (d.kind !== "knowledge") {
      showFiles(true);
      setTimeout(() => loadTree(true), 400);
    }
    if (!$("brainPanel").classList.contains("hidden")) setTimeout(() => renderBrain(), 300);
  });
  showFiles(true);
  var PROFILE = { youtube: "youtube.png", developer: "developer.png", business: "business.jpeg", editor: "editor.png", secretary: "secretary.jpeg" };
  function agName(id) {
    return (cfg.agentNames || {})[id] || AGENTS[id]?.name || id;
  }
  function agImgSrc(id) {
    const c = (cfg.agentImages || {})[id];
    if (c) return c;
    return PROFILE[id] ? `../../assets/agents/${PROFILE[id]}` : "";
  }
  function downscaleImage(file, max = 256) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * s), h = Math.round(img.height * s);
          const cv = document.createElement("canvas");
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext("2d");
          if (!ctx) return reject(new Error("canvas"));
          ctx.drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = reject;
        img.src = String(fr.result);
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function refreshAgentVisuals(id) {
    try {
      if ($("teamRoster")) renderTeamRoster();
    } catch {
    }
    const plate = document.querySelector(`#vo-${id} .vo-plate`);
    if (plate) plate.textContent = `${AGENTS[id]?.emoji || ""} ${agName(id)}`;
  }
  async function openAgentDetail(id) {
    const a = AGENTS[id];
    if (!a) return;
    const img = agImgSrc(id);
    const avatar = img ? `<img class="ag-photo" src="${escAttr(img)}" alt="" />` : `<div class="ag-photo ag-photo-emoji" style="background:color-mix(in srgb,${a.color} 18%,#0a120c);border-color:${a.color}">${a.emoji}</div>`;
    $("agHeadName").textContent = `${a.emoji} ${agName(id)}`;
    const cur = (cfg.agentModels || {})[id] || "";
    const localNames = (await connect.localModels?.() || []).map((m) => m.name).filter(Boolean);
    const allModels = Array.from(/* @__PURE__ */ new Set([...MODELS_CACHE, ...localNames]));
    const opts = ['<option value="">\u2699\uFE0F \uC790\uB3D9 (\uACF5\uC6A9 \uB450\uB1CC)</option>'].concat(allModels.map((m) => `<option value="${esc(m)}"${m === cur ? " selected" : ""}>${esc(m)}${/^gemini/i.test(m) ? " \u2601\uFE0F" : m === MODELS_LOADED ? " \u25CF \uB85C\uB4DC\uB428" : ""}</option>`)).join("");
    const traitList = String(a.specialty || "").split(/[,·]/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
    const personaLine = String(a.persona || "").split(/[.\n]/)[0].trim().slice(0, 64);
    const brainNow = cur ? `\u{1F7E2} ${esc(cur)}` : "\u2699\uFE0F \uACF5\uC6A9 \uB450\uB1CC";
    const inv = await connect.inventory?.()?.catch(() => null) || null;
    const invStrip = inv ? `
    <div class="ag-inv">
      <div class="ag-inv-t">\u{1F392} \uC6B0\uB9AC \uD68C\uC0AC AI \uBCF4\uC720 \uD604\uD669 <span class="ag-inv-sub">\uAD11\uC7A5\uC5D0\uC11C\uB3C4 \uBCF4\uC5EC\uC694</span></div>
      <div class="ag-inv-row">
        <div class="ag-inv-cell"><b>${inv.models}</b><span>\u{1F9E0} \uBCF4\uC720 AI</span></div>
        <div class="ag-inv-cell"><b>${inv.datasets}</b><span>\u{1F4C4} \uB370\uC774\uD130\uC14B</span></div>
        <div class="ag-inv-cell"><b>${inv.fusions}</b><span>\u{1F9EC} \uD569\uC131</span></div>
        <div class="ag-inv-cell lv"><b>Lv.${inv.totalLevel}</b><span>\u2B50 \uCD1D \uB808\uBCA8</span></div>
      </div>
    </div>` : "";
    $("agentBody").innerHTML = `
    <div class="ag-detail" style="--ag:${a.color}">
      <div class="ag-photo-wrap">
        ${avatar}
        <button class="ag-photo-edit" id="agImgBtn" title="\uC0AC\uC9C4 \uBC14\uAFB8\uAE30">\u{1F4F7}</button>
        <input type="file" id="agImgFile" accept="image/*" hidden />
      </div>
      <div class="ag-meta">
        <input class="ag-name-edit" id="agNameEdit" value="${escAttr(agName(id))}" maxlength="20" placeholder="${escAttr(a.name)}" />
        <div class="ag-role">${esc(a.role)} \xB7 <span class="ag-brain-now">${brainNow}</span></div>
        <div class="ag-spec">${esc(a.specialty || "")}</div>
      </div>
    </div>
    <div class="ag-traits">
      ${traitList.map((t) => `<span class="ag-chip">${esc(t)}</span>`).join("")}
      ${personaLine ? `<div class="ag-persona">\u{1F4AC} ${esc(personaLine)}</div>` : ""}
    </div>
    ${invStrip}
    <div class="ag-model">
      <label>\u{1F9E0} ${escapeHtml(agName(id))}\uC758 \uB450\uB1CC (AI \uBAA8\uB378)</label>
      <select id="agModelSel">${opts}</select>
      <div class="ag-model-hint">\uD559\uC2B5\uD55C <b>\uC804\uC6A9 \uBAA8\uB378</b>\uC744 \uBC30\uC815\uD558\uC138\uC694 (\uC608: \uB9C8\uCF00\uD305\uD29C\uB2DD \u2192 \uBE44\uC988\uB2C8\uC2A4). \uBE44\uC6B0\uBA74 \uACF5\uC6A9 \uBAA8\uB378 \uC0AC\uC6A9.</div>
    </div>
    <button class="ag-char-reset" id="agCharReset">\uC774\uB984\xB7\uC0AC\uC9C4 \uAE30\uBCF8\uAC12\uC73C\uB85C</button>`;
    $("agNameEdit")?.addEventListener("change", async (e) => {
      const v = e.target.value.trim();
      const nm = { ...cfg.agentNames || {} };
      if (v && v !== a.name) nm[id] = v;
      else delete nm[id];
      cfg = await connect.setConfig({ agentNames: nm });
      $("agHeadName").textContent = `${a.emoji} ${agName(id)}`;
      refreshAgentVisuals(id);
      hint(`${a.emoji} \uC774\uB984 \u2192 ${agName(id)}`);
    });
    $("agImgBtn")?.addEventListener("click", () => $("agImgFile")?.click());
    $("agImgFile")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const data = await downscaleImage(f);
        const im = { ...cfg.agentImages || {} };
        im[id] = data;
        cfg = await connect.setConfig({ agentImages: im });
        openAgentDetail(id);
        refreshAgentVisuals(id);
        hint(`${a.emoji} \uC0AC\uC9C4 \uBC14\uB01C`);
      } catch {
        hint("\uC0AC\uC9C4\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC5B4\uC694");
      }
    });
    $("agModelSel")?.addEventListener("change", async (e) => {
      const v = e.target.value;
      const am = { ...cfg.agentModels || {} };
      if (v) am[id] = v;
      else delete am[id];
      cfg = await connect.setConfig({ agentModels: am });
      refreshAgentVisuals(id);
      hint(v ? `${a.emoji} ${agName(id)} \u2192 ${v}` : `${a.emoji} ${agName(id)} \u2192 \uACF5\uC6A9 \uBAA8\uB378`);
    });
    $("agCharReset")?.addEventListener("click", async () => {
      const nm = { ...cfg.agentNames || {} };
      delete nm[id];
      const im = { ...cfg.agentImages || {} };
      delete im[id];
      cfg = await connect.setConfig({ agentNames: nm, agentImages: im });
      openAgentDetail(id);
      refreshAgentVisuals(id);
      hint(`${a.emoji} \uAE30\uBCF8\uAC12\uC73C\uB85C`);
    });
    openOverlay("agentPanel");
  }
  $("voffice").addEventListener("click", (e) => {
    const el = e.target.closest(".vo-agent");
    if (el) openAgentDetail(el.id.replace("vo-", ""));
  });
  $("brainBtn").addEventListener("click", async () => {
    openOverlay("brainPanel");
    selectBtab("short");
    await refreshMem();
    await renderBridge();
    await renderBrain();
    renderMethods();
    try {
      const saved = localStorage.getItem("cloudCode");
      const cc = $("cloudCode");
      if (saved && cc && !cc.value) {
        cc.value = saved;
        cc.hidden = false;
      }
    } catch {
    }
  });
  $("notesToggle").addEventListener("click", () => {
    const n = $("brainNotes");
    n.classList.toggle("hidden");
    $("notesToggle").classList.toggle("on", !n.classList.contains("hidden"));
  });
  $("mentorLinkBtn").addEventListener("click", async () => {
    const repo = $("mentorRepo").value.trim(), pw = $("mentorPw").value;
    $("mentorStatus").textContent = "\u{1F9E0} \uBA58\uD1A0 \uB450\uB1CC \uC5F0\uB3D9 \uC911\u2026";
    const r = await connect.brainLinkBrain(repo, pw);
    if (!r.ok) {
      $("mentorStatus").textContent = `\u26A0\uFE0F ${r.error}`;
      return;
    }
    $("mentorStatus").textContent = `\u2705 \uC81C\uC774 \uBE0C\uB808\uC778 ${r.added}\uAC1C \uC5F0\uB3D9 (\uCD1D ${r.total}\uAC1C)`;
    if (r.added) {
      playInjection("\u{1F9E0} \uC81C\uC774 \uBE0C\uB808\uC778 \uB9C1\uD06C", [`${r.added}\uAC1C \uC9C0\uC2DD \uC5F0\uB3D9`], "#00e5ff");
      playCollect(r.added);
      await renderBrain();
    }
  });
  async function refreshMem() {
    const m = await connect.memStatus();
    $("ghRepo").textContent = m.githubReady ? `\u{1F517} ${m.githubRepo}` : "\uBBF8\uC5F0\uACB0 (\u{1F5C2}\uFE0F \uC5F0\uB3D9\uC5D0\uC11C GitHub)";
    $("ghRepo").className = "mem-repo" + (m.githubReady ? " on" : "");
    const hfEl = $("hfRepo");
    hfEl.textContent = m.hfReady ? `\u{1F517} ${m.hfRepo}${m.hfUrl ? " \u2197" : ""}` : "\uBBF8\uC5F0\uACB0 (\u{1F5C2}\uFE0F \uC5F0\uB3D9\uC5D0\uC11C HuggingFace)";
    hfEl.className = "mem-repo" + (m.hfReady ? " on" : "") + (m.hfUrl ? " link" : "");
    hfEl.title = m.hfUrl ? "HuggingFace\uC5D0\uC11C \uB370\uC774\uD130\uC14B \uC5F4\uC5B4 \uD655\uC778" : "";
    hfEl.onclick = m.hfUrl ? () => connect.openExternal(m.hfUrl) : null;
  }
  function selectBtab(t) {
    document.querySelectorAll(".btab").forEach((x) => x.classList.toggle("active", x.dataset.btab === t));
    $("bsec-short").classList.toggle("hidden", t !== "short");
    $("bsec-long").classList.toggle("hidden", t !== "long");
    $("bsec-surgery")?.classList.toggle("hidden", t !== "surgery");
  }
  document.querySelectorAll(".btab").forEach((b) => b.addEventListener("click", () => selectBtab(b.dataset.btab)));
  var SURG_INFO = {
    model_merging: { title: "\uBAA8\uB378 \uD569\uCE58\uAE30", nb: "\uC2E4\uD5D8_AI\uB450\uAC1C\uD569\uCE58\uAE30_model_merging.ipynb", url: "https://github.com/arcee-ai/mergekit", msg: "\u{1F9EC} \uB178\uD2B8\uBD81 \uC2E4\uD5D8_AI\uB450\uAC1C\uD569\uCE58\uAE30_model_merging.ipynb \uC900\uBE44\uB428 \xB7 mergekit \uBB38\uC11C\uB97C \uC5FD\uB2C8\uB2E4. (\uC571 \u{1F9EC} \uD569\uC131\uC18C\uC5D0\uC11C \uBC14\uB85C \uD569\uCE58\uAE30\uB3C4 \uB429\uB2C8\uB2E4)" },
    task_arithmetic: { title: "Editing Models with Task Arithmetic", nb: "\uC2E4\uD5D82_\uB2A5\uB825\uB354\uD558\uACE0\uBE7C\uAE30_task_arithmetic.ipynb", url: "https://arxiv.org/abs/2212.04089", msg: '\u2797 "Editing Models with Task Arithmetic" \uB17C\uBB38(2212.04089)\uC744 \uC5FD\uB2C8\uB2E4 \xB7 \uB178\uD2B8\uBD81 \uC2E4\uD5D82_\uB2A5\uB825\uB354\uD558\uACE0\uBE7C\uAE30_task_arithmetic.ipynb \uC900\uBE44\uB428' },
    lora: { title: "\uB0B4 \uB370\uC774\uD130\uB85C \uAC00\uB974\uCE58\uAE30 (LoRA)", nb: "\uC2E4\uD5D84_\uB0B4\uB370\uC774\uD130\uB85C_\uAC00\uB974\uCE58\uAE30_LoRA.ipynb", url: "https://arxiv.org/abs/2106.09685", msg: "\u{1F393} \uB178\uD2B8\uBD81 \uC2E4\uD5D84_\uB0B4\uB370\uC774\uD130\uB85C_\uAC00\uB974\uCE58\uAE30_LoRA.ipynb \uC900\uBE44\uB428 \xB7 LoRA \uB17C\uBB38(2106.09685)\uC744 \uC5FD\uB2C8\uB2E4. (\uC774\uAC8C \uC7A5\uAE30\uAE30\uC5B5\uC758 \uC6D0\uB9AC)" },
    interpret: { title: "AI \uB0B4\uBD80 \uB4E4\uC5EC\uB2E4\uBCF4\uAE30", nb: "\uC2E4\uD5D85_\uB0B4\uBD80_\uB4E4\uC5EC\uB2E4\uBCF4\uAE30_transformer_lens.ipynb", url: "https://github.com/TransformerLensOrg/TransformerLens", msg: "\u{1F52C} \uB178\uD2B8\uBD81 \uC2E4\uD5D85_\uB0B4\uBD80_\uB4E4\uC5EC\uB2E4\uBCF4\uAE30_transformer_lens.ipynb \uC900\uBE44\uB428 \xB7 transformer_lens\uB97C \uC5FD\uB2C8\uB2E4." },
    refusal: { title: "\uAC70\uBD80 \uBC29\uD5A5 \uD574\uBD80", nb: "\uC2E4\uD5D83_\uAC70\uBD80\uBC29\uD5A5_\uD574\uBD80_refusal_direction.ipynb", url: "https://arxiv.org/abs/2406.11717", msg: "\u{1F9ED} \uB178\uD2B8\uBD81 \uC2E4\uD5D83_\uAC70\uBD80\uBC29\uD5A5_\uD574\uBD80_refusal_direction.ipynb \uC900\uBE44\uB428 \xB7 Arditi 2024(2406.11717)\uB97C \uC5FD\uB2C8\uB2E4. \uCC3E\uAE30\xB7\uC2DC\uAC01\uD654\uAE4C\uC9C0\uB9CC(\uC81C\uAC70 X)." },
    steering: { title: "\uC2E4\uC2DC\uAC04 \uC131\uACA9 \uC870\uC885", nb: "\uC2E4\uD5D86_\uC2E4\uC2DC\uAC04_\uC131\uACA9\uC870\uC885_steering.ipynb", url: "https://arxiv.org/abs/2312.06681", msg: "\u{1F39A}\uFE0F \uB178\uD2B8\uBD81 \uC2E4\uD5D86_\uC2E4\uC2DC\uAC04_\uC131\uACA9\uC870\uC885_steering.ipynb \uC900\uBE44\uB428 \xB7 CAA Steering \uB17C\uBB38(2312.06681)\uC744 \uC5FD\uB2C8\uB2E4." },
    knowledge_edit: { title: "\uAE30\uC5B5 \uBC14\uAFB8\uAE30", url: "https://arxiv.org/abs/2202.05262", msg: "\u{1F4DD} ROME(2202.05262)\xB7MEMIT \uB17C\uBB38\uC744 \uC5FD\uB2C8\uB2E4. \uC2E4\uC2B5 \uB178\uD2B8\uBD81\uC740 \uACE7 \uCD94\uAC00\uB3FC\uC694." }
  };
  document.querySelectorAll(".surg-card").forEach((c) => c.addEventListener("click", () => {
    const k = c.dataset.nb;
    const info = SURG_INFO[k];
    if (!info) return;
    hint(info.msg);
    if (info.url) connect.openExternal?.(info.url);
  }));
  document.querySelectorAll(".surg-try").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const m = btn.dataset.try || "slerp";
    _surg.method = m;
    openSurgery(m === "slerp" ? "merge" : "task");
  }));
  var ROADMAP = [
    { w: "1\uC8FC", ic: "\u{1F9EC}", t: "\uD569\uCE58\uAE30 (Merging)", papers: [["Task Arithmetic", "2212.04089"], ["TIES", "2306.01708"], ["Model Soups", "2203.05482"]], nb: "\uC2E4\uD5D8_AI\uB450\uAC1C\uD569\uCE58\uAE30" },
    { w: "2\uC8FC", ic: "\u{1F393}", t: "\uAC00\uB974\uCE58\uAE30 (LoRA)", papers: [["LoRA", "2106.09685"], ["QLoRA", "2305.14314"]], nb: "\uC2E4\uD5D84" },
    { w: "3\uC8FC", ic: "\u2797", t: "\uB354\uD558\uACE0 \uBE7C\uAE30", papers: [["Task Arithmetic", "2212.04089"]], nb: "\uC2E4\uD5D82" },
    { w: "4\uC8FC", ic: "\u{1F52C}", t: "\uB0B4\uBD80 \uB4E4\uC5EC\uB2E4\uBCF4\uAE30", papers: [["Representation Engineering", "2310.01405"]], nb: "\uC2E4\uD5D85" },
    { w: "5\uC8FC", ic: "\u{1F9ED}", t: "\uAC70\uBD80 \uBC29\uD5A5 \uD574\uBD80", papers: [["Refusal Direction (Arditi)", "2406.11717"], ["Concept Cones", "2502.17420"]], nb: "\uC2E4\uD5D83" },
    { w: "6\uC8FC", ic: "\u{1F39A}\uFE0F", t: "\uC2E4\uC2DC\uAC04 \uC870\uC885", papers: [["CAA Steering", "2312.06681"]], nb: "\uC2E4\uD5D86" },
    { w: "7\uC8FC", ic: "\u2696\uFE0F", t: "\uC548\uC804\xB7\uC724\uB9AC", papers: [["Constitutional AI", "2212.08073"], ["Fine-tuning Compromises Safety", "2310.03693"]] }
  ];
  function renderRoadmap() {
    const el = $("surgRoadmap");
    if (!el) return;
    el.innerHTML = ROADMAP.map((r) => `<div class="rm-row"><span class="rm-w">${r.ic} ${r.w}</span><div class="rm-mid"><div class="rm-t">${r.t}${r.nb ? `<span class="rm-nb">\u{1F4D3} ${r.nb}</span>` : ""}</div><div class="rm-papers">${r.papers.map(([n, id]) => `<a class="rm-paper" data-ax="${id}">${escapeHtml(n)} <span>${id}</span></a>`).join("")}</div></div></div>`).join("") + `<div class="rm-note muted small">\u{1F512} abliteration\uC740 \uC6D0\uB9AC \uC774\uD574\xB7\uC2DC\uAC01\uD654\uAE4C\uC9C0\uB9CC. \uBB34\uC0AD\uC81C \uBAA8\uB378 \uBC30\uD3EC\uB294 \uC548 \uD568.</div>`;
    el.querySelectorAll(".rm-paper").forEach((a) => a.addEventListener("click", () => connect.openExternal?.(`https://arxiv.org/abs/${a.dataset.ax}`)));
  }
  $("surgRoadmapBtn")?.addEventListener("click", () => {
    const el = $("surgRoadmap");
    if (!el) return;
    const show = el.classList.contains("hidden");
    if (show) renderRoadmap();
    el.classList.toggle("hidden", !show);
    const btn = $("surgRoadmapBtn");
    if (btn) btn.textContent = show ? "\u{1F4DA} \uB85C\uB4DC\uB9F5 \uC811\uAE30" : "\u{1F4DA} \uB85C\uB4DC\uB9F5 \uD3BC\uCE58\uAE30";
  });
  $("ghPushBtn").addEventListener("click", async () => {
    $("ghStatus").textContent = "\u2601\uFE0F GitHub\uC5D0 \uBC31\uC5C5 \uC911\u2026";
    const r = await connect.githubPush();
    $("ghStatus").textContent = r.ok ? `\u2705 \uC9C0\uC2DD ${r.count}\uAC1C \uBC31\uC5C5 \uC644\uB8CC` : `\u26A0\uFE0F ${r.error}`;
    if (r.ok) playCollect(r.count || 1);
  });
  $("ghPullBtn").addEventListener("click", async () => {
    $("ghStatus").textContent = "\u2B07 GitHub\uC5D0\uC11C \uBCF5\uC6D0 \uC911\u2026";
    const r = await connect.githubPull();
    if (r.ok) {
      const extra = r.scanned ? ` \xB7 \uD30C\uC77C ${r.scanned}\uAC1C \uC2A4\uCE94${r.skipped ? `, \uC7A1\uD30C\uC77C ${r.skipped}\uAC1C \uC81C\uC678` : ""}${r.capped ? " (\uC0C1\uD55C \uB3C4\uB2EC)" : ""}` : "";
      $("ghStatus").textContent = `\u2705 ${r.added}\uAC1C \uC0C8\uB85C \uAC00\uC838\uC634 (\uCD1D ${r.total}\uAC1C)${extra}`;
    } else $("ghStatus").textContent = `\u26A0\uFE0F ${r.error}`;
    if (r.ok && r.added) {
      playInjection("GitHub \u2192 \uB450\uB1CC \uB3D9\uAE30\uD654", [`${r.added}\uAC1C \uC9C0\uC2DD \uC8FC\uC785`]);
      playCollect(r.added);
      await renderBrain();
    }
  });
  var LONG_FX = "#39ff14";
  $("dsConvertBtn").addEventListener("click", async () => {
    const isDpo = currentMethod === "dpo";
    const btn = $("dsConvertBtn");
    btn.disabled = true;
    btn.textContent = isDpo ? "AI \uC0DD\uC131 \uC911\u2026" : "\uBCC0\uD658 \uC911\u2026";
    $("dsProg").classList.remove("hidden");
    $("dsPreview").innerHTML = "";
    $("dsFill").style.width = "0%";
    const off = connect.onDatasetProgress((d) => {
      $("dsFill").style.width = Math.round(d.done / d.total * 100) + "%";
      $("dsCnt").textContent = isDpo ? `\u{1F916} AI\uAC00 \uC88B\uC740\uB2F5/\uB098\uC05C\uB2F5 \uB9CC\uB4DC\uB294 \uC911\u2026 ${d.done}/${d.total}` : `\u{1F916} AI\uAC00 \uD559\uC2B5 \uBB38\uC81C \uCD9C\uC81C \uC911\u2026 ${d.done}/${d.total}`;
      if (d.q) {
        const el = document.createElement("div");
        el.className = "ds-q";
        el.textContent = "\u2753 " + d.q;
        const p = $("dsPreview");
        p.prepend(el);
        while (p.children.length > 4) p.lastChild.remove();
      }
    });
    const r = isDpo ? await connect.brainBuildPreference() : await connect.brainBuildDataset($("augChk").checked);
    off?.();
    btn.disabled = false;
    btn.textContent = isDpo ? "\uB2E4\uC2DC \uC0DD\uC131" : "\uB2E4\uC2DC \uBCC0\uD658";
    if (!r.ok) {
      $("dsCnt").textContent = "";
      $("hfStatus").textContent = `\u26A0\uFE0F ${r.error}`;
      return;
    }
    if (isDpo) {
      $("dsCnt").textContent = `\u2705 \uC120\uD638\uC30D ${r.pairs}\uAC1C \uC0DD\uC131 (\uC88B\uC740\uB2F5 \u2705 vs \uB098\uC05C\uB2F5 \u274C)`;
      $("dsPreview").innerHTML = (r.sample || []).map((s) => `<div class="ds-q">\u2753 ${escapeHtml(s.q)}<div class="ds-a">\u2705 ${escapeHtml(s.chosen)}\u2026</div><div class="ds-a" style="color:#e88">\u274C ${escapeHtml(s.rejected)}\u2026</div></div>`).join("");
    } else {
      $("dsCnt").textContent = `\u2705 Q&A ${r.pairs}\uC30D \uC0DD\uC131 (\uC9C0\uC2DD ${r.notes}\uAC1C${r.augment ? " \xB7 \u{1F52C}\uC99D\uAC15" : ""} \xB7 ${r.llm ? "AI \uC9C8\uBB38\uC0DD\uC131" : "\uD15C\uD50C\uB9BF"})`;
      $("dsPreview").innerHTML = (r.sample || []).map((s) => `<div class="ds-q">\u2753 ${escapeHtml(s.q)}<div class="ds-a">\u2192 ${escapeHtml(s.a)}\u2026</div></div>`).join("");
    }
    playInjection(isDpo ? "\u2696\uFE0F DPO \uC120\uD638\uC30D \uC0DD\uC131" : "\u{1F4E6} SFT \uB370\uC774\uD130 \uBCC0\uD658", [`${r.pairs}\uAC1C`], LONG_FX);
    $("lfStep1").classList.add("lf-done");
    $("lfStep2").classList.remove("lf-locked");
    $("hfUploadBtn").disabled = false;
    $("lfStep3").classList.remove("lf-locked");
    const cb = $("cloudTrainBtn");
    if (cb) cb.disabled = false;
    const mnEl = $("modelNameInput");
    if (mnEl && mnEl.disabled) {
      mnEl.disabled = false;
      connect.brainModelName().then((nm) => {
        if (!mnEl.value) mnEl.value = nm.suggested;
      });
    }
  });
  $("hfUploadBtn").addEventListener("click", async () => {
    $("hfStatus").textContent = "\u{1F917} HuggingFace\uC5D0 \uC5C5\uB85C\uB4DC \uC911\u2026";
    const r = currentMethod === "dpo" ? await connect.hfUploadPreference() : await connect.hfUploadBrain();
    if (!r.ok) {
      $("hfStatus").innerHTML = `\u26A0\uFE0F ${escapeHtml(r.error || "\uC2E4\uD328")}`;
      return;
    }
    $("hfStatus").innerHTML = `\u2705 \uB370\uC774\uD130\uC14B \uC5C5\uB85C\uB4DC \uC644\uB8CC \u2014 <a href="#" id="hfLink">${escapeHtml(r.url)}</a>`;
    $("hfLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      connect.openExternal(r.url);
    });
    playInjection("\u{1F917} \uD074\uB77C\uC6B0\uB4DC\uC5D0 \uAC01\uC778", ["\uB370\uC774\uD130\uC14B \uC5C5\uB85C\uB4DC \uC644\uB8CC"], LONG_FX);
    $("lfStep2").classList.add("lf-done");
    $("lfStep3").classList.remove("lf-locked");
    const nm = await connect.brainModelName();
    const inp = $("modelNameInput");
    inp.disabled = false;
    inp.value = nm.suggested;
    $("hfTrainBtn").disabled = false;
  });
  var TS_PRESET = {
    safe: { lr: 2e-4, epochs: 6, hint: "\u{1F6E1}\uFE0F \uC548\uC804 \u2014 \uC0B4\uC0B4 (\uACFC\uC801\uD569 \uBC29\uC9C0)" },
    balanced: { lr: 3e-4, epochs: 8, hint: "\u2696\uFE0F \uAE30\uBCF8 \u2014 \uAD8C\uC7A5" },
    strong: { lr: 5e-4, epochs: 10, hint: "\u{1F525} \uAC15\uD558\uAC8C \u2014 \uD655\uC2E4\uD788 \uC678\uC6C0" }
  };
  var tsPreset = "balanced";
  document.querySelectorAll(".ts-preset").forEach((b) => b.addEventListener("click", () => {
    tsPreset = b.dataset.preset;
    document.querySelectorAll(".ts-preset").forEach((x) => x.classList.toggle("on", x === b));
    $("tsHint").textContent = TS_PRESET[tsPreset].hint;
  }));
  function validModelName(name) {
    if (!name) return "\uBAA8\uB378 \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694 (\uC601\uC5B4\uB85C).";
    if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(name)) return "\u26A0\uFE0F \uBAA8\uB378 \uC774\uB984\uC5D0 \uD55C\uAE00\uC740 \uC4F8 \uC218 \uC5C6\uC5B4\uC694. \uC601\uC5B4\uB85C \uC785\uB825\uD558\uC138\uC694 (\uC608: my-brain-v1).";
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return "\u26A0\uFE0F \uC601\uC5B4\xB7\uC22B\uC790\xB7\uD558\uC774\uD508(-)\xB7\uC5B8\uB354\uC2A4\uCF54\uC5B4(_)\uB9CC \uAC00\uB2A5\uD574\uC694 (\uC608: my-brain-v1).";
    return null;
  }
  $("modelNameInput")?.addEventListener("input", (e) => {
    const cleaned = e.target.value.replace(/[^A-Za-z0-9._-]/g, "");
    if (cleaned !== e.target.value) {
      e.target.value = cleaned;
      hint("\uBAA8\uB378 \uC774\uB984\uC740 \uC601\uC5B4\uB85C\uB9CC \uC785\uB825\uB3FC\uC694 (\uD55C\uAE00 \uC790\uB3D9 \uC81C\uAC70).");
    }
  });
  $("hfTrainBtn").addEventListener("click", async () => {
    const ga = $("growAuto");
    if (ga) ga.style.display = "";
    const name = $("modelNameInput").value.trim();
    if (name) {
      const nameErr = validModelName(name);
      if (nameErr) {
        hint(nameErr);
        $("modelNameInput").focus();
        return;
      }
    }
    hint("\u{1F193} \uBB34\uB8CC Colab \uB178\uD2B8\uBD81 \uB9CC\uB4DC\uB294 \uC911\u2026");
    const p = TS_PRESET[tsPreset];
    const sv = (id) => $(id).value;
    const steps = parseInt($("tsSteps").value, 10) || 0;
    const al = sv("tsAlpha"), lrv = sv("tsLr"), ep = sv("tsEpochs");
    const opts = {
      method: currentMethod,
      rank: +sv("tsRank"),
      alpha: al === "auto" ? void 0 : +al,
      dropout: +sv("tsDropout"),
      learningRate: lrv ? +lrv : p.lr,
      epochs: ep ? +ep : p.epochs,
      maxSeq: +sv("tsSeq"),
      scheduler: sv("tsSched"),
      quant: sv("tsQuant"),
      maxSteps: steps > 0 ? steps : void 0
    };
    $("hfStatus").textContent = "\u{1F5C2}\uFE0F \uBCC0\uD658 \xB7 HF \uB370\uC774\uD130\uC14B \uC5C5\uB85C\uB4DC \xB7 \uB178\uD2B8\uBD81 \uC0DD\uC131 \uC911\u2026";
    const r = await connect.trainNotebook(name, opts);
    if (!r.ok) {
      $("hfStatus").textContent = `\u26A0\uFE0F ${r.error}`;
      hint(`\u26A0\uFE0F ${r.error}`);
      if (/지식/.test(r.error || "")) document.querySelector('.btab[data-btab="short"]')?.click();
      return;
    }
    const dsLine = r.dataset ? ` \xB7 \u{1F4E6} \uB370\uC774\uD130\uC14B <a href="#" id="dsLink">${escapeHtml(r.dataset)}</a> \uC5C5\uB85C\uB4DC\uB428` : "";
    $("hfStatus").innerHTML = `\u2705 Colab \uC5F4\uAE30 \u2192 <a href="#" id="colabLink">\uD559\uC2B5 \uB178\uD2B8\uBD81</a> \xB7 "\uB7F0\uD0C0\uC784 \u2192 \uBAA8\uB450 \uC2E4\uD589"${dsLine}${r.note ? ` <span class="muted">(${escapeHtml(r.note)})</span>` : ""}`;
    $("dsLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      connect.openExternal(`https://huggingface.co/datasets/${r.dataset}`);
    });
    $("colabLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      connect.openExternal(r.colab);
    });
    if (r.colab) connect.openExternal(r.colab);
    hint('\u{1F193} \uBB34\uB8CC Colab \uB178\uD2B8\uBD81\uC774 \uC5F4\uB838\uC5B4\uC694 \u2014 "\uB7F0\uD0C0\uC784 \u2192 \uBAA8\uB450 \uC2E4\uD589"');
    playInjection("\u{1F9E0} \uC7A5\uAE30\uAE30\uC5B5 \uAC01\uC778 \uC2DC\uC791", [name || "\uB0B4 \uB450\uB1CC"], LONG_FX);
    hint('\u{1F193} Colab \uD559\uC2B5 \uB178\uD2B8\uBD81\uC744 \uC5F4\uC5C8\uC5B4\uC694 \u2014 "\uB7F0\uD0C0\uC784 \u2192 \uBAA8\uB450 \uC2E4\uD589"');
    $("lfStep3").classList.add("lf-done");
  });
  $("hfExportBtn").addEventListener("click", async () => {
    $("hfStatus").textContent = "\u{1F4E6} \uBC14\uD0D5\uD654\uBA74 connect-ai-brain.jsonl \uD655\uC778 (\uBCC0\uD658 \uC2DC \uC790\uB3D9 \uC800\uC7A5)";
  });
  var _authMode = "login";
  async function refreshAuthBtn() {
    const me = await connect.authCurrent?.();
    const b = $("authBtn");
    const hb = $("hdrAuthBtn");
    if (b) {
      b.style.display = me?.configured ? "" : "none";
      b.textContent = me?.email ? `\u{1F464} ${me.email}` : "\u{1F464} \uD68C\uC6D0 \uB85C\uADF8\uC778";
      b.title = me?.email ? `${me.email} \u2014 \uD68C\uC6D0 \uBA54\uB274` : "\uD68C\uC6D0 \u2014 \uB85C\uADF8\uC778/\uD68C\uC6D0\uAC00\uC785";
    }
    if (hb) {
      hb.classList.toggle("on", !!me?.email);
      hb.textContent = me?.email ? "\u{1F464}\u2713" : "\u{1F464}";
      hb.title = me?.email ? `${me.email} \u2014 \uB0B4 \uACC4\uC815` : "\uB85C\uADF8\uC778 / \uD68C\uC6D0\uAC00\uC785";
    }
  }
  async function openAuth() {
    openOverlay("authPanel");
    const me = await connect.authCurrent?.();
    const body = $("authBody");
    if (!body) return;
    if (!me?.configured) {
      $("authTitle").textContent = "\uD68C\uC6D0";
      body.innerHTML = `<div class="muted small" style="line-height:1.6">\uD68C\uC6D0 \uC2DC\uC2A4\uD15C\uC774 \uC544\uC9C1 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC5B4\uC694. \u2699\uFE0F \uC124\uC815 \u2192 \uACE0\uAE09\uC5D0 <b>\uD68C\uC6D0 Firebase API Key</b>\uB97C \uB123\uC5B4\uC8FC\uC138\uC694.</div>`;
      return;
    }
    if (me?.email) {
      $("authTitle").textContent = "\uB0B4 \uACC4\uC815";
      body.innerHTML = `<div class="auth-me"><div class="auth-ava">\u{1F464}</div><div><div class="auth-email">${escapeHtml(me.email)}</div><div class="muted small">\uB85C\uADF8\uC778\uB428 \xB7 \uBB34\uB8CC \uD559\uC2B5 \uAC00\uB2A5</div><div class="muted small" style="margin-top:2px">\u{1F512} \uBCA0\uD0C0 \uBE44\uBC00\uBC88\uD638 = \uD559\uC2B5\xB7\uD569\uC131 \uC6D4 3\uD68C \xB7 \u{1F193} Colab \uD569\uC131\uC740 \uBB34\uC81C\uD55C(\uBB34\uB8CC)</div></div></div><button class="cyc-btn ghost" id="authLogout" style="width:100%;margin-top:12px">\uB85C\uADF8\uC544\uC6C3</button>`;
      $("authLogout")?.addEventListener("click", async () => {
        await connect.authLogout?.();
        refreshAuthBtn();
        openAuth();
        hint("\uB85C\uADF8\uC544\uC6C3\uD588\uC5B4\uC694");
      });
      return;
    }
    $("authTitle").textContent = _authMode === "login" ? "\uB85C\uADF8\uC778" : "\uD68C\uC6D0\uAC00\uC785";
    const signup = _authMode === "signup";
    body.innerHTML = `
    ${signup ? `<input id="authName" class="auth-in" type="text" placeholder="\uC774\uB984" autocomplete="name" />
    <div class="auth-phone"><select id="authCc" class="auth-in" style="flex:0 0 96px">
      <option value="+82">\u{1F1F0}\u{1F1F7} +82</option><option value="+1">\u{1F1FA}\u{1F1F8} +1</option><option value="+81">\u{1F1EF}\u{1F1F5} +81</option><option value="+86">\u{1F1E8}\u{1F1F3} +86</option><option value="+44">\u{1F1EC}\u{1F1E7} +44</option></select>
    <input id="authPhone" class="auth-in" type="tel" placeholder="\uC804\uD654\uBC88\uD638 (\uC22B\uC790\uB9CC)" autocomplete="tel" style="flex:1" /></div>` : ""}
    <input id="authEmail" class="auth-in" type="email" placeholder="\uC774\uBA54\uC77C" autocomplete="username" />
    <input id="authPw" class="auth-in" type="password" placeholder="\uBE44\uBC00\uBC88\uD638 (6\uC790 \uC774\uC0C1)" autocomplete="${signup ? "new-password" : "current-password"}" />
    ${signup ? `<input id="authPw2" class="auth-in" type="password" placeholder="\uBE44\uBC00\uBC88\uD638 \uD655\uC778" autocomplete="new-password" />
    <div class="auth-agree">
      <label class="auth-chk"><input type="checkbox" id="agTerms" /> <span>[\uD544\uC218] <a id="lnkTerms">\uC774\uC6A9\uC57D\uAD00</a>\uC5D0 \uB3D9\uC758\uD569\uB2C8\uB2E4</span></label>
      <label class="auth-chk"><input type="checkbox" id="agPriv" /> <span>[\uD544\uC218] <a id="lnkPriv">\uAC1C\uC778\uC815\uBCF4 \uCC98\uB9AC\uBC29\uCE68</a>\uC5D0 \uB3D9\uC758\uD569\uB2C8\uB2E4</span></label>
      <label class="auth-chk"><input type="checkbox" id="agMkt" /> <span>[\uC120\uD0DD] \uB9C8\uCF00\uD305\xB7\uC18C\uC2DD \uC218\uC2E0\uC5D0 \uB3D9\uC758\uD569\uB2C8\uB2E4</span></label>
    </div>` : ""}
    <div class="auth-msg" id="authMsg"></div>
    <button class="cyc-btn primary" id="authGo" style="width:100%">${signup ? "\uD68C\uC6D0\uAC00\uC785" : "\uB85C\uADF8\uC778"}</button>
    <div class="auth-switch">${signup ? '\uC774\uBBF8 \uD68C\uC6D0? <a id="authToLogin">\uB85C\uADF8\uC778</a>' : '\uACC4\uC815\uC774 \uC5C6\uB098\uC694? <a id="authToSignup">\uD68C\uC6D0\uAC00\uC785</a>'}</div>`;
    $("authToSignup")?.addEventListener("click", () => {
      _authMode = "signup";
      openAuth();
    });
    $("authToLogin")?.addEventListener("click", () => {
      _authMode = "login";
      openAuth();
    });
    $("lnkTerms")?.addEventListener("click", () => connect.openExternal?.("https://aicitybuilders.com/terms"));
    $("lnkPriv")?.addEventListener("click", () => connect.openExternal?.("https://aicitybuilders.com/privacy"));
    const go = async () => {
      const email = $("authEmail").value.trim();
      const pw = $("authPw").value;
      const msg = (t) => {
        $("authMsg").textContent = t;
      };
      if (signup) {
        const name = $("authName").value.trim();
        const phone = $("authPhone").value.replace(/[^0-9]/g, "");
        const cc = $("authCc").value;
        const pw2 = $("authPw2").value;
        if (name.length < 2) return msg("\uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694 (2\uC790 \uC774\uC0C1).");
        if (!/\S+@\S+\.\S+/.test(email)) return msg("\uC62C\uBC14\uB978 \uC774\uBA54\uC77C\uC744 \uC785\uB825\uD558\uC138\uC694.");
        if (phone.length < 8) return msg("\uC62C\uBC14\uB978 \uC804\uD654\uBC88\uD638\uB97C \uC785\uB825\uD558\uC138\uC694.");
        if (pw.length < 6) return msg("\uBE44\uBC00\uBC88\uD638\uB294 6\uC790 \uC774\uC0C1\uC774\uC5B4\uC57C \uD574\uC694.");
        if (pw !== pw2) return msg("\uBE44\uBC00\uBC88\uD638\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC544\uC694.");
        if (!$("agTerms").checked) return msg("\uC774\uC6A9\uC57D\uAD00 \uB3D9\uC758\uAC00 \uD544\uC694\uD574\uC694.");
        if (!$("agPriv").checked) return msg("\uAC1C\uC778\uC815\uBCF4 \uCC98\uB9AC\uBC29\uCE68 \uB3D9\uC758\uAC00 \uD544\uC694\uD574\uC694.");
        const btn2 = $("authGo");
        btn2.disabled = true;
        btn2.textContent = "\uCC98\uB9AC \uC911\u2026";
        const r2 = await connect.authSignup?.(email, pw, { name, phone: cc + phone, marketing: $("agMkt").checked });
        btn2.disabled = false;
        btn2.textContent = "\uD68C\uC6D0\uAC00\uC785";
        if (r2?.ok) {
          refreshAuthBtn();
          hint("\u{1F389} \uAC00\uC785 \uC644\uB8CC! \uD658\uC601\uD569\uB2C8\uB2E4");
          openAuth();
        } else msg("\u26A0\uFE0F " + (r2?.error || "\uC2E4\uD328"));
        return;
      }
      if (!email || !pw) return msg("\uC774\uBA54\uC77C\uACFC \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD558\uC138\uC694.");
      const btn = $("authGo");
      btn.disabled = true;
      btn.textContent = "\uCC98\uB9AC \uC911\u2026";
      const r = await connect.authLogin?.(email, pw);
      btn.disabled = false;
      btn.textContent = "\uB85C\uADF8\uC778";
      if (r?.ok) {
        refreshAuthBtn();
        hint("\u2705 \uB85C\uADF8\uC778\uB428");
        openAuth();
      } else msg("\u26A0\uFE0F " + (r?.error || "\uC2E4\uD328"));
    };
    $("authGo")?.addEventListener("click", go);
    $("authPw")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !signup) go();
    });
  }
  $("authBtn")?.addEventListener("click", openAuth);
  $("hdrAuthBtn")?.addEventListener("click", openAuth);
  refreshAuthBtn();
  var cloudPoll = 0;
  function cloudStat(html) {
    const el = $("cloudTrainStatus");
    if (!el) return;
    el.style.display = "block";
    el.innerHTML = html;
  }
  function jobStageInfo(stage) {
    const s = (stage || "").toUpperCase();
    if (/SCHEDUL|PENDING|QUEUE|WAIT/.test(s)) return { pct: 18, txt: "\u{1F5D3}\uFE0F GPU \uC790\uB9AC \uBC30\uC815 \uC911\u2026" };
    if (/BUILD|INITIAL|LOAD|START|PREP/.test(s)) return { pct: 38, txt: "\u{1F4E6} \uD658\uACBD\xB7\uBAA8\uB378 \uC900\uBE44 \uC911\u2026" };
    if (/RUN|TRAIN|PROGRESS|ACTIVE/.test(s)) return { pct: 70, txt: "\u26A1 GPU\uC5D0\uC11C \uC791\uC5C5 \uC911\u2026" };
    if (/UPLOAD|PUSH|SAVE|FINAL/.test(s)) return { pct: 92, txt: "\u2601\uFE0F \uACB0\uACFC \uC62C\uB9AC\uB294 \uC911\u2026" };
    return { pct: 50, txt: "\u23F3 \uC9C4\uD589 \uC911\u2026" };
  }
  function jobProgressCard(title, stage, secs, logs) {
    const { pct, txt } = jobStageInfo(stage);
    const mm = secs >= 60 ? `${Math.floor(secs / 60)}\uBD84 ${secs % 60}\uCD08` : `${secs}\uCD08`;
    const eta = title.includes("\uD569\uC131") ? "\uBCF4\uD1B5 5~20\uBD84" : "\uBCF4\uD1B5 15~40\uBD84";
    const feed = logs && logs.length ? `<div class="jp-log">${logs.slice(-6).map((l) => `<div class="jp-logline">${escapeHtml(String(l).slice(0, 120))}</div>`).join("")}</div>` : "";
    return `<div class="jobprog">
    <div class="jp-top"><span class="cyc-spin"></span> <b>${escapeHtml(title)}</b> <span class="jp-stage">${txt}</span></div>
    <div class="jp-bar"><div class="jp-fill" style="width:${pct}%"></div></div>
    ${feed}
    <div class="jp-meta">\u23F1\uFE0F ${mm} \uACBD\uACFC \xB7 GPU\uC5D0\uC11C \uC9C4\uD589\uB3FC\uC694 (${eta}) \xB7 \uB05D\uB098\uBA74 \uC790\uB3D9\uC73C\uB85C \uBC1B\uAE30 \uBC84\uD2BC\uC774 \uB5A0\uC694</div>
  </div>`;
  }
  $("cloudTrainBtn")?.addEventListener("click", async () => {
    const mn = ($("modelNameInput")?.value || "").trim();
    if (mn) {
      const e = validModelName(mn);
      if (e) {
        cloudStat("\u{1F524} " + e);
        $("modelNameInput")?.focus();
        return;
      }
    }
    const ga = $("growAuto");
    if (ga) ga.style.display = "none";
    const pwBox = $("cloudCode");
    const code = (pwBox?.value || "").trim();
    if (!code) {
      if (pwBox?.hidden) {
        pwBox.hidden = false;
        cloudStat('\u{1F512} \uBCA0\uD0C0 \uBE44\uBC00\uBC88\uD638\uB97C \uB123\uACE0 \u{1F9EA} Connect AI \uC11C\uBC84\uB97C \uB2E4\uC2DC \uB204\uB974\uC138\uC694. <span class="muted small">(\uBE44\uBC00\uBC88\uD638\uAC00 \uC5C6\uC73C\uBA74 \uC606 \u{1F193} \uBB34\uB8CC\uB85C \uC2DC\uC791!)</span>');
      } else cloudStat('\u{1F512} \uBCA0\uD0C0 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD558\uC138\uC694. <span class="muted small">\uC5C6\uC73C\uBA74 \u{1F193} \uBB34\uB8CC\uB85C \uC2DC\uC791\uD558\uC138\uC694.</span>');
      pwBox?.focus();
      return;
    }
    playTrainStart(mn || "\uB0B4 \uB450\uB1CC");
    const btn = $("cloudTrainBtn");
    btn.disabled = true;
    cloudStat('<span class="cyc-spin"></span> \uB450\uB1CC \uBCC0\uD658 \xB7 \uB370\uC774\uD130\uC14B \uC5C5\uB85C\uB4DC \xB7 GPU \uC791\uC5C5 \uC694\uCCAD \uC911\u2026');
    let r = null;
    try {
      r = await connect.trainCloud?.(code);
    } catch (e) {
      r = { ok: false, error: String(e?.message || e) };
    }
    btn.disabled = false;
    if (!r) {
      cloudStat("\u26A0\uFE0F \uC751\uB2F5\uC774 \uC5C6\uC5B4\uC694.");
      return;
    }
    if (r.badCode) {
      cloudStat(`\u{1F39F}\uFE0F ${escapeHtml(r.error || "\uBA64\uBC84\uC2ED \uCF54\uB4DC\uAC00 \uD2C0\uB838\uC5B4\uC694")}`);
      return;
    }
    if (!localStorage) {
    } else if (r.ok || r.gated || r.needLogin) {
      try {
        localStorage.setItem("cloudCode", code);
      } catch {
      }
    }
    if (r.ok && r.jobId) {
      let secs = 0;
      cloudStat(jobProgressCard("\uD559\uC2B5", "SCHEDULING", 0));
      if (cloudPoll) clearInterval(cloudPoll);
      let cloudPolls = 0;
      cloudPoll = window.setInterval(async () => {
        secs += 20;
        if (++cloudPolls > 360) {
          clearInterval(cloudPoll);
          cloudPoll = 0;
          cloudStat("\u23F1\uFE0F \uC0C1\uD0DC \uD655\uC778\uC744 \uBA48\uCDC4\uC5B4\uC694(2\uC2DC\uAC04 \uACBD\uACFC). \uC7A0\uC2DC \uD6C4 \uC571\uC744 \uB2E4\uC2DC \uC5F4\uBA74 \uACB0\uACFC\uB97C \uBC1B\uC744 \uC218 \uC788\uC5B4\uC694.");
          return;
        }
        const s = await connect.trainCloudStatus?.();
        if (!s?.ok) {
          cloudStat(jobProgressCard("\uD559\uC2B5", "", secs, []));
          return;
        }
        if (/COMPLETED|SUCCESS/i.test(s.stage)) {
          clearInterval(cloudPoll);
          cloudPoll = 0;
          playLevelUp($("modelNameInput")?.value || "\uB0B4 \uB450\uB1CC");
          cloudStat(`\u2705 \uD559\uC2B5 \uC644\uB8CC! <button id="cloudInstallBtn" class="oc-primary">\u2B07\uFE0F \uB0B4 \uBAA8\uB378\uB85C \uBC1B\uAE30</button>`);
          wireCloudInstall();
        } else if (/ERROR|FAIL/i.test(s.stage)) {
          clearInterval(cloudPoll);
          cloudPoll = 0;
          cloudStat(`\u26A0\uFE0F \uD559\uC2B5\uC774 \uC2E4\uD328\uD588\uC5B4\uC694. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uAC70\uB098 \u{1F193} \uBB34\uB8CC\uB85C \uC2DC\uC791(\uCF54\uB7A9)\uC744 \uC368\uBCF4\uC138\uC694.${s.message ? `<br><span class="muted small">${escapeHtml(String(s.message).slice(0, 120))}</span>` : ""}`);
        } else cloudStat(jobProgressCard("\uD559\uC2B5", s.stage, secs, s.logs));
      }, 2e4);
    } else if (r.needLogin) {
      cloudStat(`\u{1F511} ${escapeHtml(r.error || "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD574\uC694")} \u2014 \uAC00\uC785\uC740 \uBB34\uB8CC\uC608\uC694.`);
      openAuth();
    } else if (r.needHf) {
      cloudStat(`\u{1F917} ${escapeHtml(r.error || "\uBCF8\uC778 HuggingFace \uC5F0\uB3D9\uC774 \uD544\uC694\uD574\uC694(\uBB34\uB8CC)")}<div style="margin-top:8px;display:flex;gap:6px"><button id="cloudHfTokBtn" class="oc-primary">\u{1F511} \uBB34\uB8CC \uD1A0\uD070 \uB9CC\uB4E4\uAE30 \u2197</button><button id="cloudHfConnBtn" class="cyc-btn ghost">\u{1F5C2}\uFE0F \uC5F0\uB3D9 \uC5F4\uAE30</button></div>`);
      $("cloudHfTokBtn")?.addEventListener("click", () => connect.openExternal?.("https://huggingface.co/settings/tokens"));
      $("cloudHfConnBtn")?.addEventListener("click", () => {
        openOverlay("managePanel");
        switchMtab("integ");
      });
    } else if (r.gated) {
      cloudStat(`\u{1F5D3}\uFE0F ${escapeHtml(r.error)}`);
    } else {
      cloudStat(`\u{1F4A1} \uC774 \uACBD\uB85C\uB294 <b>\uBCF8\uC778 HuggingFace \uACC4\uC815 \uACB0\uC81C</b>\uAC00 \uD544\uC694\uD574\uC694. \uACB0\uC81C\uD558\uC2E4 \uD544\uC694 \uC5C6\uC2B5\uB2C8\uB2E4 \u2014 <b>\uD68C\uC6D0\uC73C\uB85C \uB85C\uADF8\uC778\uD558\uC2DC\uBA74 \uC6B0\uB9AC \uC11C\uBC84\uC5D0\uC11C \uBB34\uB8CC\uB85C \uD559\uC2B5</b>\uB418\uACE0, \uBE44\uBC00\uBC88\uD638\uAC00 \uC5C6\uC73C\uC2DC\uBA74 \u{1F193} \uBB34\uB8CC\uB85C \uC2DC\uC791(\uCF54\uB7A9)\uC744 \uC774\uC6A9\uD558\uC2DC\uBA74 \uB429\uB2C8\uB2E4.<div style="margin-top:8px;display:flex;gap:6px"><button id="cloudFreeBtn" class="oc-primary">\u{1F193} \uBB34\uB8CC\uB85C \uC2DC\uC791 (\uCF54\uB7A9)</button><button id="cloudLoginBtn" class="cyc-btn ghost">\u{1F511} \uB85C\uADF8\uC778</button></div>`);
      $("cloudFreeBtn")?.addEventListener("click", () => $("hfTrainBtn")?.click());
      $("cloudLoginBtn")?.addEventListener("click", () => openAuth());
    }
  });
  function wireCloudInstall() {
    $("cloudInstallBtn")?.addEventListener("click", async () => {
      const b = $("cloudInstallBtn");
      b.disabled = true;
      b.textContent = "\uBC1B\uB294 \uC911\u2026";
      const r = await connect.trainCloudInstall?.();
      if (r?.ok) {
        cloudStat(`\u{1F389} \uBC1B\uC558\uC5B4\uC694! \u{1F916} \uB0B4 AI \uD300\uC5D0\uC11C "${escapeHtml(r.model || "\uB0B4 \uBAA8\uB378")}"\uC744 \uC120\uD0DD\uD574 \uC4F0\uC138\uC694.`);
        loadLocalAI?.();
      } else cloudStat(`\u26A0\uFE0F ${escapeHtml(r?.error || "\uBC1B\uAE30 \uC2E4\uD328")}`);
    });
  }
  var _surg = { a: "", b: "", t: 0.5, running: false, name: "", method: "slerp", scope: "merge" };
  var surgPoll = 0;
  try {
    const s = JSON.parse(localStorage.getItem("surgDraft") || "{}");
    if (s && typeof s === "object") {
      _surg.a = s.a || "";
      _surg.b = s.b || "";
      _surg.t = typeof s.t === "number" ? s.t : 0.5;
      _surg.name = s.name || "";
      _surg.method = s.method || "slerp";
      _surg.scope = s.scope || "merge";
    }
  } catch {
  }
  function saveSurg() {
    try {
      localStorage.setItem("surgDraft", JSON.stringify({ a: _surg.a, b: _surg.b, t: _surg.t, name: _surg.name, method: _surg.method, scope: _surg.scope }));
    } catch {
    }
  }
  function surgSuggestName() {
    return _surg.name || (_surg.method === "task_add" ? "my-skill-add" : _surg.method === "task_sub" ? "my-skill-sub" : "my-fusion-v1");
  }
  function surgRecipe() {
    return { a: ($("surgA")?.value || "").trim(), b: ($("surgB")?.value || "").trim(), name: "\uC9C1\uC811 \uD569\uCE58\uAE30" };
  }
  function openSurgery(scope = "merge") {
    _surg.scope = scope;
    _surg.method = scope === "task" ? _surg.method.startsWith("task") ? _surg.method : "task_add" : "slerp";
    if (scope === "task" && _surg.t < 0.5) _surg.t = 1;
    saveSurg();
    closeOverlay("aiPanel");
    closeOverlay("brainPanel");
    openOverlay("surgeryPanel");
    _surg.running = false;
    renderSurgery();
  }
  function surgStat(html) {
    const el = $("surgStatus");
    if (el) {
      el.innerHTML = html;
      try {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
      }
    }
  }
  function surgFail(html) {
    const hfWall = /HF Pro|크레딧|결제|허깅|HuggingFace|횟수|월 \d|서버가 잠시|무료로 직접/i.test(html);
    const freeBtn = hfWall ? `<button id="surgFreeFromFail" class="surg-free-btn" style="margin-top:8px">\u{1F193} \uBB34\uB8CC\uB85C \uC9C1\uC811 \uD558\uAE30 <span class="sfb-sub">Colab \xB7 \uACB0\uC81C \uC5C6\uC774</span></button>` : "";
    surgStat(`${html}<div style="margin-top:8px">${freeBtn}<button id="surgRetry" class="lf-ghost">\u2190 \uB2E4\uC2DC \uC785\uB825</button></div>`);
    $("surgRetry")?.addEventListener("click", () => renderSurgery());
    $("surgFreeFromFail")?.addEventListener("click", surgeryFreeFromFail);
  }
  async function surgeryFreeFromFail() {
    const a = _surg.a, b = _surg.b, name = _fuseName || surgSuggestName();
    if (!a || !b) return renderSurgery();
    surgStat('<span class="cyc-spin"></span> \u{1F193} \uBB34\uB8CC Colab \uB178\uD2B8\uBD81 \uB9CC\uB4DC\uB294 \uC911\u2026');
    let res = null;
    try {
      res = await connect.surgeryNotebook?.(a, b, _surg.method, _surg.t, name);
    } catch (e) {
      res = { ok: false, error: String(e?.message || e) };
    }
    if (!res?.ok) return surgFail(`\u26A0\uFE0F ${escapeHtml(res?.error || "\uB178\uD2B8\uBD81 \uC0DD\uC131 \uC2E4\uD328")}`);
    if (res.colab) connect.openExternal?.(res.colab);
    surgStat(`\u{1F193} Colab \uC5F4\uC5C8\uC5B4\uC694! <a href="${escAttr(res.colab)}" target="_blank">\uD569\uC131 \uB178\uD2B8\uBD81 \u2197</a><br><span class="muted small">"\uB7F0\uD0C0\uC784 \u2192 \uBAA8\uB450 \uC2E4\uD589"\uB9CC \uB204\uB974\uBA74 \uACB0\uACFC\uAC00 \uB0B4 HF\uC5D0 \uC62C\uB77C\uAC00\uC694 \xB7 \uACB0\uC81C \uC548 \uD574\uB3C4 \uB429\uB2C8\uB2E4<br>\u{1F4A1} <b>\uBB34\uB8CC HuggingFace \uACC4\uC815</b> \uD544\uC694(1\uBD84 \uAC00\uC785) \u2014 <a href="https://huggingface.co/settings/tokens" target="_blank">\u{1F511} \uBB34\uB8CC \uD1A0\uD070 \uB9CC\uB4E4\uAE30 \u2197</a></span>`);
  }
  function surgRunning(html) {
    surgStat(`${html}<div style="margin-top:10px"><button id="surgCancelBtn" class="surg-cancel">\u2715 \uD569\uC131 \uCDE8\uC18C</button></div>`);
    $("surgCancelBtn")?.addEventListener("click", surgCancel);
  }
  async function surgCancel() {
    if (surgPoll) {
      clearInterval(surgPoll);
      surgPoll = 0;
    }
    surgStat('<span class="cyc-spin"></span> \uCDE8\uC18C\uD558\uB294 \uC911\u2026');
    try {
      await connect.cloudCancel?.();
    } catch {
    }
    surgStat('\u{1F6AB} \uD569\uC131\uC744 \uCDE8\uC18C\uD588\uC5B4\uC694. <button id="surgRetry" class="lf-ghost">\u2190 \uCC98\uC74C\uC73C\uB85C</button>');
    $("surgRetry")?.addEventListener("click", () => renderSurgery());
  }
  async function surgeryFree() {
    try {
      const r = surgRecipe();
      if (!r.a || !r.b) {
        surgStat("\u26A0\uFE0F \uD569\uCE60 AI 2\uAC1C\uB97C \uACE8\uB77C\uC8FC\uC138\uC694 (\uC704 \u{1F170}\xB7\u{1F171} \uCE78).");
        $(!r.a ? "surgA" : "surgB")?.focus();
        return;
      }
      if (r.a === r.b) {
        surgStat("\u26A0\uFE0F \uC11C\uB85C \uB2E4\uB978 \uB450 AI\uC5EC\uC57C \uD574\uC694.");
        return;
      }
      const nameRaw = ($("surgName")?.value || "").trim() || surgSuggestName();
      const nameErr = validModelName(nameRaw);
      if (nameErr) {
        surgStat("\u{1F3F7}\uFE0F " + nameErr);
        $("surgName")?.focus();
        return;
      }
      surgStat('<span class="cyc-spin"></span> \u{1F193} \uBB34\uB8CC Colab \uB178\uD2B8\uBD81 \uB9CC\uB4DC\uB294 \uC911\u2026');
      const res = await connect.surgeryNotebook?.(r.a, r.b, _surg.method, _surg.t, nameRaw);
      if (!res?.ok) return surgFail(`\u26A0\uFE0F ${escapeHtml(res?.error || "\uB178\uD2B8\uBD81 \uC0DD\uC131 \uC2E4\uD328")}`);
      if (res.colab) connect.openExternal?.(res.colab);
      surgStat(`\u{1F193} Colab \uC5F4\uC5C8\uC5B4\uC694! <a href="${escAttr(res.colab)}" target="_blank">\uD569\uC131 \uB178\uD2B8\uBD81 \u2197</a><br><span class="muted small">"\uB7F0\uD0C0\uC784 \u2192 \uBAA8\uB450 \uC2E4\uD589"\uB9CC \uB204\uB974\uBA74 \uACB0\uACFC\uAC00 \uB0B4 HF\uC5D0 \uC62C\uB77C\uAC00\uC694${res.note ? ` \xB7 ${escapeHtml(res.note)}` : ""}<br>\u{1F4A1} <b>\uBB34\uB8CC HuggingFace \uACC4\uC815</b> \uD544\uC694(1\uBD84 \uAC00\uC785) \u2014 <a href="https://huggingface.co/settings/tokens" target="_blank">\u{1F511} \uBB34\uB8CC \uD1A0\uD070 \uB9CC\uB4E4\uAE30 \u2197</a></span>`);
      hint('\u{1F193} \uBB34\uB8CC Colab \uB178\uD2B8\uBD81\uC774 \uC5F4\uB838\uC5B4\uC694 \u2014 "\uB7F0\uD0C0\uC784 \u2192 \uBAA8\uB450 \uC2E4\uD589"');
    } catch (e) {
      reportErr("\uBB34\uB8CC\uD569\uC131", e);
      surgFail(`\u26A0\uFE0F ${escapeHtml(String(e?.message || e))}`);
    }
  }
  function renderSurgery() {
    const body = $("surgBody");
    if (!body) return;
    const isTask = _surg.scope === "task";
    const paperUrl = isTask ? "https://arxiv.org/abs/2212.04089" : "https://github.com/arcee-ai/mergekit";
    const scopeIc = isTask ? "\u2797" : "\u{1F500}";
    const scopeNm = isTask ? "Task Arithmetic" : "Model Merging";
    const aIc = isTask ? "\u{1F170} \uC6D0\uBCF8 AI" : "\u{1F170} \uBAA8\uB378 A";
    const bIc = isTask ? "\u{1F171} \uB2A5\uB825 AI" : "\u{1F171} \uBAA8\uB378 B";
    const aTip = isTask ? "\uC6D0\uBCF8 AI (pretrained) \u2014 \uC608: Qwen/Qwen2.5-1.5B" : "\uBAA8\uB378 A \u2014 \uC608: Qwen/Qwen2.5-1.5B-Instruct";
    const bTip = isTask ? "\uB2A5\uB825 \uC788\uB294 AI = \uC6D0\uBCF8\uC744 \uD559\uC2B5\uC2DC\uD0A8 \uD30C\uC778\uD29C\uB2DD\uBCF8 \u2014 \uC608: Qwen/Qwen2.5-Coder-1.5B" : "\uBAA8\uB378 B \u2014 \uC608: google/gemma-2-2b-it (A\uC640 \uAC19\uC740 \uACC4\uC5F4\xB7\uD06C\uAE30)";
    const isSub = isTask && _surg.method === "task_sub";
    const opToggle = isTask ? `<div class="op-toggle">
      <button class="op-btn${_surg.method === "task_add" ? " on" : ""}" data-fm="task_add" title="\uC6D0\uBCF8 AI\uC5D0 \uB2A5\uB825 \uB354\uD558\uAE30 (Addition \xB7 \u03B8pre + \u03BB\u03C4)">\u2795</button>
      <button class="op-btn${_surg.method === "task_sub" ? " on" : ""}" data-fm="task_sub" title="\uB2A5\uB825 AI\uC5D0\uC11C \uADF8 \uB2A5\uB825 \uBE7C\uAE30 \u2192 \uC6D0\uBCF8 \uCABD (Negation \xB7 \u03B8ft \u2212 \u03BB\u03C4)">\u2796</button>
    </div>` : "";
    const opLine = isSub ? "\u{1F171} \uB2A5\uB825 AI \uC5D0\uC11C \u2796 \uB2A5\uB825\uC744 \uBE7C\uC694 \u2192 \u{1F170} \uC6D0\uBCF8 \uCABD\uC73C\uB85C" : "\u{1F170} \uC6D0\uBCF8 AI \uC5D0 \u2795 \uB2A5\uB825\uC744 \uB354\uD574\uC694";
    const resTxt = !isTask ? "\uC0C8 AI" : isSub ? "\uB2A5\uB825 \uBE80 AI (\uC6D0\uBCF8 \uCABD)" : "\uB2A5\uB825 \uB354\uD55C AI";
    const combineHtml = isTask ? `<input id="surgA" class="fuse-in" placeholder="${aIc}" value="${escAttr(_surg.a)}" title="${escAttr(aTip)}" autocomplete="off">
       <input id="surgB" class="fuse-in" placeholder="${bIc}" value="${escAttr(_surg.b)}" title="${escAttr(bTip)}" autocomplete="off">
       <div class="fuse-eq">${opLine}</div>` : `<input id="surgA" class="fuse-in" placeholder="${aIc}" value="${escAttr(_surg.a)}" title="${escAttr(aTip)}" autocomplete="off">
       <span class="fuse-op">\u{1F500}</span>
       <input id="surgB" class="fuse-in" placeholder="${bIc}" value="${escAttr(_surg.b)}" title="${escAttr(bTip)}" autocomplete="off">`;
    const blendHtml = `<div class="surg-blend">
      <div class="sb-head">${isTask ? isSub ? "\u{1F4C9} \uBE7C\uAE30 \uAC15\uB3C4 (\u03BB)" : "\u{1F4C8} \uB354\uD558\uAE30 \uAC15\uB3C4 (\u03BB)" : "\u2696\uFE0F \uD63C\uD569 \uBE44\uC728"}</div>
      <input type="range" id="surgBlend" min="0" max="${isTask ? 150 : 100}" value="${Math.round(_surg.t * 100)}">
      <div class="sb-val" id="sbVal" title="${isTask ? "\uB2A5\uB825 \uAC15\uB3C4 \u03BB (1.0=\uADF8\uB300\uB85C)" : "A:B \uC11E\uB294 \uBE44\uC728"}">${isTask ? _surg.t.toFixed(2) : `${Math.round((1 - _surg.t) * 100)}:${Math.round(_surg.t * 100)}`}</div></div>`;
    body.innerHTML = `<div class="surg-scope">${scopeIc} <b>${scopeNm}</b> <a id="surgPaperLink" class="surg-i" data-url="${paperUrl}" title="\uC6D0\uB9AC \uB17C\uBB38 \uC5F4\uAE30">\u24D8</a></div>
    ${opToggle}
    <div class="fuse-col">
      ${combineHtml}
      <span class="fuse-res" title="\uB9CC\uB4E4\uC5B4\uC9C8 \uC0C8 AI">\u2B07 \u2605 ${resTxt}</span>
    </div>
    <div class="surg-find">
      <input id="surgSearch" placeholder="\u{1F50D} \uBAA8\uB378 \uAC80\uC0C9" autocomplete="off">
      <button class="lf-ghost" id="surgSearchBtn" title="\uAC80\uC0C9">\u{1F50D}</button>
      <button class="lf-ghost" id="surgLoadMine" title="\uB0B4\uAC00 \uB9CC\uB4E0 AI \uBD88\uB7EC\uC624\uAE30">\u{1F9EC}</button>
    </div>
    <div class="surg-mine" id="surgMine"></div>
    ${blendHtml}
    <div class="pw-row">
      <input id="surgName" class="fuse-in" placeholder="\u{1F3F7}\uFE0F \uC0C8 AI \uC774\uB984" value="${escAttr(surgSuggestName())}" title="\uC601\uC5B4\xB7\uC22B\uC790\xB7\uD558\uC774\uD508\uB9CC" autocomplete="off">
      <input id="surgPw" class="surg-pw" type="password" placeholder="\u{1F512} \uBCA0\uD0C0 \uBE44\uBC00\uBC88\uD638 (\uC5C6\uC73C\uBA74 \u{1F193})" maxlength="8" title="\uBCA0\uD0C0 \uBE44\uBC00\uBC88\uD638 \u2014 \uBC1B\uC740 \uBD84\uB9CC. \uC5C6\uC73C\uBA74 \uC544\uB798 \u{1F193} \uBB34\uB8CC\uB85C \uD558\uC138\uC694" autocomplete="off">
      <span class="surg-left" id="surgLeft" title="\uC774\uBC88 \uB2EC \uB0A8\uC740 \uD569\uC131 \uD69F\uC218"></span>
    </div>
    <button class="cyc-btn primary surg-go" id="surgGo">\u{1F48E} \uD569\uC131 \uC2DC\uC791 <span class="muted small">\uBA64\uBC84\uC2ED\xB7\uC6D0\uD074\uB9AD</span></button>
    <button class="surg-free-btn" id="surgFreeBtn">\u{1F193} \uBB34\uB8CC\uB85C \uC9C1\uC811 \uD558\uAE30 <span class="sfb-sub">Colab\xB7\uBE44\uBC88 \uC5C6\uC774</span></button>
    <div class="surg-status" id="surgStatus"></div>`;
    wireSurgery();
    connect.gpuUsage?.("surgery").then((u) => {
      const el = $("surgLeft");
      if (el && u) el.innerHTML = u.left <= 0 ? `\u{1F5D3}\uFE0F \uC774\uBC88 \uB2EC \uB2E4 \uC500 \u2014 <b>\u{1F193} \uBB34\uB8CC\uB85C</b>` : `\u{1F39F}\uFE0F \uC774\uBC88 \uB2EC ${u.left}/${u.limit}\uD68C`;
    }).catch(() => {
    });
  }
  function short(repo) {
    return (repo || "").split("/").pop()?.replace(/-Instruct$/i, "") || repo;
  }
  function surgChips(models, label) {
    const box = $("surgMine");
    if (!box) return;
    box.innerHTML = `<div class="muted small" style="margin-bottom:5px">${label}</div>` + models.map((m) => `<button class="mine-chip" data-m="${escAttr(m)}" title="${escAttr(m)}">${escapeHtml(m.split("/").pop() || m)}</button>`).join("");
    box.querySelectorAll(".mine-chip").forEach((c) => c.addEventListener("click", () => {
      const m = c.dataset.m;
      if (!_surg.a) {
        _surg.a = m;
        $("surgA").value = m;
      } else if (!_surg.b) {
        _surg.b = m;
        $("surgB").value = m;
      } else {
        _surg.a = m;
        $("surgA").value = m;
        _surg.b = "";
        $("surgB").value = "";
      }
      saveSurg();
      hint(`\uC120\uD0DD: ${m.split("/").pop()}`);
    }));
  }
  function wireSurgery() {
    document.querySelectorAll(".op-btn[data-fm]").forEach((b) => b.addEventListener("click", () => {
      _surg.method = b.dataset.fm;
      if (_surg.t < 0.5) _surg.t = 1;
      saveSurg();
      renderSurgery();
    }));
    $("surgPaperLink")?.addEventListener("click", () => {
      const u = $("surgPaperLink")?.dataset.url;
      if (u) connect.openExternal?.(u);
    });
    const bl = $("surgBlend");
    if (bl) bl.oninput = () => {
      _surg.t = +bl.value / 100;
      const v = $("sbVal");
      if (v) v.textContent = _surg.method !== "slerp" ? _surg.t.toFixed(2) : `${100 - +bl.value} : ${bl.value}`;
      saveSurg();
    };
    const a = $("surgA"), b2 = $("surgB");
    if (a) a.oninput = () => {
      _surg.a = a.value;
      saveSurg();
    };
    if (b2) b2.oninput = () => {
      _surg.b = b2.value;
      saveSurg();
    };
    const nm = $("surgName");
    if (nm) nm.oninput = () => {
      _surg.name = nm.value;
      saveSurg();
    };
    $("surgLoadMine")?.addEventListener("click", async () => {
      const box = $("surgMine");
      if (box) box.innerHTML = '<span class="cyc-spin"></span> \uB0B4\uAC00 \uB9CC\uB4E0 AI \uBD88\uB7EC\uC624\uB294 \uC911\u2026';
      const r = await connect.hfMyModels?.();
      if (!r?.ok) {
        if (box) box.innerHTML = `<span class="muted small">\u26A0\uFE0F ${escapeHtml(r?.error || "\uBD88\uB7EC\uC624\uAE30 \uC2E4\uD328")}</span>`;
        return;
      }
      if (!r.models.length) {
        if (box) box.innerHTML = '<span class="muted small">\uC544\uC9C1 \uB0B4\uAC00 \uB9CC\uB4E0 AI\uAC00 \uC5C6\uC5B4\uC694 \u2014 \u{1F9EC} \uC7A5\uAE30\uAE30\uC5B5 \uD559\uC2B5\uC73C\uB85C \uB9CC\uB4E4\uBA74 \uC5EC\uAE30 \uB5A0\uC694.</span>';
        return;
      }
      surgChips(r.models, "\u{1F9EC} \uB0B4\uAC00 \uB9CC\uB4E0 AI \u2014 \uD0ED\uD558\uBA74 A\u2192B\uB85C \uCC44\uC6CC\uC838\uC694:");
    });
    const doSearch = async () => {
      const q = ($("surgSearch")?.value || "").trim();
      if (q.length < 2) {
        hint("2\uAE00\uC790 \uC774\uC0C1 \uC785\uB825\uD558\uC138\uC694");
        return;
      }
      const box = $("surgMine");
      if (box) box.innerHTML = '<span class="cyc-spin"></span> \uAC80\uC0C9 \uC911\u2026';
      const r = await connect.hfSearchModels?.(q);
      if (!r?.ok || !r.models.length) {
        if (box) box.innerHTML = `<span class="muted small">${escapeHtml(r?.error || "\uACB0\uACFC \uC5C6\uC74C")}</span>`;
        return;
      }
      surgChips(r.models, `\u{1F50D} "${escapeHtml(q)}" \uACB0\uACFC \u2014 \uD0ED\uD558\uBA74 A\u2192B\uB85C \uCC44\uC6CC\uC838\uC694:`);
    };
    $("surgSearchBtn")?.addEventListener("click", doSearch);
    $("surgSearch")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });
    $("surgGo")?.addEventListener("click", surgeryGo);
    $("surgFreeBtn")?.addEventListener("click", surgeryFree);
  }
  var _fuseName = "my-fusion";
  var _fuseA = "";
  var _fuseB = "";
  function surgFusion(aName, bName, newName) {
    _fuseName = newName;
    _fuseA = aName;
    _fuseB = bName;
    const body = $("surgBody");
    if (!body) return;
    body.innerHTML = `<div class="surg-status gf-top" id="surgStatus"><span class="cyc-spin"></span> \uD569\uC131 \uC2DC\uC791\u2026</div>
    <div class="gf-stage" id="gfStage">
      <div class="gf-circle r1"></div><div class="gf-circle r2"></div><div class="gf-circle r3"></div>
      <div class="gf-glow"></div>
      <div class="gf-orbit a"><div class="gf-orb a"><span class="go-c">\u{1F9E0}</span><span class="go-n">${escapeHtml(aName)}</span></div></div>
      <div class="gf-orbit b"><div class="gf-orb b"><span class="go-c">\u{1F9E0}</span><span class="go-n">${escapeHtml(bName)}</span></div></div>
      <div class="gf-pillar"></div>
      <div class="gf-card"><span class="gc-core">\u{1F9EC}</span><span class="gc-name">${escapeHtml(newName)}</span><div class="gf-stars" id="gfStars"></div></div>
    </div>`;
    for (let i = 0; i < 5; i++) gfParticle();
  }
  function gfParticle() {
    const st = $("gfStage");
    if (!st) return;
    const p = document.createElement("div");
    p.className = "gf-particle";
    st.appendChild(p);
    const ang = Math.random() * 6.28, d = 90 + Math.random() * 40;
    p.animate([{ transform: `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d}px) scale(1)`, opacity: 1 }, { transform: "translate(-50%,-50%) scale(.2)", opacity: 0 }], { duration: 700, easing: "cubic-bezier(.4,0,.2,1)" }).onfinish = () => p.remove();
  }
  function surgFusionDone() {
    const st = $("gfStage");
    if (!st) {
      return;
    }
    st.classList.add("gf-blast");
    for (let i = 0; i < 20; i++) gfParticle();
    setTimeout(() => {
      const card = st.querySelector(".gf-card");
      card?.classList.add("reveal");
      const stars = $("gfStars");
      if (stars) {
        [0, 1, 2].forEach((i) => setTimeout(() => {
          const s = document.createElement("span");
          s.className = "gf-star on";
          s.textContent = "\u2B50";
          stars.appendChild(s);
        }, 300 + i * 220));
      }
    }, 450);
    setTimeout(() => playFusionHero(_fuseName, _fuseA, _fuseB), 700);
  }
  function playFusionHero(newName, aName, bName) {
    const o = document.createElement("div");
    o.className = "born-fx fuse-hero";
    o.innerHTML = `<div class="born-rays"></div><div class="born-flash"></div><div class="born-ring"></div><div class="born-ring r2"></div><div class="born-core">\u{1F9EC}</div><div class="born-cap">\u{1F9EC} \uB450 AI\uAC00 \uD558\uB098\uB85C</div><div class="born-name">${escapeHtml(newName || "\uB0B4 \uD569\uC131 AI")}</div><div class="fuse-sub"><span class="fp a">\u{1F9E0} ${escapeHtml(aName || "AI")}</span><span class="plus">\u2295</span><span class="fp b">\u{1F9E0} ${escapeHtml(bName || "AI")}</span><span class="arrow">\u2192</span><span class="mine">\u2728 \uB0B4\uAC00 \uD569\uC131\uD55C AI</span></div>`;
    document.body.appendChild(o);
    requestAnimationFrame(() => o.classList.add("on"));
    setTimeout(() => o.remove(), 3600);
  }
  async function surgeryGo() {
    try {
      const r = surgRecipe();
      if (!r.a || !r.b) {
        surgStat("\u26A0\uFE0F \uD569\uCE60 AI 2\uAC1C\uB97C \uBAA8\uB450 \uACE8\uB77C\uC8FC\uC138\uC694 (\uC704 \u{1F170}\xB7\u{1F171} \uCE78).");
        $(!r.a ? "surgA" : "surgB")?.focus();
        return;
      }
      if (r.a === r.b) {
        surgStat("\u26A0\uFE0F \uC11C\uB85C \uB2E4\uB978 \uB450 AI\uC5EC\uC57C \uD574\uC694.");
        $("surgB")?.focus();
        return;
      }
      const nameRaw = ($("surgName")?.value || "").trim() || surgSuggestName();
      const nameErr = validModelName(nameRaw);
      if (nameErr) {
        surgStat("\u{1F3F7}\uFE0F " + nameErr);
        $("surgName")?.focus();
        return;
      }
      const pw = ($("surgPw")?.value || "").trim();
      if (!pw) {
        surgStat("\u{1F512} \uBE44\uBC00\uBC88\uD638(\uC544\uB798 \u{1F512} \uCE78)\uB97C \uC785\uB825\uD558\uC138\uC694.");
        const p = $("surgPw");
        p?.focus();
        p?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      surgFusion(short(r.a), short(r.b), nameRaw);
      surgStat('<span class="cyc-spin"></span> \uD569\uC131 \uC900\uBE44 \xB7 \uC2A4\uD06C\uB9BD\uD2B8 \uC5C5\uB85C\uB4DC \xB7 GPU \uC791\uC5C5 \uC694\uCCAD \uC911\u2026');
      let res = null;
      try {
        res = await connect.surgeryMerge?.(r.a, r.b, _surg.method, String(_surg.t), nameRaw, pw);
      } catch (e) {
        res = { ok: false, error: String(e?.message || e) };
      }
      const cmd = res?.command ? `<div class="cmd-box">${escapeHtml(res.command)}</div>` : "";
      if (!res) return surgFail("\u26A0\uFE0F \uC751\uB2F5\uC774 \uC5C6\uC5B4\uC694.");
      if (res.needLogin) {
        surgFail(`\u{1F511} ${escapeHtml(res.error || "\uD68C\uC6D0 \uB85C\uADF8\uC778\uC774 \uD544\uC694\uD574\uC694")}`);
        openAuth();
        return;
      }
      if (res.needHf) {
        surgFail(`\u{1F917} ${escapeHtml(res.error || "\uBCF8\uC778 HuggingFace \uC5F0\uB3D9\uC774 \uD544\uC694\uD574\uC694(\uBB34\uB8CC)")} \xB7 <a href="https://huggingface.co/settings/tokens" target="_blank">\uBB34\uB8CC \uD1A0\uD070 \uB9CC\uB4E4\uAE30 \u2197</a> \u2192 \u{1F5C2}\uFE0F \uC5F0\uB3D9\uC5D0 \uC785\uB825`);
        return;
      }
      if (res.gated) return surgFail(`\u{1F5D3}\uFE0F ${escapeHtml(res.error || "\uC774\uBC88 \uB2EC \uD569\uC131 \uD69F\uC218\uB97C \uB2E4 \uC37C\uC5B4\uC694")} \xB7 \u{1F193} \uBB34\uB8CC\uB85C \uC9C1\uC811 \uD558\uAE30\uB294 \uBB34\uC81C\uD55C\uC774\uC5D0\uC694`);
      if (res.needsPro) return surgFail(`\u26A0\uFE0F ${escapeHtml("\uC11C\uBC84\uAC00 \uC7A0\uC2DC \uD569\uC131\uC744 \uBABB \uD574\uC694 \u2014 \u{1F193} \uBB34\uB8CC\uB85C \uC9C1\uC811 \uD558\uAE30\uB85C \uC9C4\uD589\uD558\uC138\uC694")}`);
      if (!res.ok) return surgFail(`\u26A0\uFE0F ${escapeHtml(res.error || "\uC2DC\uC791 \uC2E4\uD328")}${cmd}`);
      let secs = 0;
      surgRunning(jobProgressCard("\uD569\uC131", "SCHEDULING", 0));
      if (surgPoll) clearInterval(surgPoll);
      surgPoll = window.setInterval(async () => {
        try {
          secs += 12;
          if (secs > 4200) {
            clearInterval(surgPoll);
            surgPoll = 0;
            surgFail("\u23F1\uFE0F \uC791\uC5C5\uC774 \uB108\uBB34 \uC624\uB798 \uAC78\uB824\uC694(\uC751\uB2F5 \uC5C6\uC74C). \uCDE8\uC18C\uD558\uACE0 \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.");
            return;
          }
          const s = await connect.trainCloudStatus?.();
          if (!s?.ok) {
            surgRunning(jobProgressCard("\uD569\uC131", "", secs, []));
            return;
          }
          if (/COMPLETED|SUCCESS/i.test(s.stage)) {
            clearInterval(surgPoll);
            surgPoll = 0;
            surgFusionDone();
            surgStat(`\u2705 \uD569\uC131 \uC131\uACF5! <button id="surgInstall" class="oc-primary">\u2B07\uFE0F \uC0C8 AI \uBC1B\uAE30</button>`);
            $("surgInstall")?.addEventListener("click", surgInstall);
          } else if (/ERROR|FAIL/i.test(s.stage)) {
            clearInterval(surgPoll);
            surgPoll = 0;
            surgFail(`\u26A0\uFE0F \uD569\uC131\uC774 \uC2E4\uD328\uD588\uC5B4\uC694. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uAC70\uB098 \u{1F193} \uBB34\uB8CC\uB85C \uC9C1\uC811 \uD558\uAE30(Colab)\uB97C \uC368\uBCF4\uC138\uC694.${s.message ? `<br><span class="muted small">${escapeHtml(String(s.message).slice(0, 120))}</span>` : ""}`);
          } else surgRunning(jobProgressCard("\uD569\uC131", s.stage, secs, s.logs));
        } catch (e) {
          clearInterval(surgPoll);
          surgPoll = 0;
          surgFail(`\u26A0\uFE0F \uC9C4\uD589 \uD655\uC778 \uC911 \uC624\uB958: ${escapeHtml(String(e?.message || e))}`);
        }
      }, 12e3);
    } catch (e) {
      reportErr("\uD569\uC131", e);
      surgFail(`\u26A0\uFE0F \uD569\uC131\uC744 \uC2DC\uC791\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694: ${escapeHtml(String(e?.message || e))}`);
    }
  }
  async function surgInstall() {
    const b = $("surgInstall");
    if (b) {
      b.disabled = true;
      b.textContent = "\uBC1B\uB294 \uC911\u2026";
    }
    const r = await connect.trainCloudInstall?.();
    if (r?.ok) {
      surgStat(`\u{1F389} \uBC1B\uC558\uC5B4\uC694! "${escapeHtml((r.model || "").split("/").pop() || "\uD569\uCCD0\uC9C4 \uBAA8\uB378")}" \uC900\uBE44 \uC644\uB8CC.<div style="margin-top:8px"><button id="surgOpenAi" class="oc-primary">\u{1F916} \uB0B4 AI \uC5F4\uAE30</button></div>`);
      loadLocalAI?.();
      $("surgOpenAi")?.addEventListener("click", () => {
        closeOverlay("surgeryPanel");
        openOverlay("aiPanel");
        loadAiPanel?.();
      });
    } else if (r?.adapterOnly) {
      surgStat(`\u26A0\uFE0F ${escapeHtml(r.error || "")}${r.repo ? `<br><a href="${escAttr(r.repo)}" target="_blank">\u{1F517} HuggingFace\uC5D0\uC11C \uACB0\uACFC \uBCF4\uAE30 \u2197</a>` : ""}<div style="margin-top:8px"><button id="surgInstall" class="oc-primary">\u2B07\uFE0F \uB2E4\uC2DC \uBC1B\uAE30</button></div>`);
      $("surgInstall")?.addEventListener("click", surgInstall);
    } else {
      surgStat(`\u26A0\uFE0F ${escapeHtml(r?.error || "\uBC1B\uAE30 \uC2E4\uD328")}<div style="margin-top:8px"><button id="surgInstall" class="oc-primary">\u2B07\uFE0F \uB2E4\uC2DC \uBC1B\uAE30</button></div>`);
      $("surgInstall")?.addEventListener("click", surgInstall);
    }
  }
  $("surgeryOpenBtn")?.addEventListener("click", () => openSurgery("merge"));
  var currentMethod = "sft";
  var methodsRendered = false;
  var methodList = [];
  async function renderMethods() {
    if (methodsRendered) return;
    methodsRendered = true;
    methodList = await connect.methodsList();
    const AX_FALLBACK = { sft: "2106.09685", dpo: "2305.18290" };
    methodList.forEach((m) => {
      if (!m.arxiv && AX_FALLBACK[m.id]) m.arxiv = AX_FALLBACK[m.id];
    });
    $("methodPick").innerHTML = methodList.map((m) => `<button class="m-chip${m.id === "sft" ? " on" : ""}" data-m="${m.id}" title="${escAttr(m.full || m.label)}"><span class="m-emoji">${m.emoji}</span><span class="m-lab">${escapeHtml(m.label)}</span></button>`).join("");
    document.querySelectorAll(".m-chip").forEach((b) => b.addEventListener("click", () => selectMethod(b.dataset.m)));
    selectMethod("sft");
  }
  function selectMethod(id) {
    currentMethod = id;
    const m = methodList.find((x) => x.id === id);
    if (!m) return;
    document.querySelectorAll(".m-chip").forEach((c) => c.classList.toggle("on", c.dataset.m === id));
    const mcTip = `${m.what}
\uC5B8\uC81C: ${m.when}
\uB370\uC774\uD130: ${m.data}${m.note ? `
\u{1F4A1} ${m.note}` : ""}`;
    $("methodCard").innerHTML = `<div class="mc-paper"><div class="mc-name">\u{1F4C4} ${escapeHtml(m.full || m.label)}</div><div class="mc-mean" title="${escAttr(mcTip)}">${escapeHtml(m.what || "")}</div>` + (m.arxiv ? `<button class="mc-arxiv" data-ax="${escAttr(m.arxiv)}">arXiv:${escapeHtml(m.arxiv)} \uB17C\uBB38 \uC5F4\uAE30 \u2197</button>` : "") + `</div>`;
    const axBtn = $("methodCard").querySelector(".mc-arxiv");
    if (axBtn) axBtn.addEventListener("click", () => {
      const ax = axBtn.dataset.ax;
      if (ax) connect.openExternal?.(`https://arxiv.org/abs/${ax}`);
      hint(`\u{1F4C4} ${m.full} \uB17C\uBB38(arXiv:${ax})\uC744 \uC5FD\uB2C8\uB2E4`);
    });
    const isDpo = id === "dpo";
    $("step1Title").textContent = isDpo ? "\u2696\uFE0F DPO \uC120\uD638\uC30D \uC0DD\uC131" : "\u{1F4E6} SFT \uB370\uC774\uD130\uB85C \uBCC0\uD658";
    $("step1Sub").textContent = isDpo ? "AI\uAC00 \uC88B\uC740\uB2F5 \u2705 vs \uB098\uC05C\uB2F5 \u274C \uC744 \uC2A4\uC2A4\uB85C \uC0DD\uC131 (\uC0AC\uB78C \uD074\uB9AD 0)" : "\uC9C0\uC2DD \u2192 AI\uAC00 Q&A \uBB38\uC81C\uB85C \uC790\uB3D9 \uCD9C\uC81C";
    $("dsConvertBtn").textContent = isDpo ? "\uC0DD\uC131" : "\uBCC0\uD658";
    $("augToggle").style.display = isDpo ? "none" : "";
    ["lfStep1", "lfStep2", "lfStep3"].forEach((s) => $(s).classList.remove("lf-done"));
    $("lfStep2").classList.add("lf-locked");
    $("hfUploadBtn").disabled = true;
    $("dsProg").classList.add("hidden");
  }
  var injectRaf = 0;
  var hexToRgb = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
    const n = m ? parseInt(m[1], 16) : 65345;
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  var PROTOCOL = ["> \uC778\uC81D\uC158 \uD504\uB85C\uD1A0\uCF5C \uC2DC\uC791\u2026", "> \uD398\uC774\uB85C\uB4DC \uC9C1\uB82C\uD654\u2026", "> \uC2E0\uACBD\uB9DD \uCC44\uB110 \uB3D9\uAE30\uD654\u2026", "> \uB450\uB1CC \uAC00\uC911\uCE58 \uC804\uC1A1\u2026", "> \u2713 \uC8FC\uC785 \uC644\uB8CC"];
  function playLevelUp(name) {
    const o = document.createElement("div");
    o.className = "born-fx";
    o.innerHTML = `<div class="born-rays"></div><div class="born-flash"></div><div class="born-ring"></div><div class="born-ring r2"></div><div class="born-core">\u{1F9E0}</div><div class="born-cap">\u{1F451} \uB0B4 AI \uD0C4\uC0DD</div><div class="born-name">${escapeHtml(name || "\uB0B4 \uB450\uB1CC")}</div><div class="born-sub">\u2728 \uC774\uC81C \uC644\uC804\uD55C \uB0B4 \uC18C\uC720 \u2728</div>`;
    document.body.appendChild(o);
    requestAnimationFrame(() => o.classList.add("on"));
    setTimeout(() => o.remove(), 3400);
  }
  function playTrainStart(name) {
    const o = document.createElement("div");
    o.className = "born-fx launch-hero";
    o.innerHTML = `<div class="born-rays"></div><div class="born-flash"></div><div class="born-ring"></div><div class="born-ring r2"></div><div class="born-core">\u{1F9EC}</div><div class="born-cap">\u{1F680} \uD559\uC2B5 \uC2DC\uC791</div><div class="born-name">${escapeHtml(name || "\uB0B4 \uB450\uB1CC")}</div><div class="born-sub">\u23F3 \uACE7 \uC644\uC804\uD55C \uB0B4 AI\uAC00 \uB429\uB2C8\uB2E4</div>`;
    document.body.appendChild(o);
    requestAnimationFrame(() => o.classList.add("on"));
    setTimeout(() => o.remove(), 2600);
  }
  function playCollect(n = 1) {
    const t = $("brainBtn");
    const r = t?.getBoundingClientRect();
    const o = document.createElement("div");
    o.className = "collect-fx";
    o.textContent = `\u{1F4C4} +${n} \uC9C0\uC2DD`;
    if (r) {
      o.style.left = `${r.left + r.width / 2}px`;
      o.style.top = `${r.top + r.height + 6}px`;
    }
    document.body.appendChild(o);
    requestAnimationFrame(() => o.classList.add("on"));
    setTimeout(() => o.remove(), 1300);
    t?.classList.add("brain-pulse");
    setTimeout(() => t?.classList.remove("brain-pulse"), 700);
  }
  function playInjection(label, lines = [], color = "#00ff41") {
    const fx = $("injectFx");
    const canvas = $("injectRain");
    fx.classList.remove("hidden", "out");
    $("ihSeal")?.classList.remove("show");
    fx.querySelector(".inject-hud")?.classList.remove("sealed");
    fx.style.setProperty("--fx", color);
    const [r, g, b] = hexToRgb(color);
    $("ihText").textContent = lines.join("\n").slice(0, 280);
    $("ihLog").innerHTML = "";
    let shown = 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setTimeout(() => fx.classList.add("hidden"), 1200);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.width = canvas.clientWidth * dpr, H = canvas.height = canvas.clientHeight * dpr;
    const cx = W / 2, cy = H * 0.42, maxR = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    const fontSize = 15 * dpr;
    const glyphs = "\uFF71\uFF72\uFF73\uFF74\uFF75\uFF76\uFF77\uFF78\uFF79\uFF7A\uFF7B\uFF7C\uFF7D\uFF7E\uFF7F\uFF80\uFF81\uFF82\uFF830123\u25C6\u25C7\u2B22\u2B2101";
    const gl = () => glyphs[Math.floor(Math.random() * glyphs.length)];
    const spawn = () => ({ a: Math.random() * Math.PI * 2, r: maxR * (0.65 + Math.random() * 0.45), sp: (1.5 + Math.random() * 2.8) * dpr, g: gl() });
    const P = Array.from({ length: 90 }, spawn);
    const cols = Math.max(1, Math.floor(W / (fontSize * 1.7)));
    const drops = new Array(cols).fill(0).map(() => Math.random() * -40);
    brainEnergy(1);
    const t0 = performance.now(), DUR = 2800;
    cancelAnimationFrame(injectRaf);
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / DUR);
      $("ihFill").style.width = p * 100 + "%";
      $("ihSub").textContent = p < 1 ? `${label} \u2026 ${Math.floor(p * 100)}%` : "\u2713 \uB450\uB1CC\uC5D0 \uC8FC\uC785 \uC644\uB8CC";
      const want = Math.min(PROTOCOL.length, Math.floor(p * PROTOCOL.length) + 1);
      while (shown < want) {
        const d = document.createElement("div");
        d.className = "ih-line";
        d.textContent = PROTOCOL[shown];
        $("ihLog").appendChild(d);
        shown++;
      }
      ctx.fillStyle = "rgba(0,5,7,0.24)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = fontSize + "px monospace";
      for (let k = 0; k < cols; k++) {
        const x = k * fontSize * 1.7, y = drops[k] * fontSize;
        ctx.fillStyle = `rgba(${r},${g},${b},0.16)`;
        ctx.fillText(gl(), x, y);
        if (y > H && Math.random() > 0.97) drops[k] = 0;
        drops[k] += 0.5;
      }
      const pulse = 0.62 + 0.38 * Math.sin(now / 110);
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 86 * dpr * pulse);
      grd.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
      grd.addColorStop(0.45, `rgba(${r},${g},${b},0.13)`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, 86 * dpr * pulse, 0, 7);
      ctx.fill();
      for (let ring = 0; ring < 2; ring++) {
        const rad = (40 + ring * 16) * dpr;
        const off = now / (500 + ring * 300) % (Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.55 - ring * 0.2})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, off, off + Math.PI * 1.3);
        ctx.stroke();
      }
      for (const q of P) {
        q.r -= q.sp * (0.8 + p * 1.9);
        if (q.r < 7 * dpr) {
          Object.assign(q, spawn());
          continue;
        }
        const near = 1 - q.r / maxR, al = Math.min(1, 0.22 + near * 0.95);
        const ca = Math.cos(q.a), sa = Math.sin(q.a);
        const x = cx + ca * q.r, y = cy + sa * q.r;
        const tail = (14 + near * 26) * dpr, x2 = cx + ca * (q.r + tail), y2 = cy + sa * (q.r + tail);
        ctx.strokeStyle = `rgba(${r},${g},${b},${al * 0.45})`;
        ctx.lineWidth = (0.8 + near) * dpr;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.fillStyle = Math.random() < 0.07 ? "#ffffff" : `rgba(${r},${g},${b},${al})`;
        ctx.font = fontSize * (0.65 + near * 0.8) + "px monospace";
        ctx.fillText(q.g, x, y);
      }
      if (p < 1 && !fx.classList.contains("hidden")) injectRaf = requestAnimationFrame(tick);
      else {
        $("ihCore")?.classList.add("blast");
        setTimeout(() => $("ihCore")?.classList.remove("blast"), 600);
        fx.querySelector(".inject-hud")?.classList.add("sealed");
        $("ihSeal")?.classList.add("show");
        setTimeout(() => {
          fx.classList.add("out");
          setTimeout(() => {
            fx.classList.add("hidden");
            fx.classList.remove("out");
            fx.querySelector(".inject-hud")?.classList.remove("sealed");
            brainEnergy(0.3);
          }, 620);
        }, 1300);
      }
    };
    injectRaf = requestAnimationFrame(tick);
  }
  $("injectFx").addEventListener("click", () => {
    cancelAnimationFrame(injectRaf);
    const f = $("injectFx");
    f.classList.add("hidden");
    f.querySelector(".inject-hud")?.classList.remove("sealed");
    $("ihSeal")?.classList.remove("show");
    brainEnergy(0.3);
  });
  var CAT_META = {
    marketing: { label: "\uB9C8\uCF00\uD305", emoji: "\u{1F4E3}", color: "#ff5c8a" },
    coding: { label: "\uCF54\uB529", emoji: "\u{1F4BB}", color: "#22d3ee" },
    design: { label: "\uB514\uC790\uC778", emoji: "\u{1F3A8}", color: "#a78bfa" },
    business: { label: "\uC0AC\uC5C5", emoji: "\u{1F4BC}", color: "#f5c518" },
    general: { label: "\uC77C\uBC18", emoji: "\u{1F5C2}\uFE0F", color: "#00ff41" }
  };
  function noteTitle(t) {
    const first = (t.split("\n").map((l) => l.trim()).find((l) => l && l !== "---") || t).replace(/^#+\s*/, "").replace(/[*_`>#]/g, "").trim();
    return first.slice(0, 64) + (first.length > 64 ? "\u2026" : "");
  }
  async function renderBrain() {
    const [g, list, count, stats] = await Promise.all([connect.brainGraph(), connect.brainList(), connect.brainCount(), connect.brainStats()]);
    $("brainCount").textContent = `${count}\uAC1C`;
    const lsc = $("longShortCount");
    if (lsc) lsc.textContent = String(count);
    const gsn = $("ghShortNum");
    if (gsn) gsn.textContent = String(count);
    const glx = $("ghLongXp");
    if (glx) glx.textContent = String(count);
    drawGraph(g);
    renderGrowth(stats);
    $("brainNotes").innerHTML = list.length ? list.map((n) => {
      const c = CAT_META[n.category] || CAT_META.general;
      return `<div class="bn" style="border-left:3px solid ${c.color}" title="${escapeHtml(n.text.slice(0, 500))}"><span class="bn-t">${escapeHtml(noteTitle(n.text))}</span><button class="bn-x" data-id="${n.id}">\u2715</button></div>`;
    }).join("") : '<div class="muted" style="text-align:center;padding:14px">\uC544\uC9C1 \uC9C0\uC2DD\uC774 \uC5C6\uC5B4\uC694. \u2B07 \uBCF5\uC6D0\uC73C\uB85C GitHub\uC5D0\uC11C \uAC00\uC838\uC624\uAC70\uB098, \u{1F9E0} EZER AI \uC9C0\uC2DD \uC2A4\uD1A0\uC5B4\uC5D0\uC11C \uC8FC\uC785, \uB610\uB294 \uB300\uD654 \uC911 \uC5D0\uC774\uC804\uD2B8\uAC00 \uC790\uB3D9\uC73C\uB85C \uC313\uC544\uC694.</div>';
    $("brainNotes").querySelectorAll(".bn-x").forEach((b) => b.addEventListener("click", async () => {
      await connect.brainDelete(b.dataset.id);
      await renderBrain();
    }));
  }
  function renderGrowth(stats) {
    const el = $("catGrowth");
    if (!el) return;
    if (!stats || !stats.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = stats.map((s) => {
      const c = CAT_META[s.id] || CAT_META.general;
      const ready = s.ready;
      return `<div class="cg-row${ready ? " ready" : ""}" title="${c.label} \uB450\uB1CC \xB7 ${s.count}\uAC1C${s.verified ? ` (\uAC80\uC99D ${s.verified})` : ""}">
      <span class="cg-ico" style="color:${c.color}">${c.emoji}</span>
      <span class="cg-lab">${c.label}</span>
      <span class="cg-bar"><span class="cg-fill" style="width:${s.pct}%;background:linear-gradient(90deg,${c.color}88,${c.color});box-shadow:0 0 ${ready ? 12 : 7}px ${c.color}${ready ? "" : "99"}"></span></span>
      <span class="cg-num" style="color:${ready ? c.color : ""}">${ready ? "\u{1F525}" : ""}${s.count}</span>
    </div>`;
    }).join("");
  }
  async function renderBridge() {
    const el = $("bridgeRow");
    if (!el) return;
    let b;
    try {
      b = await connect.bridgeStatus();
    } catch {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    if (b.state === "listening") {
      el.className = "bridge-row on";
      el.innerHTML = `\u{1F9E0} EZER AI \uC9C0\uC2DD \uC2A4\uD1A0\uC5B4 <b>\uC5F0\uACB0\uB428</b> (:${b.port}) \u2014 \uC2A4\uD1A0\uC5B4\uC5D0\uC11C [\uC8FC\uC785] \uB204\uB974\uBA74 \uC5D0\uC774\uC804\uD2B8 \uB450\uB1CC\uB85C \uB4E4\uC5B4\uC640\uC694`;
    } else if (b.state === "yielded") {
      el.className = "bridge-row warn";
      el.innerHTML = `\u26A0\uFE0F \uD3EC\uD2B8 ${b.port}\uB97C <b>${escapeHtml(b.heldBy || "\uB2E4\uB978 \uC571")}</b>\uC774 \uC810\uC720 \uC911 \u2014 \uC9C0\uC2DD \uC2A4\uD1A0\uC5B4 \uC8FC\uC785\uC774 \uADF8\uCABD\uC73C\uB85C \uAC00\uC694. \uB370\uC2A4\uD06C\uD0D1\uC73C\uB85C \uBC1B\uC73C\uB824\uBA74 \uADF8 \uC571(\uC775\uC2A4\uD150\uC158)\uC744 \uB044\uC138\uC694`;
    } else {
      el.className = "bridge-row";
      el.innerHTML = `\u{1F9E0} EZER AI \uC9C0\uC2DD \uC2A4\uD1A0\uC5B4 \uB300\uAE30 \uC911 (:${b.port})`;
    }
  }
  var fg = null;
  var hexA = (h, a) => {
    const [r, g, b] = hexToRgb(h);
    return `rgba(${r},${g},${b},${a})`;
  };
  function drawGraph(g) {
    const el = $("brainGraph");
    const FG = window.ForceGraph;
    const deg = {};
    (g.links || []).forEach((l) => {
      const s = l.source?.id || l.source, t = l.target?.id || l.target;
      deg[s] = (deg[s] || 0) + 1;
      deg[t] = (deg[t] || 0) + 1;
    });
    const nodes = (g.nodes || []).map((n) => ({ id: n.id, label: n.label, color: (CAT_META[n.category] || CAT_META.general).color, deg: deg[n.id] || 0 }));
    const links = (g.links || []).map((l) => ({ source: l.source, target: l.target, w: l.w }));
    if (!FG) {
      el.innerHTML = '<div class="muted" style="text-align:center;padding:30px">\uADF8\uB798\uD504 \uB77C\uC774\uBE0C\uB7EC\uB9AC \uB85C\uB4DC \uC2E4\uD328</div>';
      return;
    }
    if (!nodes.length) {
      el.innerHTML = '<div class="muted" style="text-align:center;padding:46px">\uC9C0\uC2DD\uC744 \uCD94\uAC00\uD558\uBA74 \uC2E0\uACBD\uB9DD\uC774 \uADF8\uB824\uC838\uC694 \u{1F9E0}</div>';
      fg = null;
      return;
    }
    if (!fg || el.firstChild?.tagName !== "CANVAS") {
      el.innerHTML = "";
      fg = FG()(el).backgroundColor("rgba(0,0,0,0)").nodeRelSize(3).nodeColor((n) => n.color || "#00FF41").nodeLabel((n) => n.label).linkColor((l) => hexA(l.source?.color || "#00FF41", 0.2)).linkWidth((l) => Math.max(0.6, (l.w || 0.3) * 1.6)).linkDirectionalParticles(2).linkDirectionalParticleWidth(2).linkDirectionalParticleColor((l) => l.source?.color || "#a5ffd7").nodeCanvasObjectMode(() => "after").nodeCanvasObject((node, ctx) => {
        if (!isFinite(node.x) || !isFinite(node.y)) return;
        const col = node.color || "#00FF41";
        const rad = 3 + Math.min(5, (node.deg || 0) * 0.8);
        const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, rad * 3);
        grd.addColorStop(0, hexA(col, 0.7));
        grd.addColorStop(0.5, hexA(col, 0.12));
        grd.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(node.x, node.y, rad * 3, 0, 7);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(node.x, node.y, rad, 0, 7);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(0.7, rad * 0.4), 0, 7);
        ctx.fill();
      });
    }
    fg.width(el.clientWidth || 700).height(el.clientHeight || 300);
    fg.graphData({ nodes, links });
  }
  async function openPlaza() {
    openOverlay("plazaPanel");
    if (PLAZA_MAINTENANCE) {
      const empty = $("pwEmpty");
      if (empty) {
        empty.style.display = "";
        empty.innerHTML = '\u{1F6A7} <b>\uAD11\uC7A5 \uC810\uAC80 \uC911</b><br><span style="opacity:.8">\uB354 \uC548\uC815\uC801\uC778 \uAD11\uC7A5\uC73C\uB85C \uC5C5\uADF8\uB808\uC774\uB4DC\uD558\uACE0 \uC788\uC5B4\uC694.<br>\uACE7 \uB2E4\uC2DC \uC5F4\uB9BD\uB2C8\uB2E4! \u{1F331}</span>';
      }
      const st = $("plazaStatus");
      if (st) st.textContent = "\u{1F6A7} \uC810\uAC80 \uC911";
      return;
    }
    ensurePlazaStream();
    const admin = await connect.plazaIsAdmin?.().catch(() => false);
    const dock = document.querySelector(".pw-dock");
    dock?.classList.toggle("admin", !!admin);
    const ti = $("topicInput"), tb = $("topicBtn"), gb = $("gradeBtn");
    if (admin) {
      if (ti) {
        ti.style.display = "";
        ti.placeholder = "\u{1F9D1}\u200D\u{1F3EB} [\uC120\uC0DD\uB2D8] \uD1A0\uB860 \uC8FC\uC81C\uB97C \uB4F1\uB85D\uD558\uBA74 \uBAA8\uB4E0 \uC5D0\uC774\uC804\uD2B8\uAC00 \uD1A0\uB860\uD574\uC694";
      }
      tb?.classList.remove("hidden");
      gb?.classList.remove("hidden");
      $("pwLabBtn")?.classList.remove("hidden");
    } else {
      if (ti) ti.style.display = "none";
      tb?.classList.add("hidden");
      gb?.classList.add("hidden");
      $("pwLabBtn")?.classList.add("hidden");
    }
  }
  var labSelected = /* @__PURE__ */ new Set();
  var labRunning = false;
  async function openLab() {
    $("pwLab")?.classList.remove("hidden");
    const grid = $("pwLabPersonas");
    if (!grid) return;
    if (!grid.children.length) {
      const personas = await connect.plazaLabPersonas?.().catch(() => []) || [];
      grid.innerHTML = personas.map((p) => `<button class="pw-persona" data-key="${escAttr(p.key)}" title="${escAttr(p.trait)}"><span class="pp-e">${p.emoji}</span><span class="pp-n">${escapeHtml(p.name)}</span></button>`).join("");
      grid.querySelectorAll(".pw-persona").forEach((el) => el.addEventListener("click", () => {
        const k = el.dataset.key;
        if (labSelected.has(k)) {
          labSelected.delete(k);
          el.classList.remove("on");
        } else {
          labSelected.add(k);
          el.classList.add("on");
        }
      }));
    }
  }
  $("pwLabBtn")?.addEventListener("click", openLab);
  $("pwLabClose")?.addEventListener("click", () => $("pwLab")?.classList.add("hidden"));
  $("pwLabRange")?.addEventListener("input", (e) => {
    $("pwLabNum").textContent = e.target.value;
  });
  $("pwLabSpawn")?.addEventListener("click", async () => {
    if (!plazaJoined) {
      hint("\uBA3C\uC800 \u{1F3EB} \uAD11\uC7A5 \uC785\uC7A5\uBD80\uD130 \uD558\uC138\uC694");
      return;
    }
    const count = parseInt($("pwLabRange").value, 10);
    const keys = labSelected.size ? [...labSelected] : void 0;
    const btn = $("pwLabSpawn");
    btn.disabled = true;
    btn.textContent = "\uC18C\uD658 \uC911\u2026";
    const r = await connect.plazaLab?.({ count, keys });
    btn.disabled = false;
    btn.textContent = "\u{1F680} \uC2E4\uD5D8 \uC2DC\uC791";
    if (!r?.ok) {
      hint("\uC2E4\uD5D8 \uC2E4\uD328: " + (r?.error || ""));
      return;
    }
    labRunning = true;
    $("pwLabStopBtn")?.classList.remove("hidden");
    btn.classList.add("hidden");
    const world = $("plazaWorld");
    if (world) pwToast(world, `\u{1F9EA} \uC2E4\uD5D8 \uC5D0\uC774\uC804\uD2B8 ${r.spawned.length}\uB9C8\uB9AC \uC18C\uD658! \uC8FC\uC81C\uB97C \uB358\uC838\uBCF4\uC138\uC694`);
    hint(`\u{1F9EA} \uC18C\uD658: ${r.spawned.map((s) => s.emoji + s.name).join(" ")}`);
  });
  $("pwLabStopBtn")?.addEventListener("click", async () => {
    await connect.plazaLabStop?.();
    labRunning = false;
    $("pwLabStopBtn")?.classList.add("hidden");
    $("pwLabSpawn")?.classList.remove("hidden");
    const world = $("plazaWorld");
    if (world) pwToast(world, "\u23F9 \uC2E4\uD5D8 \uC885\uB8CC \u2014 \uC5D0\uC774\uC804\uD2B8\uB4E4\uC774 \uD1F4\uC7A5\uD588\uC5B4\uC694");
  });
  $("plazaBtn")?.addEventListener("click", openPlaza);
  $("hdrPlazaBtn")?.addEventListener("click", openPlaza);
  var plazaJoined = false;
  var plazaES = null;
  var plazaMsgs = {};
  var plazaPresES = null;
  var plazaPeople = {};
  var PLAZA_MAINTENANCE = true;
  async function plazaToggleFn() {
    if (PLAZA_MAINTENANCE) {
      const st = $("plazaStatus");
      if (st) st.textContent = "\u{1F6A7} \uC810\uAC80 \uC911";
      const empty = $("pwEmpty");
      if (empty) {
        empty.style.display = "";
        empty.innerHTML = '\u{1F6A7} <b>\uAD11\uC7A5 \uC810\uAC80 \uC911</b><br><span style="opacity:.8">\uB354 \uC548\uC815\uC801\uC778 \uAD11\uC7A5\uC73C\uB85C \uC5C5\uADF8\uB808\uC774\uB4DC\uD558\uACE0 \uC788\uC5B4\uC694.<br>\uACE7 \uB2E4\uC2DC \uC5F4\uB9BD\uB2C8\uB2E4! \u{1F331}</span>';
      }
      hint("\u{1F6A7} \uAD11\uC7A5\uC740 \uC7A0\uC2DC \uC810\uAC80 \uC911\uC774\uC5D0\uC694 \u2014 \uACE7 \uB2E4\uC2DC \uC5F4\uB9BD\uB2C8\uB2E4!");
      return;
    }
    if (!plazaJoined) {
      await saveNameTag().catch(() => {
      });
      const r = await connect.plazaEnter();
      if (!r?.ok) {
        hint("\uC785\uC7A5 \uC2E4\uD328: " + (r?.reason || "\uC124\uC815\uC5D0\uC11C \uAD11\uC7A5 DB URL \uD655\uC778"));
        return;
      }
      window._myPlazaUid = r.uid || "";
      plazaJoined = true;
      $("plazaWorld")?.classList.add("joined");
      $("pwLeaveBtn")?.classList.remove("hidden");
      $("plazaStatus").textContent = "\u{1F7E2} \uC785\uC7A5 \uC911";
      ensurePlazaStream();
      if (r.uid) {
        const myEmoji = ($("plazaEmoji")?.value || cfg.plazaEmoji || "\u{1F5A5}\uFE0F").trim();
        const myCompany = ($("plazaCompany")?.value || cfg.company || "\uB0B4 \uD68C\uC0AC").trim();
        plazaPeople[r.uid] = { uid: r.uid, company: myCompany, emoji: myEmoji, agents: [], source: "connect-ai", ts: Date.now() };
        renderDesks();
      }
    } else {
      await connect.plazaLeave();
      plazaJoined = false;
      $("plazaWorld")?.classList.remove("joined");
      $("pwLeaveBtn")?.classList.add("hidden");
      $("plazaStatus").textContent = "\uB300\uAE30 \uC911";
      for (const uid of Object.keys(pwActors)) {
        pwActors[uid].el?.remove();
        delete pwActors[uid];
      }
      for (const uid of Object.keys(plazaPeople)) delete plazaPeople[uid];
      window._myPlazaUid = "";
      window._mineActor = null;
    }
  }
  $("plazaToggle")?.addEventListener("click", plazaToggleFn);
  $("pwLeaveBtn")?.addEventListener("click", plazaToggleFn);
  function subscribe(url, sub, store, onChange) {
    const q = sub === "messages" ? "?orderBy=%22ts%22&limitToLast=40" : "";
    const es = new EventSource(`${url.replace(/\/$/, "")}/plaza/rooms/lobby/${sub}.json${q}`);
    const onEv = (e) => {
      try {
        const { path, data } = JSON.parse(e.data);
        if (path === "/") {
          Object.keys(store).forEach((k) => delete store[k]);
          Object.assign(store, data || {});
        } else {
          const k = path.replace(/^\//, "").split("/")[0];
          if (data === null) delete store[k];
          else store[k] = data;
        }
        onChange();
      } catch {
      }
    };
    es.addEventListener("put", onEv);
    es.addEventListener("patch", onEv);
    return es;
  }
  async function ensurePlazaStream() {
    if (plazaES) return;
    const url = await connect.plazaDbUrl();
    if (!url || !/^https?:\/\//.test(url)) {
      $("plazaStatus").textContent = "\uC124\uC815\uC5D0\uC11C DB URL\uC744 \uBA3C\uC800 \uC785\uB825\uD558\uC138\uC694";
      return;
    }
    plazaES = subscribe(url, "messages", plazaMsgs, onMessages);
    plazaPresES = subscribe(url, "presence", plazaPeople, renderDesks);
  }
  var escAttr = (s) => String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  var PLAZA_SPRITES = ["secretary", "youtube", "developer", "business", "designer", "writer", "researcher", "editor", "instagram", "ceo"];
  var pwMeetBudget = 0;
  function pwDetectMeet(arr, many) {
    const CELL = 12;
    const grid = {};
    for (const a of arr) {
      const k = `${a.x / CELL | 0},${a.y / CELL | 0}`;
      (grid[k] || (grid[k] = [])).push(a);
    }
    pwMeetBudget = many ? 2 : 99;
    for (const a of arr) {
      const cx = a.x / CELL | 0, cy = a.y / CELL | 0;
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const cell = grid[`${gx},${gy}`];
        if (!cell) continue;
        for (const b of cell) {
          if (b.uid <= a.uid) continue;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < 8 && !a._met && !b._met) {
            a._met = b._met = true;
            a.pauseT = 70;
            b.pauseT = 70;
            a.dir = a.x > b.x ? "left" : "right";
            b.dir = b.x > a.x ? "left" : "right";
            if (pwMeetBudget-- > 0) {
              pwMeetFx(a);
              pwMeetFx(b);
              pwEncounter(a, b);
            } else {
              pwDexAdd(a);
              pwDexAdd(b);
            }
          } else if (dist > 15) {
            a._met = b._met = false;
          }
        }
      }
    }
  }
  var pwActors = {};
  var pwRaf = 0;
  var pwFrame = 0;
  var myPlazaUid = () => window._myPlazaUid || "";
  var hashIdx = (s, n) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) >>> 0;
    return h % n;
  };
  var PW_OBSTACLES = [
    [11, 40, 35, 67],
    // 💧 연못
    [50, 4, 70, 42],
    // ☕ 카페 건물
    [72, 2, 94, 40],
    // 📚 도서관 건물
    [0, 0, 100, 16],
    // 상단 나무 테두리
    [0, 0, 9, 100],
    // 좌측 나무
    [91, 40, 100, 100]
    // 우하단 나무
  ];
  var pwBlocked = (x, y) => PW_OBSTACLES.some(([x1, y1, x2, y2]) => x > x1 && x < x2 && y > y1 && y < y2);
  function pwWalkable() {
    for (let k = 0; k < 20; k++) {
      const x = 12 + Math.random() * 76, y = 44 + Math.random() * 48;
      if (!pwBlocked(x, y)) return [x, y];
    }
    return [50, 80];
  }
  function pwEnsureLoop() {
    if (pwRaf) return;
    const PT = 48, PCH = 96;
    const tick = () => {
      pwFrame++;
      const arr = Object.values(pwActors);
      const many = arr.length > 40;
      const animDiv = many ? 2 : 1;
      for (const a of arr) {
        const dx = a.tx - a.x, dy = a.ty - a.y;
        const d = Math.hypot(dx, dy);
        if (a.pauseT > 0) {
          a.pauseT--;
          a.moving = false;
        } else if (d > 0.6) {
          const sp = Math.min(0.42, 0.18 + d * 0.04) * animDiv;
          const nx = a.x + dx / d * sp, ny = a.y + dy / d * sp;
          let moved = false;
          if (!pwBlocked(nx, ny)) {
            a.x = nx;
            a.y = ny;
            moved = true;
          } else if (!pwBlocked(nx, a.y)) {
            a.x = nx;
            moved = true;
          } else if (!pwBlocked(a.x, ny)) {
            a.y = ny;
            moved = true;
          }
          if (moved) {
            a.moving = true;
            a.dir = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up";
          } else {
            const [wx, wy] = pwWalkable();
            a.tx = wx;
            a.ty = wy;
            a.moving = false;
          }
        } else {
          a.moving = false;
        }
        if (a.el && (a.moving || a._dirty)) {
          a._dirty = a.moving;
          a.el.style.left = a.x + "%";
          a.el.style.top = a.y + "%";
          a.el.style.zIndex = String(100 + (a.y | 0));
        }
        if (a.charEl && pwFrame % animDiv === 0) {
          const col = a.dir === "left" ? 6 : a.dir === "right" ? 12 : a.dir === "up" ? 18 : 0;
          const row = a.moving ? 2 : 1;
          const fi = (pwFrame / (a.moving ? 7 : 16) | 0) % 6;
          a.charEl.style.backgroundPosition = `-${(col + fi) * PT}px -${row * PCH}px`;
        }
      }
      if (pwFrame % (many ? 16 : 8) === 0) pwDetectMeet(arr, many);
      pwRaf = requestAnimationFrame(tick);
    };
    pwRaf = requestAnimationFrame(tick);
    if (!window._pwWander) window._pwWander = window.setInterval(() => {
      const arr = Object.values(pwActors);
      if (arr.length < 1) return;
      const a = pick(arr);
      if (!a || a.pauseT > 0) return;
      if (arr.length > 1 && Math.random() < 0.45) {
        const t = pick(arr.filter((x) => x.uid !== a.uid));
        let nx = t.x + (Math.random() < 0.5 ? 7 : -7), ny = t.y + 3;
        if (pwBlocked(nx, ny)) {
          const [wx, wy] = pwWalkable();
          nx = wx;
          ny = wy;
        }
        a.tx = nx;
        a.ty = ny;
      } else {
        const [wx, wy] = pwWalkable();
        a.tx = wx;
        a.ty = wy;
      }
    }, 2e3);
  }
  function pwBuildDeco(_world) {
  }
  function pwToast(world, text) {
    const t = document.createElement("div");
    t.className = "pw-toast";
    t.textContent = text;
    world.appendChild(t);
    setTimeout(() => {
      try {
        t.remove();
      } catch {
      }
    }, 2700);
  }
  var _pwProfBusy = false;
  async function pwShowProfile(p) {
    if (_pwProfBusy) return;
    _pwProfBusy = true;
    document.querySelector(".pw-prof")?.remove();
    const isMine = p.uid === myPlazaUid();
    const card = document.createElement("div");
    card.className = "pw-prof";
    const head = `<div class="pp-head"><span class="pp-emoji">${p.emoji || "\u{1F916}"}</span>
      <div><div class="pp-co">${escapeHtml(p.company || "\uC775\uBA85")}${isMine ? ' <b class="pp-me">\uB098</b>' : ""}</div>
      <div class="pp-agents">${(p.agents || []).join(" ") || "\u{1F916}"}</div></div>
      <button class="pp-x" title="\uB2EB\uAE30">\u2715</button></div>`;
    card.innerHTML = head + `<div class="pp-body"><div class="pp-loading">\u{1F392} \uBCF4\uC720 \uD604\uD669 \uBD88\uB7EC\uC624\uB294 \uC911\u2026</div></div>`;
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add("on"));
    card.querySelector(".pp-x")?.addEventListener("click", () => card.remove());
    card.addEventListener("click", (e) => {
      if (e.target === card) card.remove();
    });
    let prof = null;
    try {
      prof = await connect.plazaProfile?.(p.uid);
    } catch {
    }
    const inv = prof || { models: p.models ?? "\u2013", datasets: "\u2013", fusions: "\u2013", totalLevel: p.level ?? "\u2013", topModel: "" };
    const body = card.querySelector(".pp-body");
    if (!body) {
      _pwProfBusy = false;
      return;
    }
    body.innerHTML = `
    <div class="pp-grid">
      <div class="pp-cell"><b>${inv.models}</b><span>\u{1F9E0} \uBCF4\uC720 AI</span></div>
      <div class="pp-cell"><b>${inv.datasets}</b><span>\u{1F4C4} \uB370\uC774\uD130\uC14B</span></div>
      <div class="pp-cell"><b>${inv.fusions}</b><span>\u{1F9EC} \uD569\uC131</span></div>
      <div class="pp-cell lv"><b>Lv.${inv.totalLevel}</b><span>\u2B50 \uCD1D \uB808\uBCA8</span></div>
    </div>
    ${inv.topModel ? `<div class="pp-top">\u{1F3C6} \uB300\uD45C \uBAA8\uB378 \xB7 <b>${escapeHtml(inv.topModel)}</b></div>` : ""}
    ${prof ? "" : '<div class="pp-note">\uC544\uC9C1 \uBCF4\uC720 \uD604\uD669\uC744 \uACF5\uC720\uD558\uC9C0 \uC54A\uC740 \uD68C\uC0AC\uC608\uC694</div>'}`;
    _pwProfBusy = false;
  }
  function pwMeetFx(a) {
    if (!a.el) return;
    const m = document.createElement("div");
    m.className = "pw-meet";
    m.textContent = "\u2757";
    m.style.left = "50%";
    m.style.top = "0";
    a.el.appendChild(m);
    setTimeout(() => {
      try {
        m.remove();
      } catch {
      }
    }, 900);
  }
  var isBotUid = (uid) => /^(lab-|friend-bot|test-|demo)/.test(uid || "");
  function renderDesks() {
    const now = Date.now();
    const list = Object.values(plazaPeople).filter((p) => p && now - p.ts < 6e4).sort((a, b) => a.ts - b.ts);
    const realN = list.filter((p) => !isBotUid(p.uid)).length;
    const botN = list.length - realN;
    $("plazaStatus").innerHTML = list.length ? `\u{1F7E2} <b>${list.length}</b>\uBA85 \uC811\uC18D \uC911${realN > 1 ? ` <span style="opacity:.8">\xB7 \u{1F464} \uC2E4\uC81C ${realN}</span>` : ""}${botN ? ` <span style="opacity:.7">\xB7 \u{1F9EA} ${botN}</span>` : ""}` : "\uB300\uAE30 \uC911";
    const world = $("plazaWorld");
    if (!world) return;
    world.classList.toggle("joined", plazaJoined);
    pwBuildDeco(world);
    const seen = /* @__PURE__ */ new Set();
    const mine = myPlazaUid();
    const frag = document.createDocumentFragment();
    let newCount = 0;
    list.forEach((p, i) => {
      seen.add(p.uid);
      let a = pwActors[p.uid];
      if (!a) {
        newCount++;
        const isMine = p.uid === mine;
        const isReal = !isBotUid(p.uid);
        const sprite = isMine ? cfg.agentSprite || "secretary" : PLAZA_SPRITES[hashIdx(p.uid, PLAZA_SPRITES.length)];
        const [wx, wy] = pwWalkable();
        a = pwActors[p.uid] = { uid: p.uid, company: p.company, emoji: p.emoji || "\u{1F916}", sprite, x: 48 + i % 5 * 1.5, y: 96, tx: wx, ty: wy, dir: "up", moving: false, mine: isMine, pauseT: 0, _dirty: true };
        const el = document.createElement("div");
        el.className = "pw-actor" + (isMine ? " mine" : "") + (isReal && !isMine ? " real" : "");
        el.id = "pw-" + p.uid;
        el.style.left = a.x + "%";
        el.style.top = a.y + "%";
        el.innerHTML = `<div class="pw-bubble" id="pwb-${escAttr(p.uid)}"></div>` + (isMine ? '<div class="pw-portal"></div>' : "") + // ✨ 내 입장 포탈 연출
        `<div class="pw-char" style="background-image:url('${SPRITE(sprite)}')"></div><div class="pw-name">${isReal && !isMine ? "\u2B50 " : ""}${p.emoji || ""} ${escapeHtml(p.company || "\uC775\uBA85")}${isMine ? " <b>(\uB098)</b>" : ""}</div>`;
        frag.appendChild(el);
        a.el = el;
        a.charEl = el.querySelector(".pw-char");
        el.classList.add("pw-spawn");
        setTimeout(() => el.classList.remove("pw-spawn"), 900);
        el.addEventListener("click", () => {
          pwBubble(a, `\uC548\uB155! \uC6B0\uB9AC\uB294 ${p.company}\uC608\uC694 ${(p.agents || []).join("") || "\u{1F916}"}`);
          void pwShowProfile(p);
        });
        if (isMine) {
          window._mineActor = a;
          const w2 = $("plazaWorld");
          if (w2) pwToast(w2, "\u2728 \uAD11\uC7A5\uC5D0 \uC785\uC7A5\uD588\uC5B4\uC694!");
        } else if (isReal) {
          const w2 = $("plazaWorld");
          if (w2) pwToast(w2, `\u{1F30D} \uC2E4\uC81C \uC720\uC800 \uB4F1\uC7A5! ${p.emoji || ""} ${p.company}`);
        }
      }
      a.company = p.company;
      a.emoji = p.emoji || a.emoji;
    });
    if (frag.childNodes.length) world.appendChild(frag);
    if (newCount > 0 && list.length > 1) {
      if (newCount <= 2) {
        for (const p of list.slice(-newCount)) {
          if (p.uid !== mine) pwToast(world, `\u2728 ${p.company} \uC785\uC7A5!`);
        }
      } else pwToast(world, `\u{1F389} ${newCount}\uBA85\uC774 \uC6B0\uB974\uB974 \uC785\uC7A5! (\uCD1D ${list.length}\uBA85)`);
    }
    for (const uid of Object.keys(pwActors)) {
      if (!seen.has(uid)) {
        pwActors[uid].el?.remove();
        delete pwActors[uid];
      }
    }
    if (list.length) pwEnsureLoop();
  }
  function pwBubble(a, text) {
    const b = document.getElementById("pwb-" + a.uid);
    if (b) {
      b.textContent = text.slice(0, 70);
      b.classList.add("show");
      window.clearTimeout(b._t);
      b._t = window.setTimeout(() => b.classList.remove("show"), 4500);
    }
  }
  var PW_GREET = ["\uC548\uB155\uD558\uC138\uC694! \u{1F44B}", "\uC624, \uBC18\uAC00\uC6CC\uC694!", "\uC5B4\uB5A4 \uC77C \uD558\uC138\uC694?", "\uAC19\uC774 \uACF5\uBD80\uD574\uC694!", "\uC624\uB298 \uC8FC\uC81C \uBD24\uC5B4\uC694?", "\uD611\uC5C5\uD560\uB798\uC694?", "\uBA4B\uC9C4 \uD68C\uC0AC\uB124\uC694!", "\uC800\uD76C\uB3C4 1\uC778 \uAE30\uC5C5\uC774\uC5D0\uC694", "\uC88B\uC740 \uC544\uC774\uB514\uC5B4 \uC788\uC5B4\uC694?", "\uD654\uC774\uD305! \u{1F525}"];
  var pwTalkCooldown = {};
  function pwEncounter(a, b) {
    pwDexAdd(a);
    pwDexAdd(b);
    const key = a.uid < b.uid ? a.uid + "|" + b.uid : b.uid + "|" + a.uid;
    const now = Date.now();
    if ((pwTalkCooldown[key] || 0) > now) return;
    pwTalkCooldown[key] = now + 12e3;
    if (Math.random() < 0.05) {
      for (const k in pwTalkCooldown) if (pwTalkCooldown[k] < now) delete pwTalkCooldown[k];
    }
    setTimeout(() => pwBubble(a, pick(PW_GREET)), 200);
    setTimeout(() => pwBubble(b, pick(PW_GREET)), 1500);
  }
  var pwDex = new Set(JSON.parse(localStorage.getItem("pwDex") || "[]"));
  var pwDexMeta = JSON.parse(localStorage.getItem("pwDexMeta") || "{}");
  function pwDexAdd(a) {
    if (a.mine || pwDex.has(a.company)) return;
    pwDex.add(a.company);
    pwDexMeta[a.company] = { emoji: a.emoji, sprite: a.sprite };
    try {
      localStorage.setItem("pwDex", JSON.stringify([...pwDex]));
      localStorage.setItem("pwDexMeta", JSON.stringify(pwDexMeta));
    } catch {
    }
    pwToastWorld(`\u{1F4D5} \uB3C4\uAC10 \uB4F1\uB85D! ${a.emoji} ${a.company} (${pwDex.size}\uAC1C\uC9F8)`);
    renderDex();
  }
  function pwToastWorld(text) {
    const w = $("plazaWorld");
    if (w) pwToast(w, text);
  }
  function renderDex() {
    const el = $("pwDexCount");
    if (el) el.textContent = `\u{1F4D5} ${pwDex.size}`;
    const grid = $("pwDexGrid");
    if (!grid) return;
    grid.innerHTML = [...pwDex].map((co) => {
      const m = pwDexMeta[co] || { emoji: "\u{1F916}" };
      return `<div class="dex-card" title="${escAttr(co)}"><div class="dex-e">${m.emoji}</div><div class="dex-n">${escapeHtml(co)}</div></div>`;
    }).join("") || '<div class="muted small" style="padding:10px">\uC544\uC9C1 \uB9CC\uB09C \uD68C\uC0AC\uAC00 \uC5C6\uC5B4\uC694 \u2014 \uAD11\uC7A5\uC5D0\uC11C \uB2E4\uB978 \uC5D0\uC774\uC804\uD2B8\uC640 \uB9C8\uC8FC\uCE58\uBA74 \uB4F1\uB85D\uB3FC\uC694!</div>';
  }
  function pwTalk(uid, company, text) {
    const a = Object.values(pwActors).find((x) => x.uid === uid) || Object.values(pwActors).find((x) => x.company === company);
    if (!a) return;
    pwBubble(a, text);
    a.pauseT = 90;
    const others = Object.values(pwActors).filter((x) => x.uid !== a.uid);
    if (others.length) {
      const t = pick(others);
      let nx = t.x + (a.x > t.x ? 8 : -8), ny = t.y + 3;
      if (pwBlocked(nx, ny)) {
        const [wx, wy] = pwWalkable();
        nx = wx;
        ny = wy;
      }
      a.tx = nx;
      a.ty = ny;
      a.pauseT = 0;
      a.dir = a.x > t.x ? "left" : "right";
      t.pauseT = 60;
      t.dir = t.x > a.x ? "left" : "right";
    }
  }
  var lastMsgKey = "";
  function onMessages() {
    renderFeed();
    const list = Object.values(plazaMsgs).filter((m2) => m2 && m2.text).sort((a, b) => a.ts - b.ts);
    if (!list.length) return;
    const m = list[list.length - 1];
    const key = `${m.ts}|${m.text}`;
    if (key !== lastMsgKey) {
      const firstLoad = !lastMsgKey;
      lastMsgKey = key;
      if (!firstLoad) talkAt(m.company, m.text);
    }
    const topic = [...list].reverse().find((x) => x.role === "\uC120\uC0DD\uB2D8" || /^📢/.test(x.text || ""));
    if (topic) {
      const bb = $("bbLine");
      bb.innerHTML = `\u{1F9D1}\u200D\u{1F3EB} <b>${escapeHtml((topic.text || "").replace(/^📢\s*오늘의 주제:\s*/, ""))}</b>`;
      bb.classList.remove("hidden");
    }
  }
  function talkAt(company, text) {
    const m = Object.values(plazaMsgs).filter((x) => x && x.company === company).sort((a, b) => b.ts - a.ts)[0];
    pwTalk(m?.uid || "", company, text);
  }
  var feedSeen = /* @__PURE__ */ new Set();
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1e3);
    return s < 60 ? "\uBC29\uAE08" : s < 3600 ? `${Math.floor(s / 60)}\uBD84 \uC804` : `${Math.floor(s / 3600)}\uC2DC\uAC04 \uC804`;
  }
  function renderFeed() {
    const list = Object.values(plazaMsgs).filter((m) => m && m.text).sort((a, b) => a.ts - b.ts);
    for (const m of list) {
      const id = `${m.ts}|${m.text}`;
      if (feedSeen.has(id)) continue;
      feedSeen.add(id);
      const teacher = m.role === "\uC120\uC0DD\uB2D8" || /^📢/.test(m.text);
      const grade = /^🏆/.test(m.text);
      const el = document.createElement("div");
      el.className = "post" + (teacher ? " post-teacher" : "") + (grade ? " post-grade" : "");
      el.innerHTML = `<div class="post-av">${m.emoji || "\u{1F9D1}"}</div>
      <div class="post-body">
        <div class="post-head"><span class="post-name">${escapeHtml(m.company || "")}</span>${m.role ? `<span class="post-role">${escapeHtml(m.role)}</span>` : ""}<span class="post-time">${timeAgo(m.ts)}</span></div>
        <div class="post-text">${escapeHtml(m.text || "")}</div>
      </div>`;
      $("feed").appendChild(el);
    }
    $("feed").scrollTop = $("feed").scrollHeight;
  }
  connect.onPlazaPeer((_m) => {
  });
  connect.onPlazaPresence?.((list) => {
    if (!Array.isArray(list)) return;
    for (const p of list) if (p?.uid) plazaPeople[p.uid] = p;
    renderDesks();
  });
  connect.onPlazaLearned?.((d) => {
    const items = d?.items || [];
    const world = $("plazaWorld");
    if (world) pwToast(world, `\u{1F9E0} \uAD11\uC7A5\uC5D0\uC11C ${d.count}\uAC00\uC9C0 \uBC30\uC6E0\uC5B4\uC694! \u2192 \uB450\uB1CC\uC5D0 \uAC01\uC778 (\uCD1D ${d.total})`);
    const mine = window._mineActor;
    if (mine && items[0]) {
      pwBubble(mine, "\u{1F4A1} " + items[0]);
      const lb = document.createElement("div");
      lb.className = "pw-meet";
      lb.textContent = "\u{1F4A1}";
      lb.style.left = "50%";
      lb.style.top = "0";
      mine.el?.appendChild(lb);
      setTimeout(() => lb.remove(), 900);
    }
    hint(`\u{1F9E0} \uAD11\uC7A5\uC5D0\uC11C \uBC30\uC6B4 \uC9C0\uC2DD\uC774 \uB450\uB1CC\uC5D0 \uC313\uC600\uC5B4\uC694: ${items.join(" \xB7 ")}`);
  });
  async function sendTopic() {
    const i = $("topicInput");
    const t = i.value.trim();
    if (!t) return;
    if (!plazaJoined) {
      $("plazaStatus").textContent = "\u26A0\uFE0F \uBA3C\uC800 \u{1F3EB} \uAD11\uC7A5 \uC785\uC7A5\uBD80\uD130 \uD558\uC138\uC694!";
      return;
    }
    const r = await connect.plazaTopic(t);
    if (r && r.ok === false) {
      hint(r.notAdmin ? "\u{1F6E1}\uFE0F \uC8FC\uC81C \uB4F1\uB85D\uC740 \uAD00\uB9AC\uC790(\uC120\uC0DD\uB2D8)\uB9CC \uD560 \uC218 \uC788\uC5B4\uC694." : r.error || "\uC2E4\uD328");
      return;
    }
    i.value = "";
  }
  $("topicBtn").addEventListener("click", sendTopic);
  $("topicInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendTopic();
  });
  function loadBoard() {
    try {
      return JSON.parse(localStorage.getItem("academy_board") || "{}");
    } catch {
      return {};
    }
  }
  function renderLeaderboard() {
    const b = loadBoard();
    const list = Object.entries(b).sort((a, b2) => b2[1] - a[1]).slice(0, 5);
    $("leaderboard").innerHTML = list.length ? '<div class="lb-title">\u{1F3C5} \uB9AC\uB354\uBCF4\uB4DC</div>' + list.map(([c, p], i) => `<div class="lb-row"><span class="lb-rank">${["\u{1F947}", "\u{1F948}", "\u{1F949}", "4", "5"][i]}</span><span class="lb-name">${escapeHtml(c)}</span><span class="lb-pts">${p}\uC810</span></div>`).join("") : "";
  }
  $("gradeBtn")?.addEventListener("click", async () => {
    if (!plazaJoined) {
      $("plazaStatus").textContent = "\u26A0\uFE0F \uBA3C\uC800 \u{1F3EB} \uAD11\uC7A5 \uC785\uC7A5\uBD80\uD130 \uD558\uC138\uC694!";
      return;
    }
    const btn = $("gradeBtn");
    btn.disabled = true;
    btn.textContent = "\u{1F33E} \uC218\uD655 \uC911\u2026";
    const r = await connect.plazaGrade();
    btn.disabled = false;
    btn.textContent = "\u{1F33E} \uC9C0\uC2DD \uC218\uD655";
    if (!r?.ok) {
      hint("\uC218\uD655 \uC2E4\uD328: " + (r?.reason || "\uC544\uC9C1 \uD1A0\uB860\uC774 \uBD80\uC871\uD574\uC694"));
      return;
    }
    const b = loadBoard();
    for (const s of r.scores || []) b[s.company] = (b[s.company] || 0) + (s.score || 0);
    localStorage.setItem("academy_board", JSON.stringify(b));
    renderLeaderboard();
    if (r.insight) {
      playHarvestCinematic(r.insight, r.topic || "");
      hint(`\u{1F33E} \uAD11\uC7A5\uC5D0\uC11C \uC218\uD655\uD55C \uC9C0\uC2DD: "${r.insight}" \u2014 \uB2E8\uAE30\uAE30\uC5B5\uC5D0 \uC800\uC7A5\uB428 (\uC7A5\uAE30\uD559\uC2B5\uC73C\uB85C \uC774\uC5B4\uC9D1\uB2C8\uB2E4)`);
    } else {
      hint("\u{1F33E} \uC218\uD655 \uC644\uB8CC");
    }
    if (r.top) setTimeout(() => pwGlow(r.top), 2600);
  });
  function playHarvestCinematic(insight, topic) {
    const fx = $("pwHarvestFx");
    const world = $("plazaWorld");
    if (!fx || !world) return;
    fx.classList.remove("hidden");
    fx.classList.add("show");
    $("phfLabel").textContent = topic ? `\u{1F33E} "${topic}" \uC218\uD655 \uC911\u2026` : "\u{1F33E} \uC9D1\uB2E8\uC9C0\uC131 \uC218\uD655 \uC911\u2026";
    $("phfInsight").textContent = "";
    $("phfFoot").textContent = "";
    const crystal = $("phfCrystal");
    crystal.className = "phf-crystal gather";
    crystal.textContent = "\u{1F48E}";
    const wb = world.getBoundingClientRect();
    for (const a of Object.values(pwActors)) {
      if (!a.el) continue;
      const r = a.el.getBoundingClientRect();
      const sx = r.left + r.width / 2 - wb.left, sy = r.top - wb.top;
      for (let k = 0; k < 3; k++) {
        const p = document.createElement("div");
        p.className = "phf-particle";
        p.textContent = pick(["\u2728", "\u{1F4A1}", "\u2B50", "\u{1F506}"]);
        p.style.left = sx + "px";
        p.style.top = sy + "px";
        p.style.setProperty("--dx", wb.width / 2 - sx + "px");
        p.style.setProperty("--dy", wb.height / 2 - sy + "px");
        p.style.animationDelay = k * 90 + Math.random() * 220 + "ms";
        fx.appendChild(p);
        setTimeout(() => {
          try {
            p.remove();
          } catch {
          }
        }, 1700);
      }
    }
    setTimeout(() => {
      crystal.className = "phf-crystal pulse";
      $("phfLabel").textContent = "\u{1F48E} \uC9C0\uC2DD \uACB0\uC815 \uC644\uC131";
    }, 1300);
    setTimeout(() => {
      let i = 0;
      const el = $("phfInsight");
      const t = '"' + insight + '"';
      const typer = window.setInterval(() => {
        el.textContent = t.slice(0, ++i);
        if (i >= t.length) clearInterval(typer);
      }, 32);
    }, 1700);
    setTimeout(() => {
      $("phfFoot").textContent = "\u{1F9E0} \uB0B4 \uB450\uB1CC\uC5D0 \uAC01\uC778 \u2014 \uC7A5\uAE30\uAE30\uC5B5\uC73C\uB85C \uC790\uB78D\uB2C8\uB2E4";
      crystal.className = "phf-crystal absorb";
    }, 3400);
    setTimeout(() => {
      fx.classList.remove("show");
      fx.classList.add("hidden");
      const w = $("plazaWorld");
      if (w) pwToast(w, "\u{1F9E0} \uB450\uB1CC\uC5D0 \uC0C8 \uC9C0\uC2DD\uC758 \uBCC4\uC774 \uB5B4\uC5B4\uC694 \u2728");
    }, 4700);
  }
  function pwGlow(company) {
    for (const a2 of Object.values(pwActors)) a2.el?.querySelector(".pw-crown")?.remove();
    const a = Object.values(pwActors).find((x) => x.company === company);
    if (!a?.el) return;
    const c = document.createElement("div");
    c.className = "pw-crown";
    c.textContent = "\u{1F4A1}";
    a.el.appendChild(c);
    for (let k = 0; k < 10; k++) {
      const f = document.createElement("div");
      f.className = "pw-confetti";
      f.textContent = pick(["\u2728", "\u{1F4A1}", "\u2B50"]);
      f.style.left = 40 + Math.random() * 20 + "%";
      f.style.setProperty("--fx", ((Math.random() - 0.5) * 160).toFixed(0) + "px");
      f.style.animationDelay = k * 50 + "ms";
      $("plazaWorld")?.appendChild(f);
      setTimeout(() => f.remove(), 2e3);
    }
  }
  $("pwDexBtn")?.addEventListener("click", () => {
    renderDex();
    $("pwDex")?.classList.toggle("hidden");
  });
  var pwBgm = null;
  function pwToggleBgm() {
    const btn = $("pwBgmBtn");
    if (pwBgm) {
      pwBgm.stop();
      pwBgm = null;
      if (btn) btn.textContent = "\u{1F507}";
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const notes = [523, 587, 659, 784, 659, 587, 523, 440, 494, 523, 587, 523, 494, 440, 392, 440];
    let i = 0;
    const master = ctx.createGain();
    master.gain.value = 0.06;
    master.connect(ctx.destination);
    const id = window.setInterval(() => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square";
      o.frequency.value = notes[i % notes.length];
      g.gain.setValueAtTime(1e-4, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + 0.22);
      o.connect(g);
      g.connect(master);
      o.start();
      o.stop(ctx.currentTime + 0.24);
      if (i % 2 === 0) {
        const bo = ctx.createOscillator(), bg = ctx.createGain();
        bo.type = "triangle";
        bo.frequency.value = notes[i % notes.length] / 2;
        bg.gain.setValueAtTime(0.3, ctx.currentTime);
        bg.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + 0.3);
        bo.connect(bg);
        bg.connect(master);
        bo.start();
        bo.stop(ctx.currentTime + 0.3);
      }
      i++;
    }, 230);
    pwBgm = { ctx, stop: () => {
      clearInterval(id);
      try {
        ctx.close();
      } catch {
      }
    } };
    if (btn) btn.textContent = "\u{1F50A}";
  }
  $("pwBgmBtn")?.addEventListener("click", pwToggleBgm);
  function timeHello() {
    const h = (/* @__PURE__ */ new Date()).getHours();
    return h < 5 ? "\uB2A6\uC740 \uC2DC\uAC04\uC774\uB124\uC694" : h < 12 ? "\uC88B\uC740 \uC544\uCE68\uC785\uB2C8\uB2E4" : h < 18 ? "\uC88B\uC740 \uC624\uD6C4\uC785\uB2C8\uB2E4" : "\uC88B\uC740 \uC800\uB141\uC785\uB2C8\uB2E4";
  }
  async function greet() {
    const title = cfg.userTitle || "\uC0AC\uC7A5\uB2D8";
    const custom = (cfg.greeting || "").trim();
    if (custom) {
      addLog(agentTag(), custom.replace(/\{name\}/g, agentName()).replace(/\{title\}/g, title), false, true);
      return;
    }
    let openCnt = 0;
    try {
      const all = await connect.tasksList?.();
      openCnt = (all || []).filter((t) => t.status === "open").length;
    } catch {
    }
    const hello = `${timeHello()}, ${title}.`;
    const brief = openCnt > 0 ? `\uC624\uB298 \uD560\uC77C **${openCnt}\uAC1C**. **\u{1F680} \uC6B4\uC601 \uC2DC\uC791** \u2192 \uC5D0\uC774\uC804\uD2B8\uAC00 \uC2E4\uD589(\u2192 \uC0AC\uBB34\uC2E4). \uB610\uB294 \uBC14\uB85C \uC9C0\uC2DC\uD558\uC138\uC694.` : `**\uC624\uB298\uC758 \uD560\uC77C** \uCD94\uAC00 \uB610\uB294 \uBC14\uB85C \uC9C0\uC2DC \u2192 \uC5D0\uC774\uC804\uD2B8\uAC00 \uC0AC\uBB34\uC2E4\uC5D0\uC11C \uC2E4\uD589.`;
    addLog(agentTag(), `${hello} ${brief}`, false, true);
  }
  var welTimer = null;
  function updateWelcome() {
    if ($("welcomePanel").classList.contains("hidden")) return;
    const aiOn = !!(_localStatus?.running || cfg.llmModel);
    const coOn = !!(cfg.company && cfg.company !== "1\uC778 \uAE30\uC5C5");
    $("welStep1").className = "wel-step" + (aiOn ? " done" : " on");
    $("welStep2").className = "wel-step" + (coOn ? " done" : aiOn ? " on" : "");
    $("welStep3").className = "wel-step" + (aiOn && coOn ? " on" : "");
    const b1 = $("welAiBtn");
    b1.textContent = _localStatus?.loading ? "\u23F3 \uCF1C\uB294 \uC911\u2026" : aiOn ? "\u2713 \uCF1C\uC9D0" : "\uBAA8\uB378 \uBC1B\uAE30";
  }
  function maybeShowWelcome() {
    if (cfg.onboarded || OFFICE_MODE) return;
    openOverlay("welcomePanel");
    $("welCompany").value = cfg.company && cfg.company !== "1\uC778 \uAE30\uC5C5" ? cfg.company : "";
    updateWelcome();
    welTimer = window.setInterval(updateWelcome, 2e3);
  }
  function closeWelcome(done) {
    if (welTimer) {
      clearInterval(welTimer);
      welTimer = null;
    }
    closeOverlay("welcomePanel");
    cfg.onboarded = true;
    connect.setConfig?.({ onboarded: true });
    if (done) hint("\u{1F389} \uC900\uBE44 \uC644\uB8CC \u2014 AI \uD300\uC774 \uC77C\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4!");
  }
  $("welAiBtn")?.addEventListener("click", () => {
    openOverlay("aiPanel");
    loadAiPanel();
  });
  $("welCompany")?.addEventListener("change", async () => {
    const v = $("welCompany").value.trim();
    if (v) {
      cfg = await connect.setConfig({ company: v });
      applyCfgLabels();
      updateWelcome();
    }
  });
  $("welGoBtn")?.addEventListener("click", async () => {
    const v = $("welCompany").value.trim();
    if (v && v !== cfg.company) {
      cfg = await connect.setConfig({ company: v });
      applyCfgLabels();
    }
    closeWelcome(true);
    startOps();
  });
  $("welSkip")?.addEventListener("click", () => closeWelcome(false));
  document.querySelectorAll(".eco-mini").forEach((b) => b.addEventListener("click", () => {
    const u = b.dataset.url;
    if (u) connect.openExternal?.(u);
  }));
  $("ecoYt")?.addEventListener("click", () => connect.openExternal?.("https://www.youtube.com/channel/UCdLZ0MsYS4hmqFgOYCB6C9w"));
  $("acbBtn")?.addEventListener("click", () => connect.openExternal?.("https://aicitybuilders.com"));
  $("ezerBtn")?.addEventListener("click", () => connect.openExternal?.("https://salmon-ground-06a59b710.3.azurestaticapps.net"));
  $("ecoSite")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("https://connectai-desktop.web.app");
    } catch {
    }
    connect.openExternal?.("https://connectai-desktop.web.app");
    hint("\u{1F517} \uC8FC\uC18C \uBCF5\uC0AC\uB428 \u2014 \uCE5C\uAD6C\uC5D0\uAC8C \uBCF4\uB0B4\uC8FC\uC138\uC694!");
  });
  document.querySelectorAll(".sg-chip").forEach((b) => b.addEventListener("click", () => {
    const el = b;
    if (el.dataset.act === "ops") {
      $("suggChips")?.remove();
      startOps();
      return;
    }
    if (el.dataset.q) ask(el.dataset.q);
  }));
  function startClock() {
    const el = $("hdrClock");
    const tick = () => {
      el.textContent = (/* @__PURE__ */ new Date()).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };
    tick();
    setInterval(tick, 1e3);
  }
  function runBoot() {
    const boot = $("boot"), fill = $("bootFill"), sub = $("bootSub");
    const steps = ["INITIALIZING", "LOADING LOCAL AI", "CONNECTING", "WAKING \uC601\uC219", "READY"];
    let i = 0, pct = 0;
    const tick = setInterval(() => {
      pct = Math.min(100, pct + 9 + Math.random() * 11);
      fill.style.width = pct + "%";
      const si = Math.min(steps.length - 1, Math.floor(pct / 100 * steps.length));
      if (si !== i) {
        i = si;
        sub.textContent = steps[i];
      }
      if (pct >= 100) {
        clearInterval(tick);
        sub.textContent = "READY";
        setTimeout(() => {
          boot.classList.add("done");
          setTimeout(() => boot.remove(), 700);
        }, 320);
      }
    }, 160);
  }
  var brainViz = null;
  var brainOn = true;
  function initBrain() {
    if (brainViz) return;
    brainViz = new BrainViz($("brainGlobe"));
    brainViz.start();
    brainViz.setEnergy(0.12);
  }
  function brainEnergy(v) {
    if (brainViz) brainViz.setEnergy(brainOn ? v : 0);
  }
  $("cfgBrainViz").addEventListener("change", (e) => {
    brainOn = e.target.checked;
    $("mainStage").classList.toggle("brain-off", !brainOn);
    if (brainOn) {
      initBrain();
      brainEnergy(0.12);
    } else brainEnergy(0);
  });
  runBoot();
  loadCfg().then(async () => {
    await loadModels();
    greet();
    if (!cfg.onboarded && !OFFICE_MODE) {
      setTimeout(() => maybeShowWelcome(), 900);
      return;
    }
    const ls = await connect.localStatus?.().catch(() => null);
    if (!ls?.running && !cfg.llmModel) setTimeout(() => {
      openOverlay("aiPanel");
      loadAiPanel();
      hint("AI \uB450\uB1CC\uBD80\uD130 \uBC1B\uC73C\uBA74 \uD300\uC774 \uC77C\uC744 \uC2DC\uC791\uD574\uC694 \u2014 \uCD94\uCC9C \uB450\uB1CC \uD558\uB098 \uBC1B\uC544\uBCF4\uC138\uC694 \u{1F447}");
    }, 700);
  });
  renderLeaderboard();
  initBrain();
  startClock();
  connect.onBriefing((text) => {
    addLog("\u{1F4CB} \uC544\uCE68 \uBE0C\uB9AC\uD551", text, false, true, "#FBBF24");
    brainEnergy(0.9);
    try {
      speak(stripMd(text));
    } catch {
    }
  });
  connect.onTrayNewChat(async () => {
    await connect.reset();
    $("chat").innerHTML = "";
    greet();
    hint("\uC0C8 \uB300\uD654\uB97C \uC2DC\uC791\uD588\uC5B4\uC694");
  });
})();
//# sourceMappingURL=renderer.js.map
