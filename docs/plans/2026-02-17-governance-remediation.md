# Governance Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all pending governance bugs identified in the Feb 17 session audit (`docs/_wip/audits/2026-02-17-governance-feb17-session-audit.md`).

**Architecture:** Four independent fixes targeting different subsystems: (1) GovernanceEngine warning hysteresis to reduce UI noise, (2) premature warning-phase video pause via challenge videoLocked race, (3) voice memo / governance pause coordination, (4) ZoneProfileStore rebuild scoping to active participants only.

**Tech Stack:** React hooks, vanilla JS classes, Jest (ESM mode via `--experimental-vm-modules`)

---

## Context

### Audit Summary (P2-P5)

| Priority | Issue | Root Cause | Impact |
|----------|-------|-----------|--------|
| P2 | Zone boundary hysteresis | HR oscillates 1-3 BPM around threshold; governance re-evaluates on every 100ms debounced zone change; no warning cooldown | 19 warning flashes in 33 minutes |
| P3 | Premature warning-phase pause | `challengeState.videoLocked` can be `true` from a just-failed challenge while phase is still `warning` (not yet `locked`), causing `videoLocked` OR condition to fire | Video paused 20s before lock |
| P4 | Voice memo / governance uncoordinated | Voice memo pauses video via `setVideoPlayerPaused(true)`, closes and sets `false`, but if governance cycling starts between close and React re-render, the play() call races with governance state | Video never resumed after voice memo |
| P5 | Render thrashing / profile rebuild waste | `_syncZoneProfiles(getAllUsers())` rebuilds profiles for all 17 household members on every HR update; only 4 are active participants | 66k rebuilds/60s, 169 renders/sec |

### Key Files

| File | Role |
|------|------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Core governance logic (phases, evaluation, challenges) |
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | HR zone profile computation with hysteresis |
| `frontend/src/hooks/fitness/FitnessSession.js` | Session orchestrator, HR device handling, zone sync |
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | Video player with governance pause/resume effects |
| `frontend/src/modules/Player/utils/pauseArbiter.js` | Pause priority resolution |
| `frontend/src/context/FitnessContext.jsx` | Voice memo overlay open/close, video player pause state |
| `tests/unit/governance/GovernanceEngine.test.mjs` | 34 existing governance tests |

