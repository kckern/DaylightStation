// @vitest-environment node
/**
 * HttpPlaybackHubAdapter — integration tests against a mock HTTP server.
 *
 * Spins up a fresh `node:http` server per test so each handler can be
 * tailored independently. Each test asserts a single behavior (happy path,
 * timeout, 409 contention, 500 error, body shape).
 *
 * The `@vitest-environment node` pragma at the top is REQUIRED — the project's
 * default env is happy-dom, which intercepts global `fetch` and performs CORS
 * preflight (OPTIONS) requests, breaking our raw node:http server tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';

import { HttpPlaybackHubAdapter } from '../../../backend/src/1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs';
import { SlotStatus } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotStatus.mjs';
import { CommandResult } from '../../../backend/src/2_domains/playback-hub/value-objects/CommandResult.mjs';
import { PlayCommand } from '../../../backend/src/2_domains/playback-hub/value-objects/PlayCommand.mjs';
import { QueueRef } from '../../../backend/src/2_domains/playback-hub/value-objects/QueueRef.mjs';
import { HubDevice } from '../../../backend/src/2_domains/playback-hub/entities/HubDevice.mjs';
import { SlotPosition } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { SlotColor } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs';
import { SlotClass } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotClass.mjs';
import { InfrastructureError } from '../../../backend/src/0_system/utils/errors/InfrastructureError.mjs';

/**
 * Build a HubDevice for a given color/class combo. Uses defaults for fields
 * that don't matter to the gateway tests.
 */
function makeDevice(color, { cls = 'private', haEntityId = null, position = 1 } = {}) {
  return new HubDevice({
    position: new SlotPosition(position),
    color: new SlotColor(color),
    mac: `00:00:00:00:00:0${position}`,
    class: new SlotClass(cls),
    haEntityId,
    haTurnOffOnStop: false
  });
}

/**
 * Helper: spin up a server with a single request handler, return {server, port}.
 */
