import { describe, expect, it, vi } from 'vitest';
import { GovernanceTypeRegistry } from './GovernanceTypeRegistry.js';

describe('GovernanceTypeRegistry', () => {
  it('dispatches normalization, eligibility and evaluation by type', () => {
    const evaluate = vi.fn(() => ({ satisfied: true }));
    const registry = new GovernanceTypeRegistry('challenge').register('step', {
      normalize: (raw) => ({ type: 'step', target: Number(raw.target) }),
      isEligible: (_selection, ctx) => ({ eligible: Boolean(ctx.active), reason: ctx.active ? null : 'inactive' }),
      evaluate,
    });
    expect(registry.normalize('step', { target: '40' })).toEqual({ type: 'step', target: 40 });
    expect(registry.eligibility('step', {}, { active: false })).toEqual({ eligible: false, reason: 'inactive' });
    expect(registry.evaluate('step', {}, {})).toEqual({ satisfied: true });
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it('rejects duplicate registrations and unknown types fail closed', () => {
    const registry = new GovernanceTypeRegistry('requirement').register('zone', {});
    expect(() => registry.register('zone', {})).toThrow(/already registered/);
    expect(registry.eligibility('missing', {})).toMatchObject({ eligible: false });
  });
});
