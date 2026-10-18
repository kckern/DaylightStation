# ArtMode

ArtMode is the framed-artwork surface — the home screensaver and an ad-hoc scene. It hangs a single landscape work, or pairs two portraits into a diptych, behind a printed picture frame with a coloured mat and an engraved brass nameplate, optionally over background music. The artwork pool comes from a named **collection**, which resolves either from the local classic-art library on disk or from Immich.

All text within ArtMode, including artwork nameplates and music labels, is unselectable.

For how a screen wires ArtMode as a passive screensaver, and how a scene is dispatched ad hoc to any screen/target, see `screen-configs.md`. This document describes the art source, collection, and selection model behind that surface.

---

## Collections, presets, frames

Three catalogs configure ArtMode, each a YAML map read once and treated as empty when absent (an unconfigured install still runs against the default pool):

| Catalog | What it holds |
|---------|---------------|
| Collections | Named query definitions — the pool a scene draws from (source, folder scope, and filter fields). |
| Presets | Named scenes — a collection plus music and display options, layered over shared `defaults`. |
| Frames | Named frame varieties — window insets plus their mat band and crop budget, so frame geometry lives once per variety. |

A scene is referenced by **key**. The key may name a preset, or — when it matches no preset — a bare collection, which resolves as a one-field scene against that collection. So a menu id or scene reference can point straight at a collection without a passthrough preset. A named frame string on a resolved scene expands into the flat inset/mat/crop shape the widget consumes; explicit per-scene values for mat or crop win over the variety's.

Layering for a resolved scene, lowest to highest precedence: shared defaults, then the named preset (or the synthesised bare-collection scene), then any inline overrides.

### Collection definition

A collection is a filter over the candidate pool. An empty definition matches everything. Recognised fields:

| Field | Meaning |
|-------|---------|
| `source` | `art` (local library, default) or `immich`. |
| `folder` | The scope subdirectory of the local art library to scan (default is the classic library). |
| `dateMin` / `dateMax` | Inclusive year bounds; works with no parseable year are excluded when either bound is set. |
| `origin`, `medium`, `artist`, `department`, `category`, `display`, `section` | Case-insensitive substring matches against the work's metadata. |
| `works` | Restrict to an explicit list of work folder names. |

For Immich-sourced collections, the selector fields are different: a favourites flag, an album, a single person, a set of people (with a minimum-co-appearance count), or a smart-search phrase.

---

## The local art source

The local source scans a scope directory of the art library, one work per folder, and reads each work's metadata sidecar for title, artist, date, origin, medium, department, credit, and the work's pixel dimensions (used for aspect-ratio layout).

A scope may be **flat** (works directly under the scope) or **sectioned** (works grouped one level deeper under thematic subfolders). The scan handles both: a direct child that carries a metadata sidecar is a work; one that doesn't is treated as a section and its children are scanned one level down. A work discovered inside a section carries that section name in its metadata, so a collection can scope to a single thematic section without colliding with the metadata-derived category field.

Each work is classified by aspect ratio. Anything at least as wide as it is tall hangs as a **landscape** (shown singly); only true portraits (taller than wide) are eligible to pair into a diptych. Panoramic works (wider than 16:9) are excluded entirely. A work missing dimensions or an image file is skipped.

### Scope scan cache

The screensaver re-resolves the pool on every advance, so the per-folder scan is cached per scope and reused across advances and across collections that share a scope. The cache invalidates on the scope directory's modification time, plus the modification times of any discovered section subfolders — adding or removing a work bumps a directory's mtime, so the cache self-heals without an explicit invalidation step. The collection filter is applied per call over the cached scan, so it stays cheap.

---

## The Immich art source

The Immich source resolves a collection's selector into a set of assets, then keeps only images (videos dropped) whose orientation-corrected dimensions are non-panoramic. Selectors: family favourites (paged), an album, a single person, a co-appearance set of people, or a smart-search phrase. People and exif are requested so a placard can name who is pictured and where.

