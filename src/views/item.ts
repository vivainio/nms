/** Item detail: stats, crafting tree, refiner/cooking recipes, reverse lookup. */

import { h, fmt } from '../lib/dom';
import { craftTree, rawTotals } from '../lib/db';
import type { Db, TreeNode } from '../lib/db';
import {
  icon, itemCard, stackLink, recipeRow, panel, empty,
} from '../lib/ui';

function stat(label: string, value: string): HTMLElement {
  return h('span', { class: 'stat' }, `${label} `, h('b', { text: value }));
}

function treeList(db: Db, nodes: TreeNode[]): HTMLElement {
  return h(
    'ul',
    null,
    ...nodes.map((n) =>
      h(
        'li',
        null,
        stackLink(db, { idx: n.idx, qty: n.qty }),
        n.cyclic && h('span', { class: 'cyc', text: '(cycle — stopped)' }),
        !n.cyclic && n.children.length === 0 && db.isCraftable(n.idx) === false
          ? h('span', { class: 'leaf-note', text: '· base' })
          : null,
        n.children.length > 0 && treeList(db, n.children),
      ),
    ),
  );
}

export function renderItem(db: Db, idx: number): HTMLElement {
  const root = h('div');

  const colour = db.colour(idx);
  const group = db.group(idx);

  // -- header --------------------------------------------------------------
  const stats = h('div', { class: 'stats' });
  const value = db.value(idx);
  if (value) {
    const cur = db.currency(idx) ?? 'Units';
    stats.appendChild(stat('Value', `${fmt(value)} ${cur}`));
  }
  if (db.stack(idx)) stats.appendChild(stat('Stack', fmt(db.stack(idx))));
  if (db.cookingValue(idx)) {
    stats.appendChild(stat('Cooking value', fmt(db.cookingValue(idx))));
  }
  const bp = db.blueprintCost(idx);
  if (bp) {
    const label = bp.type === 'None' ? 'Blueprint' : `Blueprint (${bp.type})`;
    stats.appendChild(stat(label, fmt(bp.cost)));
  }
  stats.appendChild(stat('ID', db.id(idx)));

  const descEl = h('p', { class: 'desc' });
  const d = db.description(idx);
  if (d) descEl.textContent = d;

  root.appendChild(
    h(
      'div',
      { class: 'detail-head' },
      icon(db, idx, 'icon'),
      h(
        'div',
        null,
        h('h1', { text: db.name(idx), style: colour ? `color:${colour}` : null }),
        h('div', { class: 'grp', text: group ?? db.catLabel(idx) }),
        descEl,
        stats,
      ),
    ),
  );

  // -- crafted from --------------------------------------------------------
  const ingredients = db.craftOf(idx);
  if (ingredients.length) {
    const direct = h(
      'div',
      { class: 'recipe-row' },
      ...ingredients.flatMap((s, i) => [
        i > 0 ? h('span', { class: 'plus', text: '+' }) : null,
        stackLink(db, s),
      ]),
      h('span', { class: 'arrow', text: '→' }),
      stackLink(db, { idx, qty: 1 }, false),
    );

    const tree = craftTree(db, idx);
    const hasDepth = tree.children.some((c) => c.children.length > 0);
    const totals = [...rawTotals(tree)].sort((a, b) => b[1] - a[1]);

    root.appendChild(
      panel(
        'Crafted from',
        direct,
        hasDepth &&
          h(
            'div',
            { style: 'margin-top:0.9rem' },
            h('div', { class: 'result-count', text: 'full breakdown' }),
            h('div', { class: 'tree' }, treeList(db, tree.children)),
          ),
        hasDepth &&
          h(
            'div',
            { style: 'margin-top:0.9rem' },
            h('div', { class: 'result-count', text: 'total base materials' }),
            h(
              'div',
              { class: 'totals' },
              ...totals.map(([i, qty]) => stackLink(db, { idx: i, qty })),
            ),
          ),
      ),
    );
  }

  // -- refiner / cooking ---------------------------------------------------
  const sections: [string, ReturnType<Db['recipesProducing']>][] = [
    ['Refine to make this', db.recipesProducing('refine', idx)],
    ['Refine using this', db.recipesUsing('refine', idx)],
    ['Cook to make this', db.recipesProducing('cook', idx)],
    ['Cook using this', db.recipesUsing('cook', idx)],
  ];
  for (const [title, list] of sections) {
    if (!list.length) continue;
    root.appendChild(
      panel(
        `${title} (${list.length})`,
        ...list.map((r) => recipeRow(db, r)),
      ),
    );
  }

  // -- reverse: used to craft ----------------------------------------------
  const users = db.usedToCraft(idx);
  if (users.length) {
    root.appendChild(
      panel(
        `Used to craft (${users.length})`,
        h('div', { class: 'grid' }, ...users.map((u) => itemCard(db, u))),
      ),
    );
  }

  if (!db.hasAnyRecipe(idx)) {
    root.appendChild(
      panel('Recipes', empty('No crafting, refining or cooking recipes reference this item.')),
    );
  }

  return root;
}

export function renderNotFound(id: string): HTMLElement {
  return h(
    'div',
    null,
    h('h1', { text: 'Item not found' }),
    h('p', { class: 'empty', text: `No item with id “${id}”.` }),
    h('p', null, h('a', { href: '#/', text: '← Back to browse' })),
  );
}
