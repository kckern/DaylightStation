# Piano Video Player + Course Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Piano kiosk a course → lecture → player browse flow over Plex collection `plex:675686` ("Music Education"), with a custom student-oriented video player (big play/pause, −30/−15/+15/+30s skips, A–B loop, 0.5–2× speed, resume + progress).

**Architecture:** Compose the shared chromeless `<Player>` engine (`frontend/src/modules/Player/Player.jsx`) and drive it via its imperative ref (`usePlayerController` + `setPlaybackRate` + `getMediaElement`). Pure helpers carry the testable logic (rate ladder, A–B boundary, resume math, play/log payload); thin hooks wire them to the media element; presentational chrome renders the transport. Browse uses existing generic endpoints — **no backend changes**.

**Tech Stack:** React (JSX), SCSS, Vitest + @testing-library/react. Shared modules: `@/modules/Player`, `DaylightAPI` (`frontend/src/lib/api.mjs`), the logging framework (`frontend/src/lib/logging/Logger.js`).

**Spec:** `docs/superpowers/specs/2026-06-22-piano-video-player-design.md`

**Test runner:** `npx vitest run <path> --config vitest.config.mjs`

---

## File Structure

All new files live in `frontend/src/modules/Piano/PianoKiosk/modes/Videos/`. The `../../../../../lib/...` relative depth (5 `../`) is correct from this directory — it matches the existing `Videos.jsx`/`Videos.test.jsx`.

**Pure helpers (unit-tested):**
- `pianoPlaybackRate.js` — the 0.5–2× ladder + `nextPianoRate`.
- `abLoop.js` — `resolveLoopSeek(current, a, b)` boundary logic.
- `lectureMeta.js` — `lectureContentId`, `deriveResumeSeconds`, `lectureStatus`.
- `watchLog.js` — `buildWatchLogPayload` for `play/log`.

**Hooks (wiring; verified via flow/manual):**
- `useResolvedMediaEl.js` — resolves the Player's `<video>` element.
- `useABLoop.js` — A/B marks → loop on `timeupdate`.
- `usePianoWatchLog.js` — resume-on-load + throttled `play/log`.

**Components:**
- `PlayerBoundary.jsx` — extracted error boundary (shared by Videos + player).
- `PianoVideoChrome.jsx` — presentational transport bar (unit-tested).
- `PianoVideoPlayer.jsx` — composes Player + chrome + hooks.
- `CourseGrid.jsx` — the 28-course grid.
- `CourseDetail.jsx` — a course's lecture list.
- `Videos.jsx` — reworked 3-view controller.

**Styling:** append to `frontend/src/Apps/PianoApp.scss`.

**Config:** piano config `videos.plexCollection` → `plex:675686`.

---

### Task 1: Piano playback-rate ladder (pure helper)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/pianoPlaybackRate.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/pianoPlaybackRate.test.js`

- [ ] **Step 1: Write the failing test**

```js
// pianoPlaybackRate.test.js
import { describe, it, expect } from 'vitest';
import { PIANO_PLAYBACK_RATES, nextPianoRate } from './pianoPlaybackRate.js';

describe('nextPianoRate', () => {
  it('exposes the full ladder', () => {
    expect(PIANO_PLAYBACK_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });
  it('steps through the ladder and wraps at the end', () => {
    expect(nextPianoRate(0.5)).toBe(0.75);
    expect(nextPianoRate(1)).toBe(1.25);
    expect(nextPianoRate(2)).toBe(0.5);
  });
  it('treats an unknown/absent rate as the 1x slot', () => {
    expect(nextPianoRate(undefined)).toBe(1.25);
    expect(nextPianoRate(3)).toBe(1.25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/pianoPlaybackRate.test.js --config vitest.config.mjs`
Expected: FAIL — `Failed to resolve import "./pianoPlaybackRate.js"`.

- [ ] **Step 3: Write the implementation**

```js
// pianoPlaybackRate.js
// Discrete playback-rate ladder for the piano video chrome. Separate from the
// shared Player ladder ([1,1.5,2]) so slow-practice tempos are available without
// changing Player behavior elsewhere. Pure + tiny so it's trivially testable.
export const PIANO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Next rate in the ladder; unknown/absent current resolves to the 1x slot. */
export function nextPianoRate(current) {
  const i = PIANO_PLAYBACK_RATES.indexOf(current);
  const base = i === -1 ? PIANO_PLAYBACK_RATES.indexOf(1) : i;
  return PIANO_PLAYBACK_RATES[(base + 1) % PIANO_PLAYBACK_RATES.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/pianoPlaybackRate.test.js --config vitest.config.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/pianoPlaybackRate.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/pianoPlaybackRate.test.js
git commit -m "feat(piano): playback-rate ladder helper for video chrome"
```

---

### Task 2: A–B loop boundary (pure helper)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/abLoop.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/abLoop.test.js`

- [ ] **Step 1: Write the failing test**

```js
// abLoop.test.js
import { describe, it, expect } from 'vitest';
import { resolveLoopSeek } from './abLoop.js';

describe('resolveLoopSeek', () => {
  it('loops back to A once the playhead reaches/passes B', () => {
    expect(resolveLoopSeek(10, 4, 10)).toBe(4);
    expect(resolveLoopSeek(11, 4, 10)).toBe(4);
  });
  it('is a no-op before B', () => {
    expect(resolveLoopSeek(7, 4, 10)).toBeNull();
  });
  it('is a no-op when a/b are unset or invalid', () => {
    expect(resolveLoopSeek(10, null, 10)).toBeNull();
    expect(resolveLoopSeek(10, 4, null)).toBeNull();
    expect(resolveLoopSeek(10, 10, 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/abLoop.test.js --config vitest.config.mjs`
Expected: FAIL — cannot resolve `./abLoop.js`.

- [ ] **Step 3: Write the implementation**

```js
// abLoop.js
// Pure A–B loop boundary logic. Given the current playhead and the A/B marks,
// returns the time to seek to (loop back to A) or null for no-op. Only the end
// boundary loops; an unset or invalid range (b <= a) never seeks.
export function resolveLoopSeek(current, a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b <= a) return null;
  if (Number.isFinite(current) && current >= b) return a;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/abLoop.test.js --config vitest.config.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/abLoop.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/abLoop.test.js
git commit -m "feat(piano): A-B loop boundary helper"
```

---

### Task 3: Lecture metadata helpers (pure)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.test.js`

- [ ] **Step 1: Write the failing test**

