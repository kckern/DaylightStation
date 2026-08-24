import { describe, it, expect } from 'vitest';
import { TeacherGate } from './TeacherGate.mjs';
import { TeacherCapabilitySessions } from './TeacherCapabilitySessions.mjs';

function fixture() {
  let now = Date.parse('2026-08-24T10:00:00.000Z');
  const clock = () => new Date(now);
  const gate = new TeacherGate({ teachers: () => ['parent'], pin: () => '4321',
    roster: () => [{ id: 'parent', birthyear: 1984 }], clock, logger: { warn() {} } });
  const sessions = new TeacherCapabilitySessions({ teacherGate: gate, clock });
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
});
