import { describe, it, expect } from 'vitest';
import { gatekeeperStrategies } from '#apps/trigger/guards/gatekeeperStrategies.mjs';

describe('gatekeeperStrategies', () => {
  it('returns [] (approve) when no policy configured', () => {
    expect(gatekeeperStrategies({})).toEqual([]);
    expect(gatekeeperStrategies({ authorize: { policy: 'auto-approve' } })).toEqual([]);
  });

  it('returns [] (approve) for undefined locationConfig', () => {
    expect(gatekeeperStrategies()).toEqual([]);
  });

  it('returns [] for an unknown/unrecognized policy (seam default)', () => {
    expect(gatekeeperStrategies({ authorize: { policy: 'rate-limit' } })).toEqual([]);
  });
});
