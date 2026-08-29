import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
import { createTTSRouter } from '#api/v1/routers/tts.mjs';
import createNotificationRouter from '#api/v1/routers/notification.mjs';
import { createJournalingRouter } from '#api/v1/routers/journaling.mjs';
import { createNutritionRouter } from '#api/v1/routers/nutrition.mjs';
import { createHealthMentionsRouter } from '#api/v1/routers/health-mentions.mjs';
import { createEventBusRouter } from '#api/v1/routers/admin/eventbus.mjs';
import { createAdminNotificationsRouter } from '#api/v1/routers/admin/notifications.mjs';
import { createAdminImagesRouter } from '#api/v1/routers/admin/images.mjs';
import { createAdminSchedulerRouter } from '#api/v1/routers/admin/scheduler.mjs';
import { nutribotReportImgHandler } from '#api/v1/handlers/nutribot/reportImg.mjs';
import { createMediaLessonRouter } from '#api/v1/routers/mediaLesson.mjs';
import { createCameraRouter } from '#api/v1/routers/camera.mjs';
import { createGratitudeRouter } from '#api/v1/routers/gratitude.mjs';
import { SpeechSynthesis } from '#apps/tts/SpeechSynthesis.mjs';
import { NotificationOperations } from '#apps/notification/NotificationOperations.mjs';
import { JournalOperations } from '#apps/journaling/JournalOperations.mjs';
import { NutritionOperations } from '#apps/nutrition/NutritionOperations.mjs';
import { HealthMentionSuggestions } from '#apps/health/HealthMentionSuggestions.mjs';
import { EventBusAdministration } from '#apps/admin/EventBusAdministration.mjs';
import { EventBusAdministrationGateway } from '#adapters/admin/EventBusAdministrationGateway.mjs';
import { AdminNotificationOperations } from '#apps/admin/AdminNotificationOperations.mjs';
import { AdminImageService } from '#apps/admin/AdminImageService.mjs';
import { SchedulerAdminService } from '#apps/admin/SchedulerAdminService.mjs';
import { DailyReportImage } from '#apps/nutribot/DailyReportImage.mjs';
import { LessonPositionReporter, CameraEvents, GratitudeEvents } from '#apps/events/RealtimePublications.mjs';
import { CameraService } from '#apps/camera/CameraService.mjs';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const mount = (path, router) => { const app = express(); app.use(express.json({ strict: false })); app.use(path, router); return app; };

