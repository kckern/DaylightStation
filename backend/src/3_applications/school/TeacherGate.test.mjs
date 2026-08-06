import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeacherGate } from './TeacherGate.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

const roster = () => [
  { id: 'kckern', name: 'KC', birthyear: 1984 },
  { id: 'liz', name: 'Elizabeth', birthyear: 1986 },
  { id: 'felix', name: 'Felix', birthyear: 2014 },
];

let logger;
beforeEach(() => { logger = { warn: vi.fn() }; });

const gate = ({ teachers = () => ['kckern'], pin = () => '4321' } = {}) => (
  new TeacherGate({ teachers, pin, roster, logger })
);

describe('TeacherGate', () => {
  it('a listed adult with the right pin passes', () => {
    expect(() => gate().assert({ userId: 'kckern', pin: '4321', action: 'review.resolve' })).not.toThrow();
  });

  it('a child is refused even if listed', () => {
    const g = gate({ teachers: () => ['felix'] });
    expect(() => g.assert({ userId: 'felix', pin: '4321', action: 'x' })).toThrow(GuestForbiddenError);
  });

  it('an unlisted adult is refused only when the teachers key exists', () => {
    expect(() => gate().assert({ userId: 'liz', pin: '4321', action: 'x' })).toThrow(GuestForbiddenError);
    const noKey = gate({ teachers: () => undefined });
    expect(() => noKey.assert({ userId: 'liz', pin: '4321', action: 'x' })).not.toThrow();
  });

  it('a wrong or missing pin is refused only when a pin is configured', () => {
    expect(() => gate().assert({ userId: 'kckern', pin: '9999', action: 'x' })).toThrow(GuestForbiddenError);
    expect(() => gate().assert({ userId: 'kckern', action: 'x' })).toThrow(GuestForbiddenError);
    const noPin = gate({ pin: () => null });
    expect(() => noPin.assert({ userId: 'kckern', action: 'x' })).not.toThrow();
  });

  it('an unreadable roster refuses everyone', () => {
    const g = new TeacherGate({ teachers: () => ['kckern'], pin: () => null, roster: () => { throw new Error('boom'); }, logger });
    expect(() => g.assert({ userId: 'kckern', action: 'x' })).toThrow(GuestForbiddenError);
  });

  it('the pin never appears in the refusal message or the log payload', () => {
    let thrown;
    try {
      gate().assert({ userId: 'kckern', pin: 'sekret99', action: 'x' });
    } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(GuestForbiddenError);
    expect(thrown.message).not.toContain('sekret99');
    expect(thrown.message).not.toContain('4321');
    for (const call of logger.warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('sekret99');
      expect(JSON.stringify(call)).not.toContain('4321');
    }
  });

  it('every refusal logs the action and reason', () => {
    try { gate().assert({ userId: 'liz', pin: '4321', action: 'assignments.edit' }); } catch { /* expected */ }
    expect(logger.warn).toHaveBeenCalledWith('school.teacher-gate.refused',
      expect.objectContaining({ action: 'assignments.edit', userId: 'liz', reason: 'not-a-teacher' }));
  });

  it('config is read per call, never snapshotted', () => {
    let list = ['kckern'];
    const g = gate({ teachers: () => list, pin: () => null });
    expect(() => g.assert({ userId: 'liz', action: 'x' })).toThrow();
    list = ['kckern', 'liz'];
    expect(() => g.assert({ userId: 'liz', action: 'x' })).not.toThrow();
  });
});
