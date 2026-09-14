/** Research trees: unlock chains, each node linking to its item page. */

import { h } from '../lib/dom';
import type { Db, TreeEntry } from '../lib/db';
import { icon, itemHref, empty } from '../lib/ui';

function nodeLabel(db: Db, n: TreeEntry): HTMLElement {
  if (n.idx < 0) {
    return h('span', { class: 'tree-head', text: n.label || '—' });
  }
  return h(
    'a',
    { class: 'ing', href: itemHref(db, n.idx) },
    icon(db, n.idx, 'ing-icon'),
    h('span', { text: db.name(n.idx) }),
  );
}

function branch(db: Db, nodes: TreeEntry[]): HTMLElement {
  return h(
    'ul',
    null,
    ...nodes.map((n) =>
      h(
        'li',
        null,
        nodeLabel(db, n),
        n.costType && n.costType !== 'None'
          ? h('span', { class: 'leaf-note', text: n.costType })
          : null,
        n.children.length > 0 && branch(db, n.children),
      ),
    ),
  );
}

export function renderResearch(db: Db, root: number | null): HTMLElement {
  const el = h('div');

  // Tree picker, always visible so switching trees is one tap.
  el.appendChild(
    h(
      'div',
      { class: 'chips' },
      ...db.treeNames.map((name, i) =>
        h('a', {
          class: `chip${i === root ? ' on' : ''}`,
          href: `#/research/${i}`,
          text: name,
        }),
      ),
    ),
  );

  if (root === null) {
    el.appendChild(
      h('p', { class: 'empty', text: 'Pick a research tree above.' }),
    );
    return el;
  }

  const entries = db.tree(root);
  if (!entries.length) {
    el.appendChild(empty('This tree has no entries in the data dump.'));
    return el;
  }

  const count = (ns: TreeEntry[]): number =>
    ns.reduce((sum, n) => sum + 1 + count(n.children), 0);

  el.appendChild(
    h('div', { class: 'result-count', text: `${count(entries)} nodes` }),
  );
  el.appendChild(h('div', { class: 'tree research' }, branch(db, entries)));
  return el;
}
