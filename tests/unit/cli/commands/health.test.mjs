// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import health from '../../../../cli/commands/health.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(chunk, _enc, cb) { stdoutChunks.push(chunk); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(chunk, _enc, cb) { stderrChunks.push(chunk); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

function fakeAnalytics(overrides = {}) {
  return async () => ({
    aggregate: async ({ userId, metric, period, statistic }) => ({
      metric, period: { from: '2026-04-29', to: '2026-05-05', label: 'last_7d', source: 'rolling' },
      statistic: statistic || 'mean', value: 198.0, unit: 'lbs',
      daysCovered: 7, daysInPeriod: 7,
    }),
    ...overrides,
  });
}

describe('cli/commands/health', () => {
  describe('help', () => {
    it('prints usage when help=true', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: [], flags: {}, help: true },
        { stdout, stderr, getHealthAnalytics: fakeAnalytics() },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/aggregate/);
    });
  });

  describe('aggregate action', () => {
    it('emits JSON for `health aggregate <metric> --period last_7d`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: 'last_7d' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: fakeAnalytics() },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.metric).toBe('weight_lbs');
      expect(out.value).toBe(198);
      expect(out.unit).toBe('lbs');
    });

    it('passes --statistic through', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: 'last_7d', statistic: 'median' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { ...args, value: 198 }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.statistic).toBe('median');
    });

    it('parses YYYY calendar shorthand', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: '2024' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { value: 0 }; },
          }),
        },
      );
      expect(captured.period).toEqual({ calendar: '2024' });
    });

    it('parses YYYY-MM calendar shorthand', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: '2024-08' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { value: 0 }; },
          }),
        },
      );
      expect(captured.period).toEqual({ calendar: '2024-08' });
    });

    it('parses --from / --to override', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { from: '2024-01-15', to: '2024-02-10' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { value: 0 }; },
          }),
        },
      );
      expect(captured.period).toEqual({ from: '2024-01-15', to: '2024-02-10' });
    });

    it('exits 2 when --period and --from/--to are missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: {},
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: fakeAnalytics() },
      );
      expect(result.exitCode).toBe(2);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toMatch(/period_required/);
    });

    it('exits 2 when metric arg is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate'],
          flags: { period: 'last_7d' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: fakeAnalytics() },
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe('unknown action', () => {
    it('exits 2 with usage', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: ['fly'], flags: {}, help: false },
        { stdout, stderr },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/unknown action/i);
    });
  });

  describe('userId resolution', () => {
    it('uses --user flag when provided', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: 'last_7d', user: 'someone-else' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { value: 0 }; },
          }),
        },
      );
      expect(captured.userId).toBe('someone-else');
    });

    it('falls back to DSCLI_USER_ID env, then "default"', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      const original = process.env.DSCLI_USER_ID;
      process.env.DSCLI_USER_ID = 'env-user';
      try {
        await health.run(
          {
            subcommand: 'health',
            positional: ['aggregate', 'weight_lbs'],
            flags: { period: 'last_7d' },
            help: false,
          },
          {
            stdout, stderr,
            getHealthAnalytics: async () => ({
              aggregate: async (args) => { captured = args; return { value: 0 }; },
            }),
          },
        );
        expect(captured.userId).toBe('env-user');
      } finally {
        if (original === undefined) delete process.env.DSCLI_USER_ID;
        else process.env.DSCLI_USER_ID = original;
      }
    });
  });
});
