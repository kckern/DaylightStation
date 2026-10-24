import { describe, expect, it } from 'vitest';
import { musicPlaysThroughHold, musicShouldPause } from "./musicVideoSync.js";

describe('musicShouldPause', () => {
  it('pauses the music for a real video pause', () => {
    expect(musicShouldPause({ videoPlayerPaused: true, videoLoading: false, voiceMemoOpen: false })).toBe(true);
  });

  it('keeps the music playing while the video loads or recovers', () => {
    expect(musicShouldPause({ videoPlayerPaused: true, videoLoading: true, voiceMemoOpen: false })).toBe(false);
  });

  it('always pauses for a voice memo', () => {
    expect(musicShouldPause({ videoPlayerPaused: false, videoLoading: true, voiceMemoOpen: true })).toBe(true);
  });

  it('always pauses for an emergency, even while the video is loading', () => {
    expect(musicShouldPause({ videoPlayerPaused: true, videoLoading: true, voiceMemoOpen: false, emergencyHold: true })).toBe(true);
  });

  it('plays when nothing holds it', () => {
    expect(musicShouldPause({ videoPlayerPaused: false, videoLoading: false, voiceMemoOpen: false })).toBe(false);
  });
});

describe('musicPlaysThroughHold', () => {
  it('flags music that is playing while the video is paused or locked', () => {
    expect(musicPlaysThroughHold({ shouldPause: true, musicPaused: false })).toBe(true);
  });
  it('leaves already-paused music and unheld music alone', () => {
    expect(musicPlaysThroughHold({ shouldPause: true, musicPaused: true })).toBe(false);
    expect(musicPlaysThroughHold({ shouldPause: false, musicPaused: false })).toBe(false);
  });
  it('does nothing when the tick does not report a paused flag', () => {
    expect(musicPlaysThroughHold({ shouldPause: true, musicPaused: undefined })).toBe(false);
  });
});
