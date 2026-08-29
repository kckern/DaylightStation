/**
 * The hand-settle gate on `GradeSubmission` (teacher console, task 1.3).
 *
 * A settle carries no verdicts, so the existing "a person marked this" block
 * never fires for one — without a gate of its own it would cost nothing at
 * all, which is the failure mode this file exists to catch. `sessions.settle`
 * is a step-up action, so the capability cookie alone is not enough.
 *
 * The assert runs BEFORE any read, so these cases need no grading fixture: a
 * session with no events reaching `unavailable` is proof the gate let the call
 * through, and a throw is proof it did not.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { GradeSubmission } from './GradeSubmission.mjs';
import { TeacherGate } from '../TeacherGate.mjs';
import { TeacherCapabilitySessions } from '../TeacherCapabilitySessions.mjs';

function fixture() {
  const clock = () => new Date('2026-08-26T10:00:00.000Z');
  const teacherGate = new TeacherGate({
    teachers: () => ['parent'], pin: () => '4321',
    roster: () => [{ id: 'parent', birthyear: 1984 }, { id: 'kid', birthyear: 2016 }],
    clock, logger: { warn() {} },
  });
  const capabilities = new TeacherCapabilitySessions({ teacherGate,
    tokenFactory: () => randomBytes(32).toString('base64url'), clock });
  teacherGate.bindCapabilitySessions(capabilities);
  const grade = new GradeSubmission({
    curriculum: { getUnit: async () => null, getDocument: async () => null },
    sessions: { readEvents: async () => [], appendEvent: async () => {} },
    reviewQueue: { listForSession: async () => [], resolve: async () => null, enqueue: async () => {} },
    grader: { openSession: () => ({ sessionId: 'q1' }), answer: () => ({ correct: true }) },
    grownUps: { assert: () => {} },
    teacherGate, clock, logger: { info() {}, warn() {}, debug() {} },
  });
  return { grade, capabilities };
}

describe('GradeSubmission — settling stuck work by hand', () => {
  it('refuses a settle with no step-up grant', async () => {
    const f = fixture();
    const unlocked = f.capabilities.unlock({ userId: 'parent', pin: '4321' });
    await expect(f.grade.execute({
      sessionId: 'ses_1', settle: true, settledBy: 'parent',
      pin: { capabilityToken: unlocked.capabilityToken },
    })).rejects.toThrow(/PIN/);
  });

  it('refuses a settle claimed by someone who is not a grown-up', async () => {
    const f = fixture();
    await expect(f.grade.execute({
      sessionId: 'ses_1', settle: true, settledBy: 'kid', pin: '4321',
    })).rejects.toThrow(/grown-up/);
  });

  it('lets a granted settle through', async () => {
    const f = fixture();
    const unlocked = f.capabilities.unlock({ userId: 'parent', pin: '4321' });
    const grant = f.capabilities.stepUp({ capabilityToken: unlocked.capabilityToken, pin: '4321',
      action: 'sessions.settle', resource: 'ses_1' });
    const result = await f.grade.execute({
      sessionId: 'ses_1', settle: true, settledBy: 'parent',
      pin: { capabilityToken: unlocked.capabilityToken, stepUpToken: grant.grantToken },
    });
    expect(result.status).toBe('unavailable');
  });

  it('leaves an unflagged call exactly as open as it always was', async () => {
    // The scan bridge and the self-closing finisher both come through here
    // with no actor at all. A gate on every call would break both.
    const f = fixture();
    const result = await f.grade.execute({ sessionId: 'ses_1' });
    expect(result.status).toBe('unavailable');
  });
});
