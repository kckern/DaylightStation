import { describe, it, expect } from 'vitest';
import { readValue } from "./memoryRead.js";

describe('readValue', () => {
  it('reads a single byte', () => {
    const heap = new Uint8Array(0x2000);
    heap[0x1057] = 0x2a; // gb 0xD057 → offset 0x1057
    expect(readValue(heap, 0, 'gb', { addr: 0xd057 })).toBe(0x2a);
  });

  it('reads 2-byte little-endian', () => {
    const heap = new Uint8Array(0x2000);
    heap[0x1057] = 0x34;
    heap[0x1058] = 0x12;
    expect(readValue(heap, 0, 'gb', { addr: 0xd057, size: 2, endian: 'little' })).toBe(0x1234);
  });

  it('reads 2-byte big-endian', () => {
    const heap = new Uint8Array(0x2000);
    heap[0x1057] = 0x12;
    heap[0x1058] = 0x34;
    expect(readValue(heap, 0, 'gb', { addr: 0xd057, size: 2, endian: 'big' })).toBe(0x1234);
  });

  it('decodes 3-byte big-endian BCD (Creature money)', () => {
    const heap = new Uint8Array(0x2000);
    // gb 0xD347 → offset 0x1347
    heap[0x1347] = 0x01;
    heap[0x1348] = 0x23;
    heap[0x1349] = 0x45;
    expect(
      readValue(heap, 0, 'gb', { addr: 0xd347, size: 3, endian: 'big', decode: 'bcd' }),
    ).toBe(12345);
  });

  it('respects wramBase offset', () => {
    const heap = new Uint8Array(0x4000);
    const wramBase = 0x2000;
    heap[wramBase + 0x1057] = 0x7f;
    expect(readValue(heap, wramBase, 'gb', { addr: 0xd057 })).toBe(0x7f);
  });

  it('uses toRamOffset (gb 0xD057 → index wramBase+0x1057)', () => {
    const heap = new Uint8Array(0x2000);
    heap[0x1057] = 0x99;
    // sanity: reading a different addr does not return this value
    heap[0x1058] = 0x01;
    expect(readValue(heap, 0, 'gb', { addr: 0xd057 })).toBe(0x99);
  });

  describe('Genesis (Genesis Plus GX stores 68k RAM as host-order words)', () => {
    // 68k bytes at $FFFE10.. = 01 02 03 04 are stored per word swapped: 02 01 04 03.
    const heap = new Uint8Array(0x10000);
    heap.set([0x02, 0x01, 0x04, 0x03], 0xfe10);

    it('reads a byte from the swapped position (lives at $FFFE12 sits at buf[$FE13])', () => {
      expect(readValue(heap, 0, 'genesis', { addr: 0xfffe10 })).toBe(0x01);
      expect(readValue(heap, 0, 'genesis', { addr: 0xfffe11 })).toBe(0x02);
      expect(readValue(heap, 0, 'genesis', { addr: 0xfffe12 })).toBe(0x03);
    });

    it('reads words and longs big-endian by default', () => {
      expect(readValue(heap, 0, 'genesis', { addr: 0xfffe10, size: 2 })).toBe(0x0102);
      expect(readValue(heap, 0, 'genesis', { addr: 0xfffe10, size: 4 })).toBe(0x01020304);
    });

    it('Game Boy reads are unchanged', () => {
      const gb = new Uint8Array(0x2000);
      gb.set([0x34, 0x12], 0x1057);
      expect(readValue(gb, 0, 'gb', { addr: 0xd057, size: 2 })).toBe(0x1234);
    });
  });
});
