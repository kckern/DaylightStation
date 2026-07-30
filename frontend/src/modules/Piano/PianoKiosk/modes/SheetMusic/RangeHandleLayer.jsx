import React, { useRef, useState, useCallback } from 'react';
import { measureExtent } from './FocusRangeLayer.jsx';

// A press that never travels this far is a TAP, not a drag (wave-3 F). Generous
// on purpose: a finger on a kiosk glass always wobbles a pixel or three, and the
// two gestures mean very different things — a tap ARMS the edge (so the next tap
// on the music names its measure), a drag MOVES it directly.
const TAP_SLOP_PX = 8;
// How close to the scroll container's top/bottom edge a drag must come before the
// score creeps under it, and by how much per move event. A finger dragging the
// out-point down a long piece cannot lift to scroll — it would commit.
const EDGE_ZONE_PX = 48;
const EDGE_STEP_PX = 12;
// The handle's CSS width, and half of it: the grip straddles the extent it marks
// rather than sitting beside it, so the finger lands ON the boundary (SCSS keeps
// them in sync). The full width doubles as the minimum separation two grips need
// before they start covering each other.
const HANDLE_WIDTH_PX = 48;
const HANDLE_HALF_PX = HANDLE_WIDTH_PX / 2;
// Vertical slack around a system's staves — a pointer this far above/below still
// counts as "on" that system for the same-system nearest-column rule.
const BAND_SLACK_PX = 40;

/**
 * RangeHandleLayer — the loop range's two draggable endpoints, drawn on the score
 * (wave-3 F). These handles ARE the range's boundary visuals: FocusRangeLayer
 * keeps the tint, this owns the ends.
 *
 * Two gestures, one target:
 *  - **tap** (a press that barely moves) → `onArm(edge)`, exactly what the bar's
 *    mark buttons do: the next tap on the music names that edge's measure. A tap
 *    is the coarse, reliable gesture — it never needs the finger to land on a
 *    48px target twice.
 *  - **drag** → `onPreview(edge, measureIndex)` as measures are crossed, then
 *    `onCommit(edge, measureIndex, 'drag')` on release. The handle follows the
 *    finger sub-measure (visual only); what commits is always a whole measure.
 *    `onPreview(edge, null)` announces the drag ENDED (commit, cancel or miss
 *    alike), so a parent showing drag-only chrome can never latch it on.
 *
 * Geometry is passed in (the same offset space as the cursor / FocusRangeLayer /
 * MeasureGradeLayer), so this is pure/testable. The layer root is inert
 * (pointer-events: none) — only the two handle divs take pointer events, and they
 * stop the gesture from reaching the score's tap-to-seek underneath.
 *
 * @param {object} p
 * @param {Array<{index:number, firstStep:number, lastStep:number}>} [p.measures]
 * @param {Array<{x:number, top:number, bottom:number}>} [p.stepBoxes]
 * @param {{inMeasure:number, outMeasure:number}} [p.range] - the COMMITTED range
 * @param {(edge:'in'|'out') => void} [p.onArm]
 * @param {(edge:'in'|'out', measureIndex:number, via:'drag') => void} [p.onCommit]
 * @param {(edge:'in'|'out', measureIndex:number|null) => void} [p.onPreview]
 * @param {{current: HTMLElement|null}} [p.scrollRef] - the score's scroll container
 */
