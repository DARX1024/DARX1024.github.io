// 标题里含公式时，Astro 收集目录文字会把 KaTeX 输出的 MathML、TeX 注释和 HTML 三份文字拼在一起，
// 目录里就会出现「CαnC\alpha^nCαn」。这里把标题中的公式整体换成原始 HTML（目录收集时会跳过），
// 再附一个隐藏的 $TeX$，让目录拿到干净的 TeX，在 Article.astro 里重新渲染成公式。
import { toHtml } from 'hast-util-to-html';

const isHeading = (n) => n.type === 'element' && /^h[1-6]$/.test(n.tagName);
const hasClass = (n, c) => n.type === 'element' && [].concat(n.properties?.className ?? []).includes(c);

function texOf(node) {
  let tex = '';
  (function find(n) {
    if (tex) return;
    if (n.type === 'element' && n.tagName === 'annotation') {
      tex = n.children.map((c) => c.value ?? '').join('');
      return;
    }
    (n.children ?? []).forEach(find);
  })(node);
  return tex;
}

function transform(node) {
  node.children = node.children.flatMap((c) => {
    if (hasClass(c, 'katex')) {
      return [
        { type: 'raw', value: toHtml(c) },
        {
          type: 'element',
          tagName: 'span',
          properties: { hidden: true, className: ['toc-tex'] },
          children: [{ type: 'text', value: `$${texOf(c)}$` }],
        },
      ];
    }
    if (c.children) transform(c);
    return [c];
  });
}

export default function rehypeHeadingMath() {
  return (tree) => {
    (function walk(n) {
      if (isHeading(n)) return transform(n);
      (n.children ?? []).forEach(walk);
    })(tree);
  };
}
