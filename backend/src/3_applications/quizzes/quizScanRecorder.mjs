// backend/src/3_applications/quizzes/quizScanRecorder.mjs
//
// Quiz-sheet decoder — the form-specific consumer the OMR relay deliberately
// is not (see omrRelay.mjs: the relay records WHICH POSITIONS WERE MARKED and
// nothing else). This module owns the mark→meaning mapping for the household
// 50-question card and double-processes every scan:
//
//   raw manifest (relay)   {dataDir}/household/history/omr/{reader}/{day}.yml
//   decoded record (here)  {dataDir}/household/apps/quizzes/{reader}/{day}.yml
//
// The raw file stays byte-faithful; this one is the meaningful version.
//
// Form layout — calibrated against a marked card scanned 2026-07-30 (see the
// test file for the exact frame). 32 columns, 12 Hollerith rows per column
// (bit 0 = row 12 far edge … bit 11 = row 9 strobe edge):
//
//   cols 1–7    seven-digit TEST ID (not a student number: the printed quiz
//               carries this ID and maps it to both student and answer key, so
//               a randomized/tailored quiz still grades). digit d = bit (9−d).
//   cols 8–32   25 columns × two stacked question banks of five bubbles:
//               upper bank = questions 1–25,  A..E = bits 10..6
//               lower bank = questions 26–50, A..E = bits 4..0
//   bits 11, 5  printed label/separator rows — never data; stray ink ignored.
//
// A question with no mark is OMITTED from `answers`; a multi-marked question
// records every letter (e.g. `15: [A, E]`) so grading policy stays downstream.
// An unreadable test-ID digit (blank or multi-marked) records as `?`.
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const DEFAULT_TOPIC = 'omr';
const DEFAULT_HISTORY_DIR = 'household/history/omr';
const DEFAULT_QUIZZES_DIR = 'household/apps/quizzes';
// Same retransmit-suppression semantics (and config knob) as the relay's raw
// persistence, so the decoded file and the manifest agree on what "one card" is.
const DEFAULT_DEDUP_WINDOW_MS = 2000;

const ID_COLUMNS = 7;
const QUESTION_COLUMNS = 25;
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const UPPER_BANK_TOP_BIT = 10; // A..E = bits 10..6, questions 1–25
const LOWER_BANK_TOP_BIT = 4;  // A..E = bits 4..0,  questions 26–50
const ID_DIGIT_TOP_BIT = 9;    // digit d = bit (9−d)

/**
 * Decode one raw marks[] frame into { testId, answers[, testIdCandidates] }.
 * Pure — safe to reuse for live decode, backfill, and future grading.
 *
 * A '?' in `testId` means "position kept, value unknown" — but blank and
 * double-marked are NOT the same kind of unknown, and collapsing them loses
 * information a downstream best-effort matcher needs (real incident
 * 2026-08-14: a double-marked digit produced `?`, no allocation matched, and
 * a fully-answered sheet silently vanished — see
 * `#domains/school/documents/allocation.mjs`'s `resolveAmbiguousCardId`,
 * the ONE place that information is spent). A blank column carries zero
 * marks — any digit is possible, a full wildcard. A double-marked column
 * carries the ACTUAL digits the student's stray mark(s) hit — a small,
 * real, non-guessed candidate set. `testIdCandidates[i]` (one entry per id
 * column, only present when the id has at least one `?`) is exactly the
 * `digits` array this loop already builds per column, whichever length it
 * turned out to be — not re-derived, just not thrown away.
 *
 * @param {number[]} marks one 12-bit mask per column
 * @returns {{ testId: string|null, answers: Record<number, string|string[]>,
 *   testIdCandidates?: Array<number[]> }}
 */
