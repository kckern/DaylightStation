# Lazy Force-Stop for FKB Prepare Step — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure `prepareForContent()` to skip force-stop by default and only force-restart FKB when mic-blocking services are detected, reducing call setup time from 10-20s to ~2-3s in the happy path.

**Architecture:** Add a private `#isMicBlocked()` method that checks for problematic FKB services via ADB `dumpsys`. Restructure `prepareForContent()` into two phases: soft prepare (foreground + companions + mic check) and conditional force-restart (only if mic blocked). Increase foreground verification timeout from 2.5s to 15s.

**Tech Stack:** Node.js, ADB shell commands, Vitest

**Design doc:** `docs/plans/2026-03-04-lazy-force-stop-design.md`

---

### Task 1: Update existing tests for new behavior

The current tests expect force-stop to always happen. The new behavior is: force-stop only happens when `#isMicBlocked()` returns true. Update tests to match.

**Files:**
- Modify: `backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs`

**Step 1: Update the test "should force-stop and re-launch FKB via ADB after disabling settings"**

This test currently asserts that force-stop always happens. Rename and update it to test that force-stop does NOT happen when mic is not blocked (the new happy path).

Replace the test at lines 118-159 with:

```javascript
it('should skip force-stop when mic is not blocked (happy path)', async () => {
  const callOrder = [];
  const httpClient = {
    get: vi.fn(async (url) => {
      const cmd = url.match(/[?&]cmd=([^&]+)/)?.[1];
      const key = url.match(/[?&]key=([^&]+)/)?.[1];
      callOrder.push(key ? `${cmd}:${key}` : cmd);
      if (cmd === 'getDeviceInfo') {
        return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully' }) };
      }
      return { status: 200, data: '{}' };
    }),
  };

  const mockAdb = {
    connect: vi.fn(async () => ({ ok: true })),
    shell: vi.fn(async (cmd) => {
      // dumpsys returns no problematic services
      if (cmd.includes('dumpsys')) return { ok: true, output: 'no services running' };
      return { ok: true, output: '' };
    }),
    launchActivity: vi.fn(async () => ({ ok: true })),
  };

  const adapter = new FullyKioskContentAdapter(
    { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
    { httpClient, logger: mockLogger, adbAdapter: mockAdb }
  );
  const result = await adapter.prepareForContent();

  expect(result.ok).toBe(true);
  expect(result.coldRestart).toBe(false);

  // force-stop should NOT have been called for FKB
  const forceStopCalls = mockAdb.shell.mock.calls
    .filter(([cmd]) => cmd.includes('force-stop de.ozerov.fully'));
  expect(forceStopCalls).toHaveLength(0);
});
```

**Step 2: Add test for force-stop when mic IS blocked**

Add this new test after the one above:

```javascript
it('should force-stop and re-launch FKB when mic-blocking services are detected', async () => {
  const httpClient = createMockHttpClient();

  const mockAdb = {
    connect: vi.fn(async () => ({ ok: true })),
    shell: vi.fn(async (cmd) => {
      // dumpsys returns SoundMeterService — mic is blocked
      if (cmd.includes('dumpsys')) {
        return { ok: true, output: '* ServiceRecord{abc de.ozerov.fully/.SoundMeterService}\n  app=ProcessRecord{def de.ozerov.fully}' };
      }
      return { ok: true, output: '' };
    }),
    launchActivity: vi.fn(async () => ({ ok: true })),
  };

  const adapter = new FullyKioskContentAdapter(
    { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
    { httpClient, logger: mockLogger, adbAdapter: mockAdb }
  );
  const result = await adapter.prepareForContent();

  expect(result.ok).toBe(true);
  expect(result.coldRestart).toBe(true);

  // force-stop SHOULD have been called
  const forceStopCalls = mockAdb.shell.mock.calls
    .filter(([cmd]) => cmd.includes('force-stop de.ozerov.fully'));
  expect(forceStopCalls.length).toBeGreaterThanOrEqual(1);

  // re-launch called
  expect(mockAdb.launchActivity).toHaveBeenCalledWith('de.ozerov.fully/.TvActivity');
});
```

**Step 3: Add test for MotionDetectorService detection**

