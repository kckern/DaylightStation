// artLayout.js — pure geometry for ArtMode (single + diptych). No DOM.
// Reference stage 16 × 9; all outputs are CSS-ready (% of stage, except
// panel heightPct which is % of the opening; aspect ratios are unitless).
const SW = 16, SH = 9;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Display-box aspect filling a cell, allowing ≤ crop per side cover-crop.
export function boxAspect(cellAR, artAR, crop) {
  return clamp(cellAR, artAR * (1 - 2 * crop), artAR / (1 - 2 * crop));
}

/**
 * @param {object} o
 * @param {'single'|'diptych'} o.mode
 * @param {number[]} o.ratios   art aspect ratios (w/h), 1 or 2 entries
 * @param {{top,right,bottom,left}} o.frame  frame window insets, % (top/bottom of height, left/right of width)
 * @param {number} o.matMargin  mat band, % of stage height (uniform in pixels)
 * @param {number} o.crop       max cover-crop per side, fraction (e.g. 0.08)
 * @returns {{ opening:{top,bottom,left,right}, justify:string, panels:[{boxAspect,heightPct,centerXPct}] }}
 */
export function artLayout({ mode, ratios, frame, matMargin, crop }) {
  const openTopPct = frame.top + matMargin;
  const openBotPct = frame.bottom + matMargin;
  const openTopPx = (openTopPct / 100) * SH;
  const openBotPx = SH - (openBotPct / 100) * SH;
  const openHpx = openBotPx - openTopPx;
  const mmPx = (matMargin / 100) * SH; // uniform pixel mat

  if (mode === 'diptych' && ratios.length === 2) {
    const openLeftPx = (frame.left / 100) * SW;
    const openRightPx = SW - (frame.right / 100) * SW;
    const openWpx = openRightPx - openLeftPx;
    const [r1, r2] = ratios;
    const sum0 = openHpx * (r1 + r2);
    const avail = openWpx - 3 * mmPx;
    let H, b1, b2;
    if (sum0 <= avail) {
      const k = Math.min(avail / sum0, 1 / (1 - 2 * crop)); // widen via top/bottom crop, capped
      H = openHpx; b1 = r1 * k; b2 = r2 * k;
    } else {
      H = avail / (r1 + r2); b1 = r1; b2 = r2;              // too wide → shrink height to fit
    }
    const w1 = H * b1, w2 = H * b2;
    const gap = (openWpx - w1 - w2) / 3;
    const c1 = openLeftPx + gap + w1 / 2;
    const c2 = openLeftPx + 2 * gap + w1 + w2 / 2;
    const heightPct = (H / openHpx) * 100;
    return {
      opening: { top: openTopPct, bottom: openBotPct, left: frame.left, right: frame.right },
      justify: 'space-evenly',
      panels: [
        { boxAspect: b1, heightPct, centerXPct: (c1 / SW) * 100, widthPct: (w1 / SW) * 100 },
        { boxAspect: b2, heightPct, centerXPct: (c2 / SW) * 100, widthPct: (w2 / SW) * 100 },
      ],
    };
  }

  // single — mat margin on all sides (uniform in pixels)
  const mmPctX = (mmPx / SW) * 100;
  const openLeftPct = frame.left + mmPctX;
  const openRightPct = frame.right + mmPctX;
  const openLeftPx = (openLeftPct / 100) * SW;
  const openRightPx = SW - (openRightPct / 100) * SW;
  const openWpx = openRightPx - openLeftPx;
  const cellAR = openWpx / openHpx;
  const bAR = boxAspect(cellAR, ratios[0], crop);
  let wpx, hpx;
  if (bAR >= cellAR) { wpx = openWpx; hpx = wpx / bAR; }  // width-limited
  else { hpx = openHpx; wpx = hpx * bAR; }                // height-limited
  const centerX = openLeftPx + openWpx / 2;
  return {
    opening: { top: openTopPct, bottom: openBotPct, left: openLeftPct, right: openRightPct },
    justify: 'center',
    panels: [
      { boxAspect: bAR, heightPct: (hpx / openHpx) * 100, centerXPct: (centerX / SW) * 100, widthPct: (wpx / SW) * 100 },
    ],
  };
}

export default artLayout;
