import { describe, expect, it } from 'vitest';
import { resolveAddressing } from './resolveAddressing.js';
import { buildScheme } from './buildScheme.js';
import { evaluateAddressing } from './addressingProgress.js';
import { DEFAULT_CHORD_SCHEME, identifyChord, squareToChord } from '../../PianoChessGame/chordAddress.js';
import { DEFAULT_STAFF_SCHEME, identifyStaffAddress, noteName, splitFor } from '../../PianoChessGame/staffAddress.js';
import { legacyAddressing as checkersLegacy } from '../../PianoCheckers/PianoCheckers.jsx';
import { legacyAddressing as connectFourLegacy, scaleRoots } from '../../PianoConnectFour/PianoConnectFour.jsx';
import { schemeForAddressing } from '../../PianoChessGame/PianoChessGame.jsx';

/**
 * The wiring, pinned.
 *
 * The resolver is only worth having if the games actually read it, and it is
 * only safe to have wired them if the DEFAULTS are byte-identical to what each
 * game shipped with. These tests are what makes "no visual change by default"
 * a fact rather than a hope.
 */

describe('the defaults are the schemes the games already shipped', () => {
  it('staff defaults reproduce DEFAULT_STAFF_SCHEME exactly', () => {
    const { scheme } = buildScheme(resolveAddressing(), { size: 8 });
    expect(scheme.roots).toEqual([...DEFAULT_STAFF_SCHEME.roots]);
    expect(scheme.qualities).toEqual([...DEFAULT_STAFF_SCHEME.qualities]);
    expect(scheme.kind).toBe('staff');
  });

  it('chord defaults reproduce DEFAULT_CHORD_SCHEME exactly', () => {
    const { scheme } = buildScheme(resolveAddressing({ game: { vocabulary: 'chords' } }), { size: 8 });
    expect(scheme.roots).toEqual([...DEFAULT_CHORD_SCHEME.roots]);
    expect(scheme.qualities).toEqual([...DEFAULT_CHORD_SCHEME.qualities]);
  });

  it("Connect Four's seven default column notes come out of the same tier", () => {
    const { scheme } = buildScheme(resolveAddressing({ axisSize: 7 }), { size: 7 });
    expect(scheme.roots).toEqual([60, 62, 64, 65, 67, 69, 71]);
  });
});

describe('chess: schemeForAddressing through the resolver', () => {
  it('keeps chords when the config says nothing, rather than dropping to the house floor', () => {
    // Chess ships `chords`; the house default is `staff`. A config that states
    // no vocabulary must not silently re-teach the player a different skill.
    const scheme = schemeForAddressing(undefined, DEFAULT_CHORD_SCHEME);
    expect(scheme.roots).toEqual([...DEFAULT_CHORD_SCHEME.roots]);
  });

  it('still honours the shipped `addressing: chords` / `staff` string', () => {
    expect(schemeForAddressing('staff', DEFAULT_CHORD_SCHEME).kind).toBe('staff');
    expect(schemeForAddressing('chords', DEFAULT_STAFF_SCHEME).kind).toBeUndefined();
  });

  it('reads a whole config block, so tiers and order reach the board', () => {
    const scheme = schemeForAddressing(
      { addressing: { vocabulary: 'staff', x: { order: 'reverse' } } },
      DEFAULT_CHORD_SCHEME,
    );
    expect(scheme.roots).toEqual([...DEFAULT_STAFF_SCHEME.roots].reverse());
  });

  it('carries the inversion policy onto the scheme the game plays with', () => {
    const scheme = schemeForAddressing({ addressing: { vocabulary: 'chords', inversions: 'named' } });
    expect(scheme.inversions).toBe('named');
  });

  it('falls back rather than handing the board a scheme that failed validation', () => {
    const broken = { id: 'broken', roots: ['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C'], qualities: ['major'] };
    const scheme = schemeForAddressing({ addressing: { scheme: broken } }, DEFAULT_CHORD_SCHEME);
    expect(scheme).toBe(DEFAULT_CHORD_SCHEME);
  });
});

