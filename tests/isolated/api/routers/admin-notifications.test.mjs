import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminNotificationsRouter } from '#api/v1/routers/admin/notifications.mjs';

function app({ config = { quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { default: 60 } }, events = [] } = {}) {
  let stored = config;
  const notificationConfigService = {
    getConfig: () => stored,
    updateConfig: (d) => {
      if (!/^\d{2}:\d{2}$/.test(d.quiet_hours?.start || '')) { const e = new Error('bad time'); e.code = 'VALIDATION'; throw e; }
      stored = d; return stored;
    },
  };
  const notificationLedgerStore = { recentEvents: (n) => events.slice(0, n) };
  const a = express();
  a.use(express.json());
  a.use('/api/v1/admin/notifications', createAdminNotificationsRouter({ notificationConfigService, notificationLedgerStore }));
  return a;
}

describe('admin notifications router', () => {
  it('GET returns config', async () => {
    const res = await request(app()).get('/api/v1/admin/notifications');
    expect(res.status).toBe(200);
    expect(res.body.cooldowns.default).toBe(60);
  });
  it('PUT persists valid config', async () => {
    const res = await request(app()).put('/api/v1/admin/notifications').send({ quiet_hours: { enabled: false, start: '22:00', end: '06:00' }, cooldowns: { default: 30 } });
    expect(res.status).toBe(200);
    expect(res.body.quiet_hours.start).toBe('22:00');
  });
  it('PUT 400s on validation error', async () => {
    const res = await request(app()).put('/api/v1/admin/notifications').send({ quiet_hours: { start: '9am' }, cooldowns: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/time/i);
  });
  it('GET /ledger returns events', async () => {
    const res = await request(app({ events: [{ at: 2, suppressed: true, reason: 'cooldown' }, { at: 1, delivered: true }] })).get('/api/v1/admin/notifications/ledger?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(2);
  });
});
