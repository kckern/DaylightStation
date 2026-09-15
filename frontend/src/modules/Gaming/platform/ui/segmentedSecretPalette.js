// Colors for the sixteen-segment decoder. A red decoder card passes only the
// red channel, so every signal color keeps red at full and every mask color
// keeps red low. The two families overlap in apparent brightness, so brightness
// alone does not mark the letters. Hex values live in _tokens.scss.
export const SIGNAL_RED_MIN = 0xff;
export const MASK_RED_MAX = 0x40;

export const SIGNAL_SEGMENT_COLORS = Object.freeze([
  { name: 'white', token: '--gp-segment-signal-1' },
  { name: 'yellow', token: '--gp-segment-signal-2' },
  { name: 'peach', token: '--gp-segment-signal-3' },
  { name: 'pink', token: '--gp-segment-signal-4' },
  { name: 'orange', token: '--gp-segment-signal-5' },
  { name: 'magenta', token: '--gp-segment-signal-6' },
  { name: 'hot pink', token: '--gp-segment-signal-7' },
  { name: 'red', token: '--gp-segment-signal-8' },
]);

export const MASK_SEGMENT_COLORS = Object.freeze([
  { name: 'aqua mint', token: '--gp-segment-mask-1' },
  { name: 'cyan', token: '--gp-segment-mask-2' },
  { name: 'green', token: '--gp-segment-mask-3' },
  { name: 'sky', token: '--gp-segment-mask-4' },
  { name: 'teal', token: '--gp-segment-mask-5' },
  { name: 'forest', token: '--gp-segment-mask-6' },
  { name: 'blue', token: '--gp-segment-mask-7' },
  // Jet black: a dark member so the greens and blues are not the only masks.
  { name: 'jet black', token: '--gp-segment-mask-8' },
]);

export const segmentColorValue = ({ token }) => `var(${token})`;
