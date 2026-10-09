import { describe, it, expect } from 'vitest';
import { normalizeStreamContentId } from './api.js';

describe('normalizeStreamContentId', () => {
  it('base64url-encodes the url part of a raw stream id', () => {
    const out = normalizeStreamContentId('stream:https://soccerfull.net/play/14360');
    expect(out.startsWith('stream:')).toBe(true);
    const tok = out.slice('stream:'.length);
    expect(tok).not.toMatch(/[/:]/);
    expect(atob(tok.replace(/-/g, '+').replace(/_/g, '/'))).toBe('https://soccerfull.net/play/14360');
  });
  it('leaves already-encoded stream ids and non-stream ids unchanged', () => {
    expect(normalizeStreamContentId('plex:123')).toBe('plex:123');
    const enc = normalizeStreamContentId('stream:https://x/y');
    expect(normalizeStreamContentId(enc)).toBe(enc);
  });
});
