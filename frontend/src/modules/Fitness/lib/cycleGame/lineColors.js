// Per-rider identity colors for cycle-game lanes, roster, speedometers, recap.
// Single source of truth — index = rider order. Import this instead of
// redeclaring the array.
//
// Six neon hues spaced around the wheel so up to six riders (humans + ghosts)
// stay distinguishable on the dark synthwave bg. Magenta (#ff2d95) and cyan
// (#21e6ff) are deliberately ABSENT — reserved for UI chrome, so a rider is
// never confused with a selection/telemetry accent.
export const LINE_COLORS = [
  '#5dff9b', // green
  '#ffb13d', // orange
  '#b072ff', // purple
  '#ffe14d', // yellow
  '#3da5ff', // blue (clearly bluer than the reserved cyan)
  '#ff7eb6'  // pink (lighter than the reserved hot magenta)
];
