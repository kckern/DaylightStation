import { describe, expect, it } from 'vitest';
import { validateSurfaceProfile, SURFACE_FAMILIES } from './profileValidation.mjs';

const good = {
  schema: 'school.surface-profile/v1',
  surfaceId: 'paper-letter-mono',
  family: 'paper',
  title: 'Laser worksheets',
  liveness: 'static',
  capabilities: ['reader@1', 'quiz@1', 'response.choice@1', 'return.scan@1'],
  limits: { omrChannels: 12, maxItemsPerSheet: 25, maxPagesPerDocument: 20 },
};

describe('validateSurfaceProfile', () => {
  it('accepts a well-formed profile and freezes the normalized record', () => {
    const { errors, profile } = validateSurfaceProfile(good);
    expect(errors).toEqual([]);
    expect(profile.surfaceId).toBe('paper-letter-mono');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(profile.limits.omrChannels).toBe(12);
  });

  it('rejects wrong schema, bad surfaceId, unknown family, unknown liveness', () => {
    expect(validateSurfaceProfile({ ...good, schema: 'nope/v1' }).errors.join()).toMatch(/schema/);
    expect(validateSurfaceProfile({ ...good, surfaceId: 'Bad_Id' }).errors.join()).toMatch(/surfaceId/);
    expect(validateSurfaceProfile({ ...good, family: 'dispatch' }).errors.join())
      .toMatch(new RegExp(SURFACE_FAMILIES.join('\\|')));
    expect(validateSurfaceProfile({ ...good, liveness: 'live' }).errors.join()).toMatch(/liveness/);
  });

  it('rejects unregistered capability IDs unless injected as custom (spec §3.1/§3.2)', () => {
    const { errors } = validateSurfaceProfile({ ...good, capabilities: ['reader@1', 'hologram@1'] });
    expect(errors.join()).toMatch(/hologram@1/);
    const custom = validateSurfaceProfile(
      { ...good, capabilities: ['reader@1', 'periodic-table@1'] },
      { customCapabilities: ['periodic-table@1'] },
    );
    expect(custom.errors).toEqual([]);
  });

  it('requires a non-empty capability list and a mapping for limits', () => {
    expect(validateSurfaceProfile({ ...good, capabilities: [] }).errors.length).toBeGreaterThan(0);
    expect(validateSurfaceProfile({ ...good, limits: [] }).errors.join()).toMatch(/limits/);
    expect(validateSurfaceProfile({ ...good, limits: undefined }).errors).toEqual([]); // limits optional
  });
});