### Test Command

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/GovernanceEngine.test.mjs --no-cache
```

---

## Task 1: Warning Cooldown in GovernanceEngine

**Problem:** 19 `warning_started` events in 33 minutes. Alan's HR oscillates 119-127 around his 125 threshold. Each 1-2 BPM dip triggers warning; each recovery dismisses it. Average cycle: 7-30s.

**Root Cause:** When `allSatisfied` goes `true`, the engine immediately sets `unlocked` and clears the deadline. When `allSatisfied` flips back to `false` 5-10 seconds later, a brand-new warning starts. There's no cooldown between consecutive warning cycles.

**Fix:** Add a `_warningCooldownUntil` timestamp. After a warning dismisses (warning -> unlocked), suppress new warnings for a configurable cooldown (default 30s). During cooldown, if requirements fail again, stay in `unlocked` (don't flash warning). If still failing when cooldown expires, then enter warning.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1428-1475` (evaluate phase-setting block)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:619-699` (`_setPhase`)
- Test: `tests/unit/governance/GovernanceEngine.test.mjs`

**Step 1: Write the failing tests**

Add to `tests/unit/governance/GovernanceEngine.test.mjs`:

```javascript
describe('warning cooldown', () => {
  it('should suppress new warning within cooldown after warning dismisses', () => {
    const mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#0000ff' },
          { id: 'warm', name: 'Warm', color: '#ffaa00' },
          { id: 'active', name: 'Active', color: '#ff0000' },
        ]
      }
    };

    const engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30,
      warning_cooldown_seconds: 30
    }, [], {});

    // Set media so governance is active
    engine.setMedia({ id: 'test-media', labels: ['exercise'] });

    const phaseChanges = [];
    engine.registerCallbacks(
      () => {}, // onPulse
      (phase) => phaseChanges.push(phase),
      () => {} // onStateChange
    );

    // Start: both users above threshold -> unlocked
    engine.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap: { cool: 0, warm: 1, active: 2 },
      zoneInfoMap: {
        cool: { id: 'cool', name: 'Cool' },
        warm: { id: 'warm', name: 'Warm' },
        active: { id: 'active', name: 'Active' }
      }
    });
    expect(engine.phase).toBe('unlocked');

    // Alice drops to cool -> warning
    engine.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: { alice: 'cool', bob: 'active' },
      zoneRankMap: { cool: 0, warm: 1, active: 2 },
      zoneInfoMap: {
        cool: { id: 'cool', name: 'Cool' },
        warm: { id: 'warm', name: 'Warm' },
        active: { id: 'active', name: 'Active' }
      }
    });
    expect(engine.phase).toBe('warning');

    // Alice recovers -> unlocked (cooldown starts)
    engine.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap: { cool: 0, warm: 1, active: 2 },
      zoneInfoMap: {
        cool: { id: 'cool', name: 'Cool' },
        warm: { id: 'warm', name: 'Warm' },
        active: { id: 'active', name: 'Active' }
      }
    });
    expect(engine.phase).toBe('unlocked');

    // Alice drops again within cooldown -> should STAY unlocked (suppressed)
    engine.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: { alice: 'cool', bob: 'active' },
      zoneRankMap: { cool: 0, warm: 1, active: 2 },
      zoneInfoMap: {
        cool: { id: 'cool', name: 'Cool' },
        warm: { id: 'warm', name: 'Warm' },
        active: { id: 'active', name: 'Active' }
      }
    });
    // Key assertion: stays unlocked during cooldown
    expect(engine.phase).toBe('unlocked');
  });

  it('should allow warning after cooldown expires', () => {
    const mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#0000ff' },
          { id: 'active', name: 'Active', color: '#ff0000' },
        ]
      }
    };

    const engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30,
      warning_cooldown_seconds: 10
    }, [], {});

    engine.setMedia({ id: 'test-media', labels: ['exercise'] });
    engine.registerCallbacks(() => {}, () => {}, () => {});

    const zoneRankMap = { cool: 0, active: 1 };
    const zoneInfoMap = {
      cool: { id: 'cool', name: 'Cool' },
      active: { id: 'active', name: 'Active' }
    };

    // unlocked -> warning -> unlocked (cooldown starts)
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'active' }, zoneRankMap, zoneInfoMap });
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'cool' }, zoneRankMap, zoneInfoMap });
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'active' }, zoneRankMap, zoneInfoMap });
    expect(engine.phase).toBe('unlocked');

    // Simulate cooldown expiry by advancing the internal timestamp
    engine._warningCooldownUntil = Date.now() - 1; // expired

    // Now drop again -> should enter warning
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'cool' }, zoneRankMap, zoneInfoMap });
    expect(engine.phase).toBe('warning');
  });

  it('should not apply cooldown when no warning_cooldown_seconds configured', () => {
    const mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#0000ff' },
          { id: 'active', name: 'Active', color: '#ff0000' },
        ]
      }
    };

    const engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30
      // no warning_cooldown_seconds
    }, [], {});

    engine.setMedia({ id: 'test-media', labels: ['exercise'] });
    engine.registerCallbacks(() => {}, () => {}, () => {});

    const zoneRankMap = { cool: 0, active: 1 };
    const zoneInfoMap = {
      cool: { id: 'cool', name: 'Cool' },
      active: { id: 'active', name: 'Active' }
    };

    // unlocked -> warning -> unlocked
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'active' }, zoneRankMap, zoneInfoMap });
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'cool' }, zoneRankMap, zoneInfoMap });
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'active' }, zoneRankMap, zoneInfoMap });

    // Drop again -> should enter warning (no cooldown)
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'cool' }, zoneRankMap, zoneInfoMap });
    expect(engine.phase).toBe('warning');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/GovernanceEngine.test.mjs --no-cache -t "warning cooldown"
