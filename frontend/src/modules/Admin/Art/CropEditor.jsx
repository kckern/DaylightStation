import React, { useCallback, useEffect, useRef } from 'react';
import { clampPair } from './cropGeometry.js';

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
  const listenersRef = useRef(null); // { move, up } — for unmount cleanup

  // Drop any in-flight drag listeners if we unmount mid-drag (e.g. navigating to
  // the next work), so a stray pointermove can't commit onto an unmounted editor.
  useEffect(() => () => {
    if (listenersRef.current) {
      window.removeEventListener('pointermove', listenersRef.current.move);
      window.removeEventListener('pointerup', listenersRef.current.up);
      listenersRef.current = null;
    }
  }, []);

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

  const onPointerDown = useCallback((edge) => (e) => {
    e.preventDefault();
    const size = stageRef.current?.[ax.sizeDim] || 1;
    const start0 = e[ax.clientAxis];
    const move = (ev) => {
      const deltaPct = ((ev[ax.clientAxis] - start0) / size) * 100;
      // The end edge's margin shrinks as you drag it toward the far side.
      if (edge === 'a') commit(a + deltaPct, b);
      else commit(a, b - deltaPct);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      listenersRef.current = null;
    };
    listenersRef.current = { move, up };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [a, b, commit, ax]);

  const win = axis === 'horizontal' ? { left: `${a}%`, right: `${b}%` } : { top: `${a}%`, bottom: `${b}%` };

  return (
    <div className={`crop-editor crop-editor--${axis}`} ref={stageRef} data-testid="crop-editor">
      {!disabled && (
        <>
          <div className={`crop-editor__shade crop-editor__shade--${ax.a}`} style={{ [ax.dimCss]: `${a}%` }} />
          <div className={`crop-editor__shade crop-editor__shade--${ax.b}`} style={{ [ax.dimCss]: `${b}%` }} />
          <div className="crop-editor__window" style={win}>
            <button type="button" data-testid={`crop-handle-${ax.a}`}
              className={`crop-editor__handle crop-editor__handle--${ax.a}`}
              aria-label={`${ax.a} crop edge`} onPointerDown={onPointerDown('a')} onKeyDown={onHandleKey('a')} />
            <button type="button" data-testid={`crop-handle-${ax.b}`}
              className={`crop-editor__handle crop-editor__handle--${ax.b}`}
              aria-label={`${ax.b} crop edge`} onPointerDown={onPointerDown('b')} onKeyDown={onHandleKey('b')} />
            <span className="crop-editor__readout">{ax.a} {a}% · {ax.b} {b}%</span>
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
