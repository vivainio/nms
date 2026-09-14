# NMS Reference

A fast, browsable reference for No Man's Sky crafting, refining and cooking.
Static site, no backend, no framework.

## Features

- **Browse + search** all 3,769 items, filterable by category.
- **Item detail** with the full crafting tree expanded down to base materials,
  plus a summed "total base materials" list.
- **Reverse lookup** — every recipe that consumes the item you're looking at.
- **Refiner and cooking tables** with all 357 refiner and 1,321 cooking recipes.

## Getting started

```sh
npm install
npm run dev
```

The data bundle is committed under `public/data/`, so the site runs immediately.

## Data

Game data comes from [Assistant for No Man's Sky][anms], which extracts it from
the game files and publishes it to npm as `assistantapps-nomanssky-info` (ISC).
Item art is served from their CDN. This project is not affiliated with Hello
Games or AssistantNMS.

Currently pinned to **game version 6.01** (extracted 2025-08-28).

To refresh:

```sh
python3 scripts/fetch_data.py     # download latest dump into data/raw/
python3 scripts/build_data.py     # encode into public/data/
python3 scripts/verify_data.py    # prove the encoding is lossless
```

The scripts use only the Python standard library — no Node or pip needed for
the data pipeline. `data/raw/` is committed so builds are reproducible offline.

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
