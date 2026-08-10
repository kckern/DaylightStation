import { useState } from 'react';
import { keyedChordName } from '../../components/roman/keyedChordName.js';
import {
  CHORD_RHYTHMS, DIATONIC_CHORDS, chordProgressionToTake,
} from './chordBuilderModel.js';
import './ChordBuilder.scss';

const MAX_BARS = 16;

export function ChordBuilder({
  keyPc = 0,
  lengthBars = 4,
  onCommit,
  onClose,
  onPreview,
  onStopPreview,
  isPreviewing = false,
}) {
  const bars = Math.max(1, Math.min(MAX_BARS, Math.trunc(lengthBars) || 4));
  const [slots, setSlots] = useState(() => Array(bars).fill(null));
  const [sel, setSel] = useState(0);
  const [rhythm, setRhythm] = useState('pulse');
  const hasChords = slots.some(Boolean);

  const stopPreview = () => { if (isPreviewing) onStopPreview?.(); };
  const updateSlots = (fn) => { stopPreview(); setSlots(fn); };
  const place = (entry) => {
    updateSlots((prev) => {
      const next = prev.slice();
      next[sel] = entry;
      return next;
    });
    setSel((s) => Math.min(bars - 1, s + 1));
  };
  const makeTake = () => chordProgressionToTake(slots, { rhythm });
  const close = () => { onStopPreview?.(); onClose(); };
  const commit = () => { onStopPreview?.(); onCommit(makeTake()); onClose(); };
  const label = (entry) => (entry ? keyedChordName(entry.roman, keyPc) : '·');

  return (
    <div className="piano-sheet-scrim" role="presentation" onClick={close}>
      <div className="piano-sheet piano-chordbuilder" role="dialog" aria-label="build chords" onClick={(e) => e.stopPropagation()}>
        <h2 className="piano-chordbuilder__title">Build chords</h2>
        <p className="piano-chordbuilder__hint">Choose one chord per bar. Producer connects them with close keyboard voicings.</p>

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
          {DIATONIC_CHORDS.map((entry) => (
            <button key={entry.roman} type="button" className="piano-chordbuilder__chord" aria-label={`add ${keyedChordName(entry.roman, keyPc)}`} onClick={() => place(entry)}>
              <span className="piano-chordbuilder__chord-name">{keyedChordName(entry.roman, keyPc)}</span>
              <span className="piano-chordbuilder__chord-roman">{entry.roman}</span>
            </button>
          ))}
          <button type="button" className="piano-chordbuilder__chord" onClick={() => place(null)}>Rest</button>
        </div>

        <div className="piano-chordbuilder__rhythms" role="group" aria-label="chord rhythm">
          {Object.keys(CHORD_RHYTHMS).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rhythm === value}
              className={rhythm === value ? 'is-on' : ''}
              onClick={() => { stopPreview(); setRhythm(value); }}
            >{value === 'sustain' ? 'Sustain' : value === 'pulse' ? 'Quarter pulse' : 'Syncopated'}</button>
          ))}
        </div>

        <div className="piano-chordbuilder__actions">
          <button type="button" className="piano-sheet__done piano-chordbuilder__clear" disabled={!hasChords} onClick={() => updateSlots(Array(bars).fill(null))}>Clear</button>
          <button type="button" className="piano-sheet__done piano-chordbuilder__cancel" onClick={close}>Cancel</button>
          <button type="button" className="piano-sheet__done" disabled={!hasChords || !onPreview} onClick={() => (isPreviewing ? onStopPreview?.() : onPreview?.(makeTake()))}>
            {isPreviewing ? 'Stop preview' : 'Preview'}
          </button>
          <button type="button" className="piano-sheet__done" disabled={!hasChords} onClick={commit}>Add chords</button>
        </div>
      </div>
    </div>
  );
}

export default ChordBuilder;
