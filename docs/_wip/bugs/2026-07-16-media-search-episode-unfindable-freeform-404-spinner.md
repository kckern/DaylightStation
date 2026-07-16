# Media search: exact-title episode search returns nothing → freeform fallback dispatches raw text → 404 → infinite "Starting…" spinner

**Reported:** 2026-07-16 (user: "I just tried to search on the Media module. How did it go?" — it did not go well)
**Severity:** High — a user typed the **exact title** of an item that exists in Plex, waited ~8 s, got **zero real results**, and the only actionable row offered (the freeform "use as raw value" option) dispatched the literal search string as a content id, producing a 404 and a Player overlay stuck on "Starting…" with no user-visible error. Every layer of the funnel failed: search recall, search latency, source resilience, the empty-result fallback UX, URL construction, and playback error handling.
**Status:** Diagnosed, not fixed. Four independent root causes identified (RC1–RC4) plus two secondary defects (S1–S2).

---

## Incident summary (2026-07-16, frontend ts = UTC, backend ts = UTC-7 local)

Surface: Media content search (`media-content-search` → `ContentCombobox`), Mac Chrome (`172.18.0.53`).
Query: **`Think! How Intelligent Are Animals?`** — an episode that **exists in Plex** (verified below).

| Time (UTC) | Event | Meaning |
|---|---|---|
| 18:04:25.436 | `search.dispatch` `{text: "Think! How Intelligent Are Animals?", mode: "sse"}` | User submitted the query (`useContentCombobox`) |
| 18:04:25.437 | `search.started` `{endpoint: "/api/v1/content/query/search/stream", filterParams: "take=50"}` | SSE streaming search began (`useStreamingSearch`) |
| ~18:04:26 | `[ImmichAdapter] search error: durationStr.split is not a function` (raw console line, not structured) | **Immich source crashed** mid-search |
| 18:04:30.485 | `search.source-error` `{source: "files", error: "files timeout after 5000ms"}` | files source timed out |
| 18:04:31.505 | `search.source-error` `{source: "abs", error: "abs timeout after 6000ms"}` | Audiobookshelf timed out |
| 18:04:33.531 | `search.source-error` `{source: "singalong", error: "singalong timeout after 8000ms"}` | singalong timed out |
| 18:04:33.629 (11:04:33 local) | `content-query.searchStream.complete` `{totalMs: 8039, adapterCount: 16}` | Backend finished after **8.04 s** |
| 18:04:33.531 | `search.completed` | Frontend search ended — **no Plex hit for the episode was ever streamed** |
| 18:05:19.235 | `freeform.commit_via_option` `{freeformValue: "Think! How Intelligent Are Animals?", prevValue: ""}` | User, faced with no real results, selected the freeform "use as raw value" row |
| 18:05:19.236 | `select` `{contentId: "Think! How Intelligent Are Animals?", title: null, type: null}` | Raw query text became the contentId |
| 18:05:19.237 | `dispatch` + `session.state-change idle→loading` | Player session started for the bogus id |
| 18:05:19.329 | `API Error Response: {"error":"Unknown source: Think! How Intelligent Are Animals"}` | Backend 404. **Note the trailing `?` is gone** — the raw text was interpolated into the request URL unencoded, so `?` started the query string |
| 18:05:19.330 | `playback.fetch-media-failed` `{httpStatus: "404"}` + **`unhandledrejection`** (same error) | Fetch failure also escaped as an unhandled promise rejection |
| 18:05:19.343 | `playback.queue-init-empty` `{contentRef: "Think! How Intelligent Are Animals?"}` | Queue init got nothing |
| 18:05:19.344 | `session.state-change loading→ended` | Session machine correctly gave up… |
| 18:05:19 → 18:05:33+ | `playback.overlay-summary` `status:Starting…` every 1 s (waitKey `00182a9e82`, `vis:14001ms` and climbing, `startup:armed attempts=0 timeout=n/a`) | …but the loading overlay **kept rendering "Starting…" indefinitely** with no error, no timeout armed, no dismissal |

The user's experience: typed an exact title → 8-second wait → nothing → clicked the only offered row → permanent spinner.

---

## Ground truth: the item exists and Plex's own search finds it

Verified via `cli/plex.cli.mjs` (which calls the **same** Plex `hubs/search` endpoint the adapter uses):

```
$ node cli/plex.cli.mjs search "Think! How Intelligent Are Animals?" --deep

  [381439] Think! How Intelligent Are Animals?
      Type: episode (2022)
      Context: Science > Zoology: Understanding the Animal World
```

Plex hub search returns the episode as an exact title match. The app's search pipeline received it and **threw it away** (RC1).

