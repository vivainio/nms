/**
 * Decoder for the columnar bundle produced by scripts/build_data.py.
 *
 * The wire format stores items as parallel arrays with dictionary-encoded
 * strings, so nothing is repeated. We keep that layout in memory and expose
 * accessors instead of materialising 3,700 objects up front. Reverse indexes
 * (what uses this item?) are built once at load.
 */

export interface Meta {
  gameVersion: string;
  gameBuild: number;
  generated: string;
  source: string;
  cdn: string;
  count: number;
}

interface Dicts {
  cat: string[];
  group: string[];
  colour: string[];
  currency: string[];
  bpCostType: string[];
  idPrefix: string[];
  iconDir: string[];
  op: string[];
}

interface Columns {
  n: string[];
  c: number[]; g: number[]; col: number[];
  idp: number[]; idn: number[];
  icd: number[]; icn: number[];
  v: number[]; cur: number[]; st: number[]; cv: number[];
  bpc: number[]; bpt: number[];
}

interface RecipeTable {
  prefix: string;
  rid: number[];
  off: number[];
  in: number[];
  inq: number[];
  out: number[];
  outq: number[];
  t: number[];
  op: number[];
}

export interface Core {
  meta: Meta;
  catLabels: string[];
  dicts: Dicts;
  items: Columns;
  idLiteral: Record<string, string>;
  iconLiteral: Record<string, string>;
  craft: { off: number[]; it: number[]; q: number[] };
  refine: RecipeTable;
  cook: RecipeTable;
}

/** An ingredient or output: item index + quantity. */
export interface Stack {
  idx: number;
  qty: number;
}

export type RecipeKind = 'refine' | 'cook';

export interface Recipe {
  kind: RecipeKind;
  /** Index within its table. */
  k: number;
  id: string;
  inputs: Stack[];
  output: Stack;
  time: number;
  operation: string;
}

const i32 = (a: number[]) => Int32Array.from(a);

/**
 * Where mirrored icons live, relative to the site root. Hash routing means the
 * document URL is always the site root, so a relative path resolves correctly
 * whether the site is served from a domain root or a Pages subpath.
 */
const ICON_BASE = 'icons/';

export class Db {
  readonly meta: Meta;
  readonly count: number;
  readonly catKeys: string[];
  readonly catLabels: string[];

  private readonly d: Dicts;
  private readonly names: string[];
  private readonly c: Int32Array;
  private readonly g: Int32Array;
  private readonly colr: Int32Array;
  private readonly idp: Int32Array;
  private readonly idn: Int32Array;
  private readonly icd: Int32Array;
  private readonly icn: Int32Array;
  private readonly val: Int32Array;
  private readonly cur: Int32Array;
  private readonly stk: Int32Array;
  private readonly cval: Int32Array;
  private readonly bpc: Int32Array;
  private readonly bpt: Int32Array;

  private readonly idLiteral: Record<string, string>;
  private readonly iconLiteral: Record<string, string>;

  private readonly craftOff: Int32Array;
  private readonly craftIt: Int32Array;
  private readonly craftQ: Int32Array;

  private readonly tables: Record<RecipeKind, RecipeTable>;

  /** id string -> item index */
  private readonly byId = new Map<string, number>();
  /** item index -> indexes of items that list it as a craft ingredient */
  private readonly craftUsers: number[][];
  /** item index -> recipe keys, per table */
  private readonly asInput: Record<RecipeKind, number[][]>;
  private readonly asOutput: Record<RecipeKind, number[][]>;

  private descs: string[] | null = null;

