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
    fakeGateway.waitForState = async () => ({ reached: false, finalState: 'off' });

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
