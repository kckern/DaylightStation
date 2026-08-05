// backend/src/5_composition/modules/schoolPrintScanConsumer.mjs
//
// Wires `ResolveCardScan` (Task 6, spec §5.4) into the SAME decoded-scan
// stream `createQuizScanRecorder` (3_applications/quizzes/quizScanRecorder.mjs)
// already persists (spec §9: "Scan-back: decoded card (via the existing
// createQuizScanRecorder path) → allocation store → document rev + derived
// bank + seed/variant (+ learner) → grade"). Subscribes ALONGSIDE the
// recorder — same bus topics, same `decodeQuizSheet` — never replacing or
// gating it: the recorder is the byte-faithful/meaningful persistence layer
// for EVERY scan on this bus, print-document or not, and keeps doing exactly
// that regardless of what this consumer does with the same payload.
//
// A record that doesn't resolve to a card allocation — `CARD_ID_UNREADABLE`,
// or (the common case today) a card that simply carries no live/satisfied
// print-document allocation at all, because it is a legacy household bubble
// sheet the recorder alone was ever built to understand — falls through to
// the SAME behaviour as before this file existed: nothing else happens. This
// consumer only ever ADDS a resolution; it can never subtract one.
import { decodeQuizSheet, resolveQuizScanTopics } from '#apps/quizzes/quizScanRecorder.mjs';

/**
 * @param {object} deps
 * @param {object} deps.eventBus - IEventBus (subscribe only)
 * @param {object} [deps.config] - parsed config/omr-readers.yml — the SAME
 *   shape `createQuizScanRecorder`/`createOmrRelay` already take, so this
 *   consumer never disagrees with them about which topics carry sheets.
 * @param {{execute: Function}} deps.resolveCardScan - Task 6's use case,
 *   constructed by the caller against the SAME `allocationStore`/`repository`
 *   `IssueDocument`'s print-document path writes through (composition root's
 *   job — see `schoolLifecycle.mjs`'s own `stores.allocationStore`/
 *   `stores.printDocuments`).
 * @param {object} [deps.logger]
 * @returns {{ dispose: () => void }}
 */
export function createSchoolPrintScanConsumer({
  eventBus, config = {}, resolveCardScan, logger = console,
}) {
  if (!eventBus?.subscribe) {
    throw new Error('createSchoolPrintScanConsumer: eventBus with subscribe required');
  }
  if (!resolveCardScan?.execute) {
    throw new Error('createSchoolPrintScanConsumer: resolveCardScan with execute required');
  }

  const topics = resolveQuizScanTopics(config);

  const onPayload = (payload) => {
    if (payload?.event !== 'sheet' || !Array.isArray(payload.marks)) return;
    const { testId, answers } = decodeQuizSheet(payload.marks);

    resolveCardScan.execute({ testId, answers })
      .then((outcome) => {
        if (outcome?.error) {
          // CARD_ID_UNREADABLE (or any future resolver error code) — never
          // guessed at; the recorder already persisted the raw/decoded scan
          // regardless, so there is nothing further for this consumer to do.
          logger.debug?.('school.print.scan-unresolved', { testId, code: outcome.error.code });
          return;
        }
        if (!outcome?.results?.length) {
          // No live/satisfied print-document allocation record on this card
          // at all — the ordinary case for every legacy bubble sheet on this
          // bus, and NOT an error: the recorder already has the decoded scan.
          logger.debug?.('school.print.scan-no-allocation', {
            testId, unallocatedRows: outcome?.unallocatedRows ?? [],
          });
          return;
        }
        // One log line PER resolution (a card can carry more than one
        // allocation record, e.g. two documents sharing one physical card
        // across a bank boundary — spec §5.4).
        for (const card of outcome.results) {
          logger.info?.('school.print.scan-resolved', {
            testId,
            cardId: card.cardId,
            recordId: card.recordId,
            documentId: card.documentId,
            rev: card.rev,
            variant: card.variant,
            learnerId: card.learnerId ?? null,
            revisionSuperseded: card.revisionSuperseded,
            earnedPoints: card.earnedPoints,
            totalPoints: card.totalPoints,
          });
        }
      })
      .catch((err) => {
        // Never lets a resolution failure interrupt the recorder's own
        // persistence (already run, synchronously, before this promise
        // chain) — logged loudly so a broken pipeline is visible.
        logger.warn?.('school.print.scan-resolve-failed', { testId, error: err.message });
      });
  };

  const unsubs = topics.map((topic) => eventBus.subscribe(topic, onPayload));
  logger.info?.('school.print.scan-consumer.ready', { topics });
  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createSchoolPrintScanConsumer;