  constructor(core: Core) {
    this.meta = core.meta;
    this.count = core.meta.count;
    this.d = core.dicts;
    this.catKeys = core.dicts.cat;
    this.catLabels = core.catLabels;

    const it = core.items;
    this.names = it.n;
    this.c = i32(it.c); this.g = i32(it.g); this.colr = i32(it.col);
    this.idp = i32(it.idp); this.idn = i32(it.idn);
    this.icd = i32(it.icd); this.icn = i32(it.icn);
    this.val = i32(it.v); this.cur = i32(it.cur);
    this.stk = i32(it.st); this.cval = i32(it.cv);
    this.bpc = i32(it.bpc); this.bpt = i32(it.bpt);

    this.idLiteral = core.idLiteral;
    this.iconLiteral = core.iconLiteral;

    this.craftOff = i32(core.craft.off);
    this.craftIt = i32(core.craft.it);
    this.craftQ = i32(core.craft.q);

    this.tables = { refine: core.refine, cook: core.cook };

    for (let i = 0; i < this.count; i++) this.byId.set(this.id(i), i);

    // Reverse index: ingredient -> items crafted from it.
    this.craftUsers = Array.from({ length: this.count }, () => [] as number[]);
    for (let i = 0; i < this.count; i++) {
      for (let k = this.craftOff[i]; k < this.craftOff[i + 1]; k++) {
        this.craftUsers[this.craftIt[k]].push(i);
      }
    }

    const emptyIndex = () =>
      Array.from({ length: this.count }, () => [] as number[]);
    this.asInput = { refine: emptyIndex(), cook: emptyIndex() };
    this.asOutput = { refine: emptyIndex(), cook: emptyIndex() };
    for (const kind of ['refine', 'cook'] as RecipeKind[]) {
      const t = this.tables[kind];
      for (let k = 0; k < t.out.length; k++) {
        for (let x = t.off[k]; x < t.off[k + 1]; x++) {
          const arr = this.asInput[kind][t.in[x]];
          // A recipe can list the same item twice; only index it once.
          if (arr[arr.length - 1] !== k) arr.push(k);
        }
        this.asOutput[kind][t.out[k]].push(k);
      }
    }
  }

  static async load(base = 'data/'): Promise<Db> {
    const res = await fetch(`${base}core.json`);
    if (!res.ok) throw new Error(`failed to load core.json: ${res.status}`);
    return new Db(await res.json());
  }

  // ---- item accessors ----------------------------------------------------

  id(i: number): string {
    const lit = this.idLiteral[String(i)];
    if (lit !== undefined) return lit;
    return this.d.idPrefix[this.idp[i]] + this.idn[i];
  }

  name(i: number): string { return this.names[i]; }
  catKey(i: number): string { return this.d.cat[this.c[i]]; }
  catLabel(i: number): string { return this.catLabels[this.c[i]]; }
  group(i: number): string | null {
    return this.g[i] < 0 ? null : this.d.group[this.g[i]];
  }
  colour(i: number): string | null {
    return this.colr[i] < 0 ? null : '#' + this.d.colour[this.colr[i]];
  }
  value(i: number): number { return this.val[i]; }
  currency(i: number): string | null {
    const c = this.cur[i] < 0 ? null : this.d.currency[this.cur[i]];
    return c === 'None' ? null : c;
  }
  stack(i: number): number { return this.stk[i]; }
  cookingValue(i: number): number { return this.cval[i]; }
  blueprintCost(i: number): { cost: number; type: string } | null {
    if (!this.bpc[i]) return null;
    const t = this.bpt[i] < 0 ? 'None' : this.d.bpCostType[this.bpt[i]];
    return { cost: this.bpc[i], type: t };
  }

  /**
   * Local icon URL, or null when the item has no artwork.
   *
   * Icons are mirrored and downscaled into public/icons by
   * scripts/mirror_icons.py - upstream serves ~348 KB PNGs that we render at
   * 34-72px. Roughly 2,600 of the 3,769 items have no icon upstream at all;
   * those return null so the UI draws a placeholder instead of requesting a
   * URL that would 404.
   */
  iconUrl(i: number): string | null {
    const lit = this.iconLiteral[String(i)];
    if (lit !== undefined) return ICON_BASE + lit.replace(/\.png$/, '.webp');
    if (this.icd[i] < 0) return null;
    return `${ICON_BASE}${this.d.iconDir[this.icd[i]]}/${this.icn[i]}.webp`;
  }

  indexOf(id: string): number | undefined { return this.byId.get(id); }

  // ---- recipes -----------------------------------------------------------

