// fingerLabel.js — finger-id display formatting for FingerprintHands.jsx,
// split out so Fast Refresh can hot-reload the hands component on its own.

// Human-readable finger label, e.g. 'right-index' → 'Right index'.
export function fingerLabel(finger) {
  if (!finger) return '';
  return finger
    .split('-')
    .map((part, i) => (i === 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}
