import { test } from 'node:test';
import assert from 'node:assert/strict';
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

function makeRuntimeGateway({ devices, cameras }) {
  const plan = { cameras, filenameBitsByCamera: {}, dayOffset: -1 };
  return {
    loadLedgerPlan: () => plan,
    loadArchivePlan: () => ({ cameras: [] }),
    createArchiveRuntime: () => ({}),
    createLedgerRuntime: () => {
      if (!devices['camera-nvr']?.host) {
        const error = new Error("camera device 'camera-nvr' has no host");
        error.code = 'CAMERA_AUTH_UNAVAILABLE';
        throw error;
      }
      return {
        detectionSource: null,
        decodeTriggerBits: () => ({ labels: [] }),
        createSources(camera) {
          if (!devices[camera.id]?.host) throw new Error(`camera device '${camera.id}' has no host`);
          return {
            camera: { search: async () => [] },
            nvr: { search: async () => [] },
          };
        },
      };
    },
  };
}

const ledgerStore = {
  write: async () => ({ copies: 2 }),
  read: async () => [],
};

test('happy path: resolves host + auth from devices.yml and does the per-camera work', async () => {
  const runtimeGateway = makeRuntimeGateway({
    devices: {
      'cam-a': { host: '10.0.0.56', auth_ref: 'reolink' },
      'camera-nvr': { host: '10.0.0.70', auth_ref: 'reolink' },
    },
    cameras: [{ id: 'cam-a', nvrChannel: 1 }],
  });
  const handler = createCameraLedgerJobHandler({
    runtimeGateway,
    ledgerStore,
    logger: noopLogger,
  });

  const result = await handler(noopLogger, 'exec-happy');

  assert.equal(result.skipped, undefined);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].camera, 'cam-a');
  assert.equal(result.results[0].error, undefined);
});

test('camera-nvr missing from devices.yml: graceful no-auth skip, does not throw', async () => {
  const runtimeGateway = makeRuntimeGateway({
    devices: {
      'cam-a': { host: '10.0.0.56', auth_ref: 'reolink' },
      // camera-nvr intentionally absent
    },
    cameras: [{ id: 'cam-a', nvrChannel: 1 }],
  });
  const handler = createCameraLedgerJobHandler({
    runtimeGateway,
    ledgerStore,
    logger: noopLogger,
  });

  await assert.doesNotReject(() => handler(noopLogger, 'exec-no-nvr'));
  const result = await handler(noopLogger, 'exec-no-nvr-2');

  assert.deepEqual(result, { skipped: true, reason: 'no-auth' });
});

test('one camera failing (bad devices.yml entry) does not abort the other', async () => {
  const runtimeGateway = makeRuntimeGateway({
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
    runtimeGateway,
    ledgerStore,
    logger: noopLogger,
  });

  const result = await handler(noopLogger, 'exec-partial');

  assert.equal(result.results.length, 2);
  const camA = result.results.find((r) => r.camera === 'cam-a');
  const camB = result.results.find((r) => r.camera === 'cam-b');
  assert.equal(camA.error, undefined);
  assert.match(camB.error, /cam-b/);
});