describe('Wave 3 infrastructure seam HTTP contracts', () => {
  it('preserves TTS metadata and streaming headers/body', async () => {
    const gateway = {
      getStatus: () => ({ configured: true }),
      getAvailableVoices: () => ['alloy'],
      getAvailableModels: () => ['tts-1'],
      generateSpeech: vi.fn(async () => Readable.from([Buffer.from('audio')])),
    };
    const app = mount('/tts', createTTSRouter({ speechSynthesis: new SpeechSynthesis({ speechGateway: gateway }), logger }));
    expect((await request(app).get('/tts/voices')).body).toEqual({ voices: ['alloy'], models: ['tts-1'] });
    const audio = await request(app).post('/tts/generate').send({ text: 'hello', voice: 'alloy' }).buffer(true);
    expect(audio.status).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/mpeg');
    expect(audio.headers['content-disposition']).toBe('inline');
    expect(audio.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    expect(audio.body.toString()).toBe('audio');
  });

  it('preserves notification preference and pending envelopes', async () => {
    const preferences = { load: vi.fn(async () => ({ configuration: { quiet: true } })), save: vi.fn(async () => undefined) };
    const notifications = { getPending: () => ['n1'], dismiss: index => index === 0 };
    const operations = new NotificationOperations({ notifications, preferences });
    const app = mount('/notification', createNotificationRouter({ notificationOperations: operations }));
    expect((await request(app).get('/notification/preferences?username=alex')).body).toEqual({ quiet: true });
    expect((await request(app).get('/notification/pending')).body).toEqual({ pending: ['n1'] });
    expect((await request(app).post('/notification/dismiss/0')).body).toEqual({ dismissed: true });
  });

  it('preserves all notification fallbacks when the operation is absent', async () => {
    const app = mount('/notification', createNotificationRouter({}));
    expect((await request(app).get('/notification/preferences')).body).toEqual({});
    expect((await request(app).patch('/notification/preferences').send({ quiet: true })).body).toEqual({ ok: true });
    expect((await request(app).get('/notification/pending')).body).toEqual({ pending: [] });
    expect((await request(app).post('/notification/dismiss/0')).body).toEqual({ dismissed: false });
  });

  it('preserves journal overview and missing-household precedence', async () => {
    const entries = { listDates: vi.fn(async () => ['2026-08-28']), getAllTags: vi.fn(async () => ['family']) };
    const operations = new JournalOperations({ journal: {}, entries });
    const app = mount('/journaling', createJournalingRouter({ journalOperations: operations }));
    expect((await request(app).get('/journaling')).body).toEqual({ error: 'Missing household ID (hid)' });
    expect((await request(app).get('/journaling?hid=home')).body).toEqual({
      module: 'journaling', householdId: 'home', totalEntries: 1, mostRecentDate: '2026-08-28', tags: ['family'],
    });
  });

  it('preserves nutrition overview using the operation clock', async () => {
    const foodLogs = { getDailySummary: vi.fn(async () => ({ calories: 123 })) };
    const operations = new NutritionOperations({ foodLogs, logIndex: { listDates: async () => ['2026-08-27'] }, today: () => '2026-08-28' });
    const app = mount('/nutrition', createNutritionRouter({ nutritionOperations: operations }));
    expect((await request(app).get('/nutrition?hid=home')).body).toEqual({
      module: 'nutrition', householdId: 'home', datesWithLogs: 1, mostRecentDate: '2026-08-27', today: { calories: 123 },
    });
    expect(foodLogs.getDailySummary).toHaveBeenCalledWith('home', '2026-08-28');
  });

  it('preserves health mention ordering, flags, and unknown has behavior', async () => {
    const mentionSuggestions = new HealthMentionSuggestions({
      analytics: { listPeriods: async () => ({ periods: [{ slug: 'training', label: 'Training', source: 'user' }] }) },
      healthData: { loadWeightData: async () => ({ '2026-08-28': { weight: 170 } }), loadNutritionData: async () => ({}) },
      aggregateHealth: { getHealthForRange: async () => ({}) },
      now: () => new Date('2026-08-28T12:00:00Z'),
    });
    const app = mount('/mentions', createHealthMentionsRouter({ mentionSuggestions }));
    const periods = await request(app).get('/mentions/periods?user=alex&prefix=training');
    expect(periods.body.suggestions).toEqual([{ slug: 'training', label: 'Training', value: { named: 'training' }, group: 'period', subSource: 'user' }]);
    const days = await request(app).get('/mentions/recent-days?user=alex&days=2&has=unknown');
    expect(days.body.suggestions).toHaveLength(2);
    expect(days.body.suggestions[0].has).toEqual({ weight: true, nutrition: false, workout: false });
  });

  it('preserves eventbus unavailable, broadcast, and metrics envelopes', async () => {
    const unavailable = mount('/ws', createEventBusRouter({ eventBusAdministration: new EventBusAdministration(), logger }));
    expect((await request(unavailable).get('/ws/status')).status).toBe(503);
    const bus = { broadcast: vi.fn(), getMetrics: () => ({ clients: 2 }), isRunning: () => true, restart: vi.fn() };
    const app = mount('/ws', createEventBusRouter({
      eventBusAdministration: new EventBusAdministration({
        realtime: new EventBusAdministrationGateway({ eventBus: bus }),
      }),
      logger,
    }));
    const status = await request(app).get('/ws/status');
    expect(status.body).toMatchObject({ status: 'running', metrics: { clients: 2 } });
    const sent = await request(app).post('/ws/broadcast').send({ hello: 'world' });
    expect(sent.body).toMatchObject({ status: 'payload broadcasted', message: { hello: 'world' } });
    expect(bus.broadcast).toHaveBeenCalledWith('admin', expect.objectContaining({ hello: 'world', timestamp: expect.any(String) }));
  });

  it('preserves eventbus unavailable responses when the facade itself is absent', async () => {
    const app = mount('/ws', createEventBusRouter({ logger }));
    for (const response of [
      await request(app).get('/ws/status'),
      await request(app).post('/ws/restart'),
      await request(app).post('/ws/broadcast').send({ hello: 'world' }),
    ]) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'EventBus not configured', timestamp: expect.any(String) });
    }
  });

  it('preserves admin notification validation and ledger envelopes', async () => {
    const invalid = Object.assign(new Error('bad quiet hours'), { code: 'VALIDATION' });
    const configuration = { getConfig: () => ({ enabled: true }), updateConfig: vi.fn(() => { throw invalid; }) };
    const operations = new AdminNotificationOperations({ configuration, ledger: { recentEvents: limit => [{ limit }] } });
    const app = mount('/admin/notifications', createAdminNotificationsRouter({ adminNotificationOperations: operations }));
    expect((await request(app).put('/admin/notifications').send({})).status).toBe(400);
    expect((await request(app).get('/admin/notifications/ledger?limit=999')).body).toEqual({ events: [{ limit: 200 }] });
  });

  it('keeps admin image envelopes and size mapping in the HTTP adapter', async () => {
    const imageService = new AdminImageService({
      store: {
        list: () => [{ filename: 'a.jpg', path: '/media/img/lists/a.jpg', size: 1 }],
        save: () => ({ path: '/media/img/lists/id.png' }),
      },
      source: {
        download: async () => ({
          ok: true, contentType: 'image/png',
          buffer: Buffer.alloc(AdminImageService.MAX_FILE_SIZE + 1),
        }),
      },
      createId: () => 'id',
      logger,
    });
    const app = mount('/images', createAdminImagesRouter({ imageService, logger }));
    expect((await request(app).get('/images/list')).body).toEqual({
      images: [{ filename: 'a.jpg', path: '/media/img/lists/a.jpg', size: 1 }],
    });
    const oversized = await request(app).post('/images/upload-url').send({ url: 'https://example.test/a.png' });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({
      error: 'Image too large',
      maxSize: 5 * 1024 * 1024,
      maxSizeMB: 5,
    });
  });

  it('keeps scheduler resource shapes and unavailable mapping in the HTTP adapter', async () => {
    let jobs = [];
    const schedulerAdminService = new SchedulerAdminService({
      configStore: {
        readScheduledJobs: () => jobs,
        writeScheduledJobs: (next) => { jobs = next; },
        readSchedulerRuntime: () => ({}),
      },
      logger,
    });
    const app = mount('/scheduler', createAdminSchedulerRouter({ schedulerAdminService, logger }));
    const created = await request(app).post('/scheduler/jobs').send({ id: 'daily', name: 'Daily', schedule: '0 8 * * *' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ ok: true, job: { id: 'daily', name: 'Daily', schedule: '0 8 * * *' } });
    expect((await request(app).get('/scheduler/jobs')).body).toEqual([
      { id: 'daily', name: 'Daily', schedule: '0 8 * * *', runtime: null },
    ]);
    expect((await request(app).get('/scheduler/jobs/daily')).body).toEqual(
      { id: 'daily', name: 'Daily', schedule: '0 8 * * *', runtime: null },
    );
    const unavailable = await request(app).post('/scheduler/jobs/daily/run');
    expect(unavailable.status).toBe(501);
    expect(unavailable.body).toEqual({ error: 'Internal server error', code: 'NOT_IMPLEMENTED' });
  });

  it('preserves Nutribot PNG headers and report lookup input', async () => {
    const order = [];
    const reports = { execute: vi.fn(async () => { order.push('read'); return { items: [{ id: 1 }] }; }) };
    const renderer = { renderDailyReport: vi.fn(async () => { order.push('render'); return Buffer.from('png'); }) };
    const localLogger = { info: vi.fn((event) => order.push(event)), warn: vi.fn(), error: vi.fn() };
    const dailyReportImage = new DailyReportImage({ reports, renderer });
    const app = mount('/nutribot', express.Router().get('/report.png', nutribotReportImgHandler(dailyReportImage, { logger: localLogger })));
    const response = await request(app).get('/nutribot/report.png?chatId=alex&date=2026-08-28');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^image\/png/);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(reports.execute).toHaveBeenCalledWith({ userId: 'alex', date: '2026-08-28' });
    expect(order).toEqual(['reportImg.request', 'read', 'reportImg.data', 'render', 'reportImg.generated']);
  });

  it('preserves lesson playhead publication and acknowledgement', async () => {
    const publish = vi.fn();
    const positionReporter = new LessonPositionReporter({ publish, now: () => new Date('2026-08-28T12:00:00Z') });
    const router = createMediaLessonRouter({
      readLessonSnapshot: { execute: vi.fn() },
      recordCheckpointAnswer: { execute: vi.fn() },
      recordMediaCompletion: { execute: vi.fn() },
      positionReporter,
      topic: 'school-playback:custom',
      logger,
    });
    const response = await request(mount('/lesson', router)).post('/lesson/s1/position').send({ position: 12.5 });
    expect(response.body).toEqual({ ok: true, reported: true });
    expect(publish).toHaveBeenCalledWith('school-playback:custom', {
      source: 'lesson-screen', type: 'progress', sessionId: 's1', seconds: 12.5,
      percent: null, ts: '2026-08-28T12:00:00.000Z',
    });
  });

  it('preserves live-segment restart semantics across an inactive/expired stream', async () => {
    const streamAdapter = {
      ensureStream: vi.fn(), readPlaylist: vi.fn(),
      readSegment: vi.fn(async () => Buffer.from('segment')),
      touch: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), isActive: vi.fn(() => false),
    };
    const cameraService = new CameraService({
      gateway: {
        listCameras: vi.fn(), getCamera: vi.fn(), fetchSnapshot: vi.fn(),
        getStreamUrl: vi.fn(() => 'rtsp://camera/sub'),
      },
      streamAdapter,
      logger,
    });
    await expect(cameraService.getLiveSegment('front', 'segment0.ts')).resolves.toEqual(Buffer.from('segment'));
    expect(streamAdapter.readSegment).toHaveBeenCalledWith('front', 'rtsp://camera/sub', 'segment0.ts');
    expect(streamAdapter.isActive).not.toHaveBeenCalled();
  });

  it('preserves camera event publication and public acknowledgement', async () => {
    const publish = vi.fn();
    const router = createCameraRouter({
      cameraService: { hasCamera: () => true },
      cameraEvents: new CameraEvents({ publish }),
      logger,
    });
    const response = await request(mount('/camera', router)).post('/camera/front/event').send({ event: 'ring', topic: 'doorbell' });
    expect(response.body).toEqual({ broadcast: true, topic: 'doorbell', event: 'ring', cameraId: 'front' });
    expect(publish).toHaveBeenCalledWith({ topic: 'doorbell', event: 'ring', cameraId: 'front' });
  });

  it('preserves gratitude custom-item payload and response envelope', async () => {
    const publish = vi.fn();
    const gratitudeEvents = new GratitudeEvents({ publish, nowMs: () => 42, timestamp: () => 'stamp' });
    const router = createGratitudeRouter({
      gratitudeService: {},
      gratitudeHouseholdService: { getDefaultHouseholdId: () => 'home' },
      gratitudeEvents,
      cardPrintService: {},
      logger,
    });
    const response = await request(mount('/gratitude', router)).get('/gratitude/new?text=Thanks');
    expect(response.body).toEqual({
      status: 'success', message: 'Custom item sent to gratitude selector', item: { id: 42, text: 'Thanks' },
      payload: { topic: 'gratitude', item: { id: 42, text: 'Thanks' }, timestamp: 'stamp', type: 'gratitude_item', isCustom: true },
    });
    expect(publish).toHaveBeenCalledWith(response.body.payload);
  });
});
