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
  withIcon?: number;
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
  treeCost: string[];
  creature: string[];
  harvest: string[];
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
  recharge: RechargeTable;
  techtree: TechTreeTable;
  harvest: HarvestTable;
}

interface HarvestTable {
  item: number[];
  creature: number[];
  desc: number[];
  kind: number[];
}

/** Where a harvestable item comes from. */
export interface Harvest {
  creature: string;
  /** "Collect Milk" and similar; null when the item drops on death. */
  method: string | null;
}

interface RechargeTable {
  item: number[];
  total: number[];
  off: number[];
  fuel: number[];
  val: number[];
}

interface TechTreeTable {
  names: string[];
  parent: number[];
  item: number[];
  label: (string | null)[];
  cost: number[];
  root: number[];
}

/** One fuel option for a rechargeable technology. */
export interface Fuel {
  idx: number;
  /** Charge restored per unit. */
  value: number;
  /** Units needed for a full refill. */
  unitsForFull: number;
}

export interface RechargeInfo {
  /** Full charge capacity of the technology. */
  total: number;
  fuels: Fuel[];
}

/** A node in a research tree: either an item or a category heading. */
export interface TreeEntry {
  /** Item index, or -1 for a category heading. */
  idx: number;
  /** Heading text; null when this node is an item. */
  label: string | null;
  costType: string | null;
  children: TreeEntry[];
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
  private readonly rc: RechargeTable;
  private readonly tt: TechTreeTable;
  /** item index -> slot in the recharge table */
  private readonly rechargeOf = new Map<number, number>();
  /** item index -> recharge slots this item can refuel */
  private readonly fuelFor: Map<number, number[]> = new Map();
  /** root tree index -> its top-level entries, built on demand */
  private readonly treeCache = new Map<number, TreeEntry[]>();
  /** item index -> how it is harvested from creatures */
  private readonly harvestOf = new Map<number, Harvest[]>();

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
    this.rc = core.recharge;
    this.tt = core.techtree;

    const hv = core.harvest;
    for (let k = 0; k < hv.item.length; k++) {
      const entry: Harvest = {
        creature: hv.creature[k] < 0 ? '?' : core.dicts.creature[hv.creature[k]],
        method: hv.desc[k] < 0 ? null : core.dicts.harvest[hv.desc[k]],
      };
      const list = this.harvestOf.get(hv.item[k]);
      if (list) list.push(entry);
      else this.harvestOf.set(hv.item[k], [entry]);
    }

    for (let i = 0; i < this.count; i++) this.byId.set(this.id(i), i);

