export function formatGoodreadsReadAt(readAt) {
  if (!readAt) return '';
  const date = new Date(readAt);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
