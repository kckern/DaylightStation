// tests/isolated/domain/content/services/RelevanceScoringService.test.mjs
import { describe, it, expect } from 'vitest';
import { RelevanceScoringService } from '#domains/content/services/RelevanceScoringService.mjs';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';

describe('RelevanceScoringService', () => {
  describe('score', () => {
    it('returns 1000 for ID match', () => {
      const item = { _idMatch: true, title: 'Test' };
      expect(RelevanceScoringService.score(item)).toBe(1000);
    });

    it('scores by category from metadata.category', () => {
      const item = {
        title: 'Test Person',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item)).toBe(150);
    });

    it('scores CURATED category at 148', () => {
      const item = {
        title: 'My Playlist',
        metadata: { category: ContentCategory.CURATED }
      };
      expect(RelevanceScoringService.score(item)).toBe(148);
    });

    it('scores CREATOR category at 145', () => {
      const item = {
        title: 'Artist Name',
        metadata: { category: ContentCategory.CREATOR }
      };
      expect(RelevanceScoringService.score(item)).toBe(145);
    });

    it('scores SERIES category at 140', () => {
      const item = {
        title: 'TV Show',
        metadata: { category: ContentCategory.SERIES }
      };
      expect(RelevanceScoringService.score(item)).toBe(140);
    });

    it('scores WORK category at 130', () => {
      const item = {
        title: 'Movie',
        metadata: { category: ContentCategory.WORK }
      };
      expect(RelevanceScoringService.score(item)).toBe(130);
    });

    it('scores CONTAINER category at 125', () => {
      const item = {
        title: 'Album',
        metadata: { category: ContentCategory.CONTAINER }
      };
      expect(RelevanceScoringService.score(item)).toBe(125);
    });

    it('scores EPISODE category at 20', () => {
      const item = {
        title: 'Episode 1',
        metadata: { category: ContentCategory.EPISODE }
      };
      expect(RelevanceScoringService.score(item)).toBe(20);
    });

    it('scores TRACK category at 15', () => {
      const item = {
        title: 'Song',
        metadata: { category: ContentCategory.TRACK }
      };
      expect(RelevanceScoringService.score(item)).toBe(15);
    });

    it('scores MEDIA category at 10', () => {
      const item = {
        title: 'image.jpg',
        metadata: { category: ContentCategory.MEDIA }
      };
      expect(RelevanceScoringService.score(item)).toBe(10);
    });

    it('returns 5 for items without category', () => {
      const item = { title: 'Unknown', metadata: {} };
      expect(RelevanceScoringService.score(item)).toBe(5);
    });
  });

  describe('score with title matching', () => {
    it('adds 20 for exact title match', () => {
      const item = {
        title: 'Milo',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item, 'Milo')).toBe(170);
    });

    it('adds 10 for title starts with search', () => {
      const item = {
        title: 'Milo Smith',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item, 'Milo')).toBe(160);
    });

    it('adds 5 for title contains search', () => {
      const item = {
        title: 'John Milo Smith',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item, 'Milo')).toBe(155);
    });

    it('is case insensitive', () => {
      const item = {
        title: 'MILO',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item, 'milo')).toBe(170);
    });
  });

  describe('score with child count bonus', () => {
    it('adds up to 5 points for large collections', () => {
      const item = {
        title: 'Big Collection',
        metadata: { category: ContentCategory.CURATED },
        childCount: 1000
      };
      expect(RelevanceScoringService.score(item)).toBe(153);
    });

    it('scales childCount bonus proportionally', () => {
      const item = {
        title: 'Small Collection',
        metadata: { category: ContentCategory.CURATED },
        childCount: 200
      };
      expect(RelevanceScoringService.score(item)).toBe(150);
    });
  });

  describe('sortByRelevance', () => {
    it('sorts items by score descending', () => {
      const items = [
        { title: 'Track', metadata: { category: ContentCategory.TRACK } },
        { title: 'Person', metadata: { category: ContentCategory.IDENTITY } },
        { title: 'Album', metadata: { category: ContentCategory.CONTAINER } }
      ];

      const sorted = RelevanceScoringService.sortByRelevance(items);

      expect(sorted[0].title).toBe('Person');
      expect(sorted[1].title).toBe('Album');
      expect(sorted[2].title).toBe('Track');
    });

    it('considers search text for title matching', () => {
      const items = [
        { title: 'Milo Track', metadata: { category: ContentCategory.TRACK } },
        { title: 'John', metadata: { category: ContentCategory.IDENTITY } },
        { title: 'Milo', metadata: { category: ContentCategory.IDENTITY } }
      ];

      const sorted = RelevanceScoringService.sortByRelevance(items, 'Milo');

      expect(sorted[0].title).toBe('Milo');
      expect(sorted[1].title).toBe('John');
      expect(sorted[2].title).toBe('Milo Track');
    });

    it('does not mutate original array', () => {
      const items = [
        { title: 'B', metadata: { category: ContentCategory.TRACK } },
        { title: 'A', metadata: { category: ContentCategory.IDENTITY } }
      ];
      const original = [...items];

      RelevanceScoringService.sortByRelevance(items);

      expect(items).toEqual(original);
    });
  });
});
