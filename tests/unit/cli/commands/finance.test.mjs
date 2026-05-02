// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import finance from '../../../../cli/commands/finance.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

describe('cli/commands/finance', () => {
  describe('accounts action', () => {
    it('emits JSON with accounts array and a total balance', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeBuxfer = {
        async getAccounts() {
          return [
            { id: 732539, name: 'Fidelity', balance: 12345.67 },
            { id: 732537, name: 'Capital One', balance: -250.00 },
          ];
        },
      };

      const result = await finance.run(
        { subcommand: 'finance', positional: ['accounts'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => fakeBuxfer },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.accounts).toHaveLength(2);
      expect(out.count).toBe(2);
      expect(out.total).toBeCloseTo(12095.67, 2);
      expect(out.accounts[0].name).toBe('Fidelity');
    });

    it('returns empty array when adapter returns nothing', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeBuxfer = { async getAccounts() { return []; } };

      const result = await finance.run(
        { subcommand: 'finance', positional: ['accounts'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => fakeBuxfer },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.accounts).toEqual([]);
      expect(out.count).toBe(0);
      expect(out.total).toBe(0);
    });

    it('exits 3 (EXIT_CONFIG) when getBuxfer() throws', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await finance.run(
        { subcommand: 'finance', positional: ['accounts'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => { throw new Error('Buxfer credentials missing'); } },
      );
      expect(result.exitCode).toBe(3);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('config_error');
      expect(err.message).toMatch(/credentials/);
    });

    it('exits 1 (EXIT_FAIL) when adapter throws (auth or API failure)', async () => {
      const { stdout, stderr } = makeBuffers();
      const fakeBuxfer = { async getAccounts() { throw new Error('401 Unauthorized'); } };

      const result = await finance.run(
        { subcommand: 'finance', positional: ['accounts'], flags: {}, help: false },
        { stdout, stderr, getBuxfer: async () => fakeBuxfer },
      );
      expect(result.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toMatch(/buxfer_error|401/i);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await finance.run(
        { subcommand: 'finance', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/accounts/);
    });
  });
});
