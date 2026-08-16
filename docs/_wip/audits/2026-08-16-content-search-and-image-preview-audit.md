# Content Search & Image Preview Audit

**Date:** 2026-08-16
**Trigger:** FHE menu editing session (`/admin/content/lists/menus/fhe`, 20:42–20:55Z). User could not find Bible-story videos titled "Job" by searching and had to read raw rating keys out of the Plex UI. Separately, the `files:` image set for the Esther row renders no thumbnail and a blank Display preview.
**Status:** Fixed and verified end-to-end on the dev server. See *Outcome* at the end.

---

## Summary

Five defects, all verified by live probes. Two of them (RC1, RC3) make text search structurally
incapable of returning episodes, tracks, or image files. The ranking gap is arithmetic, not a
matter of tuning. One (RC4) makes image files the only media type that cannot be displayed.

| # | Defect | Layer | Severity |
|---|--------|-------|----------|
| RC1 | Category score dominates text relevance by ~7x | `2_domains` RelevanceScoringService | Critical |
| RC2 | Immich ignores the query text, floods every search with 250 items | `1_adapters` ImmichAdapter | Critical |
| RC3 | Whole-string-only matching; no tokenization | `2_domains` RelevanceScoringService | High |
| RC4 | `files:` images are never Displayable (no thumbnail, no imageUrl) | `1_adapters` FileAdapter | High |
| RC5 | Unknown source prefixes commit as literals with no validation | `frontend` combobox | Medium |

---

## RC1 — Category outranks text match by ~7x

`RelevanceScoringService.score()` computes:

```
score = getCategoryScore(item.metadata.category)   // 10 … 150
      + (title === search ? 20 : startsWith ? 10 : includes ? 5 : 0)
      + min(childCount / 100, 5)
```

Category scores (`ContentCategory.mjs`): IDENTITY 150, CURATED 148, CREATOR 145, SERIES 140,
WORK 130, CONTAINER 125, LIST 40, **EPISODE 20, TRACK 15, MEDIA 10**.

The text-match bonus tops out at **+20**. The gap between EPISODE (20) and WORK (130) is **110**.

**An episode's maximum possible score (45) is below a work's minimum (130).** No amount of text
relevance can close that. The same holds for tracks and for image/video files (MEDIA 10).

### Verified

Live SSE probe of `/api/v1/content/query/search/stream?text=job` — the exact transport the admin
combobox used (`mode: "sse"` in the session log). 486 items streamed, **486 of 486 carrying a
backend `score`**.

Top of the list as the UI renders it:

| score | category | id | title |
|---|---|---|---|
| 150.30 | series | plex:449175 | Job 1 |
| 150.05 | series | plex:622900 | Job 1 Overtime |
| 150.02 | creator | abs:author:c40c… | Karen H. Jobes |
| 145 | container | plex:178286 | Job |
| 135 | work | plex:666040 | The Italian Job |
| 135 | work | plex:228319 | Inside Job |
| 135 | work | plex:401875 | Steve Jobs — The Lost Interview |
| 135 | work | abs:f9eb8d4a… | Knock 'Em Dead 2016 — The Ultimate Job Search Guide |

The two items the user actually wanted:

| rank | score | id | title | category |
|---|---|---|---|---|
| **75** | 40 | plex:457470 | Job | episode |
| **76** | 40 | plex:642205 | Job | episode |

`RENDER_CAP = 50` (`comboboxMachine.js`, asserted in `comboboxMachine.test.js`). **Ranks 75 and 76
are past the render cap — they cannot be scrolled to.** Scoring reproduces the formula exactly
(140 series + 10 startsWith + 0.30 childCount = 150.30), confirming the model.

`plex:457470` is one of the items already in `menus/fhe.yml`. The user's own list content is
unfindable by its exact title.

### Note

`frontend/src/hooks/useStreamingSearch.js:33` (`scoreSearchResult`) already implements a *better*
formula — text-first, no category term, `-10` for machine-generated titles. It is dead code in
practice: line 34 prefers `item.score` when the backend supplies one, and the backend always does.

