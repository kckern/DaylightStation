import { describe, it, expect } from 'vitest';
import { storyBooksFromNfcTags } from '../../../../__app_modules/learning/school/server/composition/storyBookCorpus.mjs';

// The parsed NFC registry shape: { [uid]: { global, overrides } }.
const tag = (global, overrides = {}) => ({ global, overrides });

describe('storyBooksFromNfcTags', () => {
  it('turns book stickers into {contentId, title}, the note as the title', () => {
    expect(storyBooksFromNfcTags({
      '04aaaa00000001': tag({ note: 'Jungle book', plex: 620681 }),
      '0bbb0002': tag({ plex: '620707' }),
    })).toEqual([
      { contentId: 'plex:620681', title: 'Jungle book' },
      { contentId: 'plex:620707', title: null },
    ]);
  });

  it('takes an explicit content id as written', () => {
    expect(storyBooksFromNfcTags({ a: tag({ content: 'plex:5', note: 'Five' }) }))
      .toEqual([{ contentId: 'plex:5', title: 'Five' }]);
  });

  it('leaves out learner cards, non-play actions (a shuffled queue is not a book), and tags with no content', () => {
    expect(storyBooksFromNfcTags({
      card: tag({ note: 'learner card', school_learner: 'test-learner' }),
      queue: tag({ action: 'queue', plex: 456598, shuffle: 1 }),
      scene: tag({ note: 'Lights', scene: 'scene.evening' }),
      play: tag({ action: 'play', plex: 1 }),
    })).toEqual([{ contentId: 'plex:1', title: null }]);
  });

  it('answers null when there is no registry, so the history stands in', () => {
    expect(storyBooksFromNfcTags(null)).toBeNull();
    expect(storyBooksFromNfcTags(undefined)).toBeNull();
  });
});
