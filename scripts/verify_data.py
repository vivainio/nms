#!/usr/bin/env python3
"""Decode public/data/core.json and diff it against data/raw/ to prove the
columnar encoding is lossless. Run after build_data.py.

Usage:  python3 scripts/verify_data.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import CATEGORIES, clean_description, icon_path, num  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"

errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)


def main() -> int:
    core = json.loads((OUT / "core.json").read_text(encoding="utf-8"))
    descs = json.loads((OUT / "desc.json").read_text(encoding="utf-8"))
    D, col = core["dicts"], core["items"]
    n = core["meta"]["count"]

    def s(dict_name, i):
        return None if i < 0 else D[dict_name][i]

    # -- rebuild the decoded view -------------------------------------------
    def item_id(i):
        lit = core["idLiteral"].get(str(i))
        if lit is not None:
            return lit
        return f"{D['idPrefix'][col['idp'][i]]}{col['idn'][i]}"

    def icon(i):
        lit = core["iconLiteral"].get(str(i))
        if lit is not None:
            return lit
        if col["icd"][i] < 0:
            return ""
        return f"{D['iconDir'][col['icd'][i]]}/{col['icn'][i]}.png"

    decoded = {}
    for i in range(n):
        decoded[item_id(i)] = {
            "idx": i,
            "Name": col["n"][i],
            "Group": s("group", col["g"][i]),
            "Colour": s("colour", col["col"][i]),
            "Icon": icon(i),
            "Value": col["v"][i],
            "Currency": s("currency", col["cur"][i]),
            "Stack": col["st"][i],
            "CookingValue": col["cv"][i],
            "BlueprintCost": col["bpc"][i],
            "BlueprintCostType": s("bpCostType", col["bpt"][i]),
            "Description": descs[i],
        }

    check(len(decoded) == n, f"id collision after decode: {len(decoded)} != {n}")
    check(len(descs) == n, f"desc length {len(descs)} != {n}")

    # -- compare against source ---------------------------------------------
    seen, compared = set(), 0
    src_by_id = {}
    for fname, _cat, _label in CATEGORIES:
        for it in json.loads((RAW / f"{fname}.json").read_text(encoding="utf-8")):
            iid, name = it.get("Id"), (it.get("Name") or "").strip()
            if not iid or not name or iid in seen:
                continue
            seen.add(iid)
            src_by_id[iid] = it

            got = decoded.get(iid)
            if got is None:
                errors.append(f"{iid}: missing from encoded output")
                continue
            compared += 1
            check(got["Name"] == name, f"{iid}: name {got['Name']!r} != {name!r}")
            check(got["Group"] == (it.get("Group") or None),
                  f"{iid}: group mismatch")
            check(got["Colour"] == (it.get("Colour") or None),
                  f"{iid}: colour mismatch")
            check(got["Icon"] == icon_path(it),
                  f"{iid}: icon {got['Icon']!r} != {icon_path(it)!r}")
            check(got["Value"] == num(it.get("BaseValueUnits")),
                  f"{iid}: value mismatch")
            check(got["Currency"] == (it.get("CurrencyType") or None),
                  f"{iid}: currency mismatch")
            check(got["Stack"] == num(it.get("MaxStackSize")),
                  f"{iid}: stack mismatch")
            check(got["CookingValue"] == num(it.get("CookingValue")),
                  f"{iid}: cookValue mismatch")
            check(got["BlueprintCost"] == num(it.get("BlueprintCost")),
                  f"{iid}: bpCost mismatch")
            check(got["BlueprintCostType"] == (it.get("BlueprintCostType") or None),
                  f"{iid}: bpCostType mismatch")
            check(got["Description"] == clean_description(it.get("Description") or ""),
                  f"{iid}: description mismatch")

    check(compared == n, f"compared {compared} items, encoded {n}")

    # -- crafting recipes ----------------------------------------------------
    craft, craft_checked = core["craft"], 0
    check(len(craft["off"]) == n + 1, "craft offsets length wrong")
    for iid, it in src_by_id.items():
        i = decoded[iid]["idx"]
        a, b = craft["off"][i], craft["off"][i + 1]
        got = [(item_id(craft["it"][k]), craft["q"][k]) for k in range(a, b)]
        want = [(r["Id"], num(r.get("Quantity"), 1))
                for r in (it.get("RequiredItems") or []) if r.get("Id") in src_by_id]
        check(got == want, f"{iid}: craft {got} != {want}")
        craft_checked += len(want)

    # -- refiner / cooking ---------------------------------------------------
    def check_recipes(key, fname):
        enc = core[key]
        src = json.loads((RAW / f"{fname}.json").read_text(encoding="utf-8"))
        valid = []
        for r in src:
            o = r.get("Output") or {}
            ins = r.get("Inputs") or []
            if (o.get("Id") in src_by_id and ins
                    and all(x.get("Id") in src_by_id for x in ins)):
                valid.append(r)
        check(len(enc["out"]) == len(valid),
              f"{key}: {len(enc['out'])} encoded vs {len(valid)} valid in source")
        for k, r in enumerate(valid):
            a, b = enc["off"][k], enc["off"][k + 1]
            got_in = [(item_id(enc["in"][x]), enc["inq"][x]) for x in range(a, b)]
            want_in = [(x["Id"], num(x.get("Quantity"), 1)) for x in r["Inputs"]]
            check(got_in == want_in, f"{key}[{k}]: inputs {got_in} != {want_in}")
            o = r["Output"]
            check(item_id(enc["out"][k]) == o["Id"], f"{key}[{k}]: output mismatch")
            check(enc["outq"][k] == num(o.get("Quantity"), 1),
                  f"{key}[{k}]: output qty mismatch")
            check(enc["t"][k] == num(r.get("Time")), f"{key}[{k}]: time mismatch")
        return len(valid)

    nref = check_recipes("refine", "Refinery")
    ncook = check_recipes("cook", "NutrientProcessor")

    # -- recharge ------------------------------------------------------------
    rc = core["recharge"]
    raw_rc = json.loads((RAW / "Recharge.json").read_text(encoding="utf-8"))
    expected_rc = []
    for r in raw_rc:
        if r.get("Id") not in src_by_id:
            continue
        fuels = [(c["Id"], num(c.get("Value")))
                 for c in (r.get("ChargeBy") or [])
                 if c.get("Id") in src_by_id and num(c.get("Value"))]
        if fuels:
            expected_rc.append((r["Id"], num(r.get("TotalChargeAmount")), fuels))
    check(len(rc["item"]) == len(expected_rc),
          f"recharge: {len(rc['item'])} encoded vs {len(expected_rc)} expected")
    for k, (iid, total, fuels) in enumerate(expected_rc):
        if k >= len(rc["item"]):
            break
        check(item_id(rc["item"][k]) == iid, f"recharge[{k}]: item mismatch")
        check(rc["total"][k] == total, f"recharge[{k}]: total mismatch")
        a, b = rc["off"][k], rc["off"][k + 1]
        got = [(item_id(rc["fuel"][x]), rc["val"][x]) for x in range(a, b)]
        check(got == fuels, f"recharge[{k}]: fuels {got} != {fuels}")

    # -- research trees ------------------------------------------------------
    tt = core["techtree"]
    raw_tt = json.loads((RAW / "TechTree.json").read_text(encoding="utf-8"))

    # Replay the same walk (and the same skip rule) the encoder used.
    expected_nodes = []

    def walk(node, root):
        nid = node.get("Id") or ""
        label = node.get("Name") or None
        known = nid in src_by_id
        if known or label is not None:
            expected_nodes.append(
                (nid if known else None, None if known else label,
                 node.get("CostType"), root))
        for c in (node.get("Children") or []):
            walk(c, root)

    for root, t in enumerate(raw_tt):
        for top in (t.get("Trees") or []):
            walk(top, root)

    check(len(tt["names"]) == len(raw_tt),
          f"techtree: {len(tt['names'])} trees vs {len(raw_tt)}")
    check(len(tt["parent"]) == len(expected_nodes),
          f"techtree: {len(tt['parent'])} nodes vs {len(expected_nodes)} expected")
    costs = core["dicts"]["treeCost"]
    for k, (iid, label, cost, root) in enumerate(expected_nodes):
        if k >= len(tt["parent"]):
            break
        got_item = item_id(tt["item"][k]) if tt["item"][k] >= 0 else None
        check(got_item == iid, f"techtree[{k}]: item {got_item} != {iid}")
        check(tt["label"][k] == label, f"techtree[{k}]: label mismatch")
        got_cost = costs[tt["cost"][k]] if tt["cost"][k] >= 0 else None
        check(got_cost == (cost or None), f"techtree[{k}]: cost mismatch")
        check(tt["root"][k] == root, f"techtree[{k}]: root mismatch")
        p = tt["parent"][k]
        check(p == -1 or 0 <= p < k, f"techtree[{k}]: parent {p} out of range")

    # -- creature harvesting -------------------------------------------------
    hv = core["harvest"]
    raw_hv = json.loads((RAW / "CreatureHarvest.json").read_text(encoding="utf-8"))
    expected_hv = [r for r in raw_hv if r.get("ItemId") in src_by_id]
    check(len(hv["item"]) == len(expected_hv),
          f"harvest: {len(hv['item'])} encoded vs {len(expected_hv)} expected")
    creatures, harvests = core["dicts"]["creature"], core["dicts"]["harvest"]
    for k, r in enumerate(expected_hv):
        if k >= len(hv["item"]):
            break
        check(item_id(hv["item"][k]) == r["ItemId"], f"harvest[{k}]: item mismatch")
        got_c = creatures[hv["creature"][k]] if hv["creature"][k] >= 0 else None
        check(got_c == (r.get("CreatureType") or None),
              f"harvest[{k}]: creature mismatch")
        got_d = harvests[hv["desc"][k]] if hv["desc"][k] >= 0 else None
        check(got_d == (r.get("Description") or None),
              f"harvest[{k}]: description mismatch")
        check(hv["kind"][k] == num(r.get("HarvestType")),
              f"harvest[{k}]: harvest type mismatch")

    # -- report --------------------------------------------------------------
    if errors:
        print(f"FAILED - {len(errors)} problem(s):")
        for e in errors[:25]:
            print("  -", e)
        if len(errors) > 25:
            print(f"  ... and {len(errors) - 25} more")
        return 1

    print("OK - encoding is lossless")
    print(f"  {compared} items round-tripped (all fields + descriptions)")
    print(f"  {craft_checked} craft ingredients")
    print(f"  {nref} refiner + {ncook} cooking recipes")
    print(f"  {len(expected_rc)} recharge entries")
    print(f"  {len(tt['names'])} research trees, {len(expected_nodes)} nodes")
    print(f"  {len(expected_hv)} creature harvest entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
