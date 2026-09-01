/**
 * Human-visible answer-sheet identity helpers.
 *
 * Student numbers remain the machine identity.  The identicon is deliberately
 * only a redundant visual cue printed beside that number; scanners never read
 * it and it never changes the physical OMR form.
 */
export const ANSWER_SHEET_IDENTICON_VERSION = 'v1';
export const ANSWER_SHEET_IDENTICON_SIZE = 5;
export const MIN_CARD_DIGIT_DISTANCE = 4;
export const MIN_IDENTICON_CELL_DISTANCE = 8;
export const MAX_DISTINCT_CARD_ID_ATTEMPTS = 256;

const CARD_ID_RE = /^\d{7}$/;

/** Number of positions whose digits differ. */
export function cardDigitDistance(left, right) {
  if (!CARD_ID_RE.test(left ?? '') || !CARD_ID_RE.test(right ?? '')) return 0;
  let distance = 0;
  for (let index = 0; index < 7; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

/**
 * A deterministic 25-cell monochrome mark derived only from version + card id.
 * FNV-1a is used as a small stable seed, then xorshift32 supplies the cells.
 */
export function answerSheetIdenticon(cardId, version = ANSWER_SHEET_IDENTICON_VERSION) {
  if (!CARD_ID_RE.test(cardId ?? '')) throw new Error('answerSheetIdenticon requires a 7-digit card id');
  if (version !== ANSWER_SHEET_IDENTICON_VERSION) {
    throw new Error(`unsupported answer-sheet identicon version "${version}"`);
  }
  let state = 0x811c9dc5;
  for (const character of `${version}:${cardId}`) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  const cells = [];
  for (let index = 0; index < ANSWER_SHEET_IDENTICON_SIZE ** 2; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    cells.push((state & 1) === 1);
  }
  return { version, size: ANSWER_SHEET_IDENTICON_SIZE, cells };
}

export function identiconCellDistance(left, right) {
  if (!left || !right || left.version !== right.version
      || !Array.isArray(left.cells) || left.cells.length !== 25
      || !Array.isArray(right.cells) || right.cells.length !== 25) return 0;
  return left.cells.reduce((count, cell, index) => count + (cell !== right.cells[index] ? 1 : 0), 0);
}

export function isAcceptablyDistinctCardId(candidate, {
  predecessorCardId = null,
  activeCardIds = [],
  usedCardIds = [],
  identiconVersion = ANSWER_SHEET_IDENTICON_VERSION,
} = {}) {
  if (!CARD_ID_RE.test(candidate ?? '') || candidate === '0000000') return false;
  if (new Set(usedCardIds).has(candidate)) return false;
  const active = [...new Set(activeCardIds)].filter((cardId) => CARD_ID_RE.test(cardId));
  if (active.some((cardId) => cardDigitDistance(candidate, cardId) < MIN_CARD_DIGIT_DISTANCE)) return false;
  if (predecessorCardId) {
    if (!CARD_ID_RE.test(predecessorCardId)) return false;
    if (candidate[0] === predecessorCardId[0] || candidate[6] === predecessorCardId[6]) return false;
    const candidateIcon = answerSheetIdenticon(candidate, identiconVersion);
    const predecessorIcon = answerSheetIdenticon(predecessorCardId, identiconVersion);
    if (identiconCellDistance(candidateIcon, predecessorIcon) < MIN_IDENTICON_CELL_DISTANCE) return false;
  }
  return true;
}

/**
 * Draw a bounded number of seven-digit candidates and reject visually or
 * numerically confusable identities.  Failure is explicit rather than
 * silently weakening the constraints.
 */
export function mintDistinctCardId({
  rng,
  predecessorCardId = null,
  activeCardIds = [],
  usedCardIds = [],
  identiconVersion = ANSWER_SHEET_IDENTICON_VERSION,
  maxAttempts = MAX_DISTINCT_CARD_ID_ATTEMPTS,
} = {}) {
  if (typeof rng !== 'function') throw new Error('mintDistinctCardId requires rng');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = Array.from({ length: 7 }, () => Math.floor(rng() * 10)).join('');
    if (isAcceptablyDistinctCardId(candidate, {
      predecessorCardId, activeCardIds, usedCardIds, identiconVersion,
    })) return candidate;
  }
  const error = new Error(`could not mint a distinct answer-sheet id after ${maxAttempts} attempts`);
  error.code = 'ALLOCATION_CARD_ID_EXHAUSTED';
  error.details = { predecessorCardId, activeCardIds, maxAttempts };
  throw error;
}
