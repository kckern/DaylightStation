# Fitness Menu Background Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play ambient background music during fitness menu/show/home browsing, crossfading tracks on collection changes, stopping when video or a module opens.

**Architecture:** A `useMenuMusic` hook in FitnessApp manages two `Audio` element refs for A/B crossfading. FitnessApp derives `isActive` and `trackChangeKey` from its existing state. A new `GET /api/v1/fitness/menu-music` endpoint scans the media directory and returns track paths + configured volume. Audio files are already served by the existing `proxy.mjs` `/proxy/media/*` route.

**Tech Stack:** Vanilla `Audio` Web API, `requestAnimationFrame` for fade, Express `fs.readdirSync` for track listing.

---

## File Map

| Action | File |
|--------|------|
| Create | `frontend/src/modules/Fitness/nav/useMenuMusic.js` |
| Modify | `frontend/src/Apps/FitnessApp.jsx` |
| Modify | `backend/src/4_api/v1/routers/fitness.mjs` |

---

## Task 1: Backend — `GET /api/v1/fitness/menu-music`

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`

Adds a route that scans `{mediaDir}/apps/fitness/ux/menus/` for `.mp3` files and returns their media-relative paths plus the configured volume.

- [ ] **Step 1: Locate the insertion point**

Open `backend/src/4_api/v1/routers/fitness.mjs`. Find the existing imports at the top — `path` and `fs` are not yet imported. Add them directly after the existing `import path from 'path'` (line 33) — or if `fs` is absent, add both:

```javascript
import fs from 'fs';
```

(`path` is already imported on line 33.)

- [ ] **Step 2: Add the route**

Find the last `router.get` before `return router;` (around line 1103). Insert the new route just before `return router;`:

```javascript
  /**
   * GET /api/fitness/menu-music
   * Returns list of menu music track URLs + configured volume.
   */
  router.get('/menu-music', asyncHandler(async (req, res) => {
    const mediaDir = configService.getMediaDir();
    const musicDir = path.join(mediaDir, 'apps', 'fitness', 'ux', 'menus');

    let filenames = [];
    try {
      filenames = fs.readdirSync(musicDir)
        .filter(f => /\.(mp3|m4a|ogg|wav)$/i.test(f))
        .sort();
    } catch (_) {
      // Directory missing or unreadable — return empty list, not an error
    }

    const tracks = filenames.map(f => `media/apps/fitness/ux/menus/${f}`);

    const fitnessConfig = await configService.get('fitness') || {};
    const volume = fitnessConfig?.menu_music?.volume ?? 0.15;

    res.json({ tracks, volume });
  }));
```

- [ ] **Step 3: Smoke-test the endpoint**

```bash
curl -s http://localhost:3112/api/v1/fitness/menu-music | jq .
```

Expected output (abbreviated):
```json
{
  "tracks": [
    "media/apps/fitness/ux/menus/001.mp3",
    "media/apps/fitness/ux/menus/002.mp3",
    "..."
  ],
  "volume": 0.15
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness): add /api/v1/fitness/menu-music track list endpoint"
```

---

## Task 2: Frontend — `useMenuMusic` hook

**Files:**
- Create: `frontend/src/modules/Fitness/nav/useMenuMusic.js`

Manages two `Audio` element refs (A and B slots) for crossfading. Exposes no API — all behaviour is driven by props.

- [ ] **Step 1: Create the file**

```javascript
// frontend/src/modules/Fitness/nav/useMenuMusic.js
import { useEffect, useRef, useCallback } from 'react';
import getLogger from '@/lib/logging/Logger.js';

const FADE_MS = 500;

let _logger;
const logger = () => {
  if (!_logger) _logger = getLogger().child({ component: 'useMenuMusic' });
  return _logger;
};

/**
 * Cancel a running rAF fade, returning the audio element's current volume.
 */
const cancelFade = (handleRef) => {
  if (handleRef.current != null) {
    cancelAnimationFrame(handleRef.current);
    handleRef.current = null;
  }
};

/**
 * Linear rAF fade from `fromVol` to `toVol` over `durationMs`.
 * Writes directly to `audio.volume`. Calls `onDone` when finished.
 * Returns a cancel handle (rAF id stored by caller in a ref).
 */
const startFade = (audio, fromVol, toVol, durationMs, handleRef, onDone) => {
  cancelFade(handleRef);
  if (!audio) return;

  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / durationMs);
    audio.volume = Math.max(0, Math.min(1, fromVol + (toVol - fromVol) * t));
    if (t < 1) {
      handleRef.current = requestAnimationFrame(tick);
    } else {
      handleRef.current = null;
      onDone?.();
    }
  };
  handleRef.current = requestAnimationFrame(tick);
};