export function decodeQuizSheet(marks) {
  const cols = Array.isArray(marks) ? marks : [];

  let anyDigit = false;
  let testId = '';
  const idDigitCandidates = [];
  for (let i = 0; i < ID_COLUMNS; i++) {
    const digits = [];
    const mask = cols[i] | 0;
    for (let d = 0; d <= 9; d++) {
      if (mask & (1 << (ID_DIGIT_TOP_BIT - d))) digits.push(d);
    }
    idDigitCandidates.push(digits);
    if (digits.length === 1) {
      testId += String(digits[0]);
      anyDigit = true;
    } else {
      testId += '?'; // blank or double-marked: position kept, value unknown
      if (digits.length > 1) anyDigit = true;
    }
  }

  const answers = {};
  const readBank = (mask, topBit, question) => {
    const letters = [];
    for (let k = 0; k < LETTERS.length; k++) {
      if (mask & (1 << (topBit - k))) letters.push(LETTERS[k]);
    }
    if (letters.length === 1) answers[question] = letters[0];
    else if (letters.length > 1) answers[question] = letters;
  };
  for (let i = 0; i < QUESTION_COLUMNS; i++) {
    const mask = cols[ID_COLUMNS + i];
    if (!mask) continue;
    readBank(mask, UPPER_BANK_TOP_BIT, i + 1);
    readBank(mask, LOWER_BANK_TOP_BIT, i + 1 + QUESTION_COLUMNS);
  }

  const result = { testId: anyDigit ? testId : null, answers };
  // Only attached when there is actually a '?' to resolve — a fully clean
  // id (the overwhelming common case) stays exactly the two-field shape
  // this function has always returned, and a fully blank id (`testId` null)
  // has nothing a matcher could do with it regardless (`ResolveCardScan`
  // refuses a null id before ever looking at candidates).
  if (result.testId && result.testId.includes('?')) {
    result.testIdCandidates = idDigitCandidates;
  }
  return result;
}

/**
 * Bus topic(s) a decoded-scan consumer should subscribe to for THIS config —
 * always the default `omr` topic, plus any reader-specific topic named in
 * `config.scanners`. Shared between `createQuizScanRecorder` below and any
 * other consumer of the same decoded stream (Task 7's `ResolveCardScan`
 * wiring, `5_composition/modules/schoolPrintScanConsumer.mjs`) so the two
 * never disagree about which topics carry sheets.
 *
 * @param {object} [config] parsed config/omr-readers.yml
 * @returns {string[]}
 */
export function resolveQuizScanTopics(config = {}) {
  const readerDefs = config?.scanners || {};
  return [...new Set([DEFAULT_TOPIC, ...Object.values(readerDefs).map((r) => r?.topic).filter(Boolean)])];
}

/**
 * Live decoder: subscribes to the relay's bus topic(s) and appends a decoded
 * record per sheet to {quizzesDir}/{reader-id}/{YYYY-MM-DD}.yml. Same
 * constructor shape and config file (omr-readers.yml) as createOmrRelay.
 *
 * @param {object} deps
 * @param {object} deps.eventBus  IEventBus (subscribe only)
 * @param {string} deps.dataDir   resolved data dir
 * @param {object} [deps.config]  parsed config/omr-readers.yml
 * @param {object} [deps.logger]
 * @returns {{ dispose: () => void }}
 */
