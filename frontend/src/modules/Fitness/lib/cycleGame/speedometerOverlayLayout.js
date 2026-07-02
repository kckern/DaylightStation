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

// Multiplier badge diameter, capped at 30% of the avatar's diameter (not the
// gauge's) — the badge sits ANCHORED to the avatar, not the dial.
export const BADGE_TO_AVATAR_RATIO = 0.3;
export const BADGE_RATIO = AVATAR_RATIO * BADGE_TO_AVATAR_RATIO;

// The overlay wrapper's font-size, as a fraction of the gauge's pixel size —
// the anchor every em-based overlay child (rpm sub-line, speed hero) scales
// from, so typography grows/shrinks in lockstep with the dial.
export const OVERLAY_FONT_RATIO = 0.16;

// Badge anchor: just clear of the avatar's own bounding box (its right edge /
// top edge, plus a small explicit gap) — replaces the old `right: -8%; top: 2%`
// anchor (relative to the avatar's own small box), which crowded/overlapped the
// avatar once the badge could grow to the size a wide-format multiplier (e.g.
// "×2.5") needs at large gauges. The gap is a deliberate margin, not just an
// exact-touch: two ratio sums that mathematically equal the same edge (e.g.
// `0.3 + 0.4` vs `0.7`) can differ by float noise, so an exact-touch anchor can
// register as a false-positive overlap.
export const BADGE_GAP_RATIO = 0.02;
export const BADGE_LEFT_RATIO = 0.5 + AVATAR_RATIO / 2 + BADGE_GAP_RATIO; // just past the avatar's right edge
export const BADGE_TOP_RATIO = 0.5 - AVATAR_RATIO / 2;                   // = avatar's top edge

// Lower-hemisphere readout block (speed hero + rpm sub-line, stacked). Top
// ratio clears the avatar's bottom edge (0.5 + AVATAR_RATIO/2 = 0.7) with a
// margin; heights are in em (of OVERLAY_FONT_RATIO) so the whole block scales
// with the gauge exactly like the font it's built from.
export const READOUT_TOP_RATIO = 0.73;
export const SPEED_HEIGHT_EM = 1.0;
export const RPM_HEIGHT_EM = 0.55;

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

  const badgeSize = px * BADGE_RATIO;
  const badge = {
    x: BADGE_LEFT_RATIO * px,
    y: BADGE_TOP_RATIO * px,
    width: badgeSize,
    height: badgeSize
  };

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
  AVATAR_RATIO, BADGE_TO_AVATAR_RATIO, BADGE_RATIO, OVERLAY_FONT_RATIO,
  BADGE_LEFT_RATIO, BADGE_TOP_RATIO, READOUT_TOP_RATIO, SPEED_HEIGHT_EM, RPM_HEIGHT_EM,
  computeOverlayBoxes, boxesIntersect, boxWithin
};
