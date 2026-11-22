// 游戏墙的数据：把「你自己的记录」（src/content/games/*.md）和「Steam 自动同步的数据」
// （src/data/steam.json，由 scripts/steam-sync.mjs 生成）合成一张列表。
// steam.json 不存在（还没配 API Key）时照样能构建，只是没有时长和成就。
import { getCollection, type CollectionEntry } from 'astro:content';
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import { GAMES } from '../site.config';
import { getEssays, isVisible, titleOf } from './content';

export type GameEntry = CollectionEntry<'games'>;
export type Status = NonNullable<GameEntry['data']['status']>;

export const STATUS_LABEL: Record<Status, string> = {
  playing: '在玩',
  finished: '通关',
  shelved: '搁置',
  dropped: '弃坑',
  wishlist: '想玩',
};

interface SteamGame {
  appid: number;
  name: string;
  minutes?: number; // 总时长（分钟）
  recent?: number; // 最近两周的时长（分钟）
  last?: number; // 最后游玩时间（Unix 秒）
  ach?: [number, number]; // [已解锁, 总数]
  cover?: string; // 竖版封面（600×900）
  header?: string; // 横版头图，竖版缺失时的后备
  hero?: string; // 横幅大图（3840×1240）
}
interface SteamData {
  updatedAt?: string;
  games?: SteamGame[];
}

// 用 glob 读取：文件不存在时得到空对象，而不是构建失败
const steamFile = Object.values(import.meta.glob<SteamData>('../data/steam.json', { eager: true, import: 'default' }))[0];
const steam: SteamData = steamFile ?? {};
const steamById = new Map((steam.games ?? []).map((g) => [g.appid, g]));
export const steamUpdatedAt = steam.updatedAt ? new Date(steam.updatedAt) : undefined;

const CDN = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';
const steamCover = (id: number) => `${CDN}/${id}/library_600x900.jpg`;
const steamHeader = (id: number) => `${CDN}/${id}/header.jpg`;
const steamHero = (id: number) => `${CDN}/${id}/library_hero.jpg`;

// attachments 等内容目录里的图片，供 cover: 封面.jpg 这种写法查找
const images = import.meta.glob<{ default: ImageMetadata }>('/src/content/**/*.{png,jpg,jpeg,webp,avif}');
async function localCover(name: string) {
  const want = name.replace(/^!?\[\[|\]\]$/g, '').split('|')[0].trim().toLowerCase();
  const key = Object.keys(images).find((k) => k.split('/').pop()!.toLowerCase() === want);
  if (!key) return undefined;
  const img = await getImage({ src: (await images[key]()).default, width: 480, format: 'webp' });
  return img.src;
}

export interface Game {
  key: string;
  /** 页面里的锚点 id：建档的用文件名，自动收录的用 app-<appid> */
  slug: string;
  appid?: number;
  /** 横幅大图（顶部焦点区和详情卡用） */
  hero?: string;
  last?: Date;
  title: string;
  status?: Status;
  rating?: number;
  description?: string;
  platform?: string;
  hours?: number;
  /** 成就 [已解锁, 总数] */
  ach?: [number, number];
  cover?: string;
  coverFallback?: string;
  /** 写了评测：站内链接；否则 Steam 游戏链到商店页 */
  href?: string;
  external?: boolean;
  entry?: GameEntry;
  /** 最近两周玩过 */
  recent: boolean;
  /** 用来排「最近」：最后游玩、通关、评测日期里最新的那个 */
  activity?: Date;
  finished?: Date;
}

const hasReview = (e: GameEntry) => (e.body ?? '').trim().length > 0;
const toHours = (min?: number) => (min == null ? undefined : min / 60);
const maxDate = (...ds: (Date | undefined)[]) => {
  const t = Math.max(...ds.map((d) => d?.valueOf() ?? 0));
  return t ? new Date(t) : undefined;
};

let cache: Promise<Game[]> | undefined;
export function getGames() {
  return (cache ??= load());
}

