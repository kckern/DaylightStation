/**
 * The household's story books, as the trigger owner reports them.
 *
 * A refused story-time book suggests others (`suggestStories`), and the only
 * books worth suggesting are ones a child can pick up and tap: the physical
 * books with a sticker. Which tags play which content is the trigger owner's
 * rule (`NfcResolver.contentTags`), so School takes that list as given and
 * only renames it into its own vocabulary: `note`, the hand-typed sticker
 * label, becomes the fallback `title` until the reading log or Plex has the
 * real one.
 *
 * `null` (not `[]`) when there is no registry yet: "unknown" lets the launcher
 * fall back to the learner's own history, where `[]` would say "no books".
 *
 * @param {Array<{contentId: string, note?: string|null}>|null|undefined} contentTags
 * @returns {Array<{contentId: string, title: string|null}>|null}
 */
export function storyBooksFromContentTags(contentTags) {
  if (!Array.isArray(contentTags)) return null;
  return contentTags
    .filter((t) => typeof t?.contentId === 'string' && t.contentId)
    .map((t) => ({ contentId: t.contentId, title: t.note ?? null }));
}

export default storyBooksFromContentTags;
