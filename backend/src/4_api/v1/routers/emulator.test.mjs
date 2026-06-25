// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
import { createEmulatorRouter } from './emulator.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };

// Normalized cfg (as produced by loadEmulatorConfig).
function makeCfg() {
  return {
    systems: { gb: { core: 'gb', label: 'Game Boy' } },
    games: [
      {
        id: 'pokemon-red',
        system: 'gb',
        title: 'Pokémon Red',
        rom: 'roms/Pokemon Red (UE) [S][!].gb',
        save: 'saves/Pokemon Red (UE) [S][!].srm',
        boxart: 'cover.png',
        bezel: 'bezel.png',
        governance: { mode: 'credit', required_zone: 'warm', grace_seconds: 20, earn_rate: 1.5 },
        shader: 'dotmatrix',
        chrome: 'gb-bezel',
        presentation: {
          screen: { x: 29, y: 10, width: 41, height: 66 },
          hotspots: [{ id: 'speaker', action: 'volume', region: { x: 79, y: 64, width: 12, height: 22 } }],
          overlays: [{ id: 'hr', source: 'fitness.heart_rate', format: 'bpm', region: { x: 15, y: 43, width: 12, height: 16 } }],
        },
        watches: [{ id: 'in_battle', addr: 0xd057, size: 1 }],
        hooks: [{ on: 'in_battle', do: {} }],
      },
    ],
    defaults: { governance: {}, shader: null, chrome: null },
    users: {
      soren: { governance: { required_zone: 'hot' } },
    },
    input: {
      keyboard: { up: 'ArrowUp', a: 'x' },
      controllers: [{ id: 'xbox', label: 'Xbox Wireless', match: 'Xbox|045e' }],
    },
  };
}

function enoent() {
  const e = new Error('not found');
  e.code = 'ENOENT';
  return e;
}

function makeApp(overrides = {}) {
  // In-memory binary store for save/state round-trips.
  const store = new Map();

  const deps = {
    logger: NOOP_LOGGER,
    loadConfig: () => makeCfg(),
    readBinary: vi.fn((absPath) => {
      if (store.has(absPath)) {
        const buf = store.get(absPath);
        return { buffer: buf, size: buf.length, contentType: 'application/octet-stream' };
      }
      if (absPath.includes('ROM')) {
        const buf = Buffer.from('ROMBYTES');
        return { buffer: buf, size: buf.length, contentType: 'application/octet-stream' };
      }
      if (absPath.includes('ART')) {
        const buf = Buffer.from('PNGDATA');
        return { buffer: buf, size: buf.length, contentType: 'image/png' };
      }
      throw enoent();
    }),
    writeBinary: vi.fn((absPath, buffer) => {
      store.set(absPath, Buffer.from(buffer));
      return Promise.resolve();
    }),
    resolveRomPath: vi.fn((cfg, system, gameId) => `/media/${system}/ROM/${gameId}`),
    resolveArtPath: vi.fn((cfg, system, gameId, kind) => `/media/${system}/ART/${gameId}/${kind}`),
    resolveSavePath: vi.fn((system, gameId, user) => `/media/${system}/saves/${user}/${gameId}.srm`),
    resolveStatePath: vi.fn((system, gameId, slot, user) => `/media/${system}/states/${user}/${gameId}/${slot}.state`),
    readEngineFile: vi.fn((relPath) => {
      const ENGINE = {
        'loader.js': { buffer: Buffer.from('LOADER'), contentType: 'text/javascript' },
        'cores/gambatte-wasm.data': { buffer: Buffer.from('COREDATA'), contentType: 'application/octet-stream' },
      };
      const entry = ENGINE[relPath];
      if (!entry) throw enoent();
      return { buffer: entry.buffer, size: entry.buffer.length, contentType: entry.contentType };
    }),
    ...overrides,
  };

  const app = express();
  app.use('/api/v1/emulator', createEmulatorRouter(deps));
  return { app, deps, store };
}

