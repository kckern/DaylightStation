/**
 * tests/api/v1/routers/playbackHub.test.mjs
 *
 * Exercises createPlaybackHubRouter end-to-end via Supertest.
 * Uses a FakePlaybackHubContainer that stubs each use case's execute().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createPlaybackHubRouter, statusForError } from '../../../../backend/src/4_api/v1/routers/playbackHub.mjs';
import { ValidationError } from '../../../../backend/src/2_domains/core/errors/ValidationError.mjs';
import { DomainInvariantError } from '../../../../backend/src/2_domains/core/errors/DomainInvariantError.mjs';
import { EntityNotFoundError } from '../../../../backend/src/2_domains/core/errors/EntityNotFoundError.mjs';
import { InfrastructureError } from '../../../../backend/src/0_system/utils/errors/InfrastructureError.mjs';

/**
 * Minimal stub container — each property is an object with an `execute()` fn
 * so the router-under-test can do `container.getHubStatus.execute(...)`.
 */
function makeFakeContainer(overrides = {}) {
  return {
    getHubStatus: { execute: overrides.getHubStatus ?? vi.fn() },
    getHubConfig: { execute: overrides.getHubConfig ?? vi.fn() },
    sendHubCommand: { execute: overrides.sendHubCommand ?? vi.fn() },
    updateDeviceConfig: { execute: overrides.updateDeviceConfig ?? vi.fn() },
    saveScheduledFire: { execute: overrides.saveScheduledFire ?? vi.fn() },
    deleteScheduledFire: { execute: overrides.deleteScheduledFire ?? vi.fn() },
  };
}

/**
 * Build an Express app mounting the router under /api/v1/playback-hub.
 */
function buildApp(container) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/playback-hub', createPlaybackHubRouter({
    container,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  }));
  return app;
}

// ---------------------------------------------------------------------------
// Constructor guard
// ---------------------------------------------------------------------------

describe('createPlaybackHubRouter (construction)', () => {
  it('throws when container is missing', () => {
    expect(() => createPlaybackHubRouter({})).toThrow(/container required/);
  });
});

// ---------------------------------------------------------------------------
// statusForError mapping (unit)
// ---------------------------------------------------------------------------

