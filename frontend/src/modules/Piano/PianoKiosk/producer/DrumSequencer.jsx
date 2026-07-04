import { useRef, useState } from 'react';
import { PPQ } from './useLoopCapture.js';
import './DrumSequencer.scss';

// Drum step-sequencer (design §9): rows = GM drum pieces, columns = 16th steps.
// Tap cells to toggle hits; commit builds a groove layer (channel 9, drumMode)
// that feeds the existing percussion path — the granular counterpart to
// drumming a groove on the keys.
const ROWS = [
  { label: 'Kick', gm: 36 },
  { label: 'Snare', gm: 38 },
  { label: 'Hi-Hat', gm: 42 },
  { label: 'Open Hat', gm: 46 },
  { label: 'Clap', gm: 39 },
  { label: 'Ride', gm: 51 },
];
const STEPS_PER_BAR = 16; // 16th-note grid
const SIXTEENTH = PPQ / 4; // ticks per step
const MAX_BARS = 4; // keep the grid tappable on a kiosk

/** Build a groove take from the active cells (design §9 output contract). */
export function drumPatternToTake(active, bars, seq) {
  const notes = [];
  for (const key of active) {
    const [gm, step] = key.split(':').map(Number);
    notes.push({ ticks: step * SIXTEENTH, durationTicks: SIXTEENTH, midi: gm, velocity: 100 });
  }
  notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  return { takeId: `drum-${seq}`, notes, ppq: PPQ, lengthBars: bars, kind: 'groove', drumMode: true, timeline: null };
}

/**
 * @param {number} [lengthBars] loop length (clamped to 1..MAX_BARS for the grid)
 * @param {(take:object) => void} onCommit  add the groove as a layer
 * @param {() => void} onClose
 */
export function DrumSequencer({ lengthBars = 2, onCommit, onClose }) {
  const bars = Math.max(1, Math.min(MAX_BARS, Math.trunc(lengthBars) || 2));
  const steps = bars * STEPS_PER_BAR;
  const [active, setActive] = useState(() => new Set());
  const seqRef = useRef(0);

  const toggle = (gm, step) => {
    const key = `${gm}:${step}`;
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const commit = () => {
    seqRef.current += 1;
    onCommit(drumPatternToTake(active, bars, seqRef.current));
    onClose();
  };

  return (
    <div className="piano-sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="piano-sheet piano-drumseq"
        role="dialog"
        aria-label="build a drum loop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="piano-drumseq__title">Build a drum loop</h2>

        <div className="piano-drumseq__grid" style={{ '--steps': steps }}>
          {ROWS.map((row) => (
            <div key={row.gm} className="piano-drumseq__row">
              <span className="piano-drumseq__row-label">{row.label}</span>
              <div className="piano-drumseq__cells">
                {Array.from({ length: steps }, (_, step) => {
                  const on = active.has(`${row.gm}:${step}`);
                  return (
                    <button
                      key={step}
                      type="button"
                      className={`piano-drumseq__cell${on ? ' is-on' : ''}${step % 4 === 0 ? ' is-beat' : ''}`}
                      aria-label={`${row.label} step ${step + 1}`}
                      aria-pressed={on}
                      onClick={() => toggle(row.gm, step)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="piano-drumseq__actions">
          <button type="button" className="piano-sheet__done piano-drumseq__cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="piano-sheet__done"
            disabled={active.size === 0}
            onClick={commit}
          >Add drum loop</button>
        </div>
      </div>
    </div>
  );
}

export default DrumSequencer;
