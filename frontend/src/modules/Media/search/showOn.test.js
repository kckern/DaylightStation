import { describe, it, expect } from 'vitest';
import { isShowItem } from './showOn.js';

describe('isShowItem (FIND.8b/AC3)', () => {
  it('recognises a single photo, a camera feed and an image media type', () => {
    expect(isShowItem({ id: 'immich:abc', type: 'photo' })).toBe(true);
    expect(isShowItem({ id: 'immich:abc', metadata: { type: 'photo' } })).toBe(true);
    expect(isShowItem({ id: 'camera:garage' })).toBe(true);
    expect(isShowItem({ id: 'x:1', mediaType: 'image' })).toBe(true);
  });
  it('does not treat films, tracks or a collection of photos as show items', () => {
    expect(isShowItem({ id: 'plex:1', type: 'movie', mediaType: 'video' })).toBe(false);
    expect(isShowItem({ id: 'plex:2', type: 'track', mediaType: 'audio' })).toBe(false);
    expect(isShowItem({ id: 'immich:album:1', type: 'photo', itemType: 'container' })).toBe(false);
    expect(isShowItem(null)).toBe(false);
  });
});
