# DARX1024.github.io

个人学术网站：博客、课程/论文笔记、交互可视化。基于 [Astro](https://astro.build) 7，静态生成，部署在 GitHub Pages。

- 没有 React/Vue 等 UI 框架，页面零框架 JS（只有主题切换、目录高亮、iframe 自适应三段小脚本）
- KaTeX 公式（构建时渲染，浏览器端不跑 JS）、Shiki 代码高亮（亮/暗双主题）
- 兼容 Obsidian：`[[双链]]`、callout、`![[图片]]`、`==高亮==`、`%%注释%%`
- 只有 frontmatter 里 `publish: true` 的文章才会被构建

## 常用命令

需要 Node.js 22 以上。

```bash
npm install        # 第一次
npm run dev        # 本地预览 http://localhost:4321 ，改文件自动刷新；草稿也会显示（带「草稿」标记）
npm run build      # 构建到 dist/，只包含 publish: true 的内容
npm run preview    # 预览构建结果
```

推送到 `main` 分支后，GitHub Actions 会自动构建并发布。

## 目录结构

```
src/content/            ← 用 Obsidian 打开这个文件夹作为 vault
  blog/                 博客长文，一个 .md / .mdx 一篇
  notes/                笔记
    mit-6003/           一个文件夹 = 一个系列
  attachments/          图片附件（Obsidian 已配置为默认放这里）
  pages/about.md        关于页
  series.yaml           系列的标题和简介
  _templates/           Obsidian 模板（下划线开头的文件夹不会发布）
viz-raw/                独立的交互可视化 HTML
src/site.config.ts      站点名、简介、导航、GitHub 链接
src/styles/             全局样式（global.css）和正文排版（prose.css）
src/plugins/            Obsidian 语法、可视化处理的插件
```

## 写作

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
publish: true                 # 不写或 false 都不会发布
---
```

URL 规则：`blog/xxx.md → /blog/xxx/`，`notes/mit-6003/02 卷积.md → /notes/mit-6003/02-卷积/`。中文文件名可以直接用，想要英文 URL 就写 `slug`。

### 笔记系列

`notes/` 下的每个文件夹自动成为一个系列，有自己的目录页和上一篇/下一篇导航。系列标题写在 `src/content/series.yaml`，键名是文件夹名转成小写、空格换成 `-` 后的结果。直接放在 `notes/` 根下的是独立笔记。

### Obsidian 语法

| 写法 | 效果 |
| --- | --- |
| `[[笔记名]]` `[[笔记名\|显示文字]]` `[[笔记名#小标题]]` | 站内链接。可以用文件名、`title` 或 `aliases` 引用 |
| `[[还没发布的笔记]]` | 显示为灰色文字，不会产生死链 |
| `![[图.png]]` `![[图.png\|400]]` | 图片（会自动压缩优化），`\|400` 设宽度 |
| `![[fourier-series.html]]` | 嵌入 `viz-raw/` 里的可视化（需独占一段） |
| `![[fourier-series.html\|480]]` | 指定嵌入高度为 480px（默认自适应） |
| `> [!note] 标题` | callout；`[!tip]-` 默认折叠，`[!tip]+` 默认展开 |
| `> [!theorem]` `[!definition]` `[!proof]` | 数学用 callout，证明末尾自动加 ∎ |
| `==高亮==` | `<mark>` |
| `%%注释%%` | 不输出（仅支持同一段内） |
| `$...$` `$$...$$` | KaTeX 公式 |

不支持：笔记嵌入（`![[另一篇笔记]]` 会变成链接）、PDF 嵌入、Dataview。

### 在 MDX 里

`.mdx` 文件可以直接用组件：

```mdx
<Viz name="fourier-series" height={480} caption="方波的部分和" />
```

## 交互可视化

把 HTML 文件放进 `viz-raw/` 即可：

- `viz-raw/foo.html` 或 `viz-raw/foo/index.html`（后者可以带自己的 js/css/数据文件）
- 自动出现在 `/viz/` 图库里，浏览页是 `/viz/foo/`，原始页面是 `/viz-raw/foo.html`
- 下划线开头的文件/文件夹（如 `viz-raw/_shared/`）只复制、不进图库，适合放公共脚本

图库的标题、简介来自 HTML 本身：

```html
<title>方波的傅里叶级数</title>
<meta name="description" content="拖动滑块……">
<meta name="viz:date" content="2026-10-27">      <!-- 可选，默认用文件修改时间 -->
<meta name="viz:tags" content="信号与系统, 傅里叶"> <!-- 可选 -->
<meta name="viz:height" content="480">           <!-- 可选，固定嵌入高度 -->
```

嵌入时站点会给 iframe 里的 `<html>` 设置 `data-theme="light|dark"`，可视化想跟随站点暗色模式，就写 `:root[data-theme="dark"] { … }`（参考 `viz-raw/` 里的两个示例），不写也不影响使用。

## 排版说明

- 字体只用系统字体：西文 → 系统无衬线（SF / Segoe UI），中文 → 苹方 / 微软雅黑 / 思源黑体。不加载任何 webfont（KaTeX 的数学字体除外，按需加载）
- 想要衬线正文：把 `src/styles/global.css` 里的 `--font-body` 改成 `var(--font-serif)`
- 中西文间距交给浏览器的 `text-autospace`（新版 Chrome/Safari 支持），源文件里不需要手动加空格
- 中文强调 `*文字*` 显示为着重号（文字下加点），而不是机械倾斜的伪斜体
- 颜色、行宽等都在 `global.css` 顶部的变量里

## 部署

1. GitHub 上新建公开仓库 `DARX1024.github.io`，把本项目推上去
2. 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**
3. 之后每次推送到 `main`，`.github/workflows/deploy.yml` 会自动构建发布到 https://darx1024.github.io

## 小提示

- 改了 `src/plugins/` 里的插件后如果页面没变，删掉缓存：`rm -rf node_modules/.astro .astro`
- Astro 7 默认的 Markdown 处理器是 Sätteri；本站在 `astro.config.mjs` 里显式改用 unified（remark/rehype），以便使用 KaTeX 和 Obsidian 插件
