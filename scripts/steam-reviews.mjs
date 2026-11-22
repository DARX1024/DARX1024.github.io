#!/usr/bin/env node
// 把你在 Steam 上写的评测抓下来，写到 src/data/steam-reviews.json，供生活页的「评测墙」使用。
// 和 steam-sync.mjs 一起由 .github/workflows/steam-sync.yml 每天跑一次；本地也可以手动跑：
//   node scripts/steam-reviews.mjs
//
// - 评测是公开的，不需要 API Key：直接读个人主页的「评测」页（/recommended/）
// - 个人主页从 src/site.config.ts 的 GAMES.steamProfile 读取
// - 某一篇这次没抓到（网络、页面改版）时沿用上次的数据；整页都抓不到时不改文件
// - 数据和上次一样时不改文件，避免每天产生空提交
// 不依赖任何 npm 包，Node 18+ 直接运行。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'src/data/steam-reviews.json');
const MAX_PAGES = 20; // 每页 10 篇

const log = (...a) => console.log('[reviews]', ...a);

async function getText(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; darx1024.github.io review-sync)', 'accept-language': 'en-US,en;q=0.8' },
    }).catch((e) => e);
    if (res instanceof Response && res.ok) return res.text();
    const retry = !(res instanceof Response) || res.status === 429 || res.status >= 500;
    if (retry && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    log(`${url} → ${res instanceof Response ? res.status : res.message}`);
    return null;
  }
}

function profileUrl() {
  const cfg = fs.readFileSync(path.join(ROOT, 'src/site.config.ts'), 'utf8');
  const url = cfg.match(/steamProfile:\s*['"]([^'"]+)['"]/)?.[1];
  if (!url) throw new Error('site.config.ts 里没有 GAMES.steamProfile');
  return url.replace(/\/?$/, '/');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });

/** 从 html 里取出 start 处开始的那个元素（按同名标签配对，能处理嵌套） */
function element(html, start) {
  const tag = html.slice(start).match(/^<([a-z0-9]+)/i)?.[1];
  if (!tag) return '';
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html)); ) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
}

/** 评测正文（BBCode 渲染出来的 HTML）→ 纯文本，段落之间空一行 */
function toText(html) {
  const inner = html.replace(/^<[^>]+>/, '').replace(/<\/[a-z0-9]+>$/i, '');
  const t = inner
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(div|p|blockquote|h\d|ul|ol|table|tr)>/gi, '\n')
    .replace(/<(div|p|blockquote|h\d|ul|ol|table|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decode(t)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "29 Jul, 2024 @ 8:12am" / "Jul 29, 2024 @ 8:12am" / "10 Jul @ 3:00pm"（今年的不写年份） */
function parseDate(s) {
  if (!s) return undefined;
  const mon = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
  const day = s.replace(mon?.[0] ?? '', '').match(/\b(\d{1,2})\b/);
  const year = s.match(/\b(\d{4})\b/);
  if (!mon || !day) return undefined;
  const y = year ? Number(year[1]) : new Date().getUTCFullYear();
  const d = new Date(Date.UTC(y, MONTHS.indexOf(mon[1].toLowerCase()), Number(day[1])));
  return d.toISOString().slice(0, 10);
}

const num = (s) => (s == null ? undefined : Number(String(s).replace(/,/g, '')));

/** 一篇评测的详情页 */
function parseReview(html, appid, url) {
  const at = html.search(/<div[^>]+id="ReviewText"/i);
  if (at < 0) return null;
  const text = toText(element(html, at));
  if (!text) return null;
  const summary = html.match(/class="ratingSummary"[^>]*>([^<]*)</i)?.[1]?.trim() ?? '';
  const dateBlock = html.match(/class="recommendation_date"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const [postedRaw, updatedRaw] = [
    dateBlock.match(/Posted:?\s*([^<]+)/i)?.[1],
    dateBlock.match(/Updated:?\s*([^<]+)/i)?.[1],
  ];
  const play = html.match(/class="playTime"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const title = html.match(/<div class="profile_small_header_location"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>\s*<\/div>/i)?.[1];
  const r = {
    appid,
    name: title ? decode(title.trim()) : undefined,
    up: !/not\s+recommended/i.test(summary),
    hours: num(play.match(/([\d,.]+)\s*hrs?\s+on record/i)?.[1]),
    atReview: num(play.match(/([\d,.]+)\s*hrs?\s+at review time/i)?.[1]),
    posted: parseDate(postedRaw),
    updated: parseDate(updatedRaw),
    helpful: num(html.match(/([\d,]+)\s+(?:people|person)\s+found this review helpful/i)?.[1]) || undefined,
    funny: num(html.match(/([\d,]+)\s+(?:people|person)\s+found this review funny/i)?.[1]) || undefined,
    url,
    text,
  };
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
}

function readOld() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    return { reviews: [] };
  }
}

async function main() {
  const base = profileUrl() + 'recommended/';
  const old = readOld();
  const oldById = new Map((old.reviews ?? []).map((r) => [r.appid, r]));

  // 1. 列表页：拿到所有评测的 appid
  const ids = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const html = await getText(`${base}?p=${p}&l=english`);
    if (html == null) {
      if (p === 1) {
        log('评测列表打不开，这次不更新');
        return;
      }
      break;
    }
    const found = [...html.matchAll(/\/recommended\/(\d+)\/?["?]/g)].map((m) => Number(m[1]));
    const fresh = [...new Set(found)].filter((id) => !ids.includes(id));
    if (fresh.length === 0) break;
    ids.push(...fresh);
  }
  if (ids.length === 0) {
    log('没有找到评测（个人资料不公开，或者页面结构变了），这次不更新');
    return;
  }
  log(`找到 ${ids.length} 篇评测`);

  // 2. 逐篇读详情页
  const reviews = [];
  let kept = 0;
  for (const appid of ids) {
    const url = `${base}${appid}/`;
    const html = await getText(`${url}?l=english`);
    const r = html && parseReview(html, appid, url);
    if (r) reviews.push(r);
    else if (oldById.has(appid)) {
      reviews.push(oldById.get(appid));
      kept++;
    } else log(`${appid}：没读到正文，跳过`);
    await new Promise((res) => setTimeout(res, 400));
  }
  if (kept) log(`${kept} 篇沿用上次的数据`);

  reviews.sort((a, b) => (b.posted ?? '').localeCompare(a.posted ?? '') || a.appid - b.appid);
  if (JSON.stringify(reviews) === JSON.stringify(old.reviews ?? [])) {
    log('数据没有变化');
    return;
  }
  const body = { updatedAt: new Date().toISOString(), reviews };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(body, null, 2) + '\n');
  log(`已写入 ${path.relative(ROOT, OUT)}（${reviews.length} 篇）`);
}

main().catch((e) => {
  // 评测只是锦上添花：失败不影响游戏数据的同步
  console.error('[reviews] 同步失败：', e.message);
});
