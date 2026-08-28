// exerciseAbc.js — instance-to-ABC notation conversion for ExerciseNotation.jsx,
// split out so Fast Refresh can hot-reload the notation component on its own.
//
// Clef selection (engraving rule 1) for the single-voice branch: an explicit
// `hand` on the notes wins; failing that, the instance's own declared `staff`;
// failing that, which clef most of the notes' pitches naturally sit in (a tie
// goes treble). `ordering:'any'` material never reaches this module — Task 6
// renders it through KeysAsk/SvgSequenceStaff, so ABC is cued-only.
import { generateMelodyAbc, midiToAbc } from '../../../../MusicNotation/renderers/abc.js';

const MIDDLE_C = 60;

function singleVoiceAbc(notes, clef, instance) {
  const tokens = notes.map((note) => {
    if (!note || note.rest) return 'x';
    const finger = note.finger != null ? `!${note.finger}!` : '';
    return `${finger}${midiToAbc(note.midi, instance.key ?? 'C')}`;
  }).join(' ');
  return `X:1\nL:1/16\nM:${instance.meter ?? '4/4'}\nK:${instance.key ?? 'C'}\nV:MAIN clef=${clef}\n[V:MAIN] ${tokens} |]`;
}

/** Rule 1's last resort: majority of the notes' own pitch range (below middle C → bass). */
function clefByPitchMajority(notes) {
  const pitches = notes.filter((note) => !note.rest && Number.isFinite(note.midi)).map((note) => note.midi);
  if (!pitches.length) return 'treble';
  const below = pitches.filter((midi) => midi < MIDDLE_C).length;
  return below * 2 > pitches.length ? 'bass' : 'treble';
}

/** Rule 1 for notes that never declared a hand: instance.staff, else pitch majority. */
function clefForHandless(instance, notes) {
  if (instance.staff === 'treble' || instance.staff === 'bass') return instance.staff;
  return clefByPitchMajority(notes);
}

export function instanceToAbc(instance) {
  if (!instance?.events?.length) return '';
  if (instance.ordering === 'any') return '';

  const allNotes = instance.events.flatMap((event) => event.notes ?? []);
  const hasHand = allNotes.some((note) => note?.hand === 'right' || note?.hand === 'left');

  if (hasHand) {
    const notesFor = (hand) => instance.events.map((event) => event.notes.find((candidate) => candidate.hand === hand) ?? { rest: true });
    const right = notesFor('right');
    const left = notesFor('left');
    const hasRight = right.some((note) => !note.rest);
    const hasLeft = left.some((note) => !note.rest);
    if (hasRight !== hasLeft) {
      return singleVoiceAbc(hasRight ? right : left, hasRight ? 'treble' : 'bass', instance);
    }
    return generateMelodyAbc({
      meter: instance.meter ?? '4/4',
      hands: { right: [{ notes: right }], left: [{ notes: left }] },
    }, instance.key ?? 'C');
  }

  // No note declares a hand at all: one voice, clef by staff-key then pitch majority.
  const notes = instance.events.map((event) => event.notes?.[0] ?? { rest: true });
  return singleVoiceAbc(notes, clefForHandless(instance, notes), instance);
}
