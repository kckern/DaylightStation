import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../lib/volume/bindMediaToMaster.js', () => ({ bindMediaToMaster: vi.fn(() => () => {}) }));
const audioPlayed = vi.fn();
vi.mock('./wordLadderLog.js', () => ({ wordLadderLog: { audioPlayed } }));

const made = [];
class FakeAudio {
  constructor(url) { this.url = url; this.pause = vi.fn(); made.push(this); }
  play() { return Promise.resolve(); }
}

describe('wordLadderAudio — one lane', () => {
  let mod;
  beforeEach(async () => {
    made.length = 0;
    audioPlayed.mockClear();
    vi.stubGlobal('Audio', FakeAudio);
    mod = await import('./wordLadderAudio.js');
    mod.stopAudio();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('starting a second clip stops the first — a clip cut off early resolves null and logs nothing', async () => {
    const first = mod.startClip('a');
    mod.startClip('b');
    expect(made[0].pause).toHaveBeenCalled();
    expect(first.stopped).toBe(true);
    await expect(first.done).resolves.toBe(null);
    expect(made[1].pause).not.toHaveBeenCalled();
    expect(audioPlayed).not.toHaveBeenCalled();
  });

  it('a finished clip resolves "ended", logs audio.played once, and leaves the lane empty', async () => {
    const clip = mod.startClip('a', 'term');
    made[0].onended();
    await expect(clip.done).resolves.toBe('ended');
    expect(audioPlayed).toHaveBeenCalledWith({ kind: 'term', outcome: 'ended' });
    mod.stopAudio();
    expect(made[0].pause).not.toHaveBeenCalled();
  });

  it('an error resolves "error" and logs it', async () => {
    const clip = mod.startClip('a', 'gloss');
    made[0].onerror();
    await expect(clip.done).resolves.toBe('error');
    expect(audioPlayed).toHaveBeenCalledWith({ kind: 'gloss', outcome: 'error' });
  });

  it('a play() rejection (autoplay blocked) resolves "blocked" and logs it', async () => {
    class BlockedAudio extends FakeAudio {
      play() { return Promise.reject(new Error('NotAllowedError')); }
    }
    vi.stubGlobal('Audio', BlockedAudio);
    const blockedMod = await import('./wordLadderAudio.js');
    const clip = blockedMod.startClip('a', 'term');
    await expect(clip.done).resolves.toBe('blocked');
    expect(audioPlayed).toHaveBeenCalledWith({ kind: 'term', outcome: 'blocked' });
  });

  it('stopAudio stops the clip that is playing', () => {
    mod.startClip('a');
    mod.stopAudio();
    expect(made[0].pause).toHaveBeenCalled();
  });

  it('playClip resolves the same outcome string as startClip', async () => {
    const p = mod.playClip('a', 'take');
    made[0].onended();
    await expect(p).resolves.toBe('ended');
    expect(audioPlayed).toHaveBeenCalledWith({ kind: 'take', outcome: 'ended' });
  });

  it('a sequence interrupted by a newer clip does not go on to its next url', async () => {
    const seq = mod.playSequence(['take', 'native']);
    mod.startClip('other');
    await seq;
    expect(made.map((a) => a.url)).toEqual(['take', 'other']);
  });

  it('a sequence entry may carry its own kind alongside the plain-string form', async () => {
    const seq = mod.playSequence([{ url: 'take', kind: 'take' }, { url: 'native', kind: 'native' }]);
    made[0].onended();
    await Promise.resolve(); // let the loop advance to the second entry
    made[1].onended();
    await seq;
    expect(audioPlayed).toHaveBeenCalledWith({ kind: 'take', outcome: 'ended' });
    expect(audioPlayed).toHaveBeenCalledWith({ kind: 'native', outcome: 'ended' });
  });
});
