// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import system from '../../../../cli/commands/system.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) { stdoutChunks.push(chunk); cb(); },
  });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({
    write(chunk, _enc, cb) { stderrChunks.push(chunk); cb(); },
  });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

describe('cli/commands/system', () => {
  describe('health action', () => {
    it('emits JSON with backend reachability info on success', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => ({
        ok: true,
        status: 200,
        async json() { return { version: 'abc123', commit: 'abc123' }; },
      });

      const result = await system.run(
        { subcommand: 'system', positional: ['health'], flags: {}, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.ok).toBe(true);
      expect(out.backend.reachable).toBe(true);
      expect(out.backend.version).toBe('abc123');
    });

    it('exits 4 (EXIT_BACKEND) when fetch throws (backend unreachable)', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };

      const result = await system.run(
        { subcommand: 'system', positional: ['health'], flags: {}, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );

      expect(result.exitCode).toBe(4);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('backend_unreachable');
    });

    it('exits 4 when backend responds non-2xx', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => ({ ok: false, status: 503, async json() { return {}; } });

      const result = await system.run(
        { subcommand: 'system', positional: ['health'], flags: {}, help: false },
        { stdout, stderr, fetch: fakeFetch },
      );

      expect(result.exitCode).toBe(4);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('backend_unhealthy');
      expect(err.status).toBe(503);
    });

    it('honors DSCLI_BACKEND_URL env var as base URL', async () => {
      const { stdout } = makeBuffers();
      let capturedUrl;
      const fakeFetch = async (url) => {
        capturedUrl = url;
        return { ok: true, status: 200, async json() { return { version: 'x' }; } };
      };

      const original = process.env.DSCLI_BACKEND_URL;
      process.env.DSCLI_BACKEND_URL = 'http://example.invalid:9999';
      try {
        await system.run(
          { subcommand: 'system', positional: ['health'], flags: {}, help: false },
          { stdout, stderr: makeBuffers().stderr, fetch: fakeFetch },
        );
        expect(capturedUrl.startsWith('http://example.invalid:9999/')).toBe(true);
      } finally {
        if (original === undefined) delete process.env.DSCLI_BACKEND_URL;
        else process.env.DSCLI_BACKEND_URL = original;
      }
    });
  });

  describe('unknown action', () => {
    it('exits 2 with usage error', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['fly'], flags: {}, help: false },
        { stdout, stderr },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/unknown action/i);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/system/i);
      expect(stdout.read()).toMatch(/health/i);
    });
  });

  describe('config action', () => {
    function fakeConfigService() {
      return {
        getDataDir: () => '/data',
        getMediaDir: () => '/media',
        getTimezone: () => 'America/Los_Angeles',
        getHouseholdDevices: () => ({ devices: { 'office-tv': { type: 'linux-pc' } } }),
        getIntegrationsConfig: () => ({ homeassistant: { host: 'http://hass:8123' } }),
        getHouseholdAppConfig: (_hid, appName) => {
          if (appName === 'fitness') return { mode: 'cycle' };
          return null;
        },
      };
    }

    it('returns system namespace with derived values', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config', 'system'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.namespace).toBe('system');
      expect(out.config.dataDir).toBe('/data');
      expect(out.config.timezone).toBe('America/Los_Angeles');
    });

    it('returns devices namespace', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config', 'devices'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.namespace).toBe('devices');
      expect(out.config.devices['office-tv'].type).toBe('linux-pc');
    });

    it('returns app namespace (fitness) via catch-all path', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config', 'fitness'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.namespace).toBe('fitness');
      expect(out.config.mode).toBe('cycle');
    });

    it('exits 1 (not_found) for unknown namespace', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config', 'nope'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.namespace).toBe('nope');
    });

    it('exits 2 when namespace arg missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await system.run(
        { subcommand: 'system', positional: ['config'], flags: {}, help: false },
        { stdout, stderr, getConfigService: async () => fakeConfigService() },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/namespace/i);
    });
  });

  describe('reload action', () => {
    it('exits 2 without --allow-write', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await system.run(
        { subcommand: 'system', positional: ['reload'], flags: {}, help: false },
        { stdout, stderr, allowWrite: false },
      );
      expect(r.exitCode).toBe(2);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('allow_write_required');
    });

    it('POSTs to /api/v1/system/reload and emits backend response', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const fakeFetch = async (url, opts) => {
        captured = { url, method: opts?.method };
        return { ok: true, status: 200, async json() { return { ok: true, reloaded: ['concierge', 'fitness'], count: 2 }; } };
      };
      const r = await system.run(
        { subcommand: 'system', positional: ['reload'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, fetch: fakeFetch, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(0);
      expect(captured.url).toMatch(/\/api\/v1\/system\/reload/);
      expect(captured.method).toBe('POST');
      const out = JSON.parse(stdout.read().trim());
      expect(out.reloaded).toEqual(['concierge', 'fitness']);
      expect(out.count).toBe(2);
    });

    it('passes --app as query string', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const fakeFetch = async (url) => {
        captured = url;
        return { ok: true, status: 200, async json() { return { ok: true, reloaded: ['concierge'], count: 1 }; } };
      };
      await system.run(
        { subcommand: 'system', positional: ['reload'], flags: { 'allow-write': true, app: 'concierge' }, help: false },
        { stdout, stderr, fetch: fakeFetch, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(captured).toMatch(/[?&]app=concierge/);
    });

    it('exits 4 when backend unreachable', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
      const r = await system.run(
        { subcommand: 'system', positional: ['reload'], flags: { 'allow-write': true }, help: false },
        { stdout, stderr, fetch: fakeFetch, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(4);
    });
  });
});
