# Piano Spam Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect piano key spam (fist smashing, rapid mashing) and lock out the Piano module for 5 minutes after repeated offenses.

**Architecture:** Pure detection functions in `spamDetection.js` (testable without React), consumed by a `useSpamDetection` hook in PianoVisualizer. Three independent detectors (note count, dense cluster, rapid fire) feed a shared escalation counter: first offense = warning overlay, third offense within 60s = 5-minute blackout via localStorage.

**Tech Stack:** React hooks, vitest (co-located tests following noteUtils.test.js pattern), localStorage for blackout persistence.

---

### Task 1: Write pure detection functions with tests

**Files:**
- Create: `frontend/src/modules/Piano/spamDetection.js`
- Create: `frontend/src/modules/Piano/spamDetection.test.js`

**Step 1: Write failing tests for `detectNoteCountSpam`**

```javascript
// spamDetection.test.js
import { describe, it, expect } from 'vitest';
import { detectNoteCountSpam } from './spamDetection.js';

describe('detectNoteCountSpam', () => {
  it('returns true when 10+ notes are active', () => {
    const notes = new Map(Array.from({ length: 10 }, (_, i) => [60 + i, { velocity: 80 }]));
    expect(detectNoteCountSpam(notes)).toBe(true);
  });

  it('returns false when fewer than 10 notes', () => {
    const notes = new Map(Array.from({ length: 9 }, (_, i) => [60 + i, { velocity: 80 }]));
    expect(detectNoteCountSpam(notes)).toBe(false);
  });

  it('returns false for empty notes', () => {
    expect(detectNoteCountSpam(new Map())).toBe(false);
  });

  it('returns true for 15 notes (forearm smash)', () => {
    const notes = new Map(Array.from({ length: 15 }, (_, i) => [48 + i, { velocity: 100 }]));
    expect(detectNoteCountSpam(notes)).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/spamDetection.test.js`
Expected: FAIL — module not found

**Step 3: Implement `detectNoteCountSpam`**

```javascript
// spamDetection.js

/**
 * Signal A: Too many simultaneous notes.
 * 10+ simultaneous notes = physically impossible with fingers alone.
 * @param {Map<number, object>} activeNotes
 * @returns {boolean}
 */
export function detectNoteCountSpam(activeNotes) {
  return activeNotes.size >= 10;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/spamDetection.test.js`
Expected: PASS

**Step 5: Write failing tests for `detectDenseClusterSpam`**

Add to `spamDetection.test.js`:

```javascript
import { detectDenseClusterSpam } from './spamDetection.js';

describe('detectDenseClusterSpam', () => {
  it('detects white-key fist smash [60-65] as spam', () => {
    // 6 notes, range 5, density = 6/6 = 1.0
    const notes = new Map([[60,{}],[61,{}],[62,{}],[63,{}],[64,{}],[65,{}]]);
    expect(detectDenseClusterSpam(notes)).toBe(true);
  });

  it('detects two-fist smash as spam', () => {
    // 8 notes, range 13, density = 8/14 = 0.57
    const notes = new Map([[60,{}],[61,{}],[62,{}],[63,{}],[66,{}],[68,{}],[70,{}],[73,{}]]);
    expect(detectDenseClusterSpam(notes)).toBe(true);
  });

  it('allows legitimate wide chord', () => {
    // 8 notes across 24 semitones, density = 8/25 = 0.32
    const notes = new Map([[48,{}],[52,{}],[55,{}],[60,{}],[64,{}],[67,{}],[71,{}],[72,{}]]);
    expect(detectDenseClusterSpam(notes)).toBe(false);
  });

  it('allows small chord (below 6 note minimum)', () => {
    // 3 adjacent notes — dense but too few to be spam
    const notes = new Map([[60,{}],[61,{}],[62,{}]]);
    expect(detectDenseClusterSpam(notes)).toBe(false);
  });

  it('allows 5 black keys in one group', () => {
    // 5 notes — below the 6-note threshold
    const notes = new Map([[61,{}],[63,{}],[66,{}],[68,{}],[70,{}]]);
    expect(detectDenseClusterSpam(notes)).toBe(false);
  });

  it('detects 8 black keys smashed across two groups', () => {
    // [Db4,Eb4,Gb4,Ab4,Bb4, Db5,Eb5,Gb5] = [61,63,66,68,70, 73,75,78]
    // 8 notes, range 17, density = 8/18 = 0.44 — below threshold
    // But sliding window of 6 within [61,63,66,68,70,73]: range=12, density=6/13=0.46
    // This is borderline — test documents expected behavior
    const notes = new Map([[61,{}],[63,{}],[66,{}],[68,{}],[70,{}],[73,{}],[75,{}],[78,{}]]);
    // Density never exceeds 0.5 for pure black-key patterns, so this is safe.
    // Black-key spam gets caught by Signal A (10+ notes) or Signal C (rapid fire) instead.
    expect(detectDenseClusterSpam(notes)).toBe(false);
  });

  it('returns false for empty notes', () => {
    expect(detectDenseClusterSpam(new Map())).toBe(false);
  });

  it('detects 7 chromatic notes as spam', () => {
    // 7 notes, range 6, density = 7/7 = 1.0
    const notes = new Map([[60,{}],[61,{}],[62,{}],[63,{}],[64,{}],[65,{}],[66,{}]]);
    expect(detectDenseClusterSpam(notes)).toBe(true);
  });
});
```

