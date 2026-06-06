# Governance Audio-Duck Cues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a configured sound effect and briefly duck the video's audio (without pausing) when a governance challenge timer nears its lock threshold.

**Architecture:** The `GovernanceEngine` computes a stateless `audioDuck` descriptor in its composed state when a configured cue's threshold is crossed while the challenge is still unsatisfied. A small React hook (`useGovernanceAudioDuck`) in `FitnessPlayer` watches that descriptor, plays the SFX once per firing (deduped by a stable `token`), and ducks `mediaElement.volume` multiplicatively against the live persistent volume — restoring when the SFX ends.

**Tech Stack:** Vanilla JS engine class (`frontend/src/hooks/fitness/`), React hooks, Vitest + jsdom (`@testing-library/react` `renderHook`), HTML media elements.

**Spec:** `docs/superpowers/specs/2026-06-05-governance-audio-duck-cues-design.md`

**Refinement vs. spec:** The spec described an engine-side edge-tracked fired-set. This plan realizes the identical observable behavior ("fire once per challenge") more simply: the engine stays **stateless** and emits `audioDuck` for the whole in-window period with a stable `token`; the *consumer* dedupes by `token`. This is easier to test and avoids mutable engine state. The duck level is **multiplicative** (`video volume × duck_to`), fired **only while the challenge is unsatisfied/pending**.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Parse `audio_cues` config; compute stateless `audioDuck` in composed state | Modify |
| `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` | Unit tests for config parsing + `audioDuck` computation | Create |
| `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js` | Play SFX + duck/restore media volume on token change | Create |
| `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.js` | Unit tests for the hook | Create |
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Wire the hook into the player | Modify |
| `tests/_infrastructure/household-demo/config/fitness.yml` | Example `audio_cues` config for the fixture | Modify |

**Conventions verified in the repo:**
- Engine tests are colocated `*.test.js` using `import { describe, it, expect } from 'vitest'` and `import { GovernanceEngine } from './GovernanceEngine.js'`.
- The engine takes an injectable clock: `new GovernanceEngine(session, { now: () => fakeNow })`.
- Hook tests use `renderHook, act` from `@testing-library/react`; media playback is stubbed via `vi.spyOn(window.HTMLMediaElement.prototype, 'play')`.
- Media URLs resolve with `import { DaylightMediaPath } from '@/lib/api.mjs'`.
- Run a single colocated test file with the repo's vitest:
  `./node_modules/.bin/vitest run --config vitest.config.mjs <path-to-test-file>`

---

## Task 1: Parse `audio_cues` config in the engine

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (constructor ~line 290; `configure()` ~lines 862-915)
- Test: `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

const baseConfig = (audioCues) => ({
  governed_types: ['test'],
  policies: { default: { base_requirement: [{ active: 'all' }], challenges: [] } },
  zoneConfig: [
    { id: 'cool', name: 'Cool', min: 0 },
    { id: 'active', name: 'Active', min: 100 }
  ],
  audio_cues: audioCues
});

describe('GovernanceEngine — audio_cues config parsing', () => {
  it('parses a valid cue and clamps duck_to into [0,1]', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'challenge_hurry', trigger: 'challenge_remaining', threshold_seconds: 12, sound: 'apps/fitness/ux/challenge-hurry.mp3', duck_to: 5 }
    ]));
    expect(engine._audioCues).toHaveLength(1);
    expect(engine._audioCues[0]).toMatchObject({
      id: 'challenge_hurry',
      trigger: 'challenge_remaining',
      thresholdSeconds: 12,
      sound: 'apps/fitness/ux/challenge-hurry.mp3',
      duckTo: 1
    });
  });

  it('drops cues with missing sound, non-finite threshold, or unknown trigger', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'no_sound', trigger: 'challenge_remaining', threshold_seconds: 10 },
      { id: 'bad_threshold', trigger: 'challenge_remaining', threshold_seconds: 'soon', sound: 'a.mp3' },
      { id: 'bad_trigger', trigger: 'nonsense', threshold_seconds: 10, sound: 'a.mp3' }
    ]));
    expect(engine._audioCues).toHaveLength(0);
  });

  it('defaults to an empty cue list when none configured', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig(undefined));
    expect(engine._audioCues).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: FAIL — `engine._audioCues` is `undefined`.

- [ ] **Step 3: Add the constructor default**

In `GovernanceEngine.js` constructor, alongside the other field initializers (e.g. just after `this._lastCycleSig = null;` near line 290), add:

```javascript
    // Config-driven governance audio-duck cues (parsed in configure()).
    this._audioCues = [];
