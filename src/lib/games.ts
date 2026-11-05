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
  const fromLibrary: Game[] =
    min === false
      ? []
      : (steam.games ?? [])
          .filter((g) => !listed.has(g.appid) && !hiddenIds.has(g.appid) && (g.minutes ?? 0) >= min * 60)
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

