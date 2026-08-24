import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

const DEFAULT_ESTIMATED_HEIGHT = 360;
const DEFAULT_OVERSCAN_PX = 900;
const DEFAULT_MAX_MOUNTED = 60;

export function calculateVirtualRange(items, getHeight, {
  viewportTop = 0,
  viewportHeight = 900,
  containerOffset = 0,
  estimatedHeight = DEFAULT_ESTIMATED_HEIGHT,
  overscan = DEFAULT_OVERSCAN_PX,
  maxMounted = DEFAULT_MAX_MOUNTED,
  gap = 10,
} = {}) {
  const offsets = [0];
  for (const item of items) offsets.push(offsets.at(-1) + (getHeight(item) || estimatedHeight) + gap);
  const localTop = Math.max(0, viewportTop - containerOffset);
  const min = Math.max(0, localTop - overscan);
  const max = localTop + viewportHeight + overscan;
  let start = 0;
  while (start < items.length && offsets[start + 1] < min) start += 1;
  let end = start;
  while (end < items.length && offsets[end] < max && end - start < maxMounted) end += 1;
  end = Math.max(end, Math.min(items.length, start + Math.min(12, maxMounted)));
  return { start, end, paddingTop: offsets[start], paddingBottom: Math.max(0, offsets.at(-1) - offsets[end]) };
}

export function useVirtualFeedWindow(containerRef, items, enabled, options = {}) {
  const scrollRef = options.scrollRef;
  const estimatedHeight = options.estimatedHeight ?? DEFAULT_ESTIMATED_HEIGHT;
  const overscan = options.overscan ?? DEFAULT_OVERSCAN_PX;
  const maxMounted = options.maxMounted ?? DEFAULT_MAX_MOUNTED;
  const gap = options.gap ?? 10;
  const heightsRef = useRef(new Map());
  const observersRef = useRef(new Map());
  const callbacksRef = useRef(new Map());
  const [, bump] = useReducer(value => value + 1, 0);
  const [viewport, setViewport] = useState({ top: 0, height: 900 });

  useEffect(() => {
    if (!enabled) return undefined;
    const scrollEl = scrollRef?.current || document.querySelector('.feed-content');
    if (!scrollEl) return undefined;
    let frame = null;
    const update = () => {
      frame = null;
      setViewport({ top: scrollEl.scrollTop, height: scrollEl.clientHeight });
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update); };
    update();
    scrollEl.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      scrollEl.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, scrollRef]);

  useEffect(() => () => {
    for (const observer of observersRef.current.values()) observer.disconnect();
  }, []);

  const measureRef = useCallback(id => {
    if (!enabled) return () => {};
    if (callbacksRef.current.has(id)) return callbacksRef.current.get(id);
    const callback = node => {
      observersRef.current.get(id)?.disconnect();
      observersRef.current.delete(id);
      if (!node) return;
      const measure = () => {
        const height = node.offsetHeight;
        if (height > 0 && Math.abs((heightsRef.current.get(id) || 0) - height) > 2) {
          heightsRef.current.set(id, height);
          bump();
        }
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      observersRef.current.set(id, observer);
    };
    callbacksRef.current.set(id, callback);
    return callback;
  }, [enabled]);

  return useMemo(() => {
    if (!enabled || items.length <= maxMounted) {
      return { items, startIndex: 0, paddingTop: 0, paddingBottom: 0, measureRef };
    }
    const range = calculateVirtualRange(items, item => heightsRef.current.get(item.id), {
      viewportTop: viewport.top,
      viewportHeight: viewport.height,
      containerOffset: containerRef.current?.offsetTop || 0,
      estimatedHeight,
      overscan,
      maxMounted,
      gap,
    });
    return {
      items: items.slice(range.start, range.end),
      startIndex: range.start,
      paddingTop: range.paddingTop,
      paddingBottom: range.paddingBottom,
      measureRef,
    };
  }, [containerRef, enabled, estimatedHeight, gap, items, maxMounted, measureRef, overscan, viewport]);
}

export function useMasonryVirtualWindow(containerRef, items, enabled, getItemMetrics) {
  const [viewport, setViewport] = useState({ top: 0, height: 900 });
  useEffect(() => {
    if (!enabled) return undefined;
    const scrollEl = document.querySelector('.feed-content');
    if (!scrollEl) return undefined;
    let frame = null;
    const update = () => {
      frame = null;
      setViewport({ top: scrollEl.scrollTop, height: scrollEl.clientHeight });
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update); };
    update();
    scrollEl.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      scrollEl.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  if (!enabled || items.length <= DEFAULT_MAX_MOUNTED) return items;
  const localTop = Math.max(0, viewport.top - (containerRef.current?.offsetTop || 0));
  const min = Math.max(0, localTop - DEFAULT_OVERSCAN_PX);
  const max = localTop + viewport.height + DEFAULT_OVERSCAN_PX;
  const visible = [];
  const pending = [];
  for (const item of items) {
    const metrics = getItemMetrics(item.id);
    if (!metrics) pending.push(item);
    else if (metrics.top + metrics.height >= min && metrics.top <= max) visible.push(item);
  }
  return [...visible, ...pending.slice(0, Math.max(0, DEFAULT_MAX_MOUNTED - visible.length))].slice(0, DEFAULT_MAX_MOUNTED);
}

export default useVirtualFeedWindow;
