import { describe, it, expect } from 'vitest';
import { readValue } from './memoryRead.js';

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

  it('decodes 3-byte big-endian BCD (Pokémon money)', () => {
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
});
