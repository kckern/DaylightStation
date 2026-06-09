# Challenge Audio Engine Refactor & Volume Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give cycling challenges the same Start/End/Fail/Hurry SFX that heart-rate challenges already get, through a shared cue-resolution layer, and add an optional per-cue `volume` so hot assets can be pulled back from config without re-rendering audio.

**Architecture:** The governance audio duck is producer→consumer: `GovernanceEngine._computeAudioDuck` emits an `audioDuck` descriptor; `useGovernanceAudioDuck` plays the SFX and ducks the video. Today the producer returns `null` for cycle challenges (`GovernanceEngine.js:1778`). We add a pure `resolveCycleAudioCue` helper that maps the cycle snapshot's existing lifecycle edges (init/success/locked) plus a new health-based "hurry" to cue triggers, wire it into `_computeAudioDuck`, register the cycle triggers, and thread a `volume` field from config → descriptor → the SFX element.

**Tech Stack:** Frontend ES modules, vitest. `GovernanceEngine` is constructed with an injectable clock and configured via `engine.configure(config)`.

**Audit reference:** `docs/_wip/audits/2026-06-08-bug-bash-fitness-multi-issue-audit.md` (Item 3).

**Product decision locked:** the cycle **Hurry** cue fires when the rider drops **below the red zone (loRpm) and health is dropping**, gated by a **cooldown** so a needle crossing the line repeatedly does not thrash the SFX.

**Existing tests to EXTEND (do not create parallel files):**
- `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` — defines `baseConfig(audioCues)` helper; configures via `engine.configure(baseConfig([...]))` and asserts on `engine._audioCues` / `engine._computeAudioDuck(...)`.
- `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx` — defines `FakeAudio` (global `Audio`) and `descriptor(overrides)`; mocks `DaylightMediaPath` to identity.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `frontend/src/hooks/fitness/challengeAudioCues.js` | Pure: map a cycle snapshot → cue trigger, with hurry cooldown | Create |
| `frontend/src/hooks/fitness/challengeAudioCues.test.js` | Unit tests for the pure resolver | Create |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Register cycle triggers; parse `volume`; emit cycle cues + volume | Modify |
| `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` | Add volume-parse + cycle-duck cases | Modify |
| `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js` | Apply `audioDuck.volume` to the SFX element | Modify |
| `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx` | Add volume-applied case | Modify |
| `data/household/config/fitness.yml` | Add cycle cue entries + optional `volume` on hot cues | Modify (in container) |

---

## Task 1: Optional `volume` in the audio-cue config schema

The SFX element's `.volume` is never set today (always 1.0). Add an optional `volume` field to each cue, default 1.0, clamped to [0,1], and apply it on playback.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:884` (`_normalizeAudioCues`), `:1758` (`emit`)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
- Modify: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js:52`
- Modify: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`

- [ ] **Step 1: Add the failing volume-parse cases to the existing engine test**

Append a new `describe` block to `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` (it already imports `GovernanceEngine` and defines `baseConfig`):

```javascript
describe('GovernanceEngine — audio_cues volume', () => {
  it('parses an explicit volume', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'challenge_start', trigger: 'challenge_start', sound: 'a.mp3', volume: 0.5 }
    ]));
    expect(engine._audioCues[0].volume).toBe(0.5);
  });

  it('defaults volume to 1.0 when absent', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'challenge_start', trigger: 'challenge_start', sound: 'a.mp3' }
    ]));
    expect(engine._audioCues[0].volume).toBe(1);
  });

  it('clamps volume to [0,1]', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([
      { id: 'challenge_start', trigger: 'challenge_start', sound: 'a.mp3', volume: 5 },
      { id: 'challenge_complete', trigger: 'challenge_complete', sound: 'b.mp3', volume: -3 }
    ]));
    expect(engine._audioCues[0].volume).toBe(1);
    expect(engine._audioCues[1].volume).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: FAIL — `engine._audioCues[0].volume` is `undefined`.

- [ ] **Step 3: Parse + emit `volume`**

In `GovernanceEngine.js` `_normalizeAudioCues` (`:884`), add volume parsing in the `cues.push({...})` block (after `duckTo`):

```javascript
      const rawVolume = Number(entry.volume);
      const volume = Number.isFinite(rawVolume) ? Math.max(0, Math.min(1, rawVolume)) : 1;
      cues.push({
        id: String(entry.id || `audio_cue_${index}`),
        trigger,
        thresholdSeconds: Number.isFinite(thresholdSeconds) ? Math.max(0, thresholdSeconds) : null,
        sound,
        duckTo,
        volume
      });
