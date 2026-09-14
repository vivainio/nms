#!/usr/bin/env python3
"""Mirror item icons locally, downscaled to WebP.

The upstream CDN serves full-resolution PNGs - some are over 1 MB - and the
site renders them at 34-72px. Pulling those per visitor would waste tens of
megabytes per page load of someone else's bandwidth, so we fetch each icon
once, downscale it, and serve it from our own origin.

Resumable: existing output files are skipped, so an interrupted run continues
where it left off.

Usage:
  python3 scripts/mirror_icons.py                # all icons
  python3 scripts/mirror_icons.py --limit 20     # sample, for sizing
  python3 scripts/mirror_icons.py --size 96      # larger output
"""

import argparse
import io
import json
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "public" / "data" / "core.json"
OUT = ROOT / "public" / "icons"

print_lock = threading.Lock()


def icon_paths(core) -> list[str]:
    """Every distinct `dir/N.png` path referenced by the dataset."""
    D, col = core["dicts"], core["items"]
    literal = core["iconLiteral"]
    paths = []
    for i in range(core["meta"]["count"]):
        lit = literal.get(str(i))
        if lit:
            paths.append(lit)
        elif col["icd"][i] >= 0:
            paths.append(f"{D['iconDir'][col['icd'][i]]}/{col['icn'][i]}.png")
    return sorted(set(paths))


def fetch_one(cdn: str, rel: str, size: int, quality: int, retries: int = 3):
    dest = OUT / rel.replace(".png", ".webp")
    if dest.exists():
        return ("skip", dest.stat().st_size, 0)

    url = cdn + rel
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "nms-ref/0.1"})
            with urllib.request.urlopen(req, timeout=30) as r:
                blob = r.read()
            break
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            if attempt == retries - 1:
                with print_lock:
                    print(f"  !! {rel}: {e}", file=sys.stderr)
                return ("fail", 0, 0)
    else:
        return ("fail", 0, 0)

    try:
        im = Image.open(io.BytesIO(blob))
        im = im.convert("RGBA")
        # thumbnail preserves aspect ratio and never upscales.
        im.thumbnail((size, size), Image.Resampling.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "WEBP", quality=quality, method=6)
    except Exception as e:  # noqa: BLE001 - report and continue
        with print_lock:
            print(f"  !! {rel}: decode/encode failed: {e}", file=sys.stderr)
        return ("fail", 0, len(blob))

    return ("ok", dest.stat().st_size, len(blob))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="only process the first N icons")
    ap.add_argument("--size", type=int, default=96, help="max edge px (default 96)")
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    core = json.loads(CORE.read_text(encoding="utf-8"))
    cdn = core["meta"]["cdn"]
    paths = icon_paths(core)
    if args.limit:
        paths = paths[: args.limit]

    print(f"{len(paths)} icons -> {OUT.relative_to(ROOT)} "
          f"at {args.size}px webp q{args.quality}")

    done = src_bytes = out_bytes = 0
    counts = {"ok": 0, "skip": 0, "fail": 0}

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(fetch_one, cdn, p, args.size, args.quality)
                   for p in paths]
        for f in futures:
            status, osz, ssz = f.result()
            counts[status] += 1
            out_bytes += osz
            src_bytes += ssz
            done += 1
            if done % 250 == 0 or done == len(paths):
                with print_lock:
                    print(f"  {done}/{len(paths)}  "
                          f"ok={counts['ok']} skip={counts['skip']} fail={counts['fail']}  "
                          f"{out_bytes / 1e6:.1f} MB written")

    print()
    print(f"ok {counts['ok']}  skipped {counts['skip']}  failed {counts['fail']}")
    if src_bytes:
        print(f"downloaded {src_bytes / 1e6:.1f} MB -> wrote {out_bytes / 1e6:.1f} MB "
              f"({100 * out_bytes / src_bytes:.1f}%)")
        n = counts["ok"]
        if n:
            print(f"average {src_bytes / n / 1024:.0f} KB source "
                  f"-> {out_bytes / n / 1024:.1f} KB output")
    return 1 if counts["fail"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
