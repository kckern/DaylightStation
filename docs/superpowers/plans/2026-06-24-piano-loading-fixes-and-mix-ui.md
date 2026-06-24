# Piano Kiosk — Loading-UX Fixes + Mix-Balance UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the piano kiosk's Courses/content browsing feel fast (cached + progressive cover images, smooth render) and finish wiring the already-built `PianoMixContext` into the UI so the onboard-piano vs. BT-media balance is actually controllable.

**Architecture:** Three independent threads. (A) Cache cover images at the `display` redirect so the browser stops re-fetching them. (B) Give `CourseGrid` per-image lazy-load + blur-in so covers appear progressively instead of all-at-once-or-nothing. (C) Mount the existing `PianoMixContext`, add a shared `MixControls` component, and wire it into the Music and Video players. A separate on-device task addresses the WebView frame-clock keep-alive's gesture gating (see Task A3 — config/verification, not TDD).

**Tech Stack:** React (function components + context), Express (Node ESM), Vitest + @testing-library/react, Jest (backend router tests), SCSS, FKB REST + adb (on-device).

**Context from investigation (2026-06-23/24):**
- Courses *data* is fast (`list.response totalMs:409`); the slowness is (1) the WebView frame-clock stall rendering at ~7fps and (2) covers having **no `Cache-Control`** (302 via `display.mjs` → `externalProxy`) and `CourseGrid` using eager `<img>` with no placeholder.
- The frame-clock stall is fixed by the always-on keep-alive video (`KeepAliveVideo.jsx`, shipped), BUT it is gesture-gated — see `docs/_wip/bugs/2026-06-23-piano-kiosk-jank-paint-bound.md` and `docs/reference/piano/performance.md`.
- `PianoMixContext.jsx` is built + unit-tested (commit on main) but **not mounted and not in any UI**. Its full UI plan already exists at `docs/superpowers/plans/2026-06-23-piano-mix-balance.md` (Tasks 2–7); those player files are unchanged since, so they are restated here.

**Test commands:**
- Frontend: `./node_modules/.bin/vitest run --config vitest.config.mjs <path>`
- Backend router (jest): `npx jest <path>` (display router test lives at `tests/unit/api/routers/display.test.mjs`)

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/4_api/v1/routers/display.mjs` (modify) | Add `Cache-Control` to cover-image redirect + placeholder |
| `tests/unit/api/routers/display.test.mjs` (modify) | Assert the cache header |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.jsx` (create) | One cover tile: lazy `<img>` + blur-in on load |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.test.jsx` (create) | Tile blur-in behavior |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.jsx` (modify) | Use `CourseTile` |
| `frontend/src/Apps/PianoApp.scss` (modify) | Blur-in + skeleton CSS; MixControls layout |
| `frontend/src/Apps/PianoApp.jsx` (modify) | Mount `PianoMixProvider` |
| `frontend/src/modules/Piano/PianoKiosk/MixControls.jsx` (create) | Shared piano/media `−/+` control |
| `frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx` (create) | Control unit tests |
| `frontend/src/modules/Piano/PianoKiosk/modes/Music/MusicPlayer.jsx` (modify) | Use shared `mediaLevel` + MixControls |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx` (modify) | Render MixControls |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx` (modify) | MixControls in chrome |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx` (modify) | Apply `mediaLevel` to the media element |

---

# PART A — Loading / image fixes

## Task A1: Cache cover images at the display redirect

**Files:**
- Modify: `backend/src/4_api/v1/routers/display.mjs:89-97`
- Test: `tests/unit/api/routers/display.test.mjs`

- [ ] **Step 1: Add a failing test assertion**

Open `tests/unit/api/routers/display.test.mjs`, find an existing test that requests a valid display route and gets a redirect (look for `.redirect` / `302` / `location`). Add, in that test after the response is obtained, an assertion that the cache header is set:

```javascript
expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
```

If there is a separate placeholder/SVG test (no thumbnail → SVG), add the same assertion there.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/unit/api/routers/display.test.mjs`
Expected: FAIL — `cache-control` is `undefined`.

- [ ] **Step 3: Set Cache-Control in the handler**

In `display.mjs`, in `handleDisplayRequest`, set the header on both response paths. Change the placeholder block (around line 89-93):

