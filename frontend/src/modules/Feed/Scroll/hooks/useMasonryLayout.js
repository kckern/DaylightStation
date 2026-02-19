import { useRef, useReducer, useLayoutEffect, useCallback, useEffect } from 'react';
import { getLogger } from '../../../../lib/logging/Logger.js';

const COL_WIDTH = 320;
const GAP = 16;
const HEIGHT_TOLERANCE = 5; // px — ignore sub-pixel rendering noise from container queries
const log = getLogger().child({ module: 'masonry' });

export function useMasonryLayout(containerRef, items, isDesktop) {
  const posMapRef = useRef(new Map());      // id → { top, left, width }
  const heightMapRef = useRef(new Map());   // id → measured height
  const colHeightsRef = useRef([]);         // current column heights
  const prevItemsRef = useRef([]);
  const prevWidthRef = useRef(0);
  const colWidthRef = useRef(COL_WIDTH);    // actual column width for measuring
  const cardObserversRef = useRef(new Map()); // id → ResizeObserver
  const callbacksRef = useRef(new Map());   // id → stable callback ref
  const lastPosRef = useRef(new Map());     // last known positions (survives posMap clears)
  const dirtyRef = useRef(false);           // deferred recalculation flag
  const [layoutPass, bump] = useReducer(x => x + 1, 0);
  const bumpRef = useRef(bump);
  bumpRef.current = bump;

  // Stable per-ID callback ref — avoids recreating observers every render
  const measureRef = useCallback((id) => {
    if (!isDesktop) return () => {};

    let cb = callbacksRef.current.get(id);
    if (cb) return cb;

    cb = (node) => {
      // Cleanup previous observer
      const prev = cardObserversRef.current.get(id);
      if (prev) { prev.disconnect(); cardObserversRef.current.delete(id); }

      if (!node) return;

      const measure = () => {
        const h = node.offsetHeight;
        if (h === 0) return;
        const old = heightMapRef.current.get(id);
        if (old === h) return;
        // Ignore sub-pixel rendering noise
        if (old != null && Math.abs(old - h) <= HEIGHT_TOLERANCE) return;

        log.info('masonry.measure', { id: id.slice(0, 25), h, prev: old || 0, w: node.offsetWidth });
        heightMapRef.current.set(id, h);

        // If already placed and height changed, defer full relayout
        // DON'T clear posMap here — items stay at current positions to avoid
        // the offscreen→remeasure feedback loop
        if (posMapRef.current.has(id)) {
          log.warn('masonry.remeasure', { id: id.slice(0, 25), oldH: old, newH: h });
          dirtyRef.current = true;
        }

        bumpRef.current();
      };

      measure();

      const ro = new ResizeObserver(measure);
      ro.observe(node);
      cardObserversRef.current.set(id, ro);
    };

    callbacksRef.current.set(id, cb);
    return cb;
  }, [isDesktop]);

  // Clear callback cache when isDesktop changes
  useEffect(() => {
    return () => {
      callbacksRef.current.clear();
    };
  }, [isDesktop]);

  // Cleanup all card observers on unmount
  useEffect(() => {
    return () => {
      for (const ro of cardObserversRef.current.values()) ro.disconnect();
      cardObserversRef.current.clear();
      callbacksRef.current.clear();
    };
  }, []);

  // Core layout — layoutPass in deps ensures this re-runs after measurements
  useLayoutEffect(() => {
    if (!isDesktop || !containerRef.current) return;
    const cw = containerRef.current.offsetWidth;
    if (cw === 0) return;

    const numCols = Math.max(1, Math.floor((cw + GAP) / (COL_WIDTH + GAP)));
    const actualColW = (cw - GAP * (numCols - 1)) / numCols;
    colWidthRef.current = actualColW;

    // Detect reset conditions
    const prevIds = prevItemsRef.current.map(i => i.id);
    const currIds = items.map(i => i.id);
    const prevNumCols = prevWidthRef.current > 0
      ? Math.max(1, Math.floor((prevWidthRef.current + GAP) / (COL_WIDTH + GAP)))
      : 0;
    const itemsChanged = currIds.length < prevIds.length
      || (currIds.length > 0 && currIds[0] !== prevIds[0]);
    const colCountChanged = numCols !== prevNumCols && prevNumCols > 0;
    const widthChanged = cw !== prevWidthRef.current && prevWidthRef.current > 0;

    let didFullRecalc = false;
    if (itemsChanged || colCountChanged) {
      // Hard reset — items changed or column count changed: re-measure everything
      log.info('masonry.reset', { reason: itemsChanged ? 'items' : 'colCount', numCols, cw, items: currIds.length });
      posMapRef.current.clear();
      lastPosRef.current.clear();
      heightMapRef.current.clear();
      colHeightsRef.current = new Array(numCols).fill(0);
      dirtyRef.current = false;
    } else if (widthChanged || dirtyRef.current) {
      // Soft reset — width changed (e.g. scrollbar) or height changed: reposition only, keep heights
      if (widthChanged) log.info('masonry.reposition', { reason: 'width', cw, prev: prevWidthRef.current, numCols });
      for (const [id, pos] of posMapRef.current) lastPosRef.current.set(id, pos);
      posMapRef.current.clear();
      colHeightsRef.current = new Array(numCols).fill(0);
      dirtyRef.current = false;
      didFullRecalc = true;
    }

    prevWidthRef.current = cw;
    prevItemsRef.current = items;

    // Track placements per column for overlap detection
    const colPlacements = Array.from({ length: numCols }, () => []);
    for (const [id, pos] of posMapRef.current) {
      const h = heightMapRef.current.get(id) || 0;
      const col = Math.round(pos.left / (actualColW + GAP));
      if (col < numCols) colPlacements[col].push({ id, top: pos.top, h });
    }

    let placed = 0;
    let skipped = 0;
    for (const item of items) {
      if (posMapRef.current.has(item.id)) continue;
      const h = heightMapRef.current.get(item.id);
      if (!h) { skipped++; continue; }

      const minH = Math.min(...colHeightsRef.current);
      const col = colHeightsRef.current.indexOf(minH);

      const top = colHeightsRef.current[col];
      posMapRef.current.set(item.id, {
        top,
        left: col * (actualColW + GAP),
        width: actualColW,
      });
      colPlacements[col].push({ id: item.id, top, h });
      colHeightsRef.current[col] += h + GAP;
      placed++;
    }

    // Overlap detection
    let overlaps = 0;
    for (let c = 0; c < numCols; c++) {
      const cards = colPlacements[c].sort((a, b) => a.top - b.top);
      for (let i = 1; i < cards.length; i++) {
        const prev = cards[i - 1];
        const curr = cards[i];
        const prevBottom = prev.top + prev.h;
        if (prevBottom > curr.top + 1) {
          overlaps++;
          log.error('masonry.overlap', {
            col: c,
            cardA: prev.id.slice(0, 25), cardA_top: prev.top, cardA_h: prev.h, cardA_bottom: prevBottom,
            cardB: curr.id.slice(0, 25), cardB_top: curr.top,
            overlapPx: Math.round(prevBottom - curr.top),
          });
        }
      }
    }

    if (placed > 0 || skipped > 0) {
      log.info('masonry.layout', {
        pass: layoutPass, placed, skipped, total: items.length,
        positioned: posMapRef.current.size, numCols,
        colW: Math.round(actualColW),
        colHeights: colHeightsRef.current.map(Math.round),
        overlaps, recalc: didFullRecalc,
      });
    }

    // After a dirty recalc, items are still at lastPosRef positions in the DOM.
    // Bump once more so getItemStyle reads the fresh posMap on re-render.
    if (didFullRecalc && placed > 0) bump();
  }, [items, isDesktop, containerRef, layoutPass]);

  // ResizeObserver for container width changes — only bump when column count changes
  // or width drifts significantly (avoids scrollbar-induced thrashing)
  useLayoutEffect(() => {
    if (!isDesktop || !containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const cw = containerRef.current?.offsetWidth || 0;
      if (cw === prevWidthRef.current) return;
      const newCols = Math.max(1, Math.floor((cw + GAP) / (COL_WIDTH + GAP)));
      const oldCols = Math.max(1, Math.floor((prevWidthRef.current + GAP) / (COL_WIDTH + GAP)));
      // Only bump for column count changes or significant width shifts (>scrollbar width)
      if (newCols !== oldCols || Math.abs(cw - prevWidthRef.current) > 20) bump();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [isDesktop, containerRef]);

  const containerHeight = isDesktop
    ? Math.max(0, ...(colHeightsRef.current.length ? colHeightsRef.current : [0]))
    : undefined;

  const containerStyle = isDesktop
    ? { position: 'relative', height: containerHeight ? `${containerHeight}px` : 'auto' }
    : {};

  const getItemStyle = useCallback((id) => {
    if (!isDesktop) return {};
    const pos = posMapRef.current.get(id);
    if (pos) {
      return {
        position: 'absolute',
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        width: `${pos.width}px`,
        opacity: 1,
        transition: 'opacity 0.2s ease',
      };
    }
    // During recalc, keep items at last known position (prevents offscreen→remeasure loop)
    const last = lastPosRef.current.get(id);
    if (last) {
      return {
        position: 'absolute',
        top: `${last.top}px`,
        left: `${last.left}px`,
        width: `${last.width}px`,
        opacity: 1,
      };
    }
    // Truly new item — render at correct width but offscreen for initial measurement
    return {
      position: 'absolute',
      top: 0,
      left: '-9999px',
      width: `${colWidthRef.current}px`,
      opacity: 0,
    };
  }, [isDesktop]);

  return { containerStyle, getItemStyle, measureRef };
}
