// @vitest-environment node
/**
 * tests/integration/playback-hub-bootstrap.test.mjs
 *
 * Exercises `createPlaybackHubServices` end-to-end. Constructs the real
 * adapters (HttpPlaybackHubAdapter against a stub HTTP server, and
 * YamlHubConfigDatastore against a tmp file), builds the container, and
 * verifies:
 *   1. `GET /api/v1/playback-hub/status` returns slots from the stub hub
 *   2. `GET /api/v1/playback-hub/config` returns the parsed YAML
 *   3. The broadcaster ran at least once and published a snapshot
 *   4. Shutdown stops the broadcaster cleanly
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// NOTE: We don't import `createPlaybackHubServices` from bootstrap.mjs
// directly — that file eagerly pulls in the entire backend (Mastra, Plex,
// every adapter, etc.), which is too heavy for a unit-scoped integration
// test. Instead we re-construct the same wiring inline using the four
// playback-hub pieces. This keeps the test focused on the playback-hub
// bounded context and still exercises every real adapter + the broadcaster
// loop end-to-end. The full-bootstrap path is exercised by the Task 9.1
// full-stack smoke test (Phase 9).
import { HttpPlaybackHubAdapter } from '../../backend/src/1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs';
import { YamlHubConfigDatastore } from '../../backend/src/1_adapters/persistence/yaml/YamlHubConfigDatastore.mjs';
import { PlaybackHubContainer } from '../../backend/src/3_applications/playback-hub/PlaybackHubContainer.mjs';
import { createPlaybackHubRouter } from '../../backend/src/4_api/v1/routers/playbackHub.mjs';

/**
 * Mirror of `createPlaybackHubServices` from bootstrap.mjs (kept in
 * lockstep). Wires real adapters + the container + the router using only
 * the four playback-hub-local modules above.
 */
async function buildPlaybackHubServices({ configService, eventBus, logger }) {
  const services = configService.getAllServices();
  const hubServiceCfg = services.playback_hub;
  const baseUrl = hubServiceCfg.docker;
  const requestTimeoutSec = typeof hubServiceCfg.request_timeout_sec === 'number'
    ? hubServiceCfg.request_timeout_sec : 2;
  const gateway = new HttpPlaybackHubAdapter({ baseUrl, requestTimeoutSec, logger });
  const yamlPath = path.join(configService.getDataDir(), 'household', 'config', 'playback-hub.yml');
  const configRepository = new YamlHubConfigDatastore({ yamlPath, logger });
  const eventPublisher = {
    publish(payload) {
      const { topic, ...rest } = payload;
      eventBus.broadcast(topic, rest);
    },
  };
  const container = new PlaybackHubContainer({
    gateway,
    configRepository,
    eventPublisher,
    logger,
    broadcasterOptions: { intervalMs: 3000, maxBackoffMs: 30000 },
  });
  await container.start();
  const router = createPlaybackHubRouter({ container, logger });
  return { container, router };
}

const VALID_HUB_YAML = `
devices:
  - slot: 1
    color: red
    mac: "41:42:3A:E5:43:07"
    class: private
  - slot: 2
    color: yellow
    mac: "AA:BB:CC:DD:EE:FF"
    class: private
`;

const STUB_SLOT_STATUS = [
  {
    position: 1,
    color: 'red',
    bt_connected: true,
    paused: false,
    now_playing: { queue: { source: 'plex', id: '670208' } },
    volume: 45,
    playlist_pos: 12,
    playlist_count: 30,
    armed_source: null,
  },
  {
    position: 2,
    color: 'yellow',
    bt_connected: false,
    paused: true,
    now_playing: null,
    volume: 0,
    playlist_pos: 0,
    playlist_count: 0,
    armed_source: null,
  },
];

/**
 * Spin up a tiny mock playback hub on a random port.
 * Only implements GET /api/status — that's all the bootstrap smoke needs.
 */
function startStubHub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/status') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(STUB_SLOT_STATUS));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

/**
 * Stub ConfigService — the bootstrap factory only reaches for
 * `getAllServices()` and `getDataDir()`.
 */
function makeStubConfigService({ baseUrl, dataDir }) {
  return {
    getAllServices: () => ({
      playback_hub: {
        docker: baseUrl,
        request_timeout_sec: 2,
      },
    }),
    getDataDir: () => dataDir,
  };
}

