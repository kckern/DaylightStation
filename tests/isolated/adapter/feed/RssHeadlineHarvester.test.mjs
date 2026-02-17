// tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs
import { jest } from '@jest/globals';
import { RssHeadlineHarvester } from '#adapters/feed/RssHeadlineHarvester.mjs';

describe('RssHeadlineHarvester', () => {
  let harvester;
  let mockRssParser;

  const fakeFeed = {
    title: 'CNN Top Stories',
    items: [
      {
        title: 'Breaking news headline',
        contentSnippet: 'Officials say the situation has developed significantly over the past 24 hours with new developments emerging from multiple sources.',
        link: 'https://cnn.com/article/1',
        pubDate: 'Sat, 15 Feb 2026 09:00:00 GMT',
      },
      {
        title: 'Another story',
        content: '<p>Some HTML content here that should be stripped for description purposes.</p>',
        link: 'https://cnn.com/article/2',
        pubDate: 'Sat, 15 Feb 2026 08:00:00 GMT',
      },
      {
        title: 'No description story',
        link: 'https://cnn.com/article/3',
        pubDate: 'Sat, 15 Feb 2026 07:00:00 GMT',
      },
    ],
  };

  beforeEach(() => {
    mockRssParser = {
      parseURL: jest.fn().mockResolvedValue(fakeFeed),
    };
    harvester = new RssHeadlineHarvester({ rssParser: mockRssParser });
  });

  test('fetches and parses feed', async () => {
    const result = await harvester.harvest({
      id: 'cnn',
      label: 'CNN',
      url: 'http://rss.cnn.com/rss/cnn_topstories.rss',
    });
    expect(mockRssParser.parseURL).toHaveBeenCalledWith('http://rss.cnn.com/rss/cnn_topstories.rss');
    expect(result.source).toBe('cnn');
    expect(result.label).toBe('CNN');
    expect(result.items).toHaveLength(3);
  });

  test('extracts desc from contentSnippet', async () => {
    const result = await harvester.harvest({ id: 'cnn', label: 'CNN', url: 'http://example.com/rss' });
    expect(result.items[0].desc).toBeDefined();
    expect(result.items[0].desc.length).toBeLessThanOrEqual(123); // 120 + '...'
  });

  test('strips HTML from content for desc', async () => {
    const result = await harvester.harvest({ id: 'cnn', label: 'CNN', url: 'http://example.com/rss' });
    expect(result.items[1].desc).not.toContain('<p>');
    expect(result.items[1].desc).not.toContain('</p>');
  });

  test('desc is null when no content available', async () => {
    const result = await harvester.harvest({ id: 'cnn', label: 'CNN', url: 'http://example.com/rss' });
    expect(result.items[2].desc).toBeNull();
  });

  test('includes lastHarvest timestamp', async () => {
    const result = await harvester.harvest({ id: 'cnn', label: 'CNN', url: 'http://example.com/rss' });
    expect(result.lastHarvest).toBeDefined();
    expect(new Date(result.lastHarvest)).toBeInstanceOf(Date);
  });

  test('returns empty items on parse failure', async () => {
    mockRssParser.parseURL.mockRejectedValue(new Error('Network error'));
    const result = await harvester.harvest({ id: 'cnn', label: 'CNN', url: 'http://bad-url.com/rss' });
    expect(result.items).toHaveLength(0);
    expect(result.error).toBe('http://bad-url.com/rss: Network error');
  });

  test('includes imageWidth and imageHeight from media:content attributes', async () => {
    mockRssParser.parseURL.mockResolvedValue({
      title: 'Feed with image dims',
      items: [
        {
          title: 'Story with image dimensions',
          link: 'https://example.com/article/1',
          pubDate: 'Sat, 15 Feb 2026 09:00:00 GMT',
          'media:content': [
            { '$': { url: 'https://example.com/image.jpg', type: 'image/jpeg', width: '1200', height: '630' } },
          ],
        },
      ],
    });
    const result = await harvester.harvest({ id: 'test', label: 'Test', url: 'http://example.com/rss' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].image).toBe('https://example.com/image.jpg');
    expect(result.items[0].imageWidth).toBe(1200);
    expect(result.items[0].imageHeight).toBe(630);
  });

  test('harvested items have deterministic id from link', async () => {
    const result = await harvester.harvest({
      id: 'cnn',
      label: 'CNN',
      url: 'http://example.com/rss',
    });
    for (const item of result.items) {
      expect(item.id).toBeDefined();
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBe(10);
    }
  });

  test('same link produces same id across harvests', async () => {
    const result1 = await harvester.harvest({ id: 'cnn', label: 'CNN', url: 'http://example.com/rss' });
    const result2 = await harvester.harvest({ id: 'cnn', label: 'CNN', url: 'http://example.com/rss' });
    expect(result1.items[0].id).toBe(result2.items[0].id);
  });

  test('omits imageWidth/imageHeight when media:content lacks dimensions', async () => {
    mockRssParser.parseURL.mockResolvedValue({
      title: 'Feed without image dims',
      items: [
        {
          title: 'Story without image dimensions',
          link: 'https://example.com/article/2',
          pubDate: 'Sat, 15 Feb 2026 08:00:00 GMT',
          'media:content': [
            { '$': { url: 'https://example.com/photo.jpg', type: 'image/png' } },
          ],
        },
      ],
    });
    const result = await harvester.harvest({ id: 'test', label: 'Test', url: 'http://example.com/rss' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].image).toBe('https://example.com/photo.jpg');
    expect(result.items[0].imageWidth).toBeUndefined();
    expect(result.items[0].imageHeight).toBeUndefined();
  });
});