---

## Root causes

### RC1 (primary, backend): PlexAdapter tier-1 type filter silently drops `episode` results

`backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1786-1858` — `search()` runs `hubSearch` (which DOES return episodes), then at tier 1 filters to:

```js
const TIER1_DEFAULT_TYPES = ['show', 'movie', 'artist', 'album', 'collection', 'track'];  // :1844
```

`episode` (and `clip`, `season`) are excluded. Callers can override via `query.tier1AllowedTypes` or request `tier: 2` (which hydrates episodes, `:1871`), but **nothing in the search-stream path ever does**: neither `ContentQueryService.searchStream` (`backend/src/3_applications/content/ContentQueryService.mjs:236`) nor the content router sets `tier` or `tier1AllowedTypes` (grep for `tier` in both files: zero hits in the router, none in the query service). So the global media search runs permanently at tier 1 defaults → **episode titles are structurally unfindable**, no matter how exact the query.

The intent behind the tier-1 list (per the code comment, `:1839-1847`) was "drill-down containers + tracks" — i.e. searching a song returns the song, but searching an episode returns only its show *if the show title matches*. Here the episode title shares no tokens' prefix hub-match with the show title ("Zoology: Understanding the Animal World"), so nothing surfaced at all.

**Fix direction:** include `episode` in `TIER1_DEFAULT_TYPES` (mapping through `_hubResultToListableItem`/a light episode conversion — the hub result already carries `grandparentTitle` for context), or have the search-stream endpoint pass `tier1AllowedTypes` including `episode`. Tracks already prove the "leaf items belong in tier 1" precedent.

### RC2 (backend): ImmichClient.parseDuration crashes the whole Immich search on non-string duration

`backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs:313-320`:

```js
parseDuration(durationStr) {
  if (!durationStr || durationStr === '0:00:00.00000') return null;
  const parts = durationStr.split(':');   // ← TypeError when duration is not a string
```

Called from `ImmichAdapter.mjs:869-870` (`this.#client.parseDuration(asset.duration)` for video assets) while mapping search results. Some asset in the result set carried a non-string `duration` (Immich has returned numbers/objects for duration across API versions). One bad asset → entire Immich source contributes zero results for the query.

Note the two-shape Immich lesson already on file (`reference_immich_two_face_shapes`) — this is the same genre of failure: Immich payload shape drift, unguarded.

**Fix direction:** type-guard (`if (typeof durationStr !== 'string') return Number.isFinite(durationStr) ? Math.round(durationStr) : null;`), and map per-asset failures to a skipped asset, not a dead source.

### RC3 (backend/infra): three sources timed out; search waits 8 s for stragglers

Per-source budgets come from `ContentQueryService` (`adapterTimeoutMs=3000` default, `sourceTimeoutsMs` overrides — `ContentQueryService.mjs:39-59`); observed: `files` 5000 ms, `abs` 6000 ms, `singalong` 8000 ms — **all three hit their ceiling** on this query, and the stream's `totalMs` (8039) equals the largest ceiling. So the UI's completion signal is gated on the slowest configured straggler even when everything useful arrived in the first second.

Whether these three time out on *every* query or were cold-start slow needs a follow-up probe (see Open Questions). Either way, three of 16 sources silently degraded and the UI treated it as routine.

### RC4 (frontend, UX): the freeform "raw value" escape hatch is presented to a dead-end search and dispatches guaranteed-404 text

`frontend/src/modules/Content/combobox/ContentCombobox.jsx:170-194` — `commitExplicitRaw()` deliberately bypasses resolution ("we save the RAW string unconditionally — NO resolution, no warn toast"). That's a sensible power-user path for typing `plex:12345` into admin list editors. But in the **Media search** context it was the *only actionable row* after a failed search, so a normal user reasonably clicked it — and the raw English sentence went straight to the play pipeline:

- `media-content-search` `dispatch` → play request → `play.mjs` router `/:source/*splat` (`backend/src/4_api/v1/routers/play.mjs:265-277`) → `Unknown source` 404.

**Fix direction:** in dispatch-to-player contexts, the freeform row should either be suppressed, resolve-checked before dispatch (an `/api/v1/content/query/resolve` preflight), or clearly labeled as an id-input escape hatch — not rendered where it reads as "play this".

---

## Secondary defects

### S1: contentId is interpolated into the request URL unencoded

