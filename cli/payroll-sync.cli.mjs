#!/usr/bin/env node

/**
 * payroll-sync CLI — runs PayrollSyncService against TriNet + Buxfer with
 * the bulletproof transfer logic. Reads credentials from the local Dropbox
 * mirror; no docker exec required.
 *
 * Usage:
 *   node cli/payroll-sync.cli.mjs [token]   # token defaults to auth_cookie
 */

import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../backend');
const DATA = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

// Use the backend's module resolution by importing through its src tree.
// The CLI runs with cwd at the project root, but # aliases need backend.
// Workaround: dynamic import with relative paths — these don't trigger
// alias resolution in PayrollSyncService (which uses #system/utils for
// errors). To make this work, we set the cwd and use the backend package.
process.chdir(BACKEND);

const { PayrollSyncService } = await import(path.join(BACKEND, 'src/3_applications/finance/PayrollSyncService.mjs'));
const { BuxferAdapter } = await import(path.join(BACKEND, 'src/1_adapters/finance/BuxferAdapter.mjs'));

const buxferCreds = yaml.load(fs.readFileSync(`${DATA}/household/auth/buxfer.yml`, 'utf-8'));
const payrollAuth = yaml.load(fs.readFileSync(`${DATA}/household/auth/payroll.yml`, 'utf-8'));

const httpClient = {
  get: async (url, opts = {}) => {
    const res = await fetch(url, { headers: opts.headers });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
      err.response = { status: res.status };
      throw err;
    }
    return { data: await res.json() };
  },
  post: async (url, params) => {
    const body = new URLSearchParams(params);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
      err.response = { status: res.status };
      throw err;
    }
    return { data: await res.json() };
  }
};

const buxferAdapter = new BuxferAdapter(
  { email: buxferCreds.email, password: buxferCreds.password },
  { httpClient, logger: console }
);

const payrollConfig = {
  baseUrl: payrollAuth.base_url,
  authKey: payrollAuth.cookie_name || payrollAuth.authkey || payrollAuth.auth_key,
  authCookie: payrollAuth.auth_cookie || payrollAuth.auth,
  company: payrollAuth.company,
  employeeId: payrollAuth.employee_id || payrollAuth.employee,
  payrollAccountId: payrollAuth.payroll_account_id,
  directDepositAccountId: payrollAuth.direct_deposit_account_id,
};

const PAYROLL_FILE = `${DATA}/household/common/finances/payroll.yml`;
const MAPPING_FILE = `${DATA}/household/common/finances/payrollDict.yml`;

const financeStore = {
  getPayrollData: () => {
    try {
      return yaml.load(fs.readFileSync(PAYROLL_FILE, 'utf-8')) || { paychecks: {} };
    } catch (e) {
      if (e.code === 'ENOENT') return { paychecks: {} };
      throw e;
    }
  },
  savePayrollData: (_householdId, data) => {
    fs.writeFileSync(PAYROLL_FILE, yaml.dump(data));
  },
  getPayrollMapping: () => {
    try {
      const content = yaml.load(fs.readFileSync(MAPPING_FILE, 'utf-8'));
      return content?.mapping || [];
    } catch {
      return [];
    }
  }
};

const configService = {
  getDefaultHouseholdId: () => 'default',
  getUserAuth: () => ({}) // unused — we provide payrollConfig
};

const service = new PayrollSyncService({
  httpClient,
  transactionGateway: buxferAdapter,
  financeStore,
  configService,
  payrollConfig,
  logger: console,
});

const token = process.argv[2] || payrollConfig.authCookie;
if (!token) {
  console.error('No token provided and auth_cookie missing from payroll.yml');
  process.exit(1);
}

console.log('=== payroll-sync starting ===');
console.log(`baseUrl=${payrollConfig.baseUrl}  company=${payrollConfig.company}  employee=${payrollConfig.employeeId}`);
try {
  const result = await service.sync({ token });
  console.log('\n=== Result ===');
  console.log(JSON.stringify(result, null, 2));
  if (result.uploadFailures?.length > 0) {
    console.error(`\n${result.uploadFailures.length} upload(s) failed:`);
    for (const f of result.uploadFailures) console.error('  ', f);
    process.exit(2);
  }
} catch (error) {
  console.error('Sync failed:', error.message);
  if (error.context?.authExpired) {
    console.error('Pass a fresh token as argv[2]');
  }
  process.exit(1);
}
