# ArtMode Background Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play config-driven ambient background music in ArtMode and show a static brass nameplate on the top frame rail with the current track + artist.

**Architecture:** A pure `playlist.js` maps a resolved queue into a track list; a `useBackgroundMusic` hook in `lib/Player/` drives a hidden `<audio>` element (autoplay → advance on `ended` → loop, skip on `error`) and exposes the current track; ArtMode renders the audio element and a top-rail music plaque. No backend changes — the existing `/api/v1/queue/:source` endpoint resolves the playlist with audio metadata.

**Tech Stack:** React (`.jsx`/`.js`), Vitest + Testing Library (`renderHook`), plain CSS.

**Test command (all tasks):**
```
./node_modules/.bin/vitest run --config vitest.config.mjs <file ...>
```

---

## File Structure

- **Create** `frontend/src/lib/Player/playlist.js` — pure: `toTracks`, `advanceIndex`, `shuffleOrder`.
- **Create** `frontend/src/lib/Player/useBackgroundMusic.js` — the hook: fetch queue, drive the `<audio>` element, expose `{ track }`.
- **Modify** `frontend/src/screen-framework/widgets/ArtMode.jsx` — `music` prop, hidden `<audio>`, hook call, top-rail music plaque.
- **Modify** `frontend/src/screen-framework/widgets/ArtMode.css` — `.artmode__music-plaque` + hidden `.artmode__audio`.
- **Create** `tests/unit/art/playlist.test.mjs` — pure tests.
- **Create** `frontend/src/lib/Player/useBackgroundMusic.test.jsx` — hook tests.
- **Modify** `frontend/src/screen-framework/widgets/ArtMode.test.jsx` — component tests.

Config (no code wiring needed — `screensaver.props` already spreads to the widget):
```yaml
screensaver:
  type: art
  props:
    music: { queue: ambient-piano, shuffle: true, volume: 0.25 }
```

---

### Task 1: Playlist pure helpers

**Files:**
- Create: `frontend/src/lib/Player/playlist.js`
- Test: `tests/unit/art/playlist.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/playlist.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { toTracks, advanceIndex, shuffleOrder }
  from '../../../frontend/src/lib/Player/playlist.js';

describe('toTracks', () => {
  it('maps items to {mediaUrl,title,artist}', () => {
    expect(toTracks({ items: [
      { mediaUrl: 'a.mp3', title: 'A', artist: 'X' },
    ] })).toEqual([{ mediaUrl: 'a.mp3', title: 'A', artist: 'X' }]);
  });
  it('falls back to grandparentTitle for the artist', () => {
    const out = toTracks({ items: [{ mediaUrl: 'b.mp3', title: 'B', grandparentTitle: 'Y' }] });
    expect(out[0].artist).toBe('Y');
  });
  it('drops items without a mediaUrl', () => {
    const out = toTracks({ items: [
      { title: 'no url' },
      { mediaUrl: 'c.mp3', title: 'C' },
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].mediaUrl).toBe('c.mp3');
  });
  it('returns [] for missing/empty input', () => {
    expect(toTracks(null)).toEqual([]);
    expect(toTracks({})).toEqual([]);
    expect(toTracks({ items: [] })).toEqual([]);
  });
});

describe('advanceIndex', () => {
  it('advances and wraps', () => {
    expect(advanceIndex(0, 3)).toBe(1);
    expect(advanceIndex(2, 3)).toBe(0);
  });
  it('returns 0 for empty length', () => {
    expect(advanceIndex(0, 0)).toBe(0);
  });
});

describe('shuffleOrder', () => {
  it('returns a permutation of 0..len-1', () => {
    const order = shuffleOrder(5);
    expect(order).toHaveLength(5);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
  it('returns [] for non-positive length', () => {
    expect(shuffleOrder(0)).toEqual([]);
    expect(shuffleOrder(-2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm it FAILS**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/playlist.test.mjs`
Expected: cannot resolve `playlist.js`.

- [ ] **Step 3: Create `frontend/src/lib/Player/playlist.js`:**

