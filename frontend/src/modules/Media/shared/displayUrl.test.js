import { describe, it, expect } from 'vitest';
import { displayUrl } from './displayUrl.js';

describe('displayUrl', () => {
  it('builds /api/v1/display/:source/:localId for a content id', () => {
    expect(displayUrl('plex-main:12345')).toBe('/api/v1/display/plex-main/12345');
  });

  it('preserves slashes in localId (paths)', () => {
    expect(displayUrl('hymn-library:198/second')).toBe('/api/v1/display/hymn-library/198/second');
  });

  it('returns null for null/undefined/empty/unshaped input', () => {
    expect(displayUrl(null)).toBe(null);
    expect(displayUrl(undefined)).toBe(null);
    expect(displayUrl('')).toBe(null);
    expect(displayUrl('no-colon')).toBe(null);
  });
});
