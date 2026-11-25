// The content filter paints over a film's own frames, so its inks are fixed
// black and white (a pack color would tint the picture it is hiding or captioning).
// Named once here; the overlay and chrome read these instead of writing literals.
export const FILTER_BLACK = '#000'; // data-color: ink over film frames
export const FILTER_WHITE = '#fff'; // data-color: caption and glyph ink over film frames
export const FILTER_HIGHLIGHT = '#ffd54a'; // data-color: active bumper badge
/** Black at `alpha` opacity, formatted exactly as the overlay has always written it. */
export const filterBlack = (alpha) => `rgba(0,0,0,${alpha})`; // data-color: scrim over film frames
/** The active badge's glow. */
export const filterHighlightGlow = (alpha) => `rgba(255,213,74,${alpha})`; // data-color: active bumper badge glow