```js
// playlist.js — pure helpers for ArtMode background music. No DOM.

// Map a /api/v1/queue response into ambient tracks, dropping anything unplayable.
export function toTracks(queueResponse) {
  const items = queueResponse?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it && it.mediaUrl)
    .map((it) => ({
      mediaUrl: it.mediaUrl,
      title: it.title || '',
      artist: it.artist || it.grandparentTitle || '',
    }));
}

// Next position in a wrapping playlist; 0 when the list is empty.
export function advanceIndex(i, len) {
  if (!(len > 0)) return 0;
  return (i + 1) % len;
}

// A shuffled [0..len-1] (Fisher–Yates); [] for non-positive length.
export function shuffleOrder(len) {
  if (!(len > 0)) return [];
  const a = Array.from({ length: len }, (_, i) => i);
  for (let i = len - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/playlist.test.mjs`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/Player/playlist.js tests/unit/art/playlist.test.mjs
git commit -m "feat(artmode): pure playlist helpers for background music"
```

---

### Task 2: `useBackgroundMusic` hook

**Files:**
- Create: `frontend/src/lib/Player/useBackgroundMusic.js`
- Test: `frontend/src/lib/Player/useBackgroundMusic.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/Player/useBackgroundMusic.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DaylightAPI } from '../api.mjs';
import { useBackgroundMusic } from './useBackgroundMusic.js';

vi.mock('../api.mjs', () => ({ DaylightAPI: vi.fn() }));

// Minimal fake <audio>: records src/volume, captures listeners, fire() dispatches.
function makeFakeEl() {
  const handlers = {};
  return {
    volume: 1,
    src: '',
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    removeEventListener: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((h) => h !== fn); },
    removeAttribute: vi.fn(),
    fire: (ev) => (handlers[ev] || []).slice().forEach((h) => h()),
  };
}

describe('useBackgroundMusic', () => {
  beforeEach(() => { DaylightAPI.mockReset(); });

  it('loads the queue, sets volume, and exposes the first track', async () => {
    DaylightAPI.mockResolvedValue({ items: [
      { mediaUrl: 'a.mp3', title: 'A', artist: 'X' },
      { mediaUrl: 'b.mp3', title: 'B', grandparentTitle: 'Y' },
    ] });
    const el = makeFakeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useBackgroundMusic(ref, { queue: 'q', volume: 0.3 }));
    await waitFor(() => expect(result.current.track?.title).toBe('A'));
    expect(el.volume).toBe(0.3);
    expect(el.src).toBe('a.mp3');
    expect(el.play).toHaveBeenCalled();
  });

  it('advances on ended and wraps to the start', async () => {
    DaylightAPI.mockResolvedValue({ items: [
      { mediaUrl: 'a.mp3', title: 'A', artist: 'X' },
      { mediaUrl: 'b.mp3', title: 'B', artist: 'Y' },
    ] });
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(result.current.track?.title).toBe('A'));
    act(() => el.fire('ended'));
    expect(result.current.track?.title).toBe('B');
    act(() => el.fire('ended'));
    expect(result.current.track?.title).toBe('A');   // wrapped
  });

  it('skips to the next track on an error event', async () => {
    DaylightAPI.mockResolvedValue({ items: [
      { mediaUrl: 'a.mp3', title: 'A', artist: 'X' },
      { mediaUrl: 'b.mp3', title: 'B', artist: 'Y' },
    ] });
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(result.current.track?.title).toBe('A'));
    act(() => el.fire('error'));
    expect(result.current.track?.title).toBe('B');
  });

  it('track is null when the queue is empty', async () => {
    DaylightAPI.mockResolvedValue({ items: [] });
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    expect(result.current.track).toBeNull();
  });

  it('track is null and nothing fetched when music config is absent', async () => {
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, null));
    expect(result.current.track).toBeNull();
    expect(DaylightAPI).not.toHaveBeenCalled();
  });

  it('track is null when the queue fetch rejects', async () => {
    DaylightAPI.mockRejectedValue(new Error('boom'));
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    expect(result.current.track).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm it FAILS**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/lib/Player/useBackgroundMusic.test.jsx`
Expected: cannot resolve `useBackgroundMusic.js`.

- [ ] **Step 3: Create `frontend/src/lib/Player/useBackgroundMusic.js`:**

```js
// useBackgroundMusic.js — config-driven ambient audio for ArtMode. Resolves a
// queue/playlist via the existing /api/v1/queue endpoint, drives a hidden <audio>
// element (autoplay → advance on ended → loop, skip on error), and exposes the
// current track for the on-frame music plaque.
import { useEffect, useState } from 'react';
import { DaylightAPI } from '../api.mjs';
import { getChildLogger } from '../logging/singleton.js';
import { toTracks, advanceIndex, shuffleOrder } from './playlist.js';

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'artmode-music' }));

