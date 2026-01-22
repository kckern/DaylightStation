/**
 * Voice Memo Media Pause Unit Tests
 *
 * TDD Phase: RED - These tests define the expected behavior.
 * Implementation must make them pass.
 *
 * Run with: npm run test:unit -- --testPathPattern=voice-memo
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  resolvePlaybackState,
  pauseMediaIfNeeded,
  resumeMediaIfNeeded
} from '@frontend/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js';

describe('Voice Memo Media Pause', () => {
  describe('resolvePlaybackState', () => {
    it('returns null for null api', () => {
      expect(resolvePlaybackState(null)).toBeNull();
    });

    it('returns null for undefined api', () => {
      expect(resolvePlaybackState(undefined)).toBeNull();
    });

    it('uses getPlaybackState() when available', () => {
      const api = {
        getPlaybackState: () => ({ isPaused: false, currentTime: 100 })
      };
      const result = resolvePlaybackState(api);
      expect(result).toEqual({ isPaused: false, currentTime: 100 });
    });

    it('falls back to getMediaController().getPlaybackState()', () => {
      const api = {
        getMediaController: () => ({
          getPlaybackState: () => ({ isPaused: true })
        })
      };
      const result = resolvePlaybackState(api);
      expect(result).toEqual({ isPaused: true });
    });

    it('falls back to getMediaController().transport.getPlaybackState()', () => {
      const api = {
        getMediaController: () => ({
          transport: {
            getPlaybackState: () => ({ isPaused: false })
          }
        })
      };
      const result = resolvePlaybackState(api);
      expect(result).toEqual({ isPaused: false });
    });

    // NEW TEST: This is the missing functionality
    it('uses native .paused property when no methods available', () => {
      const api = {
        paused: false,
        currentTime: 50
      };
      const result = resolvePlaybackState(api);
      expect(result).toEqual({ isPaused: false });
    });

    it('uses native .paused=true property correctly', () => {
      const api = {
        paused: true
      };
      const result = resolvePlaybackState(api);
      expect(result).toEqual({ isPaused: true });
    });

    it('prefers getPlaybackState over native .paused', () => {
      const api = {
        paused: true, // native says paused
        getPlaybackState: () => ({ isPaused: false }) // method says playing
      };
      const result = resolvePlaybackState(api);
      // Method should take precedence
      expect(result).toEqual({ isPaused: false });
    });
  });

  describe('pauseMediaIfNeeded', () => {
    let wasPlayingRef;

    beforeEach(() => {
      wasPlayingRef = { current: false };
    });

    it('sets wasPlayingRef to false when playerRef is null', () => {
      pauseMediaIfNeeded({ current: null }, wasPlayingRef);
      expect(wasPlayingRef.current).toBe(false);
    });

    it('sets wasPlayingRef to false when playerRef.current is null', () => {
      pauseMediaIfNeeded({ current: null }, wasPlayingRef);
      expect(wasPlayingRef.current).toBe(false);
    });

    it('calls pause() when video is playing (getPlaybackState API)', () => {
      const pause = jest.fn();
      const playerRef = {
        current: {
          getPlaybackState: () => ({ isPaused: false }),
          pause
        }
      };

      pauseMediaIfNeeded(playerRef, wasPlayingRef);

      expect(pause).toHaveBeenCalledTimes(1);
      expect(wasPlayingRef.current).toBe(true);
    });

    it('does NOT call pause() when video is already paused', () => {
      const pause = jest.fn();
      const playerRef = {
        current: {
          getPlaybackState: () => ({ isPaused: true }),
          pause
        }
      };

      pauseMediaIfNeeded(playerRef, wasPlayingRef);

      expect(pause).not.toHaveBeenCalled();
      expect(wasPlayingRef.current).toBe(false);
    });

    // NEW TEST: Handle native video element
    it('calls pause() on native video element (uses .paused property)', () => {
      const pause = jest.fn();
      const playerRef = {
        current: {
          paused: false, // native property
          pause
        }
      };

      pauseMediaIfNeeded(playerRef, wasPlayingRef);

      expect(pause).toHaveBeenCalledTimes(1);
      expect(wasPlayingRef.current).toBe(true);
    });

    it('does NOT call pause() on native paused video', () => {
      const pause = jest.fn();
      const playerRef = {
        current: {
          paused: true, // native says already paused
          pause
        }
      };

      pauseMediaIfNeeded(playerRef, wasPlayingRef);

      expect(pause).not.toHaveBeenCalled();
      expect(wasPlayingRef.current).toBe(false);
    });

    // NEW TEST: Handle MediaController API
    it('calls pause() via getMediaController() if direct pause missing', () => {
      const controllerPause = jest.fn();
      const playerRef = {
        current: {
          paused: false,
          getMediaController: () => ({
            pause: controllerPause
          })
        }
      };

      pauseMediaIfNeeded(playerRef, wasPlayingRef);

      expect(controllerPause).toHaveBeenCalledTimes(1);
      expect(wasPlayingRef.current).toBe(true);
    });
  });

  describe('resumeMediaIfNeeded', () => {
    it('does nothing when wasPlayingRef is false', () => {
      const play = jest.fn();
      const playerRef = {
        current: { play }
      };
      const wasPlayingRef = { current: false };

      resumeMediaIfNeeded(playerRef, wasPlayingRef);

      expect(play).not.toHaveBeenCalled();
    });

    it('calls play() when wasPlayingRef is true', () => {
      const play = jest.fn();
      const playerRef = {
        current: { play }
      };
      const wasPlayingRef = { current: true };

      resumeMediaIfNeeded(playerRef, wasPlayingRef);

      expect(play).toHaveBeenCalledTimes(1);
      expect(wasPlayingRef.current).toBe(false);
    });

    it('resets wasPlayingRef even if playerRef.current is null', () => {
      const wasPlayingRef = { current: true };

      resumeMediaIfNeeded({ current: null }, wasPlayingRef);

      expect(wasPlayingRef.current).toBe(false);
    });

    it('calls play() via getMediaController() if direct play missing', () => {
      const controllerPlay = jest.fn();
      const playerRef = {
        current: {
          getMediaController: () => ({
            play: controllerPlay
          })
        }
      };
      const wasPlayingRef = { current: true };

      resumeMediaIfNeeded(playerRef, wasPlayingRef);

      expect(controllerPlay).toHaveBeenCalledTimes(1);
    });
  });
});
