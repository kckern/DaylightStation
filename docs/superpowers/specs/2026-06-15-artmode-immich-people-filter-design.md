# ArtMode Immich People Filter (`kids` preset) — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Context

A follow-on to the ArtMode rework. The Immich source (sub-project 1) supports single
`album` / `person` / `search` selectors. This adds a **multi-person "at least N"**
selector so a `kids` preset can show photos containing **≥2 of {Felix, Milo, Alan,
Soren}**, then triggers it on the office TV.

## Why pairwise search + union

Immich's `/api/search/metadata` ANDs multiple `personIds` (an asset must contain **all**
listed people) and has no "≥N of a set" parameter. So "at least 2 of 4" is expressed at
the **Immich query level** as the union of all 2-person AND-searches:

- `C(4, 2) = 6` searches: `[Felix,Milo]`, `[Felix,Alan]`, `[Felix,Soren]`,
  `[Milo,Alan]`, `[Milo,Soren]`, `[Alan,Soren]`.
- Each returns assets containing **both** of that pair (Immich does the matching).
- Union by asset id = every asset containing **≥2** of the four.

Generalised: for `minPeople = k` of `n` people, run `C(n, k)` combination searches and
union. The client only dedupes; all person-matching is server-side.

## Confirmed Immich behavior (from probing)

- The four names resolve to face ids via `GET /api/people`.
- `POST /api/search/metadata { personIds: [...] }` returns `{ assets: { items, nextPage } }`.
- **Search result items carry top-level `width`/`height`** (not `exifInfo`), and do
  **not** populate `people`/`exifInfo`/`city`/`country`. So:
  - The candidate's dimensions come from `asset.width` / `asset.height` (the existing
    `immichSource` mapping already falls back to these).
  - The photo plaque shows the **date** (`localDateTime`); location/people are absent in
    search results and are not fetched per-asset (kept simple).

## Component — `immichSource` gains `people` + `minPeople`

`backend/src/1_adapters/content/art/sources/immichSource.mjs` adds a `people` selector
to `resolveAssets(def)`:

- `def.people` — array of names (or ids). `def.minPeople` — integer, default `2`.
- Resolve each name → id (`client.getPeople`, match by `name` or accept a raw id).
- Build all `minPeople`-sized combinations of the resolved ids (a small pure
  `combinations(ids, k)` helper).
- For each combination, query `client.searchMetadata({ personIds: combo, size: <cap> })`
  and collect `assets.items`.
- Union the items by asset `id` (dedupe).
- Return the deduped assets; the existing `toCandidate` mapping (IMAGE-only, top-level
  `width`/`height`, `?size=preview` url, date plaque) applies unchanged.

Selector precedence in `resolveAssets`: `album` → `person` → `people` → `search`
(the new `people` branch sits alongside the existing ones).

**Bounded fetch:** each combination search is capped (`size`, default ~250, no deep
pagination) so the pool fetch stays reasonable for a screensaver. A `combinations`
helper and the union are pure and unit-tested; the search calls use the injected client
(faked in tests).

## Config

`art.yml` collection (data volume):
```yaml
kids:
  source: immich
  people: [Felix, Milo, Alan, Soren]
  minPeople: 2
```

`artmode.yml` preset (data volume) — a silent gallery preset over the `kids` collection:
```yaml
kids:
  collection: kids
  music: null
  placard: true
  matMargin: 4
  cropMaxPerSide: 8
  frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }
  ambient: { defaultLux: 80, curve: [ ...standard 5-point curve... ] }
```

## Trigger

`GET /api/v1/device/office-tv/load?display=art:kids` → office shows photos containing
≥2 of the four kids (silent). Reuses the entire transport-agnostic delivery + scene
pipeline already in place.

## Error handling

- A name that doesn't resolve to a face id → skipped (logged); combinations use the
  resolved ids only. If fewer than `minPeople` resolve, the collection yields no
  candidates → the ArtMode `collection.empty` fallback shows the full art pool (existing
  behavior), so the screen never blanks.
- Immich unreachable → `resolveCandidates` returns `[]` → same fallback.

## Testing

- **Pure `combinations(arr, k)`**: `C(4,2)` returns 6 pairs; `k > arr.length` → `[]`;
  `k = 1` → singletons; preserves element identity.
- **`immichSource` `people` selector** (fake client): resolves names → ids; runs one
  search per combination with the right `personIds`; unions/dedupes assets across
  combinations (an asset returned by two pairs appears once); drops VIDEO; maps
  top-level `width`/`height`; unresolved names are skipped.
- **Live** (post-deploy): `/device/office-tv/load?display=art:kids` → office logs show
  `websocket.load.display` → `commands.display` → `action.scene.show {preset: kids}` →
  `artmode.loaded`, and the screen shows kid photos.

## Out of scope

- Per-asset detail fetch to populate people/location on the plaque (date-only is fine).
- Deep pagination of every combination (bounded sample is enough for rotation).
- New preset display options (reuses the standard silent gallery block).
