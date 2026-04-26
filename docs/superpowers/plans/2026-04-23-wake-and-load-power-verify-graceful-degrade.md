# Wake-and-Load Power-Verify Graceful Degrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix office-program load aborts caused by `wake-and-load.power.failed` when the IR-controlled office TV takes longer than the adapter's 16-second verify budget to confirm power-on.

**Architecture:** Two-layer fix with strict adherence to DDD layer boundaries. **Layer 1 (adapter plumbing):** `DeviceFactory` currently strips `powerOnWaitOptions` (device-level) and `powerOnRetries` (per-display) when it builds the `HomeAssistantDeviceAdapter` — restore the plumbing so config reaches the adapter that already supports it. **Layer 2 (service policy):** `WakeAndLoadService` hard-aborts whenever `powerOn()` returns `ok: false`. Distinguish **script-dispatch failure** (fatal — power command never reached HA) from **verify timeout** (sensor didn't flip in time — power command dispatched fine). On verify timeout, log `power.unverified`, fall through to the existing verify step, which gets a second chance via `DisplayReadinessPolicy.isReady()`. **Layer 3 (config):** Add device-specific wait budgets to office-tv in `devices.yml`. No device IDs appear in service code; no timeout constants move from config into code; the `IDeviceControl` port is unchanged (`verifyFailed` is already part of the contract — the service just starts respecting the distinction).

**Tech Stack:** Node.js ESM, DDD layered backend (`#adapters`, `#apps`, `#domains`), `node:test` + `node:assert` for unit tests (jest is configured but the live harness and newer tests use node's built-in runner), YAML device config in the Docker data volume.

---

## Scope Check

Single subsystem (device wake-and-load). One plan is appropriate.

## File Structure

**Modified:**
- `backend/src/3_applications/devices/services/DeviceFactory.mjs` — plumb `powerOnWaitOptions` + `powerOnRetries` from config into adapter constructor.
- `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` — branch `verifyFailed` (non-fatal, fall through) away from script-dispatch failure (fatal, abort).
- `data/household/config/devices.yml` *(data volume — not git-tracked)* — add `powerOnWaitOptions` + `powerOnRetries` to office-tv.

**Created (tests):**
- `backend/tests/unit/applications/devices/DeviceFactory.deviceControlConfig.test.mjs`
- `backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs`

**Not modified (intentionally):**
- `backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs` — already honors `config.powerOnWaitOptions` and `config.powerOnRetries`; no changes needed.
- `backend/src/3_applications/devices/ports/IDeviceControl.mjs` — `verifyFailed` already present in adapter output; no port change.
- `backend/src/2_domains/home-automation/DisplayReadinessPolicy.mjs` — already does a one-shot HA sensor check; with the adapter-side budget raised, this is a sufficient safety net.
- `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs` — dead vitest-style test (vitest not installed); leave untouched, put new jest/node-test-style tests in a new file.

---

## Pre-flight check

- [ ] **Step 0a: Confirm we're in the correct repo on the `main` branch**

Run: `git rev-parse --abbrev-ref HEAD && pwd`
Expected: `main` on `/opt/Code/DaylightStation` (or a worktree created from `main`).

- [ ] **Step 0b: Confirm `node --test` works**

Run: `node --test backend/tests/unit/agents/framework/Assignment.test.mjs 2>&1 | tail -3`
Expected: `ℹ pass 4` (or similar — exact count doesn't matter, the `pass` line confirms the runner works).

---

## Task 1: Plumb `powerOnWaitOptions` + `powerOnRetries` through `DeviceFactory`

**Problem:** `DeviceFactory.#buildDeviceControl` constructs `HomeAssistantDeviceAdapter` with `{ displays }` only. The adapter's constructor (`HomeAssistantDeviceAdapter.mjs:50-52`) already reads `config.powerOnWaitOptions`, and `#powerOnDisplay` (`:209`) already reads per-display `config.powerOnRetries`. Neither field is ever forwarded by the factory.

**Files:**
- Create: `backend/tests/unit/applications/devices/DeviceFactory.deviceControlConfig.test.mjs`
- Modify: `backend/src/3_applications/devices/services/DeviceFactory.mjs` (only the `#buildDeviceControl` method, lines 88-109)

- [ ] **Step 1.1: Write the failing test**

Create `backend/tests/unit/applications/devices/DeviceFactory.deviceControlConfig.test.mjs`:

```javascript
// backend/tests/unit/applications/devices/DeviceFactory.deviceControlConfig.test.mjs
//
// Verifies DeviceFactory forwards powerOnWaitOptions (device-level) and
// powerOnRetries (per-display) from device config into HomeAssistantDeviceAdapter.
// Regression guard for wake-and-load power-verify timeout bug (2026-04-23).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DeviceFactory } from '../../../../src/3_applications/devices/services/DeviceFactory.mjs';

describe('DeviceFactory.#buildDeviceControl config plumbing', () => {
  let fakeGateway;
  let factory;

  beforeEach(() => {
    fakeGateway = {
      runScript: async () => ({ ok: true }),
      getState: async () => ({ state: 'on' }),
      waitForState: async () => ({ reached: true, finalState: 'on' }),
    };
    factory = new DeviceFactory({
      haGateway: fakeGateway,
      httpClient: null,
      wsBus: null,
      remoteExec: null,
      daylightHost: 'https://example.test',
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
  });

  it('forwards device-level powerOnWaitOptions to the adapter so it can raise the verify budget', async () => {
    const device = await factory.build('office-tv', {
      type: 'linux-pc',
      device_control: {
        powerOnWaitOptions: { timeoutMs: 20000, pollIntervalMs: 1500 },
        displays: {
          tv: {
            provider: 'homeassistant',
            on_script: 'script.office_tv_on',
            off_script: 'script.office_tv_off',
            state_sensor: 'binary_sensor.office_tv_power',
          },
        },
      },
    });

    // Intercept the adapter's waitForState call to confirm the plumbed timeout is used.
    let observedTimeout = null;
    fakeGateway.waitForState = async (_sensor, _state, opts) => {
      observedTimeout = opts.timeoutMs;
      return { reached: true, finalState: 'on' };
    };

    await device.powerOn();

    assert.strictEqual(
      observedTimeout, 20000,
      'Expected adapter to use timeoutMs=20000 from config.device_control.powerOnWaitOptions'
    );
  });

  it('forwards per-display powerOnRetries so IR-lagged displays can retry more', async () => {
    let scriptCallCount = 0;
    fakeGateway.runScript = async () => { scriptCallCount++; return { ok: true }; };
    fakeGateway.waitForState = async () => ({ reached: false, finalState: 'off' }); // never reaches

    const device = await factory.build('office-tv', {
      type: 'linux-pc',
      device_control: {
        displays: {
          tv: {
            provider: 'homeassistant',
            on_script: 'script.office_tv_on',
            off_script: 'script.office_tv_off',
            state_sensor: 'binary_sensor.office_tv_power',
            powerOnRetries: 3,
          },
        },
      },
    });

    await device.powerOn();

    assert.strictEqual(
      scriptCallCount, 3,
      'Expected runScript to be called 3 times (powerOnRetries=3)'
    );
  });

  it('defaults are preserved when config omits the new fields (livingroom-tv unaffected)', async () => {
    let observedTimeout = null;
    fakeGateway.waitForState = async (_sensor, _state, opts) => {
      observedTimeout = opts.timeoutMs;
      return { reached: true, finalState: 'on' };
    };

    const device = await factory.build('livingroom-tv', {
      type: 'shield-tv',
      device_control: {
        displays: {
          tv: {
            provider: 'homeassistant',
            on_script: 'script.living_room_tv_on',
            off_script: 'script.living_room_tv_off',
            state_sensor: 'binary_sensor.living_room_tv_power',
          },
        },
      },
    });

    await device.powerOn();

    assert.strictEqual(
      observedTimeout, 8000,
      'Expected default timeoutMs=8000 to apply when config omits powerOnWaitOptions'
    );
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `node --test backend/tests/unit/applications/devices/DeviceFactory.deviceControlConfig.test.mjs 2>&1 | tail -15`
Expected: Two failures: `forwards device-level powerOnWaitOptions…` (observed `8000`, expected `20000`) and `forwards per-display powerOnRetries…` (observed `2`, expected `3`). The defaults test should pass.

- [ ] **Step 1.3: Implement — preserve `powerOnWaitOptions` + `powerOnRetries` in `DeviceFactory`**

Edit `backend/src/3_applications/devices/services/DeviceFactory.mjs`. Replace the entire `#buildDeviceControl` method (currently lines 88-109) with:

```javascript
  /**
   * Build device control adapter
   * @private
   */
  #buildDeviceControl(config) {
    if (!this.#haGateway) {
      this.#logger.warn?.('deviceFactory.noHaGateway');
      return null;
    }

    // Transform display config for adapter.
    // Preserve powerOnRetries so IR-controlled displays (slow power-on) can override
    // the default retry count. state_sensor drives verify polling.
    const displays = {};
    for (const [displayId, displayConfig] of Object.entries(config.displays)) {
      displays[displayId] = {
        on_script: displayConfig.on_script,
        off_script: displayConfig.off_script,
        volume_script: displayConfig.volume_script,
        state_sensor: displayConfig.state_sensor,
        ...(displayConfig.powerOnRetries != null && { powerOnRetries: displayConfig.powerOnRetries }),
      };
    }

    // Device-level wait options apply to every display's verify-poll loop.
    // Omit if absent so the adapter's defaults (8s timeout / 1.5s poll) apply.
    const adapterConfig = { displays };
    if (config.powerOnWaitOptions) {
      adapterConfig.powerOnWaitOptions = config.powerOnWaitOptions;
    }
    if (config.waitOptions) {
      adapterConfig.waitOptions = config.waitOptions;
    }

    return new HomeAssistantDeviceAdapter(
      adapterConfig,
      { gateway: this.#haGateway, logger: this.#logger }
    );
  }
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `node --test backend/tests/unit/applications/devices/DeviceFactory.deviceControlConfig.test.mjs 2>&1 | tail -5`
Expected: `ℹ pass 3` / `ℹ fail 0`.

- [ ] **Step 1.5: Commit**

```bash
git add backend/src/3_applications/devices/services/DeviceFactory.mjs \
        backend/tests/unit/applications/devices/DeviceFactory.deviceControlConfig.test.mjs
git commit -m "$(cat <<'EOF'
fix(devices): plumb powerOnWaitOptions and powerOnRetries through DeviceFactory

The HomeAssistantDeviceAdapter already supports device-level
powerOnWaitOptions and per-display powerOnRetries, but DeviceFactory
silently stripped both fields when building the adapter from config.
This made the adapter's 8s × 2-retry default non-configurable — a
problem for IR-controlled displays where the smart-plug state sensor
can take 11+ seconds to flip after power-on.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Graceful degrade `WakeAndLoadService` on verify-timeout (keep hard-abort for script-dispatch failure)

**Problem:** `WakeAndLoadService.#executeInner` aborts at `failedStep: 'power'` whenever `powerResult.ok === false`. This conflates two different failure modes:

1. **Script-dispatch failure** (`ok: false`, no `verifyFailed`) — HA didn't accept the script call. We have no signal that power was requested. Fatal.
2. **Verify timeout** (`ok: false`, `verifyFailed: true`) — HA accepted the script, but the state sensor didn't flip within the adapter's budget. The display may still be coming on (IR lag, slow smart plug). Not fatal — let the downstream verify step re-check.

The adapter already distinguishes these cases via the `verifyFailed` field. The service just doesn't act on the distinction.

**Files:**
- Create: `backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs`
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` (lines 139-154 only)

- [ ] **Step 2.1: Write the failing test**

Create `backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs`:

```javascript
// backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs
//
// Regression guard: WakeAndLoadService must distinguish script-dispatch
// failure (fatal) from verify timeout (non-fatal, fall through to verify step).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { WakeAndLoadService } from '../../../../src/3_applications/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  const records = { info: [], warn: [], error: [], debug: [] };
  return {
    records,
    info: (event, data) => records.info.push({ event, data }),
    warn: (event, data) => records.warn.push({ event, data }),
    error: (event, data) => records.error.push({ event, data }),
    debug: (event, data) => records.debug.push({ event, data }),
  };
}

function makeDevice(overrides) {
  return {
    id: 'office-tv',
    screenPath: '/screen/office',
    defaultVolume: null,
    hasCapability: () => false,
    prepareForContent: async () => ({ ok: true }),
    loadContent: async () => ({ ok: true, url: 'http://test/screen/office' }),
    powerOn: async () => ({ ok: true, verified: true }),
    ...overrides,
  };
}

function makeService({ device, readyResult = { ready: true }, logger }) {
  return new WakeAndLoadService({
    deviceService: { get: () => device },
    readinessPolicy: { isReady: async () => readyResult },
    broadcast: () => {},
    logger,
  });
}

describe('WakeAndLoadService power-step degradation', () => {
  let logger;
  beforeEach(() => { logger = makeLogger(); });

  it('falls through to verify step when adapter returns verifyFailed', async () => {
    // Verify step has to succeed on its second-chance check so the full pipeline runs.
    const device = makeDevice({
      powerOn: async () => ({
        ok: false, verifyFailed: true, verified: false,
        error: 'Display did not respond after power-on verification',
      }),
    });
    const service = makeService({ device, readyResult: { ready: true }, logger });

    const result = await service.execute('office-tv', { queue: 'office-program' });

    assert.strictEqual(result.ok, true, 'Expected overall ok=true when verify step recovered');
    assert.strictEqual(result.failedStep, undefined, 'Expected no failedStep');
    const unverified = logger.records.warn.find(r => r.event === 'wake-and-load.power.unverified');
    assert.ok(unverified, 'Expected power.unverified warn log');
    const hardFail = logger.records.error.find(r => r.event === 'wake-and-load.power.failed');
    assert.strictEqual(hardFail, undefined, 'Expected no power.failed error on verify timeout');
  });

  it('still aborts with failedStep=power when script dispatch fails (no verifyFailed flag)', async () => {
    const device = makeDevice({
      powerOn: async () => ({
        ok: false, error: 'HA script not found',
        // no verifyFailed — this was a true dispatch failure
      }),
    });
    const service = makeService({ device, logger });

    const result = await service.execute('office-tv', { queue: 'office-program' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failedStep, 'power', 'Dispatch failures must stay fatal');
    assert.strictEqual(result.error, 'HA script not found');
  });

  it('when verifyFailed falls through but verify step also fails, aborts at verify with override', async () => {
    const device = makeDevice({
      powerOn: async () => ({
        ok: false, verifyFailed: true, verified: false,
        error: 'Display did not respond after power-on verification',
      }),
    });
    const service = makeService({
      device,
      readyResult: { ready: false, reason: 'display_off' },
      logger,
    });

    const result = await service.execute('office-tv', { queue: 'office-program' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failedStep, 'verify', 'Must fail at verify, not power');
    assert.strictEqual(result.allowOverride, true, 'Phone UI must get the override path');
  });

  it('happy path (ok:true, verified:true) is unchanged', async () => {
    const device = makeDevice({
      powerOn: async () => ({ ok: true, verified: true }),
    });
    const service = makeService({ device, logger });

    const result = await service.execute('office-tv', { queue: 'office-program' });

    assert.strictEqual(result.ok, true);
    const doneLog = logger.records.info.find(r => r.event === 'wake-and-load.power.done');
    assert.ok(doneLog, 'Expected power.done info log on happy path');
  });

  it('no_state_sensor path (ok:true, verifySkipped) is unchanged', async () => {
    const device = makeDevice({
      powerOn: async () => ({
        ok: true, verified: false, verifySkipped: 'no_state_sensor',
      }),
    });
    const service = makeService({ device, logger });

    const result = await service.execute('office-tv', { queue: 'office-program' });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.steps.verify.skipped, 'no_sensor');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `node --test backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs 2>&1 | tail -20`
Expected: The first test (`falls through to verify step…`) and third test (`verifyFailed falls through but verify step also fails…`) fail because the service currently aborts at power with `failedStep: 'power'`. The `power.unverified` log doesn't exist yet. The other three tests pass.

- [ ] **Step 2.3: Implement — branch verifyFailed from dispatch-failure**

Edit `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`. Find the block starting at line 139 (`const powerResult = await device.powerOn();`) and replace lines 139-154 (the `powerOn` call, the `if (!powerResult.ok)` abort, and the `emitProgress('power', 'done', …)` + `wake-and-load.power.done` log) with:

```javascript
    const powerResult = await device.powerOn();
    result.steps.power = powerResult;

    // Three outcomes to distinguish:
    //   1. ok:false, no verifyFailed -> script dispatch failed. Fatal.
    //   2. ok:false, verifyFailed:true -> script dispatched, sensor didn't confirm
    //      within adapter budget. Non-fatal: fall through to verify step, which
    //      gets a second chance via DisplayReadinessPolicy.isReady().
    //   3. ok:true -> proceed normally.
    if (!powerResult.ok && !powerResult.verifyFailed) {
      this.#emitProgress(topic, dispatchId, 'power', 'failed', { error: powerResult.error });
      this.#logger.error?.('wake-and-load.power.failed', { deviceId, dispatchId, error: powerResult.error });
      result.error = powerResult.error;
      result.failedStep = 'power';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    if (!powerResult.ok && powerResult.verifyFailed) {
      this.#emitProgress(topic, dispatchId, 'power', 'unverified', { error: powerResult.error });
      this.#logger.warn?.('wake-and-load.power.unverified', {
        deviceId, dispatchId, error: powerResult.error, elapsedMs: powerResult.elapsedMs
      });
    } else {
      this.#emitProgress(topic, dispatchId, 'power', 'done', { verified: powerResult.verified });
      this.#logger.info?.('wake-and-load.power.done', {
        deviceId, dispatchId, verified: powerResult.verified, elapsedMs: powerResult.elapsedMs
      });
    }
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `node --test backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs 2>&1 | tail -5`
Expected: `ℹ pass 5` / `ℹ fail 0`.

- [ ] **Step 2.5: Sanity-check sibling live tests still pass**

Run: `node --test backend/tests/unit/applications/devices/ 2>&1 | tail -5`
Expected: all tests under that folder pass. (Only our two new files live there.)

- [ ] **Step 2.6: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs \
        backend/tests/unit/applications/devices/WakeAndLoadService.powerDegradation.test.mjs
git commit -m "$(cat <<'EOF'
fix(wake-and-load): degrade on power verify-timeout, abort only on dispatch failure

The service treated every !powerResult.ok as a fatal power-step failure,
including adapter-side verify timeouts where the script dispatched fine
but the state sensor didn't flip in time. That hard-aborted the load
pipeline before the verify step (which can re-check readiness) ever ran.

Now: script-dispatch failures still abort at failedStep=power. Verify
timeouts log power.unverified and fall through to the verify step, where
DisplayReadinessPolicy.isReady() gets a second chance. If verify also
fails, the existing failedStep=verify + allowOverride path runs — phone
UI still gets its "Connect anyway" option.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Configure office-tv wait budget in `devices.yml`

**Problem:** office-tv's displays use HA IR blaster scripts. Historical logs (2026-03-22) show `binary_sensor.office_tv_power` flipping `on` ~11s after `script.office_tv_on` fires. The adapter's default `timeoutMs: 8000` × 2 retries (16s total) leaves no margin.

**Files:**
- Modify: `data/household/config/devices.yml` (lives in the Docker data volume — **not git-tracked**; edit via `sudo docker exec`).

- [ ] **Step 3.1: Read current office-tv block for reference**

Run: `sudo docker exec daylight-station sh -c 'cat data/household/config/devices.yml' > /tmp/devices-before.yml && sed -n '/office-tv:/,/piano:/p' /tmp/devices-before.yml | head -50`
Expected: Confirms the current office-tv block has no `powerOnWaitOptions` and no `powerOnRetries`.

- [ ] **Step 3.2: Write the updated office-tv block**

Write the full replacement file to a temp location, then copy into the container. (Do NOT use `sed -i` — it mangles YAML; see CLAUDE.local.md warning.)

First, save the full current file to the host:
```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/devices.yml' > /tmp/devices-current.yml
wc -l /tmp/devices-current.yml
```

Then, open `/tmp/devices-current.yml` and replace the existing `office-tv:` block (stopping at `piano:` or the next top-level device key) with the block below. Preserve exact YAML indentation (2 spaces at each level, matching the surrounding file). The only additions are `powerOnWaitOptions:` at the `device_control` level and `powerOnRetries: 3` on the `tv` display:

```yaml
  office-tv:
    type: linux-pc
    default_volume: 15
    device_control:
      powerOnWaitOptions:
        timeoutMs: 20000
        pollIntervalMs: 1500
      displays:
        tv:
          provider: homeassistant
          on_script: script.office_tv_on
          off_script: script.office_tv_off
          state_sensor: binary_sensor.office_tv_power
          powerOnRetries: 3
        monitor:
          provider: homeassistant
          on_script: script.office_monitor_on
          off_script: script.office_monitor_off
    os_control:
      provider: ssh
      host: 172.17.0.1
      user: kckern
      port: 22
      commands:
        volume: "amixer set Master {level}%"
        mute: "amixer set Master mute"
        unmute: "amixer set Master unmute"
        audio_device: "pactl set-default-sink {device}"
    content_control:
      provider: websocket
      topic: office
    # Module hooks - actions when modules activate on this device
    modules:
      piano-visualizer:
        on_open: script.office_tv_hdmi_3
        # on_close: script.office_tv_hdmi_1
```

Save to `/tmp/devices-new.yml`. Confirm the new budget: 3 attempts × 20s = 60s worst case (vs historical 11s reality).

- [ ] **Step 3.3: Install the new config into the container**

```bash
sudo docker cp /tmp/devices-new.yml daylight-station:/tmp/devices-new.yml
sudo docker exec daylight-station sh -c 'cp /tmp/devices-new.yml data/household/config/devices.yml'
sudo docker exec daylight-station sh -c 'grep -A5 "office-tv:" data/household/config/devices.yml | head -20'
```

Expected: the first 20 lines of the office-tv block, showing `powerOnWaitOptions:` and `timeoutMs: 20000`.

- [ ] **Step 3.4: YAML-parse validation**

Run: `sudo docker exec daylight-station node -e "const y=require('js-yaml');const f=require('fs');const c=y.load(f.readFileSync('data/household/config/devices.yml','utf8'));console.log(JSON.stringify(c.devices['office-tv'].device_control, null, 2))"`
Expected: JSON output showing `powerOnWaitOptions: { timeoutMs: 20000, pollIntervalMs: 1500 }` and `displays.tv.powerOnRetries: 3`.

- [ ] **Step 3.5: Restart the container to pick up config**

The sudoers policy for `claude` allows `sudo docker stop/rm/exec daylight-station` and `sudo deploy-daylight`, not `sudo docker restart`. Use the deploy wrapper (which recreates the container on the correct network/volumes without rebuilding the image):

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
sleep 15
sudo docker logs --tail 20 daylight-station 2>&1 | grep -E 'devices|ready|listening' | tail -5
```

Expected: the backend boots and logs steady-state ready signals. (Config is read at adapter instantiation, so a container recycle is required — hot reload is out of scope.)

- [ ] **Step 3.6: No git commit (data volume is gitignored)**

Add a one-line note to the bug report documenting the config change:

Edit `docs/_wip/bugs/2026-04-23-office-program-power-verify-timeout.md`. At the bottom under the `Verification plan` section, append:

```markdown
---

## Applied 2026-04-23

- **Code:** commits landing tasks 1–2 of `docs/superpowers/plans/2026-04-23-wake-and-load-power-verify-graceful-degrade.md`
- **Config:** `data/household/config/devices.yml` (data volume) — added `device_control.powerOnWaitOptions: { timeoutMs: 20000, pollIntervalMs: 1500 }` and `display.tv.powerOnRetries: 3` on office-tv. Container restarted to reload.
```

```bash
git add docs/_wip/bugs/2026-04-23-office-program-power-verify-timeout.md
git commit -m "$(cat <<'EOF'
docs(bugs): note office-tv config change applied for power-verify timeout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: End-to-end verification

**Goal:** Prove the full pipeline works with TV physically powered off at start, and captures a `power.verified` or `power.unverified → verify.done` sequence (not the pre-fix `power.failed` abort).

- [ ] **Step 4.1: Ensure office TV is fully off**

Via HA (run from the container which has network access to `homeassistant:8123`):

```bash
sudo docker exec daylight-station sh -c 'TOKEN=$(grep token data/household/auth/homeassistant.yml | cut -d" " -f2); curl -s http://homeassistant:8123/api/services/script/office_tv_off -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{}"'
sleep 15
sudo docker exec daylight-station sh -c 'TOKEN=$(grep token data/household/auth/homeassistant.yml | cut -d" " -f2); curl -s http://homeassistant:8123/api/states/binary_sensor.office_tv_power -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys;print(json.load(sys.stdin)[\"state\"])"'
```

Expected: `off`

- [ ] **Step 4.2: In one terminal, tail relevant logs**

```bash
sudo docker logs -f daylight-station 2>&1 | grep -E 'wake-and-load|device.ha.powerOn|device.router.load'
```

Leave this running.

- [ ] **Step 4.3: In another terminal, trigger the load**

```bash
curl -s "http://localhost:3111/api/v1/device/office-tv/load?queue=office-program" | python3 -m json.tool | head -40
```

Expected HTTP response:
- `ok: true`
- `failedStep` absent
- `steps.power.verified: true` (adapter verified within new 20s budget) **OR**
- `steps.power.verifyFailed: true` with `steps.verify.ready: true` (degradation path fired and readiness policy caught up)
- `steps.load.ok: true`

- [ ] **Step 4.4: Check the log stream for the expected event sequence**

In the tailing terminal you should see (in order):
```
device.router.load.start          deviceId: "office-tv"
wake-and-load.power.start
device.ha.powerOn                 displayId: "tv", maxAttempts: 3
device.ha.powerOn.verified        displayId: "tv", attempt: 1 (or 2)
wake-and-load.power.done          verified: true
wake-and-load.verify.skipped      reason: "power_on_verified"
wake-and-load.prepare.start
...
wake-and-load.load.done
device.router.load.complete       ok: true
```

The key negative signal: **no** `wake-and-load.power.failed` error. If the degradation path fires instead, you'll see `wake-and-load.power.unverified` warn followed by `wake-and-load.verify.start` → `wake-and-load.verify.done`.

- [ ] **Step 4.5: Confirm content actually loaded**

```bash
sudo docker exec daylight-station sh -c 'TOKEN=$(grep token data/household/auth/homeassistant.yml | cut -d" " -f2); curl -s http://homeassistant:8123/api/states/binary_sensor.office_tv_power -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys;print(json.load(sys.stdin)[\"state\"])"'
```
Expected: `on` (TV came up within the new budget).

Then visually confirm the office screen shows the `office-program` content (first track playing, queue populated).

- [ ] **Step 4.6: Document verification result**

Append to `docs/_wip/bugs/2026-04-23-office-program-power-verify-timeout.md` under the `Applied 2026-04-23` section:

```markdown
- **Verified end-to-end:** <UTC timestamp>. Triggered load with TV fully off. Logs show `device.ha.powerOn.verified attempt: 1, elapsedMs: <Nms>` followed by `wake-and-load.load.done`. TV powered on, office-program queue played.
```

Fill in the actual timestamp and attempt count from your log tail.

```bash
git add docs/_wip/bugs/2026-04-23-office-program-power-verify-timeout.md
git commit -m "$(cat <<'EOF'
docs(bugs): record end-to-end verification of office-tv power-verify fix

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Rollback

If anything goes wrong at Task 4:

- **Code:** `git revert` the two commits from Tasks 1 and 2.
- **Config:** `sudo docker cp /tmp/devices-before.yml daylight-station:/data/household/config/devices.yml && sudo docker restart daylight-station` (the pre-flight check in Task 3.1 saved the original).

---

## Out of scope (explicitly not in this plan)

These came up during bug-report drafting. They are legitimate but separate from this fix.

- **Monitor display sensor.** The `office-tv.monitor` display has no `state_sensor`. A `binary_sensor.office_monitor_power` could be inferred from `sensor.office_monitor_plug_power`, but that requires an HA template sensor — separate HA-config change, separate plan.
- **Retrying the office morning program on failure.** The HA automation `automation.office_morning_program_auto_start` sets `input_boolean.office_program_played_today = on` unconditionally. If the load fails, there's no retry. Fixing the retry logic is HA-automation work, not DaylightStation work.
- **Polling `DisplayReadinessPolicy`.** Currently `isReady()` is a single point-in-time HA state read. Turning it into a proper polling check (matching the adapter's `waitForState` pattern) is a deeper domain change. Not required for this bug — the adapter-side budget is sufficient.
- **Config hot-reload.** `devices.yml` is only read at adapter construction; a container restart is required. Hot-reloading device config is infrastructure work unrelated to this bug.