async function load(): Promise<Game[]> {
  const all = await getCollection('games');
  const hiddenIds = new Set(all.filter((e) => !isVisible(e) && e.data.steam).map((e) => e.data.steam!));
  const entries = all.filter(isVisible);
  const listed = new Set(entries.map((e) => e.data.steam).filter(Boolean));

  const fromEntries = await Promise.all(
    entries.map(async (e): Promise<Game> => {
      const d = e.data;
      const s = d.steam ? steamById.get(d.steam) : undefined;
      const local = d.cover && !/^https?:/.test(d.cover) ? await localCover(d.cover) : undefined;
      const last = s?.last ? new Date(s.last * 1000) : undefined;
      return {
        key: `e:${e.id}`,
        slug: e.id,
        appid: d.steam,
        hero: d.steam ? s?.hero ?? steamHero(d.steam) : undefined,
        last,
        title: titleOf(e),
        status: d.status ?? (s?.recent ? 'playing' : undefined),
        rating: d.rating,
        description: d.description,
        platform: d.platform ?? (d.steam ? 'Steam' : undefined),
        hours: d.hours ?? toHours(s?.minutes),
        ach: s?.ach,
        cover: local ?? (d.cover && /^https?:/.test(d.cover) ? d.cover : d.steam ? s?.cover ?? steamCover(d.steam) : undefined),
        coverFallback: d.steam && !d.cover ? s?.header ?? steamHeader(d.steam) : undefined,
        href: hasReview(e) ? `/games/${e.id}/` : d.steam ? `https://store.steampowered.com/app/${d.steam}/` : undefined,
        external: !hasReview(e) && !!d.steam,
        entry: e,
        recent: !!s?.recent,
        activity: maxDate(last, d.finished, d.date, d.updated, d.started),
        finished: d.finished,
      };
    }),
  );

  // 没建档、但在 Steam 上玩得够久的游戏，也自动上墙
  const min = GAMES.libraryMinHours;
  const hide = new Set(GAMES.hide);
  const fromLibrary: Game[] =
    min === false
      ? []
      : (steam.games ?? [])
          .filter((g) => !listed.has(g.appid) && !hiddenIds.has(g.appid) && !hide.has(g.appid) && (g.minutes ?? 0) >= min * 60)
          .map((g) => ({
            key: `s:${g.appid}`,
            slug: `app-${g.appid}`,
            appid: g.appid,
            hero: g.hero ?? steamHero(g.appid),
            last: g.last ? new Date(g.last * 1000) : undefined,
            title: g.name,
            status: g.recent ? ('playing' as const) : undefined,
            platform: 'Steam',
            hours: toHours(g.minutes),
            ach: g.ach,
            cover: g.cover ?? steamCover(g.appid),
            coverFallback: g.header ?? steamHeader(g.appid),
            href: `https://store.steampowered.com/app/${g.appid}/`,
            external: true,
            recent: !!g.recent,
            activity: g.last ? new Date(g.last * 1000) : undefined,
          }));

  return [...fromEntries, ...fromLibrary].sort(
    (a, b) => (b.activity?.valueOf() ?? 0) - (a.activity?.valueOf() ?? 0) || (b.hours ?? 0) - (a.hours ?? 0),
  );
}

/** 有评测的游戏，按评测日期倒序 */
export async function getReviews() {
  return (await getGames())
    .filter((g) => g.entry && hasReview(g.entry))
    .sort((a, b) => (b.entry!.data.date?.valueOf() ?? 0) - (a.entry!.data.date?.valueOf() ?? 0));
}

/** 生活区有没有内容（没有就先不放进导航） */
export async function hasLife() {
  const [essays, games] = await Promise.all([getEssays(), getGames()]);
  return essays.length > 0 || games.length > 0;
}

export const fmtHours = (h?: number) =>
  h == null ? '' : h < 1 ? '不到 1 小时' : `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h).toLocaleString('en-US')} 小时`;


// ---------- Steam 评测（生活页的评测墙） ----------
// src/data/steam-reviews.json 由 scripts/steam-reviews.mjs 抓取；展示哪几篇在 site.config.ts 的 GAMES.reviewWall 里挑