/**
 * useMenuMusic — ambient background music for the fitness menu/browse screens.
 *
 * @param {object} opts
 * @param {boolean}  opts.isActive       - True when menu music should play.
 * @param {*}        opts.trackChangeKey - Changing this triggers a crossfade to a new track.
 * @param {number}   opts.volume         - Target playback volume (0–1), default 0.15.
 * @param {string[]} opts.trackUrls      - Fully-qualified audio URLs to pick from.
 */
const useMenuMusic = ({ isActive, trackChangeKey, volume = 0.15, trackUrls = [] }) => {
  // A/B Audio elements
  const audioA = useRef(null);
  const audioB = useRef(null);
  // Which slot is the current "foreground" player
  const activeSlot = useRef('a');
  // Last-played URL, for repeat-avoidance
  const lastUrl = useRef(null);
  // rAF cancel handles per slot
  const fadeHandleA = useRef(null);
  const fadeHandleB = useRef(null);
  // Whether we have ever started playing (guards the trackChangeKey effect on mount)
  const hasStarted = useRef(false);

  // Stable refs so effects don't re-subscribe on every render
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const trackUrlsRef = useRef(trackUrls);
  useEffect(() => { trackUrlsRef.current = trackUrls; }, [trackUrls]);

  // Helpers
  const getSlot = (name) => name === 'a' ? audioA.current : audioB.current;
  const getFadeHandle = (name) => name === 'a' ? fadeHandleA : fadeHandleB;

  const pickTrack = useCallback(() => {
    const urls = trackUrlsRef.current;
    if (!urls.length) return null;
    if (urls.length === 1) return urls[0];
    let candidate;
    let attempts = 0;
    do {
      candidate = urls[Math.floor(Math.random() * urls.length)];
      attempts++;
    } while (candidate === lastUrl.current && attempts < 10);
    return candidate;
  }, []);

  // Create Audio elements once
  useEffect(() => {
    audioA.current = new Audio();
    audioA.current.volume = 0;
    audioB.current = new Audio();
    audioB.current.volume = 0;
    logger().info('menu-music.init');

    return () => {
      cancelFade(fadeHandleA);
      cancelFade(fadeHandleB);
      audioA.current?.pause();
      audioB.current?.pause();
      audioA.current = null;
      audioB.current = null;
      logger().info('menu-music.destroy');
    };
  }, []);

  // ── isActive changes ──────────────────────────────────────────────────────
  useEffect(() => {
    const slot = activeSlot.current;
    const audio = getSlot(slot);
    const handle = getFadeHandle(slot);
    if (!audio) return;

    if (isActive) {
      // If nothing loaded yet, pick and load a track
      if (!audio.src || audio.ended) {
        const url = pickTrack();
        if (!url) return;
        lastUrl.current = url;
        audio.src = url;
        audio.load();
        logger().info('menu-music.track-loaded', { url, slot });
      }
      audio.play().catch(err => logger().warn('menu-music.play-failed', { message: err?.message }));
      startFade(audio, audio.volume, volumeRef.current, FADE_MS, handle, null);
      hasStarted.current = true;
      logger().info('menu-music.started', { slot });
    } else {
      if (!hasStarted.current) return;
      startFade(audio, audio.volume, 0, FADE_MS, handle, () => {
        audio.pause();
        logger().info('menu-music.paused', { slot });
      });
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── trackChangeKey changes → crossfade ───────────────────────────────────
  // Skip on initial mount (hasStarted guard) and when no tracks available.
  useEffect(() => {
    if (!hasStarted.current || !isActive || !trackUrlsRef.current.length) return;

    const outSlot = activeSlot.current;
    const inSlot = outSlot === 'a' ? 'b' : 'a';
    const outAudio = getSlot(outSlot);
    const inAudio = getSlot(inSlot);
    const outHandle = getFadeHandle(outSlot);
    const inHandle = getFadeHandle(inSlot);
    if (!outAudio || !inAudio) return;

    const url = pickTrack();
    if (!url) return;
    lastUrl.current = url;

    inAudio.src = url;
    inAudio.volume = 0;
    inAudio.load();
    inAudio.play().catch(err => logger().warn('menu-music.crossfade-play-failed', { message: err?.message }));

    startFade(inAudio, 0, volumeRef.current, FADE_MS, inHandle, null);
    startFade(outAudio, outAudio.volume, 0, FADE_MS, outHandle, () => {
      outAudio.pause();
      outAudio.src = '';
    });

    activeSlot.current = inSlot;
    logger().info('menu-music.crossfade', { url, from: outSlot, to: inSlot });
  }, [trackChangeKey]); // eslint-disable-line react-hooks/exhaustive-deps
};

export default useMenuMusic;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/nav/useMenuMusic.js
git commit -m "feat(fitness): useMenuMusic hook — A/B crossfade ambient menu music"
```

---

## Task 3: FitnessApp — wire up the hook

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

Fetch track list after config loads, derive `isActive` and `trackChangeKey`, call `useMenuMusic`.

- [ ] **Step 1: Add import**

At the top of `FitnessApp.jsx`, after the existing fitness imports (around line 22), add:

```javascript
import useMenuMusic from '../modules/Fitness/nav/useMenuMusic.js';
import { DaylightMediaPath } from '../lib/api.mjs';
```

(`DaylightMediaPath` is already imported from `'../lib/api.mjs'` on line 5 — skip this import if it's already there. Check line 5.)

Actually line 5 already has: `import { DaylightAPI, DaylightMediaPath } from '../lib/api.mjs';` — so only add the `useMenuMusic` import.

Add after line 31 (`import { saveActiveSession, loadActiveSession, clearActiveSession } from './fitnessSessionPersistence.js';`):

```javascript
import useMenuMusic from '../modules/Fitness/nav/useMenuMusic.js';
```

- [ ] **Step 2: Add state for track list + volume**

Inside `FitnessApp` component, after the existing `useState` declarations (around line 55), add:

```javascript
const [menuMusicTracks, setMenuMusicTracks] = useState([]);
const [menuMusicVolume, setMenuMusicVolume] = useState(0.15);
```

- [ ] **Step 3: Fetch track list after config loads**

Find the `useEffect` that calls `fetchFitnessData` (around line 968). After `setFitnessConfiguration(response)` succeeds (inside the try block, after line 1025), add a secondary fetch for the music track list:

```javascript
        // Fetch menu music track list (non-blocking — failure is silent)
        DaylightAPI('/api/v1/fitness/menu-music').then(music => {
          if (!music || !Array.isArray(music.tracks)) return;
          setMenuMusicTracks(music.tracks.map(t => DaylightMediaPath(t)));
          if (typeof music.volume === 'number') setMenuMusicVolume(music.volume);
        }).catch(() => {});
```

Place this immediately after `setFitnessConfiguration(response);` (line 1025).

- [ ] **Step 4: Derive isActive and trackChangeKey**

After the `queueSize` declaration (around line 1233), add:

```javascript
  // Menu music: active when browsing (not playing video, not in a module)
  const menuMusicActive = (
    (currentView === 'menu' || currentView === 'show' || currentView === 'screen') &&
    fitnessPlayQueue.length === 0 &&
    activeModule == null &&
    !loading &&
    menuMusicTracks.length > 0
  );

  // Track changes on collection nav; stays stable when entering FitnessShow
  const menuMusicTrackKey = activeCollection;
```

- [ ] **Step 5: Call the hook**

Immediately after the two lines added in Step 4, add:

```javascript
  useMenuMusic({
    isActive: menuMusicActive,
    trackChangeKey: menuMusicTrackKey,
    volume: menuMusicVolume,
    trackUrls: menuMusicTracks,
  });
```

- [ ] **Step 6: Manual browser test**

Start the dev server and navigate to `/fitness`:
1. Music should start playing at ~15% volume when the menu loads
2. Clicking a different collection tab should crossfade (500ms) to a different track
3. Clicking a show should NOT change the track — music plays through
4. Playing a video should fade music out
5. Closing the video should fade music back in

- [ ] **Step 7: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "feat(fitness): ambient menu music — plays through show, stops on video/module"
```

---

## Self-Review Notes

- **Spec coverage:** ✓ Track change on collection nav | ✓ Play-through on FitnessShow | ✓ Stop on player/module | ✓ 500ms crossfade | ✓ Volume from config | ✓ Repeat avoidance
- **No placeholders:** All steps have complete code.
- **Type consistency:** `menuMusicTracks: string[]`, `menuMusicVolume: number`, `menuMusicActive: boolean`, `menuMusicTrackKey: any` — used consistently across Tasks 2 and 3.
- **Edge cases covered:** Empty track list (skip), Audio element not yet initialized (null guards), initial mount (hasStarted guard prevents spurious trackChangeKey crossfade).