```javascript
it('should force-stop when MotionDetectorService is detected', async () => {
  const httpClient = createMockHttpClient();

  const mockAdb = {
    connect: vi.fn(async () => ({ ok: true })),
    shell: vi.fn(async (cmd) => {
      if (cmd.includes('dumpsys')) {
        return { ok: true, output: '* ServiceRecord{abc de.ozerov.fully/.MotionDetectorService}' };
      }
      return { ok: true, output: '' };
    }),
    launchActivity: vi.fn(async () => ({ ok: true })),
  };

  const adapter = new FullyKioskContentAdapter(
    { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
    { httpClient, logger: mockLogger, adbAdapter: mockAdb }
  );
  const result = await adapter.prepareForContent();

  expect(result.ok).toBe(true);
  expect(result.coldRestart).toBe(true);
});
```

**Step 4: Update the "should continue if ADB force-stop fails" test**

This test (lines 171-191) needs updating. The old test had ADB connect fail, which meant force-stop was skipped. In the new flow, ADB connect failure means mic check is also skipped (returns false), so no force-stop is attempted. The test logic stays the same but the assertion about the warn log changes.

Replace the test at lines 171-191 with:

```javascript
it('should skip mic check and force-stop when ADB connect fails', async () => {
  const httpClient = createMockHttpClient();
  const mockAdb = {
    connect: vi.fn(async () => ({ ok: false, error: 'ADB offline' })),
    shell: vi.fn(async () => ({ ok: false })),
    launchActivity: vi.fn(async () => ({ ok: false })),
  };

  const adapter = new FullyKioskContentAdapter(
    { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
    { httpClient, logger: mockLogger, adbAdapter: mockAdb }
  );
  const result = await adapter.prepareForContent();

  // Should still succeed — ADB failure is non-blocking
  expect(result.ok).toBe(true);
  expect(result.coldRestart).toBe(false);

  // force-stop should NOT have been called
  const forceStopCalls = mockAdb.shell.mock.calls
    .filter(([cmd]) => cmd.includes('force-stop'));
  expect(forceStopCalls).toHaveLength(0);
});
```

**Step 5: Run tests to verify they fail (implementation not yet changed)**

Run: `npm run test:unit -- --reporter=verbose 2>&1 | grep -A2 'FullyKioskContentAdapter'`
Expected: Several failures (tests expect new behavior, code still has old behavior)

**Step 6: Commit test changes**

```bash
git add backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
git commit -m "test: update FullyKioskContentAdapter tests for lazy force-stop behavior"
```

---

### Task 2: Add `#isMicBlocked()` private method

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs`

**Step 1: Add `#isMicBlocked()` method**

Add this method in the Private Methods section (after `#sendCommand`, before the closing brace of the class), around line 406:

```javascript
/**
 * Check if FKB background services are holding mic/camera resources.
 * Uses ADB dumpsys to inspect running services for known problematic ones.
 * @private
 * @returns {Promise<boolean>} true if mic-blocking services are detected
 */
async #isMicBlocked() {
  if (!this.#adbAdapter) return false;

  try {
    const connectResult = await this.#adbAdapter.connect();
    if (!connectResult.ok) {
      this.#logger.warn?.('fullykiosk.isMicBlocked.connectFailed', { error: connectResult.error });
      return false;
    }

    const result = await this.#adbAdapter.shell('dumpsys activity services de.ozerov.fully');
    if (!result.ok) {
      this.#logger.warn?.('fullykiosk.isMicBlocked.dumpsysFailed', { error: result.error });
      return false;
    }

    const output = result.output || '';
    const blocked = output.includes('SoundMeterService') || output.includes('MotionDetectorService');
    this.#logger.info?.('fullykiosk.isMicBlocked.result', { blocked, outputLength: output.length });
    return blocked;
  } catch (err) {
    this.#logger.warn?.('fullykiosk.isMicBlocked.error', { error: err.message });
    return false;
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs
git commit -m "feat: add #isMicBlocked() method to FullyKioskContentAdapter"
```

---

