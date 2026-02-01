# Ambient LED Grace Period Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent ambient LED flickering during active workout sessions when heart rate zone data is temporarily lost.

**Architecture:** Add a grace period timer in `AmbientLedAdapter` that delays LED-off when zones drop to empty during an active session (`sessionEnded: false`). The timer is cleared when zones return or when the session explicitly ends.

**Tech Stack:** Node.js ES modules, Jest unit tests

---

## Task 1: Add Grace Period State to AmbientLedAdapter

**Files:**
- Modify: `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs:46-82`
- Test: `tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs`

**Step 1: Write the failing test**

Add to `tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs`:

```javascript
describe('grace period', () => {
  test('delays LED-off when zones become empty during active session', async () => {
    jest.useFakeTimers();

    // Activate with a zone first
    await adapter.syncZone({
      zones: [{ zoneId: 'warm', isActive: true }],
      sessionEnded: false,
      householdId: 'test-hid'
    });
    expect(adapter.lastScene).toBe('scene.led_yellow');
    mockGateway.activateScene.mockClear();

    // Now zones become empty (but session not ended) - should NOT immediately turn off
    adapter.lastActivatedAt = 0; // bypass rate limiting
    const result = await adapter.syncZone({
      zones: [],
      sessionEnded: false,
      householdId: 'test-hid'
    });

    expect(result.ok).toBe(true);
    expect(result.gracePeriodStarted).toBe(true);
    expect(mockGateway.activateScene).not.toHaveBeenCalled(); // Should NOT call off yet
    expect(adapter.lastScene).toBe('scene.led_yellow'); // Still showing previous scene

    jest.useRealTimers();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs -t "delays LED-off when zones become empty"`
Expected: FAIL - `gracePeriodStarted` is undefined

**Step 3: Add grace period constants and state**

Edit `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs` - add after line 18:

```javascript
const ZONE_LOSS_GRACE_PERIOD_MS = 30000; // 30 seconds grace before turning off
```

Edit constructor (after line 65 `this.backoffUntil = 0;`):

```javascript
    // Grace period for transient zone loss
    this.graceTimer = null;
    this.graceStartedAt = null;
```

**Step 4: Run test to verify it still fails**

Run: `npm test -- tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs -t "delays LED-off when zones become empty"`
Expected: FAIL - still no `gracePeriodStarted` in result

**Step 5: Commit**