const clampVol = (v) => Math.max(0, Math.min(1, typeof v === 'number' ? v : 0.25));

/**
 * @param {{current: HTMLAudioElement|null}} audioRef  element ArtMode renders
 * @param {{queue:string, shuffle?:boolean, volume?:number}|null} music  config
 * @returns {{ track: {title:string, artist:string}|null }}
 */
export function useBackgroundMusic(audioRef, music) {
  const [track, setTrack] = useState(null);
  const queue = music?.queue || null;
  const shuffle = !!music?.shuffle;
  const volume = music?.volume;

  useEffect(() => {
    if (!queue) { setTrack(null); return undefined; }

    let cancelled = false;
    let tracks = [];
    let order = [];
    let pos = 0;
    let gestureHandler = null;

    const el = () => audioRef.current;

    const bindGestureRetry = () => {
      if (gestureHandler) return;
      gestureHandler = () => {
        window.removeEventListener('keydown', gestureHandler);
        gestureHandler = null;
        const e = el();
        try { e?.play?.(); } catch (_) { /* ignore */ }
      };
      window.addEventListener('keydown', gestureHandler, { once: true });
    };

    const safePlay = (e) => {
      try {
        const r = e.play?.();
        if (r && typeof r.catch === 'function') {
          r.catch(() => { logger().info?.('artmode.music.autoplay-blocked'); bindGestureRetry(); });
        }
      } catch (_) {
        // jsdom / unsupported play() — ignore.
      }
    };

    const playAt = (p) => {
      const e = el();
      if (!e || !tracks.length) return;
      const t = tracks[order[p]];
      e.src = t.mediaUrl;
      setTrack({ title: t.title, artist: t.artist });
      logger().debug?.('artmode.music.track', { title: t.title, artist: t.artist });
      safePlay(e);
    };

    const step = () => {
      pos = advanceIndex(pos, tracks.length);
      if (pos === 0 && shuffle) order = shuffleOrder(tracks.length);
      playAt(pos);
    };
    const onEnded = () => step();
    const onError = () => { logger().warn?.('artmode.music.error'); step(); };

    (async () => {
      let resp;
      try {
        resp = await DaylightAPI(`api/v1/queue/${encodeURIComponent(queue)}${shuffle ? '?shuffle=1' : ''}`);
      } catch (err) {
        if (!cancelled) { logger().warn?.('artmode.music.error', { error: err?.message }); setTrack(null); }
        return;
      }
      if (cancelled) return;
      tracks = toTracks(resp);
      if (!tracks.length) { logger().info?.('artmode.music.empty'); setTrack(null); return; }
      order = shuffle ? shuffleOrder(tracks.length) : tracks.map((_, i) => i);
      pos = 0;
      logger().info?.('artmode.music.loaded', { count: tracks.length });
      const e = el();
      if (e) {
        e.volume = clampVol(volume);
        e.addEventListener('ended', onEnded);
        e.addEventListener('error', onError);
      }
      playAt(0);
    })();

    return () => {
      cancelled = true;
      if (gestureHandler) window.removeEventListener('keydown', gestureHandler);
      const e = el();
      if (e) {
        e.removeEventListener('ended', onEnded);
        e.removeEventListener('error', onError);
        try { e.pause?.(); } catch (_) { /* ignore */ }
        e.removeAttribute?.('src');
      }
    };
  }, [audioRef, queue, shuffle, volume]);

  return { track };
}

