// resolveAmbient — choose which ambient config ArtMode should use.
// Screen ambient (per-room sensor topic + curve) wins; preset ambient is a legacy
// fallback (no topic of its own → the default 'ambient' topic). Returns null when
// neither carries a curve (→ ArtMode does not dim).
export function resolveAmbient(screenAmbient, presetAmbient) {
  const pick = (screenAmbient && Array.isArray(screenAmbient.curve)) ? screenAmbient
    : ((presetAmbient && Array.isArray(presetAmbient.curve)) ? presetAmbient : null);
  if (!pick) return null;
  const defaultLux = Number.isFinite(pick.defaultLux) ? pick.defaultLux : 0;
  return { topic: pick.topic || 'ambient', curve: pick.curve, defaultLux };
}

export default resolveAmbient;
