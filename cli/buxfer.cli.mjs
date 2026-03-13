#!/usr/bin/env node

/**
 * Buxfer CLI - Command-line interface for Buxfer financial API
 *
 * Reads credentials from the container data volume via docker exec
 * (data/household/auth/buxfer.yml), or from BUXFER_EMAIL + BUXFER_PASSWORD
 * env vars. All Buxfer API calls go direct — no app server needed.
 *
 * QUICK REFERENCE
 * ───────────────
 *
 *   # See all accounts and their IDs
 *   node cli/buxfer.cli.mjs accounts
 *
 *   # Recent transactions (last 30 days)
 *   node cli/buxfer.cli.mjs txns
 *
 *   # Filter by account, tag, or date range
 *   node cli/buxfer.cli.mjs txns --account "Capital One" --limit 10
 *   node cli/buxfer.cli.mjs txns --tag Groceries --start 2026-01-01
 *
 *   # Add a transaction (get accountId from `accounts` command)
 *   node cli/buxfer.cli.mjs add <accountId> -50.00 "Safeway" --tags Groceries
 *   node cli/buxfer.cli.mjs add <accountId> 8780.00 "Payroll Deposit" --tags Income --type income
 *
 *   # Transfer between accounts
 *   node cli/buxfer.cli.mjs add <fromAccountId> -5000 "Net Pay Transfer" --type transfer --to <toAccountId>
 *
 *   # Rename/retag a transaction (get ID from `txns` output)
 *   node cli/buxfer.cli.mjs update <txnId> --desc "Renamed" --tags "Food,Dining"
 *
 *   # Delete a transaction
 *   node cli/buxfer.cli.mjs delete <txnId>
 *
 *   # View latest paycheck breakdown
 *   node cli/buxfer.cli.mjs payroll
 *
 *   # View a specific paycheck or all paychecks summary
 *   node cli/buxfer.cli.mjs payroll 2026-01-17
 *   node cli/buxfer.cli.mjs payroll --all
 *
 *   # Cached budget-tracked balances (from YAML, no API call)
 *   node cli/buxfer.cli.mjs bal
 *
 *   # Any command with --json for machine-readable output
 *   node cli/buxfer.cli.mjs accounts --json
 *   node cli/buxfer.cli.mjs txns --tag Food --json
 *
 * TIP: Run `accounts` first to get your account IDs, then use them
 * with `add`, `txns --account`, etc.
 *
 * ALIASES
 * ───────
 *   accounts → accts    transactions → txns, tx    update → edit
 *   delete → del, rm    payroll → pay              balances → bal
 *
 * @module cli/buxfer
 */

import { execSync } from 'child_process';

// ============================================================================
// Config: read credentials from container
// ============================================================================

const CONTAINER = 'daylight-station';
const BUXFER_API = 'https://www.buxfer.com/api';

