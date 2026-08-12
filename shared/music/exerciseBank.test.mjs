import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  axisCombinations, axisValues, countBlackKeys, countInstances, deriveLevel, expandSeed,
  instanceId, instanceIds, levelsFor, materialize, materializeById, parseInstanceId, shapeOf,
} from './exerciseBank.mjs';

const TRIADS = [
  { id: 'major', intervals: [0, 4, 7] },
  { id: 'minor', intervals: [0, 3, 7] },
];

const triadSeed = {
  id: 'triads/all',
  title: 'Triads',
  key: 'C',
  staff: 'treble',
  ordering: 'any',
  supports: ['free', 'cued'],
  events: [{ notes: [{ midi: 60, hand: 'right' }, { midi: 64, hand: 'right' }, { midi: 67, hand: 'right' }] }],
  expansion: {
    axes: {
      root: { values: 'all' },
      quality: { values: TRIADS },
      inversion: { values: ['root', '1st', '2nd'] },
      staff: { values: ['treble', 'bass'] },
    },
  },
};

const scaleSeed = {
  id: 'scales/modes',
  key: 'C',
  ordering: 'strict',
  events: [0, 2, 4, 5, 7, 9, 11, 12].map((step) => ({ value: '8th', notes: [{ midi: 60 + step, hand: 'right' }] })),
  expansion: {
    axes: {
      root: { values: ['C', 'G'] },
      direction: { values: ['up', 'down', 'up-then-down'] },
      span_octaves: { values: [1, 2] },
    },
  },
};

const midis = (instance) => instance.events.flatMap((e) => e.notes.map((n) => n.midi));

describe('axis resolution', () => {
  it('resolves all and range', () => {
    assert.equal(axisValues('root', { values: 'all' }).length, 12);
    assert.deepEqual(axisValues('pitch', { values: 'range', from: 60, to: 62 }), [60, 61, 62]);
    assert.deepEqual(axisValues('x', { values: 'range', from: 5, to: 1 }), [], 'an inverted range is empty');
    assert.deepEqual(axisValues('x', null), []);
  });

  it('counts the cross product without building it', () => {
    assert.equal(countInstances(triadSeed), 12 * 2 * 3 * 2);
    assert.equal(countInstances({ }), 1, 'a seed with no axes is exactly itself');
    assert.equal(axisCombinations(triadSeed).length, countInstances(triadSeed));
  });
});

describe('instance identity', () => {
  it('is deterministic and round-trips', () => {
    const id = instanceId('triads/all', { root: 'D', quality: { id: 'minor' }, inversion: '1st' });
    assert.equal(id, 'triads/all@root=D,quality=minor,inversion=1st');
    assert.deepEqual(parseInstanceId(id), {
      seedId: 'triads/all',
      axes: { root: 'D', quality: 'minor', inversion: '1st' },
    });
  });

  it('follows declared axis order, so ids are stable', () => {
    const ids = instanceIds(triadSeed);
    assert.equal(ids.length, 144);
    assert.equal(new Set(ids).size, 144, 'every instance is distinctly addressable');
    assert.match(ids[0], /^triads\/all@root=C,quality=major,inversion=root,staff=treble$/);
  });

  it('rejects malformed ids', () => {
    assert.equal(parseInstanceId('no-at-sign').seedId, 'no-at-sign');
    assert.equal(parseInstanceId('seed@bad'), null);
    assert.equal(parseInstanceId(''), null);
    assert.equal(parseInstanceId(null), null);
  });
});

describe('chord materialization', () => {
  it('builds the prototype unchanged', () => {
    const instance = materialize(triadSeed, { root: 'C', quality: TRIADS[0], inversion: 'root' });
    assert.deepEqual(midis(instance), [60, 64, 67]);
  });

  it('applies the quality recipe before transposing', () => {
    // D minor is D-F-A. Transposing C major first would give D-F#-A.
    const instance = materialize(triadSeed, { root: 'D', quality: TRIADS[1], inversion: 'root' });
    assert.deepEqual(midis(instance), [62, 65, 69]);
  });

  it('inverts by lifting the lowest note an octave', () => {
    const first = materialize(triadSeed, { root: 'C', quality: TRIADS[0], inversion: '1st' });
    assert.deepEqual(midis(first), [64, 67, 72], 'E-G-C');
    const second = materialize(triadSeed, { root: 'C', quality: TRIADS[0], inversion: '2nd' });
    assert.deepEqual(midis(second), [67, 72, 76], 'G-C-E');
  });

  it('treats staff as notation, never as pitch', () => {
    const treble = materialize(triadSeed, { root: 'C', quality: TRIADS[0], staff: 'treble' });
    const bass = materialize(triadSeed, { root: 'C', quality: TRIADS[0], staff: 'bass' });
    assert.deepEqual(midis(bass), midis(treble), 'the same pitches, read in another clef');
    assert.equal(bass.staff, 'bass');
  });

  it('carries the chord contract onto every instance', () => {
    const instance = materialize(triadSeed, { root: 'F', quality: TRIADS[0] });
    assert.equal(instance.ordering, 'any', 'notes struck together make no claim about order');
    assert.deepEqual(instance.supports, ['free', 'cued']);
    assert.equal(instance.shape.max_simultaneity, 3);
    assert.equal(instance.shape.events, 1);
  });
});