```bash
git add backend/src/2_adapters/fitness/AmbientLedAdapter.mjs tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): add grace period state scaffolding for ambient LED

Adds ZONE_LOSS_GRACE_PERIOD_MS constant and graceTimer/graceStartedAt
state to AmbientLedAdapter in preparation for transient zone loss handling.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Implement Grace Period Logic in syncZone

**Files:**
- Modify: `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs:163-255`
- Test: `tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs`

**Step 1: Write additional failing tests**

Add to the `describe('grace period')` block:

```javascript
  test('clears grace period when zones return', async () => {
    jest.useFakeTimers();

    // Activate, then zones empty
    await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
    adapter.lastActivatedAt = 0;
    await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });

    expect(adapter.graceTimer).not.toBeNull();

    // Zones return - grace should clear
    adapter.lastActivatedAt = 0;
    mockGateway.activateScene.mockClear();
    const result = await adapter.syncZone({ zones: [{ zoneId: 'hot', isActive: true }], sessionEnded: false, householdId: 'hid' });

    expect(result.ok).toBe(true);
    expect(adapter.graceTimer).toBeNull();
    expect(adapter.graceStartedAt).toBeNull();
    expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_orange');

    jest.useRealTimers();
  });

  test('turns off LED after grace period expires', async () => {
    jest.useFakeTimers();

    // Activate, then zones empty
    await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
    adapter.lastActivatedAt = 0;
    await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });

    mockGateway.activateScene.mockClear();

    // Advance past grace period
    jest.advanceTimersByTime(31000);

    // Grace timer should have fired
    expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_off');
    expect(adapter.lastScene).toBe('scene.led_off');

    jest.useRealTimers();
  });

  test('immediately turns off when session explicitly ends', async () => {
    jest.useFakeTimers();

    // Activate with zone
    await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
    adapter.lastActivatedAt = 0;

    // Start grace period
    await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });
    expect(adapter.graceTimer).not.toBeNull();

    mockGateway.activateScene.mockClear();
    adapter.lastActivatedAt = 0;

    // Session ends - should immediately turn off and clear grace
    const result = await adapter.syncZone({ zones: [], sessionEnded: true, householdId: 'hid' });

    expect(result.ok).toBe(true);
    expect(result.scene).toBe('scene.led_off');
    expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_off');
    expect(adapter.graceTimer).toBeNull();

    jest.useRealTimers();
  });

  test('does not start grace period when session ends', async () => {
    jest.useFakeTimers();

    // Activate with zone
    await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
    adapter.lastActivatedAt = 0;
    mockGateway.activateScene.mockClear();

    // Session ends with empty zones - should turn off immediately, no grace
    const result = await adapter.syncZone({ zones: [], sessionEnded: true, householdId: 'hid' });

    expect(result.ok).toBe(true);
    expect(result.scene).toBe('scene.led_off');
    expect(result.gracePeriodStarted).toBeUndefined();
    expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_off');

    jest.useRealTimers();
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs -t "grace period"`
Expected: FAIL - grace period logic not implemented

**Step 3: Implement grace period logic**

Edit `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs`. Replace the `#resolveTargetScene` method (lines 136-159) and add grace period handling in `syncZone`.

Add helper method after `#resolveSceneFromConfig`:

```javascript
  /**
   * Clear any active grace period timer
   * @private
   */
  #clearGraceTimer() {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
      this.graceStartedAt = null;
    }
  }
```

In `syncZone`, after the `targetScene` resolution (around line 209), replace the deduplication and rate limiting section with grace period aware logic:

```javascript
    // Grace period handling for transient zone loss during active sessions
    const isZoneEmpty = !zones.some(z => z && z.isActive !== false && this.normalizeZoneId(z.zoneId));
    const offScene = this.#resolveSceneFromConfig(sceneConfig, 'off');

    // Session end: always immediately turn off and clear grace
    if (sessionEnded) {
      this.#clearGraceTimer();
      // Continue to activation logic below
    }
    // Zone loss during active session: start grace period instead of immediate off
    else if (isZoneEmpty && targetScene === offScene && this.lastScene && this.lastScene !== offScene) {
      // Already in grace period? Just return, timer is running
      if (this.graceTimer) {
        this.#logger.debug?.('fitness.zone_led.grace_period.active', {
          elapsedMs: Date.now() - this.graceStartedAt,
          remainingMs: ZONE_LOSS_GRACE_PERIOD_MS - (Date.now() - this.graceStartedAt)
        });
        return {
          ok: true,
          skipped: true,
          reason: 'grace_period_active',
          scene: this.lastScene
        };
      }

      // Start grace period
      this.graceStartedAt = Date.now();
      this.graceTimer = setTimeout(async () => {
        this.graceTimer = null;
        this.graceStartedAt = null;

        // Fire the off scene after grace period expires
        try {
          const result = await this.#gateway.activateScene(offScene);
          if (result.ok) {
            const previousScene = this.lastScene;
            this.lastScene = offScene;
            this.lastActivatedAt = Date.now();
            this.failureCount = 0;

            this.metrics.activatedCount++;
            this.metrics.lastActivatedScene = offScene;
            this.metrics.lastActivatedTime = nowTs24();
            this.metrics.sceneHistogram[offScene] = (this.metrics.sceneHistogram[offScene] || 0) + 1;

            this.#logger.info?.('fitness.zone_led.grace_period.expired', {
              scene: offScene,
              previousScene,
              gracePeriodMs: ZONE_LOSS_GRACE_PERIOD_MS
            });
          }
        } catch (error) {
          this.failureCount++;
          this.metrics.failureCount++;
          this.#logger.error?.('fitness.zone_led.grace_period.failed', { error: error.message });
        }
      }, ZONE_LOSS_GRACE_PERIOD_MS);

      this.#logger.info?.('fitness.zone_led.grace_period.started', {
        currentScene: this.lastScene,
        gracePeriodMs: ZONE_LOSS_GRACE_PERIOD_MS
      });

      return {
        ok: true,
        gracePeriodStarted: true,
        scene: this.lastScene,
        gracePeriodMs: ZONE_LOSS_GRACE_PERIOD_MS
      };
    }
    // Zones returned: clear any grace period
    else if (!isZoneEmpty && this.graceTimer) {
      this.#logger.info?.('fitness.zone_led.grace_period.cancelled', {
        elapsedMs: Date.now() - this.graceStartedAt,
        newZones: zones.map(z => z.zoneId)
      });
      this.#clearGraceTimer();
    }

    // Deduplication: skip if same scene (unless session ended - always send off)
    if (targetScene === this.lastScene && !sessionEnded) {
      // ... existing deduplication logic
    }
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs -t "grace period"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/fitness/AmbientLedAdapter.mjs tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): implement grace period for ambient LED zone loss

When heart rate zones drop to empty during an active session, the adapter
now starts a 30-second grace period instead of immediately turning off
the LED. This prevents flickering from transient sensor disconnections.

- Grace period timer delays off-scene activation
- Timer clears when zones return or session explicitly ends
- sessionEnded=true always bypasses grace period for immediate off
- Metrics and logging track grace period events

Fixes: ambient LED premature shutoff during active workouts

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Grace Period to Reset and Status Methods

**Files:**
- Modify: `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs:327-416`
- Test: `tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs`

**Step 1: Write failing tests**

Add to `describe('reset')` block:

```javascript
  test('clears grace period timer on reset', () => {
    jest.useFakeTimers();

    // Set up a grace timer
    adapter.graceTimer = setTimeout(() => {}, 30000);
    adapter.graceStartedAt = Date.now();

    const result = adapter.reset();

    expect(result.ok).toBe(true);
    expect(adapter.graceTimer).toBeNull();
    expect(adapter.graceStartedAt).toBeNull();

    jest.useRealTimers();
  });
```

Add to `describe('getStatus')` block:

```javascript
  test('includes grace period info in status', async () => {
    jest.useFakeTimers();

    // Trigger grace period
    await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
    adapter.lastActivatedAt = 0;
    await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });

    const status = adapter.getStatus('hid');

    expect(status.state.gracePeriodActive).toBe(true);
    expect(status.state.gracePeriodStartedAt).toBeDefined();

    jest.useRealTimers();
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs -t "clears grace period|includes grace period"`
Expected: FAIL

**Step 3: Update reset and getStatus methods**

In `reset()` method, add grace timer cleanup:

```javascript
  reset() {
    const previousState = {
      failureCount: this.failureCount,
      backoffUntil: this.backoffUntil,
      lastScene: this.lastScene,
      gracePeriodActive: !!this.graceTimer
    };

    // Clear grace timer if active
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
      this.graceStartedAt = null;
    }

    this.failureCount = 0;
    this.backoffUntil = 0;
    this.lastScene = null;
    this.lastActivatedAt = 0;

    this.#logger.info?.('fitness.zone_led.reset', { previousState });

    return { ok: true, previousState };
  }
```

In `getStatus()` method, add grace period state:

```javascript
  getStatus(householdId) {
    const fitnessConfig = this.#loadFitnessConfig(householdId);
    const enabled = this.#isEnabled(fitnessConfig);

    return {
      enabled,
      scenes: enabled ? fitnessConfig.ambient_led.scenes : null,
      throttleMs: enabled ? (fitnessConfig.ambient_led.throttle_ms || 2000) : null,
      gracePeriodMs: ZONE_LOSS_GRACE_PERIOD_MS,
      state: {
        lastScene: this.lastScene,
        lastActivatedAt: this.lastActivatedAt,
        failureCount: this.failureCount,
        backoffUntil: this.backoffUntil,
        isInBackoff: this.backoffUntil > Date.now(),
        gracePeriodActive: !!this.graceTimer,
        gracePeriodStartedAt: this.graceStartedAt
      }
    };
  }
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs -t "clears grace period|includes grace period"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/fitness/AmbientLedAdapter.mjs tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): add grace period to reset/status for ambient LED