```

- [ ] **Step 4: Add the normalizer method**

Add this method to the `GovernanceEngine` class (place it just above `configure(...)`, near line 862):

```javascript
  /**
   * Normalize the `audio_cues` config block into validated cue descriptors.
   * Drops entries with a non-finite threshold, empty sound, or unknown trigger.
   * `duck_to` is clamped to [0, 1] (defaults to 0.1 when absent).
   */
  _normalizeAudioCues(raw) {
    const SUPPORTED_TRIGGERS = new Set(['challenge_remaining']);
    if (!Array.isArray(raw)) return [];
    const cues = [];
    raw.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const trigger = String(entry.trigger || '').trim();
      const sound = typeof entry.sound === 'string' ? entry.sound.trim() : '';
      const thresholdSeconds = Number(entry.threshold_seconds ?? entry.thresholdSeconds);
      if (!SUPPORTED_TRIGGERS.has(trigger) || !sound || !Number.isFinite(thresholdSeconds)) {
        getLogger().warn('governance.audio_cue.config_rejected', {
          index,
          id: entry.id || null,
          trigger: trigger || null,
          hasSound: Boolean(sound),
          thresholdSeconds: Number.isFinite(thresholdSeconds) ? thresholdSeconds : null
        });
        return;
      }
      const rawDuck = Number(entry.duck_to ?? entry.duckTo ?? 0.1);
      const duckTo = Number.isFinite(rawDuck) ? Math.max(0, Math.min(1, rawDuck)) : 0.1;
      cues.push({
        id: String(entry.id || `audio_cue_${index}`),
        trigger,
        thresholdSeconds: Math.max(0, thresholdSeconds),
        sound,
        duckTo
      });
    });
    return cues;
  }
```

- [ ] **Step 5: Call the normalizer in `configure()`**

In `configure()`, just before the final `this.evaluate();` call (near line 914), add:

```javascript
    this._audioCues = this._normalizeAudioCues(this.config.audio_cues);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js
git commit -m "feat(governance): parse audio_cues config into validated cue descriptors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Compute `audioDuck` in composed state

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`_composeState()` ~lines 1652-1748; add helper near it)
- Test: `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` (append)

This computes the `audioDuck` descriptor purely from the current challenge snapshot. It fires only when a `challenge_remaining` cue's threshold is met **and** the zone challenge is pending/unsatisfied.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`:

