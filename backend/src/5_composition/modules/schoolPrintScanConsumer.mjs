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
 * @param {{fire: Function}} [deps.gradingHook] - `SchoolGradingHookAdapter`-shaped
 *   (or any fake with a `fire(outcome)`), optional. Fired fire-and-forget
 *   (never awaited) at each of the four terminal scan outcomes — unresolved,
 *   refused, graded, review — so a slow or broken Home Assistant can never
 *   delay or prevent a grade being recorded. The adapter itself never
 *   throws; the `.catch(() => {})` at each call site is belt-and-suspenders
 *   for a fake/hook that rejects outright.
 * @returns {{ dispose: () => void }}
 */
export function createSchoolPrintScanConsumer({
  eventBus, config = {}, resolveCardScan, recordCardScanOutcome = null,
  closeSessionOutcome = null, gradingHook = null, logger = console,
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
    const { testId, answers, testIdCandidates } = decodeQuizSheet(payload.marks);

    resolveCardScan.execute({ testId, testIdCandidates, answers })
      .then((outcome) => {
        if (outcome?.error) {
          // CARD_ID_UNREADABLE (or any future resolver error code) — never
          // guessed at; the recorder already persisted the raw/decoded scan
          // regardless, so there is nothing further for this consumer to do.
          //
          // WARN, not debug: production runs at `info` (data/system/config/
          // logging.yml), so at debug this line — the single best explanation
          // for "I scanned it and nothing happened" — was dropped entirely and
          // an unreadable sheet left no trace at all. The candidate list rides
          // along because it is what says whether the id was unreadable or
          // merely ambiguous.
          logger.warn?.('school.print.scan-unresolved', {
            testId,
            code: outcome.error.code,
            testIdCandidates: Array.isArray(testIdCandidates) ? testIdCandidates.length : 0,
            answerCount: answers ? Object.keys(answers).length : 0,
          });
          // Home automation is a bystander: never awaited into the grading path
          // and never able to fail it. The adapter already swallows its own
          // errors; this catch covers a hook that rejects outright.
          gradingHook?.fire({ result: 'unresolved', testId, code: outcome.error.code }).catch(() => {});
          return;
        }
        if (outcome?.unknownCard) {
          // A card the store has never seen, with real answers on it: almost
          // always a mis-transcribed card id (no check digit). The child did
          // the work — this must be VISIBLE at production log level, with
          // the live cards one digit away as actionable candidates.
          logger.warn?.('school.print.scan-unknown-card', {
            testId,
            answeredRowCount: outcome.answeredRowCount,
            nearMissCardIds: outcome.nearMissCardIds ?? [],
          });
          return;
        }
        if (outcome?.deadCard) {
          // Every record on this card is retired (released/superseded — no
          // live/satisfied claimant left), so the sheet in the child's hand
          // refers to allocations nobody owns anymore, yet real answers
          // arrived: this must not vanish below warn just because nothing on
          // the card resolved. Distinct from `scan-record-refused` below,
          // which handles a per-record resolve failure on an otherwise-live
          // card, not a card whose records are all already retired.
          logger.warn?.('school.print.scan-dead-card', {
            testId, answeredRowCount: outcome.answeredRowCount, recordStatuses: outcome.recordStatuses,
            // Present only when `testId` itself was a `?`-bearing pattern
            // `ResolveCardScan` resolved by best-effort match rather than a
            // clean read (see its own `cardIdInferred` doc comment) — carried
            // here too so a reader following ONE scan's log trail sees the
            // inference at the point the outcome was actually acted on, not
            // only in `ResolveCardScan`'s own separate `card-id-inferred` line.
            cardIdInferred: outcome.cardIdInferred ?? null,
          });
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
        if (outcome.silentLiveRecords?.length) {
          // Wrong-rows signature: a live record on this card got zero marks
          // while other rows were answered — possibly a child answering one
          // quiz's questions in another quiz's rows on a shared card.
          logger.warn?.('school.print.scan-live-record-unmarked', {
            testId, silentLiveRecords: outcome.silentLiveRecords,
          });
        }
        // One log line PER resolution (a card can carry more than one
        // allocation record, e.g. two documents sharing one physical card
        // across a bank boundary — spec §5.4).
        for (const card of outcome.results) {
          if (card.error) {
            // A refused record (row-mapping drift, per-record resolve
            // failure, ...) — never silently dropped below the recorder's
            // own persistence: the teacher needs to know this record's
            // grade did NOT resolve, and why.
            logger.warn?.('school.print.scan-record-refused', {
              testId, recordId: card.recordId, documentId: card.documentId, code: card.error.code,
            });
            // Home automation is a bystander: never awaited into the grading path
            // and never able to fail it. The adapter already swallows its own
            // errors; this catch covers a hook that rejects outright.
            // `recordId` deliberately NOT sent — `toVariables()`'s 11-key
            // contract has no `record_id`, so it would be silently discarded;
            // the id is already on the adjacent log line for anyone who needs it.
            gradingHook?.fire({
              result: 'refused', testId, code: card.error.code, learnerId: card.learnerId ?? null,
            }).catch(() => {});
            continue;
          }
          logger.info?.('school.print.scan-resolved', {
            testId,
            cardId: card.cardId,
            recordId: card.recordId,
            documentId: card.documentId,
            rev: card.rev,
            variant: card.variant,
            learnerId: card.learnerId ?? null,
            revisionSuperseded: card.revisionSuperseded,
            reScored: card.reScored === true,
            earnedPoints: card.earnedPoints,
            totalPoints: card.totalPoints,
            // See the `scan-dead-card` log above for why this rides along —
            // same "visible at the point of action, not just at the point of
            // inference" reasoning, present only for a best-effort-resolved id.
            cardIdInferred: outcome.cardIdInferred ?? null,
          });
          if (card.reScored) {
            // The record had already settled before this scan — a re-fed
            // card, or another child bubbling this card's id. The attempt
            // store de-dups the persistence side; this warn is the teacher's
            // signal that a repeat happened at all.
            logger.warn?.('school.print.scan-rescored', {
              testId, recordId: card.recordId, learnerId: card.learnerId ?? null,
            });
          }
          if (!recordCardScanOutcome) continue;
          // B1: the grade becomes durable evidence — per-learner attempt
          // records plus the session bridge (submitted → graded) when the
          // allocation record carries its issuing session. Sequential and
          // per-card so one failure never swallows a cardmate's recording.
          recordCardScanOutcome.execute({ testId, card, cardIdInferred: outcome.cardIdInferred ?? null })
            .then(async (recorded) => {
              // A composed worksheet records one outcome per independently
              // completable lesson section. A legacy/single worksheet still
              // returns the original single outcome shape.
              const outcomes = recorded?.sectionOutcomes ?? [recorded];
              for (const sectionOutcome of outcomes) {
                if (sectionOutcome?.session?.advancedTo === 'graded') {
                  // A composed card's sectionOutcome carries ITS OWN section's
                  // score (RecordCardScanOutcome correlates sectionOutcomes[i]
                  // with card.sections[i] by construction) — falling back to
                  // the card aggregate only for a single/non-composed card,
                  // whose sectionOutcome (== `recorded` itself) never has an
                  // `earnedPoints`/`totalPoints` of its own. Without this,
                  // two sections firing twice would report the SAME whole-
                  // card score for two different lesson results.
                  const earned = sectionOutcome.earnedPoints ?? card.earnedPoints;
                  const total = sectionOutcome.totalPoints ?? card.totalPoints;
                  // percent is derived from the SAME earned/total this fire
                  // sends, never from the card, so the three numbers can
                  // never disagree. null (not NaN) when total is 0/missing.
                  const percent = (typeof earned === 'number' && typeof total === 'number' && total > 0)
                    ? Math.round((earned / total) * 10000) / 100
                    : null;
                  // Home automation is a bystander: never awaited into the
                  // grading path and never able to fail it. The adapter
                  // already swallows its own errors; this catch covers a
                  // hook that rejects outright.
                  gradingHook?.fire({
                    result: 'graded',
                    testId,
                    learnerId: card.learnerId ?? null,
                    earned,
                    total,
                    percent,
                    sessionId: sectionOutcome.session.sessionId,
                  }).catch(() => {});
                  if (closeSessionOutcome) {
                    // The bridge returns the authoritative session id (a
                    // composed card itself has no single session owner).
                    // eslint-disable-next-line no-await-in-loop
                    await closeSessionOutcome.execute({ sessionId: sectionOutcome.session.sessionId });
                  }
                } else if (sectionOutcome?.session?.reason === 'awaiting-review') {
                  gradingHook?.fire({
                    result: 'review',
                    testId,
                    learnerId: card.learnerId ?? null,
                    sessionId: sectionOutcome.session.sessionId,
                    pendingReview: sectionOutcome.session.pendingReview,
                    reasons: sectionOutcome.session.reasons,
                    items: sectionOutcome.session.items,
                  }).catch(() => {});
                }
              }
            })
            .catch((err) => {
              logger.warn?.('school.print.scan-record-failed', {
                testId, recordId: card.recordId, error: err.message,
              });
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
