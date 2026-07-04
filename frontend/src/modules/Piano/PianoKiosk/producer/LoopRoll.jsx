import { useEffect, useRef, useMemo } from 'react';

/**
 * LoopRoll — a compact piano-roll of a loop's notes with a playhead cursor that
 * sweeps in time with the transport (design §7 "see the loop play").
 *
 * WHY BLOCKS, NOT STAFF: staff notation is heavy to render and near-impossible
 * to animate a cursor across; a piano-roll maps time → x and pitch → y, so the
 * loop is legible at a glance in a mixer row and the cursor is one moving rect.
 *
 * The SVG stretches to the row width (preserveAspectRatio="none"). The cursor is
 * positioned by requestAnimationFrame reading `positionRef` directly — it never
 * triggers a React re-render, and it wraps every `barSpan` bars so a short loop's
 * cursor recycles with the loop, not the whole song.
 *
 * @param {object} props
 * @param {Array<{ticks:number,durationTicks:number,midi:number}>} props.notes
 * @param {number} props.ppq - ticks per quarter note
 * @param {number} [props.barSpan] - loop length in bars (default 1)
 * @param {{current:{bar:number,beat:number}}} [props.positionRef] - transport position
 * @param {boolean} [props.isPlaying]
 * @param {boolean} [props.muted]
 */
const H = 40;              // viewBox height (user units)
const W = 1000;            // viewBox width (user units; stretched to container)
const BEATS_PER_BAR = 4;   // producer loops are 4/4 (all bricks are 4/4)

/** Loop length in bars: the declared barSpan if known, else derived from the
 *  latest note end (real bricks don't carry barSpan). Shared with the Roman
 *  chord-highlight math so the cursor and the lit chord agree on the cycle. */
export function loopBars(notes, ppq, barSpan) {
  const declared = Math.round(barSpan);
  if (declared > 0) return declared;
  if (!Array.isArray(notes) || notes.length === 0 || !(ppq > 0)) return 1;
  let end = 0;
  for (const n of notes) end = Math.max(end, n.ticks + (n.durationTicks || 0));
  return Math.max(1, Math.ceil(end / (BEATS_PER_BAR * ppq)));
}

export function LoopRoll({ notes, ppq, barSpan = 1, positionRef, isPlaying = false, muted = false }) {
  const cursorRef = useRef(null);

  const model = useMemo(() => {
    if (!Array.isArray(notes) || notes.length === 0 || !(ppq > 0)) return null;
    const bars = loopBars(notes, ppq, barSpan);
    const totalTicks = bars * BEATS_PER_BAR * ppq;
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
    if (!Number.isFinite(lo)) return null;
    lo -= 1; hi += 1; // one-semitone padding top & bottom
    return { bars, totalTicks, lo, span: Math.max(1, hi - lo) };
  }, [notes, ppq, barSpan]);

  useEffect(() => {
    const el = cursorRef.current;
    if (!el || !model) return undefined;
    if (!isPlaying || !positionRef) { el.style.opacity = '0'; return undefined; }
    let raf = 0;
    const frame = () => {
      const p = positionRef.current || {};
      const barInLoop = (((p.bar || 0) % model.bars) + model.bars) % model.bars;
      const beatInLoop = (barInLoop * BEATS_PER_BAR) + (p.beat || 0);
      const frac = Math.max(0, Math.min(1, beatInLoop / (model.bars * BEATS_PER_BAR)));
      el.setAttribute('x', frac * W);
      el.style.opacity = '1';
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, positionRef, model]);

  if (!model) return null;
  const { bars, totalTicks, lo, span } = model;

  return (
    <svg
      className={`piano-loop-roll${muted ? ' is-muted' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="loop"
    >
      {Array.from({ length: bars + 1 }, (_, i) => {
        const x = (i / bars) * W;
        return <line key={`bar${i}`} className="piano-loop-roll__grid" x1={x} y1="0" x2={x} y2={H} />;
      })}
      {notes.map((n, i) => {
        const x = (n.ticks / totalTicks) * W;
        const w = Math.max(3, ((n.durationTicks || ppq) / totalTicks) * W);
        const yTop = H - ((n.midi - lo) / span) * H;
        const h = Math.max(2.5, H / span);
        return (
          <rect
            key={i}
            className="piano-loop-roll__note"
            x={x}
            y={yTop - h}
            width={w}
            height={h}
            rx="1.5"
          />
        );
      })}
      <rect
        ref={cursorRef}
        className="piano-loop-roll__cursor"
        x="0"
        y="0"
        width="8"
        height={H}
        style={{ opacity: 0 }}
      />
    </svg>
  );
}

export default LoopRoll;
