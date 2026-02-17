# Feed Filter Parameter Design

## Problem

The feed scroll endpoint (`/api/v1/feed/scroll`) always returns the full mixed feed from all sources via the tier assembly algorithm. There's no clean way to view a single source, a specific tier, or a named query in isolation. The existing `?source=` and `?focus=` params are crude — `source` bypasses all logic and dumps by timestamp, `focus` only works within the wire tier.

## Solution

A new `?filter=` query parameter that accepts a compound ID expression (`prefix:rest`), resolved through a ContentIdResolver-style chain. This unifies source filtering, tier filtering, and named query access into one parameter.

---

## URL Format

```
/feed/scroll?filter=<expression>
```

Where `<expression>` is `prefix` or `prefix:rest`, with `rest` being comma-separated values.

### Examples

| URL | Prefix | Rest | Resolution |
|-----|--------|------|------------|
| `?filter=reddit:worldnews,usnews` | `reddit` | `worldnews,usnews` | Source `reddit`, subsources filtered |
| `?filter=reddit` | `reddit` | (none) | Source `reddit`, all subsources |
| `?filter=compass` | `compass` | (none) | Tier `compass`, all its sources |
| `?filter=scripture-bom` | `scripture-bom` | (none) | Query file `scripture-bom.yml` |
| `?filter=photos:felix` | `photos` | `felix` | Alias -> `immich`, subsource `felix` |
| `?filter=headlines:cnn,cbs` | `headlines` | `cnn,cbs` | Source `headline`, subsources filtered |

### Combining with existing params

- `?filter=reddit&cursor=abc&limit=20` -- filter narrows source, cursor/limit paginate within it
- `?filter=` takes precedence over `?source=` and `?focus=` if both present
- `?source=` and `?focus=` remain for backward compat

---

## FeedFilterResolver -- Resolution Chain

A new stateless resolver class modeled after `ContentIdResolver`. Constructed with the list of tier names, registered adapter source types, query filenames, and an alias map.

```
Input: "reddit:worldnews,usnews"
  -> split on first ':'  ->  prefix="reddit", rest="worldnews,usnews"
  -> rest split on ','   ->  subsources=["worldnews","usnews"]
```

### Layer 1: Tier match
- Is prefix one of: `wire`, `library`, `scrapbook`, `compass`?
- Result: `{ type: 'tier', tier: 'compass' }`
- Behavior: Fetch only sources assigned to that tier

### Layer 2: Source type match
- Does any registered feed adapter have `sourceType === prefix`?
- Result: `{ type: 'source', sourceType: 'reddit', subsources: ['worldnews','usnews'] }`
- Behavior: Fetch only that adapter with subsource filter

### Layer 3: Query name match (exact)
- Does `queries/{prefix}.yml` exist?
- Result: `{ type: 'query', queryName: 'scripture-bom' }`
- Behavior: Fetch only that query's adapter with its configured params

### Layer 4: Alias
- Is prefix in the alias map?
- Resolves alias then re-runs from Layer 2
- Example: `photos` -> `immich`, then Layer 2 matches `immich`

If no layer matches, `resolve()` returns `null` (no filter applied, normal mixed feed).

---

## Filtered Feed Behavior

When a filter is active, the assembly pipeline is **bypassed**:
- No tier interleaving
- No spacing enforcement
- No diversity caps
- Items are returned sorted by timestamp (newest first)
- Standard cursor-based pagination still applies

This makes filtered views behave as a simple chronological feed for that source/tier.

---

## Subsource Filtering Per Adapter

When the resolver returns subsources, they're added to the query object as `query.subsourceFilter: string[]`. Each adapter interprets them according to its data model:

| Source Type | Subsource Meaning | Example |
|-------------|-------------------|---------|
| `reddit` | Subreddit names | `reddit:worldnews,usnews` |
| `headlines` | Outlet/publisher names | `headlines:cnn,cbs` |
| `youtube` | Channel IDs or names | `youtube:veritasium,3b1b` |
| `googlenews` | Topic slugs | `googlenews:tech,science` |
| `immich`/`photos` | Person/face names | `photos:felix` |
| `freshrss` | Feed IDs or categories | `freshrss:hn,lobsters` |
| `komga` | Series names/IDs | `komga:xmen` |
| `plex` | Library/collection names | `plex:movies` |
| `tasks` | Project or label filter | `tasks:work` |

Adapters that don't have a natural subsource concept (weather, health, gratitude) ignore the subsource filter and return their single item regardless.

---

## Frontend

- `Scroll.jsx` reads `?filter=` from `useSearchParams()` and appends to API call
- No UI changes in v1 -- URL-only, power-user/dev feature
- Deep links (`/feed/scroll/:slug`) unaffected
- Future: filter chips or source selector can set `?filter=` via `setSearchParams()`

---

## Alias Config (deferred)

When needed, aliases go in the user's `config/feed.yml`:

```yaml
scroll:
  aliases:
    photos: immich
    scripture: scripture-bom
    news: headlines
```

Not implemented in v1 -- the resolver accepts an alias map at construction but it can be empty initially.

---

## File Changes

### New
- `backend/src/3_applications/feed/services/FeedFilterResolver.mjs` -- 4-layer resolution chain

### Modified
- `backend/src/4_api/v1/routers/feed.mjs` -- parse `?filter=`, resolve, pass to assembly
- `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` -- accept resolved filter, narrow source fetching, bypass assembly when filtered
- `frontend/src/modules/Feed/Scroll/Scroll.jsx` -- read `?filter=` from URL, pass to API

### Adapter changes (as needed for subsource filtering)
- Individual adapters check `query.subsourceFilter` and apply source-specific filtering
- Reddit subreddit filtering is highest priority for v1

### Not changed
- `?source=` and `?focus=` remain for backward compat
- No new config files in v1
- No UI components added

---

## Implementation Status

- [x] FeedFilterResolver class with 4-layer chain (21 tests)
- [x] Router parses `?filter=` param (2 tests)
- [x] FeedAssemblyService bypasses assembly for filtered views
- [x] Scroll.jsx passes `?filter=` to API
- [x] Pool items tagged with `queryName` metadata
- [x] Built-in types (freshrss, headlines, entropy) supported via `builtinTypes` param
- [ ] Alias config in user's feed.yml (deferred)
- [ ] UI filter controls (deferred)
- [ ] Per-adapter subsource filtering beyond meta.subreddit (deferred)
