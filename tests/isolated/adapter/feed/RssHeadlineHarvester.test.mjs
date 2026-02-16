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
    expect(result.error).toBe('Network error');
  });
});
