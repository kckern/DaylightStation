export function formatMusicErrorMessage(err) {
  if (!err) return null;
  switch (err.kind) {
    case 'fetch-failed':       return `Music API error${err.httpStatus ? ` (HTTP ${err.httpStatus})` : ''}`;
    case 'fetch-timeout':      return 'Music load timed out';
    case 'empty-queue':        return 'Playlist empty';
    case 'invalid-queue':      return 'Playlist contains no playable items';
    case 'media-error':        return `Media error${err.code != null ? ` (code ${err.code})` : ''}`;
    case 'media-load-timeout': return 'Music load timed out';
    default:                   return 'Music unavailable';
  }
}
