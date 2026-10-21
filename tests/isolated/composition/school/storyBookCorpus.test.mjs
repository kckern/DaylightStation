import { describe, it, expect } from 'vitest';
import { storyBooksFromContentTags } from '../../../../__app_modules/learning/school/server/composition/storyBookCorpus.mjs';

describe('storyBooksFromContentTags', () => {
  it("maps the trigger owner's content tags to {contentId, title}, the note as the title", () => {
    expect(storyBooksFromContentTags([
      { uid: 'a', contentId: 'plex:620681', note: 'Jungle book' },
      { uid: 'b', contentId: 'plex:620707', note: null },
    ])).toEqual([
      { contentId: 'plex:620681', title: 'Jungle book' },
      { contentId: 'plex:620707', title: null },
    ]);
  });

  it('drops rows with no content id', () => {
    expect(storyBooksFromContentTags([{ uid: 'x', contentId: null }, null])).toEqual([]);
  });

  it('answers null when there is no registry, so the history stands in', () => {
    expect(storyBooksFromContentTags(null)).toBeNull();
    expect(storyBooksFromContentTags(undefined)).toBeNull();
  });
});