```javascript
describe('GovernanceEngine — _computeAudioDuck', () => {
  const cue = {
    id: 'challenge_hurry',
    trigger: 'challenge_remaining',
    thresholdSeconds: 12,
    sound: 'apps/fitness/ux/challenge-hurry.mp3',
    duckTo: 0.1
  };

  const makeEngine = () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine._audioCues = [cue];
    return engine;
  };

  it('returns a duck descriptor when an unsatisfied challenge is within threshold', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 10, requiredCount: 2, actualCount: 1 };
    const duck = engine._computeAudioDuck(snapshot);
    expect(duck).toMatchObject({
      cueId: 'challenge_hurry',
      sound: 'apps/fitness/ux/challenge-hurry.mp3',
      duckTo: 0.1,
      token: 'ch1:challenge_hurry'
    });
  });

  it('returns null before the threshold is crossed', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 20, requiredCount: 2, actualCount: 1 };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('returns null when the challenge is already satisfied', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: 2, actualCount: 2 };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('returns null for a non-pending challenge', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'success', remainingSeconds: 5, requiredCount: 2, actualCount: 2 };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('returns null when there is no challenge snapshot', () => {
    const engine = makeEngine();
    expect(engine._computeAudioDuck(null)).toBeNull();
  });

  it('returns null when no cues are configured', () => {
    const engine = makeEngine();
    engine._audioCues = [];
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 5, requiredCount: 2, actualCount: 1 };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('exposes audioDuck on the composed state', () => {
    const engine = makeEngine();
    // Stub the challenge snapshot used by _composeState.
    engine._buildChallengeSnapshot = () => ({ id: 'ch1', status: 'pending', remainingSeconds: 9, requiredCount: 2, actualCount: 0 });
    const state = engine._composeState();
    expect(state.audioDuck).toMatchObject({ cueId: 'challenge_hurry', token: 'ch1:challenge_hurry' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: FAIL — `engine._computeAudioDuck is not a function`.

- [ ] **Step 3: Add the helper method**

Add this method to `GovernanceEngine` (place it just above `_composeState()`, near line 1652):

```javascript
  /**
   * Compute the active audio-duck descriptor (or null) for the current
   * challenge snapshot. Stateless: returns the same stable `token` for the
   * whole in-window period; the React consumer dedupes by token so the SFX
   * fires once per challenge. Only `challenge_remaining` cues are evaluated,
   * and only while the zone challenge is pending AND unsatisfied (a satisfied
   * challenge won't lock, so there is nothing to hurry for).
   */
  _computeAudioDuck(challengeSnapshot) {
    if (!challengeSnapshot || !Array.isArray(this._audioCues) || this._audioCues.length === 0) {
      return null;
    }
    const { id: challengeId, status, remainingSeconds, requiredCount, actualCount, missingUsers } = challengeSnapshot;
    if (status !== 'pending' || !Number.isFinite(remainingSeconds)) return null;

    const satisfied = Number.isFinite(requiredCount) && Number.isFinite(actualCount)
      ? actualCount >= requiredCount
      : (Array.isArray(missingUsers) ? missingUsers.length === 0 : false);
    if (satisfied) return null;

    for (const cue of this._audioCues) {
      if (cue.trigger !== 'challenge_remaining') continue;
      if (remainingSeconds > cue.thresholdSeconds) continue;
      const token = `${challengeId || 'challenge'}:${cue.id}`;
      getLogger().sampled('governance.audio_cue.fired', {
        cueId: cue.id,
        challengeId: challengeId || null,
        remainingSeconds,
        threshold: cue.thresholdSeconds
      }, { maxPerMinute: 6 });
      return { cueId: cue.id, sound: cue.sound, duckTo: cue.duckTo, token };
    }
    return null;
  }
```

- [ ] **Step 4: Expose `audioDuck` in `_composeState()`**

In `_composeState()`, the challenge snapshot is already built as `challengeSnapshot` (line ~1662). In the returned object (the `return { ... }` near line 1710), add this property alongside `challenge: challengeSnapshot,`:

```javascript
      audioDuck: this._computeAudioDuck(challengeSnapshot),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js
git commit -m "feat(governance): emit stateless audioDuck descriptor in composed state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `useGovernanceAudioDuck` consumer hook

**Files:**
- Create: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js`
- Test: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.js`

The hook owns an `Audio` instance (so it can listen for `ended`), plays the SFX once per new `token`, ducks the passed media element's `volume` multiplicatively against the live persistent volume ref, and restores on `ended` / unmount.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGovernanceAudioDuck } from './useGovernanceAudioDuck.js';

// Fake Audio that records instances and lets the test fire 'ended'.
class FakeAudio {
  constructor(src) {
    this.src = src;
    this.volume = 1;
    this._listeners = {};
    FakeAudio.instances.push(this);
  }
  addEventListener(type, cb) { (this._listeners[type] ||= []).push(cb); }
  removeEventListener(type, cb) {
    this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== cb);
  }
  play() { this.played = true; return Promise.resolve(); }
  pause() { this.paused = true; }
  fire(type) { (this._listeners[type] || []).forEach((cb) => cb()); }
}
FakeAudio.instances = [];

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
});
afterEach(() => { vi.unstubAllGlobals(); });

const makeMedia = (volume = 0.6) => ({ volume });
const makeVolume = (level = 0.6) => ({ volumeRef: { current: level } });
const duck = (token) => ({ cueId: 'challenge_hurry', sound: 'apps/fitness/ux/challenge-hurry.mp3', duckTo: 0.1, token });

