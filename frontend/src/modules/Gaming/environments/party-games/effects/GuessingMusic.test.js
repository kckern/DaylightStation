import { describe, it, expect, vi, afterEach } from 'vitest';
import { GuessingMusic } from './GuessingMusic.js';
import { _publishMasterState, _resetForTests } from '@/lib/volume/ScreenVolumeContext.js';
class AudioDouble extends EventTarget {
  src = ''; paused = true; volume = 1;
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute(key) { if (key === 'src') this.src = ''; }
  load() {}
}
const flush = async () => { for (let n = 0; n < 6; n++) await Promise.resolve(); };
const tracks = { items: [{mediaUrl:'/first.mp3'}, {mediaUrl:'/second.mp3'}] };
const threeTracks = { items: [{mediaUrl:'/first.mp3'}, {mediaUrl:'/second.mp3'}, {mediaUrl:'/third.mp3'}] };
afterEach(_resetForTests);
describe('GuessingMusic lifecycle', () => {
  it('cleans up even when the error presenter throws', async () => {
    const audio = new AudioDouble();
    audio.play = () => { audio.paused = false; return Promise.reject(new Error('play failed')); };
    const service = new GuessingMusic({ audioFactory: () => audio, resolveQueue: async () => tracks });
    const onError = vi.fn(() => { throw new Error('presenter failed'); });
    service.start({ source: 'test:failure' }, { onError }); await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(audio.paused).toBe(true); expect(audio.src).toBe('');
    audio.dispatchEvent(new Event('ended')); await flush(); expect(audio.src).toBe('');
    const stoppedVolume = audio.volume;
    _publishMasterState(0.1, 0.1, false); expect(audio.volume).toBe(stoppedVolume);
    service.stop();
  });
  it('plays a configured queue, advances on ended, follows master volume and stops', async () => {
    const audio = new AudioDouble();
    const resolveQueue = vi.fn(async () => tracks);
    const service = new GuessingMusic({ audioFactory: () => audio, resolveQueue, random: () => 0 });
    const stop = service.start({ source:'test:music', volume:0.4 }); await flush();
    expect(resolveQueue).toHaveBeenCalledWith('test:music', expect.any(AbortSignal));
    expect(audio.src).toBe('/first.mp3'); expect(audio.paused).toBe(false);
    _publishMasterState(0.5, 0.5, false); expect(audio.volume).toBe(0.2);
    audio.dispatchEvent(new Event('ended')); await flush(); expect(audio.src).toBe('/second.mp3'); expect(audio.paused).toBe(false);
    stop(); expect(audio.paused).toBe(true); expect(audio.src).toBe('');
    audio.dispatchEvent(new Event('ended')); await flush(); expect(audio.src).toBe('');
  });
  it('never starts after stopped pending resolution or replaces a newer turn', async () => {
    let finish; const oldAudio = new AudioDouble(); const newAudio = new AudioDouble(); let n = 0;
    const service = new GuessingMusic({ audioFactory: () => ++n === 1 ? oldAudio : newAudio, resolveQueue: () => n === 1 ? new Promise(r => { finish = r; }) : Promise.resolve(tracks) });
    const oldStop = service.start({source:'test:old'}); await flush(); service.start({source:'test:new'}); await flush();
    finish(tracks); await flush(); oldStop();
    expect(oldAudio.paused).toBe(true); expect(oldAudio.src).toBe(''); expect(newAudio.paused).toBe(false);
    service.stop();
  });
  it('reports missing music and bounds failures instead of retrying forever', async () => {
    const onError = vi.fn(); const audio = new AudioDouble();
    const service = new GuessingMusic({ audioFactory: () => audio, resolveQueue: async () => tracks });
    service.start({source:'test:bad'}, {onError}); await flush();
    audio.dispatchEvent(new Event('error')); await flush(); audio.dispatchEvent(new Event('error')); await flush();
    expect(onError).toHaveBeenCalled(); expect(audio.paused).toBe(true);
    service.stop();
  });
  it('reports queue resolution failure without throwing into the game', async () => {
    const onError = vi.fn(); const service = new GuessingMusic({resolveQueue: async () => { throw new Error('offline'); }, audioFactory: () => new AudioDouble()});
    const stop = service.start({source:'test:offline'}, {onError}); await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message:'offline'})); stop();
  });

  it('uses every shuffled track before repeating across turn starts and page recreation', async () => {
    const values = new Map();
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const heard = [];
    for (let turn = 0; turn < 4; turn++) {
      const audio = new AudioDouble();
      const service = new GuessingMusic({
        audioFactory: () => audio,
        resolveQueue: async () => threeTracks,
        random: () => 0,
        storage,
      });
      service.start({source:'plex:535255', order:'shuffle', repeat:'after-cycle', memory:'session'}, {sessionId:'fhe-session'});
      await flush();
      heard.push(audio.src);
      service.stop();
    }
    expect(new Set(heard.slice(0, 3)).size).toBe(3);
    expect(heard[3]).not.toBe(heard[2]);
  });

  it('advances after-cycle shuffle when a turn key is provided', async () => {
    const audio = new AudioDouble();
    const service = new GuessingMusic({ audioFactory: () => audio, resolveQueue: async () => threeTracks, random: () => 0 });
    service.start({ source: 'test:music', order: 'shuffle', repeat: 'after-cycle' }, { sessionId: 'fhe', turnKey: '4' });
    await flush();
    const selected = audio.src;

    audio.dispatchEvent(new Event('ended'));
    await flush();

    expect(audio.src).not.toBe(selected);
    service.stop();
  });

  it('loops one selected track for the entire turn while rotating tracks between turns', async () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const first = new AudioDouble();
    const service = new GuessingMusic({ audioFactory: () => first, resolveQueue: async () => threeTracks, random: () => 0, storage });
    service.start({source:'plex:535255', order:'shuffle', repeat:'one', memory:'session'}, {sessionId:'fhe-session'});
    await flush();
    const selected = first.src;
    expect(first.loop).toBe(true);
    first.dispatchEvent(new Event('ended')); await flush();
    expect(first.src).toBe(selected);
    service.stop();

    const second = new AudioDouble();
    const nextTurn = new GuessingMusic({ audioFactory: () => second, resolveQueue: async () => threeTracks, random: () => 0, storage });
    nextTurn.start({source:'plex:535255', order:'shuffle', repeat:'one', memory:'session'}, {sessionId:'fhe-session'});
    await flush();
    expect(second.src).not.toBe(selected);
    nextTurn.stop();
  });

  it('resumes the same selected track for the same session turn', async () => {
    const values = new Map();
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const first = new AudioDouble();
    new GuessingMusic({ audioFactory: () => first, resolveQueue: async () => threeTracks, random: () => 0, storage })
      .start({ source: 'test:music', order: 'shuffle', repeat: 'one', memory: 'session' }, { sessionId: 'fhe', turnKey: '4' });
    await flush();
    const selected = first.src;

    const resumed = new AudioDouble();
    new GuessingMusic({ audioFactory: () => resumed, resolveQueue: async () => threeTracks, random: () => 0, storage })
      .start({ source: 'test:music', order: 'shuffle', repeat: 'one', memory: 'session' }, { sessionId: 'fhe', turnKey: '4' });
    await flush();
    expect(resumed.src).toBe(selected);

    const nextTurn = new AudioDouble();
    new GuessingMusic({ audioFactory: () => nextTurn, resolveQueue: async () => threeTracks, random: () => 0, storage })
      .start({ source: 'test:music', order: 'shuffle', repeat: 'one', memory: 'session' }, { sessionId: 'fhe', turnKey: '5' });
    await flush();
    expect(nextTurn.src).not.toBe(selected);
  });

  it('persists a repeat-one replacement after the selected track fails', async () => {
    const values = new Map();
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const first = new AudioDouble();
    const service = new GuessingMusic({ audioFactory: () => first, resolveQueue: async () => threeTracks, random: () => 0, storage });
    service.start({ source: 'test:music', order: 'shuffle', repeat: 'one', memory: 'session' }, { sessionId: 'fhe', turnKey: '4' });
    await flush();
    const failed = first.src;

    first.dispatchEvent(new Event('error'));
    await flush();
    const replacement = first.src;
    expect(replacement).not.toBe(failed);
    service.stop();

    const resumed = new AudioDouble();
    new GuessingMusic({ audioFactory: () => resumed, resolveQueue: async () => threeTracks, random: () => 0, storage })
      .start({ source: 'test:music', order: 'shuffle', repeat: 'one', memory: 'session' }, { sessionId: 'fhe', turnKey: '4' });
    await flush();
    expect(resumed.src).toBe(replacement);
  });
});