**Step 6: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/spamDetection.test.js`
Expected: FAIL — function not exported

**Step 7: Implement `detectDenseClusterSpam`**

Add to `spamDetection.js`:

```javascript
/**
 * Signal B: Dense cluster of notes in a tight pitch range.
 * 6+ notes where noteCount / (pitchRange + 1) > 0.5.
 * Uses a sliding window over sorted pitches to find the densest group.
 * @param {Map<number, object>} activeNotes
 * @returns {boolean}
 */
export function detectDenseClusterSpam(activeNotes) {
  const MIN_NOTES = 6;
  const DENSITY_THRESHOLD = 0.5;

  if (activeNotes.size < MIN_NOTES) return false;

  const pitches = [...activeNotes.keys()].sort((a, b) => a - b);

  // Sliding window: check every group of MIN_NOTES or more consecutive sorted pitches
  for (let windowSize = MIN_NOTES; windowSize <= pitches.length; windowSize++) {
    for (let i = 0; i <= pitches.length - windowSize; i++) {
      const windowPitches = pitches.slice(i, i + windowSize);
      const range = windowPitches[windowPitches.length - 1] - windowPitches[0];
      const density = windowSize / (range + 1);
      if (density > DENSITY_THRESHOLD) return true;
    }
  }

  return false;
}
```

**Step 8: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/spamDetection.test.js`
Expected: PASS

**Step 9: Write failing tests for `detectRapidFireSpam`**

Add to `spamDetection.test.js`:

```javascript
import { detectRapidFireSpam } from './spamDetection.js';

describe('detectRapidFireSpam', () => {
  it('detects 20+ note_on events in 3 seconds', () => {
    const now = Date.now();
    // 20 notes in 2 seconds
    const history = Array.from({ length: 20 }, (_, i) => ({
      note: 60 + (i % 12),
      velocity: 80,
      startTime: now - 2000 + (i * 100),
      endTime: null,
    }));
    expect(detectRapidFireSpam(history, now)).toBe(true);
  });

  it('allows 15 notes in 3 seconds (normal fast playing)', () => {
    const now = Date.now();
    const history = Array.from({ length: 15 }, (_, i) => ({
      note: 60 + (i % 12),
      velocity: 80,
      startTime: now - 2800 + (i * 180),
      endTime: null,
    }));
    expect(detectRapidFireSpam(history, now)).toBe(false);
  });

  it('ignores old notes outside the 3-second window', () => {
    const now = Date.now();
    // 25 notes, but all older than 3 seconds
    const history = Array.from({ length: 25 }, (_, i) => ({
      note: 60 + (i % 12),
      velocity: 80,
      startTime: now - 10000 + (i * 100),
      endTime: null,
    }));
    expect(detectRapidFireSpam(history, now)).toBe(false);
  });

  it('returns false for empty history', () => {
    expect(detectRapidFireSpam([], Date.now())).toBe(false);
  });

  it('detects exactly 20 notes at the boundary', () => {
    const now = Date.now();
    const history = Array.from({ length: 20 }, (_, i) => ({
      note: 60,
      velocity: 80,
      startTime: now - 2999 + (i * 150),
      endTime: null,
    }));
    expect(detectRapidFireSpam(history, now)).toBe(true);
  });
});
```

