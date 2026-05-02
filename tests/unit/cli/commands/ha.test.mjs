// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import ha from '../../../../cli/commands/ha.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

describe('cli/commands/ha', () => {
  describe('state action', () => {
    it('emits JSON for an existing entity', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeGateway = {
        async getState(id) {
          if (id === 'light.office_main') {
            return {
              entityId: 'light.office_main',
              state: 'off',
              attributes: { friendly_name: 'Office Main' },
              lastChanged: '2026-05-02T00:00:00Z',
            };
          }
          return null;
        },
      };

      const result = await ha.run(
        { subcommand: 'ha', positional: ['state', 'light.office_main'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.entity_id).toBe('light.office_main');
      expect(out.state).toBe('off');
      expect(out.attributes.friendly_name).toBe('Office Main');
    });

    it('exits 1 with not_found for a missing entity', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeGateway = { async getState() { return null; } };

      const result = await ha.run(
        { subcommand: 'ha', positional: ['state', 'light.does_not_exist'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => fakeGateway },
      );

      expect(result.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.entity_id).toBe('light.does_not_exist');
    });

    it('exits 2 (EXIT_USAGE) when entity_id is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await ha.run(
        { subcommand: 'ha', positional: ['state'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({ async getState() { return null; } }) },
      );

      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/entity_id/i);
    });

    it('exits 3 (EXIT_CONFIG) when getHaGateway() throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await ha.run(
        { subcommand: 'ha', positional: ['state', 'light.x'], flags: {}, help: false },
        {
          stdout,
          stderr,
          getHaGateway: async () => { throw new Error('integration not configured'); },
        },
      );

      expect(result.exitCode).toBe(3);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('config_error');
      expect(err.message).toMatch(/integration not configured/);
    });

    it('test fakes that satisfy the IHomeAutomationGateway port pass isHomeAutomationGateway()', async () => {
      // Sanity check on the port-vs-adapter discipline: a full-shape fake should
      // pass isHomeAutomationGateway. If a future command uses methods other than
      // getState, its test fakes need to implement those too — this test demonstrates
      // the contract and will catch regressions to the port itself.
      const { isHomeAutomationGateway } = await import('#apps/home-automation/ports/IHomeAutomationGateway.mjs');
      const fakeGateway = {
        async getState() { return null; },
        async getStates() { return new Map(); },
        async getHistory() { return new Map(); },
        async callService() { return { ok: true }; },
        async activateScene() { return { ok: true }; },
      };
      expect(isHomeAutomationGateway(fakeGateway)).toBe(true);
    });
  });

  describe('unknown action', () => {
    it('exits 2 with usage error', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await ha.run(
        { subcommand: 'ha', positional: ['fly'], flags: {}, help: false },
        { stdout, stderr, getHaGateway: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/unknown action/i);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await ha.run(
        { subcommand: 'ha', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/state/);
    });
  });
});
