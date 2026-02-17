# Readalong Feed Adapter Design

**Date:** 2026-02-16

## Purpose

Surface readalong content (scripture, talks, etc.) as feed cards. Each card represents the user's "next up" chapter based on read/watch progress. Tapping a card opens the full chapter text in the feed detail view with optional audio playback.

## Backend: ReadalongFeedAdapter

New file: `backend/src/1_adapters/feed/sources/ReadalongFeedAdapter.mjs`

- Extends `IFeedSourceAdapter`
- `sourceType`: `'readalong'`
- Constructor dependency: existing `ReadalongAdapter` instance (reuses progress tracking, resolver logic, media probing)

### fetchItems(query, username)

1. Reads `query.params.collection` and `query.params.volume`
2. Calls `ReadalongAdapter.resolvePlayables()` with `{collection}/{volume}` to get the next unread chapter
3. Calls `ReadalongAdapter.getItem()` on the resolved chapter to get full metadata (title, heading, duration)
4. Returns a single FeedItem-shaped object:

```js
{
  id: `readalong:${collection}/${textPath}`,
  tier: query.tier || 'compass',
  source: 'readalong',
  title: chapterReference,        // e.g., "Alma 32" via generateReference()
  body: heading || summary,       // e.g., "Alma teaches the poor about faith"
  image: collectionIconUrl,       // /api/v1/local-content/collection-icon/readalong/scripture
  link: null,
  timestamp: new Date().toISOString(),
  priority: query.priority || 5,
  meta: {
    collection,
    volume,
    contentId: canonicalId,       // full readalong:collection/path ID
    audioUrl: mediaUrl,           // /api/v1/stream/readalong/...
    duration,
    sourceName: collectionDisplayName,
    sourceIcon: collectionIconUrl,
  }
}
```

### getDetail(localId, meta, username)

1. Reconstructs compound ID from `meta.contentId`
2. Calls `ReadalongAdapter.getItem()` to load full verse data
3. Returns sections:

```js
{
  sections: [
    {
      type: 'audio',
      data: {
        url: item.mediaUrl,
        duration: item.duration
      }
    },
    {
      type: 'scripture',
      data: {
        blocks: item.content.data,      // raw verse array
        contentType: item.content.type   // 'verses', 'paragraphs', etc.
      }
    }
  ]
}
```

## Query Configuration

Per-reading-track YAML files in `data/household/config/lists/queries/`:

```yaml
# scripture-bom.yml
type: readalong
tier: compass
limit: 1
priority: 5
params:
  collection: scripture
  volume: bom
```

Multiple files for different tracks:
- `scripture-bom.yml` — Book of Mormon
- `scripture-nt.yml` — New Testament
- `talks-ldsgc.yml` — General Conference talks

Each file produces one feed card, each tracking progress independently.

## Frontend: Detail View

### Scripture Section Renderer

In `DetailView.jsx` (or a new section component), handle `type: 'scripture'`:

1. Import `convertVersesToScriptureData` and `scriptureDataToJSX` from `scripture-guide.jsx`
2. Convert raw verse data: `const blocks = convertVersesToScriptureData(data.blocks)`
3. Render: `scriptureDataToJSX(blocks)`

### Audio Section Renderer

Handle `type: 'audio'`:

1. Render a play button at the top of the detail view
2. On play, start streaming from `data.url`
3. Activate `FeedPlayerMiniBar` for persistent playback when detail view is closed

### Card Presentation

- **Title**: Chapter reference prominently displayed (e.g., "Alma 32")
- **Subtitle**: Chapter heading/summary (e.g., "Alma teaches the poor about faith")
- **Image**: Collection icon (scripture icon)
- Feed card body shows the heading text for at-a-glance context

## Registration

In `app.mjs` bootstrap, alongside other feed adapters:

```js
import { ReadalongFeedAdapter } from '#adapters/feed/sources/ReadalongFeedAdapter.mjs';

const readalongFeedAdapter = new ReadalongFeedAdapter({
  readalongAdapter,  // existing ReadalongAdapter instance
  logger
});
feedAdapters.push(readalongFeedAdapter);
```

## Dependencies

- Reuses `ReadalongAdapter` entirely — no duplicated progress/resolver logic
- Reuses `scripture-guide.jsx` for frontend rendering — no new parsing code
- Reuses `FeedPlayerMiniBar` for audio playback persistence
