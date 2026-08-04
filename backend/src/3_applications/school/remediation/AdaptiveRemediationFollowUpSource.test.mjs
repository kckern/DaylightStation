import { describe, expect, it, vi } from 'vitest';
import { AdaptiveRemediationFollowUpSource } from './AdaptiveRemediationFollowUpSource.mjs';

describe('AdaptiveRemediationFollowUpSource', () => {
  it('projects only sessions belonging to the resolved learner scope', async () => {
    const sessions = { listAvailable: vi.fn(async () => [
      { sessionId: 'rem-a', learnerId: 'kid-a', status: 'offered', initialScorePercent: 40 },
      { sessionId: 'rem-b', learnerId: 'kid-b', status: 'active', initialScorePercent: 60 },
    ]) };
    const source = new AdaptiveRemediationFollowUpSource({ sessions });
    await expect(source.listFollowUps({
      scope: { learnerIds: ['kid-b'] },
      deliveryContext: { surface: 'schoolcalc', endpointId: 'DEV001' },
    })).resolves.toEqual([expect.objectContaining({
      actionId: 'remediation:rem-b', learnerId: 'kid-b', kind: 'remediation',
      label: 'Continue tutoring', availability: 'requires_connection', priority: 5,
      target: { type: 'remediation_session', id: 'rem-b' },
    })]);
    expect(sessions.listAvailable).toHaveBeenCalledWith({
      surface: 'schoolcalc', endpointId: 'DEV001', learnerIds: ['kid-b'],
    });
  });

  it('marks a shared session ready when the web request proves current transport', async () => {
    const source = new AdaptiveRemediationFollowUpSource({
      sessions: { listAvailable: async () => [{
        sessionId: 'rem-web', learnerId: 'kid-a', status: 'offered', initialScorePercent: 60,
      }] },
    });
    await expect(source.listFollowUps({
      scope: { learnerIds: ['kid-a'] }, deliveryContext: { surface: 'web' },
    })).resolves.toEqual([expect.objectContaining({
      actionId: 'remediation:rem-web', availability: 'ready',
      target: { type: 'remediation_session', id: 'rem-web' },
    })]);
  });
});
