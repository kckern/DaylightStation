import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { clampPair } from "./cropGeometry.js";

// Per-axis config: which margins, which dimension/coordinate to drag along.
const AXES = {
  vertical:   { a: 'top',  b: 'bottom', sizeDim: 'clientHeight', clientAxis: 'clientY', dimCss: 'height' },
  horizontal: { a: 'left', b: 'right',  sizeDim: 'clientWidth',  clientAxis: 'clientX', dimCss: 'width'  },
};

// Overlay on the loupe artwork: drag (or keyboard-nudge) the two opposing edges of
// the keep-window to set the crop band; toggle "Don't crop"; reset to auto. The
// axis (vertical = top/bottom, horizontal = left/right for a panorama) is chosen by
// the caller from the work's orientation. Geometry is in % of the displayed image,
// so it's resolution-independent.
export default function CropEditor({ crop, onCrop, axis = 'vertical' }) {
  const ax = AXES[axis] || AXES.vertical;
  const disabled = crop?.enabled === false;
  const a = Number.isFinite(crop?.[ax.a]) ? crop[ax.a] : 8;   // start-edge margin %
  const b = Number.isFinite(crop?.[ax.b]) ? crop[ax.b] : 8;   // end-edge margin %
  const stageRef = useRef(null);
  const drag = useRef(null);
  const [preview, setPreview] = useState(null);

  const releaseDrag = useCallback(() => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (active.handle.hasPointerCapture(active.id)) active.handle.releasePointerCapture(active.id);
    setPreview(null);
  }, []);

  // The loupe can switch artworks without remounting the handles. Its save
  // callback belongs to the focused work, so retire any gesture on replacement.
  useLayoutEffect(() => releaseDrag, [onCrop, ax, disabled, releaseDrag]);

  const commit = useCallback((sa, sb) => {
    const [ca, cb] = clampPair(sa, sb);
    onCrop({ enabled: true, [ax.a]: ca, [ax.b]: cb });
  }, [onCrop, ax.a, ax.b]);

  const onHandleKey = useCallback((edge) => (e) => {
    const step = e.shiftKey ? 0.2 : 1;
    let d = 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') d = -step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') d = step;
    else return;
    e.preventDefault();
    if (edge === 'a') commit(a + d, b);
    else commit(a, b + d);
  }, [a, b, commit]);

  const onPointerDown = edge => event => {
    if (drag.current || event.button !== 0) return;
    const size = stageRef.current?.[ax.sizeDim];
    if (!size) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      handle: event.currentTarget, id: event.pointerId, edge, size,
      start: event[ax.clientAxis], a, b,
    };
  };

  const onPointerChange = event => {
    const active = drag.current;
    if (!active || event.pointerId !== active.id) return;
    const delta = (event[ax.clientAxis] - active.start) * 100 / active.size;
    const pair = active.edge === 'a'
      ? clampPair(active.a + delta, active.b)
      : clampPair(active.a, active.b - delta);
    if (event.type === 'pointerup') {
      releaseDrag();
      if (pair[0] !== active.a || pair[1] !== active.b) {
        onCrop({ enabled: true, [ax.a]: pair[0], [ax.b]: pair[1] });
      }
    } else setPreview(pair);
  };
  const onCancel = event => {
    if (drag.current?.id === event.pointerId) releaseDrag();
  };
  const [shownA, shownB] = preview ?? [a, b];
  const win = { [ax.a]: `${shownA}%`, [ax.b]: `${shownB}%` };

  return (
    <div className={`crop-editor crop-editor--${axis}`} ref={stageRef} data-testid="crop-editor"
      onPointerMove={onPointerChange} onPointerUp={onPointerChange}
      onPointerCancel={onCancel} onLostPointerCapture={onCancel}>
      {!disabled && (
        <>
          <div className={`crop-editor__shade crop-editor__shade--${ax.a}`} style={{ [ax.dimCss]: `${shownA}%` }} />
          <div className={`crop-editor__shade crop-editor__shade--${ax.b}`} style={{ [ax.dimCss]: `${shownB}%` }} />
          <div className="crop-editor__window" style={win}>
            <button type="button" data-testid={`crop-handle-${ax.a}`}
              className={`crop-editor__handle crop-editor__handle--${ax.a}`}
              style={{ touchAction: 'none' }} aria-label={`${ax.a} crop edge`} onPointerDown={onPointerDown('a')} onKeyDown={onHandleKey('a')} />
            <button type="button" data-testid={`crop-handle-${ax.b}`}
              className={`crop-editor__handle crop-editor__handle--${ax.b}`}
              style={{ touchAction: 'none' }} aria-label={`${ax.b} crop edge`} onPointerDown={onPointerDown('b')} onKeyDown={onHandleKey('b')} />
            <span className="crop-editor__readout">{ax.a} {shownA}% · {ax.b} {shownB}%</span>
          </div>
        </>
      )}
      <div className="crop-editor__controls">
        <label className="crop-editor__toggle">
          <input type="checkbox" checked={disabled}
            onChange={(e) => { const off = e.currentTarget.checked; onCrop(off ? { enabled: false } : { enabled: true, [ax.a]: a, [ax.b]: b }); }} />
          Don&apos;t crop (matted)
        </label>
        <button type="button" className="crop-editor__reset" onClick={() => onCrop(null)}>Reset to auto</button>
      </div>
    </div>
  );
}
