# Playback-Rate Fix + Per-Collection Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the playback-rate button actually change playback speed on DASH/all content, and persist the chosen rate across queue advances within the same show/album/artist (in-memory, per session).

**Architecture:** Stop poking the DOM. Route `media:rate` through the Player's controlled `setPlaybackRate` session state (which already applies correctly to the shadow-DOM `<video>`). Add a reactive effect so a mid-playback rate change applies immediately. Scope the rate session to a collection key (show/album/artist) so it survives advances. Keep volume's scope untouched (rate gets its own session instance).

**Tech Stack:** React (Player + screen-framework), CustomEvent transport, dash-video web component (shadow DOM), Vitest.

---

## Root cause (from systematic debugging)

The office rate button (`ScreenActionHandler.handleMediaRate`) does `document.querySelector('…,video,dash-video').playbackRate = next`. This fails because:
1. **Shadow DOM:** DASH renders via the `<dash-video>` web component; the real `<video>` is in its shadow DOM (`useCommonMediaController.getMediaEl` reads `container.shadowRoot.querySelector('video,audio')`). `document.querySelector('video')` can't reach it.
2. **Out-of-band:** The Player owns `playbackRate` as session state (`usePlaybackSession`) and applies it to the real element. Any direct DOM mutation is re-asserted/ignored.

Evidence: 101/101 `fps_stats` samples read `playbackRate:1` after two rate presses. Every other transport command works because it dispatches a keydown *into* the Player; only `media:rate` reaches around it.

## Confirmed seams

- `Player.jsx:775` — `effectivePlaybackRate = sessionPlaybackRate ?? currentItemPlaybackRate ?? queuePlaybackRate ?? 1` (session = user's button wins; item/queue config = default). **We keep this precedence** (honors "most recently set rate"; explicit config is the default when the user hasn't set one). Flagged in self-review as a tunable.
- `Player.jsx:304-327` — `prefsSessionKey` is queue-scoped for queues; `usePlaybackSession({sessionKey: prefsSessionKey})` returns `{volume, playbackRate, setVolume, setPlaybackRate}`.
- `usePlaybackSession` (in-memory `sessionStore`, keyed by `sessionKey`) — resets on reload. Matches "in-memory only."
- `useCommonMediaController.js:1314-1328` — the ONLY place rate is applied to the element: `play`/`seeked` listeners + snapshot, set up once. **No reactive apply on rate change.** `getMediaEl()` (line 331-336) pierces shadow DOM.
- `ScreenActionHandler.jsx:226-232` — `handleMediaRate` (the DOM poke), wired via `useScreenAction('media:rate', handleMediaRate)` (line 470).

## File structure

- **Create** `frontend/src/modules/Player/utils/playbackRateCycle.js` — pure `nextPlaybackRate(current)` cycle helper.
- **Create** `frontend/src/modules/Player/utils/collectionKey.js` — pure `resolveCollectionKey(meta)`.
- **Modify** `frontend/src/modules/Player/hooks/useCommonMediaController.js` — add a reactive effect applying `playbackRate` to the live element immediately.
- **Modify** `frontend/src/modules/Player/Player.jsx` — give rate its own collection-scoped session; add a `player:cycle-playback-rate` CustomEvent listener that cycles `setSessionPlaybackRate`.
- **Modify** `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` — `handleMediaRate` dispatches the CustomEvent instead of poking the DOM.

## Test runner

`./node_modules/.bin/vitest run --config vitest.config.mjs <path>`

---

### Task 1: Pure rate-cycle helper

**Files:**
- Create: `frontend/src/modules/Player/utils/playbackRateCycle.js`
- Test: `frontend/src/modules/Player/utils/playbackRateCycle.test.js`

