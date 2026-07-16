#!/usr/bin/env node
/**
 * Retroactive single-session identity heal.
 *
 * Applies the backend's `SessionIdentityHealer.planHeal` plan to an
 * on-disk saved fitness session YAML: folds "ghost" occupants (near-zero
 * effort segments, or a known user recorded under a device-swap alias) into
 * the occupant that actually did the work, then recomputes the summary
 * block the same way `merge-fitness-sessions.cli.mjs` does (via the shared
 * `cli/lib/fitnessSessionSummary.mjs` helpers).
 *
 * Dry-run by default — prints the plan without touching the file. Pass
 * --apply to write the healed YAML back.
 *
 * Usage:
 *   node cli/heal-fitness-sessions.cli.mjs <date> <sessionId> [--apply]
 *
 * Example:
 *   node cli/heal-fitness-sessions.cli.mjs 2026-06-27 20260627195941 --apply
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

import { decodeSeries, encodeSeries } from '#domains/fitness/services/TimelineService.mjs';
import { planHeal } from '#domains/fitness/services/SessionIdentityHealer.mjs';
import { buildSummary } from './lib/fitnessSessionSummary.mjs';

// ---------------------------------------------------------------------------
// Cell-level series merge
// ---------------------------------------------------------------------------

// Cumulative counters (running totals within a session) — when both the
// "from" and "to" occupant have a non-null value at the same tick, keep the
// larger one rather than overwriting (a real, still-worn strap's running
// total should never be clobbered by a ghost occupant's smaller one).
const CUMULATIVE_KEY_RE = /:(coins|beats)$/;

function isCumulativeKey(key) {
  return CUMULATIVE_KEY_RE.test(key);
}

/**
 * Merge one (fromVal, toVal) cell pair for the given (fully-qualified,
 * e.g. `grannie:coins`) destination key.
 *   - If only one side has a value, take it (union of non-null cells).
 *   - If both sides have a value: cumulative keys keep the max; everything
 *     else (hr/zone point samples) prefers the "to" (kept occupant)'s value.
 *
 * @param {string} toKey - destination series key, e.g. 'grannie:coins'
 * @param {number|string|null} fromVal
 * @param {number|string|null} toVal
 * @returns {number|string|null}
 */
export function mergeCell(toKey, fromVal, toVal) {
  if (toVal == null) return fromVal == null ? null : fromVal;
  if (fromVal == null) return toVal;
  return isCumulativeKey(toKey) ? Math.max(fromVal, toVal) : toVal;
}

/**
 * Fold occupant `fromId`'s decoded series into `toId`'s, cell-by-cell, then
 * delete `fromId`'s now-redundant series keys. Mutates `decoded` in place.
 *
 * @param {Object} decoded - decodeSeries() output (mutated)
 * @param {string} fromId
 * @param {string} toId
 */
