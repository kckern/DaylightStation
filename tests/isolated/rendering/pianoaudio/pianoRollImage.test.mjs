import { describe, it, expect } from 'vitest';
import { renderPianoRollPng } from '#rendering/pianoaudio/pianoRollImage.mjs';
import { computePianoRollLayout } from '#domains/pianoaudio/pianoRollLayout.mjs';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDims(buf) {
  // IHDR width/height are the two big-endian uint32s at bytes 16 and 20.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('renderPianoRollPng', () => {
  it('produces a valid PNG whose dimensions match the computed layout', async () => {
    const notes = [
      { pitch: 60, startSec: 0, durSec: 0.5, velocity: 90 },
      { pitch: 64, startSec: 0.5, durSec: 1.0, velocity: 60 },
      { pitch: 67, startSec: 1.0, durSec: 0.5, velocity: 120 },
    ];
    const buf = await renderPianoRollPng(notes, 1.5);
    expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);

    const layout = computePianoRollLayout(notes, 1.5);
    expect(pngDims(buf)).toEqual({ width: layout.width, height: layout.height });
  });

  it('adds header height when a title is given', async () => {
    const notes = [{ pitch: 60, startSec: 0, durSec: 0.5, velocity: 90 }];
    const plain = await renderPianoRollPng(notes, 1);
    const titled = await renderPianoRollPng(notes, 1, { title: 'Thu Jul 9, 2026 · 7:22 AM' });
    expect(pngDims(titled).width).toBe(pngDims(plain).width);
    expect(pngDims(titled).height).toBeGreaterThan(pngDims(plain).height); // header strip added
    expect(titled.subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });

  it('renders an empty note list to a valid non-empty PNG (no throw)', async () => {
    const buf = await renderPianoRollPng([], 5);
    expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
  });

  it('renders a large dense session within the size cap', async () => {
    const notes = [];
    for (let i = 0; i < 5000; i++) notes.push({ pitch: 40 + (i % 48), startSec: (i / 5000) * 7000, durSec: 0.3, velocity: 80 });
    const buf = await renderPianoRollPng(notes, 7000, { maxSide: 4000 });
    expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    const { width, height } = pngDims(buf);
    expect(width).toBeLessThanOrEqual(4000);
    expect(height).toBeLessThanOrEqual(4000);
  });
});
