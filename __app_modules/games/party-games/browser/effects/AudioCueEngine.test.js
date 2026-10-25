import { describe, it, expect, vi } from 'vitest';
import { AudioCueEngine } from "./AudioCueEngine.js";

function makeFake() {
  const instances = [];
  const factory = (src) => {
    const a = {
      src, volume: 1, loop: false, paused: false,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(function () { this.paused = true; }),
    };
    instances.push(a);
    return a;
  };
  return { factory, instances };
}

describe('AudioCueEngine', () => {
  it('plays a cue from the pack path on the sfx channel', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ pack: 'classic', audioFactory: factory });
    engine.play('correct');
    expect(instances[0].src).toBe('/api/v1/gaming/media/classic/correct.mp3');
    expect(instances[0].play).toHaveBeenCalled();
  });

  it('allows a definition to select a cue pack per playback', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ pack: 'classic', audioFactory: factory });
    engine.play('time-up', { pack: 'charades' });
    expect(instances[0].src).toBe('/api/v1/gaming/media/charades/time-up.mp3');
  });

  it('applies and bounds definition-driven cue volume', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ audioFactory: factory });
    engine.play('ready', { volume: 0.4 });
    engine.play('loud', { volume: 5 });
    expect(instances[0].volume).toBe(0.4);
    expect(instances[1].volume).toBe(1);
  });

  it('mute suppresses playback; unmute restores', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ pack: 'classic', mute: true, audioFactory: factory });
    engine.play('correct');
    expect(instances).toHaveLength(0);
    engine.setMute(false);
    engine.play('correct');
    expect(instances).toHaveLength(1);
  });

  it('stopChannel pauses everything on that channel only', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ pack: 'classic', audioFactory: factory });
    engine.play('think', { channel: 'music', loop: true });
    engine.play('correct'); // sfx
    engine.stopChannel('music');
    expect(instances[0].pause).toHaveBeenCalled();
    expect(instances[1].pause).not.toHaveBeenCalled();
  });

  it('clue-media channel auto-ducks music and unducks when stopped', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ pack: 'classic', audioFactory: factory });
    engine.play('think', { channel: 'music', loop: true });
    engine.play('clip', { channel: 'clue-media' });
    expect(instances[0].volume).toBeCloseTo(0.15);
    engine.stopChannel('clue-media');
    expect(instances[0].volume).toBe(1);
  });

  it('playback errors never throw', () => {
    const engine = new AudioCueEngine({
      pack: 'classic',
      audioFactory: () => { throw new Error('no audio device'); },
    });
    expect(() => engine.play('correct')).not.toThrow();
  });
});

it('releases failed and completed cues while retaining contextual failure attribution', async () => {
  const listeners = {}; const failed = new Error('autoplay denied');
  const engine = new AudioCueEngine({ audioFactory: () => ({ play: () => Promise.reject(failed), addEventListener: (type, fn) => { listeners[type] = fn; } }) });
  engine.log = { info: vi.fn(), warn: vi.fn() };
  engine.play('buzz', { context: { sessionId: 'safe', revision: 3 } });
  await Promise.resolve(); await Promise.resolve();
  expect(engine.channels.sfx).toHaveLength(0);
  expect(engine.log.warn).toHaveBeenCalledWith('jeopardy.cue-result', expect.objectContaining({ cue: 'buzz', channel: 'sfx', sessionId: 'safe', revision: 3, result: 'failed' }));
});
