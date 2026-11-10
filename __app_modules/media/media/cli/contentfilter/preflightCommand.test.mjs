import { describe, it, expect } from 'vitest';
import { preflight } from './preflightCommand.mjs';

const ok = { status: 0 }; const bad = { status: 1 };
const runner = (failing) => (bin, args) => {
  const s = [bin, ...args].join(' ');
  return failing.some((f) => s.includes(f)) ? bad : ok;
};
const env = { CONTENT_FILTER_TRANSCRIBE_PY: 'python3', CONTENT_FILTER_ALIGN_PY: 'python3' };

describe('preflight', () => {
  it('passes when everything is there', async () => {
    expect(await preflight({ rk: '1', env, run: runner([]), partOf: async () => '/part' })).toBeNull();
  });
  it.each([
    ['faster_whisper', 'Refine cannot run here: faster-whisper is not installed'],
    ['torch', 'Refine cannot run here: torch and torchaudio are not installed'],
  ])('names a missing %s', async (miss, msg) => {
    expect(await preflight({ rk: '1', env, run: runner([miss]), partOf: async () => '/p' })).toBe(msg);
  });
  it('names missing ImageMagick', async () => {
    expect(await preflight({ rk: '1', env, run: runner(['magick', 'convert']), partOf: async () => '/p' })).toBe('Refine cannot run here: ImageMagick is not installed');
  });
  it('reports the Plex error', async () => {
    expect(await preflight({ rk: '1', env, run: runner([]), partOf: async () => { throw new Error('ECONNREFUSED'); } }))
      .toBe('Plex could not be reached for 1: ECONNREFUSED');
  });
});
