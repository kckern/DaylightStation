import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createNotificationsRouter } from './notifications.mjs';

function app(result = { ok: true }) {
  const respond = { execute: vi.fn().mockResolvedValue(result) };
  const a = express();
  a.use(createNotificationsRouter({ respondToNotificationAction: respond }));
  return { a, respond };
}
const body = { notificationId: 'n1', actionId: 'DONOW_APPROVE_7', username: 'u' };

describe('POST /actions', () => {
  it('200 when the handler took it', async () => {
    const { a, respond } = app();
    const res = await request(a).post('/actions').send({ ...body, reply: 'ok' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(respond.execute).toHaveBeenCalledWith({ notificationId: 'n1', actionId: 'DONOW_APPROVE_7', reply: 'ok', username: 'u' });
  });
  it('400 when an id is missing', async () => {
    const res = await request(app().a).post('/actions').send({ actionId: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });
  it('400 for a reply over 1000 characters', async () => {
    expect((await request(app().a).post('/actions').send({ ...body, reply: 'x'.repeat(1001) })).status).toBe(400);
  });
  it('400 for a reply with control characters', async () => {
    expect((await request(app().a).post('/actions').send({ ...body, reply: 'a\u0007b' })).status).toBe(400);
  });
  it('accepts a reply with a newline', async () => {
    expect((await request(app().a).post('/actions').send({ ...body, reply: 'line one\nline two' })).status).toBe(200);
  });
  it('404 ACTION_UNKNOWN when nobody claims the action', async () => {
    const res = await request(app({ ok: false, code: 'ACTION_UNKNOWN' }).a).post('/actions').send(body);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ACTION_UNKNOWN');
  });
  it('409 with the handler code when it refuses', async () => {
    const res = await request(app({ ok: false, code: 'ALREADY_DECIDED' }).a).post('/actions').send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_DECIDED');
  });
  it('500 never leaks: a throwing handler is a 502 with a code', async () => {
    const respond = { execute: vi.fn().mockRejectedValue(new Error('boom')) };
    const a = express(); a.use(createNotificationsRouter({ respondToNotificationAction: respond }));
    const res = await request(a).post('/actions').send(body);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('ACTION_FAILED');
  });
});
