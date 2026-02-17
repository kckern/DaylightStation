// tests/isolated/adapter/feed/RedditFeedAdapter.test.mjs
import { jest } from '@jest/globals';
import { RedditFeedAdapter } from '#adapters/feed/sources/RedditFeedAdapter.mjs';

describe('RedditFeedAdapter — preview dimensions', () => {
  let adapter;
  const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  const mockDataService = {
    user: { read: jest.fn().mockReturnValue(null) },
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    mockLogger.warn.mockClear();
    adapter = new RedditFeedAdapter({ dataService: mockDataService, logger: mockLogger });
  });

  afterEach(() => {
    global.fetch = undefined;
  });

  function mockRedditResponse(posts) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: {
          children: posts.map(p => ({ kind: 't3', data: { stickied: false, ...p } })),
        },
      }),
    });
  }

  test('includes imageWidth and imageHeight from preview source', async () => {
    mockRedditResponse([
      {
        id: 'abc123',
        subreddit: 'pics',
        title: 'A beautiful sunset',
        selftext: '',
        url: 'https://i.redd.it/sunset.jpg',
        post_hint: 'image',
        permalink: '/r/pics/comments/abc123/a_beautiful_sunset/',
        created_utc: 1700000000,
        score: 500,
        num_comments: 42,
        preview: {
          images: [
            {
              source: {
                url: 'https://preview.redd.it/sunset.jpg?auto=webp&amp;s=abc',
                width: 1920,
                height: 1080,
              },
            },
          ],
        },
      },
    ]);

    const query = { type: 'reddit', tier: 'wire', params: { subreddits: ['pics'] } };
    const items = await adapter.fetchItems(query, 'testuser');

    expect(items).toHaveLength(1);
    expect(items[0].meta.imageWidth).toBe(1920);
    expect(items[0].meta.imageHeight).toBe(1080);
  });

  test('sets imageWidth/imageHeight to undefined when no preview', async () => {
    mockRedditResponse([
      {
        id: 'def456',
        subreddit: 'news',
        title: 'Breaking news story',
        selftext: 'Some text content here',
        url: 'https://example.com/article',
        permalink: '/r/news/comments/def456/breaking_news_story/',
        created_utc: 1700000000,
        score: 1200,
        num_comments: 300,
        // No preview field
      },
    ]);

    const query = { type: 'reddit', tier: 'wire', params: { subreddits: ['news'] } };
    const items = await adapter.fetchItems(query, 'testuser');

    expect(items).toHaveLength(1);
    expect(items[0].meta.imageWidth).toBeUndefined();
    expect(items[0].meta.imageHeight).toBeUndefined();
  });
});
