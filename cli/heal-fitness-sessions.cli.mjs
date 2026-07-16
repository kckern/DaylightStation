#!/usr/bin/env node
/**
 * Retroactive single-session identity heal, plus a `--sweep` mode that scans
 * every stored session for ones that need healing.
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
 *   node cli/heal-fitness-sessions.cli.mjs --sweep [--since Nd] [--apply]
 *
 * Examples:
 *   node cli/heal-fitness-sessions.cli.mjs 2026-06-27 20260627195941 --apply
 *   node cli/heal-fitness-sessions.cli.mjs --sweep --since 30d
 *   node cli/heal-fitness-sessions.cli.mjs --sweep --apply
 *
 * `--sweep` iterates every `history/fitness/<date>/*.yml` under the (test-
 * injectable) data base dir, plans a heal for each, and reports the ones
 * with `needsHeal === true`. Dry-run (no `--apply`) writes NOTHING — it only
 * reads and reports. `--since Nd` restricts the scan to date directories
 * within the last N days of a reference "now" (injectable via the `now`
 * param, or the `HEAL_SWEEP_NOW` env var when run from the CLI — never a
 * bare `Date.now()` call that a test can't control).
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

import { decodeSeries, encodeSeries } from '#domains/fitness/services/TimelineService.mjs';
import { planHeal } from '#domains/fitness/services/SessionIdentityHealer.mjs';
import { buildSummary, isCumulativeSeriesKey, getLastNonNull } from './lib/fitnessSessionSummary.mjs';

// ---------------------------------------------------------------------------
// Cell-level series merge
// ---------------------------------------------------------------------------

/**
 * Merge one (fromVal, toVal) cell pair for the given (fully-qualified,
 * e.g. `grannie:coins`) destination key, using the "max" cumulative
 * strategy: when both sides have a value, cumulative keys (`isCumulativeSeriesKey`
 * — `:coins`/`:beats`) keep the max; everything else (hr/zone point samples)
 * prefers the "to" (kept occupant)'s value. If only one side has a value,
 * take it (union of non-null cells).
 *
 * This is the correct rule for **transfers** (ghost-occupant absorption): the
 * "from" occupant is insignificant (coins <= 1), so its cumulative total can
 * never legitimately exceed — let alone need to be added to — the real
 * occupant's running total. It is NOT correct for **merges** (known-user
 * device-swap folds) — see `foldOccupantSeries`'s `cumulativeStrategy` param.
 *
 * @param {string} toKey - destination series key, e.g. 'grannie:coins'
 * @param {number|string|null} fromVal
 * @param {number|string|null} toVal
 * @returns {number|string|null}
 */
export function mergeCell(toKey, fromVal, toVal) {
  if (toVal == null) return fromVal == null ? null : fromVal;
  if (fromVal == null) return toVal;
  return isCumulativeSeriesKey(toKey) ? Math.max(fromVal, toVal) : toVal;
}

/**
 * Additive cumulative fold: the "from" occupant's series ends (a device
 * swap, strap handoff, etc.) and the "to" occupant's series continues the
 * SAME real person's running total from that point on. Naively taking
 * Math.max(from[i], to[i]) (as `mergeCell` does for transfers) silently
 * drops every coin/beat "to" earned after the swap once "to"'s own total
 * exceeds "from"'s frozen terminal value in absolute terms but has NOT yet
 * caught up to from+to combined — e.g. from freezes at 500, to independently
 * reaches 294, Math.max gives 500 (should be 794).
 *
 * Rule: carry `fromLast` (from's own final non-null value — its total truly
 * earned) forward into every tick where "to" has a value (folding "to"'s
 * post-swap total on top of it); where only "from" has a value, keep it
 * as-is (pre-swap ticks); where neither has a value, null.
 *
 * @param {Array} fromArr
 * @param {Array} toArr
 * @param {number} len
 * @returns {Array}
 */
function addCumulativeCells(fromArr, toArr, len) {
  const fromLast = getLastNonNull(fromArr);
  const merged = new Array(len);
  for (let i = 0; i < len; i++) {
    const toVal = toArr[i];
    if (toVal != null) {
      merged[i] = fromLast + toVal;
    } else if (fromArr[i] != null) {
      merged[i] = fromArr[i];
    } else {
      merged[i] = null;
    }
  }
  return merged;
}