---

## RC2 — Immich ignores the search text entirely

`ImmichAdapter.#buildImmichQuery()` sets `immichQuery.query = query.text` and passes it to
`client.searchMetadata()`. Immich's metadata-search endpoint has no `query` field, so the term is
dropped and the endpoint returns the library newest-first, capped at 250.

### Verified

Identical result sets for three unrelated queries against `source=immich`:

| query | total | first 3 titles |
|---|---|---|
| `job` | 250 | 1968-06-00 Gates Family Silent Films (Part 2).mp4, 2026-08-12 20.56.23.jpg, 2026-08-12 20.56.14.jpg |
| `holy moly job` | 250 | *(identical)* |
| `zzzzqqqxyz nonsense` | 250 | *(identical)* |

Immich contributes 250 items of pure noise to **every** search, competing for the 50 render slots.

When combined with RC3, it becomes 100% of the result set. Per-adapter counts for
`text=holy moly job`:

```
immich: 250   plex: 0   abs: 0   files: 0   singalong: 0
readalong: 0  local-content: 0   canvas-filesystem: 0   retroarch: 0   query: 0
```

This is what the user saw: a wall of family photos in response to a Bible-video search.

---

## RC3 — Whole-string matching, and no relevance floor

The title bonus tests `title.includes(searchText)` against the **entire** query string. There is no
tokenization, and no field other than `title` is consulted (not show/grandparent title, not
parent title).

So `"holy moly job"` — the natural way to name *the Job episode of the Holy Moly series* — matches
no title anywhere. Every text bonus is 0, and results fall back to pure category ordering of
whatever the adapters happened to return.

Compounding it: **items that match nothing are still returned and rendered as results.** There is no
minimum-relevance filter and no distinct "no matches" state, so "we found nothing" is presented
identically to "here are your matches." `text=job` returns **839 items**.

Session-log evidence of the user working around this — searching, failing, and abandoning:

```
20:46:37  search.dispatch  "plex:jo"
20:46:38  search.dispatch  "plex:job"
20:46:44  search.dispatch  "job"
20:46:58  search.dispatch  "holy hojob"        ← retyping around the cursor
20:47:00  search.dispatch  "holy job"
20:47:02  search.dispatch  "holy moly job"
20:47:15  commit.revert    {discarded: "holy moly job", kept: "plex:457462", reason: "outside"}
```

Every subsequent content change that session was a hand-typed rating key committed via
`commit.literal_fallback` — i.e. read out of the Plex UI, not found in ours.

---

## RC4 — `files:` images are never Displayable

`FileAdapter.getItem()` returns a `PlayableItem` for every media type, and builds the thumbnail as:

```js
let thumbnail = mediaType === 'video'  ? `/api/v1/local/thumbnail/${…}`
              : mediaType === 'audio'  ? `/api/v1/local-content/cover/${…}`
              : null;
// then: notation / document get a same-basename image sidecar
```

`image` is the one media type with no branch — it falls through to `null`. `imageUrl` is never set
(that lives on `DisplayableItem`, which `FileAdapter` never constructs).

`info.mjs:44` derives capability from those fields:

```js
if (item.thumbnail || item.imageUrl) capabilities.push('displayable');
```

So an image file gets **no thumbnail, no imageUrl, and `capabilities: ["playable"]`** — while a
video file gets `["playable", "displayable"]`. The classification is inverted for the one media
type that is nothing *but* displayable.

`Displayer.jsx` renders `<img src={data.imageUrl}>` after hydrating from `/api/v1/info/{source}/{id}`.
With `imageUrl` undefined, the Display preview is a blank `<img>`. That is the broken preview.

### Verified

`GET /api/v1/info/files/art/fhe/esther.jpg` → **200**

```json
{ "type": "image", "capabilities": ["playable"],
  "mediaUrl": "/api/v1/proxy/media/stream/art%2Ffhe%2Festher.jpg" }
```
— no `thumbnail`, no `image`, no `imageUrl`.