```javascript
    if (!thumbnailUrl) {
      const svg = generatePlaceholderSvg({ type: resolvedSource, title: itemTitle || localId });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(svg);
    }

    // Redirect through proxy (replace external host with proxy path). Covers are
    // immutable per ratingKey, so let the browser cache the mapping (a cold reload
    // otherwise re-resolves every cover — the "no caching" the kiosk felt).
    const proxyUrl = thumbnailUrl.replace(/https?:\/\/[^\/]+/, `/api/v1/proxy/${resolvedSource}`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.redirect(proxyUrl);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest tests/unit/api/routers/display.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/display.mjs tests/unit/api/routers/display.test.mjs
git commit -m "perf(content): Cache-Control on cover-image display redirect (stop re-fetching covers)"
```

---

## Task A2: CourseTile — lazy load + blur-in covers

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (the `.piano-video-grid__tile img` block ~line 419)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseTile from './CourseTile.jsx';

const item = { id: 'plex:1', title: 'Bach', thumbnail: '/api/v1/display/plex/1' };

describe('CourseTile', () => {
  it('renders the cover lazily and un-blurs once it loads', () => {
    render(<CourseTile item={item} onSelect={() => {}} />);
    const img = screen.getByAltText('Bach');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toContain('is-loading'); // blurred until load
    fireEvent.load(img);
    expect(img.className).not.toContain('is-loading');
  });

  it('calls onSelect with the item when tapped', () => {
    const onSelect = vi.fn();
    render(<CourseTile item={item} onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Bach'));
    expect(onSelect).toHaveBeenCalledWith(item);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.test.jsx`
Expected: FAIL — cannot resolve `./CourseTile.jsx`.

- [ ] **Step 3: Create the component**

Create `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.jsx`:

```jsx
import { useState } from 'react';

/**
 * One course/poster tile. The cover loads lazily and starts blurred
 * (`is-loading`); on load it un-blurs and fades in, so covers appear
 * progressively instead of all-at-once. Covers are cached by the display
 * redirect (see display.mjs Cache-Control), so revisits are instant.
 */
export default function CourseTile({ item, onSelect }) {
  const [loaded, setLoaded] = useState(false);
  const src = item.thumbnail || item.image;
  return (
    <li>
      <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)} title={item.title}>
        {src && (
          <img
            src={src}
            alt={item.title}
            loading="lazy"
            decoding="async"
            className={`piano-cover${loaded ? '' : ' is-loading'}`}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        )}
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Use CourseTile in CourseGrid**

In `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.jsx`, add the import after the existing imports:

```jsx
import CourseTile from './CourseTile.jsx';
```

Replace the `<ul>…</ul>` block (the `items.map(...)` with the inline `<li><button><img/></button></li>`) with:

```jsx
        <ul className="piano-video-grid piano-video-grid--posters">
          {items.map((item) => (
            <CourseTile key={item.id} item={item} onSelect={onSelect} />
          ))}
        </ul>
```

- [ ] **Step 6: Add the blur-in CSS**

In `frontend/src/Apps/PianoApp.scss`, replace the `.piano-video-grid--posters .piano-video-grid__tile img` rule (~line 419) with:

```scss
  .piano-video-grid__tile img {
    aspect-ratio: 2 / 3;
    border-radius: var(--r-sm);
    background: rgba(255, 255, 255, 0.04); // skeleton tint behind a not-yet-loaded cover
  }
  .piano-cover {
    opacity: 1;
    filter: blur(0);
    transition: opacity 240ms ease, filter 240ms ease;
    &.is-loading { opacity: 0.35; filter: blur(8px); }
  }
```

- [ ] **Step 7: Verify the Videos suite still passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseTile.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): course covers lazy-load + blur-in (progressive, not all-or-nothing)"
```

---

## Task A3: Keep-alive gesture gating + reload re-stall (ON-DEVICE — not TDD)

> **Do this task in the main session, not a code subagent — it is on-device config/diagnosis.**
> The keep-alive video (`KeepAliveVideo.jsx`) fixes the frame-clock stall but only after the first
> user gesture (WebView gates muted autoplay), and the SPA was observed fully reloading
> (`keepalive.mounted` twice in 4 min), which re-stalls each time. Loading UX renders at ~7fps until
> the video plays. Goal: keep-alive plays from load without a gesture, and persists.

- [ ] **Step 1: Try gestureless autoplay via FKB setting, then verify**

The piano tablet is reachable as `adb -s 10.0.0.245:5555` **from inside the daylight-station
container**. Set FKB's media-gesture/autoplay flags and restart FKB:

```bash
node cli/fkb.cli.mjs set autoplayVideos true
node cli/fkb.cli.mjs set webviewMixedContent 0   # (only if present; harmless skip otherwise)
```

Then reload the kiosk to `/piano/test/scroller` WITHOUT sending any tap, and read GPU busy:
```bash
sudo docker exec daylight-station sh -c 'adb -s 10.0.0.245:5555 shell cat /sys/class/kgsl/kgsl-3d0/gpu_busy_percentage'
```
Expected if gestureless works: busy > 40% with no tap (keep-alive auto-played). If still 0%,
gestureless autoplay is not achievable via FKB settings on this WebView — proceed to Step 2.

- [ ] **Step 2: Identify why the SPA fully reloads (re-stalls)**

```bash
sudo docker logs --since 600s daylight-station 2>&1 | grep -oE '"event":"[^"]*(reload|reset|reconnect|connect-gate|midi.statechange)[^"]*"' | sort | uniq -c
```
Inspect `useReloadGuard.js` and the ConnectGate (`PianoApp.jsx`) for reloads on MIDI
disconnect/reconnect flaps (the BLE-MIDI "WIDI Master" flaps). If the gate or a guard triggers a
full `window.location.reload()` on transient MIDI disconnects, debounce it (e.g. require the
disconnect to persist >5s before reacting) so a 1-second BLE flap does not remount the app.

- [ ] **Step 3: Confirm the fix holds**

After Step 1 and/or Step 2, load `/piano`, send ONE tap, then navigate Courses → a game and back.
Confirm via `docker logs` that `piano.watchdog.jank-start` does NOT recur and `gpu_busy_percentage`
stays > 40% across the navigations (keep-alive persisted). Record findings in
`docs/_wip/bugs/2026-06-23-piano-kiosk-jank-paint-bound.md`.

- [ ] **Step 4: Commit any code change (e.g. reload debounce)**

```bash
git add -A && git commit -m "fix(piano): debounce MIDI-disconnect reload so keep-alive persists (no re-stall)"
```

---

# PART B — Mix-balance UI (finish wiring `PianoMixContext`)

`PianoMixContext.jsx` already exists (`pianoLevel`/`mediaLevel`, persisted, CC7 to the Suzuki). It
is not mounted and not in any UI. These tasks mount it and add the controls. Spec:
`docs/superpowers/specs/2026-06-23-piano-mix-balance-design.md`.

## Task B1: Mount PianoMixProvider in PianoApp

**Files:**
- Modify: `frontend/src/Apps/PianoApp.jsx`

- [ ] **Step 1: Add the import**

After the `KeepAliveVideo` import line, add:

```jsx
import { PianoMixProvider } from '../modules/Piano/PianoKiosk/PianoMixContext.jsx';
```

- [ ] **Step 2: Wrap the shell (inside PianoPlaybackProvider, so it has usePianoMidi + playback)**

In `ActivePiano`, find:

```jsx
          <PianoPlaybackProvider>
            <PianoWakeLockProvider>
              <PianoShell />
            </PianoWakeLockProvider>
          </PianoPlaybackProvider>
```

Replace with:

```jsx
          <PianoPlaybackProvider>
            <PianoMixProvider>
              <PianoWakeLockProvider>
                <PianoShell />
              </PianoWakeLockProvider>
            </PianoMixProvider>
          </PianoPlaybackProvider>
```

- [ ] **Step 3: Verify the Piano suite still passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/PianoApp.jsx
git commit -m "feat(piano): mount PianoMixProvider in the kiosk shell"
```

---

## Task B2: MixControls component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/MixControls.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MixControls from './MixControls.jsx';

const base = { pianoLevel: 0.8, mediaLevel: 0.5, onPiano: vi.fn(), onMedia: vi.fn() };

describe('MixControls', () => {
  it('renders piano and media percentages', () => {
    render(<MixControls {...base} />);
    expect(screen.getByText('80')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
  });
  it('fires a negative delta on piano down and positive on piano up', () => {
    const onPiano = vi.fn();
    render(<MixControls {...base} onPiano={onPiano} />);
    fireEvent.click(screen.getByLabelText('Piano volume down'));
    fireEvent.click(screen.getByLabelText('Piano volume up'));
    expect(onPiano).toHaveBeenCalledWith(-0.1);
    expect(onPiano).toHaveBeenCalledWith(0.1);
  });
  it('fires deltas on media down/up', () => {
    const onMedia = vi.fn();
    render(<MixControls {...base} onMedia={onMedia} />);
    fireEvent.click(screen.getByLabelText('Media volume down'));
    fireEvent.click(screen.getByLabelText('Media volume up'));
    expect(onMedia).toHaveBeenCalledWith(-0.1);
    expect(onMedia).toHaveBeenCalledWith(0.1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx`
Expected: FAIL — cannot resolve `./MixControls.jsx`.

- [ ] **Step 3: Create the component**

Create `frontend/src/modules/Piano/PianoKiosk/MixControls.jsx`:

```jsx
import Icon from './icons/Icon.jsx';

/**
 * Presentational balance control: a piano −/+ cluster and a media −/+ cluster.
 * Pure — handlers (which clamp/persist via PianoMix) are wired by the host.
 * `onPiano`/`onMedia` receive a signed delta. `btnClass` lets each host reuse
 * its existing button style so the control inherits the surrounding chrome.
 */
const STEP = 0.1;
const pct = (v) => `${Math.round((v ?? 0) * 100)}`;

export default function MixControls({ pianoLevel, mediaLevel, onPiano, onMedia, btnClass = 'piano-mix__btn' }) {
  return (
    <div className="piano-mix">
      <div className="piano-mix__cluster">
        <Icon name="piano" className="piano-mix__lead" label="Piano" />
        <button type="button" className={btnClass} onClick={() => onPiano(-STEP)} aria-label="Piano volume down"><Icon name="volume-down" /></button>
        <span className="piano-mix__val">{pct(pianoLevel)}</span>
        <button type="button" className={btnClass} onClick={() => onPiano(STEP)} aria-label="Piano volume up"><Icon name="volume-up" /></button>
      </div>
      <div className="piano-mix__cluster">
        <Icon name="music" className="piano-mix__lead" label="Media" />
        <button type="button" className={btnClass} onClick={() => onMedia(-STEP)} aria-label="Media volume down"><Icon name="volume-down" /></button>
        <span className="piano-mix__val">{pct(mediaLevel)}</span>
        <button type="button" className={btnClass} onClick={() => onMedia(STEP)} aria-label="Media volume up"><Icon name="volume-up" /></button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/MixControls.jsx frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx
git commit -m "feat(piano): MixControls — shared piano/media volume clusters"
```

---

## Task B3: MusicPlayer uses shared mediaLevel + MixControls

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Music/MusicPlayer.jsx`

- [ ] **Step 1: Add imports**

After the `Icon` import (line 11), add:

```jsx
import { usePianoMix } from '../../PianoMixContext.jsx';
import MixControls from '../../MixControls.jsx';
```

- [ ] **Step 2: Consume the mix context; drop local volume state**

After `const kb = config?.keyboard ...` (~line 27), add:

```jsx
  const { mediaLevel, setMediaLevel, pianoLevel, setPianoLevel } = usePianoMix();
```

Delete the local volume state line (`const [vol, setVol] = useState(1);`, ~line 56).

- [ ] **Step 3: Apply mediaLevel to the audio element**

Replace the volume effect (`useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);`, ~line 75) with:

```jsx
  useEffect(() => { if (audioRef.current) audioRef.current.volume = mediaLevel; }, [mediaLevel]);
```

- [ ] **Step 4: Remove the old changeVol handler**

Delete the line `const changeVol = (d) => { setVol((v) => Math.max(0, Math.min(1, Math.round((v + d) * 10) / 10))); reveal(); };` (~line 128).

- [ ] **Step 5: Replace the volume markup with MixControls**

Replace the `<div className="piano-music-player__volume">…</div>` block (~lines 180-184) with:

```jsx
          <MixControls
            pianoLevel={pianoLevel}
            mediaLevel={mediaLevel}
            onPiano={(d) => { setPianoLevel(pianoLevel + d); reveal(); }}
            onMedia={(d) => { setMediaLevel(mediaLevel + d); reveal(); }}
            btnClass="piano-music-btn"
          />
```

- [ ] **Step 6: Verify the Music suite still passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Music/`
Expected: PASS. (With no provider in the test tree, `usePianoMix` returns the FALLBACK — levels 1, no-op setters — so it renders fine.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Music/MusicPlayer.jsx
git commit -m "feat(piano): Music player uses shared media level + MixControls balance"
```

---

## Task B4: PianoVideoChrome renders MixControls

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`

- [ ] **Step 1: Write the failing test**

In `PianoVideoChrome.test.jsx`, add a mock for the mix context after the imports (after line 4):

```jsx
const mix = vi.hoisted(() => ({
  pianoLevel: 0.8, mediaLevel: 0.5, setPianoLevel: vi.fn(), setMediaLevel: vi.fn(),
}));
vi.mock('../../PianoMixContext.jsx', () => ({ usePianoMix: () => mix }));
```

Add this describe block at the end of the file:

```jsx
describe('PianoVideoChrome — mix balance', () => {
  it('drives the piano level down/up from the mix context', () => {
    mix.setPianoLevel.mockReset();
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Piano volume down'));
    fireEvent.click(screen.getByLabelText('Piano volume up'));
    expect(mix.setPianoLevel).toHaveBeenCalledTimes(2);
  });
  it('drives the media level down/up from the mix context', () => {
    mix.setMediaLevel.mockReset();
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Media volume down'));
    fireEvent.click(screen.getByLabelText('Media volume up'));
    expect(mix.setMediaLevel).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`
Expected: FAIL — `Unable to find a label 'Piano volume down'`.

- [ ] **Step 3: Add imports + render MixControls**

In `PianoVideoChrome.jsx`, after the `Icon` import (line 3), add:

```jsx
import { usePianoMix } from '../../PianoMixContext.jsx';
import MixControls from '../../MixControls.jsx';
```

Inside the component body, after `const barRef = useRef(null);` (~line 20), add:

```jsx
  const { pianoLevel, mediaLevel, setPianoLevel, setMediaLevel } = usePianoMix();
```

Insert this just before the play-along `<button ...>` at the end of the row (before line 56's play-along button):

```jsx
        <MixControls
          pianoLevel={pianoLevel}
          mediaLevel={mediaLevel}
          onPiano={(d) => setPianoLevel(pianoLevel + d)}
          onMedia={(d) => setMediaLevel(mediaLevel + d)}
          btnClass="piano-video-chrome__btn"
        />
        <div className="piano-video-chrome__spacer" />
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`
Expected: PASS (original tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
git commit -m "feat(piano): video chrome renders MixControls balance"
```

---

## Task B5: PianoVideoPlayer applies mediaLevel to the media element

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`

- [ ] **Step 1: Add the import**

After the `usePianoPlayback` import (line 6), add:

```jsx
import { usePianoMix } from '../../PianoMixContext.jsx';
```

- [ ] **Step 2: Read mediaLevel and apply it to the resolved element**

After the `usePianoMidi` line (line 29, `const { activeNotes, pressNote, releaseNote } = usePianoMidi();`), add:

```jsx
  const { mediaLevel } = usePianoMix();
```

After the existing effect that mirrors media-element state ends (the closing `}, [mediaEl]);` ~line 129), add:

```jsx
  // Apply the shared media level to the resolved element (mirrors MusicPlayer).
  useEffect(() => { if (mediaEl) mediaEl.volume = mediaLevel; }, [mediaEl, mediaLevel]);
```

- [ ] **Step 3: Verify the Videos suite passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx
git commit -m "feat(piano): video player applies shared media level to its element"
```

---

## Task B6: MixControls styling

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss`

- [ ] **Step 1: Append the layout rules**

At the end of `frontend/src/Apps/PianoApp.scss`, add:

```scss
// Shared piano/media balance control (MixControls). Buttons inherit the host
// chrome's button style via `btnClass`; these rules only lay out the clusters.
.piano-mix {
  display: flex;
  align-items: center;
  gap: 1.5rem;

  &__cluster { display: flex; align-items: center; gap: 0.25rem; }
  &__lead { opacity: 0.7; }
  &__val {
    min-width: 2.5rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--piano-stage-muted);
  }
}
```

- [ ] **Step 2: Build the frontend to confirm SCSS compiles**

Run: `cd frontend && npm run build` (from the frontend dir). Expected: exit 0, no SCSS errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "style(piano): layout for the MixControls balance clusters"
```

---

# PART C — Ship & verify

## Task C1: Build, deploy, reload kiosk, verify

**Files:** none (deploy + on-device verification).

- [ ] **Step 1: Full Piano + display suites green**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/
npx jest tests/unit/api/routers/display.test.mjs
```
Expected: PASS.

- [ ] **Step 2: Build + deploy (confirm garage idle first)**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 3: Reload the piano kiosk and verify**

Reload FKB on the piano tablet. Then on `/piano`:
- Open **Courses** — covers blur-in progressively; a second visit is instant (browser-cached, confirm the cover request returns `304`/from cache).
- Open **Music** and a **Video** — each now-playing chrome shows the **🎹 piano −/+** and **🔊 media −/+** clusters; lowering the piano cluster attenuates the onboard Suzuki (CC7) without changing the track; lowering media does the inverse.
- Confirm `piano.mix.*` and the cover-cache behavior in `docker logs`.

---

## Done when

- Course covers are browser-cached (`Cache-Control` on the display redirect) and appear progressively (lazy + blur-in), not all-at-once.
- The keep-alive engages reliably (Task A3 outcome recorded) so the loading UX renders at full speed.
- Music and Video now-playing chrome each carry a piano `−/+` and media `−/+` balance; piano uses CC7, media uses element volume; both persist; physical slider stays master.
