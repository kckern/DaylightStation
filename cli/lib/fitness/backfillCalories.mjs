/**
 * Backfill missing calorie data onto archived Strava activities.
 *
 * The list endpoint (`/athlete/activities`) returns activity summaries without
 * `calories`; the detail endpoint (`/activities/{id}`) does include it. This
 * command reads the per-activity archive YAMLs under
 * `users/{user}/lifelog/strava/`, finds the ones missing `data.calories`,
 * fetches the detail, and writes the value back to both the per-activity YAML
 * and the day entry in `users/{user}/lifelog/strava.yml`.
 *
 * Dry-run by default; `--write` persists.
 *
 * @module cli/lib/fitness/backfillCalories
 */

import path from 'path';
import { existsSync, readdirSync } from 'fs';
import moment from 'moment-timezone';
import { parseArgs, bool, num } from './argv.mjs';
import { CliError } from './context.mjs';
import { stravaApi } from './stravaAuth.mjs';

export const spec = {
  name: 'backfill-calories',
  summary: 'fetch detail-endpoint calories for archived strava activities missing them',
  usage: 'fitness strava backfill-calories [--write] [--days=N] [--delay=MS]',
  details: `  --write      Apply changes (default: dry run)
  --days=N     How far back to scan (default: 30)
  --delay=MS   Pause between detail requests (default: 6000)`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string[]} argv - argv tail AFTER the group+command tokens
 * @param {Object} ctx - from `getContext()`
 * @returns {Promise<Object>}
 */
export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['write'] });
  const writeMode = bool(flags, 'write');
  const days = num(flags, 'days', 30);
  // Strava: 100 requests / 15 min ≈ 9s per request; 6s is comfortable.
  const rateDelayMs = num(flags, 'delay', 6000);

  const username = ctx.username;
  const cutoff = moment().subtract(days, 'days').format('YYYY-MM-DD');

  const archiveDir = path.join(ctx.dataDir, 'users', username, 'lifelog', 'strava');
  const summaryPath = path.join(ctx.dataDir, 'users', username, 'lifelog', 'strava.yml');

  console.log(`Backfill Strava calories for ${username}`);
  console.log(`  Days back: ${days} (cutoff ${cutoff})`);
  console.log(`  Mode:      ${writeMode ? 'WRITE' : 'DRY-RUN'}`);
  console.log(`  Delay:     ${rateDelayMs} ms / request\n`);

  // ----------------------------------------------------------------
  // Step 1: Find archive files missing calories within cutoff
  // ----------------------------------------------------------------
  if (!existsSync(archiveDir)) {
    throw new CliError(`Archive dir not found: ${archiveDir}`);
  }

  const files = readdirSync(archiveDir)
    .filter((f) => f.endsWith('.yml') && !f.includes('conflicted copy'))
    .filter((f) => f.slice(0, 10) >= cutoff)
    .sort();

  console.log(`Found ${files.length} archive files since ${cutoff}`);

  const targets = [];
  for (const f of files) {
    const full = path.join(archiveDir, f);
    const d = ctx.loadYamlSafe(full);
    if (!d?.id) continue;
    const hasCal = d.data && (d.data.calories != null || d.data.kilojoules != null);
    if (!hasCal) targets.push({ file: f, full, id: d.id, date: d.date, type: d.type, doc: d });
  }

  console.log(`  Missing calories: ${targets.length}`);
  if (targets.length === 0) {
    console.log('Nothing to backfill. Exiting.');
    return { scanned: files.length, targets: 0, backfilled: 0, noCalories: 0, errors: 0, patched: 0, write: writeMode };
  }

  // ----------------------------------------------------------------
  // Step 2: Fetch detail + patch each archive
  // ----------------------------------------------------------------
  const results = { ok: 0, noCal: 0, fail: 0, totalCal: 0 };
  const updates = []; // { id, date, type, calories } for the summary patch

  for (let i = 0; i < targets.length; i++) {
    const { file, full, id, date, type, doc } = targets[i];
    const prefix = `[${i + 1}/${targets.length}] ${file}`;
    try {
      if (i > 0) await sleep(rateDelayMs);
      const detail = await stravaApi(ctx, `/activities/${id}`);
      const cal = detail.calories ?? null;
      const kj = detail.kilojoules ?? null;
      const effective = cal ?? kj;

      if (effective == null) {
        console.log(`  ${prefix}  → no calories returned`);
        results.noCal += 1;
        continue;
      }

      // Patch the per-activity archive: only fill fields that aren't already
      // populated, to preserve existing values like heartRateOverTime.
      doc.data = doc.data || {};
      if (doc.data.calories == null) doc.data.calories = cal;
      if (doc.data.kilojoules == null && kj != null) doc.data.kilojoules = kj;
      if (doc.data.description == null && detail.description != null) doc.data.description = detail.description;
      if (doc.data.perceived_exertion == null && detail.perceived_exertion != null) doc.data.perceived_exertion = detail.perceived_exertion;

      if (writeMode) ctx.saveYaml(full, doc);

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

  // ----------------------------------------------------------------
  // Step 3: Patch summary file (lifelog/strava.yml)
  // ----------------------------------------------------------------
  let patched = 0;
  if (updates.length > 0) {
    const summary = ctx.loadYamlSafe(summaryPath) || {};
    for (const u of updates) {
      const dayArr = summary[u.date];
      if (!Array.isArray(dayArr)) continue;
      const entry = dayArr.find((a) => a.id === u.id);
      if (entry && entry.calories == null) {
        entry.calories = u.calories;
        patched += 1;
      }
    }
    if (writeMode && patched > 0) ctx.saveYaml(summaryPath, summary);
    console.log(`\nSummary patched: ${patched} entries in lifelog/strava.yml`);
  }

  // ----------------------------------------------------------------
  // Report
  // ----------------------------------------------------------------
  const meanCal = results.ok ? Math.round(results.totalCal / results.ok) : 0;
  console.log('\n=== Backfill summary ===');
  console.log(`  Backfilled:        ${results.ok}`);
  console.log(`  No calorie data:   ${results.noCal}`);
  console.log(`  Errors:            ${results.fail}`);
  console.log(`  Total kcal:        ${results.totalCal.toLocaleString()}`);
  console.log(`  Mean kcal/session: ${meanCal}`);
  console.log(`  Mode:              ${writeMode ? 'WRITE (files updated)' : 'DRY-RUN (no files touched)'}`);

  return {
    scanned: files.length,
    targets: targets.length,
    backfilled: results.ok,
    noCalories: results.noCal,
    errors: results.fail,
    totalCalories: results.totalCal,
    meanCalories: meanCal,
    patched,
    write: writeMode,
  };
}
