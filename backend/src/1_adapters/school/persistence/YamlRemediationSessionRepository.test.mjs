import { describe, expect, it } from 'vitest';
import { YamlRemediationSessionRepository } from './YamlRemediationSessionRepository.mjs';

const now = '2026-08-02T12:00:00.000Z';
const session = {
  schema: 'school.adaptive-remediation-session/v1', sessionId: 'rem_ABC123', learnerId: 'user_4',
  source: { surface: 'schoolcalc', endpointId: 'DEVICE01', externalId: 'DEVICE01:9' },
  status: 'offered', nextClientSequence: 0, createdAt: now,
};

function harness() {
  const files = new Map();
  const io = {
    load: (file) => structuredClone(files.get(file) ?? null),
    save: (file, value) => files.set(file, structuredClone(value)),
  };
  return { repository: new YamlRemediationSessionRepository({ directory: '/state/remediation', io }), files };
}

describe('YamlRemediationSessionRepository', () => {
  it('creates one source-stable offer and lists it by generic surface identity', async () => {
    const { repository } = harness();
    await expect(repository.createOffer(session)).resolves.toMatchObject({ status: 'created' });
    await expect(repository.createOffer(session)).resolves.toMatchObject({ status: 'existing' });
    await expect(repository.listAvailable({ surface: 'schoolcalc', endpointId: 'DEVICE01' }))
      .resolves.toEqual([session]);
  });

  it('claims exact payload bytes once, leases work, and returns completed duplicates', async () => {
    const { repository } = harness();
    await repository.createOffer(session);
    const claim = {
      sessionId: session.sessionId, clientSequence: 0, payloadDigest: 'digest-a',
      payload: { action: 'start' }, claimedAt: now, leaseMs: 10_000,
    };
    await expect(repository.claimAction(claim)).resolves.toMatchObject({ status: 'new' });
    await expect(repository.claimAction({ ...claim, claimedAt: '2026-08-02T12:00:01.000Z' }))
      .resolves.toMatchObject({ status: 'busy' });
    await expect(repository.claimAction({ ...claim, payloadDigest: 'digest-b' }))
      .resolves.toMatchObject({ status: 'conflict' });
    const next = { ...session, status: 'active', nextClientSequence: 1 };
    await repository.completeAction({
      sessionId: session.sessionId, clientSequence: 0, payloadDigest: 'digest-a',
      session: next, response: { status: 'active' }, completedAt: '2026-08-02T12:00:02.000Z',
    });
    await expect(repository.claimAction({ ...claim, claimedAt: '2026-08-02T12:00:03.000Z' }))
      .resolves.toMatchObject({ status: 'duplicate', response: { status: 'active' } });
  });

  it('makes a failed model call immediately resumable without advancing sequence', async () => {
    const { repository } = harness();
    await repository.createOffer(session);
    const claim = {
      sessionId: session.sessionId, clientSequence: 0, payloadDigest: 'digest-a',
      payload: { action: 'start' }, claimedAt: now,
    };
    await repository.claimAction(claim);
    await repository.failAction({ ...claim, failedAt: '2026-08-02T12:00:05.000Z', error: new Error('offline') });
    await expect(repository.claimAction({ ...claim, claimedAt: '2026-08-02T12:00:06.000Z' }))
      .resolves.toMatchObject({ status: 'resume', action: { attempts: 2 } });
  });
});
