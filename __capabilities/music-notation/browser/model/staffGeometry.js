// One fixed frame for the live grand staff. Changes never depend on played notes.
// The 40-unit offset is VexFlow's headroom above its first stave line.
export const STAFF_GEOMETRY = Object.freeze({
  top: 20,
  bottom: 272,
  trebleY: 58,
  gap: 80,
  trebleBottomLine: 138,
  bassBottomLine: 218
});
export const staffYForPosition = (position, staff) => (staff === 'treble' ? STAFF_GEOMETRY.trebleBottomLine : STAFF_GEOMETRY.bassBottomLine) - position * 5;