**Step 10: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/spamDetection.test.js`
Expected: FAIL — function not exported

**Step 11: Implement `detectRapidFireSpam`**

Add to `spamDetection.js`:

```javascript
const RAPID_FIRE_WINDOW_MS = 3000;
const RAPID_FIRE_THRESHOLD = 20;

/**
 * Signal C: Too many note_on events in a short time window.
 * 20+ note_on events within 3 seconds = mashing/banging.
 * @param {Array<{startTime: number}>} noteHistory
 * @param {number} now - current timestamp
 * @returns {boolean}
 */
export function detectRapidFireSpam(noteHistory, now) {
  const windowStart = now - RAPID_FIRE_WINDOW_MS;
  let count = 0;

  // Iterate backwards since recent notes are at the end
  for (let i = noteHistory.length - 1; i >= 0; i--) {
    if (noteHistory[i].startTime < windowStart) break;
    count++;
  }

  return count >= RAPID_FIRE_THRESHOLD;
}
```

**Step 12: Run all tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/spamDetection.test.js`
Expected: ALL PASS

**Step 13: Commit**

```bash
git add frontend/src/modules/Piano/spamDetection.js frontend/src/modules/Piano/spamDetection.test.js
git commit -m "feat(piano): add pure spam detection functions with tests

Three independent detectors: note count (10+), dense cluster (6+ notes
at >0.5 density), and rapid fire (20+ notes in 3s)."
```

---

### Task 2: Write the `useSpamDetection` hook

**Files:**
- Create: `frontend/src/modules/Piano/useSpamDetection.js`

**Step 1: Create the hook**

This hook wires the three detectors into React state with debouncing, escalation counter, warning timer, and localStorage blackout persistence.

