import { it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDeviceRouter } from '../../../backend/src/4_api/v1/routers/device.mjs';
import { DeviceContentDispatchService } from '../../../backend/src/3_applications/devices/services/DeviceContentDispatchService.mjs';

it('validates and forwards the exact item operation and exposes cold cancellation before claim', async () => {
  const queue = vi.fn(async () => ({ ok: true }));
  const dispatchService = new DeviceContentDispatchService({ wakeAndLoad: { execute: async () => ({ ok: true }) }, logger: {} });
  const app = express();
  app.use(express.json(), createDeviceRouter({ sessionService: { configured: () => true, queue }, dispatchService }));
  const body = { commandId: 'cmd', operationId: 'op', tappedAt: Date.now(), kind: 'playNext', item: { contentId: 'plex:a' }, clearRest: false };
  expect((await request(app).post('/tv/session/queue/item-action').send(body)).status).toBe(200);
  expect(queue).toHaveBeenCalledWith('tv', 'cmd', { op: 'item-action', ...body, commandId: undefined });
  expect((await request(app).post('/tv/session/queue/item-action').send({ ...body, kind: 'wrong' })).status).toBe(400);
  await dispatchService.load('tv', { itemAction: JSON.stringify(body) });
  expect((await request(app).post('/tv/session/item-action/op/cancel').send({})).body).toMatchObject({ ok: true, pending: true });
  expect((await request(app).post('/tv/session/item-action/op/claim').send({})).body).toMatchObject({ ok: false, code: 'ITEM_ACTION_CANCELLED' });
});
