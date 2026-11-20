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