export default function RangeHandleLayer({
  measures = [], stepBoxes = [], range = null, onArm, onCommit, onPreview, scrollRef,
}) {
  const rootRef = useRef(null);
  const dragRef = useRef(null); // { edge, startX, startY, moved, lastMeasure }
  // Where the finger is, while it is down and past the slop — the only reason this
  // is state rather than a ref: the handle has to repaint under the finger.
  const [dragPos, setDragPos] = useState(null); // { edge, x } | null

  // Client → renderer-local. The root spans the renderer (inset: 0), so its rect
  // is the offset origin every `stepBoxes` coordinate is expressed against.
  const localPoint = useCallback((e) => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }, []);

  // Nearest measure under a point. Within a system it is the nearest step column
  // (the coarse rule endpoint picking uses everywhere). A point BETWEEN systems
  // does not reject the way an armed tap does (measureAtPoint returns -1 there):
  // mid-drag there is no way to tell the user "miss", and a dead zone in the
  // gutter reads as the handle having come off the finger — so the vertical
  // distance is merely weighted and the nearest system always wins.
  const measureUnder = useCallback((pt) => {
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < stepBoxes.length; i++) {
      const b = stepBoxes[i];
      if (!b) continue;
      const inBand = pt.y >= b.top - BAND_SLACK_PX && pt.y <= b.bottom + BAND_SLACK_PX;
      const d = Math.abs(pt.x - b.x)
        + (inBand ? 0 : Math.abs(pt.y - (b.top + b.bottom) / 2) * 2);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI < 0) return -1;
    return measures.findIndex((mm) => bestI >= mm.firstStep && bestI <= mm.lastStep);
  }, [stepBoxes, measures]);

  const endDrag = useCallback((edge) => {
    dragRef.current = null;
    setDragPos(null);
    onPreview?.(edge, null); // the drag is over — drop any drag-only chrome
  }, [onPreview]);

  const onDown = useCallback((edge) => (e) => {
    // A press on a handle is never a press on the music behind it: the scroll
    // container's tap-to-seek (and, while armed, its endpoint commit) must not
    // also fire from the gesture that grabbed this handle.
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { edge, startX: e.clientX, startY: e.clientY, moved: false, lastMeasure: null };
  }, []);

  const onMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > TAP_SLOP_PX) d.moved = true;
    if (!d.moved) return; // still inside the tap slop — this may yet be a tap
    const pt = localPoint(e);
    setDragPos({ edge: d.edge, x: pt.x });
    const mi = measureUnder(pt);
    if (mi >= 0 && mi !== d.lastMeasure) { d.lastMeasure = mi; onPreview?.(d.edge, mi); }
    // Creep the score under the finger near either edge of the viewport.
    const el = scrollRef?.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + EDGE_ZONE_PX) el.scrollTop -= EDGE_STEP_PX;
      else if (e.clientY > r.bottom - EDGE_ZONE_PX) el.scrollTop += EDGE_STEP_PX;
    }
  }, [localPoint, measureUnder, onPreview, scrollRef]);

  const onUp = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return; // a stray up (post-cancel, or a press that started elsewhere)
    if (!d.moved) {
      dragRef.current = null;
      setDragPos(null);
      onArm?.(d.edge); // a still press ARMS this edge — no preview cycle happened
      return;
    }
    const mi = measureUnder(localPoint(e));
    if (mi >= 0) onCommit?.(d.edge, mi, 'drag');
    endDrag(d.edge);
  }, [endDrag, localPoint, measureUnder, onArm, onCommit]);

  const onCancel = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved) { dragRef.current = null; setDragPos(null); return; } // never became a drag
    endDrag(d.edge);
  }, [endDrag]);

  if (!range) return null;
  const inM = measures[range.inMeasure];
  const outM = measures[range.outMeasure];
  const inExt = inM && measureExtent(inM, stepBoxes);
  const outExt = outM && measureExtent(outM, stepBoxes);
  if (!inExt || !outExt) return null;

  // Where each grip sits when it is not being dragged. Normally the boundary it
  // marks — but a one-measure range on a single onset puts both extents at the
  // SAME x, and two 48px grips at one x means the later-painted one (out) fully
  // covers the other: the in-point would be unreachable by tap or drag, on exactly
  // the range shape the endpoint flow creates first (§F plants a one-measure range).
  // Spread them symmetrically about the boundary so each keeps a reachable half.
  // Only when they share a vertical band: a range whose ends are on different
  // systems can have any x relationship without ever overlapping on screen.
  let inAnchor = inExt.left;
  let outAnchor = outExt.right;
  const sameBand = inExt.top < outExt.bottom && outExt.top < inExt.bottom;
  if (sameBand && outAnchor - inAnchor < HANDLE_WIDTH_PX) {
    const mid = (inAnchor + outAnchor) / 2;
    inAnchor = mid - HANDLE_HALF_PX;
    outAnchor = mid + HANDLE_HALF_PX;
  }

  const handle = (edge, ext, anchor) => {
    const x = dragPos?.edge === edge ? dragPos.x : anchor;
    return (
      <div
        className={`piano-score-range-handle piano-score-range-handle--${edge}${dragPos?.edge === edge ? ' is-dragging' : ''}`}
        role="slider"
        aria-label={edge === 'in' ? 'Loop start handle' : 'Loop end handle'}
        aria-valuenow={(edge === 'in' ? range.inMeasure : range.outMeasure) + 1}
        aria-valuetext={`Measure ${(edge === 'in' ? range.inMeasure : range.outMeasure) + 1}`}
        style={{ left: x - HANDLE_HALF_PX, top: ext.top - 12, height: ext.bottom - ext.top + 24 }}
        onPointerDown={onDown(edge)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        // Belt and braces for the stopPropagation on pointerdown: a real browser
        // synthesises a click from the same press, and the score's seek handler
        // listens for CLICK — without this, arming an edge by tapping its handle
        // would immediately consume the arm on the tap that created it.
        onClick={(e) => e.stopPropagation()}
      />
    );
  };

  return (
    <div ref={rootRef} className="piano-score-range-handles">
      {handle('in', inExt, inAnchor)}
      {handle('out', outExt, outAnchor)}
    </div>
  );
}