export default useBackgroundMusic;
```

- [ ] **Step 4: Run to confirm PASS**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/lib/Player/useBackgroundMusic.test.jsx`
Expected: all 6 green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/Player/useBackgroundMusic.js frontend/src/lib/Player/useBackgroundMusic.test.jsx
git commit -m "feat(artmode): useBackgroundMusic hook (queue-driven ambient audio)"
```

---

### Task 3: ArtMode integration — audio element + top-rail music plaque

**Files:**
- Modify: `frontend/src/screen-framework/widgets/ArtMode.jsx`
- Modify: `frontend/src/screen-framework/widgets/ArtMode.css`
- Test: `frontend/src/screen-framework/widgets/ArtMode.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add these `it` blocks inside the existing `describe('ArtMode', ...)` in `frontend/src/screen-framework/widgets/ArtMode.test.jsx` (before its closing `});`). They branch the existing `DaylightAPI` mock on the request path:

```js
  it('renders a background-audio element only when music config is present', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(queryByTestId('artmode-music')).toBeNull();
  });

  it('shows the music plaque with the current track in framed modes', async () => {
    DaylightAPI.mockImplementation((path) =>
      path.startsWith('api/v1/queue/')
        ? Promise.resolve({ items: [{ mediaUrl: 'a.mp3', title: 'Gymnopédie', artist: 'Satie' }] })
        : Promise.resolve(single()));
    const { getByTestId } = render(<ArtMode music={{ queue: 'ambient', volume: 0.2 }} />);
    await waitFor(() => expect(getByTestId('artmode-music')).toBeTruthy());
    await waitFor(() => expect(getByTestId('artmode-music-plaque')).toBeTruthy());
    const txt = getByTestId('artmode-music-plaque').textContent;
    expect(txt).toContain('Gymnopédie');
    expect(txt).toContain('Satie');
  });

  it('hides the music plaque in bare modes but keeps the audio element', async () => {
    DaylightAPI.mockImplementation((path) =>
      path.startsWith('api/v1/queue/')
        ? Promise.resolve({ items: [{ mediaUrl: 'a.mp3', title: 'A', artist: 'X' }] })
        : Promise.resolve(single()));
    const { getByTestId, queryByTestId } = render(<ArtMode music={{ queue: 'ambient' }} />);
    await waitFor(() => expect(getByTestId('artmode-music-plaque')).toBeTruthy());
    press('Tab'); press('Tab'); press('Tab'); press('Tab');  // bare-cover
    expect(queryByTestId('artmode-music-plaque')).toBeNull();
    expect(getByTestId('artmode-music')).toBeTruthy();        // audio still mounted
  });
```

- [ ] **Step 2: Run to confirm the new tests FAIL**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx`
Expected: the 3 new tests fail (no `artmode-music` / `artmode-music-plaque`). Existing tests still pass.

- [ ] **Step 3: Wire the hook + prop in `ArtMode.jsx`**

(a) Add the import next to the other widget-local imports (after the `luxToDim` import line):

```jsx
import { useBackgroundMusic } from '../../lib/Player/useBackgroundMusic.js';
```

(b) Add the `music` prop. Change the destructured props line:

```jsx
  defaultViewMode = 'gallery', measureText = null,
  curtainMinMs = CURTAIN_MIN_MS, curtainMaxMs = CURTAIN_MAX_MS,
```

to:

```jsx
  defaultViewMode = 'gallery', measureText = null,
  curtainMinMs = CURTAIN_MIN_MS, curtainMaxMs = CURTAIN_MAX_MS, music = null,
