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

  it('emits school.nav.section at info', () => {
    schoolLog.nav('section', { section: 'banks' });
    expect(info).toHaveBeenCalledWith('school.nav.section', expect.objectContaining({ section: 'banks' }));
  });

  it('emits school.nav.home at info', () => {
    schoolLog.nav('home', {});
    expect(info).toHaveBeenCalledWith('school.nav.home', expect.any(Object));
  });

  it('emits school.materials.catalog-failed at info', () => {
    schoolLog.materials('catalog-failed', { status: 500 });
    expect(info).toHaveBeenCalledWith('school.materials.catalog-failed', expect.objectContaining({ status: 500 }));
  });

  it('emits school.materials.<detail> at error via materialsError', () => {
    schoolLog.materialsError('record-failed', { unitId: 'u1' });
    expect(error).toHaveBeenCalledWith('school.materials.record-failed', expect.objectContaining({ unitId: 'u1' }));
  });

  it('emits school.surface.profile-unresolved at warn', () => {
    schoolLog.surface('profile-unresolved', { screenId: 'screen-kitchen' });
    expect(warn).toHaveBeenCalledWith('school.surface.profile-unresolved', expect.objectContaining({ screenId: 'screen-kitchen' }));
  });
});

// ── Reading shelf (book-shelf UI design §7) ──────────────────────────────────
describe('schoolLog.bookShelf', () => {
  it('emits school.book-shelf.<detail> at info', () => {
    schoolLog.bookShelf('opened', { learnerId: 'kid' });
    expect(info).toHaveBeenCalledWith('school.book-shelf.opened', expect.objectContaining({ learnerId: 'kid' }));
  });

  it('emits school.book-shelf.<detail> at error via bookShelfError', () => {
    schoolLog.bookShelfError('shelf.failed', { status: 503 });
    expect(error).toHaveBeenCalledWith('school.book-shelf.shelf.failed', expect.objectContaining({ status: 503 }));
  });
});
