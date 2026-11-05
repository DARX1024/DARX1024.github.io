// 线稿地球仪：Canvas 2D 手绘风场景，可拖动旋转、带惯性，颜色跟随站点主题。
// 静态部分（星点、光晕、地面、柏树、台座、球面阴影）预渲染到离屏画布，每帧只重画经纬网、星环和闪烁的星星。

type Mat = number[]; // 3×3，行主序
type RGB = [number, number, number];

const rotX = (t: number): Mat => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (t: number): Mat => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (t: number): Mat => { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
function mul(a: Mat, b: Mat): Mat {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
// 连乘后数值会慢慢漂移，偶尔把行向量重新正交化
function orthonormalize(m: Mat) {
  const r0 = [m[0], m[1], m[2]], r1 = [m[3], m[4], m[5]];
  const n0 = Math.hypot(...r0); r0.forEach((v, i) => (r0[i] = v / n0));
  const d = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2];
  r1.forEach((v, i) => (r1[i] = v - d * r0[i]));
  const n1 = Math.hypot(...r1); r1.forEach((v, i) => (r1[i] = v / n1));
  const r2 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
  m.splice(0, 9, ...r0, ...r1, ...r2);
}

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// 在当前裁剪区域里画排线。dir: '\\' 左上→右下，'/' 右上→左下，'|' 竖线
function hatch(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, gap: number, dir: '\\' | '/' | '|') {
  g.beginPath();
  if (dir === '|') {
    for (let x = x0; x <= x1; x += gap) { g.moveTo(x, y0); g.lineTo(x, y1); }
  } else if (dir === '\\') {
    for (let k = x0 - y1; k <= x1 - y0; k += gap * Math.SQRT2) { g.moveTo(k + y0, y0); g.lineTo(k + y1, y1); }
  } else {
    for (let k = x0 + y0; k <= x1 + y1; k += gap * Math.SQRT2) { g.moveTo(k - y0, y0); g.lineTo(k - y1, y1); }
  }
  g.stroke();
}

// 经纬网：本体坐标，北极为 +y
const D = Math.PI / 180;
const sph = (lat: number, lon: number) => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
function graticule() {
  const lines: { pts: number[][]; accent?: boolean }[] = [];
  for (let lon = 0; lon < 360; lon += 20) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(sph(lat * D, lon * D));
    lines.push({ pts, accent: lon === 0 });
  }
  for (let lat = -60; lat <= 60; lat += 20) {
    const pts = [];
    for (let lon = 0; lon <= 360; lon += 3) pts.push(sph(lat * D, lon * D));
    lines.push({ pts });
  }
  return lines;
}

// 光从左上前方照来（世界坐标，y 向上）
const L = (() => { const v = [-0.62, 0.5, 0.42]; const n = Math.hypot(...v); return v.map((x) => x / n); })();

