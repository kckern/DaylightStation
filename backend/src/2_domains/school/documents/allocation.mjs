/**
 * OMR card allocation domain (spec §5): card-instance identity, row
 * planning against a derived bank, and allocation-record lifecycle rules.
 * Pure: no I/O, no Date, no randomness of its own (rng is injected).
 */
import { walkBlocks } from './documentValidation.mjs';

/** Card rows are numbered 1..50 (spec §5.1's 50-row physical card). */
export const CARD_ROWS = 50;

/** Answer positions per row: A-E (spec §5.1). */
export const ROW_CHOICES = 5;

/**
 * Bank item types that can be printed as a card row (spec §5.3). `true_false`
 * is graded A/B (True/False) and never carries a `choices` array on its bank
 * item — its choice count is fixed at 2, computed in `planRows` below.
 *
 * `companion_code` is the finish-code gate row (Task 8). It is here for the
 * one reason the list exists: without it the gate block is planned, found
 * un-mappable, and the whole render is refused — so the gate would never reach
 * a card at all. It is NOT a question-bank type (it is never validated by
 * `questionBankValidation`, whose `multi_select` two-answer minimum would make
 * a single-letter code illegal); its item is synthesized from the printed
 * document at prepare time, and it carries its own answer.
 */
export const ROW_MAPPABLE_TYPES = ['multiple_choice', 'true_false', 'multi_select', 'companion_code'];

/** Allocation record lifecycle states (spec §5.4). */
export const ALLOCATION_STATUSES = ['live', 'satisfied', 'released', 'superseded'];

// --- card identity (spec §5.2) ---

/**
 * Draws a random 7-digit card-instance id from an injected 0..1 rng (a
 * `mulberry32`-compatible generator — see `generatedBanks/distractors.mjs`).
 * Leading zeros are legal and preserved (string, not a number); the
 * all-zero id is excluded (spec §5.2 "avoiding all-zero") and re-drawn.
 *
 * IDs are random, not derived from any document/seed input — they are
 * opaque physical-card handles (spec §5.2's "no ordering, no guessing"), so
 * this function takes only the rng, nothing else.
 *
 * @param {() => number} rng - injected 0..1 generator, called once per digit
 * @returns {string} exactly 7 digits, never '0000000'
 */
export function generateCardId(rng) {
  let id;
  do {
    id = Array.from({ length: 7 }, () => Math.floor(rng() * 10)).join('');
  } while (id === '0000000');
  return id;
}

/**
 * Best-effort resolution of an ambiguous decoded test id against the
 * household's own known card ids (household direction, real incident
 * 2026-08-14: a scan chirped success, decoded 8 real answers, and still
 * silently dropped everything because one digit column double-marked ->
 * `7481?48` matched no allocation). The owner's own framing is the
 * invariant this function encodes: "a best effort ... [when] the likelihood
 * of collisions will be very low" BUT "guessing a card that was never
 * printed is far worse than refusing" — so this only ever returns a single
 * id when EXACTLY one known card is consistent with the pattern; two or
 * more (however small a set) is refused exactly like zero, because a wrong
 * guess is graded as though it were a clean read and nothing downstream
 * would ever know to doubt it.
 *
 * `digitMarks[i]` is what `decodeQuizSheet` actually saw punched in column
 * `i` — NOT a re-guess: an empty array (a truly blank column) carries no
 * constraint at all and is treated as a full 0-9 wildcard, while 2+ entries
 * (a double-marked column, the actual incident) constrains that position to
 * just those digits. This is deliberately narrower than the also-considered
 * "any single-digit misread" search over the CLEAN columns too — a cleanly
 * decoded digit carries no signal that it might be wrong (unlike a blank or
 * double mark, both of which the scanner itself flags as uncertain), so
 * treating it as fuzzy would mean silently overriding a digit the hardware
 * actually read with more confidence than the ambiguous ones, on no
 * evidence whatsoever. Only positions the decoder itself marked '?' are
 * ever loosened; every other position must match exactly.
 *
 * A missing/malformed `digitMarks` entry for a '?' position (a caller that
 * only has the pattern string, e.g. this file's own tests, or a decode path
 * that predates `testIdCandidates`) degrades to the widest-possible wildcard
 * for that position, same as an observed blank — never narrower than what
 * was actually seen, so a caller with less information than a live scan
 * never resolves something a live scan itself would have refused.
 *
 * @param {string} pattern - 7-char decoded test id, '?' at each unreadable position
 * @param {Array<number[]>|null} digitMarks - one entry per position (0..6):
 *   the digits `decodeQuizSheet` actually saw marked there. Only consulted
 *   at a '?' position in `pattern`; ignored elsewhere.
 * @param {string[]} knownCardIds - every card id the allocation store
 *   currently has any record for (`YamlAllocationStore#listCardIds`).
 * @returns {{cardId: string}|{candidates: string[]}} exactly one consistent
 *   id resolves to `{cardId}`; zero or 2+ return `{candidates}` (the full
 *   matching set, empty when none) for the caller to report and refuse.
 */
