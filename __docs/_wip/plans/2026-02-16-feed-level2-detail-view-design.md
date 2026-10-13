# Feed Level 2 Detail View — Design

**Date:** 2026-02-16

## Overview

Add a "level 2" detail view to the feed scroll. Tapping any card replaces the scroll column with a detail view showing expanded content (full articles, comments, EXIF, stats, etc.). Each feed adapter provides detail content via a standard sections-based interface. Back navigation restores the feed at the same scroll position.

## API

### New endpoint: `GET /api/v1/feed/detail/:itemId`

The `itemId` uses the existing `{source}:{localId}` format. The router splits on the first `:`, dispatches to the adapter's `getDetail(localId)` method.

**Response shape:**
```json
{
  "item": { /* original feed item */ },
  "sections": [
    { "type": "body", "data": { "text": "..." } },
    { "type": "comments", "data": { "items": [...] } }
  ]
}
```

### Section Types

| Type | Data Shape | Used By |
|------|-----------|---------|
| `article` | `{ title, html, wordCount }` | freshrss, headline, googlenews |
| `comments` | `{ items: [{ author, body, score, depth }] }` | reddit |
| `embed` | `{ provider, url, aspectRatio }` | youtube |
| `body` | `{ text }` | reddit selftext, journal, tasks, gratitude |
| `stats` | `{ items: [{ label, value }] }` | health, fitness, weather |
| `metadata` | `{ items: [{ label, value }] }` | photo (EXIF), plex (cast/genre) |
| `media` | `{ images: [{ url, caption }] }` | photo |
| `actions` | `{ items: [{ id, label, style, endpoint, method, body }] }` | tasks, photo, gratitude |
| `player` | `{ contentId }` | plex, immich (video), any playable media |

### Adapter Interface

Each adapter implements:
```js
async getDetail(localId) → { sections: Section[] }
```

Adapters that don't support detail (entropy) don't implement `getDetail()`.

## Adapter Detail Implementations

| Adapter | Sections | Data Source |
|---------|----------|-------------|
| Reddit | `body` + `comments` | Reddit JSON API `/r/{sub}/comments/{postId}.json` |
| FreshRSS | `article` | `WebContentAdapter.extractReadableContent()` via link |
| Headlines | `article` | Same readable endpoint |
| Google News | `article` | Same readable endpoint (follows redirects) |
| YouTube | `embed` + `body` | Embed URL from `videoId`; description from meta |
| Plex | `player` + `metadata` + `body` | ContentIdResolver via `plex:{ratingKey}` |
| Photo (video) | `player` + `metadata` | ContentIdResolver via `immich:{assetId}` |
| Photo (image) | `media` + `metadata` | Immich API via asset ID |
| Health | `stats` | Already in scroll item `meta` |
| Fitness | `stats` | Already in scroll item `meta` |
| Weather | `stats` | Household weather data |
| Journal | `body` | Already in scroll item |
| Gratitude | `body` | Already in scroll item |
| Tasks | `body` + `metadata` | Already in scroll item meta |

Grounding cards with all data already in `meta` repackage it into sections (no external fetch). Action sections can be added to any adapter for interactivity (mark done, classify, discard, etc.).

## Frontend

### Navigation Pattern

Full replace in the center column. Scroll view is hidden (not unmounted) when detail is open — preserves scroll position. URL stays `/feed/scroll`. Back button in detail header returns to feed.

**State in Scroll.jsx:**
- `selectedItem` — null or the tapped feed item
- `detailData` — null or `{ item, sections }` from API
- `detailLoading` — boolean

**Flow:**
1. Tap card → set `selectedItem`, fetch detail
2. `scroll-view` hidden, `DetailView` renders in the layout
3. Card header shown immediately as loading placeholder
4. API responds → sections render
5. Back → `selectedItem` = null, scroll view reappears

### Component Structure

```
detail/
  DetailView.jsx          — main detail container
  sections/
    ArticleSection.jsx
    CommentsSection.jsx
    BodySection.jsx
    EmbedSection.jsx
    StatsSection.jsx
    MetadataSection.jsx
    MediaSection.jsx
    ActionsSection.jsx
```

### DetailView Layout

1. **Header bar** — sticky, dark. Back arrow, source icon/name, external link icon.
2. **Hero area** — item image full-width (if present). YouTube embed replaces this.
3. **Sections** — rendered in array order from response.
4. **Actions** — button row, styled per `style` field (primary/danger/default).

## FeedPlayer — Persistent Playback

### Overview

A `FeedPlayer.jsx` component wraps `Player.jsx` (like `FitnessPlayer.jsx` does) to provide persistent playback across feed navigation. Lives at the `scroll-layout` level so it survives level 1/2 transitions.

### Content ID Resolution

FeedPlayer is **source-agnostic**. It passes the feed item's existing content ID (e.g. `plex:457385`, `immich:abc-123`) to the Player, which routes through `ContentIdResolver` to the correct adapter. No source-specific logic in FeedPlayer.

```jsx
<Player
  play={{ contentId: activeMedia.item.id }}
  clear={() => setActiveMedia(null)}
  ignoreKeys
  playerType="feed"
/>
```

### Two Modes

| Mode | When | Visual |
|------|------|--------|
| **Full** | Detail view open for the playing item | Player renders in the hero area of DetailView |
| **Mini** | User navigated back to feed while playing | Fixed bottom bar: title, play/pause, close. Tap reopens detail. |

### State (in Scroll.jsx)

- `activeMedia` — `null` or `{ item }` (the feed item being played)
- `miniMode` — `boolean` (true when user is back in feed while media plays)

### Flow

1. User opens detail view for a playable item → `player` section triggers `activeMedia` set
2. FeedPlayer renders `<Player>` in full mode within the detail hero area
3. User hits Back → `miniMode = true`, player keeps running, bottom bar appears over feed
4. User taps mini bar → reopens detail view for that item, back to full mode
5. User taps Play on a different item → previous playback stops, new `activeMedia` set (single-playback enforced)
6. User hits Close on mini bar → `activeMedia = null`, playback stops

### Mini Bar

Fixed-position bar at bottom of `.scroll-layout`:
- Dark background, same visual language as cards
- Shows: source icon, title (truncated), play/pause button, close button
- Tap anywhere (except buttons) reopens the detail view
- Does not scroll with content

### Single-Playback Enforcement

Only one thing plays at a time. Setting `activeMedia` to a new item automatically clears the previous one. The `Player` component's `clear` callback handles cleanup.

### Component Structure

```
FeedPlayer.jsx              — wraps Player, manages full/mini mode
FeedPlayerMiniBar.jsx       — the bottom bar UI
```

### Removed

The existing `ContentDrawer` (inline expand on double-tap) is superseded by the level 2 detail view.