- reset() now clears any active grace timer
- getStatus() exposes grace period state for observability
- gracePeriodMs constant included in status response

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add Grace Period Metrics

**Files:**
- Modify: `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs:68-82`
- Modify: `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs:348-395`
- Test: `tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs`

**Step 1: Write failing test**

Add to `describe('getMetrics')` block:

```javascript
  test('tracks grace period metrics', async () => {
    jest.useFakeTimers();

    // Trigger grace period start
    await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
    adapter.lastActivatedAt = 0;
    await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });

    // Cancel it by returning zones
    adapter.lastActivatedAt = 0;
    await adapter.syncZone({ zones: [{ zoneId: 'hot', isActive: true }], sessionEnded: false, householdId: 'hid' });

    const metrics = adapter.getMetrics();

    expect(metrics.gracePeriod.started).toBe(1);
    expect(metrics.gracePeriod.cancelled).toBe(1);

    jest.useRealTimers();
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs -t "tracks grace period metrics"`
Expected: FAIL - gracePeriod metrics undefined

**Step 3: Add grace period metrics**

In constructor metrics initialization (after line 79):

```javascript
      gracePeriodStarted: 0,
      gracePeriodCancelled: 0,
      gracePeriodExpired: 0
```

In `getMetrics()` method, add:

```javascript
      gracePeriod: {
        started: this.metrics.gracePeriodStarted,
        cancelled: this.metrics.gracePeriodCancelled,
        expired: this.metrics.gracePeriodExpired
      },
```

