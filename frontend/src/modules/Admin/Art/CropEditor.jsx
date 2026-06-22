import React, { useCallback, useEffect, useRef } from 'react';
import { clampBand } from './cropGeometry.js';

// Overlay on the loupe artwork: drag (or keyboard-nudge) the top/bottom edges of
// the keep-window to set the crop band; toggle "Don't crop"; reset to auto.
// Geometry is in % of the displayed image height, so it's resolution-independent.
export default function CropEditor({ crop, onCrop }) {
  const disabled = crop?.enabled === false;
  const top = Number.isFinite(crop?.top) ? crop.top : 8;
  const bottom = Number.isFinite(crop?.bottom) ? crop.bottom : 8;
  const stageRef = useRef(null);
  const dragRef = useRef(null); // { edge, startY, startTop, startBottom, h }
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

  const commit = useCallback((band) => {
    onCrop({ enabled: true, ...clampBand(band) });
  }, [onCrop]);

  const onHandleKey = useCallback((edge) => (e) => {
    const step = e.shiftKey ? 0.2 : 1;
    let d = 0;
    if (e.key === 'ArrowUp') d = -step;
    else if (e.key === 'ArrowDown') d = step;
    else return;
    e.preventDefault();
    if (edge === 'top') commit({ top: top + d, bottom });
    else commit({ top, bottom: bottom + d });
  }, [top, bottom, commit]);

  const onPointerDown = useCallback((edge) => (e) => {
    e.preventDefault();
    const h = stageRef.current?.clientHeight || 1;
    dragRef.current = { edge, startY: e.clientY, startTop: top, startBottom: bottom, h };
    const move = (ev) => {
      const dref = dragRef.current;
      if (!dref) return;
      const deltaPct = ((ev.clientY - dref.startY) / dref.h) * 100;
      if (dref.edge === 'top') commit({ top: dref.startTop + deltaPct, bottom: dref.startBottom });
      else commit({ top: dref.startTop, bottom: dref.startBottom - deltaPct });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      listenersRef.current = null;
    };
    listenersRef.current = { move, up };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [top, bottom, commit]);

  return (
    <div className="crop-editor" ref={stageRef} data-testid="crop-editor">
      {!disabled && (
        <>
          <div className="crop-editor__shade crop-editor__shade--top" style={{ height: `${top}%` }} />
          <div className="crop-editor__shade crop-editor__shade--bottom" style={{ height: `${bottom}%` }} />
          <div className="crop-editor__window" style={{ top: `${top}%`, bottom: `${bottom}%` }}>
            <button type="button" data-testid="crop-handle-top" className="crop-editor__handle crop-editor__handle--top"
              aria-label="Top crop edge" onPointerDown={onPointerDown('top')} onKeyDown={onHandleKey('top')} />
            <button type="button" data-testid="crop-handle-bottom" className="crop-editor__handle crop-editor__handle--bottom"
              aria-label="Bottom crop edge" onPointerDown={onPointerDown('bottom')} onKeyDown={onHandleKey('bottom')} />
            <span className="crop-editor__readout">top {top}% · bottom {bottom}%</span>
          </div>
        </>
      )}
      <div className="crop-editor__controls">
        <label className="crop-editor__toggle">
          <input type="checkbox" checked={disabled}
            onChange={(e) => { const off = e.currentTarget.checked; onCrop(off ? { enabled: false } : { enabled: true, top, bottom }); }} />
          Don&apos;t crop (matted)
        </label>
        <button type="button" className="crop-editor__reset" onClick={() => onCrop(null)}>Reset to auto</button>
      </div>
    </div>
  );
}