describe('useGovernanceAudioDuck', () => {
  it('plays the SFX and ducks media volume multiplicatively on a new token', () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    renderHook(() => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: duck('ch1:challenge_hurry') }));
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].played).toBe(true);
    expect(media.volume).toBeCloseTo(0.06); // 0.6 * 0.1
  });

  it('restores media volume to the live persistent level when the SFX ends', () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    renderHook(() => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: duck('ch1:challenge_hurry') }));
    // User nudged volume up during the duck; restore must use the live ref.
    videoVolume.volumeRef.current = 0.8;
    FakeAudio.instances[0].fire('ended');
    expect(media.volume).toBeCloseTo(0.8);
  });

  it('does not refire for the same token', () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    const { rerender } = renderHook(
      ({ d }) => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: d }),
      { initialProps: { d: duck('ch1:challenge_hurry') } }
    );
    rerender({ d: duck('ch1:challenge_hurry') });
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('is a no-op when audioDuck is null', () => {
    const media = makeMedia(0.6);
    renderHook(() => useGovernanceAudioDuck({ mediaElement: media, videoVolume: makeVolume(0.6), audioDuck: null }));
    expect(FakeAudio.instances).toHaveLength(0);
    expect(media.volume).toBe(0.6);
  });

  it('restores volume on unmount if still ducked', () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    const { unmount } = renderHook(() => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: duck('ch1:challenge_hurry') }));
    expect(media.volume).toBeCloseTo(0.06);
    unmount();
    expect(media.volume).toBeCloseTo(0.6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.js`
Expected: FAIL — cannot resolve `./useGovernanceAudioDuck.js`.

- [ ] **Step 3: Write the hook**

Create `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js`:

```javascript
import { useEffect, useRef } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'governance-audio-duck' });
  return _logger;
}

/**
 * Plays a one-shot SFX and ducks the video's audio (without pausing) when the
 * GovernanceEngine emits an `audioDuck` descriptor. The duck lasts only while
 * the SFX plays — volume is restored on the SFX `ended` event (or on unmount).
 *
 * Dedupes by `audioDuck.token`: each distinct token fires exactly once, so a
 * descriptor that persists across the whole threshold window only ducks once.
 *
 * @param {object}  params
 * @param {HTMLMediaElement|{volume:number}|null} params.mediaElement - the video element to duck
 * @param {{ volumeRef: { current: number } }|null} params.videoVolume - live persistent volume
 * @param {{ cueId:string, sound:string, duckTo:number, token:string }|null} params.audioDuck
 */
export function useGovernanceAudioDuck({ mediaElement, videoVolume, audioDuck }) {
  const firedTokenRef = useRef(null);
  const audioRef = useRef(null);
  const duckedMediaRef = useRef(null);

  useEffect(() => {
    const token = audioDuck?.token || null;
    if (!token || token === firedTokenRef.current) return;
    if (!mediaElement || typeof mediaElement.volume !== 'number') return;

    firedTokenRef.current = token;

    const baseLevel = Number.isFinite(videoVolume?.volumeRef?.current)
      ? videoVolume.volumeRef.current
      : mediaElement.volume;
    const duckLevel = Math.max(0, Math.min(1, baseLevel * audioDuck.duckTo));

    mediaElement.volume = duckLevel;
    duckedMediaRef.current = mediaElement;

    logger().info('fitness.audio_duck.start', {
      cueId: audioDuck.cueId,
      token,
      duckTo: audioDuck.duckTo,
      level: duckLevel
    });

    const restore = () => {
      const media = duckedMediaRef.current;
      if (media && typeof media.volume === 'number') {
        const live = Number.isFinite(videoVolume?.volumeRef?.current)
          ? videoVolume.volumeRef.current
          : media.volume;
        media.volume = live;
      }
      duckedMediaRef.current = null;
      logger().info('fitness.audio_duck.end', { cueId: audioDuck.cueId, token });
    };

    let audio = null;
    try {
      audio = new Audio(DaylightMediaPath(`/media/${audioDuck.sound}`));
      audioRef.current = audio;
      audio.addEventListener('ended', restore);
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Audio construction/playback failed — restore immediately so we never
      // leave the video ducked with no SFX to end it.
      restore();
      return undefined;
    }

    return () => {
      if (audio) audio.removeEventListener('ended', restore);
      // If the duck is still active when this effect tears down (unmount or a
      // new token arriving mid-SFX), restore the video volume.
      if (duckedMediaRef.current) restore();
    };
  }, [audioDuck, mediaElement, videoVolume]);
}

