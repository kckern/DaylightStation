/**
 * TransportBar — Band 1 of the Producer's three-band shell (design §7).
 *
 * Play/stop, bar:beat readout, BPM stepper + tap-tempo pad, key stepper,
 * metronome toggle, and the record button (opens/closes the CaptureCard;
 * pulses red while a capture session is open). All discrete latching taps,
 * ≥48px targets, no drags.
 *
 * Deliberately dumb: every control emits through a callback prop; the shell
 * owns the workspace reducer. The ONLY internal state is the bar:beat readout
 * (polled from `positionRef` on rAF while playing, written into local state at
 * ≤4Hz — never per-frame React state) and the tap-tempo timestamp window.
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
import { useEffect, useRef, useState } from 'react';

const BPM_STEP = 4;
/** Readout refresh gate: at most ~4 state writes per second. */
const READOUT_MS = 250;
/** A pause ≥ this between taps starts a fresh tap-tempo measurement. */
const TAP_RESET_MS = 2000;
/** Average over at most this many recent intervals (5 timestamps). */
const TAP_MAX_INTERVALS = 4;
/** Tooltip for tempo/key controls disabled during a capture session. */
const LOCKED_TITLE = 'Locked while recording';

export function TransportBar({
  isPlaying,
  canPlay,
  onTogglePlay,
  positionRef,
  bpm,
  onBpm,
  keyLabel,
  onKeyNudge,
  metronome,
  onToggleMetronome,
  recActive = false,
  onRecord,
  locked = false,
  now = () => performance.now(),
}) {
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

  // ── tap tempo: average the last ≤4 intervals; a ≥2s gap resets ─────────────
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

  // Count-in bars are negative; the readout floor keeps 1:1 as the resting face.
  const barLabel = Math.max(0, pos.bar) + 1;
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
      </span>

      <span className="piano-producer-mode__tempo">
        <button type="button" aria-label="tempo down" disabled={locked} title={locked ? LOCKED_TITLE : undefined} onClick={() => onBpm(bpm - BPM_STEP)}>−</button>
        <span aria-label="tempo">{bpm} BPM</span>
        <button type="button" aria-label="tempo up" disabled={locked} title={locked ? LOCKED_TITLE : undefined} onClick={() => onBpm(bpm + BPM_STEP)}>+</button>
        <button type="button" className="piano-producer-mode__tap" aria-label="tap tempo" disabled={locked} title={locked ? LOCKED_TITLE : undefined} onClick={handleTap}>TAP</button>
      </span>

      <span className="piano-producer-mode__key">
        <button type="button" aria-label="key down" disabled={locked} title={locked ? LOCKED_TITLE : undefined} onClick={() => onKeyNudge(-1)}>−</button>
        <span aria-label="key">Key {keyLabel}</span>
        <button type="button" aria-label="key up" disabled={locked} title={locked ? LOCKED_TITLE : undefined} onClick={() => onKeyNudge(1)}>+</button>
      </span>

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
    </div>
  );
}

export default TransportBar;