```js
// lectureMeta.test.js
import { describe, it, expect } from 'vitest';
import { lectureContentId, deriveResumeSeconds, lectureStatus } from './lectureMeta.js';

describe('lectureContentId', () => {
  it('prefers the plex field', () => {
    expect(lectureContentId({ plex: '662039' })).toBe('plex:662039');
  });
  it('accepts a plex:-prefixed id and contentId fallback', () => {
    expect(lectureContentId({ id: 'plex:5' })).toBe('plex:5');
    expect(lectureContentId({ contentId: 'plex:7' })).toBe('plex:7');
  });
  it('returns null when unresolved', () => {
    expect(lectureContentId({ id: '5' })).toBeNull();
    expect(lectureContentId(null)).toBeNull();
  });
});

describe('deriveResumeSeconds', () => {
  it('uses watchSeconds when present', () => {
    expect(deriveResumeSeconds({ watchSeconds: 42, duration: 100 })).toBe(42);
  });
  it('falls back to watchProgress percent of duration', () => {
    expect(deriveResumeSeconds({ watchProgress: 25, duration: 200 })).toBe(50);
  });
  it('is 0 with no progress info', () => {
    expect(deriveResumeSeconds({ duration: 100 })).toBe(0);
    expect(deriveResumeSeconds(null)).toBe(0);
  });
});

describe('lectureStatus', () => {
  it('reports watched and clamps percent', () => {
    expect(lectureStatus({ isWatched: true, watchProgress: 140 })).toEqual({ watched: true, percent: 100 });
  });
  it('reports in-progress percent', () => {
    expect(lectureStatus({ watchProgress: 33.6 })).toEqual({ watched: false, percent: 34 });
  });
  it('defaults to unwatched/0', () => {
    expect(lectureStatus({})).toEqual({ watched: false, percent: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.test.js --config vitest.config.mjs`
Expected: FAIL — cannot resolve `./lectureMeta.js`.

- [ ] **Step 3: Write the implementation**

```js
// lectureMeta.js
const num = (v) => {
  if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : null; }
  return Number.isFinite(v) ? v : null;
};

/** Plex content id for the Player, e.g. "plex:662039". Null if unresolved. */
export function lectureContentId(item) {
  if (!item) return null;
  if (item.plex) return `plex:${item.plex}`;
  if (typeof item.id === 'string' && /^plex:/i.test(item.id)) return item.id;
  if (typeof item.contentId === 'string') return item.contentId;
  return null;
}

/** Resume position in seconds from a /playable lecture item (0 = start). */
export function deriveResumeSeconds(item) {
  const ws = num(item?.watchSeconds);
  if (ws && ws > 0) return ws;
  const dur = num(item?.duration);
  const pct = num(item?.watchProgress);
  if (pct && pct > 0 && dur && dur > 0) {
    return Math.min(dur, (Math.max(0, Math.min(100, pct)) / 100) * dur);
  }
  return 0;
}

/** Tile badge state: watched flag + integer percent [0..100]. */
export function lectureStatus(item) {
  const pct = num(item?.watchProgress);
  return {
    watched: Boolean(item?.isWatched),
    percent: pct ? Math.max(0, Math.min(100, Math.round(pct))) : 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.test.js --config vitest.config.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.test.js
git commit -m "feat(piano): lecture content-id/resume/status helpers"
```

---

### Task 4: play/log payload builder (pure)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/watchLog.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/watchLog.test.js`

- [ ] **Step 1: Write the failing test**

```js
// watchLog.test.js
import { describe, it, expect } from 'vitest';
import { buildWatchLogPayload } from './watchLog.js';

describe('buildWatchLogPayload', () => {
  it('computes percent and in_progress status mid-video', () => {
    const p = buildWatchLogPayload({ contentId: 'plex:9', title: 'L1', seconds: 30, duration: 120, reason: 'progress' });
    expect(p).toMatchObject({
      title: 'L1', type: 'plex', assetId: 'plex:9',
      seconds: 30, percent: 25, status: 'in_progress', naturalEnd: false,
      duration: 120, reason: 'progress',
    });
  });
  it('marks completed/naturalEnd at >=98%', () => {
    const p = buildWatchLogPayload({ contentId: 'plex:9', seconds: 119, duration: 120, reason: 'close' });
    expect(p.status).toBe('completed');
    expect(p.naturalEnd).toBe(true);
  });
  it('handles missing duration as none/0%', () => {
    const p = buildWatchLogPayload({ contentId: 'plex:9', seconds: 0, duration: 0, reason: 'close' });
    expect(p).toMatchObject({ percent: 0, status: 'none', naturalEnd: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/watchLog.test.js --config vitest.config.mjs`
Expected: FAIL — cannot resolve `./watchLog.js`.

- [ ] **Step 3: Write the implementation**

```js
// watchLog.js
/** Build the POST api/v1/play/log payload (mirrors the fitness convention). */
export function buildWatchLogPayload({ contentId, title, seconds, duration, reason }) {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const percent = d ? Math.round((s / d) * 100) : 0;
  const naturalEnd = d > 0 && s >= d * 0.98;
  return {
    title: title || '',
    type: 'plex',
    assetId: contentId,
    seconds: Math.round(s),
    percent,
    status: naturalEnd ? 'completed' : (s > 0 ? 'in_progress' : 'none'),
    naturalEnd,
    duration: Math.round(d),
    reason: reason || 'progress',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/watchLog.test.js --config vitest.config.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/watchLog.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/watchLog.test.js
git commit -m "feat(piano): play/log payload builder"
```

---

### Task 5: Extract PlayerBoundary into its own file

The error boundary currently lives inside `Videos.jsx`. Both the reworked `Videos.jsx`'s player and the new `PianoVideoPlayer` need it, so extract it. `Videos.jsx` will be rewritten in Task 11; for now leave it untouched — this task only adds the new file (no behavior change yet).

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PlayerBoundary.jsx`

- [ ] **Step 1: Create the file**

```jsx
// PlayerBoundary.jsx
import { Component } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';

/** Error boundary so a Player failure drops back to the list, not a blank kiosk. */
export default class PlayerBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    getLogger().child({ component: 'piano-videos' }).error('player.crash', { error: error?.message });
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="piano-mode__placeholder">
          Playback failed. <button type="button" onClick={this.props.onBack}>Back to videos</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Verify the existing Videos suite still passes (no regression)**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.test.jsx --config vitest.config.mjs`
Expected: PASS (2 tests) — unchanged.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PlayerBoundary.jsx
git commit -m "refactor(piano): extract PlayerBoundary for reuse"
```

---

