#!/usr/bin/env node
/**
 * One-shot: split a persisted v3 fitness session into two at a timestamp boundary.
 *
 * Usage (inside the container):
 *   node cli/fitness-split-session.mjs --file <session.yml> <SPLIT-SELECTOR> [--write]
 *
 * SPLIT-SELECTOR (pick one):
 *   --split-ts <epochMs>        split at an exact unix-ms timestamp
 *   --split-content <contentId> split at the first media event with this contentId
 *                               (e.g. --split-content plex:675678)
 *   --split-time "HH:mm:ss"     split at a wall-clock time on the session's date
 *                               (interpreted in the session timezone)
 *
 * Everything at/after the split timestamp becomes part 2 (a new session id =
 * the split time); part 1 keeps the original id, truncated. Cumulative series
 * (beats/coins/rotations/impacts) are re-zeroed for part 2; color buckets are
 * the original totals redistributed by each part's activity.
 *
 * Without --write it is a DRY RUN: prints the split tick, the two new ids, and
 * all reconciliation invariants, and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { decodeSeries, encodeSeries } from '../backend/src/2_domains/fitness/services/TimelineService.mjs';
import { splitDecodedSeries, computeSplitTick, recomputeSummaryForPart, allocateBucketsRedistribute } from '../backend/src/2_domains/fitness/services/sessionSplit.mjs';

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v == null || v.startsWith('--')) ? true : v;
}

const FILE = arg('file');
const WRITE = !!arg('write', false);
const SPLIT_TS_ARG = arg('split-ts');
const SPLIT_CONTENT = arg('split-content');
const SPLIT_TIME = arg('split-time');
if (!FILE) {
  console.error('Required: --file <path> and one of --split-ts / --split-content / --split-time');
  process.exit(2);
}

const raw = fs.readFileSync(FILE, 'utf8');
const doc = yaml.load(raw);
const tz = doc.timezone || 'America/Los_Angeles';
const intervalMs = doc.treasureBox?.coinTimeUnitMs || 5000;

// Resolve the split timestamp from whichever selector was given.
let SPLIT_TS = NaN;
if (SPLIT_TS_ARG != null && SPLIT_TS_ARG !== true) {
  SPLIT_TS = Number(SPLIT_TS_ARG);
} else if (SPLIT_CONTENT && SPLIT_CONTENT !== true) {
  const ev = (doc.timeline?.events || []).find(
    e => e?.type === 'media' && e?.data?.contentId === SPLIT_CONTENT && Number.isFinite(Number(e.timestamp))
  );
  if (!ev) { console.error(`No media event found for contentId ${SPLIT_CONTENT}`); process.exit(2); }
  SPLIT_TS = Number(ev.timestamp);
  console.log(`resolved --split-content ${SPLIT_CONTENT} -> ts ${SPLIT_TS} ("${ev.data?.grandparentTitle || ''} / ${ev.data?.parentTitle || ev.data?.title || ''}")`);
} else if (SPLIT_TIME && SPLIT_TIME !== true) {
  SPLIT_TS = moment.tz(`${doc.session.date} ${SPLIT_TIME}`, 'YYYY-MM-DD HH:mm:ss', tz).valueOf();
  console.log(`resolved --split-time ${SPLIT_TIME} on ${doc.session.date} -> ts ${SPLIT_TS}`);
}
if (!Number.isFinite(SPLIT_TS)) {
  console.error('Could not resolve a split timestamp. Provide --split-ts / --split-content / --split-time.');
  process.exit(2);
}

// TZ-aware start epoch (TimelineService.parseToUnixMs is NOT tz-aware — do not use it here).
const startAbsMs = moment.tz(doc.session.start, 'YYYY-MM-DD HH:mm:ss.SSS', tz).valueOf();
const endAbsMs = moment.tz(doc.session.end, 'YYYY-MM-DD HH:mm:ss.SSS', tz).valueOf();
const splitTick = computeSplitTick({ splitTs: SPLIT_TS, startAbsMs, intervalMs });

const slugs = Object.keys(doc.participants || {});
const decoded = decodeSeries(doc.timeline?.series || {});
const { part1: s1, part2: s2 } = splitDecodedSeries(decoded, splitTick);

const allEvents = Array.isArray(doc.timeline?.events) ? doc.timeline.events : [];
const ev1 = allEvents.filter(e => Number(e.timestamp) < SPLIT_TS);
const ev2 = allEvents.filter(e => Number(e.timestamp) >= SPLIT_TS);

const caps = doc.snapshots?.captures || [];
const cap1 = caps.filter(c => Number(c.timestamp) < SPLIT_TS);
const cap2 = caps.filter(c => Number(c.timestamp) >= SPLIT_TS);

const memos = doc.summary?.voiceMemos || [];
const memo1 = memos.filter(m => Number(m.timestamp) < SPLIT_TS);
const memo2 = memos.filter(m => Number(m.timestamp) >= SPLIT_TS);

const r1 = recomputeSummaryForPart({ series: s1, slugs, events: ev1, intervalMs, coinTimeUnitMs: intervalMs });
const r2 = recomputeSummaryForPart({ series: s2, slugs, events: ev2, intervalMs, coinTimeUnitMs: intervalMs });

// Per-color buckets cannot be exactly reconstructed from persisted per-tick data
// (coins are colored by the highest zone per award interval, which isn't stored).
// Redistribute the KNOWN original buckets between the parts, weighted by each
// part's estimated zone activity, preserving both the per-color totals and each
// part's exact coin total. The recompute buckets above are used only as weights.
const origBuckets = doc.summary?.coins?.buckets || {};
const alloc = allocateBucketsRedistribute(
  origBuckets, r1.treasureBox.buckets, r2.treasureBox.buckets,
  r1.treasureBox.totalCoins, r2.treasureBox.totalCoins
);
r1.treasureBox.buckets = alloc.part1; r1.summary.coins.buckets = alloc.part1;
r2.treasureBox.buckets = alloc.part2; r2.summary.coins.buckets = alloc.part2;

const newDate = moment.tz(SPLIT_TS, tz).format('YYYY-MM-DD');
const part2Id = moment.tz(SPLIT_TS, tz).format('YYYYMMDDHHmmss');
const part1Id = doc.sessionId; // original id retained by part 1
const fmt = (ms) => moment.tz(ms, tz).format('YYYY-MM-DD HH:mm:ss.SSS');

// --- Reconciliation invariants ---
const tick1 = Math.max(0, ...Object.values(s1).map(a => a.length));
const tick2 = Math.max(0, ...Object.values(s2).map(a => a.length));
const checks = [];
const want = (label, cond) => checks.push({ label, ok: !!cond });

want(`tick_count reconciles: ${tick1} + ${tick2} == ${doc.timeline.tick_count}`, tick1 + tick2 === doc.timeline.tick_count);
want(`events reconcile: ${ev1.length} + ${ev2.length} == ${allEvents.length}`, ev1.length + ev2.length === allEvents.length);
want(`snapshots reconcile: ${cap1.length} + ${cap2.length} == ${caps.length}`, cap1.length + cap2.length === caps.length);
want(`coin total reconciles: ${r1.treasureBox.totalCoins} + ${r2.treasureBox.totalCoins} == ${doc.summary.coins.total}`,
  r1.treasureBox.totalCoins + r2.treasureBox.totalCoins === doc.summary.coins.total);
for (const color of ['blue', 'green', 'yellow', 'orange', 'red']) {
  const got = (r1.treasureBox.buckets[color] || 0) + (r2.treasureBox.buckets[color] || 0);
  const orig = doc.summary.coins.buckets?.[color] || 0;
  want(`bucket ${color} reconciles: ${got} == ${orig}`, got === orig);
}
const bsum = (b) => ['blue', 'green', 'yellow', 'orange', 'red'].reduce((s, c) => s + (b[c] || 0), 0);
want(`part1 buckets sum to its coin total: ${bsum(r1.treasureBox.buckets)} == ${r1.treasureBox.totalCoins}`, bsum(r1.treasureBox.buckets) === r1.treasureBox.totalCoins);
want(`part2 buckets sum to its coin total: ${bsum(r2.treasureBox.buckets)} == ${r2.treasureBox.totalCoins}`, bsum(r2.treasureBox.buckets) === r2.treasureBox.totalCoins);
// Per-user cumulative coins reconcile (part1 last + part2 last == original last)
for (const slug of slugs) {
  const o = decoded[`${slug}:coins`] || [];
  const a = s1[`${slug}:coins`] || [];
  const b = s2[`${slug}:coins`] || [];
  const last = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return 0; };
  if (o.length) want(`${slug}:coins reconciles: ${last(a)} + ${last(b)} == ${last(o)}`, last(a) + last(b) === last(o));
}

console.log('=== fitness-split-session DRY RUN ===');
console.log(`file:        ${FILE}`);
console.log(`timezone:    ${tz}   intervalMs: ${intervalMs}`);
console.log(`startAbsMs:  ${startAbsMs}  (${fmt(startAbsMs)})`);
console.log(`splitTs:     ${SPLIT_TS}  (${fmt(SPLIT_TS)})  -> splitTick ${splitTick}`);
console.log(`part1 id:    ${part1Id}   ticks 0..${splitTick - 1}  (${tick1})  events ${ev1.length}  caps ${cap1.length}  memos ${memo1.length}`);
console.log(`part2 id:    ${part2Id}   ticks ${splitTick}..  (${tick2})  events ${ev2.length}  caps ${cap2.length}  memos ${memo2.length}`);
console.log(`part2 date:  ${newDate}`);
console.log('--- invariants ---');
for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.label}`);
const allOk = checks.every(c => c.ok);
console.log(`--- ${allOk ? 'ALL INVARIANTS PASS' : 'INVARIANT FAILURE — refusing to write'} ---`);

// Build the two output documents.
function buildDoc({ id, date, startMs, endMs, series, events, summaryParts, treasureBox, captures, memos, keepStrava }) {
  const participants = {};
  for (const [slug, meta] of Object.entries(doc.participants)) {
    const copy = { ...meta };
    if (!keepStrava) delete copy.strava;
    participants[slug] = copy;
  }
  const summary = { ...summaryParts };
  if (memos.length) summary.voiceMemos = memos; // else omit
  return {
    version: 3,
    sessionId: id,
    session: {
      id,
      date,
      start: fmt(startMs),
      end: fmt(endMs),
      duration_seconds: Math.round((endMs - startMs) / 1000),
    },
    timezone: tz,
    participants,
    timeline: {
      series: encodeSeries(series),
      events,
      tick_count: Math.max(0, ...Object.values(series).map(a => a.length)),
    },
    treasureBox,
    summary,
    snapshots: { captures },
    // A deliberate split: mark both parts finalized so the session-consolidation
    // policy treats each as a settled standalone session (won't re-merge them).
    finalized: true,
  };
}

if (WRITE) {
  if (!allOk) { console.error('Refusing to write: invariants failed.'); process.exit(1); }

  // IMPORTANT: write the backup OUTSIDE any scanned day folder. The session
  // lister globs every *.yml in a YYYY-MM-DD dir, so a backup left there would be
  // loaded as a duplicate sessionId and shadow the real (truncated) part 1. The
  // `_split_backups` sibling does not match the date regex, so it is ignored.
  const sessionsRoot = path.dirname(path.dirname(FILE)); // history/fitness
  const backupDir = path.join(sessionsRoot, '_split_backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `${part1Id}.${doc.session.date}.PRE-SPLIT.bak.yml`);
  fs.writeFileSync(backup, raw, 'utf8');
  console.log(`backup written: ${backup}`);

  const doc1 = buildDoc({
    id: part1Id, date: doc.session.date, startMs: startAbsMs, endMs: SPLIT_TS,
    series: s1, events: ev1, summaryParts: r1.summary, treasureBox: r1.treasureBox,
    captures: cap1, memos: memo1, keepStrava: true, // the Strava Ride covers the cycling part
  });
  const doc2 = buildDoc({
    id: part2Id, date: newDate, startMs: SPLIT_TS, endMs: endAbsMs,
    series: s2, events: ev2, summaryParts: r2.summary, treasureBox: r2.treasureBox,
    captures: cap2, memos: memo2, keepStrava: false,
  });

  const file1 = FILE; // overwrite original (part 1 keeps the id)
  const file2 = path.join(path.dirname(path.dirname(FILE)), newDate, `${part2Id}.yml`);
  fs.mkdirSync(path.dirname(file2), { recursive: true });
  const dump = (d) => yaml.dump(d, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(file1, dump(doc1), 'utf8');
  fs.writeFileSync(file2, dump(doc2), 'utf8');
  console.log(`WROTE part1: ${file1}`);
  console.log(`WROTE part2: ${file2}`);
} else {
  console.log('(dry run — pass --write to apply)');
}
