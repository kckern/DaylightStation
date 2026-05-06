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

  describe('trajectory action', () => {
    it('emits JSON for `health trajectory <metric> --period <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['trajectory', 'weight_lbs'],
          flags: { period: 'last_90d', granularity: 'weekly' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            trajectory: async (args) => { captured = args; return { slope: -0.1, direction: 'down', rSquared: 0.95 }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.granularity).toBe('weekly');
    });
  });

  describe('regime-change action', () => {
    it('emits JSON for `health regime-change <metric> --period <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['regime-change', 'weight_lbs'],
          flags: { period: 'last_2y', 'max-results': '5' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            detectRegimeChange: async () => ({ changes: [{ date: '2024-08-15', confidence: 0.8, magnitude: 2.5 }] }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.changes.length).toBe(1);
    });
  });

  describe('anomalies action', () => {
    it('emits JSON for `health anomalies <metric> --period <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['anomalies', 'workout_calories'],
          flags: { period: 'last_90d' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            detectAnomalies: async () => ({ anomalies: [], count: 0 }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
    });

    it('passes z-score threshold flag', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      await health.run(
        {
          subcommand: 'health',
          positional: ['anomalies', 'weight_lbs'],
          flags: { period: 'last_90d', 'z-threshold': '3' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            detectAnomalies: async (args) => { captured = args; return { anomalies: [], count: 0 }; },
          }),
        },
      );
      expect(captured.zScore_threshold).toBe(3);
    });
  });

  describe('sustained action', () => {
    it('emits JSON for `health sustained <metric> --period <p> --condition <json> --min-duration-days <n>`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['sustained', 'weight_lbs'],
          flags: { period: 'last_year', condition: '{"value_range":[193,197]}', 'min-duration-days': '30' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            detectSustained: async (args) => { captured = args; return { runs: [] }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.condition).toEqual({ value_range: [193, 197] });
      expect(captured.min_duration_days).toBe(30);
    });

    it('exits 2 when --min-duration-days missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['sustained', 'weight_lbs'],
          flags: { period: 'last_year', condition: '{"value_range":[193,197]}' },
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

  describe('periods list action', () => {
    it('emits JSON for `health periods list`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: ['periods', 'list'], flags: {}, help: false },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            listPeriods: async () => ({ periods: [
              { slug: 'cut-2024', label: '2024 Cut', from: '2024-01-01', to: '2024-04-30', source: 'declared' },
            ] }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.periods).toHaveLength(1);
    });
  });

  describe('periods deduce action', () => {
    it('emits JSON for `health periods deduce --metric weight_lbs --range 193 197 --min-duration-days 30`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'deduce'],
          flags: { metric: 'weight_lbs', range: '193 197', 'min-duration-days': '30' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            deducePeriod: async (args) => { captured = args; return { candidates: [] }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.criteria).toEqual({
        metric: 'weight_lbs',
        value_range: [193, 197],
        min_duration_days: 30,
      });
    });

    it('exits 2 when --metric or --min-duration-days missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: ['periods', 'deduce'], flags: { metric: 'weight_lbs' }, help: false },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe('periods remember action', () => {
    it('requires --allow-write', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'remember'],
          flags: { slug: 'stable', from: '2024-01-01', to: '2024-12-31', label: 'Stable' },
          help: false,
        },
        { stdout, stderr, allowWrite: false, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/allow_write_required/);
    });

    it('calls service.rememberPeriod when --allow-write set', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'remember'],
          flags: { slug: 'stable', from: '2024-01-01', to: '2024-12-31', label: 'Stable' },
          help: false,
        },
        {
          stdout, stderr, allowWrite: true,
          getHealthAnalytics: async () => ({
            rememberPeriod: async (args) => { captured = args; return { slug: args.slug }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.slug).toBe('stable');
    });
  });

  describe('periods forget action', () => {
    it('requires --allow-write', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'forget'],
          flags: { slug: 'stable' },
          help: false,
        },
        { stdout, stderr, allowWrite: false, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });

    it('calls service.forgetPeriod when --allow-write set', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'forget'],
          flags: { slug: 'stable' },
          help: false,
        },
        {
          stdout, stderr, allowWrite: true,
          getHealthAnalytics: async () => ({
            forgetPeriod: async (args) => { captured = args; return { slug: args.slug, removed: true }; },
          }),
        },
      );
      expect(captured.slug).toBe('stable');
    });
  });

  describe('analyze action', () => {
    it('emits JSON for `health analyze`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: ['analyze'], flags: {}, help: false },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            analyzeHistory: async () => ({
              summary: { metrics: [{ metric: 'weight_lbs', value: 195 }] },
              candidates: [],
              observations: ['weight_lbs flat across all_time'],
            }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.observations).toHaveLength(1);
    });

    it('passes --focus through', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      await health.run(
        { subcommand: 'health', positional: ['analyze'], flags: { focus: 'weight' }, help: false },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            analyzeHistory: async (args) => { captured = args; return { summary: { metrics: [] }, candidates: [], observations: [] }; },
          }),
        },
      );
      expect(captured.focus).toBe('weight');
    });
  });
});
