/**
 * GainStrip — segmented tap-to-set layer gain for the Producer's channel
 * strips (design §7 Mix view).
 *
 * Pattern source: the fitness player's TouchVolumeButtons
 * (frontend/src/modules/Fitness/player/panels/TouchVolumeButtons.jsx). The
 * level/curve helpers are EXTRACTED here rather than imported — piano must
 * not depend on the fitness domain. Kept from the pattern: the 11-segment
 * strip, snap-to-nearest-level, the log curve with the midpoint segment
 * pinned to 10% output, pointer capture, and the mount-time stale-event
 * guard (their BUG-04 fix).
 *
 * Domain adaptation — GAIN (0..1), not percent volume:
 *   - A workspace layer's gain is 0..1 (the reducer clamps). It scales note
 *     velocity in the loopScheduler AND feeds the synth's channel gain.
 *   - level 0   → gain 0: the layer is SILENT (loopScheduler emits nothing
 *     at gain ≤ 0). The far-left cell is the mute-ish cell (✕), mirroring
 *     the pattern's ≤7.5% dead-left zone.
 *   - level L>0 → gain = 10^((L−100)·k), k = log10(0.1)/(50−100) = 0.02.
 *     So level 100 → 1 (the layer default), 50 → 0.1, 10 → ≈0.016 — the
 *     same midpoint-50→10% curve as the pattern source, stretching the quiet
 *     range so low segments are meaningful choices instead of "already too
 *     loud".
 *   - Displayed level = snapToGainLevel(levelFromGain(gain)) (inverse curve),
 *     so any reducer-side gain lands on the nearest segment.
 *
 * Touch ergonomics (a DELIBERATE delta from the pattern): TouchVolumeButtons
 * commits on pointer-DOWN, fine in its non-scrolling panel. This strip lives
 * inside the Producer's scrollable layer list, so a scroll gesture that
 * happens to start on it must NOT set gain. Three guards:
 *   - `touch-action: pan-y` (ChannelStrip.scss): the browser keeps vertical
 *     scrolling and fires pointercancel when it claims the gesture — we then
 *     drop the pending tap;
 *   - commit on pointer-UP, using the DOWN point (the tap intent);
 *   - a movement threshold: > 12px of drift cancels the tap.
 *
 * Muted layers render dimmed (`is-muted`) but stay interactive — you can
 * pre-set a level before unmuting, like on a hardware desk.
 */
import { useRef } from 'react';

export const GAIN_LEVELS = Object.freeze([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

// Log curve anchors (see header): midpoint segment (level 50) → 10% gain.
const MID_LEVEL = 50;
const MID_GAIN = 0.1;
const EXPONENT_PER_LEVEL = Math.log10(MID_GAIN) / (MID_LEVEL - 100); // = 0.02

/** Nearest segment level (0..100 in tens) for a raw strip percent. */
export const snapToGainLevel = (percent) => {
  if (!Number.isFinite(percent)) return 0;
  return GAIN_LEVELS.reduce((closest, level) => (
    Math.abs(level - percent) < Math.abs(closest - percent) ? level : closest
  ), GAIN_LEVELS[0]);
};

/** Segment level → layer gain 0..1 (log curve; level ≤ 0 → exactly 0). */
export const gainFromLevel = (level) => {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(1, Math.max(0, 10 ** ((level - 100) * EXPONENT_PER_LEVEL)));
};

/** Layer gain 0..1 → level 0..100 (inverse curve; gain ≤ 0 → 0). */
export const levelFromGain = (gain) => {
  if (!Number.isFinite(gain) || gain <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(100 + Math.log10(gain) / EXPONENT_PER_LEVEL)));
};

const MOVE_CANCEL_PX = 12; // beyond this the gesture is a scroll, not a tap
const MUTE_ZONE_PERCENT = 7.5; // far-left dead zone = level 0 (silence)

/**
 * @param {object} props
 * @param {number} props.gain - current layer gain 0..1 (reducer-owned)
 * @param {boolean} [props.muted] - dims the strip (still interactive)
 * @param {(gain:number) => void} props.onGain - curve-mapped gain for a tap
 * @param {string} [props.label] - accessible group label
 */
export function GainStrip({ gain, muted = false, onGain, label = 'gain' }) {
  const mountTimeRef = useRef(performance.now());
  const tapRef = useRef(null); // { pointerId, x, y, level } | null

  const handlePointerDown = (e) => {
    // Stale-event guard (pattern's BUG-04): ignore events stamped before mount.
    const eventTime = e.nativeEvent?.timeStamp || performance.now();
    if (eventTime <= mountTimeRef.current) return;

    if (typeof e.preventDefault === 'function') {
      e.preventDefault(); // interaction isolation: no ghost click / focus steal
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom / old WebView */ }
    }

    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    const level = percent <= MUTE_ZONE_PERCENT ? 0 : snapToGainLevel(percent);
    tapRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, level };
  };

  const handlePointerMove = (e) => {
    const tap = tapRef.current;
    if (!tap || tap.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > MOVE_CANCEL_PX) tapRef.current = null;
  };

  const handlePointerUp = (e) => {
    const tap = tapRef.current;
    tapRef.current = null;
    if (!tap || tap.pointerId !== e.pointerId) return;
    onGain?.(gainFromLevel(tap.level));
  };

  const handlePointerCancel = () => { tapRef.current = null; };

  const currentLevel = snapToGainLevel(levelFromGain(gain));

  return (
    <div
      className={`piano-gain-strip${muted ? ' is-muted' : ''}`}
      role="group"
      aria-label={label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {GAIN_LEVELS.map((level) => {
        const isActive = level === currentLevel;
        const isOn = currentLevel > 0 && level > 0 && level <= currentLevel;
        const className = [
          'piano-gain-strip__cell',
          isOn ? 'is-on' : 'is-off',
          isActive ? 'is-active' : '',
          level === 0 ? 'piano-gain-strip__cell--silent' : '',
        ].filter(Boolean).join(' ');
        return (
          // Cells are display segments, not individual actions (the strip
          // handles pointers) — tabIndex -1 keeps 11 dead tab stops out of
          // the focus order on this touch-first surface.
          <button
            key={level}
            type="button"
            tabIndex={-1}
            className={className}
            aria-pressed={isActive}
            aria-label={level === 0 ? 'silent' : `${level}%`}
          >{level === 0 ? '✕' : ''}</button>
        );
      })}
    </div>
  );
}

export default GainStrip;
