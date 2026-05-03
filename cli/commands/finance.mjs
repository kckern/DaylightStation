/**
 * dscli finance — finance operations via Buxfer.
 *
 * Actions:
 *   dscli finance accounts   — List Buxfer accounts with balances.
 *
 * Auth from data/household/auth/buxfer.yml.
 */

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG, EXIT_BACKEND } from '../_output.mjs';

function backendUrl() {
  return process.env.DSCLI_BACKEND_URL || 'http://localhost:3111';
}

const HELP = `
dscli finance — finance operations

Usage:
  dscli finance <action> [flags]

Actions:
  accounts    List Buxfer accounts with balances.
              Returns: { accounts, count, total }
  balance <name>
              Single account by name (exact then substring match).
              Returns: { account }
  transactions [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--account NAME] [--tag NAME]
              List transactions, optionally filtered.
              Returns: { transactions, count }
  refresh --allow-write
              Trigger full Buxfer refresh on the running backend
              (POST /api/v1/finance/refresh). Audited.
`.trimStart();

async function actionAccounts(args, deps) {
  let buxfer;
  try {
    buxfer = await deps.getBuxfer();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let accounts;
  try {
    accounts = await buxfer.getAccounts();
  } catch (err) {
    printError(deps.stderr, { error: 'buxfer_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  accounts = Array.isArray(accounts) ? accounts : [];
  const total = accounts.reduce((sum, a) => sum + Number(a.balance ?? 0), 0);

  printJson(deps.stdout, {
    accounts,
    count: accounts.length,
    total,
  });
  return { exitCode: EXIT_OK };
}

async function actionBalance(args, deps) {
  const name = args.positional.slice(1).join(' ').trim();
  if (!name) {
    deps.stderr.write('dscli finance balance: missing required <name>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  let buxfer;
  try {
    buxfer = await deps.getBuxfer();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  let accounts;
  try {
    accounts = await buxfer.getAccounts();
  } catch (err) {
    printError(deps.stderr, { error: 'buxfer_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  const needle = name.toLowerCase();
  let match = accounts.find((a) => a.name?.toLowerCase() === needle);
  if (!match) {
    match = accounts.find((a) => a.name?.toLowerCase().includes(needle));
  }

  if (!match) {
    printError(deps.stderr, { error: 'not_found', name });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, { account: match });
  return { exitCode: EXIT_OK };
}

async function actionTransactions(args, deps) {
  let buxfer;
  try {
    buxfer = await deps.getBuxfer();
  } catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_CONFIG };
  }

  const opts = {};
  if (args.flags.from) opts.startDate = args.flags.from;
  if (args.flags.to) opts.endDate = args.flags.to;
  if (args.flags.account) opts.accounts = args.flags.account;
  if (args.flags.tag) opts.tagName = args.flags.tag;

  let transactions;
  try {
    transactions = await buxfer.getTransactions(opts);
  } catch (err) {
    printError(deps.stderr, { error: 'buxfer_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  transactions = Array.isArray(transactions) ? transactions : [];
  printJson(deps.stdout, { transactions, count: transactions.length });
  return { exitCode: EXIT_OK };
}

async function actionRefresh(args, deps) {
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'finance refresh', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }

  const url = backendUrl() + '/api/v1/finance/refresh';
  const fetchFn = deps.fetch || globalThis.fetch;

  let response;
  try {
    response = await fetchFn(url, { method: 'POST' });
  } catch (err) {
    printError(deps.stderr, { error: 'backend_unreachable', url, message: err.message });
    return { exitCode: EXIT_BACKEND };
  }

  if (!response.ok) {
    printError(deps.stderr, { error: 'backend_unhealthy', url, status: response.status });
    return { exitCode: EXIT_BACKEND };
  }

  let body = {};
  try { body = await response.json(); } catch {}

  try {
    const audit = await deps.getWriteAuditor();
    await audit.log({ command: 'finance', action: 'refresh', args: {}, result: body });
  } catch {}

  printJson(deps.stdout, { ok: true, ...body });
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  accounts: actionAccounts,
  balance: actionBalance,
  transactions: actionTransactions,
  refresh: actionRefresh,
};

export default {
  name: 'finance',
  description: 'Finance operations via Buxfer',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }

    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli finance: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }

    return ACTIONS[action](args, deps);
  },
};
