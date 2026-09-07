#!/usr/bin/env node
/**
 * `school booklog migrate` — convert one learner's reading shelf to
 * `school.book-log/v2`, and refuse to unless the conversion measures the same.
 *
 *   node cli/school.mjs booklog migrate <learnerId> [--data-dir <path>]
 *                                       [--timezone <tz>] [--apply]
 *
 * ## DRY RUN BY DEFAULT, ONE LEARNER AT A TIME
 *
 * The data tree is shared and Dropbox-synced, so a migration is LIVE the
 * moment it runs — the dry run is not a formality. Nothing is written without
 * `--apply`, and the original bytes are copied to `{learnerId}.v1.bak` before
 * anything replaces them.
 *
 * ## VERIFIED BY PROJECTION EQUALITY
 *
 * The v1 item and the reading it becomes must agree on status, furthest page,
 * percent, minutes and days read, AND on every obligation measurement — four
 * metrics across the day, week, month and cumulative windows. A single
 * disagreement aborts the whole learner, names the reading and the field, and
 * leaves v1 exactly where it was. A converted shelf that reports a different
 * year of reading than the one it replaced is the failure this exists to
 * prevent.
 *
 * ## THE DAY RULE IS THE HOUSEHOLD'S
 *
 * A v1 event carries only an instant; a v2 entry carries the study DAY it
 * belongs to. Mapping one to the other needs the household's 4am boundary and
 * timezone, read from `system/config/system.yml` unless `--timezone` overrides
 * it. Converting with a bare UTC slice would move a 7pm read to the next day.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { shortId } from '#system/utils/id.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';
import {
  readingFromLegacyItem, projectShelfItem, projectReading, measureObligation,
} from '#domains/school/bookShelf.mjs';

const SCHEMA = 'school.book-log/v2';
/** No separators, no traversal — this becomes a filename. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const PROJECTED_FIELDS = ['status', 'page', 'percent', 'minutes', 'daysRead'];
const METRICS = ['pages', 'minutes', 'books', 'checkins'];

const DAY_MS = 86_400_000;
const shiftDay = (day, days) => new Date(Date.parse(`${day}T12:00:00.000Z`) + days * DAY_MS)
  .toISOString().slice(0, 10);

/** The same four windows `obligationWindow` builds, so the check covers what the launcher asks. */
function windowsFor(studyDay) {
  return {
    day: { from: studyDay, to: studyDay },
    week: { from: shiftDay(studyDay, -6), to: studyDay },
    month: { from: shiftDay(studyDay, -29), to: studyDay },
    once: { from: null, to: studyDay },
  };
}

/** The household timezone, or null when the tree does not say. */
export function timezoneFrom(dataDir) {
  try {
    const config = yaml.load(fs.readFileSync(path.join(dataDir, 'system', 'config', 'system.yml'), 'utf8'));
    return config?.timezone ?? null;
  } catch {
    return null;
  }
}

/**
 * Every way the two shapes could disagree about one reading.
 *
 * @returns {{field: string, before: unknown, after: unknown}[]} empty when they agree
 */
export function verifyReading(item, reading, { dayOf, studyDay }) {
  const mismatches = [];
  const before = projectShelfItem(item, { dayOf });
  const after = projectReading(reading);
  for (const field of PROJECTED_FIELDS) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      mismatches.push({ field, before: before[field], after: after[field] });
    }
  }

  for (const [per, window] of Object.entries(windowsFor(studyDay))) {
    for (const metric of METRICS) {
      const obligation = { metric, quantity: 1, per };
      const v1 = measureObligation(obligation, [item], window, { dayOf });
      const v2 = measureObligation(obligation, [reading], window);
      if (v1.actual !== v2.actual || v1.met !== v2.met
        || JSON.stringify(v1.incompatibleBooks) !== JSON.stringify(v2.incompatibleBooks)) {
        mismatches.push({ field: `${metric}/${per}`, before: v1.actual, after: v2.actual });
      }
    }
  }
  return mismatches;
}

/**
 * Convert one learner's shelf. Writes only when `apply` is true and every
 * reading verified.
 *
 * @param {{dataDir: string, learnerId: string, apply?: boolean, timezone?: string|null,
 *   now?: string, convert?: (reading: object) => object}} options
 *   `convert` is a test seam for proving the abort path — production passes none.
 * @returns {{status: string, applied: boolean, readings: object[], errors: string[],
 *   file: string, timezone: string|null, studyDay: string}}
 */