```javascript
// useSpamDetection.js
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import { detectNoteCountSpam, detectDenseClusterSpam, detectRapidFireSpam } from './spamDetection.js';

const BLACKOUT_KEY = 'piano-spam-blackout';
const BLACKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const WARNING_DISPLAY_MS = 3000;
const ESCALATION_WINDOW_MS = 60000;
const STRIKES_TO_BLACKOUT = 3;

function getBlackoutRemaining() {
  const stored = localStorage.getItem(BLACKOUT_KEY);
  if (!stored) return 0;
  const remaining = Number(stored) - Date.now();
  if (remaining <= 0) {
    localStorage.removeItem(BLACKOUT_KEY);
    return 0;
  }
  return remaining;
}

/**
 * Top-level spam detection for PianoVisualizer.
 * Monitors activeNotes and noteHistory for spam patterns.
 * Returns spam state for rendering warning/blackout overlays.
 *
 * @param {Map<number, object>} activeNotes
 * @param {Array} noteHistory
 * @returns {{ spamState: string, warningVisible: boolean, blackoutRemaining: number, spamEventCount: number }}
 */
export function useSpamDetection(activeNotes, noteHistory) {
  const logger = useMemo(() => getChildLogger({ component: 'spam-detection' }), []);

  const [warningVisible, setWarningVisible] = useState(false);
  const [blackoutRemaining, setBlackoutRemaining] = useState(() => getBlackoutRemaining());

  // Spam event timestamps within escalation window
  const spamEventsRef = useRef([]);
  const [spamEventCount, setSpamEventCount] = useState(0);

  // Debounce refs — prevent re-triggering until condition clears
  const noteCountFiredRef = useRef(false);
  const denseClusterFiredRef = useRef(false);
  const rapidFireCooldownRef = useRef(0);

  // Warning dismiss timer
  const warningTimerRef = useRef(null);

  const triggerBlackout = useCallback(() => {
    const expiresAt = Date.now() + BLACKOUT_DURATION_MS;
    localStorage.setItem(BLACKOUT_KEY, String(expiresAt));
    setBlackoutRemaining(BLACKOUT_DURATION_MS);
    logger.warn('spam.blackout', { duration_ms: BLACKOUT_DURATION_MS });
  }, [logger]);

  const recordSpamEvent = useCallback((signal) => {
    const now = Date.now();
    logger.warn('spam.detected', { signal });

    // Prune old events
    spamEventsRef.current = spamEventsRef.current.filter(
      t => now - t < ESCALATION_WINDOW_MS
    );
    spamEventsRef.current.push(now);
    const count = spamEventsRef.current.length;
    setSpamEventCount(count);

    if (count >= STRIKES_TO_BLACKOUT) {
      triggerBlackout();
      spamEventsRef.current = [];
      setSpamEventCount(0);
      return;
    }

    // Show warning
    setWarningVisible(true);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    warningTimerRef.current = setTimeout(() => setWarningVisible(false), WARNING_DISPLAY_MS);
  }, [triggerBlackout, logger]);

  // ─── Signal A: Note count ─────────────────────────────────
  useEffect(() => {
    if (blackoutRemaining > 0) return;
    const isSpam = detectNoteCountSpam(activeNotes);
    if (isSpam && !noteCountFiredRef.current) {
      noteCountFiredRef.current = true;
      recordSpamEvent('note-count');
    } else if (!isSpam) {
      noteCountFiredRef.current = false;
    }
  }, [activeNotes, blackoutRemaining, recordSpamEvent]);

  // ─── Signal B: Dense cluster ──────────────────────────────
  useEffect(() => {
    if (blackoutRemaining > 0) return;
    const isSpam = detectDenseClusterSpam(activeNotes);
    if (isSpam && !denseClusterFiredRef.current) {
      denseClusterFiredRef.current = true;
      recordSpamEvent('dense-cluster');
    } else if (!isSpam) {
      denseClusterFiredRef.current = false;
    }
  }, [activeNotes, blackoutRemaining, recordSpamEvent]);

  // ─── Signal C: Rapid fire ─────────────────────────────────
  useEffect(() => {
    if (blackoutRemaining > 0) return;
    const now = Date.now();
    if (now < rapidFireCooldownRef.current) return;
    const isSpam = detectRapidFireSpam(noteHistory, now);
    if (isSpam) {
      rapidFireCooldownRef.current = now + 3000;
      recordSpamEvent('rapid-fire');
    }
  }, [noteHistory, blackoutRemaining, recordSpamEvent]);

  // ─── Blackout countdown ticker ────────────────────────────
  useEffect(() => {
    if (blackoutRemaining <= 0) return;
    const interval = setInterval(() => {
      const remaining = getBlackoutRemaining();
      setBlackoutRemaining(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [blackoutRemaining > 0]);

  // ─── Cleanup ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };
  }, []);

  const spamState = blackoutRemaining > 0 ? 'blackout' : warningVisible ? 'warning' : 'clear';

  return { spamState, warningVisible, blackoutRemaining, spamEventCount };
}
```

**Step 2: Verify the module imports correctly**

Run: `npx vitest run frontend/src/modules/Piano/spamDetection.test.js`
Expected: Still PASS (no regression from new file)

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/useSpamDetection.js
git commit -m "feat(piano): add useSpamDetection hook

Wires three detection signals into React state with debouncing,
escalation counter (3 strikes in 60s), warning timer (3s),
and localStorage-persisted 5-minute blackout."
```

---

### Task 3: Add warning and blackout overlays to PianoVisualizer

**Files:**
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`
- Modify: `frontend/src/modules/Piano/PianoVisualizer.scss`

**Step 1: Import and wire `useSpamDetection` into PianoVisualizer**

In `PianoVisualizer.jsx`, add the import at the top (after other hook imports around line 13):

```javascript
import { useSpamDetection } from './useSpamDetection.js';
```

Inside the `PianoVisualizer` component function, after the `useMidiSubscription()` call (line 22), add:

