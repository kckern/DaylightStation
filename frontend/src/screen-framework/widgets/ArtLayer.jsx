// frontend/src/screen-framework/widgets/ArtLayer.jsx
// One complete matted picture — matte + painting(s) + frame + nameplate(s) — as a
// single absolutely-positioned plane filling the stage. ArtMode stacks these and
// cross-dissolves opacity for `transition: 'crossfade'` (slideshow). Because the
// WHOLE picture lives in one opacity layer, the artwork, the mat (a gradient that
// can't be CSS-transitioned in place) and the placards all crossfade together, and
// a single→diptych change dissolves cleanly. The geometry/title math mirrors the
// inline curtain-mode render in ArtMode.jsx (kept identical so both paths agree).
import React, { useMemo, useRef } from 'react';
import { DaylightMediaPath } from '../../lib/api.mjs';
import { artLayout } from './artLayout.js';
import { objectFitWindows, cropFocus, cropBandFit } from './artModes.js';
import { layoutTitle } from './titleLayout.js';
import smartquotes from 'smartquotes';

const smartQuotes = (s) => (s == null ? s : smartquotes.string(String(s)));

// A panel has an active crop band when in a cover mode and crop has margins on
// either axis (top/bottom = vertical, left/right = horizontal panorama).
// `openingRatio` is the panel's ACTUAL window aspect (a diptych half is narrower
// than the full opening), so the band covers the right box.
const bandFor = (panel, fit, openingRatio) => {
  const c = panel?.meta?.crop;
  if (fit !== 'cover' || !c || c.enabled === false) return null;
  const hasMargins = ['top', 'bottom', 'left', 'right'].some((k) => Number.isFinite(c[k]));
  if (!hasMargins) return null;
  const srcRatio = (panel.meta.width > 0 && panel.meta.height > 0) ? panel.meta.width / panel.meta.height : 1;
  return cropBandFit(c, srcRatio, openingRatio);
};
// Aspect (w/h) of a fit-window from its stage-% insets, over the 16:9 stage.
const windowAspect = (win) =>
  ((100 - win.left - win.right) / 100 * 16) / ((100 - win.top - win.bottom) / 100 * 9);

/**
 * @param {object}  o.art           featured-art payload ({ mode, panels, matte })
 * @param {object}  o.mode          active view mode (from artModes.VIEW_MODES)
 * @param {object}  o.frame         frame window insets {top,right,bottom,left} %
 * @param {number}  o.matMargin     mat band, % of height
 * @param {number}  o.cropMaxPerSide  max cover-crop per side, %
 * @param {boolean} o.placard       render nameplate(s)
 * @param {{w,h}}   o.stage         stage size px (placard width / title measuring)
 * @param {number}  o.fontPx        placard font size px
 * @param {function} o.measure      (s)=>px text measurer (canvas or test seam)
 * @param {string}  o.frameSrc      frame PNG url
 * @param {boolean} o.visible       fade target — true → opacity 1
 * @param {number}  o.transitionMs  crossfade duration ms (opacity transition)
 * @param {function} o.onImageLoad  called once per panel image as it loads/errors
 */
