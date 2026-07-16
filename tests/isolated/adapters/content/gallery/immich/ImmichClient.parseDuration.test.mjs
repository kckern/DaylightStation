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
  });

  it('does NOT throw on a non-string duration (the RC2 crash)', () => {
    expect(() => c.parseDuration(90)).not.toThrow();
    expect(() => c.parseDuration({})).not.toThrow();
    expect(() => c.parseDuration([1, 2, 3])).not.toThrow();
  });

  it('coerces a finite number to a rounded second count', () => {
    expect(c.parseDuration(90)).toBe(90);
    expect(c.parseDuration(90.7)).toBe(91);
  });

  it('returns null for non-string, non-number inputs', () => {
    expect(c.parseDuration({})).toBeNull();
    expect(c.parseDuration(NaN)).toBeNull();
  });
});