interface SteamReview {
  appid: number;
  name?: string;
  up: boolean; // 推荐 / 不推荐
  hours?: number; // 现在的总时长
  atReview?: number; // 写评测时的时长
  posted?: string; // YYYY-MM-DD
  updated?: string;
  helpful?: number;
  funny?: number;
  url: string;
  text: string;
}
const reviewsFile = Object.values(
  import.meta.glob<{ reviews?: SteamReview[] }>('../data/steam-reviews.json', { eager: true, import: 'default' }),
)[0];
const steamReviews = new Map((reviewsFile?.reviews ?? []).map((r) => [r.appid, r]));

export interface WallReview {
  appid: number;
  title: string;
  up: boolean;
  /** 评测自己的标题（原文第一行是短标题时） */
  headline?: string;
  /** 原文里「2025.7.8 全成就纪念」这种落款的后半句 */
  memo?: string;
  /** 卡片上的摘句 */
  quote: string;
  /** 正文还有没展示的部分 */
  more: boolean;
  hours?: number;
  posted?: Date;
  helpful?: number;
  url: string;
  hero?: string;
  header?: string;
  cover?: string;
  /** 站内有没有这款游戏（有就能在游戏墙打开详情） */
  slug?: string;
}

/** 拆出原文开头的短标题和「日期 + 纪念」落款，剩下的是正文 */
function splitReview(text: string) {
  const lines = text.split('\n');
  let headline: string | undefined;
  let memo: string | undefined;
  for (let k = 0; k < 3 && lines.length; k++) {
    const l = lines[0].trim();
    const date = l.match(/^\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?\s*(.*)$/);
    if (!l || /^[—–\-_=]{3,}$/.test(l)) lines.shift();
    else if (date) {
      memo = date[1].trim() || undefined;
      lines.shift();
    } else if (!headline && k === 0 && l.length <= 24 && !/[。！]$/.test(l)) {
      headline = l.replace(/^【(.*)】$/, '$1');
      lines.shift();
    } else break;
  }
  return { headline, memo, body: lines.join('\n').trim() };
}

/** 从正文开头取一段做摘句：尽量在句末断开 */
function excerpt(text: string, max = 150) {
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  let out = '';
  for (const p of paras) {
    if (!out) out = p;
    else if (out.length + p.length < max * 0.8) out += ' ' + p;
    else break;
  }
  if (out.length <= max) return out;
  const cut = out.slice(0, max);
  const end = Math.max(...['。', '！', '？', '…', '.', '!', '?'].map((c) => cut.lastIndexOf(c)));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/[，、,;；：:\s]*$/, '') + '……';
}

export async function getReviewWall(): Promise<WallReview[]> {
  const games = await getGames();
  const byApp = new Map(games.filter((g) => g.appid).map((g) => [g.appid!, g]));
  return GAMES.reviewWall
    .map(({ appid, quote }): WallReview | undefined => {
      const r = steamReviews.get(appid);
      if (!r || !r.text) return undefined;
      const g = byApp.get(appid);
      const s = steamById.get(appid);
      const { headline, memo, body } = splitReview(r.text);
      const q = quote?.trim() || excerpt(body);
      return {
        appid,
        title: g?.title ?? s?.name ?? r.name ?? String(appid),
        up: r.up,
        headline,
        memo,
        quote: q,
        more: body.replace(/\s+/g, '').length > q.replace(/\s+|……$/g, '').length + 4,
        hours: r.hours ?? toHours(s?.minutes),
        posted: r.posted ? new Date(r.posted) : undefined,
        helpful: r.helpful,
        url: r.url,
        hero: g?.hero ?? s?.hero ?? steamHero(appid),
        header: s?.header ?? steamHeader(appid),
        cover: g?.cover ?? s?.cover ?? steamCover(appid),
        slug: g?.slug,
      };
    })
    .filter((r): r is WallReview => !!r)
    .sort((a, b) => (b.posted?.valueOf() ?? 0) - (a.posted?.valueOf() ?? 0));
}
