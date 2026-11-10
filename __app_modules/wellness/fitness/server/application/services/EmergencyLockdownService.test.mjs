// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EmergencyLockdownService } from './EmergencyLockdownService.mjs';

const flush = () => new Promise((r) => setTimeout(r, 0));
const quiet = { info() {}, warn: vi.fn(), error() {}, debug() {} };

function build({ publications, ended } = {}) {
  const sessions = {
    getActiveSessions: vi.fn(async () => [{ sessionId: { toString: () => 's1' } }]),
    endSession: vi.fn(async () => ended ?? { sessionId: 's1', startTime: 1000, endTime: 5000, finalized: true, participants: { 'learner-a': {} } }),
  };
  const service = new EmergencyLockdownService({ sessions, publications, logger: quiet, clock: { now: () => 5000 } });
  return { service, sessions };
}

describe('EmergencyLockdownService.finalizeSessions publication', () => {
  it('publishes fitness.session.ended for each session it ends', async () => {
    const ended = vi.fn();
    const { service } = build({ publications: { ended } });
    service.finalizeSessions('home', 'alice');
    await flush();
    expect(ended).toHaveBeenCalledWith({ sessionId: 's1', learnerIds: ['learner-a'], endMs: 5000, startMs: 1000, finalized: true });
  });

  it('a failing bus never stops the lockdown', async () => {
    const { service, sessions } = build({ publications: { ended: () => { throw new Error('bus'); } } });
    service.finalizeSessions('home', 'alice');
    await flush();
    expect(sessions.endSession).toHaveBeenCalled();
    expect(quiet.warn).toHaveBeenCalledWith('fitness.sessions.ended-publish-failed', expect.objectContaining({ via: 'emergency' }));
  });

  it('works without publications', async () => {
    const { service, sessions } = build();
    service.finalizeSessions('home', 'alice');
    await flush();
    expect(sessions.endSession).toHaveBeenCalled();
  });
});