```

In `_computeAudioDuck`'s `emit()` (`:1765`), include volume in the descriptor:

```javascript
      return { cueId: cue.id, sound: cue.sound, duckTo: cue.duckTo, volume: cue.volume, token };
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: PASS — the three new cases pass and the existing suite stays green.

- [ ] **Step 5: Add the failing hook volume case**

Append to `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx` (inside the `describe('useGovernanceAudioDuck', …)` block, which already has `render` + `descriptor` + `FakeAudio`):

```javascript
  it('applies the descriptor volume to the SFX element', () => {
    render(descriptor({ volume: 0.6 }));
    expect(FakeAudio.instances[0].volume).toBe(0.6);
  });

  it('defaults the SFX volume to 1 when no volume is given', () => {
    render(descriptor());
    expect(FakeAudio.instances[0].volume).toBe(1);
  });
```

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: FAIL — `FakeAudio.instances[0].volume` is `undefined` (the hook never sets it).

- [ ] **Step 6: Apply the volume in the hook**

In `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js`, in `startSession` after `audio.src = ...` (`:52`):

```javascript
    audio.src = DaylightMediaPath(`/media/${audioDuck.sound}`);
    const vol = Number(audioDuck.volume);
    audio.volume = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 1;
    audio.currentTime = 0;
```

Update the JSDoc descriptor type (`:99`) to include `volume`:

```javascript
 * @param {{ cueId:string, sound:string, duckTo:number, volume?:number, token:string }|null} params.audioDuck
```

- [ ] **Step 7: Run to verify the hook cases pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js \
        frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js \
        frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx
git commit -m "feat(fitness): optional per-cue volume for governance SFX"
```

---

## Task 2: Pure cycle-cue resolver (Start/End/Fail/Hurry)

Extract the cycle mapping into a pure, testable helper so the engine wiring stays thin.

**Files:**
- Create: `frontend/src/hooks/fitness/challengeAudioCues.js`
- Create: `frontend/src/hooks/fitness/challengeAudioCues.test.js`

- [ ] **Step 1: Write the failing resolver test**

Create `frontend/src/hooks/fitness/challengeAudioCues.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { resolveCycleAudioCue, CYCLE_HURRY_COOLDOWN_MS } from './challengeAudioCues.js';

describe('resolveCycleAudioCue — edge cues', () => {
  it('maps init→cycle_start, success→cycle_end, locked→cycle_fail', () => {
    expect(resolveCycleAudioCue({ cycleAudioCue: 'cycle_challenge_init' }, { now: 0 }).trigger).toBe('cycle_start');
    expect(resolveCycleAudioCue({ cycleAudioCue: 'cycle_success' }, { now: 0 }).trigger).toBe('cycle_end');
    expect(resolveCycleAudioCue({ cycleAudioCue: 'cycle_locked' }, { now: 0 }).trigger).toBe('cycle_fail');
  });

  it('ignores phase_complete (no cue)', () => {
    expect(resolveCycleAudioCue({ cycleAudioCue: 'cycle_phase_complete' }, { now: 0 }).trigger).toBeNull();
  });
});

