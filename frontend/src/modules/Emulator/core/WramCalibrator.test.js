import { describe, it, expect, vi } from 'vitest';
import {
  createWramCalibrator,
  gameSharkCode,
  DEFAULT_SIGNATURE,
} from './WramCalibrator.js';

describe('gameSharkCode', () => {
  it('formats data + little-endian address, uppercased', () => {
    expect(gameSharkCode(0xe7, 0xc080)).toBe('01E780C0');
  });

  it('little-endians the address bytes (0xD057 -> 57D0)', () => {
    expect(gameSharkCode(0x00, 0xd057)).toBe('010057D0');
  });

  it('zero-pads single-hex-digit data and address bytes', () => {
    expect(gameSharkCode(0x05, 0xc001)).toBe('010501C0');
  });
});

describe('DEFAULT_SIGNATURE', () => {
  it('is a 32-byte varied pattern', () => {
    expect(DEFAULT_SIGNATURE).toHaveLength(32);
    // not a uniform run
    const unique = new Set(DEFAULT_SIGNATURE);
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe('createWramCalibrator.calibrate', () => {
  it('finds the WRAM base when the signature lands exactly once', async () => {
    const offset = 5000;
    const heap = new Uint8Array(0x10000);
    const sig = DEFAULT_SIGNATURE;
    const cal = createWramCalibrator({
      setCheat: vi.fn(),
      resetCheat: vi.fn(),
      getHeap: () => heap,
      waitFrames: async () => {
        heap.set(sig, offset);
      },
      scratchAddr: 0xc080,
      signature: sig,
    });

    const result = await cal.calibrate();
    expect(result).toEqual({
      wramBase: offset - (0xc080 - 0xc000),
      matchIndex: offset,
    });
  });

  it('returns null when the signature never lands', async () => {
    const heap = new Uint8Array(0x10000);
    const cal = createWramCalibrator({
      setCheat: vi.fn(),
      resetCheat: vi.fn(),
      getHeap: () => heap,
      waitFrames: async () => {},
      scratchAddr: 0xc080,
      signature: DEFAULT_SIGNATURE,
    });
    expect(await cal.calibrate()).toBeNull();
  });

  it('returns null when the signature appears twice (ambiguous)', async () => {
    const heap = new Uint8Array(0x10000);
    const sig = DEFAULT_SIGNATURE;
    const cal = createWramCalibrator({
      setCheat: vi.fn(),
      resetCheat: vi.fn(),
      getHeap: () => heap,
      waitFrames: async () => {
        heap.set(sig, 5000);
        heap.set(sig, 9000);
      },
      scratchAddr: 0xc080,
      signature: sig,
    });
    expect(await cal.calibrate()).toBeNull();
  });

  it('resets cheats exactly once and issues 32 uppercased setCheat calls', async () => {
    const heap = new Uint8Array(0x10000);
    const sig = DEFAULT_SIGNATURE;
    const setCheat = vi.fn();
    const resetCheat = vi.fn();
    const cal = createWramCalibrator({
      setCheat,
      resetCheat,
      getHeap: () => heap,
      waitFrames: async () => {
        heap.set(sig, 5000);
      },
      scratchAddr: 0xc080,
      signature: sig,
    });
    await cal.calibrate();
    expect(resetCheat).toHaveBeenCalledTimes(1);
    expect(setCheat).toHaveBeenCalledTimes(32);
    // first cheat: write sig[0] to 0xC080
    const firstCode = setCheat.mock.calls[0][2];
    expect(firstCode).toBe(firstCode.toUpperCase());
    expect(firstCode).toBe(gameSharkCode(sig[0], 0xc080));
    expect(setCheat.mock.calls[0][0]).toBe(0); // index
    expect(setCheat.mock.calls[0][1]).toBe(1); // enabled
  });

  it('passes a logger warn on ambiguous result when provided', async () => {
    const heap = new Uint8Array(0x10000);
    const sig = DEFAULT_SIGNATURE;
    const warn = vi.fn();
    const cal = createWramCalibrator({
      setCheat: vi.fn(),
      resetCheat: vi.fn(),
      getHeap: () => heap,
      waitFrames: async () => {
        heap.set(sig, 100);
        heap.set(sig, 200);
      },
      scratchAddr: 0xc080,
      signature: sig,
      logger: { warn },
    });
    expect(await cal.calibrate()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
