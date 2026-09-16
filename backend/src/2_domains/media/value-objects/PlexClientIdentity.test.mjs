/**
 * PlexClientIdentity tests.
 *
 * These matter because `clientIdentifier` is permanent and unreclaimable on the
 * Plex side. A blank or accidentally-generated value does not fail loudly — it
 * quietly registers a NEW device, and enough of those wedged this household's
 * Plex server for a whole morning (81,009 device rows, ~26s statistics lock
 * every ~56s). Validation here is the cheap place to catch that.
 */

import { describe, it, expect } from 'vitest';
import { PlexClientIdentity } from './PlexClientIdentity.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

const VALID = {
  clientIdentifier: '9f2c1e80-3b77-4f2e-9a41-6d2b8c5e1a03',
  product: 'DaylightStation',
  version: '1.0',
  platform: 'Linux',
  device: 'Living Room TV',
};

describe('PlexClientIdentity', () => {
  it('keeps every declared field', () => {
    const id = new PlexClientIdentity(VALID);
    expect(id.clientIdentifier).toBe(VALID.clientIdentifier);
    expect(id.product).toBe('DaylightStation');
    expect(id.version).toBe('1.0');
    expect(id.platform).toBe('Linux');
    expect(id.device).toBe('Living Room TV');
  });

  it('refuses a missing or blank client identifier rather than inventing one', () => {
    expect(() => new PlexClientIdentity({ ...VALID, clientIdentifier: '' }))
      .toThrow(ValidationError);
    expect(() => new PlexClientIdentity({ ...VALID, clientIdentifier: '   ' }))
      .toThrow(ValidationError);
    expect(() => new PlexClientIdentity({ product: 'DaylightStation' }))
      .toThrow(ValidationError);
  });

  it('requires a product', () => {
    expect(() => new PlexClientIdentity({ clientIdentifier: 'abc' })).toThrow(ValidationError);
  });

  it('treats absent optional fields as null, not empty string', () => {
    const id = new PlexClientIdentity({ clientIdentifier: 'abc', product: 'DaylightStation' });
    expect(id.version).toBeNull();
    expect(id.platform).toBeNull();
    expect(id.device).toBeNull();
  });

  it('shows the device name to people, falling back to the product', () => {
    expect(new PlexClientIdentity(VALID).displayName).toBe('Living Room TV');
    expect(new PlexClientIdentity({ clientIdentifier: 'abc', product: 'DaylightStation' }).displayName)
      .toBe('DaylightStation');
  });

  it('is immutable', () => {
    const id = new PlexClientIdentity(VALID);
    expect(Object.isFrozen(id)).toBe(true);
  });

  it('compares by value, not by reference', () => {
    expect(new PlexClientIdentity(VALID).equals(new PlexClientIdentity(VALID))).toBe(true);
    expect(new PlexClientIdentity(VALID).equals(new PlexClientIdentity({ ...VALID, device: 'Garage Gym TV' })))
      .toBe(false);
    expect(new PlexClientIdentity(VALID).equals(null)).toBe(false);
  });

  it('trims surrounding whitespace so a stray YAML space is not a new device', () => {
    const id = new PlexClientIdentity({ ...VALID, clientIdentifier: '  abc  ' });
    expect(id.clientIdentifier).toBe('abc');
  });
});
