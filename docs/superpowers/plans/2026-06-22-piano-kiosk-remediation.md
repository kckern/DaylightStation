# Piano Kiosk Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redeem the Piano kiosk from the design/UX sins enumerated in `docs/_wip/audits/2026-06-22-piano-kiosk-design-ux-sins-audit.md` — light theme, never-lose-state, fast cached browsing, deep-linkable routes, coherent layout, and a real design system — without breaking the dark media stages or the other apps sharing the SPA.

**Architecture:** The Piano SPA (`frontend/src/Apps/PianoApp.jsx` + `modules/Piano/PianoKiosk/`) is a touch kiosk routed under `/piano/:pianoId`. Remediation is phased so each phase ships independently: (1) theme + kiosk-fixity, (2) never-lose-state, (3) a cached list primitive every grid shares, (4) a route per view with Plex IDs in the URL, (5) media-player reliability, (6) browse-layout fixes, (7) a shared design system (tokens, card, icons, back), (8) modes + accessibility polish. Browse chrome is light; immersive media stages (video letterbox, fullscreen games, now-playing music, note-waterfall) stay dark by design.

**Tech Stack:** React 18 + react-router (SPA), SCSS with CSS custom-property tokens, Vitest for unit tests, Playwright for flow tests, `DaylightAPI(path, data, method)` for backend calls, structured logging via `getLogger().child(...)`.

---

## Conventions for every task

- **Run unit tests** from repo root: `npx vitest run <path-to-test>` (config: `vitest.config.mjs`).
- **Build check** (SCSS/JSX compiles): `cd /opt/Code/DaylightStation && npx vite build --config frontend/vite.config.* 2>&1 | tail -5` — or rely on the running dev server (`ss -tlnp | grep 3112`) hot-reloading without errors in `dev.log`.
- **Visual check:** load `https://daylightlocal.kckern.net/piano` (or the dev URL) on a tablet/desktop; for kiosk verify, reload garage Firefox per `CLAUDE.local.md`.
- **Logging:** every new component/hook adds `getLogger().child({ component })` events at lifecycle/error points (project rule).
- **Commit** after each task with a `feat(piano):` / `fix(piano):` / `style(piano):` message.
- **Already started:** `frontend/src/Apps/PianoApp.scss` has been rewritten to a light token system with the media-stage exceptions, the music now-playing overlay+dim, the caption line-clamp, and the gesture guards. Tasks below that say "(SCSS done)" only need the JS/JSX half + verification.

---

## Phase 1 — Light theme + kiosk fixity

### Task 1: Scope the light body background to the Piano app

**Files:**
- Modify: `frontend/src/Apps/PianoApp.jsx` (the default `PianoApp` component, ~line 139)
- Test: `frontend/src/Apps/PianoApp.bodytheme.test.jsx` (create)

The shared `index.html` sets `<body style="background-color: black;">` inline (beats any class selector). Other apps depend on it, so we override the body background **only while Piano is mounted**, restoring it on unmount.

- [ ] **Step 1: Write the failing test**

```jsx
// PianoApp.bodytheme.test.jsx
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { applyPianoBodyTheme } from './pianoBodyTheme.js';

afterEach(cleanup);

describe('applyPianoBodyTheme', () => {
  it('sets a light body background and returns a restore fn', () => {
    document.body.style.backgroundColor = 'black';
    const restore = applyPianoBodyTheme();
    expect(document.body.style.backgroundColor).toBe('rgb(255, 255, 255)');
    restore();
    expect(document.body.style.backgroundColor).toBe('black');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/Apps/PianoApp.bodytheme.test.jsx`
Expected: FAIL — `pianoBodyTheme.js` does not exist.

- [ ] **Step 3: Create the helper**

```js
// frontend/src/Apps/pianoBodyTheme.js
/** Force a light body background while the Piano kiosk is mounted; returns a restore fn. */
export function applyPianoBodyTheme() {
  const prev = document.body.style.backgroundColor;
  document.body.style.backgroundColor = '#ffffff';
  return () => { document.body.style.backgroundColor = prev; };
}
```

- [ ] **Step 4: Wire it into PianoApp**

In `frontend/src/Apps/PianoApp.jsx`, inside `export default function PianoApp()`, add:

```js
import { applyPianoBodyTheme } from './pianoBodyTheme.js';
// ...
useEffect(() => applyPianoBodyTheme(), []);
```

- [ ] **Step 5: Run test + build**

Run: `npx vitest run frontend/src/Apps/PianoApp.bodytheme.test.jsx`
Expected: PASS. Then load `/piano` with no params on a desktop — background is white, text dark.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Apps/pianoBodyTheme.js frontend/src/Apps/PianoApp.bodytheme.test.jsx frontend/src/Apps/PianoApp.jsx
git commit -m "fix(piano): light body background scoped to the kiosk (no param, no prefers-color-scheme)"
```

### Task 2: Verify gesture guards (pull-to-refresh + zoom) — (SCSS done)

**Files:**
- Verify: `frontend/src/Apps/PianoApp.scss` (`.piano-app` has `overscroll-behavior: none; touch-action: manipulation;`)

- [ ] **Step 1:** Confirm the two declarations exist on `.piano-app` and `.piano-connect-gate`. They do (from the rewrite).
- [ ] **Step 2:** On a touch device, swipe down hard at the top → page must NOT reload. Double-tap → must NOT zoom. Pinch → must NOT zoom.
- [ ] **Step 3:** If the kiosk browser still zooms via its own chrome, set the FKB/Firefox kiosk zoom-lock pref (out of code scope; note in runbook).
- [ ] **Step 4:** No commit needed unless the runbook note is added.

### Task 3: Acceptance — light by default

- [ ] Load `…/piano` with **no params**, OS theme set to dark. Confirm: light background, readable dark text, every control legible (no cream-on-white invisibility). Spot-check menu, a grid, album detail, studio, score viewer mat, video transport bar. Media stages (video letterbox, now-playing) remain dark — expected.

---

## Phase 2 — Never lose my place

### Task 4: Inactivity-return must treat active playback as activity

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/useInactivityReturn.js`
- Modify: `frontend/src/Apps/PianoApp.jsx` (`PianoShell`, pass a `mediaActive` signal)
- Test: `frontend/src/modules/Piano/PianoKiosk/useInactivityReturn.test.js` (create)