Each asset becomes a candidate with the same shape as a local work. The placard is built from the shared photo-label helpers: a headline of people and place (or a sense of when/where when no one is named), with the full human-readable capture date beneath. Dates are read as the photo's wall-clock local time, rendered verbatim, so a placard never prints a timezone-shifted hour.

---

## Selection: featured artwork

Selecting a featured artwork resolves the collection to candidates, picks a primary, and returns either a single panel or a diptych, each panel carrying its image, metadata, and a sampled average colour. A coloured mat is derived from the panel colours (the mean of both, for a diptych).

- A **landscape** primary shows as a single matted panel.
- A **portrait** primary pairs with a companion drawn from the portrait pool, chosen by the tightest available match — same artist and credit, else same artist, else same credit, else any — to form a diptych under one shared mat.

If a narrowing collection (an Immich collection, or any filtered local collection) resolves to nothing, selection widens to the full local pool so the surface never blanks; an already-unfiltered pool that comes back empty surfaces as unavailable instead.

### Recency tempering

Uniform random-with-replacement clusters and favours a few works because it has no memory of what just showed. ArtMode benches the most-recently-shown works before picking: roughly the most recent half of the pool (a configurable fraction) is held out of candidacy, then re-enters once enough other works have had a turn. This bounds how often any one work recurs without requiring the whole collection to be exhausted, and the bench is capped so the pool can never be fully benched.

The no-repeat window is persistent — every shown work (both panels of a diptych) is recorded to a media-memory store keyed by work id, alongside the other media-memory recency logs, with a last-shown timestamp and a show count. The store is loaded once and written through on each pick; a write failure never blocks serving the artwork, and a missing or unreadable store simply means no tempering until it can be read.

(The music side has its own, separate wrap-seam fix: when a shuffled background playlist loops, it reshuffles while avoiding repeating the song that just ended on the seam.)

### Menu thumbnails

A scene key also resolves to a representative menu thumbnail. The thumbnail picks a **deterministic** candidate from the scene's collection (first by sorted id — stable across loads, no colour analysis) and is cached per collection. Art scenes are not generic playable or listable content — they are mounted through the dedicated preset route, not the content pipeline — so the art content source implements only the thumbnail path. It hands back the browser-served static-image path, rewriting the canonical library path to the served route the same way the frontend media-path helper does.

---

## The widget

The widget renders one matted, framed picture (single or diptych) with engraved nameplate(s) and optional background music. It reads the work dimensions to lay out the opening and, for a diptych, to balance the two panels under one mat.

### View modes

