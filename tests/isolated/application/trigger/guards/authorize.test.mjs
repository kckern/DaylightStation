import { describe, it, expect } from 'vitest';
import { authorize } from '#apps/trigger/guards/authorize.mjs';

describe('authorize', () => {
  it('approves by default (no strategies)', async () => {
    expect(await authorize({ strategies: [], context: {} })).toEqual({ approved: true });
  });
  it('denies when a strategy denies', async () => {
    const deny = { evaluate: async () => ({ approved: false, reason: 'nope' }) };
    expect(await authorize({ strategies: [deny], context: {} })).toEqual({ approved: false, reason: 'nope' });
  });
});
