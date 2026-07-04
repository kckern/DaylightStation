import { useRef } from 'react';
import './TransportSheets.scss';

const TAP_RESET_MS = 2000;
const TAP_MAX_INTERVALS = 4;
const PRESETS = [72, 90, 110, 120, 140];

/**
 * TempoSheet — the tap-to-open tempo control (design §5). A big BPM readout,
 * fine ±1 steppers, a TAP pad, and preset chips. Tap-tempo + metronome are
 * tempo-family, so they live here, not on the crowded transport bar. Discrete
 * taps only (kiosk rule). Emits the RAW next bpm; the reducer clamps.
 *
 * @param {number} bpm
 * @param {(bpm:number) => void} onBpm
 * @param {() => void} onClose
 * @param {() => number} [now] injectable clock (tests)
 */
export function TempoSheet({ bpm, onBpm, onClose, now = () => performance.now() }) {
  const tapsRef = useRef([]);
  const handleTap = () => {
    const t = now();
    const taps = tapsRef.current;
    if (taps.length && t - taps[taps.length - 1] >= TAP_RESET_MS) taps.length = 0;
    taps.push(t);
    if (taps.length > TAP_MAX_INTERVALS + 1) taps.shift();
    if (taps.length < 2) return;
    const avgMs = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    if (avgMs > 0) onBpm(Math.round(60000 / avgMs));
  };

  return (
    <div className="piano-sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="piano-sheet piano-tempo-sheet"
        role="dialog"
        aria-label="tempo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="piano-tempo-sheet__big" aria-label="tempo">
          <span className="piano-tempo-sheet__bpm">{bpm}</span>
          <span className="piano-tempo-sheet__unit">Tempo</span>
        </div>

        <div className="piano-tempo-sheet__fine">
          <button type="button" aria-label="tempo down" onClick={() => onBpm(bpm - 1)}>−</button>
          <button type="button" className="piano-tempo-sheet__tap" aria-label="tap tempo" onClick={handleTap}>TAP</button>
          <button type="button" aria-label="tempo up" onClick={() => onBpm(bpm + 1)}>+</button>
        </div>

        <div className="piano-tempo-sheet__presets" role="group" aria-label="tempo presets">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`piano-tempo-sheet__preset${bpm === p ? ' is-on' : ''}`}
              aria-pressed={bpm === p}
              onClick={() => onBpm(p)}
            >{p}</button>
          ))}
        </div>

        <button type="button" className="piano-sheet__done" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default TempoSheet;