describe('createEmulatorRouter', () => {
  describe('GET /library', () => {
    it('returns systems and games with URLs', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/library');
      expect(res.status).toBe(200);
      expect(res.body.systems.gb.label).toBe('Game Boy');
      expect(res.body.games).toHaveLength(1);
      const g = res.body.games[0];
      expect(g.id).toBe('pokemon-red');
      expect(g.system).toBe('gb');
      expect(g.title).toBe('Pokémon Red');
      expect(g.shader).toBe('dotmatrix');
      expect(g.chrome).toBe('gb-bezel');
      expect(g.romUrl).toBe('/api/v1/emulator/rom/gb/pokemon-red');
      expect(g.coverUrl).toBe('/api/v1/emulator/art/gb/pokemon-red/cover');
      expect(g.bezelUrl).toBe('/api/v1/emulator/art/gb/pokemon-red/bezel');
      // No-user governance: game value
      expect(g.governance.required_zone).toBe('warm');
    });

    it('includes the bezel presentation (screen/hotspots/overlays)', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/library');
      const g = res.body.games[0];
      expect(g.presentation.screen).toEqual({ x: 29, y: 10, width: 41, height: 66 });
      expect(g.presentation.hotspots[0].id).toBe('speaker');
      expect(g.presentation.overlays[0].source).toBe('fitness.heart_rate');
    });

    it('includes the input config (keyboard + controllers)', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/library');
      expect(res.status).toBe(200);
      expect(res.body.input).toBeTruthy();
      expect(res.body.input.keyboard.up).toBe('ArrowUp');
      expect(res.body.input.controllers[0].id).toBe('xbox');
    });

    it('returns input:null when cfg has no input', async () => {
      const { app } = makeApp({
        loadConfig: () => ({ systems: { gb: { core: 'gb', label: 'Game Boy' } }, games: [], defaults: { governance: {}, shader: null, chrome: null }, users: {} }),
      });
      const res = await request(app).get('/api/v1/emulator/library');
      expect(res.status).toBe(200);
      expect(res.body.input).toBeNull();
    });

    it('applies per-user governance overlay with ?user=', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/library?user=soren');
      expect(res.status).toBe(200);
      expect(res.body.games[0].governance.required_zone).toBe('hot');
    });
  });

  describe('GET /rom', () => {
    it('streams bytes 200', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/rom/gb/pokemon-red');
      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('ROMBYTES');
      expect(res.headers['cache-control']).toMatch(/immutable/);
    });

    it('404 on ENOENT', async () => {
      const { app } = makeApp({
        resolveRomPath: () => '/media/gb/missing/x',
      });
      const res = await request(app).get('/api/v1/emulator/rom/gb/pokemon-red');
      expect(res.status).toBe(404);
    });

    it('400 on unsafe system', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/rom/..%2Fetc/pokemon-red');
      expect(res.status).toBe(400);
    });

    it('honors Range → 206', async () => {
      const { app } = makeApp({
        readBinary: (absPath, opts) => {
          const full = Buffer.from('ROMBYTES');
          if (opts?.range) {
            const { start, end } = opts.range;
            const slice = full.subarray(start, end + 1);
            return { stream: Readable.from(slice), size: full.length, contentType: 'application/octet-stream', range: { start, end } };
          }
          return { buffer: full, size: full.length, contentType: 'application/octet-stream' };
        },
      });
      const res = await request(app).get('/api/v1/emulator/rom/gb/pokemon-red').set('Range', 'bytes=0-2');
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 0-2/8');
      expect(res.body.toString()).toBe('ROM');
    });
  });

  describe('GET /art/:kind', () => {
    it('serves cover', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/art/gb/pokemon-red/cover');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/png/);
    });

    it('400 on invalid kind', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/art/gb/pokemon-red/screenshot');
      expect(res.status).toBe(400);
    });
  });

  describe('saves', () => {
    it('PUT then GET round-trips identical bytes', async () => {
      const { app } = makeApp();
      const payload = Buffer.from([1, 2, 3, 4, 5]);
      const put = await request(app)
        .put('/api/v1/emulator/save/gb/pokemon-red?user=soren')
        .set('Content-Type', 'application/octet-stream')
        .send(payload);
      expect(put.status).toBe(200);
      expect(put.body).toEqual({ ok: true, bytes: 5 });

      const get = await request(app).get('/api/v1/emulator/save/gb/pokemon-red?user=soren');
      expect(get.status).toBe(200);
      expect(Buffer.from(get.body)).toEqual(payload);
    });

    it('GET ENOENT → 204', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/save/gb/pokemon-red?user=soren');
      expect(res.status).toBe(204);
    });

    it('GET missing user → 400', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/save/gb/pokemon-red');
      expect(res.status).toBe(400);
    });

    it('PUT missing user → 400', async () => {
      const { app } = makeApp();
      const res = await request(app)
        .put('/api/v1/emulator/save/gb/pokemon-red')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from([1]));
      expect(res.status).toBe(400);
    });

    it('PUT empty body → 400', async () => {
      const { app } = makeApp();
      const res = await request(app)
        .put('/api/v1/emulator/save/gb/pokemon-red?user=soren')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(0));
      expect(res.status).toBe(400);
    });

    it('PUT unsafe user → 400', async () => {
      const { app } = makeApp();
      const res = await request(app)
        .put('/api/v1/emulator/save/gb/pokemon-red?user=..%2Fetc')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from([1]));
      expect(res.status).toBe(400);
    });
  });

  describe('states', () => {
    it('PUT then GET round-trips with slot', async () => {
      const { app } = makeApp();
      const payload = Buffer.from([9, 8, 7]);
      const put = await request(app)
        .put('/api/v1/emulator/state/gb/pokemon-red/1?user=soren')
        .set('Content-Type', 'application/octet-stream')
        .send(payload);
      expect(put.status).toBe(200);
      expect(put.body).toEqual({ ok: true, bytes: 3 });

      const get = await request(app).get('/api/v1/emulator/state/gb/pokemon-red/1?user=soren');
      expect(get.status).toBe(200);
      expect(Buffer.from(get.body)).toEqual(payload);
    });

    it('GET ENOENT → 204', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/state/gb/pokemon-red/1?user=soren');
      expect(res.status).toBe(204);
    });
  });

  describe('GET /engine/*', () => {
    it('serves loader.js with text/javascript', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/engine/loader.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/javascript/);
      expect(res.text).toBe('LOADER');
      expect(res.headers['cache-control']).toBeTruthy();
    });

    it('serves a nested core data file', async () => {
      const { app, deps } = makeApp();
      const res = await request(app).get('/api/v1/emulator/engine/cores/gambatte-wasm.data');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/octet-stream/);
      expect(Buffer.from(res.body).toString()).toBe('COREDATA');
      expect(deps.readEngineFile).toHaveBeenCalledWith('cores/gambatte-wasm.data');
    });

    it('400 on traversal segment', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/engine/..%2Fsecret');
      expect(res.status).toBe(400);
    });

    it('404 on missing file', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/api/v1/emulator/engine/nope.js');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /bt/pair', () => {
    it('202 + requestId, calls publishBtPair once with default 30000ms', async () => {
      const publishBtPair = vi.fn();
      const makeRequestId = () => 'req-fixed';
      const { app } = makeApp({ publishBtPair, makeRequestId });

      const res = await request(app).post('/api/v1/emulator/bt/pair').send({});

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ requestId: 'req-fixed' });
      expect(publishBtPair).toHaveBeenCalledTimes(1);
      expect(publishBtPair).toHaveBeenCalledWith({ requestId: 'req-fixed', durationMs: 30000 });
    });

    it('honors a provided durationMs', async () => {
      const publishBtPair = vi.fn();
      const makeRequestId = () => 'req-fixed';
      const { app } = makeApp({ publishBtPair, makeRequestId });

      const res = await request(app).post('/api/v1/emulator/bt/pair').send({ durationMs: 15000 });

      expect(res.status).toBe(202);
      expect(publishBtPair).toHaveBeenCalledWith({ requestId: 'req-fixed', durationMs: 15000 });
    });

    it('500 when the publisher throws', async () => {
      const publishBtPair = vi.fn(() => { throw new Error('bus down'); });
      const { app } = makeApp({ publishBtPair, makeRequestId: () => 'req-x' });

      const res = await request(app).post('/api/v1/emulator/bt/pair').send({});
      expect(res.status).toBe(500);
    });
  });
});
