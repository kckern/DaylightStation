#!/usr/bin/env node
/**
 * piano-segment-calibrate — how well the heuristic boundary scorer agrees with
 * Learn segments a grown-up cut by hand (spec §5, calibration gate).
 *
 * Reads the household's Learn files (`<household>/piano/sheetmusic/*.yml`). A piece
 * counts when its approved segments were cut by hand from scratch
 * (`approved.proposal.scorer: manual`) and the approval kept the draft's barline
 * features. Approvals of an edited scorer proposal (`edited: true`) started from a
 * scorer's cuts, so they would favour it: they are reported on their own and kept
 * out of the overall figures. The
 * heuristic is re-run offline from those features, through the same
 * partitionSegments, and its cuts are compared with the approved ones: boundary
 * precision and recall per piece and overall, and (for drafts that recorded where
 * the engraving broke systems) split into seam and interior barlines. No network,
 * no AI spend.
 *
 * Jev needs score pictures, which are not stored, so it is not re-run here. Its
 * side of the comparison comes from the admin score page: on a piece with
 * hand-cut approved segments (with `sheetmusic.admin.boundaryScorer: calibrate`),
 * Compare with Jev shows both scorers'
 * precision/recall against them and logs `piano.sheetmusic.propose.compared`
 * (query the log store for that event to collect them). This CLI lists the
 * eligible pieces so they can be proposed there.
 *
 * Usage: node cli/piano-segment-calibrate.cli.mjs [--dir <learn dir>] [--household <id>] [--target 4] [--min 4] [--json]
 *
 * Exit codes (cli/_output.mjs): 0 ok, 1 unexpected failure, 2 usage, 3 fewer than
 * `--min` (default 4) hand-segmented pieces to measure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import {
  boundaryProbabilities, partitionSegments, recordsFromRows, splitAgreement,
} from '../portable/music/phraseSegments.mjs';
import { EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CONFIG } from '../../../../cli/_output.mjs';

const USAGE = 'Usage: node cli/piano-segment-calibrate.cli.mjs [--dir <learn dir>] [--household <id>] [--target 4] [--min 4] [--json]\n'
  + '  --dir        folder of Learn files (default: $DAYLIGHT_BASE_PATH/data/household[-<id>]/piano/sheetmusic)\n'
  + '  --household  household id (default: the default household)\n'
  + '  --target     targetLen for the partition (default 4, the household passages default)\n'
  + '  --min        hand-segmented pieces needed (default 4)\n'
  + '  --json       print JSON instead of a table\n';

export const LIMITS = Object.freeze({ minLen: 2, maxLen: 8 });

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Why a Learn file is or is not evidence: 'eligible' or a skip reason. */
export function eligibility(file) {
  const segments = Array.isArray(file?.segments) ? file.segments : [];
  if (!segments.length) return 'not-approved';
  const proposal = isObject(file?.approved?.proposal) ? file.approved.proposal : null;
  if (!proposal) return 'no-provenance';
  if (proposal.scorer !== 'manual') return proposal.edited === true ? 'edited-proposal' : 'scorer-cut';
  if (!Array.isArray(proposal.features) || !proposal.features.length || !Array.isArray(proposal.featureKeys)) return 'no-features';
  if (typeof proposal.contentSha256 === 'string' && typeof file.contentSha256 === 'string' && proposal.contentSha256 !== file.contentSha256) {
    return 'features-from-another-version';
  }
  const lastEnd = Math.max(...segments.map((s) => s.end));
  if (!(lastEnd < proposal.features.length + 1)) return 'features-do-not-fit';
  return 'eligible';
}

const round = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

function scorePiece(name, file, targetLen) {
  const { featureKeys, features } = file.approved.proposal;
  const records = recordsFromRows(featureKeys, features);
  const measureCount = records.length + 1;
  const reference = file.segments.map(({ start, end }) => ({ start, end }));
  const heuristic = partitionSegments(measureCount, boundaryProbabilities(records), { ...LIMITS, targetLen });
  const seams = Array.isArray(file.approved.proposal.seams) ? file.approved.proposal.seams : null;
  const split = splitAgreement(heuristic, reference, measureCount, seams || []);
  const agreement = split.all;
  const counts = (a) => ({ tp: a.tp, fp: a.fp, fn: a.fn, nearTp: a.tolerant.tp });
  return {
    name, scoreId: file.scoreId ?? null, measureCount, tp: agreement.tp, fp: agreement.fp, fn: agreement.fn,
    precision: agreement.precision, recall: agreement.recall,
    nearPrecision: agreement.tolerant.precision, nearRecall: agreement.tolerant.recall, nearTp: agreement.tolerant.tp,
    // Only when the draft recorded where its engraving broke systems.
    ...(seams ? { seamCounts: counts(split.seams), interiorCounts: counts(split.interior) } : {}),
  };
}

/** Totals over the pieces that recorded seams, for seam and interior barlines apart. */
function splitTotals(pieces) {
  const known = pieces.filter((p) => p.seamCounts);
  if (!known.length) return null;
  const of = (key) => totals(known.map((p) => p[key]));
  return { pieces: known.length, seams: of('seamCounts'), interior: of('interiorCounts') };
}