export default function ArtLayer({
  art, mode, frame, matMargin, cropMaxPerSide, placard,
  stage, fontPx, measure, frameSrc, visible, transitionMs, onImageLoad,
}) {
  const isGallery = mode.fit === 'gallery';
  const panels = art?.panels ?? [];

  const matteVars = useMemo(() => {
    const m = art?.matte;
    if (!m) return undefined;
    return {
      '--matte-base': m.base, '--matte-glow': m.glow, '--matte-edge': m.edge,
      '--cut-top': m.bevelTop, '--cut-left': m.bevelLeft, '--cut-right': m.bevelRight, '--cut-bottom': m.bevelBottom,
    };
  }, [art]);

  const layout = useMemo(() => {
    if (!panels.length) return null;
    const ratios = panels.map((p) =>
      (p.meta?.width > 0 && p.meta?.height > 0) ? p.meta.width / p.meta.height : 1);
    return artLayout({ mode: art.mode, ratios, frame, matMargin, crop: cropMaxPerSide / 100 });
  }, [panels, art, frame, matMargin, cropMaxPerSide]);

  const fitWindows = useMemo(
    () => (panels.length ? objectFitWindows({ count: panels.length, frame, fullWindow: mode.fullWindow }) : []),
    [panels.length, frame, mode.fullWindow]);

  const placardGeom = isGallery ? (layout?.panels ?? []) : fitWindows;
  const placardLines = useMemo(
    () => placardGeom.map((g, i) => {
      const t = panels[i]?.meta?.title;
      if (!t) return [];
      const textPx = Math.max(0, (g.widthPct / 100) * stage.w - 3.4 * fontPx);
      return layoutTitle(smartQuotes(t), textPx, measure);
    }),
    [placardGeom, panels, stage.w, fontPx, measure],
  );

  const testid = (base, i) => (i === 0 ? base : `${base}-${i}`);
  // Notify the parent once every panel image has resolved, so it can reveal this
  // layer only when its art is fully painted (never crossfade to a blank frame).
  const loadedRef = useRef(0);
  const handleLoaded = () => {
    loadedRef.current += 1;
    if (loadedRef.current >= panels.length) onImageLoad?.();
  };

  return (
    <div
      className={`artmode__layer${visible ? ' artmode__layer--visible' : ''}`}
      data-testid="artmode-layer"
      style={{ ...matteVars, transition: `opacity ${transitionMs}ms ease-in-out` }}
    >
      <div className="artmode__matte" aria-hidden="true" />

      {isGallery && layout && (
        <div className="artmode__opening" style={{
          top: `${layout.opening.top}%`, bottom: `${layout.opening.bottom}%`,
          left: `${layout.opening.left}%`, right: `${layout.opening.right}%`,
          justifyContent: layout.justify,
        }}>
          {panels.map((p, i) => (
            <div key={p.image} className="artmode__window" data-testid={testid('artmode-window', i)}
                 style={{ height: `${layout.panels[i].heightPct}%`, aspectRatio: String(layout.panels[i].boxAspect) }}>
              <img className="artmode__image" data-testid={testid('artmode-image', i)}
                   src={DaylightMediaPath(p.image)} alt={p.meta?.title || 'Artwork'}
                   style={{ objectPosition: cropFocus(p.meta?.crop_anchor) || undefined }}
                   onLoad={handleLoaded} onError={handleLoaded} />
              <span className="artmode__cut" aria-hidden="true" />
            </div>
          ))}
        </div>
      )}

      {!isGallery && panels.map((p, i) => {
        const win = fitWindows[i];
        const band = bandFor(p, mode.fit, windowAspect(win));
        return (
          <div key={p.image} className="artmode__fitwindow" data-testid={testid('artmode-window', i)}
               style={{ top: `${win.top}%`, left: `${win.left}%`, right: `${win.right}%`, bottom: `${win.bottom}%` }}>
            <img className={`artmode__fitimage artmode__fitimage--${band ? (band.axis === 'horizontal' ? 'bandh' : 'band') : mode.fit}`}
                 data-testid={testid('artmode-image', i)}
                 src={DaylightMediaPath(p.image)} alt={p.meta?.title || 'Artwork'}
                 style={band
                   ? { transform: band.transform, transformOrigin: band.transformOrigin }
                   : { objectPosition: cropFocus(p.meta?.crop_anchor) || undefined }}
                 onLoad={handleLoaded} onError={handleLoaded} />
          </div>
        );
      })}

      {mode.frame && (
        <img className="artmode__frame" data-testid="artmode-frame" src={frameSrc} alt="" />
      )}

      {placard && mode.placard && placardGeom.map((g, i) => {
        const p = panels[i];
        if (!p || !(p.meta && (p.meta.title || p.meta.artist))) return null;
        const lines = placardLines[i] ?? [];
        return (
          <div key={panels[i]?.image ?? i} className="artmode__placard" data-testid={testid('artmode-placard', i)}
               style={{ left: `${g.centerXPct}%`, maxWidth: `${g.widthPct}%` }}>
            {lines.map((ln, j) => (
              <span key={j} className="artmode__placard-title artmode__placard-line">{ln}</span>
            ))}
            {(p.meta.artist || p.meta.date) && (
              <span className="artmode__placard-artist artmode__placard-line">
                {smartQuotes([p.meta.artist, p.meta.date].filter(Boolean).join(' · '))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
