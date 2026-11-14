import { describe, it, expect } from 'vitest';
import {
  catalogKey, catalogAddress, normalizePatches, addressFor, stepAddress, setAddressField, sameAddress, formatAddress, patchEntry,
} from './voicePatches.js';

const grand = { no: 1, name: 'Acoustic Grand', pc: 0, bank: 0 };
const dizi = { no: 136, name: 'Dizi', pc: 3, bank: 1 };

describe('voicePatches', () => {
  it('keys voices by catalog pc:bank, the same identity presets use', () => {
    expect(catalogKey(grand)).toBe('0:0');
    expect(catalogKey(dizi)).toBe('3:1');
    expect(catalogKey({ name: 'x' })).toBeNull();
  });

  it('gives the catalog address when nothing is patched', () => {
    expect(catalogAddress(dizi)).toEqual({ msb: 1, lsb: 0, pc: 3 });
    expect(addressFor(grand, {})).toEqual({ msb: 0, lsb: 0, pc: 0, patched: false });
  });

  it('sends the saved patch instead of the catalog address', () => {
    const patches = normalizePatches({ '0:0': { msb: 0, lsb: 3, pc: 0, name: 'Acoustic Grand' } });
    expect(addressFor(grand, patches)).toEqual({ msb: 0, lsb: 3, pc: 0, patched: true });
    expect(addressFor(dizi, patches).patched).toBe(false);
  });

  it('drops malformed rows instead of sending a guessed program', () => {
    expect(normalizePatches({
      '0:0': { msb: 0, lsb: 0, pc: 200 },
      piano: { msb: 0, lsb: 0, pc: 1 },
      '1:0': null,
      '2:0': { pc: 5 },
    })).toEqual({ '2:0': { msb: 0, lsb: 0, pc: 5 } });
    expect(normalizePatches(null)).toEqual({});
  });

  it('steps a field with wraparound and leaves the others alone', () => {
    const a = { msb: 0, lsb: 0, pc: 0 };
    expect(stepAddress(a, 'pc', -1)).toEqual({ msb: 0, lsb: 0, pc: 127 });
    expect(stepAddress({ ...a, lsb: 127 }, 'lsb', 1)).toEqual({ msb: 0, lsb: 0, pc: 0 });
    expect(stepAddress(a, 'pc', 10).pc).toBe(10);
    expect(stepAddress(a, 'nope', 1)).toBe(a);
  });

  it('refuses typed values outside 0–127', () => {
    const a = { msb: 0, lsb: 0, pc: 0 };
    expect(setAddressField(a, 'pc', '42')).toEqual({ msb: 0, lsb: 0, pc: 42 });
    expect(setAddressField(a, 'pc', 128)).toBe(a);
    expect(setAddressField(a, 'msb', 'x')).toBe(a);
  });

  it('compares, formats and serializes', () => {
    expect(sameAddress({ msb: 0, lsb: 1, pc: 2 }, { msb: 0, lsb: 1, pc: 2, patched: true })).toBe(true);
    expect(formatAddress({ msb: 0, lsb: 3, pc: 0 })).toBe('Bank 0/3 · Prog 0');
    expect(patchEntry({ msb: 0, lsb: 3, pc: 0, patched: true }, grand)).toEqual({ msb: 0, lsb: 3, pc: 0, name: 'Acoustic Grand' });
  });
});