/**
 * Fold occupant `fromId`'s decoded series into `toId`'s, cell-by-cell, then
 * delete `fromId`'s now-redundant series keys. Mutates `decoded` in place.
 *
 * @param {Object} decoded - decodeSeries() output (mutated)
 * @param {string} fromId
 * @param {string} toId
 * @param {Object} [opts]
 * @param {'max'|'add'} [opts.cumulativeStrategy='max'] - how to fold
 *   CUMULATIVE keys (`:coins`/`:beats`) when both sides have a value at the
 *   same tick:
 *     - 'max' (ghost-absorption / `plan.transfers`): the "from" occupant is
 *       insignificant — keep whichever side is larger. Safe because a ghost's
 *       total is never large enough to matter.
 *     - 'add' (known-user device-swap / `plan.merges`): the "from" occupant
 *       is a REAL person whose recording continues under "to" after a device
 *       swap — the two partial totals must be SUMMED, not maxed, or real
 *       coins earned after the swap are lost (see `addCumulativeCells`).
 *   Non-cumulative keys (`:hr`/`:zone`) always use the non-null-union /
 *   prefer-"to" rule (`mergeCell`) regardless of strategy.
 */
export function foldOccupantSeries(decoded, fromId, toId, { cumulativeStrategy = 'max' } = {}) {
  const prefix = `${fromId}:`;
  const fromKeys = Object.keys(decoded).filter((k) => k.startsWith(prefix));
  for (const fromKey of fromKeys) {
    const suffix = fromKey.slice(prefix.length);
    const toKey = `${toId}:${suffix}`;
    const fromArr = decoded[fromKey] || [];
    const toArr = decoded[toKey] || [];
    const len = Math.max(fromArr.length, toArr.length);

    let merged;
    if (cumulativeStrategy === 'add' && isCumulativeSeriesKey(toKey)) {
      merged = addCumulativeCells(fromArr, toArr, len);
    } else {
      merged = new Array(len);
      for (let i = 0; i < len; i++) {
        merged[i] = mergeCell(toKey, fromArr[i], toArr[i]);
      }
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
// Sweep — scan all stored sessions for ones that need healing
// ---------------------------------------------------------------------------

/**
 * Resolve the `history/fitness` root directory (parent of the per-date
 * dirs), honoring the same `baseDir` override convention as
 * `resolveSessionPath`.
 *
 * @param {string} [baseDir]
 * @returns {string}
 */
export function historyRoot(baseDir) {
  const resolvedBaseDir = baseDir || process.env.DAYLIGHT_BASE_PATH || process.cwd();
  return path.join(resolvedBaseDir, 'data', 'household', 'history', 'fitness');
}

/**
 * List the `YYYY-MM-DD` date directories under the history root, sorted
 * ascending. Returns `[]` if the root doesn't exist (nothing swept yet).
 *
 * @param {string} [baseDir]
 * @returns {Promise<string[]>}
 */
export async function listDateDirs(baseDir) {
  const root = historyRoot(baseDir);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && isValidDate(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Parse a `--since` CLI value of the form `"Nd"` (N days) into a plain
 * number of days.
 *
 * @param {string} value
 * @returns {number}
 */
export function parseSinceArg(value) {
  const m = /^(\d+)d$/.exec(String(value));
  if (!m) {
    throw new Error(`--since value must look like "Nd" (e.g. "30d"), got: ${value}`);
  }
  return Number(m[1]);
}

/**
 * Compute the `YYYY-MM-DD` cutoff date string for a `--since Nd` window
 * relative to `now`. Date directory names sort lexically the same as
 * chronologically, so callers can filter with a plain string comparison
 * (`dateDir >= cutoff`).
 *
 * @param {Date} now
 * @param {number} sinceDays
 * @returns {string}
 */
export function cutoffDateString(now, sinceDays) {
  const cutoffMs = now.getTime() - sinceDays * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString().slice(0, 10);
}

/**
 * Scan every stored session under `history/fitness/<date>/*.yml`, plan a
 * heal for each, and collect the ones that need healing. Read-only unless
 * `apply` is set, in which case each candidate is healed via `heal()`
 * (which does its own load/plan/apply — the sweep doesn't re-derive the
 * write from its own scan pass).
 *
 * @param {Object} [opts]
 * @param {string} [opts.baseDir] - override the data-dir root (for tests)
 * @param {number} [opts.sinceDays] - restrict to date dirs within N days of `now`
 * @param {boolean} [opts.apply=false] - heal each candidate; dry-run (no writes) otherwise
 * @param {Date} [opts.now=new Date()] - reference "now" for `--since` filtering (test-injectable)
 * @returns {Promise<{
 *   candidates: Array<{date:string, sessionId:string, removed:string[], merges:Array}>,
 *   applied: Array<{date:string, sessionId:string, changed:boolean}>
 * }>}
 */
export async function sweep({ baseDir, sinceDays, apply = false, now = new Date() } = {}) {
  const root = historyRoot(baseDir);
  let dateDirs = await listDateDirs(baseDir);

  if (Number.isFinite(sinceDays)) {
    const cutoff = cutoffDateString(now, sinceDays);
    dateDirs = dateDirs.filter((d) => d >= cutoff);
  }

  const candidates = [];
  for (const date of dateDirs) {
    const dir = path.join(root, date);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const fileName of files) {
      if (!fileName.endsWith('.yml')) continue;
      const sessionId = fileName.slice(0, -'.yml'.length);
      if (!isValidSessionId(sessionId)) continue;

      let raw;
      try {
        raw = await fs.readFile(path.join(dir, fileName), 'utf8');
      } catch {
        continue;
      }

      let obj;
      try {
        obj = yaml.load(raw);
      } catch {
        continue;
      }
      if (!obj || typeof obj !== 'object') continue;

      const plan = planHeal(obj);
      if (plan.needsHeal) {
        candidates.push({
          date,
          sessionId,
          removed: plan.removedOccupants,
          merges: plan.merges
        });
      }
    }
  }

  const applied = [];
  if (apply) {
    for (const c of candidates) {
      const result = await heal(c.date, c.sessionId, { apply: true, baseDir });
      applied.push({ date: c.date, sessionId: c.sessionId, changed: result.changed });
    }
  }

  return { candidates, applied };
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
  //
  // Transfers (ghost absorption) and merges (known-user device-swap) use
  // DIFFERENT cumulative-fold strategies: a ghost's coins/beats total is
  // insignificant by construction, so 'max' can never clobber the real
  // occupant's total; a device-swap merge's "from" occupant is a REAL
  // person's other segment, so cumulative keys must be SUMMED ('add') or
  // real post-swap coins are lost. See `foldOccupantSeries`.
  // -------------------------------------------------------------------
  const intervalSeconds = Number.isFinite(obj.timeline?.interval_seconds)
    ? obj.timeline.interval_seconds
    : 5;
  const decoded = decodeSeries(obj.timeline?.series || {});

  for (const { from, to } of plan.transfers) {
    foldOccupantSeries(decoded, from, to, { cumulativeStrategy: 'max' });
  }
  for (const { from, to } of plan.merges) {
    foldOccupantSeries(decoded, from, to, { cumulativeStrategy: 'add' });
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

  // Also drop the removed occupants' records from the `entities` array.
  // Otherwise an entity-backed ghost (one that had an entity but whose series
  // were folded away) is re-discovered by a later scan/sweep from its lingering
  // entity, so healing would not be idempotent (the sweep would keep flagging
  // the session even though its participants/summary are already clean).
  const removedSet = new Set(plan.removedOccupants);
  const entities = Array.isArray(obj.entities)
    ? obj.entities.filter((e) => !removedSet.has(e?.profileId))
    : obj.entities;

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
    entities,
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

async function runSweep(args) {
  const apply = args.includes('--apply');
  const sinceIdx = args.indexOf('--since');

  let sinceDays;
  if (sinceIdx !== -1) {
    try {
      sinceDays = parseSinceArg(args[sinceIdx + 1]);
    } catch (e) {
      console.error(`ERROR: ${e.message}`);
      process.exit(1);
    }
  }

  const now = process.env.HEAL_SWEEP_NOW ? new Date(process.env.HEAL_SWEEP_NOW) : new Date();

  const { candidates, applied } = await sweep({ sinceDays, apply, now });

  console.log('=== Heal sweep ===');
  if (Number.isFinite(sinceDays)) console.log(`Window: last ${sinceDays}d (as of ${now.toISOString()})`);
  console.log('');
  console.log('date        sessionId       removed              merges');
  for (const c of candidates) {
    const removedStr = c.removed.join(',') || '(none)';
    const mergesStr = c.merges.map((m) => `${m.from}->${m.to}`).join(',') || '(none)';
    console.log(`${c.date}  ${c.sessionId}  ${removedStr.padEnd(20)}  ${mergesStr}`);
  }
  console.log('');
  console.log(`${candidates.length} session(s) need healing`);

  if (!candidates.length) {
    // nothing to report either way
  } else if (apply) {
    const changedCount = applied.filter((a) => a.changed).length;
    console.log(`APPLIED — healed ${changedCount} of ${applied.length} candidate session(s).`);
  } else {
    console.log('DRY RUN — no changes written. Pass --apply to heal these sessions.');
  }

  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--sweep')) {
    await runSweep(args);
    return;
  }

  const apply = args.includes('--apply');
  const positional = args.filter((a) => !a.startsWith('--'));

  if (positional.length !== 2) {
    console.error('Usage: node cli/heal-fitness-sessions.cli.mjs <date> <sessionId> [--apply]');
    console.error('       node cli/heal-fitness-sessions.cli.mjs --sweep [--since Nd] [--apply]');
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