The backend error says `Unknown source: Think! How Intelligent Are Animals` — **without the trailing `?`**. The raw contentId was placed into the URL path unescaped, so the browser treated `?` as the query-string separator (an encoded `%3F` would have round-tripped through Express param decoding and appeared in the error). Any legitimate content id containing `?`, `#`, `&`, or spaces would be mangled the same way on this code path (frontend fetch in the Player's media-info request — same family as the URL mangling documented in `2026-06-19-stream-source-raw-url-mangling-and-silent-proxy.md`).

### S2: Player loading overlay survives session death — "Starting…" forever, no error surfaced

After the 404, the session machine did the right thing (`loading → ended` at 18:05:19.344, `playback.queue-init-empty` logged). But `PlayerOverlayLoading` (waitKey `00182a9e82`) kept emitting `status:Starting…` summaries — `vis:14001ms` and climbing 14+ s later, with `startup:armed attempts=0 timeout=n/a`, i.e. **no startup watchdog ever armed and nothing dismisses the overlay on fetch failure**. This is the same "stuck overlay outlives a dead dispatch" gap documented in `2026-07-07-nfc-play-next-url-fallback-misparse-nothing-plays.md` (Gap G1) and `2026-03-22-stale-player-overlay-blocks-video.md` — this incident confirms it also fires on the plain in-app dispatch path, not just NFC/URL delivery. Also note the fetch failure additionally escaped as an `unhandledrejection` (18:05:19.330), so the failure path isn't even fully caught.

---

## Failure funnel (why this compounded so badly)

```
exact-title query for an existing item
  → RC1: only source that has it filters it out (episodes invisible at tier 1)
  → RC2: immich source crashes (contributes nothing, logs a raw console line)
  → RC3: files/abs/singalong all time out; user stares at a spinner for 8 s
  → UI: zero real results; the freeform raw-value row is the only clickable thing
  → RC4: user clicks it; raw sentence dispatched as a contentId
  → S1: trailing "?" eaten by unencoded URL interpolation
  → backend correctly 404s ("Unknown source")
  → S2: overlay ignores the failure and spins on "Starting…" indefinitely
```

A single fix at RC1 would have made the incident invisible; each later layer then failed to contain the blast.

---

## Recommended fixes (priority order)

1. **RC1 — make episodes searchable** (`PlexAdapter.mjs:1844`): add `episode` to `TIER1_DEFAULT_TYPES` with a lightweight conversion carrying `grandparentTitle`/`parentTitle` context (no per-item hydration — keep tier 1 fast), or pass `tier1AllowedTypes` from the search-stream call site. Add a regression test: hub result of type `episode` must appear in tier-1 `search()` output.
2. **S2 — kill the immortal spinner**: on `playback.fetch-media-failed` / `queue-init-empty`, the loading overlay must transition to a visible error state (with dismissal), and the media-info fetch must not leak an `unhandledrejection`.
3. **RC2 — guard `parseDuration`** (`ImmichClient.mjs:313`): accept string/number/null; per-asset try/catch in the search mapping; route the error through the structured logger instead of bare `console.error`.
4. **RC4 — gate the freeform row in play contexts**: preflight-resolve before dispatch, or restyle/suppress in `media-content-search`.
5. **S1 — encode contentId** everywhere it enters a URL path (`encodeURIComponent`), matching the fix pattern from the stream-source mangling bug.
6. **RC3 — instrument the stragglers**: log per-source elapsed in `searchStream.complete` (currently only `totalMs`), then decide whether files/abs/singalong need warm caches, tighter budgets, or index fixes. Consider completing the UI's "search done" state when all *responsive* sources land, with late results streamed in.

---

## Open questions

- **Q1:** Do `files`, `abs`, and `singalong` time out on *every* query (structural: cold index / serialized upstream) or only under cold-start? One-off probe: run three consecutive searches and compare per-source timings once per-source elapsed logging exists.
- **Q2:** What `duration` shape did Immich actually return? (Reproduce with the same query against the Immich search API and inspect the video assets — determines whether the guard should coerce numbers or ignore objects.)
- **Q3:** Should tier 2 (hydrating) search ever be reachable from the UI (e.g. a "deep search" affordance), or is enriching tier 1 with episodes sufficient?

---

## Reproduction

1. Pick any Plex **episode** whose title doesn't share its show's title (e.g. `[381439] Think! How Intelligent Are Animals?` in Science → *Zoology: Understanding the Animal World*).
2. In the Media app search box, type the exact episode title. → No result for the episode (RC1). Wait for the ~8 s completion (RC3).
3. Select the freeform "use as raw value" row. → 404 `Unknown source` (RC4/S1) and a Player overlay stuck on "Starting…" (S2).

CLI ground-truth check: `node cli/plex.cli.mjs search "<episode title>" --deep` → item exists.