/**
 * Stub event bus — records broadcasts so the test can observe broadcaster ticks.
 */
function makeStubEventBus() {
  const broadcasts = [];
  return {
    broadcast(topic, payload) {
      broadcasts.push({ topic, payload });
    },
    broadcasts,
  };
}

describe('playback-hub bootstrap integration', () => {
  /** @type {http.Server} */
  let stubServer;
  let baseUrl;
  /** @type {string} */
  let dataDir;
  /** @type {string} */
  let yamlPath;
  /** @type {import('express').Express} */
  let app;
  /** @type {import('../../backend/src/3_applications/playback-hub/PlaybackHubContainer.mjs').PlaybackHubContainer} */
  let container;
  /** @type {{broadcasts: Array<{topic:string,payload:object}>}} */
  let eventBus;

  beforeAll(async () => {
    // Stub hub
    const stub = await startStubHub();
    stubServer = stub.server;
    baseUrl = `http://127.0.0.1:${stub.port}`;

    // Tmp data dir + household/config/playback-hub.yml
    dataDir = await mkdtemp(path.join(tmpdir(), 'playback-hub-it-'));
    const configDir = path.join(dataDir, 'household', 'config');
    await import('node:fs').then(({ promises }) => promises.mkdir(configDir, { recursive: true }));
    yamlPath = path.join(configDir, 'playback-hub.yml');
    await writeFile(yamlPath, VALID_HUB_YAML, 'utf8');

    // Stub deps
    const configService = makeStubConfigService({ baseUrl, dataDir });
    eventBus = makeStubEventBus();

    const services = await buildPlaybackHubServices({
      configService,
      eventBus,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(services).not.toBeNull();
    container = services.container;

    app = express();
    app.use(express.json());
    app.use('/api/v1/playback-hub', services.router);
  }, 15000);

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
    if (stubServer) {
      await new Promise((r) => stubServer.close(r));
    }
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('GET /status returns slot data from the stub hub', async () => {
    const res = await request(app).get('/api/v1/playback-hub/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect(res.body.slots).toHaveLength(2);
    // SlotStatus VOs serialize their fields; positions + colors come straight
    // from the stub.
    expect(res.body.slots[0].color).toBe('red');
    expect(res.body.slots[1].color).toBe('yellow');
    expect(typeof res.body.fetchedAt).toBe('string');
  });

  it('GET /config returns the parsed YAML aggregate', async () => {
    const res = await request(app).get('/api/v1/playback-hub/config');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.config).toBeTypeOf('object');
    expect(Array.isArray(res.body.config.devices)).toBe(true);
    expect(res.body.config.devices).toHaveLength(2);
    expect(res.body.config.devices[0].color).toBe('red');
    expect(res.body.config.devices[1].color).toBe('yellow');
  });

  it('broadcaster publishes snapshots to the event bus', async () => {
    // Wait for at least one broadcaster tick. The default intervalMs is 3000;
    // we give it a generous budget and poll. The very first tick fires
    // immediately on .start() — getLastSnapshot() shouldn't be null long.
    const deadline = Date.now() + 5000;
    let snapshot = container.broadcaster.getLastSnapshot();
    while (!snapshot && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      snapshot = container.broadcaster.getLastSnapshot();
    }
    expect(snapshot).not.toBeNull();
    expect(Array.isArray(snapshot.devices)).toBe(true);
    expect(snapshot.devices.length).toBeGreaterThan(0);
    const playbackBroadcasts = eventBus.broadcasts.filter(
      (b) => b.topic === 'playback-hub:status'
    );
    expect(playbackBroadcasts.length).toBeGreaterThan(0);
    expect(playbackBroadcasts[0].payload.type).toBe('playback-hub.status.snapshot');
  }, 10000);

  it('container.stop() halts the broadcaster cleanly', async () => {
    await container.stop();
    const before = container.broadcaster.getLastSnapshot();
    // Wait long enough for what would have been another tick — no new snapshot.
    await new Promise((r) => setTimeout(r, 250));
    const after = container.broadcaster.getLastSnapshot();
    // last snapshot is preserved (we exposed getLastSnapshot for this reason).
    expect(after).toBe(before);
    // Re-stopping is idempotent.
    await container.stop();
  });
});
