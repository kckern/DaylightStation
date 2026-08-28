import { describe, expect, it } from 'vitest';
import {
  accidentalForKey,
  instanceKeySignature,
  clefForAsk,
  deriveRunTier,
  eventsToStaffNotes,
  staffFitsAsk,
  stageForTier,
} from './runPresentation.js';

const event = (...midis) => ({ notes: midis.map((midi) => ({ midi })) });

describe('accidentalForKey', () => {
  // The reason this helper exists: SvgSequenceStaff's `accidental` default is
  // 'sharp', so a B♭ in F major renders as A♯ — a wrong letter on a reading
  // surface for a child who is learning exactly that letter.
  it.each([
    ['F', 'flat'], ['Bb', 'flat'], ['Eb', 'flat'], ['Ab', 'flat'], ['Db', 'flat'], ['Gb', 'flat'],
    ['C', 'sharp'], ['G', 'sharp'], ['D', 'sharp'], ['A', 'sharp'], ['E', 'sharp'], ['B', 'sharp'],
    ['F#', 'sharp'], ['C#', 'sharp'],
  ])('spells %s as %s', (key, expected) => {
    expect(accidentalForKey(key)).toBe(expected);
  });

  it('reads the minor keys off their own signatures, not their letters', () => {
    // D minor carries one flat; D major carries two sharps. The letter alone
    // cannot tell them apart, which is the whole trap here.
    expect(accidentalForKey('D minor')).toBe('flat');
    expect(accidentalForKey('Dm')).toBe('flat');
    expect(accidentalForKey('D')).toBe('sharp');
    expect(accidentalForKey('G minor')).toBe('flat');
    expect(accidentalForKey('C minor')).toBe('flat');
    expect(accidentalForKey('F minor')).toBe('flat');
    expect(accidentalForKey('A minor')).toBe('sharp');
    expect(accidentalForKey('E minor')).toBe('sharp');
  });

  it('accepts the unicode signs and stray casing an authored key can carry', () => {
    expect(accidentalForKey('B♭')).toBe('flat');
    expect(accidentalForKey('  eb  ')).toBe('flat');
    expect(accidentalForKey('F♯')).toBe('sharp');
    expect(accidentalForKey('f major')).toBe('flat');
  });

  it('falls back to sharps for anything it cannot read, never to a coin flip', () => {
    for (const key of [null, undefined, '', 'H', 42, {}]) expect(accidentalForKey(key)).toBe('sharp');
  });
});

describe('instanceKeySignature — re-joining the key the bank splits in two', () => {
  // The bank writes `key` as the root pitch class ALONE and puts the quality on
  // an axis, so `accidentalForKey(instance.key)` on its own can never reach its
  // minor branch. Every D minor instance would be spelled with D major's two
  // sharps, and its B♭ drawn as A♯.
  it('reads the minor off the mode axis a scale instance carries', () => {
    const dMinor = { key: 'D', axes: { root: 'D', mode: 'aeolian' } };
    expect(instanceKeySignature(dMinor)).toBe('D minor');
    expect(accidentalForKey(instanceKeySignature(dMinor))).toBe('flat');
    // …and without it, the trap this closes.
    expect(accidentalForKey(dMinor.key)).toBe('sharp');
  });

  it('reads it off the quality axis a chord instance carries instead', () => {
    expect(instanceKeySignature({ key: 'G', axes: { quality: 'minor' } })).toBe('G minor');
    expect(accidentalForKey(instanceKeySignature({ key: 'G', axes: { quality: 'minor' } }))).toBe('flat');
  });

  it('leaves major material exactly as it was — F major already answered flat', () => {
    for (const [key, mode] of [['F', 'ionian'], ['C', 'ionian'], ['G', 'ionian'], ['D', 'ionian']]) {
      expect(instanceKeySignature({ key, axes: { root: key, mode } })).toBe(key);
    }
    expect(accidentalForKey(instanceKeySignature({ key: 'F', axes: { mode: 'ionian' } }))).toBe('flat');
    expect(accidentalForKey(instanceKeySignature({ key: 'G', axes: { mode: 'ionian' } }))).toBe('sharp');
  });

  it('answers null for an instance with no readable key, which reads as sharps', () => {
    for (const instance of [null, undefined, {}, { key: '' }, { key: 42 }]) {
      expect(instanceKeySignature(instance)).toBeNull();
      expect(accidentalForKey(instanceKeySignature(instance))).toBe('sharp');
    }
  });

  it('leaves a mode it has no rule for alone rather than guessing at it', () => {
    // Dorian and mixolydian carry flats or sharps depending on the root; the
    // helper says nothing about them rather than inventing an answer.
    expect(instanceKeySignature({ key: 'D', axes: { mode: 'dorian' } })).toBe('D');
  });
});

