// tests/isolated/domain/content/services/RelevanceScoringService.test.mjs
import { describe, it, expect } from 'vitest';
import { RelevanceScoringService } from '#domains/content/services/RelevanceScoringService.mjs';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';

const item = (title, category, extra = {}) => ({
  title,
  metadata: { category, ...(extra.metadata || {}) },
  ...extra
});

describe('RelevanceScoringService', () => {
  describe('score', () => {
    it('returns 10000 for ID match', () => {
      expect(RelevanceScoringService.score({ _idMatch: true, title: 'Test' })).toBe(10000);
    });
  });

  // With no search text there is nothing to match against, so the only signal
  // is what kind of thing an item is. This is the browse ordering and keeps
  // the original category scale.
  describe('browse ordering (no search text)', () => {
    it.each([
      [ContentCategory.IDENTITY, 150],
      [ContentCategory.CURATED, 148],
      [ContentCategory.CREATOR, 145],
      [ContentCategory.SERIES, 140],
      [ContentCategory.WORK, 130],
      [ContentCategory.CONTAINER, 125],
      [ContentCategory.EPISODE, 20],
      [ContentCategory.TRACK, 15],
      [ContentCategory.MEDIA, 10]
    ])('scores %s at %i', (category, expected) => {
      expect(RelevanceScoringService.score(item('Anything', category))).toBe(expected);
    });

    it('returns 5 for items without category', () => {
      expect(RelevanceScoringService.score({ title: 'Unknown', metadata: {} })).toBe(5);
    });

    it('adds up to 5 points for large collections', () => {
      const big = item('Big Collection', ContentCategory.CURATED, { childCount: 1000 });
      expect(RelevanceScoringService.score(big)).toBe(153);
    });

    it('scales childCount bonus proportionally', () => {
      const small = item('Small Collection', ContentCategory.CURATED, { childCount: 200 });
      expect(RelevanceScoringService.score(small)).toBe(150);
    });
  });

  // The regression this scoring exists to prevent: category used to be worth
  // up to 150 while a text match was worth at most 20, so an episode could
  // never outrank a container no matter how well it matched.
  describe('match quality outranks category', () => {
    it('ranks an exact-title episode above a container that merely contains the term', () => {
      const episode = item('Job', ContentCategory.EPISODE);
      const movie = item('The Italian Job', ContentCategory.WORK);
      expect(RelevanceScoringService.score(episode, 'job'))
        .toBeGreaterThan(RelevanceScoringService.score(movie, 'job'));
    });

    it('ranks an exact-title track above a non-matching identity', () => {
      const track = item('User_3', ContentCategory.TRACK);
      const person = item('John', ContentCategory.IDENTITY);
      expect(RelevanceScoringService.score(track, 'User_3'))
        .toBeGreaterThan(RelevanceScoringService.score(person, 'User_3'));
    });

    it('ranks an exact-title image file above a partially-matching series', () => {
      const image = item('esther', ContentCategory.MEDIA);
      const series = item('Esther and the King', ContentCategory.SERIES);
      expect(RelevanceScoringService.score(image, 'esther'))
        .toBeGreaterThan(RelevanceScoringService.score(series, 'esther'));
    });

    it('uses category only to break ties between equally good matches', () => {
      const container = item('Job', ContentCategory.CONTAINER);
      const episode = item('Job', ContentCategory.EPISODE);
      expect(RelevanceScoringService.score(container, 'job'))
        .toBeGreaterThan(RelevanceScoringService.score(episode, 'job'));
    });
  });

  describe('match tiers', () => {
    const cat = ContentCategory.EPISODE;

    it('ranks exact above prefix above contains', () => {
      const exact = RelevanceScoringService.score(item('Job', cat), 'job');
      const prefix = RelevanceScoringService.score(item('Job Interview', cat), 'job');
      const contains = RelevanceScoringService.score(item('The Italian Job', cat), 'job');
      expect(exact).toBeGreaterThan(prefix);
      expect(prefix).toBeGreaterThan(contains);
    });

    it('is case insensitive', () => {
      expect(RelevanceScoringService.score(item('USER_3', cat), 'user_3'))
        .toBe(RelevanceScoringService.score(item('User_3', cat), 'User_3'));
    });

    it('ignores punctuation differences', () => {
      expect(RelevanceScoringService.score(item("Job's Trials", cat), 'jobs trials'))
        .toBeGreaterThan(0);
    });

    it('matches word prefixes for typeahead', () => {
      expect(RelevanceScoringService.score(item('Esther', cat), 'esth')).toBeGreaterThan(0);
    });
  });

  describe('multi-token queries', () => {
    it('matches all tokens regardless of order', () => {
      expect(RelevanceScoringService.score(item('Red Sea Crossing', ContentCategory.EPISODE), 'crossing red'))
        .toBeGreaterThan(0);
    });

    it('scores tokens in query order above scattered order', () => {
      const ordered = RelevanceScoringService.score(item('Red Sea Crossing', ContentCategory.EPISODE), 'red sea');
      const scattered = RelevanceScoringService.score(item('Sea of Red', ContentCategory.EPISODE), 'red sea');
      expect(ordered).toBeGreaterThan(scattered);
    });

    it('returns 0 when a token matches nothing', () => {
      expect(RelevanceScoringService.score(item('Baby Moses', ContentCategory.EPISODE), 'holy moly job'))
        .toBe(0);
    });

    it('matches across the show title when the episode title alone cannot', () => {
      const episode = item('Job', ContentCategory.EPISODE, {
        metadata: { grandparentTitle: 'Scripture Stories', parentTitle: 'Season 1' }
      });
      expect(RelevanceScoringService.score(episode, 'scripture stories job')).toBeGreaterThan(0);
    });

    it('ranks a title-only match above a cross-field match of the same tier', () => {
      const titleMatch = item('Scripture Stories Job', ContentCategory.EPISODE);
      const crossField = item('Job', ContentCategory.EPISODE, {
        metadata: { grandparentTitle: 'Scripture Stories' }
      });
      expect(RelevanceScoringService.score(titleMatch, 'scripture stories job'))
        .toBeGreaterThan(RelevanceScoringService.score(crossField, 'scripture stories job'));
    });
  });

  describe('coverage', () => {
    it('ranks a short exact title above a long title containing the term', () => {
      const short = item('Job', ContentCategory.WORK);
      const long = item('Cracking the PM Interview: How to Land a Product Manager Job in Technology', ContentCategory.WORK);
      expect(RelevanceScoringService.score(short, 'job'))
        .toBeGreaterThan(RelevanceScoringService.score(long, 'job'));
    });

    it('separates two same-tier matches by how much of the title the query covers', () => {
      const tight = RelevanceScoringService.score(item('Inside Job', ContentCategory.WORK), 'job');
      const loose = RelevanceScoringService.score(item('Every Job Is a Sales Job Really', ContentCategory.WORK), 'job');
      expect(tight).toBeGreaterThan(loose);
    });
  });

  describe('non-matches', () => {
    it('scores an unrelated item 0 so callers can filter it out', () => {
      expect(RelevanceScoringService.score(item('2026-08-12 20.56.23.jpg', ContentCategory.MEDIA), 'job'))
        .toBe(0);
    });

    it('matches() is true for any item when there is no search text', () => {
      expect(RelevanceScoringService.matches(item('Anything', ContentCategory.MEDIA), '')).toBe(true);
    });

    it('matches() is false for an item that matches no token', () => {
      expect(RelevanceScoringService.matches(item('Baby Moses', ContentCategory.EPISODE), 'job')).toBe(false);
    });
  });

  describe('sortByRelevance', () => {
    it('sorts by category when there is no search text', () => {
      const items = [
        item('Track', ContentCategory.TRACK),
        item('Person', ContentCategory.IDENTITY),
        item('Album', ContentCategory.CONTAINER)
      ];
      const sorted = RelevanceScoringService.sortByRelevance(items);
      expect(sorted.map(i => i.title)).toEqual(['Person', 'Album', 'Track']);
    });

    it('puts the best text match first regardless of category', () => {
      const items = [
        item('User_3 Track', ContentCategory.TRACK),
        item('John', ContentCategory.IDENTITY),
        item('User_3', ContentCategory.IDENTITY)
      ];
      const sorted = RelevanceScoringService.sortByRelevance(items, 'User_3');
      // 'John' matches nothing and sorts last, where it used to sort second
      // purely because it was an IDENTITY.
      expect(sorted.map(i => i.title)).toEqual(['User_3', 'User_3 Track', 'John']);
    });

    it('is stable within equal scores', () => {
      const items = [
        item('Job', ContentCategory.EPISODE, { id: 'a' }),
        item('Job', ContentCategory.EPISODE, { id: 'b' }),
        item('Job', ContentCategory.EPISODE, { id: 'c' })
      ];
      expect(RelevanceScoringService.sortByRelevance(items, 'job').map(i => i.id))
        .toEqual(['a', 'b', 'c']);
    });

    it('does not mutate original array', () => {
      const items = [
        item('B', ContentCategory.TRACK),
        item('A', ContentCategory.IDENTITY)
      ];
      const original = [...items];
      RelevanceScoringService.sortByRelevance(items);
      expect(items).toEqual(original);
    });
  });
});