describe('resolveCycleAudioCue — health-based hurry', () => {
  const danger = { cycleAudioCue: null, currentPhase: { loRpm: 60, hiRpm: 80 }, currentRpm: 50, cycleHealthPct: 0.8 };

  it('fires cycle_hurry when below red (loRpm) and health is dropping', () => {
    const r = resolveCycleAudioCue(danger, { now: 1000, cooldownUntil: 0 });
    expect(r.trigger).toBe('cycle_hurry');
    expect(r.cooldownUntil).toBe(1000 + CYCLE_HURRY_COOLDOWN_MS);
  });

  it('does NOT fire while above red even if health is below full', () => {
    expect(resolveCycleAudioCue({ ...danger, currentRpm: 75 }, { now: 1000 }).trigger).toBeNull();
  });

  it('does NOT fire while full health (needle just crossed, nothing dropping yet)', () => {
    expect(resolveCycleAudioCue({ ...danger, cycleHealthPct: 1 }, { now: 1000 }).trigger).toBeNull();
  });

  it('respects the cooldown to prevent thrashing across the line', () => {
    const r = resolveCycleAudioCue(danger, { now: 2000, cooldownUntil: 9000 });
    expect(r.trigger).toBeNull();
    expect(r.cooldownUntil).toBe(9000); // unchanged
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/challengeAudioCues.test.js`
Expected: FAIL — cannot resolve `./challengeAudioCues.js`.

- [ ] **Step 3: Implement the resolver**

Create `frontend/src/hooks/fitness/challengeAudioCues.js`:

```javascript
/**
 * Pure cue resolution for CYCLE challenges. HR challenges keep their existing
 * path in GovernanceEngine._computeAudioDuck; this only covers the cycle branch,
 * which previously produced no SFX at all.
 *
 * Edge cues (start/end/fail) come from the snapshot's `cycleAudioCue` field,
 * which GovernanceEngine already edge-detects each tick. The "hurry" cue is new:
 * it fires when the rider has dropped below the red zone (loRpm) and health is
 * dropping, gated by a cooldown so a needle that crosses the line repeatedly
 * does not retrigger the SFX.
 */

export const CYCLE_HURRY_COOLDOWN_MS = 8000;

const CYCLE_EDGE_TO_TRIGGER = {
  cycle_challenge_init: 'cycle_start',
  cycle_success: 'cycle_end',
  cycle_locked: 'cycle_fail'
};

/**
 * @param {object} snap - the cycle challenge snapshot (type === 'cycle')
 * @param {{now:number, cooldownUntil?:number, cooldownMs?:number}} ctx
 * @returns {{trigger: string|null, cooldownUntil: number}}
 */
export function resolveCycleAudioCue(snap, { now, cooldownUntil = 0, cooldownMs = CYCLE_HURRY_COOLDOWN_MS } = {}) {
  const edge = CYCLE_EDGE_TO_TRIGGER[snap?.cycleAudioCue];
  if (edge) return { trigger: edge, cooldownUntil };

  const phase = snap?.currentPhase;
  const belowRed = phase && Number.isFinite(snap?.currentRpm) && snap.currentRpm < phase.loRpm;
  const healthDropping = Number.isFinite(snap?.cycleHealthPct) && snap.cycleHealthPct < 1;
  if (belowRed && healthDropping && !(cooldownUntil > now)) {
    return { trigger: 'cycle_hurry', cooldownUntil: now + cooldownMs };
  }
  return { trigger: null, cooldownUntil };
}

export default resolveCycleAudioCue;
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/challengeAudioCues.test.js`
Expected: PASS — `Tests 6 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/challengeAudioCues.js \
        frontend/src/hooks/fitness/challengeAudioCues.test.js
git commit -m "feat(fitness): pure cycle audio-cue resolver with health-based hurry + cooldown"
```

---

## Task 3: Register cycle triggers and wire the cycle branch

Register the four cycle triggers in the supported set and replace the cycle early-return in `_computeAudioDuck` with the resolver.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:29` (`SUPPORTED_AUDIO_CUE_TRIGGERS`), `:7` (import), `:1778` (`_computeAudioDuck`)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`

- [ ] **Step 1: Add the failing cycle-duck cases to the existing engine test**

Append a new `describe` block to `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`:

```javascript
describe('GovernanceEngine — cycle audio duck', () => {
  const cycleCues = [
    { id: 'cyc_start', trigger: 'cycle_start', sound: 'cs.mp3' },
    { id: 'cyc_end',   trigger: 'cycle_end',   sound: 'ce.mp3' },
    { id: 'cyc_fail',  trigger: 'cycle_fail',  sound: 'cf.mp3' },
    { id: 'cyc_hurry', trigger: 'cycle_hurry', sound: 'ch.mp3', volume: 0.6 }
  ];

  const withCycleCues = (now = 1000) => {
    const e = new GovernanceEngine(null, { now: () => now });
    e.configure(baseConfig(cycleCues));
    e.phase = 'unlocked'; // ensure the governance-warning precedence branch is skipped
    return e;
  };

  it('emits cycle_start on the init edge', () => {
    const duck = withCycleCues()._computeAudioDuck({ type: 'cycle', id: 'c1', cycleAudioCue: 'cycle_challenge_init' });
    expect(duck?.cueId).toBe('cyc_start');
  });

  it('emits cycle_fail on the locked edge', () => {
    const duck = withCycleCues()._computeAudioDuck({ type: 'cycle', id: 'c1', cycleAudioCue: 'cycle_locked' });
    expect(duck?.cueId).toBe('cyc_fail');
  });

  it('emits cycle_hurry (with its volume) when below red and health dropping', () => {
    const duck = withCycleCues()._computeAudioDuck({
      type: 'cycle', id: 'c1', cycleAudioCue: null,
      currentPhase: { loRpm: 60, hiRpm: 80 }, currentRpm: 50, cycleHealthPct: 0.8
    });
    expect(duck?.cueId).toBe('cyc_hurry');
    expect(duck?.volume).toBe(0.6);
  });

  it('does not re-emit hurry on the next tick (cooldown)', () => {
    const e = withCycleCues();
    const snap = { type: 'cycle', id: 'c1', cycleAudioCue: null, currentPhase: { loRpm: 60 }, currentRpm: 50, cycleHealthPct: 0.8 };
    expect(e._computeAudioDuck(snap)?.cueId).toBe('cyc_hurry');
    expect(e._computeAudioDuck(snap)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: FAIL — the cycle cues are rejected (`unknown_trigger`) so `_audioCues` is empty, and `_computeAudioDuck` returns `null` for cycle.

- [ ] **Step 3: Register the cycle triggers**

In `GovernanceEngine.js`, extend `SUPPORTED_AUDIO_CUE_TRIGGERS` (`:29`):

```javascript
const SUPPORTED_AUDIO_CUE_TRIGGERS = new Set([
  'challenge_start',      // a challenge appears
  'challenge_remaining',  // challenge timer within threshold_seconds of expiring
  'challenge_complete',   // challenge satisfied
  'governance_warning',   // grace phase begins (screen blurs + health bar)
  'cycle_start',          // cycle challenge appears
  'cycle_end',            // cycle challenge completed
  'cycle_fail',           // cycle challenge locked/failed
  'cycle_hurry'           // rider below red zone, health dropping
]);
```

- [ ] **Step 4: Wire the resolver into `_computeAudioDuck`**

Add the import at the top of `GovernanceEngine.js` (next to the `CadenceFilter` import, `:7`):

```javascript
import { resolveCycleAudioCue } from './challengeAudioCues.js';
```

Replace the cycle early-return (`:1777-1778`):

```javascript
    // Cycle challenges: map the snapshot's lifecycle edges + a health-based
    // hurry to cue triggers (shared duck/SFX engine; see challengeAudioCues.js).
    if (!challengeSnapshot) return null;
    if (challengeSnapshot.type === 'cycle') {
      const cycleNow = this._now();
      const { trigger, cooldownUntil } = resolveCycleAudioCue(challengeSnapshot, {
        now: cycleNow,
        cooldownUntil: this._cycleHurryCooldownUntil || 0
      });
      this._cycleHurryCooldownUntil = cooldownUntil;
      if (!trigger) return null;
      const cue = this._audioCues.find((c) => c.trigger === trigger);
      if (!cue) return null;
      const chId = challengeSnapshot.id || 'cycle';
      const token = trigger === 'cycle_hurry'
        ? `${chId}:cycle_hurry:${Math.floor(cycleNow)}`
        : `${chId}:${cue.id}`;
      return emit(cue, token);
    }
```

(The `if (this.phase === 'warning')` precedence block above it is unchanged.)

- [ ] **Step 5: Run to verify all engine audio tests pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: PASS — volume + cycle cases and the original cases all pass.

- [ ] **Step 6: Run the existing governance suite to confirm no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/governance/`
Expected: PASS (no new failures vs. baseline). Capture the pass/fail summary line as evidence.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js
git commit -m "feat(fitness): wire cycle Start/End/Fail/Hurry SFX into the governance duck engine"
```

---

## Task 4: Add cycle cue config + tame hot levels

Add the four cycle cue entries to the governance config, reusing existing or new assets, and set `volume` on any cues mixing too loud.

**Files:**
- Modify (in the Docker volume): `data/household/config/fitness.yml` → `governance.audio_cues`

- [ ] **Step 1: Read the current config**

Run:
```bash
sudo docker exec daylight-station sh -c 'sed -n "/audio_cues:/,/superusers:/p" data/household/config/fitness.yml'
```
Expected: the four existing `challenge_*` entries.

- [ ] **Step 2: Write the whole file back with cycle cues appended**

Read the full `fitness.yml`, splice the new `audio_cues` block in place of the old one, and write the complete file back (per the CLAUDE.local.md rule: write the complete file, never `sed -i`). The new block:

```yaml
  audio_cues:
    - id: challenge_start
      trigger: challenge_start
      sound: apps/fitness/ux/challenge-start.mp3
      duck_to: 0.2
    - id: challenge_hurry
      trigger: challenge_remaining
      threshold_seconds: 12
      sound: apps/fitness/ux/challenge-hurry.mp3
      duck_to: 0.1
    - id: challenge_complete
      trigger: challenge_complete
      sound: apps/fitness/ux/challenge-complete.mp3
      duck_to: 0.2
      volume: 0.6
    - id: challenge_warning
      trigger: governance_warning
      sound: apps/fitness/ux/challenge-warning.mp3
      duck_to: 0.15
    - id: cycle_start
      trigger: cycle_start
      sound: apps/fitness/ux/challenge-start.mp3
      duck_to: 0.2
    - id: cycle_end
      trigger: cycle_end
      sound: apps/fitness/ux/challenge-complete.mp3
      duck_to: 0.2
    - id: cycle_fail
      trigger: cycle_fail
      sound: apps/fitness/ux/challenge-warning.mp3
      duck_to: 0.15
    - id: cycle_hurry
      trigger: cycle_hurry
      sound: apps/fitness/ux/challenge-hurry.mp3
      duck_to: 0.1
      volume: 0.7
```

> The cycle cues reuse the existing HR assets to start; swap to dedicated cycle SFX paths later by editing the `sound:` lines. `volume` on `challenge_complete`/`cycle_hurry` are examples — tune to taste.

- [ ] **Step 3: Verify the config parses (no rejected cues)**

```bash
sudo docker logs daylight-station 2>&1 | grep -i "audio_cue.config_rejected" | tail
```
Expected: no rejections referencing `cycle_*` triggers (empty result = success).

- [ ] **Step 4: Runtime verification**

In a live cycle challenge on the garage fitness host: start a cycle challenge (Start SFX + duck), drop below the red zone until health falls (Hurry SFX, then silent for the cooldown), and let it complete or lock (End/Fail SFX).

```bash
sudo docker logs daylight-station 2>&1 | grep "fitness.audio_duck.start\|governance.audio_cue.fired" | tail
```
Expected: cycle cue ids (`cyc_start`/`cyc_hurry`/`cyc_end`/`cyc_fail`) appear during the challenge.

(Config files live in the Docker volume and are not git-tracked here — record the change in your deploy log.)

---

## Final Verification

- [ ] Run all touched audio suites:

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/hooks/fitness/challengeAudioCues.test.js \
  frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js \
  frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx
```
Expected: all pass, 0 failed.

- [ ] Confirm the governance suite (`tests/unit/governance/`) has no new failures vs. baseline.
- [ ] Deploy + verify cycle SFX and volume attenuation on the garage host during a real cycle challenge.