Five view modes cycle from museum to immersive: gallery (matted), framed-contain, framed-cover, bare-contain, bare-cover. The viewer cycles modes by hand (Tab/Shift+Tab, the remote's rewind, or a repurposed rate button on macro-keypad screens); a hand-picked mode sticks across advances until the surface remounts.

Each freshly-loaded artwork otherwise starts in a per-image default. A **matless-fill** rule lets a single image that can cover-fill the bare frame opening within a per-axis crop budget start mat-less in framed-cover — the picture bleeds to fill the frame instead of floating in a mat. Cover-filling crops exactly one axis (a work narrower than the opening trims top/bottom; a wider one trims left/right), so the budget is split per axis. Diptychs and over-budget singles fall back to the matted default. A qualifying single's matless start overrides even a sticky manual choice; the decision and its reasoning (aspect ratio, which axis, needed-vs-budget crop, verdict) are logged so it is answerable from logs.

### Advance and transition

Two orthogonal axes govern how the surface changes artwork:

| Axis | Values |
|------|--------|
| **advance** — what triggers the next artwork | `hold` (static until remount or manual skip, the default), `track` (a fresh artwork each time the music moves to a new song), `timer` (a new artwork every interval), `auto` (music → track, else interval → timer, else hold). |
| **transition** — how the change looks | `curtains` (a velvet drape closes over the swap and parts once the new art has loaded, the default) or `crossfade` (the new artwork dissolves in over the old as a stacked plane — the slideshow look). |

A timed crossfade is the classic slideshow; the velvet curtain is the home-screensaver default. The interval sets the timer period; the crossfade duration is configurable. Under the curtain, the swap only ever happens behind a fully-closed drape, with a minimum dwell and a safety rail so the curtain can neither flash by nor stick shut. In track mode under the curtain, the music nameplate is pinned so it changes with the artwork behind the drape rather than mid-reveal.

### Controls and ambient

The surface owns its own input: left/right shuffle the artwork (and advance the song), up/down brighten/dim, OK/Enter or Escape exit, fwd/rew scrub within the current song, pause toggles the music. On macro-keypad screens that emit semantic actions plus spurious companion keys, the raw-key handler is disabled so those keys don't double-fire. An optional ambient-light curve auto-dims the surface from a light-sensor topic, layered with the manual brightness bias.

---

## Reviewed music matching

A preset with `matching: { profile: quiet }` uses a separate, reviewed catalog at
`data/household/art/ambiance.yml`. This mode holds one composition for each
recording, including the first song. With `portraitPairing: true` in the profile,
a portrait can pair with a second reviewed portrait that matches the song and is
emotionally compatible with the primary. Landscapes remain single; a portrait
without a safe companion also stays single. Both panels retain their own title,
artist and available creation date. Track changes
use curtains; timers and crossfades do not repick the artwork. Pause, seeking and
brightness changes hold the current selection. Late responses from a previous
recording cannot replace the current match.

```yaml
presets:
  quiet-evening:
    matching: { profile: quiet }
    advance: track
    music: { queue: 'plex:12345', shuffle: true, volume: 0.2 }
```

The profile automatically supplies `music.eligibilityProfile`. Before starting
audio, the client intersects the playlist with approved recording IDs. An absent
or unavailable eligibility response holds playback. Recording identity, rather
than song title, distinguishes arrangements; each repeat play has a new occurrence.

Catalog version 1 contains `profiles`, `tracks`, `artworks` and optional `pairings`
maps. Track keys are canonical content IDs; artwork keys are scope-relative paths
such as `sacred/peace/Artist - Date - Title`. The catalog is reread for each request;
missing or malformed data never opens the ordinary random-art pool.

```yaml
version: 1
profiles:
  quiet:
    maxEnergy: 1
    maxIntensity: 2
    excludedSeasons: [christmas, nativity]
    allowedMedia: [painting, drawing, watercolor, digital-painting]
    minScore: 3
    portraitPairing: true # optional; defaults to false
    repeatWindow: 50 # distinct recently displayed works; defaults to 50
    fallbackArtIds: [sacred/peace/Artist - Date - Title]
tracks: {}
artworks: {}
pairings: {} # recording ID -> array of explicitly paired artwork IDs
```

Matching excludes recent works before narrowing by relevance, while preserving
the minimum score and all review gates. If every suitable choice is recent,
the least recently shown choice can return. Both panels count toward recency.
Per-profile history persists in `data/household/media/memory/ambiance.yml` across
scene and server restarts. Overlapping requests for a profile share that history
in request order. `art.ambiance.selected` logs the recording and both artwork IDs.

Both recordings and artworks carry extensible arrays `subjects`, `narratives`,
`themes`, `symbols`, `moods`, and `seasons`, plus integer `energy` and `intensity`
levels 0–3. Artworks also carry `mediumKind`. A review contains `status`,
`profiles`, `reviewer`, `reviewedAt`, `reason`, and an `evidence` array. Each piece
of evidence has a `kind` and a `path`, `url` or `details`; visual or recording
assessments should retain exact asset checksums and their method. Acquisition
status alone is not a review.

Artwork visual evidence must include its exact `sha256`. Matching rereads the
actual image bytes and compares that fingerprint on every request, independently
of source/color caches. Changed, deleted or undecodable files are excluded from
matches, overrides and fallbacks. A browser image failure clears the current
matched image to neutral; stale image events cannot clear a newer recording.

Eligibility gates apply before matching, overrides and fallbacks. Matching favors
shared narratives, themes, subjects, symbols and moods; energy/intensity limits
and incompatible moods filter the choices first. Variety and recent-pick avoidance
operate among strong matches. Explicit pairings may express intentional emotional
contrast but cannot bypass eligibility. A missing match uses only an eligible,
compatible configured fallback; otherwise the surface is neutral with no panels.

The additive API is `GET /api/v1/art/ambiance/:profile/tracks` and
`POST /api/v1/art/ambiance/:profile/match` with `{trackId, recentIds?}`. The first
returns `{trackIds}`; the second returns the normal artwork presentation plus
`match`, or `{mode:'neutral', panels:[], matte:null, match:{kind:'neutral'}}`.

### Audit and acquisition CLI

Run `node cli/art-ambiance.cli.mjs help` for flags. Audit concrete playlist contents
against the catalog and actual artwork files before publication:

```bash
node cli/art-ambiance.cli.mjs audit --catalog "$CATALOG" --profile quiet \
  --playlist "$PLAYLIST_JSON" --art-root "$ART_ROOT" --output "$REPORT"
```

Playlist JSON is `{ "trackIds": ["plex:123"] }`. The report detects unapproved
playlist additions, missing approved recordings, missing image files, ineligible
approvals and per-recording semantic/override/fallback/neutral coverage. Violations
return a nonzero exit code. The caller must export actual playlist contents rather
than substituting its intended ID list.
Availability uses the same runtime source filters, fingerprint checks and image
decoder, including hidden/flagged/excluded works and unsupported dimensions/depth.

The harvest commands accept a saved collection HTML page and complete paginated
Shopify product JSON inventories. `harvest-plan` rejects an incomplete inventory,
selects unframed print/rolled-canvas source images, removes CDN resize parameters,
and deduplicates artist/title across the existing library and inventory. Artist
comes from the product's artist tag, not its publisher or URL slug. Inspect the
manifest for media exclusions and ambiguous sources before importing.

`harvest-download --manifest "$MANIFEST" --cache "$CACHE" --allow-write` validates
actual image bytes, retries transient failures and resumes matching cached URLs.
`harvest-import --manifest "$MANIFEST" --cache "$CACHE" --existing "$LIBRARY" \
--destination "$DESTINATION" --allow-write` deduplicates by identity and actual
SHA-256, never overwrites existing assets, and writes image/metadata folders
atomically. Both operate only on manifest entries with `status: download`.
Imported sidecars preserve source/product/collection URLs, tags, artist, pixel
dimensions and checksum, and start with `curation_status: unreviewed`. Published
CDN resolution is preserved without upscaling; it may be smaller than the original
studio file. Framed mockups or unavailable clean sources remain held.

## Source map

| Concern | Directory |
|---------|-----------|
| Art adapter, collection resolution, sources, recency store, content source | `__app_modules/media/art/server/adapters/` |
| Eligibility, matching, recency and mat derivation (pure domain) | `__app_modules/media/art/server/domain/` |
| Shared Immich photo-label helpers | `__backend/src/1_adapters/content/gallery/immich/` |
| Art API (featured, preset, ambiance) | `__app_modules/media/art/server/api/` |
| ArtMode widget, layout, view modes, advance resolution | `frontend/src/composition/screens/widgets/` |
| Background-music playlist (shuffle wrap-seam) | `__capabilities/playback/browser/playlist.js` |
| Catalogs (collections, presets/frames, ambiance) | `data/household/art/` |
| Persistent recency log | `data/household/media/memory/art.yml` |
| Audit and acquisition tooling | `__app_modules/media/art/cli/`, `cli/art-ambiance.cli.mjs` |
