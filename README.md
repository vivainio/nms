# NMS Reference

A fast, browsable reference for No Man's Sky crafting, refining and cooking.
Static site, no backend, no framework.

## Features

- **Category landing** — 13 categories with item and craftable counts, so
  building blueprints (882 of them) and technology are one tap away.
- **Browse + search** all 3,769 items, filterable by category.
- **Item detail** with a full breakdown expanded down to base materials, through
  both crafting *and* refining, plus a summed "total base materials" list.
  Antimatter resolves to 50 Copper + 40 Carbon.
- **Reverse lookup** — every recipe that consumes the item you're looking at.
- **Creature harvesting** — which creatures yield an item, and how.
- **Refiner and cooking tables** with all 357 refiner and 1,321 cooking recipes.
- **Recharge info** — what refuels a technology, how much charge each unit
  gives, and how many units a full refill takes; plus the reverse ("what does
  Sodium recharge?").
- **Research trees** — 10 unlock trees, 242 nodes, each linking to its item.

## Getting started

```sh
npm install
npm run dev
```

The data bundle is committed under `public/data/`, so the site runs immediately.

## Data

Game data comes from [Assistant for No Man's Sky][anms], which extracts it from
the game files and publishes it to npm as `assistantapps-nomanssky-info` (ISC).
Item art is served from their CDN. See [NOTICE.md](NOTICE.md) for attribution
and licensing. This project is not affiliated with Hello Games or AssistantApps.

Currently pinned to **game version 6.01** (extracted 2025-08-28).

To refresh:

```sh
python3 scripts/fetch_data.py     # download latest dump into data/raw/
python3 scripts/build_data.py     # encode into public/data/
python3 scripts/verify_data.py    # prove the encoding is lossless
python3 scripts/mirror_icons.py   # mirror icons (needs Pillow; resumable)
```

The first three use only the Python standard library — no Node or pip needed.
`data/raw/` is committed so builds are reproducible offline.

### Icons

Icons are mirrored into `public/icons/` and downscaled to 96px WebP. Upstream
PNGs average **348 KB** (some exceed 1 MB) and are rendered here at 34–72px, so
hotlinking them would pull tens of megabytes per page view off someone else's
CDN. The mirror is 986 files totalling **4.4 MB** — 1.2% of the 351 MB of
source PNGs.

Only 1,121 of the 3,769 items have artwork. The other 2,648 get a placeholder
glyph picked from the item's group — a ship part, a room, a meal and a damaged
component are all distinguishable at a glance. 77% are matched on a group
keyword and the rest fall back to their category; see
[`src/lib/glyphs.ts`](src/lib/glyphs.ts). Glyphs are deliberately *not* tinted
with the item's colour, because many of those are near-black (Starship
Components are `#1A2733`) and vanish against the dark theme.

One trap worth knowing if you touch the pipeline: each item carries both an
`Icon` and a `CdnUrl` field, and **they disagree for ~5% of items**. `CdnUrl` is
the authoritative one — sampling the CDN, every item with a `CdnUrl` returns
200, while items having only `Icon` 404 about 87% of the time. Only 1,121 of the
3,769 items have artwork at all; the rest render a placeholder rather than
requesting a URL that does not exist.

### Wire format

The naive encoding of this dataset is ~1.7 MB (196 KB gzipped). The bundle the
site actually loads is **318 KB (60 KB gzipped)**, roughly a 3× reduction on the
critical path, achieved by removing every repeated string:

| Technique | What it removes |
| --- | --- |
| Columnar layout (parallel arrays, not objects) | ~3,769 copies of each JSON key name |
| Integer item indexes in all recipe references | every repeated `"raw1"`-style id |
| Dictionary encoding (`group`, `colour`, `currency`, `operation`, …) | 3,769 group strings → 821 unique |
| `prefix + number` splitting for ids and icon paths | 11 icon directory strings instead of 3,769 paths |
| CSR-style flat arrays for recipes | every `{"id":…,"qty":…}` key pair |
| Descriptions split into `desc.json` | 734 KB deferred until the first detail view |

Descriptions are **52%** of the total payload and are only needed on the item
page, so browse and the recipe tables never fetch them.

`scripts/verify_data.py` decodes the bundle and diffs every field of every item
and recipe against `data/raw/`, so the compression can't silently drop data.
The decoder lives in [`src/lib/db.ts`](src/lib/db.ts).

### Choosing a refiner route

Most depth in No Man's Sky lives in refining, not crafting, so the breakdown
follows refiner recipes too. That needs an opinion about *which* recipe to show,
since 25 recipes produce Chromatic Metal. Three rules, each added because the
naive version produced something wrong:

1. **Only follow value-adding steps.** Many refiner recipes are sidegrades, not
   decompositions — the atmospheric gases convert into each other in a loop
   (Nitrogen → Radon → Sulphurine → Nitrogen). Following those downwards turned
   one Antimatter into 1,080 Nitrogen. A real decomposition builds something out
   of cheaper parts, so a recipe is only followed when its inputs are worth no
   more than its output.
2. **Rank by the priciest input, cheapest first.** Ranking by output-per-run
   picks the *rarest* material: it recommended Activated Indium over Copper for
   Chromatic Metal. Item value is a decent scarcity proxy.
3. **Stop after one refiner step.** Almost anything can be refined from
   something else — Carbon from Fungal Mould, and onwards — so an unbounded walk
   drifts well past useful. One step keeps the totals honest: stopping at Carbon
   beats claiming you need Fungal Mould.

Crafting chains are finite and meaningful, so they are followed to the end
regardless; only refining is capped. A toggle on the page turns refining off.

## Layout

```
data/raw/        vendored upstream dump (committed)
scripts/         fetch / build / verify — stdlib Python only
public/data/     core.json + desc.json, the encoded bundle
src/lib/         db decoder, search, DOM helpers, shared UI
src/views/       browse, item detail, recipe tables
```

## Build

```sh
npm run build     # typechecks, then emits dist/
npm run preview
```

`base` is `./` in `vite.config.ts`, so `dist/` can be served from a subpath
(GitHub Pages project sites) or a domain root.

[anms]: https://nmsassistant.com/
