# Fitness Session Recap Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface each workout's already-generated silent timelapse recap MP4 when reviewing sessions on the Fitness home — a "has recap" chip in the session list, and in-slot + full-frame playback in the session detail.

**Architecture:** The full session JSON already serializes `timelapse: { status, videoPath, … }`, and the recap MP4 is already served with byte-range support at `/api/v1/proxy/media/video/fitness/<slug>.mp4`. So the detail view needs no backend change — it reads `sessionData.timelapse` and plays the recap in the existing 16:9 `session-detail__thumb` slot (no crop), with a corner chip that opens a full-frame overlay. The only backend change is adding a lightweight `hasVideo` boolean to the list summary (and bumping the index version) so the list can badge recap-bearing sessions without loading each full file.

**Tech Stack:** Node.js ES modules (backend, `node:test`), React + Mantine + SCSS (frontend, `vitest` + happy-dom), plain HTML5 `<video>` (no Player/DASH, no GIF).

## Global Constraints

- **Recaps are silent** (H.264, `-an`) — muted autoplay is always safe; never add audio controls.
- **Raw HTML5 `<video>` only** — never route recap playback through `lib/Player/` (Plex/DASH/MSE) or a GIF sidecar.
- **Garage kiosk display is jank-prone** — no video decode during list scrubbing; gate in-slot playback behind a settle delay and `prefers-reduced-motion`; `preload="metadata"`.
- **Recap URL** is always built with `DaylightMediaPath(timelapse.videoPath)` (rewrites `media/…` → `/api/v1/proxy/media/…`). Never hand-build the path.
- **Recap gating** is always `timelapse?.status === 'ready' && !!timelapse?.videoPath`. `processing | failed | skipped | absent` never plays.
- Frontend alias `@` → `frontend/src`. Backend colocated tests use `node:test` + `node:assert/strict` and run via `node --test <file>`. Frontend colocated tests use `vitest` and run via `frontend/node_modules/.bin/vitest run --config vitest.config.mjs <file>`.

---

## File Structure

- **Backend**
  - Modify: `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` — export `deriveHasVideo(data)`, add `hasVideo` to the `findByDate` summary, bump `INDEX_VERSION` 2→3.
  - Test: `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.test.mjs` — add `deriveHasVideo` cases.
- **Frontend — list**
  - Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx` — add `RecapChip` + render it on `s.hasVideo`.
  - Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.scss` — chip styles; ensure `.session-row__top` is `position: relative`.
  - Test: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/RecapChip.test.jsx`.
- **Frontend — detail**
  - Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapVideo.js` — `deriveRecap(timelapse)`.
  - Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapPlayback.js` — `shouldPlayRecap(...)` + `useSettledRecapPlay(...)`.
  - Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/RecapOverlay.jsx` + `RecapOverlay.scss`.
  - Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx` — wire recap into the header memo, thumb slot, and overlay mount.
  - Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.scss` — thumb-video / expand-chip / processing-hint styles.
  - Test: `recapVideo.test.js`, `recapPlayback.test.js`, `RecapOverlay.test.jsx` (all colocated).

---

### Task 1: Backend `hasVideo` on the list summary

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` (INDEX_VERSION line 38; `findByDate` summary `sessions.push({…})` at line 479–494; add exported helper near `synthesizeRosterFromParticipants`)
- Test: `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.test.mjs`

**Interfaces:**
- Produces: `export function deriveHasVideo(data): boolean` — true iff `data.timelapse.status === 'ready'` and `data.timelapse.videoPath` is truthy. Adds `hasVideo: boolean` to each object returned by `findByDate` (consumed by Task 2 as `session.hasVideo`).

- [ ] **Step 1: Write the failing test**

Edit the existing import line at the top of `YamlSessionDatastore.test.mjs`:

```js
import { synthesizeRosterFromParticipants, deriveHasVideo } from './YamlSessionDatastore.mjs';
```

Append these tests to the end of the file:

```js
test('deriveHasVideo: true only when timelapse is ready with a videoPath', () => {
  assert.equal(
    deriveHasVideo({ timelapse: { status: 'ready', videoPath: 'media/video/fitness/x.mp4' } }),
    true
  );
});

