// volumeCurve — pure. Map a user-facing master level [0,1] to an output gain
// [0,1] via a piecewise-linear curve of { in, out } control points (clamped at
// the ends). Lets a screen reshape its volume dial without touching code: e.g.
// a knee at { in: 0.5, out: 0.1 } gives the bottom half of the dial fine control
// over the quiet 0–10% range and the top half the audible 10–100% range, so the
// top steps actually change loudness and the low steps aren't all near-silent.
const clampUnit = (n) => Math.max(0, Math.min(1, n));

export function volumeCurve(master, curve) {
  const m = clampUnit(Number(master));
  if (!Array.isArray(curve) || curve.length === 0) return m;   // no curve → linear
  const pts = curve
    .map((p) => ({ in: Number(p.in), out: Number(p.out) }))
    .filter((p) => Number.isFinite(p.in) && Number.isFinite(p.out))
    .sort((a, b) => a.in - b.in);
  if (pts.length === 0) return m;
  if (m <= pts[0].in) return clampUnit(pts[0].out);
  const last = pts[pts.length - 1];
  if (m >= last.in) return clampUnit(last.out);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (m >= a.in && m <= b.in) {
      const span = b.in - a.in;
      const t = span === 0 ? 0 : (m - a.in) / span;
      return clampUnit(a.out + t * (b.out - a.out));
    }
  }
  return clampUnit(last.out);
}

export default volumeCurve;
