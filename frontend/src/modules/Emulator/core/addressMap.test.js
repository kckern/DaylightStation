import { describe, it, expect } from 'vitest';
import { toRamOffset } from './addressMap.js';

describe('toRamOffset', () => {
  it('translates gb WRAM address to offset', () => {
    expect(toRamOffset('gb', 0xD057)).toBe(0x1057);
  });

  it('translates gbc WRAM base to 0', () => {
    expect(toRamOffset('gbc', 0xC000)).toBe(0);
  });

  it('translates gb end of WRAM', () => {
    expect(toRamOffset('gb', 0xDFFF)).toBe(0x1FFF);
  });

  it('throws on address out of range', () => {
    expect(() => toRamOffset('gb', 0x8000)).toThrow('address out of range');
    expect(() => toRamOffset('gb', 0xE000)).toThrow('address out of range');
  });

  it('throws on unknown system', () => {
    expect(() => toRamOffset('nes', 0xC000)).toThrow('unknown system');
  });
});
