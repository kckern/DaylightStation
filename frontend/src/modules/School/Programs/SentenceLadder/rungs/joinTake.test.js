import { describe, it, expect, vi } from 'vitest';
import { concatWithGaps, encodeWav, joinTake, JOIN_RATE } from './joinTake.js';

describe('concatWithGaps', () => {
  it('puts a silence between pieces and none at the ends', () => {
    const out = concatWithGaps([Float32Array.of(1, 1), Float32Array.of(2)], 1000, 3);
    expect(Array.from(out)).toEqual([1, 1, 0, 0, 0, 2]);
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header and clamps the samples', () => {
    const buf = encodeWav(Float32Array.of(0, 1, -1, 2), 16000);
    const v = new DataView(buf);
    const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1);        // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);       // bits
    expect(v.getUint32(40, true)).toBe(8);        // 4 samples × 2 bytes
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getInt16(50, true)).toBe(32767);     // 2 clamped to 1
  });
});

describe('joinTake', () => {
  it('decodes each piece and returns one audio/wav blob', async () => {
    const decode = vi.fn(async () => new Float32Array(JOIN_RATE / 10)); // 100ms each
    const blob = await joinTake([new Blob(['a']), new Blob(['b'])], { decode });
    expect(decode).toHaveBeenCalledTimes(2);
    expect(blob.type).toBe('audio/wav');
    // 2 × 100ms + one 250ms gap at 16kHz, 2 bytes a sample, 44-byte header
    expect(blob.size).toBe(44 + 2 * (1600 * 2 + 4000));
  });

  it('fails loudly when a piece will not decode, so the rung can fall back', async () => {
    const decode = vi.fn().mockRejectedValueOnce(new Error('bad piece'));
    await expect(joinTake([new Blob(['a'])], { decode })).rejects.toThrow('bad piece');
  });
});
