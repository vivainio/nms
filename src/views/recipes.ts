/** Full refiner / cooking lookup tables, filterable by item name. */

import { h } from '../lib/dom';
import type { Db, Recipe, RecipeKind } from '../lib/db';
import { stackLink, formatTime, empty } from '../lib/ui';

export interface RecipeViewState {
  query: string;
}

function matches(db: Db, r: Recipe, q: string): boolean {
  if (!q) return true;
  if (db.name(r.output.idx).toLowerCase().includes(q)) return true;
  if (r.operation.toLowerCase().includes(q)) return true;
  return r.inputs.some((s) => db.name(s.idx).toLowerCase().includes(q));
}

export function renderRecipeTable(
  db: Db,
  kind: RecipeKind,
  state: RecipeViewState,
): HTMLElement {
  const root = h('div');
  const q = state.query.trim().toLowerCase();

  const all = db.allRecipes(kind);
  const rows = all.filter((r) => matches(db, r, q));

  root.appendChild(
    h('div', {
      class: 'result-count',
      text: q
        ? `${rows.length} of ${all.length} recipes matching “${state.query}”`
        : `${all.length} recipes`,
    }),
  );

  if (!rows.length) {
    root.appendChild(empty('No recipes match that filter.'));
    return root;
  }

  // Sort by output name so related recipes sit together.
  rows.sort(
    (a, b) =>
      db.name(a.output.idx).localeCompare(db.name(b.output.idx)) ||
      a.inputs.length - b.inputs.length,
  );

  const body = h('tbody');
  for (const r of rows) {
    body.appendChild(
      h(
        'tr',
        null,
        h(
          'td',
          { class: 'inputs' },
          ...r.inputs.flatMap((s, i) => [
            i > 0 ? h('span', { class: 'plus', text: '+' }) : null,
            stackLink(db, s),
          ]),
        ),
        h('td', null, h('span', { class: 'arrow', text: '→' })),
        h('td', null, stackLink(db, r.output)),
        h('td', { class: 'op', text: r.operation || '—' }),
        h('td', { class: 'time', text: formatTime(r.time) }),
      ),
    );
  }

  root.appendChild(
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'recipes' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { text: 'Inputs' }),
            h('th', { text: '' }),
            h('th', { text: 'Output' }),
            h('th', { text: kind === 'refine' ? 'Operation' : 'Setting' }),
            h('th', { class: 'time', text: 'Time' }),
          ),
        ),
        body,
      ),
    ),
  );

  return root;
}