describe('checkers: legacy keys read forward', () => {
  it('honours a saved pair of axes over the tier material', () => {
    const saved = { file_notes: [72, 74, 76, 77, 79, 81, 83, 84], rank_notes: [36, 38, 40, 41, 43, 45, 47, 48] };
    const legacy = checkersLegacy(saved);
    expect(legacy.scheme.roots).toEqual(saved.file_notes);
    expect(legacy.scheme.qualities).toEqual(saved.rank_notes);
  });

  it('ignores a config from before the redesign rather than half-trusting it', () => {
    // `square_notes` and nothing else: reading file_notes[0] against that shape
    // does not throw, it just makes the game permanently unresponsive.
    expect(checkersLegacy({ square_notes: Array.from({ length: 32 }, (_, i) => 48 + i) }).scheme).toBeUndefined();
    expect(checkersLegacy({ file_notes: [60, 62] }).scheme).toBeUndefined();
    expect(checkersLegacy(null).scheme).toBeUndefined();
  });

  it('reads the legacy cadence boolean forward', () => {
    expect(checkersLegacy({ shuffle_each_game: true }).shuffle_each_game).toBe(true);
  });
});

describe('connect four: legacy keys and scale ordering', () => {
  it('honours a saved column axis', () => {
    const saved = { column_notes: [72, 74, 76, 77, 79, 81, 83] };
    expect(connectFourLegacy(saved).scheme.roots).toEqual(saved.column_notes);
  });

  it('does not claim a saved axis when the config is just the default', () => {
    expect(connectFourLegacy({ column_notes: [60, 62, 64, 65, 67, 69, 71] }).scheme).toBeUndefined();
  });

  it('sorts chord roots into scale order — a row of columns is a scale, not an alphabet', () => {
    expect(scaleRoots(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Bb']))
      .toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'Bb']);
  });

  it('takes only as many roots as there are columns', () => {
    expect(scaleRoots(['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'])).toHaveLength(7);
  });
});

describe('inversions, enforced at match time', () => {
  const scheme = (inversions) => buildScheme(
    resolveAddressing({ game: { vocabulary: 'chords', inversions } }), { size: 8 },
  ).scheme;

  it('any: every voicing of the right notes addresses the square — the shipped floor', () => {
    const s = scheme('any');
    const rootPosition = identifyChord([48, 52, 55], s);   // C E G
    const firstInv = identifyChord([52, 55, 60], s);       // E G C
    const secondInv = identifyChord([55, 60, 64], s);      // G C E
    expect(rootPosition.square).toBeTruthy();
    expect(firstInv.square).toBe(rootPosition.square);
    expect(secondInv.square).toBe(rootPosition.square);
  });

  it('root: the same notes are refused unless the root is lowest', () => {
    const s = scheme('root');
    expect(identifyChord([48, 52, 55], s).square).toBeTruthy();   // C in the bass
    expect(identifyChord([52, 55, 60], s).square).toBeNull();     // E in the bass
    expect(identifyChord([55, 60, 64], s).square).toBeNull();     // G in the bass
  });

  it('named: each square wants a specific chord tone in the bass', () => {
    const s = scheme('named');
    // Whatever the board asks for, exactly one of the three voicings satisfies
    // it — the address is (root, quality, bass) now.
    const voicings = [[48, 52, 55], [52, 55, 60], [55, 60, 64]];
    const hits = voicings.map((notes) => identifyChord(notes, s).square).filter(Boolean);
    expect(hits).toHaveLength(1);
  });

  it('named: the required bass is deterministic, so a replay lands the same way', () => {
    const s = scheme('named');
    const chord = squareToChord('d5', s);
    expect(chord.required_bass).toBe(squareToChord('d5', s).required_bass);
    expect(chord.pitch_classes).toContain(chord.required_bass);
  });

  it('named: the rim prints the slash so the player can read what is wanted', () => {
    const s = scheme('named');
    const slashed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
      .flatMap((file) => [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => squareToChord(`${file}${rank}`, s).symbol))
      .filter((symbol) => symbol.includes('/'));
    // Two thirds of the board wants an inversion; root position needs no slash.
    expect(slashed.length).toBeGreaterThan(20);
  });

  it('a policy never makes an ambiguous set MORE ambiguous', () => {
    // The bass was already the tiebreak; making it load-bearing can only narrow
    // the candidate list, never widen it.
    const held = [48, 52, 55];
    const free = identifyChord(held, scheme('any')).candidates.length;
    const strict = identifyChord(held, scheme('root')).candidates.length;
    expect(strict).toBeLessThanOrEqual(free);
  });
});

