// MusicNotation — ABC string generation (pure).
//
// Extracted verbatim (behavior-preserving) from
// modules/Piano/components/CurrentChordStaff.jsx. Consumes the shared model
// (key signatures, hand split, ottava). The abcjs render call lives in
// AbcRenderer.jsx; this module is pure string-building so it can be unit-tested.

import { KEY_SIGNATURES, NATURAL_NOTES, PITCH_TO_NATURAL } from '../model/keySignature.js';
import { splitByHand, getOttavaInfo } from '../model/handSplit.js';

/**
 * Convert a MIDI note to ABC notation, key-signature aware.
 * C4 (MIDI 60) = 'C' in ABC.
 */
export const midiToAbc = (midiNote, keySignature = null) => {
  const pitchClass = midiNote % 12;
  const octave = Math.floor(midiNote / 12) - 1;

  const keyData = keySignature ? KEY_SIGNATURES[keySignature] : KEY_SIGNATURES['C'];
  const sharps = new Set(keyData?.sharps || []);
  const flats = new Set(keyData?.flats || []);
  const scale = new Set(keyData?.scale || [0, 2, 4, 5, 7, 9, 11]);

  let noteName;
  let accidental = '';

  const isInScale = scale.has(pitchClass);

  if (isInScale) {
    if (sharps.has(pitchClass)) {
      const naturalIndex = PITCH_TO_NATURAL[pitchClass];
      noteName = NATURAL_NOTES[naturalIndex];
    } else if (flats.has(pitchClass)) {
      const naturalIndex = (PITCH_TO_NATURAL[pitchClass] + 1) % 7;
      noteName = NATURAL_NOTES[naturalIndex];
    } else {
      const naturalIndex = PITCH_TO_NATURAL[pitchClass];
      noteName = NATURAL_NOTES[naturalIndex];
    }
  } else {
    const isSharp = [1, 3, 6, 8, 10].includes(pitchClass);

    if (isSharp) {
      const naturalPc = pitchClass - 1;
      if (sharps.has(naturalPc)) {
        const naturalIndex = PITCH_TO_NATURAL[pitchClass];
        noteName = NATURAL_NOTES[naturalIndex];
        accidental = '^';
      } else {
        const naturalIndex = PITCH_TO_NATURAL[pitchClass];
        noteName = NATURAL_NOTES[naturalIndex];
        accidental = '^';
      }
    } else {
      const naturalIndex = PITCH_TO_NATURAL[pitchClass];
      noteName = NATURAL_NOTES[naturalIndex];

      if (sharps.has(pitchClass) || flats.has(pitchClass)) {
        accidental = '=';
      } else if (sharps.has(pitchClass + 1)) {
        for (const sharpPc of sharps) {
          if (sharpPc - 1 === pitchClass) {
            accidental = '=';
            break;
          }
        }
      }
    }
  }

  let abc;
  if (octave >= 5) {
    abc = accidental + noteName.toLowerCase();
    abc += "'".repeat(octave - 5);
  } else if (octave === 4) {
    abc = accidental + noteName;
  } else {
    abc = accidental + noteName + ",".repeat(4 - octave);
  }

  return abc;
};

/**
 * Generate a single melodic staff directly from the MIDI pitches used for
 * grading. This deliberately prevents an exercise from authoring one melody
 * for the player to see and a second, divergent melody for the matcher.
 */
export const generateScaleAbc = (midiNotes, keySignature = 'C') => {
  if (!Array.isArray(midiNotes) || midiNotes.length === 0) return '';
  const melody = midiNotes.map((note) => midiToAbc(note, keySignature)).join(' ');
  return `X:1\nL:1/4\nK:${keySignature}\n${melody} |]`;
};

/**
 * Generate ABC notation for a grand staff with the current notes.
 * Always shows both treble and bass clefs with a closing bar line.
 * @param {Map} activeNotes - Map of MIDI note numbers to note data
 * @param {string} keySignature - e.g. 'G', 'F', 'C'
 */
export const generateAbc = (activeNotes, keySignature = 'C') => {
  const notes = Array.from(activeNotes.keys()).sort((a, b) => a - b);

  const { bassNotes, trebleNotes } = splitByHand(notes);

  const trebleOttava = getOttavaInfo(trebleNotes, true);
  const bassOttava = getOttavaInfo(bassNotes, false);

  const displayTrebleNotes = trebleOttava.octaves > 0
    ? trebleNotes.map(n => n - (trebleOttava.octaves * 12))
    : trebleNotes;
  const displayBassNotes = bassOttava.octaves > 0
    ? bassNotes.map(n => n + (bassOttava.octaves * 12))
    : bassNotes;

  const trebleAbc = displayTrebleNotes.length > 0
    ? (displayTrebleNotes.length === 1
        ? midiToAbc(displayTrebleNotes[0], keySignature)
        : '[' + displayTrebleNotes.map(n => midiToAbc(n, keySignature)).join('') + ']')
    : 'x';

  const bassAbc = displayBassNotes.length > 0
    ? (displayBassNotes.length === 1
        ? midiToAbc(displayBassNotes[0], keySignature)
        : '[' + displayBassNotes.map(n => midiToAbc(n, keySignature)).join('') + ']')
    : 'x';

  const trebleContent = trebleOttava.marker
    ? `!${trebleOttava.marker}(!${trebleAbc}!${trebleOttava.marker})!`
    : trebleAbc;
  const bassContent = bassOttava.marker
    ? `!${bassOttava.marker}(!${bassAbc}!${bassOttava.marker})!`
    : bassAbc;

  const abc = `X:1
L:1/4
M:none
K:${keySignature}
%%topspace 0
%%composerspace 0
%%titlespace 0
%%musicspace 0
%%vocalspace 0
%%textspace 0
%%staffsep 60
%%sysstaffsep 40
%%staves {(RH) (LH)}
V:RH clef=treble
V:LH clef=bass
[V:RH] x x ${trebleContent} x x |]
[V:LH] x x ${bassContent} x x |]`;

  return abc;
};

