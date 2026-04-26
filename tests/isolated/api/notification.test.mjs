import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createNotificationRouter from '#api/v1/routers/notification.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';

describe('Notification API Router', () => {
  let app;
  let mockNotificationService;
  let mockPreferenceStore;

  const prefConfig = {
    ceremony: { normal: ['telegram'], high: ['telegram', 'app'] },
    system: { normal: ['app'] },
  };

  beforeEach(() => {
    mockNotificationService = {
      getPending: vi.fn().mockReturnValue([
        { intent: { title: 'Test', body: 'Body' }, timestamp: '2025-06-01T10:00:00Z' },
      ]),
      dismiss: vi.fn().mockReturnValue(true),
    };

    mockPreferenceStore = {
      load: vi.fn().mockResolvedValue(new NotificationPreference(prefConfig)),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const router = createNotificationRouter({
      notificationService: mockNotificationService,
      preferenceStore: mockPreferenceStore,
    });

    app = express();
    app.use(express.json());
    app.use('/notification', router);
  });

  describe('GET /notification/preferences', () => {
    it('returns user preferences', async () => {
      const res = await request(app).get('/notification/preferences?username=kckern');
      expect(res.status).toBe(200);
      expect(res.body.ceremony).toBeTruthy();
      expect(res.body.ceremony.normal).toEqual(['telegram']);
      expect(mockPreferenceStore.load).toHaveBeenCalledWith('kckern');
    });
  });

  describe('PATCH /notification/preferences', () => {
    it('updates preferences', async () => {
      const newPrefs = { ceremony: { normal: ['app'] } };
      const res = await request(app)
        .patch('/notification/preferences?username=kckern')
        .send(newPrefs);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockPreferenceStore.save).toHaveBeenCalledWith('kckern', newPrefs);
    });
  });

  describe('GET /notification/pending', () => {
    it('returns pending notifications', async () => {
      const res = await request(app).get('/notification/pending');
      expect(res.status).toBe(200);
      expect(res.body.pending).toHaveLength(1);
      expect(res.body.pending[0].intent.title).toBe('Test');
    });
  });

  describe('POST /notification/dismiss/:index', () => {
    it('dismisses a notification', async () => {
      const res = await request(app).post('/notification/dismiss/0');
      expect(res.status).toBe(200);
      expect(res.body.dismissed).toBe(true);
      expect(mockNotificationService.dismiss).toHaveBeenCalledWith(0);
    });
  });
});
