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
 *   re-broadcasts every terminal scan outcome — `scan-graded`, `scan-review`,
 *   `scan-unresolved`, `scan-refused`, `scan-stale-sheet`,
 *   `scan-rows-unmarked`, `scan-not-recorded` — on the SAME `omr`
 *   topic the relay already broadcasts sheets on, so the School panel (the
 *   ceremony Slice D builds) can subscribe without any new transport. This
 *   is a second, parallel consumer of the outcome, never a replacement for
 *   the hook or the log lines beside it.
 *
 *   EVERY one of them goes out through the `speak` funnel in `onPayload`,
 *   which is also what the "a scan is never silent" backstop reads. A new
 *   outcome that broadcasts directly on `eventBus` instead would be invisible
 *   to that check — that is exactly how a sheet went unanswered on
 *   2026-08-26. Add outcomes by calling `speak`, never `eventBus.broadcast`.
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
  if (!eventBus?.broadcast) {
    // IMPORTANT 2 (final review, 2026-08-26): `spoke` in `speak()` below is
    // set BEFORE `eventBus.broadcast?.()` runs, so a subscribe-only bus
    // marks every sheet as answered while broadcasting nothing — the
    // backstop suppressed, with no warning, by the very guard meant to let
    // it through. `broadcast` is required here, same as `subscribe` above,
    // rather than left to the optional-call `?.` at the call site.
    throw new Error('createSchoolPrintScanConsumer: eventBus with broadcast required');
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

    // THE CEREMONY FUNNEL (2026-08-26). Every broadcast below goes through
    // `speak`, and every terminal path below returns through ONE place
    // that checks whether it did.
    //
    // Both silent-scan incidents were the same defect wearing different
    // clothes. 2026-08-25: a missing `else` let terminal session states
    // fall off the end of a branch. 2026-08-26: an early `return` on
    // `!results.length` sat ABOVE the `silentLiveRecords` warn written for
    // that exact signature, above the `spoke` tracker, and above the
    // `scan-not-recorded` backstop — so a child fed his card four times
    // and the room stayed silent, because the guarantee and the path that
    // violated it never met.
    //
    // `spoke`/`speak` are declared HERE, above the `.then`/`.catch` split
    // (final review CRITICAL 1), not inside the `.then` — a rejection from
    // `resolveCardScan.execute`, or a synchronous throw anywhere inside
    // `settleOutcome`, means the `.then` callback never runs (or never
    // finishes) and only `.catch` ever gets a turn. A tracker only the
    // `.then` can see is not a guarantee either; it is the exact same hole
    // one level up.
    let spoke = false;
    const speak = (event) => {
      spoke = true;
      eventBus.broadcast?.(broadcastTopic, event);
    };

    resolveCardScan.execute({ testId, testIdCandidates, answers })
      .then(async (outcome) => {
        // A tracker that any `return` can skip past is not a guarantee. The
        // outcome handling now runs as a nested call whose returns cannot
        // escape the check, and it reports whether this sheet is OWED a
        // ceremony it did not already get.
        const owedCeremony = await settleOutcome(outcome, speak);
        if (!spoke && owedCeremony) {
          logger.warn?.('school.print.scan-not-recorded', {
            testId, recordCount: outcome?.results?.length ?? 0,
          });
          speak({
            event: 'scan-not-recorded',
            testId,
            learnerId: outcome?.results?.find((c) => c.learnerId)?.learnerId ?? null,
          });
        }
      })
      .catch((err) => {
        // Never lets a resolution failure interrupt the recorder's own
        // persistence (already run, synchronously, before this promise
        // chain) — logged loudly so a broken pipeline is visible.
        logger.warn?.('school.print.scan-resolve-failed', { testId, error: err.message });
        // CRITICAL 1a (final review, 2026-08-26): this `.catch` sat OUTSIDE
        // the funnel — a resolver rejection (allocation-store read failure,
        // phantom rev, bad YAML) or any synchronous throw inside
        // `settleOutcome` (e.g. `recordCardScanOutcome.execute` throwing
        // before returning a promise) used to land here with a warn and
        // NOTHING broadcast, because `spoke` was never consulted. A child
        // who fed paper is owed an answer even when the backend broke, so
        // this backstop applies here too — unless something already spoke
        // for this sheet before the failure hit.
        if (!spoke) {
          speak({ event: 'scan-not-recorded', testId, learnerId: null });
        }
      });

    /**
     * Handles one resolved outcome, speaking for it wherever it can.
     *
     * @returns {Promise<boolean>} whether this sheet is OWED a terminal
     *   ceremony if nothing above produced one. False for the two deliberate
     *   silences: a legacy bubble sheet this system never issued, and a
     *   resolve-and-score-only wiring with no recorder (it never tried to
     *   record, so it is in no position to announce that nothing was).
     */
    async function settleOutcome(outcome, speak) {
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
        // CRITICAL 1b (final review): wrapped in `Promise.resolve` — the
        // JSDoc contract above sanctions "any fake with a `fire(outcome)`",
        // and a hook that returns a non-promise would otherwise throw
        // SYNCHRONOUSLY calling `.catch` on it, on the exact incident path,
        // before the `speak` a few lines below ever runs.
        Promise.resolve(gradingHook?.fire({ result: 'unresolved', testId, code: outcome.error.code })).catch(() => {});
        // Same outcome, second listener: the School panel ceremony (Slice
        // D) needs this broadcast too. `testIdCandidates` here is the RAW
        // per-column digit-mark arrays `decodeQuizSheet` built (one entry
        // per test-id column, each the digit(s) 0-9 that column's marks
        // decoded to) — NOT a list of card ids, and not showable copy:
        // `useScanCeremony.js`'s `scan-unresolved` case only ever reads
        // `code`, never this field. The full array (not just the count the
        // log line above carries) rides along as raw diagnostic payload
        // for whatever inspects the wire directly, the same shape
        // `ResolveCardScan` itself already consumed for best-effort
        // resolution before this outcome was ever reached.
        speak({
          event: 'scan-unresolved',
          code: outcome.error.code,
          testId,
          testIdCandidates: Array.isArray(testIdCandidates) ? testIdCandidates : [],
        });
        return false;
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
        // A warn line is for the grown-up reading logs later; the child is
        // standing at the scanner NOW. This outcome used to return here with
        // no hook and no broadcast, so a real sheet with real answers on it
        // produced exactly nothing the child could see — the "nothing
        // happened" failure spec §6.2 exists to forbid ("a scan never
        // succeeds silently"). It rides the SAME `scan-refused` ceremony as
        // a per-record refusal because the child's next move is identical
        // (fetch a grown-up); only the `code` distinguishes them, which is
        // all a grown-up needs to tell "card id we've never seen" from
        // "record on a known card refused".
        // See CRITICAL 1b note above: `Promise.resolve(...)` guards a hook
        // whose `fire` returns a non-promise.
        Promise.resolve(gradingHook?.fire({ result: 'unresolved', testId, code: 'unknown_card' })).catch(() => {});
        speak({
          event: 'scan-refused', code: 'unknown_card', recordId: null,
        });
        return false;
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
        // Its OWN ceremony, not `scan-refused`, because the child's next
        // move is genuinely different and they can do it themselves: this
        // sheet is simply out of date, and scanning their card prints a
        // fresh one. Refusing them to a grown-up here would send a child
        // to fetch help for something self-service already solves.
        // See CRITICAL 1b note above: `Promise.resolve(...)` guards a hook
        // whose `fire` returns a non-promise.
        Promise.resolve(gradingHook?.fire({ result: 'unresolved', testId, code: 'dead_card' })).catch(() => {});
        speak({
          event: 'scan-stale-sheet', code: 'dead_card', testId,
        });
        return false;
      }
      // HOISTED ABOVE THE EMPTY-RESULTS RETURN (2026-08-26). This block used
      // to sit directly BELOW it, which made it dead code in the one case it
      // was written for: when the silent live record is the ONLY thing that
      // happened, `results` is empty and the return above fired first.
      if (outcome.silentLiveRecords?.length) {
        // Wrong-rows signature: a live record on this card got zero marks
        // while other rows were answered — a child answering one quiz's
        // questions in another quiz's rows, or (2026-08-26) a cumulative
        // card fed with only its older, already-satisfied marks on it
        // because today's rows were never filled in.
        logger.warn?.('school.print.scan-live-record-unmarked', {
          testId, silentLiveRecords: outcome.silentLiveRecords,
        });
        // See CRITICAL 1b note above: `Promise.resolve(...)` guards a hook
        // whose `fire` returns a non-promise — on THIS incident path, the
        // very one the 2026-08-26 report is about, a thrown `.catch` here
        // would fire before the `scan-rows-unmarked` `speak` a few lines
        // below ever runs.
        Promise.resolve(gradingHook?.fire({
          result: 'partial',
          testId,
          code: 'live_record_unmarked',
          silentLiveRecords: outcome.silentLiveRecords,
        })).catch(() => {});
        // WHO HEARS THIS depends on whether anything else will speak, and
        // the original code got that call backwards by only ever considering
        // one of the two cases.
        //
        // When other records on the card DID grade, this stays house-only:
        // there is no child action ("your answers went into another quiz's
        // rows" is not fixable at the scanner), and a panel event could not
        // be seen anyway — the per-record work below resolves
        // asynchronously, so its `scan-graded`/`scan-review` ceremony lands
        // after this one and replaces it. A ceremony that is reliably
        // overwritten is not a ceremony.
        //
        // When NOTHING else will speak, every one of those reasons inverts.
        // Nothing overwrites it, and the child's next move is obvious and
        // entirely self-service: fill in the rows that are actually theirs
        // today and feed the card again. Naming the range is what makes it
        // actionable — on a cumulative card there is no other way to tell
        // which block of rows is this morning's.
        if (!outcome.results?.length) {
          // MINOR 4 (final review): a card can carry more than one unmarked
          // live record (two pending worksheets on one cumulative card) —
          // naming only the first told the child about rows 34-39 and said
          // nothing about 40-45. `rowRange` stays the first record's range
          // for backward compatibility with any existing consumer of this
          // shape; `rowRanges` rides alongside with every unmarked record's
          // range so a multi-worksheet card is named in full.
          const [unmarked] = outcome.silentLiveRecords;
          speak({
            event: 'scan-rows-unmarked',
            testId,
            learnerId: unmarked.learnerId ?? null,
            rowRange: unmarked.rowRange,
            rowRanges: outcome.silentLiveRecords.map((record) => record.rowRange),
          });
          return false;
        }
      }
      if (!outcome?.results?.length) {
        // An empty `results` is TWO different situations and the difference
        // decides whether silence is correct (2026-08-26).
        //
        // Zero records on the card: a legacy household bubble sheet this
        // system never issued. Genuinely routine — the recorder already has
        // the decoded scan and there is nothing to say. Stays at `debug`.
        //
        // Records DO exist, but none of them owned a marked row: this is a
        // card we issued, holding a worksheet we are waiting on, and its
        // scan produced nothing. That is never routine. It gets `warn` (the
        // lesson this file already learned once for `scan-unresolved` at the
        // top: production runs at `info`, so a `debug` line is no line at
        // all) and it gets a ceremony from the funnel below.
        // `?? 0` degrades to the pre-existing "stay quiet" reading for any
        // resolver that does not report the count — never to a new noise.
        // (An unmarked LIVE record cannot reach here: that case speaks and
        // returns above, so this is only ever a card with no live claim left.)
        const cardIsOurs = (outcome?.cardRecordCount ?? 0) > 0;
        const detail = {
          testId,
          unallocatedRows: outcome?.unallocatedRows ?? [],
          cardRecordCount: outcome?.cardRecordCount ?? 0,
        };
        if (cardIsOurs) logger.warn?.('school.print.scan-no-allocation', detail);
        else logger.debug?.('school.print.scan-no-allocation', detail);
        return cardIsOurs && !!recordCardScanOutcome;
      }
      // A SCAN NEVER HAPPENS SILENTLY (spec §6.2). Everything below can end
      // in a terminal state that says nothing to the child — a re-fed sheet
      // whose session is already `rewarded`, rows that were all recorded on
      // an earlier pass, a session that has gone missing. Those are the
      // right things to RECORD, but the wrong things to be quiet about: on
      // 2026-08-25 three sheets were fed and the room stayed silent.
      //
      // Tracked per SHEET, not per record, by the `speak` funnel this
      // function was handed. A card can carry six allocation records; six
      // sounds at a child standing at the scanner is not feedback, it is an
      // alarm.
      const settling = [];
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
          // See CRITICAL 1b note above: `Promise.resolve(...)` guards a hook
          // whose `fire` returns a non-promise.
          Promise.resolve(gradingHook?.fire({
            result: 'refused', testId, code: card.error.code, learnerId: card.learnerId ?? null,
          })).catch(() => {});
          // Same outcome, second listener: the School panel ceremony
          // (Slice D) needs this on the wire too.
          speak({
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
        settling.push(recordCardScanOutcome.execute({ testId, card, cardIdInferred: outcome.cardIdInferred ?? null })
          .then(async (recorded) => {
            // A composed worksheet records one outcome per independently
            // completable lesson section. A legacy/single worksheet still
            // returns the original single outcome shape.
            const outcomes = recorded?.sectionOutcomes ?? [recorded];
            for (const sectionOutcome of outcomes) {
              // `gate-repaired` (Task 11) rides the SAME branch, and must: a
              // child who has just fed the sheet back with their finish code
              // needs the settle to run (that is what re-decides the result and
              // prints the new receipt) and the room to say something. It
              // carries the same session-sourced percent/counts the graded path
              // does — the score the sheet already earned, unchanged by the
              // repair — so nothing below has to know which of the two it is.
              if (sectionOutcome?.session?.advancedTo === 'graded'
                  || sectionOutcome?.session?.reason === 'gate-repaired') {
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
                let settledResult = 'graded';
                // DID PAPER COME OUT? The panel's ceremony is a FALLBACK,
                // not a receipt (see `useScanCeremony.js`): when the result
                // receipt prints, the paper in the child's hand IS the
                // feedback, and repeating the score on a wall screen both
                // duplicates it and reads a grade out loud in a shared
                // room. The panel cannot make that call without this pair,
                // and this is the only place in the graded path that knows
                // it — `CloseSessionOutcome#execute` returns the SAME
                // `{printed, printReason}` `ReceiptPrinting.print()`
                // produced, so nothing here re-derives or guesses it.
                //
                // Defaults FAIL TOWARD SPEAKING. `false` is the answer for
                // every case where paper is not KNOWN to have arrived — no
                // settle step wired (nothing prints at all then), a settle
                // that threw, a settle that reported nothing — because a
                // redundant ceremony costs a child twelve seconds of banner
                // and a wrongly-suppressed one costs them any feedback at
                // all.
                let printed = false;
                let printReason = 'not_settled';
                if (closeSessionOutcome) {
                  try {
                    // The bridge returns the authoritative session id (a
                    // composed card itself has no single session owner).
                    // eslint-disable-next-line no-await-in-loop
                    const settled = await closeSessionOutcome.execute({ sessionId: sectionOutcome.session.sessionId });
                    settledResult = settled?.result ?? settledResult;
                    printed = settled?.printed === true;
                    printReason = printed ? null : (settled?.printReason ?? 'unknown');
                  } catch (err) {
                    // The settle is now UPSTREAM of the broadcast (it has to
                    // be — the print outcome does not exist before it), so
                    // an unguarded throw here would take the whole ceremony
                    // with it and a scan would make no visible mark on the
                    // room at all. That is exactly the failure the ceremony
                    // exists to forbid, so the grade is still announced and
                    // the failure is still loud in the log.
                    printed = false;
                    printReason = 'settle_failed';
                    logger.warn?.('school.print.scan-settle-failed', {
                      testId, sessionId: sectionOutcome.session.sessionId, error: err.message,
                    });
                  }
                }
                // Home automation is a bystander: never awaited into the
                // grading path and never able to fail it. The adapter
                // already swallows its own errors; this catch covers a
                // hook that rejects outright.
                // Same outcome, second listener: the School panel ceremony
                // (Slice D) needs this on the wire too. SAME session-sourced
                // percent/earned/total the hook above just fired — never
                // recomputed from `card.earnedPoints`/`card.totalPoints`,
                // for the identical reason the hook doesn't: that points
                // aggregate can disagree with the row-count percent the
                // gradebook/report card actually record (final review Fix
                // 3), and the panel must never be able to show a different
                // score than the report card will.
                speak({
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
                  result: settledResult,
                  sessionId: sectionOutcome.session.sessionId,
                  printed,
                  printReason,
                });
                // Fire after the authoritative outcome settles so Home
                // Assistant can distinguish a passing non-perfect score
                // from a score needing remediation. The hook itself is
                // still fire-and-forget and cannot affect grading.
                // See CRITICAL 1b note above: `Promise.resolve(...)` guards
                // a hook whose `fire` returns a non-promise.
                Promise.resolve(gradingHook?.fire({
                  result: settledResult,
                  testId,
                  learnerId: card.learnerId ?? null,
                  earned,
                  total,
                  percent,
                  sessionId: sectionOutcome.session.sessionId,
                  subject: sectionOutcome.curriculum?.subjectId ?? null,
                  course: sectionOutcome.curriculum?.courseId ?? null,
                  unit: sectionOutcome.curriculum?.unitId ?? null,
                  lesson: sectionOutcome.curriculum?.lessonId ?? null,
                })).catch(() => {});
              } else if (sectionOutcome?.session?.reason === 'awaiting-review') {
                // See CRITICAL 1b note above: `Promise.resolve(...)` guards
                // a hook whose `fire` returns a non-promise.
                Promise.resolve(gradingHook?.fire({
                  result: 'review',
                  testId,
                  learnerId: card.learnerId ?? null,
                  sessionId: sectionOutcome.session.sessionId,
                  pendingReview: sectionOutcome.session.pendingReview,
                  reasons: sectionOutcome.session.reasons,
                  items: sectionOutcome.session.items,
                  subject: sectionOutcome.curriculum?.subjectId ?? null,
                  course: sectionOutcome.curriculum?.courseId ?? null,
                  unit: sectionOutcome.curriculum?.unitId ?? null,
                  lesson: sectionOutcome.curriculum?.lessonId ?? null,
                })).catch(() => {});
                // Same outcome, second listener: the School panel ceremony
                // (Slice D) needs this on the wire too.
                speak({
                  event: 'scan-review',
                  testId,
                  learnerId: card.learnerId ?? null,
                  sessionId: sectionOutcome.session.sessionId,
                  pendingReview: sectionOutcome.session.pendingReview,
                  reasons: sectionOutcome.session.reasons,
                  items: sectionOutcome.session.items,
                });
              } else if (sectionOutcome?.session?.reason === 'partial-scan') {
                // AN UNFINISHED SHEET IS SCORED AND THEN DROPPED, AND USED TO
                // BE DROPPED IN SILENCE (2026-08-26).
                //
                // `#bridgeSession` refuses to grade a card with any blank row,
                // and that refusal is right — a half-empty sheet must not
                // become a permanent verdict on unfinished work. But it was
                // the only branch here with no ceremony, so the scan resolved,
                // scored, logged `scan-partial-not-bridged`, and told nobody.
                // The child re-fed the card twice more and got silence both
                // times; a parent found it hours later by noticing the day's
                // disc count was wrong.
                //
                // This is strictly MORE actionable than `scan-rows-unmarked`,
                // which can only name a range: here the rows are known
                // individually, so the child is told exactly which bubble is
                // missing. Ambiguous rows ride along because a double mark is
                // the other way a sheet stalls, and the two are easy to
                // confuse on paper — a stray second mark reads as "I answered
                // that one" to the child who made it.
                const rowsWith = (status) => (card.results ?? [])
                  .filter((row) => row.status === status && Number.isFinite(row.row))
                  .map((row) => row.row)
                  .sort((a, b) => a - b);
                const blankRows = rowsWith('blank');
                const ambiguousRows = rowsWith('ambiguous');
                logger.warn?.('school.print.scan-partial-unfinished', {
                  testId, recordId: card.recordId, learnerId: card.learnerId ?? null,
                  sessionId: sectionOutcome.session.sessionId, blankRows, ambiguousRows,
                });
                // See CRITICAL 1b note above: `Promise.resolve(...)` guards a
                // hook whose `fire` returns a non-promise.
                Promise.resolve(gradingHook?.fire({
                  result: 'partial',
                  testId,
                  code: 'partial_scan',
                  learnerId: card.learnerId ?? null,
                })).catch(() => {});
                speak({
                  event: 'scan-rows-incomplete',
                  testId,
                  learnerId: card.learnerId ?? null,
                  sessionId: sectionOutcome.session.sessionId,
                  blankRows,
                  ambiguousRows,
                });
              }
            }
          })
          .catch((err) => {
            logger.warn?.('school.print.scan-record-failed', {
              testId, recordId: card.recordId, error: err.message,
            });
          }));
      }
      // The sheet is finished. Whether anything spoke for it is decided by
      // the funnel in the caller, which no `return` in here can skip past.
      await Promise.all(settling);
      // Owed an answer only when a recorder was actually wired. Without one
      // this consumer never attempted to record anything, so it is in no
      // position to announce that nothing was recorded — the
      // resolve-and-score-only composition is a legitimate wiring, not a
      // silent scan.
      return !!recordCardScanOutcome;
    }
  };

  const unsubs = topics.map((topic) => eventBus.subscribe(topic, onPayload));
  logger.info?.('school.print.scan-consumer.ready', { topics });
  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createSchoolPrintScanConsumer;
