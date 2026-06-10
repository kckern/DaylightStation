export function resultToQueueInput(row) {
  if (!row || typeof row !== 'object') return null;
  const contentId = row.id
    ?? row.itemId
    ?? (row.source && row.localId ? `${row.source}:${row.localId}` : null);
  if (!contentId) return null;
  const mediaType = row.mediaType;
  const format = mediaType === 'video' || mediaType === 'audio' ? mediaType : null;
  return {
    contentId,
    title: row.title ?? null,
    thumbnail: row.thumbnail ?? null,
    duration: typeof row.duration === 'number' ? row.duration : null,
    format,
  };
}

export default resultToQueueInput;
