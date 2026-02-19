# YouTube Piped Proxy Integration

## Problem

YouTube videos in the feed use iframe embeds (`youtube.com/embed/{id}`). This means:
- No native player controls (volume, speed, shader)
- No integration with the persistent player / minibar
- No offline or proxy resilience
- Embeds blocked on some kiosk/TV setups

## Solution

Add a **YouTubeAdapter** content adapter backed by the self-hosted Piped API (`pipedapi.kckern.net`). This resolves YouTube video IDs to direct `.mp4` stream URLs playable by the native Player component. Falls back to YouTube embed on failure.

## Architecture

```
┌─────────────────────────┐     ┌──────────────────────────┐
│  YouTubeFeedAdapter     │     │  YouTubeAdapter          │
│  (feed/sources/)        │     │  (content/media/youtube/) │
│                         │     │                          │
│  fetchItems()           │     │  getStreamInfo(videoId,  │
│  #fetchChannelRSS()     │     │    { quality })          │
│  #searchKeywordCached() │     │  getDetail(videoId,      │
│  #getChannelIcon()      │     │    { quality })          │
│                         │     │                          │
│  getDetail() ───────────┼────>│  Piped API call          │
│    delegates to ────────┼────>│  Stream quality selection │
│                         │     │  Fallback to embed       │
└─────────────────────────┘     └──────────────────────────┘
```

### What stays in YouTubeFeedAdapter

Everything it does today — feed discovery is a feed concern:
- `fetchItems()` — channel RSS fetch, API search, keyword caching
- RSS parsing, entity decoding, thumbnail dimensions
- Channel icon resolution via Channels API
- In-memory TTL cache for feed results

Only change: `getDetail()` delegates to `YouTubeAdapter`.

### What goes in YouTubeAdapter

New content adapter at `backend/src/1_adapters/content/media/youtube/`:

```
youtube/
  YouTubeAdapter.mjs    — Stream resolution via Piped API
  manifest.mjs          — Adapter registry descriptor
```

**`YouTubeAdapter.getStreamInfo(videoId, { quality })`**

Calls `{pipedHost}/streams/{videoId}`, selects streams by quality tier:

| Quality | Stream Selection | Use Case |
|---------|-----------------|----------|
| `360p`  | First combined (videoOnly=false) mp4 stream | Scroll card preview |
| `480p`  | 480p video-only mp4 + best audio mp4 | Reader detail view |
| `720p`  | 720p video-only mp4 + best audio mp4 | Standalone player |

Returns:
```js
// Combined stream (360p)
{ url: 'https://...', mimeType: 'video/mp4', duration, title, uploader }

// Split streams (480p, 720p)
{ videoUrl: 'https://...', audioUrl: 'https://...', mimeType: 'video/mp4', duration, title, uploader }

// Failure
null
```

**`YouTubeAdapter.getDetail(videoId, { quality })`**

Wraps `getStreamInfo()` into the feed detail section format:

```js
// Success — native player
{
  sections: [{
    type: 'player',
    data: {
      provider: 'youtube',
      url: '...',          // combined stream
      // OR
      videoUrl: '...',     // video-only stream
      audioUrl: '...',     // audio stream
      mimeType: 'video/mp4',
      duration: 1298,
    }
  }]
}

// Failure — fallback to embed
{
  sections: [{
    type: 'embed',
    data: {
      provider: 'youtube',
      url: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
      aspectRatio: '16:9',
    }
  }]
}
```

**Caching**: In-memory Map with 30-min TTL (same pattern as YouTubeFeedAdapter).

### Wiring

**`services.yml`** — new entry:
```yaml
piped:
  docker: http://piped-api:8080
  kckern-server: https://pipedapi.kckern.net
  kckern-macbook: https://pipedapi.kckern.net
```

**`manifest.mjs`**:
```js
export default {
  capability: 'media',
  provider: 'youtube',
  configSchema: { host: { required: true } },
  adapter: () => import('./YouTubeAdapter.mjs'),
};
```

**YouTubeFeedAdapter** receives YouTubeAdapter instance via constructor injection (same pattern as other adapters receiving their deps).

## Frontend Changes

### Quality hint in getDetail API

The feed detail API call gains an optional `quality` query param:
```
GET /api/v1/feed/detail/youtube:abc123?quality=480p&meta={...}
```

The feed router passes this through to `getDetail()`.

### DetailView.jsx — YouTube playback

