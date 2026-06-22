import { describe, it, expect, vi } from 'vitest';
import { createHtmlAudioClip } from './htmlAudioClip.js';

/**
 * Fake HTMLAudioElement: records constructor url, the loop/volume props,
 * play/pause calls, currentTime resets, and 'ended' listeners.
 */
function makeFakeAudioCtor() {
  const instances = [];
  function FakeAudio(url) {
    const listeners = {};
    const inst = {
      url,
      loop: false,
      volume: 1,
      currentTime: 0,
      paused: true,
      play: vi.fn(function () {
        inst.paused = false;
      }),
      pause: vi.fn(function () {
        inst.paused = true;
      }),
      addEventListener: vi.fn(function (event, cb) {
        (listeners[event] ||= []).push(cb);
      }),
      _fire(event) {
        (listeners[event] || []).forEach((cb) => cb());
      },
    };
    instances.push(inst);
    return inst;
  }
  FakeAudio.instances = instances;
  return FakeAudio;
}

describe('createHtmlAudioClip', () => {
  it('constructs the element with the url and default loop=false', () => {
    const AudioCtor = makeFakeAudioCtor();
    createHtmlAudioClip('song.mp3', {}, { AudioCtor });
    expect(AudioCtor.instances).toHaveLength(1);
    const el = AudioCtor.instances[0];
    expect(el.url).toBe('song.mp3');
    expect(el.loop).toBe(false);
  });

  it('sets loop when requested', () => {
    const AudioCtor = makeFakeAudioCtor();
    createHtmlAudioClip('song.mp3', { loop: true }, { AudioCtor });
    expect(AudioCtor.instances[0].loop).toBe(true);
  });

  it('play() delegates to the element', () => {
    const AudioCtor = makeFakeAudioCtor();
    const clip = createHtmlAudioClip('s.mp3', {}, { AudioCtor });
    clip.play();
    expect(AudioCtor.instances[0].play).toHaveBeenCalledTimes(1);
  });

  it('stop() pauses and resets currentTime', () => {
    const AudioCtor = makeFakeAudioCtor();
    const clip = createHtmlAudioClip('s.mp3', {}, { AudioCtor });
    const el = AudioCtor.instances[0];
    el.currentTime = 12;
    clip.stop();
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(el.currentTime).toBe(0);
  });

  it('setVolume() delegates and clamps to 0..1', () => {
    const AudioCtor = makeFakeAudioCtor();
    const clip = createHtmlAudioClip('s.mp3', {}, { AudioCtor });
    const el = AudioCtor.instances[0];
    clip.setVolume(0.5);
    expect(el.volume).toBe(0.5);
    clip.setVolume(2);
    expect(el.volume).toBe(1);
    clip.setVolume(-3);
    expect(el.volume).toBe(0);
  });

  it('onEnded() registers an ended listener that fires', () => {
    const AudioCtor = makeFakeAudioCtor();
    const clip = createHtmlAudioClip('s.mp3', {}, { AudioCtor });
    const el = AudioCtor.instances[0];
    const cb = vi.fn();
    clip.onEnded(cb);
    expect(el.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    el._fire('ended');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is a no-op-safe clip when no AudioCtor is available', () => {
    const clip = createHtmlAudioClip('s.mp3', {}, { AudioCtor: null });
    // Should not throw on any method.
    expect(() => {
      clip.play();
      clip.stop();
      clip.setVolume(0.5);
      clip.onEnded(() => {});
    }).not.toThrow();
  });
});
