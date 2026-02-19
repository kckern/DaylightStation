# Content Plugin Registry Design

## Problem

YouTube content enters the system through multiple paths (FreshRSS subscriptions, direct YouTube API searches) but only direct API items get YouTube-specific rendering. FreshRSS-originated YouTube items render as plain text articles in both the Reader inbox and Scroll masonry feed. There is no mechanism to detect and enrich content by type regardless of source.

## Solution

A **ContentPluginRegistry** — a post-processing enrichment layer that inspects normalized items from any source adapter and applies content-type-specific metadata. YouTube is the first plugin. The registry is extensible for future content types (podcasts, etc.).

### Key Distinction

- `source` = where the item came from (freshrss, youtube, reddit)
- `contentType` = what kind of content it is (youtube, podcast, article)
- An item can be `source: 'freshrss', contentType: 'youtube'`

## Architecture

### Backend

**ContentPluginRegistry** (`backend/src/3_applications/feed/services/ContentPluginRegistry.mjs`)
- Holds ordered list of `IContentPlugin` instances
- `enrich(items)` iterates items; for each, first matching plugin wins
- Items with existing `contentType` or matching `source` skip detection

**IContentPlugin interface** (`backend/src/3_applications/feed/plugins/IContentPlugin.mjs`)
- `contentType: string` — e.g., `'youtube'`
- `detect(item): boolean` — URL pattern match
- `enrich(item): object` — returns metadata to merge onto item

**YouTube plugin** (`backend/src/1_adapters/feed/plugins/youtube.mjs`)
- `detect`: checks `item.link` for `youtube.com/watch`, `youtu.be/`, `youtube.com/embed/`
- `enrich`: extracts `videoId`, returns:
  - `contentType: 'youtube'`
  - `meta.videoId`, `meta.playable: true`, `meta.embedUrl`
  - `meta.imageWidth: 1280`, `meta.imageHeight: 720`
  - `image: https://img.youtube.com/vi/{videoId}/hqdefault.jpg` (if missing)
- Items with `source === 'youtube'` skip (already fully enriched by YouTubeFeedAdapter)

**Integration:**
- `FeedAssemblyService` calls `registry.enrich(items)` after pool fetch
- `feed.mjs` router `/reader/stream` calls `registry.enrich(result)` after FreshRSS enrichment

### Frontend

**Content plugin registry** (`frontend/src/modules/Feed/contentPlugins/index.js`)
- `getContentPlugin(item)` — checks `item.contentType` field, returns plugin or null
- Each plugin exports: `{ contentType, ScrollBody, ReaderRow }`

**YouTube plugin** (`frontend/src/modules/Feed/contentPlugins/youtube.jsx`)
- `ScrollBody`: channel name, duration badge, "YouTube" label (similar to MediaBody)
- `ReaderRow`: collapsed = thumbnail with play icon overlay + title/channel/age; expanded = YouTube iframe embed + meta

**View integration:**
- `FeedCard.jsx`: check `getContentPlugin(item)` before `getBodyModule(item.source)`. Plugin takes priority, existing body registry is fallback.
- `ArticleRow.jsx`: check `getContentPlugin(item)`. If matched, delegate to `plugin.ReaderRow`.

## Data Flow

```
FreshRSS RSS (youtube.com/feeds/videos.xml)
  → FreshRSSFeedAdapter.getItems()
  → feed.mjs /reader/stream enrichment (isRead, preview, tags)
  → ContentPluginRegistry.enrich() — detects YouTube, merges metadata
  → Frontend receives { ...item, contentType: 'youtube', meta: { videoId, playable, ... } }
  → getContentPlugin(item) → youtube plugin
  → Reader: ReaderRow (thumbnail + play overlay / embed)
  → Scroll: ScrollBody (YouTube-styled card)
```

Direct YouTube API items (`YouTubeFeedAdapter`) already have full metadata — registry skips them, frontend renders via same plugin.

## File Changes

### New Files

| File | Layer | Purpose |
|---|---|---|
| `backend/src/3_applications/feed/services/ContentPluginRegistry.mjs` | Application | Registry class |
| `backend/src/3_applications/feed/plugins/IContentPlugin.mjs` | Application | Plugin interface |
| `backend/src/1_adapters/feed/plugins/youtube.mjs` | Adapter | YouTube detection + enrichment |
| `frontend/src/modules/Feed/contentPlugins/index.js` | Frontend | Frontend plugin registry |
| `frontend/src/modules/Feed/contentPlugins/youtube.jsx` | Frontend | YouTube renderers |

### Modified Files

| File | Change |
|---|---|
| `backend/src/app.mjs` | Instantiate registry + YouTube plugin, pass to services/router |
| `backend/src/4_api/v1/routers/feed.mjs` | Call `registry.enrich()` in `/reader/stream` |
| `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx` | Check `getContentPlugin()` before `getBodyModule()` |
| `frontend/src/modules/Feed/Reader/ArticleRow.jsx` | Check `getContentPlugin()`, delegate to `ReaderRow` |

### Not Modified

- `FreshRSSFeedAdapter.mjs` — stays a clean GReader API wrapper
- `YouTubeFeedAdapter.mjs` — already produces correct metadata
- `bodies/index.js` — remains fallback body module registry
