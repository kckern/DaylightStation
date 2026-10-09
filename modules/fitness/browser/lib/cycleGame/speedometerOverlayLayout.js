// Pure geometry for the speedometer's HTML overlay children — the avatar, the
// multiplier badge, and the rpm/speed readout stacked in the lower hemisphere.
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
export const AVATAR_RATIO = 0.4;

// Multiplier CHIP (not a circular badge — a pill, like the SENSOR chip):
// audit feedback (2026-07-02) reported the multiplier number unreadable —
// the prior circular badge, capped at 30% of the avatar's diameter, shrank
// to ~11px at the wide-mode floor (96px gauge), too small for "×1.4" to fit
// as text, so it degraded to a color-only dot. A pill's width is independent
// of its height, so it can hold the text at a legible floor size at ANY
// gauge size without the height needing to grow to match — the avatar-ratio
// coupling that caused the original collapse is gone entirely. Anchored
// top-right of the gauge (clear of the centered avatar and the bottom
// readout block) rather than glued to the avatar's edge.
export const MULTIPLIER_CHIP_MIN_WIDTH_PX = 52;
export const MULTIPLIER_CHIP_MIN_HEIGHT_PX = 24;
export const MULTIPLIER_CHIP_WIDTH_RATIO = 0.34;
export const MULTIPLIER_CHIP_HEIGHT_RATIO = 0.11;
export const MULTIPLIER_CHIP_MARGIN_RATIO = 0.02;

// The overlay wrapper's font-size, as a fraction of the gauge's pixel size —
// the anchor every em-based overlay child (rpm sub-line, speed hero) scales
// from, so typography grows/shrinks in lockstep with the dial.
export const OVERLAY_FONT_RATIO = 0.16;

// Lower-hemisphere readout block (speed hero + rpm sub-line, stacked). Top
// ratio clears the avatar's bottom edge (0.5 + AVATAR_RATIO/2 = 0.7) with a
// margin; heights are in em (of OVERLAY_FONT_RATIO) so the whole block scales
// with the gauge exactly like the font it's built from.
export const READOUT_TOP_RATIO = 0.73;
export const SPEED_HEIGHT_EM = 1.0;
export const RPM_HEIGHT_EM = 0.55;

/**
 * multiplierChipBox(gaugePx) — the pill's box, top-right corner of the gauge.
 * Width/height each have an absolute px floor (so text stays legible at the
 * smallest gauge) and grow with gaugePx beyond that floor.
 */
export function multiplierChipBox(gaugePx) {
  const px = Number.isFinite(gaugePx) && gaugePx > 0 ? gaugePx : 0;
  const width = Math.max(MULTIPLIER_CHIP_MIN_WIDTH_PX, px * MULTIPLIER_CHIP_WIDTH_RATIO);
  const height = Math.max(MULTIPLIER_CHIP_MIN_HEIGHT_PX, px * MULTIPLIER_CHIP_HEIGHT_RATIO);
  const margin = px * MULTIPLIER_CHIP_MARGIN_RATIO;
  return { x: px - width - margin, y: margin, width, height };
}

/**
 * computeOverlayBoxes(gaugePx) — pure, no DOM. Returns axis-aligned bounding
 * boxes (px, relative to the gauge's own top-left corner) for the gauge itself
 * and each HTML overlay child, using the ratios above.
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

  const badge = multiplierChipBox(px);

  const speed = {
    x: 0,
    y: READOUT_TOP_RATIO * px,
    width: px,
    height: SPEED_HEIGHT_EM * fontPx
  };
  const rpm = {
    x: 0,
    y: speed.y + speed.height,
    width: px,
    height: RPM_HEIGHT_EM * fontPx
  };

  return { gauge: { x: 0, y: 0, width: px, height: px }, avatar, badge, speed, rpm };
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
  MULTIPLIER_CHIP_MIN_WIDTH_PX, MULTIPLIER_CHIP_MIN_HEIGHT_PX,
  MULTIPLIER_CHIP_WIDTH_RATIO, MULTIPLIER_CHIP_HEIGHT_RATIO, MULTIPLIER_CHIP_MARGIN_RATIO,
  READOUT_TOP_RATIO, SPEED_HEIGHT_EM, RPM_HEIGHT_EM,
  computeOverlayBoxes, multiplierChipBox, boxesIntersect, boxWithin
};
