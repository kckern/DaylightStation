# Season-as-Show Design

**Date:** 2026-04-30
**Status:** Design (pending implementation plan)
**Author:** brainstorm session, kc + Claude

## 1. Goal

Surface a single Plex season as a standalone tile in the Fitness menu, alongside the existing playlist-as-show and collection patterns. Driving instance: surface Super Blocks Season 2023121 (plex:603856, "LIIFT MORE Super Block", 22 episodes) on the Strength menu without exposing the rest of Super Blocks.

This extends the established playlist-as-show pattern. A Plex season is a different container, but the user-facing role — "a curated, standalone show tile" — is the same.

## 2. Motivation

Plex collections only accept whole shows. The operator wants editorial control over which curated *seasons* appear in a fitness category, not just whole shows or playlists. Today this is impossible without manually maintaining a Plex playlist that mirrors the season — extra work and prone to drift.

## 3. Non-goals

- Per-season override maps in `fitness.yml`. Season title/summary live in Plex; if they're wrong, fix them in Plex.
- Hiding the season from its parent show. The parent show isn't currently in any nav, and a hide mechanism would be premature complexity.
- Virtual sub-season chunking for long seasons. Flat rendering only.
- New `nav_item` types (`plex_season`, etc.). Season IDs ride inside the existing `collection_ids` array.
- Automatic exposure of *all* seasons of a show. Operator picks specific seasons by ID.
- Per-season labels stored on the season in Plex. Labels inherit from the parent show; per-season overrides are deferred until a real use case demands them.

## 4. Architecture

Three layers, each touched minimally. No new entities, no new endpoints — existing endpoints learn to handle one more Plex `type`.

### 4.1 Data hygiene (operator workflow, separate task)

The operator uses the existing `cli/plex-sync.cli.mjs` pull → edit → push cycle to set season-level `title` and `summary` in Plex itself:

```bash
node cli/plex-sync.cli.mjs pull --filter "Super Blocks"
# Edit YAML: locate seasons[] entry where index=2023121,
# set title: "LIIFT MORE Super Block" and a real summary.
node cli/plex-sync.cli.mjs push --filter "Super Blocks"
```

This is a separate task from the code work in this spec. It must be done before the operator adds the season ID to `fitness.yml`, otherwise the tile renders with Plex's default season title (e.g., `"Season 2023121"`) — usable but ugly. No code-side fallback is provided; the bad title is the visible signal that the operator skipped step.

### 4.2 Backend changes

Two existing endpoints get one new branch each.

**`GET /api/v1/list/plex/{id}`** — currently resolves to a Plex collection (multi-item list) or playlist (single tile, `sourceType: 'playlist'`). New branch: when Plex responds with `type='season'`, build a single tile mirroring the playlist case:

```js
{
  id: `plex:${seasonId}`,
  title: <season.title from Plex>,
  type: 'show',                  // routing discriminator — FitnessMenu treats as a show tile
  sourceType: 'season',          // distinguishes from collection items and playlist tiles
  childCount: <season.leafCount>,
  thumbnail: <season.thumb>,
  image: <season.thumb>,
  rating: <season.rating || undefined>,
  userRating: <season.userRating || undefined>,
  queue: { contentId: `plex:${seasonId}`, plex: <seasonId> },
  list: { contentId: `plex:${seasonId}`, plex: <seasonId> }
}
```

The new tile-shaping code MUST pass through `userRating` and `rating` from Plex season metadata. Seasons sort by rating like regular shows (no priority bucket), so absent values mean the tile sinks to the bottom of the menu. The implementer should verify that whatever Plex adapter call retrieves the season's metadata exposes these fields and that the new shaping branch reads them.

**`GET /api/v1/fitness/show/{id}/playable`** — currently loads a show or playlist; for playlists it normalizes the flat episode list. New branch: when the id resolves to a Plex season, return the season's episodes with:

```js
{
  info: {
    type: 'season',                                   // discriminator for frontend rendering
    title: <season.title>,
    summary: <season.summary>,
    image: <season.thumb>,
    labels: <inherited from parent show, see 4.2.1>
  },
  items: [<22 episodes, in Plex order>],
  parents: {}                                         // no virtual seasons; flat rendering
}
```

Episodes within `items` retain their natural Plex linkage: `parentId` = season ratingKey (603856), `grandparentId` = show ratingKey (603855), `grandparentTitle` = show title. This matches how playlist-as-show episodes already behave and means resume tracking continues to key on the show. The seasons-derivation fallback in `FitnessShow` (lines 818-836) will synthesize one entry from the shared parentId, which yields `seasons.length === 1` and the filter bar stays hidden.

#### 4.2.1 Label inheritance

