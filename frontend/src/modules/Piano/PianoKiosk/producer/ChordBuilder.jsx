import { useRef, useState } from 'react';
import { PPQ } from './useLoopCapture.js';
import { keyedChordName } from '../../components/roman/keyedChordName.js';
import './ChordBuilder.scss';

// Chord progression builder (design §9): one slot per bar; tap a slot, pick a
// diatonic chord. Output is a CANONICAL-C chords take (Roman I → C) so the
// existing keyShift path transposes it to the jam key on playback — the manual,
// precise alternative to browsing the library.

// Diatonic major-key chords: semitone offset from the tonic + triad quality.
const DIATONIC = [
  { roman: 'I', offset: 0, quality: 'major' },
  { roman: 'ii', offset: 2, quality: 'minor' },
  { roman: 'iii', offset: 4, quality: 'minor' },
  { roman: 'IV', offset: 5, quality: 'major' },
  { roman: 'V', offset: 7, quality: 'major' },
  { roman: 'vi', offset: 9, quality: 'minor' },
  { roman: 'vii°', offset: 11, quality: 'dim' },
];
const TRIAD = { major: [0, 4, 7], minor: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8] };
const ROOT_MIDI = 60; // canonical middle C == Roman I

/** Canonical-C triad midis for a diatonic entry (root position, one octave). */
export function chordTriadMidi(entry) {
  return TRIAD[entry.quality].map((iv) => ROOT_MIDI + entry.offset + iv);
}

/** Build a canonical-C chords take from a per-bar progression (design §9). */
export function chordProgressionToTake(slots, seq) {
  const ppq = PPQ;
  const barTicks = ppq * 4;
  const notes = [];
  slots.forEach((entry, bar) => {
    if (!entry) return;
    for (const midi of chordTriadMidi(entry)) {
      notes.push({ ticks: bar * barTicks, durationTicks: barTicks, midi, velocity: 88 });
    }
  });
  notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  return { takeId: `chords-${seq}`, notes, ppq, lengthBars: slots.length, kind: 'chords', drumMode: false, timeline: null };
}

/**
 * @param {number} keyPc  the jam tonic (0..11) — for LABELS only (stored notes
 *   are canonical); Roman I shows as its keyed name here.
 * @param {number} [lengthBars]  number of bar slots (default 4)
 * @param {(take:object) => void} onCommit
 * @param {() => void} onClose
 */
export function ChordBuilder({ keyPc = 0, lengthBars = 4, onCommit, onClose }) {
  const bars = Math.max(1, Math.min(8, Math.trunc(lengthBars) || 4));
  const [slots, setSlots] = useState(() => Array(bars).fill(null));
  const [sel, setSel] = useState(0);
  const seqRef = useRef(0);

  const place = (entry) => {
    setSlots((prev) => {
      const next = prev.slice();
      next[sel] = entry;
      return next;
    });
    setSel((s) => Math.min(bars - 1, s + 1)); // auto-advance
  };

  const commit = () => {
    seqRef.current += 1;
    onCommit(chordProgressionToTake(slots, seqRef.current));
    onClose();
  };

  const label = (entry) => (entry ? keyedChordName(entry.roman, keyPc) : '·');

  return (
    <div className="piano-sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="piano-sheet piano-chordbuilder"
        role="dialog"
        aria-label="build chords"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="piano-chordbuilder__title">Build chords</h2>

        <div className="piano-chordbuilder__slots" role="group" aria-label="progression">
          {slots.map((entry, i) => (
            <button
              key={i}
              type="button"
              className={`piano-chordbuilder__slot${i === sel ? ' is-sel' : ''}${entry ? ' is-filled' : ''}`}
              aria-label={`bar ${i + 1}${entry ? ` ${label(entry)}` : ' empty'}`}
              onClick={() => setSel(i)}
            >
              <span className="piano-chordbuilder__slot-name">{label(entry)}</span>
              {entry && <span className="piano-chordbuilder__slot-roman">{entry.roman}</span>}
            </button>
          ))}
        </div>

        <div className="piano-chordbuilder__palette" role="group" aria-label="diatonic chords">
          {DIATONIC.map((entry) => (
            <button
              key={entry.roman}
              type="button"
              className="piano-chordbuilder__chord"
              aria-label={`add ${keyedChordName(entry.roman, keyPc)}`}
              onClick={() => place(entry)}
            >
              <span className="piano-chordbuilder__chord-name">{keyedChordName(entry.roman, keyPc)}</span>
              <span className="piano-chordbuilder__chord-roman">{entry.roman}</span>
            </button>
          ))}
        </div>

        <div className="piano-chordbuilder__actions">
          <button type="button" className="piano-sheet__done piano-chordbuilder__clear" onClick={() => setSlots(Array(bars).fill(null))}>Clear</button>
          <button type="button" className="piano-sheet__done piano-chordbuilder__cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="piano-sheet__done"
            disabled={slots.every((s) => !s)}
            onClick={commit}
          >Add chords</button>
        </div>
      </div>
    </div>
  );
}

export default ChordBuilder;
