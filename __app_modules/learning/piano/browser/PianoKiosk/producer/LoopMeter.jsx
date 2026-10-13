import { useEffect, useRef, useState } from 'react';
import './LoopMeter.scss';

/**
 * LoopMeter — the bounded loop made VISIBLE (design §4). One segment per bar of
 * the current stack loop; the sounding bar lights and a playhead sweeps smoothly
 * across, snapping back to bar 1 at the loop boundary (this is the "sense of a
 * loop" the ever-climbing bar counter lacked).
 *
 * Driven by requestAnimationFrame reading the transport positionRef: the cursor
 * moves via `left` every frame (no React re-render); the active segment
 * re-renders only when the sounding bar changes. `positionRef.normalized` is
 * already 0..1 WITHIN the loop and resets each pass, so the wrap is automatic.
 *
 * @param {number} loopBars  whole-bar length of the loop (0 → renders nothing)
 * @param {{current:{normalized:number}}|null} positionRef
 * @param {boolean} isPlaying
 */
export function LoopMeter({ loopBars = 0, positionRef, isPlaying = false }) {
  const cursorRef = useRef(null);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const el = cursorRef.current;
    if (!isPlaying || !positionRef || loopBars <= 0) {
      setActive(-1);
      if (el) el.style.opacity = '0';
      return undefined;
    }
    let raf = 0;
    let last = -1;
    const frame = () => {
      const p = positionRef.current || {};
      const frac = Math.max(0, Math.min(1, p.normalized || 0));
      if (el) { el.style.opacity = '1'; el.style.left = `${frac * 100}%`; }
      const idx = Math.min(loopBars - 1, Math.floor(frac * loopBars));
      if (idx !== last) { last = idx; setActive(idx); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, positionRef, loopBars]);

  if (loopBars <= 0) return null;
  return (
    <div className="piano-loop-meter" role="img" aria-label={`${loopBars}-bar loop`}>
      {Array.from({ length: loopBars }, (_, i) => (
        <div key={i} className={`piano-loop-meter__bar${i === active ? ' is-active' : ''}`}>
          <span className="piano-loop-meter__num">{i + 1}</span>
        </div>
      ))}
      <div ref={cursorRef} className="piano-loop-meter__cursor" style={{ opacity: 0 }} />
    </div>
  );
}

export default LoopMeter;
