// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import content from '../../../../cli/commands/content.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

describe('cli/commands/content', () => {
  describe('search action', () => {
    it('emits JSON with results array and count', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeQuery = {
        async search(query) {
          return {
            items: [
              { source: 'plex', localId: '642120', title: 'Workout Mix', type: 'playlist' },
              { source: 'plex', localId: '642121', title: 'Workout Vol 2', type: 'playlist' },
            ],
            total: 2,
            sources: ['plex'],
          };
        },
      };

      const result = await content.run(
        { subcommand: 'content', positional: ['search', 'workout'], flags: { take: '5' }, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.results).toHaveLength(2);
      expect(out.count).toBe(2);
      expect(out.results[0].title).toBe('Workout Mix');
    });

    it('passes query text to the service as a query object', async () => {
      const { stdout, stderr } = makeBuffers();
      let capturedQuery;
      const fakeQuery = {
        async search(q) {
          capturedQuery = q;
          return { items: [], total: 0, sources: [] };
        },
      };

      await content.run(
        { subcommand: 'content', positional: ['search', 'plex:', 'workout', 'mix'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );

      // Should join positional[1..] with spaces and pass as { text: ... }
      expect(capturedQuery).toMatchObject({ text: 'plex: workout mix' });
    });

    it('exits 2 when query text is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await content.run(
        { subcommand: 'content', positional: ['search'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => ({ async search() { return {}; } }) },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/query/i);
    });

    it('exits 0 with empty results array on no matches', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeQuery = { async search() { return { items: [], total: 0, sources: [] }; } };

      const result = await content.run(
        { subcommand: 'content', positional: ['search', 'nothing'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.results).toEqual([]);
      expect(out.count).toBe(0);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await content.run(
        { subcommand: 'content', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/search/);
    });
  });

  describe('resolve action', () => {
    it('parses source:id and calls resolve()', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const fakeQuery = {
        async resolve(source, localId) {
          captured = { source, localId };
          return { source, localId, title: 'Workout Mix', type: 'playlist', metadata: { runtime: 1800 } };
        },
      };
      const r = await content.run(
        { subcommand: 'content', positional: ['resolve', 'plex:642120'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );
      expect(r.exitCode).toBe(0);
      expect(captured).toEqual({ source: 'plex', localId: '642120' });
      const out = JSON.parse(stdout.read().trim());
      expect(out.title).toBe('Workout Mix');
      expect(out.source).toBe('plex');
    });

    it('exits 2 when key is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['resolve'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => ({ async resolve() { return null; } }) },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/source:id/i);
    });

    it('exits 2 when key is malformed (no colon)', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['resolve', 'just-an-id'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => ({ async resolve() { return null; } }) },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/source:id/i);
    });

    it('exits 1 not_found when resolve returns null', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['resolve', 'plex:nope'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => ({ async resolve() { return null; } }) },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.source).toBe('plex');
      expect(err.localId).toBe('nope');
    });
  });

  describe('list-libraries action', () => {
    it('returns categories with optional source filter', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeRegistry = {
        getCategories() { return ['media', 'gallery', 'audiobooks']; },
        resolveSource(name) {
          const map = {
            plex: [{ getProviderName: () => 'plex', getCategoryName: () => 'media' }],
            immich: [{ getProviderName: () => 'immich', getCategoryName: () => 'gallery' }],
          };
          return map[name] || [];
        },
      };
      const fakeQuery = { __registry: fakeRegistry };
      const r = await content.run(
        { subcommand: 'content', positional: ['list-libraries'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.categories).toEqual(['media', 'gallery', 'audiobooks']);
      expect(out.count).toBe(3);
    });

    it('exits 3 when factory throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['list-libraries'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => { throw new Error('plex auth missing'); } },
      );
      expect(r.exitCode).toBe(3);
    });

    it('exits 1 when registry is missing or malformed', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeQuery = { __registry: null };
      const r = await content.run(
        { subcommand: 'content', positional: ['list-libraries'], flags: {}, help: false },
        { stdout, stderr, getContentQuery: async () => fakeQuery },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('content_error');
    });
  });

  describe('play action', () => {
    it('exits 2 without --allow-write', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['play', 'plex:642120'], flags: { to: 'livingroom-tv' }, help: false },
        { stdout, stderr, allowWrite: false },
      );
      expect(r.exitCode).toBe(2);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('allow_write_required');
    });

    it('exits 2 when --to or key missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await content.run(
        { subcommand: 'content', positional: ['play', 'plex:642120'], flags: {}, help: false },
        { stdout, stderr, allowWrite: false },
      );
      expect(r.exitCode).toBe(2);
    });

    it('GETs /api/v1/device/<id>/load with queue+shader+shuffle and returns ok', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const fakeFetch = async (url) => {
        captured = url;
        return { ok: true, status: 200, async json() { return { state: 'loaded' }; } };
      };
      const r = await content.run(
        {
          subcommand: 'content',
          positional: ['play', 'plex:642120'],
          flags: { 'allow-write': true, to: 'livingroom-tv', shader: 'dark', shuffle: true },
          help: false,
        },
        { stdout, stderr, fetch: fakeFetch, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(0);
      expect(captured).toMatch(/\/api\/v1\/device\/livingroom-tv\/load/);
      expect(captured).toMatch(/queue=plex%3A642120/);
      expect(captured).toMatch(/shader=dark/);
      expect(captured).toMatch(/shuffle=1/);
      const out = JSON.parse(stdout.read().trim());
      expect(out.ok).toBe(true);
      expect(out.device).toBe('livingroom-tv');
      expect(out.state).toBe('loaded');
    });

    it('exits 4 when backend unreachable', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
      const r = await content.run(
        {
          subcommand: 'content',
          positional: ['play', 'plex:642120'],
          flags: { 'allow-write': true, to: 'livingroom-tv' },
          help: false,
        },
        { stdout, stderr, fetch: fakeFetch, allowWrite: true, getWriteAuditor: async () => ({ log: async () => {} }) },
      );
      expect(r.exitCode).toBe(4);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('backend_unreachable');
    });
  });
});
