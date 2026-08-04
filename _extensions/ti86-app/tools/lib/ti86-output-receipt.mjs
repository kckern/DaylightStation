import { crc16Ccitt } from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';

/** Calculator-private optical-output receipt. Never sent to the backend. */
export const TI86_OUTPUT_RECEIPT_MAGIC = 'SCO1';
export const TI86_OUTPUT_RECEIPT_VERSION = 1;
export const TI86_OUTPUT_RECEIPT_MAX_RECORDS = 170;
export const TI86_OUTPUT_RECEIPT_BITSET_BYTES = 22;
export const TI86_OUTPUT_RECEIPT_BYTES = 34;

export function encodeTi86OutputReceipt({ baseSequence, reportedIndexes = [] } = {}) {
  assertSequence(baseSequence, 'baseSequence');
  const bytes = Buffer.alloc(TI86_OUTPUT_RECEIPT_BYTES);
  bytes.write(TI86_OUTPUT_RECEIPT_MAGIC, 0, 4, 'ascii');
  bytes[4] = TI86_OUTPUT_RECEIPT_VERSION;
  bytes.writeUInt16LE(3 + TI86_OUTPUT_RECEIPT_BITSET_BYTES, 5);
  writeU24(bytes, 7, baseSequence);
  for (const index of reportedIndexes) setReceiptBit(bytes, index);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  return bytes;
}

export function decodeTi86OutputReceipt(input) {
  const bytes = Buffer.from(input ?? []);
  if (bytes.length !== TI86_OUTPUT_RECEIPT_BYTES
      || bytes.toString('ascii', 0, 4) !== TI86_OUTPUT_RECEIPT_MAGIC
      || bytes[4] !== TI86_OUTPUT_RECEIPT_VERSION
      || bytes.readUInt16LE(5) !== 3 + TI86_OUTPUT_RECEIPT_BITSET_BYTES
      || bytes.readUInt16LE(bytes.length - 2) !== crc16Ccitt(bytes.subarray(0, -2))) {
    throw new Error('SCO1 output receipt is invalid');
  }
  const reportedIndexes = [];
  for (let index = 0; index < TI86_OUTPUT_RECEIPT_MAX_RECORDS; index += 1) {
    if (receiptBit(bytes, index)) reportedIndexes.push(index);
  }
  return Object.freeze({
    baseSequence: readU24(bytes, 7),
    reportedIndexes: Object.freeze(reportedIndexes),
  });
}

/** A stale sidecar is harmless: the calculator offers the QR again. */
export function isTi86OutputReceiptCurrent(receipt, { baseSequence, queueLength } = {}) {
  assertSequence(baseSequence, 'baseSequence');
  if (!Number.isInteger(queueLength) || queueLength < 1 || queueLength > TI86_OUTPUT_RECEIPT_MAX_RECORDS) {
    throw new Error('output receipt queueLength is invalid');
  }
  try {
    return decodeTi86OutputReceipt(receipt).baseSequence === baseSequence;
  } catch {
    return false;
  }
}

export function markTi86OutputReceipt(receipt, { baseSequence, index } = {}) {
  assertSequence(baseSequence, 'baseSequence');
  assertIndex(index);
  const current = isTi86OutputReceiptCurrent(receipt, {
    baseSequence,
    queueLength: TI86_OUTPUT_RECEIPT_MAX_RECORDS,
  });
  const reportedIndexes = current ? decodeTi86OutputReceipt(receipt).reportedIndexes : [];
  return encodeTi86OutputReceipt({ baseSequence, reportedIndexes: [...reportedIndexes, index] });
}

export function isTi86OutputReported(receipt, { baseSequence, index } = {}) {
  assertSequence(baseSequence, 'baseSequence');
  assertIndex(index);
  if (!isTi86OutputReceiptCurrent(receipt, {
    baseSequence,
    queueLength: TI86_OUTPUT_RECEIPT_MAX_RECORDS,
  })) return false;
  return receiptBit(Buffer.from(receipt), index);
}

function setReceiptBit(bytes, index) {
  assertIndex(index);
  bytes[10 + Math.floor(index / 8)] |= 1 << (index % 8);
}

function receiptBit(bytes, index) {
  return (bytes[10 + Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
}

function assertIndex(value) {
  if (!Number.isInteger(value) || value < 0 || value >= TI86_OUTPUT_RECEIPT_MAX_RECORDS) {
    throw new Error('output receipt index is invalid');
  }
}

function assertSequence(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff_ffff || value === 0xff_ffff) {
    throw new Error(`output receipt ${label} is invalid`);
  }
}

function writeU24(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function readU24(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}
