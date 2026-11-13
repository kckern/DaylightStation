#!/usr/bin/env node
/**
 * piano-goodfaith-calibrate — measures the session-level good-faith judge
 * before it is switched on (`videos.practice.good_faith_model`).
 *
 * Every engagement-audit sitting (engaged / low-touch / absentee / rhythm-loop,
 * school and preschool cohorts) plus the synthetic mash sittings is turned into
 * the exact state the kiosk sends (sittingGoodFaithState: practice-like notes,
 * notes per minute, lesson facts, presence check-ins) and asked the one `score`
 * question. The audit has no check-in record, so check-ins are replayed the
 * way the kiosk now opens them (presenceLadder.replayLadder, 2026-11-13): the
 * presence ladder's rung intervals and keepalive deadline, every check-in
 * answered at once, each carrying its rung and minimal-effort mark (a child
 * who wanders off and comes back to tap is the absentee case).
 *
 * Expected: engaged + low-touch credit; absentee, rhythm-loop and mash drill.
 * Bar (owner, 2026-11-12): false drills on engaged + low-touch ≤ 5 %, absentees
 * caught ≥ 90 % — overall and in each cohort.
 *
 * Usage: node __app_modules/learning/piano/cli/piano-goodfaith-calibrate.cli.mjs [--limit N] [--concurrency N]
 * Prints JSON. AI spend: origin `cli:piano-goodfaith-calibrate`, app piano /
 * feature lesson-good-faith.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sittingGoodFaithState, goodFaithQuestion, goodFaithFromAnswer, fallbackCredited } from '../portable/practice/sittingGoodFaith.mjs';
import { weighEvents, PRESCHOOL_PRACTICE, PRACTICE_DEFAULTS } from '../portable/practice/practiceScore.mjs';
import { GOOD_FAITH_DEFAULTS, PRESCHOOL_POLICY } from '../portable/practice/goodFaith.mjs';
import { replayLadder, ladderConfig } from '../portable/practice/presenceLadder.mjs';
import { mashSittings } from '../portable/practice/__fixtures__/mash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BAR = Object.freeze({ falseDrillMax: 0.05, absenteeCaughtMin: 0.9, errorRateMax: 0.02 });
const CREDIT_LABELS = new Set(['engaged', 'low-touch']);

/**
 * The kiosk's presence check-ins, replayed with the ladder (default household
 * tunables; preschool stays on the note): `{ atMs, scales, rung, minimal, answered }`.
 */
export function replayedCheckIns(events, playedSec, { preschool = false } = {}) {
  const cfg = ladderConfig({}, { preschool });
  return replayLadder(events, playedSec, cfg, { preschool })
    .map(({ atMs, scales, rung, minimal, answered }) => ({ atMs, scales, rung, minimal, answered }));
}

const auditEvents = (notes) => notes.map(([t, note, velocity]) => ({ t: Math.round(t * 1000), note, velocity }));
const mashEvents = (notes) => notes.map(([t, note, velocity]) => ({ t, note, velocity }));

function item({ id, label, cohort, events, lessonSec, playedSec }) {
  const preschool = cohort === 'preschool';
  const checkIns = replayedCheckIns(events, playedSec, { preschool });
  const state = sittingGoodFaithState({ events, startMs: 0, lessonSec, watchedSec: playedSec, checkIns, preschool });
  const practiceNotes = weighEvents(events, preschool ? PRESCHOOL_PRACTICE : {}).filter((e) => e.weight >= PRACTICE_DEFAULTS.legitWeight).length;
  return {
    id, label, cohort, expectCredit: CREDIT_LABELS.has(label), state,
    fallback: fallbackCredited({ practiceNotes, checkInsAnswered: checkIns.length }),
    fallbackNotesOnly: fallbackCredited({ practiceNotes, checkInsAnswered: 0 }),
  };
}

/** The labelled calibration set (deterministic). `limit` caps each (label, cohort) group. */
export function calibrationSittings({ limit = Infinity, sittings, mash = mashSittings(1) } = {}) {
  const rows = sittings ?? JSON.parse(fs.readFileSync(path.join(HERE, '../portable/practice/__fixtures__/audit-sittings.json'), 'utf8'));
  const taken = new Map();
  const take = (k) => { const n = (taken.get(k) || 0) + 1; taken.set(k, n); return n <= limit; };
  const out = [];
  for (const s of rows) {
    if (!take(`${s.label}/${s.cohort}`)) continue;
    out.push(item({ id: s.id, label: s.label, cohort: s.cohort, events: auditEvents(s.notes), lessonSec: s.durationSec, playedSec: s.playedSec }));
  }
  for (const m of mash) {
    if (!take('mash/school')) continue;
    out.push(item({ id: `mash-${m.kind}`, label: 'mash', cohort: 'school', events: mashEvents(m.notes), lessonSec: m.durationSec, playedSec: m.durationSec }));
  }
  return out;
}

const rate = (num, den) => (den ? Math.round((num / den) * 1000) / 1000 : null);
const passOf = (cohort) => (cohort === 'preschool' ? PRESCHOOL_POLICY.passScore : GOOD_FAITH_DEFAULTS.passScore);

function metrics(rows, credited) {
  const ok = rows.filter((r) => credited(r) != null);
  const want = ok.filter((r) => r.expectCredit);
  const caught = (label) => {
    const xs = ok.filter((r) => r.label === label);
    return rate(xs.filter((r) => !credited(r)).length, xs.length);
  };
  return {
    n: ok.length,
    accuracy: rate(ok.filter((r) => credited(r) === r.expectCredit).length, ok.length),
    falseDrillRate: rate(want.filter((r) => !credited(r)).length, want.length),
    falseDrills: want.filter((r) => !credited(r)).length,
    absenteeCaught: caught('absentee'),
    rhythmLoopCaught: caught('rhythm-loop'),
    mashCaught: caught('mash'),
  };
}

