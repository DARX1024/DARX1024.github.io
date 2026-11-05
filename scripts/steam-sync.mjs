#!/usr/bin/env node
// 从 Steam 拉取游戏时长、成就、封面，写到 src/data/steam.json，供游戏墙使用。
// 由 .github/workflows/steam-sync.yml 每天跑一次；本地也可以手动跑：
//   STEAM_API_KEY=xxxx node scripts/steam-sync.mjs
//
// - 没有 STEAM_API_KEY：只补全 src/content/games/ 里建档游戏的名字和封面（商店接口不需要 Key），不报错
// - SteamID：环境变量 STEAM_ID（17 位数字），否则从 src/site.config.ts 的 steamProfile 解析
// - 数据和上次一样时不改文件，避免每天产生空提交
// 不依赖任何 npm 包，Node 18+ 直接运行。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'src/data/steam.json');
const GAMES_DIR = path.join(ROOT, 'src/content/games');
const CDN = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const API = 'https://api.steampowered.com';
const KEY = process.env.STEAM_API_KEY?.trim();
const ACH_LIMIT = 300; // 最多查多少款游戏的成就（按时长从高到低），防止库特别大时请求太多

const log = (...a) => console.log('[steam]', ...a);

async function get(url, { allowFail = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': 'darx1024.github.io steam-sync' } }).catch((e) => e);
    if (res instanceof Response && res.ok) return res.json();
    const retry = !(res instanceof Response) || res.status === 429 || res.status >= 500;
    if (retry && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    if (allowFail) return null;
    const why = res instanceof Response ? `${res.status} ${res.statusText}` : res.message;
    throw new Error(`${url.replace(/key=[^&]+/, 'key=***')} → ${why}`);
  }
}

/** 并发执行，限制同时请求数 */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** 建档游戏的 appid：frontmatter 里的 steam: 1245620 或商店链接 */
function listedAppIds() {
  const ids = new Set();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name.startsWith('_')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.mdx?$/i.test(ent.name)) {
        const fm = fs.readFileSync(p, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
        const m = fm.match(/^steam:\s*['"]?(?:\S*\/app\/)?(\d+)/m);
        if (m) ids.add(Number(m[1]));
      }
    }
  };
  walk(GAMES_DIR);
  return ids;
}

async function steamId() {
  if (process.env.STEAM_ID?.trim()) return process.env.STEAM_ID.trim();
  const cfg = fs.readFileSync(path.join(ROOT, 'src/site.config.ts'), 'utf8');
  const url = cfg.match(/steamProfile:\s*['"]([^'"]+)['"]/)?.[1] ?? '';
  const direct = url.match(/\/profiles\/(\d{17})/)?.[1];
  if (direct) return direct;
  const vanity = url.match(/\/id\/([^/?#]+)/)?.[1];
  if (!vanity) throw new Error('找不到 SteamID：请设置 STEAM_ID，或在 site.config.ts 填写 steamProfile');
  const r = await get(`${API}/ISteamUser/ResolveVanityURL/v1/?key=${KEY}&vanityurl=${encodeURIComponent(vanity)}`);
  if (r?.response?.success !== 1) throw new Error(`无法解析 Steam 个人主页 ${url}`);
  return r.response.steamid;
}

/** 商店信息：中文名 + 竖版封面 / 横版头图的真实地址（新游戏的图片路径带哈希，不能直接拼） */
async function storeInfo(appids) {
  const info = new Map();
  for (let i = 0; i < appids.length; i += 50) {
    const ids = appids.slice(i, i + 50);
    const input = {
      ids: ids.map((appid) => ({ appid })),
      context: { language: 'schinese', country_code: 'US' },
      data_request: { include_assets: true },
    };
    const r = await get(`${API}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, {
      allowFail: true,
    });
    for (const it of r?.response?.store_items ?? []) {
      const a = it.assets ?? {};
      const url = (file) => (file && a.asset_url_format ? CDN + a.asset_url_format.replace('${FILENAME}', file) : undefined);
      info.set(it.appid ?? it.id, {
        name: it.name,
        cover: url(a.library_capsule ?? a.library_capsule_2x),
        header: url(a.header),
        hero: url(a.library_hero), // 横幅大图（3840×1240），游戏墙顶部和详情卡用
      });
    }
  }
  return info;
}

async function achievements(sid, appid) {
  const r = await get(`${API}/ISteamUserStats/GetPlayerAchievements/v1/?key=${KEY}&steamid=${sid}&appid=${appid}`, {
    allowFail: true, // 没有成就的游戏会返回 400
  });
  const list = r?.playerstats?.achievements;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return [list.filter((x) => x.achieved).length, list.length];
}

function readOld() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    return { games: [] };
  }
}

async function main() {
  const old = readOld();
  const oldById = new Map((old.games ?? []).map((g) => [g.appid, g]));
  const listed = listedAppIds();
  const games = new Map();

  if (KEY) {
    const sid = await steamId();
    log('SteamID', sid);
    const owned = await get(
      `${API}/IPlayerService/GetOwnedGames/v1/?key=${KEY}&steamid=${sid}&include_appinfo=1&include_played_free_games=1&skip_unvetted_apps=0`,
    );
    const list = owned?.response?.games ?? [];
    if (list.length === 0) {
      log('没有拿到游戏列表：请确认 Steam 隐私设置里「游戏详情」是公开的');
    }
    const recent = await get(`${API}/IPlayerService/GetRecentlyPlayedGames/v1/?key=${KEY}&steamid=${sid}`, { allowFail: true });
    const recentMin = new Map((recent?.response?.games ?? []).map((g) => [g.appid, g.playtime_2weeks]));
    for (const g of list) {
      games.set(g.appid, {
        appid: g.appid,
        name: g.name,
        minutes: g.playtime_forever || undefined,
        recent: recentMin.get(g.appid) || undefined,
        last: g.rtime_last_played || undefined,
      });
    }
    // 成就：建档的游戏 + 玩过的游戏里时长最高的一批
    const targets = [...games.values()]
      .filter((g) => listed.has(g.appid) || g.minutes)
      .sort((a, b) => Number(listed.has(b.appid)) - Number(listed.has(a.appid)) || (b.minutes ?? 0) - (a.minutes ?? 0))
      .slice(0, ACH_LIMIT);
    await pool(targets, 4, async (g) => {
      const ach = await achievements(sid, g.appid);
      if (ach) g.ach = ach;
    });
    log(`${list.length} 款游戏，${targets.filter((g) => g.ach).length} 款有成就数据`);
  } else {
    log('没有 STEAM_API_KEY：只更新建档游戏的名字和封面');
    for (const g of old.games ?? []) games.set(g.appid, { ...g });
  }

  // 建档但不在库里的（比如家庭共享、已退款、想玩的），也要有名字和封面
  for (const id of listed) if (!games.has(id)) games.set(id, { appid: id, name: oldById.get(id)?.name ?? String(id) });

  const info = await storeInfo([...games.keys()]);
  for (const g of games.values()) {
    const s = info.get(g.appid);
    const o = oldById.get(g.appid);
    // 商店接口偶尔失败：沿用上次的数据
    g.name = s?.name || g.name || o?.name;
    g.cover = s?.cover ?? o?.cover;
    g.header = s?.header ?? o?.header;
    g.hero = s?.hero ?? o?.hero;
  }

  const clean = [...games.values()]
    .map((g) => Object.fromEntries(Object.entries(g).filter(([, v]) => v !== undefined)))
    .sort((a, b) => a.appid - b.appid);
  if (JSON.stringify(clean) === JSON.stringify(old.games ?? [])) {
    log('数据没有变化');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const body = { updatedAt: new Date().toISOString(), games: clean };
  // 每款游戏一行：diff 好读
  const text = `{\n  "updatedAt": ${JSON.stringify(body.updatedAt)},\n  "games": [\n${clean.map((g) => '    ' + JSON.stringify(g)).join(',\n')}\n  ]\n}\n`;
  fs.writeFileSync(OUT, text);
  log(`已写入 ${path.relative(ROOT, OUT)}（${clean.length} 款）`);
}

main().catch((e) => {
  console.error('[steam] 同步失败：', e.message);
  process.exit(1);
});
