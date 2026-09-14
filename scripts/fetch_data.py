#!/usr/bin/env python3
"""Re-download the AssistantNMS dataset into data/raw/.

The data is published to npm as `assistantapps-nomanssky-info` (ISC licensed),
extracted from the No Man's Sky game files by the AssistantNMS project.
We pull the tarball straight from the npm registry so this works without Node.

Usage:  python3 scripts/fetch_data.py [--version 6.1.4990]
"""

import argparse
import io
import json
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

PACKAGE = "assistantapps-nomanssky-info"
REGISTRY = f"https://registry.npmjs.org/{PACKAGE}"
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"

# Item catalogues, the two standalone recipe tables, and the research trees.
# These live under assets/json/<lang>/ and are translated.
WANTED = [
    "RawMaterials", "Products", "Curiosity", "Cooking", "Technology",
    "TechnologyModule", "UpgradeModules", "ConstructedTechnology", "Buildings",
    "TradeItems", "ProceduralProducts", "Others", "Fishing",
    "Refinery", "NutrientProcessor", "TechTree",
]

# Language-independent tables under assets/data/. Recharge maps a technology to
# the items that refuel it, and carries no display strings of its own.
WANTED_DATA = ["Recharge"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="package version (default: latest)")
    ap.add_argument("--lang", default="en", help="language code (default: en)")
    args = ap.parse_args()

    print(f"querying {REGISTRY} ...")
    with urllib.request.urlopen(REGISTRY) as r:
        meta = json.load(r)

    version = args.version or meta["dist-tags"]["latest"]
    if version not in meta["versions"]:
        sys.exit(f"version {version} not found")
    tarball = meta["versions"][version]["dist"]["tarball"]
    print(f"version {version} (published {meta['time'][version][:10]})")

    print(f"downloading {tarball} ...")
    with urllib.request.urlopen(tarball) as r:
        blob = r.read()
    print(f"  {len(blob) / 1e6:.1f} MB")

    RAW.mkdir(parents=True, exist_ok=True)
    base = f"package/lib/assets/json/{args.lang}/"
    found = set()

    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        for name in WANTED:
            member = f"{base}{name}.lang.json"
            try:
                src = tf.extractfile(member)
            except KeyError:
                src = None
            if src is None:
                print(f"  !! missing {member}")
                continue
            with open(RAW / f"{name}.json", "wb") as out:
                shutil.copyfileobj(src, out)
            found.add(name)

        for name in WANTED_DATA:
            member = f"package/lib/assets/data/{name}.json"
            try:
                src = tf.extractfile(member)
            except KeyError:
                src = None
            if src is None:
                print(f"  !! missing {member}")
                continue
            with open(RAW / f"{name}.json", "wb") as out:
                shutil.copyfileobj(src, out)
            found.add(name)

        m = tf.extractfile("package/lib/assets/data/meta.json")
        if m is not None:
            with open(RAW / "meta.json", "wb") as out:
                shutil.copyfileobj(m, out)

    total = len(WANTED) + len(WANTED_DATA)
    print(f"wrote {len(found)}/{total} files to {RAW}")
    if (RAW / "meta.json").exists():
        gm = json.loads((RAW / "meta.json").read_text())
        print(f"game version {gm.get('GameVersion')}, generated {gm.get('GeneratedDate')}")
    return 0 if len(found) == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