```
Expected: FAIL — first test expects `unlocked` but gets `warning` (no cooldown logic exists yet).

**Step 3: Implement warning cooldown**

In `GovernanceEngine.js`:

1. Add `_warningCooldownUntil = null` in constructor (around line 157):
```javascript
this._warningCooldownUntil = null;
```

2. In `_setPhase()` (line 619), after `this.phase = newPhase`, add cooldown tracking when transitioning **from** warning to unlocked:
```javascript
// Start warning cooldown when warning dismisses to unlocked
if (oldPhase === 'warning' && newPhase === 'unlocked') {
  const cooldownSeconds = Number(this.config?.warning_cooldown_seconds);
  if (Number.isFinite(cooldownSeconds) && cooldownSeconds > 0) {
    this._warningCooldownUntil = now + cooldownSeconds * 1000;
  }
}
```

3. In the evaluate phase-setting block (around line 1439-1475), wrap the "Was satisfied, now failing -> warning with grace period" block. Before entering warning, check cooldown:
```javascript
} else {
  // Was satisfied, now failing -> warning with grace period
  // Check warning cooldown: if recently dismissed a warning, suppress re-entry
  const inCooldown = this._warningCooldownUntil && now < this._warningCooldownUntil;
  if (inCooldown) {
    // Stay in unlocked during cooldown, but DON'T clear satisfiedOnce
    // so when cooldown expires, the next failing eval enters warning normally
    return;
  }

  let graceSeconds = baseGraceSeconds;
  // ... rest of existing grace period logic
```

4. Clear cooldown on media unload / reset:
In `_deactivateGovernance()` or `reset()`, add:
```javascript
this._warningCooldownUntil = null;
```

**Step 4: Run all governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/GovernanceEngine.test.mjs --no-cache
```
Expected: All tests pass (34 existing + 3 new = 37).

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "fix(governance): add warning cooldown to prevent zone boundary oscillation flashing

After a warning dismisses (warning -> unlocked), suppress new warnings
for a configurable cooldown period (warning_cooldown_seconds). During
cooldown, failing zone evaluations stay in unlocked phase. This prevents
the 19 warning flashes in 33 minutes observed when HR oscillates 1-3 BPM
around threshold boundaries."
```

---

## Task 2: Fix Premature Warning-Phase Video Pause

**Problem:** At 01:25:50, video paused during warning phase. `videoLocked` should be `false` during warning. But `challengeState.videoLocked` can be `true` from a challenge that just failed/expired, and the `||` in the `videoLocked` computation makes it `true` even though the phase-based check correctly excludes warning.

**Root Cause:** Line 269-270 of GovernanceEngine.js:
```javascript
videoLocked: this.challengeState?.videoLocked
  || (this._mediaIsGoverned() && this.phase !== 'unlocked' && this.phase !== 'warning'),
```
And line 1157-1158 (the cached state version):
```javascript
videoLocked: !!(this.challengeState && this.challengeState.videoLocked)
  || (this._mediaIsGoverned() && this.phase !== 'unlocked' && this.phase !== 'warning'),
```

If `challengeState.videoLocked` is `true` (set at line 2038 or 2108 when a challenge fails), the entire `videoLocked` expression is `true` regardless of phase. The challenge `videoLocked` was designed for challenge-failure locks, but it doesn't check whether the governance phase has since moved to `warning` — it should only apply when phase is actually `locked`.

**Fix:** Gate `challengeState.videoLocked` behind a phase check. Challenge videoLocked should only contribute when phase is `locked` or `pending`.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:269-270` (state getter)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1157-1158` (cached state)
- Test: `tests/unit/governance/GovernanceEngine.test.mjs`

**Step 1: Write the failing test**

```javascript
describe('videoLocked during warning phase', () => {
  it('should NOT set videoLocked during warning even if challengeState.videoLocked is true', () => {
    const mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#0000ff' },
          { id: 'active', name: 'Active', color: '#ff0000' },
        ]
      }
    };

    const engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30
    }, [], {});

    engine.setMedia({ id: 'test-media', labels: ['exercise'] });
    engine.registerCallbacks(() => {}, () => {}, () => {});

    const zoneRankMap = { cool: 0, active: 1 };
    const zoneInfoMap = {
      cool: { id: 'cool', name: 'Cool' },
      active: { id: 'active', name: 'Active' }
    };

    // Get to unlocked first
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'active' }, zoneRankMap, zoneInfoMap });
    expect(engine.phase).toBe('unlocked');

    // Simulate challenge videoLocked being set (e.g., from a just-failed challenge)
    engine.challengeState.videoLocked = true;

    // Now drop to cool -> warning phase
    engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'cool' }, zoneRankMap, zoneInfoMap });
    expect(engine.phase).toBe('warning');

    // videoLocked should be FALSE during warning, even though challengeState.videoLocked is true
    const state = engine.getState();
    expect(state.videoLocked).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/GovernanceEngine.test.mjs --no-cache -t "videoLocked during warning"
```
Expected: FAIL — `videoLocked` is `true` because `challengeState.videoLocked` is `true`.

**Step 3: Implement fix**

In `GovernanceEngine.js`, change both `videoLocked` computations.

Line 269-270 (state getter):
```javascript
// Before:
videoLocked: this.challengeState?.videoLocked
  || (this._mediaIsGoverned() && this.phase !== 'unlocked' && this.phase !== 'warning'),

// After:
videoLocked: (this.challengeState?.videoLocked && this.phase !== 'unlocked' && this.phase !== 'warning')
  || (this._mediaIsGoverned() && this.phase !== 'unlocked' && this.phase !== 'warning'),
