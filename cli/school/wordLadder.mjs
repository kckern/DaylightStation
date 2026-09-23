#!/usr/bin/env node
/**
 * cli/school/wordLadder.mjs — `school word-ladder` — word-ladder operations,
 * for any word package. Nothing here names a language: titles, quiz copy and
 * topics all come from the deck's lexicon.
 *
 *   quiz         write the printed quiz SOURCE for a lexicon deck
 *                (then: `school docs publish <file>`, render with variety=omr)
 *   enroll-plan  write an `ops assign` plan file adding the word-ladder
 *                program to a learner's CURRENT assignment (then:
 *                `school ops assign <learner> --file <plan> … --apply`)
 *
 * A composition root: adapters are wired here, the rules are in
 * `#domains/school/wordLadder`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { YamlLearningContentRepository } from '#adapters/school/catalog/YamlLearningContentRepository.mjs';
import { YamlLexiconRepository } from '#adapters/school/catalog/YamlLexiconRepository.mjs';
import { LexiconDeckLoader } from '#adapters/school/catalog/LexiconDeckLoader.mjs';
import {
  STATUS_SCHEMA_V3, buildLearnerQuizSource, buildWordQuizSource, emptyStatusV3, formatTrace, hashString, isoWeekOf, migrateStatusV2,
} from '#domains/school/wordLadder/index.mjs';

const ENTRYPOINT = fileURLToPath(import.meta.url);
const DEFAULT_BASE_URL = process.env.SCHOOL_BASE_URL || 'http://localhost:3111/api/v1/school';
const DEFAULT_LOGSTORE = process.env.DAYLIGHT_LOGSTORE || 'http://localhost:9428';
const LOG_QUERY_LIMIT = 5000;
const HELP = `school word-ladder — word-ladder operations (any word package)

Usage:
  school.mjs word-ladder quiz --deck <deckId|slug> [--seed N] [--force]
                              [--data-dir P] [--media-dir P] [--source-root P]
  school.mjs word-ladder quiz --learner <id> --package <pkg> [--week <YYYY-Www>]
                              [--rows N] [--seed N] [--force]
                              [--data-dir P] [--media-dir P] [--source-root P]
  school.mjs word-ladder enroll-plan --learner <id> --deck <deckId|slug> --out <file>
                              [--title TEXT] [--base-url URL] [--data-dir P] [--media-dir P]
  school.mjs word-ladder trace --learner <id> [--day YYYY-MM-DD | --sitting ID]
                              [--mode live|test|all] [--data-dir P]

A full deck id (containing '/') is used as-is. A bare slug resolves only when
exactly one flashcard deck id ends with /<slug>; otherwise the matches are listed.
quiz --deck writes <source-root>/<deckId>-quiz.yml — the WHOLE deck (an
un-introduced word's miss is logged only, never demoted). quiz --learner
writes <source-root>/<deckDir>/<pkg>-quiz-<learner>-<isoWeek>.yml — only
words that learner has been introduced to, this ISO week's introductions
first, then other unsettled words, then a seeded sample of mastered words
(default source root: content/school/learning-catalog/documents under
--data-dir). An identical file is left alone; a different one (e.g. a
reprint after new introductions) is refused unless --force.
enroll-plan reads GET <base-url>/lifecycle/assignments/<learner> and writes a
plan for 'school ops assign' with the word-ladder program appended (or
replacing that learner's existing word-ladder program). The tile title
defaults to the lexicon's program.title.
trace reads $DAYLIGHT_LOGSTORE (default ${DEFAULT_LOGSTORE}) for that
learner's school.word-ladder.* events and prints a timeline: one header line
per sitting trace, one line per item (time, kind, word, task/layout,
response, correct/score, ms), transitions and stalls called out, and the
item the sitting ended on marked when it didn't end on goal or the time cap.
--day defaults to today when neither --day nor --sitting is given. When the
store is unreachable or has nothing for the window, falls back to the day
file(s) under <data-dir>/users/<learner>/apps/school/word-ladder/*/days/ —
that fallback has absolute timestamps but no per-item timing detail.
`;

/** A full deck id as-is; a bare slug only when exactly one known deck id ends with `/<slug>`. */
export function resolveDeckId(value, deckIds = []) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('--deck is required');
  const wanted = value.trim();
  if (wanted.includes('/')) return wanted;
  const matches = deckIds.filter((id) => typeof id === 'string' && (id === wanted || id.endsWith(`/${wanted}`)));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`no flashcard deck matches '${wanted}'`);
  throw new Error(`'${wanted}' is ambiguous: ${matches.sort().join(', ')} — pass the full deck id`);
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

function roots(argv, env = process.env) {
  const base = env.DAYLIGHT_BASE_PATH || '/usr/src/app';
  const dataDir = path.resolve(option(argv, '--data-dir') ?? path.join(base, 'data'));
  const mediaDir = path.resolve(option(argv, '--media-dir') ?? path.join(base, 'media'));
  const sourceRoot = path.resolve(dataDir, option(argv, '--source-root') ?? 'content/school/learning-catalog/documents');
  return { dataDir, mediaDir, sourceRoot };
}

/** The lexicon + learning-content catalog, wired the same way for every command that needs it. */
function catalog(argv) {
  const { dataDir, mediaDir } = roots(argv);
  const lexicons = new YamlLexiconRepository({ mediaRoot: path.join(mediaDir, 'school') });
  const content = new YamlLearningContentRepository({
    documentDirectories: [path.join(dataDir, 'content/school/learning-catalog/documents')],
    bankDirectories: [path.join(dataDir, 'content/school/learning-catalog/question-banks')],
    deckDirectories: [path.join(dataDir, 'content/school/learning-catalog/flashcard-decks')],
  });
  return { dataDir, mediaDir, lexicons, content };
}

/** The lexicon deck `--deck` names, and its validated lexicon. */
async function loadDeck(argv) {
  const { lexicons, content } = catalog(argv);
  const flag = option(argv, '--deck');
  const deckIds = typeof flag === 'string' && !flag.includes('/')
    ? (await content.listFlashcardDecks()).map((raw) => raw?.id)
    : [];
  const deckId = resolveDeckId(flag, deckIds);
  const deck = await new LexiconDeckLoader({ content, lexicons }).getFlashcardDeck(deckId);
  if (!deck || !Array.isArray(deck.words)) throw new Error(`'${deckId}' is not a lexicon deck`);
  return { deckId, deck, lexicon: lexicons.getLexicon(deck.lexicon) };
}

/**
 * Writes a `school.document-source/v1` quiz to `<sourceRoot>/<source.id>.yml`.
 * An identical file is left alone; a different one (e.g. a reprint after new
 * introductions) is refused unless `--force` — a republish must never pin the
 * old card. Shared by both quiz forms so neither drifts from the other.
 */
function writeQuizSource(argv, io, sourceRoot, source, extraNextLine = '') {
  const file = path.join(sourceRoot, `${source.id}.yml`);
  const text = yaml.dump(source, { lineWidth: -1, noRefs: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') === text) { io.stdout.write(`unchanged: ${file}\n`); return 0; }
    if (!argv.includes('--force')) { io.stderr.write(`${file} differs; pass --force to overwrite\n`); return 1; }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  io.stdout.write(`wrote ${file}\nnext: node cli/school.mjs docs publish ${path.relative(sourceRoot, file)}\n${extraNextLine}`);
  return 0;
}

async function quizForDeck(argv, io) {
  const { sourceRoot } = roots(argv);
  const { deckId, deck, lexicon } = await loadDeck(argv);
  const seedFlag = option(argv, '--seed');
  const seed = seedFlag !== undefined ? Number(seedFlag) : hashString(deckId) % 100000;
  if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a whole number');
  const source = buildWordQuizSource({ deck, lexicon, seed });
  return writeQuizSource(argv, io, sourceRoot, source);
}

/**
 * The Monday ('YYYY-MM-DD') of an ISO-8601 week ('YYYY-Www') — the inverse of
 * isoWeekOf. Accepts either case ('2026-W39' or '2026-w39'): the generated
 * document id always lowercases the week, but a person typing --week by hand
 * naturally reaches for the ISO-cased form. Pure UTC arithmetic.
 */
function mondayOfIsoWeek(weekStr) {
  const m = /^(\d{4})-W(\d{2})$/i.exec(weekStr);
  if (!m) throw new Error(`--week must look like YYYY-Www, got '${weekStr}'`);
  const [, yearStr, weekNumStr] = m;
  const jan4 = Date.UTC(Number(yearStr), 0, 4);
  const jan4Weekday = new Date(jan4).getUTCDay() || 7; // Monday = 1 .. Sunday = 7
  const week1Monday = jan4 - (jan4Weekday - 1) * 86_400_000;
  return new Date(week1Monday + (Number(weekNumStr) - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** `users/<id>/apps/school/word-ladder/<pkg>/status.yml`, migrating a v1 file. Missing/empty reads as a fresh status. */
function loadLearnerStatus(dataDir, learnerId, pkg) {
  const file = path.join(dataDir, 'users', learnerId, 'apps', 'school', 'word-ladder', pkg, 'status.yml');
  if (!fs.existsSync(file)) return emptyStatusV3();
  const raw = yaml.load(fs.readFileSync(file, 'utf8'));
  if (raw == null) return emptyStatusV3();
  if (raw.schema === STATUS_SCHEMA_V3) return { ...emptyStatusV3(), ...raw };
  return migrateStatusV2(raw);
}

/** Every lexicon deck whose lexicon belongs to `pkg`, sorted by id for a deterministic deck order. */
async function decksForPackage(argv, pkg) {
  const { lexicons, content } = catalog(argv);
  const all = await new LexiconDeckLoader({ content, lexicons }).listFlashcardDecks();
  const decks = all
    .filter((deck) => Array.isArray(deck?.words) && typeof deck?.lexicon === 'string')
    .filter((deck) => { try { return lexicons.getLexicon(deck.lexicon).package === pkg; } catch { return false; } })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!decks.length) throw new Error(`no lexicon decks found for package '${pkg}'`);
  return { decks, lexicon: lexicons.getLexicon(decks[0].lexicon) };
}

async function quizForLearner(argv, io) {
  const { dataDir, sourceRoot } = roots(argv);
  const learnerId = option(argv, '--learner');
  const pkg = option(argv, '--package');
  if (!pkg) throw new Error('--package is required with --learner');
  const { decks, lexicon } = await decksForPackage(argv, pkg);
  const status = loadLearnerStatus(dataDir, learnerId, pkg);
  const weekFlag = option(argv, '--week');
  const day = weekFlag ? mondayOfIsoWeek(weekFlag) : new Date().toISOString().slice(0, 10);
  const rowsFlag = option(argv, '--rows');
  const rowLimit = rowsFlag !== undefined ? Number(rowsFlag) : 20;
  if (!Number.isInteger(rowLimit) || rowLimit <= 0) throw new Error('--rows must be a whole positive number');
  const seedFlag = option(argv, '--seed');
  const seed = seedFlag !== undefined ? Number(seedFlag) : hashString(`${pkg}|${learnerId}|${isoWeekOf(day)}`) % 100000;
  if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a whole number');
  const source = buildLearnerQuizSource({
    status, lexicon, decks, learnerId, day, seed, rowLimit,
  });
  return writeQuizSource(argv, io, sourceRoot, source, 'then mint a fresh card: POST /api/v1/school/print/render (see docs/reference/school/print-documents.md)\n');
}

async function quiz(argv, io) {
  const learnerId = option(argv, '--learner');
  if (learnerId !== undefined) return quizForLearner(argv, io);
  return quizForDeck(argv, io);
}

export function buildEnrollPlan(current, { deckId, title }) {
  if (typeof title !== 'string' || !title.trim()) throw new Error('an enrollment needs a tile title');
  const programs = (current?.programs ?? []).filter((row) => !(row?.programId === 'flashcards' && row.policy?.mode === 'word-ladder'));
  programs.push({
    programId: 'flashcards', deckId, title: title.trim(),
    policy: { mode: 'word-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
  });
  return { courses: current?.courses ?? [], units: current?.units ?? [], programs };
}

async function enrollPlan(argv, io, fetchImpl = globalThis.fetch) {
  const learner = option(argv, '--learner');
  const out = option(argv, '--out');
  if (!learner || !out) throw new Error('enroll-plan requires --learner and --out');
  const { deckId, lexicon } = await loadDeck(argv);
  const baseUrl = (option(argv, '--base-url') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const response = await fetchImpl(`${baseUrl}/lifecycle/assignments/${encodeURIComponent(learner)}`);
  if (!response.ok) throw new Error(`could not read ${learner}'s assignment (HTTP ${response.status})`);
  const plan = buildEnrollPlan(await response.json(), { deckId, title: option(argv, '--title') ?? lexicon.program.title });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, yaml.dump(plan, { lineWidth: -1, noRefs: true }), 'utf8');
  io.stdout.write(`wrote ${out} (${plan.programs.length} programs)\n`);
  return 0;
}

