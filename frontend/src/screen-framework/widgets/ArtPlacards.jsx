// frontend/src/screen-framework/widgets/ArtPlacards.jsx
// Animated brass nameplate(s) for the crossfade slideshow. In crossfade mode the
// artwork dissolves between self-contained ArtLayer planes, but the placards are
// pulled OUT of those planes and rendered here as a persistent shared overlay so
// each one can transition on its own — exactly like the steel MusicPlaque on the
// top rail: the old engraving fades out, the plate resizes (a measured width/left
// FLIP) to fit the new title, then the new engraving fades back in. Bundling the
// placard inside the dissolving layer (as ArtLayer still does for completeness)
// only cross-dissolves it with the picture; this gives it a real choreographed
// label change + single↔diptych plate morph.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { artLayout } from './artLayout.js';
import { objectFitWindows } from './artModes.js';
import { layoutTitle } from './titleLayout.js';
import smartquotes from 'smartquotes';

const smartQuotes = (s) => (s == null ? s : smartquotes.string(String(s)));

const PLACARD_FADE_MS = 280;   // old engraving out / new engraving in
const PLACARD_RESIZE_MS = 420; // plate grows/shrinks (and slides) to the new label, behind the fade

const sameLines = (a, b) =>
  a.length === b.length && a.every((s, i) => s === b[i]);
const sameContent = (a, b) =>
  !!a && !!b && a.artist === b.artist
  && a.centerXPct === b.centerXPct && a.widthPct === b.widthPct
  && sameLines(a.lines, b.lines);

/**
 * One animating brass nameplate. `content` = { lines, artist, centerXPct, widthPct }.
 * The whole label (text + geometry) swaps as a unit behind the fade so the resize
 * and reposition happen while the engraving is invisible — never a hard cut, never
 * a mid-fade reflow flicker. Width/left can't be CSS-transitioned from `auto`/`%`
 * cleanly, so the resize is a measured FLIP: pin the old box, reflow, transition to
 * the new one. Skipped where there's no layout (jsdom: offsetWidth 0) and on first
 * appearance (nothing to transition from).
 */
