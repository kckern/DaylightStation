/**
 * useBoardFit — sizes the Gem Board panel to the screen from the board's own
 * measured size, and the column-name row to the names it holds.
 *
 * Everything in the panel is in em, so the board's size at the current font
 * size, divided by that size, is its size in em, whatever the font size is.
 * One measurement therefore gives the font size that fills 95% of the tighter
 * screen dimension (clamped 12..40px), with no second pass.
 *
 * What is measured, all in the panel's em:
 *  - width: the grid's resolved column tracks (its natural width, which the
 *    stretched grid box does not show), plus how far the last slanted name
 *    leans out past them (`leanEm`, given back as the grid's right padding so
 *    the scrolling body never cuts it), or the header's own row of controls if
 *    that is wider; plus the panel's side padding and border. The body's
 *    negative side margin and its equal padding cancel, so they add nothing.
 *  - height: the header, the panel's row gap, the grid with its first row
 *    swapped for the measured name row (`headEm`), the panel's top and bottom
 *    padding and border.
 *
 * In jsdom nothing has a size and the grid's tracks come back unresolved, so
 * the hook leaves everything null and the stylesheet's fallbacks apply.
 *
 * Never moves once shown. The board opens on the last board's outline while
 * its read is out (seconds, sometimes tens), and a fit that changed when the
 * answer landed — or when the fonts settled — snapped the whole panel: a
 * "rug-pull jolt". So the fit is LOCKED for an opening: the first fit applied
 * for a given board shape (`signature`: who and which columns, with their
 * names) and screen size stays until the board closes, the shape changes or
 * the screen is resized. Each measurement is still kept (`localStorage`
 * `daylight.gemBoard.fit.v1`, by signature and screen size), and the next
 * opening starts from it before its first paint, so the outline, the loaded
 * board and the reopened board are one size.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'gem-board-fit' }));

/** The font size (px) that fits a board of `wEm × hEm` into 95% of the screen; null when unmeasured. */
export const fitFontPx = ({ wEm, hEm }, { vw, vh }) => {
  if (!(wEm > 0) || !(hEm > 0)) return null;
  return Math.min(40, Math.max(12, Math.min((0.95 * vw) / wEm, (0.95 * vh) / hEm)));
};

/** The column-name row: the tallest slanted name plus a margin, never below 3em. */
export const headRowEm = (risesEm) => Math.max(3, ...risesEm.map((r) => r + 0.6));

/** Sum of a resolved `grid-template-columns` ("120px 10px …"); 0 when any track is not in px. */
export const trackSumPx = (tracks) => {
  const parts = String(tracks ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length || !parts.every((p) => /^-?[\d.]+px$/.test(p))) return 0;
  return parts.reduce((n, p) => n + parseFloat(p), 0);
};

const px = (v) => parseFloat(v) || 0;
const EMPTY = { fontPx: null, headEm: null, leanEm: null };
const FIT_KEY = 'daylight.gemBoard.fit.v1';
const screenOf = () => ({ vw: window.innerWidth, vh: window.innerHeight });

/** The fit kept for this board shape on a screen this size, or null. */
export function readCachedFit(signature, { vw, vh } = screenOf()) {
  if (!signature) return null;
  try {
    const c = JSON.parse(localStorage.getItem(FIT_KEY) ?? 'null');
    if (!c || c.signature !== signature || c.vw !== vw || c.vh !== vh || !(c.fontPx > 0)) return null;
    return { fontPx: c.fontPx, headEm: c.headEm ?? null, leanEm: c.leanEm ?? null };
  } catch {
    return null;
  }
}

/** Keep a measured fit for the next opening. Storage off or full: the next opening measures afresh. */
export function saveCachedFit(signature, fit, { vw, vh } = screenOf()) {
  if (!signature || !(fit?.fontPx > 0)) return;
  try {
    localStorage.setItem(FIT_KEY, JSON.stringify({ signature, vw, vh, fontPx: fit.fontPx, headEm: fit.headEm, leanEm: fit.leanEm }));
  } catch { /* nothing to do */ }
}
const close = (a, b, tol) => Math.abs((a ?? 0) - (b ?? 0)) < tol;

