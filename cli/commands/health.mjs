/**
 * dscli health — health analytics surface (Plans 1-2).
 *
 * Plan 1 actions:
 *   dscli health aggregate <metric> --period <shorthand> [--statistic <s>] [--user <id>]
 *
 * Plan 2 actions:
 *   dscli health compare <metric> --a <p> --b <p>
 *   dscli health summarize-change <metric> --a <p> --b <p>
 *   dscli health conditional <metric> --period <p> --condition <json>
 *   dscli health correlate <metric_a> <metric_b> --period <p>
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

Actions (Plans 1-2):
  aggregate <metric>                    Single-value summary over a period.
  compare <metric>                      Compare metric across two periods (--a, --b).
  summarize-change <metric>             Richer compare with shape classification.
  conditional <metric>                  Split metric by condition (--condition <json>).
  correlate <metric_a> <metric_b>       Spearman/Pearson correlation across a period.

Period shorthand (--period, --a, --b, or --from/--to):
  last_7d / last_30d / last_90d / last_180d / last_365d / last_2y / last_5y / last_10y / all_time
  prev_7d / prev_30d / prev_90d / prev_180d / prev_365d
  this_week / this_month / this_quarter / this_year / last_quarter / last_year
  YYYY / YYYY-MM / YYYY-Qn

Other flags:
  --statistic <name>     mean (default) | median | min | max | count | sum | p25 | p75 | stdev
  --user <id>            override user id (defaults to $DSCLI_USER_ID or 'default')
  --from / --to          explicit YYYY-MM-DD bounds (overrides --period)
  --condition <json>     JSON condition for 'conditional' action
  --granularity <g>      daily (default) | weekly | monthly | quarterly | yearly (correlate)

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

function parseCondition(rawJson) {
  try { return JSON.parse(rawJson); }
  catch (err) { throw new Error(`invalid JSON in --condition: ${err.message}`); }
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

async function actionCompare(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health compare: missing required <metric>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  let period_a, period_b;
  try {
    period_a = args.flags.a ? parsePeriodFlag(args.flags.a) : null;
    period_b = args.flags.b ? parsePeriodFlag(args.flags.b) : null;
  } catch (err) {
    printError(deps.stderr, { error: 'invalid_period', message: err.message });
    return { exitCode: EXIT_USAGE };
  }
  if (!period_a || !period_b) {
    printError(deps.stderr, { error: 'period_required', message: 'pass --a <shorthand> and --b <shorthand>.' });
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
    result = await svc.compare({
      userId: resolveUserId(args),
      metric, period_a, period_b,
      statistic: args.flags.statistic,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'compare_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionSummarizeChange(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health summarize-change: missing required <metric>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  let period_a, period_b;
  try {
    period_a = args.flags.a ? parsePeriodFlag(args.flags.a) : null;
    period_b = args.flags.b ? parsePeriodFlag(args.flags.b) : null;
  } catch (err) {
    printError(deps.stderr, { error: 'invalid_period', message: err.message });
    return { exitCode: EXIT_USAGE };
  }
  if (!period_a || !period_b) {
    printError(deps.stderr, { error: 'period_required', message: 'pass --a <shorthand> and --b <shorthand>.' });
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
    result = await svc.summarizeChange({
      userId: resolveUserId(args),
      metric, period_a, period_b,
      statistic: args.flags.statistic,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'summarize_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionConditional(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health conditional: missing required <metric>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  if (!args.flags.condition) {
    printError(deps.stderr, { error: 'condition_required', message: 'pass --condition <json>.' });
    return { exitCode: EXIT_USAGE };
  }
  let condition;
  try { condition = parseCondition(args.flags.condition); }
  catch (err) {
    printError(deps.stderr, { error: 'invalid_condition', message: err.message });
    return { exitCode: EXIT_USAGE };
  }
  let period;
  try {
    period = args.flags.from && args.flags.to
      ? { from: args.flags.from, to: args.flags.to }
      : args.flags.period ? parsePeriodFlag(args.flags.period) : null;
  } catch (err) {
    printError(deps.stderr, { error: 'invalid_period', message: err.message });
    return { exitCode: EXIT_USAGE };
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
    result = await svc.conditionalAggregate({
      userId: resolveUserId(args),
      metric, period, condition,
      statistic: args.flags.statistic,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'conditional_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionCorrelate(args, deps) {
  const metric_a = args.positional[1];
  const metric_b = args.positional[2];
  if (!metric_a || !metric_b) {
    deps.stderr.write('dscli health correlate: requires <metric_a> <metric_b>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  let period;
  try {
    period = args.flags.from && args.flags.to
      ? { from: args.flags.from, to: args.flags.to }
      : args.flags.period ? parsePeriodFlag(args.flags.period) : null;
  } catch (err) {
    printError(deps.stderr, { error: 'invalid_period', message: err.message });
    return { exitCode: EXIT_USAGE };
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
    result = await svc.correlateMetrics({
      userId: resolveUserId(args),
      metric_a, metric_b,
      period,
      granularity: args.flags.granularity || 'daily',
    });
  } catch (err) {
    printError(deps.stderr, { error: 'correlate_failed', message: err.message });
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
  compare: actionCompare,
  'summarize-change': actionSummarizeChange,
  conditional: actionConditional,
  correlate: actionCorrelate,
};

export default {
  name: 'health',
  description: 'Health analytics: aggregate, compare, summarize-change, conditional, correlate (Plans 1-2)',
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
