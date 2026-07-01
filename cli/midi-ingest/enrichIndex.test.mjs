import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enrichIndex } from './enrichIndex.mjs';

const BAR = 480 * 4;
// C major bar then A minor bar → I, vi in C.
const cMajThenAMin = [
  { ticks: 0, durationTicks: 240, midi: 60 },
  { ticks: 0, durationTicks: 240, midi: 64 },
  { ticks: 0, durationTicks: 240, midi: 67 },
  { ticks: BAR, durationTicks: 240, midi: 69 },
  { ticks: BAR, durationTicks: 240, midi: 60 },
  { ticks: BAR, durationTicks: 240, midi: 64 },
];

describe('enrichIndex', () => {
  it('classifies a melody with no authored roman and preserves an authored one', () => {
    const entries = [
      { slug: 'quick-moves-7-1-7-6-stepwise-walkdown', roman: null, type: 'melody', path: 'a.mid' },
      { slug: 'am-f-g-am', roman: ['iii', 'I', 'II', 'iii'], type: 'chord-progression', path: 'b.mid' },
    ];
    const loadNotes = (e) => (e.path === 'a.mid'
      ? { notes: cMajThenAMin, ppq: 480, timeSig: { beats: 4, beatType: 4 } }
      : null);
    const out = enrichIndex(entries, loadNotes);

    // Melody: inferred roman + signature + barSpan + title.
    assert.deepEqual(out[0].roman, ['I', 'vi']);
    assert.equal(out[0].signature, 'I-vi');
    assert.equal(out[0].barSpan, 2);
    assert.equal(out[0].title, 'Quick Moves · Stepwise Walkdown');

    // Chord entry: authored roman preserved, signature derived, title added.
    assert.deepEqual(out[1].roman, ['iii', 'I', 'II', 'iii']);
    assert.equal(out[1].signature, 'iii-I-II-iii');
    assert.equal(out[1].title, 'Am F · G Am');
  });

  it('does not mutate the input entries', () => {
    const entries = [{ slug: 'x', roman: null, type: 'melody', path: 'x.mid' }];
    enrichIndex(entries, () => null);
    assert.equal('signature' in entries[0], false);
  });

  it('leaves roman null when the loop is unreadable (loader returns null)', () => {
    const entries = [{ slug: 'gone', roman: null, type: 'melody', path: 'gone.mid' }];
    const out = enrichIndex(entries, () => null);
    assert.equal(out[0].roman, null);
    assert.equal(out[0].signature, null);
    assert.equal(out[0].title, 'Gone');
  });
});
