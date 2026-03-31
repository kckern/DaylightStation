#!/usr/bin/env node

/**
 * mortgage-cost-of-capital.cli.mjs
 *
 * Calculate the true cost of withholding money from the mortgage.
 *
 * If you have $X today and choose NOT to put it toward principal,
 * how much extra interest will you pay over the remaining life of the loan?
 *
 * Reads mortgage config from budget.config.yml and live balance from the finance API.
 *
 * Usage:
 *   node cli/mortgage-cost-of-capital.cli.mjs [amount...]
 *   node cli/mortgage-cost-of-capital.cli.mjs 1000
 *   node cli/mortgage-cost-of-capital.cli.mjs 500 1000 2500
 *   node cli/mortgage-cost-of-capital.cli.mjs --rate 5.5 --balance 200000 --payment 3000
 *
 * @module cli/mortgage-cost-of-capital
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { hostname } from 'os';

// ============================================================================
// Config resolution
// ============================================================================

const CONTAINER = 'daylight-station';

function dockerRead(filePath) {
  try {
    return execSync(
      `sudo -n docker exec ${CONTAINER} sh -c 'cat ${filePath}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    return null;
  }
}

function loadYaml(text) {
  try { return yaml.load(text); } catch { return null; }
}

/**
 * Resolve the app port from system config
 */
function getAppPort() {
  const envName = hostname();
  const sources = [];

  // Try DAYLIGHT_BASE_PATH env var
  if (process.env.DAYLIGHT_BASE_PATH) {
    sources.push(join(process.env.DAYLIGHT_BASE_PATH, 'data', 'system', 'config', 'system.yml'));
  }

  // Try .env file
  try {
    const envFile = readFileSync(join(process.cwd(), '.env'), 'utf-8');
    const match = envFile.match(/DAYLIGHT_BASE_PATH=(.+)/);
    if (match) sources.push(join(match[1].trim(), 'data', 'system', 'config', 'system.yml'));
  } catch { /* ignore */ }

  for (const configPath of sources) {
    if (!existsSync(configPath)) continue;
    try {
      const config = loadYaml(readFileSync(configPath, 'utf-8'));
      const ports = config?.app?.ports;
      if (ports) {
        const hostPort = ports[envName];
        const dockerPort = ports.docker ?? ports.default;
        if (hostPort && hostPort !== dockerPort) return [hostPort, dockerPort];
        return [dockerPort];
      }
      if (config?.app?.port) return [config.app.port];
    } catch { /* ignore */ }
  }

  // Fall back to container config
  const containerConfig = dockerRead('data/system/config/system.yml');
  if (containerConfig) {
    const config = loadYaml(containerConfig);
    const ports = config?.app?.ports;
    if (ports) {
      // Return both host-specific and docker ports so caller can try both
      const hostPort = ports[envName];
      const dockerPort = ports.docker ?? ports.default;
      if (hostPort && hostPort !== dockerPort) return [hostPort, dockerPort];
      return [dockerPort];
    }
    if (config?.app?.port) return [config.app.port];
  }

  return null;
}

/**
 * Read mortgage config from budget.config.yml
 */
function readMortgageConfig() {
  const raw = dockerRead('data/household/common/finances/budget.config.yml');
  if (!raw) return null;

  const config = loadYaml(raw);
  if (!config?.mortgage) return null;

  return {
    rate: config.mortgage.interestRate,
    payment: config.mortgage.minimumPayment,
  };
}

/**
 * Fetch live mortgage balance from the finance API
 */
