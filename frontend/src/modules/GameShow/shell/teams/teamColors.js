// Team palette + readable on-color. Gold is deliberately absent (reserved
// for the UI brass accent) and so is red (reserved for danger/negative).
// Presets from the data volume can carry ANY hex, so text-on-team-color is
// computed from WCAG relative luminance, not looked up.

export const TEAM_COLORS = ['#3273dc', '#2fbf71', '#9b5de5', '#f28c28', '#1fa8a0', '#c2559f'];

// Intentional duplicates of --gs-paper / --gs-ink (CSS vars aren't readable
// from this pure helper; keep in sync with styles/_tokens.scss).
const PAPER = '#f3efe2';
const INK = '#10131f';

function linear(hex, i) {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function onColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return PAPER;
  const L = 0.2126 * linear(hex, 0) + 0.7152 * linear(hex, 1) + 0.0722 * linear(hex, 2);
  return L > 0.3 ? INK : PAPER;
}