Update the grace period logic to increment metrics:
- When starting grace period: `this.metrics.gracePeriodStarted++;`
- When cancelling grace period: `this.metrics.gracePeriodCancelled++;`
- When grace period expires: `this.metrics.gracePeriodExpired++;`

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs -t "tracks grace period metrics"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/fitness/AmbientLedAdapter.mjs tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): add grace period metrics to ambient LED adapter

Tracks:
- gracePeriodStarted: number of times grace period was initiated
- gracePeriodCancelled: zones returned before expiry
- gracePeriodExpired: grace period ran to completion

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Run Full Test Suite and Verify

**Files:**
- Test: `tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs`

**Step 1: Run all AmbientLedAdapter tests**

Run: `npm test -- tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs`
Expected: All tests PASS

**Step 2: Run all fitness tests**

Run: `npm test -- tests/unit/suite/fitness/`
Expected: All tests PASS

**Step 3: Run integration tests**

Run: `npm test -- tests/integration/suite/api/fitness-parity.test.mjs`
Expected: All tests PASS

**Step 4: Commit any test fixes if needed**

Only if there are failing tests that need adjustment.

---

## Task 6: Update Bug Report Status

**Files:**
- Modify: `docs/_wip/2026-01-25-bug-ambient-led-premature-off.md`

**Step 1: Update bug report**

Change status from "Confirmed" to "Fixed" and add resolution notes:

```markdown
**Status:** Fixed

## Resolution

**Fix implemented:** 2026-01-25

Grace period added to `AmbientLedAdapter` that delays LED-off for 30 seconds when zones become empty during an active session (`sessionEnded: false`). The grace period:

1. Prevents immediate LED-off when zone data is lost
2. Clears when zones return (zone recovery)
3. Expires after 30 seconds if zones don't return
4. Is bypassed when `sessionEnded: true` (explicit session end always turns off immediately)

**Files changed:**
- `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs`
- `tests/unit/suite/adapters/fitness/AmbientLedAdapter.test.mjs`
```

**Step 2: Commit**

```bash
git add docs/_wip/2026-01-25-bug-ambient-led-premature-off.md
git commit -m "$(cat <<'EOF'
docs: mark ambient LED bug as fixed

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Testing Checklist

After all tasks complete, manually verify:

- [ ] LED stays on during brief sensor disconnections (< 30s)
- [ ] LED turns off after grace period expires (30s) if session still active
- [ ] LED turns off immediately when session explicitly ends
- [ ] LED responds to genuine zone changes normally
- [ ] No flickering during stable workout sessions
- [ ] Status endpoint shows grace period state
- [ ] Metrics endpoint shows grace period counts
- [ ] Reset clears any active grace period
