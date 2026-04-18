import { describe, it, expect } from 'vitest';
import { resultToQueueInput } from './resultToQueueInput.js';

describe('resultToQueueInput', () => {
  it('maps id to contentId, preserving title/thumbnail/duration when present', () => {
    const row = { id: 'plex:660761', title: 'Lonesome Ghosts', thumbnail: '/t.jpg', duration: 600, mediaType: 'video' };
    expect(resultToQueueInput(row)).toEqual({
      contentId: 'plex:660761', title: 'Lonesome Ghosts', thumbnail: '/t.jpg', duration: 600, format: 'video',
    });
  });

  it('falls back to itemId when id is missing', () => {
    const row = { itemId: 'abs:abc' };
    expect(resultToQueueInput(row).contentId).toBe('abs:abc');
  });

  it('falls back to "<source>:<localId>" if id/itemId both missing', () => {
    expect(resultToQueueInput({ source: 'plex', localId: 'xyz' }).contentId).toBe('plex:xyz');
  });

  it('returns null for rows with no identifier', () => {
    expect(resultToQueueInput({})).toBeNull();
    expect(resultToQueueInput(null)).toBeNull();
  });

  it('treats mediaType "video" and "audio" as format; leaves everything else null', () => {
    expect(resultToQueueInput({ id: 'a:b', mediaType: 'audio' }).format).toBe('audio');
    expect(resultToQueueInput({ id: 'a:b', mediaType: 'video' }).format).toBe('video');
    expect(resultToQueueInput({ id: 'a:b', mediaType: 'image' }).format).toBe(null);
    expect(resultToQueueInput({ id: 'a:b' }).format).toBe(null);
  });
});
