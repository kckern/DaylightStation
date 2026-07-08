#!/usr/bin/env node

/**
 * Backfill Strava Calories
 *
 * The list endpoint (/athlete/activities) returns activity summaries without
 * `calories`. The detail endpoint (/activities/{id}) does include it.
 * This script reads existing per-activity archive YAMLs in lifelog/strava/,
 * finds ones missing data.calories, fetches the detail, and writes calories
 * back to both the per-activity YAML and the summary in lifelog/strava.yml.
 *
 * Dry-run by default. Pass --write to persist.
 *
 * Usage:
 *   node cli/scripts/backfill-strava-calories.mjs [--write] [--days=N]
 *
 * Examples:
 *   node cli/scripts/backfill-strava-calories.mjs                 # dry-run, 30 days
 *   node cli/scripts/backfill-strava-calories.mjs --write         # write, 30 days
 *   node cli/scripts/backfill-strava-calories.mjs --write --days=90
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';
import moment from 'moment-timezone';
import * as Y from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : (process.env.DAYLIGHT_BASE_PATH || projectRoot);
const dataDir = path.join(baseDir, 'data');

const username = process.env.DAYLIGHT_USER || 'user_1';
const STRAVA_BASE = 'https://www.strava.com';

const systemAuthPath = path.join(dataDir, 'system', 'auth', 'strava.yml');
const userAuthPath   = path.join(dataDir, 'users', username, 'auth', 'strava.yml');
const archiveDir     = path.join(dataDir, 'users', username, 'lifelog', 'strava');
const summaryPath    = path.join(dataDir, 'users', username, 'lifelog', 'strava.yml');

// ------------------------------------------------------------------
// Args
// ------------------------------------------------------------------
const args = process.argv.slice(2);
const writeMode = args.includes('--write');
function getArg(name, def) {
  for (const a of args) {
    if (a === name) return '';
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return def;
}
const days = parseInt(getArg('--days', '30'), 10);
const cutoff = moment().subtract(days, 'days').format('YYYY-MM-DD');

const RATE_DELAY_MS = parseInt(getArg('--delay', '6000'), 10); // Strava: 100/15min ≈ 9s/req; 6s is comfortable

console.log(`Backfill Strava calories for ${username}`);
console.log(`  Days back: ${days} (cutoff ${cutoff})`);
console.log(`  Mode:      ${writeMode ? 'WRITE' : 'DRY-RUN'}`);
console.log(`  Delay:     ${RATE_DELAY_MS} ms / request\n`);

// ------------------------------------------------------------------
// YAML helpers (mirrors strava.cli.mjs fallback)
// ------------------------------------------------------------------
function loadYaml(p) {
  try { return Y.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}
function saveYaml(p, data) {
  writeFileSync(p, Y.stringify(data));
}

// ------------------------------------------------------------------
// Auth (mirrors cli/strava.cli.mjs)
// ------------------------------------------------------------------
function loadSystemAuth() {
  const d = loadYaml(systemAuthPath);
  if (!d?.client_id || !d?.client_secret) throw new Error(`Missing client_id/secret at ${systemAuthPath}`);
  return d;
}
function loadUserAuth() {
  const d = loadYaml(userAuthPath);
  if (!d?.refresh) throw new Error(`Missing refresh token at ${userAuthPath}`);
  return d;
}
async function refreshIfNeeded({ force = false } = {}) {
  const auth = loadUserAuth();
  const now = Math.floor(Date.now() / 1000);
  if (!force && auth.access_token && auth.expires_at && now < auth.expires_at - 60) return auth;
  const sys = loadSystemAuth();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refresh,
    client_id: String(sys.client_id),
    client_secret: sys.client_secret,
  });
  const res = await fetch(`${STRAVA_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const updated = {
    refresh: data.refresh_token || auth.refresh,
    access_token: data.access_token,
    expires_at: data.expires_at,
    updated_at: new Date().toISOString(),
  };
  saveYaml(userAuthPath, updated);
  return updated;
}
async function getActivityDetail(id) {
  const auth = await refreshIfNeeded();
  const res = await fetch(`${STRAVA_BASE}/api/v3/activities/${id}`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!res.ok) throw new Error(`GET /activities/${id} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// ------------------------------------------------------------------
// Step 1: Find archive files missing calories within cutoff
// ------------------------------------------------------------------
if (!existsSync(archiveDir)) throw new Error(`Archive dir not found: ${archiveDir}`);

const files = readdirSync(archiveDir)
  .filter((f) => f.endsWith('.yml') && !f.includes('conflicted copy'))
  .filter((f) => f.slice(0, 10) >= cutoff)
  .sort();

console.log(`Found ${files.length} archive files since ${cutoff}`);

const targets = [];
for (const f of files) {
  const full = path.join(archiveDir, f);
  const d = loadYaml(full);
  if (!d?.id) continue;
  const hasCal = d.data && (d.data.calories != null || d.data.kilojoules != null);
  if (!hasCal) targets.push({ file: f, full, id: d.id, date: d.date, type: d.type, doc: d });
}

console.log(`  Missing calories: ${targets.length}`);
if (targets.length === 0) {
  console.log('Nothing to backfill. Exiting.');
  process.exit(0);
}

// ------------------------------------------------------------------
// Step 2: Fetch detail + patch each archive
// ------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { ok: 0, noCal: 0, fail: 0, totalCal: 0 };
const updates = []; // { id, date, type, calories } for summary patch

for (let i = 0; i < targets.length; i++) {
  const { file, full, id, date, type, doc } = targets[i];
  const prefix = `[${i + 1}/${targets.length}] ${file}`;
  try {
    if (i > 0) await sleep(RATE_DELAY_MS);
    const detail = await getActivityDetail(id);
    const cal = detail.calories ?? null;
    const kj = detail.kilojoules ?? null;
    const effective = cal ?? kj;

    if (effective == null) {
      console.log(`  ${prefix}  → no calories returned`);
      results.noCal += 1;
      continue;
    }

    // Patch the per-activity archive: merge full detail back over data
    // (only fields that aren't already populated, to preserve existing values like heartRateOverTime)
    doc.data = doc.data || {};
    if (doc.data.calories == null) doc.data.calories = cal;
    if (doc.data.kilojoules == null && kj != null) doc.data.kilojoules = kj;
    if (doc.data.description == null && detail.description != null) doc.data.description = detail.description;
    if (doc.data.perceived_exertion == null && detail.perceived_exertion != null) doc.data.perceived_exertion = detail.perceived_exertion;

    if (writeMode) saveYaml(full, doc);

    updates.push({ id, date, type, calories: effective });
    results.ok += 1;
    results.totalCal += effective;
    console.log(`  ${prefix}  → ${effective} kcal  (${type}, ${date})`);
  } catch (err) {
    console.error(`  ${prefix}  → ERROR: ${err.message}`);
    results.fail += 1;
    // Backoff on rate-limit (429)
    if (/\b429\b/.test(err.message)) {
      console.error('  Rate limit hit — sleeping 60s then continuing.');
      await sleep(60_000);
    }
  }
}

// ------------------------------------------------------------------
// Step 3: Patch summary file (lifelog/strava.yml)
// ------------------------------------------------------------------
if (updates.length > 0) {
  const summary = loadYaml(summaryPath) || {};
  let patched = 0;
  for (const u of updates) {
    const dayArr = summary[u.date];
    if (!Array.isArray(dayArr)) continue;
    const entry = dayArr.find((a) => a.id === u.id);
    if (entry && entry.calories == null) {
      entry.calories = u.calories;
      patched += 1;
    }
  }
  if (writeMode && patched > 0) saveYaml(summaryPath, summary);
  console.log(`\nSummary patched: ${patched} entries in lifelog/strava.yml`);
}

// ------------------------------------------------------------------
// Report
// ------------------------------------------------------------------
console.log('\n=== Backfill summary ===');
console.log(`  Backfilled:        ${results.ok}`);
console.log(`  No calorie data:   ${results.noCal}`);
console.log(`  Errors:            ${results.fail}`);
console.log(`  Total kcal:        ${results.totalCal.toLocaleString()}`);
console.log(`  Mean kcal/session: ${results.ok ? Math.round(results.totalCal / results.ok) : 0}`);
console.log(`  Mode:              ${writeMode ? 'WRITE (files updated)' : 'DRY-RUN (no files touched)'}`);