async function fetchLiveData(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/v1/finance/data`, {
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!data.mortgage) return null;
    return {
      balance: data.mortgage.balance,
      rate: data.mortgage.interestRate,
      payment: data.mortgage.minimumPayment,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Amortization
// ============================================================================

function amortize(balance, monthlyRate, payment) {
  let totalInterest = 0;
  let months = 0;

  while (balance > 0.01 && months < 600) {
    const interest = balance * monthlyRate;
    totalInterest += interest;
    const principal = Math.min(payment - interest, balance);
    balance -= principal;
    months++;
  }

  return { totalInterest, months };
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { amounts: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--rate') opts.rate = parseFloat(args[++i]);
    else if (arg === '--balance') opts.balance = parseFloat(args[++i]);
    else if (arg === '--payment') opts.payment = parseFloat(args[++i]);
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else if (!isNaN(parseFloat(arg))) opts.amounts.push(parseFloat(arg));
  }

  if (!opts.amounts.length) opts.amounts = [1000, 2000, 5000, 10000];
  return opts;
}

function printHelp() {
  console.log(`
mortgage-cost-of-capital — what does spending $X cost you in mortgage interest?

Reads mortgage config from budget.config.yml and live balance from the finance API.
Override any value with CLI flags.

Usage:
  node cli/mortgage-cost-of-capital.cli.mjs [amount...] [options]

Arguments:
  amount        Dollar amount(s) withheld from mortgage (default: 1000 2000 5000 10000)

Options:
  --rate N      Override annual interest rate (percent)
  --balance N   Override current mortgage balance
  --payment N   Override monthly payment amount
  --help        Show this help

Examples:
  node cli/mortgage-cost-of-capital.cli.mjs 1000
  node cli/mortgage-cost-of-capital.cli.mjs 500 1000 2500
  node cli/mortgage-cost-of-capital.cli.mjs --rate 2.0 --balance 350000 --payment 1800
  `);
}

async function main() {
  const opts = parseArgs();

  const mortgageConfig = readMortgageConfig();
  const ports = getAppPort() || [];

  let liveData = null;
  for (const port of ports) {
    liveData = await fetchLiveData(port);
    if (liveData) break;
  }

  // Layer: CLI flags > API live data > config file
  const rate = opts.rate
    ?? (liveData?.rate != null ? liveData.rate * 100 : null)
    ?? (mortgageConfig?.rate != null ? mortgageConfig.rate * 100 : null);

  const balance = opts.balance ?? liveData?.balance;
  const payment = opts.payment ?? liveData?.payment ?? mortgageConfig?.payment;

  if (!rate || !balance || !payment) {
    const missing = [];
    if (!rate) missing.push('--rate');
    if (!balance) missing.push('--balance');
    if (!payment) missing.push('--payment');
    console.error(`Could not resolve: ${missing.join(', ')}`);
    console.error('Provide manually or ensure the finance API is running.');
    process.exit(1);
  }

  const sources = [];
  if (liveData) sources.push('API');
  if (mortgageConfig) sources.push('config');
  if (opts.rate || opts.balance || opts.payment) sources.push('CLI overrides');
  console.log(`  Sources: ${sources.join(' + ')}`);

  const monthlyRate = (rate / 100) / 12;

  console.log(`  Mortgage: $${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} at ${rate}%, $${payment.toLocaleString()}/mo`);
  console.log();

  const baseline = amortize(balance, monthlyRate, payment);

  console.log(`  Baseline: ${baseline.months} months to payoff, $${Math.round(baseline.totalInterest).toLocaleString()} total interest`);
  console.log();
  console.log(`  ${'Amount'.padStart(10)}  ${'Extra Interest'.padStart(14)}  ${'Extra Months'.padStart(12)}  ${'Cost per $1'.padStart(12)}  Note`);
  console.log(`  ${'-'.repeat(10)}  ${'-'.repeat(14)}  ${'-'.repeat(12)}  ${'-'.repeat(12)}  ${'-'.repeat(30)}`);

  for (const amount of opts.amounts) {
    const scenario = amortize(balance + amount, monthlyRate, payment);
    const extraInterest = scenario.totalInterest - baseline.totalInterest;
    const extraMonths = scenario.months - baseline.months;
    const costPerDollar = extraInterest / amount;

    const note = extraInterest > amount ? 'costs MORE than you spent'
      : extraInterest > amount * 0.5 ? 'costs >50% of what you spent'
      : extraInterest > amount * 0.25 ? 'costs >25% of what you spent'
      : '';

    console.log(
      `  $${amount.toLocaleString().padStart(9)}` +
      `  $${Math.round(extraInterest).toLocaleString().padStart(13)}` +
      `  ${extraMonths.toString().padStart(12)}` +
      `  $${costPerDollar.toFixed(2).padStart(11)}` +
      `  ${note}`
    );
  }

  console.log();
  console.log(`  Cost of withholding $${opts.amounts[0].toLocaleString()} at different points in the loan:`);
  console.log();
  console.log(`  ${'Balance'.padStart(12)}  ${'Extra Interest'.padStart(14)}  ${'Cost per $1'.padStart(12)}`);
  console.log(`  ${'-'.repeat(12)}  ${'-'.repeat(14)}  ${'-'.repeat(12)}`);

  const refAmount = opts.amounts[0];
  const checkpoints = [balance];
  for (const pct of [0.75, 0.50, 0.25, 0.10]) {
    const b = Math.round(balance * pct);
    if (b > refAmount) checkpoints.push(b);
  }
  checkpoints.sort((a, b) => b - a);

  for (const b of checkpoints) {
    const base = amortize(b, monthlyRate, payment);
    const with_ = amortize(b + refAmount, monthlyRate, payment);
    const extra = with_.totalInterest - base.totalInterest;
    const cpd = extra / refAmount;
    console.log(
      `  $${b.toLocaleString().padStart(11)}` +
      `  $${Math.round(extra).toLocaleString().padStart(13)}` +
      `  $${cpd.toFixed(2).padStart(11)}`
    );
  }

  console.log();
  console.log(`  The earlier you pay it down, the more interest you avoid.`);
}

main();