```

This can be simplified to:
```javascript
videoLocked: (this.challengeState?.videoLocked || this._mediaIsGoverned())
  && this.phase !== 'unlocked' && this.phase !== 'warning',
```

Line 1157-1158 (cached state):
```javascript
// Before:
videoLocked: !!(this.challengeState && this.challengeState.videoLocked)
  || (this._mediaIsGoverned() && this.phase !== 'unlocked' && this.phase !== 'warning'),

// After:
videoLocked: (this.challengeState?.videoLocked || this._mediaIsGoverned())
  && this.phase !== 'unlocked' && this.phase !== 'warning',
```

**Step 4: Run all governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/GovernanceEngine.test.mjs --no-cache
```
Expected: All tests pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "fix(governance): prevent challengeState.videoLocked from pausing video during warning phase

Gate challengeState.videoLocked behind the same phase check as the
base governance videoLocked. Both conditions now require phase to be
neither 'unlocked' nor 'warning'. This prevents a stale challenge
videoLocked flag from causing premature video pause during the
grace period warning."
```

---

## Task 3: Voice Memo / Governance Pause Coordination

**Problem:** At 01:51:22, voice memo pauses video. Memo closes at 01:51:30 and calls `setVideoPlayerPaused(false)` + `videoPlayerRef.current.play()`. But governance warning cycling starts around the same time. The `play()` call may be immediately overridden by governance's pause logic, leaving video permanently paused.

**Root Cause:** Two independent pause owners (voice memo and governance) act on the same media element without coordination. When voice memo closes:
1. `closeVoiceMemoOverlay()` sets `videoPlayerPaused = false` and calls `play()`
2. But governance may be in `warning` phase and about to transition to `locked`
3. The `governancePaused` effect in FitnessPlayer.jsx fires and calls `media.pause()`
4. Since `wasGovernancePausedRef` tracks governance pauses, not voice memo pauses, the unlock -> resume path doesn't fire

The voice memo has its own pause/resume effect in FitnessPlayer.jsx (lines 385-405) that uses `videoPlayerPaused` state. The issue is that this effect responds to `videoPlayerPaused` going `false`, tries to play, but then governance immediately pauses again.

**Fix:** After voice memo closes, if governance is currently locked/pending (videoLocked), don't try to force-play — let governance handle the resume when it unlocks. If governance is in unlocked/warning/idle, proceed with voice memo resume normally.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:823-853` (`closeVoiceMemoOverlay`)
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:385-405` (voice memo pause/resume effect)

**Step 1: Identify the coordination gap**

The voice memo effect (FitnessPlayer.jsx:385-405) already has the right pattern — it checks `videoPlayerPaused` and resumes. The problem is it calls `play()` regardless of governance state. When governance is `locked`, this `play()` immediately gets overridden by the governance pause effect.

**Step 2: Implement fix in FitnessPlayer.jsx voice memo effect**

Change lines 385-405 to check governance state before resuming:

```javascript
// Handled manual pause/resume for voice memos (BUG-08)
const wasPlayingBeforeVoiceMemoRef = useRef(false);
useEffect(() => {
  if (videoPlayerPaused) {
    // Capture playing state before pausing
    if (mediaElement && !mediaElement.paused) {
      wasPlayingBeforeVoiceMemoRef.current = true;
      mediaElement.pause();
    }
  } else {
    // Resume if we were playing before the pause
    if (wasPlayingBeforeVoiceMemoRef.current && mediaElement) {
      wasPlayingBeforeVoiceMemoRef.current = false;
      // Only resume if governance isn't currently locking the video
      // If governance is locked, let governance handle resume on unlock
      if (!governancePaused) {
        if (mediaElement.paused) {
          mediaElement.play().catch(() => {});
        }
      }
      // If governance IS paused, wasGovernancePausedRef is already true,
      // so the governance unlock effect will resume playback naturally
    }
  }
}, [videoPlayerPaused, mediaElement, governancePaused]);
```

**Step 3: Verify no test infrastructure changes needed**

This is a React effect change. Manual verification with dev server is the appropriate test approach. No unit test file exists for FitnessPlayer.jsx.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "fix(fitness): coordinate voice memo resume with governance pause state

When voice memo closes, check if governance currently has the video
locked. If so, skip the play() call and let governance handle resume
on its next unlock transition. This prevents the play()-then-immediately-
pause race that left the video permanently paused after voice memos."
```

---

## Task 4: Scope ZoneProfileStore Rebuilds to Active Participants

**Problem:** `_syncZoneProfiles(getAllUsers())` rebuilds zone profiles for all 17 household members on every HR device update. Only 4 are active participants. This causes 60k-66k profile rebuilds per 60 seconds and contributes to 169 renders/sec peak.

