import { describe, it, expect } from 'vitest';
import { toRamOffset } from "./addressMap.js";

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

import { resolveAddress } from "./addressMap.js";

describe('resolveAddress', () => {
  it('classifies Game Boy WRAM, save RAM and HRAM', () => {
    expect(resolveAddress('gb', 0xD057)).toEqual({ name: 'ram', offset: 0x1057, mapped: false });
    expect(resolveAddress('gb', 0xA216)).toEqual({ name: 'sram', offset: 0x216, mapped: false });
    expect(resolveAddress('gbc', 0xFFF9)).toEqual({ name: 'hram', offset: 0x79, mapped: true });
  });
  it('classifies GBA EWRAM and IWRAM', () => {
    expect(resolveAddress('gba', 0x02000010)).toEqual({ name: 'ram', offset: 0x10, mapped: false });
    expect(resolveAddress('gba', 0x03003D10)).toEqual({ name: 'iwram', offset: 0x3D10, mapped: true });
  });
  it('keeps toRamOffset to the system RAM buffer only', () => {
    expect(() => toRamOffset('gb', 0xA000)).toThrow('address out of range');
  });
});
