import { describe, it, expect } from 'vitest';
import { resolveSourceContentKey } from './mediaIdentity.js';

describe('resolveSourceContentKey', () => {
  it('gives two equivalent-but-distinct source objects the same key', () => {
    const a = { contentId: 'plex:694719', shader: 'focused', seconds: 0, resume: false };
    const b = { contentId: 'plex:694719', shader: 'focused', seconds: 0, resume: false };
    expect(a).not.toBe(b);
    expect(resolveSourceContentKey(a)).toBe(resolveSourceContentKey(b));
  });

  it('gives different content different keys', () => {
    expect(resolveSourceContentKey({ contentId: 'plex:694719' }))
      .not.toBe(resolveSourceContentKey({ contentId: 'plex:694720' }));
  });

  it('prefers an explicit guid over every other field', () => {
    expect(resolveSourceContentKey({ guid: 'abc', contentId: 'plex:1' })).toBe('guid:abc');
  });

  it('falls back through the identity fields the Player already understands', () => {
    expect(resolveSourceContentKey({ plex: '694719' })).toBe('plex:694719');
    expect(resolveSourceContentKey({ mediaUrl: '/x.mp4' })).toBe('mediaUrl:/x.mp4');
  });

  it('returns null when no field identifies the content', () => {
    expect(resolveSourceContentKey({ shader: 'focused' })).toBeNull();
    expect(resolveSourceContentKey(null)).toBeNull();
    expect(resolveSourceContentKey('a-string')).toBeNull();
  });
});
