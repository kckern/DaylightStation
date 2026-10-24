/**
 * Is the governance warning UI (life meter, offender chips) painting clean, or
 * is something dimming it? Two ways it can be:
 *
 * 1. COVERED — the warning scrim (darken + blur + grayscale backdrop) paints
 *    ABOVE it. Its z-index (60) beats the scrim's (5) only while both sit in the
 *    same stacking context; any ancestor that starts a new one traps it below.
 * 2. FILTERED — it, or an ancestor, carries a filter or opacity < 1 (e.g. the
 *    locked-state `grayscale(1) brightness(0.6)` on the video tree).
 *
 * Pure DOM reads, no layout; cheap enough to run every couple of seconds.
 */

const STACKING_CONTAIN = /\b(layout|paint|strict|content)\b/;

const styleOf = (el) => el.ownerDocument.defaultView.getComputedStyle(el);

function createsStackingContext(cs) {
  const positioned = cs.position && cs.position !== 'static';
  const hasZ = cs.zIndex !== 'auto' && cs.zIndex !== ''; // '' = unset (non-browser DOMs)
  return (positioned && hasZ)
    || cs.position === 'fixed'
    || cs.position === 'sticky'
    || (cs.opacity !== '' && Number(cs.opacity) < 1)
    || (cs.transform && cs.transform !== 'none')
    || (cs.filter && cs.filter !== 'none')
    || (cs.backdropFilter && cs.backdropFilter !== 'none')
    || cs.isolation === 'isolate'
    || STACKING_CONTAIN.test(cs.contain || '');
}

/**
 * Where `el` lands in the paint order of `ancestor`'s stacking context: the
 * z-index of the outermost stacking context between them, or the implicit
 * layer when there is none.
 */
function layerWithin(el, ancestor) {
  let outermost = null;
  for (let node = el; node && node !== ancestor; node = node.parentElement) {
    if (createsStackingContext(styleOf(node))) outermost = node;
  }
  if (outermost) {
    const z = Number.parseInt(styleOf(outermost).zIndex, 10);
    return Number.isFinite(z) ? z : 0;
  }
  // Positioned with z auto paints in the z=0 layer; flow content below it.
  return styleOf(el).position !== 'static' ? 0 : -0.5;
}

function commonAncestor(a, b) {
  const seen = new Set();
  for (let node = a; node; node = node.parentElement) seen.add(node);
  for (let node = b; node; node = node.parentElement) if (seen.has(node)) return node;
  return null;
}

/** True when `top` paints above `bottom`. */
export function paintsAbove(top, bottom) {
  const ancestor = commonAncestor(top, bottom);
  if (!ancestor) return false;
  const zTop = layerWithin(top, ancestor);
  const zBottom = layerWithin(bottom, ancestor);
  if (zTop !== zBottom) return zTop > zBottom;
  // Same layer: later in document order paints on top.
  // eslint-disable-next-line no-bitwise
  return Boolean(bottom.compareDocumentPosition(top) & 4); // DOCUMENT_POSITION_FOLLOWING
}

/** Filters / opacity on `el` or any ancestor — each one dims its pixels. */
export function dimmingChain(el) {
  const found = [];
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const cs = styleOf(node);
    const filter = cs.filter && cs.filter !== 'none' ? cs.filter : null;
    const opacity = cs.opacity !== '' && Number(cs.opacity) < 1 ? Number(cs.opacity) : null;
    if (filter || opacity != null) {
      found.push({ element: String(node.className || node.tagName).slice(0, 60), filter, opacity });
    }
  }
  return found;
}

/**
 * @param {{ [name: string]: Element|null }} targets - e.g. { meter, chip }
 * @param {Element|null} scrim
 * @returns {{ dimmed: boolean, targets: Object }}
 */
