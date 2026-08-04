import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  decodeTi86DeliveryRequestRecord,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  TI86_DELIVERY_MAX_BYTES,
  TI86_DELIVERY_MAX_RECORDS,
  acknowledgeTi86DeliveryQueueBatch,
  appendTi86DeliveryRequest,
  recoverTi86DeliveryQueue,
  ti86DeliveryCommitStages,
} from './ti86-delivery-queue.mjs';

const codec = new Ti86SchoolCalcCodec();
const deviceId = '86A001';

describe('TI-86 durable delivery queue reference', () => {
  it('appends canonical install/remove intents and makes exact replay idempotent', () => {
    const firstRequest = { requestId: 20, learnerKey: 4, action: 'install', address: 'main/math/a/u/lesson' };
    const first = appendTi86DeliveryRequest(null, { deviceId, request: firstRequest });
    expect(appendTi86DeliveryRequest(first, { deviceId, request: firstRequest }).equals(first)).toBe(true);
    const second = appendTi86DeliveryRequest(first, { deviceId, request: {
      requestId: 21, learnerKey: 4, action: 'remove', artifactId: 'sc:ti86:ABC234DEFG',
    } });
    expect(decodeTi86DeliveryRequestRecord(second).requests).toEqual([
      expect.objectContaining(firstRequest),
      expect.objectContaining({ requestId: 21, action: 'remove', artifactId: 'sc:ti86:ABC234DEFG' }),
    ]);
    expect(() => appendTi86DeliveryRequest(first, { deviceId, request: {
      requestId: 20, learnerKey: 4, action: 'install', address: 'main/math/a/u/other',
    } })).toThrow(/different content/);
    expect(() => appendTi86DeliveryRequest(first, { deviceId, request: {
      requestId: 22, learnerKey: 4, action: 'install', address: 'main/math/a/u/skipped',
    } })).toThrow(/exact successor/);
  });

  it('retires only a complete batch sealed into the committed manifest', () => {
    let queue = null;
    for (const requestId of [4, 5, 6]) {
      queue = appendTi86DeliveryRequest(queue, { deviceId, request: {
        requestId, learnerKey: 4, action: 'install', address: `main/math/a/u/l${requestId}`,
      } });
    }
    const manifest = syncManifest([4, 5]);
    const retained = acknowledgeTi86DeliveryQueueBatch(queue, manifest);
    expect(retained.equals(queue)).toBe(true);
    expect(acknowledgeTi86DeliveryQueueBatch(queue, syncManifest([4, 5, 6]))).toBe(null);
    expect(acknowledgeTi86DeliveryQueueBatch(queue, syncManifest([5, 6])).equals(queue)).toBe(true);
    expect(() => acknowledgeTi86DeliveryQueueBatch(queue, syncManifest([4], '86B002')))
      .toThrow(/does not authorize/);
  });

  it('recovers every backup-first append/retirement prefix', () => {
    const oldQueue = appendTi86DeliveryRequest(null, { deviceId, request: {
      requestId: 1, learnerKey: 4, action: 'install', address: 'main/math/a/u/one',
    } });
    const newQueue = appendTi86DeliveryRequest(oldQueue, { deviceId, request: {
      requestId: 2, learnerKey: 4, action: 'install', address: 'main/math/a/u/two',
    } });
    const stages = ti86DeliveryCommitStages(oldQueue, newQueue);
    expect(recoverTi86DeliveryQueue({ ...stages[0], deviceId }).queue.equals(oldQueue)).toBe(true);
    expect(recoverTi86DeliveryQueue({ ...stages[1], deviceId })).toMatchObject({ action: 'promote-backup' });
    expect(recoverTi86DeliveryQueue({ ...stages[2], deviceId })).toMatchObject({ action: 'delete-backup' });
    expect(recoverTi86DeliveryQueue({ ...stages[3], deviceId })).toMatchObject({ action: 'none' });

    const corrupt = Buffer.from(newQueue);
    corrupt[10] ^= 1;
    expect(recoverTi86DeliveryQueue({ canonical: oldQueue, backup: corrupt, deviceId }))
      .toMatchObject({ action: 'delete-backup', discardedCorruptBackup: true });
    expect(() => recoverTi86DeliveryQueue({ canonical: corrupt, deviceId })).toThrow(/neither DSREQ/);
  });

  it('shares the adapter resource limits', () => {
    expect(TI86_DELIVERY_MAX_BYTES).toBe(2048);
    expect(TI86_DELIVERY_MAX_RECORDS).toBe(32);
  });
});

function syncManifest(requestIds, manifestDeviceId = deviceId) {
  return codec.encodeSyncManifest({
    schema: 'school.calc.sync-plan/v1',
    deviceId: manifestDeviceId,
    platformId: 'ti86',
    generation: 'sha256:plan',
    catalog: { generation: 'sha256:catalog', changed: false },
    ready: true,
    blockers: [],
    removals: [],
    artifacts: [],
    installedArtifacts: [],
    acknowledgements: { sequences: [] },
    deliveryAcknowledgements: { requestIds },
  });
}
