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

  it('skips a present-but-empty field and keeps scanning for a real identity', () => {
    // ensureEntryGuid short-circuits on a TRUTHY guid, so a falsy one reaches here and
    // must not win the precedence race — the item is identified by its contentId.
    expect(resolveSourceContentKey({ guid: false, contentId: 'plex:694719' })).toBe('contentId:plex:694719');
    expect(resolveSourceContentKey({ guid: '', contentId: 'plex:694719' })).toBe('contentId:plex:694719');
    expect(resolveSourceContentKey({ guid: NaN, contentId: 'plex:694719' })).toBe('contentId:plex:694719');
  });

  it('accepts a numeric id of zero, which is a usable key', () => {
    expect(resolveSourceContentKey({ plex: 0 })).toBe('plex:0');
  });

  it('rejects a non-scalar field rather than collapsing it to [object Object]', () => {
    expect(resolveSourceContentKey({ media: { url: '/a.mp4' }, contentId: 'plex:694719' }))
      .toBe('contentId:plex:694719');
  });

  it('returns null when no field identifies the content', () => {
    expect(resolveSourceContentKey({ shader: 'focused' })).toBeNull();
    expect(resolveSourceContentKey(null)).toBeNull();
    expect(resolveSourceContentKey('a-string')).toBeNull();
  });
});