Today passive video/music gets navigated back to the menu after `inactivityMinutes` because the timer only counts MIDI + pointer. Add a `keepAlive` flag that, while true, continuously bumps the activity timestamp.

- [ ] **Step 1: Write the failing test**

```js
// useInactivityReturn.test.js
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useInactivityReturn } from './useInactivityReturn.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useInactivityReturn', () => {
  it('does NOT fire onIdle while keepAlive is true', () => {
    const onIdle = vi.fn();
    renderHook(() => useInactivityReturn(new Map(), 0, 1, onIdle, true)); // 1 min, keepAlive
    vi.advanceTimersByTime(5 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('fires onIdle after the threshold when keepAlive is false', () => {
    const onIdle = vi.fn();
    renderHook(() => useInactivityReturn(new Map(), 0, 1, onIdle, false));
    vi.advanceTimersByTime(70_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/useInactivityReturn.test.js`
Expected: FAIL — `keepAlive` param not honored.

- [ ] **Step 3: Implement**

Add a 5th param `keepAlive` and an effect that bumps the timer on an interval while it's true:

```js
export function useInactivityReturn(activeNotes, historyLen, minutes, onIdle, keepAlive = false) {
  const lastActivityRef = useRef(Date.now());
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => { lastActivityRef.current = Date.now(); }, [activeNotes, historyLen]);

  // Active playback continuously counts as activity.
  useEffect(() => {
    if (!keepAlive) return undefined;
    lastActivityRef.current = Date.now();
    const id = setInterval(() => { lastActivityRef.current = Date.now(); }, 5_000);
    return () => clearInterval(id);
  }, [keepAlive]);

  useEffect(() => {
    if (!minutes || minutes <= 0) return undefined;
    const bump = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('pointerdown', bump, true);
    window.addEventListener('keydown', bump, true);
    return () => {
      window.removeEventListener('pointerdown', bump, true);
      window.removeEventListener('keydown', bump, true);
    };
  }, [minutes]);

  useEffect(() => {
    if (!minutes || minutes <= 0) return undefined;
    const thresholdMs = minutes * 60_000;
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= thresholdMs) {
        lastActivityRef.current = Date.now();
        onIdleRef.current?.();
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [minutes]);
}
```

- [ ] **Step 4: Provide the `mediaActive` signal**

`PianoShell` needs to know if media is playing. Add a tiny context the players set. Create `frontend/src/modules/Piano/PianoKiosk/PianoPlaybackContext.jsx`:

```jsx
import { createContext, useContext, useState, useMemo, useCallback } from 'react';
const Ctx = createContext({ playing: false, setPlaying: () => {} });
export function PianoPlaybackProvider({ children }) {
  const [playing, setPlayingState] = useState(false);
  const setPlaying = useCallback((v) => setPlayingState(!!v), []);
  const value = useMemo(() => ({ playing, setPlaying }), [playing, setPlaying]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const usePianoPlayback = () => useContext(Ctx);
```

Wrap `<PianoShell />` with `<PianoPlaybackProvider>` in `ActivePiano` (PianoApp.jsx). In `PianoShell`, read `const { playing } = usePianoPlayback();` and pass it as the 5th arg:

```js
useInactivityReturn(activeNotes, noteHistory.length, config.inactivityMinutes, onIdle, playing);
```

- [ ] **Step 5: Players report playback**

In `MusicPlayer.jsx`, add `const { setPlaying } = usePianoPlayback();` and `useEffect(() => { setPlaying(playing); return () => setPlaying(false); }, [playing, setPlaying]);`. Do the same in `PianoVideoPlayer.jsx` keyed on `isPlaying`.

- [ ] **Step 6: Run test + manual**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/useInactivityReturn.test.js`
Expected: PASS. Manual: start a track, leave it ≥ inactivityMinutes untouched → stays on now-playing (does not jump to menu).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/useInactivityReturn.js frontend/src/modules/Piano/PianoKiosk/useInactivityReturn.test.js frontend/src/modules/Piano/PianoKiosk/PianoPlaybackContext.jsx frontend/src/Apps/PianoApp.jsx frontend/src/modules/Piano/PianoKiosk/modes/Music/MusicPlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx
git commit -m "fix(piano): keep playing media alive against the inactivity-return timer"
```

### Task 5: Scoped reload guard during active playback (pull-to-refresh backstop)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/useReloadGuard.js`
- Modify: `MusicPlayer.jsx`, `PianoVideoPlayer.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/useReloadGuard.test.js`

`overscroll-behavior:none` (Task 2) already prevents the accidental pull-to-refresh gesture. This adds a **backstop** that only arms `beforeunload` *while media is actively playing*, so it never nags during idle browsing and never blocks the menu-state deploy reload (`xdotool ctrl+shift+r` is done from the menu, not mid-playback).

- [ ] **Step 1: Write the failing test**

```js
// useReloadGuard.test.js
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useReloadGuard } from './useReloadGuard.js';

afterEach(() => vi.restoreAllMocks());

describe('useReloadGuard', () => {
  it('adds beforeunload only when active', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { rerender, unmount } = renderHook(({ a }) => useReloadGuard(a), { initialProps: { a: false } });
    expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
    rerender({ a: true });
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    unmount();
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/useReloadGuard.test.js` → FAIL (no module).

- [ ] **Step 3: Implement**