### Task 3: Restructure `prepareForContent()`

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` (lines 77-216)

**Step 1: Replace `prepareForContent()` method body**

Replace the entire method (lines 77-216) with the new two-phase implementation:

```javascript
async prepareForContent() {
  const startTime = Date.now();
  this.#metrics.prepares++;
  const FK_PACKAGE = 'de.ozerov.fully';
  const MAX_FOREGROUND_ATTEMPTS = 15;
  const FOREGROUND_RETRY_MS = 1000;

  this.#logger.debug?.('fullykiosk.prepareForContent.start', { host: this.#host, port: this.#port });

  try {
    let coldRestart = false;

    // Wake screen
    const screenResult = await this.#sendCommand('screenOn');
    if (!screenResult.ok) {
      this.#logger.error?.('fullykiosk.prepareForContent.screenOn.failed', { error: screenResult.error });
      return { ok: false, step: 'screenOn', error: screenResult.error };
    }

    // Disable FKB background services that hold AUDIO_SOURCE_MIC and Camera 0.
    // These cause AudioRecord init failures and PiP windows.
    // Non-blocking: log failures but don't abort prepare.
    for (const setting of ['motionDetection', 'motionDetectionAcoustic', 'acousticScreenOn']) {
      const setResult = await this.#sendCommand('setBooleanSetting', { key: setting, value: 'false' });
      if (setResult.ok) {
        this.#logger.debug?.('fullykiosk.prepareForContent.disableSetting.ok', { setting });
      } else {
        this.#logger.warn?.('fullykiosk.prepareForContent.disableSetting.failed', { setting, error: setResult.error });
      }
    }

    // --- Phase 1: Soft prepare (no force-stop) ---
    const fgResult = await this.#verifyForeground(FK_PACKAGE, MAX_FOREGROUND_ATTEMPTS, FOREGROUND_RETRY_MS, startTime);
    if (!fgResult.ok) {
      return fgResult;
    }

    // Launch companion apps
    await this.#launchCompanions();

    // Check if mic-blocking FKB services are still running
    const micBlocked = await this.#isMicBlocked();

    if (micBlocked) {
      // --- Phase 2: Force restart needed ---
      this.#logger.info?.('fullykiosk.prepareForContent.micBlocked', { elapsedMs: Date.now() - startTime });

      if (this.#adbAdapter && this.#launchActivity) {
        try {
          const connectResult = await this.#adbAdapter.connect();
          if (connectResult.ok) {
            const stopResult = await this.#adbAdapter.shell('am force-stop de.ozerov.fully');
            this.#logger.info?.('fullykiosk.prepareForContent.adbForceStop', { ok: stopResult.ok });
            coldRestart = true;

            // Brief pause for process to fully terminate
            await new Promise(r => setTimeout(r, 500));

            const launchResult = await this.#adbAdapter.launchActivity(this.#launchActivity);
            this.#logger.info?.('fullykiosk.prepareForContent.adbRelaunch', { ok: launchResult.ok });

            // Re-verify foreground after restart
            const fgResult2 = await this.#verifyForeground(FK_PACKAGE, MAX_FOREGROUND_ATTEMPTS, FOREGROUND_RETRY_MS, startTime);
            if (!fgResult2.ok) {
              return fgResult2;
            }

            // Re-launch companions with fresh foreground context
            await this.#launchCompanions();
          } else {
            this.#logger.warn?.('fullykiosk.prepareForContent.adbRestart.failed', {
              error: connectResult.error || 'ADB connect failed'
            });
          }
        } catch (err) {
          this.#logger.warn?.('fullykiosk.prepareForContent.adbRestart.failed', { error: err.message });
        }
      }
    } else {
      this.#logger.info?.('fullykiosk.prepareForContent.micClear', { elapsedMs: Date.now() - startTime });
    }

    // Camera check (runs after either phase)
    let cameraAvailable = false;
    if (this.#adbAdapter) {
      const MAX_CAMERA_ATTEMPTS = 3;
      const CAMERA_RETRY_MS = 2000;

      for (let camAttempt = 1; camAttempt <= MAX_CAMERA_ATTEMPTS; camAttempt++) {
        const camResult = await this.#adbAdapter.shell('ls /dev/video* 2>/dev/null | wc -l');
        const count = parseInt(camResult.output?.trim(), 10) || 0;

        if (count > 0) {
          this.#logger.info?.('fullykiosk.prepareForContent.cameraCheck.passed', {
            attempt: camAttempt, videoDevices: count
          });
          cameraAvailable = true;
          break;
        }

        this.#logger.warn?.('fullykiosk.prepareForContent.cameraCheck.failed', {
          attempt: camAttempt, maxAttempts: MAX_CAMERA_ATTEMPTS
        });

        if (camAttempt < MAX_CAMERA_ATTEMPTS) {
          await new Promise(r => setTimeout(r, CAMERA_RETRY_MS));
        }
      }
    } else {
      cameraAvailable = true;
    }

    return { ok: true, coldRestart, cameraAvailable, elapsedMs: Date.now() - startTime };
  } catch (error) {
    this.#metrics.errors++;
    this.#logger.error?.('fullykiosk.prepareForContent.exception', { error: error.message, stack: error.stack });
    return { ok: false, error: error.message };
  }
}
```

**Step 2: Add `#verifyForeground()` helper method**

