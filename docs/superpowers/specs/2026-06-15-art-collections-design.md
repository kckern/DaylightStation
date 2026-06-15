# Art Collections (Art + Immich) — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Context

This is **sub-project 1 of 4** in an ArtMode architecture rework. The full arc:

1. **Art collections (this spec)** — named, source-aware image pools the rest builds on.
2. **ArtMode presets + config extraction** — named presentation bundles `{ collection, music?, display options }` in their own config; the screen screensaver references a preset by key.
3. **Triggered ArtMode** — dispatch a preset (with music) via the device load API, distinct from the silent passive screensaver.
4. **Registry / menu integration** — make a preset a first-class launchable thing (the "is ArtMode an app?" question; deferred, has an open tension with its screensaver-shell role).

This spec covers only #1.

## Purpose

Let ArtMode draw from named **collections** instead of one flat pool — classical-art
collections defined by metadata filters / curated folders, **and** photo collections
sourced from Immich (albums, people, search). A collection is selectable per request
via `GET /api/v1/art/featured?collection=<key>`.

## Core concept — the source resolver

A **collection** is `{ source: 'art' | 'immich', ...selector }`. Each source resolves
its selector into a **normalized candidate list**, where each candidate is:

```
{ image, width, height, meta }
```

- `image` — display URL/path the frontend renders (local media path for art; the
  Immich `?size=preview` proxy URL for photos).
- `width`, `height` — pixel dimensions, for the existing aspect-ratio pipeline.
- `meta` — fields the placard/diptych pairing use (see below).
- plus an internal handle for matte derivation (local file path for art; the preview
  URL to fetch for Immich).

The **existing** ArtMode selection pipeline runs unchanged on this normalized list:
eligibility (ratio ≤ 16:9, panoramic excluded), classification (landscape → single;
portrait → diptych companion), companion pairing (tiered), and matte derivation
(`deriveMatte` via Jimp). New sources never touch the rendering logic — they only
produce normalized candidates.

`source` defaults to `art`. An absent `collection` query param resolves to the `all`
collection (the whole classic pool) — preserving today's behavior exactly.

## Sources

### `art` source (default)

Resolves against the local classic pool under `media/img/art/`. Selectors (all
optional; multiple combine with AND; none = whole pool):

- `dateMin`, `dateMax` — inclusive year range. The work's year is parsed from its
  (messy) `date` field: the first 4-digit run (e.g. "c. 1860" → 1860, "1519" → 1519).
  Works whose year is unparseable or `0000` are **excluded** from any date-filtered
  collection (but included in `all` and non-date collections).
- `origin`, `medium`, `artist`, `department` — case-insensitive substring match
  against the corresponding `metadata.yaml` field.
- `folder` — restrict to a subdirectory under `media/img/art/` (e.g.
  `themed/americana`), enabling curated themed collections without touching `classic`.
- `works` — an explicit list of work-folder names.

Meta → `{ title, artist, date }` (from `metadata.yaml`, as today).

### `immich` source

Resolves against Immich via the existing `ImmichAdapter` / `ImmichClient`. Selectors
(one primary required):

- `album` — album name or id (`getAlbum`).
- `person` — person name or id (`getPersonAssets`).
- `search` — smart/metadata search string (`smartSearch` / `searchMetadata`).
- (optional) `tag`, `location`.

Only `type === 'IMAGE'` assets are kept (videos dropped). Each asset maps to a
candidate: `image` = the `?size=preview` proxy URL; `width`/`height` from exif; meta
→ `{ date (localDateTime), location ({city, country}), people (names), album }`.

A name-based `album`/`person` selector resolves to its id once and is cached.

## Matte derivation

`deriveMatte` needs pixels. For `art`, read the local image file (as today). For
`immich`, fetch the `?size=preview` JPEG (a real JPEG — not HEIC — so Jimp reads it)
and derive from that. Derived matte/color is **cached per work/asset** so repeated
featured picks don't refetch or recompute.

## Placard meta mapping

The frontend placard renders two lines (title line, artist/subtitle line). The
normalized `meta` drives both sources through the same component:

- **art**: line 1 = `title`; line 2 = `artist` (· `date`). Unchanged.
- **immich**: line 1 = `location.city` (else `location.country`) else `album` name;
  line 2 = formatted `date` (e.g. "August 2019"), appending people names if present.
  If a photo has none of these, both lines are empty and the placard is omitted (the
  existing empty-plaque guard).