export function foldOccupantSeries(decoded, fromId, toId) {
  const prefix = `${fromId}:`;
  const fromKeys = Object.keys(decoded).filter((k) => k.startsWith(prefix));
  for (const fromKey of fromKeys) {
    const suffix = fromKey.slice(prefix.length);
    const toKey = `${toId}:${suffix}`;
    const fromArr = decoded[fromKey] || [];
    const toArr = decoded[toKey] || [];
    const len = Math.max(fromArr.length, toArr.length);
    const merged = new Array(len);
    for (let i = 0; i < len; i++) {
      merged[i] = mergeCell(toKey, fromArr[i], toArr[i]);
    }
    decoded[toKey] = merged;
    delete decoded[fromKey];
  }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the on-disk path for a session YAML.
 * Honors an explicit `baseDir` override (used by tests) before falling back
 * to DAYLIGHT_BASE_PATH / cwd, same convention as merge-fitness-sessions.cli.mjs.
 *
 * @param {string} date - YYYY-MM-DD
 * @param {string} sessionId - 14-digit session id
 * @param {string} [baseDir]
 * @returns {string}
 */
export function resolveSessionPath(date, sessionId, baseDir) {
  const resolvedBaseDir = baseDir || process.env.DAYLIGHT_BASE_PATH || process.cwd();
  return path.join(resolvedBaseDir, 'data', 'household', 'history', 'fitness', date, `${sessionId}.yml`);
}

// ---------------------------------------------------------------------------
// Arg validation (exported so the CLI wrapper and tests share one rule)
// ---------------------------------------------------------------------------

export function isValidDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function isValidSessionId(id) {
  return /^\d{14}$/.test(id);
}

// ---------------------------------------------------------------------------
// heal()
// ---------------------------------------------------------------------------

/**
 * Load a session YAML, plan the identity heal, and (if `apply`) rewrite the
 * file with ghost occupants folded away and the summary recomputed.
 *
 * @param {string} date - YYYY-MM-DD
 * @param {string} sessionId - 14-digit session id
 * @param {Object} [opts]
 * @param {boolean} [opts.apply=false] - write the healed YAML back; dry-run otherwise
 * @param {string} [opts.baseDir] - override the data-dir root (for tests)
 * @returns {Promise<{
 *   file: string,
 *   plan: {removedOccupants:string[], transfers:Array, merges:Array, needsHeal:boolean},
 *   changed: boolean,
 *   out: (Object|null)
 * }>}
 */
export async function heal(date, sessionId, { apply = false, baseDir } = {}) {
  if (!isValidDate(date)) {
    throw new Error(`<date> must be YYYY-MM-DD, got: ${date}`);
  }
  if (!isValidSessionId(sessionId)) {
    throw new Error(`<sessionId> must be 14 digits, got: ${sessionId}`);
  }

  const file = resolveSessionPath(date, sessionId, baseDir);

  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read ${file}: ${e.message}`);
  }
  const obj = yaml.load(raw);
  if (!obj || typeof obj !== 'object') {
    throw new Error(`Cannot parse YAML at ${file}`);
  }

  const plan = planHeal(obj);

  if (!plan.needsHeal || !apply) {
    return { file, plan, changed: false, out: null };
  }

  // -------------------------------------------------------------------
  // Apply: fold transfers then merges (order matters — a chain like
  // soren -> elizabeth -> grannie must land soren's data on elizabeth
  // BEFORE elizabeth's (now-combined) series folds into grannie).
  // -------------------------------------------------------------------
  const intervalSeconds = Number.isFinite(obj.timeline?.interval_seconds)
    ? obj.timeline.interval_seconds
    : 5;
  const decoded = decodeSeries(obj.timeline?.series || {});

  for (const { from, to } of [...plan.transfers, ...plan.merges]) {
    foldOccupantSeries(decoded, from, to);
  }

  // Defensive: drop any stray removed-occupant series keys the fold loop
  // above didn't touch (shouldn't happen given the plan invariants, but
  // cheap to guarantee).
  for (const id of plan.removedOccupants) {
    const prefix = `${id}:`;
    for (const key of Object.keys(decoded)) {
      if (key.startsWith(prefix)) delete decoded[key];
    }
  }

  const participants = { ...(obj.participants || {}) };
  for (const id of plan.removedOccupants) delete participants[id];

  const events = Array.isArray(obj.timeline?.events) ? obj.timeline.events : [];

  const summary = buildSummary({
    participants,
    series: decoded,
    events,
    treasureBox: obj.treasureBox,
    intervalSeconds
  });

  const out = {
    ...obj,
    participants,
    timeline: {
      ...obj.timeline,
      series: encodeSeries(decoded)
    },
    summary
  };

  const yamlText = yaml.dump(out, { lineWidth: -1, noRefs: true });
  await fs.writeFile(file, yamlText, 'utf8');

  return { file, plan, changed: true, out };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const positional = args.filter((a) => !a.startsWith('--'));

  if (positional.length !== 2) {
    console.error('Usage: node cli/heal-fitness-sessions.cli.mjs <date> <sessionId> [--apply]');
    process.exit(1);
  }
  const [date, sessionId] = positional;

  if (!isValidDate(date)) {
    console.error(`ERROR: <date> must be YYYY-MM-DD, got: ${date}`);
    process.exit(1);
  }
  if (!isValidSessionId(sessionId)) {
    console.error(`ERROR: <sessionId> must be 14 digits, got: ${sessionId}`);
    process.exit(1);
  }

  let result;
  try {
    result = await heal(date, sessionId, { apply });
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }

  const { file, plan } = result;
  console.log(`=== Heal plan: ${sessionId} (${date}) ===`);
  console.log(`File: ${file}`);
  console.log(`needsHeal: ${plan.needsHeal}`);
  console.log(`Removed occupants (${plan.removedOccupants.length}): ${plan.removedOccupants.join(', ') || '(none)'}`);
  console.log(`Transfers (${plan.transfers.length}):`);
  for (const t of plan.transfers) console.log(`  - ${t.from} -> ${t.to}  (${t.reason})`);
  console.log(`Merges (${plan.merges.length}):`);
  for (const m of plan.merges) console.log(`  - ${m.from} -> ${m.to}  (${m.reason})`);

  if (!plan.needsHeal) {
    console.log('Nothing to heal — file left untouched.');
  } else if (!apply) {
    console.log('DRY RUN — no changes written. Pass --apply to write.');
  } else {
    console.log('APPLIED — file rewritten.');
    for (const [slug, p] of Object.entries(result.out.summary.participants)) {
      console.log(`  summary.participants.${slug}.coins=${p.coins}  hr_avg=${p.hr_avg}  hr_min=${p.hr_min}  hr_max=${p.hr_max}`);
    }
  }

  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
