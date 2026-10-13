/**
 * Slug → human label (advocacy B6): courses and units have no authored
 * display names, so the console renders "math-fractions" as "Math
 * Fractions" instead of raw kebab. Purely presentational — ids stay ids in
 * every write.
 */
export function labelize(slug) {
  if (typeof slug !== 'string' || !slug) return slug ?? '';
  return slug
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}
export default labelize;