describe('clef pairs are honoured, not assumed', () => {
  const built = (clefs) => buildScheme(resolveAddressing({ game: { vocabulary: 'staff', clefs } }), { size: 8 }).scheme;

  it('grand keeps the shipped split at middle C', () => {
    expect(splitFor(built('grand'))).toEqual({ boundary: 60, filesAbove: true });
  });

  it('treble-only stacks both axes above middle C, and still separates them', () => {
    const scheme = built('treble-only');
    const split = splitFor(scheme);
    expect(split).not.toBeNull();
    expect(split.boundary).toBeGreaterThan(60);
    expect(Math.min(...scheme.roots)).toBeGreaterThanOrEqual(60);
    expect(Math.min(...scheme.qualities)).toBeGreaterThan(Math.max(...scheme.roots));
  });

  it('bass-only stacks both axes below middle C', () => {
    const scheme = built('bass-only');
    expect(Math.max(...scheme.roots)).toBeLessThan(60);
    expect(Math.max(...scheme.qualities)).toBeLessThan(Math.min(...scheme.roots));
  });

  it('inverted puts the FILE in the left hand — the split reports which side is which', () => {
    const split = splitFor(built('inverted'));
    expect(split.filesAbove).toBe(false);
  });

  it('every clef pair addresses a square, rather than answering only for grand', () => {
    for (const clefs of ['grand', 'treble-only', 'bass-only', 'inverted']) {
      const scheme = built(clefs);
      const found = identifyStaffAddress([scheme.roots[3], scheme.qualities[5]], scheme);
      expect(found.square, clefs).toBeTruthy();
    }
  });

  it('refuses to guess when a scheme\'s axes overlap', () => {
    const overlapping = { kind: 'staff', roots: [60, 62, 64, 65, 67, 69, 71, 72], qualities: [60, 62, 64, 65, 67, 69, 71, 72] };
    expect(splitFor(overlapping)).toBeNull();
    expect(identifyStaffAddress([60, 62], overlapping).square).toBeNull();
  });
});

describe('the `names` vocabulary is reachable and plays', () => {
  it('rung 1 selects it', () => {
    expect(resolveAddressing({ rung: 1 }).vocabulary).toBe('names');
  });

  it('builds a valid, addressable scheme', () => {
    const built = buildScheme(resolveAddressing({ rung: 1, axisSize: 8 }), { size: 8 });
    expect(built.valid, built.errors.join('; ')).toBe(true);
    // It is a staff scheme under the hood — same 64 squares, same two-note
    // address — and only the RAIL prints differently. That is the whole point:
    // the pre-literate rung is a different label, not a different game.
    expect(built.scheme.kind).toBe('staff');
    expect(built.scheme.roots).toHaveLength(8);
  });

  it('addresses a square with the same two-note press as every other staff rung', () => {
    const { scheme } = buildScheme(resolveAddressing({ rung: 1, axisSize: 8 }), { size: 8 });
    const found = identifyStaffAddress([scheme.roots[2], scheme.qualities[4]], scheme);
    expect(found.square).toBeTruthy();
  });

  it('every axis note has a printable letter name for the rail to draw', () => {
    const { scheme } = buildScheme(resolveAddressing({ rung: 1, axisSize: 8 }), { size: 8 });
    for (const midi of [...scheme.roots, ...scheme.qualities]) {
      expect(noteName(midi), `${midi}`).toMatch(/^[A-G]#?-?\d+$/);
    }
  });
});

describe('promotion thresholds are configuration, not constants', () => {
  it('a household can tune them without a release', () => {
    const lenient = { minSamples: 3, accuracy: 0.5, medianMs: 60000 };
    const progress = { rung: 2, samples: [{ ok: true, ms: 30000 }, { ok: true, ms: 30000 }, { ok: false, ms: null }] };
    expect(evaluateAddressing(progress, lenient).verdict).toBe('promote');
    // The same play against the shipped defaults is not enough to judge on.
    expect(evaluateAddressing(progress).verdict).toBe('hold');
  });
});
