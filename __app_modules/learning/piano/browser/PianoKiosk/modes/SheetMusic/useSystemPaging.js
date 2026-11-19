import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cancelScrollTween } from './scrollTween.js';
import { engravedSystems, systemCuts, pageAt, nextStart, prevStart, startForSystems } from './systemPaging.js';

// A drag this long, mostly along one axis, turns the page.
const SWIPE_PX = 48;

/** Vertical strips of the engraving that carry ink, in the renderer's coordinates. */
function measureInk(container) {
  const renderer = container?.querySelector('.musicxml-renderer');
  const svg = renderer?.querySelector('svg');
  if (!renderer || !svg) return [];
  const origin = renderer.getBoundingClientRect().top;
  const ink = [];
  for (const node of svg.querySelectorAll('*')) {
    if (node.firstElementChild) continue;
    const box = node.getBoundingClientRect();
    if (box.height > 0 && box.width > 0) ink.push([box.top - origin, box.bottom - origin]);
  }
  return ink;
}

/**
 * The Learn score as pages of whole systems (see systemPaging.js). The scroll
 * container stops scrolling; the engraving is moved and cut so that only the
 * systems of the current page show.
 *
 * @param {boolean} p.enabled
 * @param {{current: HTMLElement|null}} p.scrollRef - the score's container
 * @param {object} p.layout - the renderer's published layout (its identity marks a re-engrave)
 * @param {Array} p.measureRects - per-measure rectangles carrying `system`
 * @param {Array<[number, number]>} [p.overlayInk] - strips taken by overlays drawn above the staff
 * @param {(turn: {from: number, to: number, by: string}) => void} [p.onTurn]
 */
export default function useSystemPaging({ enabled, scrollRef, layout, measureRects, overlayInk, onTurn }) {
  const [start, setStart] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [ink, setInk] = useState([]);
  const systems = useMemo(() => (enabled ? engravedSystems(measureRects) : []), [enabled, measureRects]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) return undefined;
    // A page is placed by moving the engraving, never by scrolling the container.
    cancelScrollTween(el);
    el.scrollTop = 0; el.scrollLeft = 0;
    const read = () => setViewport(el.clientHeight);
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
    // `layout` too: coming back from a drill mounts a new container, and the
    // re-engrave that follows is what says so.
  }, [enabled, scrollRef, layout]);

  useLayoutEffect(() => {
    if (!enabled) return;
    setInk(measureInk(scrollRef.current));
  }, [enabled, scrollRef, layout]);

  const cuts = useMemo(() => systemCuts(systems, layout?.height ?? 0, overlayInk ? [...ink, ...overlayInk] : ink), [systems, layout?.height, ink, overlayInk]);
  const page = useMemo(() => (enabled ? pageAt(cuts, start, viewport) : null), [enabled, cuts, start, viewport]);

  const live = useRef({}); live.current = { cuts, viewport, start: page?.start ?? 0, onTurn };
  const turnTo = useCallback((pick, by) => {
    const { cuts: c, viewport: v, start: from, onTurn: notify } = live.current;
    if (c.length < 2) return;
    const to = pick(c, from, v);
    if (to === from) return;
    setStart(to);
    notify?.({ from, to, by });
  }, []);
  const next = useCallback((by = 'button') => turnTo(nextStart, by), [turnTo]);
  const prev = useCallback((by = 'button') => turnTo(prevStart, by), [turnTo]);
  /** Turn to the page that holds measures `inMeasure`..`outMeasure`. */
  const showMeasures = useCallback((inMeasure, outMeasure) => {
    const holds = systems.filter((system) => system.firstMeasure <= outMeasure && system.lastMeasure >= inMeasure);
    if (!holds.length) return;
    const first = systems.indexOf(holds[0]);
    const last = systems.indexOf(holds[holds.length - 1]);
    turnTo((c, from, v) => startForSystems(c, v, from, first, last), 'passage');
  }, [systems, turnTo]);

  // A swipe turns the page, and the tap it would otherwise end as is dropped.
  const press = useRef(null);
  const swipedAt = useRef(0);
  const onPointerDown = useCallback((event) => { press.current = { x: event.clientX, y: event.clientY }; }, []);
  const onPointerUp = useCallback((event) => {
    const from = press.current; press.current = null;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    const along = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    if (Math.abs(along) < SWIPE_PX) return;
    swipedAt.current = performance.now();
    if (along < 0) next('swipe'); else prev('swipe');
  }, [next, prev]);
  const onPointerCancel = useCallback(() => { press.current = null; }, []);
  const onClickCapture = useCallback((event) => {
    if (performance.now() - swipedAt.current > 400) return;
    swipedAt.current = 0;
    event.stopPropagation(); event.preventDefault();
  }, []);

  useEffect(() => { if (!enabled) setStart(0); }, [enabled]);

  if (!enabled || !page) return { page: null, style: undefined, handlers: null, next, prev, showMeasures };
  return {
    page,
    style: { '--page-shift': `${page.shift}px`, '--page-top': `${page.top}px`, '--page-bottom': `${page.bottom}px` },
    handlers: { onPointerDown, onPointerUp, onPointerCancel, onClickCapture },
    next, prev, showMeasures,
  };
}