- [ ] **Step 1: Write the failing test** — Create `frontend/src/modules/Player/utils/playbackRateCycle.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { nextPlaybackRate, PLAYBACK_RATES } from './playbackRateCycle.js';

describe('nextPlaybackRate', () => {
  it('cycles 1 → 1.5 → 2 → 1', () => {
    expect(nextPlaybackRate(1)).toBe(1.5);
    expect(nextPlaybackRate(1.5)).toBe(2);
    expect(nextPlaybackRate(2)).toBe(1);
  });
  it('treats null/undefined/unknown as 1 (so the first press goes to 1.5)', () => {
    expect(nextPlaybackRate(null)).toBe(1.5);
    expect(nextPlaybackRate(undefined)).toBe(1.5);
    expect(nextPlaybackRate(0.75)).toBe(1.5);
  });
  it('exports the rate list', () => {
    expect(PLAYBACK_RATES).toEqual([1, 1.5, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/utils/playbackRateCycle.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — Create `frontend/src/modules/Player/utils/playbackRateCycle.js`:

```javascript
// The cycle the rate button steps through. Pure + tiny so it's trivially testable
// and shared between the Player (which owns the rate) and tests.
export const PLAYBACK_RATES = [1, 1.5, 2];

/**
 * @param {number|null|undefined} current
 * @returns {number} the next rate in the cycle (unknown/absent → first step, 1.5)
 */
export function nextPlaybackRate(current) {
  const idx = PLAYBACK_RATES.indexOf(current);
  return PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
}
```

(Note: `indexOf(unknown)` is `-1`, so `(-1+1)%3 = 0` → `PLAYBACK_RATES[0]` is `1`… that would make the first press 1, not 1.5. Fix below.)

Use this exact implementation so unknown values step to 1.5:

```javascript
export const PLAYBACK_RATES = [1, 1.5, 2];