export function runMigration({
  dataDir, learnerId, apply = false, timezone = undefined, now = new Date().toISOString(), convert = null,
} = {}) {
  if (typeof learnerId !== 'string' || !SAFE_ID.test(learnerId)) {
    throw new Error(`booklog migrate: unsafe learnerId: ${learnerId}`);
  }
  const zone = timezone === undefined ? timezoneFrom(dataDir) : timezone;
  const dayOf = (iso) => (Number.isFinite(Date.parse(iso))
    ? studyDayForInstant(Date.parse(iso), { timezone: zone })
    : '');
  const studyDay = dayOf(now);

  const dir = path.join(dataDir, 'household', 'school', 'records', 'books');
  const file = path.join(dir, `${learnerId}.yml`);
  const backup = path.join(dir, `${learnerId}.v1.bak`);
  const base = {
    applied: false, readings: [], errors: [], file, timezone: zone, studyDay,
  };

  if (!fs.existsSync(file)) return { ...base, status: 'missing' };

  const text = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (error) {
    return { ...base, status: 'unreadable', errors: [`could not parse ${file}: ${error.message}`] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...base, status: 'unreadable', errors: [`${file}: root must be a mapping`] };
  }
  if (parsed.schema === SCHEMA) return { ...base, status: 'already-v2' };
  if (!Array.isArray(parsed.items)) {
    return { ...base, status: 'unreadable', errors: [`${file}: no v1 items list to convert`] };
  }

  const items = parsed.items.filter(Boolean);
  const readings = [];
  const errors = [];
  const report = [];

  for (const item of items) {
    const converted = readingFromLegacyItem(item, {
      learnerId,
      dayOf,
      readingId: `rdg_${shortId(12)}`,
      entryIdFor: () => `ent_${shortId(12)}`,
    });
    // The WHOLE v1 item, not just its id: `started`, `set-aside` and `reopened`
    // became fields, and a finish a child took back became nothing at all. This
    // revision is the only place inside the new file where they survive.
    converted.revisions = [{
      id: `rev_${shortId(12)}`,
      by: 'migration',
      at: now,
      verb: 'convert',
      before: item,
      after: null,
      reason: `book log v1 converted to ${SCHEMA}`,
      toldChild: false,
    }];
    const reading = convert ? convert(converted) : converted;

    const mismatches = verifyReading(item, reading, { dayOf, studyDay });
    for (const mismatch of mismatches) {
      errors.push(`${item.itemId}: ${mismatch.field} was ${JSON.stringify(mismatch.before)}, converts to ${JSON.stringify(mismatch.after)}`);
    }
    readings.push(reading);
    report.push({
      from: item.itemId ?? null,
      to: reading.id,
      status: reading.status,
      entries: (reading.entries ?? []).length,
      verified: mismatches.length === 0,
    });
  }

  if (errors.length) {
    return { ...base, status: 'mismatch', readings: report, errors };
  }
  if (!apply) return { ...base, status: 'ok', readings: report };

  if (fs.existsSync(backup)) {
    return {
      ...base,
      status: 'blocked',
      readings: report,
      errors: [`${backup} already exists — move it aside before converting again`],
    };
  }
  fs.writeFileSync(backup, text);
  fs.writeFileSync(file, yaml.dump({ schema: SCHEMA, readings }, { lineWidth: 120, noRefs: true }));
  return { ...base, status: 'ok', applied: true, readings: report };
}

const HELP = `school booklog — the reading shelf's storage

Usage:
  node cli/school.mjs booklog migrate <learnerId> [--data-dir <path>] [--timezone <tz>] [--apply]

Converts one learner's shelf from the v1 item shape to ${SCHEMA}.
DRY RUN by default: prints what would change and verifies it, writing nothing.
With --apply, the original file is copied to {learnerId}.v1.bak first.

A conversion is written only if every reading projects and measures identically
before and after — status, page, percent, minutes, days read, and all four
obligation metrics across the day, week, month and cumulative windows.
`;

export function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return argv.length ? 0 : 2;
  }
  const flagValue = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const apply = argv.includes('--apply');
  const dataDirFlag = flagValue('--data-dir');
  const timezone = flagValue('--timezone');
  const positional = argv.filter((token, index) => !token.startsWith('--')
    && argv[index - 1] !== '--data-dir' && argv[index - 1] !== '--timezone');

  const [command, learnerId] = positional;
  if (command !== 'migrate' || !learnerId || positional.length > 2) {
    process.stderr.write(HELP);
    return 2;
  }

  const dataDir = dataDirFlag ?? path.join(process.env.DAYLIGHT_BASE_PATH ?? process.cwd(), 'data');
  let result;
  try {
    result = runMigration({ dataDir, learnerId, apply, ...(timezone ? { timezone } : {}) });
  } catch (error) {
    process.stderr.write(`ERROR ${error.message}\n`);
    return 1;
  }

  process.stdout.write(`${result.file}\n`);
  process.stdout.write(`  timezone ${result.timezone ?? '(none — UTC days)'}, study day ${result.studyDay}\n`);

  if (result.status === 'missing') {
    process.stdout.write('  no shelf file — nothing to convert\n');
    return 0;
  }
  if (result.status === 'already-v2') {
    process.stdout.write(`  already ${SCHEMA} — nothing to convert\n`);
    return 0;
  }

  for (const reading of result.readings) {
    process.stdout.write(`  ${reading.verified ? 'OK  ' : 'FAIL'} ${reading.to}  ${String(reading.status).padEnd(9)} ${String(reading.entries).padStart(2)} entr${reading.entries === 1 ? 'y' : 'ies'}   was ${reading.from}\n`);
  }
  for (const error of result.errors) process.stderr.write(`ERROR ${error}\n`);

  if (result.errors.length) {
    process.stderr.write('  ABORTED — v1 left in place. Nothing was written.\n');
    return 1;
  }
  process.stdout.write(result.applied
    ? `  CONVERTED ${result.readings.length} reading(s). Original bytes kept beside it as ${path.basename(result.file, '.yml')}.v1.bak\n`
    : `  DRY RUN — ${result.readings.length} reading(s) verified, nothing written. Re-run with --apply.\n`);
  return 0;
}

export default main;
