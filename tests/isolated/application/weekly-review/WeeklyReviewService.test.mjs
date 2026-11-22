import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { WeeklyReviewService } from "../../../../__app_modules/personal/weekly-review/server/application/WeeklyReviewService.mjs";
import { FilesystemWeeklyReviewStore } from "../../../../__app_modules/personal/weekly-review/server/adapters/persistence/FilesystemWeeklyReviewStore.mjs";

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
      dataPath: path.join(os.tmpdir(),'test-data'),
      mediaPath: path.join(os.tmpdir(),'test-media'),
    }, {
      reviewStore: new FilesystemWeeklyReviewStore({
        householdDir: path.join(os.tmpdir(),'test-data','household'),
        mediaPath: path.join(os.tmpdir(),'test-media'),
        logger: mockLogger,
      }),
      runCommand: vi.fn(async () => ({})),
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
  describe('school work', () => {
    const work = (over = {}) => ({
      learnerId: 'kid1', learnerName: 'Kid', kind: 'activity', verb: 'completed',
      title: 'Maze', subtitle: null, at: '2026-03-24T15:00:00Z', studyDay: '2026-03-24',
      imageUrl: null, groupKey: 'activity:1', weight: 1, subject: null, ...over,
    });

    function buildService(schoolWork) {
      return new WeeklyReviewService({ dataPath: path.join(os.tmpdir(), 'test-data') }, {
        reviewStore: new FilesystemWeeklyReviewStore({
          householdDir: path.join(os.tmpdir(), 'test-data', 'household'),
          mediaPath: path.join(os.tmpdir(), 'test-media'),
          logger: mockLogger,
        }),
        runCommand: vi.fn(async () => ({})),
        immichAdapter: mockImmichAdapter,
        calendarData: mockCalendarData,
        schoolWork,
        logger: mockLogger,
      });
    }

    it('asks the adapter for the window with an exclusive end and puts curated work on days', async () => {
      const items = [
        work(),
        work({ groupKey: 'activity:2', title: 'Sudoku', at: '2026-03-24T16:00:00Z' }),
        work({ learnerId: 'kid2', learnerName: 'Two', groupKey: 'activity:3', studyDay: '2026-03-30', at: '2026-03-30T10:00:00Z' }),
        work({ groupKey: 'activity:4', studyDay: '2026-03-31', at: '2026-03-31T10:00:00Z' }),
      ];
      const schoolWork = { getWorkForDateRange: vi.fn().mockResolvedValue(items), getImage: vi.fn() };
      const result = await buildService(schoolWork).bootstrap('2026-03-23');

      expect(schoolWork.getWorkForDateRange).toHaveBeenCalledWith('2026-03-23', '2026-03-31');
      const mar24 = result.days.find(d => d.date === '2026-03-24');
      expect(mar24.school).toHaveLength(1);
      expect(mar24.schoolAll).toHaveLength(2);
      const mar30 = result.days.find(d => d.date === '2026-03-30');
      expect(mar30.school.map(i => i.learnerId)).toEqual(['kid2']);
      expect(result.days.find(d => d.date === '2026-03-23').school).toEqual([]);

      expect(mockLogger.info).toHaveBeenCalledWith('weekly-review.school.loaded', {
        week: '2026-03-23', learners: 2, items: 4, shown: 2, byKind: { activity: 4 },
      });
    });

    it('degrades to empty lists and warns when the adapter throws', async () => {
      const schoolWork = { getWorkForDateRange: vi.fn().mockRejectedValue(new Error('boom')), getImage: vi.fn() };
      const result = await buildService(schoolWork).bootstrap('2026-03-23');
      expect(result.days).toHaveLength(8);
      for (const day of result.days) {
        expect(day.school).toEqual([]);
        expect(day.schoolAll).toEqual([]);
      }
      expect(mockLogger.warn).toHaveBeenCalledWith('weekly-review.school.error', { error: 'boom' });
    });

    it('gives empty lists when no school adapter is wired', async () => {
      const result = await buildService(undefined).bootstrap('2026-03-23');
      for (const day of result.days) {
        expect(day.school).toEqual([]);
        expect(day.schoolAll).toEqual([]);
      }
    });

    it('getSchoolImage delegates to the adapter and is null without one', async () => {
      const img = { bytes: Buffer.from('x'), contentType: 'image/png' };
      const schoolWork = { getWorkForDateRange: vi.fn(), getImage: vi.fn().mockResolvedValue(img) };
      expect(await buildService(schoolWork).getSchoolImage('course:1')).toBe(img);
      expect(schoolWork.getImage).toHaveBeenCalledWith('course:1');
      expect(await buildService(undefined).getSchoolImage('course:1')).toBeNull();
    });
  });
});