export function createQuizScanRecorder({ eventBus, dataDir, config = {}, logger = console }) {
  if (!eventBus?.subscribe) {
    throw new Error('createQuizScanRecorder: eventBus with subscribe required');
  }

  const outRoot = resolveDir(dataDir, config?.quizzes?.dir, DEFAULT_QUIZZES_DIR);
  const dedupWindowMs = Number(config?.persistence?.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS);
  const topics = new Set(resolveQuizScanTopics(config));

  const lastSheet = new Map(); // reader id -> { signature, atMs }

  // Serialize appends: read-modify-write day files, same reasoning as the relay.
  let writeChain = Promise.resolve();
  const onPayload = (payload) => {
    if (payload?.event !== 'sheet' || !Array.isArray(payload.marks)) return;
    const id = payload.id || 'unknown';

    const signature = payload.marks.join(',');
    const nowMs = Date.now();
    const prev = lastSheet.get(id);
    if (prev && prev.signature === signature && (nowMs - prev.atMs) < dedupWindowMs) {
      logger.debug?.('quiz.decode.deduped', { id, sinceMs: nowMs - prev.atMs });
      return;
    }
    lastSheet.set(id, { signature, atMs: nowMs });

    const record = { ts: payload.ts, ...decodeQuizSheet(payload.marks) };
    logger.info?.('quiz.decode.sheet', {
      id, testId: record.testId, answered: Object.keys(record.answers).length,
    });
    writeChain = writeChain
      .then(() => appendDecoded(outRoot, id, record))
      .catch((err) => logger.warn?.('quiz.decode.persist_failed', { id, error: err.message }));
  };

  const unsubs = [...topics].map((topic) => eventBus.subscribe(topic, onPayload));
  logger.info?.('quiz.decode.ready', { outRoot, topics: [...topics] });
  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

/**
 * Backfill: regenerate every decoded day file from the raw manifest. Rebuilds
 * whole files (overwrite, not append) so it is idempotent and safe to re-run
 * after a layout fix. Non-sheet events (nfc, reader-error, data-loss) skip.
 *
 * @returns {{ readers: number, days: number, sheets: number }}
 */
export async function rebuildQuizDayFiles({ dataDir, config = {}, logger = console }) {
  const historyRoot = resolveDir(dataDir, config?.persistence?.dir, DEFAULT_HISTORY_DIR);
  const outRoot = resolveDir(dataDir, config?.quizzes?.dir, DEFAULT_QUIZZES_DIR);

  const result = { readers: 0, days: 0, sheets: 0 };
  let readerIds = [];
  try {
    readerIds = (await fs.readdir(historyRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === 'ENOENT') return result; // no history yet — nothing to do
    throw err;
  }

  for (const id of readerIds) {
    result.readers += 1;
    const dayFiles = (await fs.readdir(path.join(historyRoot, id)))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f)).sort();
    for (const dayFile of dayFiles) {
      const raw = yaml.load(await fs.readFile(path.join(historyRoot, id, dayFile), 'utf8'));
      if (!Array.isArray(raw)) continue;
      const decoded = raw
        .filter((r) => r?.event === 'sheet' && Array.isArray(r.marks))
        .map((r) => ({ ts: r.ts, ...decodeQuizSheet(r.marks) }));
      if (!decoded.length) continue;
      const outDir = path.join(outRoot, id);
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(path.join(outDir, dayFile), dumpQuizYaml(decoded), 'utf8');
      result.days += 1;
      result.sheets += decoded.length;
      logger.info?.('quiz.backfill.day', { id, day: dayFile, sheets: decoded.length });
    }
  }
  return result;
}

function resolveDir(dataDir, configured, fallback) {
  const rel = (configured || fallback).replace(/^\/+/, '');
  return path.join(dataDir, ...rel.split('/'));
}

async function appendDecoded(outRoot, id, record) {
  const day = (typeof record?.ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(record.ts))
    ? record.ts.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const dir = path.join(outRoot, id);
  const file = path.join(dir, `${day}.yml`);
  await fs.mkdir(dir, { recursive: true });

  let list = [];
  try {
    const existing = yaml.load(await fs.readFile(file, 'utf8'));
    if (Array.isArray(existing)) list = existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  list.push(record);
  await fs.writeFile(file, dumpQuizYaml(list), 'utf8');
}

// js-yaml quotes numeric-looking string keys ('1': A). Question numbers ARE
// numbers, so unquote them for a clean human-readable file; flowLevel keeps
// multi-mark answers inline (15: [A, E]) instead of a block list.
function dumpQuizYaml(list) {
  return yaml
    .dump(list, { indent: 2, lineWidth: -1, noRefs: true, flowLevel: 3 })
    .replace(/^(\s+)'(\d+)':/gm, '$1$2:');
}

export default createQuizScanRecorder;
