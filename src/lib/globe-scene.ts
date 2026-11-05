// 线稿地球仪：Canvas 2D 手绘风场景，可拖动旋转、带惯性，颜色跟随站点主题。
// 静态部分（星空、银河、太阳、月亮、球面阴影）预渲染到离屏画布，每帧只重画经纬网、大陆轮廓、星环和闪烁的星星。
import { LAND } from './land';

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

// 经纬网和大陆轮廓：本体坐标，北极为 +y
const D = Math.PI / 180;
const sph = (lat: number, lon: number) => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
type Line = { pts: number[][]; kind: 'grid' | 'accent' | 'land' };
function lines(): Line[] {
  const out: Line[] = [];
  for (let lon = 0; lon < 360; lon += 20) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(sph(lat * D, lon * D));
    out.push({ pts, kind: lon === 0 ? 'accent' : 'grid' });
  }
  for (let lat = -60; lat <= 60; lat += 20) {
    const pts = [];
    for (let lon = 0; lon <= 360; lon += 3) pts.push(sph(lat * D, lon * D));
    out.push({ pts, kind: 'grid' });
  }
  // 数据在 ±180° 经线处被切开，切口不是真实海岸线，遇到就断开
  for (const ring of LAND) {
    let pts: number[][] = [];
    for (let i = 0; i < ring.length; i += 2) {
      const lon = ring[i] / 2, lat = ring[i + 1] / 2;
      if (pts.length && Math.abs(lon) >= 179.5 && Math.abs(ring[i - 2] / 2) >= 179.5) {
        if (pts.length > 1) out.push({ pts, kind: 'land' });
        pts = [];
      }
      pts.push(sph(lat * D, lon * D));
    }
    if (pts.length > 1) out.push({ pts, kind: 'land' });
  }
  return out;
}

const norm = (v: number[]) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };

