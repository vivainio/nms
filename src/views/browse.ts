/** Browse + search view: category landing, then filter chips over a grid. */

import { h, fmt } from '../lib/dom';
import type { Db } from '../lib/db';
import type { SearchIndex } from '../lib/search';
import { itemCard, icon, empty } from '../lib/ui';

export interface BrowseState {
  query: string;
  categories: Set<string>;
  /** Set once the user opts into the full 3,769-item list. */
  browseAll: boolean;
}

const PAGE = 120;

interface CatStat {
  key: string;
  label: string;
  total: number;
  craftable: number;
  sample: number[];
}

let statsCache: CatStat[] | null = null;

function categoryStats(db: Db): CatStat[] {
  if (statsCache) return statsCache;
  const byKey = new Map<string, CatStat>();
  db.catKeys.forEach((key, i) =>
    byKey.set(key, { key, label: db.catLabels[i], total: 0, craftable: 0, sample: [] }),
  );
  for (let i = 0; i < db.count; i++) {
    const s = byKey.get(db.catKey(i));
    if (!s) continue;
    s.total++;
    if (db.isCraftable(i)) s.craftable++;
    // Keep a few icons to give each tile a face.
    if (s.sample.length < 4 && db.iconUrl(i)) s.sample.push(i);
  }
  statsCache = [...byKey.values()].sort((a, b) => b.total - a.total);
  return statsCache;
}

/** Landing grid of category tiles - the entry point when nothing is filtered. */
function renderLanding(db: Db, state: BrowseState, onChange: () => void): HTMLElement {
  const root = h('div');
  root.appendChild(
    h('p', {
      class: 'lede',
      text: `${fmt(db.count)} items across ${db.catKeys.length} categories. `
        + `Pick one, or search above.`,
    }),
  );

  const grid = h('div', { class: 'cat-grid' });
  for (const s of categoryStats(db)) {
    grid.appendChild(
      h(
        'button',
        {
          class: 'cat-tile',
          onclick: () => {
            state.categories.add(s.key);
            onChange();
          },
        },
        h('div', { class: 'cat-icons' }, ...s.sample.map((i) => icon(db, i, 'ing-icon'))),
        h('div', { class: 'cat-name', text: s.label }),
        h('div', {
          class: 'cat-count',
          text: s.craftable
            ? `${fmt(s.total)} · ${fmt(s.craftable)} craftable`
            : fmt(s.total),
        }),
      ),
    );
  }
  root.appendChild(grid);

  root.appendChild(
    h(
      'p',
      { style: 'margin-top:1.25rem' },
      h('button', {
        class: 'chip',
        text: `Browse all ${fmt(db.count)} items`,
        onclick: () => {
          state.browseAll = true;
          onChange();
        },
      }),
    ),
  );
  return root;
}

export function renderBrowse(
  db: Db,
  search: SearchIndex,
  state: BrowseState,
  onChange: () => void,
): HTMLElement {
  const filtered = state.query.trim() !== '' || state.categories.size > 0;
  if (!filtered && !state.browseAll) return renderLanding(db, state, onChange);

  const root = h('div');

  // -- category chips ------------------------------------------------------
  const chips = h('div', { class: 'chips' });
  chips.appendChild(
    h('button', {
      class: 'chip',
      text: '← Categories',
      onclick: () => {
        state.categories.clear();
        state.browseAll = false;
        state.query = '';
        onChange();
      },
    }),
  );
  db.catKeys.forEach((key, i) => {
    const on = state.categories.has(key);
    chips.appendChild(
      h('button', {
        class: `chip${on ? ' on' : ''}`,
        text: db.catLabels[i],
        onclick: () => {
          // Chips are additive, so several categories can be active at once.
          if (on) state.categories.delete(key);
          else state.categories.add(key);
          onChange();
        },
      }),
    );
  });
  root.appendChild(chips);

  // -- results -------------------------------------------------------------
  const hits = search.search(state.query, {
    categories: state.categories,
    limit: 5000,
  });

  const count = h('div', { class: 'result-count' });
  root.appendChild(count);

  if (hits.length === 0) {
    root.appendChild(empty(`No items match “${state.query}”.`));
    count.textContent = '0 items';
    return root;
  }

  const grid = h('div', { class: 'grid' });
  root.appendChild(grid);

  // Render in pages so a bare "all items" listing stays responsive.
  let shown = 0;
  const more = h('button', { class: 'chip', text: 'Show more' });

  const renderPage = () => {
    const end = Math.min(shown + PAGE, hits.length);
    const frag = document.createDocumentFragment();
    for (let i = shown; i < end; i++) frag.appendChild(itemCard(db, hits[i].idx));
    grid.appendChild(frag);
    shown = end;
    count.textContent =
      shown < hits.length
        ? `showing ${shown} of ${fmt(hits.length)} items`
        : `${fmt(hits.length)} item${hits.length === 1 ? '' : 's'}`;
    more.style.display = shown < hits.length ? '' : 'none';
  };

  more.addEventListener('click', renderPage);
  renderPage();
  root.appendChild(h('div', { style: 'margin-top:1rem' }, more));

  return root;
}
