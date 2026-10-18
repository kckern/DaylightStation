import { isEligible, selectAmbianceArtwork } from '../server/domain/ambiancePolicy.mjs';

/** Compare a concrete playlist and available files with the publication policy. */
export function auditAmbiance({ catalog, profile, trackIds, artIds }) {
  if (catalog?.version !== 1 || !catalog.tracks || !catalog.artworks || !catalog.profiles) throw new Error('Unsupported ambiance catalog');
  if (!Object.hasOwn(catalog.profiles, profile)) throw new Error('Unknown ambiance profile');
  if (!Array.isArray(trackIds) || !Array.isArray(artIds)) throw new Error('Audit requires explicit playlist and artwork IDs');
  const policy = catalog.profiles[profile];
  const issues = [];
  const playlist = new Set(trackIds);
  const available = new Set(artIds);
  const eligibleTracks = Object.entries(catalog.tracks).filter(([, record]) => isEligible(record, profile, policy));
  for (const [type, records] of [['track', catalog.tracks], ['artwork', catalog.artworks]]) {
    for (const [id, record] of Object.entries(records)) {
      if (record?.review?.status === 'approved' && Array.isArray(record.review.profiles) && record.review.profiles.includes(profile) &&
          !isEligible(record, profile, policy, type)) issues.push({ kind: 'ineligible-approval', type, id });
    }
  }
  for (const id of playlist) if (!isEligible(catalog.tracks[id], profile, policy)) issues.push({ kind: 'unapproved-track', id });
  for (const [id] of eligibleTracks) if (!playlist.has(id)) issues.push({ kind: 'missing-track', id });
  for (const [id, record] of Object.entries(catalog.artworks)) {
    if (isEligible(record, profile, policy, 'artwork') && !available.has(id)) issues.push({ kind: 'missing-art', id });
  }
  const artworks = Object.fromEntries(Object.entries(catalog.artworks).filter(([id]) => available.has(id)));
  const coverage = eligibleTracks.map(([trackId, record]) => {
    const match = selectAmbianceArtwork({ track: { ...record, id: trackId }, artworks,
      profileKey: profile, policy, overrides: catalog.pairings, random: () => 0 });
    if (!match) issues.push({ kind: 'no-art-coverage', id: trackId });
    return { trackId, kind: match?.kind === 'matched' ? 'semantic' : match?.kind || 'neutral', artId: match?.artId || null };
  });
  return { ok: issues.length === 0, profile, counts: { playlist: playlist.size, approvedTracks: eligibleTracks.length, availableArtworks: available.size }, issues, coverage };
}
