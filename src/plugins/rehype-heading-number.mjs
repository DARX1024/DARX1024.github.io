// 小标题开头的编号（「0. 出发点」「2.1 推导」）包进 <span class="h-num">，
// 宽屏时把编号悬挂到正文左边距外，标题文字和正文左对齐。只改结构，不改文字，目录和锚点不受影响。
const NUM = /^(\d+(?:\.\d+)*\.?)(\s+)/;

export default function rehypeHeadingNumber() {
  return (tree) => {
    (function walk(n) {
      if (n.type === 'element' && (n.tagName === 'h2' || n.tagName === 'h3')) {
        const first = n.children?.[0];
        const m = first?.type === 'text' && first.value.match(NUM);
        if (m) {
          first.value = first.value.slice(m[0].length);
          n.children.unshift(
            { type: 'element', tagName: 'span', properties: { className: ['h-num'] }, children: [{ type: 'text', value: m[1] }] },
            { type: 'text', value: ' ' },
          );
        }
        return;
      }
      (n.children ?? []).forEach(walk);
    })(tree);
  };
}
