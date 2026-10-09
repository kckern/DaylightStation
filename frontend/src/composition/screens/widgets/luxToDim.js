// luxToDim — pure. Map a lux reading to a dim-overlay opacity via a
// piecewise-linear curve of { lux, dim } control points (clamped at the ends).
const DIM_CEIL = 0.85;
const clampDim = (n) => Math.max(0, Math.min(DIM_CEIL, n));

export function luxToDim(lux, curve) {
  if (!Array.isArray(curve) || curve.length === 0) return 0.4;
  const pts = [...curve].sort((a, b) => a.lux - b.lux);
  if (!Number.isFinite(lux) || lux <= pts[0].lux) return clampDim(pts[0].dim);
  const last = pts[pts.length - 1];
  if (lux >= last.lux) return clampDim(last.dim);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (lux >= a.lux && lux <= b.lux) {
      const t = (lux - a.lux) / (b.lux - a.lux);
      return clampDim(a.dim + t * (b.dim - a.dim));
    }
  }
  return clampDim(last.dim);
}

export default luxToDim;