  /** Ingredients this item is crafted from (empty if not craftable). */
  craftOf(i: number): Stack[] {
    const out: Stack[] = [];
    for (let k = this.craftOff[i]; k < this.craftOff[i + 1]; k++) {
      out.push({ idx: this.craftIt[k], qty: this.craftQ[k] });
    }
    return out;
  }

  isCraftable(i: number): boolean {
    return this.craftOff[i + 1] > this.craftOff[i];
  }

  /** Items that list this item as a crafting ingredient. */
  usedToCraft(i: number): number[] { return this.craftUsers[i]; }

  recipe(kind: RecipeKind, k: number): Recipe {
    const t = this.tables[kind];
    const inputs: Stack[] = [];
    for (let x = t.off[k]; x < t.off[k + 1]; x++) {
      inputs.push({ idx: t.in[x], qty: t.inq[x] });
    }
    return {
      kind,
      k,
      id: t.rid[k] < 0 ? `${t.prefix}?${k}` : `${t.prefix}${t.rid[k]}`,
      inputs,
      output: { idx: t.out[k], qty: t.outq[k] },
      time: t.t[k],
      operation: t.op[k] < 0 ? '' : this.d.op[t.op[k]],
    };
  }

  recipeCount(kind: RecipeKind): number { return this.tables[kind].out.length; }

  allRecipes(kind: RecipeKind): Recipe[] {
    const n = this.recipeCount(kind);
    const out: Recipe[] = new Array(n);
    for (let k = 0; k < n; k++) out[k] = this.recipe(kind, k);
    return out;
  }

  /** Recipes of `kind` that consume this item. */
  recipesUsing(kind: RecipeKind, i: number): Recipe[] {
    return this.asInput[kind][i].map((k) => this.recipe(kind, k));
  }

  /** Recipes of `kind` that produce this item. */
  recipesProducing(kind: RecipeKind, i: number): Recipe[] {
    return this.asOutput[kind][i].map((k) => this.recipe(kind, k));
  }

  /** True if anything at all references this item. */
  hasAnyRecipe(i: number): boolean {
    return (
      this.isCraftable(i) ||
      this.craftUsers[i].length > 0 ||
      this.asInput.refine[i].length > 0 ||
      this.asOutput.refine[i].length > 0 ||
      this.asInput.cook[i].length > 0 ||
      this.asOutput.cook[i].length > 0
    );
  }

  // ---- descriptions (lazy) ----------------------------------------------

  async loadDescriptions(base = 'data/'): Promise<void> {
    if (this.descs) return;
    const res = await fetch(`${base}desc.json`);
    if (!res.ok) throw new Error(`failed to load desc.json: ${res.status}`);
    this.descs = await res.json();
  }

  description(i: number): string | null {
    const d = this.descs?.[i];
    return d ? d : null;
  }
}

/** A node in the expanded crafting tree. */
export interface TreeNode {
  idx: number;
  qty: number;
  children: TreeNode[];
  /** Set when expansion stopped because the item repeats up its own branch. */
  cyclic?: boolean;
}

/**
 * Expand an item's crafting recipe down to leaves.
 *
 * `path` guards against an item appearing inside its own subtree - the game
 * data contains loops (notably in cooking), and without this the walk would
 * not terminate.
 */
export function craftTree(
  db: Db,
  idx: number,
  qty = 1,
  maxDepth = 12,
  path: ReadonlySet<number> = new Set(),
): TreeNode {
  if (path.has(idx)) return { idx, qty, children: [], cyclic: true };
  if (maxDepth <= 0 || !db.isCraftable(idx)) return { idx, qty, children: [] };

  const next = new Set(path);
  next.add(idx);
  const children = db.craftOf(idx).map((ing) =>
    craftTree(db, ing.idx, ing.qty * qty, maxDepth - 1, next),
  );
  return { idx, qty, children };
}

/** Sum a crafting tree's leaves into a raw-material shopping list. */
export function rawTotals(node: TreeNode): Map<number, number> {
  const totals = new Map<number, number>();
  const walk = (n: TreeNode) => {
    if (n.children.length === 0) {
      totals.set(n.idx, (totals.get(n.idx) ?? 0) + n.qty);
      return;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return totals;
}