export function mountGlobe(wrap: HTMLElement) {
  const canvas = wrap.querySelector('canvas')!;
  const handle = wrap.querySelector<HTMLElement>('.globe-handle')!;
  const ctx = canvas.getContext('2d')!;
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const LINES = lines();

  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 0;
  let sun = { x: 0, y: 0, r: 0 }, moon = { x: 0, y: 0, r: 0 };
  let L = [-0.6, 0.5, 0.4]; // 光照方向（世界坐标，y 向上），由太阳位置决定
  let bg: RGB = [0, 0, 0], fg: RGB = [255, 255, 255], accent: RGB = [255, 200, 0];
  const css = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  let back: HTMLCanvasElement, shade: HTMLCanvasElement;
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
    R = Math.min(H * 0.3, W * 0.21);
    cx = W / 2; cy = H * 0.5;
    // 太阳在左上，月亮在右下；窄屏时往角落收
    const sr = Math.max(14, R * 0.26), mr = Math.max(12, R * 0.22);
    sun = { x: Math.max(sr * 2.3, Math.min(cx - 2.25 * R, W * 0.16)), y: Math.max(sr * 2.3, H * 0.2), r: sr };
    moon = { x: Math.min(W - mr * 2, Math.max(cx + 2.3 * R, W * 0.84)), y: Math.min(H - mr * 2.2, H * 0.78), r: mr };
    if (W < 560) { sun.y = sr * 2; moon.y = H - mr * 1.8; }
    L = norm([sun.x - cx, -(sun.y - cy), Math.hypot(sun.x - cx, sun.y - cy) * 0.75]);
    const hs = R * 2.3;
    Object.assign(handle.style, { left: `${cx - hs / 2}px`, top: `${cy - hs / 2}px`, width: `${hs}px`, height: `${hs}px` });
  }

  // ---------- 静态图层 ----------
  // 球体明暗：先画满排线，再按每个像素的 n·L 把亮面擦掉。返回边长 2r+4 的贴图
  function shadeSprite(r: number, light: number[], gapA: number, gapB: number) {
    const size = 2 * r + 4, o = r + 2;
    const make = (dir: '\\' | '/', gap: number, alpha: number, lo: number, hi: number) => {
      const [c, g] = layer(size, size);
      g.strokeStyle = css(fg, alpha); g.lineWidth = 0.75;
      hatch(g, 0, 0, size, size, gap, dir);
      const img = g.getImageData(0, 0, c.width, c.height), d = img.data, k = r * dpr;
      for (let py = 0; py < c.height; py++) {
        const Y = (py + 0.5 - o * dpr) / k;
        for (let px = 0; px < c.width; px++) {
          const i = (py * c.width + px) * 4 + 3;
          if (!d[i]) continue;
          const X = (px + 0.5 - o * dpr) / k, d2 = X * X + Y * Y;
          if (d2 >= 1) { d[i] = 0; continue; }
          const l = X * light[0] - Y * light[1] + Math.sqrt(1 - d2) * light[2];
          d[i] *= smooth(lo, hi, l) * clamp01((1 - Math.sqrt(d2)) * k);
        }
      }
      g.putImageData(img, 0, 0);
      return c;
    };
    const a = make('\\', gapA, 0.7, 0.16, -0.06);
    a.getContext('2d')!.drawImage(make('/', gapB, 0.5, -0.3, -0.55), 0, 0);
    return a;
  }

  function buildBack() {
    const [c, g] = layer();
    const r = rng(7);

    // 银河：沿一条斜带高斯分布的细小星点
    const ang = -0.38, ux = Math.cos(ang), uy = Math.sin(ang), span = Math.hypot(W, H);
    const gauss = () => (r() + r() + r() + r() - 2) / 2;
    const nm = Math.round((W * H) / 260);
    for (let i = 0; i < nm; i++) {
      const t = (r() - 0.5) * span, off = gauss() * H * 0.16 + Math.sin(t * 0.008) * H * 0.04;
      const x = W / 2 + ux * t - uy * off, y = H * 0.55 + uy * t + ux * off;
      if (x < 0 || x > W || y < 0 || y > H) continue;
      g.fillStyle = css(fg, (0.08 + r() * 0.25) * (1 - Math.min(1, Math.abs(off) / (H * 0.32))));
      g.fillRect(x, y, 0.8, 0.8);
    }
    // 普通星点：多数很暗，少数亮一些
    const n = Math.round((W * H) / 1500);
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * H, b = r() ** 3, s = 0.35 + b * 1.25;
      g.fillStyle = css(fg, 0.2 + b * 0.7 + r() * 0.1);
      g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
    }
    // 几个星座样的连线，很淡
    for (let k = 0; k < 3; k++) {
      let x = r() * W, y = r() * H * 0.9;
      g.strokeStyle = css(fg, 0.16); g.lineWidth = 0.6; g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(x, y);
      const pts = [[x, y]];
      for (let j = 0; j < 4; j++) { x += (r() - 0.3) * 60; y += (r() - 0.5) * 50; g.lineTo(x, y); pts.push([x, y]); }
      g.stroke(); g.setLineDash([]);
      for (const [px, py] of pts) { g.fillStyle = css(fg, 0.85); g.beginPath(); g.arc(px, py, 1.3, 0, 7); g.fill(); }
    }
    sparkles = [];
    for (let i = 0; i < 10; i++) sparkles.push({ x: r() * W, y: r() * H, s: 3 + r() * 4, w: 0.0008 + r() * 0.0016, p: r() * 7 });

    // 太阳：几圈淡淡的光晕、长短交替的光芒、排线填充的日面
    const { x: sx, y: sy, r: sr } = sun;
    g.strokeStyle = css(fg, 0.12); g.lineWidth = 0.8;
    for (const k of [2.05, 2.5]) { g.beginPath(); g.arc(sx, sy, sr * k, 0, 7); g.stroke(); }
    g.strokeStyle = css(fg, 0.8); g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, l = i % 2 ? 1.45 : 1.8;
      g.moveTo(sx + Math.cos(a) * sr * 1.22, sy + Math.sin(a) * sr * 1.22);
      g.lineTo(sx + Math.cos(a) * sr * l, sy + Math.sin(a) * sr * l);
    }
    g.stroke();
    g.fillStyle = css(bg); g.beginPath(); g.arc(sx, sy, sr, 0, 7); g.fill();
    g.save(); g.clip();
    g.strokeStyle = css(fg, 0.35); g.lineWidth = 0.7;
    hatch(g, sx - sr, sy - sr, sx + sr, sy + sr, 2.6, '|');
    g.restore();
    g.strokeStyle = css(fg, 0.95); g.lineWidth = 1.4;
    g.beginPath(); g.arc(sx, sy, sr, 0, 7); g.stroke();
    g.lineWidth = 0.9; g.beginPath(); g.arc(sx, sy, sr * 0.62, 0, 7); g.stroke();

    // 月亮：被同一个太阳照亮，所以亮面朝向太阳；加几个环形山
    const { x: mx, y: my, r: mr } = moon;
    const ml = norm([sun.x - mx, -(sun.y - my), Math.hypot(sun.x - mx, sun.y - my) * -1.1]); // 太阳在月亮后方，看到的是弦月
    g.fillStyle = css(bg); g.beginPath(); g.arc(mx, my, mr, 0, 7); g.fill();
    g.strokeStyle = css(fg, 0.55); g.lineWidth = 0.8;
    for (const [dx, dy, cr] of [[-0.35, -0.3, 0.2], [0.2, 0.35, 0.14], [-0.05, 0.05, 0.1], [0.4, -0.25, 0.09]]) {
      g.beginPath(); g.ellipse(mx + dx * mr, my + dy * mr, cr * mr, cr * mr * 0.85, 0.3, 0, 7); g.stroke();
    }
    g.drawImage(shadeSprite(mr, ml, 2.2, 2.6), mx - mr - 2, my - mr - 2, 2 * mr + 4, 2 * mr + 4);
    g.strokeStyle = css(fg, 0.95); g.lineWidth = 1.2;
    g.beginPath(); g.arc(mx, my, mr, 0, 7); g.stroke();
    back = c;
  }

  function rebuild() {
    if (!W || !H) return;
    readColors(); buildBack(); shade = shadeSprite(R, L, 3.0, 3.6);
  }

  // ---------- 每帧 ----------
  const proj = (p: number[], r = 1) => {
    const x = M[0] * p[0] + M[1] * p[1] + M[2] * p[2];
    const y = M[3] * p[0] + M[4] * p[1] + M[5] * p[2];
    const z = M[6] * p[0] + M[7] * p[1] + M[8] * p[2];
    return [cx + x * R * r, cy - y * R * r, z];
  };

  function drawGrid() {
    const paths = { grid: new Path2D(), accent: new Path2D(), land: new Path2D() };
    for (const line of LINES) {
      const path = paths[line.kind];
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
    ctx.lineWidth = 0.7; ctx.strokeStyle = css(fg, 0.38); ctx.stroke(paths.grid);
    ctx.lineWidth = 1.1; ctx.strokeStyle = css(accent, 0.8); ctx.stroke(paths.accent);
    ctx.lineWidth = 1.25; ctx.strokeStyle = css(fg, 0.95); ctx.stroke(paths.land);
  }

  // 星环在赤道面上，双线环带；front=true 画前半圈，否则画后半圈
  function drawRing(front: boolean) {
    const N = 160, r0 = 1.4, r1 = 1.47;
    const pts: number[][][] = [];
    for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2; const p = [Math.cos(a), 0, Math.sin(a)]; pts.push([proj(p, r0), proj(p, r1)]); }
    const runs: number[][][][] = [];
    let run: number[][][] | null = null;
    // 每段两端各多带一个点，前后两半在交界处接上，不留缺口
    const on = pts.map((q) => (q[0][2] >= 0) === front);
    pts.forEach((q, i) => {
      const keep = on[i] || on[(i + 1) % (N + 1)] || on[(i + N) % (N + 1)];
      if (keep) (run ??= []).push(q); else if (run) { runs.push(run); run = null; }
    });
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
        meteor = { x: W * (0.15 + 0.7 * Math.random()), y: H * (0.05 + 0.4 * Math.random()), vx: 0.32 * dir, vy: 0.12, life: 1 };
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
