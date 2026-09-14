/**
 * Placeholder glyphs for the ~2,600 items that have no artwork upstream.
 *
 * A dashed box told the reader nothing. These pick a shape from the item's
 * group (and category as a fallback), so a starship part, a room and a meal are
 * at least distinguishable at a glance. Stroke-only paths on a 24x24 grid,
 * drawn in currentColor so they follow the theme.
 */

import { svg } from './dom';
import type { Db } from './db';

export type GlyphName =
  | 'room' | 'chip' | 'food' | 'fish' | 'crystal' | 'cube' | 'ship'
  | 'frame' | 'egg' | 'helmet' | 'broken' | 'plant' | 'crate' | 'spiral';

const PATHS: Record<GlyphName, string[]> = {
  // Construction parts and habitation - a structure with a doorway.
  room: ['M3 21h18', 'M5 21V10l7-5 7 5v11', 'M10 21v-6h4v6'],
  // Technology, modules, upgrades - a chip with pins.
  chip: ['M7 7h10v10H7z', 'M10 10h4v4h-4z',
         'M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4'],
  // Edible products - bowl with rising steam.
  food: ['M3 12h18a9 9 0 0 1-18 0z', 'M3 21h18', 'M8 3c0 2 1.5 2 1.5 4',
         'M14 2c0 2 1.5 2 1.5 4'],
  fish: ['M3 12c4-5 9-5 12 0-3 5-8 5-12 0z', 'M15 12l6-4v8z', 'M7 11h.01'],
  // Raw and refined elements.
  crystal: ['M12 2 4 9l8 13 8-13z', 'M4 9h16', 'M12 2v20'],
  // Generic manufactured product.
  cube: ['M12 2 3 7v10l9 5 9-5V7z', 'M3 7l9 5 9-5', 'M12 12v10'],
  // Starship, freighter and spacecraft parts.
  ship: ['M12 2c2.5 2.8 4 6.5 4 10l-1 6H9l-1-6c0-3.5 1.5-7.2 4-10z',
         'M8 13l-3 5 3-1.5', 'M16 13l3 5-3-1.5', 'M12 9h.01'],
  // Decorations, posters, signs, statues.
  frame: ['M4 4h16v16H4z', 'M7 16l3.5-4.5 2.5 3L16 10l2 6z', 'M9 8h.01'],
  egg: ['M12 3c3.2 0 6 5 6 9a6 6 0 0 1-12 0c0-4 2.8-9 6-9z'],
  // Helmets, appearance and identification items.
  helmet: ['M5 13a7 7 0 0 1 14 0v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M8 13h8'],
  // Damaged / salvaged components.
  broken: ['M12 2 3 7v10l9 5 9-5V7z', 'M9 8l3.5 4-2 2.5L14 18'],
  // Flora and organic matter.
  plant: ['M12 21V9', 'M12 9C12 6 10 4 7 4c0 3 2 5 5 5z',
          'M12 13c0-3 2-5 5-5 0 3-2 5-5 5z'],
  // Trade goods and containers.
  crate: ['M3 8h18v13H3z', 'M3 8l2-5h14l2 5', 'M12 8v13', 'M3 14h18'],
  // Curiosities and artefacts.
  spiral: ['M12 12a2.5 2.5 0 1 0 2.5 2.5A5 5 0 1 1 9.5 9.5 7.5 7.5 0 1 0 17 17'],
};

/**
 * Group-name keywords, most specific first. The group text is far more
 * descriptive than the category - "Hauler Starship Component" and "Timber
 * Construction Component" are both Buildings, but they are not the same thing.
 */
const GROUP_RULES: [RegExp, GlyphName][] = [
  [/fish|catch/i, 'fish'],
  [/egg/i, 'egg'],
  [/damaged|broken|salvage|scrap|junk|flotsam|rubbish/i, 'broken'],
  [/starship|freighter|spacecraft|frigate|ship |corvette|exocraft|vehicle/i, 'ship'],
  [/construction|habitation|structure|room|floor|wall|roof|door|window|stair|ramp/i, 'room'],
  [/decoration|poster|sign|statue|figurine|banner|trophy|painting|model|replica/i, 'frame'],
  [/edible|food|meal|cake|bread|drink|soup|stew|pie|cream|sauce|jam|curry|biscuit/i, 'food'],
  [/helmet|appearance|identification|customisation|customization|cloak|cape|jetpack|suit/i, 'helmet'],
  [/plant|flora|organic|agricultur|seed|flower|crop|fungal|harvest/i, 'plant'],
  [/component|module|technology|device|upgrade|system|drive|reactor|computer|circuit/i, 'chip'],
  [/element|mineral|metal|crystal|ore|gas|alloy|substance|catalyst/i, 'crystal'],
  [/trade|commodity|goods|artifact|artefact|treasure|currency/i, 'crate'],
  [/curiosity|relic|anomal|atlas|monolith|orb|fragment/i, 'spiral'],
];

const CATEGORY_GLYPH: Record<string, GlyphName> = {
  raw: 'crystal',
  product: 'cube',
  curio: 'spiral',
  cooking: 'food',
  tech: 'chip',
  techmod: 'chip',
  upgrade: 'chip',
  constructed: 'chip',
  building: 'room',
  trade: 'crate',
  procproduct: 'cube',
  fish: 'fish',
  other: 'cube',
};

export function glyphFor(db: Db, idx: number): GlyphName {
  const group = db.group(idx);
  if (group) {
    for (const [re, name] of GROUP_RULES) {
      if (re.test(group)) return name;
    }
  }
  return CATEGORY_GLYPH[db.catKey(idx)] ?? 'cube';
}

/** Render a glyph as an inline SVG sized by CSS. */
export function glyphEl(name: GlyphName, cls: string): SVGElement {
  return svg(
    'svg',
    {
      class: `${cls} glyph`,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.4',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...PATHS[name].map((d) => svg('path', { d })),
  );
}
