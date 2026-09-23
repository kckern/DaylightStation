/** Engine thresholds (spec §7 table + grown-up settings). Defaults live here; school.yml card_ladder overrides. */
export const DEFAULT_SETTINGS = Object.freeze({
  round: { size: 5, maxPasses: 3 },
  batch: { newPerDay: 4, workingSet: 7 },
  // review.typedEvery is retired (ruling 2026-09-23): typing is the sign-off, never a cadence.
  review: { gapScale: 1 },
  drill: { afterMisses: 2, perSitting: 1 },
  session: { capMinutes: 15 },
  typing: { passScore: 6 },
});

const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over ?? {})) {
    if (isMap(v) && isMap(out[k])) out[k] = merge(out[k], v);
    else if (typeof v === 'number' && Number.isFinite(v) && typeof out[k] === 'number') out[k] = v;
  }
  return out;
}

export function resolveSettings(config = {}) {
  const out = merge(DEFAULT_SETTINGS, config.settings);
  for (const [dotted, range] of Object.entries(config.bounds ?? {})) {
    const [group, key] = dotted.split('.');
    if (Array.isArray(range) && typeof out[group]?.[key] === 'number') out[group][key] = Math.min(range[1], Math.max(range[0], out[group][key]));
  }
  return out;
}
