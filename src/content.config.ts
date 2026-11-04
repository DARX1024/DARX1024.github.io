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

const base = {
  title: z.string().optional(), // 不写就用文件名
  description: z.string().optional(),
  date: z.coerce.date().optional(),
  updated: z.coerce.date().optional(),
  tags,
  publish: z.boolean().default(false), // 只有 publish: true 才会出现在构建产物里
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
    file: z.string(),
  }),
});

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '*.{md,mdx}' }),
  schema: z.object({ title: z.string(), description: z.string().optional() }),
});

export const collections = { blog, notes, series, viz, pages };
