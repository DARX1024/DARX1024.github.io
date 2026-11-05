// 为 viz-raw/ 里的每个可视化截两张缩略图（亮/暗各一张），存到 viz-raw/_thumbs/<id>-light.png 和 <id>-dark.png，
// 供首页和图库使用。缩略图是透明底、只用站点前景色 + 一个强调色的「线稿」，和首页地球仪是同一种视觉语言。
// 用法：npm run thumbs        （需要本机有 Playwright：npx playwright install chromium）
//
// 截哪一块由可视化自己声明，不写就截第一个 <canvas>：
//   <meta name="viz:thumb" content="#A .figs">          CSS 选择器
//   <meta name="viz:thumb-query" content="?lab=A">     打开时附带的查询参数
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listViz, VIZ_SRC } from '../src/plugins/viz.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // 全局安装的 Playwright 只能通过 require + NODE_PATH 找到
  try {
    ({ chromium } = (await import('node:module')).createRequire(import.meta.url)('playwright'));
  } catch {}
}
if (!chromium) {
  console.error('没有找到 Playwright。先运行：npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

// 与网站两套主题一致的配色（src/styles/global.css）
const THEMES = {
  light: { bg: '#fcfcfa', 'bg-soft': '#f4f3ef', fg: '#23221f', 'fg-soft': '#4a4843', muted: '#85827b', border: '#e5e3dd', accent: '#2f5d8a' },
  dark: { bg: '#171513', 'bg-soft': '#201d1a', fg: '#e6dccb', 'fg-soft': '#c2b6a2', muted: '#8a7f70', border: '#2c2824', accent: '#d9a55b' },
};
// 缩略图里把可视化自己的数据色收成单色：主体用前景色，一条用强调色，其余用弱前景色
const inkOf = (t) => ({ '--vec': t.fg, '--re': t.accent, '--env': t.muted, '--im': t['fg-soft'] });

const meta = (html, name) =>
  html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1];

const out = path.join(VIZ_SRC, '_thumbs');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 880, height: 900 }, deviceScaleFactor: 1.5 });
for (const v of listViz()) {
  const file = path.join(VIZ_SRC, v.file);
  const html = fs.readFileSync(file, 'utf8');
  const selector = meta(html, 'viz:thumb') ?? 'canvas';
  const query = meta(html, 'viz:thumb-query') ?? '';
  await page.goto(pathToFileURL(file).href + query);
  for (const [theme, site] of Object.entries(THEMES)) {
    await page.evaluate(
      ({ site, ink, theme }) => {
        const el = document.documentElement;
        for (const [k, val] of Object.entries(site)) el.style.setProperty(`--site-${k}`, val);
        el.style.setProperty('--site-bg', 'transparent');
        el.style.setProperty('--site-bg-soft', 'transparent');
        for (const [k, val] of Object.entries(ink)) el.style.setProperty(k, val);
        el.dataset.embedded = '';
        el.dataset.theme = theme;
      },
      { site, ink: inkOf(site), theme },
    );
    await page.waitForTimeout(400);
    const target = (await page.$(selector)) ?? (await page.$('body'));
    const dest = path.join(out, `${v.id}-${theme}.png`);
    await target.screenshot({ path: dest, omitBackground: true });
    console.log(`✓ ${path.relative(process.cwd(), dest)}`);
  }
  // 旧版的单张 jpg 缩略图不再使用
  fs.rmSync(path.join(out, `${v.id}.jpg`), { force: true });
}
await browser.close();
