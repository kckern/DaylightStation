import { CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';
import { FreshRSSSourceAdapter } from '#adapters/feed/sources/FreshRSSSourceAdapter.mjs';
import { HeadlineFeedAdapter } from '#adapters/feed/sources/HeadlineFeedAdapter.mjs';
import { GoogleNewsFeedAdapter } from '#adapters/feed/sources/GoogleNewsFeedAdapter.mjs';
import { RedditFeedAdapter } from '#adapters/feed/sources/RedditFeedAdapter.mjs';
import { ImmichFeedAdapter } from '#adapters/feed/sources/ImmichFeedAdapter.mjs';
import { KomgaFeedAdapter } from '#adapters/feed/sources/KomgaFeedAdapter.mjs';
import { ABSEbookFeedAdapter } from '#adapters/feed/sources/ABSEbookFeedAdapter.mjs';
import { PlexFeedAdapter } from '#adapters/feed/sources/PlexFeedAdapter.mjs';
import { YouTubeFeedAdapter } from '#adapters/feed/sources/YouTubeFeedAdapter.mjs';
import { JournalFeedAdapter } from '#adapters/feed/sources/JournalFeedAdapter.mjs';
import { GoodreadsFeedAdapter } from '#adapters/feed/sources/GoodreadsFeedAdapter.mjs';
import { TodoistFeedAdapter } from '#adapters/feed/sources/TodoistFeedAdapter.mjs';
import { WeatherFeedAdapter } from '#adapters/feed/sources/WeatherFeedAdapter.mjs';
import { HealthFeedAdapter } from '#adapters/feed/sources/HealthFeedAdapter.mjs';
import { StravaFeedAdapter } from '#adapters/feed/sources/StravaFeedAdapter.mjs';
import { GratitudeFeedAdapter } from '#adapters/feed/sources/GratitudeFeedAdapter.mjs';
import { EntropyFeedAdapter } from '#adapters/feed/sources/EntropyFeedAdapter.mjs';
import { ReadalongFeedAdapter } from '#adapters/feed/sources/ReadalongFeedAdapter.mjs';

const EXPECTED = [
  [FreshRSSSourceAdapter,   'freshrss',    [CONTENT_TYPES.FEEDS]],
  [HeadlineFeedAdapter,     'headlines',   [CONTENT_TYPES.NEWS]],
  [GoogleNewsFeedAdapter,   'googlenews',  [CONTENT_TYPES.NEWS]],
  [RedditFeedAdapter,       'reddit',      [CONTENT_TYPES.SOCIAL]],
  [ImmichFeedAdapter,       'immich',      [CONTENT_TYPES.PHOTOS]],
  [KomgaFeedAdapter,        'komga',       [CONTENT_TYPES.COMICS]],
  [ABSEbookFeedAdapter,     'abs-ebooks',  [CONTENT_TYPES.EBOOKS]],
  [PlexFeedAdapter,         'plex',        [CONTENT_TYPES.VIDEO]],
  [YouTubeFeedAdapter,      'youtube',     [CONTENT_TYPES.VIDEO]],
  [JournalFeedAdapter,      'journal',     [CONTENT_TYPES.JOURNAL]],
  [GoodreadsFeedAdapter,    'goodreads',   [CONTENT_TYPES.BOOK_REVIEWS]],
  [TodoistFeedAdapter,      'tasks',       [CONTENT_TYPES.TASKS]],
  [WeatherFeedAdapter,      'weather',     [CONTENT_TYPES.WEATHER]],
  [HealthFeedAdapter,       'health',      [CONTENT_TYPES.HEALTH]],
  [StravaFeedAdapter,       'strava',      [CONTENT_TYPES.FITNESS]],
  [GratitudeFeedAdapter,    'gratitude',   [CONTENT_TYPES.GRATITUDE]],
  [EntropyFeedAdapter,      'entropy',     [CONTENT_TYPES.ENTROPY]],
  [ReadalongFeedAdapter,    'readalong',   [CONTENT_TYPES.SCRIPTURE]],
];

describe('Adapter provides declarations', () => {
  test.each(EXPECTED)('%s declares sourceType=%s and provides=%j',
    (AdapterClass, expectedType, expectedProvides) => {
      const adapter = Object.create(AdapterClass.prototype);
      expect(adapter.provides).toEqual(expectedProvides);
    }
  );

  test('every provides value is a valid CONTENT_TYPES value', () => {
    const validValues = new Set(Object.values(CONTENT_TYPES));
    for (const [AdapterClass] of EXPECTED) {
      const adapter = Object.create(AdapterClass.prototype);
      for (const ct of adapter.provides) {
        expect(validValues.has(ct)).toBe(true);
      }
    }
  });
});
