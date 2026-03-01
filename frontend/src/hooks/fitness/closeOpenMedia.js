/**
 * Find contentIds that have a media_start but no matching media_end.
 * Pure function — no side effects, no class dependencies.
 *
 * @param {Array<{type: string, data?: {contentId?: string}}>} events
 * @returns {string[]} Array of unclosed contentIds
 */
export function findUnclosedMedia(events) {
  const opened = new Set();
  for (const evt of events) {
    const id = evt.data?.contentId;
    if (!id) continue;
    if (evt.type === 'media_start') opened.add(id);
    if (evt.type === 'media_end') opened.delete(id);
  }
  return [...opened];
}
