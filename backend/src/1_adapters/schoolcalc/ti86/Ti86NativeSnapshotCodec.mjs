import { crc16Ccitt } from './Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from './Ti86SchoolCalcLimits.mjs';
import { TI86_NATIVE_OPERATION, TI86_NATIVE_SNAPSHOT_RESOURCE } from './Ti86NativeToolMapper.mjs';

export const TI86_NATIVE_SNAPSHOT_MAGIC = 'SCN1';
export const TI86_NATIVE_SNAPSHOT_VARIABLE = 'DSNATIVE';
export const TI86_NATIVE_SNAPSHOT_MAX_BYTES = TI86_SCHOOLCALC_LIMITS.nativeSnapshotMaxBytes;

const CAPABILITY_CODE = Object.freeze({
  calculator: TI86_NATIVE_OPERATION.calculator,
  graph: TI86_NATIVE_OPERATION.graph,
  table: TI86_NATIVE_OPERATION.table,
  solver: TI86_NATIVE_OPERATION.solver,
  matrix: TI86_NATIVE_OPERATION.matrix,
  equationEditor: TI86_NATIVE_OPERATION.equationEditor,
  nativeProgram: TI86_NATIVE_OPERATION.nativeProgram,
});
const CAPABILITY_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(CAPABILITY_CODE).map(([name, code]) => [code, name]),
));
const RESOURCE_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(TI86_NATIVE_SNAPSHOT_RESOURCE).map(([name, code]) => [code, name]),
));

// Per-resource ceilings keep a valid total envelope from hiding an absurd
// resource. The function GDB is intentionally the largest: TI-OS owns its
// opaque layout and it captures equations, selection/style, window, and format.
export const TI86_NATIVE_SNAPSHOT_RESOURCE_MAX_BYTES = Object.freeze({
  homeEntry: 128,
  functionGraphDatabase: 3 * 1024,
  tableSettings: 32,
  solverState: 512,
  matrixWorkspace: 2 * 1024,
  nativeProgramWorkspace: 1024,
});

/**
 * Encode client-private SCN1 bytes stored in the TI String `DSNATIVE`.
 *
 * Body layout:
 *   generation:u32, capability:u8, entryCount:u8,
 *   repeated resource:u8, flags:u8, length:u16, opaque bytes.
 * The outer header is magic/version/bodyLength and the final two bytes are
 * CRC-16/CCITT-FALSE. Entries are canonical and sorted by resource code.
 */
export function encodeTi86NativeSnapshot({ generation, capability, entries }) {
  uint(generation, 1, 0xFFFF_FFFF, 'SCN1 generation');
  const capabilityCode = CAPABILITY_CODE[capability];
  if (!capabilityCode) throw new Error('SCN1 capability is invalid');
  if (!Array.isArray(entries) || entries.length < 1
      || entries.length > Object.keys(TI86_NATIVE_SNAPSHOT_RESOURCE).length) {
    throw new Error('SCN1 entries must be a non-empty bounded array');
  }
  const normalized = entries.map(normalizeEntry).sort((a, b) => a.code - b.code);
  if (new Set(normalized.map((entry) => entry.code)).size !== normalized.length) {
    throw new Error('SCN1 repeats a snapshot resource');
  }

  const body = [
    generation & 0xFF,
    (generation >>> 8) & 0xFF,
    (generation >>> 16) & 0xFF,
    (generation >>> 24) & 0xFF,
    capabilityCode,
    normalized.length,
  ];
  normalized.forEach((entry) => {
    body.push(entry.code, entry.present ? 1 : 0, entry.bytes.length & 0xFF, entry.bytes.length >>> 8);
    body.push(...entry.bytes);
  });
  const bytes = Buffer.alloc(7 + body.length + 2);
  bytes.write(TI86_NATIVE_SNAPSHOT_MAGIC, 0, 4, 'ascii');
  bytes[4] = 1;
  bytes.writeUInt16LE(body.length, 5);
  Buffer.from(body).copy(bytes, 7);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  if (bytes.length > TI86_NATIVE_SNAPSHOT_MAX_BYTES) {
    throw new Error(`SCN1 exceeds ${TI86_NATIVE_SNAPSHOT_MAX_BYTES}-byte native snapshot limit`);
  }
  return bytes;
}

