import { CONTENT_TYPES } from "../../../../modules/feed/server/application/ports/IFeedSourceAdapter.mjs";
import { FreshRSSSourceAdapter } from "../../../../modules/feed/server/adapters/sources/FreshRSSSourceAdapter.mjs";
import { HeadlineFeedAdapter } from "../../../../modules/feed/server/adapters/sources/HeadlineFeedAdapter.mjs";
import { GoogleNewsFeedAdapter } from "../../../../modules/feed/server/adapters/sources/GoogleNewsFeedAdapter.mjs";
import { RedditFeedAdapter } from "../../../../modules/feed/server/adapters/sources/RedditFeedAdapter.mjs";
import { ImmichFeedAdapter } from "../../../../modules/feed/server/adapters/sources/ImmichFeedAdapter.mjs";
import { KomgaFeedAdapter } from "../../../../modules/feed/server/adapters/sources/KomgaFeedAdapter.mjs";
import { ABSEbookFeedAdapter } from "../../../../modules/feed/server/adapters/sources/ABSEbookFeedAdapter.mjs";
import { PlexFeedAdapter } from "../../../../modules/feed/server/adapters/sources/PlexFeedAdapter.mjs";
import { YouTubeFeedAdapter } from "../../../../modules/feed/server/adapters/sources/YouTubeFeedAdapter.mjs";
import { JournalFeedAdapter } from "../../../../modules/feed/server/adapters/sources/JournalFeedAdapter.mjs";
import { GoodreadsFeedAdapter } from "../../../../modules/feed/server/adapters/sources/GoodreadsFeedAdapter.mjs";
import { TodoistFeedAdapter } from "../../../../modules/feed/server/adapters/sources/TodoistFeedAdapter.mjs";
import { WeatherFeedAdapter } from "../../../../modules/feed/server/adapters/sources/WeatherFeedAdapter.mjs";
import { HealthFeedAdapter } from "../../../../modules/feed/server/adapters/sources/HealthFeedAdapter.mjs";
import { StravaFeedAdapter } from "../../../../modules/feed/server/adapters/sources/StravaFeedAdapter.mjs";
import { GratitudeFeedAdapter } from "../../../../modules/feed/server/adapters/sources/GratitudeFeedAdapter.mjs";
import { EntropyFeedAdapter } from "../../../../modules/feed/server/adapters/sources/EntropyFeedAdapter.mjs";
import { ReadalongFeedAdapter } from "../../../../modules/feed/server/adapters/sources/ReadalongFeedAdapter.mjs";

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
