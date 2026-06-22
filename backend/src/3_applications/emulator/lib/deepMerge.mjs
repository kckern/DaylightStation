export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== 'object' || base === null) return over ?? base;
  if (typeof over !== 'object' || over === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = (k in base) ? deepMerge(base[k], v) : v;
  }
  return out;
}
