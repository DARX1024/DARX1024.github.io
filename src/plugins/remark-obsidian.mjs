// Obsidian 语法 → 标准 Markdown AST：
//   [[笔记]] [[笔记|别名]] [[笔记#标题]] [[#本页标题]]
//   ![[图片.png]] ![[图片.png|300]]   ![](只写文件名.png)
//   ![[可视化.html]] ![[可视化.html|480]]  → 可视化 iframe
//   ==高亮==   %%注释%%
// 指向未发布笔记的双链会降级为普通文字，不会产生死链。
import fs from 'node:fs';
import path from 'node:path';
import { getIndex, IMAGE_EXT } from './content-index.mjs';
import { headingSlug } from './slug.mjs';
import { listViz, readVizMeta } from './viz.mjs';

const TOKEN = /(!?)\[\[([^\[\]\n]+?)\]\]|==(?=\S)([^=\n]*?\S)==|%%[^%]*?%%/g;
const SKIP = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'html', 'mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression']);

function splitTarget(raw) {
  const [left, ...aliasParts] = raw.split('|');
  const alias = aliasParts.join('|').trim();
  const hashAt = left.indexOf('#');
  const target = (hashAt >= 0 ? left.slice(0, hashAt) : left).trim();
  const heading = hashAt >= 0 ? left.slice(hashAt + 1).replace(/^\^/, '').trim() : '';
  return { target, heading, alias };
}

function parseSize(s) {
  const m = /^(\d+)(?:x(\d+))?$/.exec(s ?? '');
  return m ? { width: Number(m[1]), height: m[2] ? Number(m[2]) : undefined } : {};
}

function relImageUrl(fromFile, absTarget) {
  let rel = path.relative(path.dirname(fromFile), absTarget).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

/** 按文件名找附件：同名多份时优先离笔记最近的那份。 */
function findAttachment(name, fromFile, files) {
  const hits = files.get(path.basename(name).toLowerCase());
  if (!hits?.length) return null;
  if (hits.length === 1 || !fromFile) return hits[0];
  const dir = path.dirname(fromFile);
  return [...hits].sort((a, b) => path.relative(dir, a).length - path.relative(dir, b).length)[0];
}

function findViz(file) {
  const id = file.replace(/^\/+/, '').replace(/(\/index)?\.html$/i, '').toLowerCase();
  const v = listViz().find((x) => x.id === id);
  return v ? readVizMeta(v) : null;
}

export function vizNode(file, { height, caption } = {}, warn = () => {}) {
  const meta = findViz(file);
  if (!meta) warn(`找不到可视化 ${file}（应放在 viz-raw/ 下）`);
  height ??= meta?.data.height;
  caption ||= meta?.data.title;
  const name = meta ? meta.id : file.replace(/(\/index)?\.html$/i, '');
  const src = '/viz-raw/' + (meta ? meta.data.file : file.replace(/^\/+/, ''));
  const props = {
    className: ['viz-frame'],
    src,
    title: caption || name,
    loading: 'lazy',
  };
  if (height) props.style = `height:${height}px`;
  else props.dataAutoheight = '';
  return {
    type: 'paragraph',
    data: {
      hName: 'figure',
      hProperties: { className: ['viz'] },
      hChildren: [
        { type: 'element', tagName: 'iframe', properties: props, children: [] },
        {
          type: 'element',
          tagName: 'figcaption',
          properties: {},
          children: [
            ...(caption ? [{ type: 'text', value: caption + ' · ' }] : []),
            {
              type: 'element',
              tagName: 'a',
              properties: { href: `/viz/${name.toLowerCase()}/` },
              children: [{ type: 'text', value: '单独打开 ↗' }],
            },
          ],
        },
      ],
    },
    children: [],
  };
}

function transformText(value, ctx) {
  const out = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN)) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    last = m.index + m[0].length;
    const [whole, bang, inner, mark] = m;

    if (whole.startsWith('%%')) continue; // Obsidian 注释，直接丢掉
    if (mark !== undefined) {
      out.push({ type: 'emphasis', data: { hName: 'mark' }, children: [{ type: 'text', value: mark }] });
      continue;
    }
    const { target, heading, alias } = splitTarget(inner);

    if (bang && IMAGE_EXT.test(target)) {
      const abs = findAttachment(target, ctx.file, ctx.index.files);
      if (!abs) {
        ctx.warn(`找不到图片 ${target}`);
        out.push({ type: 'text', value: whole });
        continue;
      }
      const size = parseSize(alias);
      out.push({
        type: 'image',
        url: relImageUrl(ctx.file, abs),
        alt: size.width ? path.basename(target, path.extname(target)) : alias || path.basename(target, path.extname(target)),
        data: size.width ? { hProperties: { width: size.width, height: size.height } } : undefined,
      });
      continue;
    }
    if (bang && /\.html$/i.test(target)) {
      // 行内的可视化嵌入降级为链接；独占一段时由 paragraph 处理成 iframe
      const name = target.replace(/(\/index)?\.html$/i, '').toLowerCase();
      out.push({ type: 'link', url: `/viz/${name}/`, children: [{ type: 'text', value: alias || name }] });
      continue;
    }

    // 普通双链（![[笔记]] 嵌入也按链接处理）
    const hash = heading ? '#' + headingSlug(heading) : '';
    const label = alias || (target ? (heading ? `${target} › ${heading}` : target) : heading);
    if (!target) {
      out.push({ type: 'link', url: hash, data: { hProperties: { className: ['wikilink'] } }, children: [{ type: 'text', value: label }] });
      continue;
    }
    const hit = ctx.index.notes.get(target.replaceAll('\\', '/').toLowerCase());
    if (hit) {
      out.push({
        type: 'link',
        url: hit.url + hash,
        data: { hProperties: { className: ['wikilink'] } },
        children: [{ type: 'text', value: label }],
      });
    } else {
      out.push({
        type: 'emphasis',
        data: { hName: 'span', hProperties: { className: ['wikilink', 'is-missing'], title: '这篇笔记还没有发布' } },
        children: [{ type: 'text', value: label }],
      });
    }
  }
  if (last === 0) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