describe('melodic materialization', () => {
  it('transposes a scale', () => {
    const instance = materialize(scaleSeed, { root: 'G', direction: 'up', span_octaves: 1 });
    assert.equal(midis(instance)[0], 67, 'starts on G');
    assert.equal(midis(instance).length, 8);
  });

  it('transposes from the declared key, not from the lowest note', () => {
    // A ii-V-I in C bottoms out on D. Anchoring on the lowest note would read
    // it as being in D and shift it ten semitones to "reach" C.
    const phrase = {
      id: 'runs/ii-v-i',
      key: 'C',
      ordering: 'strict',
      events: [62, 65, 69, 72, 71, 69, 67, 65, 64].map((midi) => ({ notes: [{ midi, hand: 'right' }] })),
      expansion: { axes: { root: { values: 'all' } } },
    };
    assert.deepEqual(midis(materialize(phrase, { root: 'C' })), [62, 65, 69, 72, 71, 69, 67, 65, 64]);
    // Into F, everything moves up a fourth and the shape is preserved.
    assert.deepEqual(midis(materialize(phrase, { root: 'F' })), [67, 70, 74, 77, 76, 74, 72, 70, 69]);
  });

  it('falls back to the lowest note when a seed declares no key', () => {
    const keyless = {
      id: 'x/keyless',
      ordering: 'strict',
      events: [60, 64, 67].map((midi) => ({ notes: [{ midi, hand: 'right' }] })),
      expansion: { axes: { root: { values: 'all' } } },
    };
    assert.deepEqual(midis(materialize(keyless, { root: 'D' })), [62, 66, 69]);
  });

  it('reverses for descending', () => {
    const up = materialize(scaleSeed, { root: 'C', direction: 'up', span_octaves: 1 });
    const down = materialize(scaleSeed, { root: 'C', direction: 'down', span_octaves: 1 });
    assert.deepEqual(midis(down), [...midis(up)].reverse());
  });

  it('does not strike the turn note twice going up-then-down', () => {
    const instance = materialize(scaleSeed, { root: 'C', direction: 'up-then-down', span_octaves: 1 });
    const played = midis(instance);
    assert.equal(played.length, 15, '8 up + 7 back, not 16');
    assert.equal(played[7], 72, 'the turn');
    assert.notEqual(played[8], 72, 'and it is not repeated');
  });

  it('spans octaves before sequencing, striking the join once', () => {
    const instance = materialize(scaleSeed, { root: 'C', direction: 'up', span_octaves: 2 });
    const played = midis(instance);
    // The degrees run 0..12, so the octave is the last note of the first block
    // and the first of the second. It is one key: 8 + 7, not 8 + 8.
    assert.equal(played.length, 15);
    assert.equal(new Set(played).size, 15, 'no key is struck twice in a row');
    assert.equal(played[7], 72, 'the join');
    assert.equal(played[8], 74, 'and the scale continues rather than repeating it');
    assert.equal(Math.max(...played), 84, 'two octaves above middle C');
  });

  it('spans octaves for material that does not end on the octave', () => {
    // A figure whose last note is not the octave above its first has no join to
    // collapse, so every repetition is kept whole.
    const figure = {
      id: 'x/figure',
      events: [0, 2, 4].map((step) => ({ notes: [{ midi: 60 + step, hand: 'right' }] })),
      expansion: { axes: { span_octaves: { values: [2] } } },
    };
    assert.equal(midis(materialize(figure, { span_octaves: 2 })).length, 6);
  });

  it('measures shape from the instance, not the seed', () => {
    const one = materialize(scaleSeed, { root: 'C', direction: 'up', span_octaves: 1 });
    const two = materialize(scaleSeed, { root: 'C', direction: 'up', span_octaves: 2 });
    assert.equal(one.shape.span_semitones, 12);
    assert.equal(two.shape.span_semitones, 24);
  });
});

