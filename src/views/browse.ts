/** Browse + search view: filter chips over a grid of item cards. */

import { h } from '../lib/dom';
import type { Db } from '../lib/db';
import type { SearchIndex } from '../lib/search';
import { itemCard, empty } from '../lib/ui';

export interface BrowseState {
  query: string;
  categories: Set<string>;
}

const PAGE = 120;

export function renderBrowse(
  db: Db,
  search: SearchIndex,
  state: BrowseState,
  onChange: () => void,
): HTMLElement {
  const root = h('div');

  // -- category chips ------------------------------------------------------
  const chips = h('div', { class: 'chips' });
  const allOn = state.categories.size === 0;
  chips.appendChild(
    h('button', {
      class: `chip${allOn ? ' on' : ''}`,
      text: 'All',
      onclick: () => {
        state.categories.clear();
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
          // Plain click toggles; chips are additive so several can be active.
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

  // Render in pages so a bare "All" listing (3,700 cards) stays responsive.
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
        ? `showing ${shown} of ${hits.length} items`
        : `${hits.length} item${hits.length === 1 ? '' : 's'}`;
    more.style.display = shown < hits.length ? '' : 'none';
  };

  more.addEventListener('click', renderPage);
  renderPage();
  root.appendChild(h('div', { style: 'margin-top:1rem' }, more));

  return root;
}
