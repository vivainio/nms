/**
 * App shell: loads the data bundle, owns the hash router and the header.
 *
 * Routes:
 *   #/                 browse + search
 *   #/item/<id>        item detail
 *   #/refiner          refiner lookup table
 *   #/cooking          nutrient processor lookup table
 */

import './styles.css';

import { Db } from './lib/db';
import { SearchIndex } from './lib/search';
import { h, clear } from './lib/dom';
import { renderBrowse, type BrowseState } from './views/browse';
import { renderItem, renderNotFound } from './views/item';
import { renderRecipeTable, type RecipeViewState } from './views/recipes';
import { renderResearch } from './views/research';

type Route =
  | { name: 'browse' }
  | { name: 'item'; id: string }
  | { name: 'refiner' }
  | { name: 'cooking' }
  | { name: 'research'; root: number | null };

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path.startsWith('item/')) {
    return { name: 'item', id: decodeURIComponent(path.slice(5)) };
  }
  if (path === 'refiner') return { name: 'refiner' };
  if (path === 'cooking') return { name: 'cooking' };
  if (path === 'research') return { name: 'research', root: null };
  if (path.startsWith('research/')) {
    const n = Number.parseInt(path.slice(9), 10);
    return { name: 'research', root: Number.isNaN(n) ? null : n };
  }
  return { name: 'browse' };
}

const TABS: { href: string; label: string; match: Route['name'] }[] = [
  { href: '#/', label: 'Items', match: 'browse' },
  { href: '#/refiner', label: 'Refiner', match: 'refiner' },
  { href: '#/cooking', label: 'Cooking', match: 'cooking' },
  { href: '#/research/0', label: 'Research', match: 'research' },
];

const PLACEHOLDER: Record<Route['name'], string> = {
  browse: 'Search items…  (try: carbon, warp, stasis)',
  item: 'Search items…',
  refiner: 'Filter refiner recipes…',
  cooking: 'Filter cooking recipes…',
  research: 'Search items…',
};

async function main(): Promise<void> {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app missing');

  let db: Db;
  try {
    db = await Db.load();
  } catch (err) {
    clear(mount);
    mount.appendChild(
      h(
        'div',
        { class: 'boot' },
        'Could not load the item database. ',
        h('br'),
        h('small', { text: String(err) }),
      ),
    );
    return;
  }

  const search = new SearchIndex(db);
  const browseState: BrowseState = {
    query: '', categories: new Set(), browseAll: false,
  };
  const refinerState: RecipeViewState = { query: '' };
  const cookingState: RecipeViewState = { query: '' };

  // -- shell ---------------------------------------------------------------
  const searchInput = h('input', {
    class: 'search',
    type: 'search',
    placeholder: PLACEHOLDER.browse,
    'aria-label': 'Search',
    autocomplete: 'off',
  }) as HTMLInputElement;

  const tabEls = TABS.map((t) => h('a', { href: t.href, text: t.label }));
  const nav = h('nav', { class: 'tabs' }, ...tabEls);

  const content = h('main');

  const shell = h(
    'div',
    { class: 'app' },
    h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'top-inner' },
        h('a', { class: 'brand', href: '#/', text: 'NMS Reference' }),
        nav,
        h('div', { class: 'search-wrap' }, searchInput),
      ),
    ),
    content,
    h(
      'footer',
      { class: 'bottom' },
      `Game data v${db.meta.gameVersion} (build ${db.meta.gameBuild}), extracted ${db.meta.generated}. `,
      h('br'),
      'Data from ',
      h('a', {
        href: 'https://nmsassistant.com/',
        text: 'Assistant for No Man’s Sky',
        rel: 'noopener',
        target: '_blank',
      }),
      ' · item art mirrored from their CDN. Not affiliated with Hello Games.',
    ),
  );

  clear(mount);
  mount.appendChild(shell);

  // -- routing -------------------------------------------------------------
  let current: Route = parseRoute(location.hash);

  const stateFor = (r: Route): { query: string } | null =>
    r.name === 'browse' ? browseState
      : r.name === 'refiner' ? refinerState
      : r.name === 'cooking' ? cookingState
      : null;

  function renderContent(): void {
    clear(content);
    switch (current.name) {
      case 'browse':
        content.appendChild(
          renderBrowse(db, search, browseState, renderContent),
        );
        break;
      case 'item': {
        const idx = db.indexOf(current.id);
        content.appendChild(
          idx === undefined ? renderNotFound(current.id) : renderItem(db, idx),
        );
        break;
      }
      case 'refiner':
        content.appendChild(renderRecipeTable(db, 'refine', refinerState));
        break;
      case 'cooking':
        content.appendChild(renderRecipeTable(db, 'cook', cookingState));
        break;
      case 'research':
        content.appendChild(renderResearch(db, current.root));
        break;
    }
  }

  function syncChrome(): void {
    tabEls.forEach((el, i) => {
      el.className = TABS[i].match === current.name ? 'on' : '';
    });
    searchInput.placeholder = PLACEHOLDER[current.name];
    const s = stateFor(current);
    searchInput.value = s ? s.query : '';
  }

  async function navigate(): Promise<void> {
    current = parseRoute(location.hash);
    syncChrome();

    // Descriptions are only needed on the detail view, so the browse and table
    // routes never pay for them.
    if (current.name === 'item') {
      try {
        await db.loadDescriptions();
      } catch {
        // Non-fatal: the page renders fine without flavour text.
      }
      if (parseRoute(location.hash).name !== 'item') return;
    }

    renderContent();
  }

  window.addEventListener('hashchange', () => {
    void navigate();
    content.scrollIntoView({ block: 'start' });
  });

  let debounce: number | undefined;
  searchInput.addEventListener('input', () => {
    const s = stateFor(current);
    if (!s) {
      // Typing from an item page jumps back to browse.
      browseState.query = searchInput.value;
      location.hash = '#/';
      return;
    }
    s.query = searchInput.value;
    window.clearTimeout(debounce);
    debounce = window.setTimeout(renderContent, 90);
  });

  await navigate();
}

void main();
