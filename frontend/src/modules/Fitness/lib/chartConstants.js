export const CHART_MARGIN = { top: 40, right: 90, bottom: 38, left: 30 };
export const MIN_VISIBLE_TICKS = 30;
// Minimum gap duration before showing grey dotted style (2 minutes)
// Used by both race chart (grey dotted line) and timeline area chart (zero fill)
export const MIN_GAP_DURATION_FOR_DASHED_MS = 2 * 60 * 1000;

// Annotation styling (challenge/video markers). Single source of truth so the
// line chart, gutter, and HR lanes never disagree (audit Sin 10).
export const MARKER_FILL_OPACITY = 0.06;          // duration-rect tint
export const MARKER_CHART_TICK_LEN = 14;          // short downward tick under a badge in the line chart
