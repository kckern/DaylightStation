import { describe, it, expect, vi, beforeEach } from 'vitest';

const info = vi.fn();
const debugFn = vi.fn();
const warn = vi.fn();
const error = vi.fn();
const child = vi.fn(() => ({ info, debug: debugFn, warn, error }));
const getLoggerMock = vi.fn(() => ({ child }));

vi.mock('../../lib/logging/Logger.js', () => ({
  default: (...args) => getLoggerMock(...args),
}));

let schoolLog;

beforeEach(async () => {
  vi.resetModules();
  info.mockClear();
  debugFn.mockClear();
  warn.mockClear();
  error.mockClear();
  child.mockClear();
  getLoggerMock.mockClear();
  ({ schoolLog } = await import('./schoolLog.js'));
});

describe('schoolLog', () => {
  it('emits school.profile.claimed at info', () => {
    schoolLog.profile('claimed', { userId: 'u1' });
    expect(info).toHaveBeenCalledWith('school.profile.claimed', expect.objectContaining({ userId: 'u1' }));
  });

  it('emits school.profile.lapsed at info', () => {
    schoolLog.profile('lapsed', { userId: 'u1' });
    expect(info).toHaveBeenCalledWith('school.profile.lapsed', expect.objectContaining({ userId: 'u1' }));
  });

  it('emits school.session.start at info', () => {
    schoolLog.session('start', { sessionId: 's1' });
    expect(info).toHaveBeenCalledWith('school.session.start', expect.objectContaining({ sessionId: 's1' }));
  });

  it('emits school.session.end at info', () => {
    schoolLog.session('end', { sessionId: 's1' });
    expect(info).toHaveBeenCalledWith('school.session.end', expect.objectContaining({ sessionId: 's1' }));
  });

  it('emits school.answer.graded at debug', () => {
    schoolLog.answer('graded', { itemId: 'q1' });
    expect(debugFn).toHaveBeenCalledWith('school.answer.graded', expect.objectContaining({ itemId: 'q1' }));
  });

  it('emits school.answer.record-failed at error', () => {
    schoolLog.answerError('record-failed', { itemId: 'q1' });
    expect(error).toHaveBeenCalledWith('school.answer.record-failed', expect.objectContaining({ itemId: 'q1' }));
  });

  it('emits school.bank.invalid at warn', () => {
    schoolLog.bank('invalid', { bankId: 'b1' });
    expect(warn).toHaveBeenCalledWith('school.bank.invalid', expect.objectContaining({ bankId: 'b1' }));
  });
});
