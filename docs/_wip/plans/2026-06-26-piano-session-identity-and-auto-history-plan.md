# Piano: session identity + always-on MIDI history — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an idle gap the piano re-prompts "Who's playing?" (dismiss → Guest) so practice credits the right player, and a browser-side recorder writes silence/player-segmented `.mid` files to `data/household/history/piano/{user}/{date}/`.

**Architecture:** Two phases. **A (identity):** a `useWhoIsPlaying` idle-gap hook + a presentational `WhoIsPlayingPrompt` (roster faces only) at `PianoShell`, plus a `guest` sentinel in `PianoUserContext`. **B (history):** a pure node SMF encoder + a `PUT …/history/:date/:takeId` endpoint (idempotent full-file overwrite), driven by a `useAutoMidiHistory` hook that captures the live Web-MIDI stream, segments on silence/player-change, drops tiny takes, and flushes full-state on a cadence. Browser-side because the piano is BLE-paired to the tablet (a host daemon can't see the MIDI).

**Tech Stack:** React (hooks/context), vitest + @testing-library/react, Express + supertest, `#system/utils/FileIO.mjs`, `configService`. Spec: `docs/_wip/plans/2026-06-26-piano-session-identity-and-auto-history.md`.

---

## File structure

**Phase A**
- Modify `frontend/src/modules/Piano/PianoKiosk/PianoUserContext.jsx` — guest sentinel via a pure `resolveProfile` helper.
- Create `frontend/src/modules/Piano/PianoKiosk/PianoAvatar.jsx` — extracted round avatar (shared by chip + prompt).
- Modify `frontend/src/modules/Piano/PianoKiosk/PianoUserChip.jsx` — use the extracted avatar.
- Create `frontend/src/modules/Piano/PianoKiosk/whoIsPlaying.js` + `.test.js` — pure gap decision.
- Create `frontend/src/modules/Piano/PianoKiosk/useWhoIsPlaying.js` — the hook (thin wiring).
- Create `frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx` + `.test.jsx`.
- Modify `frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx` + `PianoConfig.test.js` — new config fields.
- Modify `frontend/src/Apps/PianoApp.jsx` — wire `useWhoIsPlaying` + render the prompt in `PianoShell`.

**Phase B**
- Create `backend/src/3_applications/piano/midiFile.mjs` + `midiFile.test.mjs` — SMF encoder.
- Modify `backend/src/4_api/v1/routers/piano.mjs` — `PUT …/history/:date/:takeId`.
- Create `backend/src/4_api/v1/routers/piano.history.test.mjs` — endpoint test.
- Create `frontend/src/modules/Piano/PianoKiosk/autoHistory.js` + `.test.js` — pure take helpers.
- Create `frontend/src/modules/Piano/PianoKiosk/useAutoMidiHistory.js` — the capture hook.
- Modify `frontend/src/Apps/PianoApp.jsx` — wire `useAutoMidiHistory` in `PianoShell`.

Run a single frontend test: `npx vitest run <path> --no-color`. Backend test: `npx vitest run <path> --no-color`.

---

# PHASE A — Who's-playing identity

### Task A1: Guest sentinel in PianoUserContext

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/pianoUser.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/pianoUser.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoUserContext.jsx`

- [ ] **Step 1: Write the failing test** — `pianoUser.test.js`

```js
import { describe, it, expect } from 'vitest';
import { GUEST_PROFILE, resolveProfile } from './pianoUser.js';

describe('resolveProfile', () => {
  const users = [{ id: 'kc', name: 'KC' }, { id: 'user_3', name: 'User_3' }];
  it('returns the roster match for a known user', () => {
    expect(resolveProfile(users, 'user_3')).toEqual({ id: 'user_3', name: 'User_3' });
  });
  it('returns the synthetic Guest profile for "guest" (never from the roster)', () => {
    expect(resolveProfile(users, 'guest')).toEqual(GUEST_PROFILE);
    expect(users.some((u) => u.id === 'guest')).toBe(false);
  });
  it('returns null when the id is unknown / unset', () => {
    expect(resolveProfile(users, 'nobody')).toBeNull();
    expect(resolveProfile(users, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './pianoUser.js'`)

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/pianoUser.test.js --no-color`

- [ ] **Step 3: Implement** — `pianoUser.js`

```js
// Guest is the dismiss-outcome identity — NEVER a roster entry / pick option.
export const GUEST_PROFILE = { id: 'guest', name: 'Guest' };

/** Resolve the active profile: roster match, or the synthetic Guest for 'guest', else null. */
export function resolveProfile(users, currentUser) {
  if (currentUser === GUEST_PROFILE.id) return GUEST_PROFILE;
  if (!currentUser) return null;
  return (users || []).find((u) => u.id === currentUser) || null;
}
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Wire into the context** — in `PianoUserContext.jsx`, import the helper and replace the `currentProfile` memo. (Guest is recognized by `currentUser`, never added to `users`.)

```js
// add to imports
import { resolveProfile } from './pianoUser.js';

// replace the existing currentProfile useMemo with:
const currentProfile = useMemo(
  () => resolveProfile(users, currentUser),
  [users, currentUser],
);
```

- [ ] **Step 6: Run the existing context-dependent test to confirm no regression**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoSoundContext.test.jsx --no-color`
Expected: PASS (unrelated, sanity).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/pianoUser.js frontend/src/modules/Piano/PianoKiosk/pianoUser.test.js frontend/src/modules/Piano/PianoKiosk/PianoUserContext.jsx
git commit -m "feat(piano): guest sentinel profile (resolveProfile)"
```

---

### Task A2: Pure idle-gap decision + useWhoIsPlaying hook

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/whoIsPlaying.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/whoIsPlaying.test.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/useWhoIsPlaying.js`

- [ ] **Step 1: Write the failing test** — `whoIsPlaying.test.js`

```js
import { describe, it, expect } from 'vitest';
import { firesOnGap } from './whoIsPlaying.js';

describe('firesOnGap', () => {
  const THRESH = 120000; // 2 min
  it('fires when input resumes after >= threshold of inactivity', () => {
    expect(firesOnGap(1_000, 1_000 + THRESH, THRESH)).toBe(true);
    expect(firesOnGap(1_000, 1_000 + THRESH + 5, THRESH)).toBe(true);
  });
  it('does not fire within the threshold', () => {
    expect(firesOnGap(1_000, 1_000 + THRESH - 1, THRESH)).toBe(false);
  });
  it('is disabled at threshold <= 0', () => {
    expect(firesOnGap(0, 9_999_999, 0)).toBe(false);
    expect(firesOnGap(0, 9_999_999, -1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/whoIsPlaying.test.js --no-color`

- [ ] **Step 3: Implement** — `whoIsPlaying.js`

```js
/**
 * Decide whether an input arriving at `nowMs` (after the last input at
 * `lastMs`) should trigger the "who's playing?" prompt: true iff the idle gap
 * reached the threshold. `thresholdMs <= 0` disables the feature.
 */
export function firesOnGap(lastMs, nowMs, thresholdMs) {
  if (!(thresholdMs > 0)) return false;
  return nowMs - lastMs >= thresholdMs;
}
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Implement the hook** — `useWhoIsPlaying.js`

```js
import { useEffect, useRef } from 'react';
import { firesOnGap } from './whoIsPlaying.js';

/**
 * useWhoIsPlaying — after `timeoutMinutes` with no input, the NEXT input (a MIDI
 * note OR a screen touch/keydown) calls `onIdleGap` once. Mirrors the idle
 * signals of useInactivityReturn. Disabled when timeoutMinutes <= 0.
 *
 * @param {Map}    activeNotes  live notes (identity changes = MIDI activity)
 * @param {number} historyLen   noteHistory length (grows per note = activity)
 * @param {number} timeoutMinutes  gap threshold in minutes
 * @param {() => void} onIdleGap
 */
export function useWhoIsPlaying(activeNotes, historyLen, timeoutMinutes, onIdleGap) {
  const lastRef = useRef(Date.now());
  const onGapRef = useRef(onIdleGap);
  onGapRef.current = onIdleGap;
  const thresholdMs = (timeoutMinutes || 0) * 60_000;

  // One place to evaluate an input event: fire if the gap qualifies, then stamp.
  const onInput = useRef(() => {});
  onInput.current = () => {
    const now = Date.now();
    if (firesOnGap(lastRef.current, now, thresholdMs)) onGapRef.current?.();
    lastRef.current = now;
  };

  // MIDI activity: any change to activeNotes / historyLen is an input.
  useEffect(() => {
    if (thresholdMs <= 0) return;
    onInput.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNotes, historyLen]);

  // Touch / keyboard activity.
  useEffect(() => {
    if (thresholdMs <= 0) return undefined;
    const bump = () => onInput.current();
    window.addEventListener('pointerdown', bump, true);
    window.addEventListener('keydown', bump, true);
    return () => {
      window.removeEventListener('pointerdown', bump, true);
      window.removeEventListener('keydown', bump, true);
    };
  }, [thresholdMs]);
}

export default useWhoIsPlaying;
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/whoIsPlaying.js frontend/src/modules/Piano/PianoKiosk/whoIsPlaying.test.js frontend/src/modules/Piano/PianoKiosk/useWhoIsPlaying.js
git commit -m "feat(piano): useWhoIsPlaying idle-gap hook + pure firesOnGap"
```

---

### Task A3: Extract PianoAvatar (shared)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/PianoAvatar.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoUserChip.jsx`

- [ ] **Step 1: Create `PianoAvatar.jsx`** (lifted verbatim from `PianoUserChip`'s `Avatar`)

```jsx
import { useState } from 'react';

/** Round avatar — user image, falling back to initials on a colour from the id. */
export default function PianoAvatar({ id, name }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (failed || !id) {
    return <span className="piano-avatar piano-avatar--fallback" data-initials={initials}>{initials}</span>;
  }
  return (
    <img className="piano-avatar" src={`/api/v1/static/img/users/${id}`} alt={name} onError={() => setFailed(true)} />
  );
}
```

- [ ] **Step 2: Update `PianoUserChip.jsx`** — delete its local `Avatar` function and import the shared one:

```jsx
// replace `import { useState, useContext } from 'react';` usage of local Avatar:
import { useState, useContext } from 'react';
import PianoUserContext from './PianoUserContext.jsx';
import PianoAvatar from './PianoAvatar.jsx';
// ...delete the local `function Avatar({ id, name }) {...}` block...
// ...replace every `<Avatar ... />` with `<PianoAvatar ... />`...
```

- [ ] **Step 3: Run the chip-adjacent test for regression**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk --no-color`
Expected: PASS (no chip test exists; this confirms nothing else broke). NOTE: 2 pre-existing failures in `Videos.test.jsx` are unrelated WIP — ignore them.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoAvatar.jsx frontend/src/modules/Piano/PianoKiosk/PianoUserChip.jsx
git commit -m "refactor(piano): extract PianoAvatar shared by chip + prompt"
```

---

### Task A4: WhoIsPlayingPrompt component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx`

- [ ] **Step 1: Write the failing test** — `WhoIsPlayingPrompt.test.jsx`

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import WhoIsPlayingPrompt from './WhoIsPlayingPrompt.jsx';

const users = [{ id: 'kc', name: 'KC' }, { id: 'user_3', name: 'User_3' }];
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('WhoIsPlayingPrompt', () => {
  it('renders only roster faces — never a Guest card', () => {
    render(<WhoIsPlayingPrompt open users={users} onPick={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('KC')).toBeTruthy();
    expect(screen.getByText('User_3')).toBeTruthy();
    expect(screen.queryByText('Guest')).toBeNull();
  });
  it('tapping a face calls onPick with that id', () => {
    const onPick = vi.fn();
    render(<WhoIsPlayingPrompt open users={users} onPick={onPick} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('User_3'));
    expect(onPick).toHaveBeenCalledWith('user_3');
  });
  it('the ✕ / backdrop dismiss calls onDismiss (→ caller sets Guest)', () => {
    const onDismiss = vi.fn();
    render(<WhoIsPlayingPrompt open users={users} onPick={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
  it('auto-dismisses after timeoutMs', () => {
    const onDismiss = vi.fn();
    render(<WhoIsPlayingPrompt open users={users} onPick={() => {}} onDismiss={onDismiss} timeoutMs={30000} />);
    act(() => { vi.advanceTimersByTime(30000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
  it('renders nothing when closed', () => {
    const { container } = render(<WhoIsPlayingPrompt open={false} users={users} onPick={() => {}} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx --no-color`

- [ ] **Step 3: Implement** — `WhoIsPlayingPrompt.jsx`

```jsx
import { useEffect, useRef } from 'react';
import PianoAvatar from './PianoAvatar.jsx';

/**
 * "Who's playing?" prompt — roster faces ONLY (Guest is never a card). Tap a
 * face → onPick(id). The ✕ / backdrop / timeout → onDismiss (the caller sets
 * the player to Guest). Presentational; the parent owns identity side-effects.
 */
export default function WhoIsPlayingPrompt({ open, users = [], onPick, onDismiss, timeoutMs = 30000 }) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open || !(timeoutMs > 0)) return undefined;
    const t = setTimeout(() => onDismissRef.current?.(), timeoutMs);
    return () => clearTimeout(t);
  }, [open, timeoutMs]);

  if (!open) return null;
  return (
    <div className="piano-userpicker piano-userpicker--prompt" role="dialog" aria-modal="true" aria-label="Who's playing?">
      <div className="piano-userpicker__scrim" onClick={() => onDismiss?.()} />
      <div className="piano-userpicker__sheet">
        <button type="button" className="piano-userpicker__close" aria-label="Close" onClick={() => onDismiss?.()}>✕</button>
        <h2 className="piano-userpicker__title">Who’s playing?</h2>
        <ul className="piano-userpicker__grid">
          {users.map((u) => (
            <li key={u.id}>
              <button type="button" className="piano-usercard" onClick={() => onPick?.(u.id)}>
                <PianoAvatar id={u.id} name={u.name} />
                <span className="piano-usercard__name">{u.name}</span>
                {u.group_label && <span className="piano-usercard__label">{u.group_label}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx
git commit -m "feat(piano): WhoIsPlayingPrompt (roster faces only; dismiss = Guest)"
```

---

### Task A5: Config — whoIsPlayingMinutes + autoRecord

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js`

- [ ] **Step 1: Add the failing assertions** to `PianoConfig.test.js` (inside the existing `resolvePianoConfig` describe):

```js
it('resolves who-is-playing + auto-record defaults and per-piano overrides', () => {
  const base = resolvePianoConfig({}, 'default');
  expect(base.whoIsPlayingMinutes).toBe(2);
  expect(base.autoRecord).toEqual({ enabled: false, silenceSeconds: 25, minNotes: 5, minSeconds: 3, flushSeconds: 12 });

  const over = resolvePianoConfig(
    { whoIsPlayingMinutes: 5, autoRecord: { enabled: true, minNotes: 8 } },
    'default',
  );
  expect(over.whoIsPlayingMinutes).toBe(5);
  expect(over.autoRecord).toEqual({ enabled: true, silenceSeconds: 25, minNotes: 8, minSeconds: 3, flushSeconds: 12 });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js --no-color`

- [ ] **Step 3: Implement** — in `PianoConfig.jsx`:

Add to `PIANO_CONFIG_DEFAULTS` (after `inactivityMinutes: 10,`):

```js
  // Re-prompt "who's playing?" after this many idle minutes (0 disables).
  whoIsPlayingMinutes: 2,
  // Always-on MIDI history (disabled by default — opt in per piano).
  autoRecord: { enabled: false, silenceSeconds: 25, minNotes: 5, minSeconds: 3, flushSeconds: 12 },
```

Add a resolver helper near `resolveScreensaver`:

```js
/** Resolve auto-record config: per-piano over shared over defaults (field-wise). */
export function resolveAutoRecord(shared, p) {
  const s = shared.autoRecord || {};
  const ps = p.autoRecord || {};
  const d = PIANO_CONFIG_DEFAULTS.autoRecord;
  return {
    enabled: ps.enabled ?? s.enabled ?? d.enabled,
    silenceSeconds: ps.silenceSeconds ?? s.silenceSeconds ?? d.silenceSeconds,
    minNotes: ps.minNotes ?? s.minNotes ?? d.minNotes,
    minSeconds: ps.minSeconds ?? s.minSeconds ?? d.minSeconds,
    flushSeconds: ps.flushSeconds ?? s.flushSeconds ?? d.flushSeconds,
  };
}
```

In `resolvePianoConfig`'s returned object (after `inactivityMinutes:` line):

```js
    whoIsPlayingMinutes: p.whoIsPlayingMinutes ?? shared.whoIsPlayingMinutes ?? PIANO_CONFIG_DEFAULTS.whoIsPlayingMinutes,
    autoRecord: resolveAutoRecord(shared, p),
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js
git commit -m "feat(piano): config — whoIsPlayingMinutes + autoRecord"
```

---

### Task A6: Wire identity into PianoShell

**Files:**
- Modify: `frontend/src/Apps/PianoApp.jsx` (the `PianoShell` component, ~lines 96-151)

- [ ] **Step 1: Add imports** (top of `PianoApp.jsx`):

```js
import { useState } from 'react';                                   // ensure useState is imported
import { usePianoUser } from '../modules/Piano/PianoKiosk/PianoUserContext.jsx';
import { useWhoIsPlaying } from '../modules/Piano/PianoKiosk/useWhoIsPlaying.js';
import WhoIsPlayingPrompt from '../modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx';
```

- [ ] **Step 2: In `PianoShell`, after the existing `usePianoPlayback()` line**, add identity wiring:

```js
  const { users, setCurrentUser } = usePianoUser();
  const [whoOpen, setWhoOpen] = useState(false);

  // Re-prompt "who's playing?" after an idle gap so the next player is credited.
  useWhoIsPlaying(activeNotes, noteHistory.length, config.whoIsPlayingMinutes, () => {
    logger.info('piano.who-is-playing.prompt', { pianoId });
    setWhoOpen(true);
  });
```

- [ ] **Step 3: Render the prompt** inside the returned `<div className="piano-app">`, just before `<PianoChrome ... />`:

```jsx
          <WhoIsPlayingPrompt
            open={whoOpen}
            users={users}
            onPick={(id) => { setCurrentUser(id); setWhoOpen(false); }}
            onDismiss={() => { setCurrentUser('guest'); setWhoOpen(false); }}
          />
```

- [ ] **Step 4: Build sanity** (no unit test for wiring):

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/useWhoIsPlaying.test.js frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.test.jsx --no-color`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Apps/PianoApp.jsx
git commit -m "feat(piano): wire who's-playing re-prompt into PianoShell"
```

**End of Phase A — shippable on its own.** Deploy + verify the prompt fires after the configured idle gap and dismiss → Guest.

---

# PHASE B — Always-on MIDI history

### Task B1: SMF (.mid) encoder (backend, pure)

**Files:**
- Create: `backend/src/3_applications/piano/midiFile.mjs`
- Create: `backend/src/3_applications/piano/midiFile.test.mjs`

- [ ] **Step 1: Write the failing test** — `midiFile.test.mjs`

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { encodeMidiFile } from './midiFile.mjs';

const events = [
  { t: 0,   type: 'note_on',  note: 60, velocity: 100 },
  { t: 500, type: 'note_off', note: 60, velocity: 0 },
];

describe('encodeMidiFile', () => {
  it('produces a valid format-0 SMF (MThd + MTrk)', () => {
    const buf = encodeMidiFile(events, { ppq: 480, bpm: 120 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString('ascii')).toBe('MThd');
    expect(buf.readUInt32BE(4)).toBe(6);           // header length
    expect(buf.readUInt16BE(8)).toBe(0);           // format 0
    expect(buf.readUInt16BE(10)).toBe(1);          // 1 track
    expect(buf.readUInt16BE(12)).toBe(480);        // division (ppq)
    const mtrkAt = buf.indexOf(Buffer.from('MTrk', 'ascii'));
    expect(mtrkAt).toBeGreaterThan(0);
  });
  it('emits note-on (0x90) and note-off (0x80) for the channel', () => {
    const buf = encodeMidiFile(events, { ppq: 480, bpm: 120 });
    expect(buf.includes(Buffer.from([0x90, 60, 100]))).toBe(true);  // note on C4
    expect(buf.includes(Buffer.from([0x80, 60, 0]))).toBe(true);    // note off C4
  });
  it('ends with the End-of-Track meta (FF 2F 00)', () => {
    const buf = encodeMidiFile(events, {});
    expect(buf.slice(-3).equals(Buffer.from([0xff, 0x2f, 0x00]))).toBe(true);
  });
  it('an empty event list still yields a valid (silent) track', () => {
    const buf = encodeMidiFile([], {});
    expect(buf.slice(0, 4).toString('ascii')).toBe('MThd');
    expect(buf.slice(-3).equals(Buffer.from([0xff, 0x2f, 0x00]))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run backend/src/3_applications/piano/midiFile.test.mjs --no-color`

- [ ] **Step 3: Implement** — `midiFile.mjs`

```js
/**
 * encodeMidiFile — turn a take's relative-time events into Standard MIDI File
 * bytes (format 0, single track). Pure; no I/O.
 *
 * @param {Array<{t:number,type:'note_on'|'note_off',note:number,velocity:number}>} events
 *        t = ms from take start.
 * @param {{ ppq?:number, bpm?:number, channel?:number }} [opts]
 * @returns {Buffer}
 */
export function encodeMidiFile(events = [], { ppq = 480, bpm = 120, channel = 0 } = {}) {
  const ticksPerMs = (ppq * bpm) / 60000;
  const sorted = [...events].sort((a, b) => a.t - b.t);

  const track = [];
  // Tempo meta at t=0: FF 51 03 <usPerQuarter>
  const usPerQuarter = Math.round(60000000 / bpm);
  pushVarLen(track, 0);
  track.push(0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);

  let lastTick = 0;
  for (const e of sorted) {
    const tick = Math.max(0, Math.round(e.t * ticksPerMs));
    pushVarLen(track, tick - lastTick);
    lastTick = tick;
    const status = (e.type === 'note_on' ? 0x90 : 0x80) | (channel & 0x0f);
    track.push(status, e.note & 0x7f, (e.type === 'note_on' ? (e.velocity ?? 0) : 0) & 0x7f);
  }
  // End of track
  pushVarLen(track, 0);
  track.push(0xff, 0x2f, 0x00);

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
  const trkLen = track.length;
  const trkHeader = [0x4d, 0x54, 0x72, 0x6b, (trkLen >> 24) & 0xff, (trkLen >> 16) & 0xff, (trkLen >> 8) & 0xff, trkLen & 0xff];
  return Buffer.from([...header, ...trkHeader, ...track]);
}

/** Append a MIDI variable-length quantity (big-endian, 7 bits/byte). */
function pushVarLen(arr, value) {
  let v = Math.max(0, value | 0);
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7; }
  for (const b of bytes) arr.push(b);
}

export default encodeMidiFile;
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/piano/midiFile.mjs backend/src/3_applications/piano/midiFile.test.mjs
git commit -m "feat(piano): pure SMF encoder (events -> .mid bytes)"
```

---

### Task B2: History PUT endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs`
- Create: `backend/src/4_api/v1/routers/piano.history.test.mjs`

- [ ] **Step 1: Write the failing test** — `piano.history.test.mjs`

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const written = [];
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: () => null, saveYaml: () => {}, listYamlFiles: () => [], deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn((p, buf) => { written.push({ path: p, bytes: buf.length }); }),
}));
vi.mock('#system/config/UserService.mjs', () => ({ userService: { hydrateUsers: () => [] } }));
vi.mock('#domains/core/utils/id.mjs', () => ({ shortId: () => 'x' }));

import { createPianoRouter } from './piano.mjs';

const configService = {
  getDefaultHouseholdId: () => 'default',
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getUserProfile: (id) => (['kc', 'user_3'].includes(id) ? { id } : null),
  getUserDir: (id) => `/data/users/${id}`,
  getHouseholdAppConfig: () => ({}),
};

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1/piano', createPianoRouter({ configService, logger: { info() {}, error() {} } }));
  return a;
}

const body = { events: [{ t: 0, type: 'note_on', note: 60, velocity: 90 }, { t: 100, type: 'note_off', note: 60, velocity: 0 }], startedAt: '2026-06-26T10:00:00.000Z', durationMs: 100 };

beforeEach(() => { written.length = 0; });

describe('PUT /users/:userId/history/:date/:takeId', () => {
  it('writes a .mid for a known user at the household history path', async () => {
    const res = await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/10.00.00').send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0].path).toBe('/data/household/history/piano/kc/2026-06-26/10.00.00.mid');
    expect(written[0].bytes).toBeGreaterThan(20);
  });
  it('accepts the guest user', async () => {
    const res = await request(app()).put('/api/v1/piano/users/guest/history/2026-06-26/10.00.00').send(body);
    expect(res.status).toBe(200);
    expect(written[0].path).toBe('/data/household/history/piano/guest/2026-06-26/10.00.00.mid');
  });
  it('rejects an unknown user (not guest)', async () => {
    const res = await request(app()).put('/api/v1/piano/users/nobody/history/2026-06-26/10.00.00').send(body);
    expect(res.status).toBe(400);
  });
  it('rejects a bad date / takeId', async () => {
    expect((await request(app()).put('/api/v1/piano/users/kc/history/2026_06_26/10.00.00').send(body)).status).toBe(400);
    expect((await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/..%2Fx').send(body)).status).toBe(400);
  });
  it('requires a non-empty events array', async () => {
    const res = await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/10.00.00').send({ events: [] });
    expect(res.status).toBe(400);
  });
  it('is idempotent — a second PUT overwrites the same path', async () => {
    await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/10.00.00').send(body);
    await request(app()).put('/api/v1/piano/users/kc/history/2026-06-26/10.00.00').send(body);
    expect(written.map((w) => w.path)).toEqual([
      '/data/household/history/piano/kc/2026-06-26/10.00.00.mid',
      '/data/household/history/piano/kc/2026-06-26/10.00.00.mid',
    ]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (route 404 → status not 200)

Run: `npx vitest run backend/src/4_api/v1/routers/piano.history.test.mjs --no-color`

- [ ] **Step 3: Implement** — in `piano.mjs`:

Add to the FileIO import:

```js
import {
  loadYaml,
  saveYaml,
  listYamlFiles,
  deleteYaml,
  ensureDir,
  writeBinary,
} from '#system/utils/FileIO.mjs';
import path from 'path';
import { encodeMidiFile } from '#applications/piano/midiFile.mjs';
```

> If `#applications` is not an alias, use the relative path `../../../3_applications/piano/midiFile.mjs`.

Inside `createPianoRouter`, after the studio routes, add:

```js
  // ── Always-on MIDI history (.mid per user/date) ─────────────────────────────
  // History lives at the HOUSEHOLD level (not data/users), and accepts `guest`
  // (the dismiss-outcome identity) in addition to known roster users.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TAKE_RE = /^[0-9][0-9.\-]{1,30}$/;            // HH.MM.SS or HH.MM.SS-2
  const historyUser = (u) => u === 'guest' || knownUser(u);

  router.put('/users/:userId/history/:date/:takeId', asyncHandler(async (req, res) => {
    const { userId, date, takeId } = req.params;
    if (!historyUser(userId)) return res.status(400).json({ error: 'Invalid user' });
    if (!DATE_RE.test(date) || !TAKE_RE.test(takeId) || takeId.includes('..')) {
      return res.status(400).json({ error: 'Invalid date/take' });
    }
    const { events } = req.body || {};
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events (non-empty array) required' });
    }
    const dir = configService.getHouseholdPath(path.join('history', 'piano', userId, date));
    ensureDir(dir);
    const buf = encodeMidiFile(events);
    const file = path.join(dir, `${takeId}.mid`);
    writeBinary(file, buf);                            // overwrite — idempotent
    logger.info?.('piano.history.write', { userId, date, takeId, events: events.length, bytes: buf.length });
    res.json({ ok: true, bytes: buf.length, path: file });
  }));
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/piano.mjs backend/src/4_api/v1/routers/piano.history.test.mjs
git commit -m "feat(piano): PUT history endpoint — idempotent per-user/date .mid write"
```

---

### Task B3: Pure auto-history take helpers

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/autoHistory.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/autoHistory.test.js`

- [ ] **Step 1: Write the failing test** — `autoHistory.test.js`

```js
import { describe, it, expect } from 'vitest';
import { newTake, addEvent, noteCount, qualified, silent, takeKey, flushBody } from './autoHistory.js';

// 2026-06-26 10:00:00 local
const START = new Date(2026, 5, 26, 10, 0, 0).getTime();

describe('autoHistory helpers', () => {
  it('newTake derives date + zero-padded HH.MM.SS id from start time', () => {
    const t = newTake(START, 'kc');
    expect(t.owner).toBe('kc');
    expect(t.date).toBe('2026-06-26');
    expect(t.id).toBe('10.00.00');
  });
  it('counts note_on events and qualifies on minNotes + minSeconds', () => {
    let t = newTake(START, 'kc');
    for (let i = 0; i < 4; i++) t = addEvent(t, { type: 'note_on', note: 60 + i, velocity: 80, time: START + i * 100 });
    expect(noteCount(t)).toBe(4);
    expect(qualified(t, { minNotes: 5, minSeconds: 0 })).toBe(false);     // too few notes
    t = addEvent(t, { type: 'note_on', note: 67, velocity: 80, time: START + 4000 });
    expect(qualified(t, { minNotes: 5, minSeconds: 3 })).toBe(true);      // 5 notes, 4s
    expect(qualified(t, { minNotes: 5, minSeconds: 6 })).toBe(false);     // not long enough
  });
  it('silent() is true once silenceMs has passed since the last event', () => {
    let t = newTake(START, 'kc');
    t = addEvent(t, { type: 'note_on', note: 60, velocity: 80, time: START });
    expect(silent(t, START + 24000, 25000)).toBe(false);
    expect(silent(t, START + 25000, 25000)).toBe(true);
  });
  it('takeKey suffixes same-second collisions', () => {
    expect(takeKey('2026-06-26', '10.00.00', new Set())).toBe('10.00.00');
    expect(takeKey('2026-06-26', '10.00.00', new Set(['2026-06-26/10.00.00']))).toBe('10.00.00-2');
  });
  it('flushBody closes still-held notes at the flush time', () => {
    let t = newTake(START, 'kc');
    t = addEvent(t, { type: 'note_on', note: 60, velocity: 80, time: START });
    const body = flushBody(t, START + 1000);
    expect(body.events.at(-1)).toMatchObject({ type: 'note_off', note: 60 });
    expect(body.durationMs).toBeGreaterThanOrEqual(1000);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/autoHistory.test.js --no-color`

- [ ] **Step 3: Implement** — `autoHistory.js`

```js
import { toTakeEvent, closeOpenNotes, takeDuration } from './modes/Studio/studioRecording.js';

const pad = (n) => String(n).padStart(2, '0');

/** Start a new take: relative-time events + a date/id derived from local start time. */
export function newTake(startedAtMs, owner) {
  const d = new Date(startedAtMs);
  return {
    startedAtMs,
    owner,
    events: [],
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    id: `${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`,
  };
}

/** Append a live MIDI event ({type,note,velocity,time}) as a relative-time take event. */
export function addEvent(take, evt) {
  return { ...take, events: [...take.events, toTakeEvent(evt, take.startedAtMs)] };
}

export const noteCount = (take) => take.events.filter((e) => e.type === 'note_on').length;

/** A take is worth saving once it reaches minNotes (and minSeconds, if set). */
export function qualified(take, { minNotes = 0, minSeconds = 0 } = {}) {
  if (noteCount(take) < minNotes) return false;
  if (minSeconds > 0 && takeDuration(take.events) < minSeconds * 1000) return false;
  return true;
}

/** True once `silenceMs` has elapsed since the take's last event (absolute clock). */
export function silent(take, nowMs, silenceMs) {
  if (take.events.length === 0) return false;
  const lastAbs = take.startedAtMs + take.events[take.events.length - 1].t;
  return nowMs - lastAbs >= silenceMs;
}

/** Resolve a unique key, suffixing -2/-3 on a same-second collision within a date. */
export function takeKey(date, id, usedKeys) {
  if (!usedKeys.has(`${date}/${id}`)) return id;
  let n = 2;
  while (usedKeys.has(`${date}/${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}

/** Build the PUT body, closing any held notes at `nowMs` so the .mid is valid. */
export function flushBody(take, nowMs) {
  const events = closeOpenNotes(take.events, Math.max(0, nowMs - take.startedAtMs));
  return { events, startedAt: new Date(take.startedAtMs).toISOString(), durationMs: takeDuration(events) };
}
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/autoHistory.js frontend/src/modules/Piano/PianoKiosk/autoHistory.test.js
git commit -m "feat(piano): pure auto-history take helpers"
```

---

### Task B4: useAutoMidiHistory hook

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/useAutoMidiHistory.js`

> No unit test (timer/subscription wiring around the already-tested pure helpers + a tested endpoint). Verified live on the kiosk in Task B5.

- [ ] **Step 1: Implement** — `useAutoMidiHistory.js`

```js
import { useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { newTake, addEvent, qualified, silent, takeKey, flushBody } from './autoHistory.js';

/**
 * useAutoMidiHistory — always-on capture of the live Web-MIDI stream into
 * silence/player-segmented .mid files, attributed to the current player.
 *
 * Buffers events into a take; once it crosses minNotes/minSeconds it gets a
 * stable start-time id and is flushed (full-state, idempotent PUT) every
 * flushSeconds. A silence gap or a player change closes the take (final flush);
 * sub-threshold takes are dropped. Disabled unless config.enabled.
 *
 * @param {{ subscribe: Function }} midi   from usePianoMidi()
 * @param {string} currentUser            'guest' or a roster id
 * @param {object} config                 resolved piano config .autoRecord
 */
export function useAutoMidiHistory(subscribe, currentUser, config) {
  const logger = useRef(null);
  if (!logger.current) logger.current = getLogger().child({ component: 'piano-auto-history' });

  const cfgRef = useRef(config); cfgRef.current = config;
  const userRef = useRef(currentUser); // read live inside the stable subscription
  const takeRef = useRef(null);
  const usedKeys = useRef(new Set());
  const flushedAtRef = useRef(0);

  // PUT the current take (full state) to the history endpoint. Idempotent.
  const flush = (take, nowMs, { final = false } = {}) => {
    if (!take) return;
    const key = take.key || takeKey(take.date, take.id, usedKeys.current);
    take.key = key; usedKeys.current.add(`${take.date}/${key}`);
    const body = flushBody(take, nowMs);
    DaylightAPI(`api/v1/piano/users/${encodeURIComponent(take.owner)}/history/${take.date}/${key}`, body, 'PUT')
      .then(() => logger.current.info('piano.history.flush', { owner: take.owner, key, final, events: body.events.length }))
      .catch((e) => logger.current.warn('piano.history.flush.fail', { owner: take.owner, key, error: e?.message }));
  };

  const closeCurrent = (nowMs) => {
    const take = takeRef.current;
    takeRef.current = null;
    if (take && qualified(take, cfgRef.current)) flush(take, nowMs, { final: true });
  };

  // Subscribe to the live note stream (mounted once; reads userRef live).
  useEffect(() => {
    if (!config?.enabled) return undefined;
    const unsub = subscribe((evt) => {
      const now = Date.now();
      if (!takeRef.current) takeRef.current = newTake(now, userRef.current || 'guest');
      takeRef.current = addEvent(takeRef.current, evt);
      takeRef.current.key = takeRef.current.key; // preserve assigned key across spreads
    });
    return () => { unsub?.(); closeCurrent(Date.now()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.enabled, subscribe]);

  // Poll: silence-close + periodic flush.
  useEffect(() => {
    if (!config?.enabled) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      const take = takeRef.current;
      if (!take) return;
      if (silent(take, now, (cfgRef.current.silenceSeconds || 25) * 1000)) {
        closeCurrent(now);          // qualified → final flush; else dropped
        return;
      }
      if (qualified(take, cfgRef.current) && now - flushedAtRef.current >= (cfgRef.current.flushSeconds || 12) * 1000) {
        flushedAtRef.current = now;
        flush(take, now);
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.enabled]);

  // Player change: close the open take under the OLD owner, then re-point.
  useEffect(() => {
    if (!config?.enabled) return;
    if (takeRef.current && takeRef.current.owner !== currentUser) closeCurrent(Date.now());
    userRef.current = currentUser;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, config?.enabled]);
}

export default useAutoMidiHistory;
```

> NOTE for the implementer: confirm `DaylightAPI(path, body, method)` supports a `'PUT'` method arg. Check `frontend/src/lib/api.mjs`; if the signature differs (e.g. `DaylightAPI(path, { method, body })`), adapt the one `DaylightAPI(...)` call accordingly. This is the only external-contract assumption in the hook.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/useAutoMidiHistory.js
git commit -m "feat(piano): useAutoMidiHistory capture/segment/flush hook"
```

---

### Task B5: Wire history into PianoShell + enable config

**Files:**
- Modify: `frontend/src/Apps/PianoApp.jsx`

- [ ] **Step 1: Import + grab `subscribe`** — in `PianoApp.jsx`:

```js
import { useAutoMidiHistory } from '../modules/Piano/PianoKiosk/useAutoMidiHistory.js';
```

In `PianoShell`, extend the existing `usePianoMidi()` destructure to include `subscribe` and `currentUser` from `usePianoUser()` (already added in A6):

```js
  const { activeNotes, noteHistory, subscribe } = usePianoMidi();
  const { users, currentUser, setCurrentUser } = usePianoUser();
```

- [ ] **Step 2: Drive the recorder** (after the `useWhoIsPlaying(...)` call):

```js
  useAutoMidiHistory(subscribe, currentUser, config.autoRecord);
```

- [ ] **Step 3: Run the frontend piano suite** (expect only the known unrelated Videos WIP failures):

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk --no-color`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/PianoApp.jsx
git commit -m "feat(piano): wire always-on MIDI history into PianoShell"
```

- [ ] **Step 5: Enable on the kiosk piano** — edit `data/household/config/piano.yml` (in the container; write the whole block, never `sed`):

```yaml
who_is_playing_minutes: 2
auto_record:
  enabled: true
  silence_seconds: 25
  min_notes: 5
  min_seconds: 3
  flush_seconds: 12
```

(Place at the piano's top level, or under `pianos.{id}` for a specific piano.)

- [ ] **Step 6: Deploy + verify** (gate-check first per CLAUDE.local.md). Reload the piano (Settings → Reload app), play ≥ `min_notes`, pause `silence_seconds`, and confirm a `.mid` lands at
`data/household/history/piano/{user}/{YYYY-MM-DD}/{HH.MM.SS}.mid` (and `guest` after dismissing the prompt).

```bash
sudo docker exec daylight-station sh -c 'ls -R data/household/history/piano 2>/dev/null | head'
```

**End of Phase B.**

---

## Self-review notes
- **Spec coverage:** identity (A1 guest, A2 hook, A4 prompt, A6 wire) ✓; always-on history (B1 encoder, B2 endpoint, B3/B4 capture+segment+filter+flush, B5 wire) ✓; config (A5) ✓; guest-not-a-pick-option (A4 test asserts no Guest card) ✓; idempotent overwrite (B2 test) ✓; player-change segmentation (B4 effect) ✓; min-take drop (B3/B4) ✓.
- **External assumptions flagged inline:** `DaylightAPI` PUT signature (B4), `#applications` alias vs relative path (B2). Resolve at implementation by reading the referenced file.
- **Types consistent:** `firesOnGap`, `resolveProfile`, `encodeMidiFile`, `newTake/addEvent/qualified/silent/takeKey/flushBody` used identically across tasks.