/**
 * Authored note values → the ABC length suffix they get under `L:1/4`.
 *
 * `L:1/4` is the unit length every generator in this file writes, so an
 * undeclared value engraves as a plain quarter notehead: no flag, no beam, no
 * rhythm claimed. Untimed material is most of the exercise bank ("omit for
 * untimed material", exercise-bank.md), and it should look like a method book's
 * pattern line rather than like a rhythm it was never given.
 */
export const ABC_DURATIONS = Object.freeze({
  whole: '4', half: '2', quarter: '', eighth: '/2', '8th': '/2', sixteenth: '/4', '16th': '/4',
});

/** The values that carry a flag, and therefore want a beam over a run of them. */
const BEAMABLE = new Set(['eighth', '8th', 'sixteenth', '16th']);

/** How many flagged notes share one beam. Four is the reading unit an engraver uses. */
const BEAM_GROUP = 4;

/** One note, with its fingering decoration and its length. */
export const abcNoteToken = (note, keySignature = 'C') => {
  if (!note || note.rest) return 'x';
  const finger = note.finger != null ? `!${note.finger}!` : '';
  return `${finger}${midiToAbc(note.midi, keySignature)}${ABC_DURATIONS[note.value] ?? ''}`;
};

/**
 * A run of notes as ONE ENGRAVED LINE — the difference between a published
 * exercise and a wall of flags.
 *
 * abcjs beams notes written ADJACENT and breaks the beam wherever there is a
 * space, so beaming is a joining rule and nothing more. Both generators used to
 * join with a space unconditionally, which meant every flagged note carried its
 * own flag stack: sixteen individually-flagged sixteenths in a row, which is
 * what a scale looked like on the grand staff and reads as noise rather than as
 * music.
 *
 * Only flagged values beam (a quarter has nothing to beam), a rest breaks the
 * group, and a group never runs past four.
 */
export const abcNoteLine = (notes, keySignature = 'C') => {
  const entries = (notes || []).map((note) => ({
    abc: abcNoteToken(note, keySignature),
    beamable: Boolean(note) && !note.rest && BEAMABLE.has(note.value),
  }));
  let line = '';
  let run = 0;
  entries.forEach((entry, index) => {
    if (index === 0) {
      line = entry.abc;
      run = entry.beamable ? 1 : 0;
      return;
    }
    const joinsBeam = entry.beamable && entries[index - 1].beamable && run < BEAM_GROUP;
    line += joinsBeam ? entry.abc : ` ${entry.abc}`;
    run = joinsBeam ? run + 1 : (entry.beamable ? 1 : 0);
  });
  return line;
};

/**
 * Generate ABC for a melodic drill — a played figure (not a chord) on a grand
 * staff, with fingering numbers. Content-agnostic: drives any lesson drill whose
 * data shape is { meter, hands: { right:[cell], left:[cell] } }.
 *
 * Unlike generateAbc (which stacks simultaneous notes into one chord), this lays
 * notes out horizontally as a played sequence. Each `hand` is an array of cells
 * (e.g. ascending then descending), and each cell is one measure. Notes carry an
 * optional `finger` (1–5), rendered via abcjs `!n!` fingering decorations.
 *
 * @param {object} drill - { meter, hands: { right:[{notes}], left:[{notes}] } }
 * @param {string} [keySignature='C']
 * @returns {string} ABC tune string
 */
export const generateMelodyAbc = (drill, keySignature = 'C') => {
  const meter = drill?.meter || '4/4';
  // One cell → one measure, engraved and beamed by the shared rule.
  const cellToMeasure = (cell) => abcNoteLine(cell?.notes, keySignature) || 'x';
  // Join a hand's cells (ascending | descending) into a barred voice line.
  const handLine = (hand) => {
    const cells = Array.isArray(hand) ? hand : [];
    if (cells.length === 0) return 'x |]';
    return cells.map(cellToMeasure).join(' | ') + ' |]';
  };

  const rh = handLine(drill?.hands?.right);
  const lh = handLine(drill?.hands?.left);

  // L:1/4, NOT L:1/16 — the unit length the other two generators in this file
  // already write, and the one the note values above are expressed against.
  // Under `L:1/16` the tokens carried no length at all, so every note in every
  // two-hand exercise engraved as a SIXTEENTH whatever it was: a scale the bank
  // declares no rhythm for came out as sixteen double-flagged notes, while the
  // single-staff sibling of the same exercise drew the same notes as quarters.
  return `X:1
L:1/4
M:${meter}
K:${keySignature}
%%staffsep 70
%%sysstaffsep 50
%%staves {(RH) (LH)}
V:RH clef=treble
V:LH clef=bass
[V:RH] ${rh}
[V:LH] ${lh}`;
};