describe('statusForError mapping', () => {
  it('ValidationError → 400', () => {
    expect(statusForError(new ValidationError('bad'))).toBe(400);
  });
  it('DomainInvariantError → 422', () => {
    expect(statusForError(new DomainInvariantError('rule'))).toBe(422);
  });
  it('EntityNotFoundError → 404', () => {
    expect(statusForError(new EntityNotFoundError('HubDevice', 'pink'))).toBe(404);
  });
  it('InfrastructureError → 502', () => {
    expect(statusForError(new InfrastructureError('hub down'))).toBe(502);
  });
  it('plain Error → 500', () => {
    expect(statusForError(new Error('boom'))).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /status — happy path
// ---------------------------------------------------------------------------

describe('GET /api/v1/playback-hub/status', () => {
  it('200 — returns slots + fetchedAt', async () => {
    const fakeSlots = [
      {
        position: 1, color: 'red', bt_connected: true, paused: false,
        now_playing: null, volume: 50, playlist_pos: 0, playlist_count: 0,
        armed_source: null,
      },
      {
        position: 2, color: 'yellow', bt_connected: false, paused: true,
        now_playing: null, volume: 0, playlist_pos: 0, playlist_count: 0,
        armed_source: null,
      },
    ];
    const fetchedAt = new Date('2026-05-27T17:00:00Z');
    const container = makeFakeContainer({
      getHubStatus: vi.fn().mockResolvedValue({ slots: fakeSlots, fetchedAt }),
    });

    const res = await request(buildApp(container)).get('/api/v1/playback-hub/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      slots: fakeSlots,
      fetchedAt: '2026-05-27T17:00:00.000Z',
    });
    expect(container.getHubStatus.execute).toHaveBeenCalledOnce();
  });

  it('502 — InfrastructureError from gateway', async () => {
    const container = makeFakeContainer({
      getHubStatus: vi.fn().mockRejectedValue(new InfrastructureError('hub unreachable', { code: 'HUB_TIMEOUT' })),
    });
    const res = await request(buildApp(container)).get('/api/v1/playback-hub/status');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ ok: false, error: 'hub unreachable', code: 'HUB_TIMEOUT' });
  });
});

// ---------------------------------------------------------------------------
// GET /config
// ---------------------------------------------------------------------------

describe('GET /api/v1/playback-hub/config', () => {
  it('200 — returns hubConfig.toYaml()', async () => {
    const yamlShape = { devices: [{ slot: 1, color: 'red', mac: 'aa:bb', class: 'private' }] };
    const fakeConfig = { toYaml: vi.fn().mockReturnValue(yamlShape) };
    const container = makeFakeContainer({
      getHubConfig: vi.fn().mockResolvedValue(fakeConfig),
    });

    const res = await request(buildApp(container)).get('/api/v1/playback-hub/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, config: yamlShape });
    expect(fakeConfig.toYaml).toHaveBeenCalledOnce();
  });

  it('500 — yaml-IO InfrastructureError surfaces as 502 (any cause maps to 502)', async () => {
    const container = makeFakeContainer({
      getHubConfig: vi.fn().mockRejectedValue(new InfrastructureError('yaml read failed')),
    });
    const res = await request(buildApp(container)).get('/api/v1/playback-hub/config');
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /command — partial-failure HTTP coding
// ---------------------------------------------------------------------------

describe('POST /api/v1/playback-hub/command', () => {
  it('200 — applied:[red], skipped:[] (all applied)', async () => {
    const container = makeFakeContainer({
      sendHubCommand: vi.fn().mockResolvedValue({
        applied: ['red'],
        skipped: [],
      }),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .send({ action: 'play', target: 'red', contentId: 'plex:670208' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, applied: ['red'], skipped: [] });
    expect(container.sendHubCommand.execute).toHaveBeenCalledWith({
      action: 'play',
      target: 'red',
      contentId: 'plex:670208',
      volume: null,
      durationMin: null,
      resumePrevious: false,
    });
  });

  it('200 — applied:[], skipped:[contention] (non-terminal, user-recoverable)', async () => {
    const container = makeFakeContainer({
      sendHubCommand: vi.fn().mockResolvedValue({
        applied: [],
        skipped: [{ color: 'red', reason: 'contention' }],
      }),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .send({ action: 'play', target: 'red' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      applied: [],
      skipped: [{ color: 'red', reason: 'contention' }],
    });
  });

  it('502 — applied:[], skipped:[unreachable] (all terminal)', async () => {
    const container = makeFakeContainer({
      sendHubCommand: vi.fn().mockResolvedValue({
        applied: [],
        skipped: [{ color: 'red', reason: 'unreachable' }],
      }),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .send({ action: 'play', target: 'red' });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      ok: true,
      applied: [],
      skipped: [{ color: 'red', reason: 'unreachable' }],
    });
  });

  it('502 — applied:[], skipped:[not-found] (all terminal)', async () => {
    const container = makeFakeContainer({
      sendHubCommand: vi.fn().mockResolvedValue({
        applied: [],
        skipped: [{ color: 'red', reason: 'not-found' }],
      }),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .send({ action: 'play', target: 'red' });
    expect(res.status).toBe(502);
  });

  it('200 — applied:[red], skipped:[yellow:contention] (partial success)', async () => {
    const container = makeFakeContainer({
      sendHubCommand: vi.fn().mockResolvedValue({
        applied: ['red'],
        skipped: [{ color: 'yellow', reason: 'contention' }],
      }),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .send({ action: 'play', target: 'red,yellow' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      applied: ['red'],
      skipped: [{ color: 'yellow', reason: 'contention' }],
    });
  });

  it('200 — applied:[red], skipped:[yellow:unreachable] (one succeeded; not 502)', async () => {
    const container = makeFakeContainer({
      sendHubCommand: vi.fn().mockResolvedValue({
        applied: ['red'],
        skipped: [{ color: 'yellow', reason: 'unreachable' }],
      }),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .send({ action: 'play', target: 'red,yellow' });
    expect(res.status).toBe(200);
  });

  it('200 — mixed skipped reasons (contention + unreachable); user-recoverable wins', async () => {
    const container = makeFakeContainer({
      sendHubCommand: vi.fn().mockResolvedValue({
        applied: [],
        skipped: [
          { color: 'red', reason: 'contention' },
          { color: 'yellow', reason: 'unreachable' },
        ],
      }),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .send({ action: 'play', target: 'red,yellow' });
    expect(res.status).toBe(200);
  });

  it('400 — ValidationError from PlayCommand maps to 400', async () => {
    const container = makeFakeContainer({
      sendHubCommand: vi.fn().mockRejectedValue(
        new ValidationError('bad action', { code: 'INVALID_ACTION', field: 'action' })
      ),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .send({ action: 'jump', target: 'red' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'bad action', code: 'INVALID_ACTION' });
  });

  it('404 — EntityNotFoundError from findDevice maps to 404', async () => {
    const container = makeFakeContainer({
      sendHubCommand: vi.fn().mockRejectedValue(
        new EntityNotFoundError('HubDevice', 'pink')
      ),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .send({ action: 'play', target: 'pink' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('HubDevice not found: pink');
  });

  it('500 — broken JSON body returns 400 from express body-parser', async () => {
    // Express's body-parser will respond 400 itself when JSON is malformed —
    // it produces a SyntaxError. Our app's express.json() middleware handles
    // the response before our router error mapper runs.
    const container = makeFakeContainer({
      sendHubCommand: vi.fn(),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/command')
      .set('Content-Type', 'application/json')
      .send('{ broken json');
    expect(res.status).toBe(400);
    expect(container.sendHubCommand.execute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /devices/:color
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/playback-hub/devices/:color', () => {
  it('200 — returns device.toYaml()', async () => {
    const yamlShape = { slot: 1, color: 'red', mac: 'aa:bb', class: 'private', volume: { max: 30 } };
    const fakeDevice = { toYaml: vi.fn().mockReturnValue(yamlShape) };
    const container = makeFakeContainer({
      updateDeviceConfig: vi.fn().mockResolvedValue(fakeDevice),
    });
    const res = await request(buildApp(container))
      .patch('/api/v1/playback-hub/devices/red')
      .send({ volumeBounds: { min: 0, default: 25, max: 30 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, device: yamlShape });
    expect(container.updateDeviceConfig.execute).toHaveBeenCalledWith({
      color: 'red',
      patch: { volumeBounds: { min: 0, default: 25, max: 30 } },
    });
  });

  it('404 — EntityNotFoundError for unknown color', async () => {
    const container = makeFakeContainer({
      updateDeviceConfig: vi.fn().mockRejectedValue(
        new EntityNotFoundError('HubDevice', 'pink')
      ),
    });
    const res = await request(buildApp(container))
      .patch('/api/v1/playback-hub/devices/pink')
      .send({});
    expect(res.status).toBe(404);
  });

  it('422 — DomainInvariantError for invalid patch', async () => {
    const container = makeFakeContainer({
      updateDeviceConfig: vi.fn().mockRejectedValue(
        new DomainInvariantError('public device requires ha_entity_id', {
          code: 'PUBLIC_REQUIRES_HA_ENTITY_ID',
        })
      ),
    });
    const res = await request(buildApp(container))
      .patch('/api/v1/playback-hub/devices/white')
      .send({ class: 'public' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      ok: false,
      error: 'public device requires ha_entity_id',
      code: 'PUBLIC_REQUIRES_HA_ENTITY_ID',
    });
  });
});

// ---------------------------------------------------------------------------
// POST /scheduled  +  PUT /scheduled/:id
// ---------------------------------------------------------------------------

function makeFakeFire(overrides = {}) {
  return {
    id: overrides.id ?? 'morning-news',
    time: '07:30',
    target: 'red',
    queue: { toString: () => 'plex:670208' },
    days: { value: 'weekdays' },
    durationMin: null,
    volumeOverride: null,
    ...overrides,
  };
}

describe('POST /api/v1/playback-hub/scheduled', () => {
  it('201 — creates a scheduled fire', async () => {
    const fire = makeFakeFire();
    const container = makeFakeContainer({
      saveScheduledFire: vi.fn().mockResolvedValue(fire),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/scheduled')
      .send({
        id: 'morning-news',
        time: '07:30',
        days: 'weekdays',
        target: 'red',
        queue: 'plex:670208',
      });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      fire: {
        id: 'morning-news',
        time: '07:30',
        target: 'red',
        queue: 'plex:670208',
        days: 'weekdays',
      },
    });
    expect(container.saveScheduledFire.execute).toHaveBeenCalledWith({
      fire: {
        id: 'morning-news',
        time: '07:30',
        days: 'weekdays',
        target: 'red',
        queue: 'plex:670208',
      },
    });
  });

  it('201 — emits duration_min and volume_override when set', async () => {
    const fire = makeFakeFire({ durationMin: 45, volumeOverride: 60 });
    const container = makeFakeContainer({
      saveScheduledFire: vi.fn().mockResolvedValue(fire),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/scheduled')
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.fire.duration_min).toBe(45);
    expect(res.body.fire.volume_override).toBe(60);
  });

  it('400 — ValidationError from ScheduledFire entity', async () => {
    const container = makeFakeContainer({
      saveScheduledFire: vi.fn().mockRejectedValue(
        new ValidationError('time must be HH:MM', {
          code: 'INVALID_SCHEDULED_FIRE', field: 'time'
        })
      ),
    });
    const res = await request(buildApp(container))
      .post('/api/v1/playback-hub/scheduled')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SCHEDULED_FIRE');
  });
});

describe('PUT /api/v1/playback-hub/scheduled/:id', () => {
  it('200 — upsert with id from URL', async () => {
    const fire = makeFakeFire({ id: 'morning-news' });
    const container = makeFakeContainer({
      saveScheduledFire: vi.fn().mockResolvedValue(fire),
    });
    const res = await request(buildApp(container))
      .put('/api/v1/playback-hub/scheduled/morning-news')
      .send({
        time: '07:30',
        days: 'weekdays',
        target: 'red',
        queue: 'plex:670208',
      });
    expect(res.status).toBe(200);
    expect(res.body.fire.id).toBe('morning-news');
    expect(container.saveScheduledFire.execute).toHaveBeenCalledWith({
      fire: {
        time: '07:30',
        days: 'weekdays',
        target: 'red',
        queue: 'plex:670208',
        id: 'morning-news', // injected from URL path
      },
    });
  });

  it('422 — DomainInvariantError surfaces as 422', async () => {
    const container = makeFakeContainer({
      saveScheduledFire: vi.fn().mockRejectedValue(
        new DomainInvariantError('volumeOverride exceeds bounds', {
          code: 'VOLUME_OVERRIDE_EXCEEDS_BOUNDS',
        })
      ),
    });
    const res = await request(buildApp(container))
      .put('/api/v1/playback-hub/scheduled/x')
      .send({});
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// DELETE /scheduled/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/playback-hub/scheduled/:id', () => {
  it('204 — no body on success', async () => {
    const container = makeFakeContainer({
      deleteScheduledFire: vi.fn().mockResolvedValue(undefined),
    });
    const res = await request(buildApp(container))
      .delete('/api/v1/playback-hub/scheduled/morning-news');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(container.deleteScheduledFire.execute).toHaveBeenCalledWith({ id: 'morning-news' });
  });

  it('404 — EntityNotFoundError surfaces as 404', async () => {
    const container = makeFakeContainer({
      deleteScheduledFire: vi.fn().mockRejectedValue(
        new EntityNotFoundError('ScheduledFire', 'ghost')
      ),
    });
    const res = await request(buildApp(container))
      .delete('/api/v1/playback-hub/scheduled/ghost');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unhandled errors → 500
// ---------------------------------------------------------------------------

describe('error mapping — unhandled', () => {
  it('500 — plain Error from any use case', async () => {
    const container = makeFakeContainer({
      getHubStatus: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const res = await request(buildApp(container))
      .get('/api/v1/playback-hub/status');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'boom', code: null });
  });
});
