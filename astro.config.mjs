// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkObsidian from './src/plugins/remark-obsidian.mjs';
import remarkCallout from './src/plugins/remark-callout.mjs';
import { vizIntegration } from './src/plugins/viz.mjs';

export default defineConfig({
  // 用户站点仓库 <用户名>.github.io 部署在根路径，不需要 base
  site: 'https://darx1024.github.io',
  trailingSlash: 'ignore',
  integrations: [vizIntegration(), mdx()],
  markdown: {
    // Astro 7 默认的 Sätteri 处理器不跑 remark/rehype 插件；
    // 这里显式使用 unified，以便复用 remark-math / rehype-katex 和自写的 Obsidian 插件。
    // .md 和 .mdx 共用这一套。
    processor: unified({
      remarkPlugins: [remarkMath, remarkCallout, remarkObsidian],
      rehypePlugins: [[rehypeKatex, { strict: false, throwOnError: false }]],
      remarkRehype: { footnoteLabel: '脚注', footnoteBackLabel: '回到正文' },
    }),
    shikiConfig: {
      // 亮/暗两套主题同时输出，CSS 根据 data-theme 切换，无需 JS 重新高亮
      themes: { light: 'github-light', dark: 'github-dark-dimmed' },
      defaultColor: false,
      wrap: false,
    },
  },
});