test('deriveHasVideo: false for processing/failed/skipped or missing videoPath', () => {
  assert.equal(deriveHasVideo({ timelapse: { status: 'processing' } }), false);
  assert.equal(deriveHasVideo({ timelapse: { status: 'failed', error: 'x' } }), false);
  assert.equal(deriveHasVideo({ timelapse: { status: 'skipped', reason: 'x' } }), false);
  assert.equal(deriveHasVideo({ timelapse: { status: 'ready' } }), false); // no videoPath
});

test('deriveHasVideo: false when no timelapse block at all', () => {
  assert.equal(deriveHasVideo({}), false);
  assert.equal(deriveHasVideo(null), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.test.mjs`
Expected: FAIL — `deriveHasVideo` is not exported (`SyntaxError` / `deriveHasVideo is not a function`).

- [ ] **Step 3: Write the helper**

In `YamlSessionDatastore.mjs`, add this exported function next to the other module-level helper `synthesizeRosterFromParticipants` (search for `export function synthesizeRosterFromParticipants`):

```js
/**
 * True iff a persisted session doc has a finished, playable timelapse recap.
 * Powers the lightweight `hasVideo` flag on the list summary so the Fitness home
 * can badge recap-bearing sessions without loading each full session file.
 * @param {object|null|undefined} data - parsed session YAML doc
 * @returns {boolean}
 */
export function deriveHasVideo(data) {
  return data?.timelapse?.status === 'ready' && !!data?.timelapse?.videoPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.test.mjs`
Expected: PASS — all `deriveHasVideo` tests green (plus the 3 pre-existing roster tests).

- [ ] **Step 5: Wire `hasVideo` into the summary + bump index version**

In `findByDate`, add `hasVideo` to the `sessions.push({…})` object (currently lines 479–494) — add it right after `stravaNotes,`:

```js
        voiceMemos,
        stravaNotes,
        hasVideo: deriveHasVideo(data),
      });
```

Bump the index version (line 38) so cached shards rebuild with the new field:

```js
const INDEX_VERSION = 3; // v3: list summary carries hasVideo (recap badge)
```

- [ ] **Step 6: Run the datastore test again (still green) + confirm nothing else broke**

Run: `node --test backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs \
        backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.test.mjs
git commit -m "feat(fitness): add hasVideo to session list summary

Derive a lightweight hasVideo boolean (timelapse ready + videoPath) on the
findByDate summary so the Fitness home can badge sessions that have a recap.
Bump INDEX_VERSION 2->3 so cached index shards rebuild with the new field.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: List — recap chip on the poster corner

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/RecapChip.jsx` (own file so the test imports it without loading the whole widget + its providers)
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx` (import `RecapChip`; render inside `.session-row__top` after the poster ternary, before `<div className="session-row__info">` at line 175)
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.scss` (`.session-row__top` rule at line 87; add chip rule)
- Test: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/RecapChip.test.jsx`

**Interfaces:**
- Consumes: `session.hasVideo` (from Task 1).
- Produces: `export default function RecapChip({ size?: number }): JSX` — a self-contained filled play-triangle chip; used only within this widget.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/RecapChip.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RecapChip from './RecapChip.jsx';

describe('RecapChip', () => {
  it('renders an svg play-triangle chip', () => {
    const { container } = render(<RecapChip />);
    const chip = container.querySelector('.session-row__recap-chip');
    expect(chip).toBeTruthy();
    expect(chip.querySelector('svg')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/RecapChip.test.jsx`
Expected: FAIL — cannot resolve `./RecapChip.jsx`.

- [ ] **Step 3: Add the `RecapChip` component**

Create `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/RecapChip.jsx`:

```jsx
import React from 'react';

/**
 * "Session has a recap video" marker — a filled play-triangle chip pinned to the
 * poster corner. Purely informational (pointer-events: none in SCSS); the row
 * click still selects the session. Sized to read at TV distance (2-4m).
 * @param {{ size?: number }} props
 */
export default function RecapChip({ size = 26 }) {
  return (
    <div className="session-row__recap-chip" title="Has recap video" aria-label="Has recap video">
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none">
        <path d="M5 3.5v9l7-4.5-7-4.5z" fill="#fff" />
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/RecapChip.test.jsx`
Expected: PASS.

- [ ] **Step 5: Import and render the chip on rows with a recap**

In `FitnessSessionsWidget.jsx`, add the import near the other imports at the top of the file:

```jsx
import RecapChip from './RecapChip.jsx';
```

Then, inside `.session-row__top`, add the chip immediately after the closing `)}` of the poster-variant ternary and immediately before `<div className="session-row__info">` (line 175):

```jsx
                    )}

                    {s.hasVideo && <RecapChip />}

                    <div className="session-row__info">
```

- [ ] **Step 6: Style the chip + ensure the top row anchors it**

In `FitnessSessionsWidget.scss`, add `position: relative;` to the base `.session-row__top` rule (line 87) so the absolutely-positioned chip anchors to the poster corner:

```scss
.session-row__top {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem;
  min-height: 60px;
}
```

Then add the chip rule (place it after the `.session-poster` block, near line 140):

```scss
// Recap-available chip — filled pill on the poster's top-left corner. Sized to
// read at TV distance (2-4m), matching the coin/duration filled-badge treatment.
.session-row__recap-chip {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.62);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 2px; // optically center the triangle
  pointer-events: none;
}
```

- [ ] **Step 7: Run the widget's existing tests to confirm no regression**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/`
Expected: PASS (RecapChip test + any pre-existing `sessionDisplay.test.js`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/RecapChip.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/RecapChip.test.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.scss
git commit -m "feat(fitness): recap-available chip on session list rows

Filled play-triangle chip on the poster corner for sessions whose summary
carries hasVideo. Legible at TV distance; not gated on the participant row.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Detail — play the recap in the existing 16:9 thumb slot

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapVideo.js`
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapPlayback.js`
- Test: `recapVideo.test.js`, `recapPlayback.test.js` (colocated)
- Modify: `FitnessSessionDetailWidget.jsx` (imports; header memo return at lines ~239–260; hook + state near lines 129–140; thumb slot at lines 387–424)
- Modify: `FitnessSessionDetailWidget.scss` (thumb block near line 50)

**Interfaces:**
- Consumes: `sessionData.timelapse` (already fetched); `header.thumbUrl` (existing episode-still URL).
- Produces:
  - `deriveRecap(timelapse) → { ready: boolean, processing: boolean, url: string|null }`
  - `shouldPlayRecap({ enabled: boolean, prefersReducedMotion: boolean }) → boolean`
  - `useSettledRecapPlay({ enabled: boolean, delayMs?: number }) → { videoRef, playing }`
  - Header memo gains `recapUrl`, `hasRecap`, `recapProcessing`. Task 4 consumes `header.recapUrl` and the `recapOpen`/`setRecapOpen` state added here.

- [ ] **Step 1: Write the failing test for `deriveRecap`**

Create `recapVideo.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { deriveRecap } from './recapVideo.js';

describe('deriveRecap', () => {
  it('ready with a url when status ready + videoPath', () => {
    const r = deriveRecap({ status: 'ready', videoPath: 'media/video/fitness/x.mp4' });
    expect(r.ready).toBe(true);
    expect(r.processing).toBe(false);
    expect(r.url).toContain('video/fitness/x.mp4');
  });
  it('processing flag with no url', () => {
    const r = deriveRecap({ status: 'processing' });
    expect(r.ready).toBe(false);
    expect(r.processing).toBe(true);
    expect(r.url).toBe(null);
  });
  it('failed/skipped/ready-without-path/absent → not ready, no url', () => {
    for (const t of [{ status: 'failed' }, { status: 'skipped' }, { status: 'ready' }, null, undefined]) {
      const r = deriveRecap(t);
      expect(r.ready).toBe(false);
      expect(r.url).toBe(null);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapVideo.test.js`
Expected: FAIL — cannot resolve `./recapVideo.js`.

- [ ] **Step 3: Implement `deriveRecap`**

Create `recapVideo.js`:

```js
import { DaylightMediaPath } from '@/lib/api.mjs';

/**
 * Interpret a session's `timelapse` block for the detail UI. The recap is a
 * silent H.264 MP4 served with byte-range support; the URL is built via
 * DaylightMediaPath (rewrites `media/…` → `/api/v1/proxy/media/…`).
 * @param {object|null|undefined} timelapse - session.timelapse
 * @returns {{ ready: boolean, processing: boolean, url: string|null }}
 */
export function deriveRecap(timelapse) {
  const ready = timelapse?.status === 'ready' && !!timelapse?.videoPath;
  return {
    ready,
    processing: timelapse?.status === 'processing',
    url: ready ? DaylightMediaPath(timelapse.videoPath) : null,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapVideo.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `shouldPlayRecap`**

Create `recapPlayback.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { shouldPlayRecap } from './recapPlayback.js';

describe('shouldPlayRecap', () => {
  it('plays when enabled and motion is allowed', () => {
    expect(shouldPlayRecap({ enabled: true, prefersReducedMotion: false })).toBe(true);
  });
  it('never plays under prefers-reduced-motion', () => {
    expect(shouldPlayRecap({ enabled: true, prefersReducedMotion: true })).toBe(false);
  });
  it('never plays when disabled', () => {
    expect(shouldPlayRecap({ enabled: false, prefersReducedMotion: false })).toBe(false);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapPlayback.test.js`
Expected: FAIL — cannot resolve `./recapPlayback.js`.

- [ ] **Step 7: Implement `recapPlayback.js`**

Create `recapPlayback.js`:

```js
import { useEffect, useRef, useState } from 'react';

/**
 * Pure decision: should the in-slot recap loop play right now?
 * @param {{ enabled: boolean, prefersReducedMotion: boolean }} o
 * @returns {boolean}
 */
export function shouldPlayRecap({ enabled, prefersReducedMotion }) {
  return !!enabled && !prefersReducedMotion;
}

/**
 * Gate in-slot recap playback: play only after the selection settles (so tapping
 * down the session list doesn't strobe restarting loops) and never under
 * prefers-reduced-motion. Attach the returned ref to the <video>.
 * @param {{ enabled: boolean, delayMs?: number }} opts
 * @returns {{ videoRef: import('react').RefObject<HTMLVideoElement>, playing: boolean }}
 */
export function useSettledRecapPlay({ enabled, delayMs = 400 }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlaying(false);
    const prefersReducedMotion = typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!shouldPlayRecap({ enabled, prefersReducedMotion })) return undefined;
    const t = setTimeout(() => setPlaying(true), delayMs);
    return () => clearTimeout(t);
  }, [enabled, delayMs]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) el.play?.().catch(() => {});
    else el.pause?.();
  }, [playing]);

  return { videoRef, playing };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapPlayback.test.js`
Expected: PASS.

- [ ] **Step 9: Wire recap data into the detail header memo**

In `FitnessSessionDetailWidget.jsx`, add imports near the top (with the other local imports around line 16):

```jsx
import { deriveRecap } from './recapVideo.js';
import { useSettledRecapPlay } from './recapPlayback.js';
```

Inside the `header` useMemo, just before the `return {` (around line 239), compute:

```jsx
    const recap = deriveRecap(sessionData.timelapse);
```

Add these three fields to the returned object (next to `thumbUrl` / `description`):

```jsx
      recapUrl: recap.url,
      hasRecap: recap.ready,
      recapProcessing: recap.processing,
```

- [ ] **Step 10: Add the playback hook + overlay state (unconditional, before early returns)**

Immediately after the `header` useMemo (before the `if (loading)` block near line 262), add:

```jsx
  const { videoRef: recapVideoRef } = useSettledRecapPlay({ enabled: !!header?.hasRecap });
  const [recapOpen, setRecapOpen] = useState(false);
```

- [ ] **Step 11: Swap the thumb-slot content to the recap when ready**

In the render, change the thumb-slot outer condition (line 387) from:

```jsx
        {header?.thumbUrl ? (
          <div className="session-detail__thumb">
            <img
              src={header.thumbUrl}
              alt=""
              onError={(e) => { e.target.style.display = 'none'; }}
            />
```

to (widen the condition so a recap shows even when there is no episode still, and render `<video>` when a recap is ready — the close/delete/memo buttons and thumb-desc below it are unchanged):

```jsx
        {(header?.thumbUrl || header?.hasRecap) ? (
          <div className="session-detail__thumb">
            {header?.hasRecap ? (
              <>
                <video
                  ref={recapVideoRef}
                  className="session-detail__thumb-video"
                  src={header.recapUrl}
                  poster={header.thumbUrl || undefined}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                />
                <button
                  className="session-detail__recap-expand"
                  onPointerDown={(e) => { e.preventDefault(); setRecapOpen(true); }}
                  title="Watch recap"
                  aria-label="Watch session recap"
                >{'▶'}</button>
              </>
            ) : (
              <img
                src={header.thumbUrl}
                alt=""
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            {header?.recapProcessing && !header?.hasRecap && (
              <div className="session-detail__recap-processing">Recap rendering…</div>
            )}
```

Leave the rest of that `<div className="session-detail__thumb">` block (the close/delete/add-memo buttons, session-id `<code>`, and `thumb-desc`) exactly as-is.

- [ ] **Step 12: Style the recap video, expand chip, and processing hint**

In `FitnessSessionDetailWidget.scss`, extend the `&__thumb` area (near line 50). Add these rules inside the `.session-detail` block (alongside the existing `&__thumb`):

```scss
  &__thumb-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover; // 16:9 source in a 16:9 box → no crop
    background: #000;
  }

  &__recap-expand {
    position: absolute;
    left: 6px;
    bottom: 6px;
    z-index: 3;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 1.1rem;
    line-height: 1;
    padding-left: 3px; // optically center the triangle
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover { background: rgba(0, 0, 0, 0.8); }
  }

  &__recap-processing {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 3;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.55);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.62rem;
    letter-spacing: 0.02em;
  }
```

- [ ] **Step 13: Run the detail widget's existing tests (no regression)**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/`
Expected: PASS — the new `recapVideo` / `recapPlayback` tests plus the pre-existing `FitnessSessionDetailWidget.refresh.test.jsx` and `sessionDetailUtils.test.js`.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapVideo.js \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapVideo.test.js \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapPlayback.js \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/recapPlayback.test.js \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.scss
git commit -m "feat(fitness): play session recap in the detail thumb slot

Swap the 16:9 thumb still for the recap <video> when timelapse is ready
(episode still as poster, no crop). In-slot loop is settle-gated and
suppressed under prefers-reduced-motion; a corner chip will open a
full-frame overlay (next task). Processing sessions show a subtle hint.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Detail — full-frame recap overlay

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/RecapOverlay.jsx`
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/RecapOverlay.scss`
- Test: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/RecapOverlay.test.jsx`
- Modify: `FitnessSessionDetailWidget.jsx` (import; mount overlay before the closing `</div>` of `.session-detail` at line ~511)

**Interfaces:**
- Consumes: `header.recapUrl` and `recapOpen` / `setRecapOpen` (from Task 3).
- Produces: `export default function RecapOverlay({ src: string, onClose: () => void }): JSX`.

- [ ] **Step 1: Write the failing test**

Create `RecapOverlay.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import RecapOverlay from './RecapOverlay.jsx';

describe('RecapOverlay', () => {
  it('renders a video with the given src', () => {
    const { container } = render(
      <RecapOverlay src="/api/v1/proxy/media/video/fitness/x.mp4" onClose={() => {}} />
    );
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toContain('video/fitness/x.mp4');
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<RecapOverlay src="x.mp4" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop tap but not on the video itself', () => {
    const onClose = vi.fn();
    const { container } = render(<RecapOverlay src="x.mp4" onClose={onClose} />);
    fireEvent.pointerDown(container.querySelector('.recap-overlay__video'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(container.querySelector('.recap-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/RecapOverlay.test.jsx`
Expected: FAIL — cannot resolve `./RecapOverlay.jsx`.

- [ ] **Step 3: Implement `RecapOverlay.jsx`**

```jsx
import React, { useEffect } from 'react';
import './RecapOverlay.scss';

/**
 * Full-frame, silent, looping playback of a session recap MP4 over the Fitness
 * UI. Muted autoplay is safe (recaps have no audio track). object-fit: contain
 * shows the whole 16:9 frame uncropped. Closes on Escape or a backdrop tap.
 * @param {{ src: string, onClose: () => void }} props
 */
export default function RecapOverlay({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="recap-overlay"
      role="dialog"
      aria-label="Session recap"
      onPointerDown={onClose}
    >
      <video
        className="recap-overlay__video"
        src={src}
        muted
        autoPlay
        loop
        playsInline
        onPointerDown={(e) => e.stopPropagation()}
      />
      <button
        className="recap-overlay__close"
        onPointerDown={(e) => { e.stopPropagation(); onClose?.(); }}
        aria-label="Close recap"
      >{'×'}</button>
    </div>
  );
}
```

- [ ] **Step 4: Add `RecapOverlay.scss`**

```scss
.recap-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);

  &__video {
    max-width: 96vw;
    max-height: 92vh;
    width: auto;
    height: auto;
    object-fit: contain; // whole 16:9 frame, uncropped
    background: #000;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
  }

  &__close {
    position: absolute;
    top: 20px;
    right: 24px;
    width: 48px;
    height: 48px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: rgba(255, 255, 255, 0.9);
    font-size: 1.8rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover { background: rgba(0, 0, 0, 0.75); }
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/RecapOverlay.test.jsx`
Expected: PASS.

- [ ] **Step 6: Mount the overlay in the detail widget**

In `FitnessSessionDetailWidget.jsx`, add the import near the other local imports (~line 16):

```jsx
import RecapOverlay from './RecapOverlay.jsx';
```

Mount it just before the closing `</div>` of the root `<div className="session-detail">` (the `</div>` right above the `);` at line ~511):

```jsx
      {recapOpen && header?.recapUrl && (
        <RecapOverlay src={header.recapUrl} onClose={() => setRecapOpen(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run the whole detail widget test dir (no regression)**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/`
Expected: PASS — RecapOverlay + recapVideo + recapPlayback + pre-existing suites.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/RecapOverlay.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/RecapOverlay.scss \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/RecapOverlay.test.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx
git commit -m "feat(fitness): full-frame recap overlay from the detail thumb

Corner chip opens the recap full-screen (object-fit: contain, muted
autoplay loop, Esc / backdrop to close) so the whole 16:9 frame is
watchable, not just the small thumb.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manual verification (garage, after deploy)

Not a code step — run after the tasks land and the image is built + deployed (gate on no active workout / no live playback per CLAUDE.local.md; then hard-reload the garage kiosk Firefox):

1. Open Fitness home → confirm a recap chip appears on rows for sessions that have a recap, and none on sessions without.
2. Select a recap-bearing session → the thumb slot shows the recap (whole frame, corners intact) and begins looping silently after ~0.4s; scrubbing quickly between sessions does **not** strobe.
3. Tap the corner ▶ chip → full-frame recap plays; Escape / tap-out closes it.
4. Select a just-ended (still-processing) session → thumb shows the episode still + a subtle "Recap rendering…" hint, no broken video.

## Notes / intentional scope decisions

- **Off-screen / visibility pause is deferred (YAGNI).** The detail shows a single focused panel and the recap is a silent muted `<video>`; the settle-gate already prevents scrub-strobe, so an IntersectionObserver/visibilitychange pause adds code for negligible benefit. Revisit only if profiling on the garage display shows the single detail `<video>` costing frames.
- **No backend change to the detail path.** `GET /api/v1/fitness/sessions/:id` already serializes `timelapse`; only the list summary needed `hasVideo`.
- **The `INDEX_VERSION` bump is not separately unit-tested.** The spec suggested testing that a v2 shard is treated as stale after the bump, but the "version mismatch → empty shard → rebuild" behavior lives in the unchanged private `#loadIndexShard` and needs filesystem setup the colocated `node:test` file (pure helpers only) doesn't do. The mechanism is generic and unchanged; re-testing it here would be brittle for no added safety. The bump itself is a one-line constant change verified by the manual pass (list badges appear on next read).
