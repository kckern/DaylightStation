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

    function buildService(schoolWork, extraDeps = {}) {
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
        ...extraDeps,
      });
    }

    it('asks the adapter for the window with an exclusive end and puts curated work on days', async () => {
      const items = [
        work(),
        work({ groupKey: 'activity:2', title: 'Sudoku', at: '2026-03-24T16:00:00Z' }),
        work({ learnerId: 'kid2', learnerName: 'Two', groupKey: 'activity:3', studyDay: '2026-03-30', at: '2026-03-30T10:00:00Z' }),
        work({ groupKey: 'activity:4', studyDay: '2026-03-31', at: '2026-03-31T10:00:00Z' }),
        work({ learnerId: 'kid3', groupKey: 'activity:5', studyDay: '2026-03-31', at: '2026-03-31T11:00:00Z' }),
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
        week: '2026-03-23', learners: 2, items: 5, shown: 2, byKind: { activity: 5 },
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

    it('gives up on a school source that never answers and warns with the timeout', async () => {
      const schoolWork = { getWorkForDateRange: vi.fn(() => new Promise(() => {})), getImage: vi.fn() };
      const result = await buildService(schoolWork, { schoolTimeoutMs: 20 }).bootstrap('2026-03-23');
      expect(result.days).toHaveLength(8);
      for (const day of result.days) expect(day.school).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith('weekly-review.school.timeout', { week: '2026-03-23', ms: 20 });
    });

    it('gives empty lists when no school adapter is wired', async () => {
      const result = await buildService(undefined).bootstrap('2026-03-23');
      for (const day of result.days) {
        expect(day.school).toEqual([]);
        expect(day.schoolAll).toEqual([]);
      }
    });

    describe('school showcase', () => {
      const weekItems = () => [
        work({ subtitle: 'Maze · level 1', imageUrl: '/img/a1' }),
        work({ groupKey: 'activity:2', subtitle: 'Sudoku', imageUrl: '/img/a2', at: '2026-03-25T10:00:00Z', studyDay: '2026-03-25' }),
        work({ learnerId: 'kid0', learnerName: 'Ada', kind: 'book', verb: 'finished', title: 'Holes', groupKey: 'book:r1:finished' }),
        work({ learnerId: 'kid9', learnerName: 'Late', groupKey: 'activity:9', studyDay: '2026-03-31', at: '2026-03-31T10:00:00Z' }),
      ];

      it('bootstrap carries a plain showcase per child, without items or hash', async () => {
        const schoolWork = { getWorkForDateRange: vi.fn().mockResolvedValue(weekItems()), getImage: vi.fn() };
        const result = await buildService(schoolWork).bootstrap('2026-03-23');
        expect(schoolWork.getWorkForDateRange).toHaveBeenCalledTimes(1);
        expect(result.schoolShowcase).toEqual([
          { learnerId: 'kid0', learnerName: 'Ada', images: [], bullets: ['Finished Holes'], source: 'plain' },
          { learnerId: 'kid1', learnerName: 'Kid', images: ['/img/a1', '/img/a2'], bullets: ['2 printed pages: a maze and a sudoku'], source: 'plain' },
        ]);
      });

      it('bootstrap has an empty showcase when school fails or is absent', async () => {
        const failing = { getWorkForDateRange: vi.fn().mockRejectedValue(new Error('boom')), getImage: vi.fn() };
        expect((await buildService(failing).bootstrap('2026-03-23')).schoolShowcase).toEqual([]);
        expect((await buildService(undefined).bootstrap('2026-03-23')).schoolShowcase).toEqual([]);
      });

      it('getSchoolShowcase runs the showcase service over the window and trims the result', async () => {
        const schoolWork = { getWorkForDateRange: vi.fn().mockResolvedValue(weekItems()), getImage: vi.fn() };
        const schoolShowcase = {
          execute: vi.fn(async (_week, showcases) => showcases.map(s => ({ ...s, bullets: [`AI for ${s.learnerName}`], source: 'ai' }))),
        };
        const result = await buildService(schoolWork, { schoolShowcase }).getSchoolShowcase('2026-03-23');
        expect(schoolWork.getWorkForDateRange).toHaveBeenCalledWith('2026-03-23', '2026-03-31');
        const [week, showcases] = schoolShowcase.execute.mock.calls[0];
        expect(week).toBe('2026-03-23');
        expect(showcases.map(s => s.itemsHash)).toEqual(['book:r1:finished:1', 'activity:1:1|activity:2:1']);
        expect(result).toEqual([
          { learnerId: 'kid0', learnerName: 'Ada', bullets: ['AI for Ada'], images: [], source: 'ai' },
          { learnerId: 'kid1', learnerName: 'Kid', bullets: ['AI for Kid'], images: ['/img/a1', '/img/a2'], source: 'ai' },
        ]);
      });

      it('getSchoolShowcase is plain without a showcase service and empty on a school timeout', async () => {
        const schoolWork = { getWorkForDateRange: vi.fn().mockResolvedValue(weekItems()), getImage: vi.fn() };
        const plain = await buildService(schoolWork).getSchoolShowcase('2026-03-23');
        expect(plain.map(s => s.source)).toEqual(['plain', 'plain']);

        const schoolShowcase = { execute: vi.fn() };
        const hanging = { getWorkForDateRange: vi.fn(() => new Promise(() => {})), getImage: vi.fn() };
        expect(await buildService(hanging, { schoolTimeoutMs: 20, schoolShowcase }).getSchoolShowcase('2026-03-23')).toEqual([]);
        expect(schoolShowcase.execute).not.toHaveBeenCalled();
      });

      it('getSchoolShowcase rejects a malformed week', async () => {
        await expect(buildService(undefined).getSchoolShowcase('../etc')).rejects.toThrow(/invalid week/);
      });

      describe('wins', () => {
        const winsOf = (silver, rings = 0) => ({ week: { silver, gems: 0, rings }, allTime: { silver: silver * 10, gems: 1, rings: rings * 10 } });
        const roster = () => [{ id: 'kid1', name: 'Kid' }, { id: 'kid5', name: 'Bea' }, { id: 'kid6', name: 'Zed' }];
        const winsService = (byId) => ({ execute: vi.fn(async ({ learnerIds }) => Object.fromEntries(learnerIds.filter(id => byId[id]).map(id => [id, byId[id]]))) });

        it('bootstrap attaches wins to each showcase and adds a child with week wins but no work', async () => {
          const schoolWork = { getWorkForDateRange: vi.fn().mockResolvedValue(weekItems()), getImage: vi.fn() };
          const learnerWins = winsService({ kid0: winsOf(5), kid1: winsOf(0), kid5: winsOf(0, 3), kid6: winsOf(0) });
          const result = await buildService(schoolWork, { learnerWins, learners: roster }).bootstrap('2026-03-23');

          const [args] = learnerWins.execute.mock.calls.at(-1);
          expect(args.dates).toHaveLength(8);
          expect(args.windowStartMs).toBe(Date.parse('2026-03-23T04:00:00Z'));
          expect(args.windowEndMs).toBe(Date.parse('2026-03-31T04:00:00Z'));
          const asked = learnerWins.execute.mock.calls.flatMap(([a]) => a.learnerIds);
          expect(new Set(asked)).toEqual(new Set(['kid0', 'kid1', 'kid5', 'kid6']));

          expect(result.schoolShowcase).toEqual([
            { learnerId: 'kid0', learnerName: 'Ada', images: [], bullets: ['Finished Holes'], source: 'plain', wins: winsOf(5) },
            { learnerId: 'kid5', learnerName: 'Bea', images: [], bullets: [], source: 'plain', wins: winsOf(0, 3) },
            { learnerId: 'kid1', learnerName: 'Kid', images: ['/img/a1', '/img/a2'], bullets: ['2 printed pages: a maze and a sudoku'], source: 'plain', wins: winsOf(0) },
          ]);
        });

        it('getSchoolShowcase carries the same wins and the wins-only child, and does not draft for them', async () => {
          const schoolWork = { getWorkForDateRange: vi.fn().mockResolvedValue(weekItems()), getImage: vi.fn() };
          const schoolShowcase = { execute: vi.fn(async (_w, list) => list.map(s => ({ ...s, source: 'ai' }))) };
          const learnerWins = winsService({ kid1: winsOf(2), kid5: winsOf(1) });
          const result = await buildService(schoolWork, { learnerWins, learners: roster, schoolShowcase }).getSchoolShowcase('2026-03-23');
          expect(schoolShowcase.execute.mock.calls[0][1].map(s => s.learnerId)).toEqual(['kid0', 'kid1']);
          expect(result.map(s => [s.learnerId, s.source, s.wins ?? 'none'])).toEqual([
            ['kid0', 'ai', 'none'],
            ['kid5', 'plain', winsOf(1)],
            ['kid1', 'ai', winsOf(2)],
          ]);
        });

        it('a child with wins but no work is shown when school is absent, named from the roster', async () => {
          const learnerWins = winsService({ kid6: winsOf(4) });
          const result = await buildService(undefined, { learnerWins, learners: roster }).bootstrap('2026-03-23');
          expect(result.schoolShowcase).toEqual([
            { learnerId: 'kid6', learnerName: 'Zed', bullets: [], images: [], source: 'plain', wins: winsOf(4) },
          ]);
        });

        it('omits wins and warns when wins never answer, without failing the review', async () => {
          const schoolWork = { getWorkForDateRange: vi.fn().mockResolvedValue(weekItems()), getImage: vi.fn() };
          const learnerWins = { execute: vi.fn(() => new Promise(() => {})) };
          const result = await buildService(schoolWork, { learnerWins, learners: roster, winsTimeoutMs: 20 }).bootstrap('2026-03-23');
          expect(result.schoolShowcase.map(s => s.learnerId)).toEqual(['kid0', 'kid1']);
          for (const s of result.schoolShowcase) expect(s).not.toHaveProperty('wins');
          expect(mockLogger.warn).toHaveBeenCalledWith('weekly-review.wins.timeout', { week: '2026-03-23', ms: 20 });
        });

        it('omits wins when the wins service or the roster throws', async () => {
          const schoolWork = { getWorkForDateRange: vi.fn().mockResolvedValue(weekItems()), getImage: vi.fn() };
          const learnerWins = { execute: vi.fn().mockRejectedValue(new Error('boom')) };
          const result = await buildService(schoolWork, { learnerWins, learners: roster }).bootstrap('2026-03-23');
          for (const s of result.schoolShowcase) expect(s).not.toHaveProperty('wins');
          expect(mockLogger.warn).toHaveBeenCalledWith('weekly-review.wins.error', { week: '2026-03-23', error: 'boom' });

          const okWins = winsService({ kid0: winsOf(1) });
          const badRoster = () => { throw new Error('no roster'); };
          const withBadRoster = await buildService(schoolWork, { learnerWins: okWins, learners: badRoster }).bootstrap('2026-03-23');
          expect(withBadRoster.schoolShowcase.map(s => [s.learnerId, s.wins?.week.silver ?? null])).toEqual([['kid0', 1], ['kid1', null]]);
          expect(mockLogger.warn).toHaveBeenCalledWith('weekly-review.wins.roster-failed', { error: 'no roster' });
        });
      });
    });

    it('getSchoolImage delegates to the adapter and is null without one', async () => {
      const img = { bytes: Buffer.from('x'), contentType: 'image/png' };
      const schoolWork = { getWorkForDateRange: vi.fn(), getImage: vi.fn().mockResolvedValue(img) };
      expect(await buildService(schoolWork).getSchoolImage('course:1')).toBe(img);
      expect(schoolWork.getImage).toHaveBeenCalledWith('course:1');
      expect(await buildService(undefined).getSchoolImage('course:1')).toBeNull();
    });

    it('getSchoolImage refuses answers without bytes or with a non-image type', async () => {
      for (const answer of [
        null,
        { contentType: 'image/png' },
        { bytes: Buffer.from('x'), contentType: 'text/html' },
        { bytes: Buffer.from('x') },
      ]) {
        const schoolWork = { getWorkForDateRange: vi.fn(), getImage: vi.fn().mockResolvedValue(answer) };
        expect(await buildService(schoolWork).getSchoolImage('activity:1')).toBeNull();
      }
    });
  });
});