export function resolveAmbiguousCardId(pattern, digitMarks, knownCardIds) {
  if (typeof pattern !== 'string' || pattern.length !== 7) return { candidates: [] };
  const marks = Array.isArray(digitMarks) ? digitMarks : [];

  const isConsistent = (candidateId) => {
    if (typeof candidateId !== 'string' || candidateId.length !== 7) return false;
    for (let position = 0; position < 7; position += 1) {
      const expected = pattern[position];
      if (expected !== '?') {
        if (candidateId[position] !== expected) return false;
        continue;
      }
      const observed = marks[position];
      // Empty (or absent) observation = blank column = unconstrained; a
      // non-empty observation = double-marked column = must be one of the
      // actual marks. Never wider than an empty array; never narrower than
      // what was truly observed at that position.
      if (Array.isArray(observed) && observed.length > 0
        && !observed.includes(Number(candidateId[position]))) {
        return false;
      }
    }
    return true;
  };

  const matches = [...new Set((knownCardIds || []).filter(isConsistent))];
  return matches.length === 1 ? { cardId: matches[0] } : { candidates: matches };
}

// --- row planning (spec §5.3) ---

/**
 * Walks a PREPARED document (published: bank-select sugar already expanded,
 * every row-relevant `question` block carries a concrete `itemId` — spec §3)
 * in document order and assigns contiguous card rows starting at `startRow`
 * to every row-consuming question.
 *
 * Row-consuming rule (spec §5.3):
 * - `archetype: 'quiz'` — every SCORED question (`points` override, or the
 *   envelope's `defaultPoints`, greater than 0) consumes a row, and it is an
 *   error for a scored quiz item to resolve to a non-row-mappable bank type.
 * - any other archetype (worksheet/infopage) — only questions explicitly
 *   marked `omr: true` consume a row; unmarked questions are silently
 *   skipped (free-response/write-on, spec §5.3's "write-on blocks are
 *   worksheet-only or unscored").
 *
 * A row-consuming question's TYPE and CHOICE COUNT are read off the supplied
 * BANK item (resolved by `block.itemId`), never off the block itself — a
 * source-stage block may still carry inline `choices`, but printed rows are
 * planned from the derived answer key, not the author's draft (per the task
 * brief). A row-consuming question whose `itemId` does not resolve in `bank`
 * is an error.
 *
 * Bank-boundary spanning (a shared row range crossing row 25/26) is
 * deliberately NOT checked here — per spec §5.1 that boundary is a decoding
 * detail of the physical card, not an allocation constraint.
 *
 * @param {{document: object, bank: {items: Array<{id:string,type:string,choices?:string[]}>}|null, startRow?: number}} args
 * @returns {{errors: string[]}|{rows: Array<{row:number, blockPath:string, itemId:string, itemType:string, choiceCount:number}>}}
 */
