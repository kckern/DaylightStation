// tests/isolated/adapter/weekly-review/WeeklyReviewImmichAdapter.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      people: [{ name: 'User_2' }],
    },
    {
      id: 'asset-2',
      type: 'IMAGE',
      localDateTime: '2026-03-23T14:30:00.000Z',
      people: [{ name: 'User_2' }, { name: 'User_4' }],
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
      people: [{ name: 'User_2' }],
    },
  ];

  beforeEach(() => {
    mockClient = {
      searchMetadata: vi.fn().mockResolvedValue({ items: MOCK_ASSETS, total: MOCK_ASSETS.length }),
    };
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    adapter = new WeeklyReviewImmichAdapter({
      priorityPeople: ['User_2', 'User_4', 'User_5', 'User_3'],
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

      // Production no longer narrows by `type: 'IMAGE'` server-side; both
      // images and videos are pulled and surfaced together (videos carry
      // `type: 'video'` on the response items).
      expect(mockClient.searchMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          takenAfter: '2026-03-23T00:00:00.000Z',
          takenBefore: '2026-03-31T00:00:00.000Z',
        })
      );
    });

    it('includes VIDEO assets alongside IMAGE assets', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const allIds = result.flatMap(day => day.photos.map(p => p.id));
      // asset-4 is a VIDEO and must now appear in the day's photos list.
      expect(allIds).toContain('asset-4');
    });

    it('groups photos+videos by date', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      const mar25 = result.find(d => d.date === '2026-03-25');
      // mar23 now includes the VIDEO asset (asset-4) → 4 entries
      expect(mar23.photos.length).toBe(4);
      expect(mar25.photos.length).toBe(2);
    });

    // Photo order is chronological so browsing a day moves forward in time;
    // face priority now decides only which photo the collage features as hero
    // (the grid pulls it forward itself — see PhotoWall).
    it('orders a day chronologically, earliest first', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      expect(mar23.photos.map(p => p.id)).toEqual(['asset-1', 'asset-4', 'asset-2', 'asset-3']);
    });

    it('picks the photo with the most priority people as hero', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      // asset-2 has two priority people; asset-1 has one; asset-3/4 have none.
      expect(mar23.photos.find(p => p.isHero).id).toBe('asset-2');
    });

    it('only counts configured priority people as face matches', async () => {
      // A day of three, where the earliest photo's only face is a stranger.
      // Hero selection must skip it in favour of the photo with a real match.
      mockClient.searchMetadata.mockResolvedValueOnce({
        items: [
          { id: 'stranger', type: 'IMAGE', localDateTime: '2026-03-25T10:00:00.000Z', people: [{ name: 'Stranger' }] },
          { id: 'known', type: 'IMAGE', localDateTime: '2026-03-25T10:30:00.000Z', people: [{ name: 'User_2' }] },
          { id: 'faceless', type: 'IMAGE', localDateTime: '2026-03-25T11:00:00.000Z', people: [] }
        ],
        total: 3
      });

      const result = await adapter.getPhotosForDateRange('2026-03-25', '2026-03-25');
      const mar25 = result.find(d => d.date === '2026-03-25');

      expect(mar25.photos.find(p => p.isHero).id).toBe('known');
    });

    it('groups photos into sessions by time proximity', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      // Day has 4 entries: 14:00 (image), 14:15 (video), 14:30 (image),
      // 19:00 (image). The 14:* trio falls in one session (within 120-min
      // gap), 19:00 in a second session. Total = 2 sessions, [3, 1].
      expect(mar23.sessions.length).toBe(2);
      expect(mar23.sessions[0].count).toBe(3);
      expect(mar23.sessions[1].count).toBe(1);
    });

    it('marks hero photo for days with 3+ photos', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      const mar25 = result.find(d => d.date === '2026-03-25');
      expect(mar23.photos.some(p => p.isHero)).toBe(true);
      expect(mar25.photos.some(p => p.isHero)).toBe(false);
    });

    it('includes proxy URLs, serving images from the preview rendition', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      const image = mar23.photos.find(p => p.id === 'asset-1');

      expect(image.thumbnail).toBe('/proxy/immich/assets/asset-1/thumbnail');
      // Images use ?size=preview: /original is usually HEIC, which only Safari
      // decodes, so it rendered blank on our surfaces.
      expect(image.original).toBe('/proxy/immich/assets/asset-1/thumbnail?size=preview');
    });

    it('serves videos from the original stream, not the preview rendition', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const video = result.find(d => d.date === '2026-03-23').photos.find(p => p.id === 'asset-4');

      expect(video.type).toBe('video');
      expect(video.original).toBe('/proxy/immich/assets/asset-4/original');
    });
  });
});
