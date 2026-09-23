import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../lib/volume/bindMediaToMaster.js', () => ({ bindMediaToMaster: vi.fn(() => () => {}) }));
vi.mock('./wordLadderLog.js', () => ({ wordLadderLog: { audioBlocked: vi.fn() } }));

const made = [];
class FakeAudio {
  constructor(url) { this.url = url; this.pause = vi.fn(); made.push(this); }
  play() { return Promise.resolve(); }
}

describe('wordLadderAudio — one lane', () => {
  let mod;
  beforeEach(async () => {
    made.length = 0;
    vi.stubGlobal('Audio', FakeAudio);
    mod = await import('./wordLadderAudio.js');
    mod.stopAudio();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('starting a second clip stops the first', async () => {
    const first = mod.startClip('a');
    mod.startClip('b');
    expect(made[0].pause).toHaveBeenCalled();
    expect(first.stopped).toBe(true);
    await expect(first.done).resolves.toBe(false);
    expect(made[1].pause).not.toHaveBeenCalled();
  });

  it('a finished clip leaves the lane empty (stopAudio does not touch it)', async () => {
    const clip = mod.startClip('a');
    made[0].onended();
    await expect(clip.done).resolves.toBe(true);
    mod.stopAudio();
    expect(made[0].pause).not.toHaveBeenCalled();
  });

  it('stopAudio stops the clip that is playing', () => {
    mod.startClip('a');
    mod.stopAudio();
    expect(made[0].pause).toHaveBeenCalled();
  });

  it('a sequence interrupted by a newer clip does not go on to its next url', async () => {
    const seq = mod.playSequence(['take', 'native']);
    mod.startClip('other');
    await seq;
    expect(made.map((a) => a.url)).toEqual(['take', 'other']);
  });
});
