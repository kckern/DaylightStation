# Arcade Thumbnail Caching — Design

**Date:** 2026-04-25
**Status:** Validated, ready for implementation
**Touches:** `backend/src/4_api/v1/routers/proxy.mjs`, `frontend/src/modules/Menu/ArcadeSelector.jsx`, new `frontend/src/modules/Menu/RetryImg.jsx`

## Problem

ArcadeSelector navmap tiles intermittently fail to render thumbnails. Refreshing the page sometimes fixes it; some tiles paint while others don't ("partial loading"). No thumbnail is permanently broken.

## Root cause

`/api/v1/proxy/retroarch/thumbnail/*` (`proxy.mjs:325-362`) does a live `fetch()` to X-plore (Shield TV's WiFi file manager) on **every** request. Loading the navmap fires ~20 simultaneous requests, swamping X-plore. Some time out at the 10s deadline; others fail mid-stream.

Two compounding issues:

1. **No server-side cache.** Every render re-asks X-plore for the same static files.
2. **Failures return HTTP 200 + placeholder SVG** (`sendPlaceholderSvg` line 360). The browser sees a successful response and never fires `onError`, so client-side retry is impossible.

## Solution: two-layer cache + retry

### Layer 1 — Backend disk cache (proxy.mjs)

Mirror the existing Komga composite pattern (lines 199-276). RetroArch thumbnails are static, slug-based, and total only a few MB → no eviction logic needed.

**Cache location:** `{mediaBasePath}/img/retroarch/thumbs/{thumbPath}` — preserves directory structure for trivial inspection.

**Flow:**

1. **Disk hit** → stream with `Cache-Control: public, max-age=31536000, immutable` + `X-Cache: HIT`.
2. **Disk miss** → fetch X-plore with current 10s timeout. On failure, **one retry** after 1500ms.
3. **Fetch success** → `mkdir -p` cache dir, write buffer to disk, send response with `immutable` header + `X-Cache: MISS`.
4. **All fetches fail** → respond `503` with `Cache-Control: no-store`. **Do not** return placeholder SVG (was masking failures from the client).

**Excluded (YAGNI):**
- Concurrency cap on X-plore fetch — disk cache makes cold-fill the only window of concurrent X-plore traffic; one retry handles those.
- ETag / 304 — `immutable` makes it pointless.
- Cache eviction — a few MB total.
- Negative cache for X-plore 404 — no permanently missing thumbs reported. Add later if it surfaces.

### Layer 2 — Frontend `<RetryImg>` component

New file: `frontend/src/modules/Menu/RetryImg.jsx`

```jsx
import { useState } from 'react';

export function RetryImg({ src, alt, className, maxRetries = 2, fallback = null, onLoad, onError }) {
  const [attempt, setAttempt] = useState(0);
  const [givenUp, setGivenUp] = useState(false);

  if (givenUp || !src) return fallback;

  const url = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_r=${attempt}`;
  return (
    <img
      key={attempt}
      src={url}
      alt={alt}
      className={className}
      onLoad={onLoad}
      onError={() => {
        if (attempt >= maxRetries) { setGivenUp(true); onError?.(); return; }
        const delay = 600 * Math.pow(2, attempt);  // 600, 1200, 2400ms
        setTimeout(() => setAttempt(a => a + 1), delay);
      }}
    />
  );
}
```

Notes:
- `key={attempt}` forces React to remount the `<img>` so a same-prefix URL still triggers a fresh request.
- Cache-bust query (`_r=N`) is defense-in-depth against any intermediary caching a 503.
- 600/1200/2400ms backoff covers ~4s of cold-fill window without tight-looping.

### Integration in `ArcadeSelector.jsx`

**Hero block (lines 330-335):** replace both `<img>` tags with `<RetryImg>`. No fallback needed — the hero's colored backplate is acceptable if all retries miss.

**Navmap tile (lines 378-385):** replace the conditional `<img>` block with:

```jsx
<RetryImg
  src={resolveImage(items[tile.idx])}
  alt={items[tile.idx].label}
  fallback={<span className="arcade-selector__navmap-placeholder" />}
/>
```

## Why both layers help

| Layer | What it fixes |
|-------|---------------|
| Backend disk cache | Eliminates ongoing X-plore load entirely after first warm-up. One fetch per thumbnail, ever. |
| Frontend retry | Catches the cold-fill window when first-load tiles get 503s while their neighbors succeed. |
| Strong cache headers | Browser holds thumbnails forever (vs. daily revalidation today). |

## Rollout

1. Backend changes — non-breaking; existing `Cache-Control: public, max-age=86400` still works for any consumer outside ArcadeSelector during the change window. The 503 response replaces the placeholder for retroarch only; other proxy routes keep their placeholder behavior.
2. Frontend changes — additive. `<RetryImg>` is opt-in.
3. No migration needed; cache fills naturally on first use.

## Verification

- Cold-start dev server, open arcade menu, observe `X-Cache: MISS` then `X-Cache: HIT` on subsequent loads (network panel).
- `ls {mediaBasePath}/img/retroarch/thumbs/` should populate after first menu open.
- Force a failure: temporarily break X-plore baseUrl in config; client should fire 2 retries (~4s window) per tile, then render placeholder. Restore config; next render fills cache from network.
- Sanity-check the navmap renders fully even when X-plore is throttled (cap can be simulated with `tc` or just a wrong port for a few seconds).
