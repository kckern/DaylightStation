// backend/src/3_applications/quizzes/quizScanRecorder.mjs
//
// Quiz-sheet decoder — the form-specific consumer the OMR relay deliberately
// is not (see omrRelay.mjs: the relay records WHICH POSITIONS WERE MARKED and
// nothing else). This module owns the mark→meaning mapping for the household
// 50-question card and double-processes every scan:
//
//   raw manifest (relay)   {dataDir}/household/hardware/omr/log/{reader}/{day}.yml
//   decoded record (here)  {dataDir}/household/school/records/assessments/omr/{day}.yml
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
 * Live decoder: subscribes to the relay's bus topic(s) and appends a decoded
 * record per sheet to {quizzesDir}/{reader-id}/{YYYY-MM-DD}.yml. Same
 * constructor shape and config file (omr-readers.yml) as createOmrRelay.
 *
 * @param {object} deps
 * @param {{observe: Function}} deps.scanSource
 * @param {number} [deps.dedupWindowMs]
 * @param {object} [deps.logger]
 * @returns {{ dispose: () => void }}
 */
/**
 * Roots are INJECTED, absolute, already resolved.
 *
 * These used to be `household/<domain>` literals joined onto dataDir here.
 * That is storage layout living in the application layer, which
 * application-layer-guidelines.md rules out ("Application layer never builds
 * file paths"), and it is why the household reorganization had to edit this
 * file. The composition root resolves the location — config override
 * included — and passes directories down.
 */
export function createQuizScanRecorder({ scanSource, decodedScanStore, dedupWindowMs = DEFAULT_DEDUP_WINDOW_MS, logger = console }) {
  if (!scanSource?.observe) {
    throw new Error('createQuizScanRecorder: scanSource required');
  }

  if (!decodedScanStore?.append) throw new Error('createQuizScanRecorder: decodedScanStore required');
  const effectiveDedupWindowMs = Number(dedupWindowMs);

  const lastSheet = new Map(); // reader id -> { signature, atMs }

  // Serialize appends: read-modify-write day files, same reasoning as the relay.
  let writeChain = Promise.resolve();
  const onPayload = (payload) => {
    if (payload?.event !== 'sheet' || !Array.isArray(payload.marks)) return;
    const id = payload.id || 'unknown';

    const signature = payload.marks.join(',');
    const nowMs = Date.now();
    const prev = lastSheet.get(id);
    if (prev && prev.signature === signature && (nowMs - prev.atMs) < effectiveDedupWindowMs) {
      logger.debug?.('quiz.decode.deduped', { id, sinceMs: nowMs - prev.atMs });
      return;
    }
    lastSheet.set(id, { signature, atMs: nowMs });

    const record = { ts: payload.ts, ...decodeQuizSheet(payload.marks) };
    logger.info?.('quiz.decode.sheet', {
      id, testId: record.testId, answered: Object.keys(record.answers).length,
    });
    writeChain = writeChain
      .then(() => decodedScanStore.append(id, record))
      .catch((err) => logger.warn?.('quiz.decode.persist_failed', { id, error: err.message }));
  };

  const unsubscribe = scanSource.observe(onPayload);
  logger.info?.('quiz.decode.ready');
  return { dispose: () => { try { unsubscribe?.(); } catch { /* noop */ } } };
}

/**
 * Backfill: regenerate every decoded day file from the raw manifest. Rebuilds
 * whole files (overwrite, not append) so it is idempotent and safe to re-run
 * after a layout fix. Non-sheet events (nfc, reader-error, data-loss) skip.
 *
 * @returns {{ readers: number, days: number, sheets: number }}
 */
export async function rebuildQuizDayFiles({ decodedScanStore, logger = console }) {
  if (!decodedScanStore) throw new Error('rebuildQuizDayFiles: decodedScanStore required');

  const result = { readers: 0, days: 0, sheets: 0 };
  const readerIds = await decodedScanStore.listRawReaders();

  for (const id of readerIds) {
    result.readers += 1;
    const dayFiles = await decodedScanStore.listRawDays(id);
    for (const dayFile of dayFiles) {
      const raw = await decodedScanStore.readRawDay(id, dayFile);
      if (!Array.isArray(raw)) continue;
      const decoded = raw
        .filter((r) => r?.event === 'sheet' && Array.isArray(r.marks))
        .map((r) => ({ ts: r.ts, ...decodeQuizSheet(r.marks) }));
      if (!decoded.length) continue;
      await decodedScanStore.replaceDecodedDay(id, dayFile, decoded);
      result.days += 1;
      result.sheets += decoded.length;
      logger.info?.('quiz.backfill.day', { id, day: dayFile, sheets: decoded.length });
    }
  }
  return result;
}

export default createQuizScanRecorder;