describe('clefForAsk / staffFitsAsk', () => {
  it('puts an ask that sits inside the treble window on a treble staff', () => {
    expect(clefForAsk([event(60), event(64), event(67)])).toBe('treble');
    expect(staffFitsAsk([event(60), event(64), event(67)])).toBe(true);
  });

  it('puts a low ask on a bass staff', () => {
    expect(clefForAsk([event(43), event(47), event(50)])).toBe('bass');
    expect(staffFitsAsk([event(43), event(47), event(50)])).toBe(true);
  });

  it('refuses an ask that no single clef holds', () => {
    // C2 and C6 cannot share a staff without ledger lines nobody can count.
    expect(clefForAsk([event(36), event(84)])).toBeNull();
    expect(staffFitsAsk([event(36), event(84)])).toBe(false);
  });

  it('refuses an ask wider than an octave even when one clef would hold it', () => {
    // 60..79 fits the treble window, but a two-key reading task that wide is
    // not the small reinforcement staff tier 1 promises.
    expect(clefForAsk([event(60), event(79)])).toBe('treble');
    expect(staffFitsAsk([event(60), event(79)])).toBe(false);
  });

  it('has nothing to draw for an empty ask', () => {
    expect(staffFitsAsk([])).toBe(false);
    expect(clefForAsk([])).toBeNull();
  });
});

describe('eventsToStaffNotes', () => {
  it('gives one entry per event, and a chord entry when an event carries several notes', () => {
    expect(eventsToStaffNotes([event(60), event(64, 67)])).toEqual([
      { midi: 60 },
      { midis: [64, 67] },
    ]);
  });
});

describe('deriveRunTier', () => {
  it('reads a cued ask as tier 3 and everything else sequential as tier 2', () => {
    expect(deriveRunTier({ ordering: 'strict' }, 'cued')).toBe(3);
    expect(deriveRunTier({ ordering: 'strict' }, 'free')).toBe(2);
    expect(deriveRunTier({ ordering: 'strict' }, 'metronome')).toBe(2);
  });

  it('reads ordering:any material as tier 1 — lit keys, not a grand staff', () => {
    // This is what makes instanceToAbc's `ordering:'any'` grand-staff branch
    // unreachable: no tier this derives ever routes that material to the ABC
    // renderer.
    expect(deriveRunTier({ ordering: 'any' }, 'free')).toBe(1);
    expect(deriveRunTier({ ordering: 'any' }, 'cued')).toBe(1);
  });
});

describe('stageForTier', () => {
  const strict = { ordering: 'strict' };
  it.each([
    [0, 'keys'], [1, 'keys'], [2, 'sequence'], [3, 'notation'],
  ])('tier %i renders the %s stage', (tier, stage) => {
    expect(stageForTier(tier, strict)).toBe(stage);
  });

  it('sends ordering:any material to the keys stage at every tier', () => {
    // Even a host that names tier 3 explicitly: there is no notation for an
    // unordered ask, which is the branch this surface is retiring.
    for (const tier of [0, 1, 2, 3]) expect(stageForTier(tier, { ordering: 'any' })).toBe('keys');
  });
});
