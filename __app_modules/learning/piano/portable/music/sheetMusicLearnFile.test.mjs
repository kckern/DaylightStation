import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeLearnFile, validateSegments, approvedSegments, approvalImpact } from './sheetMusicLearnFile.mjs';

const SHA = 'a'.repeat(64);

describe('validateSegments', () => {
  it('accepts ordered, non-overlapping, in-range segments', () => {
    assert.deepEqual(validateSegments([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }], 8), []);
  });
  it('rejects overlap, duplicate ids, reversed and out-of-range bounds', () => {
    const errors = validateSegments([
      { id: 'a', start: 0, end: 4 }, { id: 'a', start: 4, end: 6 }, { id: 'c', start: 6, end: 5 }, { id: 'd', start: 7, end: 9 },
    ], 8);
    assert.deepEqual(errors.map((e) => e.code).sort(), ['duplicate-id', 'out-of-range', 'overlap', 'reversed']);
  });
  it('requires a non-empty string id', () => {
    assert.equal(validateSegments([{ id: ' ', start: 0, end: 1 }], 4)[0].code, 'missing-id');
  });
});

describe('normalizeLearnFile', () => {
  it('returns an empty file for null', () => {
    assert.deepEqual(normalizeLearnFile(null), { version: 1, scoreId: null, contentSha256: null, segments: [], approved: null, draft: null });
  });
  it('keeps known fields and drops unknown ones', () => {
    const file = normalizeLearnFile({ version: 1, scoreId: 'files:x.mxl', contentSha256: SHA, segments: [{ id: 'a', start: 0, end: 3, name: ' Intro ', junk: 1 }], extra: true });
    assert.deepEqual(file.segments, [{ id: 'a', start: 0, end: 3, name: 'Intro' }]);
    assert.equal('extra' in file, false);
  });
  it('keeps a segment\'s parts when they are a non-empty list of hand names', () => {
    const file = normalizeLearnFile({ segments: [
      { id: 'a', start: 0, end: 3, parts: ['rh'] },
      { id: 'b', start: 4, end: 7, parts: [] },
      { id: 'c', start: 8, end: 9, parts: ['rh', 2] },
      { id: 'd', start: 10, end: 11, parts: 'rh' },
    ] });
    assert.deepEqual(file.segments.map((s) => s.parts ?? null), [['rh'], null, null, null]);
    assert.deepEqual(approvedSegments({ contentSha256: SHA, segments: [{ id: 'a', start: 0, end: 3, parts: ['rh'] }] }, SHA), [{ id: 'a', start: 0, end: 3, parts: ['rh'] }]);
  });
});

describe('approvedSegments', () => {
  const file = { contentSha256: SHA, segments: [{ id: 'a', start: 0, end: 3 }], draft: { segments: [{ id: 'z', start: 0, end: 1 }] } };
  it('returns approved segments when the content matches', () => {
    assert.deepEqual(approvedSegments(file, SHA), [{ id: 'a', start: 0, end: 3 }]);
  });
  it('returns null on a content mismatch or no approved segments', () => {
    assert.equal(approvedSegments(file, 'b'.repeat(64)), null);
    assert.equal(approvedSegments({ ...file, segments: [] }, SHA), null);
  });
  it('ignores the content check when no sha is given (server readers without the XML)', () => {
    assert.deepEqual(approvedSegments(file, undefined), [{ id: 'a', start: 0, end: 3 }]);
  });
});

describe('approvalImpact', () => {
  const summary = { total: 3, gold: 3, passages: [
    { id: 'm0-3', start: 0, end: 3, silver: 't', gold: 't' },
    { id: 'm4-7', start: 4, end: 7, silver: 't', gold: 't' },
    { id: 'm8-9', start: 8, end: 9, silver: null, gold: null },
  ] };
  it('keeps identical ranges and orphans the rest', () => {
    const impact = approvalImpact(summary, [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 9 }]);
    assert.deepEqual(impact.kept.map((p) => p.id), ['m0-3']);
    assert.deepEqual(impact.orphaned.map((p) => p.id), ['m4-7', 'm8-9']);
    assert.equal(impact.lostSilver, 1);
    assert.equal(impact.lostGold, 1);
    assert.equal(impact.wasAllGold, true);
    assert.equal(impact.allGoldAfter, false);
  });
  it('reports nothing for a learner with no summary', () => {
    assert.deepEqual(approvalImpact(null, [{ id: 'a', start: 0, end: 3 }]), { kept: [], orphaned: [], lostSilver: 0, lostGold: 0, wasAllGold: false, allGoldAfter: false });
  });
});

describe('validateSegments edge cases', () => {
  it('catches overlaps nested inside an earlier long segment', () => {
    const errors = validateSegments([{ id: 'a', start: 0, end: 10 }, { id: 'b', start: 2, end: 3 }, { id: 'c', start: 5, end: 6 }], 12);
    assert.deepEqual(errors.map((e) => [e.code, e.id]), [['overlap', 'b'], ['overlap', 'c']]);
  });
  it('reports a non-numeric bound once, without a false overlap', () => {
    const errors = validateSegments([{ id: 'b', start: 5, end: 8 }, { id: 'x', start: 'zz', end: 1 }, { id: 'a', start: 0, end: 3 }], 10);
    assert.deepEqual(errors, [{ code: 'not-integer', id: 'x', index: 1 }]);
  });
  it('flags fractional bounds as not-integer', () => {
    assert.deepEqual(validateSegments([{ id: 'a', start: 0.5, end: 2 }], 4), [{ code: 'not-integer', id: 'a', index: 0 }]);
  });
  it('rejects a missing or invalid measure count', () => {
    const expected = [{ code: 'bad-measure-count', id: null, index: -1 }];
    assert.deepEqual(validateSegments([{ id: 'a', start: 0, end: 1 }], undefined), expected);
    assert.deepEqual(validateSegments([{ id: 'a', start: 0, end: 1 }], NaN), expected);
  });
  it('rejects non-array segments instead of throwing', () => {
    assert.deepEqual(validateSegments(null, 4), [{ code: 'not-array', id: null, index: -1 }]);
  });
  it('gives every error the same shape', () => {
    const [err] = validateSegments([{ id: ' ', start: 0, end: 1 }], 4);
    assert.deepEqual(err, { code: 'missing-id', id: null, index: 0 });
  });
});

describe('approvedSegments structure checks', () => {
  it('returns null when stored segments overlap', () => {
    const file = { contentSha256: SHA, segments: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 3, end: 6 }] };
    assert.equal(approvedSegments(file, SHA), null);
  });
  it('returns valid unsorted segments sorted by start', () => {
    const file = { contentSha256: SHA, segments: [{ id: 'b', start: 4, end: 6 }, { id: 'a', start: 0, end: 3 }] };
    assert.deepEqual(approvedSegments(file, SHA).map((s) => s.id), ['a', 'b']);
  });
});

describe('approvalImpact with no segments', () => {
  it('is never all gold after approving nothing', () => {
    const summary = { total: 1, gold: 1, passages: [{ id: 'm0-3', start: 0, end: 3, silver: 't', gold: 't' }] };
    assert.equal(approvalImpact(summary, []).allGoldAfter, false);
    assert.equal(approvalImpact(summary, null).allGoldAfter, false);
  });
});
