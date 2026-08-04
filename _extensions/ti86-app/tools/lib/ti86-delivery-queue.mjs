import {
  decodeTi86DeliveryRequestRecord,
  decodeTi86SyncManifest,
  encodeTi86DeliveryRequests,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';

export const TI86_DELIVERY_VARIABLE = 'DSREQ';
export const TI86_DELIVERY_BACKUP_VARIABLE = 'DSREQB';
export const TI86_DELIVERY_MAX_BYTES = TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes;
export const TI86_DELIVERY_MAX_RECORDS = TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords;

/** Append one calculator-authored intent to the canonical fixed SCD1 queue. */
export function appendTi86DeliveryRequest(existingQueue, { deviceId, request }, {
  maxBytes = TI86_DELIVERY_MAX_BYTES,
} = {}) {
  const existing = existingQueue == null
    ? { deviceId, requests: [] }
    : decodeTi86DeliveryRequestRecord(asBuffer(existingQueue, 'existing delivery queue'));
  if (existing.deviceId !== deviceId) throw new Error('existing delivery queue belongs to another device');

  const normalized = decodeTi86DeliveryRequestRecord(encodeTi86DeliveryRequests({
    deviceId, requests: [{ ...request }],
  })).requests[0];
  const prior = existing.requests.find((entry) => entry.requestId === normalized.requestId);
  if (prior) {
    if (sameRequest(prior, normalized)) return Buffer.from(existingQueue);
    throw new Error(`delivery request ${normalized.requestId} already has different content`);
  }
  const lastId = existing.requests.at(-1)?.requestId;
  if (lastId !== undefined && normalized.requestId !== lastId + 1) {
    throw new Error('new delivery request must be the exact successor of the queue tail');
  }
  return bounded(encodeTi86DeliveryRequests({
    deviceId, requests: [...existing.requests, normalized],
  }), maxBytes);
}

/**
 * Retire an immutable queue only when SCM1 seals every request ID in the
 * batch. A partial or unrelated acknowledgement leaves DSREQ byte-for-byte
 * unchanged, avoiding a second calculator-side queue allocation.
 */
export function acknowledgeTi86DeliveryQueueBatch(existingQueue, manifest) {
  if (existingQueue == null) return null;
  const existingBytes = asBuffer(existingQueue, 'existing delivery queue');
  const existing = decodeTi86DeliveryRequestRecord(existingBytes);
  const acknowledgement = decodeTi86SyncManifest(asBuffer(manifest, 'sync manifest'));
  if (acknowledgement.deviceId !== existing.deviceId) {
    throw new Error('delivery acknowledgement does not authorize this queue');
  }
  const requestIds = existing.requests.map((request) => request.requestId);
  const acknowledged = acknowledgement.acknowledgedRequestIds;
  if (requestIds.length !== acknowledged.length
      || requestIds.some((requestId, index) => requestId !== acknowledged[index])) {
    return Buffer.from(existingBytes);
  }
  return null;
}

/** A valid backup is the intended next state and wins after an interrupted write. */
export function recoverTi86DeliveryQueue({ canonical = null, backup = null, deviceId } = {}) {
  const canonicalState = inspect(canonical, deviceId);
  const backupState = inspect(backup, deviceId);
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
  throw new Error('neither DSREQ nor DSREQB contains a valid device request queue');
}

/** Ordered mutations; every stage prefix is accepted by the recovery rule. */
export function ti86DeliveryCommitStages(canonical, intended) {
  const current = canonical == null ? null : Buffer.from(canonical);
  const next = intended == null ? null : Buffer.from(intended);
  if (next == null) {
    return Object.freeze([
      Object.freeze({ step: 'delete-old-backup', canonical: current, backup: null }),
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

function inspect(value, expectedDeviceId) {
  if (value == null) return { valid: false, bytes: null };
  try {
    const bytes = asBuffer(value, 'delivery queue candidate');
    const decoded = decodeTi86DeliveryRequestRecord(bytes);
    if (expectedDeviceId && decoded.deviceId !== expectedDeviceId) return { valid: false, bytes };
    return { valid: true, bytes };
  } catch {
    return { valid: false, bytes: Buffer.from(value) };
  }
}

function bounded(bytes, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes < 9 || maxBytes > 0xFFFF + 9) {
    throw new Error('delivery queue maxBytes is invalid');
  }
  if (bytes.length > maxBytes) throw new Error(`SCD1 queue exceeds ${maxBytes}-byte calculator bound`);
  return Buffer.from(bytes);
}

function sameRequest(left, right) {
  return left.requestId === right.requestId
    && left.action === right.action
    && left.address === right.address
    && left.artifactId === right.artifactId;
}

function asBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`${label} must be bytes`);
}