export function planRows({ document, bank, startRow = 1 }) {
  if (!Number.isInteger(startRow) || startRow < 1) {
    return { errors: [`startRow must be an integer >= 1, got ${JSON.stringify(startRow)}`] };
  }

  const bankItems = new Map((bank?.items ?? []).map((item) => [item.id, item]));
  const isQuiz = document?.archetype === 'quiz';
  const defaultPoints = typeof document?.defaultPoints === 'number' ? document.defaultPoints : 1;

  const candidates = [];
  walkBlocks(document?.blocks, (block, at) => {
    if (block.type !== 'question') return;
    const points = typeof block.points === 'number' ? block.points : defaultPoints;
    const rowConsuming = isQuiz ? points > 0 : block.omr === true;
    if (rowConsuming) candidates.push({ at, block });
  });

  const errors = [];

  if (candidates.length > 0) {
    const endRow = startRow + candidates.length - 1;
    if (endRow > CARD_ROWS) {
      errors.push(`rows ${startRow}-${endRow} exceed the ${CARD_ROWS}-row card capacity (${candidates.length} row-consuming questions starting at row ${startRow})`);
    }
  }

  const rows = [];
  candidates.forEach(({ at, block }, index) => {
    const item = typeof block.itemId === 'string' ? bankItems.get(block.itemId) : undefined;
    if (!item) {
      errors.push(`${at}: itemId "${block.itemId}" was not found in the bank`);
      return;
    }
    if (!ROW_MAPPABLE_TYPES.includes(item.type)) {
      const context = isQuiz ? 'a scored quiz item must be row-mappable' : 'an omr question must be row-mappable';
      errors.push(`${at}: item type "${item.type}" is not row-mappable (${context})`);
      return;
    }
    const choiceCount = item.type === 'true_false' ? 2 : (Array.isArray(item.choices) ? item.choices.length : 0);
    if (choiceCount > ROW_CHOICES) {
      errors.push(`${at}: ${choiceCount} choices exceeds the ${ROW_CHOICES}-choice row limit`);
      return;
    }
    rows.push({
      row: startRow + index, blockPath: at, itemId: block.itemId, itemType: item.type, choiceCount,
    });
  });

  if (errors.length) return { errors };
  return { rows };
}

// --- allocation record lifecycle (spec §5.4) ---

/**
 * @param {{start:number, end:number}} a
 * @param {{start:number, end:number}} b
 * @returns {boolean} true when the inclusive row ranges overlap at all
 */
export function rangesOverlap(a, b) {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * A new record whose row range overlaps a `live` record on the SAME card is
 * always an error, regardless of learner (spec §5.4's collision rule —
 * random card ids make cross-card collisions a non-issue, so only same-card
 * ranges are compared).
 *
 * @param {Array<{cardId:string, startRow:number, endRow:number, status:string}>} existingRecords
 * @param {{cardId:string, startRow:number, endRow:number}} candidateRange
 * @returns {Array} the colliding `live` records (empty when none collide)
 */
export function checkCollision(existingRecords, candidateRange) {
  return (existingRecords || []).filter((record) => record.status === 'live'
    && record.cardId === candidateRange.cardId
    && rangesOverlap(
      { start: record.startRow, end: record.endRow },
      { start: candidateRange.startRow, end: candidateRange.endRow },
    ));
}

/**
 * Finds the prior `live` record this candidate render replaces: a
 * reprint/re-render of the same `(documentId, learnerId)` pair (spec §5.4's
 * supersede case). Anonymous renders (`learnerId` absent) match other
 * anonymous renders of the same document — both sides normalise to `null`.
 *
 * @param {Array<{documentId:string, learnerId?:string|null, status:string}>} existingRecords
 * @param {{documentId:string, learnerId?:string|null}} candidate
 * @returns {object|null} the prior live record, or null when none exists
 */
export function supersedes(existingRecords, candidate) {
  const learnerId = candidate?.learnerId ?? null;
  const match = (existingRecords || []).find((record) => record.status === 'live'
    && record.documentId === candidate.documentId
    && (record.learnerId ?? null) === learnerId);
  return match || null;
}
