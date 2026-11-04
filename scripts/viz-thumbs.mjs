// 为 viz-raw/ 里的每个可视化截一张缩略图，存到 viz-raw/_thumbs/<id>.jpg，供首页和图库使用。
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

// 与网站暗色主题一致的配色（src/styles/global.css）
const SITE = {
  bg: '#171513', 'bg-soft': '#201d1a', fg: '#e6dccb', 'fg-soft': '#c2b6a2', muted: '#8a7f70', border: '#2c2824', accent: '#d9a55b',
};

const meta = (html, name) =>
  html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1];

const out = path.join(VIZ_SRC, '_thumbs');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 880, height: 900 }, deviceScaleFactor: 2 });
for (const v of listViz()) {
  const file = path.join(VIZ_SRC, v.file);
  const html = fs.readFileSync(file, 'utf8');
  const selector = meta(html, 'viz:thumb') ?? 'canvas';
  const query = meta(html, 'viz:thumb-query') ?? '';
  await page.goto(pathToFileURL(file).href + query);
  await page.evaluate((site) => {
    const el = document.documentElement;
    for (const [k, val] of Object.entries(site)) el.style.setProperty(`--site-${k}`, val);
    el.dataset.embedded = '';
    el.dataset.theme = 'dark';
  }, SITE);
  await page.waitForTimeout(400);
  const target = (await page.$(selector)) ?? (await page.$('body'));
  const dest = path.join(out, `${v.id}.jpg`);
  await target.screenshot({ path: dest, type: 'jpeg', quality: 85 });
  console.log(`✓ ${path.relative(process.cwd(), dest)}`);
}
await browser.close();