function totals(pieces) {
  const sum = (key) => pieces.reduce((n, p) => n + p[key], 0);
  const tp = sum('tp'); const fp = sum('fp'); const fn = sum('fn'); const near = sum('nearTp');
  return {
    tp, fp, fn,
    precision: round(tp + fp ? tp / (tp + fp) : null),
    recall: round(tp + fn ? tp / (tp + fn) : null),
    nearPrecision: round(tp + fp ? near / (tp + fp) : null),
    nearRecall: round(tp + fn ? near / (tp + fn) : null),
  };
}

const rounded = ({ seamCounts, interiorCounts, ...p }) => ({
  ...p, precision: round(p.precision), recall: round(p.recall), nearPrecision: round(p.nearPrecision), nearRecall: round(p.nearRecall),
});

/**
 * Heuristic vs hand-cut segments. `pieces`/`overall` are the evidence; `edited`
 * (approved edits of a scorer's proposal, with stored features) is shown apart.
 * `near*` count a boundary one bar off as a match.
 * @param {Array<{ name: string, file: object }>} files
 * @param {{ targetLen?: number }} [opts]
 */
export function calibrate(files, { targetLen = 4 } = {}) {
  const pieces = [];
  const edited = [];
  const skipped = {};
  for (const { name, file } of files) {
    const why = eligibility(file);
    if (why === 'eligible') { pieces.push(scorePiece(name, file, targetLen)); continue; }
    skipped[why] = (skipped[why] || 0) + 1;
    const proposal = file?.approved?.proposal;
    if (why === 'edited-proposal' && Array.isArray(proposal?.features) && proposal.features.length && Array.isArray(proposal.featureKeys)) {
      edited.push(scorePiece(name, file, targetLen));
    }
  }
  return {
    pieces: pieces.map(rounded),
    overall: totals(pieces),
    bySeam: splitTotals(pieces),
    edited: edited.map(rounded),
    skipped,
  };
}

export function parseArgs(argv) {
  const out = { dir: null, household: null, target: 4, min: 4, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--dir') out.dir = value();
    else if (arg === '--household') out.household = value();
    else if (arg === '--target' || arg === '--min') {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new Error(`${arg} must be a positive whole number`);
      out[arg.slice(2)] = n;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function defaultDir(household) {
  const base = fs.existsSync('/.dockerenv') ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
  if (!base) return null;
  return path.join(base, 'data', household ? `household-${household}` : 'household', 'piano', 'sheetmusic');
}

export function readLearnFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).sort().map((name) => ({
    name,
    file: yaml.load(fs.readFileSync(path.join(dir, name), 'utf8')) || {},
  }));
}

const HEADER = 'piece                                          bars  tp  fp  fn  precision  recall  ±1 prec  ±1 rec';
const cell = (v, w) => String(v ?? 'n/a').padStart(w);
const row = (name, p) => `${name.padEnd(46).slice(0, 46)} ${cell(p.measureCount ?? '', 4)} ${cell(p.tp, 3)} ${cell(p.fp, 3)} ${cell(p.fn, 3)}  ${cell(p.precision, 9)}  ${cell(p.recall, 6)}  ${cell(p.nearPrecision, 7)}  ${cell(p.nearRecall, 6)}`;

function table(result) {
  const lines = [HEADER];
  for (const p of result.pieces) lines.push(row(p.name, p));
  lines.push(row('overall', result.overall));
  if (result.bySeam) {
    lines.push(row(`  at system breaks (${result.bySeam.pieces} pieces)`, result.bySeam.seams));
    lines.push(row('  elsewhere', result.bySeam.interior));
  }
  if (result.edited.length) {
    lines.push('', 'edited scorer proposals (not counted above):', HEADER);
    for (const p of result.edited) lines.push(row(p.name, p));
  }
  const skips = Object.entries(result.skipped).map(([k, n]) => `${k} ${n}`).join(', ');
  if (skips) lines.push(`skipped: ${skips}`);
  return lines.join('\n');
}

export async function main(argv, { stdout = process.stdout, stderr = process.stderr, readFiles = readLearnFiles } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (error) { stderr.write(`${error.message}\n${USAGE}`); return EXIT_USAGE; }
  if (args.help) { stdout.write(USAGE); return EXIT_OK; }
  const dir = args.dir || defaultDir(args.household);
  if (!dir) { stderr.write(`No --dir and no DAYLIGHT_BASE_PATH.\n${USAGE}`); return EXIT_USAGE; }
  let files;
  try {
    files = readFiles(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') files = [];
    else { stderr.write(`Could not read ${dir}: ${error.message}\n`); return EXIT_FAIL; }
  }
  const result = calibrate(files, { targetLen: args.target });
  stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${table(result)}\n`);
  if (result.pieces.length < args.min) {
    stderr.write(`Only ${result.pieces.length} hand-segmented piece(s) with stored features in ${dir}; calibration needs ${args.min}. `
      + 'Cut segments by hand on the admin score page (Save draft, then Approve) for more pieces, then run this again.\n');
    return EXIT_CONFIG;
  }
  stderr.write('Jev is compared on the admin score page: Propose with Jev on these pieces (event piano.sheetmusic.propose.compared).\n');
  return EXIT_OK;
}

export function runCliEntry() {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = EXIT_FAIL;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCliEntry();
