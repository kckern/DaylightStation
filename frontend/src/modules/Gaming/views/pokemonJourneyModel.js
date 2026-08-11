export const SKILL_LABELS = Object.freeze({
  scale: 'Scales',
  chord: 'Chords',
  arpeggio: 'Arpeggios',
  'timed-pattern': 'Rhythm',
});

export function pokemonAssetUrl(asset) {
  if (!asset) return null;
  if (/^(?:https?:)?\/\//.test(asset) || asset.startsWith('/')) return asset;
  return `/api/v1/proxy/media/stream/${encodeURIComponent(asset)}`;
}

export function hitClass(hitResult) {
  if (hitResult === 'bullseye' || hitResult === 'direct-hit') return 'direct';
  if (hitResult === 'partial-hit') return 'partial';
  return 'miss';
}

export function starText(stars = 0) {
  return `${'★'.repeat(stars)}${'☆'.repeat(Math.max(0, 3 - stars))}`;
}