### Task 6: Media-element + A–B loop hooks

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/useResolvedMediaEl.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/useABLoop.js`

These are thin wiring hooks over the Task 2 helper; their logic is covered by `abLoop.test.js` and exercised manually in the player. No separate hook test (would require mounting the heavy `<Player>`).

- [ ] **Step 1: Create `useResolvedMediaEl.js`**

```js
// useResolvedMediaEl.js
import { useState, useEffect } from 'react';

/**
 * Polls the Player imperative ref until its <video>/<audio> element exists.
 * The shared Player creates the media element asynchronously (lazy + resilience
 * controller), so getMediaElement() may be null on the first render.
 */
export default function useResolvedMediaEl(playerRef) {
  const [el, setEl] = useState(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const m = playerRef?.current?.getMediaElement?.();
      if (m) { setEl(m); return; }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playerRef]);
  return el;
}
```

- [ ] **Step 2: Create `useABLoop.js`**

```js
// useABLoop.js
import { useState, useRef, useEffect, useCallback } from 'react';
import { resolveLoopSeek } from './abLoop.js';

/** Wires A/B marks to the media element: loops back to A when playback passes B. */
export default function useABLoop(mediaEl, seek, getCurrentTime) {
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const aRef = useRef(null); const bRef = useRef(null);
  useEffect(() => { aRef.current = a; }, [a]);
  useEffect(() => { bRef.current = b; }, [b]);

  useEffect(() => {
    if (!mediaEl) return undefined;
    const onTime = () => {
      const target = resolveLoopSeek(mediaEl.currentTime, aRef.current, bRef.current);
      if (target != null) seek(target);
    };
    mediaEl.addEventListener('timeupdate', onTime);
    return () => mediaEl.removeEventListener('timeupdate', onTime);
  }, [mediaEl, seek]);

  const markA = useCallback(() => setA(getCurrentTime?.() ?? 0), [getCurrentTime]);
  const markB = useCallback(() => setB(getCurrentTime?.() ?? 0), [getCurrentTime]);
  const clear = useCallback(() => { setA(null); setB(null); }, []);
  return { a, b, markA, markB, clear };
}
```

- [ ] **Step 3: Verify the files compile via the existing suite**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/abLoop.test.js --config vitest.config.mjs`
Expected: PASS (unchanged — confirms `abLoop.js` import path used by the hook resolves).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/useResolvedMediaEl.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/useABLoop.js
git commit -m "feat(piano): media-element + A-B loop hooks"
```

---

### Task 7: Watch-log hook (resume + throttled logging)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoWatchLog.js`

Logic (payload) is covered by `watchLog.test.js`; the hook wiring is verified manually in the player. No separate hook test.

- [ ] **Step 1: Create the hook**

```js
// usePianoWatchLog.js
import { useEffect, useRef } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import getLogger from '../../../../../lib/logging/Logger.js';
import { buildWatchLogPayload } from './watchLog.js';

const LOG_INTERVAL_MS = 10000;

/** Resume-on-load + throttled play/log posting for a piano lecture. */
export default function usePianoWatchLog({ mediaEl, contentId, title, resumeSeconds }) {
  const logger = useRef(null);
  if (!logger.current) logger.current = getLogger().child({ component: 'piano-video-player' });

  // Resume once, after metadata is available.
  useEffect(() => {
    if (!mediaEl || !(resumeSeconds > 0)) return undefined;
    let done = false;
    const apply = () => {
      if (done) return; done = true;
      try {
        if (mediaEl.currentTime < resumeSeconds - 1) mediaEl.currentTime = resumeSeconds;
        logger.current.info('piano.video.resume', { contentId, resumeSeconds });
      } catch (_) { /* element may detach during reload */ }
    };
    if (mediaEl.readyState >= 1) apply();
    else mediaEl.addEventListener('loadedmetadata', apply, { once: true });
    return () => mediaEl.removeEventListener('loadedmetadata', apply);
  }, [mediaEl, resumeSeconds, contentId]);

  // Throttled progress logging while playing + a final post on unmount.
  useEffect(() => {
    if (!mediaEl || !contentId) return undefined;
    const post = (reason) => {
      const payload = buildWatchLogPayload({
        contentId, title,
        seconds: mediaEl.currentTime,
        duration: mediaEl.duration,
        reason,
      });
      DaylightAPI('api/v1/play/log', payload)
        .then(() => logger.current.debug('piano.video.log-ok', { reason, seconds: payload.seconds }))
        .catch((err) => logger.current.warn('piano.video.log-fail', { reason, error: err.message }));
    };
    const id = setInterval(() => { if (!mediaEl.paused) post('progress'); }, LOG_INTERVAL_MS);
    return () => { clearInterval(id); post('close'); };
  }, [mediaEl, contentId, title]);
}
```

- [ ] **Step 2: Verify the payload contract still passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/watchLog.test.js --config vitest.config.mjs`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoWatchLog.js
git commit -m "feat(piano): watch-log hook (resume + throttled play/log)"
```

---

### Task 7B: Chord/note-name helper (pure) — play-along readout

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/chordName.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/chordName.test.js`

Names the notes currently held (and the chord, when they form a known triad/
seventh in any inversion). Uses `getNoteName` from `Piano/noteUtils.js`
(C4 = MIDI 60). Powers the play-along note/chord readout.

- [ ] **Step 1: Write the failing test**

```js
// chordName.test.js
import { describe, it, expect } from 'vitest';
import { describeChord } from './chordName.js';
// MIDI: C4=60 D4=62 E4=64 F4=65 G4=67 A4=69 B4=71, C5=72, E5=76

