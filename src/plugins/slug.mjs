// 统一的 slug 规则：内容集合的 id、双链解析、标题锚点都用它，保证三者一致。
import { slug as githubSlug } from 'github-slugger';

/**
 * 把内容文件的相对路径转成 URL id。每段路径都会 slug 化（中文保留）。
 * frontmatter 里写了 slug 时，只替换最后一段（文件名），文件夹（= 笔记系列）保持不变：
 *   notes/mit-6003/01 信号与系统概述.md + slug: intro → mit-6003/intro
 */
export function entryId(relPath, data = {}) {
  const segs = relPath.replace(/\.(md|mdx)$/i, '').split(/[\\/]/).map((seg) => githubSlug(seg));
  if (typeof data.slug === 'string' && data.slug.trim()) {
    segs[segs.length - 1] = data.slug.trim().replace(/^\/+|\/+$/g, '');
  }
  return segs.join('/').replace(/(^|\/)index$/, '');
}

/** 标题锚点，和 Astro 给 h1–h6 生成 id 的规则一致（github-slugger）。 */
export const headingSlug = (text) => githubSlug(text);
