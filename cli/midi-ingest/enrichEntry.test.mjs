import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enrichEntry, titleFromSlug } from './enrichEntry.mjs';

describe('titleFromSlug', () => {
  it('humanizes a slug, stripping degree digits, artist noise and bpm', () => {
    assert.equal(
      titleFromSlug('rock-melody-11-intenseawesomebassline-niko-kotoulas-140bpm'),
      'Rock Melody Bassline',
    );
    assert.equal(titleFromSlug('quick-moves-7-1-7-6-stepwise-walkdown'), 'Quick Moves · Stepwise Walkdown');
  });
});

describe('enrichEntry', () => {
  it('keeps an authored roman and just adds signature/barSpan/title', () => {
    const entry = { slug: 'am-f-g-am', roman: ['iii', 'I', 'II', 'iii'], type: 'chord-progression' };
    const out = enrichEntry(entry, { classified: null });
    assert.deepEqual(out.roman, ['iii', 'I', 'II', 'iii']);
    assert.equal(out.signature, 'iii-I-II-iii');
    assert.equal(out.title, 'Am F · G Am');
  });
  it('fills roman/signature/barSpan from the classifier when roman is null and confidence is high', () => {
    const entry = { slug: 'quick-moves-7-1-7-6-stepwise-walkdown', roman: null, type: 'melody' };
    const classified = { roman: ['I', 'vi'], barSpan: 2, signature: 'I-vi', confidence: 0.9 };
    const out = enrichEntry(entry, { classified, minConfidence: 0.6 });
    assert.deepEqual(out.roman, ['I', 'vi']);
    assert.equal(out.signature, 'I-vi');
    assert.equal(out.barSpan, 2);
    assert.equal(out.harmonyConfidence, 0.9);
  });
  it('leaves roman null when classifier confidence is below threshold', () => {
    const entry = { slug: 'pouring-rain', roman: null, type: 'melody' };
    const classified = { roman: ['I', '?'], barSpan: 2, signature: 'I', confidence: 0.4 };
    const out = enrichEntry(entry, { classified, minConfidence: 0.6 });
    assert.equal(out.roman, null);
    assert.equal(out.signature, null);
  });
});
