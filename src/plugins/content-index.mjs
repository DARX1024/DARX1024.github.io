// 扫描 src/content，建立「笔记名 → URL」和「附件名 → 文件路径」两张索引，
// 供 remark-obsidian 解析 [[双链]] 和 ![[图片]]。
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { entryId } from './slug.mjs';

export const CONTENT_DIR = path.resolve('src/content');

/** 哪些文件夹会发布成页面，以及对应的 URL 前缀。 */
export const COLLECTIONS = { blog: '/blog/', notes: '/notes/' };

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const IGNORED_DIR = /^(\.|_|node_modules$)/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIR.test(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function readFrontmatter(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  try {
    return parseYaml(m[1]) ?? {};
  } catch {
    return {};
  }
}

/** 和 content.config.ts 一致：默认发布，publish: false 隐藏 */
export const isPublished = (data) => data.publish !== false;

let cache = null;
let cachedAt = 0;

export function getIndex() {
  // dev 时新建的笔记要能被立刻链接到，所以索引只缓存 1 秒
  if (cache && Date.now() - cachedAt < 1000) return cache;
  const notes = new Map(); // key(小写) -> { url, title }
  const files = new Map(); // 文件名(小写) -> 绝对路径[]

  for (const file of walk(CONTENT_DIR)) {
    const base = path.basename(file);
    if (!/\.(md|mdx)$/i.test(base)) {
      const k = base.toLowerCase();
      files.set(k, [...(files.get(k) ?? []), file]);
      continue;
    }
    const rel = path.relative(CONTENT_DIR, file);
    const [collection, ...rest] = rel.split(path.sep);
    if (!COLLECTIONS[collection] || rest.length === 0) continue;
    const data = readFrontmatter(file);
    if (!isPublished(data)) continue;

    const stem = base.replace(/\.(md|mdx)$/i, '');
    const target = {
      url: COLLECTIONS[collection] + entryId(rest.join('/'), data) + '/',
      title: data.title ?? stem,
    };
    const keys = [stem, rel.replace(/\.(md|mdx)$/i, ''), rest.join('/').replace(/\.(md|mdx)$/i, '')];
    if (data.title) keys.push(String(data.title));
    for (const a of [].concat(data.aliases ?? [])) keys.push(String(a));
    for (const k of keys) {
      const key = k.replaceAll('\\', '/').toLowerCase();
      if (!notes.has(key)) notes.set(key, target);
    }
  }
  cache = { notes, files };
  cachedAt = Date.now();
  return cache;
}