// ── trace (spec §8 "school word-ladder trace") ─────────────────────────────
// Reads the log store for this learner's school.word-ladder.* events, turns
// them into a timeline via the pure `formatTrace` (backend/…/wordLadder/trace.mjs),
// and falls back to the day file(s) on disk when the store is unreachable or
// empty. A composition root like the rest of this file: all the policy (how
// events group into a trace, how a line is worded) lives in the domain; this
// only fetches, un-flattens and prints.

/** UTC today as YYYY-MM-DD — only used as the trace window's default when the
 * caller names neither --day nor --sitting; the query window is generous
 * (see `timeWindow`) so a few hours of local/UTC drift near midnight cannot
 * silently exclude the very events being asked for. */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Unquoted, VictoriaLogs tokenizes a value on `.` and `-`, so a learnerId or
// sittingId containing either (a sitting id is always `<pkg>.<token>.<n>`)
// matches far more than intended. Quoting makes it an exact-phrase match.
function quoteLogsqlValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function traceQuery({ learnerId, mode, sittingId }) {
  const parts = ['_msg:~"school.word-ladder"', `data.learnerId:${quoteLogsqlValue(learnerId)}`];
  if (mode && mode !== 'all') parts.push(`data.mode:${quoteLogsqlValue(mode)}`);
  if (sittingId) parts.push(`data.sittingId:${quoteLogsqlValue(sittingId)}`);
  return parts.join(' AND ');
}