export function nextPlaybackRate(current) {
  const idx = PLAYBACK_RATES.indexOf(current);
  // Unknown/absent (idx === -1) is treated as the 1× slot, so the next is 1.5.
  const base = idx === -1 ? 0 : idx;
  return PLAYBACK_RATES[(base + 1) % PLAYBACK_RATES.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/utils/playbackRateCycle.test.js`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/utils/playbackRateCycle.js frontend/src/modules/Player/utils/playbackRateCycle.test.js
git commit -m "feat(player): pure nextPlaybackRate cycle helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Collection-key helper (show/album/artist scope)

**Files:**
- Create: `frontend/src/modules/Player/utils/collectionKey.js`
- Test: `frontend/src/modules/Player/utils/collectionKey.test.js`

- [ ] **Step 1: Write the failing test** — Create `frontend/src/modules/Player/utils/collectionKey.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { resolveCollectionKey } from './collectionKey.js';

describe('resolveCollectionKey', () => {
  it('keys a TV/lecture series by grandparent/parent title', () => {
    expect(resolveCollectionKey({ grandparentTitle: 'Peterson Academy', parentTitle: 'Sermon on the Mount' }))
      .toBe('peterson academy/sermon on the mount');
  });
  it('keys music by artist/album', () => {
    expect(resolveCollectionKey({ artist: 'Bach', album: 'Cello Suites' }))
      .toBe('bach/cello suites');
  });
  it('falls back to whichever level exists', () => {
    expect(resolveCollectionKey({ grandparentTitle: 'The Office' })).toBe('the office');
    expect(resolveCollectionKey({ parentTitle: 'Season 2' })).toBe('season 2');
  });
  it('returns null when there is no collection metadata', () => {
    expect(resolveCollectionKey({ title: 'One-off clip' })).toBeNull();
    expect(resolveCollectionKey(null)).toBeNull();
    expect(resolveCollectionKey({ grandparentTitle: '  ' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/utils/collectionKey.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — Create `frontend/src/modules/Player/utils/collectionKey.js`:

```javascript
/**
 * Derive a stable "collection" identity for rate persistence: the show/season
 * (TV/lectures, via grandparentTitle/parentTitle) or artist/album (music). Stable
 * across the episodes/tracks of one collection, so advancing keeps the rate; a
 * different collection gets its own. Returns null when there's no collection
 * metadata (caller falls back to its default session scope).
 *
 * @param {Object|null} meta - effectiveMeta of the current item
 * @returns {string|null}
 */
export function resolveCollectionKey(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const norm = (v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
  const top = norm(meta.grandparentTitle) || norm(meta.artist);
  const mid = norm(meta.parentTitle) || norm(meta.album);
  const parts = [top, mid].filter(Boolean);
  return parts.length ? parts.join('/') : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/utils/collectionKey.test.js`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/utils/collectionKey.js frontend/src/modules/Player/utils/collectionKey.test.js
git commit -m "feat(player): resolveCollectionKey for per-show/album/artist scope

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Reactive rate apply (so a mid-play change takes effect immediately)

Without this, `playbackRate` is only applied on `play`/`seeked`/setup — pressing the rate button on an already-playing video would do nothing until the next seek.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js`

- [ ] **Step 1: Read the apply site.** Open `frontend/src/modules/Player/hooks/useCommonMediaController.js` and locate the `getMediaEl` definition (around line 331) and the block around line 1314-1328 where `mediaEl.playbackRate = playbackRate` is set inside `play`/`seeked` listeners. Confirm there is no standalone `useEffect` keyed on `playbackRate` that applies to the element. (There isn't — that's the gap.)

- [ ] **Step 2: Add the reactive apply effect.** Find the `getMediaEl` declaration:

```javascript
  const getMediaEl = useCallback(() => {
```

Immediately AFTER the full `getMediaEl` `useCallback` block (after its closing `}, [...]);`), add:

```javascript
  // Apply the controlled playbackRate to the live element the instant it changes.
  // The element-setup effect only (re)applies rate on play/seeked, so without this a
  // mid-playback rate change (e.g. the rate button) wouldn't take effect until the
  // next seek. getMediaEl() resolves the real <video> inside the dash-video shadow DOM.
  useEffect(() => {
    const el = getMediaEl();
    if (el && Number.isFinite(playbackRate) && el.playbackRate !== playbackRate) {
      el.playbackRate = playbackRate;
    }
  }, [playbackRate, getMediaEl, elementKey]);
```

(`useEffect`, `playbackRate`, and `elementKey` are all already in scope in this hook — `useEffect` is imported at line 1, `playbackRate` is a destructured arg, `elementKey` is the existing remount key state.)

- [ ] **Step 3: Verify it parses and the existing Player tests still pass.**

Run:
```bash
node --check frontend/src/modules/Player/hooks/useCommonMediaController.js
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/
```
Expected: parse OK; existing Player suite stays green (no behavior regression — this only adds an idempotent apply).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js
git commit -m "fix(player): apply playbackRate reactively (mid-play rate changes take effect)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Player — collection-scoped rate session + cycle-on-event

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx`

- [ ] **Step 1: Import the helpers.** Near the other Player imports (top of `Player.jsx`, beside `import { usePlaybackSession } from './hooks/usePlaybackSession.js';`), add:

```javascript
import { resolveCollectionKey } from './utils/collectionKey.js';
import { nextPlaybackRate } from './utils/playbackRateCycle.js';
```

- [ ] **Step 2: Derive a collection-scoped rate session key.** Find:

```javascript
  const itemSessionKey = useMemo(() => {
    const identifier = currentMediaGuid ?? mediaIdentity;
    return identifier ? `player-item:${identifier}` : 'player-item:idle';
  }, [currentMediaGuid, mediaIdentity]);
```

Immediately AFTER it, add:

```javascript
  // Rate persists per show/album/artist (in-memory, per session). Falls back to the
  // prefs (queue/item) scope when there's no collection metadata.
  const rateSessionKey = useMemo(() => {
    const collection = resolveCollectionKey(effectiveMeta);
    return collection ? `player-rate:${collection}` : prefsSessionKey;
  }, [effectiveMeta, prefsSessionKey]);
```

- [ ] **Step 3: Split rate onto its own session (leave volume scope unchanged).** Find:

```javascript
  const {
    volume: sessionVolume,
    playbackRate: sessionPlaybackRate,
    setVolume: setSessionVolume,
    setPlaybackRate: setSessionPlaybackRate
  } = usePlaybackSession({ sessionKey: prefsSessionKey });
```

Replace with:

```javascript
  const {
    volume: sessionVolume,
    setVolume: setSessionVolume
  } = usePlaybackSession({ sessionKey: prefsSessionKey });

  // Rate lives on its own collection-scoped session so it persists across show/album/
  // artist advances without changing how volume is scoped.
  const {
    playbackRate: sessionPlaybackRate,
    setPlaybackRate: setSessionPlaybackRate
  } = usePlaybackSession({ sessionKey: rateSessionKey });
```

- [ ] **Step 4: Add the cycle-on-event listener.** The screen dispatches a `player:cycle-playback-rate` CustomEvent; the Player owns the cycle. Add this AFTER the two `usePlaybackSession(...)` calls from Step 3 (so `sessionPlaybackRate`/`setSessionPlaybackRate` are in scope):

```javascript
  // The rate button (ScreenActionHandler) dispatches `player:cycle-playback-rate`
  // rather than poking the DOM — DOM pokes can't reach the dash-video shadow <video>
  // and get re-asserted by the controlled rate. Cycle the session rate here; the
  // controlled apply (useCommonMediaController) handles the shadow element.
  const sessionPlaybackRateRef = useRef(sessionPlaybackRate);
  sessionPlaybackRateRef.current = sessionPlaybackRate;
  useEffect(() => {
    const onCycle = () => setSessionPlaybackRate(nextPlaybackRate(sessionPlaybackRateRef.current));
    window.addEventListener('player:cycle-playback-rate', onCycle);
    return () => window.removeEventListener('player:cycle-playback-rate', onCycle);
  }, [setSessionPlaybackRate]);
```

(`useRef`, `useEffect` are already imported at `Player.jsx:1`.)

- [ ] **Step 5: Verify it parses and the Player suite stays green.**

Run:
```bash
node --check frontend/src/modules/Player/Player.jsx
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Player/
```
Expected: parse OK; Player suite green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): collection-scoped rate session + cycle-on-event

Rate now persists per show/album/artist (in-memory). A player:cycle-playback-rate
event cycles the session rate (1→1.5→2); volume scope is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Screen rate button → dispatch the event (drop the DOM poke)

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`
- Test: `frontend/src/screen-framework/actions/ScreenActionHandler.mediaRate.test.jsx` (create)

- [ ] **Step 1: Write the failing test** — Create `frontend/src/screen-framework/actions/ScreenActionHandler.mediaRate.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We unit-test the handler's effect (dispatching the cycle event), not the whole
// component. Extract via the exported helper.
import { dispatchCyclePlaybackRate } from './ScreenActionHandler.jsx';

describe('dispatchCyclePlaybackRate', () => {
  let received;
  const listener = () => { received += 1; };
  beforeEach(() => { received = 0; window.addEventListener('player:cycle-playback-rate', listener); });
  afterEach(() => { window.removeEventListener('player:cycle-playback-rate', listener); });

  it('dispatches a player:cycle-playback-rate event', () => {
    dispatchCyclePlaybackRate();
    expect(received).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/actions/ScreenActionHandler.mediaRate.test.jsx`
Expected: FAIL — `dispatchCyclePlaybackRate` is not exported.

- [ ] **Step 3: Add the exported dispatcher + rewire the handler.** In `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`, add this exported helper near the top of the file (after the imports, before the component):

```javascript
/**
 * Tell the active Player to cycle its playback rate. We dispatch an event rather
 * than mutate the media element directly: a DOM poke can't reach the <video> inside
 * the dash-video shadow DOM and is overwritten by the Player's controlled rate.
 */
export function dispatchCyclePlaybackRate() {
  window.dispatchEvent(new CustomEvent('player:cycle-playback-rate'));
}
```

Then find the existing handler:

```javascript
  const handleMediaRate = useCallback(() => {
    const media = document.querySelector('audio:not([data-role="ambient"]):not([data-role="artmode-music"]), video, dash-video');
    if (!media) return;
    const rates = [1.0, 1.5, 2.0];
    const idx = rates.indexOf(media.playbackRate);
    media.playbackRate = rates[(idx + 1) % rates.length];
  }, []);
```

Replace it with:

```javascript
  const handleMediaRate = useCallback(() => {
    dispatchCyclePlaybackRate();
  }, []);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/actions/ScreenActionHandler.mediaRate.test.jsx`
Expected: PASS.

- [ ] **Step 5: Confirm the screen-framework suite still passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx frontend/src/screen-framework/actions/ScreenActionHandler.mediaRate.test.jsx
git commit -m "fix(screen): media:rate dispatches player cycle event (not a DOM poke)

The DOM poke couldn't reach the dash-video shadow <video> and was overwritten by
the Player's controlled rate, so the rate button did nothing on DASH. Dispatch
player:cycle-playback-rate; the Player cycles + persists the session rate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Live verification on the actual DASH lecture

**Files:** none (verification)

- [ ] **Step 1: Build + gate-check + deploy.** Per `CLAUDE.local.md` (no deploy during an active fitness session or while a video/readalong is actually playing — but note THIS verification needs a video playing on the office, which you control).

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
# fitness gate:
sudo docker logs --since 40s daylight-station 2>&1 | grep -oE '"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```
Expected: build OK; `sessionActive:false` before deploying.

- [ ] **Step 2: Reload the office screen** so it serves the new bundle (office is local Brave — reload via the documented CDP path, or have the user reload). The rate fix only runs in the new frontend.

- [ ] **Step 3: Play a Plex lecture/queue on the office, press the rate button, and confirm the rate actually changes** by watching the fps_stats:

```bash
sudo docker logs --since 60s daylight-station 2>&1 | grep '"event":"playback.fps_stats"' \
  | grep -oE '"title":"[^"]*"|"playbackRate":[0-9.]+' | paste - - | tail -10
```
Expected: after one press `playbackRate:1.5`, after two `playbackRate:2`, after three `playbackRate:1` — a NON-1 value now appears (the bug is fixed).

- [ ] **Step 4: Let it advance to the next item (or press next) and confirm the rate is maintained.**

```bash
sudo docker logs --since 60s daylight-station 2>&1 | grep -E '"playback.queue-advance"|"event":"playback.fps_stats"' \
  | grep -oE 'queue-advance|"title":"[^"]*"|"playbackRate":[0-9.]+' | tail -12
```
Expected: after the advance, the new item's `fps_stats` shows the SAME `playbackRate` the user last set (e.g. `1.5`), not a reset to `1`.

- [ ] **Step 5: Record the before/after** (e.g. "press → 1.5× now applies; advance → stays 1.5×") in the PR/commit description.

---

## Self-Review

- **Spec coverage:** Bug (rate doesn't apply) → Tasks 3+4+5 (reactive apply + session routing + event dispatch). Persistence across advance per show/album/artist → Task 2 (collection key) + Task 4 (rate session keyed by it). In-memory/per-session → uses the existing in-memory `sessionStore` (no backend). Explicit params/config → preserved via the unchanged `effectivePlaybackRate` precedence (see flag below). Live proof → Task 6.
- **Placeholder scan:** No TBD/TODO. The Task 1 helper shows the wrong-then-corrected impl explicitly to call out the `indexOf(-1)` pitfall; the engineer uses the second (corrected) block.
- **Type/name consistency:** `nextPlaybackRate(current)` (Task 1) used in Task 4. `resolveCollectionKey(meta)` (Task 2) used in Task 4. `player:cycle-playback-rate` event name identical in Task 4 (listener) and Task 5 (dispatch) and the test. `setSessionPlaybackRate`/`sessionPlaybackRate` names match the existing Player code. `getMediaEl`/`elementKey`/`playbackRate` in Task 3 are confirmed in-scope in `useCommonMediaController`.
- **Decision flag (precedence):** `effectivePlaybackRate = sessionPlaybackRate ?? currentItemPlaybackRate ?? queuePlaybackRate ?? 1` is kept as-is, so the user's button (session) wins and explicit params/config act as the *default* when no manual rate is set. If instead an explicit param/config should HARD-override even a user's manual choice, change that one line to `currentItemPlaybackRate ?? queuePlaybackRate ?? sessionPlaybackRate ?? 1`. Left as the documented default per "most recently set rate."
- **Coupling resolved:** rate is split onto its own `rateSessionKey` session; volume stays on `prefsSessionKey` — volume scope is unchanged.
