import { describe, it, expect, vi, beforeEach } from 'vitest';

const info = vi.fn();
const debugFn = vi.fn();
const warn = vi.fn();
const error = vi.fn();
const child = vi.fn(() => ({ info, debug: debugFn, warn, error }));
const getLoggerMock = vi.fn(() => ({ child }));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: (...args) => getLoggerMock(...args),
}));

let teacherLog;

beforeEach(async () => {
  vi.resetModules();
  [info, debugFn, warn, error, child, getLoggerMock].forEach((m) => m.mockClear());
  ({ teacherLog } = await import('./teacherLog.js'));
});

describe('teacherLog write category', () => {
  it('emits a successful write at info under teacher.write.*', () => {
    teacherLog.write('saved', { panel: 'enrollment', learnerId: 'learner-b' });
    expect(info).toHaveBeenCalledWith('teacher.write.saved', {
      panel: 'enrollment', learnerId: 'learner-b', detail: 'saved',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('emits a refusal at warn, not error — a refused write is not a broken console', () => {
    teacherLog.writeRefused('blocked-on-pin', { panel: 'enrollment', status: 403 });
    expect(warn).toHaveBeenCalledWith('teacher.write.blocked-on-pin', {
      panel: 'enrollment', status: 403, detail: 'blocked-on-pin',
    });
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('shares one filterable prefix with the refusal path, so a write reads as one story', () => {
    teacherLog.write('saved', { learnerId: 'learner-b' });
    teacherLog.writeRefused('refused', { learnerId: 'learner-b' });
    const events = [...info.mock.calls, ...warn.mock.calls].map(([e]) => e);
    expect(events.every((e) => e.startsWith('teacher.write.'))).toBe(true);
  });

  it('tolerates a missing payload', () => {
    expect(() => teacherLog.write('saved')).not.toThrow();
    expect(info).toHaveBeenCalledWith('teacher.write.saved', { detail: 'saved' });
  });

  it('scopes the console apart from the kids app', () => {
    teacherLog.write('saved', {});
    expect(child).toHaveBeenCalledWith({ component: 'school-teacher' });
  });
});
