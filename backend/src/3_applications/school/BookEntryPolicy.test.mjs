import { describe, it, expect, vi } from 'vitest';
import { BookEntryPolicy } from './BookEntryPolicy.mjs';

const ISBN = '9780064400558';
const policy = ({ manual = false, scanned = () => false, logger = { warn: vi.fn() } } = {}) =>
  new BookEntryPolicy({ manualEntryAllowed: () => manual, scanned, logger });

describe('BookEntryPolicy', () => {
  it('allows any book while manual entry is on, and says so', () => {
    const p = policy({ manual: true });
    expect(p.describe()).toEqual({ manual: true });
    expect(() => p.assertMayOpen({ learnerId: 'kid', bookId: '9780123456786' })).not.toThrow();
  });

  it('refuses a typed book when scan-only, as a 403 the panel can show', () => {
    const logger = { warn: vi.fn() };
    const p = policy({ logger });
    expect(p.describe()).toEqual({ manual: false });
    expect(() => p.assertMayOpen({ learnerId: 'kid', bookId: '9780123456786' }))
      .toThrow(expect.objectContaining({ status: 403, name: 'AuthorizationError', message: expect.stringMatching(/Scan the barcode/) }));
    expect(logger.warn).toHaveBeenCalledWith('school.book-log.manual-entry-refused', { learnerId: 'kid', bookId: '9780123456786' });
  });

  it('allows the book this learner scanned, normalising the identifier first', () => {
    const scanned = vi.fn(({ learnerId, isbn13 }) => learnerId === 'kid' && isbn13 === ISBN);
    const p = policy({ scanned });
    expect(() => p.assertMayOpen({ learnerId: 'kid', bookId: ISBN })).not.toThrow();
    expect(() => p.assertMayOpen({ learnerId: 'kid', bookId: '0-06-440055-7' })).not.toThrow();
    expect(() => p.assertMayOpen({ learnerId: 'sibling', bookId: ISBN })).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('refuses a missing or non-ISBN book id without asking the scan store', () => {
    const scanned = vi.fn(() => true);
    const p = policy({ scanned });
    expect(() => p.assertMayOpen({ learnerId: 'kid', bookId: undefined })).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => p.assertMayOpen({ learnerId: 'kid', bookId: 'not-a-book' })).toThrow(expect.objectContaining({ status: 403 }));
    expect(scanned).not.toHaveBeenCalled();
  });

  it('fails closed when the flag cannot be read', () => {
    const p = new BookEntryPolicy({ manualEntryAllowed: () => { throw new Error('config'); }, scanned: () => false });
    expect(p.describe()).toEqual({ manual: false });
  });
});
