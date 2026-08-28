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
  // The bank writes `key` as the root pitch class ALONE and puts the flavour on
  // an axis, so `accidentalForKey(instance.key)` on its own can only ever see a
  // major tonic. Every D minor instance would be spelled with D major's two
  // sharps, and its B♭ drawn as A♯.
  const sigOf = (key, axes) => instanceKeySignature({ key, axes });
  const spellingOf = (key, axes) => accidentalForKey(sigOf(key, axes));

  it('walks a mode back to its relative major, spelled and not merely pitched', () => {
    // C aeolian's signature is E♭ major's three flats. Naming it 'D#' — the
    // same pitch, the sharp-side spelling — would answer sharp and undo the fix.
    expect(sigOf('C', { mode: 'aeolian' })).toBe('Eb');
    expect(sigOf('D', { mode: 'aeolian' })).toBe('F');
    expect(sigOf('G', { mode: 'dorian' })).toBe('F');
    expect(sigOf('A', { mode: 'dorian' })).toBe('G');
    expect(sigOf('G', { mode: 'mixolydian' })).toBe('C');
    expect(sigOf('F', { mode: 'locrian' })).toBe('Gb');
  });

  it('covers every mode the live seed publishes', () => {
    // `data/content/music/scales/modes.yml` expands over exactly these ten.
    // A mode missing from the table falls through to the root and spells as if
    // it were major — which for a flat-side mode is the wrong letter.
    const onG = {
      ionian: 'sharp', // G major, one sharp
      dorian: 'flat', // = F major, one flat
      phrygian: 'flat', // = Eb major, three flats
      lydian: 'sharp', // = D major, two sharps
      mixolydian: 'sharp', // = C major, none — nothing to flatten
      aeolian: 'flat', // = Bb major, two flats
      locrian: 'flat', // = Ab major, four flats
      'major-pentatonic': 'sharp',
      'minor-pentatonic': 'flat',
      blues: 'flat',
    };
    for (const [mode, expected] of Object.entries(onG)) {
      expect(spellingOf('G', { root: 'G', mode }), `G ${mode}`).toBe(expected);
    }
  });

  it('reads the chord vocabulary off the quality axis with the same rule', () => {
    // C minor is C-E♭-G, C dominant-7th is C-E-G-B♭: both want flats, and both
    // are read as the degree of a major scale they stand on.
    expect(spellingOf('C', { quality: 'minor' })).toBe('flat');
    expect(spellingOf('C', { quality: 'minor-7th' })).toBe('flat');
    expect(spellingOf('C', { quality: 'dominant-7th' })).toBe('flat');
    expect(spellingOf('C', { quality: 'half-diminished-7th' })).toBe('flat');
    expect(spellingOf('C', { quality: 'diminished' })).toBe('flat');
    // C-E-G♯ is in no key signature at all; it stays on its own tonic.
    expect(spellingOf('C', { quality: 'augmented' })).toBe('sharp');
    expect(spellingOf('C', { quality: 'major-7th' })).toBe('sharp');
  });

  it('is the trap it closes: the same instance read off its root alone', () => {
    for (const [key, axes] of [['D', { mode: 'aeolian' }], ['G', { mode: 'dorian' }], ['C', { quality: 'minor' }]]) {
      expect(spellingOf(key, axes), `${key} ${JSON.stringify(axes)}`).toBe('flat');
      expect(accidentalForKey(key), `${key} read off the root alone`).toBe('sharp');
    }
  });

  it('leaves major material exactly as it was — F major already answered flat', () => {
    for (const key of ['F', 'C', 'G', 'D']) {
      expect(sigOf(key, { root: key, mode: 'ionian' })).toBe(key);
    }
    expect(spellingOf('F', { mode: 'ionian' })).toBe('flat');
    expect(spellingOf('G', { mode: 'ionian' })).toBe('sharp');
    // …and an instance carrying no axes at all is the plain-key case.
    expect(instanceKeySignature({ key: 'F' })).toBe('F');
  });

  it('keeps a sharp-named root on the sharp side, which is the bank’s own spelling', () => {
    // The bank has no enharmonic intent: its roots are all sharp-named, so A♯
    // minor resolves to C♯ major (seven sharps) rather than to B♭ minor.
    expect(sigOf('A#', { mode: 'aeolian' })).toBe('C#');
    expect(spellingOf('A#', { mode: 'aeolian' })).toBe('sharp');
  });

  it('answers null for an instance with no readable key, which reads as sharps', () => {
    for (const instance of [null, undefined, {}, { key: '' }, { key: 42 }]) {
      expect(instanceKeySignature(instance)).toBeNull();
      expect(accidentalForKey(instanceKeySignature(instance))).toBe('sharp');
    }
  });

  it('leaves a flavour it has no rule for alone rather than guessing at it', () => {
    expect(sigOf('D', { mode: 'klezmer' })).toBe('D');
    expect(sigOf('D', { quality: 'sus4' })).toBe('D');
    // …and a root it cannot parse, however the flavour reads.
    expect(sigOf('H', { mode: 'aeolian' })).toBe('H');
    expect(sigOf('Cbb', { mode: 'aeolian' })).toBe('Cbb');
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
