import { describe, it, expect, vi } from 'vitest';
import { FitnessConfigProjection } from './FitnessConfigProjection.mjs';

const configService = (fitness) => ({
  getDefaultHouseholdId: () => 'default',
  getHouseholdAppConfig: () => fitness,
  getAllUserProfiles: () => new Map([
    ['parent-a', { type: 'owner' }],
    ['child-a', { type: 'family_member' }],
  ]),
});

describe('FitnessConfigProjection supervisors', () => {
  it('replaces governance.superusers with role-resolved supervisors', () => {
    const logger = { warn: vi.fn() };
    const p = new FitnessConfigProjection({ configService: configService({ governance: { superusers: ['child-a'] } }), logger });
    expect(p.raw().governance.superusers).toEqual(['parent-a']);
    expect(logger.warn).toHaveBeenCalledWith('governance.config.superusers_retired', expect.any(Object));
  });
  it('warns about a stale list only once', () => {
    const logger = { warn: vi.fn() };
    const p = new FitnessConfigProjection({ configService: configService({ governance: { superusers: ['x'] } }), logger });
    p.raw(); p.raw();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
  it('null config stays null', () => {
    const p = new FitnessConfigProjection({ configService: configService(null) });
    expect(p.raw()).toBeNull();
  });
});
