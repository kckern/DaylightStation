// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
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
