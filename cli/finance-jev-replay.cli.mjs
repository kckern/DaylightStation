#!/usr/bin/env node
/**
 * finance-jev-replay: measure the Jev category judge against transactions
 * the household has already tagged. Read-only: nothing is written to the
 * finance provider (Buxfer is never constructed) or the finance store (only
 * its read methods are exposed), and Jev calls are not recorded in the AI
 * usage ledger.
 *
 * Prod shadow (categorization.jev.compare) sees ~26 decisions a week and the
 * log store keeps 7 days, so this replay is the main promotion evidence.
 * Stored descriptions are already cleaned friendly names, which is easier
 * than the raw descriptions Jev sees live: treat results as an upper bound.
 *
 * Usage: node cli/finance-jev-replay.cli.mjs [--period YYYY-MM-DD] [--limit 200] [--floor 0.8] [--household <id>]
 *
 * Exit codes (cli/_output.mjs): 0 ok, 1 unexpected failure, 2 usage, 3 config
 * (no Jev key, no validTags, no period), 4 every judgement failed (bad key, Jev down).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TransactionCategoryJudge } from '#apps/finance/TransactionCategoryJudge.mjs';
import { EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG, EXIT_BACKEND, printError } from './_output.mjs';

const USAGE = 'Usage: node cli/finance-jev-replay.cli.mjs [--period YYYY-MM-DD] [--limit 200] [--floor 0.8] [--household <id>]\n'
  + '  --period     budget period (default: the latest one with transactions)\n'
  + '  --limit      max tagged transactions to judge (default 200)\n'
  + '  --floor      confidence floor for coverage / agreementAtFloor (default 0.8)\n'
  + '  --household  household id (default: the configured default)\n';

class UsageError extends Error {}
class ConfigError extends Error {}

export function summarize(rows, floor) {
  const judged = rows.filter(r => r.jevCategory != null);
  // Number.isFinite: a null confidence is never confident (null >= 0 is true in JS)
  const confident = judged.filter(r => Number.isFinite(r.confidence) && r.confidence >= floor);
  const rate = (list) => (list.length ? list.filter(r => r.jevCategory === r.tag).length / list.length : null);
  const counts = {};
  for (const r of confident) {
    if (r.jevCategory === r.tag) continue;
    const key = `${r.tag} -> ${r.jevCategory}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const cjk = judged.filter(r => r.cjk);
  // Which model was measured: the replay uses the adapter's default model,
  // which may differ from a household `decision` integration's pin in prod.
  const models = {};
  for (const r of judged) {
    const model = r.model ?? 'unknown';
    models[model] = (models[model] || 0) + 1;
  }
  return {
    total: rows.length,
    judged: judged.length,
    agreement: rate(judged),
    confident: confident.length,
    coverage: rows.length ? confident.length / rows.length : null,
    agreementAtFloor: rate(confident),
    cjk: { judged: cjk.length, agreement: rate(cjk) },
    disagreements: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15),
    models,
  };
}

export async function runReplay({ transactions, validTags, judge, floor = 0.8, limit = 200 }) {
  const sample = transactions
    .filter(t => t.tagNames?.length === 1 && validTags.includes(t.tagNames[0]))
    .slice(0, limit);
  const rows = [];
  for (const txn of sample) {
    const verdict = await judge.judge(txn, validTags);
    rows.push({
      id: txn.id, tag: txn.tagNames[0],
      jevCategory: verdict?.category ?? null, confidence: verdict?.confidence ?? null, cjk: verdict?.cjk ?? false,
      model: verdict?.model ?? null,
    });
  }
  return summarize(rows, floor);
}

export function parseArgs(argv) {
  const options = { period: null, limit: 200, floor: 0.8, household: null, help: false };
  const value = (flag, i) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else if (flag === '--period') {
      options.period = value(flag, i); i += 1;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.period)) throw new UsageError('--period must be YYYY-MM-DD');
    } else if (flag === '--limit') {
      options.limit = Number(value(flag, i)); i += 1;
      if (!Number.isInteger(options.limit) || options.limit < 1) throw new UsageError('--limit must be a positive integer');
    } else if (flag === '--floor') {
      options.floor = Number(value(flag, i)); i += 1;
      if (!Number.isFinite(options.floor) || options.floor < 0 || options.floor > 1) {
        throw new UsageError('--floor must be a number between 0 and 1');
      }
    } else if (flag === '--household') {
      options.household = value(flag, i); i += 1;
    } else {
      throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  return options;
}

/** The real runtime: config, a read-only view of the finance store, and a Jev gateway factory. */
async function loadRealRuntime() {
  const { default: dotenv } = await import('dotenv');
  // _bootstrap reads DAYLIGHT_BASE_PATH but never loads .env; existing env wins.
  dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true });
  const [{ getConfigService }, { YamlFinanceDatastore }, { JevAdapter }, { default: axios }] = await Promise.all([
    import('./_bootstrap.mjs'),
    import('#adapters/persistence/yaml/YamlFinanceDatastore.mjs'),
    import('#adapters/ai/JevAdapter.mjs'),
    import('axios'),
  ]);
  const configService = await getConfigService();
  const datastore = new YamlFinanceDatastore({ configService });
  const store = {
    getCategorizationConfig: (hid) => datastore.getCategorizationConfig(hid),
    listBudgetPeriods: (hid) => datastore.listBudgetPeriods(hid),
    getTransactions: (period, hid) => datastore.getTransactions(period, hid),
  };
  // No aiUsageLedger: the replay must not write anywhere.
  const createDecisionGateway = ({ apiKey, logger }) => new JevAdapter({ apiKey }, { httpClient: axios, logger });
  return { configService, store, createDecisionGateway };
}

