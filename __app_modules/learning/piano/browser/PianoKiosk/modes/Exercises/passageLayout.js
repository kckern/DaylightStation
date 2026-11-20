const MIN_STAFF_SPACE = 8;

const finite = (value) => Number.isFinite(value);
const containScale = (viewport, box) => Math.min(viewport.width / box.width, viewport.height / box.height);

export function systemForStep(step, staffBoxes = []) {
  if (!step || !staffBoxes.length) return 0;
  const notes = step.notes ?? [];
  const top = Number.isFinite(step.top) ? step.top : Math.min(...notes.map((note) => note.top).filter(finite));
  const bottom = Number.isFinite(step.bottom) ? step.bottom : Math.max(...notes.map((note) => note.bottom).filter(finite));
  if (!finite(top) || !finite(bottom)) return 0;
  const center = (top + bottom) / 2;
  return staffBoxes.reduce((best, staff) => {
    const staffCenter = staff.top + staff.lineSpacing * 2;
    const distance = Math.abs(center - staffCenter);
    return distance < best.distance ? { system: staff.system, distance } : best;
  }, { system: 0, distance: Infinity }).system;
}

function systemBox(layout, system) {
  const staves = (layout.staffBoxes ?? []).filter((staff) => staff.system === system);
  if (!staves.length) return null;
  const spacing = Math.min(...staves.map((staff) => staff.lineSpacing).filter(finite));
  const staffTop = Math.min(...staves.map((staff) => staff.top));
  const staffBottom = Math.max(...staves.map((staff) => staff.top + staff.lineSpacing * 4));
  const measures = (layout.measureBounds ?? []).filter((measure) => {
    const center = (measure.top + measure.bottom) / 2;
    return center >= staffTop - spacing * 4 && center <= staffBottom + spacing * 4;
  });
  const top = Math.min(staffTop, ...measures.map((measure) => measure.top)) - spacing * 2;
  const bottom = Math.max(staffBottom, ...measures.map((measure) => measure.bottom)) + spacing * 2;
  const page = contentBox(layout);
  return { x: page.x, y: Math.max(0, top), width: page.width, height: bottom - Math.max(0, top), spacing };
}

function contentBox(layout) {
  const staves = layout.staffBoxes ?? [];
  const measures = (layout.measureBounds ?? []).filter(Boolean);
  const spacing = Math.max(0, ...staves.map((staff) => staff.lineSpacing).filter(finite));
  // The engraving's measured extent, when the host could read it: the page is
  // the ink and a little air, on every side. The engraver's own page margins
  // (and the room it leaves for a title) are not part of a passage, and left in
  // they made a two-system passage a fifth smaller than its stage allowed.
  // Staves and bars are unioned in, so a stale measurement can never crop them.
  const ink = layout.ink;
  if (ink && [ink.x, ink.y, ink.width, ink.height].every(finite) && ink.width > 0 && ink.height > 0) {
    const air = spacing * 1.5;
    // Above and below, room for a verdict mark (ScorePassage `verdictMark`,
    // 12 units tall) beside the highest and lowest noteheads; at 1.5 spaces a
    // mark under a low note was cut off by the edge of the paper.
    const airY = spacing * 2;
    const left = Math.min(ink.x, ...staves.map((staff) => staff.left).filter(finite), ...measures.map((measure) => measure.left).filter(finite));
    const top = Math.min(ink.y, ...staves.map((staff) => staff.top).filter(finite), ...measures.map((measure) => measure.top).filter(finite));
    const right = Math.max(ink.x + ink.width, ...staves.map((staff) => staff.right).filter(finite), ...measures.map((measure) => measure.right).filter(finite));
    const bottom = Math.max(ink.y + ink.height, ...staves.map((staff) => staff.top + staff.lineSpacing * 4).filter(finite), ...measures.map((measure) => measure.bottom).filter(finite));
    const x = Math.max(0, left - air); const y = Math.max(0, top - airY);
    return { x, y, width: right + air - x, height: bottom + airY - y };
  }
  // The engraver does not stretch a short last (or only) system across the
  // page. When every system stops short, the page ends where the ink does, so
  // a few bars are scaled up to fill the stage instead of sitting in half of it.
  const inkRight = Math.max(
    ...staves.map((staff) => staff.right).filter(finite),
    ...measures.map((measure) => measure.right).filter(finite),
  );
  const inkLeft = Math.min(...staves.map((staff) => staff.left).filter(finite), ...measures.map((measure) => measure.left).filter(finite));
  const margin = finite(inkLeft) ? Math.max(spacing * 2, inkLeft) : spacing * 2;
  const right = finite(inkRight) && inkRight + margin < layout.width ? inkRight + margin : Math.max(layout.width, finite(inkRight) ? inkRight : 0);
  const bottom = Math.max(
    layout.height,
    ...staves.map((staff) => staff.top + staff.lineSpacing * 4 + spacing * 2).filter(finite),
    ...measures.map((measure) => measure.bottom + spacing * 2).filter(finite),
  );
  return { x: 0, y: 0, width: right, height: bottom };
}

export function resolvePassageLayout({ layout, viewport, cursorSystem = 0, minStaffSpacePx = MIN_STAFF_SPACE, keepWholePassage = false }) {
  if (!layout || !finite(layout.width) || !finite(layout.height) || !(viewport?.width > 0) || !(viewport?.height > 0)) return null;
  const systems = [...new Set((layout.staffBoxes ?? []).map((staff) => staff.system).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!systems.length) return null;
  const spacing = Math.min(...layout.staffBoxes.map((staff) => staff.lineSpacing).filter(finite));
  // OSMD's SVG height can lag the graphical model after a forced system break.
  // Trust the measured staff/measure bottoms as the minimum page extent: the
  // stale SVG height is exactly how a wrapped grand staff lost its final bass
  // stave below the white passage card.
  const full = contentBox(layout);
  const fullSpacing = spacing * containScale(viewport, full);
  if (!keepWholePassage && fullSpacing < minStaffSpacePx) {
    const activeSystem = systems.includes(cursorSystem) ? cursorSystem : systems[0];
    const focused = systemBox(layout, activeSystem);
    const focusedSpacing = focused.spacing * containScale(viewport, focused);
    return {
      mode: 'system', compact: focusedSpacing < minStaffSpacePx, activeSystem, systemCount: systems.length,
      viewBox: focused, projectedStaffSpacePx: focusedSpacing,
    };
  }
  // Learn Lab assigns a short passage as one visual task. Never turn its
  // systems into cursor-following pages: that hides the player's look-ahead.
  // Other score surfaces retain the readable-system fallback above.
  return {
    mode: 'full', compact: fullSpacing < minStaffSpacePx, activeSystem: null, systemCount: systems.length,
    viewBox: full, projectedStaffSpacePx: fullSpacing,
  };
}
