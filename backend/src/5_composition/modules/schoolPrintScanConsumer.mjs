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
 * @param {object} deps.eventBus - IEventBus (subscribe AND broadcast). Widened
 *   from subscribe-only (Slice C, 2026-08-22-omr-grading-integrity, Task C1):
 *   alongside the existing `gradingHook` fire sites, this consumer now ALSO
 *   re-broadcasts each of the four terminal scan outcomes — `scan-graded`,
 *   `scan-review`, `scan-unresolved`, `scan-refused` — on the SAME `omr`
 *   topic the relay already broadcasts sheets on, so the School panel (the
 *   ceremony Slice D builds) can subscribe without any new transport. This
 *   is a second, parallel consumer of the outcome, never a replacement for
 *   the hook or the log lines beside it.
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
  // The subscribe side already treats `topics` as the declared source of
  // truth for which topics carry sheets (`resolveQuizScanTopics`, shared
  // with `createQuizScanRecorder`/`createOmrRelay`); the broadcast side used
  // to hardcode a second, independent 'omr' literal, so renaming the topic
  // there could silently leave this one pointing at a dead string.
  // `resolveQuizScanTopics` always seeds its result with the module's own
  // `DEFAULT_TOPIC` first, ahead of any per-reader override — that first
  // entry is the one fixed "front door" every deployment carries regardless
  // of `config/omr-readers.yml`, and the one the School panel's
  // `useScanCeremony.js` subscribes to, so it's the right one to broadcast
  // outcomes on.
  const [broadcastTopic] = topics;

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
          // Same outcome, second listener: the School panel ceremony (Slice
          // D) needs this on the wire too. Full candidate list (not just the
          // count the log line above carries) — the panel is expected to
          // show them, not just say how many there were.
          eventBus.broadcast?.(broadcastTopic, {
            event: 'scan-unresolved',
            code: outcome.error.code,
            testId,
            testIdCandidates: Array.isArray(testIdCandidates) ? testIdCandidates : [],
          });
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
            // Same outcome, second listener: the School panel ceremony
            // (Slice D) needs this on the wire too.
            eventBus.broadcast?.(broadcastTopic, {
              event: 'scan-refused', code: card.error.code, recordId: card.recordId,
            });
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
                  // percent/earned/total come from the SESSION
                  // (`RecordCardScanOutcome#bridgeSession`'s row-count
                  // computation), never from points, because that row-count
                  // percent is the SAME number `reduceSession` turns into the
                  // session's `gradedPercent` — the value the report card,
                  // course grade, and pass/fail all read (final review Fix
                  // 3). The prior version sent a POINTS-based percent
                  // (`earnedPoints/totalPoints`) here: on a worksheet with
                  // rows worth different point values that disagreed with the
                  // gradebook's row-count percent, so Home Assistant could
                  // announce a passing score while the report card recorded a
                  // failing one (or vice versa). Reading it off `session`
                  // instead of recomputing it here means the two can never
                  // diverge again. A composed card's sectionOutcome still
                  // carries its OWN section's session (RecordCardScanOutcome
                  // correlates sectionOutcomes[i] with card.sections[i] by
                  // construction — see `execute()`'s own comment above), so
                  // two sections still never report the same score for two
                  // different lesson results. null (never NaN) when the
                  // session bridge did not attach a real number.
                  const percent = typeof sectionOutcome.session.percent === 'number'
                    ? sectionOutcome.session.percent
                    : null;
                  const earned = typeof sectionOutcome.session.correctCount === 'number'
                    ? sectionOutcome.session.correctCount
                    : null;
                  const total = typeof sectionOutcome.session.totalCount === 'number'
                    ? sectionOutcome.session.totalCount
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
                  // Same outcome, second listener: the School panel ceremony
                  // (Slice D) needs this on the wire too. SAME session-sourced
                  // percent/earned/total the hook above just fired — never
                  // recomputed from `card.earnedPoints`/`card.totalPoints`,
                  // for the identical reason the hook doesn't: that points
                  // aggregate can disagree with the row-count percent the
                  // gradebook/report card actually record (final review Fix
                  // 3), and the panel must never be able to show a different
                  // score than the report card will.
                  eventBus.broadcast?.(broadcastTopic, {
                    event: 'scan-graded',
                    testId,
                    learnerId: card.learnerId ?? null,
                    // ROW counts (session.correctCount/totalCount), named for
                    // what they are — never `earnedPoints`/`totalPoints`,
                    // which would invite a future maintainer to reach for
                    // `card.earnedPoints`/`card.totalPoints` instead, a
                    // different points-based number two scopes away.
                    correctCount: earned,
                    totalCount: total,
                    percent,
                    result: 'graded',
                    sessionId: sectionOutcome.session.sessionId,
                  });
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
                  // Same outcome, second listener: the School panel ceremony
                  // (Slice D) needs this on the wire too.
                  eventBus.broadcast?.(broadcastTopic, {
                    event: 'scan-review',
                    testId,
                    learnerId: card.learnerId ?? null,
                    sessionId: sectionOutcome.session.sessionId,
                    pendingReview: sectionOutcome.session.pendingReview,
                    reasons: sectionOutcome.session.reasons,
                    items: sectionOutcome.session.items,
                  });
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
