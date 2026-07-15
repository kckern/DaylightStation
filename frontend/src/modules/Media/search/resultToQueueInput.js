export function resultToQueueInput(row) {
  if (!row || typeof row !== 'object') return null;
  const contentId = row.id
    ?? row.itemId
    ?? (row.source && row.localId ? `${row.source}:${row.localId}` : null);
  if (!contentId) return null;
  const mediaType = row.mediaType;
  const format = mediaType === 'video' || mediaType === 'audio' ? mediaType : null;
  const input = {
    contentId,
    title: row.title ?? null,
    thumbnail: row.thumbnail ?? null,
    duration: typeof row.duration === 'number' ? row.duration : null,
    format,
  };
  // Container markers pass through so the session layer can expand an
  // album/show/playlist into its playable children (containerExpansion.js).
  // Without these a "Play Now" on an album plays one track and stops.
  if (row.itemType != null) input.itemType = row.itemType;
  const containerType = row.type ?? row.metadata?.type;
  if (containerType != null) input.type = containerType;
  if (typeof row.childCount === 'number') input.childCount = row.childCount;
  // Carry artist/album so Now Playing can show "<artist> — <album>" for a
  // directly-played track (containerExpansion already sets containerTitle
  // for tracks reached via an album; a track played straight from search had
  // no context line before).
  const artist = row.metadata?.artist ?? row.metadata?.grandparentTitle;
  const album = row.metadata?.album ?? row.metadata?.parentTitle;
  if (artist) input.artist = artist;
  if (album) input.album = album;
  return input;
}

export default resultToQueueInput;
