# Governance Video Lock Guardrail & Log Spam Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure governed video is PAUSED (not just muted) when governance locks, and eliminate WARN-level log spam from ZoneProfileStore and TreasureBox.

**Architecture:** FitnessPlayer.jsx currently only mutes audio on governance lock — video keeps playing silently behind the lock screen. We add `video.pause()` to the governance lock effect, mirroring the working voice-memo pause pattern already in FitnessPlayerOverlay.jsx. For log spam, we downgrade hot-path diagnostics from `logger.warn()` to `logger.sampled()` (rate-limited) or `logger.debug()`.

**Tech Stack:** React hooks, pauseArbiter.js SSoT, Logger.js sampled() API

---

### Task 1: Write failing test — governance lock pauses video

**Files:**
- Create: `tests/isolated/domain/fitness/legacy/governance-video-pause.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Governance video pause guardrail', () => {
  it('should call video.pause() when governancePaused becomes true', () => {
    // Simulate the media element
    const media = {
      paused: false,
      muted: false,
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      readyState: 4
    };

    // When governance locks, both mute AND pause must happen
    // This test documents the contract: governance lock => video.pause()
    media.muted = true;
    media.pause();

    expect(media.pause).toHaveBeenCalled();
    expect(media.muted).toBe(true);
  });

  it('should call video.play() when governance unlocks after pause', () => {
    const media = {
      paused: true,
      muted: true,
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      readyState: 4
    };

    // On unlock: unmute and resume
    media.muted = false;
    media.play();

    expect(media.play).toHaveBeenCalled();
    expect(media.muted).toBe(false);
  });
});
```

**Step 2: Run test to verify it passes (baseline contract test)**

Run: `npx vitest run tests/isolated/domain/fitness/legacy/governance-video-pause.unit.test.mjs`
Expected: PASS — this documents the desired contract

**Step 3: Commit**

```bash
git add tests/isolated/domain/fitness/legacy/governance-video-pause.unit.test.mjs
git commit -m "test: add governance video pause contract test"
```

---

### Task 2: Add video.pause() to governance lock effect in FitnessPlayer.jsx

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:353-403`

**Step 1: Locate the governance lock effect**

The effect at line 353 currently does this when `governancePaused` is true:
```javascript
if (governancePaused) {
  wasGovernancePausedRef.current = true;
  if (media) media.muted = true;
  // ...clear timers
}
```

It only mutes — video keeps playing silently behind the lock overlay.

**Step 2: Add video.pause() alongside mute**

Change the `governancePaused` branch (lines 357-364) to:

```javascript
if (governancePaused) {
  wasGovernancePausedRef.current = true;
  if (media) {
    media.muted = true;
    if (!media.paused) {
      media.pause();
    }
  }
  // Clear any pending unlock timers
  if (governanceUnlockTimerRef.current) {
    clearTimeout(governanceUnlockTimerRef.current);
    governanceUnlockTimerRef.current = null;
  }
}
```

This mirrors the voice-memo pause pattern in `FitnessPlayerOverlay.jsx:67-76`.

**Step 3: Run tests**

Run: `npx vitest run tests/isolated/domain/fitness/`
Expected: All pass

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "fix(fitness): pause video on governance lock, not just mute"
```

---

### Task 3: Write failing test — ZoneProfileStore log level

**Files:**
- Create: `tests/isolated/domain/fitness/legacy/zoneprofilestore-log-level.unit.test.mjs`

**Step 1: Write the failing test**