/**
 * A `--day` window is generous (that day plus the next, i.e. up to 48h) — the
 * log store's own `_time` is local time mislabeled as UTC (see CLAUDE.md
 * "Reading Logs"), so a tight midnight-to-midnight window can miss events
 * near either boundary. A `--sitting` with no `--day` doesn't know which day
 * to look at, so it takes a 30-day lookback instead; with neither, 2 days is
 * plenty for "what happened around today".
 */
function timeWindow({ day, sittingId }) {
  if (day) return `_time:[${day}T00:00:00, ${addDaysIso(day, 2)}T00:00:00]`;
  return sittingId ? '_time:30d' : '_time:2d';
}

function parseLogLines(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* one malformed line must not sink the whole trace */ }
  }
  return rows;
}

/** "true"/"false"/"null"/a numeric string/a JSON array -> its real type. VictoriaLogs stores every field as a string. */
function coerceLogValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (typeof value === 'string' && value !== '' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  // An array (a quiz queue, a round's word ids) is stored as its JSON text.
  if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function setPath(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * A log-store row is flat: `{_msg, _time, level, "data.itemId": "...", "data.to.state": "mastered", ...}`.
 * `formatTrace` wants nested, typed `{ msg, time, level, data }` — this is
 * the one place that un-flattening and string coercion happen, so the
 * domain formatter stays free of store-shape knowledge (and stays testable
 * against clean fixtures).
 */
function unflattenRow(row) {
  const data = {};
  const context = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('data.')) setPath(data, key.slice('data.'.length).split('.'), coerceLogValue(value));
    else if (key.startsWith('context.')) setPath(context, key.slice('context.'.length).split('.'), coerceLogValue(value));
  }
  return { msg: row._msg, time: row._time, level: row.level, data, context };
}

