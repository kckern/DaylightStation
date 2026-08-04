import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  encodeTi86ResultRecord,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  TI86_QUEUE_MAX_BYTES,
  acknowledgeTi86Queue,
  acknowledgeTi86QueueBatch,
  appendTi86QueueRecord,
  recoverTi86Queue,
  ti86QueueCommitStages,
} from './ti86-durable-queue.mjs';

const codec = new Ti86SchoolCalcCodec();
const deviceId = '86A001';

describe('TI-86 durable result queue reference', () => {
  it('stream-appends exact SCR1 bytes through multiple 256-byte cache windows', () => {
    let queue = null;
    const records = [];
    for (let sequence = 1; sequence <= 18; sequence += 1) {
      const record = result(sequence);
      records.push(record);
      queue = appendTi86QueueRecord(queue, { deviceId, record });
    }
    expect(queue.length).toBeGreaterThan(512);
    const decoded = codec.decodeResultQueue(queue);
    expect(decoded).toHaveLength(records.length);
    decoded.forEach((entry, index) => expect(entry.equals(records[index])).toBe(true));
  });

  it('makes exact re-append idempotent and rejects sequence conflicts or another device', () => {
    const first = result(9);
    const queue = appendTi86QueueRecord(null, { deviceId, record: first });
    expect(appendTi86QueueRecord(queue, { deviceId, record: first }).equals(queue)).toBe(true);
    expect(() => appendTi86QueueRecord(queue, {
      deviceId,
      record: result(9, { given: 4 }),
    })).toThrow(/different bytes/);
    expect(() => appendTi86QueueRecord(queue, {
      deviceId,
      record: result(10, { deviceId: '86B002' }),
    })).toThrow(/another device/);
  });

  it('interleaves assessment and timestamp-free progress records in one ordered queue', () => {
    const response = result(20);
    const progress = encodeTi86ResultRecord({
      schema: 'school.calc.result/v1', kind: 'progress', deviceId, sequence: 21, learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 3,
      progress: { status: 'completed', position: 8, total: 8 },
    });
    let queue = appendTi86QueueRecord(null, { deviceId, record: response });
    queue = appendTi86QueueRecord(queue, { deviceId, record: progress });
    expect(codec.decodeResultQueue(queue).map((record) => codec.decodeResult(record))).toEqual([
      expect.objectContaining({ sequence: 20, kind: 'responses' }),
      expect.objectContaining({
        sequence: 21, kind: 'progress',
        progress: { status: 'completed', position: 8, total: 8 },
      }),
    ]);
  });

  it('enforces the calculator queue allocation bound', () => {
    let queue = null;
    let sequence = 1;
    expect(() => {
      for (;; sequence += 1) {
        queue = appendTi86QueueRecord(queue, { deviceId, record: result(sequence) }, { maxBytes: 300 });
      }
    }).toThrow(/exceeds 300-byte/);
    expect(TI86_QUEUE_MAX_BYTES).toBe(6144);
  });

  it('removes only backend-authorized sequences and accepts duplicate ACK application', () => {
    let queue = null;
    for (const sequence of [3, 4, 5]) {
      queue = appendTi86QueueRecord(queue, { deviceId, record: result(sequence) });
    }
    const ack = codec.encodeAcknowledgements({ deviceId, sequences: [3, 5, 99] });
    const retained = acknowledgeTi86Queue(queue, ack);
    expect(codec.decodeResultQueue(retained).map((record) => codec.decodeResult(record).sequence)).toEqual([4]);
    expect(acknowledgeTi86Queue(retained, ack).equals(retained)).toBe(true);
    expect(acknowledgeTi86Queue(retained, codec.encodeAcknowledgements({
      deviceId, sequences: [4],
    }))).toBe(null);
    expect(() => acknowledgeTi86Queue(queue, codec.encodeAcknowledgements({
      deviceId: '86B002', sequences: [3],
    }))).toThrow(/does not authorize/);
  });

  it('uses atomic whole-batch deletion in the production calculator transaction', () => {
    let queue = null;
    for (const sequence of [3, 4, 5]) {
      queue = appendTi86QueueRecord(queue, { deviceId, record: result(sequence) });
    }
    const partial = codec.encodeAcknowledgements({ deviceId, sequences: [3, 5] });
    expect(acknowledgeTi86QueueBatch(queue, partial).equals(queue)).toBe(true);
    const complete = codec.encodeAcknowledgements({ deviceId, sequences: [3, 4, 5] });
    expect(acknowledgeTi86QueueBatch(queue, complete)).toBe(null);
  });

  it('recovers every prefix of backup-first replacement without losing intended state', () => {
    const oldQueue = appendTi86QueueRecord(null, { deviceId, record: result(1) });
    const newQueue = appendTi86QueueRecord(oldQueue, { deviceId, record: result(2) });
    const stages = ti86QueueCommitStages(oldQueue, newQueue);
    expect(recoverTi86Queue({ ...stages[0], deviceId }).queue.equals(oldQueue)).toBe(true);
    expect(recoverTi86Queue({ ...stages[1], deviceId })).toMatchObject({ action: 'promote-backup' });
    expect(recoverTi86Queue({ ...stages[1], deviceId }).queue.equals(newQueue)).toBe(true);
    expect(recoverTi86Queue({ ...stages[2], deviceId })).toMatchObject({ action: 'delete-backup' });
    expect(recoverTi86Queue({ ...stages[3], deviceId })).toMatchObject({ action: 'none' });

    const corrupt = Buffer.from(newQueue);
    corrupt[10] ^= 1;
    const recovered = recoverTi86Queue({ canonical: oldQueue, backup: corrupt, deviceId });
    expect(recovered.queue.equals(oldQueue)).toBe(true);
    expect(recovered).toMatchObject({ action: 'delete-backup', discardedCorruptBackup: true });
    expect(() => recoverTi86Queue({ canonical: corrupt, backup: null, deviceId })).toThrow(/neither DSQ/);

    const deleteStages = ti86QueueCommitStages(oldQueue, null);
    expect(deleteStages.map((stage) => stage.step)).toEqual(['delete-old-backup', 'delete-canonical']);
    expect(recoverTi86Queue({ ...deleteStages[0], deviceId }).queue.equals(oldQueue)).toBe(true);
    expect(recoverTi86Queue({ ...deleteStages[1], deviceId })).toMatchObject({ queue: null, action: 'none' });
  });
});

function result(sequence, overrides = {}) {
  return encodeTi86ResultRecord({
    schema: 'school.calc.result/v1',
    kind: 'responses',
    deviceId: overrides.deviceId ?? deviceId,
    learnerKey: overrides.learnerKey ?? 4,
    sequence,
    artifactId: 'sc:ti86:ABC234DEFG',
    moduleIndex: 0,
    responses: [{ itemIndex: 0, given: overrides.given ?? 2 }],
    localScore: { correct: overrides.given === 1 ? 0 : 1, total: 1, percent: overrides.given === 1 ? 0 : 100 },
  });
}