async function listenWith(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

describe('HttpPlaybackHubAdapter', () => {
  let server;
  let adapter;

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
      server = null;
    }
  });

  // -----------------------------------------------------------------------
  // getStatus
  // -----------------------------------------------------------------------

  describe('getStatus', () => {
    it('maps hub JSON array to SlotStatus[]', async () => {
      const payload = [
        {
          slot: 1, position: 1, color: 'red',
          bt_connected: true, paused: false,
          now_playing: { queue: { source: 'plex', id: '670208' } },
          volume: 45, playlist_pos: 12, playlist_count: 30,
          armed_source: null
        },
        {
          slot: 2, position: 2, color: 'yellow',
          bt_connected: false, paused: true,
          now_playing: null,
          volume: 60, playlist_pos: 0, playlist_count: 0,
          armed_source: 'api'
        }
      ];
      const listening = await listenWith((req, res) => {
        expect(req.method).toBe('GET');
        expect(req.url).toBe('/api/status');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const result = await adapter.getStatus();
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(SlotStatus);
      expect(result[0].color).toBe('red');
      expect(result[0].bt_connected).toBe(true);
      expect(result[1].color).toBe('yellow');
      expect(result[1].armed_source).toBe('api');
    });

    it('throws InfrastructureError on 500', async () => {
      const listening = await listenWith((req, res) => {
        res.statusCode = 500;
        res.end('boom');
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      await expect(adapter.getStatus()).rejects.toThrow(InfrastructureError);
    });

    it('throws InfrastructureError on timeout', async () => {
      const listening = await listenWith(() => {
        // never respond — let the AbortController fire
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({
        baseUrl: `http://127.0.0.1:${listening.port}`,
        requestTimeoutSec: 0.1
      });
      const err = await adapter.getStatus().then(() => null, e => e);
      expect(err).toBeInstanceOf(InfrastructureError);
      expect(String(err.message).toLowerCase()).toContain('timeout');
    });

    it('throws InfrastructureError on network error (unreachable port)', async () => {
      // Bind+close to claim and release a port — anything we connect to next
      // on the same address will refuse.
      const tmp = await listenWith(() => {});
      const port = tmp.port;
      await new Promise(r => tmp.server.close(r));
      adapter = new HttpPlaybackHubAdapter({
        baseUrl: `http://127.0.0.1:${port}`,
        requestTimeoutSec: 2
      });
      await expect(adapter.getStatus()).rejects.toThrow(InfrastructureError);
    });
  });

  // -----------------------------------------------------------------------
  // sendCommand — body shape
  // -----------------------------------------------------------------------

  describe('sendCommand body shape', () => {
    it('POSTs to /api/play with the expected JSON shape', async () => {
      let captured = null;
      const listening = await listenWith((req, res) => {
        expect(req.method).toBe('POST');
        expect(req.url).toBe('/api/play');
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          captured = JSON.parse(body);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, applied: ['red'], skipped: [] }));
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({
        action: 'play',
        queue: QueueRef.parse('plex:670208'),
        volume: 45,
        durationMin: 30
      });
      await adapter.sendCommand(cmd, [makeDevice('red')]);
      expect(captured).toEqual({
        action: 'play',
        target: 'red',
        content_id: '670208',
        volume: 45,
        duration_min: 30
      });
    });

    it('comma-joins multiple targets and omits optional fields when null', async () => {
      let captured = null;
      const listening = await listenWith((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          captured = JSON.parse(body);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, applied: ['red', 'yellow'], skipped: [] }));
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({ action: 'pause' });
      await adapter.sendCommand(cmd, [makeDevice('red'), makeDevice('yellow', { position: 2 })]);
      expect(captured.action).toBe('pause');
      expect(captured.target).toBe('red,yellow');
      expect(captured.content_id).toBeUndefined();
      expect(captured.volume).toBeUndefined();
      expect(captured.duration_min).toBeUndefined();
    });

    it('keeps non-plex queue ids prefixed but strips plex: prefix', async () => {
      let captured = null;
      const listening = await listenWith((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          captured = JSON.parse(body);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, applied: ['red'], skipped: [] }));
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({
        action: 'play',
        queue: new QueueRef({ source: 'spotify', id: 'track123' })
      });
      await adapter.sendCommand(cmd, [makeDevice('red')]);
      expect(captured.content_id).toBe('spotify:track123');
    });
  });

  // -----------------------------------------------------------------------
  // sendCommand — response handling
  // -----------------------------------------------------------------------

  describe('sendCommand response handling', () => {
    it('returns CommandResult.applied for 200 OK with applied colors', async () => {
      const listening = await listenWith((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, applied: ['red'], skipped: [] }));
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({ action: 'pause' });
      const result = await adapter.sendCommand(cmd, [makeDevice('red')]);
      expect(result).toBeInstanceOf(CommandResult);
      expect(result.applied).toEqual(['red']);
      expect(result.skipped).toEqual([]);
    });

    it('handles legacy numeric-count response shape (applied:N, skipped:N)', async () => {
      // Today's hub returns applied/skipped as counts; the adapter falls back
      // to treating the request's targets as applied when count > 0.
      const listening = await listenWith((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, action: 'pause', applied: 1, skipped: 0 }));
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({ action: 'pause' });
      const result = await adapter.sendCommand(cmd, [makeDevice('red')]);
      expect(result.applied).toEqual(['red']);
      expect(result.skipped).toEqual([]);
    });

    it('legacy numeric skipped > 0 → maps targets to skipped[invalid-target]', async () => {
      const listening = await listenWith((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, action: 'pause', applied: 0, skipped: 1 }));
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({ action: 'pause' });
      const result = await adapter.sendCommand(cmd, [makeDevice('red')]);
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual([{ color: 'red', reason: 'invalid-target' }]);
    });

    it('409 maps to skipped[reason:contention] without throwing', async () => {
      const listening = await listenWith((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'another command in flight' }));
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({ action: 'pause' });
      const result = await adapter.sendCommand(cmd, [makeDevice('red'), makeDevice('yellow', { position: 2 })]);
      expect(result).toBeInstanceOf(CommandResult);
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual([
        { color: 'red', reason: 'contention' },
        { color: 'yellow', reason: 'contention' }
      ]);
    });

    it('500 throws InfrastructureError (NOT swallowed as skipped)', async () => {
      const listening = await listenWith((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          res.statusCode = 500;
          res.end('explosion');
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({ action: 'pause' });
      await expect(adapter.sendCommand(cmd, [makeDevice('red')])).rejects.toThrow(InfrastructureError);
    });

    it('400 from hub throws InfrastructureError', async () => {
      const listening = await listenWith((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'malformed' }));
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({ action: 'pause' });
      await expect(adapter.sendCommand(cmd, [makeDevice('red')])).rejects.toThrow(InfrastructureError);
    });

    it('timeout on /api/play throws InfrastructureError with timeout message', async () => {
      const listening = await listenWith(() => { /* hang */ });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({
        baseUrl: `http://127.0.0.1:${listening.port}`,
        requestTimeoutSec: 0.1
      });
      const cmd = new PlayCommand({ action: 'pause' });
      const err = await adapter.sendCommand(cmd, [makeDevice('red')]).then(() => null, e => e);
      expect(err).toBeInstanceOf(InfrastructureError);
      expect(String(err.message).toLowerCase()).toContain('timeout');
    });

    it('maps unknown reason strings to invalid-target', async () => {
      const listening = await listenWith((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            ok: true,
            applied: [],
            skipped: [{ color: 'red', reason: 'no-such-reason' }]
          }));
        });
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const cmd = new PlayCommand({ action: 'pause' });
      const result = await adapter.sendCommand(cmd, [makeDevice('red')]);
      expect(result.skipped).toEqual([{ color: 'red', reason: 'invalid-target' }]);
    });
  });

  // -----------------------------------------------------------------------
  // Constructor validation
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('requires a baseUrl', () => {
      expect(() => new HttpPlaybackHubAdapter({})).toThrow(InfrastructureError);
    });

    it('strips trailing slash from baseUrl', async () => {
      const listening = await listenWith((req, res) => {
        expect(req.url).toBe('/api/status');
        res.setHeader('Content-Type', 'application/json');
        res.end('[]');
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}/` });
      await adapter.getStatus();
    });
  });
});