function dockerRead(filePath) {
  try {
    return execSync(
      `sudo docker exec ${CONTAINER} sh -c 'cat ${filePath}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    return null;
  }
}

function parseSimpleYaml(text) {
  // Minimal YAML parser for flat key: value files
  const obj = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([^#][^:]+):\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      obj[key] = val;
    }
  }
  return obj;
}

let _credentials = null;

function getCredentials() {
  if (_credentials) return _credentials;

  // Try env vars first
  if (process.env.BUXFER_EMAIL && process.env.BUXFER_PASSWORD) {
    _credentials = { email: process.env.BUXFER_EMAIL, password: process.env.BUXFER_PASSWORD };
    return _credentials;
  }

  // Read from container
  const raw = dockerRead('data/household/auth/buxfer.yml');
  if (!raw) {
    console.error('Error: Cannot read Buxfer credentials.');
    console.error('Set BUXFER_EMAIL + BUXFER_PASSWORD env vars, or ensure docker container is running.');
    process.exit(1);
  }

  _credentials = parseSimpleYaml(raw);
  if (!_credentials.email || !_credentials.password) {
    console.error('Error: Buxfer credentials missing email or password.');
    process.exit(1);
  }

  return _credentials;
}

// ============================================================================
// Buxfer API Client
// ============================================================================

let _token = null;
let _tokenExpires = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpires) return _token;

  const { email, password } = getCredentials();
  const url = `${BUXFER_API}/login?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data?.response?.token) {
    console.error('Error: Buxfer authentication failed.');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  _token = data.response.token;
  _tokenExpires = Date.now() + 23 * 60 * 60 * 1000;
  return _token;
}

async function buxferGet(endpoint, params = {}) {
  const token = await getToken();
  const qs = new URLSearchParams({ token, ...params }).toString();
  const res = await fetch(`${BUXFER_API}/${endpoint}?${qs}`);
  const data = await res.json();
  return data?.response;
}

async function buxferPost(endpoint, params = {}) {
  const token = await getToken();
  const body = new URLSearchParams({ token, ...params });
  const res = await fetch(`${BUXFER_API}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  return data?.response;
}

// ============================================================================
// Parse CLI args
// ============================================================================

const argv = process.argv.slice(2);

function getFlag(name) {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function hasFlag(name) {
  return argv.includes(`--${name}`);
}

const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    i++; // skip value
  } else {
    positional.push(argv[i]);
  }
}

const command = positional[0];
const commandArgs = positional.slice(1);
const jsonOutput = hasFlag('json');

// ============================================================================
// Formatters
// ============================================================================

function formatMoney(amount) {
  const n = parseFloat(amount);
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function truncate(str, len = 40) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len - 1) + '~' : str;
}

// ============================================================================
// Commands
// ============================================================================

async function cmdAccounts() {
  const response = await buxferGet('accounts');
  const accounts = response?.accounts || [];

  if (jsonOutput) {
    console.log(JSON.stringify(accounts, null, 2));
    return;
  }

  console.log('\nBuxfer Accounts');
  console.log('='.repeat(65));
  console.log(`${'ID'.padEnd(10)} ${'Name'.padEnd(35)} ${'Balance'.padStart(15)}`);
  console.log('-'.repeat(65));

  for (const a of accounts) {
    console.log(`${String(a.id).padEnd(10)} ${truncate(a.name, 35).padEnd(35)} ${formatMoney(a.balance).padStart(15)}`);
  }

  const total = accounts.reduce((s, a) => s + a.balance, 0);
  console.log('-'.repeat(65));
  console.log(`${''.padEnd(10)} ${'TOTAL'.padEnd(35)} ${formatMoney(total).padStart(15)}`);
  console.log();
}

async function cmdTransactions() {
  const startDate = getFlag('start') || defaultStartDate();
  const endDate = getFlag('end') || todayDate();
  const accountName = getFlag('account');
  const tagName = getFlag('tag');
  const limit = parseInt(getFlag('limit') || '25', 10);

  const params = { startDate, endDate };
  if (accountName) params.accountName = accountName;
  if (tagName) params.tagName = tagName;

  let allTxns = [];
  let page = 1;
  let totalCount = Infinity;

  while (allTxns.length < limit && allTxns.length < totalCount) {
    const response = await buxferGet('transactions', { ...params, page });
    const txns = response?.transactions || [];
    if (response?.totalTransactionsCount != null) {
      totalCount = response.totalTransactionsCount;
    }
    allTxns.push(...txns);
    if (txns.length === 0) break;
    page++;
  }

  allTxns = allTxns.slice(0, limit);

  if (jsonOutput) {
    console.log(JSON.stringify(allTxns, null, 2));
    return;
  }

  console.log(`\nTransactions (${startDate} to ${endDate})${accountName ? ` [${accountName}]` : ''}${tagName ? ` #${tagName}` : ''}`);
  console.log('='.repeat(95));
  console.log(
    `${'ID'.padEnd(12)} ${'Date'.padEnd(12)} ${'Amount'.padStart(12)} ${'Description'.padEnd(30)} ${'Tags'.padEnd(20)}`
  );
  console.log('-'.repeat(95));

  for (const t of allTxns) {
    const tags = (t.tagNames || []).join(', ');
    console.log(
      `${String(t.id).padEnd(12)} ${t.date.padEnd(12)} ${formatMoney(t.amount).padStart(12)} ${truncate(t.description, 30).padEnd(30)} ${truncate(tags, 20).padEnd(20)}`
    );
  }

  console.log('-'.repeat(95));
  console.log(`Showing ${allTxns.length} transactions`);
  console.log();
}

async function cmdAdd() {
  const accountId = commandArgs[0];
  const amount = commandArgs[1];
  const description = commandArgs[2] || getFlag('desc');

  if (!accountId || !amount || !description) {
    console.error('Usage: buxfer add <accountId> <amount> <description> [--tags tag1,tag2] [--type expense|income|transfer] [--to accountId]');
    process.exit(1);
  }

  const txType = getFlag('type') || (parseFloat(amount) < 0 ? 'expense' : 'income');
  const toAccountId = getFlag('to');

  const params = {
    amount: Math.abs(parseFloat(amount)).toString(),
    description,
    date: getFlag('date') || todayDate(),
    type: txType,
    status: 'cleared',
  };

  // For transfers, use fromAccountId/toAccountId; for others, use accountId
  if (txType === 'transfer' && toAccountId) {
    params.fromAccountId = accountId;
    params.toAccountId = toAccountId;
  } else {
    params.accountId = accountId;
    if (toAccountId) params.toAccountId = toAccountId;
  }

  const tags = getFlag('tags');
  if (tags) params.tags = tags;

  const result = await buxferPost('transaction_add', params);

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('\nTransaction added:');
  console.log(`  Amount: ${formatMoney(amount)}`);
  console.log(`  Description: ${description}`);
  console.log(`  Account ID: ${accountId}`);
  console.log(`  Date: ${params.date}`);
  console.log(`  Type: ${params.type}`);
  if (tags) console.log(`  Tags: ${tags}`);
  console.log();
}

async function cmdUpdate() {
  const id = commandArgs[0];
  if (!id) {
    console.error('Usage: buxfer update <transactionId> [--desc description] [--tags tag1,tag2] [--memo text]');
    process.exit(1);
  }

  const params = { id };
  const desc = getFlag('desc');
  const tags = getFlag('tags');
  const memo = getFlag('memo');

  if (desc) params.description = desc;
  if (tags) params.tags = tags;
  if (memo) params.memo = memo;

  if (!desc && !tags && !memo) {
    console.error('Error: Provide at least one of --desc, --tags, or --memo');
    process.exit(1);
  }

  const result = await buxferPost('transaction_edit', params);

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\nTransaction ${id} updated:`);
  if (desc) console.log(`  Description: ${desc}`);
  if (tags) console.log(`  Tags: ${tags}`);
  if (memo) console.log(`  Memo: ${memo}`);
  console.log();
}

async function cmdDelete() {
  const id = commandArgs[0];
  if (!id) {
    console.error('Usage: buxfer delete <transactionId>');
    process.exit(1);
  }

  const result = await buxferPost('transaction_delete', { id });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\nTransaction ${id} deleted.`);
  console.log();
}

async function cmdPayroll() {
  const raw = dockerRead('data/household/common/finances/payroll.yml');
  if (!raw) {
    console.error('Error: Cannot read payroll data from container.');
    process.exit(1);
  }

  // Use js-yaml for complex nested YAML
  const yaml = await import('js-yaml');
  const payroll = yaml.default.load(raw);

  if (!payroll?.paychecks) {
    console.error('Error: No payroll data found.');
    process.exit(1);
  }

  const dates = Object.keys(payroll.paychecks).sort((a, b) => b.localeCompare(a));
  const requestedDate = commandArgs[0];

  if (requestedDate) {
    const check = payroll.paychecks[requestedDate];
    if (!check) {
      console.error(`No paycheck found for ${requestedDate}`);
      console.error(`Available dates: ${dates.slice(0, 10).join(', ')}...`);
      process.exit(1);
    }

    if (jsonOutput) {
      console.log(JSON.stringify(check, null, 2));
      return;
    }

    printPaycheck(requestedDate, check);
    return;
  }

  if (hasFlag('all')) {
    if (jsonOutput) {
      console.log(JSON.stringify(payroll.paychecks, null, 2));
      return;
    }

    console.log('\nPayroll History');
    console.log('='.repeat(70));
    console.log(`${'Pay Date'.padEnd(14)} ${'Check Date'.padEnd(14)} ${'Gross'.padStart(14)} ${'Net'.padStart(14)} ${'Taxes'.padStart(14)}`);
    console.log('-'.repeat(70));

    for (const date of dates) {
      const c = payroll.paychecks[date];
      const h = c.header || {};
      const t = c.detail?.totals || {};
      const gross = parseFloat(t.curGross || 0);
      const net = parseFloat(h.netPay || t.curNetPay || 0);
      const taxes = parseFloat(t.curTaxes || 0);
      console.log(
        `${date.padEnd(14)} ${(h.checkDt || '').padEnd(14)} ${formatMoney(gross).padStart(14)} ${formatMoney(net).padStart(14)} ${formatMoney(taxes).padStart(14)}`
      );
    }
    console.log();
    return;
  }

  // Default: latest paycheck
  const latestDate = dates[0];
  if (jsonOutput) {
    console.log(JSON.stringify({ date: latestDate, ...payroll.paychecks[latestDate] }, null, 2));
    return;
  }

  printPaycheck(latestDate, payroll.paychecks[latestDate]);
}

function printPaycheck(date, check) {
  const h = check.header || {};
  const d = check.detail || {};
  const t = d.totals || {};

  console.log(`\nPaycheck: ${date}`);
  console.log('='.repeat(60));
  console.log(`  Employee: ${h.name}`);
  console.log(`  Employer: ${h.employerName}`);
  console.log(`  Title: ${h.businessTitle}`);
  console.log(`  Pay Rate: ${formatMoney(h.payRate)} (${h.payRateDesc})`);
  console.log(`  Period: ${h.earnsBegDt} to ${h.earnsEndDt}`);
  console.log(`  Check Date: ${h.checkDt}`);
  console.log(`  Check #: ${h.checkNumber}`);
  console.log(`  Net Pay: ${formatMoney(h.netPay)}`);

  if (d.earns?.length) {
    console.log('\n  Earnings:');
    for (const e of d.earns) {
      const desc = e.curEarnsDesc || e.desc || 'Unknown';
      const amt = parseFloat(e.curEarnsEarn || 0);
      if (amt) console.log(`    ${desc.padEnd(35)} ${formatMoney(amt).padStart(12)}`);
    }
  }

  if (d.taxWithholdings?.length) {
    console.log('\n  Tax Withholdings:');
    for (const tw of d.taxWithholdings) {
      const desc = tw.taxDesc || tw.desc || 'Unknown';
      const amt = parseFloat(tw.curTaxes || 0);
      if (amt) console.log(`    ${desc.padEnd(35)} ${formatMoney(amt).padStart(12)}`);
    }
  }

  if (d.preTaxDedns?.length) {
    console.log('\n  Pre-Tax Deductions:');
    for (const ded of d.preTaxDedns) {
      const desc = ded.desc || 'Unknown';
      const amt = parseFloat(ded.curDedns || 0);
      if (amt) console.log(`    ${desc.padEnd(35)} ${formatMoney(amt).padStart(12)}`);
    }
  }

  if (d.postTaxDedns?.length) {
    console.log('\n  Post-Tax Deductions:');
    for (const ded of d.postTaxDedns) {
      const desc = ded.desc || 'Unknown';
      const amt = parseFloat(ded.curDedns || 0);
      if (amt) console.log(`    ${desc.padEnd(35)} ${formatMoney(amt).padStart(12)}`);
    }
  }

  console.log('\n  Totals:');
  console.log(`    Gross Pay:      ${formatMoney(t.curGross || 0).padStart(12)}`);
  console.log(`    Total Taxes:    ${formatMoney(t.curTaxes || 0).padStart(12)}`);
  console.log(`    Total Dedns:    ${formatMoney(t.curDedns || 0).padStart(12)}`);
  console.log(`    Net Pay:        ${formatMoney(t.curNetPay || 0).padStart(12)}`);
  console.log();
}

async function cmdBalances() {
  const raw = dockerRead('data/household/common/finances/account.balances.yml');
  if (!raw) {
    console.error('Error: Cannot read account balances from container.');
    process.exit(1);
  }

  const yaml = await import('js-yaml');
  const data = yaml.default.load(raw);
  const balances = data?.accountBalances || [];

  if (jsonOutput) {
    console.log(JSON.stringify(balances, null, 2));
    return;
  }

  console.log('\nCached Account Balances');
  console.log('='.repeat(55));
  console.log(`${'Name'.padEnd(35)} ${'Balance'.padStart(15)}`);
  console.log('-'.repeat(55));

  for (const b of balances) {
    console.log(`${truncate(b.name, 35).padEnd(35)} ${formatMoney(b.balance).padStart(15)}`);
  }
  console.log();
}

// ============================================================================
// Helpers
// ============================================================================

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function defaultStartDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split('T')[0];
}

// ============================================================================
// Help
// ============================================================================

function showHelp() {
  console.log(`
Buxfer CLI - Manage Buxfer financial data

Usage:
  node cli/buxfer.cli.mjs <command> [options]

Commands:
  accounts                          List all accounts with IDs and balances
  transactions                      List recent transactions
  add <accountId> <amount> <desc>   Add a transaction
  update <id>                       Update a transaction
  delete <id>                       Delete a transaction
  payroll [date]                    Show payroll data (latest or specific)
  balances                          Show cached account balances

Aliases:
  accts, txns/tx, edit, del/rm, pay, bal

Transaction Filters:
  --start <YYYY-MM-DD>              Start date (default: 1 month ago)
  --end <YYYY-MM-DD>                End date (default: today)
  --account <name>                  Filter by account name
  --tag <name>                      Filter by tag/category
  --limit <n>                       Max results (default: 25)

Add Options:
  --tags <tag1,tag2>                Comma-separated tags
  --type <expense|income|transfer>  Transaction type (default: auto from sign)
  --date <YYYY-MM-DD>               Date (default: today)
  --to <accountId>                  Transfer destination account

Update Options:
  --desc <description>              New description
  --tags <tag1,tag2>                New tags
  --memo <text>                     New memo

Payroll Options:
  --all                             Show all paychecks summary

Output:
  --json                            Output as JSON

Examples:
  node cli/buxfer.cli.mjs accounts
  node cli/buxfer.cli.mjs txns --account "Checking" --start 2026-01-01
  node cli/buxfer.cli.mjs txns --tag Groceries --limit 10
  node cli/buxfer.cli.mjs add <accountId> -50.00 "Grocery Store" --tags Food,Groceries
  node cli/buxfer.cli.mjs add <accountId> 8780.00 "Payroll" --tags Income --type income
  node cli/buxfer.cli.mjs update <txnId> --desc "Renamed" --tags "Food"
  node cli/buxfer.cli.mjs delete <txnId>
  node cli/buxfer.cli.mjs payroll
  node cli/buxfer.cli.mjs payroll 2026-01-17
  node cli/buxfer.cli.mjs payroll --all
  node cli/buxfer.cli.mjs accounts --json
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'accounts':
      case 'accts':
        await cmdAccounts();
        break;

      case 'transactions':
      case 'txns':
      case 'tx':
        await cmdTransactions();
        break;

      case 'add':
        await cmdAdd();
        break;

      case 'update':
      case 'edit':
        await cmdUpdate();
        break;

      case 'delete':
      case 'del':
      case 'rm':
        await cmdDelete();
        break;

      case 'payroll':
      case 'pay':
        await cmdPayroll();
        break;

      case 'balances':
      case 'bal':
        await cmdBalances();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
}

main();
