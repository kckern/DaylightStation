import { describe, it, expect } from 'vitest';
import { musicBehindVerdict } from './musicBehindPolicy.js';

const photo = { contentId: 'immich:1', format: 'image' };
const film = { contentId: 'plex:1', format: 'dash_video' };

describe('music behind follows the slideshow (PLAY.9a, no double audio)', () => {
  it('stays while photos are on screen', () => {
    expect(musicBehindVerdict({ item: photo, state: 'playing', keep: false })).toBe('stay');
    expect(musicBehindVerdict({ item: photo, state: 'playing', keep: true })).toBe('stay');
  });
  it('stops when the slideshow is gone and the person did not keep it', () => {
    expect(musicBehindVerdict({ item: null, state: 'ready', keep: false })).toBe('stop');
    expect(musicBehindVerdict({ item: null, state: 'idle', keep: false })).toBe('stop');
  });
  it('a kept music stays over an empty screen', () => {
    expect(musicBehindVerdict({ item: null, state: 'ready', keep: true })).toBe('stay');
  });
  it('waits out a transient load between photos', () => {
    expect(musicBehindVerdict({ item: null, state: 'loading', keep: false })).toBe('stay');
  });
  it('anything with its own sound stops it, kept or not', () => {
    expect(musicBehindVerdict({ item: film, state: 'playing', keep: false })).toBe('stop');
    expect(musicBehindVerdict({ item: film, state: 'loading', keep: true })).toBe('stop');
  });
});