describe('expansion', () => {
  it('expands every combination', () => {
    assert.equal(expandSeed(triadSeed).length, 144);
    assert.equal(expandSeed(triadSeed, { limit: 10 }).length, 10);
  });

  it('drops instances that fall off the keyboard', () => {
    const high = {
      id: 'x/high',
      events: [{ notes: [{ midi: 104, hand: 'right' }] }],
      expansion: { axes: { octave: { values: [0, 1] } } },
    };
    const expanded = expandSeed(high);
    assert.equal(expanded.length, 1, 'the octave-up instance is above the top key');
    assert.equal(materialize(high, { octave: 1 }), null);
  });

  it('rebuilds an instance from its id', () => {
    const id = 'triads/all@root=D,quality=minor,inversion=1st,staff=bass';
    const instance = materializeById(triadSeed, id);
    assert.equal(instance.id, id);
    assert.deepEqual(midis(instance), [65, 69, 74], 'F-A-D, first inversion of D minor');
  });

  it('refuses an id naming an axis or value the seed does not have', () => {
    assert.equal(materializeById(triadSeed, 'triads/all@tempo=fast'), null);
    assert.equal(materializeById(triadSeed, 'triads/all@quality=klezmer'), null);
    assert.equal(materializeById(triadSeed, 'other/seed@root=C'), null);
  });

  it('returns null rather than throwing on an empty seed', () => {
    assert.equal(materialize({ id: 'x', events: [] }, {}), null);
    assert.equal(materialize(null, {}), null);
  });
});

describe('level', () => {
  const shape = (over = {}) => ({ events: 1, notes: 1, max_simultaneity: 1, hands: 'right', span_semitones: 0, ...over });

  it('puts a single note on the floor', () => {
    assert.equal(deriveLevel(shape()), 1);
  });

  it('never leaves the 1-10 scale', () => {
    const hardest = shape({ events: 64, max_simultaneity: 5, hands: 'both', hand_independence: 'independent', span_semitones: 48 });
    const level = deriveLevel(hardest, { mode: 'cued', tempo: { target_bpm: 200 }, blackKeys: 5, positionShifts: 4 });
    assert.ok(level <= 10 && level >= 1, `got ${level}`);
    assert.equal(deriveLevel(shape(), { mode: 'free' }), 1, 'and the floor holds');
  });

  it('charges more for strictness than for anything else', () => {
    const base = shape({ events: 8 });
    assert.ok(deriveLevel(base, { mode: 'cued' }) > deriveLevel(base, { mode: 'metronome' }));
    assert.ok(deriveLevel(base, { mode: 'metronome' }) > deriveLevel(base, { mode: 'free' }));
  });

  it('charges for hands, and more when they disagree', () => {
    const one = deriveLevel(shape({ events: 8 }));
    const parallel = deriveLevel(shape({ events: 8, hands: 'both', hand_independence: 'parallel' }));
    const independent = deriveLevel(shape({ events: 8, hands: 'both', hand_independence: 'independent' }));
    assert.ok(independent > parallel && parallel > one);
  });

  it('counts black keys as physical keys, not notated accidentals', () => {
    // Every major triad has no accidentals against its own root, but F-sharp
    // major is three black keys and C major is none.
    assert.equal(countBlackKeys([{ notes: [{ midi: 60 }, { midi: 64 }, { midi: 67 }] }]), 0, 'C major');
    assert.equal(countBlackKeys([{ notes: [{ midi: 66 }, { midi: 70 }, { midi: 73 }] }]), 3, 'F# major');
    // Doubling a black key does not make it a second black key to find.
    assert.equal(countBlackKeys([{ notes: [{ midi: 66 }, { midi: 78 }] }]), 1);
  });

  it('gives a level per supported mode, never one for the item alone', () => {
    const levels = levelsFor(shape({ events: 8 }), { supports: ['free', 'metronome', 'cued'] });
    assert.deepEqual(Object.keys(levels), ['free', 'metronome', 'cued']);
    assert.ok(levels.cued > levels.free);
    // A mode the item does not support gets no level.
    assert.deepEqual(Object.keys(levelsFor(shape(), { supports: ['free'] })), ['free']);
    assert.deepEqual(levelsFor(shape(), { supports: ['nonsense'] }), {});
  });

  it('levels an instance from its own notes, not its seed', () => {
    const easy = materialize(triadSeed, { root: 'C', quality: TRIADS[0], inversion: 'root' });
    const hard = materialize(triadSeed, { root: 'F#', quality: TRIADS[0], inversion: 'root' });
    assert.ok(hard.level.free > easy.level.free, 'F# major is three black keys; C major is none');
  });
});

describe('shapeOf', () => {
  it('reports both hands when both are present', () => {
    const shape = shapeOf([{ notes: [{ midi: 48, hand: 'left' }, { midi: 72, hand: 'right' }] }]);
    assert.equal(shape.hands, 'both');
    assert.equal(shape.max_simultaneity, 2);
    assert.equal(shape.span_semitones, 24);
  });
});