Add in the Private Methods section:

```javascript
/**
 * Bring FKB to foreground and verify via polling loop.
 * @private
 * @param {string} fkPackage - Expected foreground package name
 * @param {number} maxAttempts - Maximum verification attempts
 * @param {number} retryMs - Delay between attempts in ms
 * @param {number} startTime - Start time for elapsed logging
 * @returns {Promise<{ok: boolean, step?: string, error?: string}>}
 */
async #verifyForeground(fkPackage, maxAttempts, retryMs, startTime) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await this.#sendCommand('toForeground');
    await new Promise(r => setTimeout(r, retryMs));

    const info = await this.#sendCommand('getDeviceInfo', { type: 'json' });
    const foreground = info.data?.foreground;

    if (foreground === fkPackage) {
      this.#logger.info?.('fullykiosk.prepareForContent.foregroundConfirmed', {
        attempt, elapsedMs: Date.now() - startTime
      });
      return { ok: true };
    }

    this.#logger.warn?.('fullykiosk.prepareForContent.notInForeground', {
      attempt, foreground, expected: fkPackage
    });
  }

  this.#logger.error?.('fullykiosk.prepareForContent.foregroundFailed', {
    attempts: maxAttempts, elapsedMs: Date.now() - startTime
  });
  return { ok: false, step: 'toForeground', error: 'Could not bring Fully Kiosk to foreground' };
}
```

**Step 3: Add `#launchCompanions()` helper method**

Add in the Private Methods section:

```javascript
/**
 * Launch companion apps from FKB's foreground context.
 * On Android 11+, apps started by the foreground app inherit
 * foreground privileges (createdFromFg=true), enabling microphone
 * access that background-started services are denied.
 * @private
 */
async #launchCompanions() {
  for (const pkg of this.#companionApps) {
    // Force-stop first so the app's Activity recreates the service
    // with fresh foreground context (restarting over a BootReceiver
    // instance that has createdFromFg=false).
    if (this.#adbAdapter) {
      try {
        await this.#adbAdapter.shell(`am force-stop ${pkg}`);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        this.#logger.debug?.('fullykiosk.prepareForContent.companionForceStop.failed', { pkg, error: err.message });
      }
    }
    const appResult = await this.#sendCommand('startApplication', { package: pkg });
    this.#logger.info?.('fullykiosk.prepareForContent.companionApp', { pkg, ok: appResult.ok });
  }
}
```

**Step 4: Run tests**

Run: `npm run test:unit -- --reporter=verbose 2>&1 | grep -A2 'FullyKioskContentAdapter'`
Expected: All tests pass

**Step 5: Commit**

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs
git commit -m "feat: lazy force-stop in prepareForContent — only restart FKB when mic is blocked"
```

---

### Task 4: Final verification

**Step 1: Run full unit test suite**

Run: `npm run test:unit`
Expected: All tests pass, no regressions

**Step 2: Commit design doc**

```bash
git add docs/plans/2026-03-04-lazy-force-stop-design.md docs/plans/2026-03-04-lazy-force-stop-plan.md
git commit -m "docs: add lazy force-stop design and implementation plan"
```
