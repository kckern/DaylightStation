import { useEffect, useRef, useState } from 'react';
import { RomanChord } from '../../components/roman/RomanProgression.jsx';
import { keyedChordName } from '../../components/roman/keyedChordName.js';
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
 * Chords are distributed evenly over the loop (a good default; per-chord
 * durations aren't stored), wrapping every `barSpan` bars.
 *
 * When `tonicPc` is given (the Producer keys every loop to the jam), each slot
 * also shows the CONCRETE keyed chord name (D, Dsus4…) above the Roman numeral
 * — the loop is instantiated in a real key, so name it (design §7). Omit tonicPc
 * (the abstract library) → Roman only.
 *
 * @param {string[]} roman
 * @param {{notes:Array, ppq:number, barSpan:number}|null} notesBundle
 * @param {{current:{bar:number,barFrac:number}}|null} positionRef
 * @param {boolean} isPlaying
 * @param {boolean} muted
 * @param {number|null} tonicPc  pitch class Roman `I` sounds at (null → Roman only)
 */
export function ChordLane({ roman, notesBundle, positionRef, isPlaying = false, muted = false, tonicPc = null }) {
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
    let raf = 0;
    let last = -1;
    const frame = () => {
      const p = positionRef.current || {};
      const barInLoop = ((((p.bar || 0) % bars) + bars) % bars);
      const frac = Math.max(0, Math.min(1, (barInLoop + (p.barFrac || 0)) / bars));
      if (el) { el.style.opacity = '1'; el.style.left = `${frac * 100}%`; }
      const idx = Math.min(count - 1, Math.floor(frac * count));
      if (idx !== last) { last = idx; setActive(idx); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, positionRef, count, notesBundle]);

  if (!count) return null;
  return (
    <div className={`piano-chord-lane${muted ? ' is-muted' : ''}`}>
      {roman.map((token, i) => {
        const keyed = Number.isFinite(tonicPc) ? keyedChordName(token, tonicPc) : null;
        return (
          <div key={`${token}-${i}`} className={`piano-chord-lane__slot${i === active ? ' is-active' : ''}`}>
            {keyed && <span className="piano-chord-lane__keyed">{keyed}</span>}
            <RomanChord token={token} />
          </div>
        );
      })}
      <div ref={cursorRef} className="piano-chord-lane__cursor" style={{ opacity: 0 }} />
    </div>
  );
}

export default ChordLane;