```javascript
const { spamState, warningVisible, blackoutRemaining, spamEventCount } = useSpamDetection(activeNotes, noteHistory);
```

**Step 2: Add blackout guard — render blackout overlay instead of normal content**

Wrap the existing return JSX. If `spamState === 'blackout'`, render only the blackout countdown. Replace the entire `return (...)` block (lines 54-114) with:

```jsx
if (spamState === 'blackout') {
  const mins = Math.floor(blackoutRemaining / 60000);
  const secs = Math.floor((blackoutRemaining % 60000) / 1000);
  return (
    <div className="piano-visualizer">
      <div className="spam-blackout-overlay">
        <div className="blackout-content">
          <div className="blackout-icon">&#x1f6ab;</div>
          <h1>Piano Locked</h1>
          <p className="blackout-timer">{mins}:{String(secs).padStart(2, '0')}</p>
          <p className="blackout-message">Please be gentle with the piano.</p>
        </div>
      </div>
    </div>
  );
}

return (
  <div className={`piano-visualizer${isFullscreenGame ? ' tetris-mode' : ''}`}>
    {warningVisible && (
      <div className="spam-warning-overlay">
        <div className="warning-content">
          <h2>Easy on the keys!</h2>
          <p>Warning {spamEventCount} of {3}</p>
        </div>
      </div>
    )}
    {/* ... rest of existing JSX unchanged ... */}
  </div>
);
```

The warning overlay is placed inside the existing container div, just before the `piano-header`. Keep all existing JSX intact below it.

**Step 3: Add SCSS for overlays**

Append to `PianoVisualizer.scss` (inside the `.piano-visualizer` block, before the closing `}`):

```scss
  // ─── Spam Detection Overlays ────────────────────────────────
  .spam-warning-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(180, 60, 20, 0.85);
    pointer-events: none;

    .warning-content {
      text-align: center;
      color: #fff;

      h2 {
        font-size: 3rem;
        margin: 0 0 0.5rem;
      }

      p {
        font-size: 1.2rem;
        opacity: 0.8;
      }
    }
  }

  .spam-blackout-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #111;

    .blackout-content {
      text-align: center;
      color: #666;

      .blackout-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
      }

      h1 {
        font-size: 2.5rem;
        margin: 0 0 1rem;
        color: #888;
      }

      .blackout-timer {
        font-size: 5rem;
        font-variant-numeric: tabular-nums;
        color: #cc4444;
        margin: 0 0 1rem;
      }

      .blackout-message {
        font-size: 1rem;
        opacity: 0.5;
      }
    }
  }
```

**Step 4: Verify the app compiles**

Run: `npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds without errors

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoVisualizer.jsx frontend/src/modules/Piano/PianoVisualizer.scss
git commit -m "feat(piano): add spam warning and blackout overlays

Warning overlay shows on first spam detection, auto-dismisses in 3s.
Blackout overlay shows 5-minute countdown after 3 strikes in 60s.
Blackout persists in localStorage across page reloads."
```

---

### Task 4: Manual testing and edge-case verification

**Step 1: Start dev server if not running**

Run: `lsof -i :3111` — if nothing, run `npm run dev`

**Step 2: Test with dev keyboard**

Open the Piano module in browser. The dev keyboard (number keys 1-0, -, =) only maps 12 keys, so Signal A (10+) requires holding most of them simultaneously. Test:

1. Rapidly tap all number keys to trigger Signal C (rapid fire)
2. Verify warning overlay appears and dismisses after 3 seconds
3. Trigger 3 times within 60 seconds — verify blackout screen appears
4. Refresh page — verify blackout persists (localStorage)
5. Wait 5 minutes or manually clear `localStorage.removeItem('piano-spam-blackout')` — verify recovery

**Step 3: Verify no game regressions**

1. Open Piano, activate a game via backtick
2. Play normally — no false spam warnings
3. Exit game — Piano returns to normal

**Step 4: Commit the design doc update if any changes were needed**

```bash
git add docs/plans/2026-03-03-piano-spam-detection.md
git commit -m "docs: finalize piano spam detection design"
```
