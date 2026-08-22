import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCameraLedgerJobHandler } from './cameraLedgerJobHandler.mjs';

/**
 * Covers the Finding 1-3 fallout from the devices.yml rewiring: this is the
 * only camera pipeline with no `enabled` gate (camera-ledger runs nightly,
 * unconditionally, per data/system/config/jobs.yml), so it is the one job
 * that cannot afford to hard-throw on a bad/missing camera-nvr entry.
 *
 * No network, no data volume: `makeSource().search()` is stubbed to return no
 * records, and ledgerPaths point at a throwaway tmp dir for the real
 * writeLedger() fs call.
 */

const noopLogger = { info() {}, warn() {}, error() {} };

function makeCameraAdapters() {
  return {
    ReolinkClient: class ReolinkClient {
      constructor(opts) { this.opts = opts; }
    },
    makeSource: () => ({ search: async () => [] }),
    createHaDetectionSource: () => ({ fetchDay: async () => [] }),
    parseTriggerBits: () => ({ labels: [] }),
  };
}

function makeConfigService({ devices, cameras }) {
  const ledgerDir = mkdtempSync(path.join(tmpdir(), 'camera-ledger-test-'));
  return {
    ledgerDir,
    getHouseholdAppConfig: () => ({
      cameras,
      storage: { ledgerPaths: [ledgerDir] },
      sources: { streamType: 'sub' },
      classification: { sensorsByCamera: {}, filenameBits: {} },
      ledger: { dayOffset: -1 },
    }),
    getDeviceConfig: (id) => devices[id] ?? null,
    getHouseholdAuth: (ref) => (ref === 'reolink' ? { username: 'u', password: 'p' } : null),
  };
}

test('happy path: resolves host + auth from devices.yml and does the per-camera work', async () => {
  const configService = makeConfigService({
    devices: {
      'cam-a': { host: '10.0.0.56', auth_ref: 'reolink' },
      'camera-nvr': { host: '10.0.0.70', auth_ref: 'reolink' },
    },
    cameras: [{ id: 'cam-a', nvrChannel: 1 }],
  });
  const handler = createCameraLedgerJobHandler({
    configService,
    cameraAdapters: makeCameraAdapters(),
    logger: noopLogger,
  });

  const result = await handler(noopLogger, 'exec-happy');

  assert.equal(result.skipped, undefined);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].camera, 'cam-a');
  assert.equal(result.results[0].error, undefined);
  rmSync(configService.ledgerDir, { recursive: true, force: true });
});

test('camera-nvr missing from devices.yml: graceful no-auth skip, does not throw', async () => {
  const configService = makeConfigService({
    devices: {
      'cam-a': { host: '10.0.0.56', auth_ref: 'reolink' },
      // camera-nvr intentionally absent
    },
    cameras: [{ id: 'cam-a', nvrChannel: 1 }],
  });
  const handler = createCameraLedgerJobHandler({
    configService,
    cameraAdapters: makeCameraAdapters(),
    logger: noopLogger,
  });

  await assert.doesNotReject(() => handler(noopLogger, 'exec-no-nvr'));
  const result = await handler(noopLogger, 'exec-no-nvr-2');

  assert.deepEqual(result, { skipped: true, reason: 'no-auth' });
  rmSync(configService.ledgerDir, { recursive: true, force: true });
});

test('one camera failing (bad devices.yml entry) does not abort the other', async () => {
  const configService = makeConfigService({
    devices: {
      'cam-a': { host: '10.0.0.56', auth_ref: 'reolink' },
      // cam-b has no host in devices.yml -> resolveCameraEndpoint throws,
      // caught by the per-camera try/catch (not the auth-only call site).
      'cam-b': { auth_ref: 'reolink' },
      'camera-nvr': { host: '10.0.0.70', auth_ref: 'reolink' },
    },
    cameras: [{ id: 'cam-a', nvrChannel: 1 }, { id: 'cam-b', nvrChannel: 0 }],
  });
  const handler = createCameraLedgerJobHandler({
    configService,
    cameraAdapters: makeCameraAdapters(),
    logger: noopLogger,
  });

  const result = await handler(noopLogger, 'exec-partial');

  assert.equal(result.results.length, 2);
  const camA = result.results.find((r) => r.camera === 'cam-a');
  const camB = result.results.find((r) => r.camera === 'cam-b');
  assert.equal(camA.error, undefined);
  assert.match(camB.error, /cam-b/);
  rmSync(configService.ledgerDir, { recursive: true, force: true });
});
