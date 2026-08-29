import { describe, it, expect, vi } from 'vitest';
import { ConvertPendingPianoMidi } from '#apps/pianoaudio/ConvertPendingPianoMidi.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function fakeLibrary(pending) {
  return { listPendingRecordings: vi.fn(async () => pending) };
}

describe('ConvertPendingPianoMidi', () => {
  it('converts all pending with bounded concurrency (runs overlap, count correct)', async () => {
    const pending = Array.from({ length: 5 }, (_, i) => ({ recordingId: `${i}.mid` }));
    let inFlight = 0;
    let maxInFlight = 0;
    const converter = {
      convertRecording: vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      }),
    };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary(pending), converter, logger: silent, concurrency: 3 });

    const result = await uc.execute();

    expect(converter.convertRecording).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ count: 5, status: 'success' });
    expect(maxInFlight).toBeGreaterThan(1); // genuinely parallel
    expect(maxInFlight).toBeLessThanOrEqual(3); // but bounded by concurrency
  });

  it('converts every pending ref and counts successes', async () => {
    const pending = [
      { recordingId: 'a.mid' },
      { recordingId: 'b.mid' },
    ];
    const converter = { convertRecording: vi.fn(async () => {}) };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary(pending), converter, logger: silent });

    const result = await uc.execute();

    expect(converter.convertRecording).toHaveBeenCalledTimes(2);
    expect(converter.convertRecording).toHaveBeenNthCalledWith(1, { recordingId: 'a.mid' });
    expect(converter.convertRecording).toHaveBeenNthCalledWith(2, { recordingId: 'b.mid' });
    expect(result).toEqual({ count: 2, status: 'success' });
  });

  it('skips a per-file failure without aborting the run', async () => {
    const pending = [
      { recordingId: 'a.mid' },
      { recordingId: 'b.mid' },
      { recordingId: 'c.mid' },
    ];
    const converter = {
      convertRecording: vi.fn(async ({ recordingId }) => {
        if (recordingId === 'b.mid') throw new Error('fluidsynth exit 1');
      }),
    };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary(pending), converter, logger: silent });

    const result = await uc.execute();

    expect(converter.convertRecording).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ count: 2, status: 'success' });
  });

  it('returns success with count 0 when nothing is pending', async () => {
    const converter = { convertRecording: vi.fn() };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary([]), converter, logger: silent });

    expect(await uc.execute()).toEqual({ count: 0, status: 'success' });
    expect(converter.convertRecording).not.toHaveBeenCalled();
  });

  it('returns an error result when listing fails', async () => {
    const library = { listPendingRecordings: vi.fn(async () => { throw new Error('EACCES'); }) };
    const converter = { convertRecording: vi.fn() };
    const uc = new ConvertPendingPianoMidi({ library, converter, logger: silent });

    const result = await uc.execute();

    expect(result).toEqual({ count: 0, status: 'error', reason: 'EACCES' });
    expect(converter.convertRecording).not.toHaveBeenCalled();
  });

  it('skips a concurrent run while one is already in flight', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const pending = [{ recordingId: 'a.mid' }];
    const converter = { convertRecording: vi.fn(async () => { await gate; }) };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary(pending), converter, logger: silent });

    const first = uc.execute();               // starts, blocks inside convert()
    const second = await uc.execute();        // #running already true → immediate skip

    expect(second).toEqual({ count: 0, status: 'skipped', reason: 'already-running' });
    expect(converter.convertRecording).toHaveBeenCalledTimes(1); // second did not convert

    release();
    expect(await first).toEqual({ count: 1, status: 'success' });
  });
});