export function checkOverlayPaint(targets, scrim) {
  const result = {};
  let dimmed = false;
  Object.entries(targets).forEach(([name, el]) => {
    if (!el) return;
    const coveredByScrim = Boolean(scrim && paintsAbove(scrim, el));
    const filters = dimmingChain(el);
    if (coveredByScrim || filters.length) dimmed = true;
    result[name] = { coveredByScrim, filters };
  });
  return { dimmed, targets: result };
}

const MAX_FILTERED = 12;
const round = (n) => Math.round(n * 10) / 10;
const isSet = (v) => Boolean(v) && v !== 'none';
const label = (node) => String(node.className?.baseVal ?? node.className ?? node.tagName).slice(0, 60) || node.tagName;

function rectOf(el, win) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const dpr = win.devicePixelRatio || 1;
  // Firefox exposes where the viewport sits on the screen; with the device
  // rect that lets a screen grab be cropped to exactly this element.
  const sx = Number.isFinite(win.mozInnerScreenX) ? win.mozInnerScreenX : null;
  const sy = Number.isFinite(win.mozInnerScreenY) ? win.mozInnerScreenY : null;
  return {
    css: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) },
    device: { x: Math.round(r.left * dpr), y: Math.round(r.top * dpr), w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) },
    screen: sx != null && sy != null ? { x: Math.round((sx + r.left) * dpr), y: Math.round((sy + r.top) * dpr) } : null,
  };
}

const intersects = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * The compositing picture around the warning overlay, for the log. Computed
 * styles cannot see what WebRender does with them, but they can say what it
 * was given: the scrim's step and darkness, the video's filter, the device
 * scale, where the chips are in device px, and every element on the page that
 * carries a filter or backdrop-filter (the costly, artifact-prone kinds) and
 * whether it overlaps the chips/meter. A full-page style scan, so callers run
 * it a handful of times per warning (shown, each scrim step, dimmed), never on
 * a clock.
 *
 * @param {{ root: Element, targets: { [name: string]: Element|null }, scrim?: Element|null, video?: Element|null }} args
 */
export function describeCompositing({ root, targets, scrim = null, video = null }) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const targetRects = Object.values(targets).filter(Boolean).map((el) => el.getBoundingClientRect());
  const filtered = [];
  let filteredCount = 0;
  for (const node of doc.body ? doc.body.querySelectorAll('*') : []) {
    const cs = win.getComputedStyle(node);
    const backdrop = cs.backdropFilter || cs.webkitBackdropFilter;
    if (!isSet(backdrop) && !isSet(cs.filter)) continue;
    filteredCount += 1;
    if (filtered.length >= MAX_FILTERED) continue;
    const r = node.getBoundingClientRect();
    filtered.push({
      element: label(node),
      backdropFilter: isSet(backdrop) ? backdrop : null,
      filter: isSet(cs.filter) ? cs.filter : null,
      overlapsTargets: targetRects.some((t) => intersects(r, t)),
    });
  }
  const rects = {};
  Object.entries(targets).forEach(([name, el]) => { if (el) rects[name] = rectOf(el, win); });
  const scrimStyle = scrim ? win.getComputedStyle(scrim) : null;
  const videoStyle = video ? win.getComputedStyle(video) : null;
  return {
    scrimStep: scrim?.dataset?.step != null ? Number(scrim.dataset.step) : null,
    scrimBackground: scrimStyle ? scrimStyle.backgroundColor : null,
    scrimBackdropFilter: scrimStyle && isSet(scrimStyle.backdropFilter) ? scrimStyle.backdropFilter : null,
    videoFilter: videoStyle && isSet(videoStyle.filter) ? videoStyle.filter : null,
    devicePixelRatio: win.devicePixelRatio || 1,
    visualViewportScale: win.visualViewport ? win.visualViewport.scale : null,
    fullscreen: Boolean(doc.fullscreenElement),
    playerMode: (String(root.closest?.('.fitness-player')?.className || '').match(/\bmode-([\w-]+)/) || [])[1] || null,
    rects,
    filtered,
    filteredCount,
  };
}
