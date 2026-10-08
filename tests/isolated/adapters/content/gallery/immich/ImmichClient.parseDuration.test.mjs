import { describe, it, expect } from 'vitest';
import { ImmichClient } from '#adapters/content/gallery/immich/ImmichClient.mjs';

function client() {
  return new ImmichClient(
    { host: 'http://immich', apiKey: 'k' },
    { httpClient: { get: async () => ({ data: {} }) } }
  );
}

describe('ImmichClient.parseDuration', () => {
  const c = client();

  it('parses a valid HH:MM:SS.mmm string to seconds', () => {
    expect(c.parseDuration('0:01:30.00000')).toBe(90);
  });

  it('returns null for the zero-duration sentinel and empty input', () => {
    expect(c.parseDuration('0:00:00.00000')).toBeNull();
    expect(c.parseDuration('')).toBeNull();
    expect(c.parseDuration(null)).toBeNull();
    expect(c.parseDuration(undefined)).toBeNull();
    expect(c.parseDuration(0)).toBeNull(); // numeric zero == no duration, matches the '0:00:00.00000' sentinel
  });

  it('does NOT throw on a non-string duration (the RC2 crash)', () => {
    expect(() => c.parseDuration(90)).not.toThrow();
    expect(() => c.parseDuration({})).not.toThrow();
    expect(() => c.parseDuration([1, 2, 3])).not.toThrow();
  });

  // Immich 3.x sends `duration` as integer MILLISECONDS (verified 2026-10-07 on
  // 3.3.0: a 35.9 s clip reports 35946). Reading it as seconds made every video
  // look 1000x longer, so the query adapter segmented 5-second clips and seeked
  // hours past their end.
  it('reads a numeric duration as milliseconds and returns rounded seconds', () => {
    expect(c.parseDuration(35946)).toBe(36);
    expect(c.parseDuration(50155)).toBe(50);
    expect(c.parseDuration(90000)).toBe(90);
    expect(c.parseDuration(1410600)).toBe(1411);
  });

  it('returns null for non-string, non-number inputs', () => {
    expect(c.parseDuration({})).toBeNull();
    expect(c.parseDuration(NaN)).toBeNull();
  });
});
