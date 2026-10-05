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
  return { x: 0, y: Math.max(0, top), width: contentBox(layout).width, height: bottom - Math.max(0, top), spacing };
}

function contentBox(layout) {
  const staves = layout.staffBoxes ?? [];
  const measures = (layout.measureBounds ?? []).filter(Boolean);
  const spacing = Math.max(0, ...staves.map((staff) => staff.lineSpacing).filter(finite));
  const right = Math.max(
    layout.width,
    ...staves.map((staff) => staff.right).filter(finite),
    ...measures.map((measure) => measure.right).filter(finite),
  );
  const bottom = Math.max(
    layout.height,
    ...staves.map((staff) => staff.top + staff.lineSpacing * 4 + spacing * 2).filter(finite),
    ...measures.map((measure) => measure.bottom + spacing * 2).filter(finite),
  );
  return { x: 0, y: 0, width: right, height: bottom };
}

export function resolvePassageLayout({ layout, viewport, cursorSystem = 0, minStaffSpacePx = MIN_STAFF_SPACE }) {
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
  if (fullSpacing >= minStaffSpacePx) return {
    mode: 'full', compact: false, activeSystem: null, systemCount: systems.length,
    viewBox: full, projectedStaffSpacePx: fullSpacing,
  };
  const activeSystem = systems.includes(cursorSystem) ? cursorSystem : systems[0];
  const focused = systemBox(layout, activeSystem);
  const focusedSpacing = focused.spacing * containScale(viewport, focused);
  return {
    mode: 'system', compact: focusedSpacing < minStaffSpacePx, activeSystem, systemCount: systems.length,
    viewBox: focused, projectedStaffSpacePx: focusedSpacing,
  };
}
