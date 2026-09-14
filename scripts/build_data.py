#!/usr/bin/env python3
"""Transform the raw AssistantNMS dumps into the compact bundle the site loads.

Reads  data/raw/*.json
Writes public/data/core.json   (browse + search + recipes)
       public/data/desc.json   (descriptions, fetched lazily on first detail view)

The output is columnar and dictionary-encoded rather than an array of objects:

  * Every item gets an integer index; all recipe references use that index, so
    no item id string is ever repeated.
  * Repeated strings (group, colour, currency, operation, ...) live in a
    dictionary array and are referenced by index.
  * Item ids and icon paths are almost entirely `prefix + number`, so we store
    a prefix index and an integer, with an escape map for the few exceptions.
  * Recipes use CSR-style flat arrays (offsets + values) instead of nested
    objects, which removes all the repeated `{"id":..,"qty":..}` key names.

See src/lib/db.ts for the decoder.

Usage:  python3 scripts/build_data.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"

# source file -> (category key, human label)
CATEGORIES = [
    ("RawMaterials",          "raw",         "Raw Material"),
    ("Products",              "product",     "Product"),
    ("Curiosity",             "curio",       "Curiosity"),
    ("Cooking",               "cooking",     "Cooking"),
    ("Technology",            "tech",        "Technology"),
    ("TechnologyModule",      "techmod",     "Tech Module"),
    ("UpgradeModules",        "upgrade",     "Upgrade Module"),
    ("ConstructedTechnology", "constructed", "Constructed Tech"),
    ("Buildings",             "building",    "Building"),
    ("TradeItems",            "trade",       "Trade Item"),
    ("ProceduralProducts",    "procproduct", "Procedural Product"),
    ("Fishing",               "fish",        "Fish"),
    ("Others",                "other",       "Other"),
]

# NMS inline markup: <TECHNOLOGY>some text<>  ->  plain text.
MARKUP = re.compile(r"<([A-Z_]+)>(.*?)<>", re.S)
# Runtime placeholder markers the game substitutes at display time, e.g.
# "Current Bait: <%NAMETAG%>%BAIT%". The <%..%> part is a colour marker.
PLACEHOLDER_TAG = re.compile(r"<%[A-Z_]+%>")
# A few entries in the dump have an unterminated opener, e.g. Sodium's
# "<CATALYSTsodium-rich flora." - drop the tag, keep the words.
BROKEN_OPEN = re.compile(r"<(?:CATALYST|TECHNOLOGY|FUEL|PRODUCT|SPECIAL|COMMODITY)(?![A-Z_]*>)")

SPLIT_ID = re.compile(r"([A-Za-z]+)(\d+)$")
SPLIT_ICON = re.compile(r"([A-Za-z0-9_-]+)/(\d+)\.png$")


class Dict_:
    """Interns strings, returning a stable index. -1 means absent."""

    def __init__(self):
        self.index = {}
        self.values = []

    def __call__(self, s) -> int:
        if s is None or s == "":
            return -1
        i = self.index.get(s)
        if i is None:
            i = len(self.values)
            self.index[s] = i
            self.values.append(s)
        return i


def clean_description(text: str) -> str:
    """Strip NMS colour markup, keeping the inner text."""
    if not text:
        return ""
    prev = None
    # Tags can nest/repeat; loop until stable.
    while prev != text:
        prev = text
        text = MARKUP.sub(lambda m: m.group(2), text)
    text = PLACEHOLDER_TAG.sub("", text)
    text = BROKEN_OPEN.sub("", text)
    text = text.replace("<>", "")
    # Collapse the padded blank lines the game files use (" \n \n").
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def num(v, default=0):
    if v is None:
        return default
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return int(f) if f == int(f) else f


def load(name: str):
    p = RAW / f"{name}.json"
    if not p.exists():
        raise SystemExit(f"missing {p} - run scripts/fetch_data.py first")
    return json.loads(p.read_text(encoding="utf-8"))


def main() -> int:
    meta_raw = json.loads((RAW / "meta.json").read_text(encoding="utf-8"))

    # ---- pass 1: collect items in a flat list, index by id -----------------
    rows = []
    index_of = {}

    for fname, cat, _label in CATEGORIES:
        for it in load(fname):
            iid = it.get("Id")
            name = (it.get("Name") or "").strip()
            if not iid or not name:
                continue
            if iid in index_of:
                print(f"  !! duplicate id {iid} in {fname}, skipping")
                continue
            index_of[iid] = len(rows)
            rows.append((cat, it, name))

    n = len(rows)

    # ---- pass 2: encode columns -------------------------------------------
    d_cat, d_group, d_colour = Dict_(), Dict_(), Dict_()
    d_currency, d_bpt = Dict_(), Dict_()
    d_idpre, d_icondir = Dict_(), Dict_()

    col = {k: [] for k in
           ("n", "c", "g", "col", "idp", "idn", "icd", "icn",
            "v", "cur", "st", "cv", "bpc", "bpt")}
    id_literal, icon_literal = {}, {}
    descriptions = []

    for i, (cat, it, name) in enumerate(rows):
        col["n"].append(name)
        col["c"].append(d_cat(cat))
        col["g"].append(d_group(it.get("Group")))
        col["col"].append(d_colour(it.get("Colour")))

        iid = it["Id"]
        m = SPLIT_ID.fullmatch(iid)
        if m:
            col["idp"].append(d_idpre(m.group(1)))
            col["idn"].append(int(m.group(2)))
        else:
            col["idp"].append(-1)
            col["idn"].append(-1)
            id_literal[str(i)] = iid

        icon = it.get("Icon") or ""
        mi = SPLIT_ICON.fullmatch(icon)
        if mi:
            col["icd"].append(d_icondir(mi.group(1)))
            col["icn"].append(int(mi.group(2)))
        else:
            col["icd"].append(-1)
            col["icn"].append(-1)
            if icon:
                icon_literal[str(i)] = icon

        col["v"].append(num(it.get("BaseValueUnits")))
        col["cur"].append(d_currency(it.get("CurrencyType")))
        col["st"].append(num(it.get("MaxStackSize")))
        col["cv"].append(num(it.get("CookingValue")))
        col["bpc"].append(num(it.get("BlueprintCost")))
        col["bpt"].append(d_bpt(it.get("BlueprintCostType")))

        descriptions.append(clean_description(it.get("Description") or ""))

    # ---- crafting recipes, CSR-style --------------------------------------
    craft_off, craft_it, craft_q = [0], [], []
    dangling = 0
    for _cat, it, _name in rows:
        for ri in (it.get("RequiredItems") or []):
            j = index_of.get(ri.get("Id"))
            if j is None:
                dangling += 1
                continue
            craft_it.append(j)
            craft_q.append(num(ri.get("Quantity"), 1))
        craft_off.append(len(craft_it))
    if dangling:
        print(f"  dropped {dangling} dangling craft ingredient(s)")

    # ---- refiner / cooking recipes ----------------------------------------
    d_op = Dict_()

    def recipes(fname: str, id_prefix: str):
        off, inp, inq = [0], [], []
        out, outq, time, ops, rid = [], [], [], [], []
        dropped = 0
        for r in load(fname):
            output = r.get("Output") or {}
            oj = index_of.get(output.get("Id"))
            ins = [(index_of.get(x.get("Id")), num(x.get("Quantity"), 1))
                   for x in (r.get("Inputs") or [])]
            # A handful of rows in the dump have blank ids - drop them rather
            # than render a recipe pointing at nothing.
            if oj is None or not ins or any(j is None for j, _ in ins):
                dropped += 1
                continue
            for j, q in ins:
                inp.append(j)
                inq.append(q)
            off.append(len(inp))
            out.append(oj)
            outq.append(num(output.get("Quantity"), 1))
            time.append(num(r.get("Time")))
            op = (r.get("Operation") or "").split(":", 1)
            ops.append(d_op(op[1].strip() if len(op) == 2 else op[0].strip()))
            m = SPLIT_ID.fullmatch(r.get("Id") or "")
            rid.append(int(m.group(2)) if m else -1)
        if dropped:
            print(f"  {fname}: dropped {dropped} malformed recipe(s)")
        return {"prefix": id_prefix, "rid": rid, "off": off, "in": inp,
                "inq": inq, "out": out, "outq": outq, "t": time, "op": ops}

    refine = recipes("Refinery", "ref")
    cook = recipes("NutrientProcessor", "nut")

    # ---- emit --------------------------------------------------------------
    core = {
        "meta": {
            "gameVersion": meta_raw.get("GameVersion"),
            "gameBuild": meta_raw.get("GameBuildNumber"),
            "generated": meta_raw.get("GeneratedDate"),
            "source": "AssistantNMS (assistantapps-nomanssky-info, ISC)",
            "cdn": "https://cdn.nmsassistant.com/",
            "count": n,
        },
        "catLabels": [label for _, _, label in CATEGORIES],
        "dicts": {
            "cat": d_cat.values,
            "group": d_group.values,
            "colour": d_colour.values,
            "currency": d_currency.values,
            "bpCostType": d_bpt.values,
            "idPrefix": d_idpre.values,
            "iconDir": d_icondir.values,
            "op": d_op.values,
        },
        "items": col,
        "idLiteral": id_literal,
        "iconLiteral": icon_literal,
        "craft": {"off": craft_off, "it": craft_it, "q": craft_q},
        "refine": refine,
        "cook": cook,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    dump = lambda o: json.dumps(o, separators=(",", ":"), ensure_ascii=False)
    (OUT / "core.json").write_text(dump(core), encoding="utf-8")
    (OUT / "desc.json").write_text(dump(descriptions), encoding="utf-8")

    craftable = sum(1 for i in range(n) if craft_off[i + 1] > craft_off[i])
    kb = lambda p: (OUT / p).stat().st_size / 1024
    print(f"items      {n} ({craftable} craftable)")
    print(f"refine     {len(refine['out'])}")
    print(f"cook       {len(cook['out'])}")
    print(f"dicts      group={len(d_group.values)} colour={len(d_colour.values)} "
          f"op={len(d_op.values)}")
    print(f"escapes    id={len(id_literal)} icon={len(icon_literal)}")
    print(f"-> core.json {kb('core.json'):8.1f} KB")
    print(f"-> desc.json {kb('desc.json'):8.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
