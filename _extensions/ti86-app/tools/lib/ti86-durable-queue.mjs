import {
  Ti86SchoolCalcCodec,
  decodeTi86Acknowledgements,
  decodeTi86ResultQueueRecord,
  encodeTi86ResultQueue,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';

export const TI86_QUEUE_MAX_BYTES = 6 * 1024;
export const TI86_QUEUE_VARIABLE = 'DSQ';
export const TI86_QUEUE_BACKUP_VARIABLE = 'DSQB';

const codec = new Ti86SchoolCalcCodec();

/**
 * Reference implementation of the streaming append the Z80 shell performs.
 * It appends one length-prefixed exact SCR1 record to the fixed-layout queue,
 * patches the count/envelope length, then recomputes the envelope CRC.
 */
export function appendTi86QueueRecord(existingQueue, { deviceId, record }, {
  maxBytes = TI86_QUEUE_MAX_BYTES,
} = {}) {
  const exactRecord = asBuffer(record, 'queued result');
  const result = codec.decodeResult(exactRecord);
  if (result.deviceId !== deviceId) throw new Error('queued result belongs to another device');

  if (existingQueue == null) {
    return boundedQueue(encodeTi86ResultQueue({ deviceId, records: [exactRecord] }), maxBytes);
  }

  const existing = asBuffer(existingQueue, 'existing queue');
  const queued = codec.decodeResultQueue(existing);
  for (const entry of queued) {
    const decoded = codec.decodeResult(entry);
    if (decoded.sequence !== result.sequence) continue;
    if (entry.equals(exactRecord)) return Buffer.from(existing);
    throw new Error(`queue sequence ${result.sequence} already has different bytes`);
  }
  const queueDeviceId = queueIdentity(existing);
  if (queueDeviceId !== deviceId) throw new Error('existing queue belongs to another device');

  if (queued.length >= 0xFFFF) throw new Error('SCQ1 queue contains too many records');
  const next = boundedQueue(encodeTi86ResultQueue({
    deviceId, records: [...queued, exactRecord],
  }), maxBytes);

  const verified = codec.decodeResultQueue(next);
  if (verified.length !== queued.length + 1 || !verified.at(-1).equals(exactRecord)) {
    throw new Error('streaming SCQ1 append did not produce the intended queue');
  }
  return next;
}

/** Apply backend-authorized SCA1 sequences. Unmentioned records always remain. */
export function acknowledgeTi86Queue(existingQueue, acknowledgement, {
  maxBytes = TI86_QUEUE_MAX_BYTES,
} = {}) {
  if (existingQueue == null) return null;
  const existing = asBuffer(existingQueue, 'existing queue');
  const queued = codec.decodeResultQueue(existing);
  const queueDeviceId = queueIdentity(existing);
  const ack = decodeTi86Acknowledgements(asBuffer(acknowledgement, 'acknowledgement'));
  if (ack.deviceId !== queueDeviceId || !ack.sequences.every(isSequence)) {
    throw new Error('acknowledgement does not authorize this queue');
  }
  const acknowledged = new Set(ack.sequences);
  const retained = queued.filter((record) => !acknowledged.has(codec.decodeResult(record).sequence));
  if (retained.length === queued.length) return Buffer.from(existing);
  if (retained.length === 0) return null;
  return boundedQueue(encodeTi86ResultQueue({ deviceId: queueDeviceId, records: retained }), maxBytes);
}

/**
 * Production v0 acknowledgement policy: delete only when the backend has
 * acknowledged the exact complete queue batch. A partial/mismatched batch is
 * retained byte-for-byte and safely replays through backend idempotency.
 */
export function acknowledgeTi86QueueBatch(existingQueue, acknowledgement) {
  if (existingQueue == null) return null;
  const existing = asBuffer(existingQueue, 'existing queue');
  const queued = codec.decodeResultQueue(existing);
  const queueDeviceId = queueIdentity(existing);
  const ack = decodeTi86Acknowledgements(asBuffer(acknowledgement, 'acknowledgement'));
  if (ack.deviceId !== queueDeviceId) throw new Error('acknowledgement does not authorize this queue');
  const queueSequences = queued.map((record) => codec.decodeResult(record).sequence);
  const completeBatch = queueSequences.length === ack.sequences.length
    && queueSequences.every((sequence, index) => sequence === ack.sequences[index]);
  return completeBatch ? null : Buffer.from(existing);
}

/**
 * Recovery rule for crash-safe `DSQ` replacement through `DSQB`.
 * A complete valid backup is always the pending intended state and wins.
 */
export function recoverTi86Queue({ canonical = null, backup = null, deviceId } = {}) {
  const canonicalState = inspectQueue(canonical, deviceId);
  const backupState = inspectQueue(backup, deviceId);
  if (backupState.valid) {
    return Object.freeze({
      queue: Buffer.from(backupState.bytes),
      action: canonicalState.valid && canonicalState.bytes.equals(backupState.bytes)
        ? 'delete-backup'
        : 'promote-backup',
      discardedCorruptBackup: false,
    });
  }
  if (canonicalState.valid) {
    return Object.freeze({
      queue: Buffer.from(canonicalState.bytes),
      action: backup == null ? 'none' : 'delete-backup',
      discardedCorruptBackup: backup != null,
    });
  }
  if (canonical == null && backup == null) {
    return Object.freeze({ queue: null, action: 'none', discardedCorruptBackup: false });
  }
  throw new Error('neither DSQ nor DSQB contains a valid device queue');
}

/** Ordered write/delete stages. Each prefix is recoverable by recoverTi86Queue. */
export function ti86QueueCommitStages(canonical, intended) {
  const current = canonical == null ? null : Buffer.from(canonical);
  const next = intended == null ? null : Buffer.from(intended);
  if (next == null) {
    return Object.freeze([
      Object.freeze({ step: 'delete-old-backup', canonical: current, backup: null }),
      // An authorized empty queue is a deletion. A crash before this step may
      // resend duplicates; a crash after it is already the intended state.
      Object.freeze({ step: 'delete-canonical', canonical: null, backup: null }),
    ]);
  }
  return Object.freeze([
    Object.freeze({ step: 'delete-old-backup', canonical: current, backup: null }),
    Object.freeze({ step: 'write-and-verify-backup', canonical: current, backup: next }),
    Object.freeze({ step: 'replace-canonical', canonical: next, backup: next }),
    Object.freeze({ step: 'delete-backup', canonical: next, backup: null }),
  ]);
}

function inspectQueue(value, expectedDeviceId) {
  if (value == null) return { valid: false, bytes: null };
  try {
    const bytes = asBuffer(value, 'queue candidate');
    codec.decodeResultQueue(bytes);
    if (expectedDeviceId && queueIdentity(bytes) !== expectedDeviceId) return { valid: false, bytes };
    return { valid: true, bytes };
  } catch {
    return { valid: false, bytes: Buffer.from(value) };
  }
}

function queueIdentity(bytes) {
  return decodeTi86ResultQueueRecord(bytes).deviceId;
}

function boundedQueue(bytes, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes < 9 || maxBytes > 0xFFFF + 9) {
    throw new Error('queue maxBytes is invalid');
  }
  if (bytes.length > maxBytes) throw new Error(`SCQ1 queue exceeds ${maxBytes}-byte calculator bound`);
  return Buffer.from(bytes);
}

function asBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`${label} must be bytes`);
}

function isSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xFF_FFFF;
}