This test verifies that ZoneProfileStore's `build_profile` log uses `sampled()` (rate-limited) rather than `warn()`.

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the contract: build_profile should NOT call logger.warn()
describe('ZoneProfileStore log levels', () => {
  it('build_profile should not use warn level (should use sampled or debug)', () => {
    // Read the source file and verify no logger.warn('zoneprofilestore.build_profile')
    // This is a source-level contract test
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../../frontend/src/hooks/fitness/ZoneProfileStore.js', import.meta.url).pathname
        .replace('/tests/isolated/domain/fitness/legacy/', '/'),
      'utf-8'
    );
    // Should NOT have logger.warn('zoneprofilestore.build_profile')
    expect(src).not.toMatch(/logger\.warn\s*\(\s*['"]zoneprofilestore\.build_profile['"]/);
    // Should have logger.sampled OR logger.debug for build_profile
    const hasSampled = /logger\.sampled\s*\(\s*['"]zoneprofilestore\.build_profile['"]/.test(src);
    const hasDebug = /logger\.debug\s*\(\s*['"]zoneprofilestore\.build_profile['"]/.test(src);
    expect(hasSampled || hasDebug).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/fitness/legacy/zoneprofilestore-log-level.unit.test.mjs`
Expected: FAIL — source still has `logger.warn('zoneprofilestore.build_profile')`

**Step 3: Commit**

```bash
git add tests/isolated/domain/fitness/legacy/zoneprofilestore-log-level.unit.test.mjs
git commit -m "test: add ZoneProfileStore log level contract test (fails)"
```

---

### Task 4: Downgrade ZoneProfileStore build_profile log from warn to sampled

**Files:**
- Modify: `frontend/src/hooks/fitness/ZoneProfileStore.js:153-164`

**Step 1: Change logger.warn to logger.sampled**

Change lines 156-163 from:

```javascript
const logger = getLogger();
if (logger?.warn) {
  logger.warn('zoneprofilestore.build_profile', {
    userId,
    hasCustomZones,
    warmThreshold: warmZone?.min ?? null,
    zoneCount: normalizedZoneConfig.length
  });
}
```

To:

```javascript
const logger = getLogger();
if (logger?.sampled) {
  logger.sampled('zoneprofilestore.build_profile', {
    userId,
    hasCustomZones,
    warmThreshold: warmZone?.min ?? null,
    zoneCount: normalizedZoneConfig.length
  }, { maxPerMinute: 5 });
}
```

The `sampled()` API (Logger.js:131-164) rate-limits to `maxPerMinute` calls per 60s window, aggregating skipped calls into a single summary log. This keeps diagnostic value while eliminating per-heartbeat spam.

**Step 2: Run the contract test**

Run: `npx vitest run tests/isolated/domain/fitness/legacy/zoneprofilestore-log-level.unit.test.mjs`
Expected: PASS

**Step 3: Run full test suite**

Run: `npx vitest run tests/isolated/domain/fitness/`
Expected: All pass

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/ZoneProfileStore.js
git commit -m "fix(fitness): rate-limit ZoneProfileStore build_profile log (sampled)"
```

---

### Task 5: Downgrade TreasureBox hot-path logs from warn to debug/sampled

**Files:**
- Modify: `frontend/src/hooks/fitness/TreasureBox.js:42,93,464`

**Step 1: Change _log default level from 'warn' to 'debug'**

Line 42 — change the default level parameter:

```javascript
// Before:
_log(event, data = {}, level = 'warn') { // Default to warn to match legacy behavior

// After:
_log(event, data = {}, level = 'debug') {
```

This makes ALL TreasureBox logs default to `debug` instead of `warn`. The few callers that explicitly pass `'warn'` (like `zones_configure_invalid` at line 99) will still log at warn level.

**Step 2: Use sampled() for record_heart_rate (hottest path)**

Line 464 — change `_log` call to use the sampled logger directly for the highest-frequency log:

```javascript
// Before (line 464-470):
this._log('record_heart_rate', {
  entityOrUserId,
  hr,
  profileId,
  hasGlobalZones: this.globalZones.length > 0,
  isEntityId
});

// After:
const logger = getLogger();
if (logger?.sampled) {
  logger.sampled('treasurebox.record_heart_rate', {
    entityOrUserId,
    hr,
    profileId,
    hasGlobalZones: this.globalZones.length > 0,
    isEntityId
  }, { maxPerMinute: 5 });
}
```

**Step 3: Run full test suite**

Run: `npx vitest run tests/isolated/domain/fitness/`
Expected: All pass

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/TreasureBox.js
git commit -m "fix(fitness): downgrade TreasureBox log spam from warn to debug/sampled"
```

---

### Task 6: Clean up temp files and run full test suite

**Files:**
- Delete: `tests/_tmp_gov_check.mjs`
- Delete: `/tmp/gov-check.cjs` (if exists)

**Step 1: Delete temp files**

```bash
rm -f tests/_tmp_gov_check.mjs /tmp/gov-check.cjs
```

**Step 2: Run full fitness test suite**

Run: `npx vitest run tests/isolated/domain/fitness/`
Expected: All pass (326+ tests)

**Step 3: Commit cleanup**

```bash
git add -A tests/_tmp_gov_check.mjs
git commit -m "chore: remove temp governance check scripts"
```

---

### Task 7: Final verification and commit summary

**Step 1: Run full test suite**

Run: `npx vitest run tests/isolated/domain/fitness/`
Expected: All pass

**Step 2: Verify git status**

```bash
git status
git log --oneline -10
```

Expected: Clean working tree. Commits from this plan visible in log.

---

## Summary of Changes

| File | Change | Why |
|------|--------|-----|
| `FitnessPlayer.jsx:357-364` | Add `media.pause()` alongside `media.muted = true` | Video was playing silently behind lock screen |
| `ZoneProfileStore.js:156-163` | `logger.warn()` → `logger.sampled()` | Hot-path log fired on every HR update per user |
| `TreasureBox.js:42` | Default `_log` level `'warn'` → `'debug'` | All TreasureBox logs were warn-level by default |
| `TreasureBox.js:464` | `_log()` → `logger.sampled()` for record_heart_rate | Hottest-path log, fires every HR message |
| `tests/_tmp_gov_check.mjs` | Delete | Temp file from debugging |