```js
// useReloadGuard.js
import { useEffect } from 'react';
/** While `active`, prompt before an accidental unload (pull-to-refresh backstop). */
export function useReloadGuard(active) {
  useEffect(() => {
    if (!active) return undefined;
    const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [active]);
}
export default useReloadGuard;
```

- [ ] **Step 4:** In `MusicPlayer.jsx` call `useReloadGuard(playing)`; in `PianoVideoPlayer.jsx` call `useReloadGuard(isPlaying)`.

- [ ] **Step 5: Run test** → PASS. Manual: while a track plays, a reload prompts; from the menu, a reload does not.

- [ ] **Step 6: Commit** `fix(piano): guard accidental reload only during active playback`

---

## Phase 3 — Caching: stop refetching grids and posters on every visit

### Task 6: A cached list hook shared by every grid

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/usePianoList.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/usePianoList.test.js`

Today each grid refetches in `useEffect` on every mount, so back-navigation re-pays the list call and re-downloads posters. Introduce a module-level cache with stale-while-revalidate: cached data renders instantly, a background refresh updates it.

- [ ] **Step 1: Write the failing test**

```js
// usePianoList.test.js
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => { calls.push(path); return { items: [{ id: 'a' }] }; }),
}));
import { usePianoList, __clearPianoListCache } from './usePianoList.js';

beforeEach(() => { calls.length = 0; __clearPianoListCache(); });

