# YouTube Piped Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace YouTube iframe embeds with native Player playback via self-hosted Piped API proxy, with graceful fallback to embed on any failure.

**Architecture:** New `YouTubeAdapter` content adapter calls Piped API to resolve video IDs into direct mp4 stream URLs. `YouTubeFeedAdapter.getDetail()` delegates to it. Frontend DetailView renders via Player component instead of iframe. Every layer falls back to YouTube embed on error.

**Tech Stack:** Node.js backend (ESM), React frontend, Piped API (self-hosted), existing Player/SinglePlayer/VideoPlayer infrastructure.

**Design doc:** `docs/_wip/plans/2026-02-19-youtube-piped-proxy-design.md`

---

### Task 1: Add Piped service to services.yml

**Files:**
- Modify: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/config/services.yml`

**Step 1: Add piped entry**

Add after the `komga` block at the end of the file:

```yaml
piped:
  docker: https://pipedapi.kckern.net
  kckern-server: https://pipedapi.kckern.net
  kckern-macbook: https://pipedapi.kckern.net
```

**Step 2: Verify config resolves**

Run:
```bash
node -e "
  import('./backend/src/0_system/config/configLoader.mjs')
    .then(m => m.default ? m.default() : m.loadConfig?.())
    .then(c => console.log('piped:', c?.services?.piped || 'NOT FOUND'))
    .catch(e => console.error(e.message))
"
```

Expected: Shows piped URLs.

**Step 3: Commit**

```bash
git add data/system/config/services.yml
git commit -m "config: add piped service entry for YouTube proxy"
```

---

### Task 2: Create YouTubeAdapter content adapter

**Files:**
- Create: `backend/src/1_adapters/content/media/youtube/YouTubeAdapter.mjs`
- Create: `backend/src/1_adapters/content/media/youtube/manifest.mjs`

**Step 1: Create manifest.mjs**

```js
// backend/src/1_adapters/content/media/youtube/manifest.mjs
export default {
  provider: 'youtube',
  capability: 'media',
  displayName: 'YouTube (Piped Proxy)',
  mediaTypes: ['video'],
  adapter: () => import('./YouTubeAdapter.mjs'),
  configSchema: {
    host: { type: 'string', required: true, description: 'Piped API base URL (e.g., https://pipedapi.kckern.net)' },
  },
};
```

**Step 2: Create YouTubeAdapter.mjs**

```js
// backend/src/1_adapters/content/media/youtube/YouTubeAdapter.mjs

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PIPED_TIMEOUT_MS = 5000;
const CIRCUIT_BREAK_THRESHOLD = 3;
const CIRCUIT_BREAK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * YouTubeAdapter — resolves YouTube video IDs to direct stream URLs
 * via self-hosted Piped API. Falls back to YouTube embed on any failure.
 */
export class YouTubeAdapter {
  #host;
  #logger;
  #cache = new Map();
  #consecutiveFailures = 0;
  #circuitBrokenUntil = 0;

  constructor({ host, logger = console }) {
    if (!host) throw new Error('YouTubeAdapter requires host (Piped API URL)');
    this.#host = host.replace(/\/$/, '');
    this.#logger = logger;
  }

