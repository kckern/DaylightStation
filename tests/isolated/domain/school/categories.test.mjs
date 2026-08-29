import { describe, it, expect, vi } from 'vitest';
import { CATEGORIES, resolveCategory } from '#domains/school/categories.mjs';

describe('CATEGORIES', () => {
  it('is the closed spec §3 table: course, reference, listening', () => {
    expect(Object.keys(CATEGORIES).sort()).toEqual(['course', 'listening', 'reference']);
  });

  it('course: sequential, gated, completion requires played+gate, credits coins+curriculum', () => {
    expect(CATEGORIES.course).toEqual({
      sequential: true,
      gated: true,
      completion: ['played', 'gate'],
      credit: { coins: true, curriculum: true },
    });
  });

  it('reference: not sequential, not gated, nothing completes, no credit', () => {
    expect(CATEGORIES.reference).toEqual({
      sequential: false,
      gated: false,
      completion: [],
      credit: { coins: false, curriculum: false },
    });
  });

  it('listening: SEQUENTIAL (watch in order) but not gated, completion played only, no credit', () => {
    expect(CATEGORIES.listening).toEqual({
      sequential: true,
      gated: false,
      completion: ['played'],
      credit: { coins: false, curriculum: false },
    });
  });
});

describe('resolveCategory', () => {
  it('known category resolves without warning', () => {
    const logger = { warn: vi.fn() };
    const result = resolveCategory('course', { logger, sourceLabel: 'Shakespeare Tales' });
    expect(result).toEqual({ key: 'course', def: CATEGORIES.course });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('unknown category falls back to reference', () => {
    const result = resolveCategory('coures');
    expect(result).toEqual({ key: 'reference', def: CATEGORIES.reference });
  });

  it('missing category name falls back to reference', () => {
    const result = resolveCategory(undefined);
    expect(result).toEqual({ key: 'reference', def: CATEGORIES.reference });
  });
});
