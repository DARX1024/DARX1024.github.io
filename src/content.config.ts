import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';
import { entryId } from './plugins/slug.mjs';
import { vizLoader } from './plugins/viz.mjs';

// Obsidian 写的 frontmatter 往往不太规整：tags 可能是字符串，日期可能带时间。这里都宽容处理。
const tags = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v == null ? [] : Array.isArray(v) ? v : v.split(/[,，\s]+/).filter(Boolean)));

// Obsidian 的属性面板里留空的字段会写成 `key:`（null）。当作没写处理，否则日期会变成 1970 年、字符串字段会报错
const blank = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === null || v === '' ? undefined : v), s);

const base = {
  title: blank(z.string().optional()), // 不写就用文件名
  description: blank(z.string().optional()),
  date: blank(z.coerce.date().optional()),
  updated: blank(z.coerce.date().optional()),
  tags,
  publish: z.boolean().default(true), // 网站只做展示：默认发布，写 publish: false 可临时隐藏
  toc: z.boolean().default(true),
};

// 下划线开头的文件/文件夹（比如 _templates）不会被读取
const pattern = ['**/*.{md,mdx}', '!**/_*', '!**/_*/**'];
const generateId = ({ entry, data }: { entry: string; data: Record<string, unknown> }) => entryId(entry, data);

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern, generateId }),
  schema: z.object(base),
});

const notes = defineCollection({
  loader: glob({ base: './src/content/notes', pattern, generateId }),
  schema: z.object({
    ...base,
    order: z.number().optional(), // 系列内排序；不写则按文件名
    lecture: z.union([z.number(), z.string()]).optional(), // 对应课程第几讲
    course: z.string().optional(),
    textbook: z.string().optional(), // 教材章节
  }),
});

// 笔记系列的元数据：id 对应 notes/ 下的文件夹（slug 化之后）
const series = defineCollection({
  loader: file('./src/content/series.yaml'),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    url: z.string().optional(), // 课程主页等
  }),
});

const viz = defineCollection({
  loader: vizLoader(),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    height: z.number().optional(),
    thumb: z.string().optional(),
    thumbLight: z.string().optional(),
    file: z.string(),
  }),
});

// 生活区的随笔：和博客一样，一个 .md 一篇
const life = defineCollection({
  loader: glob({ base: './src/content/life', pattern, generateId }),
  schema: z.object(base),
});

// 游戏：一个 .md = 游戏墙上的一款游戏。frontmatter 是你自己的记录，正文写了就是评测（不写只上墙）。
// Steam 上的时长、成就、封面由 scripts/steam-sync.mjs 拉取，见 lib/games.ts。
const STATUS: Record<string, 'playing' | 'finished' | 'shelved' | 'dropped' | 'wishlist'> = {
  在玩: 'playing', playing: 'playing',
  通关: 'finished', 已通关: 'finished', finished: 'finished', completed: 'finished', beaten: 'finished',
  搁置: 'shelved', shelved: 'shelved', paused: 'shelved',
  弃坑: 'dropped', dropped: 'dropped', abandoned: 'dropped',
  想玩: 'wishlist', wishlist: 'wishlist', backlog: 'wishlist',
};
const games = defineCollection({
  loader: glob({ base: './src/content/games', pattern, generateId }),
  schema: z.object({
    ...base,
    // Steam appid，也可以直接粘贴商店链接 https://store.steampowered.com/app/1245620/...
    steam: blank(
      z
        .union([z.number(), z.string()])
        .optional()
        .transform((v) => {
          const m = v == null ? null : String(v).match(/\/app\/(\d+)/) ?? String(v).match(/^\s*(\d+)\s*$/);
          return m ? Number(m[1]) : undefined;
        }),
    ),
    platform: blank(z.string().optional()), // 非 Steam 游戏写 Switch / PS5 / iOS 等
    status: blank(
      z
        .string()
        .optional()
        .transform((v) => (v ? STATUS[v.trim().toLowerCase()] ?? STATUS[v.trim()] : undefined)),
    ),
    rating: blank(z.coerce.number().min(0).max(10).optional()), // 10 分制
    started: blank(z.coerce.date().optional()),
    finished: blank(z.coerce.date().optional()), // 通关日期
    hours: blank(z.coerce.number().optional()), // 手动填写的时长；Steam 游戏不用填
    cover: blank(z.string().optional()), // 封面：图片链接，或 attachments/ 里的文件名（也可以写 [[封面.jpg]]）
  }),
});

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '*.{md,mdx}' }),
  schema: z.object({ title: z.string(), description: z.string().optional() }),
});

export const collections = { blog, notes, series, viz, life, games, pages };
