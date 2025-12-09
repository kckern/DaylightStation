export const resolveMediaIdentity = (meta) => {
  if (!meta) return null;
  const candidate = meta.media_key
    ?? meta.key
    ?? meta.plex
    ?? meta.media
    ?? meta.id
    ?? meta.guid
    ?? meta.media_url
    ?? null;
  return candidate != null ? String(candidate) : null;
};

export const normalizeDuration = (...candidates) => {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const normalized = typeof candidate === 'string' ? parseFloat(candidate) : Number(candidate);
    if (!Number.isFinite(normalized) || normalized <= 0) continue;
    return normalized > 1000 ? Math.round(normalized / 1000) : Math.round(normalized);
  }
  return null;
};
