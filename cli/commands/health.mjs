/**
 * dscli health — health analytics surface (Plan 1 foundation).
 *
 * Plan 1 actions:
 *   dscli health aggregate <metric> --period <shorthand> [--statistic <s>] [--user <id>]
 *
 * Subsequent plans add: aggregate-series, distribution, percentile, snapshot,
 * compare, summarize-change, conditional, correlate, trajectory, regime-change,
 * anomalies, sustained, periods *, deduce, analyze.
 *
 * Period shorthand:
 *   bare token        → rolling: 'last_30d', 'last_year', 'prev_30d', 'all_time'
 *   YYYY              → calendar: { calendar: '2024' }
 *   YYYY-MM           → calendar: { calendar: '2024-08' }
 *   YYYY-Qn           → calendar: { calendar: '2024-Q3' }
 *   --from / --to     → explicit { from, to } (highest precedence)
 *
 * (Named and deduced shorthand land in Plan 4.)
 */

import { printJson, printError, EXIT_OK, EXIT_USAGE, EXIT_FAIL } from '../_output.mjs';

const HELP = `
dscli health — health analytics surface

Usage:
  dscli health <action> [args] [flags]

Actions (Plan 1):
  aggregate <metric>     Single-value summary of a metric over a period.
                         Returns: { metric, period, statistic, value, unit,
                                    daysCovered, daysInPeriod }
                         Required flag: --period <shorthand> OR --from / --to

Future actions (later plans): aggregate-series, distribution, percentile,
  snapshot, compare, summarize-change, conditional, correlate, trajectory,
  regime-change, anomalies, sustained, periods (list/deduce/remember/forget),
  analyze.

Period shorthand (--period):
  last_7d / last_30d / last_90d / last_180d / last_365d / last_2y / last_5y / last_10y / all_time
  prev_7d / prev_30d / prev_90d / prev_180d / prev_365d
  this_week / this_month / this_quarter / this_year / last_quarter / last_year
  YYYY / YYYY-MM / YYYY-Qn

Other flags:
  --statistic <name>     mean (default) | median | min | max | count | sum | p25 | p75 | stdev
  --user <id>            override user id (defaults to $DSCLI_USER_ID or 'default')
  --from / --to          explicit YYYY-MM-DD bounds (overrides --period)

Environment:
  DSCLI_USER_ID          default user id when --user not provided
`.trimStart();

/**
 * Translate a CLI period shorthand into the polymorphic period input the
 * domain layer accepts. Returns the period object or throws on syntax errors.
 */
function parsePeriodFlag(shorthand) {
  if (!shorthand || typeof shorthand !== 'string') return null;
  const s = shorthand.trim();

  // Rolling: last_*, prev_*, all_time
  if (s === 'all_time' || /^(last|prev)_\d+[dy]$/.test(s)) {
    return { rolling: s };
  }

  // Calendar named labels
  const CALENDAR_LABELS = ['this_week', 'this_month', 'this_quarter', 'this_year', 'last_quarter', 'last_year'];
  if (CALENDAR_LABELS.includes(s)) {
    return { calendar: s };
  }

  // Calendar absolute: YYYY, YYYY-MM, YYYY-Qn
  if (/^\d{4}$/.test(s) || /^\d{4}-\d{2}$/.test(s) || /^\d{4}-Q[1-4]$/.test(s)) {
    return { calendar: s };
  }

  throw new Error(`unknown period shorthand "${shorthand}"`);
}

function resolveUserId(args) {
  if (args.flags.user) return args.flags.user;
  if (process.env.DSCLI_USER_ID) return process.env.DSCLI_USER_ID;
  return 'default';
}

async function actionAggregate(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health aggregate: missing required <metric>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  // Period: --from/--to wins, else --period shorthand.
  let period;
  if (args.flags.from && args.flags.to) {
    period = { from: args.flags.from, to: args.flags.to };
  } else if (args.flags.period) {
    try { period = parsePeriodFlag(args.flags.period); }
    catch (err) {
      printError(deps.stderr, { error: 'invalid_period', message: err.message });
      return { exitCode: EXIT_USAGE };
    }
  }
  if (!period) {
    printError(deps.stderr, { error: 'period_required', message: 'pass --period <shorthand> or --from / --to.' });
    return { exitCode: EXIT_USAGE };
  }

  let svc;
  try { svc = await deps.getHealthAnalytics(); }
  catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  let result;
  try {
    result = await svc.aggregate({
      userId: resolveUserId(args),
      metric,
      period,
      statistic: args.flags.statistic,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'aggregate_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  aggregate: actionAggregate,
};

export default {
  name: 'health',
  description: 'Health analytics: aggregate (Plan 1)',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }
    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli health: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }
    return ACTIONS[action](args, deps);
  },
};
