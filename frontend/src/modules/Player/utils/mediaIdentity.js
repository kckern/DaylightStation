export const resolveMediaIdentity = (meta) => {
  if (!meta) return null;
  const candidate = meta.assetId
    ?? meta.key
    ?? meta.plex
    ?? meta.media
    ?? meta.id
    ?? meta.guid
    ?? meta.mediaUrl
    ?? null;
  return candidate != null ? String(candidate) : null;
};

/**
 * Resolve media identity with source namespace prefix.
 * Returns format like "plex:649319" for source-aware identification.
 * Falls back to bare ID if source cannot be determined.
 */
export const resolveContentId = (metadata) => {
  const bareId = resolveMediaIdentity(metadata);
  if (!bareId) return null;

  // If already namespaced, return as-is
  if (typeof bareId === 'string' && bareId.includes(':')) return bareId;

  // Determine source from metadata
  const source = metadata?.source
    || (metadata?.plex != null ? 'plex' : null)
    || (metadata?.assetId != null ? 'plex' : null)
    || (metadata?.key != null ? 'plex' : null)
    || 'plex';

  return `${source}:${bareId}`;
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
