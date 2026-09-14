/** Shared render helpers used by more than one view. */

import { h, fmt } from './dom';
import type { Db, Recipe, Stack } from './db';

export function itemHref(db: Db, idx: number): string {
  return `#/item/${db.id(idx)}`;
}

/** Item icon, or a dashed placeholder when the dump has no art for it. */
export function icon(db: Db, idx: number, cls = 'icon'): HTMLElement {
  const url = db.iconUrl(idx);
  if (!url) return h('div', { class: `${cls} icon-ph` });
  return h('img', {
    class: cls,
    src: url,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    width: 64,
    height: 64,
  });
}

/** A card in the browse grid. */
export function itemCard(db: Db, idx: number): HTMLElement {
  const colour = db.colour(idx);
  const sub = db.group(idx) ?? db.catLabel(idx);
  return h(
    'a',
    {
      class: 'card',
      href: itemHref(db, idx),
      style: colour ? `--swatch:${colour}` : null,
    },
    icon(db, idx),
    h(
      'div',
      { class: 'meta' },
      h('div', { class: 'nm', text: db.name(idx) }),
      h('div', { class: 'sub', text: sub }),
    ),
  );
}

/** "12x Carbon" as a link. */
export function stackLink(db: Db, s: Stack, showQty = true): HTMLElement {
  return h(
    'a',
    { class: 'ing', href: itemHref(db, s.idx), title: db.name(s.idx) },
    showQty && h('span', { class: 'q', text: `${fmt(s.qty)}×` }),
    icon(db, s.idx, 'ing-icon'),
    h('span', { text: db.name(s.idx) }),
  );
}

/** Join stacks with "+" separators. */
export function stackList(db: Db, stacks: Stack[]): (HTMLElement | string)[] {
  const out: (HTMLElement | string)[] = [];
  stacks.forEach((s, i) => {
    if (i > 0) out.push(h('span', { class: 'plus', text: '+' }));
    out.push(stackLink(db, s));
  });
  return out;
}

export function formatTime(t: number): string {
  if (!t) return '—';
  return `${t}s`;
}

/** One refiner/cooking recipe as a row: inputs → output. */
export function recipeRow(db: Db, r: Recipe): HTMLElement {
  return h(
    'div',
    { class: 'recipe-row' },
    ...stackList(db, r.inputs),
    h('span', { class: 'arrow', text: '→' }),
    stackLink(db, r.output),
    r.operation && h('span', { class: 'op', text: r.operation }),
  );
}

export function panel(title: string, ...body: (Node | string | null | false)[]): HTMLElement {
  return h('section', { class: 'panel' }, h('h2', { text: title }), ...body);
}

export function empty(msg: string): HTMLElement {
  return h('p', { class: 'empty', text: msg });
}
