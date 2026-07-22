/**
 * School's language-study domain — the sentence ladder and its pacing.
 *
 * Pure: no I/O, no clock (timestamps are injected), no vendor names, no
 * hardcoded language codes. Suppliers live in `1_adapters/`; language codes
 * live in the corpus.
 */
export {
  ROLES, RUNGS, RUNG_IDS,
  rungById, resolveRole, requirementFor,
  chainFor, nextRung, graduationEdges,
} from './ladder.mjs';

export { buildDayQueue, summarizeQueue } from './dayQueue.mjs';
export { shouldRollDay, studyDayIndex } from './rollover.mjs';
export { normalize, editDistance, accuracy, isCloseEnough, CLOSE_ENOUGH } from './transcription.mjs';
export { validateCorpus, indexBySeq } from './corpus.mjs';
