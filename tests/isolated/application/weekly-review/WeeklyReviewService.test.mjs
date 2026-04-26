import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeeklyReviewService } from '../../../../backend/src/3_applications/weekly-review/WeeklyReviewService.mjs';

describe('WeeklyReviewService', () => {
  let service;
  let mockImmichAdapter;
  let mockCalendarData;
  let mockTranscriptionService;
  let mockLogger;

  const PHOTO_DAYS = [
    { date: '2026-03-23', photos: [{ id: 'p1' }], photoCount: 1, sessions: [] },
    { date: '2026-03-24', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-25', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-26', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-27', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-28', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-29', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-30', photos: [], photoCount: 0, sessions: [] },
  ];

  beforeEach(() => {
    mockImmichAdapter = {
      getPhotosForDateRange: vi.fn().mockResolvedValue(PHOTO_DAYS),
    };
    mockCalendarData = {
      getEventsForDateRange: vi.fn().mockResolvedValue([
        { date: '2026-03-23', events: [{ summary: 'Soccer', time: '10:00', calendar: 'family' }] },
      ]),
    };
    mockTranscriptionService = {
      transcribe: vi.fn().mockResolvedValue({
        transcriptRaw: 'raw text',
        transcriptClean: 'Clean text.',
      }),
    };
    mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    service = new WeeklyReviewService({
      dataPath: '/tmp/test-data',
      mediaPath: '/tmp/test-media',
    }, {
      immichAdapter: mockImmichAdapter,
      calendarData: mockCalendarData,
      transcriptionService: mockTranscriptionService,
      logger: mockLogger,
    });
  });

  describe('bootstrap', () => {
    it('returns aggregated 8-day structure', async () => {
      const result = await service.bootstrap('2026-03-23');
      expect(result.week).toBe('2026-03-23');
      expect(result.days.length).toBe(8);
      expect(mockImmichAdapter.getPhotosForDateRange).toHaveBeenCalledWith('2026-03-23', '2026-03-30');
      expect(mockCalendarData.getEventsForDateRange).toHaveBeenCalledWith('2026-03-23', '2026-03-30');
    });

    it('defaults to current week if no week param', async () => {
      const result = await service.bootstrap();
      expect(result.week).toBeDefined();
      expect(result.days.length).toBe(8);
    });

    it('includes recording status', async () => {
      const result = await service.bootstrap('2026-03-23');
      expect(result).toHaveProperty('recording');
    });
  });

  describe('saveRecording', () => {
    it('calls transcription service with audio data', async () => {
      const result = await service.saveRecording({
        audioBase64: 'dGVzdA==',
        mimeType: 'audio/webm',
        week: '2026-03-23',
        duration: 120,
      });

      expect(mockTranscriptionService.transcribe).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.transcript).toBeDefined();
    });

    it('rejects if audioBase64 is missing', async () => {
      await expect(service.saveRecording({ week: '2026-03-23' }))
        .rejects.toThrow('audioBase64 required');
    });
  });
});
