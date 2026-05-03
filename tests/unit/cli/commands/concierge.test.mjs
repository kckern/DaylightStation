// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import concierge from '../../../../cli/commands/concierge.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

describe('cli/commands/concierge', () => {
  describe('satellites action', () => {
    it('emits JSON with satellites array', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeConfig = {
        satellites: [
          { id: 'dev', area: 'livingroom', media_player_entity: 'media_player.lr', allowed_skills: ['memory'], scopes_allowed: ['memory:**'] },
          { id: 'cli', area: 'none', allowed_skills: ['memory', 'home_automation'], scopes_allowed: ['ha:**'] },
        ],
      };
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['satellites'], flags: {}, help: false },
        { stdout, stderr, getConciergeConfig: async () => fakeConfig },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.satellites).toHaveLength(2);
      expect(out.count).toBe(2);
      expect(out.satellites[0].id).toBe('dev');
      expect(out.satellites[1].id).toBe('cli');
    });

    it('returns empty list when no satellites configured', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['satellites'], flags: {}, help: false },
        { stdout, stderr, getConciergeConfig: async () => ({}) },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.satellites).toEqual([]);
      expect(out.count).toBe(0);
    });

    it('exits 3 when getConciergeConfig() throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['satellites'], flags: {}, help: false },
        { stdout, stderr, getConciergeConfig: async () => { throw new Error('concierge.yml not found'); } },
      );
      expect(r.exitCode).toBe(3);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('config_error');
    });
  });

  describe('transcripts list + transcript', () => {
    let tmpRoot;
    beforeEach(async () => {
      tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dscli-tx-'));
      // Build a sample transcript tree:
      //   tmpRoot/2026-05-01/dev/1700000000-aaa-111.json
      //   tmpRoot/2026-05-02/dev/1700000100-bbb-222.json
      //   tmpRoot/2026-05-02/cli/1700000200-ccc-333.json
      const make = async (day, sat, file, body) => {
        const dir = path.join(tmpRoot, day, sat);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, file), JSON.stringify(body), 'utf8');
      };
      await make('2026-05-01', 'dev', '1700000000-aaa-111.json', { id: 'aaa-111', satellite: 'dev' });
      await make('2026-05-02', 'dev', '1700000100-bbb-222.json', { id: 'bbb-222', satellite: 'dev' });
      await make('2026-05-02', 'cli', '1700000200-ccc-333.json', { id: 'ccc-333', satellite: 'cli' });
    });
    afterEach(async () => {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    });

    it('transcripts list returns all recent ids', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['transcripts'], flags: {}, help: false },
        { stdout, stderr, getTranscriptDir: async () => tmpRoot },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.count).toBe(3);
      const ids = out.transcripts.map((t) => t.id);
      expect(ids).toEqual(expect.arrayContaining(['aaa-111', 'bbb-222', 'ccc-333']));
    });

    it('transcripts list filters by --satellite', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['transcripts'], flags: { satellite: 'cli' }, help: false },
        { stdout, stderr, getTranscriptDir: async () => tmpRoot },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.count).toBe(1);
      expect(out.transcripts[0].satellite).toBe('cli');
      expect(out.transcripts[0].id).toBe('ccc-333');
    });

    it('transcripts list returns empty when tree is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['transcripts'], flags: {}, help: false },
        { stdout, stderr, getTranscriptDir: async () => path.join(tmpRoot, 'nope') },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.transcripts).toEqual([]);
      expect(out.count).toBe(0);
    });

    it('transcripts list rejects unknown sub-action', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['transcripts', 'show'], flags: {}, help: false },
        { stdout, stderr, getTranscriptDir: async () => tmpRoot },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/unknown sub-action/i);
    });

    it('transcript <id> returns the matching JSON', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['transcript', 'bbb-222'], flags: {}, help: false },
        { stdout, stderr, getTranscriptDir: async () => tmpRoot },
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.id).toBe('bbb-222');
      expect(out.satellite).toBe('dev');
    });

    it('transcript <id> exits 1 not_found for missing id', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['transcript', 'zzz-999'], flags: {}, help: false },
        { stdout, stderr, getTranscriptDir: async () => tmpRoot },
      );
      expect(r.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.id).toBe('zzz-999');
    });

    it('transcript exits 2 when id missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['transcript'], flags: {}, help: false },
        { stdout, stderr, getTranscriptDir: async () => tmpRoot },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/id/i);
    });
  });

  describe('unknown action / help', () => {
    it('exits 2 on unknown action', async () => {
      const { stdout, stderr } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: ['nope'], flags: {}, help: false },
        { stdout, stderr },
      );
      expect(r.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/unknown action/i);
    });

    it('returns exit 0 with usage on help=true', async () => {
      const { stdout } = makeBuffers();
      const r = await concierge.run(
        { subcommand: 'concierge', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(r.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/satellites/);
    });
  });
});
