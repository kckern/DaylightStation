import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCameraArchiveJobHandler } from './cameraArchiveJobHandler.mjs';

const logger = { info() {}, warn() {}, error() {} };
const plan = {
  cameras: [{ id: 'driveway', nvrChannel: 1 }],
  enabled: true,
  dayOffset: -1,
  policy: {},
};

function runtimeGateway({ failPreparation = false } = {}) {
  return {
    loadLedgerPlan: () => ({ cameras: [] }),
    loadArchivePlan: () => plan,
    createLedgerRuntime: () => ({}),
    createArchiveRuntime: () => {
      if (failPreparation) {
        const error = new Error('credentials unavailable');
        error.code = 'CAMERA_AUTH_UNAVAILABLE';
        throw error;
      }
      const source = { search: async () => [] };
      return {
        encoder: {},
        manifestStore: { read: async () => null, isComplete: () => false },
        archiveArtifacts: {},
        sheetArtifacts: {},
        createSources: () => ({ metadata: source, footage: source }),
      };
    },
  };
}

const ledgerStore = { read: async () => [], write: async () => [] };

test('camera archive handler consumes semantic runtime capabilities', async () => {
  const handler = createCameraArchiveJobHandler({
    runtimeGateway: runtimeGateway(), ledgerStore, logger,
  });

  const result = await handler(logger, 'archive-test');

  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0], {
    camera: 'driveway',
    day: result.day,
    skipped: true,
    reason: 'no-recordings',
  });
});

test('camera archive handler preserves graceful no-auth skip', async () => {
  const handler = createCameraArchiveJobHandler({
    runtimeGateway: runtimeGateway({ failPreparation: true }), ledgerStore, logger,
  });
  assert.deepEqual(await handler(logger, 'archive-no-auth'), {
    skipped: true,
    reason: 'no-auth',
  });
});

test('camera archive handler does not mislabel runtime construction failures as no-auth', async () => {
  const gateway = runtimeGateway();
  gateway.createArchiveRuntime = () => { throw new Error('manifest root missing'); };
  const handler = createCameraArchiveJobHandler({
    runtimeGateway: gateway, ledgerStore, logger,
  });
  await assert.rejects(() => handler(logger, 'archive-runtime-error'), /manifest root missing/);
});
