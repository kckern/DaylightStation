import { describe, it, expect } from 'vitest';
import { contentRequiresCamera } from '#apps/devices/services/contentRequiresCamera.mjs';

describe('contentRequiresCamera', () => {
  it('returns false for play=plex:*', () => {
    expect(contentRequiresCamera({ play: 'plex:620707' })).toBe(false);
  });

  it('returns false for queue=*', () => {
    expect(contentRequiresCamera({ queue: 'plex:1' })).toBe(false);
  });

  it('returns true for open=videocall/*', () => {
    expect(contentRequiresCamera({ open: 'videocall/abc' })).toBe(true);
  });

  it('returns true for app=webcam', () => {
    expect(contentRequiresCamera({ app: 'webcam' })).toBe(true);
  });

  it('returns false for empty query', () => {
    expect(contentRequiresCamera({})).toBe(false);
  });
});
