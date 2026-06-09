import { describe, it, expect } from 'vitest';
import { mediaDisplayUrl, resolveSessionStartMs } from './sessionDetailUtils.js';

describe('mediaDisplayUrl', () => {
  it('builds a source-qualified display url', () => {
    expect(mediaDisplayUrl('plex:674287')).toBe('/api/v1/display/plex/674287');
  });
  it('defaults bare ids to plex', () => {
    expect(mediaDisplayUrl('674287')).toBe('/api/v1/display/plex/674287');
  });
  it('returns null for empty input', () => {
    expect(mediaDisplayUrl(null)).toBeNull();
  });
});

describe('resolveSessionStartMs', () => {
  it('prefers session.start (ISO)', () => {
    expect(resolveSessionStartMs({ session: { start: '2026-06-08T19:19:48.000Z' } }))
      .toBe(Date.parse('2026-06-08T19:19:48.000Z'));
  });
  it('falls back to root .start then numeric startTime', () => {
    expect(resolveSessionStartMs({ start: '2026-06-08T19:19:48.000Z' }))
      .toBe(Date.parse('2026-06-08T19:19:48.000Z'));
    expect(resolveSessionStartMs({ startTime: 1780971588000 })).toBe(1780971588000);
  });
  it('returns null when no start is available', () => {
    expect(resolveSessionStartMs({})).toBeNull();
    expect(resolveSessionStartMs(null)).toBeNull();
  });
});
