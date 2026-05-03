/**
 * dscli finance — finance operations via Buxfer.
 *
 * Actions:
 *   dscli finance accounts   — List Buxfer accounts with balances.
 *
 * Auth from data/household/auth/buxfer.yml.
 */

import { printJson, printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG } from '../_output.mjs';

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

const ACTIONS = {
  accounts: actionAccounts,
  balance: actionBalance,
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