describe('describeChord', () => {
  it('names a major triad in root position and inversion', () => {
    expect(describeChord([60, 64, 67]).name).toBe('C major');
    expect(describeChord([64, 67, 72]).name).toBe('C major'); // E G C (1st inv)
  });
  it('names a minor triad', () => {
    expect(describeChord([69, 72, 76]).name).toBe('A minor'); // A C E
  });
  it('names a dominant seventh', () => {
    expect(describeChord([67, 71, 74, 77]).name).toBe('G7'); // G B D F
  });
  it('lists note names low-to-high regardless of input order', () => {
    expect(describeChord([67, 60, 64]).notes).toEqual(['C4', 'E4', 'G4']);
  });
  it('returns a null name for non-chords / too few notes', () => {
    expect(describeChord([60, 62]).name).toBeNull();
    expect(describeChord([]).name).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/chordName.test.js --config vitest.config.mjs`
Expected: FAIL — cannot resolve `./chordName.js`.

- [ ] **Step 3: Write the implementation**

```js
// chordName.js
import { getNoteName } from '../../../noteUtils.js';

const PC_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// interval set (semitones above root, sorted, joined) → quality label
const TRIAD_QUALITY = { '0,4,7': 'major', '0,3,7': 'minor', '0,3,6': 'dim', '0,4,8': 'aug' };
const SEVENTH_QUALITY = { '0,4,7,10': '7', '0,4,7,11': 'maj7', '0,3,7,10': 'm7', '0,3,6,10': 'm7b5', '0,3,6,9': 'dim7' };

/**
 * Describe the notes currently held.
 * @param {Iterable<number>} midiNotes
 * @returns {{ notes: string[], name: string|null }} notes low→high with octave;
 *   name = chord name if a known triad/seventh in any inversion, else null.
 */
export function describeChord(midiNotes) {
  const arr = Array.from(midiNotes || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const notes = arr.map((n) => getNoteName(n));
  const pcs = Array.from(new Set(arr.map((n) => ((n % 12) + 12) % 12)));
  let name = null;
  if (pcs.length === 3 || pcs.length === 4) {
    for (const root of pcs) {
      const intervals = pcs.map((pc) => (((pc - root) % 12) + 12) % 12).sort((a, b) => a - b).join(',');
      const quality = pcs.length === 3 ? TRIAD_QUALITY[intervals] : SEVENTH_QUALITY[intervals];
      if (quality) {
        const r = PC_NAMES_SHARP[root];
        name = quality === 'major' ? `${r} major`
          : quality === 'minor' ? `${r} minor`
          : quality === 'dim' ? `${r} dim`
          : quality === 'aug' ? `${r} aug`
          : `${r}${quality}`;
        break;
      }
    }
  }
  return { notes, name };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/chordName.test.js --config vitest.config.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/chordName.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/chordName.test.js
git commit -m "feat(piano): chord/note-name helper for play-along readout"
```

---

### Task 8: Transport chrome component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`

> **Play-along addition:** the chrome also takes `playAlong` (bool) and
> `onTogglePlayAlong` and renders a toggle button (`🎹`) that reflects/controls
> play-along visibility. These are included in the code/test below.

- [ ] **Step 1: Write the failing test**

```jsx
// PianoVideoChrome.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PianoVideoChrome from './PianoVideoChrome.jsx';

const baseProps = {
  isPlaying: true, currentTime: 30, duration: 120, rate: 1, loop: { a: null, b: null },
  playAlong: true,
  onToggle: vi.fn(), onSkip: vi.fn(), onCycleRate: vi.fn(),
  onMarkA: vi.fn(), onMarkB: vi.fn(), onClearLoop: vi.fn(), onSeek: vi.fn(), onBack: vi.fn(),
  onTogglePlayAlong: vi.fn(),
};

describe('PianoVideoChrome', () => {
  it('shows the pause control while playing and toggles', () => {
    const onToggle = vi.fn();
    render(<PianoVideoChrome {...baseProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(onToggle).toHaveBeenCalled();
  });
  it('toggles the play-along panel', () => {
    const onTogglePlayAlong = vi.fn();
    render(<PianoVideoChrome {...baseProps} onTogglePlayAlong={onTogglePlayAlong} />);
    fireEvent.click(screen.getByLabelText('Hide play-along'));
    expect(onTogglePlayAlong).toHaveBeenCalled();
  });
  it('skips by the labeled amounts', () => {
    const onSkip = vi.fn();
    render(<PianoVideoChrome {...baseProps} onSkip={onSkip} />);
    fireEvent.click(screen.getByLabelText('Back 30 seconds'));
    fireEvent.click(screen.getByLabelText('Forward 15 seconds'));
    expect(onSkip).toHaveBeenCalledWith(-30);
    expect(onSkip).toHaveBeenCalledWith(15);
  });
  it('renders the current rate and cycles it', () => {
    const onCycleRate = vi.fn();
    render(<PianoVideoChrome {...baseProps} rate={1.5} onCycleRate={onCycleRate} />);
    fireEvent.click(screen.getByText('1.5×'));
    expect(onCycleRate).toHaveBeenCalled();
  });
  it('marks A and B for the loop', () => {
    const onMarkA = vi.fn(); const onMarkB = vi.fn();
    render(<PianoVideoChrome {...baseProps} onMarkA={onMarkA} onMarkB={onMarkB} />);
    fireEvent.click(screen.getByLabelText('Mark loop start'));
    fireEvent.click(screen.getByLabelText('Mark loop end'));
    expect(onMarkA).toHaveBeenCalled();
    expect(onMarkB).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx --config vitest.config.mjs`
Expected: FAIL — cannot resolve `./PianoVideoChrome.jsx`.

- [ ] **Step 3: Write the implementation**

```jsx
// PianoVideoChrome.jsx
import { useRef } from 'react';

const fmt = (s) => {
  let v = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
};

/**
 * Presentational transport bar for the piano video player. Big touch targets,
 * no drag sliders (tap-to-seek bar, discrete speed cycle, A/B loop taps).
 */
export default function PianoVideoChrome({
  isPlaying, currentTime, duration, rate, loop, playAlong,
  onToggle, onSkip, onCycleRate, onMarkA, onMarkB, onClearLoop, onSeek, onBack, onTogglePlayAlong,
}) {
  const barRef = useRef(null);
  const dur = duration > 0 ? duration : 0;
  const pct = dur ? Math.min(100, (currentTime / dur) * 100) : 0;
  const markPos = (v) => (dur && Number.isFinite(v) ? `${Math.min(100, (v / dur) * 100)}%` : null);
  const seekFromEvent = (e) => {
    const el = barRef.current; if (!el || !dur) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    onSeek(Math.max(0, Math.min(dur, (x / rect.width) * dur)));
  };
  const hasLoop = loop?.a != null || loop?.b != null;

  return (
    <div className="piano-video-chrome" data-testid="piano-video-chrome">
      <div className="piano-video-chrome__bar" ref={barRef} onPointerDown={seekFromEvent}>
        <div className="piano-video-chrome__progress" style={{ width: `${pct}%` }} />
        {markPos(loop?.a) && <span className="piano-video-chrome__mark piano-video-chrome__mark--a" style={{ left: markPos(loop.a) }} />}
        {markPos(loop?.b) && <span className="piano-video-chrome__mark piano-video-chrome__mark--b" style={{ left: markPos(loop.b) }} />}
      </div>
      <div className="piano-video-chrome__row">
        <button type="button" className="piano-video-chrome__btn" onClick={onBack}>‹ Lessons</button>
        <span className="piano-video-chrome__time">{fmt(currentTime)} / {fmt(dur)}</span>
        <div className="piano-video-chrome__spacer" />
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-30)} aria-label="Back 30 seconds">«30</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-15)} aria-label="Back 15 seconds">«15</button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--play" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? '❚❚' : '▶'}</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(15)} aria-label="Forward 15 seconds">15»</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(30)} aria-label="Forward 30 seconds">30»</button>
        <div className="piano-video-chrome__spacer" />
        <button type="button" className="piano-video-chrome__btn" onClick={onCycleRate} aria-label="Playback speed">{rate}×</button>
        <button type="button" className={`piano-video-chrome__btn${loop?.a != null && loop?.b == null ? ' is-arming' : ''}`} onClick={onMarkA} aria-label="Mark loop start">A</button>
        <button type="button" className="piano-video-chrome__btn" onClick={onMarkB} aria-label="Mark loop end">B</button>
        <button type="button" className="piano-video-chrome__btn" onClick={onClearLoop} disabled={!hasLoop} aria-label="Clear loop">✕</button>
        <div className="piano-video-chrome__spacer" />
        <button type="button" className={`piano-video-chrome__btn${playAlong ? ' is-on' : ''}`} onClick={onTogglePlayAlong} aria-label={playAlong ? 'Hide play-along' : 'Show play-along'}>🎹</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx --config vitest.config.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
git commit -m "feat(piano): transport chrome (pause, skips, speed, A-B loop)"
```

---

### Task 9: PianoVideoPlayer (compose Player + chrome + hooks)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`

No unit test (mounts the heavy lazy `<Player>` which does network I/O — out of scope for jsdom, matching the existing suite that never tests the Player view). Verified in the integration test (Task 11) up to the lecture list, and manually on garage (Task 13).

- [ ] **Step 1: Create the component**

```jsx
// PianoVideoPlayer.jsx
import { useRef, useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import usePlayerController from '../../../../Player/usePlayerController.js';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { NoteWaterfall } from '../../../components/NoteWaterfall.jsx';
import { CurrentChordStaff } from '../../../components/CurrentChordStaff.jsx';
import PlayerBoundary from './PlayerBoundary.jsx';
import PianoVideoChrome from './PianoVideoChrome.jsx';
import useResolvedMediaEl from './useResolvedMediaEl.js';
import useABLoop from './useABLoop.js';
import usePianoWatchLog from './usePianoWatchLog.js';
import { nextPianoRate } from './pianoPlaybackRate.js';
import { lectureContentId, deriveResumeSeconds } from './lectureMeta.js';
import { describeChord } from './chordName.js';

// Player is heavy — code-split it so the menu/other modes don't pay for it.
const Player = lazy(() => import('../../../../Player/Player.jsx'));

const EMPTY_NOTES = new Map();

/** Custom student video player for a single piano lecture, with MIDI play-along. */
export default function PianoVideoPlayer({ lecture, onBack }) {
  const playerRef = useRef(null);
  const ctrl = usePlayerController(playerRef);
  const mediaEl = useResolvedMediaEl(playerRef);
  const { activeNotes, noteHistory } = usePianoMidi();
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [playAlong, setPlayAlong] = useState(true);

  const contentId = lectureContentId(lecture);
  const title = lecture?.label || lecture?.title || '';
  const resumeSeconds = deriveResumeSeconds(lecture);
  const loop = useABLoop(mediaEl, ctrl.seek, ctrl.getCurrentTime);
  usePianoWatchLog({ mediaEl, contentId, title, resumeSeconds });

  const notes = activeNotes || EMPTY_NOTES;
  const chord = useMemo(() => describeChord(notes.keys()), [notes]);

  useEffect(() => {
    getLogger().child({ component: 'piano-video-player' }).info('piano.video.open', { contentId, resumeSeconds });
  }, [contentId, resumeSeconds]);

  // Mirror media-element state into React for the chrome.
  useEffect(() => {
    if (!mediaEl) return undefined;
    const onTime = () => setCurrentTime(mediaEl.currentTime || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onMeta = () => setDuration(mediaEl.duration || 0);
    mediaEl.addEventListener('timeupdate', onTime);
    mediaEl.addEventListener('play', onPlay);
    mediaEl.addEventListener('pause', onPause);
    mediaEl.addEventListener('loadedmetadata', onMeta);
    onMeta();
    return () => {
      mediaEl.removeEventListener('timeupdate', onTime);
      mediaEl.removeEventListener('play', onPlay);
      mediaEl.removeEventListener('pause', onPause);
      mediaEl.removeEventListener('loadedmetadata', onMeta);
    };
  }, [mediaEl]);

  const handleSkip = useCallback((delta) => {
    const cur = ctrl.getCurrentTime() || 0;
    const max = duration > 0 ? duration : cur + Math.abs(delta);
    ctrl.seek(Math.max(0, Math.min(max, cur + delta)));
  }, [ctrl, duration]);

  const handleCycleRate = useCallback(() => {
    const r = nextPianoRate(rate);
    setRate(r);
    playerRef.current?.setPlaybackRate?.(r);
    getLogger().child({ component: 'piano-video-player' }).info('piano.video.rate', { rate: r });
  }, [rate]);

  const togglePlayAlong = useCallback(() => {
    setPlayAlong((v) => {
      const next = !v;
      getLogger().child({ component: 'piano-video-player' }).info('piano.video.playalong', { on: next });
      return next;
    });
  }, []);

  if (!contentId) {
    return (
      <div className="piano-mode__placeholder">
        This lecture can’t be played. <button type="button" onClick={onBack}>Back</button>
      </div>
    );
  }

  return (
    <div className={`piano-video-player${playAlong ? ' piano-video-player--playalong' : ''}`}>
      <div className="piano-video-player__stage">
        <div className="piano-video-player__video">
          <PlayerBoundary onBack={onBack}>
            <Suspense fallback={<div className="piano-mode__placeholder">Loading…</div>}>
              <Player ref={playerRef} play={{ contentId }} clear={onBack} />
            </Suspense>
          </PlayerBoundary>
        </div>
        {playAlong && (
          <aside className="piano-video-player__staff">
            <div className="piano-video-player__readout">
              {chord.notes.length ? chord.notes.join(' ') : 'Play along…'}
              {chord.name ? ` — ${chord.name}` : ''}
            </div>
            <CurrentChordStaff activeNotes={notes} />
          </aside>
        )}
      </div>

      <PianoVideoChrome
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        rate={rate}
        loop={loop}
        playAlong={playAlong}
        onToggle={ctrl.toggle}
        onSkip={handleSkip}
        onCycleRate={handleCycleRate}
        onMarkA={loop.markA}
        onMarkB={loop.markB}
        onClearLoop={loop.clear}
        onSeek={ctrl.seek}
        onBack={onBack}
        onTogglePlayAlong={togglePlayAlong}
      />

      {playAlong && (
        <div className="piano-video-player__keys">
          <NoteWaterfall noteHistory={noteHistory || []} activeNotes={notes} />
          <PianoKeyboard activeNotes={notes} />
        </div>
      )}
    </div>
  );
}
```

> **Note on `usePianoMidi`:** it requires a `PianoMidiProvider`, which wraps all
> piano modes in `PianoApp.jsx` (so the live kiosk is fine). The Videos tests
> never mount `PianoVideoPlayer` (they stop at the lecture list), so no provider
> is needed there.

- [ ] **Step 2: Verify it compiles (lint via vitest transform of a dependent suite)**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx --config vitest.config.mjs`
Expected: PASS (the chrome import graph the player reuses still resolves; no syntax errors introduced).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx
git commit -m "feat(piano): PianoVideoPlayer composing shared Player + chrome"
```

---

### Task 10: CourseGrid component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.jsx`

Behavior is covered by the reworked `Videos.test.jsx` (Task 11), which renders the grid at the top level.

- [ ] **Step 1: Create the component**

```jsx
// CourseGrid.jsx
import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';

/** Grid of the configured collection's courses; tap one to open its lectures. */
export default function CourseGrid({ collection, onSelect }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-grid' }), []);
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!collection) { if (!cancelled) { setItems([]); setError('No videos.plexCollection configured.'); } return; }
        const ratingKey = String(collection).replace(/^plex:/, '');
        logger.info('piano.videos-load', { ratingKey });
        const list = await DaylightAPI(`api/v1/list/plex/${ratingKey}`);
        if (!cancelled) setItems(list?.items ?? []);
      } catch (err) {
        if (!cancelled) { setItems([]); setError(err.message); }
        logger.warn('piano.videos-load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, collection]);

  return (
    <section className="piano-mode piano-mode--videos">
      <h2>Videos</h2>
      {items === null && <p className="piano-mode__placeholder">Loading…</p>}
      {items?.length === 0 && <p className="piano-mode__placeholder">{error || 'No videos found.'}</p>}
      {items?.length > 0 && (
        <ul className="piano-video-grid">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)}>
                {(item.thumbnail || item.image) && <img src={item.thumbnail || item.image} alt="" loading="lazy" />}
                <span className="piano-video-grid__title">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.jsx
git commit -m "feat(piano): CourseGrid (collection courses)"
```

---

### Task 11: CourseDetail component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx`

Behavior covered by the reworked `Videos.test.jsx` (Task 12).

- [ ] **Step 1: Create the component**

```jsx
// CourseDetail.jsx
import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { lectureStatus } from './lectureMeta.js';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/** A course's lecture list (FitnessShow-style). Tap a lecture to play it. */
export default function CourseDetail({ course, onPlay, onBack }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const courseId = idOf(course?.id);
        logger.info('piano.course-load', { courseId });
        const res = await DaylightAPI(`api/v1/fitness/show/${courseId}/playable`);
        if (!cancelled) setData(res || { items: [] });
      } catch (err) {
        if (!cancelled) { setData({ items: [] }); setError(err.message); }
        logger.warn('piano.course-load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, course?.id]);

  const info = data?.info || {};
  const items = data ? (data.items || []) : null;

  return (
    <section className="piano-mode piano-mode--videos piano-video-detail">
      <div className="piano-video-detail__head">
        <button type="button" className="piano-game-fullscreen__back" onClick={onBack}>‹ Courses</button>
        <h2>{course?.title || info.title || 'Course'}</h2>
      </div>
      {(info.image || course?.image) && (
        <img className="piano-video-detail__poster" src={info.image || course.image} alt="" />
      )}
      {info.summary && <p className="piano-video-detail__summary">{info.summary}</p>}
      {items === null && <p className="piano-mode__placeholder">Loading…</p>}
      {items?.length === 0 && <p className="piano-mode__placeholder">{error || 'No lectures found.'}</p>}
      {items?.length > 0 && (
        <ul className="piano-video-grid">
          {items.map((item) => {
            const st = lectureStatus(item);
            return (
              <li key={item.plex || item.id}>
                <button type="button" className="piano-video-grid__tile" onClick={() => onPlay(item)}>
                  {(item.image || item.thumbnail) && <img src={item.image || item.thumbnail} alt="" loading="lazy" />}
                  {st.watched && <span className="piano-video-grid__badge">✓</span>}
                  {!st.watched && st.percent > 0 && (
                    <span className="piano-video-grid__bar"><span style={{ width: `${st.percent}%` }} /></span>
                  )}
                  <span className="piano-video-grid__title">{item.label || item.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx
git commit -m "feat(piano): CourseDetail (lecture list with progress badges)"
```

---

### Task 12: Rework Videos.jsx into a 3-view controller + extend tests

**Files:**
- Modify (replace): `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.test.jsx`

- [ ] **Step 1: Extend the test with the drill-down flow**

Replace the entire contents of `Videos.test.jsx` with:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { Videos } from './Videos.jsx';

const renderVideos = (plexCollection) => render(
  <ActivePianoProvider
    pianoId="test"
    config={{ videos: { plexCollection }, voices: [], midi: {}, inactivityMinutes: 10 }}
  >
    <Videos />
  </ActivePianoProvider>
);

beforeEach(() => api.mockReset());

describe('Videos mode', () => {
  it('lists courses from the configured Plex collection', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/440630') {
        return Promise.resolve({ items: [
          { id: 'plex:1', title: 'Beethoven Sonatas' },
          { id: 'plex:2', title: 'How to Listen to Opera' },
        ] });
      }
      return Promise.resolve({});
    });

    renderVideos('plex:440630');
    expect(await screen.findByText('Beethoven Sonatas')).toBeTruthy();
    expect(screen.getByText('How to Listen to Opera')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/list/plex/440630');
  });

  it('shows a helpful message when no collection is configured', async () => {
    renderVideos(null);
    await waitFor(() =>
      expect(screen.getByText(/No videos.plexCollection configured/i)).toBeTruthy()
    );
  });

  it('drills into a course, lists its lectures, and goes back', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/440630') {
        return Promise.resolve({ items: [{ id: 'plex:1', title: 'Beethoven Sonatas' }] });
      }
      if (path === 'api/v1/fitness/show/1/playable') {
        return Promise.resolve({ info: { title: 'Beethoven Sonatas' }, items: [
          { plex: '10', label: 'Lecture 1' },
          { plex: '11', label: 'Lecture 2' },
        ] });
      }
      return Promise.resolve({});
    });

    renderVideos('plex:440630');
    fireEvent.click(await screen.findByText('Beethoven Sonatas'));
    expect(await screen.findByText('Lecture 1')).toBeTruthy();
    expect(screen.getByText('Lecture 2')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/fitness/show/1/playable');

    fireEvent.click(screen.getByText('‹ Courses'));
    expect(await screen.findByText('Beethoven Sonatas')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify the new case fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.test.jsx --config vitest.config.mjs`
Expected: FAIL on the drill-down test (current `Videos.jsx` has no course→lecture navigation; clicking a title plays via the old Player path instead of fetching `/playable`).

- [ ] **Step 3: Replace `Videos.jsx` with the controller**

Replace the entire contents of `Videos.jsx` with:

```jsx
import { useMemo, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import CourseGrid from './CourseGrid.jsx';
import CourseDetail from './CourseDetail.jsx';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';

/**
 * Videos mode — passive lectures from a configured Plex collection.
 * Three views: course grid → course detail (lectures) → player.
 * Collection id comes from piano config `videos.plexCollection` (a Plex
 * collection ratingKey, optionally `plex:`-prefixed).
 */
export function Videos() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const { config } = usePianoKioskConfig();
  const collection = config.videos.plexCollection;
  const [course, setCourse] = useState(null);
  const [lecture, setLecture] = useState(null);

  if (lecture) {
    return (
      <PianoVideoPlayer
        lecture={lecture}
        onBack={() => { logger.info('piano.video-close', {}); setLecture(null); }}
      />
    );
  }
  if (course) {
    return (
      <CourseDetail
        course={course}
        onPlay={(item) => { logger.info('piano.video-play', { contentId: item.plex || item.id }); setLecture(item); }}
        onBack={() => setCourse(null)}
      />
    );
  }
  return (
    <CourseGrid
      collection={collection}
      onSelect={(item) => { logger.info('piano.course-open', { id: item.id }); setCourse(item); }}
    />
  );
}

export default Videos;
```

- [ ] **Step 4: Run test to verify all pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.test.jsx --config vitest.config.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole Videos directory suite**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/ --config vitest.config.mjs`
Expected: PASS — all suites (pianoPlaybackRate, abLoop, lectureMeta, watchLog, PianoVideoChrome, Videos).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.test.jsx
git commit -m "feat(piano): wire Videos into course→lecture→player flow"
```

---

### Task 13: Styling

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss` (append a new section at end of file)

Reuses the existing `.piano-video-grid` / `.piano-video-player` / `.piano-game-fullscreen__back` rules; adds the course-detail layout, lecture badges, and the transport chrome.

- [ ] **Step 1: Append the styles**

Add to the end of `frontend/src/Apps/PianoApp.scss`:

```scss
/* ---- Piano video: course detail ---- */
.piano-video-detail {
  &__head { display: flex; align-items: center; gap: 1rem; }
  &__poster {
    max-height: 9rem; border-radius: 10px; margin: 0.5rem 0;
    object-fit: cover; align-self: flex-start;
  }
  &__summary { color: #aaa; max-width: 60ch; margin: 0 0 1rem; }
}

/* lecture tile progress affordances (layered over .piano-video-grid__tile) */
.piano-video-grid__tile { position: relative; }
.piano-video-grid__badge {
  position: absolute; top: 6px; right: 6px;
  background: #3c7; color: #0e0e12; font-weight: 700;
  border-radius: 999px; width: 1.4rem; height: 1.4rem;
  display: flex; align-items: center; justify-content: center; font-size: 0.85rem;
}
.piano-video-grid__bar {
  position: absolute; left: 0; right: 0; bottom: 0; height: 4px;
  background: rgba(255, 255, 255, 0.15);
  span { display: block; height: 100%; background: #3c7; }
}

/* ---- Piano video: player layout (stage + chrome + play-along strip) ---- */
.piano-video-player {
  position: relative; flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column; background: #000;

  &__stage { flex: 1 1 auto; min-height: 0; display: flex; }
  &__video { flex: 1 1 auto; min-width: 0; position: relative; }
  &__staff {
    flex: 0 0 20rem; min-width: 0; background: #d9d0c1;
    display: flex; flex-direction: column; overflow: hidden;
  }
  &__readout {
    flex: 0 0 auto; padding: 0.4rem 0.75rem; text-align: center;
    color: #2a2a2a; font-family: 'Roboto Condensed', system-ui, sans-serif;
    font-variant-numeric: tabular-nums; font-size: 1.05rem; min-height: 1.6rem;
  }
  /* note waterfall + keyboard stacked; share width so they align */
  &__keys {
    flex: 0 0 auto; display: flex; flex-direction: column; background: #2a2a2a;
    .note-waterfall { flex: 0 0 9rem; position: relative; }
    .piano-keyboard { flex: 0 0 9rem; }
  }
}

/* ---- Piano video: transport chrome (in-flow bar) ---- */
.piano-video-chrome {
  flex: 0 0 auto; z-index: 5;
  background: #0e0e12;
  padding: 0.5rem 1rem;
  font-family: 'Roboto Condensed', system-ui, sans-serif;

  &__bar {
    position: relative; height: 10px; border-radius: 999px;
    background: rgba(255, 255, 255, 0.2); cursor: pointer; margin-bottom: 0.75rem;
  }
  &__progress { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: #3c7; }
  &__mark { position: absolute; top: -3px; width: 3px; height: 16px; border-radius: 2px; }
  &__mark--a { background: #fd3; }
  &__mark--b { background: #f63; }

  &__row { display: flex; align-items: center; gap: 0.5rem; }
  &__spacer { flex: 1 1 auto; }
  &__time { color: #ddd; font-variant-numeric: tabular-nums; font-size: 0.95rem; }

  &__btn {
    min-width: 3rem; height: 3rem; padding: 0 0.75rem;
    background: #24242f; color: #f2f2f2; border: 1px solid #34343f;
    border-radius: 10px; font-size: 1rem; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    &:disabled { opacity: 0.4; cursor: default; }
    &.is-arming { border-color: #fd3; color: #fd3; }
    &.is-on { border-color: #3c7; color: #3c7; }
  }
  &__btn--play { min-width: 4.5rem; height: 3.5rem; font-size: 1.3rem; background: #3c7; color: #0e0e12; border-color: #3c7; }
}
```

- [ ] **Step 2: Verify the SCSS compiles via a frontend build**

Run: `cd /opt/Code/DaylightStation && npx vite build 2>&1 | tail -20`
Expected: build completes (look for "built in" with no SCSS error). The large-chunk warning is benign.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "style(piano): course detail + transport chrome styles"
```

---

### Task 14: Wire the collection into piano config

The collection id comes from piano config `videos.plexCollection`. Set it to `plex:675686` for the active piano. The config is served by `GET api/v1/admin/apps/piano/config` and stored in the data volume under the household apps config.

- [ ] **Step 1: Locate the piano config file in the container**

Run:
```bash
sudo docker exec daylight-station sh -c 'ls -la data/household/apps/piano/ 2>/dev/null; echo "---"; grep -rl "plexCollection\|pianos:" data/household 2>/dev/null | head'
```
Expected: prints the piano config path (e.g. `data/household/apps/piano/config.yml`). Note the exact path for the next step.

- [ ] **Step 2: Read the current config**

Run (substitute the path found above):
```bash
sudo docker exec daylight-station sh -c 'cat data/household/apps/piano/config.yml'
```
Expected: shows current piano config. Identify whether `videos:` exists at top level or under a `pianos.<id>:` block.

- [ ] **Step 3: Set `videos.plexCollection: plex:675686`**

Edit the config **by rewriting the whole file** (never `sed -i` on YAML — house rule). Using the current contents from Step 2, write the full file back with the `videos` block set. Example for a top-level `videos`:
```bash
sudo docker exec daylight-station sh -c "cat > data/household/apps/piano/config.yml << 'EOF'
# (paste the full existing config here, with this block set:)
videos:
  plexCollection: plex:675686
EOF"
```
Expected: no output (success). Re-run Step 2's `cat` to confirm the block is present and the rest of the file is intact.

- [ ] **Step 4: Verify the API serves the new value**

Run: `curl -s http://localhost:3111/api/v1/admin/apps/piano/config | grep -o '"plexCollection":"[^"]*"'`
Expected: `"plexCollection":"plex:675686"` (or the resolved value for the active piano).

- [ ] **Step 5: Commit (config lives in the data volume, not git — note the change)**

No code commit. Record the change in the session notes; the data volume is not version-controlled.

---

### Task 15: Full suite, build, deploy, verify

- [ ] **Step 1: Run the full Videos directory suite**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/ --config vitest.config.mjs`
Expected: PASS — all suites green. Capture the pass/fail summary line (not a piped tail's exit code).

- [ ] **Step 2: Build the image**

Run:
```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```
Expected: build succeeds (vite build runs inside).

- [ ] **Step 3: Check the deploy gate, then deploy**

Per `CLAUDE.local.md`, do not redeploy during an active fitness session or live video playback. Check:
```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```
If clear (0 render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`), deploy:
```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```
If the gate is active, pause and ask the user before deploying.

- [ ] **Step 4: Verify on the piano kiosk**

Open the piano kiosk's Videos mode and confirm via logs (don't speculate):
```bash
sudo docker logs --since 2m daylight-station 2>&1 | grep -E 'piano.course-open|piano.video.open|piano.video.resume|piano.video.rate|piano.video.log'
```
Expected: course-open on tapping a course, `piano.video.open` on playing a lecture, `piano.video.rate` when changing speed, `piano.video.playalong` when toggling the keyboard, and periodic `piano.video.log` events. Manually confirm: big pause works, −30/−15/+15/+30 skip, speed cycles 0.5–2×, A then B marks loop and playback loops, resume returns to the saved spot. Play-along: pressing keys on the connected MIDI piano lights the bottom keyboard, streams notes down the waterfall into the keys, renders them on the right grand staff, and the readout names the notes/chord; the 🎹 toggle hides/shows the whole play-along strip (video goes full-size when off).

---

## Self-Review

**Spec coverage:**
- Course → lecture → player browse → Tasks 10 (CourseGrid), 11 (CourseDetail), 12 (Videos controller). ✓
- Custom player chrome (big pause, −30/−15/+15/+30, A–B loop, 0.5–2× speed) → Tasks 1 (rate), 2/6 (loop), 8 (chrome), 9 (player). ✓
- Resume + progress (play/log, watched/in-progress badges) → Tasks 3 (resume/status), 4/7 (watch-log), 11 (badges). ✓
- Compose shared chromeless Player (no FitnessPlayer fork) → Task 9. ✓
- No backend changes; reuse `list/plex`, `fitness/show/{id}/playable`, `play/log` → Tasks 10/11/7. ✓
- No drag sliders, touch targets → Task 8 + Task 13 styles. ✓
- Config `videos.plexCollection = plex:675686` → Task 14. ✓
- Logging at lifecycle/transport/resume → Tasks 7, 9, 10, 11, 12. ✓
- Play-along (keyboard + waterfall + grand staff + note/chord readout + toggle) → Task 7B (chord helper), Task 8 (toggle button), Task 9 (usePianoMidi + PianoKeyboard + NoteWaterfall + CurrentChordStaff + readout + toggle state), Task 13 (layout). Reuses existing `PianoKeyboard`, `NoteWaterfall`, `CurrentChordStaff`. ✓
- Tests (controller flow + pure helpers) → Tasks 1–4, 7B, 8, 12. ✓

**Placeholder scan:** No TBD/TODO in code. Task 14 uses container-discovery commands (the YAML path is environment data, confirmed at runtime in Step 1) — an ops step, not a code placeholder.

**Type/name consistency:** `lectureContentId`/`deriveResumeSeconds`/`lectureStatus` (Task 3) are imported with those exact names in Tasks 9, 11. `nextPianoRate` (1) used in 9. `resolveLoopSeek` (2) used in 6. `buildWatchLogPayload` (4) used in 7. `PianoVideoChrome` prop names match between Task 8 definition and Task 9 call site (`isPlaying, currentTime, duration, rate, loop, onToggle, onSkip, onCycleRate, onMarkA, onMarkB, onClearLoop, onSeek, onBack`). Player ref API (`seek/toggle/getCurrentTime/setPlaybackRate/getMediaElement`) matches `usePlayerController` + `Player.jsx` useImperativeHandle. ✓