export function decodeTi86NativeSnapshot(input) {
  const bytes = asBuffer(input);
  if (bytes.length < 15 || bytes.length > TI86_NATIVE_SNAPSHOT_MAX_BYTES
      || bytes.toString('ascii', 0, 4) !== TI86_NATIVE_SNAPSHOT_MAGIC
      || bytes[4] !== 1
      || bytes.readUInt16LE(5) !== bytes.length - 9
      || bytes.readUInt16LE(bytes.length - 2) !== crc16Ccitt(bytes.subarray(0, -2))) {
    throw new Error('SCN1 native snapshot envelope is invalid');
  }
  const body = bytes.subarray(7, -2);
  const generation = body.readUInt32LE(0);
  if (generation < 1) throw new Error('SCN1 generation is invalid');
  const capability = CAPABILITY_BY_CODE[body[4]];
  if (!capability) throw new Error('SCN1 capability code is invalid');
  const count = body[5];
  if (count < 1 || count > Object.keys(TI86_NATIVE_SNAPSHOT_RESOURCE).length) {
    throw new Error('SCN1 entry count is invalid');
  }
  const entries = [];
  let offset = 6;
  let priorCode = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > body.length) throw new Error('SCN1 resource header is truncated');
    const code = body[offset];
    const flags = body[offset + 1];
    const length = body.readUInt16LE(offset + 2);
    offset += 4;
    const resource = RESOURCE_BY_CODE[code];
    if (!resource || code <= priorCode) throw new Error('SCN1 resources are unknown, repeated, or noncanonical');
    if ((flags & ~1) !== 0) throw new Error(`SCN1 ${resource} has unknown flags`);
    const present = Boolean(flags & 1);
    if (!present && length !== 0) throw new Error(`SCN1 absent ${resource} contains bytes`);
    if (length > TI86_NATIVE_SNAPSHOT_RESOURCE_MAX_BYTES[resource]) {
      throw new Error(`SCN1 ${resource} exceeds its resource limit`);
    }
    if (offset + length > body.length) throw new Error(`SCN1 ${resource} is truncated`);
    entries.push(Object.freeze({
      resource,
      present,
      bytes: Buffer.from(body.subarray(offset, offset + length)),
    }));
    offset += length;
    priorCode = code;
  }
  if (offset !== body.length) throw new Error('SCN1 contains trailing bytes');
  return Object.freeze({
    generation,
    capability,
    entries: Object.freeze(entries),
  });
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('SCN1 entry must be a mapping');
  const code = TI86_NATIVE_SNAPSHOT_RESOURCE[raw.resource];
  if (!code) throw new Error(`SCN1 resource '${raw.resource ?? 'missing'}' is invalid`);
  if (typeof raw.present !== 'boolean') throw new Error(`SCN1 ${raw.resource} present flag is invalid`);
  const bytes = raw.bytes == null ? Buffer.alloc(0) : asBuffer(raw.bytes);
  if (!raw.present && bytes.length !== 0) throw new Error(`SCN1 absent ${raw.resource} contains bytes`);
  if (bytes.length > TI86_NATIVE_SNAPSHOT_RESOURCE_MAX_BYTES[raw.resource]) {
    throw new Error(`SCN1 ${raw.resource} exceeds its resource limit`);
  }
  return { code, present: raw.present, bytes: Buffer.from(bytes) };
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('SCN1 bytes are required');
}

function uint(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} is invalid`);
}

export default Object.freeze({ encodeTi86NativeSnapshot, decodeTi86NativeSnapshot });