Plex seasons don't carry their own labels. The playable endpoint MUST fetch the parent show's metadata (Plex season's `parentRatingKey` points to the show) and copy `labels` into the season `info`. This drives:

- `isResumable` (resumable_labels match)
- `isSequential` (sequential_labels match — yes, sequential locking applies if the parent show has the label)
- `isGovernedShow` (governed_labels or governed_types match)

Implementation: one extra Plex metadata fetch keyed by the season's `parentRatingKey`. Cache the show metadata for the lifetime of the request. If the show fetch fails, fall back to empty labels — degraded UX (no governance/resume gating) for that load only, not a 500.

### 4.3 Config

`fitness.yml` mixes the season ID into the existing `collection_ids` array. No new keys.

```yaml
- type: plex_collection_group
  name: Strength
  icon: weights
  order: 20
  target:
    collection_ids: [364853, 674574, 603856]  # collection, collection, season
```

The first time this lands, only one ID will be a season; the syntax just *allows* it. Same syntactic shape as the existing Stretch entry, which already mixes a playlist with a collection.

### 4.4 Frontend

Effectively zero changes. The existing dispatch:

- `FitnessMenu` renders the tile from the API response — already keys off `type: 'show'`. The `sourceType: 'season'` value flows through but is not a sort discriminator; seasons sort by rating like regular shows.
- `handleNavigate('show', target)` routes to `/fitness/show/603856` — works as-is.
- `FitnessShow` reads `info.type` for the playlist branch (`info.type === 'playlist'` triggers `buildVirtualSeasons`). The new `info.type === 'season'` value falls through that check, so virtual season construction is skipped automatically. With `parents: {}` from the backend, the season filter bar (which only renders when `seasons.length > 1`) hides itself. Result: flat episode grid, single show poster on the left, no chunking. No frontend code changes required.

If the backend returns `parents` populated for some reason, the season filter bar appears with one entry — visually wrong but functionally harmless. The fix is on the backend (return `parents: {}`), not the frontend.

## 5. Data flow

```
fitness.yml: collection_ids: [..., 603856]
        │
        ▼
FitnessMenu: GET /api/v1/list/plex/603856
        │
        ▼
Backend list endpoint: Plex says type='season'
  → build single tile { type:'show', sourceType:'season',
                         title: <season title from Plex>,
                         image: <season thumb>,
                         userRating: <season rating> }
        │
        ▼
FitnessMenu: tile rendered alongside collection items, sorted by rating
        │
        ▼ (user taps)
FitnessApp.handleNavigate('show', tile) → /fitness/show/603856
        │
        ▼
FitnessShow: GET /api/v1/fitness/show/603856/playable
        │
        ▼
Backend playable service: target is a season
  → fetch season's episodes
  → fetch grandparent show metadata for label inheritance
  → return { info: { type:'season', labels:<from-show>, ... },
             items: [...22], parents: {} }
        │
        ▼
FitnessShow: info.type='season' → no virtual seasons branch fires,
             parents:{} → no season filter bar,
             render episodes flat.
```

## 6. Edge cases

| Case | Behavior |
|------|----------|
| Plex returns `type='show'` for an ID in `collection_ids` | Log warning, skip. Whole shows belong inside a Plex collection. |
| Plex returns `type='movie'` / `'episode'` / null | Log warning, skip. |
| Operator forgets to run `plex-sync` after editing YAML | Tile shows `"Season N"` raw. Visible signal — fix the data, no code change. |
| Season `rating` / `userRating` absent | Pass-through undefined. Existing menu sort `(b.rating || 0) - (a.rating || 0)` puts unrated tiles last. |
| Grandparent show fetch fails during playable | Fall back to empty `labels`. User loses governance/resume gating for that load. Not a 500. |
| Season has zero episodes | Return `{ info, items: [] }`. `FitnessShow` already renders the empty state. |
| Playing an episode from inside season-as-show | `episode.grandparentId` still points to the show (603855) — Plex populates this natively. Resume tracking and progress aggregation key on the show, identical to playlist-as-show behavior. No change. |
| Parent show has sequential label | Inherited. The season's 22 episodes lock progressively. This is the intended default — a curated season is a sequence, not a buffet. To change behavior for one season, remove the sequential label from the parent show. |

## 7. Testing

Three layers, each small:

**Backend unit/integration:**
- List endpoint test: Plex `type='season'` response → single tile with `sourceType:'season'`, `type:'show'`, `userRating` populated.
- Playable service test: season-ID branch returns episodes flat, `info.type='season'`, `info.labels` matches the mocked grandparent show's labels, `parents` is `{}`.

**Live smoke (Playwright or manual):**
- Open `/fitness/menu/364853,674574,603856` (Strength group) → "LIIFT MORE Super Block" tile renders alongside collection shows.
- Tap it → land on `/fitness/show/603856`, see 22 episodes flat, no season filter bar.
- Play one episode → progress tracking works; returning to the season tile shows the watched marker.

**Plex CLI workflow validation (manual, separate task):**
- `plex-sync pull --filter "Super Blocks"` produces a YAML with `seasons[]` array containing index `2023121`.
- After hand-edit, `plex-sync push --filter "Super Blocks" --dry-run` reports the title/summary diff for that season only.
- Real push → `/api/v1/fitness/show/603855/playable` shows `parents['603856'].title = "LIIFT MORE Super Block"`.

## 8. Order of operations to ship

1. Implement the backend list/playable branches and the adapter rating pass-through. Land code.
2. Operator runs the `plex-sync pull/edit/push` cycle to set Super Blocks Season 2023121's title and summary in Plex (separate task — needs research and data collection per operator's note).
3. Operator adds `603856` to the Strength `collection_ids` array in `fitness.yml`.

Step 1 is independent of step 2. The code can land first; the feature is dormant until step 3, and step 3 is gated on step 2 producing usable titles.

## 9. Open follow-ups (not blocking this spec)

- A future plex-sync pass should also enable label edits per season (the existing CLI handles labels at show level; extending to seasons is straightforward but not required now).
- If multiple seasons end up surfaced via this mechanism, revisit whether `playlist_episodes_per_season`-style chunking should apply to long seasons. For now, all in-scope seasons fit the flat rendering case.
