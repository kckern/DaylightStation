// Pure geometry for the speedometer's HTML overlay children — the avatar, the
// one-line rpm · km/h readout in the lower hemisphere, and the zone multiplier
// tag straddling the dial's base. (The multiplier badge that once sat
// top-right covered the dial's top tick label; nothing overlays the top
// hemisphere but the centred avatar.)
// Deliberately kept SEPARATE from speedometerGeometry.js (the SVG dial/band/
// tick math) per the T10 remit: fix the overlay-vs-dial collision without
// touching the dial geometry lib beyond what the rpm-label move needs.
//
// audit UX §3.1-3.2: RPM digits at a fixed `top: 8%` collided with the
// 12-o'clock mid-scale tick label at every gauge size, and fixed-rem overlay
// text/badges collapsed onto the 38px avatar at the wide-mode floor (96px
// gauge). The fix here is RATIO-based, not size-based: every overlay box is a
// fraction of the gauge's own pixel size (`gaugePx`), so the SAME layout is
// collision-free at any size — 96px (wide-mode floor) through 360px (solo/
// sidebar max) — without per-size overrides. CycleSpeedometer.jsx applies
// these ratios as inline px/em styles; `computeOverlayBoxes` lets tests assert
// the geometry never overlaps, purely, with no DOM/layout involved.
//
// Dial ticks/labels only ever occupy the TOP hemisphere of the gauge (rpmToAngle
// sweeps angle ∈ [π, 2π], i.e. 9 o'clock through 12 to 3 o'clock — see
// cycleOverlayVisuals.js). Anything positioned with a top ratio ≥ 0.5 (the
// gauge's vertical center) is therefore guaranteed clear of them by construction.

// Avatar diameter, as a fraction of the gauge's pixel size.
export const AVATAR_RATIO = 0.36;

// The overlay wrapper's font-size, as a fraction of the gauge's pixel size —
// the anchor every em-based overlay child (rpm sub-line, speed hero) scales
// from, so typography grows/shrinks in lockstep with the dial.
export const OVERLAY_FONT_RATIO = 0.16;

// Lower-hemisphere readout: rpm (hero) and km/h on ONE line. Its top clears
// the avatar's bottom edge (0.5 + AVATAR_RATIO/2 = 0.68); its height is in em
// of OVERLAY_FONT_RATIO, so it scales with the gauge like the font it uses.
export const READOUT_TOP_RATIO = 0.69;
export const READOUT_HEIGHT_EM = 1.0;

// The zone multiplier tag ("Warm ×1.2", "No strap ×0.8"): one line of fixed,
// legible text (cg-type(2)) on a solid plate, straddling the dial's base. It
// hangs TAG_OVERHANG_PX below the gauge box, which is what keeps it clear of
// the readout at the 140 px floor; the band budget counts that overhang
// (layoutSizing.CHROME_BELOW_GAUGE_PX).
export const TAG_HEIGHT_PX = 28;
export const TAG_OVERHANG_PX = 10;

/**
 * computeOverlayBoxes(gaugePx) — pure, no DOM. Axis-aligned boxes (px,
 * relative to the gauge's top-left) for the gauge and each overlay child.
 * The tag's width depends on its text, so its box spans the gauge width (the
 * strictest case for overlap checks).
 */
export function computeOverlayBoxes(gaugePx) {
  const px = Number.isFinite(gaugePx) && gaugePx > 0 ? gaugePx : 0;
  const fontPx = px * OVERLAY_FONT_RATIO;
  const avatarSize = px * AVATAR_RATIO;
  const avatar = {
    x: (0.5 - AVATAR_RATIO / 2) * px,
    y: (0.5 - AVATAR_RATIO / 2) * px,
    width: avatarSize,
    height: avatarSize
  };
  const readout = { x: 0, y: READOUT_TOP_RATIO * px, width: px, height: READOUT_HEIGHT_EM * fontPx };
  const tag = { x: 0, y: px + TAG_OVERHANG_PX - TAG_HEIGHT_PX, width: px, height: TAG_HEIGHT_PX };
  return { gauge: { x: 0, y: 0, width: px, height: px }, avatar, readout, tag };
}

/** True if two axis-aligned boxes overlap (touching edges do NOT count). */
export function boxesIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** True if `box` fits entirely within `bounds` (touching edges are fine). */
export function boxWithin(box, bounds) {
  return (
    box.x >= bounds.x && box.y >= bounds.y &&
    box.x + box.width <= bounds.x + bounds.width &&
    box.y + box.height <= bounds.y + bounds.height
  );
}

export default {
  AVATAR_RATIO, OVERLAY_FONT_RATIO,
  READOUT_TOP_RATIO, READOUT_HEIGHT_EM, TAG_HEIGHT_PX, TAG_OVERHANG_PX,
  computeOverlayBoxes, boxesIntersect, boxWithin
};
