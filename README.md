# DARX1024.github.io

个人学术网站：博客、课程/论文笔记、交互可视化。基于 [Astro](https://astro.build) 7，静态生成，部署在 GitHub Pages。

- 没有 React/Vue 等 UI 框架，页面零框架 JS（只有主题切换、目录高亮、iframe 自适应三段小脚本）
- KaTeX 公式（构建时渲染，浏览器端不跑 JS）、Shiki 代码高亮（亮/暗双主题）
- 兼容 Obsidian：`[[双链]]`、callout、`![[图片]]`、`==高亮==`、`%%注释%%`
- 这里只放**整理好的成品**。草稿和碎片想法留在私有的笔记仓库，整理润色后再复制过来
- 放进来的文章默认发布；想暂时藏起来就在 frontmatter 写 `publish: false`

## 常用命令

需要 Node.js 22 以上。

```bash
npm install        # 第一次
npm run dev        # 本地预览 http://localhost:4321 ，改文件自动刷新
npm run build      # 构建到 dist/
npm run preview    # 预览构建结果
npm run thumbs     # 给 viz-raw/ 里的可视化生成缩略图（需要 Playwright，见下文）
```

推送到 `main` 分支后，GitHub Actions 会自动构建并发布。

## 目录结构

```
src/content/
  blog/                 博客长文，一个 .md / .mdx 一篇
  notes/                笔记
    signals-and-systems/  一个文件夹 = 一个系列
  attachments/          图片附件
  pages/about.md        关于页
  series.yaml           系列的标题、简介、课程链接
viz-raw/                独立的交互可视化 HTML
  _thumbs/              npm run thumbs 生成的缩略图（要一起提交）
src/site.config.ts      站点名、简介、导航、GitHub 链接
src/styles/             全局样式（global.css）和正文排版（prose.css）
src/plugins/            Obsidian 语法、可视化处理的插件
```

## 发布一篇文章

1. 在私有笔记仓库里整理好，把 `.md` 复制到 `src/content/notes/<系列>/` 或 `src/content/blog/`
2. 用到的交互页放进 `viz-raw/`，图片放进 `src/content/attachments/`
3. 新的交互页跑一次 `npm run thumbs`
4. `npm run dev` 看一眼，没问题就提交推送

文件名或标题以下划线开头的文件、文件夹不会发布，可以放临时内容。

### Frontmatter

```yaml
---
title: 卷积与线性时不变系统   # 可省略，省略时用文件名
description: 一句话简介        # 可选，会出现在列表和 <meta> 里
date: 2026-10-27
updated: 2026-11-02           # 可选
tags: [signals, convolution]
slug: convolution             # 可选，自定义 URL 的最后一段
order: 2                      # 仅笔记：系列内排序，省略时按文件名排
toc: false                    # 可选，关掉右侧目录
aliases: [别名]                # 可选，[[别名]] 也能链接到这里
publish: false                # 可选，默认发布；写 false 暂时隐藏
---
```

URL 规则：`blog/xxx.md → /blog/xxx/`，`notes/signals-and-systems/02 卷积.md → /notes/signals-and-systems/02-卷积/`。中文文件名可以直接用，想要英文 URL 就写 `slug`。

### 笔记系列

`notes/` 下的每个文件夹自动成为一个系列，有自己的目录页和上一篇/下一篇导航。系列标题写在 `src/content/series.yaml`，键名是文件夹名转成小写、空格换成 `-` 后的结果。直接放在 `notes/` 根下的是独立笔记。

### Obsidian 语法

| 写法 | 效果 |
| --- | --- |
| `[[笔记名]]` `[[笔记名\|显示文字]]` `[[笔记名#小标题]]` | 站内链接。可以用文件名、`title` 或 `aliases` 引用 |
| `[[站里没有的笔记]]` | 显示为灰色文字，不会产生死链（私有仓库里的链接可以原样保留） |
| `![[图.png]]` `![[图.png\|400]]` | 图片（会自动压缩优化），`\|400` 设宽度 |
| `![[envelope-lab.html]]` | 嵌入 `viz-raw/` 里的可视化（需独占一段），高度自适应 |
| `![[envelope-lab.html\|480]]` | 指定嵌入高度为 480px |
| `![[envelope-lab.html\|图注文字]]` | 自定义图注（默认用可视化的标题） |
| `![[envelope-lab.html?lab=A]]` | 问号后的参数原样传给可视化，比如只显示其中一个实验 |
| `> [!note] 标题` | callout；`[!tip]-` 默认折叠，`[!tip]+` 默认展开 |
| `> [!theorem]` `[!definition]` `[!proof]` | 数学用 callout，证明末尾自动加 ∎ |
| `==高亮==` | `<mark>` |
| `%%注释%%` | 不输出（仅支持同一段内） |
| `$...$` `$$...$$` | KaTeX 公式 |

不支持：笔记嵌入（`![[另一篇笔记]]` 会变成链接）、PDF 嵌入、Dataview。

### 在 MDX 里

`.mdx` 文件可以直接用组件：

```mdx
<Viz name="envelope-lab" height={480} caption="包络实验" />
```

## 交互可视化

把 HTML 文件放进 `viz-raw/` 即可：

- `viz-raw/foo.html` 或 `viz-raw/foo/index.html`（后者可以带自己的 js/css/数据文件）
- 不要引用 Google Fonts 等外部字体，直接用系统字体栈
- 自动出现在 `/viz/` 图库里，浏览页是 `/viz/foo/`，原始页面是 `/viz-raw/foo.html`
- 下划线开头的文件/文件夹（如 `viz-raw/_shared/`）只复制、不进图库，适合放公共脚本

图库的标题、简介来自 HTML 本身：

```html
<title>复指数包络实验</title>
<meta name="description" content="拖动滑块……">
<meta name="viz:date" content="2026-11-03">       <!-- 可选，默认用文件修改时间 -->
<meta name="viz:tags" content="信号与系统, 复指数"> <!-- 可选 -->
<meta name="viz:height" content="480">            <!-- 可选，固定嵌入高度 -->
<meta name="viz:thumb" content="#A .figs">        <!-- 可选，缩略图截哪一块（CSS 选择器），默认第一个 canvas -->
<meta name="viz:thumb-query" content="?lab=A">    <!-- 可选，截图时附带的参数 -->
```

### 缩略图

首页和图库的卡片用 `viz-raw/_thumbs/<名字>-light.png` 和 `<名字>-dark.png`（透明底线稿，跟随主题切换），没有就显示文字封面。
截图时会把可视化里的 `--vec` `--re` `--env` `--im` 这几个数据色收成站点的前景色 + 强调色，和首页地球仪保持同一种线稿风格；
自己的可视化如果用了别的颜色变量名，在 `scripts/viz-thumbs.mjs` 的 `inkOf` 里加上即可。生成方法：

```bash
npm i -D playwright && npx playwright install chromium   # 只需一次
npm run thumbs
```

### 让可视化和站点融为一体

嵌入时，站点会在 iframe 的 `<html>` 上设置：

- `data-embedded`：表示正在被嵌入，可以用来隐藏页面自带的大标题
- `data-theme="light|dark"`：当前主题，用户切换时会同步更新
- `--site-bg` `--site-bg-soft` `--site-fg` `--site-fg-soft` `--site-muted` `--site-border` `--site-accent` `--site-font-body` `--site-font-heading` `--site-font-mono`：站点配色和字体

在可视化里把自己的变量映射过去就行（参考 `viz-raw/envelope-lab.html`）：

```css
:root[data-embedded] {
  --bg: var(--site-bg);
  --ink: var(--site-fg);
  --accent: var(--site-accent);
}
:root[data-embedded] header > h1 { display: none; }
```

用 canvas 画图的，颜色变了需要重画，可以监听 `<html>` 的属性变化：

```js
new MutationObserver(redraw).observe(document.documentElement, {
  attributes: true, attributeFilter: ['data-theme', 'data-embedded', 'style'],
});
```

iframe 高度会根据内容自动调整，不需要做什么。以上都是可选的，不写也能正常嵌入。

## 排版说明

- 默认暗色（暖棕黑 + 琥珀），右上角可切换亮色，选择会被记住
- 字体只用系统字体：正文西文 → 系统无衬线（SF / Segoe UI），中文 → 苹方 / 微软雅黑 / 思源黑体；标题西文用系统衬线。不加载任何 webfont（KaTeX 的数学字体除外，按需加载）
- 想要衬线正文：把 `src/styles/global.css` 里的 `--font-body` 改成 `var(--font-serif)`
- 中西文间距交给浏览器的 `text-autospace`（新版 Chrome/Safari 支持），源文件里不需要手动加空格
- 中文强调 `*文字*` 显示为着重号（文字下加点），而不是机械倾斜的伪斜体
- 颜色、行宽等都在 `global.css` 顶部的变量里

## 部署

1. 把本项目推到公开仓库 `DARX1024.github.io`
2. 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**
3. 之后每次推送到 `main`，`.github/workflows/deploy.yml` 会自动构建发布到 https://darx1024.github.io

## 小提示

- 改了 `src/plugins/` 里的插件后如果页面没变，删掉缓存：`rm -rf node_modules/.astro .astro`
- Astro 7 默认的 Markdown 处理器是 Sätteri；本站在 `astro.config.mjs` 里显式改用 unified（remark/rehype），以便使用 KaTeX 和 Obsidian 插件
