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

  describe('compare action', () => {
    it('emits JSON for `health compare <metric> --a <p> --b <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['compare', 'weight_lbs'],
          flags: { a: 'last_30d', b: 'prev_30d' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            compare: async (args) => ({
              metric: args.metric, statistic: 'mean',
              a: { value: 197 }, b: { value: 200 },
              delta: -3, percentChange: -0.015, reliability: 'high',
            }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.delta).toBe(-3);
    });

    it('exits 2 when --a or --b missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['compare', 'weight_lbs'],
          flags: { a: 'last_30d' },  // missing b
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe('summarize-change action', () => {
    it('emits JSON for `health summarize-change <metric> --a <p> --b <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['summarize-change', 'weight_lbs'],
          flags: { a: 'last_30d', b: 'prev_30d' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            summarizeChange: async (args) => { captured = args; return { changeShape: 'monotonic' }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.metric).toBe('weight_lbs');
    });
  });

  describe('conditional action', () => {
    it('emits JSON for `health conditional <metric> --period <p> --condition <json>`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['conditional', 'weight_lbs'],
          flags: { period: 'last_30d', condition: '{"tracked":true}' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            conditionalAggregate: async (args) => ({
              matching: { value: 197, daysMatched: 15 },
              notMatching: { value: 199, daysNotMatched: 15 },
              delta: -2,
            }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.matching.daysMatched).toBe(15);
    });

    it('exits 2 when --condition missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['conditional', 'weight_lbs'],
          flags: { period: 'last_30d' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });

    it('exits 2 when --condition is malformed JSON', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['conditional', 'weight_lbs'],
          flags: { period: 'last_30d', condition: 'not-json' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe('correlate action', () => {
    it('emits JSON for `health correlate <a> <b> --period <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['correlate', 'weight_lbs', 'calories'],
          flags: { period: 'last_30d', granularity: 'weekly' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            correlateMetrics: async (args) => { captured = args; return { correlation: -0.85, pearson: -0.84, pairs: 4, interpretation: 'strong-negative' }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.metric_a).toBe('weight_lbs');
      expect(captured.metric_b).toBe('calories');
      expect(captured.granularity).toBe('weekly');
    });

    it('exits 2 when second metric missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['correlate', 'weight_lbs'],
          flags: { period: 'last_30d' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
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