const VIZ_LINE = /^\s*!\[\[([^\[\]|]+?\.html)(?:\|([^\]]*))?\]\]\s*$/i;

// ==高亮== 里含有公式、加粗等时，会跨越多个 AST 节点，这里先把它们配对包成 <mark>
const OPEN = /==(?=\S)/;
const countMarks = (v) => (v.match(/==/g) ?? []).length;
function markAcross(node) {
  const kids = node.children;
  for (let i = 0; i < kids.length; i++) {
    const a = kids[i];
    if (a.type !== 'text' || countMarks(a.value) % 2 === 0) continue;
    const p = a.value.lastIndexOf('==');
    if (!OPEN.test(a.value.slice(p))) continue;
    for (let j = i + 1; j < kids.length; j++) {
      const b = kids[j];
      if (b.type !== 'text' || !b.value.includes('==')) continue;
      const q = b.value.indexOf('==');
      const inner = [
        ...(a.value.slice(p + 2) ? [{ type: 'text', value: a.value.slice(p + 2) }] : []),
        ...kids.slice(i + 1, j),
        ...(b.value.slice(0, q) ? [{ type: 'text', value: b.value.slice(0, q) }] : []),
      ];
      const mark = { type: 'emphasis', data: { hName: 'mark' }, children: inner };
      const repl = [{ type: 'text', value: a.value.slice(0, p) }, mark, { type: 'text', value: b.value.slice(q + 2) }];
      kids.splice(i, j - i + 1, ...repl);
      i += 1;
      break;
    }
  }
}

function walk(node, ctx) {
  if (!node.children) return;
  markAcross(node);
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (SKIP.has(child.type)) continue;

    // 独占一段的 ![[xxx.html]] → 可视化 figure
    if (child.type === 'paragraph' && child.children.length === 1 && child.children[0].type === 'text') {
      const m = VIZ_LINE.exec(child.children[0].value);
      if (m) {
        const opt = (m[2] ?? '').trim();
        const height = /^\d+$/.test(opt) ? Number(opt) : undefined;
        node.children[i] = vizNode(m[1].trim(), { height, caption: height ? '' : opt }, ctx.warn);
        continue;
      }
    }

    // 标准写法 ![](foo.png)，但 Obsidian 只写了文件名或 vault 根路径
    if (child.type === 'image' && ctx.file && !/^(https?:|\/|data:|#)/.test(child.url)) {
      const decoded = decodeURI(child.url);
      if (!fs.existsSync(path.resolve(path.dirname(ctx.file), decoded))) {
        const abs = findAttachment(decoded, ctx.file, ctx.index.files);
        if (abs) child.url = relImageUrl(ctx.file, abs);
      }
      const [alt, size] = (child.alt ?? '').split('|');
      const s = parseSize(size?.trim());
      if (s.width) {
        child.alt = alt;
        child.data = { ...child.data, hProperties: { width: s.width, height: s.height } };
      }
      continue;
    }

    if (child.type === 'text') {
      const replaced = transformText(child.value, ctx);
      if (replaced) {
        node.children.splice(i, 1, ...replaced);
        i += replaced.length - 1;
      }
      continue;
    }
    walk(child, ctx);
  }
}

export default function remarkObsidian() {
  return (tree, file) => {
    const ctx = {
      file: file.path,
      index: getIndex(),
      warn: (msg) => console.warn(`[obsidian] ${file.path ? path.relative(process.cwd(), file.path) : ''}: ${msg}`),
    };
    walk(tree, ctx);
  };
}
