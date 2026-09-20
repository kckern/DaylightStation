import { describe, expect, it } from 'vitest';
import { PlaybackRiskRepository } from './PlaybackRiskRepository.mjs';

describe('PlaybackRiskRepository', () => {
  it('retrieves rules and recorded outcomes in the exact profile/environment scope', async () => {
    const repository = new PlaybackRiskRepository({ state: {} });
    const scoped = { scope: { profileKey: 'browser-a', environmentVersion: 'env-1' }, status: 'active' };
    await repository.record({ incidentId: 'incident-1', profileKey: 'browser-a', environmentVersion: 'env-1' });
    await repository.save(scoped);
    await repository.save({ scope: { profileKey: 'browser-a', environmentVersion: 'env-2' }, status: 'active' });
    expect(await repository.find({ profileKey: 'browser-a', environmentVersion: 'env-1' })).toEqual([scoped, { incidentId: 'incident-1', profileKey: 'browser-a', environmentVersion: 'env-1' }]);
    expect(await repository.find({ profileKey: 'browser-a', environmentVersion: 'env-3' })).toEqual([]);
  });

  it('does not duplicate an observation incident and leaves caller objects immutable', async () => {
    const state = {};
    const repository = new PlaybackRiskRepository({ state });
    const outcome = { incidentId: 'incident-1', profileKey: 'browser-a', environmentVersion: 'env-1' };
    await repository.record(outcome);
    await repository.record(outcome);
    expect(state.outcomes).toEqual([outcome]);
    expect(state.outcomes[0]).not.toBe(outcome);
  });

  it('isolates cached nested evidence from later caller mutations', async () => {
    const state = {};
    const repository = new PlaybackRiskRepository({ state });
    const outcome = { incidentId: 'incident-1', profileKey: 'browser-a', environmentVersion: 'env-1', media: { codec: 'hevc' } };
    await repository.record(outcome);
    outcome.media.codec = 'h264';
    expect(state.outcomes[0].media.codec).toBe('hevc');
  });
});