function ArtPlacard({
  content, testid, animate = true, fadeMs = PLACARD_FADE_MS, resizeMs = PLACARD_RESIZE_MS,
}) {
  const [shown, setShown] = useState(content);   // the label currently engraved
  const [hidden, setHidden] = useState(false);   // engraving faded out (fade-out + resize phases)
  const plateRef = useRef(null);
  const firstRef = useRef(true);
  const prevLeftRef = useRef(null);
  const timersRef = useRef([]);

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  // Choreograph a label change. First appearance (no prior label) and non-animated
  // mode both swap instantly; otherwise fade out → swap → fade in.
  useEffect(() => {
    if (sameContent(content, shown)) return;
    if (!animate || !shown) { clearTimers(); setShown(content); setHidden(false); return; }
    clearTimers();
    setHidden(true);                                                      // 1) fade old engraving out
    timersRef.current.push(setTimeout(() => {
      setShown(content);                                                  // 2) swap (resize via layout effect)
      timersRef.current.push(setTimeout(() => setHidden(false), resizeMs)); // 3) fade new engraving in
    }, fadeMs));
  }, [content, shown, animate, fadeMs, resizeMs]);

  useEffect(() => () => clearTimers(), []);

  // Animate the plate to the new label's natural width and centre (FLIP).
  useLayoutEffect(() => {
    const el = plateRef.current;
    if (!el || !shown) return;
    const newLeft = `${shown.centerXPct}%`;
    el.style.transition = 'none';
    const prevW = el.style.width;
    el.style.width = 'auto';
    const w = el.offsetWidth;
    if (!w) {                                          // no layout (jsdom) — leave auto
      el.style.width = '';
      el.style.left = newLeft;
      prevLeftRef.current = newLeft;
      return;
    }
    if (firstRef.current) {                            // first paint — nothing to animate from
      firstRef.current = false;
      el.style.width = `${w}px`;
      el.style.left = newLeft;
      prevLeftRef.current = newLeft;
      return;
    }
    el.style.width = prevW || `${w}px`;                // pin the old box
    el.style.left = prevLeftRef.current || newLeft;
    void el.offsetWidth;                               // reflow so the change animates
    el.style.transition =
      `width ${resizeMs}ms cubic-bezier(0.4, 0, 0.2, 1), left ${resizeMs}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    el.style.width = `${w}px`;                         // → new width
    el.style.left = newLeft;                           // → new centre
    prevLeftRef.current = newLeft;
  }, [shown, resizeMs]);

  if (!shown || !(shown.lines.length || shown.artist)) return null;
  return (
    <div
      className="artmode__placard artmode__placard--animated"
      data-testid={testid}
      ref={plateRef}
      style={{ maxWidth: `${shown.widthPct}%` }}
    >
      <div
        className={`artmode__plaque-text${hidden ? ' artmode__plaque-text--hidden' : ''}`}
        style={{ transition: `opacity ${fadeMs}ms ease` }}
      >
        {shown.lines.map((ln, j) => (
          <span key={j} className="artmode__placard-title artmode__placard-line">{ln}</span>
        ))}
        {shown.artist && (
          <span className="artmode__placard-artist artmode__placard-line">{shown.artist}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Shared placard overlay for the crossfade slideshow. Computes per-panel geometry
 * and split titles for the current `art` (the same math ArtLayer/curtain-mode use),
 * then renders one persistent <ArtPlacard> per panel (keyed by index) so they
 * animate across advances instead of dissolving with the layer beneath.
 *
 * @param {object}   o.art            featured-art payload ({ mode, panels, matte })
 * @param {object}   o.mode           active view mode (artModes.VIEW_MODES)
 * @param {object}   o.frame          frame window insets {top,right,bottom,left} %
 * @param {number}   o.matMargin      mat band, % of height
 * @param {number}   o.cropMaxPerSide max cover-crop per side, %
 * @param {{w,h}}    o.stage          stage size px (placard width / title measuring)
 * @param {number}   o.fontPx         placard font size px
 * @param {function} o.measure        (s)=>px text measurer (canvas or test seam)
 * @param {boolean}  o.animate        choreograph label changes (false = instant)
 */
export default function ArtPlacards({
  art, mode, frame, matMargin, cropMaxPerSide, stage, fontPx, measure, animate = true,
}) {
  const panels = art?.panels ?? [];
  const isGallery = mode.fit === 'gallery';

  const layout = useMemo(() => {
    if (!panels.length) return null;
    const ratios = panels.map((p) =>
      (p.meta?.width > 0 && p.meta?.height > 0) ? p.meta.width / p.meta.height : 1);
    return artLayout({ mode: art.mode, ratios, frame, matMargin, crop: cropMaxPerSide / 100 });
  }, [panels, art, frame, matMargin, cropMaxPerSide]);

  const fitWindows = useMemo(
    () => (panels.length ? objectFitWindows({ count: panels.length, frame, fullWindow: mode.fullWindow }) : []),
    [panels.length, frame, mode.fullWindow]);

  const geom = isGallery ? (layout?.panels ?? []) : fitWindows;

  const lines = useMemo(
    () => geom.map((g, i) => {
      const t = panels[i]?.meta?.title;
      if (!t) return [];
      const textPx = Math.max(0, (g.widthPct / 100) * stage.w - 3.4 * fontPx);
      return layoutTitle(smartQuotes(t), textPx, measure);
    }),
    [geom, panels, stage.w, fontPx, measure],
  );

  if (!mode.placard) return null;

  return geom.map((g, i) => {
    const p = panels[i];
    if (!p || !(p.meta && (p.meta.title || p.meta.artist))) return null;
    const artist = (p.meta.artist || p.meta.date)
      ? smartQuotes([p.meta.artist, p.meta.date].filter(Boolean).join(' · '))
      : '';
    const content = { lines: lines[i] ?? [], artist, centerXPct: g.centerXPct, widthPct: g.widthPct };
    return (
      <ArtPlacard
        key={i}
        content={content}
        animate={animate}
        testid={i === 0 ? 'artmode-placard' : `artmode-placard-${i}`}
      />
    );
  });
}

export { ArtPlacard };