```

(c) Add the audio ref + hook call. Immediately after the `stageRef`/`stage` block's closing (right before the `const load = useCallback(...)` line), insert:

```jsx
  const musicRef = useRef(null);
  const { track: musicTrack } = useBackgroundMusic(musicRef, music);
```

- [ ] **Step 4: Render the audio element + music plaque in `ArtMode.jsx`**

In the returned JSX, find the frame block:

```jsx
        {mode.frame && (
          <img className="artmode__frame" data-testid="artmode-frame" src={frameSrc} alt="" />
        )}
```

Immediately AFTER it, insert the music elements:

```jsx
        {music && (
          <audio ref={musicRef} className="artmode__audio" data-testid="artmode-music" />
        )}

        {music && musicTrack && mode.frame && (
          <div className="artmode__placard artmode__music-plaque" data-testid="artmode-music-plaque">
            {musicTrack.title && (
              <span className="artmode__placard-title artmode__placard-line">{`♪ ${smartQuotes(musicTrack.title)}`}</span>
            )}
            {musicTrack.artist && (
              <span className="artmode__placard-artist artmode__placard-line">{smartQuotes(musicTrack.artist)}</span>
            )}
          </div>
        )}
```

- [ ] **Step 5: Add the CSS**

Append to the END of `frontend/src/screen-framework/widgets/ArtMode.css`:

```css
/* ---- Background audio element (no UI) ---- */
.artmode__audio { display: none; }

/* ---- Music plaque: a brass nameplate on the TOP frame rail (static) ---- */
.artmode__music-plaque {
  top: 2.4%;
  bottom: auto;
  left: 50%;
  max-width: 56%;
}
```

(`.artmode__music-plaque` layers on the shared `.artmode__placard` rule — absolute, `transform: translateX(-50%)`, brass background, screws, z-index — and only overrides the vertical anchor + center, so it mirrors the artwork nameplate on the opposite rail.)

- [ ] **Step 6: Run the ArtMode tests — expect ALL green**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx`
Expected: every test passes (prior tests plus the 3 new ones). If a test fails, debug and fix; do not leave failing tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx \
        frontend/src/screen-framework/widgets/ArtMode.css \
        frontend/src/screen-framework/widgets/ArtMode.test.jsx
git commit -m "feat(artmode): config-driven background music + top-rail music plaque"
```

---

### Task 4: Full art-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run every art + music test together**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/unit/art/playlist.test.mjs \
  tests/unit/art/artModes.test.mjs \
  tests/unit/art/titleLayout.test.mjs \
  tests/unit/art/artLayout.test.mjs \
  tests/unit/art/luxToDim.test.mjs \
  tests/unit/art/deriveMatte.test.mjs \
  frontend/src/lib/Player/useBackgroundMusic.test.jsx \
  frontend/src/screen-framework/widgets/ArtMode.test.jsx
```
Expected: all test files green, zero failures.

- [ ] **Step 2: Manual QA notes (post-deploy, on the kiosk)**

After deploy + kiosk reload, with `screensaver.props.music: { queue: <playlist>, shuffle: true, volume: 0.25 }`:
- Music starts automatically; on track end it advances and loops.
- A brass nameplate on the **top** rail shows `♪ Title` + artist, updating per track, statically positioned.
- Tab to a bare mode (4-5): the music plaque disappears (no frame) but music keeps playing; Tab back: it returns.
- ←/→ shuffles art and Up/Down still control brightness — music is unaffected.

(Deploy is the operator's call; this plan ends at green tests.)

---

## Notes for the implementer

- Run tests with the exact vitest command shown; `npm run test:isolated` routes these specs to the wrong runner.
- `DaylightAPI(path)` (GET) returns parsed JSON. The hook calls `api/v1/queue/<queue>[?shuffle=1]`.
- jsdom does not implement `HTMLMediaElement.play()` (it throws); `safePlay` swallows that — expected. The hook tests use a fake element, the component tests use a real `<audio>` whose `play()` throw is ignored.
- Keep all existing ArtMode tests passing — the changes are additive (new prop defaults to `null` → no audio, no plaque).