The frontend already renders whatever `meta.title` / `meta.artist` it receives, so the
mapping is done backend-side when building Immich candidates (`meta.title` / `meta.artist`
are populated from the photo fields above). No frontend changes are required for
sub-project 1.

## Config

`data/household/config/art.yml` (loads via the household-app-config pattern, like
`ambient.yml`):

```yaml
collections:
  all: {}                                     # whole classic pool (default)
  renaissance:   { dateMin: 1400, dateMax: 1600 }
  baroque:       { dateMin: 1600, dateMax: 1750 }
  rococo:        { dateMin: 1700, dateMax: 1780 }
  romantic:      { dateMin: 1780, dateMax: 1850 }
  realism:       { dateMin: 1840, dateMax: 1880 }
  impressionism: { dateMin: 1860, dateMax: 1900 }
  modern:        { dateMin: 1880, dateMax: 1945 }
  dutch:         { origin: Netherlands }
  americana:     { folder: themed/americana }
  family:        { source: immich, album: "Family Favorites" }
```

The seven period collections + `all` ship predefined; folder/works/Immich collections
are authored by the user. If `art.yml` is absent, only `all` exists (current behavior).

## API

`GET /api/v1/art/featured?collection=<key>`:

- Resolves `<key>` against `art.yml` collections; builds candidates via the source
  resolver; runs the existing pipeline; returns the same `{ mode, matte, panels }`
  shape as today.
- **Unknown key, empty result, or a source error → fall back to `all`** and log a
  warn. The screensaver must never go blank.
- Absent `collection` → `all` (today's behavior, byte-for-byte where possible).

## Backend units

- `backend/src/1_adapters/content/art/collections.mjs` (pure): `parseYear(dateStr)`,
  `buildArtPredicate(def)`, `resolveCollection(defs, key)` (+ fallback). Unit-tested.
- `backend/src/1_adapters/content/art/sources/artSource.mjs`: resolves an `art`
  collection def → normalized candidates (refactor of the current ArtAdapter scan).
- `backend/src/1_adapters/content/art/sources/immichSource.mjs`: resolves an `immich`
  collection def → normalized candidates via an injected Immich client; IMAGE-only;
  exif + preview URL + placard meta mapping.
- `backend/src/1_adapters/content/art/ArtAdapter.mjs`: orchestrate — resolve collection
  → source resolver → normalized list → eligibility/classify/pair/matte → panels.
  Accepts a `collection` argument in its featured method; injects the Immich client.
- `backend/src/4_api/v1/routers/art.mjs`: read `?collection=`, pass through, fallback.
- `backend/src/app.mjs`: load `art.yml` collections and inject the Immich
  client/adapter into `createArtAdapter`.
- `data/household/config/art.yml`: starter collections (created in the container data
  volume, not the repo).

## Error handling

- Unknown / empty / erroring collection → fall back to `all` + warn.
- Immich unreachable → that collection falls back to `all` (art); logged.
- Unparseable/`0000` year → excluded from date filters, kept in `all`.
- Immich asset without exif dimensions → excluded (can't classify aspect).

## Testing

- **Pure (`collections.mjs`)**: `parseYear` ("c. 1860"→1860, "1519"→1519, "0000"→null,
  ""→null); `buildArtPredicate` (date range incl. messy years, field substring match,
  folder scoping, explicit works, AND-combo, empty=match-all); `resolveCollection`
  (known key, unknown→all fallback).
- **`artSource`**: filters a fixture set of works by each selector; folder scoping;
  explicit works list.
- **`immichSource`** (fake Immich client): album/person/search → candidates; drops
  VIDEO; maps exif width/height; builds the `?size=preview` URL; placard meta mapping
  (location/album/date/people); drops assets missing dimensions.
- **`ArtAdapter`** (fakes): featured for an `art` collection (single + diptych, matte);
  featured for an `immich` collection; companion pairing stays within the collection;
  unknown collection → `all` fallback.
- **API**: `?collection=` flows through; absent = current behavior; fallback on
  unknown.

Run via: `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` for
frontend-style specs, or the appropriate backend jest/vitest harness for the adapter
tests (the implementer confirms the runner the existing art/adapter tests use).

## Open items / future (out of scope for #1)

- ArtMode presets bundling collection + music + display options (sub-project 2).
- Triggering a preset via the load API (sub-project 3).
- Registry/menu launch + the screensaver-shell-vs-app tension (sub-project 4).
- Immich-specific aspect handling beyond ratio (e.g. face-aware cropping); crossfade.
