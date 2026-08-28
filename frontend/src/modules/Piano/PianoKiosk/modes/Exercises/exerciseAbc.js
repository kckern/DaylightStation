// exerciseAbc.js — instance-to-ABC notation conversion for ExerciseNotation.jsx,
// split out so Fast Refresh can hot-reload the notation component on its own.
//
// Clef selection (engraving rule 1) for the single-voice branch, per
// docs/reference/piano/exercise-bank.md:140-175 — `staff` is a re-notate-only
// axis defined explicitly INDEPENDENT of `hand` ("a left hand can read
// treble… single-hand material can therefore be expanded across both clefs
// and be genuinely two different exercises"). So the instance's own declared
// `staff` wins first — a note's pitch never moves, only which clef draws it —
// then the hand it's played by, then (for material that names neither) which
// clef most of the notes' pitches naturally sit in (a tie goes treble). This
// matches `runPresentation.js`'s `clefForInstance`, the sibling engraving
// surface, which is also staff-first. `ordering:'any'` material never reaches
// this module — Task 6 renders it through KeysAsk/SvgSequenceStaff, so ABC is
// cued-only.
import { generateMelodyAbc, midiToAbc } from '../../../../MusicNotation/renderers/abc.js';

const MIDDLE_C = 60;
const ABC_DURATIONS = Object.freeze({ whole: '4', half: '2', quarter: '', eighth: '/2', '8th': '/2', sixteenth: '/4', '16th': '/4' });

function singleVoiceAbc(notes, clef, instance) {
  const tokens = notes.map((note) => {
    if (!note || note.rest) return 'x';
    const finger = note.finger != null ? `!${note.finger}!` : '';
    return `${finger}${midiToAbc(note.midi, instance.key ?? 'C')}${ABC_DURATIONS[note.value] ?? ''}`;
  }).join(' ');
  return `X:1\nL:1/4\nM:${instance.meter ?? '4/4'}\nK:${instance.key ?? 'C'}\nV:MAIN clef=${clef}\n[V:MAIN] ${tokens} |]`;
}

/** Rule 1's last resort: majority of the notes' own pitch range (below middle C → bass). */
function clefByPitchMajority(notes) {
  const pitches = notes.filter((note) => !note.rest && Number.isFinite(note.midi)).map((note) => note.midi);
  if (!pitches.length) return 'treble';
  const below = pitches.filter((midi) => midi < MIDDLE_C).length;
  return below * 2 > pitches.length ? 'bass' : 'treble';
}

/**
 * The instance's own declared re-notation staff, case-insensitively, or null
 * if it names neither clef (unset, `'grand'`, or garbage) — the chain falls
 * through to hand / pitch majority in that case.
 */
function declaredStaff(instance) {
  const value = typeof instance?.staff === 'string' ? instance.staff.trim().toLowerCase() : null;
  return value === 'treble' || value === 'bass' ? value : null;
}

export function instanceToAbc(instance) {
  if (!instance?.events?.length) return '';
  if (instance.ordering === 'any') return '';

  const staff = declaredStaff(instance);
  const allNotes = instance.events.flatMap((event) => event.notes ?? []);
  const hasHand = allNotes.some((note) => note?.hand === 'right' || note?.hand === 'left');

  if (hasHand) {
    // A hand-less note inside otherwise hand-tagged material is still legal
    // per note (exercise-bank.md's `hand` is optional per NOTE, not per
    // instance) — assign it by pitch register so it lands on exactly one
    // staff. Dropping it (silence) or duplicating it onto both (an old bug)
    // are both wrong: the child has to play every note exactly once.
    const notesFor = (hand) => instance.events.map((event) => {
      const explicit = event.notes.find((candidate) => candidate.hand === hand);
      if (explicit) return { ...explicit, value: event.value };
      if (event.notes.length === 1 && !event.notes[0].hand) {
        const note = event.notes[0];
        const side = note.midi < MIDDLE_C ? 'left' : 'right';
        if (side === hand) return { ...note, value: event.value };
      }
      return { rest: true };
    });
    const right = notesFor('right');
    const left = notesFor('left');
    const hasRight = right.some((note) => !note.rest);
    const hasLeft = left.some((note) => !note.rest);
    if (hasRight !== hasLeft) {
      const naturalClef = hasRight ? 'treble' : 'bass';
      return singleVoiceAbc(hasRight ? right : left, staff ?? naturalClef, instance);
    }
    return generateMelodyAbc({
      meter: instance.meter ?? '4/4',
      hands: { right: [{ notes: right }], left: [{ notes: left }] },
    }, instance.key ?? 'C');
  }

  // No note declares a hand at all: one voice, clef by staff then pitch majority.
  const notes = instance.events.map((event) => ({ ...(event.notes?.[0] ?? { rest: true }), value: event.value }));
  return singleVoiceAbc(notes, staff ?? clefByPitchMajority(notes), instance);
}