function measure(panel) {
  const ps = getComputedStyle(panel);
  const fs = px(ps.fontSize);
  const grid = panel.querySelector('.gem-board__grid');
  if (!fs || !grid) return null;
  const gs = getComputedStyle(grid);
  const tracks = trackSumPx(gs.gridTemplateColumns);
  if (!tracks) return null;

  // The slanted names: how high each rises, and how far the furthest leans past the last track.
  const gridLeft = grid.getBoundingClientRect().left + px(gs.paddingLeft) + px(gs.borderLeftWidth);
  const names = [...grid.querySelectorAll('.gem-board__cat > span')].map((s) => s.getBoundingClientRect());
  const headEm = headRowEm(names.map((r) => r.height / fs));
  const reach = names.reduce((m, r) => Math.max(m, r.right - gridLeft), 0);
  const leanEm = Math.max(0, reach - tracks) / fs + 0.3;

  // The header's controls side by side, with room for the push between title and week switch.
  const header = panel.querySelector('.gem-board__header');
  const hs = header ? getComputedStyle(header) : null;
  const kids = header ? [...header.children] : [];
  const headerW = kids.reduce((n, el) => n + el.getBoundingClientRect().width, 0)
    + Math.max(0, kids.length - 1) * px(hs?.columnGap) + 2 * fs;

  const gridW = px(gs.paddingLeft) + tracks + leanEm * fs;
  const sidePx = px(ps.paddingLeft) + px(ps.paddingRight) + px(ps.borderLeftWidth) + px(ps.borderRightWidth);
  const wEm = (Math.max(gridW, headerW) + sidePx) / fs;

  const nameRowPx = grid.querySelector('.gem-board__cat')?.getBoundingClientRect().height ?? 0;
  const gridHEm = (grid.getBoundingClientRect().height - nameRowPx) / fs + headEm;
  const endsPx = px(ps.paddingTop) + px(ps.paddingBottom) + px(ps.borderTopWidth) + px(ps.borderBottomWidth)
    + (header ? header.getBoundingClientRect().height + px(ps.rowGap) : 0);
  const hEm = gridHEm + endsPx / fs;

  const fontPx = fitFontPx({ wEm, hEm }, { vw: window.innerWidth, vh: window.innerHeight });
  return fontPx ? { fontPx, headEm, leanEm, wEm, hEm } : null;
}

/**
 * @param {{current: HTMLElement|null}} panelRef - the `.gem-board__panel`
 * @param {unknown} key - re-measure when this changes (the board's shape, the week, outline vs board)
 * @param {string|null} [signature] - the board's shape (who, which columns, their names); null while
 *   closed or with nothing to draw. The fit is locked per signature and screen size for one opening.
 * @returns {{fontPx: number|null, headEm: number|null, leanEm: number|null}}
 */
export default function useBoardFit(panelRef, key, signature = null) {
  const [fit, setFit] = useState(EMPTY);
  // The fit this opening is locked to: {lockKey, fit}. Cleared when the board closes (no signature).
  const lock = useRef(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !signature) { lock.current = null; return undefined; }
    let live = true;
    const apply = (next) => setFit((f) => (
      close(f.fontPx, next.fontPx, 0.01) && close(f.headEm, next.headEm, 0.01) && close(f.leanEm, next.leanEm, 0.01) ? f : next
    ));
    const run = (why) => {
      if (!live) return;
      const screen = screenOf();
      const lockKey = `${signature}|${screen.vw}x${screen.vh}`;
      // First paint of this opening: the fit kept from the last one, before anything is measured.
      if (lock.current?.lockKey !== lockKey) {
        const cached = readCachedFit(signature, screen);
        if (cached) {
          lock.current = { lockKey, fit: cached };
          apply(cached);
          logger().debug('gem-board.fit-cached', { fontPx: Math.round(cached.fontPx * 10) / 10, why });
        }
      }
      const m = measure(panel);
      if (!m) return;
      const measured = { fontPx: m.fontPx, headEm: m.headEm, leanEm: m.leanEm };
      saveCachedFit(signature, measured, screen);
      if (lock.current?.lockKey === lockKey) {
        const held = lock.current.fit;
        if (!(close(held.fontPx, m.fontPx, 0.5) && close(held.headEm, m.headEm, 0.1) && close(held.leanEm, m.leanEm, 0.1))) {
          // Kept for this opening; the next one opens at the new size.
          logger().debug('gem-board.fit-held', { why, heldPx: Math.round(held.fontPx * 10) / 10, measuredPx: Math.round(m.fontPx * 10) / 10 });
        }
        return;
      }
      lock.current = { lockKey, fit: measured };
      logger().debug('gem-board.fit', { why, fontPx: Math.round(m.fontPx * 10) / 10, wEm: Math.round(m.wEm * 10) / 10, hEm: Math.round(m.hEm * 10) / 10, headEm: Math.round(m.headEm * 10) / 10, vw: screen.vw, vh: screen.vh });
      apply(measured);
    };
    run('open');
    // Names are measured in the board's font; measure again once it has loaded (kept for next time).
    document.fonts?.ready?.then(() => run('fonts')).catch(() => {});
    const onResize = () => run('resize');
    window.addEventListener('resize', onResize);
    return () => { live = false; window.removeEventListener('resize', onResize); };
  }, [panelRef, key, signature]);
  return fit;
}