describe('usePianoList', () => {
  it('fetches once, then serves cache on remount (no second fetch within TTL)', async () => {
    const h1 = renderHook(() => usePianoList('api/v1/list/plex/123'));
    await waitFor(() => expect(h1.result.current.data).toEqual([{ id: 'a' }]));
    h1.unmount();
    const h2 = renderHook(() => usePianoList('api/v1/list/plex/123'));
    expect(h2.result.current.data).toEqual([{ id: 'a' }]); // instant from cache
    expect(calls.length).toBe(1);
  });

  it('returns null path as empty without fetching', () => {
    const { result } = renderHook(() => usePianoList(null));
    expect(result.current.data).toEqual([]);
    expect(calls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to fail** — FAIL (no module).

- [ ] **Step 3: Implement**

```js
// usePianoList.js
import { useState, useEffect } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';

const cache = new Map(); // path -> { items, at }
const TTL_MS = 5 * 60_000;
export function __clearPianoListCache() { cache.clear(); }

/**
 * Cached list fetch with stale-while-revalidate. `select` maps the raw response
 * to an array (default: res.items). Returns { data, loading, error }.
 * data is null while first-loading, [] when empty.
 */
export function usePianoList(path, select = (r) => r?.items ?? []) {
  const cached = path ? cache.get(path) : null;
  const [data, setData] = useState(cached ? cached.items : (path ? null : []));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!path) { setData([]); return undefined; }
    let cancelled = false;
    const fresh = cache.get(path);
    if (fresh && Date.now() - fresh.at < TTL_MS) { setData(fresh.items); return undefined; }
    if (fresh) setData(fresh.items); // stale: show immediately, revalidate below
    (async () => {
      try {
        const res = await DaylightAPI(path);
        const items = select(res);
        if (!cancelled) { cache.set(path, { items, at: Date.now() }); setData(items); }
      } catch (err) {
        if (!cancelled) { setError(err.message); if (!fresh) setData([]); }
        getLogger().child({ component: 'piano-list' }).warn('piano.list-failed', { path, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading: data === null, error };
}
export default usePianoList;
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit** `feat(piano): cached stale-while-revalidate list hook`

### Task 7: Move CourseGrid, ScoreGrid, AlbumGrid onto usePianoList

**Files:**
- Modify: `modes/Videos/CourseGrid.jsx`, `modes/SheetMusic/ScoreGrid.jsx`, `modes/Music/AlbumGrid.jsx`

- [ ] **Step 1:** In `CourseGrid.jsx`, replace the `useState(items)` + `useEffect` fetch with:

```jsx
const ratingKey = collection ? String(collection).replace(/^plex:/, '') : null;
const { data: items, error } = usePianoList(ratingKey ? `api/v1/list/plex/${ratingKey}` : null);
```

Keep the render branches (`items === null` loading, `items?.length === 0` empty with `error || 'No videos found.'`). Remove the now-unused logger/effect imports if dead.

- [ ] **Step 2:** Same transform in `ScoreGrid.jsx`.
- [ ] **Step 3:** `AlbumGrid.jsx` composes collection + playlists; keep its `Promise.all` but wrap the **collection** list in `usePianoList` and fetch playlists once (they rarely change) — or, simplest, leave AlbumGrid's composite fetch but route it through a second cache key. Minimum: cache the collection call. (Document that playlists still refetch; acceptable.)
- [ ] **Step 4: Verify** existing tests still pass: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/`
- [ ] **Step 5: Manual** — open Videos, enter a course, press Back → grid renders instantly, no poster re-flash.
- [ ] **Step 6: Commit** `perf(piano): cache collection grids so back-nav doesn't refetch`

### Task 8: Eager posters + skeleton tiles (no flash of empty rectangles)

**Files:**
- Modify: `CourseGrid.jsx`, `ScoreGrid.jsx`, `AlbumGrid.jsx`, `CourseDetail.jsx` (img tags)
- Modify: `frontend/src/Apps/PianoApp.scss` (skeleton)

- [ ] **Step 1:** On every grid `<img>`, drop `loading="lazy"` and add `loading="eager" decoding="async"`. Keep the first row high priority by adding `fetchpriority="high"` to images whose index < (columns).
- [ ] **Step 2:** Add a skeleton background so a not-yet-loaded tile holds its slot. In `PianoApp.scss` add:

```scss
.piano-video-grid__tile { background-clip: padding-box; }
.piano-video-grid__tile img { background: var(--piano-surface-2); }
.piano-video-grid--posters .piano-video-grid__tile,
.piano-music-grid .piano-video-grid__tile {
  aspect-ratio: 2 / 3;            // posters reserve their box even with no img yet
  background: var(--piano-surface-2);
  border-radius: 8px;
}
.piano-music-grid .piano-video-grid__tile { aspect-ratio: 1 / 1; }
```

- [ ] **Step 3:** Always render the tile box even when `item.thumbnail||item.image` is falsy (remove the `&&` guard around `<img>`; instead render `<img>` only when a src exists but keep the tile/button sized via the CSS above).
- [ ] **Step 4: Manual** — throttle network in devtools; tiles appear as gray boxes immediately, images fade in, no layout shift.
- [ ] **Step 5: Commit** `style(piano): eager posters + skeleton tiles, no empty-rectangle flash`

---

## Phase 4 — A route per view (Plex IDs in the URL)

> **Routing requirement (user):** the single/default piano must NOT carry a `pianoId`
> segment. URLs are `/piano`, `/piano/videos`, `/piano/music/:albumId`, … — never
> `/piano/default/videos`. The `:pianoId` segment is used ONLY when the household has
> more than one piano. Task 8B establishes this; Tasks 9–11 nest under whichever
> parent applies.

### Task 8B: Serve the single/default piano without a pianoId URL segment

**Files:**
- Modify: `frontend/src/Apps/PianoApp.jsx` (route table + `ActivePiano`/`PianoPicker` wiring)
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoChrome.jsx` (home/label navigation), `PianoMenu.jsx`, `PianoPicker.jsx` (any absolute `/piano/${pianoId}` builders)
- Test: `frontend/src/Apps/PianoApp.routing.test.jsx` (create)

When `derivePianos(raw)` yields exactly one piano, mount the active-piano subtree at `/piano/*` (resolving `pianoId` internally to that one piano) so mode URLs are `/piano/videos` etc. When there are 2+ pianos, keep `/piano/:pianoId/*` and the picker at `/piano`.

- [ ] **Step 1: Write the failing test** — render `PianoApp` in a `MemoryRouter` with a roster of one piano at `/piano/videos`; assert the Videos mode renders (no redirect to `/piano/default/...`). Mock `usePianoRoster`/config as the existing piano tests do (read `PianoConfig.test.js` first for the established mocking pattern — do not invent helpers).

- [ ] **Step 2:** In `PianoApp.jsx`, branch the route table on roster size:

```jsx
// inside the component that has the roster:
const { pianos } = usePianoRoster();
const single = pianos.length === 1;
return single ? (
  <Routes>
    <Route path="/*" element={<ActivePiano pianoId={pianos[0].id} />} />
  </Routes>
) : (
  <Routes>
    <Route index element={<PianoPicker />} />
    <Route path=":pianoId/*" element={<ActivePiano />} />
  </Routes>
);
```

`ActivePiano` must accept an optional `pianoId` prop (falling back to `useParams().pianoId`). Build a `basePath` = `single ? '/piano' : '/piano/' + pianoId` and thread it (via the existing `ActivePianoProvider` value, add a `basePath` field) so chrome/menu navigation uses it instead of hardcoding `/piano/${pianoId}`.

- [ ] **Step 3:** Update `PianoChrome.jsx` home button → `navigate(basePath)`; the label "switch piano" button → only render when multi-piano (a single-piano kiosk has nothing to switch to); `PianoMenu.open()` → `navigate(\`${basePath}/${id}\`)`. Pull `basePath` from `usePianoKioskConfig()`.

- [ ] **Step 4:** `PianoPicker` keeps its multi-piano list at `/piano`; its single-piano auto-enter effect is no longer needed (the route branch handles it) — remove that redirect to avoid a double-navigation.

- [ ] **Step 5:** Run the routing test (PASS) and the existing `PianoConfig.test.js` (no regression). Manual: load `/piano` on a one-piano household → menu; tap Videos → URL is `/piano/videos` (no `default`).

- [ ] **Step 6: Commit** `feat(piano): single piano serves without a pianoId URL segment`

### Task 9: Route the Videos mode (grid → course → lecture)

**Files:**
- Modify: `modes/Videos/Videos.jsx`
- Modify: `frontend/src/Apps/PianoApp.jsx` (route is already `videos` → make it `videos/*`)

Replace `useState(course/lecture)` with nested routes so the course id and lecture contentId live in the URL. This restores deep-linking, makes browser/physical Back an "up" gesture, and survives reload.

- [ ] **Step 1:** In `PianoApp.jsx` change `<Route path="videos" …>` to `<Route path="videos/*" element={<Videos />} />`.
- [ ] **Step 2:** Rewrite `Videos.jsx` to nested routes:

```jsx
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
// CourseGrid at index; CourseDetail at :courseId; player at :courseId/:lectureId
export function Videos() {
  const navigate = useNavigate();
  const { config } = usePianoKioskConfig();
  const collection = config.videos.plexCollection;
  return (
    <Routes>
      <Route index element={<CourseGrid collection={collection} onSelect={(it) => navigate(idOf(it.id))} />} />
      <Route path=":courseId" element={<CourseDetailRoute />} />
      <Route path=":courseId/:lectureId" element={<LecturePlayerRoute />} />
    </Routes>
  );
}
```

Where `CourseDetailRoute` reads `useParams().courseId`, fetches/locates the course, and `onPlay={(item) => navigate(\`${courseId}/${lectureContentId(item)}\`)}`, `onBack={() => navigate('..')}` (relative). `LecturePlayerRoute` reads both params, resolves the lecture, renders `PianoVideoPlayer` with `onBack={() => navigate('..')}`. Keep `useKeepScreenAwake('video', isPlayerRoute)`.

- [ ] **Step 3:** `PianoVideoPlayer`'s lecture object may need re-fetching from the contentId on a cold deep-link. Use the existing `usePianoList(\`api/v1/fitness/show/${courseId}/playable\`)` (cached) to find the lecture by id; if not found, show the existing "This lecture can't be played. Back" placeholder.
- [ ] **Step 4: Update tests** — `Videos.test.jsx` likely asserts the state-machine. Update to use `MemoryRouter` and assert the rendered view per path. Run `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.test.jsx`.
- [ ] **Step 5: Manual** — deep-link `…/videos/<courseId>/<lectureId>` loads straight into the player; browser Back goes up one level; reload during a course keeps you on the course.
- [ ] **Step 6: Commit** `feat(piano): route the Videos mode (course/lecture ids in the URL)`

### Task 10: Route the Music mode (grid → album → now-playing)

**Files:** Modify `modes/Music/Music.jsx`, route `music/*` in `PianoApp.jsx`.

- [ ] **Step 1:** `music/*` route. Nested: index `AlbumGrid` → `:albumId` `AlbumDetail` → `:albumId/play?track=N` `MusicPlayer`.
- [ ] **Step 2:** `AlbumDetail` reads `useParams().albumId`; `onPlay={(tracks, i) => navigate(\`play?track=${i}\`)}`. `MusicPlayer` reads `albumId` + `?track=` (via `useSearchParams`), fetches tracks through the cached queue endpoint, `onBack={() => navigate('..')}`.
- [ ] **Step 3:** Keep the now-playing as the full-cover overlay (SCSS done). Confirm it still covers the header under the new route.
- [ ] **Step 4: Update `Music.test.jsx`** to router assertions. Run vitest for the Music dir.
- [ ] **Step 5: Manual** — deep-link an album + track; reload mid-album returns to the now-playing for that album/track (position resumes from track start — full media resume is out of scope).
- [ ] **Step 6: Commit** `feat(piano): route the Music mode (album id + track in the URL)`

### Task 11: Route SheetMusic and Games

**Files:** `modes/SheetMusic/SheetMusic.jsx`, `modes/Games/Games.jsx`, routes `sheetmusic/*`, `games/*`.

- [ ] **Step 1:** SheetMusic: index `ScoreGrid` → `:scoreId` `ScoreViewer` (reads param, `onBack={() => navigate('..')}`).
- [ ] **Step 2:** Games: index grid → `:gameId` fullscreen game (reads param via `getGameEntry`, `onDeactivate={() => navigate('..')}`).
- [ ] **Step 3: Update `SheetMusic.test.jsx`, `Games.test.jsx`** to router assertions; run vitest for both dirs.
- [ ] **Step 4: Manual** — deep-link a score and a game; Back behaves as up.
- [ ] **Step 5: Commit** `feat(piano): route SheetMusic and Games (ids in the URL)`

---

## Phase 5 — Media-player reliability

### Task 12: Time-out the video media-element resolver; surface a real failure

**Files:**
- Modify: `modes/Videos/useResolvedMediaEl.js`
- Modify: `modes/Videos/PianoVideoPlayer.jsx`
- Test: `modes/Videos/useResolvedMediaEl.test.js` (create)

`useResolvedMediaEl` polls forever; if the Player never mounts a media element, the transport is silently dead ("can't stop the video"). Add a timeout that reports failure so the player can show a Back affordance.

- [ ] **Step 1: Write the failing test**

```js
// useResolvedMediaEl.test.js
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import useResolvedMediaEl from './useResolvedMediaEl.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useResolvedMediaEl', () => {
  it('reports timedOut when the element never appears', () => {
    const ref = { current: { getMediaElement: () => null } };
    const { result } = renderHook(() => useResolvedMediaEl(ref, 8000));
    act(() => { vi.advanceTimersByTime(8100); });
    expect(result.current.timedOut).toBe(true);
    expect(result.current.el).toBe(null);
  });
});
```

- [ ] **Step 2: Run to fail** — current hook returns the element directly, not `{ el, timedOut }`.

- [ ] **Step 3: Implement** — change the hook to return `{ el, timedOut }`, poll via `requestAnimationFrame`, and after `timeoutMs` (default 8000) stop polling and set `timedOut`. Use a timestamp captured at mount (pass via `performance.now()` inside the rAF, which is allowed in app code) to measure elapsed.

```js
export default function useResolvedMediaEl(playerRef, timeoutMs = 8000) {
  const [state, setState] = useState({ el: null, timedOut: false });
  useEffect(() => {
    let raf; let start;
    const tick = (t) => {
      if (start == null) start = t;
      const m = playerRef?.current?.getMediaElement?.();
      if (m) { setState({ el: m, timedOut: false }); return; }
      if (t - start >= timeoutMs) { setState({ el: null, timedOut: true }); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playerRef, timeoutMs]);
  return state;
}
```

- [ ] **Step 4:** Update `PianoVideoPlayer.jsx`: `const { el: mediaEl, timedOut } = useResolvedMediaEl(playerRef);` and when `timedOut && !mediaEl`, render the placeholder: `"This video didn't start." <button onClick={onBack}>Back to course</button>` (logs `piano.video.mount-timeout`).
- [ ] **Step 5: Run test + manual** → PASS; simulate by pointing at a bad contentId and confirm the failure UI appears instead of a dead transport.
- [ ] **Step 6: Commit** `fix(piano): time out the video media-element resolver and show a real failure`

### Task 13: Relabel the video back button to its real destination

**Files:** Modify `modes/Videos/PianoVideoChrome.jsx`

- [ ] **Step 1:** Change `‹ Lessons` (line 39) to `‹ Course`. (After Task 9 the player's parent is the course detail.) Pass an explicit `backLabel` prop from `PianoVideoPlayer` if a more specific course title is available (`‹ {courseTitle}`).
- [ ] **Step 2: Update `PianoVideoChrome.test.jsx`** expectation for the label. Run vitest for the Videos dir.
- [ ] **Step 3: Commit** `fix(piano): correct the video back-button label (was "Lessons")`

### Task 14: Auto-hide the video transport; reclaim video height

**Files:** Modify `PianoVideoPlayer.jsx`, `PianoVideoChrome.jsx`, `PianoApp.scss`

- [ ] **Step 1:** Reuse `useVanishingControls({ active: isPlaying })` (already in the Music dir — import it; it lives at `modes/Music/useVanishingControls.js`, generic enough to share, or move it to `PianoKiosk/useVanishingControls.js` and update the one Music import).
- [ ] **Step 2:** Wrap `PianoVideoChrome` so it gets `chrome-hidden` when idle; CSS: `.piano-video-player.chrome-hidden .piano-video-chrome { opacity: 0; pointer-events: none; }` with a transition. Reveal on `onPointerDown` of `.piano-video-player`.
- [ ] **Step 3:** Make the keyboard footer collapsible too when play-along is on but idle, so the video gets the height back (optional: only fade the transport).
- [ ] **Step 4: Manual** — play a video, idle 3s → transport fades, video uses more height; tap → returns.
- [ ] **Step 5: Commit** `style(piano): auto-hide video transport to reclaim video height`

### Task 15: Verify music now-playing header-hide + ambient dim — (SCSS done)

- [ ] **Step 1:** Confirm `.piano-music-player` is `position:absolute; inset:0; z-index:40` (covers the app header) and `&.chrome-hidden { filter: brightness(0.15); }`.
- [ ] **Step 2: Manual** — open a track: the top app chrome is not visible (covered); idle 3s → whole screen dims to ~15% (ambient, doesn't glow); tap anywhere → brightens + controls return.
- [ ] **Step 3:** No commit unless adjustments needed.

---

## Phase 6 — Browse-layout crimes

### Task 16: CourseDetail header band (stop wasting the fold)

**Files:** Modify `modes/Videos/CourseDetail.jsx`, `PianoApp.scss`

- [ ] **Step 1:** Restructure the JSX so poster + meta form one horizontal band, grid below:

```jsx
<section className="piano-mode piano-mode--videos piano-video-detail">
  <PianoBack onClick={onBack} label="Courses" />  {/* Task 24 */}
  <header className="piano-video-detail__band">
    {(info.image || course?.image) && <img className="piano-video-detail__poster" src={info.image || course.image} alt="" />}
    <div className="piano-video-detail__meta">
      <h2 className="piano-video-detail__title">{course?.title || info.title || 'Course'}</h2>
      {info.summary && <p className="piano-video-detail__summary">{info.summary}</p>}
      <p className="piano-video-detail__count">{items?.length ? `${items.length} lectures` : ''}</p>
    </div>
  </header>
  {/* grid… */}
</section>
```

- [ ] **Step 2:** CSS:

```scss
.piano-video-detail__band { display: flex; gap: 1.25rem; align-items: flex-start; margin-bottom: 1rem; }
.piano-video-detail__poster { max-height: 11rem; border-radius: 10px; flex: 0 0 auto; }
.piano-video-detail__meta { flex: 1 1 auto; min-width: 0; }
.piano-video-detail__title { margin: 0 0 .4rem; }
.piano-video-detail__count { color: var(--piano-muted); margin: .25rem 0 0; }
```

- [ ] **Step 3: Manual** — the lecture grid now starts high on the screen; header is a shallow band, not a tall left-aligned stack.
- [ ] **Step 4: Commit** `style(piano): CourseDetail header band reclaims the fold`

### Task 17: Lecture rows show a description (episode synopsis is viewable)

**Files:** Modify `modes/Videos/CourseDetail.jsx`, `PianoApp.scss`; check `lectureMeta.js` for a summary field.

- [ ] **Step 1:** Inspect a `playable` item (log one) to find the per-lecture summary/description field name. If present (e.g. `item.summary`/`item.description`), render it clamped under the title:

```jsx
<span className="piano-video-grid__title">{item.label || item.title}</span>
{(item.summary || item.description) && (
  <span className="piano-video-grid__desc">{item.summary || item.description}</span>
)}
```

- [ ] **Step 2:** CSS — clamp to 2 lines, muted:

```scss
.piano-video-grid__desc {
  font-size: .85rem; color: var(--piano-muted); line-height: 1.25;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
```

- [ ] **Step 3:** If no per-lecture description exists in the API, add a long-press/focus detail panel instead (note as follow-up; do not invent fields). Verify the field before committing (project rule: verify before prescribing).
- [ ] **Step 4: Manual** — lecture tiles show a 2-line synopsis; titles + descriptions are both clamped so the board is even.
- [ ] **Step 5: Commit** `feat(piano): show lecture descriptions in the course list`

### Task 18: Remove the per-mode `<h2>`; show the mode name in the chrome bar

**Files:** Modify `CourseGrid.jsx`, `AlbumGrid.jsx`, `ScoreGrid.jsx`, `Games.jsx`, `Lessons.jsx`, `Studio.jsx` (remove `<h2>`); `PianoChrome.jsx` (+ `PianoApp.jsx` to pass the active mode label).

- [ ] **Step 1:** Delete the leading `<h2>Videos/Music/Sheet Music/Games/Lessons/Studio</h2>` from each mode's grid/root.
- [ ] **Step 2:** In `PianoChrome.jsx`, add an optional `modeLabel` prop rendered as a centered title between the label and the status. Derive it in `PianoShell` from the current route segment (map `videos→Videos`, etc.).
- [ ] **Step 3: Manual** — the fold no longer has a redundant heading; the current mode reads from the top bar.
- [ ] **Step 4: Commit** `style(piano): drop redundant per-mode headings; mode name lives in the chrome`

### Task 19: Caption the collection/album/score tiles (visible labels on touch)

**Files:** Modify `CourseGrid.jsx`, `AlbumGrid.jsx`, `ScoreGrid.jsx`, `PianoApp.scss`

- [ ] **Step 1:** Under each poster/cover `<img>`, render a clamped caption (these grids currently rely on `title=`/`alt` only, invisible on touch):

```jsx
<span className="piano-video-grid__title">{item.title}</span>
```

- [ ] **Step 2:** CSS already gives `.piano-video-grid__title` a 2-line clamp (SCSS done). For the poster/cover variants, restore `padding`/`gap` on the tile so the caption has room (override the `padding:0` in `--posters`/`piano-music-grid` with a small bottom area).
- [ ] **Step 3: Manual** — every cover has a readable label beneath it.
- [ ] **Step 4: Commit** `fix(piano): visible captions on cover grids (touch has no hover)`

---

## Phase 7 — A real design system

### Task 20: Radius + spacing tokens (kill the seven-radius chaos)

**Files:** Modify `PianoApp.scss`

- [ ] **Step 1:** Add to `:root`: `--r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-pill: 999px;`. Replace the ad-hoc `4/6/10/12/16` radii with the nearest token (pages/thumbnails `--r-sm`, cards `--r-md`, hero tiles/art `--r-lg`, chips/buttons `--r-pill` where pill-shaped).
- [ ] **Step 2: Visual** — radii now read as a 3-step scale.
- [ ] **Step 3: Commit** `style(piano): radius token scale`

### Task 21: One card primitive (`PianoTile`) for menu, posters, games

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/PianoTile.jsx`; refactor `PianoMenu.jsx`, `Games.jsx`, the grids to use it.

- [ ] **Step 1:** Build a `PianoTile` that accepts `{ shape: 'card'|'poster'|'square'|'pill', icon, image, label, sublabel, onClick, selected }` and renders the consistent box (reserved aspect, skeleton bg, clamped caption, `:active`/`:focus-visible` states). Replace the four divergent tile markups (menu cards, poster tiles, game text-pills, lecture tiles) with it.
- [ ] **Step 2:** Games stop being variable-width text pills — render `shape="card"` with an icon + label so they match the menu.
- [ ] **Step 3: Update tests** that assert tile class names. Run the Piano test dir.
- [ ] **Step 4: Commit** `refactor(piano): single PianoTile primitive across menu, grids, games`

### Task 22: SVG icon set (replace emoji + mixed glyphs)

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/icons/` (one component per icon, single stroke weight, `currentColor`); replace usages in `PianoMenu.jsx`, `PianoChrome.jsx`, `MusicPlayer.jsx`, `PianoVideoChrome.jsx`, `Studio.jsx`.

- [ ] **Step 1:** The icon set is ALREADY PROVIDED and vaulted at `frontend/src/modules/Piano/PianoKiosk/icons/svg/*.svg` (31 Solar Bold icons, `fill="currentColor"`; see `icons/MANIFEST.md`). Build an `<Icon name="play" />` component in `frontend/src/modules/Piano/PianoKiosk/icons/Icon.jsx` that renders the matching SVG (import via Vite — confirm the project's SVG handling first: check for `vite-plugin-svgr` / `?react` imports, else inline via a `raw` import + `dangerouslySetInnerHTML`, or a static `import.meta.glob('./svg/*.svg', { eager: true })` map). Names match the filenames: `video, music, sheet-music, game, lessons, studio, home, connection, play, pause, previous, next, shuffle, repeat, volume-down, volume-up, queue, back, close, skip-back-15, skip-back-30, skip-forward-15, skip-forward-30, speed, loop-a, loop-b, clear-loop, play-along, record, stop, trash`. Per MANIFEST: overlay the 15/30 numerals as text on the skip icons, and the A/B letters on loop-a/loop-b. Do NOT hand-author icons.
- [ ] **Step 2:** Replace every emoji/Unicode glyph (🎬🎵🎼🎮🎓🎹 ⌂ ‹ ≡ ✕ 🔀🔁🔉🔊 ❚❚ ▶ ⏮ ⏭ ■ ● 🗑) with the matching `<Icon/>`. Keep `aria-label`s.
- [ ] **Step 3: Visual** — one coherent monochrome icon language; no platform emoji; both transport rows share a weight.
- [ ] **Step 4: Update tests** that match on glyph text (e.g. play/pause aria-labels stay; remove any text-content assertions on glyphs).
- [ ] **Step 5: Commit** `style(piano): replace emoji/mixed glyphs with one SVG icon set`

### Task 23: Voice picker → contextual tap-to-cycle (drop the native `<select>`)

**Files:** Modify `PianoChrome.jsx`, `PianoApp.scss`

- [ ] **Step 1:** Replace the `<select>` with a tap-to-cycle button showing the current voice label; tapping advances to the next voice and sends the Program Change. Style as a chunky touch target (no native dropdown).
- [ ] **Step 2:** Only render it where instrument timbre is relevant. Hide it on Videos/Music/SheetMusic routes (pass a `showVoice` flag from `PianoShell` based on the active mode; show on menu/studio/games/lessons).
- [ ] **Step 3: Manual** — voice is a tap target, not an OS dropdown, and absent on passive-media modes.
- [ ] **Step 4: Commit** `style(piano): tap-to-cycle voice control, shown only where relevant`

### Task 24: Shared `PianoBack` + breadcrumb vocabulary

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/PianoBack.jsx`; replace the six ad-hoc back buttons (Music `‹`, AlbumDetail/ScoreViewer `piano-game-fullscreen__back`, CourseDetail `‹ Courses`, etc.).

- [ ] **Step 1:** `PianoBack({ onClick, label })` renders the back icon (Task 22) + a consistent label, never absolutely positioned over content. Use one vocabulary: the back label always names the level you return TO (so the grid titled "Videos" is reached via "‹ Videos", not "‹ Courses").
- [ ] **Step 2:** Replace all back affordances; remove `piano-game-fullscreen__back` reuse outside games. In ScoreViewer, place it in normal flow (not absolute over the first page).
- [ ] **Step 3: Manual** — back controls look identical everywhere, never overlap content, and name levels consistently up and down.
- [ ] **Step 4: Commit** `refactor(piano): shared PianoBack + consistent breadcrumb labels`

---

## Phase 8 — Modes, content, accessibility

### Task 25: Lessons — honest state (no hollow shell behind a content promise)

**Files:** Modify `modes/Lessons/Lessons.jsx`, `PianoMenu.jsx`

- [ ] **Step 1:** Until the notation renderer + theory runners are real, either hide the Lessons tile (remove from `PIANO_MODES`) or relabel its blurb to "Coming soon" and render an explicit "Lessons are coming soon" state instead of an empty `<Notation>` seam.
- [ ] **Step 2: Manual** — tapping Lessons never lands on a broken/empty renderer.
- [ ] **Step 3: Commit** `fix(piano): honest Lessons state until the renderer ships`

### Task 26: Studio delete confirmation

**Files:** Modify `modes/Studio/Studio.jsx`

- [ ] **Step 1:** Gate `onDelete(id)` behind a confirm step (inline "Delete take? ✓ / ✕" on the row, or a small modal). No single-tap irreversible delete.
- [ ] **Step 2: Manual** — deleting a take requires confirmation; titles could also gain a rename affordance (optional follow-up).
- [ ] **Step 3: Commit** `fix(piano): confirm before deleting a studio take`

### Task 27: Responsive / orientation

**Files:** Modify `PianoApp.scss`

- [ ] **Step 1:** Add orientation handling for the menu grid: portrait → `grid-template-columns: repeat(2, …)` (6 tiles as 2×3); landscape → 3×2. Add `@media (orientation: portrait)` blocks for album-detail body (stack cover above tracks) and the transport row (allow wrap).
- [ ] **Step 2: Manual** — rotate the tablet; layouts reflow instead of cramming/clipping.
- [ ] **Step 3: Commit** `style(piano): orientation-aware layouts`

### Task 28: Type scale + secondary-text contrast (AA)

**Files:** Modify `PianoApp.scss`

- [ ] **Step 1:** Add type tokens (`--t-cap: .85rem; --t-body: 1rem; --t-h: 1.25rem; --t-title: 1.6rem; --t-display: 2.2rem`) and apply a sane ramp: mode/page titles ≥ tile labels (fix the inverted hierarchy), control heading margins. `--piano-muted` is already AA on white; ensure no remaining `#999`/`#aaa`/`#bbb` literals on light surfaces (the now-playing stage keeps its light-on-dark muted).
- [ ] **Step 2: Check** contrast with devtools on blurbs, summaries, track nums.
- [ ] **Step 3: Commit** `style(piano): type scale + AA secondary text`

### Task 29: Empty/error states + user-facing copy

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/PianoEmpty.jsx`; use it in every grid.

- [ ] **Step 1:** A shared empty/error component with a skeleton-or-message body. Replace the bare italic placeholders. Rewrite developer-leaking copy: `"No music.collection configured."` → `"No music has been set up yet."` (don't name YAML keys to the end user).
- [ ] **Step 2: Manual** — empty states are consistent and speak to the user, not the config.
- [ ] **Step 3: Commit** `style(piano): shared empty-state with user-facing copy`

### Task 30: Focus-visible, selected state, reduced motion, view transitions

**Files:** Modify `PianoApp.scss`; `PianoTile.jsx`

- [ ] **Step 1:** Add `:focus-visible` rings on all tiles/buttons (visible on light surfaces) and a `.is-selected`/focused state for D-pad/gamepad traversal (project rule: gamepad support mandatory) — especially the Games grid.
- [ ] **Step 2:** Wrap transitions in `@media (prefers-reduced-motion: no-preference)`, and add a subtle crossfade between mode views (optional, behind the same guard).
- [ ] **Step 3: Manual** — keyboard/gamepad focus is always visible; reduced-motion users get no transitions.
- [ ] **Step 4: Commit** `a11y(piano): focus-visible, selected state, reduced-motion`

---

## Self-review checklist (run before execution)

- **Spec coverage vs. audit:** A1 (Task 15 dim supersedes "title always visible" per the dark-room requirement), A2 (T4), A3 (T12+T13), A4/J8 (T14), A5 (T19), A6 (T25), A7 (T26), B1/B3 (T1 palette + T28 type), B2 (T22), B4 (Plexamp wash kept by choice — noted, not a task), C1/J2 (T23), C3 (T14/T27 wrap), D1 (T27), D3 (SCSS done), D4 (T29), E/J4/J5 (T30), F (T9–T11), G1 (T6–T7), G2/G3/G4 (T8), H1 (T2), H2 (T18), I1 (T16), I2 (SCSS done, verified in T8/T16), I3 (T17), I4/J1 (T20–T21), I5 (T28), I6/I7 (T24), J3 (T28), K1 (T2 + T5). **All audit items mapped.**
- **No placeholders:** every code step has real code; verify the lecture-description field (T17) and the `playable` shape before relying on them.
- **Type consistency:** `usePianoList` returns `{ data, loading, error }` everywhere; `useResolvedMediaEl` returns `{ el, timedOut }` (callers updated in T12); `useInactivityReturn` 5th arg `keepAlive`; `usePianoPlayback` exposes `{ playing, setPlaying }`.

---

## Notes & decisions

- **Browse light / media dark** is deliberate (video letterbox, fullscreen games, now-playing music, note-waterfall stay dark). If you want the media stages light too, that's a follow-up — flag before doing it.
- **Phases are independently shippable** and could each be its own PR/branch. Recommended order is as written; Phase 4 (routing) is the largest and is what makes Phases 5–6 fully robust against reloads.
- **Deploy discipline:** after any `frontend/src/modules/Piano/**` change, build + (if clear) deploy per `CLAUDE.local.md`, then reload the relevant kiosk. Never deploy while a fitness session or live video is active.
