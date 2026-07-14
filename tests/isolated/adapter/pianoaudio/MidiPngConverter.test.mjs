import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MidiPngConverter } from '#adapters/pianoaudio/MidiPngConverter.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
let root, midiPath, pngPath;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pianoaudio-png-'));
  midiPath = path.join(root, 'src', 'jamcorder', '2026', '2026-07', '2026-07-09 07.22.03.mid');
  pngPath = path.join(root, 'dst', 'jamcorder', '2026', '2026-07', '2026-07-09 07.22.03.png');
  fs.mkdirSync(path.dirname(midiPath), { recursive: true });
  fs.writeFileSync(midiPath, 'MID'); // parseNotes is injected in tests, so content is irrelevant
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('MidiPngConverter.convert', () => {
  it('parses notes, derives the timestamp title, renders, and writes the PNG atomically', async () => {
    const renderPng = vi.fn(async () => Buffer.from('PNGBYTES'));
    const parseNotes = vi.fn(() => ({ notes: [{ pitch: 60, startSec: 0, durSec: 1, velocity: 90 }], durationSeconds: 1 }));
    const conv = new MidiPngConverter({ renderPng, parseNotes, logger: silent });

    await conv.convert(midiPath, pngPath);

    expect(parseNotes).toHaveBeenCalledTimes(1);
    // title derived from the path's embedded timestamp
    const [, , opts] = renderPng.mock.calls[0];
    expect(opts.title).toBe('Thu Jul 9, 2026 · 7:22 AM');
    // final PNG written, no leftover tmp
    expect(fs.existsSync(pngPath)).toBe(true);
    expect(fs.readFileSync(pngPath).toString()).toBe('PNGBYTES');
    expect(fs.existsSync(`${pngPath}.tmp`)).toBe(false);
  });

  it('skips (no render) when the PNG already exists', async () => {
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    fs.writeFileSync(pngPath, 'EXISTING');
    const renderPng = vi.fn();
    const conv = new MidiPngConverter({ renderPng, parseNotes: vi.fn(), logger: silent });

    await conv.convert(midiPath, pngPath);

    expect(renderPng).not.toHaveBeenCalled();
    expect(fs.readFileSync(pngPath).toString()).toBe('EXISTING');
  });

  it('throws if constructed without a renderer', () => {
    expect(() => new MidiPngConverter({ logger: silent })).toThrow();
  });
});
