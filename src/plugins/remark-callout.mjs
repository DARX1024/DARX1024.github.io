// Obsidian / GitHub callout：
//   > [!note] 可选标题
//   > 内容
// `[!tip]-` 默认折叠，`[!tip]+` 可折叠但默认展开。支持嵌套。

// Obsidian 的别名 → 用于配色的大类
const GROUP = {
  note: 'note', info: 'note', todo: 'note',
  abstract: 'abstract', summary: 'abstract', tldr: 'abstract',
  tip: 'tip', hint: 'tip', important: 'tip',
  success: 'success', check: 'success', done: 'success',
  question: 'question', help: 'question', faq: 'question',
  warning: 'warning', caution: 'warning', attention: 'warning',
  failure: 'danger', fail: 'danger', missing: 'danger', danger: 'danger', error: 'danger', bug: 'danger',
  example: 'example',
  quote: 'quote', cite: 'quote',
  theorem: 'math', lemma: 'math', proof: 'math', definition: 'math', proposition: 'math',
};

const LABEL = {
  note: '注', info: '信息', todo: '待办', abstract: '摘要', summary: '摘要', tldr: 'TL;DR',
  tip: '提示', hint: '提示', important: '重要', success: '完成', check: '完成', done: '完成',
  question: '问题', help: '问题', faq: 'FAQ', warning: '注意', caution: '注意', attention: '注意',
  failure: '失败', fail: '失败', missing: '缺失', danger: '危险', error: '错误', bug: 'Bug',
  example: '例', quote: '引用', cite: '引用',
  theorem: '定理', lemma: '引理', proof: '证明', definition: '定义', proposition: '命题',
};

const HEAD = /^\[!([\w-]+)\]([+-]?)[ \t]*/;

function visit(node) {
  for (const child of node.children ?? []) visit(child);
  if (node.type !== 'blockquote') return;
  const first = node.children[0];
  if (first?.type !== 'paragraph') return;
  const t = first.children[0];
  if (t?.type !== 'text') return;
  const m = HEAD.exec(t.value);
  if (!m) return;

  const type = m[1].toLowerCase();
  const fold = m[2];
  t.value = t.value.slice(m[0].length);

  // 第一行剩下的部分是标题，之后的是正文
  const title = [];
  const rest = [];
  let inTitle = true;
  for (const n of first.children) {
    if (!inTitle) { rest.push(n); continue; }
    if (n.type === 'break') { inTitle = false; continue; }
    if (n.type === 'text' && n.value.includes('\n')) {
      const at = n.value.indexOf('\n');
      if (at > 0) title.push({ type: 'text', value: n.value.slice(0, at) });
      const after = n.value.slice(at + 1);
      if (after) rest.push({ type: 'text', value: after });
      inTitle = false;
      continue;
    }
    title.push(n);
  }
  const hasTitle = title.some((n) => n.type !== 'text' || n.value.trim());
  const body = [...(rest.length ? [{ type: 'paragraph', children: rest }] : []), ...node.children.slice(1)];

  node.data = {
    hName: fold ? 'details' : 'aside',
    hProperties: {
      className: ['callout'],
      dataCallout: type,
      dataCalloutGroup: GROUP[type] ?? 'note',
      ...(fold === '+' ? { open: true } : {}),
    },
  };
  node.children = [
    {
      type: 'paragraph',
      data: { hName: fold ? 'summary' : 'div', hProperties: { className: ['callout-title'] } },
      children: hasTitle ? title : [{ type: 'text', value: LABEL[type] ?? type[0].toUpperCase() + type.slice(1) }],
    },
    ...(body.length
      ? [{ type: 'blockquote', data: { hName: 'div', hProperties: { className: ['callout-content'] } }, children: body }]
      : []),
  ];
}

export default function remarkCallout() {
  return (tree) => visit(tree);
}