Same call for a video (`files:clips/ring.mp4`) → `capabilities: ["playable","displayable"]`, with
`thumbnail` and `image` both populated.

Same call for an Immich image → `capabilities: ["displayable"]`, with `thumbnail`, `image`, and
`imageUrl` all populated. That is the shape `Displayer` expects.

**The bytes are fine — this is purely a contract-mapping bug:**

| endpoint | result |
|---|---|
| `/api/v1/proxy/media/stream/art%2Ffhe%2Festher.jpg` | 200, `image/jpeg`, 1,086,833 B |
| `/api/v1/proxy/media/stream/art%2Ffhe%2Felisha.jpeg` | 200, `image/jpeg`, 13,348 B |
| `/api/v1/local/thumbnail/img%2Fart%2Ffhe%2Festher.jpg` | 200, `image/jpeg` |

Corroborated in the session log: every other row logged an `image.load.end`; the Esther row logged
none, because no thumbnail URL was ever emitted for it to load.

---

## RC5 — Unknown source prefixes commit without validation

The combobox accepts any `word:rest` string as a literal and saves it. `img:` is not a registered
source:

```
GET /api/v1/info/img/art/fhe/esther.jpg  →  404 {"error":"Unknown source: img"}
```

The user committed `img:art/fhe/esther.jpg` into the live list and learned it was wrong only from a
background 404 (`content_api.error_status`) plus a red `load_siblings.error: Browse failed: 404`.
`file:` (singular) is *not* offered by search but happens to resolve server-side to `files:`, which
made the diagnosis harder still — the preview appeared to work under one invalid prefix.

Three prefixes were tried before the right one landed: `img:` → `file:` → `files:`.

---

## Recommended fixes

**A. Invert the relevance model (RC1, RC3).** Text match becomes primary; category becomes a
tiebreaker within equal match quality, not an override. Concretely: score match quality first
(exact > all-tokens-in-order > all-tokens-present > partial), tokenize the query, match against
title *and* the show/parent title so `"holy moly job"` resolves, then apply a small category
nudge (single-digit, not 130) so a series edges out its own episode on a tie. Drop items with zero
token matches — a relevance floor — and return an explicit empty state.

**B. Stop Immich from answering text searches it cannot serve (RC2).** Either route the term to
Immich's smart-search endpoint, or match it against `originalFileName`/description, or exclude
Immich from unscoped text search unless the user scopes to `immich:`. Minimum bar: return `[]`
rather than the newest 250 assets when the term cannot be applied.

**C. Make `files:` images displayable (RC4).** Give `mediaType === 'image'` a thumbnail (its own
stream URL, or `/api/v1/local/thumbnail/…`, both verified working) and set `imageUrl` so
`capabilities` picks up `displayable` and `Displayer` has something to render. Smallest of the
five fixes; unbreaks the preview and the row thumbnail together.

**D. Validate source prefixes at commit (RC5).** Check the prefix against the registered adapter
list before saving; warn inline on an unknown source instead of writing it to the list.

A and B are what make search usable; C is a few lines and independently shippable.

---

## Outcome

All five root causes fixed, plus the pre-existing test failures found along the way.

### Changes

| RC | Change |
|----|--------|
| RC1 | `RelevanceScoringService` rewritten: match quality is the sort key (tiered exact → prefix → all-tokens-ordered → all-tokens → word-prefix → substring), scaled by a **coverage ratio** (how much of the title the query accounts for). Category demoted to a single-digit tiebreaker via new `getCategoryTiebreak()`. With no search text, the original category scale still orders the browse. |
| RC2 | `ImmichAdapter.#buildImmichQuery` sends free text as `originalFileName` instead of the non-existent `query` field. |
| RC3 | Query is tokenised (punctuation folded, apostrophes joined so `Job's` → `jobs`), tokens may span the title **and** the show/season context, and `ContentQueryService` applies a **relevance floor** on both the batch and streaming paths — a zero-scoring item is dropped rather than shown. |
| RC4 | `FileAdapter` gives `mediaType === 'image'` a thumbnail and an `imageUrl`, so images become `displayable`. |
| RC5 | New `frontend/src/modules/Content/lib/knownSources.js`; a literal commit with an unregistered prefix now warns *"Unknown source — this row will not load"* instead of the reassuring "Saved as raw id". |

