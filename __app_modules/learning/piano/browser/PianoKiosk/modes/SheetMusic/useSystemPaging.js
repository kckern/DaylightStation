import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { engravedSystems, systemCuts, pageAt, nextStart, prevStart, startForSystems, startForCursor, tallestSystem, windowEnd } from './systemPaging.js';

const NO_INK = [];
// A drag this long, mostly along one axis, turns the page.
const SWIPE_PX = 48;
// How long a turn made for the cursor takes to slide (matches the stylesheet).
export const GLIDE_MS = 260;

/** Strips of the engraving that carry ink, `[top, bottom, left, right]` in the renderer's coordinates. */
function measureInk(container) {
  const renderer = container?.querySelector('.musicxml-renderer');
  const svg = renderer?.querySelector('svg');
  if (!renderer || !svg) return [];
  const { top: origin, left: originX } = renderer.getBoundingClientRect();
  const ink = [];
  for (const node of svg.querySelectorAll('*')) {
    if (node.firstElementChild) continue;
    const box = node.getBoundingClientRect();
    if (box.height > 0 && box.width > 0) ink.push([box.top - origin, box.bottom - origin, box.left - originX, box.right - originX]);
  }
  return ink;
}

/**
 * The score as pages of whole systems (see systemPaging.js), in every mode. The
 * container never scrolls; the engraving is moved and cut so that only the
 * systems of the current page show.
 *
 * A turn is view state only: it moves and clips the engraving and touches no
 * transport, click or grading clock. A turn made for the cursor slides (the
 * system being read moves to the top, so the eye can follow it); for that
 * moment the cut is the union of both pages, and the slide is a transform, which
 * costs no repaint of the notation. Every other turn is immediate.
 *
 * @param {boolean} p.enabled
 * @param {{current: HTMLElement|null}} p.scrollRef - the score's container
 * @param {object} p.layout - the renderer's published layout (its identity marks a re-engrave)
 * @param {Array} p.measureRects - per-measure rectangles carrying `system`
 * @param {Array<[number, number]>|((ink: Array) => Array<[number, number]>)} [p.overlayInk] - strips
 *   taken by overlays drawn over a staff (the passage numbers), or a function of the
 *   engraving's measured ink that returns them (an overlay placed clear of the ink it
 *   would cover). Each belongs to the system under it: no cut falls below one.
 * @param {(turn: {from: number, to: number, by: string}) => void} [p.onTurn]
 * The result carries `ink`, the strips measured on the current engraving, so an
 * overlay can be placed by the same measurement the page cut uses.
 */
export default function useSystemPaging({ enabled, scrollRef, layout, measureRects, overlayInk, onTurn }) {
  const [start, setStart] = useState(0);
  const [viewport, setViewport] = useState(0);
  // The ink strips, with the engraving they were measured on.
  const [inked, setInked] = useState({ layout: null, ink: [] });
  const inkCurrent = inked.layout === layout;
  const ink = inkCurrent ? inked.ink : NO_INK;
  // While a cursor turn slides: the strip that both pages cover.
  const [glide, setGlide] = useState(null);
  const glideTimer = useRef(null);
  const systems = useMemo(() => (enabled ? engravedSystems(measureRects) : []), [enabled, measureRects]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) return undefined;
    // A page is placed by moving the engraving, never by scrolling the container.
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
    setInked({ layout, ink: measureInk(scrollRef.current) });
  }, [enabled, scrollRef, layout]);

  const cuts = useMemo(() => {
    const extra = typeof overlayInk === 'function' ? overlayInk(ink) : overlayInk;
    return systemCuts(systems, layout?.height ?? 0, ink, extra);
  }, [systems, layout?.height, ink, overlayInk]);
  const page = useMemo(() => (enabled ? pageAt(cuts, start, viewport) : null), [enabled, cuts, start, viewport]);

  const live = useRef({}); live.current = { cuts, viewport, start: page?.start ?? 0, onTurn };
  const turnTo = useCallback((pick, by) => {
    const { cuts: c, viewport: v, start: from, onTurn: notify } = live.current;
    if (c.length < 2) return;
    const to = pick(c, from, v);
    if (to === from) return;
    clearTimeout(glideTimer.current);
    // Slide only a turn that follows the cursor onto the next systems. A jump
    // (a restart, a wrap, a page turned back) would drag the whole piece past.
    const follows = by === 'cursor' && to > from && to <= windowEnd(c, from, v);
    if (follows) {
      const a = pageAt(c, from, v); const b = pageAt(c, to, v);
      setGlide({ top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) });
      glideTimer.current = setTimeout(() => setGlide(null), GLIDE_MS + 40);
    } else setGlide(null);
    setStart(to);
    notify?.({ from, to, by });
  }, []);
  useEffect(() => () => clearTimeout(glideTimer.current), []);
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

  /**
   * Keep the cursor's measure on the page. With `ahead` (the music is running)
   * the page turns as the cursor reaches its last system: see `startForCursor`.
   */
  const followMeasure = useCallback((measure, { ahead = false } = {}) => {
    const system = systems.findIndex((item) => item.firstMeasure <= measure && item.lastMeasure >= measure);
    if (system < 0) return;
    turnTo((c, from, v) => startForCursor(c, v, from, system, { ahead }), 'cursor');
  }, [systems, turnTo]);
  // The tallest system of this engraving, once its ink and the window are both
  // measured: what the window must hold to show one system whole.
  const tallest = inkCurrent && viewport > 0 && cuts.length > 1 ? tallestSystem(cuts) : null;

  // A swipe turns the page, and the tap it would otherwise end as is dropped.
  const press = useRef(null);
  const swipedAt = useRef(-Infinity);
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
    swipedAt.current = -Infinity;
    event.stopPropagation(); event.preventDefault();
  }, []);

  useEffect(() => { if (!enabled) setStart(0); }, [enabled]);

  if (!enabled || !page) return { page: null, style: undefined, handlers: null, turning: false, tallest, viewport, ink, next, prev, showMeasures, followMeasure };
  const cut = glide || page;
  return {
    page,
    style: { '--page-shift': `${page.shift}px`, '--page-top': `${cut.top}px`, '--page-bottom': `${cut.bottom}px` },
    handlers: { onPointerDown, onPointerUp, onPointerCancel, onClickCapture },
    turning: Boolean(glide), tallest, viewport, ink,
    next, prev, showMeasures, followMeasure,
  };
}
