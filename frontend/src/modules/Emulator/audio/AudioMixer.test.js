import { describe, it, expect, vi } from 'vitest';
import { createAudioMixer } from './AudioMixer.js';

/**
 * Build a fake clip handle that records calls and lets a test fire onEnded.
 */
function makeClip(url, opts) {
  let endedCb = null;
  return {
    url,
    opts,
    play: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    onEnded: vi.fn((cb) => {
      endedCb = cb;
    }),
    fireEnded() {
      if (endedCb) endedCb();
    },
  };
}

/**
 * Build a createClip factory spy that returns (and records) fake clips.
 */
function makeClipFactory() {
  const clips = [];
  const createClip = vi.fn((url, opts) => {
    const clip = makeClip(url, opts);
    clips.push(clip);
    return clip;
  });
  return { createClip, clips };
}

function setup(overrides = {}) {
  const setGameVolume = overrides.setGameVolume || vi.fn();
  const { createClip, clips } = overrides.clipFactory || makeClipFactory();
  const logger = overrides.logger || { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() };
  const mixer = createAudioMixer({
    setGameVolume,
    createClip,
    duck: overrides.duck,
    logger,
  });
  return { mixer, setGameVolume, createClip, clips, logger };
}

describe('createAudioMixer', () => {
  describe('construction', () => {
    it('calls setGameVolume(1) once on creation', () => {
      const { setGameVolume } = setup();
      expect(setGameVolume).toHaveBeenCalledTimes(1);
      expect(setGameVolume).toHaveBeenLastCalledWith(1);
    });
  });

  describe('master + bus volume', () => {
    it('setMasterVolume(0.5) re-applies game volume to 0.5', () => {
      const { mixer, setGameVolume } = setup();
      mixer.setMasterVolume(0.5);
      expect(setGameVolume).toHaveBeenLastCalledWith(0.5);
    });

    it('setBusVolume(game,0.4) with master 0.5 => game 0.2', () => {
      const { mixer, setGameVolume } = setup();
      mixer.setMasterVolume(0.5);
      mixer.setBusVolume('game', 0.4);
      expect(setGameVolume).toHaveBeenLastCalledWith(0.2);
      expect(mixer.getEffective('game')).toBeCloseTo(0.2);
    });

    it('clamps effective volume to 0..1', () => {
      const { mixer } = setup();
      mixer.setMasterVolume(5);
      expect(mixer.getEffective('game')).toBe(1);
      mixer.setMasterVolume(-2);
      expect(mixer.getEffective('game')).toBe(0);
    });
  });

  describe('mute', () => {
    it('muteBus(game) => setGameVolume(0); unmute restores', () => {
      const { mixer, setGameVolume } = setup();
      mixer.muteBus('game');
      expect(setGameVolume).toHaveBeenLastCalledWith(0);
      mixer.muteBus('game', false);
      expect(setGameVolume).toHaveBeenLastCalledWith(1);
    });
  });

  describe('music', () => {
    it('playMusic creates+plays a clip at effective(music)', () => {
      const { mixer, createClip, clips } = setup();
      mixer.setBusVolume('music', 0.6);
      const handle = mixer.playMusic('song.mp3');
      expect(createClip).toHaveBeenCalledWith('song.mp3', { loop: true });
      expect(handle).toBe(clips[0]);
      expect(clips[0].setVolume).toHaveBeenLastCalledWith(0.6);
      expect(clips[0].play).toHaveBeenCalledTimes(1);
    });

    it('passes loop:false through when requested', () => {
      const { mixer, createClip } = setup();
      mixer.playMusic('song.mp3', { loop: false });
      expect(createClip).toHaveBeenCalledWith('song.mp3', { loop: false });
    });

    it('a second playMusic stops the first', () => {
      const { mixer, clips } = setup();
      mixer.playMusic('a.mp3');
      mixer.playMusic('b.mp3');
      expect(clips[0].stop).toHaveBeenCalledTimes(1);
      expect(clips[1].play).toHaveBeenCalledTimes(1);
    });

    it('setBusVolume(music) updates the live music clip volume', () => {
      const { mixer, clips } = setup();
      mixer.playMusic('a.mp3');
      mixer.setBusVolume('music', 0.3);
      expect(clips[0].setVolume).toHaveBeenLastCalledWith(0.3);
    });

    it('stopMusic stops and clears the current clip', () => {
      const { mixer, clips } = setup();
      mixer.playMusic('a.mp3');
      mixer.stopMusic();
      expect(clips[0].stop).toHaveBeenCalledTimes(1);
      // After clearing, a music volume change should not touch the stopped clip again.
      clips[0].setVolume.mockClear();
      mixer.setBusVolume('music', 0.2);
      expect(clips[0].setVolume).not.toHaveBeenCalled();
    });
  });

  describe('cues + ducking', () => {
    it('playCue plays on the cues bus and ducks game+music', () => {
      const { mixer, setGameVolume, clips } = setup();
      mixer.playMusic('song.mp3'); // music clip = clips[0]
      const cue = mixer.playCue('chime.mp3'); // cues clip = clips[1]

      // cue plays at effective(cues) = 1
      expect(cue).toBe(clips[1]);
      expect(clips[1].setVolume).toHaveBeenLastCalledWith(1);
      expect(clips[1].play).toHaveBeenCalledTimes(1);
      expect(clips[1].opts).toEqual({ loop: false });

      // game ducked to master*gameVol*factor = 1*1*0.2
      expect(setGameVolume).toHaveBeenLastCalledWith(0.2);
      // music clip ducked to effective(music)*factor = 0.2
      expect(clips[0].setVolume).toHaveBeenLastCalledWith(0.2);
    });

    it('firing onEnded restores ducked buses', () => {
      const { mixer, setGameVolume, clips } = setup();
      mixer.playMusic('song.mp3');
      mixer.playCue('chime.mp3');
      clips[1].fireEnded();
      expect(setGameVolume).toHaveBeenLastCalledWith(1);
      expect(clips[0].setVolume).toHaveBeenLastCalledWith(1);
    });

    it('overlapping cues: restore only when the LAST cue ends', () => {
      const { mixer, setGameVolume, clips } = setup();
      mixer.playMusic('song.mp3');
      mixer.playCue('a.mp3'); // clips[1]
      mixer.playCue('b.mp3'); // clips[2]
      expect(setGameVolume).toHaveBeenLastCalledWith(0.2);

      clips[1].fireEnded(); // one cue ends — still ducked
      expect(setGameVolume).toHaveBeenLastCalledWith(0.2);

      clips[2].fireEnded(); // last cue ends — restored
      expect(setGameVolume).toHaveBeenLastCalledWith(1);
    });

    it('muting the cues bus then playCue plays at 0 and does NOT duck', () => {
      const { mixer, setGameVolume, clips } = setup();
      mixer.muteBus('cues');
      const gameCallsBefore = setGameVolume.mock.calls.length;
      const cue = mixer.playCue('chime.mp3');
      expect(cue.setVolume).toHaveBeenLastCalledWith(0);
      expect(cue.play).toHaveBeenCalledTimes(1);
      // No additional game-volume re-apply (no ducking).
      expect(setGameVolume.mock.calls.length).toBe(gameCallsBefore);
      expect(mixer.getEffective('game')).toBe(1);
      // No onEnded registered for ducking.
      expect(cue.onEnded).not.toHaveBeenCalled();
    });

    it('honors a custom duck config (factor + buses)', () => {
      const { mixer, setGameVolume, clips } = setup({
        duck: { factor: 0.5, buses: ['game'] },
      });
      mixer.playMusic('song.mp3');
      mixer.playCue('chime.mp3');
      // game ducked to 0.5
      expect(setGameVolume).toHaveBeenLastCalledWith(0.5);
      // music NOT in duck buses -> stays at 1
      expect(clips[0].setVolume).toHaveBeenLastCalledWith(1);
    });
  });

  describe('validation', () => {
    it('warns on unknown bus name and does not throw', () => {
      const { mixer, logger } = setup();
      expect(() => mixer.setBusVolume('bogus', 0.5)).not.toThrow();
      expect(() => mixer.muteBus('nope')).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