export function mountGlobe(wrap: HTMLElement) {
  const canvas = wrap.querySelector('canvas')!;
  const handle = wrap.querySelector<HTMLElement>('.globe-handle')!;
  const ctx = canvas.getContext('2d')!;
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const GRID = graticule();

  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 0, G = 0;
  let bg: RGB = [0, 0, 0], fg: RGB = [255, 255, 255], accent: RGB = [255, 200, 0];
  const css = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  let back: HTMLCanvasElement, fore: HTMLCanvasElement, shade: HTMLCanvasElement;
  let sparkles: { x: number; y: number; s: number; w: number; p: number }[] = [];

  // 初始姿态：北极朝观众倾 20°、向左偏 26°
  const M: Mat = mul(rotZ(0.45), rotX(0.35));
  let vx = 0, vy = 0; // 绕世界 x / y 轴的角速度（rad/ms）
  let lastTouch = -1e9; // 上次交互的时间，自转在其后慢慢恢复
  let spinK = 1;
  let meteor: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  let nextMeteor = 6000;
  let frames = 0;

  // ---------- 颜色 ----------
  const probe = document.createElement('canvas').getContext('2d')!;
  function toRGB(c: string, fallback: RGB): RGB {
    probe.fillStyle = '#000';
    probe.fillStyle = c || '#000';
    const s = String(probe.fillStyle);
    if (s.startsWith('#')) return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
    const m = s.match(/[\d.]+/g);
    return m ? (m.slice(0, 3).map(Number) as RGB) : fallback;
  }
  function readColors() {
    const cs = getComputedStyle(root);
    bg = toRGB(cs.getPropertyValue('--bg').trim(), bg);
    fg = toRGB(cs.getPropertyValue('--fg').trim(), fg);
    accent = toRGB(cs.getPropertyValue('--accent').trim(), accent);
  }

  function layer(w = W, h = H) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.scale(dpr, dpr);
    g.lineCap = 'round'; g.lineJoin = 'round';
    return [c, g] as const;
  }

  // ---------- 布局 ----------
  function layout() {
    W = wrap.clientWidth; H = wrap.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    G = H * 0.8;
    R = Math.min(H * 0.22, W * 0.2);
    cx = W / 2; cy = G - 2.02 * R;
    const hs = R * 2.3;
    Object.assign(handle.style, { left: `${cx - hs / 2}px`, top: `${cy - hs / 2}px`, width: `${hs}px`, height: `${hs}px` });
  }

  // ---------- 静态图层 ----------
  function buildBack() {
    const [c, g] = layer();
    const r = rng(7);
    const n = Math.round((W * G) / 2400);
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * (G - 6), s = 0.35 + r() * r() * 1.1;
      g.fillStyle = css(fg, 0.2 + r() * 0.6);
      g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
    }
    sparkles = [];
    for (let i = 0; i < 9; i++) sparkles.push({ x: r() * W, y: r() * (G - 30) + 6, s: 3 + r() * 4, w: 0.0008 + r() * 0.0016, p: r() * 7 });

    // 球后的排线光晕，略偏左上
    g.save();
    g.beginPath(); g.arc(cx - 0.3 * R, cy - 0.26 * R, 1.06 * R, 0, 7); g.clip();
    g.strokeStyle = css(fg, 0.42); g.lineWidth = 0.7;
    hatch(g, cx - 1.5 * R, cy - 1.5 * R, cx + 1.2 * R, cy + 1.2 * R, 3.2, '\\');
    g.restore();
    back = c;
  }

  function cypress(g: CanvasRenderingContext2D, x: number, h: number, w: number) {
    const y = G + (x - cx) * -0.012; // 地平线略向右上倾
    const shape = new Path2D();
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const s = 1 - i / N; // 1=底，0=顶
      const hw = (w / 2) * Math.pow(s, 0.75) * (1 - 0.35 * Math.pow(s, 6));
      shape.lineTo(x - hw, y - (1 - s) * h);
    }
    for (let i = N; i >= 0; i--) {
      const s = 1 - i / N;
      const hw = (w / 2) * Math.pow(s, 0.75) * (1 - 0.35 * Math.pow(s, 6));
      shape.lineTo(x + hw, y - (1 - s) * h);
    }
    shape.closePath();
    g.fillStyle = css(bg); g.fill(shape);
    g.save(); g.clip(shape);
    g.strokeStyle = css(fg, 0.6); g.lineWidth = 0.7;
    hatch(g, x - w, y - h, x + w, y, 2.6, '/');
    g.restore();
    g.strokeStyle = css(fg, 0.95); g.lineWidth = 1.1; g.stroke(shape);
  }

  function buildFore() {
    const [c, g] = layer();
    const r = rng(11);
    const hy = (x: number) => G + (x - cx) * -0.012;

    // 地面：竖向短线做质感，两条起伏的等高线
    g.fillStyle = css(bg);
    g.beginPath(); g.moveTo(0, hy(0)); g.lineTo(W, hy(W)); g.lineTo(W, H); g.lineTo(0, H); g.fill();
    g.lineWidth = 0.7;
    const n = Math.round((W * (H - G)) / 38);
    for (let i = 0; i < n; i++) {
      const x = r() * W, top = hy(x) + 2, y = top + r() * (H - top);
      const len = 5 + r() * (6 + (y - top) * 0.25);
      g.strokeStyle = css(fg, 0.18 + r() * 0.45);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - len * 0.06, Math.min(H, y + len)); g.stroke();
    }
    for (const f of [0.38, 0.74]) {
      g.strokeStyle = css(fg, 0.45); g.lineWidth = 0.8;
      g.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const y = hy(x) + f * (H - G) + Math.sin(x * 0.013 + f * 9) * 2.2 + Math.sin(x * 0.041 + f * 3) * 1.1;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    g.strokeStyle = css(fg, 0.9); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(0, hy(0)); g.lineTo(W, hy(W)); g.stroke();

    // 柏树：位置以球半径为单位，放不下的就不画
    const trees: [number, number, number][] = [
      [-1.62, 1.4, 0.26], [-1.22, 1.85, 0.3], [2.1, 1.6, 0.27], [2.5, 1.2, 0.22],
      [-2.9, 1.0, 0.2], [3.25, 0.85, 0.18], [-3.6, 1.3, 0.24],
    ];
    for (const [dx, h, w] of trees) {
      const x = cx + dx * R;
      if (x - w * R < 4 || x + w * R > W - 4) continue;
      cypress(g, x, h * R, w * R);
    }

    // 台座：顶板 + 柱身，右侧凹槽表示背光面
    const slabW = 0.95 * R, slabH = 0.075 * R, slabY = cy + R * 1.025;
    const colW = 0.64 * R, colY = slabY + slabH, colH = hy(cx) - colY;
    g.lineWidth = 1.2; g.strokeStyle = css(fg, 0.95); g.fillStyle = css(bg);
    g.beginPath(); g.rect(cx - 0.05 * R, cy + R * 0.99, 0.1 * R, slabY - cy - R * 0.99); g.fill(); g.stroke();
    g.beginPath(); g.rect(cx - colW / 2, colY, colW, colH); g.fill(); g.stroke();
    g.save();
    g.beginPath(); g.rect(cx + colW * 0.06, colY, colW * 0.44, colH); g.clip();
    g.strokeStyle = css(fg, 0.6); g.lineWidth = 0.7;
    hatch(g, cx + colW * 0.06 + 1.5, colY, cx + colW / 2, colY + colH, 2.4, '|');
    g.restore();
    g.beginPath(); g.rect(cx - slabW / 2, slabY, slabW, slabH); g.fill(); g.stroke();

    // 底部淡出到页面背景
    const fade = g.createLinearGradient(0, H * 0.86, 0, H);
    fade.addColorStop(0, css(bg, 0)); fade.addColorStop(1, css(bg, 1));
    g.fillStyle = fade; g.fillRect(0, H * 0.86, W, H * 0.14 + 1);
    fore = c;
  }

  // 球面阴影：先画满排线，再按每个像素的 n·L 把亮面擦掉
  function buildShade() {
    const size = 2 * R + 4, o = R + 2;
    const make = (dir: '\\' | '/', gap: number, alpha: number, lo: number, hi: number) => {
      const [c, g] = layer(size, size);
      g.strokeStyle = css(fg, alpha); g.lineWidth = 0.75;
      hatch(g, 0, 0, size, size, gap, dir);
      const img = g.getImageData(0, 0, c.width, c.height), d = img.data, k = R * dpr;
      for (let py = 0; py < c.height; py++) {
        const Y = (py + 0.5 - o * dpr) / k;
        for (let px = 0; px < c.width; px++) {
          const i = (py * c.width + px) * 4 + 3;
          if (!d[i]) continue;
          const X = (px + 0.5 - o * dpr) / k, d2 = X * X + Y * Y;
          if (d2 >= 1) { d[i] = 0; continue; }
          const l = X * L[0] - Y * L[1] + Math.sqrt(1 - d2) * L[2];
          d[i] *= smooth(lo, hi, l) * clamp01((1 - Math.sqrt(d2)) * k);
        }
      }
      g.putImageData(img, 0, 0);
      return c;
    };
    const a = make('\\', 3.0, 0.7, 0.16, -0.06);
    const b = make('/', 3.6, 0.5, -0.3, -0.55);
    a.getContext('2d')!.drawImage(b, 0, 0);
    shade = a;
  }

  function rebuild() {
    if (!W || !H) return;
    readColors(); buildBack(); buildFore(); buildShade();
  }

  // ---------- 每帧 ----------
  const proj = (p: number[], r = 1) => {
    const x = M[0] * p[0] + M[1] * p[1] + M[2] * p[2];
    const y = M[3] * p[0] + M[4] * p[1] + M[5] * p[2];
    const z = M[6] * p[0] + M[7] * p[1] + M[8] * p[2];
    return [cx + x * R * r, cy - y * R * r, z];
  };

  function drawGrid() {
    const paths = [new Path2D(), new Path2D()]; // 普通线 / 本初子午线
    for (const line of GRID) {
      const path = paths[line.accent ? 1 : 0];
      let prev = proj(line.pts[0]), pen = false;
      if (prev[2] >= 0) { path.moveTo(prev[0], prev[1]); pen = true; }
      for (let i = 1; i < line.pts.length; i++) {
        const cur = proj(line.pts[i]);
        if ((prev[2] >= 0) !== (cur[2] >= 0)) {
          // 在球的轮廓处截断
          const t = prev[2] / (prev[2] - cur[2]);
          let ex = prev[0] + (cur[0] - prev[0]) * t - cx, ey = prev[1] + (cur[1] - prev[1]) * t - cy;
          const n = Math.hypot(ex, ey) / R || 1; ex = cx + ex / n; ey = cy + ey / n;
          if (pen) { path.lineTo(ex, ey); pen = false; } else { path.moveTo(ex, ey); path.lineTo(cur[0], cur[1]); pen = true; }
        } else if (pen) path.lineTo(cur[0], cur[1]);
        prev = cur;
      }
    }
    ctx.lineWidth = 0.9; ctx.strokeStyle = css(fg, 0.72); ctx.stroke(paths[0]);
    ctx.lineWidth = 1.3; ctx.strokeStyle = css(accent, 0.95); ctx.stroke(paths[1]);
  }

  // 星环在赤道面上，双线环带；front=true 画前半圈，否则画后半圈
  function drawRing(front: boolean) {
    const N = 160, r0 = 1.4, r1 = 1.47;
    const pts: number[][][] = [];
    for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2; const p = [Math.cos(a), 0, Math.sin(a)]; pts.push([proj(p, r0), proj(p, r1)]); }
    const runs: number[][][][] = [];
    let run: number[][][] | null = null;
    for (const q of pts) {
      if ((q[0][2] >= 0) === front) { (run ??= []).push(q); } else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    // 首尾相接的情况：把最后一段并到第一段前面
    if (runs.length > 1 && (pts[0][0][2] >= 0) === front && (pts[N][0][2] >= 0) === front) runs[0] = runs.pop()!.concat(runs[0]);
    for (const seg of runs) {
      if (seg.length < 2) continue;
      ctx.beginPath();
      seg.forEach((q, i) => (i ? ctx.lineTo(q[1][0], q[1][1]) : ctx.moveTo(q[1][0], q[1][1])));
      for (let i = seg.length - 1; i >= 0; i--) ctx.lineTo(seg[i][0][0], seg[i][0][1]);
      ctx.closePath();
      ctx.fillStyle = css(bg); ctx.fill();
      ctx.strokeStyle = css(fg, front ? 0.95 : 0.7); ctx.lineWidth = 1.1;
      for (const k of [0, 1]) {
        ctx.beginPath();
        seg.forEach((q, i) => (i ? ctx.lineTo(q[k][0], q[k][1]) : ctx.moveTo(q[k][0], q[k][1])));
        ctx.stroke();
      }
    }
  }

  function draw(t: number) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.drawImage(back, 0, 0, W, H);

    const still = reduce.matches;
    for (const s of sparkles) {
      const a = still ? 0.8 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.w + s.p));
      const k = s.s * (still ? 1 : 0.8 + 0.2 * a);
      ctx.strokeStyle = css(fg, a); ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(s.x - k, s.y); ctx.lineTo(s.x + k, s.y); ctx.moveTo(s.x, s.y - k); ctx.lineTo(s.x, s.y + k); ctx.stroke();
      ctx.fillStyle = css(fg, a); ctx.beginPath(); ctx.arc(s.x, s.y, 1.1, 0, 7); ctx.fill();
    }
    if (meteor) {
      const a = Math.sin(Math.PI * clamp01(meteor.life));
      const g = ctx.createLinearGradient(meteor.x, meteor.y, meteor.x - meteor.vx * 140, meteor.y - meteor.vy * 140);
      g.addColorStop(0, css(fg, 0.9 * a)); g.addColorStop(1, css(fg, 0));
      ctx.strokeStyle = g; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(meteor.x, meteor.y); ctx.lineTo(meteor.x - meteor.vx * 140, meteor.y - meteor.vy * 140); ctx.stroke();
    }

    drawRing(false);
    ctx.fillStyle = css(bg);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    ctx.drawImage(shade, cx - R - 2, cy - R - 2, 2 * R + 4, 2 * R + 4);
    drawGrid();
    ctx.strokeStyle = css(fg, 1); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    ctx.drawImage(fore, 0, 0, W, H);
    drawRing(true);
  }

  function step(dt: number, now: number) {
    if (!drag) {
      if (vx || vy) {
        const m = mul(rotY(vy * dt), rotX(vx * dt));
        M.splice(0, 9, ...mul(m, M));
        const f = Math.exp(-dt / 1200);
        vx *= f; vy *= f;
        if (Math.abs(vx) + Math.abs(vy) < 1e-6) vx = vy = 0;
      }
      if (!reduce.matches) {
        spinK = smooth(1500, 4000, now - lastTouch);
        if (spinK > 0) M.splice(0, 9, ...mul(M, rotY(0.00016 * spinK * dt)));
      }
    }
    if (++frames % 120 === 0) orthonormalize(M);

    if (!reduce.matches) {
      if (meteor) {
        meteor.x += meteor.vx * dt; meteor.y += meteor.vy * dt; meteor.life -= dt / 1100;
        if (meteor.life <= 0) meteor = null;
      } else if ((nextMeteor -= dt) <= 0) {
        const r = Math.random(), dir = r < 0.5 ? 1 : -1;
        meteor = { x: W * (0.15 + 0.7 * Math.random()), y: G * (0.05 + 0.3 * Math.random()), vx: 0.32 * dir, vy: 0.12, life: 1 };
        nextMeteor = 9000 + Math.random() * 14000;
      }
    }
  }

  // ---------- 动画循环：只在可见时跑 ----------
  let raf = 0, last = 0, visible = false;
  const moving = () => !!drag || Math.abs(vx) + Math.abs(vy) > 0;
  const shouldRun = () => visible && !document.hidden && (!reduce.matches || moving());
  function frame(t: number) {
    raf = 0;
    const dt = Math.min(50, Math.max(0, t - last)); last = t;
    step(dt, t); draw(t);
    if (shouldRun()) raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  // ---------- 交互 ----------
  let drag: { id: number; x: number; y: number; t: number } | null = null;
  const rotateWorld = (ax: number, ay: number) => M.splice(0, 9, ...mul(mul(rotY(ay), rotX(ax)), M));

  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    vx = vy = 0; lastTouch = performance.now();
    try { wrap.setPointerCapture(e.pointerId); } catch {}
    wrap.classList.add('dragging');
    kick();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(8, e.timeStamp - drag.t);
    rotateWorld(dy / R, dx / R);
    // 速度做一点平滑，松手时作为惯性的初速度
    vx = 0.6 * (dy / R / dt) + 0.4 * vx; vy = 0.6 * (dx / R / dt) + 0.4 * vy;
    drag = { id: drag.id, x: e.clientX, y: e.clientY, t: e.timeStamp };
    lastTouch = performance.now();
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.timeStamp - drag.t > 90) vx = vy = 0; // 停住后再松手，就不甩出去
    const cap = 0.012; vx = Math.max(-cap, Math.min(cap, vx)); vy = Math.max(-cap, Math.min(cap, vy));
    drag = null; lastTouch = performance.now();
    wrap.classList.remove('dragging');
    kick();
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!k) return;
    e.preventDefault();
    vx += k[0] * 0.0025; vy += k[1] * 0.0025; lastTouch = performance.now();
    kick();
  });

  // ---------- 尺寸、主题、可见性 ----------
  new ResizeObserver(() => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    layout(); rebuild(); draw(performance.now()); kick();
  }).observe(wrap);
  new MutationObserver(() => { rebuild(); draw(performance.now()); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(wrap);
  document.addEventListener('visibilitychange', kick);
  reduce.addEventListener?.('change', kick);

  layout(); rebuild(); draw(performance.now());
  wrap.classList.add('ready');
}
