/**
 * OMR card allocation domain (spec §5): card-instance identity, row
 * planning, and allocation-record lifecycle rules. Pure — no I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  generateCardId, CARD_ROWS, ROW_CHOICES, ROW_MAPPABLE_TYPES, ALLOCATION_STATUSES,
  planRows, rangesOverlap, checkCollision, supersedes,
} from '#domains/school/documents/allocation.mjs';

// A tiny deterministic rng stand-in for mulberry32: replays a fixed queue of
// 0..1 values, then falls back to 0 forever (used to force the all-zero /
// retry path deterministically).
function queueRng(values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

describe('constants', () => {
  it('exposes the physical card shape (spec §5.1)', () => {
    expect(CARD_ROWS).toBe(50);
    expect(ROW_CHOICES).toBe(5);
    expect(ROW_MAPPABLE_TYPES).toEqual(['multiple_choice', 'true_false', 'multi_select']);
    expect(ALLOCATION_STATUSES).toEqual(['live', 'satisfied', 'released', 'superseded']);
  });
});

describe('generateCardId', () => {
  it('returns a 7-digit string', () => {
    const id = generateCardId(queueRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]));
    expect(id).toMatch(/^\d{7}$/);
    expect(id.length).toBe(7);
  });

  it('preserves leading zeros', () => {
    // digits: 0,0,0,0,0,0,1 -> '0000001'
    const id = generateCardId(queueRng([0, 0, 0, 0, 0, 0, 0.15]));
    expect(id).toBe('0000001');
  });

  it('is deterministic for a fixed rng sequence', () => {
    const values = [0.91, 0.02, 0.55, 0.33, 0.99, 0.01, 0.44];
    const first = generateCardId(queueRng([...values]));
    const second = generateCardId(queueRng([...values]));
    expect(first).toBe(second);
  });

  it('never returns all-zero — redraws when the sequence would produce it', () => {
    // First 7 draws are all-zero (-> '0000000', rejected), next 7 produce '1234567'.
    const values = [0, 0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    const id = generateCardId(queueRng(values));
    expect(id).not.toBe('0000000');
    expect(id).toBe('1234567');
  });

  it('produces varied ids across many draws (distribution smoke test)', () => {
    let seed = 12345;
    // Simple LCG so this test doesn't depend on any production rng.
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const ids = new Set();
    for (let i = 0; i < 200; i += 1) ids.add(generateCardId(rng));
    expect(ids.size).toBeGreaterThan(150);
    for (const id of ids) {
      expect(id).toMatch(/^\d{7}$/);
      expect(id).not.toBe('0000000');
    }
  });
});

// --- planRows fixtures ---

function question({
  itemId, at = itemId, points, omr,
}) {
  const block = {
    type: 'question', itemId, number: 1, blocks: [{ type: 'rich_text', md: `prompt ${at}` }],
  };
  if (points !== undefined) block.points = points;
  if (omr !== undefined) block.omr = omr;
  return block;
}

function mcItem(id, choiceCount = 4) {
  return { id, type: 'multiple_choice', choices: Array.from({ length: choiceCount }, (_, i) => `c${i}`), answer: 'c0' };
}

function tfItem(id) {
  return { id, type: 'true_false', answer: true };
}

function multiSelectItem(id, choiceCount = 3) {
  return {
    id, type: 'multi_select', choices: Array.from({ length: choiceCount }, (_, i) => `c${i}`), answers: ['c0'],
  };
}

function shortAnswerItem(id) {
  return { id, type: 'short_answer', answer: 'because' };
}

describe('planRows — quiz archetype (all scored items must be row-mappable)', () => {
  it('plans contiguous rows in document order starting at 1', () => {
    const document = {
      archetype: 'quiz',
      blocks: [question({ itemId: 'q1' }), question({ itemId: 'q2' }), question({ itemId: 'q3' })],
    };
    const bank = { items: [mcItem('q1'), tfItem('q2'), multiSelectItem('q3')] };
    const result = planRows({ document, bank });
    expect(result.errors).toBeUndefined();
    expect(result.rows).toEqual([
      {
        row: 1, blockPath: 'blocks[0]', itemId: 'q1', itemType: 'multiple_choice', choiceCount: 4,
      },
      {
        row: 2, blockPath: 'blocks[1]', itemId: 'q2', itemType: 'true_false', choiceCount: 2,
      },
      {
        row: 3, blockPath: 'blocks[2]', itemId: 'q3', itemType: 'multi_select', choiceCount: 3,
      },
    ]);
  });

  it('honors a non-1 startRow (first-class per spec §5.3)', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'q1' })] };
    const bank = { items: [mcItem('q1')] };
    const result = planRows({ document, bank, startRow: 10 });
    expect(result.rows[0].row).toBe(10);
  });

  it('skips a question with points: 0 (unscored) even on a quiz', () => {
    const document = {
      archetype: 'quiz',
      blocks: [question({ itemId: 'q1', points: 0 }), question({ itemId: 'q2' })],
    };
    const bank = { items: [mcItem('q1'), mcItem('q2')] };
    const result = planRows({ document, bank });
    expect(result.rows).toEqual([
      {
        row: 1, blockPath: 'blocks[1]', itemId: 'q2', itemType: 'multiple_choice', choiceCount: 4,
      },
    ]);
  });

  it('treats a question as scored via the envelope defaultPoints when unset', () => {
    const document = { archetype: 'quiz', defaultPoints: 0, blocks: [question({ itemId: 'q1' })] };
    const bank = { items: [mcItem('q1')] };
    const result = planRows({ document, bank });
    expect(result.rows).toEqual([]);
  });

  it('errors when a scored quiz item resolves to a non-row-mappable bank type', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'q1' })] };
    const bank = { items: [shortAnswerItem('q1')] };
    const result = planRows({ document, bank });
    expect(result.rows).toBeUndefined();
    expect(result.errors).toEqual([
      'blocks[0]: item type "short_answer" is not row-mappable (a scored quiz item must be row-mappable)',
    ]);
  });

  it('bank-boundary spanning (rows 25/26) is not an error', () => {
    const document = {
      archetype: 'quiz',
      blocks: [question({ itemId: 'q1' }), question({ itemId: 'q2' }), question({ itemId: 'q3' })],
    };
    const bank = { items: [mcItem('q1'), mcItem('q2'), mcItem('q3')] };
    const result = planRows({ document, bank, startRow: 25 });
    expect(result.errors).toBeUndefined();
    expect(result.rows.map((r) => r.row)).toEqual([25, 26, 27]);
  });
});

describe('planRows — worksheet archetype (only omr: true questions consume rows)', () => {
  it('skips questions without omr: true, plans only the marked ones', () => {
    const document = {
      archetype: 'worksheet',
      blocks: [
        question({ itemId: 'w1' }), // no omr flag -> free-response, skipped
        question({ itemId: 'w2', omr: true }),
        question({ itemId: 'w3', omr: false }),
      ],
    };
    const bank = { items: [mcItem('w1'), tfItem('w2'), mcItem('w3')] };
    const result = planRows({ document, bank });
    expect(result.errors).toBeUndefined();
    expect(result.rows).toEqual([
      {
        row: 1, blockPath: 'blocks[1]', itemId: 'w2', itemType: 'true_false', choiceCount: 2,
      },
    ]);
  });

  it('a worksheet with no omr: true questions plans zero rows (no error)', () => {
    const document = { archetype: 'worksheet', blocks: [question({ itemId: 'w1' })] };
    const bank = { items: [shortAnswerItem('w1')] };
    const result = planRows({ document, bank });
    expect(result.errors).toBeUndefined();
    expect(result.rows).toEqual([]);
  });

  it('errors when an omr: true worksheet item resolves to a non-row-mappable type', () => {
    const document = { archetype: 'worksheet', blocks: [question({ itemId: 'w1', omr: true })] };
    const bank = { items: [shortAnswerItem('w1')] };
    const result = planRows({ document, bank });
    expect(result.errors).toEqual([
      'blocks[0]: item type "short_answer" is not row-mappable (an omr question must be row-mappable)',
    ]);
  });

  it('an infopage (or any non-quiz archetype) follows the same omr-flag rule as worksheet', () => {
    const document = { archetype: 'infopage', blocks: [question({ itemId: 'i1' })] };
    const bank = { items: [mcItem('i1')] };
    expect(planRows({ document, bank }).rows).toEqual([]);
  });
});

describe('planRows — shared validation', () => {
  it('errors on more than 5 choices for a row-mapped item', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'q1' })] };
    const bank = { items: [mcItem('q1', 6)] };
    const result = planRows({ document, bank });
    expect(result.errors).toEqual(['blocks[0]: 6 choices exceeds the 5-choice row limit']);
  });

  it('accepts exactly 5 choices (the row limit, not past it)', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'q1' })] };
    const bank = { items: [mcItem('q1', 5)] };
    const result = planRows({ document, bank });
    expect(result.errors).toBeUndefined();
    expect(result.rows[0].choiceCount).toBe(5);
  });

  it('errors when startRow + row count - 1 exceeds 50', () => {
    const document = {
      archetype: 'quiz',
      blocks: [question({ itemId: 'q1' }), question({ itemId: 'q2' })],
    };
    const bank = { items: [mcItem('q1'), mcItem('q2')] };
    const result = planRows({ document, bank, startRow: 50 });
    expect(result.errors).toEqual([
      'rows 50-51 exceed the 50-row card capacity (2 row-consuming questions starting at row 50)',
    ]);
  });

  it('accepts a plan that lands exactly on row 50', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'q1' })] };
    const bank = { items: [mcItem('q1')] };
    const result = planRows({ document, bank, startRow: 50 });
    expect(result.errors).toBeUndefined();
    expect(result.rows[0].row).toBe(50);
  });

  it('errors on startRow < 1', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'q1' })] };
    const bank = { items: [mcItem('q1')] };
    expect(planRows({ document, bank, startRow: 0 }).errors).toEqual([
      'startRow must be an integer >= 1, got 0',
    ]);
  });

  it('errors on a non-integer startRow', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'q1' })] };
    const bank = { items: [mcItem('q1')] };
    expect(planRows({ document, bank, startRow: 1.5 }).errors).toEqual([
      'startRow must be an integer >= 1, got 1.5',
    ]);
  });

  it('errors when a row-consuming question itemId is missing from the bank', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'ghost' })] };
    const bank = { items: [] };
    const result = planRows({ document, bank });
    expect(result.errors).toEqual(['blocks[0]: itemId "ghost" was not found in the bank']);
  });

  it('collects multiple errors across the document rather than stopping at the first', () => {
    const document = {
      archetype: 'quiz',
      blocks: [question({ itemId: 'q1' }), question({ itemId: 'q2' })],
    };
    const bank = { items: [shortAnswerItem('q1'), mcItem('q2', 7)] };
    const result = planRows({ document, bank });
    expect(result.errors).toEqual([
      'blocks[0]: item type "short_answer" is not row-mappable (a scored quiz item must be row-mappable)',
      'blocks[1]: 7 choices exceeds the 5-choice row limit',
    ]);
  });

  it('handles a null bank as if it had no items (every row-consuming question errors as missing)', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'q1' })] };
    const result = planRows({ document, bank: null });
    expect(result.errors).toEqual(['blocks[0]: itemId "q1" was not found in the bank']);
  });

  it('a document with no row-consuming questions plans an empty row list', () => {
    const document = { archetype: 'quiz', blocks: [question({ itemId: 'q1', points: 0 })] };
    const bank = { items: [mcItem('q1')] };
    expect(planRows({ document, bank })).toEqual({ rows: [] });
  });
});

// --- lifecycle rules (spec §5.4) ---

describe('rangesOverlap', () => {
  it('true when ranges share any row', () => {
    expect(rangesOverlap({ start: 1, end: 5 }, { start: 5, end: 10 })).toBe(true);
    expect(rangesOverlap({ start: 1, end: 10 }, { start: 3, end: 4 })).toBe(true);
  });

  it('false when ranges are disjoint', () => {
    expect(rangesOverlap({ start: 1, end: 5 }, { start: 6, end: 10 })).toBe(false);
  });

  it('is symmetric', () => {
    const a = { start: 1, end: 5 };
    const b = { start: 4, end: 8 };
    expect(rangesOverlap(a, b)).toBe(rangesOverlap(b, a));
  });
});

describe('checkCollision', () => {
  const base = {
    cardId: '1234567', startRow: 1, endRow: 10, status: 'live',
  };

  it('returns overlapping live records on the same card', () => {
    const existing = [base];
    const result = checkCollision(existing, { cardId: '1234567', startRow: 8, endRow: 20 });
    expect(result).toEqual([base]);
  });

  it('ignores non-live records even if overlapping', () => {
    const satisfied = { ...base, status: 'satisfied' };
    const released = { ...base, status: 'released' };
    const superseded = { ...base, status: 'superseded' };
    const result = checkCollision([satisfied, released, superseded], { cardId: '1234567', startRow: 1, endRow: 10 });
    expect(result).toEqual([]);
  });

  it('ignores overlapping ranges on a different card (random ids -> cross-card is a non-issue)', () => {
    const result = checkCollision([base], { cardId: '9999999', startRow: 1, endRow: 10 });
    expect(result).toEqual([]);
  });

  it('collides regardless of learner (a physical card cannot host two documents on the same rows)', () => {
    const learnerA = { ...base, documentId: 'doc-a', learnerId: 'kid-1' };
    const result = checkCollision([learnerA], {
      cardId: '1234567', startRow: 5, endRow: 6,
    });
    expect(result).toEqual([learnerA]);
  });

  it('returns no collision when ranges are disjoint on the same card', () => {
    const result = checkCollision([base], { cardId: '1234567', startRow: 11, endRow: 20 });
    expect(result).toEqual([]);
  });

  it('handles an empty existing-records list', () => {
    expect(checkCollision([], { cardId: '1234567', startRow: 1, endRow: 5 })).toEqual([]);
  });
});

describe('supersedes', () => {
  it('finds the prior live record for the same (documentId, learnerId)', () => {
    const prior = {
      documentId: 'doc-a', learnerId: 'kid-1', status: 'live', cardId: '1234567',
    };
    const result = supersedes([prior], { documentId: 'doc-a', learnerId: 'kid-1' });
    expect(result).toBe(prior);
  });

  it('returns null when no prior record matches', () => {
    const prior = { documentId: 'doc-a', learnerId: 'kid-1', status: 'live' };
    expect(supersedes([prior], { documentId: 'doc-b', learnerId: 'kid-1' })).toBeNull();
    expect(supersedes([prior], { documentId: 'doc-a', learnerId: 'kid-2' })).toBeNull();
  });

  it('ignores non-live prior records', () => {
    const prior = { documentId: 'doc-a', learnerId: 'kid-1', status: 'satisfied' };
    expect(supersedes([prior], { documentId: 'doc-a', learnerId: 'kid-1' })).toBeNull();
  });

  it('matches anonymous renders (no learnerId) of the same document to each other', () => {
    const prior = { documentId: 'doc-a', status: 'live' };
    const result = supersedes([prior], { documentId: 'doc-a' });
    expect(result).toBe(prior);
  });

  it('does not cross-match an anonymous prior with a named candidate or vice versa', () => {
    const anonPrior = { documentId: 'doc-a', status: 'live' };
    expect(supersedes([anonPrior], { documentId: 'doc-a', learnerId: 'kid-1' })).toBeNull();
    const namedPrior = { documentId: 'doc-a', learnerId: 'kid-1', status: 'live' };
    expect(supersedes([namedPrior], { documentId: 'doc-a' })).toBeNull();
  });

  it('handles an empty existing-records list', () => {
    expect(supersedes([], { documentId: 'doc-a', learnerId: 'kid-1' })).toBeNull();
  });
});