    // Recharge lookups, both directions: what fuels this tech, and what tech
    // does this item fuel.
    for (let k = 0; k < this.rc.item.length; k++) {
      this.rechargeOf.set(this.rc.item[k], k);
      for (let x = this.rc.off[k]; x < this.rc.off[k + 1]; x++) {
        const f = this.rc.fuel[x];
        const list = this.fuelFor.get(f);
        if (list) list.push(k);
        else this.fuelFor.set(f, [k]);
      }
    }

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
      this.asOutput.cook[i].length > 0 ||
      this.rechargeOf.has(i) ||
      this.fuelFor.has(i)
    );
  }

  // ---- recharge ----------------------------------------------------------

  /** How this technology refuels, or null if it is not rechargeable. */
  recharge(i: number): RechargeInfo | null {
    const k = this.rechargeOf.get(i);
    if (k === undefined) return null;
    const total = this.rc.total[k];
    const fuels: Fuel[] = [];
    for (let x = this.rc.off[k]; x < this.rc.off[k + 1]; x++) {
      const value = this.rc.val[x];
      fuels.push({
        idx: this.rc.fuel[x],
        value,
        unitsForFull: value > 0 ? Math.ceil(total / value) : 0,
      });
    }
    // Most charge per unit first - that is the one worth carrying.
    fuels.sort((a, b) => b.value - a.value);
    return { total, fuels };
  }

  /** Technologies this item can refuel, with the charge it gives each. */
  rechargesWhat(i: number): { idx: number; value: number; total: number }[] {
    const slots = this.fuelFor.get(i);
    if (!slots) return [];
    const out: { idx: number; value: number; total: number }[] = [];
    for (const k of slots) {
      for (let x = this.rc.off[k]; x < this.rc.off[k + 1]; x++) {
        if (this.rc.fuel[x] === i) {
          out.push({ idx: this.rc.item[k], value: this.rc.val[x],
                     total: this.rc.total[k] });
          break;
        }
      }
    }
    return out;
  }

  // ---- research trees ----------------------------------------------------

  get treeNames(): string[] { return this.tt.names; }

  /** Top-level entries of one research tree, as a nested structure. */
  tree(root: number): TreeEntry[] {
    const cached = this.treeCache.get(root);
    if (cached) return cached;

    const nodes: (TreeEntry | null)[] = new Array(this.tt.parent.length).fill(null);
    const roots: TreeEntry[] = [];
    const costs = this.d.treeCost;

    for (let k = 0; k < this.tt.parent.length; k++) {
      if (this.tt.root[k] !== root) continue;
      const entry: TreeEntry = {
        idx: this.tt.item[k],
        label: this.tt.label[k],
        costType: this.tt.cost[k] < 0 ? null : costs[this.tt.cost[k]],
        children: [],
      };
      nodes[k] = entry;
      const p = this.tt.parent[k];
      // Nodes are emitted parent-before-child, so the parent already exists.
      const parent = p >= 0 ? nodes[p] : null;
      if (parent) parent.children.push(entry);
      else roots.push(entry);
    }

    this.treeCache.set(root, roots);
    return roots;
  }

  /** Research trees that contain this item, by root index. */
  treesContaining(i: number): number[] {
    const out = new Set<number>();
    for (let k = 0; k < this.tt.item.length; k++) {
      if (this.tt.item[k] === i) out.add(this.tt.root[k]);
    }
    return [...out];
  }

  // ---- creature harvesting -----------------------------------------------

  /** Creatures this item can be harvested from. */
  harvestedFrom(i: number): Harvest[] {
    return this.harvestOf.get(i) ?? [];
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

/** How a tree node's children are produced. */
export type Via =
  | { kind: 'craft' }
  | {
      kind: 'refine';
      operation: string;
      /** Refiner runs needed to reach the node's quantity. */
      runs: number;
      /** Output produced per run. */
      outputPer: number;
    };

/** A node in the expanded production tree. */
export interface TreeNode {
  idx: number;
  qty: number;
  children: TreeNode[];
  /** How `children` produce this node; absent on leaves. */
  via?: Via;
  /** Set when expansion stopped because the item repeats up its own branch. */
  cyclic?: boolean;
}

export interface TreeOptions {
  /** Follow refiner recipes for items that have no crafting recipe. */
  includeRefining?: boolean;
  maxDepth?: number;
  /**
   * How many refiner steps to chain. Crafting chains are finite and meaningful,
   * but almost everything can be refined from something else - Carbon from
   * Fungal Mould, Fungal Mould from ... - so an unbounded walk wanders far past
   * the point of being useful. One step answers the actual question ("what do I
   * put in the refiner to get this?") and keeps the totals honest: stopping at
   * Carbon is more useful than claiming you need Fungal Mould.
   */
  maxRefineDepth?: number;
}

/** Input cost per unit of output, using item value as a scarcity proxy. */
function costPerUnit(db: Db, r: Recipe): number {
  const total = r.inputs.reduce((t, i) => t + i.qty * db.value(i.idx), 0);
  return total / (r.output.qty || 1);
}

/**
 * Pick which refiner recipe to expand when several produce the same item.
 *
 * Two traps here, both found by expanding Antimatter:
 *
 * 1. Ranking by output-per-run picks the *rarest* input (it chose Activated
 *    Indium over Copper for Chromatic Metal). Item value proxies scarcity, so
 *    we rank by input cost per unit of output instead.
 *
 * 2. Many refiner recipes are sidegrades rather than decompositions - the
 *    atmospheric gases convert into each other in a loop (Nitrogen -> Radon ->
 *    Sulphurine -> Nitrogen). Following those "downwards" exploded a single
 *    Antimatter into 1,080 Nitrogen. A genuine decomposition builds something
 *    valuable out of cheaper parts, so we only follow a recipe whose inputs
 *    are worth no more than its output. That prunes the loops at their source.
 */
function bestRefine(db: Db, candidates: Recipe[]): Recipe | null {
  const outputValue = candidates.length ? db.value(candidates[0].output.idx) : 0;
  // With no value to compare against we cannot tell a decomposition from a
  // sidegrade, so leave the item as a leaf rather than guess.
  if (!outputValue) return null;

  const worthwhile = candidates.filter(
    (r) =>
      r.inputs.every((i) => db.value(i.idx) > 0) &&
      costPerUnit(db, r) <= outputValue,
  );
  if (!worthwhile.length) return null;

  // Rank by the priciest material a recipe demands, cheapest first. Cost per
  // unit of output alone recommends Activated Indium for Chromatic Metal - it
  // yields 4 per unit so it "wins" on efficiency - but it only occurs in blue
  // systems. Copper is a third of the price and found in far more places, and
  // that is what a player actually wants to be told.
  const dearestInput = (r: Recipe) =>
    r.inputs.reduce((max, i) => Math.max(max, db.value(i.idx)), 0);

  return worthwhile.sort((a, b) => {
    const da = dearestInput(a);
    const db_ = dearestInput(b);
    if (da !== db_) return da - db_;
    // Single-input recipes are simpler to actually run.
    if (a.inputs.length !== b.inputs.length) return a.inputs.length - b.inputs.length;
    const ca = costPerUnit(db, a);
    const cb = costPerUnit(db, b);
    if (ca !== cb) return ca - cb;
    return b.output.qty - a.output.qty || a.k - b.k;
  })[0];
}

/**
 * Expand an item down to its base materials.
 *
 * Follows crafting recipes first, then refiner recipes - in No Man's Sky most
 * of the depth lives in refining, so a craft-only walk stops almost
 * immediately (Antimatter's ingredients are both refined, not crafted).
 *
 * `path` guards against an item appearing inside its own subtree. The game
 * data contains loops, so without this the walk would not terminate.
 */
export function craftTree(
  db: Db,
  idx: number,
  qty = 1,
  opts: TreeOptions = {},
  path: ReadonlySet<number> = new Set(),
): TreeNode {
  const { includeRefining = true, maxDepth = 12, maxRefineDepth = 1 } = opts;

  if (path.has(idx)) return { idx, qty, children: [], cyclic: true };
  if (maxDepth <= 0) return { idx, qty, children: [] };

  const next = new Set(path);
  next.add(idx);
  const recurse = (i: number, q: number, refineBudget: number) =>
    craftTree(
      db, i, q,
      { includeRefining, maxDepth: maxDepth - 1, maxRefineDepth: refineBudget },
      next,
    );

  if (db.isCraftable(idx)) {
    return {
      idx,
      qty,
      via: { kind: 'craft' },
      // Crafting does not spend the refining budget.
      children: db.craftOf(idx).map((ing) => recurse(ing.idx, ing.qty * qty, maxRefineDepth)),
    };
  }

  if (includeRefining && maxRefineDepth > 0) {
    // Skip recipes that consume the item they produce, and prefer ones whose
    // inputs are not already above us - otherwise we would pick a loop when a
    // straightforward route exists.
    const producing = db
      .recipesProducing('refine', idx)
      .filter((r) => !r.inputs.some((i) => i.idx === idx));
    const acyclic = producing.filter((r) => !r.inputs.some((i) => path.has(i.idx)));
    const chosen = bestRefine(db, acyclic.length ? acyclic : producing);

    if (chosen) {
      const outputPer = chosen.output.qty || 1;
      const runs = Math.ceil(qty / outputPer);
      return {
        idx,
        qty,
        via: {
          kind: 'refine',
          operation: chosen.operation,
          runs,
          outputPer,
        },
        children: chosen.inputs.map((i) =>
          recurse(i.idx, i.qty * runs, maxRefineDepth - 1),
        ),
      };
    }
  }

  return { idx, qty, children: [] };
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
