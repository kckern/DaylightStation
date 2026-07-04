/**
 * TransportBar — Band 1 of the Producer's three-band shell (design §7).
 *
 * Play/stop, bar:beat readout (cycling within the loop, · N bars), tap-to-open
 * Tempo and Key chips (their sheets own the fine controls — design §5), a
 * metronome (Click) toggle, and the record button (opens/closes the CaptureCard;
 * pulses red while a capture session is open). All discrete taps, ≥48px targets.
 *
 * Deliberately dumb: every control emits through a callback prop; the shell
 * owns the workspace reducer. Internal state is the bar:beat readout (polled
 * from `positionRef` on rAF while playing, ≤4Hz — never per-frame) and which
 * transport sheet is open.
 *
 * Styles live in the shell's Producer.scss (`piano-producer-mode__transport*`
 * classes) — this bar only ever renders inside the Producer surface.
 *
 * @param {object} props
 * @param {boolean} props.isPlaying
 * @param {boolean} props.canPlay        - false disables play (no layers yet)
 * @param {() => void} props.onTogglePlay
 * @param {{current: {bar:number, beat:number}}} [props.positionRef] - transport positionRef
 * @param {number} props.bpm
 * @param {(bpm:number) => void} props.onBpm - steppers/tap emit the RAW next value; the reducer clamps 40..220
 * @param {string} props.keyLabel        - current key name (detected + shifted)
 * @param {(delta:number) => void} props.onKeyNudge
 * @param {boolean} props.metronome
 * @param {() => void} props.onToggleMetronome
 * @param {boolean} [props.recActive] - a capture session is open (pulse red)
 * @param {() => void} [props.onRecord] - open/close the capture card
 * @param {boolean} [props.locked] - capture session open: tempo/tap/key are
 *   disabled ("Locked while recording") — the capture engine freezes its
 *   geometry at arm, and a key nudge would desync heard-vs-stored pitch
 * @param {() => number} [props.now] - clock seam for the tap-tempo window
 *   (tests script it; defaults to performance.now)
 */
import { useEffect, useState } from 'react';
import { TempoSheet } from './TempoSheet.jsx';
import { KeySheet } from './KeySheet.jsx';

/** Readout refresh gate: at most ~4 state writes per second. */
const READOUT_MS = 250;
/** Tooltip for tempo/key chips disabled during a capture session. */
const LOCKED_TITLE = 'Locked while recording';

export function TransportBar({
  isPlaying,
  canPlay,
  onTogglePlay,
  positionRef,
  loopBars = 0,
  bpm,
  onBpm,
  keyLabel,
  keyPc = 0,
  onKeyNudge,
  metronome,
  onToggleMetronome,
  recActive = false,
  onRecord,
  locked = false,
  now = () => performance.now(),
}) {
  // Which tempo/key sheet is open (design §5) — null | 'tempo' | 'key'.
  const [sheet, setSheet] = useState(null);
  // ── bar:beat readout: rAF poll ONLY while playing, ≤4Hz state writes ───────
  const [pos, setPos] = useState({ bar: 0, beat: 0 });
  useEffect(() => {
    if (!isPlaying) {
      setPos({ bar: 0, beat: 0 });
      return undefined;
    }
    const read = () => {
      const p = positionRef?.current;
      if (!p) return;
      setPos((prev) => (prev.bar === p.bar && prev.beat === p.beat ? prev : { bar: p.bar, beat: p.beat }));
    };
    read(); // immediate first paint — don't wait a frame
    let raf = 0;
    let last = 0;
    const tick = (t) => {
      if (t - last >= READOUT_MS) {
        last = t;
        read();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, positionRef]);

  // Count-in bars are negative; the readout floor keeps 1:1 as the resting face.
  // The bar cycles WITHIN the loop (design §4): a bounded loop counts 1→N then
  // resets, instead of an ever-climbing global bar. loopBars 0 (nothing loaded /
  // arrangement mode) falls back to the raw climbing bar.
  const rawBar = Math.max(0, pos.bar);
  const barInLoop = loopBars > 0 ? rawBar % loopBars : rawBar;
  const barLabel = barInLoop + 1;
  const beatLabel = Math.max(0, pos.beat) + 1;

  return (
    <div className="piano-producer-mode__transport">
      <button
        type="button"
        className={`piano-producer-mode__play${isPlaying ? ' is-on' : ''}`}
        onClick={onTogglePlay}
        disabled={!canPlay}
      >
        {isPlaying ? '◼ Stop' : '▶ Play'}
      </button>

      <span className="piano-producer-mode__pos" aria-label="position">
        {barLabel}:{beatLabel}
        {loopBars > 0 && <span className="piano-producer-mode__pos-len"> · {loopBars} bars</span>}
      </span>

      {/* Tempo + Key collapse to tap-to-open chips (design §5): live state at a
          glance, a big-target sheet for changing it. */}
      <button
        type="button"
        className="piano-producer-mode__chip"
        aria-label="tempo"
        disabled={locked}
        title={locked ? LOCKED_TITLE : 'Tempo'}
        onClick={() => setSheet('tempo')}
      >{bpm} BPM</button>

      <button
        type="button"
        className="piano-producer-mode__chip"
        aria-label="key"
        disabled={locked}
        title={locked ? LOCKED_TITLE : 'Key'}
        onClick={() => setSheet('key')}
      >Key {keyLabel}</button>

      <button
        type="button"
        className={`piano-producer-mode__metro${metronome ? ' is-on' : ''}`}
        aria-label="metronome"
        aria-pressed={metronome}
        onClick={onToggleMetronome}
      >
        Click
      </button>

      <button
        type="button"
        className={`piano-producer-mode__rec${recActive ? ' is-armed' : ''}`}
        aria-label="record"
        aria-pressed={recActive}
        onClick={onRecord}
      >
        ●
      </button>

      {sheet === 'tempo' && (
        <TempoSheet bpm={bpm} onBpm={onBpm} onClose={() => setSheet(null)} now={now} />
      )}
      {sheet === 'key' && (
        <KeySheet keyPc={keyPc} onKeyNudge={onKeyNudge} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

export default TransportBar;
