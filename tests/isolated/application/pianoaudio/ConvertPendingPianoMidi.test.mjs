import { describe, it, expect, vi } from 'vitest';
import { ConvertPendingPianoMidi } from '#apps/pianoaudio/ConvertPendingPianoMidi.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function fakeLibrary(pending) {
  return { listPending: vi.fn(async () => pending) };
}

describe('ConvertPendingPianoMidi', () => {
  it('converts every pending ref and counts successes', async () => {
    const pending = [
      { midiPath: '/src/a.mid', mp3Path: '/dst/a.mp3' },
      { midiPath: '/src/b.mid', mp3Path: '/dst/b.mp3' },
    ];
    const converter = { convert: vi.fn(async () => {}) };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary(pending), converter, logger: silent });

    const result = await uc.execute();

    expect(converter.convert).toHaveBeenCalledTimes(2);
    expect(converter.convert).toHaveBeenNthCalledWith(1, '/src/a.mid', '/dst/a.mp3');
    expect(converter.convert).toHaveBeenNthCalledWith(2, '/src/b.mid', '/dst/b.mp3');
    expect(result).toEqual({ count: 2, status: 'success' });
  });

  it('skips a per-file failure without aborting the run', async () => {
    const pending = [
      { midiPath: '/src/a.mid', mp3Path: '/dst/a.mp3' },
      { midiPath: '/src/b.mid', mp3Path: '/dst/b.mp3' },
      { midiPath: '/src/c.mid', mp3Path: '/dst/c.mp3' },
    ];
    const converter = {
      convert: vi.fn(async (midiPath) => {
        if (midiPath === '/src/b.mid') throw new Error('fluidsynth exit 1');
      }),
    };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary(pending), converter, logger: silent });

    const result = await uc.execute();

    expect(converter.convert).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ count: 2, status: 'success' });
  });

  it('returns success with count 0 when nothing is pending', async () => {
    const converter = { convert: vi.fn() };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary([]), converter, logger: silent });

    expect(await uc.execute()).toEqual({ count: 0, status: 'success' });
    expect(converter.convert).not.toHaveBeenCalled();
  });

  it('returns an error result when listing fails', async () => {
    const library = { listPending: vi.fn(async () => { throw new Error('EACCES'); }) };
    const converter = { convert: vi.fn() };
    const uc = new ConvertPendingPianoMidi({ library, converter, logger: silent });

    const result = await uc.execute();

    expect(result).toEqual({ count: 0, status: 'error', reason: 'EACCES' });
    expect(converter.convert).not.toHaveBeenCalled();
  });
});
