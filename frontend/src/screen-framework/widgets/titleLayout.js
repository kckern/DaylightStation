// titleLayout.js — pure balanced line splitting for placard titles. No DOM.
// Returns 1 or 2 lines; per-line truncation (…) is left to CSS.

export function layoutTitle(title, maxWidthPx, measure) {
  const text = String(title ?? '').trim();
  if (!text) return [];
  if (typeof measure !== 'function' || !(maxWidthPx > 0)) return [text];
  if (measure(text) <= maxWidthPx) return [text];

  const words = text.split(/\s+/);
  if (words.length < 2) return [text];

  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const diff = Math.abs(measure(a) - measure(b));
    if (best === null || diff < best.diff) best = { diff, a, b };
  }
  return [best.a, best.b];
}

export default layoutTitle;
