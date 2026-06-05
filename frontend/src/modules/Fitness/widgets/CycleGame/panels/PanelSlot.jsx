import React, { useEffect, useRef, useState, cloneElement, isValidElement } from 'react';
import PropTypes from 'prop-types';

/**
 * Per-zone mount + enter animation. The layout owns measurement: the slot
 * measures its own grid-cell box and injects a stable `zoneBox` ({width,height})
 * into the panel, so panels size from a parent-provided box instead of running
 * their own ResizeObserver (which caused measure→resize→measure thrash). The box
 * only updates when it actually changes. Keyed by panelId so a swap remounts.
 *
 * Prefer the `render` prop: PanelSlot CALLS it with { zoneBox }, so the element it
 * returns has a STABLE type (SpeedoRow, DistanceChart, …) and React reconciles it
 * in place. The legacy `children` path used `<Factory />` as a component type, but
 * CycleRaceScreen rebuilds those factory closures every tick — a new function
 * identity each render — so React remounted the whole panel subtree every frame
 * (reloading avatars, resetting CSS transitions). `render` avoids that.
 */
export default function PanelSlot({ panelId, render, children }) {
  const ref = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setBox((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    return () => { if (ro) ro.disconnect(); };
  }, [panelId]);

  const content = typeof render === 'function'
    ? render({ zoneBox: box })
    : (isValidElement(children) ? cloneElement(children, { zoneBox: box }) : children);
  return (
    <div ref={ref} className="race-layout__slot" data-panel={panelId}>{content}</div>
  );
}
PanelSlot.propTypes = { panelId: PropTypes.string, render: PropTypes.func, children: PropTypes.node };