### Verified on the dev server

Searching `job`, through the same SSE transport the admin combobox uses:

| | before | after |
|---|---|---|
| `plex:457470` "Job" (episode) | rank **75** (score 40) | rank **1** (score 2102) |
| `plex:642205` "Job" (episode) | rank **76** (score 40) | rank **2** (score 2102) |
| items streamed | 486 | 153 |
| top of list | The Italian Job, Steve Jobs, job-interview audiobooks | the exact-title "Job" items |

Category still breaks ties among equal matches: container 2104 > episode 2102 > track 2101.

Other checks:

- `immich` source: `job` → 0, `zzzzqqqxyz nonsense` → 0, `gates family` → 1 real match (was 250 identical results for all three).
- `scripture stories job` → exactly the two Job episodes, matched across title + show title. This is the query shape that previously returned family photos.
- `holy moly job` → 0 results, honestly reported. (The Job episodes live in *Scripture Stories*; the Holy Moly listing shows no Job episode, so empty is the correct answer — and now it is visible immediately instead of buried under noise.)
- `GET /api/v1/info/files/art/fhe/esther.jpg` → `capabilities: ["playable","displayable"]` with `thumbnail`, `image`, and `imageUrl` all populated (was `["playable"]` with none of them).

### Test suite

`tests/isolated`: **106 failures → 52**, with no newly-failing file. 54 tests across 10 files fixed:

- Content: new relevance/floor/adapter coverage; `ContentQueryService` mocks no longer return titleless items (which the `Item` entity forbids).
- `localContent` router (11): joined an optional `mediaBasePath` unconditionally at construction, throwing `The "path" argument must be of type string` before any route registered. Now degrades like every other use in that file. **This was a code bug, not a test bug.**
- Immich display tests (5): still asserted `/original`, which the adapters deliberately left because HEIC originals render blank outside Safari.
- Weekly-review photo order: asserted face-first ordering after the adapter moved to chronological with face priority deciding only the hero.
- School stores (24): assertion helpers looked under `<household>/apps/school/...`, but household-scoped school data has no `apps/` segment (verified on disk); the `apps/` layout applies only to `users/{id}/apps/{app}/`. Also the `history` shelf was folded into `civilization`, and corrupt-file events log at `error`, not `warn`. A stale docstring in `YamlTokenRegistry` that encoded the wrong path was corrected.

### Still failing (52), all unrelated and untouched

- **Laser printer (11)** — *environment, not code*: this Mac's Homebrew Ghostscript 10.07.0 has no `urf` output device compiled in, so `gs -sDEVICE=urf` fails. Needs either a gs built with `urf` (cups-filters) or a capability guard on the tests. Flagged rather than skipped, per the project's "skipping is not passing" rule.
- **Piano router (6)** — tests construct `createPianoRouter` without the now-required `pianoContainer`; needs a fixture container.
- School golden/PDF/EscPos renders (7), schoolcalc conformance (5), configLoader (4), fitness voice memo (4), fitness domain (3), and single failures in scripture resolver, jamcorder, schoolRouter, infrastructure-ownership, notification config, Life UserSwitcher.
- `life-plan-authoring` fails only under full-suite parallel load (10s setup-hook timeout); passes 3/3 in isolation.

### Follow-up worth doing

`/api/v1/local/thumbnail` serves the **original** image for image files (a `TODO: Use sharp to resize` is in the route). A 1 MB JPEG now loads per admin row avatar. `sharp` is not installed; `ffmpeg` is already shelled out to for video frames and could resize images the same way.
