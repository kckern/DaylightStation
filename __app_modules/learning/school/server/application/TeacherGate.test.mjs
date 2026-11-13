import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeacherGate } from "./TeacherGate.mjs";
import { GuestForbiddenError } from "../domain/errors.mjs";

const roster = () => [
  { id: 'kckern', name: 'KC', birthyear: 1984 },
  { id: 'liz', name: 'User_9', birthyear: 1986 },
  { id: 'learner4', name: 'Learner4', birthyear: 2014 },
];

let logger;
beforeEach(() => { logger = { warn: vi.fn() }; });

const gate = ({ teachers = () => ['kckern'] } = {}) => (
  new TeacherGate({ teachers, roster, logger })
);

describe('TeacherGate', () => {
  it('a listed adult passes', () => {
    expect(() => gate().assert({ userId: 'kckern', action: 'review.resolve' })).not.toThrow();
  });

  it('a child is refused even if listed', () => {
    const g = gate({ teachers: () => ['learner4'] });
    expect(() => g.assert({ userId: 'learner4', action: 'x' })).toThrow(GuestForbiddenError);
  });

  it('an unlisted adult is refused only when the teachers key exists', () => {
    expect(() => gate().assert({ userId: 'liz', action: 'x' })).toThrow(GuestForbiddenError);
    const noKey = gate({ teachers: () => undefined });
    expect(() => noKey.assert({ userId: 'liz', action: 'x' })).not.toThrow();
  });

  it('an unreadable roster refuses everyone', () => {
    const g = new TeacherGate({ teachers: () => ['kckern'], roster: () => { throw new Error('boom'); }, logger });
    expect(() => g.assert({ userId: 'kckern', action: 'x' })).toThrow(GuestForbiddenError);
  });

  it('every refusal logs the action and reason', () => {
    try { gate().assert({ userId: 'liz', action: 'assignments.edit' }); } catch { /* expected */ }
    expect(logger.warn).toHaveBeenCalledWith('school.teacher-gate.refused',
      expect.objectContaining({ action: 'assignments.edit', userId: 'liz', reason: 'not-a-teacher' }));
  });

  it('config is read per call, never snapshotted', () => {
    let list = ['kckern'];
    const g = gate({ teachers: () => list });
    expect(() => g.assert({ userId: 'liz', action: 'x' })).toThrow();
    list = ['kckern', 'liz'];
    expect(() => g.assert({ userId: 'liz', action: 'x' })).not.toThrow();
  });
});
