import { describe, expect, it } from 'vitest';
import {
  TI86_NATIVE_SNAPSHOT_MAX_BYTES,
  TI86_NATIVE_SNAPSHOT_VARIABLE,
  decodeTi86NativeSnapshot,
  encodeTi86NativeSnapshot,
} from './Ti86NativeSnapshotCodec.mjs';
import { crc16Ccitt } from './Ti86SchoolCalcCodec.mjs';

describe('Ti86NativeSnapshotCodec', () => {
  it('round-trips canonical present and absent resources', () => {
    const bytes = encodeTi86NativeSnapshot({
      generation: 42,
      capability: 'table',
      entries: [
        { resource: 'tableSettings', present: false, bytes: Buffer.alloc(0) },
        { resource: 'functionGraphDatabase', present: true, bytes: Buffer.from('gdb') },
      ],
    });
    expect(TI86_NATIVE_SNAPSHOT_VARIABLE).toBe('DSNATIVE');
    expect(bytes.toString('ascii', 0, 4)).toBe('SCN1');
    expect(decodeTi86NativeSnapshot(bytes)).toEqual({
      generation: 42,
      capability: 'table',
      entries: [
        { resource: 'functionGraphDatabase', present: true, bytes: Buffer.from('gdb') },
        { resource: 'tableSettings', present: false, bytes: Buffer.alloc(0) },
      ],
    });
  });

  it('rejects corruption, duplicate resources, unknown flags, and trailing bytes', () => {
    const valid = encodeTi86NativeSnapshot({
      generation: 1,
      capability: 'graph',
      entries: [{ resource: 'functionGraphDatabase', present: true, bytes: Buffer.from([1, 2]) }],
    });
    const corrupt = Buffer.from(valid);
    corrupt[12] ^= 0x80;
    expect(() => decodeTi86NativeSnapshot(corrupt)).toThrow(/envelope/);

    const unknownFlags = Buffer.from(valid);
    unknownFlags[14] = 0x02;
    repairCrc(unknownFlags);
    expect(() => decodeTi86NativeSnapshot(unknownFlags)).toThrow(/unknown flags/);

    const absentWithBytes = Buffer.from(valid);
    absentWithBytes[14] = 0;
    repairCrc(absentWithBytes);
    expect(() => decodeTi86NativeSnapshot(absentWithBytes)).toThrow(/absent/);

    const trailing = Buffer.concat([valid.subarray(0, -2), Buffer.from([0]), Buffer.alloc(2)]);
    trailing.writeUInt16LE(trailing.length - 9, 5);
    repairCrc(trailing);
    expect(() => decodeTi86NativeSnapshot(trailing)).toThrow(/trailing/);

    const unknownResource = Buffer.from(valid);
    unknownResource[13] = 0x7F;
    repairCrc(unknownResource);
    expect(() => decodeTi86NativeSnapshot(unknownResource)).toThrow(/unknown/);

    const truncatedEntryList = Buffer.from(valid);
    truncatedEntryList[12] = 2;
    repairCrc(truncatedEntryList);
    expect(() => decodeTi86NativeSnapshot(truncatedEntryList)).toThrow(/truncated/);
    expect(() => encodeTi86NativeSnapshot({
      generation: 1,
      capability: 'graph',
      entries: [
        { resource: 'functionGraphDatabase', present: true, bytes: Buffer.alloc(0) },
        { resource: 'functionGraphDatabase', present: false, bytes: Buffer.alloc(0) },
      ],
    })).toThrow(/repeats/);
    expect(() => encodeTi86NativeSnapshot({
      generation: 1,
      capability: 'graph',
      entries: [{ resource: 'functionGraphDatabase', present: false, bytes: Buffer.from([1]) }],
    })).toThrow(/absent/);
  });

  it('enforces per-resource and total snapshot limits', () => {
    expect(TI86_NATIVE_SNAPSHOT_MAX_BYTES).toBe(4096);
    expect(() => encodeTi86NativeSnapshot({
      generation: 1,
      capability: 'graph',
      entries: [{
        resource: 'functionGraphDatabase', present: true, bytes: Buffer.alloc((3 * 1024) + 1),
      }],
    })).toThrow(/resource limit/);
    expect(() => encodeTi86NativeSnapshot({
      generation: 1,
      capability: 'nativeProgram',
      entries: [
        { resource: 'functionGraphDatabase', present: true, bytes: Buffer.alloc(3 * 1024) },
        { resource: 'nativeProgramWorkspace', present: true, bytes: Buffer.alloc(1024) },
      ],
    })).toThrow(/4096-byte/);
  });
});

function repairCrc(bytes) {
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
}
