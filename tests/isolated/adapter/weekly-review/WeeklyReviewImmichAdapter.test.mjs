// tests/isolated/adapter/weekly-review/WeeklyReviewImmichAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { WeeklyReviewImmichAdapter } from '../../../../backend/src/1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs';

describe('WeeklyReviewImmichAdapter', () => {
  let adapter;
  let mockClient;
  let mockLogger;

  const MOCK_ASSETS = [
    {
      id: 'asset-1',
      type: 'IMAGE',
      localDateTime: '2026-03-23T14:00:00.000Z',
      people: [{ name: 'Felix' }],
    },
    {
      id: 'asset-2',
      type: 'IMAGE',
      localDateTime: '2026-03-23T14:30:00.000Z',
      people: [{ name: 'Felix' }, { name: 'Alan' }],
    },
    {
      id: 'asset-3',
      type: 'IMAGE',
      localDateTime: '2026-03-23T19:00:00.000Z',
      people: [],
    },
    {
      id: 'asset-4',
      type: 'VIDEO',
      localDateTime: '2026-03-23T14:15:00.000Z',
      people: [],
    },
    {
      id: 'asset-5',
      type: 'IMAGE',
      localDateTime: '2026-03-25T10:00:00.000Z',
      people: [{ name: 'Stranger' }],
    },
    {
      id: 'asset-6',
      type: 'IMAGE',
      localDateTime: '2026-03-25T10:30:00.000Z',
      people: [{ name: 'Felix' }],
    },
  ];

  beforeEach(() => {
    mockClient = {
      searchMetadata: jest.fn().mockResolvedValue({ items: MOCK_ASSETS, total: MOCK_ASSETS.length }),
    };
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    adapter = new WeeklyReviewImmichAdapter({
      priorityPeople: ['Felix', 'Alan', 'Soren', 'Milo'],
      proxyPath: '/proxy/immich',
      sessionGapMinutes: 120,
    }, {
      client: mockClient,
      logger: mockLogger,
    });
  });

  describe('constructor', () => {
    it('throws if client is not provided', () => {
      expect(() => new WeeklyReviewImmichAdapter({}, {})).toThrow('client');
    });
  });

  describe('getPhotosForDateRange', () => {
    it('queries Immich with correct date range', async () => {
      await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');

      expect(mockClient.searchMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          takenAfter: '2026-03-23T00:00:00.000Z',
          takenBefore: '2026-03-31T00:00:00.000Z',
          type: 'IMAGE',
        })
      );
    });

    it('filters out non-IMAGE assets', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const allIds = result.flatMap(day => day.photos.map(p => p.id));
      expect(allIds).not.toContain('asset-4');
    });

    it('groups photos by date', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      const mar25 = result.find(d => d.date === '2026-03-25');
      expect(mar23.photos.length).toBe(3);
      expect(mar25.photos.length).toBe(2);
    });

    it('sorts face-tagged photos first, multi-face before single', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      expect(mar23.photos[0].id).toBe('asset-2');
      expect(mar23.photos[1].id).toBe('asset-1');
      expect(mar23.photos[2].id).toBe('asset-3');
    });

    it('only counts configured priority people as face matches', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar25 = result.find(d => d.date === '2026-03-25');
      expect(mar25.photos[0].id).toBe('asset-6');
      expect(mar25.photos[1].id).toBe('asset-5');
    });

    it('groups photos into sessions by time proximity', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      expect(mar23.sessions.length).toBe(2);
      expect(mar23.sessions[0].count).toBe(2);
      expect(mar23.sessions[1].count).toBe(1);
    });

    it('marks hero photo for days with 3+ photos', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      const mar25 = result.find(d => d.date === '2026-03-25');
      expect(mar23.photos.some(p => p.isHero)).toBe(true);
      expect(mar25.photos.some(p => p.isHero)).toBe(false);
    });

    it('includes proxy URLs for thumbnail and original', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const photo = result.find(d => d.date === '2026-03-23').photos[0];
      expect(photo.thumbnail).toBe('/proxy/immich/assets/asset-2/thumbnail');
      expect(photo.original).toBe('/proxy/immich/assets/asset-2/original');
    });
  });
});
