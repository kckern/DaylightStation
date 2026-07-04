import { useEffect, useRef, useState } from 'react';
import { RomanChord } from '../../components/roman/RomanProgression.jsx';
import { loopBars } from './LoopRoll.jsx';

/**
 * ChordLane — a chord loop as a TIME LINE: the Roman chords laid out
 * left-to-right in equal time slots across the loop's width, the sounding chord
 * lit, and a playhead that sweeps SMOOTHLY across (not per-measure). This reads
 * as "here is the progression and here is where we are", unlike a piano-roll of
 * sustained chord tones (which is meaningless for chords).
 *
 * The active slot + cursor are driven by requestAnimationFrame reading the
 * transport position (bar + smooth barFrac) — the cursor moves via `left` every
 * frame (no React re-render); the active index re-renders only when it changes.
 *
 * Per-chord TIMING: when `durations` (slots per chord, from the backend
 * canonical-name braille) is present, slot WIDTHS are proportional to duration
 * and the active chord is the one whose cumulative span contains the playhead —
 * so an uneven progression (a 2-bar I then a 1-bar IV) highlights correctly and
 * the cursor lines up with the lit slot. Absent → equal slots + even
 * distribution (the safe fallback), wrapping every `barSpan` bars.
 *
 * @param {string[]} roman
 * @param {number[]|null} durations - slots per chord, parallel to roman (optional)
 * @param {{notes:Array, ppq:number, barSpan:number}|null} notesBundle
 * @param {{current:{bar:number,barFrac:number}}|null} positionRef
 * @param {boolean} isPlaying
 * @param {boolean} muted
 */
/** Cumulative END fractions per chord from durations, or null when the
 *  durations don't line up with the chord count. */
export function cumulativeBounds(durations, count) {
  if (!Array.isArray(durations) || durations.length !== count) return null;
  const total = durations.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (!(total > 0)) return null;
  const bounds = [];
  let acc = 0;
  for (const d of durations) { acc += Math.max(0, d); bounds.push(acc / total); }
  return bounds; // bounds[i] = end fraction of chord i (bounds[count-1] === 1)
}

export function ChordLane({
  roman, durations = null, notesBundle, positionRef, isPlaying = false, muted = false,
}) {
  const cursorRef = useRef(null);
  const [active, setActive] = useState(-1);
  const count = roman?.length || 0;

  useEffect(() => {
    const el = cursorRef.current;
    if (!isPlaying || !positionRef || !count || !notesBundle) {
      setActive(-1);
      if (el) el.style.opacity = '0';
      return undefined;
    }
    const bars = loopBars(notesBundle.notes, notesBundle.ppq, notesBundle.barSpan);
    const bounds = cumulativeBounds(durations, count);
    let raf = 0;
    let last = -1;
    const frame = () => {
      const p = positionRef.current || {};
      const barInLoop = ((((p.bar || 0) % bars) + bars) % bars);
      const frac = Math.max(0, Math.min(1, (barInLoop + (p.barFrac || 0)) / bars));
      if (el) { el.style.opacity = '1'; el.style.left = `${frac * 100}%`; }
      let idx;
      if (bounds) {
        idx = bounds.findIndex((edge) => frac < edge);
        if (idx < 0) idx = count - 1;
      } else {
        idx = Math.min(count - 1, Math.floor(frac * count));
      }
      if (idx !== last) { last = idx; setActive(idx); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, positionRef, count, notesBundle, durations]);

  if (!count) return null;
  const useWidths = Array.isArray(durations) && durations.length === count;
  return (
    <div className={`piano-chord-lane${muted ? ' is-muted' : ''}`}>
      {roman.map((token, i) => (
        <div
          key={`${token}-${i}`}
          className={`piano-chord-lane__slot${i === active ? ' is-active' : ''}`}
          style={useWidths ? { flexGrow: Math.max(0.001, durations[i]) } : undefined}
        >
          <RomanChord token={token} />
        </div>
      ))}
      <div ref={cursorRef} className="piano-chord-lane__cursor" style={{ opacity: 0 }} />
    </div>
  );
}

export default ChordLane;
