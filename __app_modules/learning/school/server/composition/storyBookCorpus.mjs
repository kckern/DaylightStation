/**
 * The household's story books, read off the NFC book stickers.
 *
 * A refused story-time book suggests others (`suggestStories`), and the only
 * books worth suggesting are ones a child can pick up and tap: the physical
 * books with a sticker. The trigger registry already holds them, so this maps
 * its parsed tags (`{[uid]: {global, overrides}}`) to `[{contentId, title}]`.
 *
 * Only the tag-global layer is read, and only the two content spellings the
 * book file actually uses — `plex: <id>` shorthand and an explicit
 * `content: <source:id>`. A tag with an action other than `play` (a shuffled
 * `queue` of a whole collection) is not one book, and a learner card is a
 * person. `note` is the hand-typed label, used as a title only until the
 * reading log has the real one.
 *
 * `null` (not `[]`) when there is no registry yet: "unknown" lets the launcher
 * fall back to the learner's own history, where `[]` would say "no books".
 */
export function storyBooksFromNfcTags(tags) {
  if (!tags || typeof tags !== 'object') return null;
  const books = [];
  for (const entry of Object.values(tags)) {
    const g = entry?.global;
    if (!g || typeof g !== 'object') continue;
    if (g.school_learner !== undefined && g.school_learner !== null) continue;
    if (g.action !== undefined && g.action !== 'play') continue;
    let contentId = null;
    if (typeof g.content === 'string' && g.content.includes(':')) contentId = g.content.trim();
    else if ((typeof g.plex === 'string' && g.plex.trim()) || Number.isFinite(g.plex)) contentId = `plex:${String(g.plex).trim()}`;
    if (!contentId) continue;
    const title = typeof g.note === 'string' && g.note.trim() ? g.note.trim() : null;
    books.push({ contentId, title });
  }
  return books;
}

export default storyBooksFromNfcTags;
