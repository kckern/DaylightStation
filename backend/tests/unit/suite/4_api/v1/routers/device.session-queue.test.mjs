/**
 * POST /api/v1/device/:id/session/queue/:op — router-level tests.
 *
 * Verifies per-op body validation, envelope construction, and that the
 * ack payload (including queue: QueueSnapshot) is passed through intact.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { ERROR_CODES } from '#shared-contracts/media/errors.mjs';
import { QUEUE_OPS } from '#shared-contracts/media/commands.mjs';

function makeDeviceService() {
  return {
    get: vi.fn(() => null),
    listDevices: vi.fn(() => []),
  };
}

function findHandler(router, path, method = 'post') {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} route not mounted`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    ended: false,
    status: vi.fn(function status(code) { this.statusCode = code; return this; }),
    json: vi.fn(function json(body) { this.body = body; return this; }),
    end: vi.fn(function end() { this.ended = true; return this; }),
  };
  return res;
}

describe('POST /device/:deviceId/session/queue/:op', () => {
  let deviceService, sessionControlService, logger, router, handler;

  beforeEach(() => {
    deviceService = makeDeviceService();
    sessionControlService = {
      getSnapshot: vi.fn(() => null),
      sendCommand: vi.fn(async () => ({
        ok: true, commandId: 'c1', appliedAt: '2026-04-17T00:00:00.000Z',
      })),
      waitForStateChange: vi.fn(),
    };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    router = createDeviceRouter({ deviceService, sessionControlService, logger });
    handler = findHandler(router, '/:deviceId/session/queue/:op', 'post');
  });

  async function run(op, body, deviceId = 'tv-1') {
    const req = { params: { deviceId, op }, body };
    const res = makeRes();
    await handler(req, res, vi.fn());
    return res;
  }

  // ---------------------------------------------------------------------------
  // Happy paths — all 8 ops
  // ---------------------------------------------------------------------------

  it('returns 200 for play-now with contentId and clearRest', async () => {
    const res = await run('play-now', {
      contentId: 'plex/1', clearRest: true, commandId: 'c-pn',
    });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope).toMatchObject({
      command: 'queue',
      targetDevice: 'tv-1',
      commandId: 'c-pn',
      params: { op: 'play-now', contentId: 'plex/1', clearRest: true },
    });
  });

  it('returns 200 for play-next', async () => {
    const res = await run('play-next', { contentId: 'plex/2', commandId: 'c-pnxt' });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ op: 'play-next', contentId: 'plex/2' });
  });

  it('returns 200 for add-up-next', async () => {
    const res = await run('add-up-next', { contentId: 'plex/3', commandId: 'c-aun' });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ op: 'add-up-next', contentId: 'plex/3' });
  });

  it('returns 200 for add', async () => {
    const res = await run('add', { contentId: 'plex/4', commandId: 'c-add' });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ op: 'add', contentId: 'plex/4' });
  });

  it('returns 200 for reorder with from/to', async () => {
    const res = await run('reorder', { from: 'q1', to: 'q5', commandId: 'c-ro' });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ op: 'reorder', from: 'q1', to: 'q5' });
  });

  it('returns 200 for reorder with items array', async () => {
    const res = await run('reorder', {
      items: ['q1', 'q2', 'q3'], commandId: 'c-ro-items',
    });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({
      op: 'reorder', items: ['q1', 'q2', 'q3'],
    });
  });

  it('returns 200 for remove', async () => {
    const res = await run('remove', { queueItemId: 'q5', commandId: 'c-rm' });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ op: 'remove', queueItemId: 'q5' });
  });

  it('returns 200 for jump', async () => {
    const res = await run('jump', { queueItemId: 'q7', commandId: 'c-jp' });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ op: 'jump', queueItemId: 'q7' });
  });

  it('returns 200 for clear', async () => {
    const res = await run('clear', { commandId: 'c-clr' });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ op: 'clear' });
  });

  it('passes through queue snapshot when ack includes one', async () => {
    const queue = {
      items: [{ queueItemId: 'q1', contentId: 'plex/1' }],
      currentIndex: 0,
      upNextCount: 0,
    };
    sessionControlService.sendCommand.mockResolvedValue({
      ok: true, commandId: 'c1', appliedAt: 't', queue,
    });
    const res = await run('clear', { commandId: 'c-with-queue' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, queue });
  });

  // ---------------------------------------------------------------------------
  // :op validation
  // ---------------------------------------------------------------------------

  it('returns 400 when :op is not a known queue op', async () => {
    const res = await run('sabotage', { commandId: 'c1' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toMatch(/op/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // commandId validation
  // ---------------------------------------------------------------------------

  it('returns 400 when commandId is missing (play-now)', async () => {
    const res = await run('play-now', { contentId: 'plex/1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/commandId/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  it('returns 400 when commandId is missing (clear)', async () => {
    const res = await run('clear', {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/commandId/i);
  });

  // ---------------------------------------------------------------------------
  // Per-op field validation
  // ---------------------------------------------------------------------------

  it('returns 400 when play-now is missing contentId', async () => {
    const res = await run('play-now', { commandId: 'c1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/contentId/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  it('returns 400 when remove is missing queueItemId', async () => {
    const res = await run('remove', { commandId: 'c1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/queueItemId/i);
  });

  it('returns 400 when jump is missing queueItemId', async () => {
    const res = await run('jump', { commandId: 'c1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/queueItemId/i);
  });

  it('returns 400 when reorder has neither from/to nor items', async () => {
    const res = await run('reorder', { commandId: 'c1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/reorder|from|items/i);
  });

  it('returns 400 when reorder has an empty items array', async () => {
    const res = await run('reorder', { items: [], commandId: 'c1' });
    expect(res.statusCode).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Service result mapping
  // ---------------------------------------------------------------------------

  it('returns 409 with lastKnown when device is offline', async () => {
    const lastKnown = { sessionId: 's', state: 'paused' };
    sessionControlService.sendCommand.mockResolvedValue({
      ok: false, code: ERROR_CODES.DEVICE_OFFLINE, error: 'Device offline', lastKnown,
    });
    const res = await run('clear', { commandId: 'c1' });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      code: ERROR_CODES.DEVICE_OFFLINE,
      lastKnown,
    });
  });

  it('returns 502 when device refuses', async () => {
    sessionControlService.sendCommand.mockResolvedValue({
      ok: false, code: ERROR_CODES.DEVICE_REFUSED, error: 'Timeout',
    });
    const res = await run('clear', { commandId: 'c1' });

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ ok: false, code: ERROR_CODES.DEVICE_REFUSED });
  });

  it('returns 501 when sessionControlService is not injected', async () => {
    const r = createDeviceRouter({ deviceService, sessionControlService: undefined, logger });
    const h = findHandler(r, '/:deviceId/session/queue/:op', 'post');
    const req = { params: { deviceId: 'tv-1', op: 'clear' }, body: { commandId: 'c1' } };
    const res = makeRes();
    await h(req, res, vi.fn());

    expect(res.statusCode).toBe(501);
  });

  it('covers all QUEUE_OPS values', () => {
    expect([...QUEUE_OPS].sort()).toEqual(
      ['add', 'add-up-next', 'clear', 'jump', 'play-next', 'play-now', 'remove', 'reorder']
    );
  });
});
