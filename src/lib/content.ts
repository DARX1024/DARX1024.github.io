import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;
export type Note = CollectionEntry<'notes'>;

/** dev 下显示草稿（带「草稿」标记）方便预览；build 时只保留 publish: true */
export const isVisible = (e: { data: { publish: boolean } }) => e.data.publish || import.meta.env.DEV;

export const titleOf = (e: { id: string; data: { title?: string }; filePath?: string }) =>
  e.data.title ?? e.filePath?.split('/').pop()?.replace(/\.(md|mdx)$/i, '') ?? e.id;

const byDateDesc = (a: { data: { date?: Date } }, b: { data: { date?: Date } }) =>
  (b.data.date?.valueOf() ?? 0) - (a.data.date?.valueOf() ?? 0);

export async function getPosts() {
  return (await getCollection('blog', isVisible)).sort(byDateDesc);
}

/** 笔记的系列 = notes/ 下第一层文件夹；直接放在 notes/ 根下的是独立笔记 */
export const seriesIdOf = (n: Note) => (n.id.includes('/') ? n.id.split('/')[0] : undefined);

const noteOrder = (a: Note, b: Note) =>
  (a.data.order ?? Infinity) - (b.data.order ?? Infinity) ||
  (a.filePath ?? a.id).localeCompare(b.filePath ?? b.id, 'zh-CN', { numeric: true });

export async function getNotes() {
  return (await getCollection('notes', isVisible)).sort(noteOrder);
}

export interface Series {
  id: string;
  title: string;
  description?: string;
  url?: string;
  notes: Note[];
  updated?: Date;
}

export async function getSeries(): Promise<Series[]> {
  const [notes, meta] = await Promise.all([getNotes(), getCollection('series')]);
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const s = seriesIdOf(n);
    if (s) groups.set(s, [...(groups.get(s) ?? []), n]);
  }
  return [...groups].map(([id, list]) => {
    const m = meta.find((x) => x.id === id)?.data;
    const dates = list.map((n) => (n.data.updated ?? n.data.date)?.valueOf() ?? 0);
    const latest = Math.max(...dates);
    return { id, title: m?.title ?? id, description: m?.description, url: m?.url, notes: list, updated: latest ? new Date(latest) : undefined };
  });
}

/** 中文按字、英文按词估算阅读时间（约 400 字/分钟，200 词/分钟） */
export function readingMinutes(body = '') {
  const text = body.replace(/```[\s\S]*?```/g, '').replace(/\$\$[\s\S]*?\$\$/g, '');
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const words = (text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9]+/g) ?? []).length;
  return Math.max(1, Math.round(cjk / 400 + words / 200));
}

export const fmtDate = (d?: Date) => (d ? d.toISOString().slice(0, 10) : '');
export const fmtDateLong = (d?: Date) =>
  d ? `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日` : '';
