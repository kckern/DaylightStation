#!/usr/bin/env node
/**
 * piano-legit-calibrate — measures the lesson legitimacy judge before it is
 * switched on (`videos.practice.legit_model`).
 *
 * Bursts (8–40 notes, deterministic) come from the practice fixtures: 60 from
 * engaged audit sittings (label: legit) and 60 from synthetic mashing (label:
 * not legit), plus 40 from the preschool cohort's engaged sittings asked the
 * young-child question. Each burst is labelled by the deterministic filter
 * (classifyBurst) and asked the one yesNo question on its minimal MIDI log
 * (burstState: notes + five stats; nothing else).
 *
 * Usage: node __app_modules/learning/piano/cli/piano-legit-calibrate.cli.mjs [--per-label N] [--concurrency N]
 * Prints JSON. AI spend is stamped origin `cli:piano-legit-calibrate`,
 * app piano / feature lesson-legit-notes, in the AI usage ledger.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyBurst, burstState, PRESCHOOL_PRACTICE } from '../portable/practice/practiceScore.mjs';
import { mashSittings } from '../portable/practice/__fixtures__/mash.mjs';
import { cutBursts, auditEvents, mashEvents } from '../portable/practice/__fixtures__/bursts.mjs';
import { LEGIT_QUESTION, PRESCHOOL_LEGIT_QUESTION, LEGIT_PASS_PROBABILITY } from '../server/application/JudgeNoteBurst.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BAR = Object.freeze({ overall: 0.9, ambiguous: 0.8, preschool: 0.9 });

/** The deterministic calibration set. */
export function calibrationBursts({ perLabel = 60, sittings, mash = mashSittings(1) } = {}) {
  const rows = sittings ?? JSON.parse(fs.readFileSync(path.join(HERE, '../portable/practice/__fixtures__/audit-sittings.json'), 'utf8'));
  const take = (list, n) => list.slice(0, n);
  const engaged = take(rows.filter((s) => s.label === 'engaged' && s.cohort !== 'preschool' && s.notes.length >= 16)
    .flatMap((s) => cutBursts(auditEvents(s.notes), 1)), perLabel).map((events) => ({ label: true, cohort: 'school', events }));
  const mashed = take(mash.flatMap((m) => cutBursts(mashEvents(m.notes), Math.ceil(perLabel / mash.length))), perLabel)
    .map((events) => ({ label: false, cohort: 'school', events }));
  const pre = take(rows.filter((s) => s.label === 'engaged' && s.cohort === 'preschool' && s.notes.length >= 16)
    .flatMap((s) => cutBursts(auditEvents(s.notes), 1)), Math.round(perLabel * 2 / 3)).map((events) => ({ label: true, cohort: 'preschool', events }));
  return [...engaged, ...mashed, ...pre];
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const rate = (num, den) => (den ? Math.round((num / den) * 1000) / 1000 : null);

/** Run the set through the filter and the gateway; returns the report. */
export async function runCalibration({ bursts, decisionGateway, concurrency = 4 }) {
  const results = await pool(bursts, concurrency, async (b) => {
    const pre = b.cohort === 'preschool';
    const f = classifyBurst(b.events, pre ? PRESCHOOL_PRACTICE : {});
    const state = burstState(b.events, f.stats);
    let probability = null;
    let error = null;
    try {
      const res = await decisionGateway.evaluate(state, { legit: { type: 'yesNo', instructions: pre ? PRESCHOOL_LEGIT_QUESTION : LEGIT_QUESTION } });
      probability = Number(res?.answers?.legit?.probability);
      if (!Number.isFinite(probability)) { probability = null; error = 'no probability'; }
    } catch (err) { error = err.message; }
    return { ...b, verdict: f.verdict, probability, error };
  });
  const std = results.filter((r) => r.cohort === 'school' && r.probability != null);
  const pre = results.filter((r) => r.cohort === 'preschool' && r.probability != null);
  const modelLegit = (r) => r.probability >= LEGIT_PASS_PROBABILITY;
  const filterLegit = (r) => r.verdict !== 'spam'; // ambiguous falls back to legit
  const clear = std.filter((r) => r.verdict !== 'ambiguous');
  const amb = std.filter((r) => r.verdict === 'ambiguous');
  const report = {
    n: results.length,
    errors: results.filter((r) => r.error).length,
    modelAccuracy: rate(std.filter((r) => modelLegit(r) === r.label).length, std.length),
    filterAccuracy: rate(std.filter((r) => filterLegit(r) === r.label).length, std.length),
    modelFilterAgreement: rate(clear.filter((r) => modelLegit(r) === (r.verdict === 'legit')).length, clear.length),
    ambiguous: { n: amb.length, modelAccuracy: rate(amb.filter((r) => modelLegit(r) === r.label).length, amb.length) },
    byLabel: {
      engaged: { n: std.filter((r) => r.label).length, modelLegit: std.filter((r) => r.label && modelLegit(r)).length },
      mash: { n: std.filter((r) => !r.label).length, modelLegit: std.filter((r) => !r.label && modelLegit(r)).length },
    },
    preschool: { n: pre.length, modelAcceptRate: rate(pre.filter(modelLegit).length, pre.length) },
    bar: BAR,
  };
  report.passes = report.modelAccuracy != null && report.modelAccuracy >= BAR.overall
    && (report.ambiguous.n === 0 || report.ambiguous.modelAccuracy >= BAR.ambiguous)
    && (report.preschool.n === 0 || report.preschool.modelAcceptRate >= BAR.preschool)
    && report.errors === 0;
  return report;
}

export function parseArgs(argv) {
  const o = { perLabel: 60, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--per-label') o.perLabel = Number(argv[++i]);
    else if (argv[i] === '--concurrency') o.concurrency = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') o.help = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return o;
}

async function loadRealRuntime() {
  const [{ getConfigService }, { JevAdapter }, { default: axios }, { createCliAiUsageLedger }] = await Promise.all([
    import('../../../../cli/_bootstrap.mjs'),
    import('#adapters/ai/JevAdapter.mjs'),
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
      .scoped({ app: 'piano', feature: 'lesson-legit-notes' }),
  };
}

export async function main(argv, { loadRuntime = loadRealRuntime, stdout = process.stdout, stderr = process.stderr } = {}) {
  let opts;
  try { opts = parseArgs(argv); } catch (err) { stderr.write(`${err.message}\n`); return 2; }
  if (opts.help) { stdout.write('node piano-legit-calibrate.cli.mjs [--per-label N] [--concurrency N]\n'); return 0; }
  try {
    const { runWithOrigin } = await import('#system/runtime/aiContext.mjs');
    const { decisionGateway } = await loadRuntime();
    const report = await runWithOrigin('cli:piano-legit-calibrate', () => runCalibration({
      bursts: calibrationBursts({ perLabel: opts.perLabel }), decisionGateway, concurrency: opts.concurrency,
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
