import { describe, it, expect, vi } from 'vitest';
import { AudioCueEngine } from './AudioCueEngine.js';

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
    expect(instances[0].src).toBe('/api/v1/gameshow/media/gameshow/classic/correct.mp3');
    expect(instances[0].play).toHaveBeenCalled();
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