  /**
   * Get stream info for a YouTube video.
   * @param {string} videoId
   * @param {Object} [opts]
   * @param {string} [opts.quality='360p'] - '360p', '480p', or '720p'
   * @returns {Promise<Object|null>} Stream info or null on failure
   */
  async getStreamInfo(videoId, { quality = '360p' } = {}) {
    if (!videoId) return null;

    // Circuit breaker: skip Piped if it's been failing
    if (Date.now() < this.#circuitBrokenUntil) {
      this.#logger.debug?.('youtube.adapter.circuit-open', { videoId });
      return null;
    }

    // Check cache
    const cacheKey = `stream:${videoId}`;
    const cached = this.#getFromCache(cacheKey);
    if (cached) return this.#selectStreams(cached, quality);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PIPED_TIMEOUT_MS);

      const res = await fetch(`${this.#host}/streams/${encodeURIComponent(videoId)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`Piped API ${res.status}`);

      const data = await res.json();
      this.#consecutiveFailures = 0;
      this.#putInCache(cacheKey, data);
      return this.#selectStreams(data, quality);
    } catch (err) {
      this.#consecutiveFailures++;
      this.#logger.warn?.('youtube.adapter.piped.failed', {
        videoId,
        error: err.message,
        consecutiveFailures: this.#consecutiveFailures,
      });

      if (this.#consecutiveFailures >= CIRCUIT_BREAK_THRESHOLD) {
        this.#circuitBrokenUntil = Date.now() + CIRCUIT_BREAK_DURATION_MS;
        this.#logger.warn?.('youtube.adapter.circuit-break', {
          until: new Date(this.#circuitBrokenUntil).toISOString(),
        });
      }

      return null;
    }
  }

  /**
   * Get detail sections for a YouTube video (feed detail format).
   * Always returns a valid response — embed fallback on Piped failure.
   * @param {string} videoId
   * @param {Object} [opts]
   * @param {string} [opts.quality='360p']
   * @returns {Promise<Object>} { sections: [...] }
   */
  async getDetail(videoId, { quality = '360p' } = {}) {
    const embedFallback = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;

    const streamInfo = await this.getStreamInfo(videoId, { quality });

    if (!streamInfo) {
      // Piped failed — return embed-only
      return {
        sections: [{
          type: 'embed',
          data: { provider: 'youtube', url: embedFallback, aspectRatio: '16:9' },
        }],
      };
    }

    // Native player with embed fallback baked in
    return {
      sections: [{
        type: 'player',
        data: {
          provider: 'youtube',
          ...streamInfo,
          embedFallback,
        },
      }],
    };
  }

  // ======================================================================
  // Stream selection
  // ======================================================================

  #selectStreams(data, quality) {
    const videoStreams = data.videoStreams || [];
    const audioStreams = data.audioStreams || [];
    const duration = data.duration || null;
    const meta = {
      duration,
      title: data.title || null,
      uploader: data.uploader || null,
      thumbnailUrl: data.thumbnailUrl || null,
    };

    // For 360p: use combined stream (videoOnly=false)
    if (quality === '360p') {
      const combined = videoStreams.find(
        s => !s.videoOnly && s.mimeType?.startsWith('video/mp4')
      );
      if (combined) {
        return { url: combined.url, mimeType: combined.mimeType || 'video/mp4', ...meta };
      }
      // No combined stream — try any combined stream
      const anyCombined = videoStreams.find(s => !s.videoOnly);
      if (anyCombined) {
        return { url: anyCombined.url, mimeType: anyCombined.mimeType || 'video/mp4', ...meta };
      }
      return null;
    }

    // For 480p/720p: video-only + audio
    const targetQuality = quality === '720p' ? '720p' : '480p';
    const videoOnly = this.#findBestVideoStream(videoStreams, targetQuality);
    const audio = this.#findBestAudioStream(audioStreams);

    if (videoOnly && audio) {
      return {
        videoUrl: videoOnly.url,
        audioUrl: audio.url,
        mimeType: videoOnly.mimeType || 'video/mp4',
        ...meta,
      };
    }

    // Fallback: try combined 360p
    return this.#selectStreams(data, '360p');
  }

  #findBestVideoStream(streams, targetQuality) {
    // Prefer mp4, match target quality, fall back to nearest lower
    const mp4Only = streams.filter(s => s.videoOnly && s.mimeType?.startsWith('video/mp4'));
    const exact = mp4Only.find(s => s.quality === targetQuality);
    if (exact) return exact;

    // Fall back to nearest quality
    const qualityOrder = ['720p', '480p', '360p', '240p', '144p'];
    const targetIdx = qualityOrder.indexOf(targetQuality);
    for (let i = targetIdx + 1; i < qualityOrder.length; i++) {
      const fallback = mp4Only.find(s => s.quality === qualityOrder[i]);
      if (fallback) return fallback;
    }
    return mp4Only[0] || null;
  }

  #findBestAudioStream(streams) {
    // Prefer mp4 audio, highest bitrate
    const mp4Audio = streams
      .filter(s => s.mimeType?.startsWith('audio/mp4'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    return mp4Audio[0] || streams[0] || null;
  }

  // ======================================================================
  // Cache helpers (same pattern as YouTubeFeedAdapter)
  // ======================================================================

  #getFromCache(key) {
    const entry = this.#cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      this.#cache.delete(key);
      return null;
    }
    return entry.data;
  }

  #putInCache(key, data) {
    this.#cache.set(key, { data, ts: Date.now() });
    if (this.#cache.size > 100) {
      const oldest = this.#cache.keys().next().value;
      this.#cache.delete(oldest);
    }
  }
}
```

**Step 3: Commit**

```bash
git add backend/src/1_adapters/content/media/youtube/
git commit -m "feat: add YouTubeAdapter content adapter with Piped API proxy"
```

---

### Task 3: Wire YouTubeAdapter into app bootstrap

**Files:**
- Modify: `backend/src/app.mjs` (near line 662 and 748-752)

**Step 1: Import and instantiate YouTubeAdapter**

Find the YouTubeFeedAdapter import block (around line 662):
```js
const { YouTubeFeedAdapter } = await import('./1_adapters/feed/sources/YouTubeFeedAdapter.mjs');
```

Add after it:
```js
const { YouTubeAdapter } = await import('./1_adapters/content/media/youtube/YouTubeAdapter.mjs');
```

Find the YouTubeFeedAdapter instantiation block (around line 748-752):
```js
const googleAuth = dataService.system.read('auth/google');
const youtubeAdapter = googleAuth?.api_key ? new YouTubeFeedAdapter({
  apiKey: googleAuth.api_key,
  logger: rootLogger.child({ module: 'youtube-feed' }),
}) : null;
```

Replace with:
```js
const googleAuth = dataService.system.read('auth/google');
const pipedHost = configService.resolveServiceUrl('piped');
const youtubeContentAdapter = pipedHost ? new YouTubeAdapter({
  host: pipedHost,
  logger: rootLogger.child({ module: 'youtube-adapter' }),
}) : null;
const youtubeAdapter = googleAuth?.api_key ? new YouTubeFeedAdapter({
  apiKey: googleAuth.api_key,
  youtubeAdapter: youtubeContentAdapter,
  logger: rootLogger.child({ module: 'youtube-feed' }),
}) : null;
```

**Step 2: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat: wire YouTubeAdapter into app bootstrap with Piped service URL"
```

---

### Task 4: Delegate YouTubeFeedAdapter.getDetail() to content adapter

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs`

**Step 1: Accept youtubeAdapter in constructor**

Find the constructor (line 39-44):
```js
  constructor({ apiKey, logger = console }) {
    super();
    if (!apiKey) throw new Error('YouTubeFeedAdapter requires apiKey');
    this.#apiKey = apiKey;
    this.#logger = logger;
  }
```

Replace with:
```js
  #youtubeAdapter;

  constructor({ apiKey, youtubeAdapter = null, logger = console }) {
    super();
    if (!apiKey) throw new Error('YouTubeFeedAdapter requires apiKey');
    this.#apiKey = apiKey;
    this.#youtubeAdapter = youtubeAdapter;
    this.#logger = logger;
  }
```

Note: Add `#youtubeAdapter;` as a new private field declaration alongside the existing `#apiKey` / `#logger` / `#cache` declarations near line 29.

**Step 2: Update getDetail to delegate**

Find the existing getDetail (line 85-97):
```js
  async getDetail(localId, meta, _username) {
    const videoId = meta.videoId || localId;
    return {
      sections: [{
        type: 'embed',
        data: {
          provider: 'youtube',
          url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`,
          aspectRatio: '16:9',
        },
      }],
    };
  }