export default useGovernanceAudioDuck;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.js
git commit -m "feat(fitness): useGovernanceAudioDuck hook — play SFX + duck video volume

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire the hook into `FitnessPlayer`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` (import near line 22; call near line 617)

- [ ] **Step 1: Add the import**

In `FitnessPlayer.jsx`, alongside the other Fitness hook imports (after the `useVolumeSync` import at line 22), add:

```javascript
import { useGovernanceAudioDuck } from '@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js';
```

- [ ] **Step 2: Add the hook call**

In `FitnessPlayer.jsx`, immediately after the `useVolumeSync({ ... });` block (ends at line 617), add:

```javascript
  // Audio-duck cues: play a configured SFX and briefly lower the video volume
  // (without pausing) when the governance engine signals a challenge is nearing
  // its lock threshold. Restores volume when the SFX ends.
  useGovernanceAudioDuck({
    mediaElement,
    videoVolume,
    audioDuck: effectiveGovernanceState?.audioDuck
  });
```

- [ ] **Step 3: Verify the full fitness unit suite still passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player frontend/src/hooks/fitness`
Expected: PASS — no regressions; the new audioDuck + hook tests included.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(fitness): wire useGovernanceAudioDuck into FitnessPlayer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Example config + prod enablement

> **DEVIATION (as built):** No committed `fitness.yml` fixture has a `governance:`
> block — governance config lives only on the data volume, and the config-parsing
> path is already covered by `GovernanceEngine.audioDuck.test.js`. Seeding an
> `audio_cues` block into an otherwise-ungoverned demo fixture would be dead,
> misleading config that nothing reads. So instead of editing a fixture, the
> config surface was documented in `docs/reference/fitness/governance-engine.md`
> (commit `fb3ccd7e7`), and prod enablement remains the operational step below.

**Files:**
- ~~Modify: `tests/_infrastructure/household-demo/config/fitness.yml`~~ → replaced by
  `docs/reference/fitness/governance-engine.md` (Audio Cues section).

This documents the cue config. The real household config on the data volume is edited separately at deploy time (see Step 3).

- [ ] **Step 1: Read the fixture's governance block**

Run: `grep -n "governance:\|grace_period_seconds\|policies:" tests/_infrastructure/household-demo/config/fitness.yml`
Confirm where the `governance:` block is and its indentation.

- [ ] **Step 2: Add the `audio_cues` block**

Under the `governance:` mapping in `tests/_infrastructure/household-demo/config/fitness.yml` (sibling to `policies:` / `grace_period_seconds:`, matching the file's existing indentation), add:

```yaml
  audio_cues:
    - id: challenge_hurry
      trigger: challenge_remaining
      threshold_seconds: 12
      sound: apps/fitness/ux/challenge-hurry.mp3
      duck_to: 0.1
```

- [ ] **Step 3: Document prod enablement (no code change)**

The live behavior requires the same block in the household config on the data volume. The sound file already exists at `media/apps/fitness/ux/challenge-hurry.mp3`. After merge/deploy, add the `audio_cues` block under `governance:` in the household `fitness.yml` (per CLAUDE.local.md, edit the data volume with a heredoc inside `sudo docker exec daylight-station sh -c '...'`, never `sed -i`). This step is operational, performed by the user — do not attempt it during plan execution.

- [ ] **Step 4: Commit**

```bash
git add tests/_infrastructure/household-demo/config/fitness.yml
git commit -m "test(fitness): add challenge_hurry audio cue to demo config fixture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the affected unit tests:**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.js`
Expected: PASS — all audioDuck + hook tests.

- [ ] **Run the isolated harness for governance** to confirm no regressions in the broader engine suite:

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness`
Expected: PASS.

- [ ] **Manual verification (dev server):** With governance active and a zone challenge running, let the challenge timer count down past 12s while unsatisfied. Confirm: the hurry SFX plays, the video keeps playing at reduced volume, and volume returns to normal when the SFX ends. Watch `dev.log` for `fitness.audio_duck.start` / `fitness.audio_duck.end` and `governance.audio_cue.fired`.

---

## Self-Review notes

- **Spec coverage:** config block (Task 1 + 5), engine `audioDuck` (Task 2), consumer hook with multiplicative duck + restore-on-end (Task 3), wiring (Task 4), tests + logging throughout. The spec's "edge-triggered once" is realized via consumer token-dedup (documented at top).
- **Type consistency:** the descriptor shape `{ cueId, sound, duckTo, token }` is identical in engine (Task 2), hook (Task 3), and wiring (Task 4). Cue descriptor `{ id, trigger, thresholdSeconds, sound, duckTo }` consistent between Task 1 normalizer and Task 2 consumer.
- **Known v1 limitation (from spec):** a `useVolumeSync` re-apply or manual volume change during the ~3s duck window could restore full volume early. Accepted for v1.