Currently (line 161-170): hardcoded YouTube embed iframe.

After: checks if detail sections contain a `player` type with provider `youtube`:
- **Has `url` (combined stream)**: Renders Player component inline with `play={{ url, mimeType: 'video/mp4' }}`
- **Has `videoUrl` + `audioUrl` (split streams)**: Renders Player with RemuxPlayer renderer
- **Has `embed` type (fallback)**: Existing iframe behavior, unchanged

### RemuxPlayer.jsx

New renderer at `frontend/src/modules/Player/renderers/RemuxPlayer.jsx`.

Syncs a visible `<video>` element (video-only stream) with a hidden `<audio>` element:
- Video element is the leader — audio follows
- Play/pause/seek events mirror between elements
- Exposes same interface as VideoPlayer (`onPlaybackMetrics`, `onRegisterMediaAccess`)
- SinglePlayer routes to RemuxPlayer when props contain both `videoUrl` and `audioUrl`

### Expand to persistent player

Inline player in detail view gets an expand button. On click:
- Calls `onPlay(item)` with the resolved stream URLs in meta
- PersistentPlayer / FeedPlayerMiniBar picks it up
- Detail view shows "Now playing" state instead of inline player

### youtube.jsx content plugin

`YouTubeScrollBody` stays as-is (title + body text for masonry cards). No changes needed — the card doesn't play video inline.

## Graceful Fallback (Critical)

**Piped is self-hosted and will have stability issues.** Every layer must degrade gracefully to the YouTube embed iframe. The user should never see a broken player — at worst they get the iframe experience.

### Backend fallback chain

```
Piped stream at requested quality
  → Piped stream at 360p (combined)
    → YouTube embed iframe
```

`YouTubeAdapter.getDetail()` always returns a valid response. It includes **both** the resolved stream (if available) and the embed fallback URL:

```js
{
  sections: [{
    type: 'player',
    data: {
      provider: 'youtube',
      url: 'https://pipedproxy.../videoplayback?...',
      mimeType: 'video/mp4',
      duration: 1298,
      // Always included — frontend uses this if stream fails
      embedFallback: 'https://www.youtube.com/embed/abc123?autoplay=1',
    }
  }]
}
```

Timeout: **5 seconds max** for Piped API calls. If exceeded, return embed-only response immediately.

### Frontend fallback — Player level

The Player/RemuxPlayer must handle stream failure at runtime:
- **`<video>` error event** (network error, 403 expired URL, decode failure) → automatically swap to iframe embed
- **Stall detection** (no progress for 10s) → offer "Switch to YouTube" button
- The `embedFallback` URL is always available in the player props

Pattern in DetailView / content plugin:
```jsx
const [useEmbed, setUseEmbed] = useState(false);

// If native player, render with onError fallback
if (data.url && !useEmbed) {
  return <Player play={{ url: data.url }} onError={() => setUseEmbed(true)} />;
}
// Fallback: iframe embed (always works)
return <iframe src={data.embedFallback} ... />;
```

### Frontend fallback — RemuxPlayer level

Split video+audio streams are more fragile (two network requests, sync issues):
- If either `<video>` or `<audio>` element errors → fall back to embed immediately
- If audio sync drifts >500ms → fall back to embed
- RemuxPlayer exposes `onError` callback that bubbles up to trigger embed swap

### Feed card level (youtube.jsx)

ScrollBody doesn't play video — no fallback needed there. But if we ever add inline card preview playback, same pattern: try native, catch to embed.

### Piped health tracking

`YouTubeAdapter` tracks consecutive failures. After **3 consecutive Piped failures**, skip Piped entirely for 5 minutes and return embed-only responses. This prevents slow timeouts from degrading the whole feed experience when Piped is down.

## Implementation Order

1. `services.yml` — add piped entry
2. `YouTubeAdapter` + `manifest.mjs` — content adapter with Piped API
3. `YouTubeFeedAdapter.getDetail()` — delegate to content adapter
4. Feed detail API — pass quality param through
5. `RemuxPlayer.jsx` — new Player renderer for split streams
6. `DetailView.jsx` — replace YouTube iframe with Player component
7. Expand button — wire to persistent player

## Not In Scope

- Piped API authentication (it's self-hosted, no auth needed)
- Playlist support via Piped
- Downloading/caching streams locally
- HLS/DASH adaptive streaming (using direct mp4 URLs)
