// tests/isolated/adapter/feed/RedditFeedAdapter.test.mjs
import { vi } from 'vitest';
import { RedditFeedAdapter } from '#adapters/feed/sources/RedditFeedAdapter.mjs';

describe('RedditFeedAdapter — preview dimensions', () => {
  let adapter;
  const mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const mockDataService = {
    user: { read: vi.fn().mockReturnValue(null) },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockLogger.warn.mockClear();
    adapter = new RedditFeedAdapter({ dataService: mockDataService, logger: mockLogger });
  });

  afterEach(() => {
    global.fetch = undefined;
  });

  function mockRedditResponse(posts) {
    global.fetch = vi.fn().mockResolvedValue({
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

  test('includes thumbnail from preview resolutions for progressive loading', async () => {
    mockRedditResponse([
      {
        id: 'thumb1',
        subreddit: 'pics',
        title: 'Photo with resolutions',
        selftext: '',
        url: 'https://i.redd.it/photo.jpg',
        post_hint: 'image',
        permalink: '/r/pics/comments/thumb1/photo/',
        created_utc: 1700000000,
        score: 100,
        num_comments: 5,
        preview: {
          images: [{
            source: { url: 'https://preview.redd.it/photo.jpg?width=1920', width: 1920, height: 1080 },
            resolutions: [
              { url: 'https://preview.redd.it/photo.jpg?width=108', width: 108, height: 60 },
              { url: 'https://preview.redd.it/photo.jpg?width=216', width: 216, height: 121 },
              { url: 'https://preview.redd.it/photo.jpg?width=320', width: 320, height: 180 },
              { url: 'https://preview.redd.it/photo.jpg?width=640', width: 640, height: 360 },
            ],
          }],
        },
      },
    ]);

    const query = { type: 'reddit', tier: 'wire', params: { subreddits: ['pics'] } };
    const items = await adapter.fetchItems(query, 'testuser');

    expect(items[0].thumbnail).toContain('width=320');
  });

  test('gallery images include thumbnails from preview ladder', async () => {
    mockRedditResponse([
      {
        id: 'gal_thumb',
        subreddit: 'pics',
        title: 'Gallery with thumbnails',
        selftext: '',
        url: 'https://www.reddit.com/gallery/gal_thumb',
        is_gallery: true,
        permalink: '/r/pics/comments/gal_thumb/gallery/',
        created_utc: 1700000000,
        score: 50,
        num_comments: 2,
        gallery_data: { items: [{ media_id: 'a' }, { media_id: 'b' }] },
        media_metadata: {
          a: {
            status: 'valid', m: 'image/jpg',
            s: { u: 'https://preview.redd.it/a.jpg?width=2880', x: 2880, y: 2880 },
            p: [
              { u: 'https://preview.redd.it/a.jpg?width=108', x: 108, y: 108 },
              { u: 'https://preview.redd.it/a.jpg?width=320', x: 320, y: 320 },
              { u: 'https://preview.redd.it/a.jpg?width=640', x: 640, y: 640 },
            ],
          },
          b: {
            status: 'valid', m: 'image/jpg',
            s: { u: 'https://preview.redd.it/b.jpg?width=1500', x: 1500, y: 1000 },
            p: [
              { u: 'https://preview.redd.it/b.jpg?width=108', x: 108, y: 72 },
              { u: 'https://preview.redd.it/b.jpg?width=320', x: 320, y: 213 },
            ],
          },
        },
      },
    ]);

    const query = { type: 'reddit', tier: 'wire', params: { subreddits: ['pics'] } };
    const items = await adapter.fetchItems(query, 'testuser');

    expect(items[0].thumbnail).toContain('width=320');
    expect(items[0].meta.galleryImages[0].thumbnail).toContain('width=320');
    expect(items[0].meta.galleryImages[1].thumbnail).toContain('width=320');
  });

  test('extracts gallery images from is_gallery posts', async () => {
    mockRedditResponse([
      {
        id: 'gal789',
        subreddit: 'pics',
        title: 'Gallery post with multiple images',
        selftext: '',
        url: 'https://www.reddit.com/gallery/gal789',
        is_gallery: true,
        permalink: '/r/pics/comments/gal789/gallery_post/',
        created_utc: 1700000000,
        score: 300,
        num_comments: 20,
        gallery_data: {
          items: [
            { media_id: 'img1' },
            { media_id: 'img2' },
            { media_id: 'img3' },
          ],
        },
        media_metadata: {
          img1: { status: 'valid', m: 'image/jpg', s: { u: 'https://preview.redd.it/img1.jpg?width=1500&amp;format=pjpg', x: 1500, y: 1000 } },
          img2: { status: 'valid', m: 'image/jpg', s: { u: 'https://preview.redd.it/img2.jpg?width=2880&amp;format=pjpg', x: 2880, y: 2880 } },
          img3: { status: 'valid', m: 'image/png', s: { u: 'https://preview.redd.it/img3.png?width=800&amp;format=png', x: 800, y: 600 } },
        },
      },
    ]);

    const query = { type: 'reddit', tier: 'wire', params: { subreddits: ['pics'] } };
    const items = await adapter.fetchItems(query, 'testuser');

    expect(items).toHaveLength(1);
    const item = items[0];

    // First gallery image used as hero
    expect(item.image).toContain('img1.jpg');

    // Dimensions from first gallery image
    expect(item.meta.imageWidth).toBe(1500);
    expect(item.meta.imageHeight).toBe(1000);

    // All gallery images in meta
    expect(item.meta.galleryImages).toHaveLength(3);
    expect(item.meta.galleryImages[0].url).toContain('img1.jpg');
    expect(item.meta.galleryImages[0].width).toBe(1500);
    expect(item.meta.galleryImages[1].url).toContain('img2.jpg');
    expect(item.meta.galleryImages[2].url).toContain('img3.png');
  });

  test('skips invalid gallery items in media_metadata', async () => {
    mockRedditResponse([
      {
        id: 'gal_partial',
        subreddit: 'pics',
        title: 'Gallery with some invalid items',
        selftext: '',
        url: 'https://www.reddit.com/gallery/gal_partial',
        is_gallery: true,
        permalink: '/r/pics/comments/gal_partial/gallery/',
        created_utc: 1700000000,
        score: 100,
        num_comments: 5,
        gallery_data: {
          items: [
            { media_id: 'good1' },
            { media_id: 'bad1' },
            { media_id: 'good2' },
          ],
        },
        media_metadata: {
          good1: { status: 'valid', m: 'image/jpg', s: { u: 'https://preview.redd.it/good1.jpg?width=800', x: 800, y: 600 } },
          bad1: { status: 'failed', m: 'image/jpg' },
          good2: { status: 'valid', m: 'image/jpg', s: { u: 'https://preview.redd.it/good2.jpg?width=1024', x: 1024, y: 768 } },
        },
      },
    ]);

    const query = { type: 'reddit', tier: 'wire', params: { subreddits: ['pics'] } };
    const items = await adapter.fetchItems(query, 'testuser');

    expect(items[0].meta.galleryImages).toHaveLength(2);
    expect(items[0].meta.galleryImages[0].url).toContain('good1.jpg');
    expect(items[0].meta.galleryImages[1].url).toContain('good2.jpg');
  });

  test('single gallery image does not set galleryImages', async () => {
    mockRedditResponse([
      {
        id: 'gal_single',
        subreddit: 'pics',
        title: 'Gallery with one image',
        selftext: '',
        url: 'https://www.reddit.com/gallery/gal_single',
        is_gallery: true,
        permalink: '/r/pics/comments/gal_single/gallery/',
        created_utc: 1700000000,
        score: 50,
        num_comments: 2,
        gallery_data: { items: [{ media_id: 'only1' }] },
        media_metadata: {
          only1: { status: 'valid', m: 'image/jpg', s: { u: 'https://preview.redd.it/only1.jpg?width=640', x: 640, y: 480 } },
        },
      },
    ]);

    const query = { type: 'reddit', tier: 'wire', params: { subreddits: ['pics'] } };
    const items = await adapter.fetchItems(query, 'testuser');

    // Single image — no galleryImages array (treated as regular card)
    expect(items[0].image).toContain('only1.jpg');
    expect(items[0].meta.galleryImages).toBeUndefined();
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
