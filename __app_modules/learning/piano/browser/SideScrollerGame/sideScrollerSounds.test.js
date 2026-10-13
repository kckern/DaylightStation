import { describe, it, expect, vi } from 'vitest';
import { createSfxPlayer, resolveSoundSrc } from './sideScrollerSounds.js';

// A fake audio element + factory so we never touch real DOM audio.
function fakeAudioFactory() {
  const created = [];
  const factory = (src) => {
    const el = {
      src,
      preload: '',
      currentTime: 0,
      play: vi.fn(() => Promise.resolve()),
      cloneNode: function () { return this; },
    };
    created.push(el);
    return el;
  };
  factory.created = created;
  return factory;
}

describe('createSfxPlayer', () => {
  it('preloads only non-null sound paths', () => {
    const createAudio = fakeAudioFactory();
    createSfxPlayer({ jump: '/jump.wav', hit: null, duck: '/duck.wav' }, { createAudio });
    expect(createAudio.created.map((e) => e.src)).toEqual(['/jump.wav', '/duck.wav']);
  });

  it('plays a configured sound and reports success', () => {
    const createAudio = fakeAudioFactory();
    const sfx = createSfxPlayer({ hit: '/hit.wav' }, { createAudio });
    expect(sfx.play('hit')).toBe(true);
    expect(createAudio.created[0].play).toHaveBeenCalledTimes(1);
  });

  it('is a silent no-op for a null path', () => {
    const createAudio = fakeAudioFactory();
    const sfx = createSfxPlayer({ jump: null }, { createAudio });
    expect(sfx.play('jump')).toBe(false);
    expect(createAudio.created).toHaveLength(0);
  });

  it('is a no-op for an unknown name', () => {
    const createAudio = fakeAudioFactory();
    const sfx = createSfxPlayer({ jump: '/jump.wav' }, { createAudio });
    expect(sfx.play('explode')).toBe(false);
  });

  it('swallows play() rejection (autoplay blocked) without throwing', async () => {
    const createAudio = (src) => ({
      src,
      currentTime: 0,
      play: vi.fn(() => Promise.reject(new Error('NotAllowedError'))),
      cloneNode: function () { return this; },
    });
    const sfx = createSfxPlayer({ jump: '/jump.wav' }, { createAudio });
    expect(() => sfx.play('jump')).not.toThrow();
    expect(sfx.play('jump')).toBe(true);
  });
});

describe('resolveSoundSrc', () => {
  it('routes a /media path through the media proxy, like every other piano sfx', () => {
    expect(resolveSoundSrc('/media/audio/sfx/side-scroller/shoot.mp3'))
      .toMatch(/\/api\/v1\/proxy\/media\/audio\/sfx\/side-scroller\/shoot\.mp3$/);
  });

  it('leaves an /api route or any other path exactly as configured', () => {
    expect(resolveSoundSrc('/api/v1/static/sfx/jump.wav')).toBe('/api/v1/static/sfx/jump.wav');
    expect(resolveSoundSrc('/jump.wav')).toBe('/jump.wav');
  });

  it('is what the player preloads', () => {
    const created = [];
    createSfxPlayer({ death: '/media/audio/sfx/side-scroller/death.mp3' }, {
      createAudio: (src) => { created.push(src); return { src, currentTime: 0, play: vi.fn(() => Promise.resolve()) }; },
    });
    expect(created[0]).toMatch(/\/api\/v1\/proxy\/media\/audio\/sfx\/side-scroller\/death\.mp3$/);
  });
});