```

Replace with:
```js
  async getDetail(localId, meta, _username, { quality } = {}) {
    const videoId = meta.videoId || localId;

    // Delegate to content adapter if available
    if (this.#youtubeAdapter) {
      return this.#youtubeAdapter.getDetail(videoId, { quality });
    }

    // No content adapter — embed-only fallback
    return {
      sections: [{
        type: 'embed',
        data: {
          provider: 'youtube',
          url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`,
          aspectRatio: '16:9',
        },
      }],
    };
  }
```

**Step 3: Commit**

```bash
git add backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs
git commit -m "feat: delegate YouTubeFeedAdapter.getDetail() to YouTubeAdapter"
```

---

### Task 5: Pass quality param through feed detail API

**Files:**
- Modify: `backend/src/4_api/v1/routers/feed.mjs` (around line 335-350)
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` (around line 223-243)

**Step 1: Update feed router to pass quality**

Find the detail route handler in `feed.mjs`:
```js
  const result = await feedAssemblyService.getDetail(itemId, meta, username);
```

Replace with:
```js
  const quality = req.query.quality || undefined;
  const result = await feedAssemblyService.getDetail(itemId, meta, username, { quality });
```

**Step 2: Update FeedAssemblyService.getDetail to forward options**

Find in `FeedAssemblyService.mjs` the getDetail method signature:
```js
  async getDetail(itemId, itemMeta, username) {
```

Replace with:
```js
  async getDetail(itemId, itemMeta, username, opts = {}) {
```

Find the adapter call within that method:
```js
    const result = await adapter.getDetail(localId, itemMeta || {}, username);
```

Replace with:
```js
    const result = await adapter.getDetail(localId, itemMeta || {}, username, opts);
```

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/feed.mjs backend/src/3_applications/feed/services/FeedAssemblyService.mjs
git commit -m "feat: pass quality param through feed detail API to adapters"
```

---

### Task 6: Test backend end-to-end with curl

**Step 1: Restart dev server if running**

```bash
lsof -i :3112  # check if running
# If running, restart it to pick up changes
```

**Step 2: Test Piped proxy path**

```bash
curl -s 'http://localhost:3112/api/v1/feed/detail/youtube:_rtmobO-VHA?quality=360p&meta=%7B%22videoId%22%3A%22_rtmobO-VHA%22%7D' | jq .
```

Expected: Response with `sections[0].type === 'player'` and `data.url` containing a pipedproxy URL, plus `data.embedFallback` containing a YouTube embed URL.

**Step 3: Test fallback with bogus video ID**

```bash
curl -s 'http://localhost:3112/api/v1/feed/detail/youtube:NONEXISTENT?meta=%7B%22videoId%22%3A%22NONEXISTENT%22%7D' | jq .
```

Expected: Response with `sections[0].type === 'embed'` — graceful fallback.

---

### Task 7: Create RemuxPlayer renderer

**Files:**
- Create: `frontend/src/modules/Player/renderers/RemuxPlayer.jsx`

**Step 1: Create RemuxPlayer.jsx**

```jsx
// frontend/src/modules/Player/renderers/RemuxPlayer.jsx
import React, { useRef, useEffect, useCallback, useState } from 'react';

/**
 * RemuxPlayer — syncs a visible <video> (video-only stream) with a hidden
 * <audio> element. Video is the leader, audio follows.
 *
 * Falls back via onError if either element fails or sync drifts too far.
 */
const SYNC_DRIFT_THRESHOLD = 0.5; // seconds
const SYNC_CHECK_INTERVAL_MS = 1000;

export function RemuxPlayer({
  videoUrl,
  audioUrl,
  onError,
  onMediaRef,
  onPlaybackMetrics,
  onRegisterMediaAccess,
  volume = 1,
  playbackRate = 1,
  style,
}) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const syncIntervalRef = useRef(null);
  const [ready, setReady] = useState(false);

  // Register media access for Player ecosystem
  useEffect(() => {
    if (!videoRef.current) return;
    onRegisterMediaAccess?.({
      getMediaEl: () => videoRef.current,
    });
  }, [ready, onRegisterMediaAccess]);

  // Sync audio to video on play/pause/seek
  const syncAudio = useCallback(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    // Match play state
    if (video.paused && !audio.paused) audio.pause();
    if (!video.paused && audio.paused) audio.play().catch(() => {});

    // Match seek — correct drift
    const drift = Math.abs(video.currentTime - audio.currentTime);
    if (drift > SYNC_DRIFT_THRESHOLD) {
      // If drift is extreme, it may indicate a broken stream
      if (drift > 3) {
        onError?.('sync-drift-extreme');
        return;
      }
      audio.currentTime = video.currentTime;
    }
  }, [onError]);

  // Video event handlers
  const handlePlay = useCallback(() => {
    audioRef.current?.play().catch(() => {});
    onPlaybackMetrics?.({ isPaused: false });
  }, [onPlaybackMetrics]);

  const handlePause = useCallback(() => {
    audioRef.current?.pause();
    onPlaybackMetrics?.({ isPaused: true });
  }, [onPlaybackMetrics]);

  const handleSeeked = useCallback(() => {
    if (audioRef.current && videoRef.current) {
      audioRef.current.currentTime = videoRef.current.currentTime;
    }
    onPlaybackMetrics?.({ isSeeking: false });
  }, [onPlaybackMetrics]);

  const handleSeeking = useCallback(() => {
    onPlaybackMetrics?.({ isSeeking: true });
  }, [onPlaybackMetrics]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    onPlaybackMetrics?.({
      seconds: video.currentTime,
      isPaused: video.paused,
    });
  }, [onPlaybackMetrics]);

  const handleError = useCallback((e) => {
    onError?.('video-error');
  }, [onError]);

  const handleAudioError = useCallback(() => {
    onError?.('audio-error');
  }, [onError]);

  // Volume and playback rate sync
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) video.playbackRate = playbackRate;
    if (audio) audio.playbackRate = playbackRate;
  }, [playbackRate]);

  // Periodic sync check
  useEffect(() => {
    syncIntervalRef.current = setInterval(syncAudio, SYNC_CHECK_INTERVAL_MS);
    return () => clearInterval(syncIntervalRef.current);
  }, [syncAudio]);

  // Report media ref
  useEffect(() => {
    if (videoRef.current) {
      onMediaRef?.(videoRef.current);
      setReady(true);
    }
  }, [onMediaRef]);

  return (
    <>
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        autoPlay
        playsInline
        onPlay={handlePlay}
        onPause={handlePause}
        onSeeked={handleSeeked}
        onSeeking={handleSeeking}
        onTimeUpdate={handleTimeUpdate}
        onError={handleError}
        style={{ width: '100%', height: '100%', objectFit: 'contain', ...style }}
      />
      <audio
        ref={audioRef}
        src={audioUrl}
        autoPlay
        onError={handleAudioError}
      />
    </>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/renderers/RemuxPlayer.jsx
git commit -m "feat: add RemuxPlayer renderer for synced video+audio streams"
```

---

### Task 8: Update DetailView.jsx for native YouTube playback with fallback

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/detail/DetailView.jsx`

**Step 1: Add imports**

Find the existing imports at the top of DetailView.jsx. Add:
```js
import { useState as useStateFallback } from 'react';
import Player from '../../../Player/Player.jsx';
import { RemuxPlayer } from '../../../Player/renderers/RemuxPlayer.jsx';
```

Note: `useState` is likely already imported. If so, skip the alias — just use the existing `useState`.

**Step 2: Replace the YouTube hero block**

Find the current YouTube block (around line 161-189):
```jsx
{isYouTube ? (
  <div className="detail-hero" style={{ aspectRatio: ... }}>
    {ytPlaying ? (
      <iframe
        src={`https://www.youtube.com/embed/${item.meta.videoId}?autoplay=1&rel=0`}
        ...
      />
    ) : (
      <>
        ...play button...
      </>
    )}
  </div>
```

Replace with:
```jsx
{isYouTube ? (
  <YouTubeHero
    item={item}
    heroImage={heroImage}
    sections={sections}
    onPlay={onPlay}
  />
```

**Step 3: Add YouTubeHero component at bottom of file (before export)**

Add before the `export default`:
```jsx
function YouTubeHero({ item, heroImage, sections, onPlay }) {
  const [ytPlaying, setYtPlaying] = useState(false);
  const [useEmbed, setUseEmbed] = useState(false);

  // Check if backend provided a native player section
  const playerSection = sections.find(
    s => s.type === 'player' && s.data?.provider === 'youtube'
  );
  const embedFallback = playerSection?.data?.embedFallback
    || `https://www.youtube.com/embed/${item.meta.videoId}?autoplay=1&rel=0`;

  const handleStreamError = useCallback(() => {
    setUseEmbed(true);
  }, []);

  const aspectRatio = (item.meta?.imageWidth && item.meta?.imageHeight)
    ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
    : '16 / 9';

  // Not playing yet — show thumbnail + play button
  if (!ytPlaying) {
    return (
      <div className="detail-hero" style={{ aspectRatio }}>
        {heroImage && <img src={heroImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        <button
          onClick={() => setYtPlaying(true)}
          style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
          }}
          aria-label="Play video"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
        </button>
      </div>
    );
  }

  // Playing: try native player, fall back to embed
  if (playerSection && !useEmbed) {
    const data = playerSection.data;

    // Split streams (video-only + audio) → RemuxPlayer
    if (data.videoUrl && data.audioUrl) {
      return (
        <div className="detail-hero" style={{ aspectRatio }}>
          <RemuxPlayer
            videoUrl={data.videoUrl}
            audioUrl={data.audioUrl}
            onError={handleStreamError}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          />
        </div>
      );
    }

    // Combined stream → Player component
    if (data.url) {
      return (
        <div className="detail-hero" style={{ aspectRatio }}>
          <video
            src={data.url}
            autoPlay
            playsInline
            controls
            onError={handleStreamError}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
      );
    }
  }

  // Embed fallback (always works)
  return (
    <div className="detail-hero" style={{ aspectRatio }}>
      <iframe
        src={embedFallback}
        title={item.title}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
}
```

**Step 4: Add missing useCallback import if needed**

Check the existing imports. If `useCallback` is not already imported from React, add it.

**Step 5: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/detail/DetailView.jsx
git commit -m "feat: replace YouTube iframe with native player + embed fallback"
```

---

### Task 9: Pass quality param from frontend detail fetch

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx` (the detail-fetching logic)

**Step 1: Find the detail fetch call**

Search for the `getDetail` or `/api/v1/feed/detail/` call in `Scroll.jsx`. It should be in a function like `handleItemSelect` or `fetchDetail`.

Add `quality=480p` to the query string (reader/detail context):

Find the fetch URL pattern like:
```js
`/api/v1/feed/detail/${encodeURIComponent(item.id)}?meta=${encodeURIComponent(JSON.stringify(item.meta))}`
```

Append `&quality=480p` to the URL:
```js
`/api/v1/feed/detail/${encodeURIComponent(item.id)}?quality=480p&meta=${encodeURIComponent(JSON.stringify(item.meta))}`
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx
git commit -m "feat: pass quality=480p hint to feed detail API for YouTube"
```

---

### Task 10: Manual integration test

**Step 1: Start dev server**

```bash
lsof -i :3111 || npm run dev &
```

**Step 2: Open feed in browser**

Navigate to the app. Find a YouTube video in the feed scroll. Click it to open the detail view.

**Verify:**
- [ ] Detail view shows video thumbnail with play button
- [ ] Clicking play: attempts native `<video>` playback (check network tab for pipedproxy URL)
- [ ] If Piped works: video plays natively with browser controls
- [ ] If Piped fails: falls back to YouTube embed iframe seamlessly
- [ ] No broken player states — always playable

**Step 3: Test Piped failure scenario**

Temporarily change `services.yml` piped URL to `https://bogus.invalid` and restart. Verify YouTube videos still work via embed fallback.

Restore the correct URL after testing.

---

### Task 11: Final commit and cleanup

**Step 1: Verify no lint errors**

```bash
cd frontend && npx eslint src/modules/Feed/Scroll/detail/DetailView.jsx src/modules/Player/renderers/RemuxPlayer.jsx --no-error-on-unmatched-pattern 2>/dev/null; cd ..
```

**Step 2: Commit any remaining changes**

```bash
git status
# Stage and commit any remaining changes
git commit -m "feat: YouTube Piped proxy integration complete"
```
