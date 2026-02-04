// tests/live/adapter/harvesters/_test-helper.mjs

/**
 * Shared test helper for harvester live tests.
 * Invokes harvest.mjs CLI and parses JSON output.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARVEST_CLI = path.join(__dirname, '..', 'harvest.mjs');

/**
 * Run harvest CLI for a specific harvester
 * @param {string} serviceId - Harvester to run
 * @param {Object} opts - Options
 * @param {string} [opts.since] - Backfill date (YYYY-MM-DD)
 * @returns {Promise<Object>} - Result object with status, error, duration
 */
export async function runHarvest(serviceId, opts = {}) {
  const dataPath = process.env.DAYLIGHT_DATA_PATH;
  if (!dataPath) {
    throw new Error('DAYLIGHT_DATA_PATH environment variable required');
  }

  const args = ['--only=' + serviceId, '--json'];
  if (opts.since) args.push('--since=' + opts.since);

  return new Promise((resolve, reject) => {
    const child = spawn('node', [HARVEST_CLI, ...args], {
      env: { ...process.env, DAYLIGHT_DATA_PATH: dataPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      try {
        const output = JSON.parse(stdout);
        const result = output.results?.find(r => r.serviceId === serviceId);
        if (result) {
          resolve(result);
        } else {
          reject(new Error(`No result for ${serviceId} in output`));
        }
      } catch (err) {
        reject(new Error(`Failed to parse CLI output: ${err.message}\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Get date N days ago in YYYY-MM-DD format
 */
export function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString().split('T')[0];
}

/**
 * Acceptable statuses for a passing test
 * (cooldown is acceptable - circuit breaker doing its job)
 */
export const ACCEPTABLE_STATUSES = ['pass', 'cooldown', 'rate_limited'];