/** Every word package this learner has a word-ladder day file under, sorted for determinism. */
function packageDirs(root) {
  try { return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
  catch { return []; }
}

/**
 * The fallback source (spec §8): the day file(s) on disk, when the log store
 * is unreachable or has aged the events out. No `--package` flag exists, so
 * a `--day` reads every package this learner has a matching day file under;
 * a `--sitting` (no day known from the id alone) scans every day file of
 * every package for one whose `sittings` map contains that id.
 */
function dayFileFallback(io, dataDir, learnerId, { day, sittingId }) {
  const root = path.join(dataDir, 'users', learnerId, 'apps', 'school', 'word-ladder');
  const pkgDirs = packageDirs(root);
  const blocks = [];
  if (sittingId) {
    const bare = sittingId.startsWith('test.') ? sittingId.slice('test.'.length) : sittingId;
    const guessedPkg = bare.split('.')[0];
    const candidates = pkgDirs.includes(guessedPkg) ? [guessedPkg] : pkgDirs;
    for (const pkg of candidates) {
      const daysDir = path.join(root, pkg, 'days');
      let files = [];
      try { files = fs.readdirSync(daysDir); } catch { continue; }
      for (const file of files.filter((f) => /\.ya?ml$/.test(f)).sort()) {
        const raw = yaml.load(fs.readFileSync(path.join(daysDir, file), 'utf8'));
        if (raw?.sittings?.[sittingId]) {
          blocks.push(`# ${learnerId} · ${pkg} · ${file.replace(/\.ya?ml$/, '')} · sitting ${sittingId}\n${formatTrace([], { dayFile: raw })}`);
        }
      }
    }
  } else if (day) {
    for (const pkg of pkgDirs) {
      const file = path.join(root, pkg, 'days', `${day}.yml`);
      if (!fs.existsSync(file)) continue;
      const raw = yaml.load(fs.readFileSync(file, 'utf8'));
      blocks.push(`# ${learnerId} · ${pkg} · ${day}\n${formatTrace([], { dayFile: raw })}`);
    }
  }
  if (!blocks.length) {
    const where = day ? ` on ${day}` : sittingId ? ` (sitting ${sittingId})` : '';
    io.stderr.write(`no trace found for ${learnerId}${where} — the log store had nothing and no matching day file exists\n`);
    return 1;
  }
  io.stdout.write(`${blocks.join('\n\n')}\n`);
  return 0;
}

async function trace(argv, io, fetchImpl = globalThis.fetch) {
  const { dataDir } = roots(argv);
  const learnerId = option(argv, '--learner');
  if (!learnerId) throw new Error('--learner is required');
  const day = option(argv, '--day');
  const sittingId = option(argv, '--sitting');
  if (day && sittingId) throw new Error('pass --day or --sitting, not both');
  const mode = option(argv, '--mode') ?? 'all';
  if (!['live', 'test', 'all'].includes(mode)) throw new Error(`--mode must be live, test or all, got '${mode}'`);
  const effectiveDay = day ?? (sittingId ? null : todayIso());

  let rows = [];
  let reachable = typeof fetchImpl === 'function';
  if (reachable) {
    try {
      const query = `${traceQuery({ learnerId, mode, sittingId })} AND ${timeWindow({ day: effectiveDay, sittingId })}`;
      const res = await fetchImpl(`${DEFAULT_LOGSTORE.replace(/\/$/, '')}/select/logsql/query`, {
        method: 'POST',
        body: new URLSearchParams({ query, limit: String(LOG_QUERY_LIMIT) }),
      });
      if (res?.ok) rows = parseLogLines(await res.text());
      else reachable = false;
    } catch { reachable = false; }
  }
  // Hitting the limit exactly means the window may hold more rows than were
  // fetched — the trace below could be missing its tail (or head) silently
  // otherwise. A count under the limit proves the query saw everything.
  if (rows.length === LOG_QUERY_LIMIT) {
    io.stderr.write(`warning: the log store returned ${LOG_QUERY_LIMIT} rows (the query limit) — results may be truncated; narrow --day/--sitting/--mode\n`);
  }

  if (reachable && rows.length) {
    const output = formatTrace(rows.map(unflattenRow));
    if (output) { io.stdout.write(`${output}\n`); return 0; }
  }
  return dayFileFallback(io, dataDir, learnerId, { day: effectiveDay, sittingId });
}

export async function main(argv = process.argv.slice(2), io = process, deps = {}) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') { io.stdout.write(HELP); return command ? 0 : 2; }
  try {
    if (command === 'quiz') return await quiz(rest, io);
    if (command === 'enroll-plan') return await enrollPlan(rest, io, deps.fetch);
    if (command === 'trace') return await trace(rest, io, deps.fetch);
    io.stderr.write(HELP);
    return 2;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main().then((code) => { process.exitCode = code; });
}