/**
 * @returns {Promise<number>} exit code
 */
export async function main(argv, { loadRuntime = loadRealRuntime, stdout = process.stdout, stderr = process.stderr } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    printError(stderr, { error: error.message, usage: USAGE.split('\n')[0] });
    return EXIT_USAGE;
  }
  if (options.help) {
    stdout.write(USAGE);
    return EXIT_OK;
  }

  try {
    const { configService, store, createDecisionGateway } = await loadRuntime();
    const apiKey = configService.getSystemAuth('jev', 'api_key');
    if (!apiKey) throw new ConfigError('No Jev key: system auth jev.api_key is not set, so nothing can be judged');

    const householdId = options.household || configService.getDefaultHouseholdId();
    const { validTags } = store.getCategorizationConfig(householdId) || {};
    if (!validTags?.length) throw new ConfigError(`No categorization config (validTags) for household ${householdId}`);
    const period = options.period || store.listBudgetPeriods(householdId).at(-1);
    if (!period) throw new ConfigError(`No budget period with transactions for household ${householdId}`);
    const transactions = store.getTransactions(period, householdId) || [];

    // Collect judge failures so a bad key reads as an error, not as 0% agreement.
    const judgeErrors = {};
    const logger = {
      info() {}, debug() {}, error() {},
      warn(event, data) {
        if (event === 'categorization.jev.failed') judgeErrors[data?.error] = (judgeErrors[data?.error] || 0) + 1;
      },
      child() { return logger; },
    };
    const judge = new TransactionCategoryJudge({ decisionGateway: createDecisionGateway({ apiKey, logger }), logger });
    const summary = await runReplay({ transactions, validTags, judge, floor: options.floor, limit: options.limit });

    if (summary.total > 0 && summary.judged === 0) {
      printError(stderr, { error: `No transaction was judged (${summary.total} tried)`, householdId, period, judgeErrors });
      return EXIT_BACKEND;
    }
    stdout.write(`${JSON.stringify({ householdId, period, floor: options.floor, ...summary, judgeErrors }, null, 2)}\n`);
    return EXIT_OK;
  } catch (error) {
    printError(stderr, { error: error.message });
    return error instanceof ConfigError ? EXIT_CONFIG : EXIT_FAIL;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
