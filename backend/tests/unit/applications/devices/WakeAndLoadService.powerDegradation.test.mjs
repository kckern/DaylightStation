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