**Root Cause:** `FitnessSession.js` line 522 uses `this.userManager.getAllUsers()` which returns every household member. The signature-based change detection in `ZoneProfileStore.syncFromUsers()` catches most redundant work, but the profile-building loop (`#buildProfileFromUser` for each of 17 users) still runs on every call, wasting CPU.

**Fix:** Replace `getAllUsers()` with `getActiveParticipants()` (which returns only roster-active participants). The ZoneProfileStore doesn't need profiles for users who aren't in the fitness session.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:521-523` (HR device update sync)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1478` (timeline tick sync)

**Step 1: Understand the call sites**

Two call sites pass `getAllUsers()` to `_syncZoneProfiles`:

1. **Line 521-523** (HR device update): Triggered on every heart rate reading from any device.
```javascript
const allUsers = this.userManager.getAllUsers();
const changed = this._syncZoneProfiles(allUsers);
```

2. **Line 1478** (timeline tick): Triggered every 5000ms during snapshot recording.
```javascript
this._syncZoneProfiles(allUsers);
```
Where `allUsers` is defined earlier in the same function as `this.userManager.getAllUsers()`.

**Step 2: Implement fix — HR device update path**

Change line 522 from:
```javascript
const allUsers = this.userManager.getAllUsers();
```
To:
```javascript
const allUsers = this._participantRoster?.getActive() || this.userManager.getAllUsers();
```

This falls back to `getAllUsers()` if the roster isn't initialized yet (safety).

**Step 3: Implement fix — timeline tick path**

At line 1478, the `allUsers` variable is already defined for the broader snapshot function. Rather than changing that variable (which other code uses), pass a scoped list just for zone profiles.

Change line 1478 from:
```javascript
this._syncZoneProfiles(allUsers);
```
To:
```javascript
const activeUsers = this._participantRoster?.getActive() || allUsers;
this._syncZoneProfiles(activeUsers);
```

**Step 4: Verify no zone data is lost**

The `ZoneProfileStore` only needs profiles for users that governance evaluates. Governance only evaluates `activeParticipants` (from the roster). Non-active users aren't checked by `_evaluateZoneRequirement`. So reducing the profile scope to active participants is correct.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "perf(fitness): scope zone profile rebuilds to active participants only

Replace getAllUsers() (17 household members) with getActive() (only
session participants) when syncing ZoneProfileStore. Non-active users
aren't evaluated by governance, so their profiles don't need rebuilding
on every HR update. Reduces profile rebuild volume ~4x."
```

---

## Task 5: Add `warning_cooldown_seconds` to Governance Config YAML

**Problem:** Task 1 adds `warning_cooldown_seconds` support but doesn't set a value in the YAML config.

**Files:**
- Modify: Governance config YAML (find via ConfigService)

**Step 1: Find the governance YAML config**

```bash
grep -r "grace_period_seconds" data/ --include="*.yml" -l
```

This will reveal the YAML file(s) that configure governance.

**Step 2: Add `warning_cooldown_seconds: 30` alongside existing `grace_period_seconds`**

```yaml
warning_cooldown_seconds: 30
```

**Step 3: Commit**

```bash
git add <config-file>
git commit -m "config(governance): add warning_cooldown_seconds: 30 to reduce warning flash frequency"
```

---

## Task 6: Run Full Test Suite and Verify

**Step 1: Run governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/GovernanceEngine.test.mjs --no-cache
```
Expected: All tests pass (34 existing + 4 new).

**Step 2: Run broader test suite for regressions**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest --no-cache
```

**Step 3: Verify no lint errors in changed files**

```bash
npx eslint frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/FitnessSession.js frontend/src/modules/Fitness/FitnessPlayer.jsx frontend/src/context/FitnessContext.jsx
```

---

## Execution Summary

| Task | Files Modified | Tests Added | Risk |
|------|---------------|-------------|------|
| 1. Warning cooldown | GovernanceEngine.js | 3 | Low — additive, config-gated |
| 2. Fix warning-phase pause | GovernanceEngine.js | 1 | Low — tightens existing condition |
| 3. Voice memo coordination | FitnessPlayer.jsx | 0 (manual verify) | Low — adds guard to existing effect |
| 4. Scope profile rebuilds | FitnessSession.js | 0 (perf improvement) | Low — fallback to getAllUsers() |
| 5. YAML config | config YAML | 0 | None — config value |
| 6. Verify all tests | — | — | — |

**Dependencies:** Tasks 1-4 are independent and can be implemented in any order. Task 5 depends on Task 1. Task 6 runs after all others.
