// Per-rider identity colors for cycle-game lanes, roster, speedometers, recap.
// Single source of truth — index = rider order. Import this instead of
// redeclaring the array.
//
// Synthwave palette — six hues distinct from both reserved UI chrome and
// HR-zone colors. Avoided hues: blue-green (#6ab8ff, #51cf66), yellow (#ffd43b),
// orange (#ff922b), red (#ff6b6b). Reserved UI chrome absent here: cyan (#21e6ff)
// and hot magenta (#ff2d95) stay exclusive to telemetry/selection accents.
export const LINE_COLORS = [
  '#4dd0e1', // cyan (softer than the reserved chrome cyan #21e6ff)
  '#d472c0', // magenta (softer than the reserved hot magenta #ff2d95)
  '#2dd4bf', // teal
  '#a14d6b', // maroon / rose
  '#cbb285', // sand / tan
  '#9aa3c0'  // slate gray
];