function meanScores(rows) {
  const by = {};
  for (const r of rows.filter((x) => Number.isFinite(x.score))) (by[r.label] = by[r.label] || []).push(r.score);
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, {
    n: v.length,
    mean: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10,
    min: Math.min(...v),
  }]));
}

/** The report from judged rows ({ label, cohort, expectCredit, score|null, fallback }). */
export function summarise(rows) {
  const model = (r) => (Number.isFinite(r.score) ? r.score >= passOf(r.cohort) : null);
  const fb = (r) => !!r.fallback;
  const fbNotes = (r) => !!r.fallbackNotesOnly;
  const cohort = (c) => rows.filter((r) => r.cohort === c);
  const report = {
    overall: metrics(rows, model),
    school: { ...metrics(cohort('school'), model), scores: meanScores(cohort('school')) },
    preschool: { ...metrics(cohort('preschool'), model), scores: meanScores(cohort('preschool')) },
    fallback: {
      rule: 'credit iff >= 6 practice-like notes or an answered presence check-in',
      school: metrics(cohort('school'), fb),
      preschool: metrics(cohort('preschool'), fb),
      notesOnly: { school: metrics(cohort('school'), fbNotes), preschool: metrics(cohort('preschool'), fbNotes) },
    },
    bar: BAR,
  };
  return report;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Ask the gateway about every item; returns the report. */
export async function runCalibration({ items, decisionGateway, concurrency = 6, costOf = () => null }) {
  let cost = 0;
  let inputTokens = 0;
  let answered = 0;
  const rows = await pool(items, concurrency, async (it) => {
    const preschool = it.cohort === 'preschool';
    let score = null;
    let error = null;
    try {
      const res = await decisionGateway.evaluate(it.state, { goodFaith: goodFaithQuestion(preschool) }, { timeout: 20000 });
      score = goodFaithFromAnswer(res?.answers?.goodFaith);
      if (score == null) error = 'no score';
      else {
        answered += 1;
        inputTokens += Number(res?.usage?.inputTokens) || 0;
        cost += Number(costOf(res?.model, res?.usage)) || 0;
      }
    } catch (err) { error = err.message; }
    return { id: it.id, label: it.label, cohort: it.cohort, expectCredit: it.expectCredit, fallback: it.fallback, fallbackNotesOnly: it.fallbackNotesOnly, score, error };
  });
  const report = summarise(rows);
  const errors = rows.filter((r) => r.error).length;
  report.n = rows.length;
  report.errors = errors;
  report.cost = {
    totalUsd: Math.round(cost * 1e6) / 1e6,
    perSittingUsd: answered ? Math.round((cost / answered) * 1e7) / 1e7 : null,
    meanInputTokens: answered ? Math.round(inputTokens / answered) : null,
  };
  const meets = (m) => m.n > 0 && m.falseDrillRate != null && m.falseDrillRate <= BAR.falseDrillMax
    && (m.absenteeCaught == null || m.absenteeCaught >= BAR.absenteeCaughtMin);
  report.passes = meets(report.overall) && meets(report.school) && meets(report.preschool)
    && errors / Math.max(1, rows.length) <= BAR.errorRateMax;
  report.misses = rows.filter((r) => Number.isFinite(r.score) && (r.score >= passOf(r.cohort)) !== r.expectCredit)
    .map((r) => ({ id: r.id, label: r.label, cohort: r.cohort, score: r.score }));
  return report;
}

export function parseArgs(argv) {
  const o = { limit: Infinity, concurrency: 6 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') o.limit = Number(argv[++i]);
    else if (argv[i] === '--concurrency') o.concurrency = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') o.help = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return o;
}

async function loadRealRuntime() {
  const [{ getConfigService }, { JevAdapter }, { estimateCostUsd }, { default: axios }, { createCliAiUsageLedger }] = await Promise.all([
    import('../../../../cli/_bootstrap.mjs'),
    import('#adapters/ai/JevAdapter.mjs'),
    import('#adapters/ai/aiPricing.mjs'),
    import('axios'),
    import('../../../../cli/_aiUsage.mjs'),
  ]);
  const configService = await getConfigService();
  const apiKey = configService.getSystemAuth('jev', 'api_key');
  if (!apiKey) throw new Error('No Jev key: system auth jev.api_key is not set');
  const aiUsageLedger = createCliAiUsageLedger(configService);
  const logger = { info() {}, debug() {}, warn() {}, error() {}, child() { return logger; } };
  return {
    decisionGateway: new JevAdapter({ apiKey }, { httpClient: axios, logger, aiUsageLedger })
      .scoped({ app: 'piano', feature: 'lesson-good-faith' }),
    costOf: (model, usage) => estimateCostUsd(model || 'jev', { promptTokens: usage?.inputTokens, completionTokens: usage?.outputTokens }),
  };
}

export async function main(argv, { loadRuntime = loadRealRuntime, stdout = process.stdout, stderr = process.stderr } = {}) {
  let opts;
  try { opts = parseArgs(argv); } catch (err) { stderr.write(`${err.message}\n`); return 2; }
  if (opts.help) { stdout.write('node piano-goodfaith-calibrate.cli.mjs [--limit N] [--concurrency N]\n'); return 0; }
  try {
    const { runWithOrigin } = await import('#system/runtime/aiContext.mjs');
    const { decisionGateway, costOf } = await loadRuntime();
    const report = await runWithOrigin('cli:piano-goodfaith-calibrate', () => runCalibration({
      items: calibrationSittings({ limit: opts.limit }), decisionGateway, concurrency: opts.concurrency, costOf,
    }));
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (err) {
    stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
