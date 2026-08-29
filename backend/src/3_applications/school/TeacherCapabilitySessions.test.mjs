import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { TeacherGate } from './TeacherGate.mjs';
import { TeacherCapabilitySessions, requiresTeacherStepUp, teacherResource } from './TeacherCapabilitySessions.mjs';

function fixture() {
  let now = Date.parse('2026-08-24T10:00:00.000Z');
  const clock = () => new Date(now);
  const gate = new TeacherGate({ teachers: () => ['parent'], pin: () => '4321',
    roster: () => [{ id: 'parent', birthyear: 1984 }], clock, logger: { warn() {} } });
  const sessions = new TeacherCapabilitySessions({ teacherGate: gate,
    tokenFactory: () => randomBytes(32).toString('base64url'), clock });
  gate.bindCapabilitySessions(sessions);
  return { gate, sessions, advance: (ms) => { now += ms; } };
}

describe('TeacherCapabilitySessions', () => {
  it('authorizes ordinary writes until idle or absolute expiry', () => {
    const f = fixture();
    const unlocked = f.sessions.unlock({ userId: 'parent', pin: '4321' });
    const proof = { capabilityToken: unlocked.capabilityToken };
    expect(() => f.gate.assert({ userId: 'parent', pin: proof, action: 'assignments.put' })).not.toThrow();
    f.advance(9 * 60_000);
    expect(() => f.gate.assert({ userId: 'parent', pin: proof, action: 'assignments.put' })).not.toThrow();
    f.advance(10 * 60_000);
    expect(() => f.gate.assert({ userId: 'parent', pin: proof, action: 'assignments.put' })).toThrow(/PIN/);
  });

  it('never extends beyond the 30-minute absolute lifetime', () => {
    const f = fixture();
    const unlocked = f.sessions.unlock({ userId: 'parent', pin: '4321' });
    for (let i = 0; i < 3; i += 1) {
      f.advance(9 * 60_000);
      expect(f.sessions.status(unlocked.capabilityToken, { touch: true }).active).toBe(true);
    }
    f.advance(3 * 60_000);
    expect(f.sessions.status(unlocked.capabilityToken).active).toBe(false);
  });

  it('requires a resource-scoped one-use step-up for sensitive actions', () => {
    const f = fixture();
    const unlocked = f.sessions.unlock({ userId: 'parent', pin: '4321' });
    const proof = { capabilityToken: unlocked.capabilityToken };
    expect(() => f.gate.assert({ userId: 'parent', pin: proof,
      action: 'sessions.grade-adjust.preview', context: { sessionId: 'ses_1' } })).not.toThrow();
    expect(() => f.gate.assert({ userId: 'parent', pin: proof, action: 'sessions.grade-adjust', context: { sessionId: 'ses_1' } })).toThrow(/PIN/);
    const grant = f.sessions.stepUp({ capabilityToken: unlocked.capabilityToken, pin: '4321',
      action: 'sessions.grade-adjust', resource: 'ses_1' });
    expect(() => f.gate.assert({ userId: 'parent', pin: { ...proof, stepUpToken: grant.grantToken },
      action: 'sessions.grade-adjust', context: { sessionId: 'ses_1' } })).not.toThrow();
    expect(() => f.gate.assert({ userId: 'parent', pin: { ...proof, stepUpToken: grant.grantToken },
      action: 'sessions.grade-adjust', context: { sessionId: 'ses_1' } })).toThrow(/PIN/);
  });

  it('refuses wrong-resource and expired grants and revokes grants on lock', () => {
    const f = fixture();
    const unlocked = f.sessions.unlock({ userId: 'parent', pin: '4321' });
    const grant = f.sessions.stepUp({ capabilityToken: unlocked.capabilityToken, pin: '4321',
      action: 'agenda.dispatch', resource: 'kid-a' });
    expect(f.sessions.authorize({ capabilityToken: unlocked.capabilityToken, stepUpToken: grant.grantToken,
      userId: 'parent', action: 'agenda.dispatch', context: { learnerId: 'kid-b' } })).toBe(false);
    const expiring = f.sessions.stepUp({ capabilityToken: unlocked.capabilityToken, pin: '4321',
      action: 'agenda.dispatch', resource: 'kid-a' });
    f.advance(2 * 60_000);
    expect(f.sessions.authorize({ capabilityToken: unlocked.capabilityToken, stepUpToken: expiring.grantToken,
      userId: 'parent', action: 'agenda.dispatch', context: { learnerId: 'kid-a' } })).toBe(false);
    expect(f.sessions.lock(unlocked.capabilityToken).locked).toBe(true);
    expect(f.sessions.status(unlocked.capabilityToken).active).toBe(false);
  });

  it('raw PIN authorization remains compatible for sensitive writes', () => {
    const f = fixture();
    expect(() => f.gate.assert({ userId: 'parent', pin: '4321', action: 'attempts.regrade', context: { bankId: 'math' } })).not.toThrow();
  });

  it('scopes a correction retraction to both session and adjustment', () => {
    const f = fixture();
    const unlocked = f.sessions.unlock({ userId: 'parent', pin: '4321' });
    const grant = f.sessions.stepUp({ capabilityToken: unlocked.capabilityToken, pin: '4321',
      action: 'sessions.grade-adjustment.retract', resource: 'ses_1/adj_1' });
    expect(f.sessions.authorize({ capabilityToken: unlocked.capabilityToken, stepUpToken: grant.grantToken,
      userId: 'parent', action: 'sessions.grade-adjustment.retract', context: { sessionId: 'ses_1', adjustmentId: 'adj_2' } })).toBe(false);
  });

  // The Set and `teacherResource` have to AGREE. `requiresTeacherStepUp` is
  // derived from the resource being non-null, so a name in the Set with no
  // resource branch requires nothing — a step-up that silently buys a free
  // pass looks exactly like one that works, which is why this is asserted
  // rather than eyeballed.
  it('scopes a hand-settle to the one session it is settling', () => {
    expect(requiresTeacherStepUp('sessions.settle', { sessionId: 'ses_1' })).toBe(true);
    expect(teacherResource('sessions.settle', { sessionId: 'ses_1' })).toBe('ses_1');
    expect(requiresTeacherStepUp('sessions.settle', {})).toBe(false);

    const f = fixture();
    const unlocked = f.sessions.unlock({ userId: 'parent', pin: '4321' });
    const proof = { capabilityToken: unlocked.capabilityToken };
    // The capability cookie alone is not enough, and a grant for a different
    // session is not either.
    expect(() => f.gate.assert({ userId: 'parent', pin: proof,
      action: 'sessions.settle', context: { sessionId: 'ses_1' } })).toThrow(/PIN/);
    const other = f.sessions.stepUp({ capabilityToken: unlocked.capabilityToken, pin: '4321',
      action: 'sessions.settle', resource: 'ses_2' });
    expect(() => f.gate.assert({ userId: 'parent', pin: { ...proof, stepUpToken: other.grantToken },
      action: 'sessions.settle', context: { sessionId: 'ses_1' } })).toThrow(/PIN/);
    const grant = f.sessions.stepUp({ capabilityToken: unlocked.capabilityToken, pin: '4321',
      action: 'sessions.settle', resource: 'ses_1' });
    expect(() => f.gate.assert({ userId: 'parent', pin: { ...proof, stepUpToken: grant.grantToken },
      action: 'sessions.settle', context: { sessionId: 'ses_1' } })).not.toThrow();
    // One use only: the same token cannot settle the session twice.
    expect(() => f.gate.assert({ userId: 'parent', pin: { ...proof, stepUpToken: grant.grantToken },
      action: 'sessions.settle', context: { sessionId: 'ses_1' } })).toThrow(/PIN/);
  });

  // Reading a child's finish code out loud hands over the one secret the
  // companion gate is made of. An unlocked console left open on a household
  // screen must not be enough on its own; the grown-up types the PIN again,
  // for the one session in front of them.
  it('scopes a finish-code reveal to the one session it is unblocking', () => {
    expect(requiresTeacherStepUp('companion.finish-code.reveal', { sessionId: 'ses_1' })).toBe(true);
    expect(teacherResource('companion.finish-code.reveal', { sessionId: 'ses_1' })).toBe('ses_1');
    expect(requiresTeacherStepUp('companion.finish-code.reveal', {})).toBe(false);

    const f = fixture();
    const unlocked = f.sessions.unlock({ userId: 'parent', pin: '4321' });
    const proof = { capabilityToken: unlocked.capabilityToken };
    expect(() => f.gate.assert({ userId: 'parent', pin: proof,
      action: 'companion.finish-code.reveal', context: { sessionId: 'ses_1' } })).toThrow(/PIN/);
    const other = f.sessions.stepUp({ capabilityToken: unlocked.capabilityToken, pin: '4321',
      action: 'companion.finish-code.reveal', resource: 'ses_2' });
    expect(() => f.gate.assert({ userId: 'parent', pin: { ...proof, stepUpToken: other.grantToken },
      action: 'companion.finish-code.reveal', context: { sessionId: 'ses_1' } })).toThrow(/PIN/);
    const grant = f.sessions.stepUp({ capabilityToken: unlocked.capabilityToken, pin: '4321',
      action: 'companion.finish-code.reveal', resource: 'ses_1' });
    expect(() => f.gate.assert({ userId: 'parent', pin: { ...proof, stepUpToken: grant.grantToken },
      action: 'companion.finish-code.reveal', context: { sessionId: 'ses_1' } })).not.toThrow();
    // One use only: a second child needs a second deliberate reveal.
    expect(() => f.gate.assert({ userId: 'parent', pin: { ...proof, stepUpToken: grant.grantToken },
      action: 'companion.finish-code.reveal', context: { sessionId: 'ses_1' } })).toThrow(/PIN/);
  });
});
