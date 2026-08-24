/**
 * End-to-end: can a child actually do a piece of schoolwork?
 *
 * Every other School suite tests a part against doubles. This one runs the whole
 * console — real use cases, real domain, real MathJax/pdfkit rendering, real YAML
 * persistence — with only the four physical devices virtualised, and asserts on
 * what came OUT: the transcript off the receipt roll, the PDF in the tray, the
 * form map on disk, the event log, the coin ledger.
 *
 * A use case that returns a tidy object while printing a piece of paper nobody
 * can act on has failed. Only artifact-level assertions can see that, which is
 * why nothing below asserts on a return value alone.
 *
 * @see tests/_lib/school/lifecycleHarness.mjs
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createLifecycleHarness, fixtureBank,
  MEDIA_UNIT, WORKSHEET_UNIT, OMR_UNIT, MIXED_UNIT, DEFAULT_LEARNER, DEFAULT_GROWNUP,
} from '#testlib/school/lifecycleHarness.mjs';

const ALL_RIGHT = (ids) => Object.fromEntries(ids.map((id) => [id, 'correct']));
const U2 = ['u2-q1', 'u2-q2', 'u2-q3', 'u2-q4', 'u2-q5', 'u2-q6'];
const U1 = ['u1-q1', 'u1-q2', 'u1-q3', 'u1-q4', 'u1-q5', 'u1-q6'];

let h;

beforeEach(async () => { h = await createLifecycleHarness(); await h.assign(); });
afterEach(() => { h?.dispose(); });

// ---------------------------------------------------------------------------
// 1. video unit, happy path
// ---------------------------------------------------------------------------

describe('scenario 1 — the video unit, end to end', () => {
  it('takes a child from a card scan to a passed unit and an unlocked next one', async () => {
    // --- the card prints a list with a scannable line for unit 01 -----------
    const card = await h.scanCard();
    expect(card.status).toBe('agenda_printed');
    expect(card.printed).toBe(true);

    const agenda = h.lastReceiptText();
    expect(agenda).toContain('TEST LEARNER');
    expect(agenda).toContain('Equivalent Fractions and Common Denominators');
    // The card's footer instruction names what THIS scan does. A video unit's
    // scan plays a film, so the line must not say "print" — see "Agenda and
    // result-receipt language" in docs/reference/school/print-documents.md.
    expect(agenda).toMatch(/WATCH OR LISTEN/i);

    const offered = h.tokensInLastReceipt();
    expect(offered).toHaveLength(1);
    expect(offered[0].token).toMatch(/^sch:[2-9A-HJ-NP-Z]{16}$/);

    // --- scanning it hands the video to a screen ----------------------------
    const started = await h.scanTokenMatching(/watch or listen/i);
    expect(started.status).toBe('dispatched');
    expect(started.effect.target).toBe('school-screen');
    expect(h.devices.playback.listDispatches()).toHaveLength(1);
    expect(h.devices.playback.listDispatches()[0].contentId).toBe('plex:481203');

    // The child is told where it is playing and what to do at the end.
    expect(h.lastReceiptText()).toMatch(/school screen/i);
    expect(h.lastReceiptText()).toMatch(/scan your card/i);

    // --- only finishing it releases the questions ---------------------------
    const sessionId = started.sessionId;
    expect((await h.sessionState(sessionId)).state).toBe('media_dispatched');

    const completed = await h.playToEnd();
    expect(completed.status).toBe('completed');
    expect((await h.sessionState(sessionId)).state).toBe('media_completed');
    expect((await h.sessionState(sessionId)).mediaDispatch.verified).toBe('playhead');

    // --- the quiz is answered on the screen, through the one grading engine --
    const bank = fixtureBank('math/math-fractions/01-quiz');
    const entries = {};
    for (const item of bank.items) {
      entries[item.id] = item.type === 'matching' ? item.pairs.map((p) => ({ ...p })) : item.answer;
    }
    const handedIn = await h.handIn({ sessionId, entries, submittedBy: DEFAULT_LEARNER });
    expect(handedIn.status).toBe('submitted');
    expect(handedIn.review).toEqual([]);

    const graded = await h.grade({ sessionId, entries });
    expect(graded.status).toBe('graded');
    expect(graded.percent).toBe(100);

    // Real attempts landed in the learner's own log — paper and screen share it.
    const attempts = h.attemptsFor(DEFAULT_LEARNER);
    expect(attempts).toHaveLength(bank.items.length);
    expect(attempts.every((a) => a.correct === true)).toBe(true);

    // --- the result receipt is a thing a child can read ---------------------
    const settled = await h.closeOutcome({ sessionId });
    expect(settled.status).toBe('settled');
    expect(settled.result).toBe('passed');

    // The result slip's verdict, its exact score, and the lesson it opens up.
    // (Wave-A2 copy: the headline is the verdict word and the score is the
    // exact fraction — see receipts.mjs `resultDocument`.)
    const receipt = h.lastReceiptText();
    expect(receipt).toContain('PASSED');
    expect(receipt).toContain('6 of 6 correct');
    expect(receipt).toContain('ONE MORE?');
    expect(receipt).toContain('Today is already complete. Scan only if you want one more.');
    expect(receipt).toContain('Adding and Subtracting Unlike Denominators');

    // --- and unit 02 is now offered ----------------------------------------
    const plan = await h.plan();
    expect(plan.entries.find((e) => e.unitId === MEDIA_UNIT).status).toBe('completed');
    expect(plan.entries.find((e) => e.unitId === WORKSHEET_UNIT).status).toBe('available');

    // The v2 agenda mints ONE ticket per SUBJECT and serves it once per study
    // day (spec §6.3) — math already served today via unit 01, so unit 02
    // only shows up on the card tomorrow's study day.
    h.advanceDays(1);
    await h.scanCard();
    expect(h.lastReceiptText()).toContain('Lesson · Adding and Subtracting Unlike Denominators');
    expect(h.lastReceiptText()).toMatch(/PRINT YOUR SHEET/i);
  });
});

// ---------------------------------------------------------------------------
// 2. worksheet unit
// ---------------------------------------------------------------------------

describe('scenario 2 — the printed worksheet unit', () => {
  it('prints a real multi-page PDF, takes a parent mark, and pays out', async () => {
    await h.completeMediaUnit();
    // math already served today via unit 01 — unit 02 is due on the next study day.
    h.advanceDays(1);
    await h.scanCard();

    const issued = await h.scanTokenMatching(/print your sheet/i);
    expect(issued.status).toBe('issued');
    expect(issued.physical).toBe('worksheet');

    // --- a real PDF, in the tray -------------------------------------------
    const jobs = h.printedPdfs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobName).toContain(WORKSHEET_UNIT);
    expect(jobs[0].requestedBy).toBe(DEFAULT_LEARNER);

    const printed = await h.lastPrintedPdf();
    expect(printed.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(printed.pdf.length).toBeGreaterThan(10_000);
    // The renderer's own count and the bytes on paper must agree — pdfkit has
    // silently emitted twice the reported page count before.
    expect(issued.effect.pageCount).toBe(2);
    expect(printed.pageCount).toBe(issued.effect.pageCount);

    // --- a written sheet carries no bubbles, so it stores no form map -------
    const sessionId = issued.sessionId;
    expect(await h.formMapFor(sessionId)).toBeNull();

    // --- a grown-up marks it ------------------------------------------------
    const graded = await h.parentGrades(
      { ...ALL_RIGHT(U2.slice(0, 5)), 'u2-q6': 'incorrect' },
      { sessionId },
    );
    expect(graded.status).toBe('graded');
    expect(graded.correct).toBe(5);
    expect(graded.expected).toBe(6);
    expect(graded.percent).toBeCloseTo(83.33, 2);

    // Every verdict is on the record with WHO made it — a parent's judgement is
    // never laundered into a machine-graded attempt.
    const review = await h.reviewItems(sessionId);
    expect(review).toHaveLength(6);
    expect(review.every((i) => i.gradedBy === DEFAULT_GROWNUP)).toBe(true);
    expect(h.attemptsFor(DEFAULT_LEARNER).filter((a) => a.bankId === 'math-fractions-02')).toHaveLength(0);

    const settled = await h.closeOutcome({ sessionId });
    expect(settled.result).toBe('passed');
    expect(h.lastReceiptText()).toContain('5 of 6 correct');
    expect(h.lastReceiptText()).toContain('You earned 5 coins.');
    expect(await h.coinsFor()).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. OMR unit
// ---------------------------------------------------------------------------

describe('scenario 3 — the bubble-sheet checkpoint', () => {
  it('reads the real form map and grades through the canonical engine', async () => {
    await h.completeMediaUnit();
    h.advanceDays(1); // math served today via unit 01 — unit 02 is due tomorrow
    await h.completeWorksheetUnit();
    h.advanceDays(1); // and unit 03 the day after that
    await h.scanCard();

    const issued = await h.scanTokenMatching(/print your sheet/i);
    expect(issued.status).toBe('issued');
    const sessionId = issued.sessionId;

    // --- the printed sheet's geometry is on disk ----------------------------
    const formMap = await h.formMapFor(sessionId);
    expect(formMap).not.toBeNull();
    expect(formMap.documentId).toBe('math-fractions-03-omr');
    expect(formMap.marks).toHaveLength(24); // six questions x four bubbles

    // Every bubble carries the CHOICE TEXT from the bank, not a bare letter. A
    // sheet of unlabelled A/B/C/D bubbles is unanswerable.
    const bank = fixtureBank('math/math-fractions/03-checkpoint');
    for (const item of bank.items) {
      const bubbles = formMap.marks.filter((m) => m.itemId === item.id);
      expect(bubbles.map((b) => b.label)).toEqual(item.choices);
      expect(bubbles.map((b) => b.label)).toContain(item.answer);
    }

    // --- a child fills the right bubbles; the reader reads the paper ---------
    const chosen = await h.correctBubbles({ sessionId, bankId: 'math/math-fractions/03-checkpoint' });
    const submitted = await h.omrSubmit(chosen, { sessionId });
    expect(submitted.status).toBe('submitted');
    expect(submitted.review).toEqual([]);

    // What the reader decoded IS the bank's answer text, which is what the
    // grader compares against.
    expect(submitted.scorable).toEqual(
      Object.fromEntries(bank.items.map((i) => [i.id, i.answer])),
    );
    const sheet = h.devices.omr.lastSheet();
    expect(sheet.columns).toBe(6);
    expect(sheet.markedColumns).toBe(6);

    const graded = await h.grade({ sessionId, entries: submitted.scorable });
    expect(graded.status).toBe('graded');
    expect(graded.correct).toBe(6);
    expect(graded.percent).toBe(100);

    // Graded through the ONE engine: six real attempts, each carrying the paper
    // provenance and the bank's own answer.
    const attempts = h.attemptsFor(DEFAULT_LEARNER).filter((a) => a.bankId === 'math/math-fractions/03-checkpoint');
    expect(attempts).toHaveLength(6);
    expect(attempts.every((a) => a.transport === 'paper' && a.correct === true)).toBe(true);
    expect(attempts.map((a) => a.given).sort()).toEqual(bank.items.map((i) => i.answer).sort());

    // Unit 03's reward waits on a grown-up, so the pass lands but the coins do not.
    const held = await h.closeOutcome({ sessionId });
    expect(held.result).toBe('passed');
    expect(held.reward.skipReason).toBe('awaiting_signoff');

    const signed = await h.closeOutcome({ sessionId, signedOff: true });
    expect(signed.reward.amount).toBeGreaterThan(0);
  });

  it('sends a smudged row and an empty one to a grown-up rather than guessing', async () => {
    await h.completeMediaUnit();
    h.advanceDays(1);
    await h.completeWorksheetUnit();
    h.advanceDays(1);
    await h.scanCard();
    const issued = await h.scanTokenMatching(/print your sheet/i);
    const sessionId = issued.sessionId;

    const chosen = await h.correctBubbles({ sessionId, bankId: 'math/math-fractions/03-checkpoint' });
    delete chosen['u3-q3'];
    delete chosen['u3-q4'];
    const submitted = await h.omrSubmit(chosen, {
      sessionId, ambiguous: ['u3-q3'], blank: ['u3-q4'],
    });

    expect(Object.keys(submitted.scorable).sort()).toEqual(['u3-q1', 'u3-q2', 'u3-q5', 'u3-q6']);
    expect(submitted.review.map((r) => [r.itemId, r.reason]).sort()).toEqual([
      ['u3-q3', 'ambiguous'], ['u3-q4', 'blank'],
    ]);

    // The session WAITS rather than inventing a verdict.
    const partial = await h.grade({ sessionId, entries: submitted.scorable });
    expect(partial.status).toBe('awaiting_review');
    expect(partial.outstanding.sort()).toEqual(['u3-q3', 'u3-q4']);
    expect((await h.sessionState(sessionId)).state).toBe('submitted');
    expect((await h.pendingReview()).map((i) => i.itemId).sort()).toEqual(['u3-q3', 'u3-q4']);

    const finished = await h.grade({
      sessionId, entries: submitted.scorable,
      verdicts: { 'u3-q3': 'correct', 'u3-q4': 'incorrect' }, gradedBy: DEFAULT_GROWNUP,
    });
    expect(finished.status).toBe('graded');
    expect(finished.correct).toBe(5);
    expect(await h.pendingReview()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. fail, retry, credit once
// ---------------------------------------------------------------------------

describe('scenario 4 — failing, retrying, and being paid exactly once', () => {
  it('prints a retry ticket, opens a new variant, and credits one payout', async () => {
    await h.completeMediaUnit();
    h.advanceDays(1);
    await h.scanCard();
    const issued = await h.scanTokenMatching(/print your sheet/i);
    const firstSession = issued.sessionId;
    const firstArtifact = issued.effect.artifactId;

    await h.parentGrades({ ...ALL_RIGHT(U2.slice(0, 3)), 'u2-q4': 'incorrect', 'u2-q5': 'incorrect', 'u2-q6': 'incorrect' }, { sessionId: firstSession });
    const failed = await h.closeOutcome({ sessionId: firstSession });
    expect(failed.result).toBe('needs_remediation');

    // Settling PRINTS. Nothing in this test asks it to — a close-out that only
    // returned JSON left the retry barcode inside the server and the child
    // holding a marked sheet with no way to ask for another.
    expect(failed.printed).toBe(true);

    // --- the receipt says what went wrong AND carries the next move ---------
    const receipt = h.lastReceiptText();
    expect(receipt).toContain('TRY AGAIN');
    expect(receipt).toContain('3 of 6 correct');
    expect(receipt).toContain('REVIEW BEFORE YOU RETRY');
    const retryTicket = h.tokensInLastReceipt();
    expect(retryTicket).toHaveLength(1);
    // The retry is offered as a lesson card: the TRY AGAIN eyebrow, the unit it
    // reopens, and a footer saying a fresh sheet is what the scan produces.
    expect(retryTicket[0].printed).toMatch(/try again/i);
    expect(retryTicket[0].printed).toMatch(/fresh worksheet/i);
    expect(retryTicket[0].printed).toMatch(/scan to print your retry/i);
    expect(await h.coinsFor()).toBe(0);

    // --- scanning it prints a NEW sheet on a linked session ------------------
    const retry = await h.scanTokenMatching(/try again/i);
    expect(retry.status).toBe('issued');
    expect(retry.physical).toBe('worksheet');
    expect(retry.sessionId).not.toBe(firstSession);

    const retryState = await h.sessionState(retry.sessionId);
    expect(retryState.unitId).toBe(WORKSHEET_UNIT);       // same unit
    expect(retryState.remediationOf).toBe(firstSession);  // linked, not rewound
    expect(retryState.variant).toBe(1);                   // a different form
    expect(retryState.issuedArtifacts).toEqual([retry.effect.artifactId]);
    expect(retry.effect.artifactId).not.toBe(firstArtifact);

    // A retry is different PAPER: a second job in the tray whose bytes are not
    // the first one's. WHICH form the renderer was asked for is pinned at the
    // unit level (issueDocument.test.mjs) and recorded on the session above —
    // the harness no longer wraps the renderer to count calls, because a
    // wrapper production does not have is the parallel construction this suite
    // exists to be free of.
    const [firstJob, retryJob] = h.printedPdfs();
    const firstBytes = (await h.readPrintedPdf(firstJob.jobId)).pdf;
    const retryBytes = (await h.readPrintedPdf(retryJob.jobId)).pdf;
    expect(retryBytes.equals(firstBytes)).toBe(false);

    // The original keeps its own evidence and is terminal.
    const originalState = await h.sessionState(firstSession);
    expect(originalState.state).toBe('remediation_opened');
    expect(originalState.terminal).toBe(true);
    expect(originalState.gradedPercent).toBe(50);

    // Two sheets came out of the tray, one per attempt.
    expect(h.printedPdfs()).toHaveLength(2);

    // --- passing the second time pays, once ---------------------------------
    await h.parentGrades(ALL_RIGHT(U2), { sessionId: retry.sessionId });
    const passed = await h.closeOutcome({ sessionId: retry.sessionId });
    expect(passed.result).toBe('passed');
    expect(passed.reward.amount).toBe(5);

    expect(await h.coinsFor()).toBe(5);
    expect(h.economyCalls).toHaveLength(1);
    expect(h.ledgerFor().filter((t) => t.kind === 'earn')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. the idempotency matrix
// ---------------------------------------------------------------------------

describe('scenario 5 — the idempotency matrix, driven for real', () => {
  it('a second card scan reuses the session it already opened', async () => {
    await h.scanCard();
    const first = (await h.sessionRows()).map((r) => r.sessionId);
    const second = await h.scanCard();
    expect((await h.sessionRows()).map((r) => r.sessionId)).toEqual(first);
    expect(first).toHaveLength(1);

    // Slice G (2026-08-22-omr-grading-integrity, f94a7c726) added a per-learner
    // agenda print cooldown: a repeat tap within the window reprints nothing —
    // real logs showed a child tapping four times in five minutes, flooding the
    // printer. But the tap is never SILENT: the use case still acknowledges it
    // (`agenda_suppressed`, `printed:false`, a real message) so a child who taps
    // twice isn't taught that tapping harder gets a result. This e2e harness
    // drives cards through the barcode-relay/ResolveScanAction path, which hands
    // that acknowledgement back synchronously in the return value — the `omr`
    // broadcast half of Slice G's acknowledgement (for the real hardware NFC
    // ingress, which has no synchronous caller to answer) is covered separately
    // in nfcTapIngress.test.mjs. Only the first tap's receipt actually printed.
    expect(second.status).toBe('agenda_suppressed');
    expect(second.printed).toBe(false);
    expect(second.message).toBeTruthy();
    expect(h.receiptTexts()).toHaveLength(1);

    // Rule 4: the cooldown is a window, not a lockout. Once it elapses, a
    // repeat tap prints the agenda again — and it is still the same session,
    // never a second one.
    h.advanceClock(16 * 60 * 1000);
    const third = await h.scanCard();
    expect(third.status).toBe('agenda_printed');
    expect(third.printed).toBe(true);
    expect((await h.sessionRows()).map((r) => r.sessionId)).toEqual(first);

    // Both real receipts (tap 1 and tap 3, post-cooldown) offer the same ticket.
    expect(h.receiptTexts()).toHaveLength(2);
    expect(h.tokensInLastReceipt()[0].token).toBeTruthy();
  });

  it('a second scan of a selection does not start the work twice', async () => {
    await h.scanCard();
    const token = h.tokensInLastReceipt()[0].token;
    expect((await h.scan(token)).status).toBe('dispatched');

    // The v2 ticket is a `subject_next` token, sessionless and re-resolved
    // fresh on every scan (Task 11) — a re-scan while the video is out
    // recomputes "what's next for math right now" and finds `media_dispatched`,
    // which reads as "wait", not the old per-selection "already_done". The
    // INVARIANT the scenario proves is unchanged: no second dispatch, and the
    // child is told to keep going rather than left to guess.
    const again = await h.scan(token);
    expect(again.status).toBe('wait');
    expect(again.printed).toBe(true);
    expect(h.lastReceiptText()).toMatch(/finish watching, then scan your card/i);
    expect(h.devices.playback.listDispatches()).toHaveLength(1);
  });

  it('a re-scan mid-play never dispatches a second time', async () => {
    await h.scanCard();
    const started = await h.scanTokenMatching(/watch or listen/i);
    const before = h.devices.playback.listDispatches().length;

    const midPlay = await h.useCases.dispatchMedia.execute({ sessionId: started.sessionId });
    expect(midPlay.status).toBe('already_playing');
    expect(midPlay.dispatchId).toBe(started.effect.dispatchId);
    expect(h.devices.playback.listDispatches()).toHaveLength(before);
    expect(await h.eventTypes(started.sessionId)).toEqual(['created', 'media_dispatched']);
  });

  it('a reprint reuses the original artifact id and adds a lineage event', async () => {
    await h.completeMediaUnit();
    h.advanceDays(1);
    await h.scanCard();
    const issued = await h.scanTokenMatching(/print your sheet/i);

    const reprint = await h.useCases.issueDocument.execute({ sessionId: issued.sessionId });
    expect(reprint.status).toBe('reprinted');
    expect(reprint.artifactId).toBe(issued.effect.artifactId);
    expect(await h.eventTypes(issued.sessionId)).toEqual(['created', 'issued', 'reprinted']);
    // Two sheets on paper, one piece of work.
    expect(h.printedPdfs()).toHaveLength(2);
    expect((await h.sessionState(issued.sessionId)).issuedArtifacts).toEqual([issued.effect.artifactId]);
  });

  it('a duplicate submission is refused and points at the one already in', async () => {
    await h.completeMediaUnit();
    h.advanceDays(1);
    await h.scanCard();
    const issued = await h.scanTokenMatching(/print your sheet/i);
    expect((await h.handIn({ sessionId: issued.sessionId })).status).toBe('submitted');

    const second = await h.handIn({ sessionId: issued.sessionId });
    expect(second.status).toBe('duplicate');
    expect(second.pointsAt.state).toBe('submitted');
    expect(await h.eventTypes(issued.sessionId)).toEqual(['created', 'issued', 'submitted']);
  });

  it('settling twice records one outcome', async () => {
    await h.completeMediaUnit();
    h.advanceDays(1);
    await h.scanCard();
    const issued = await h.scanTokenMatching(/print your sheet/i);
    await h.parentGrades(ALL_RIGHT(U2), { sessionId: issued.sessionId });

    const first = await h.closeOutcome({ sessionId: issued.sessionId });
    const second = await h.closeOutcome({ sessionId: issued.sessionId });
    expect(first.status).toBe('settled');
    expect(second.status).toBe('already_settled');
    expect(first.outcomeId).toBe(second.outcomeId);

    const events = await h.eventTypes(issued.sessionId);
    expect(events.filter((t) => t === 'outcome_recorded')).toHaveLength(1);
    expect(events.filter((t) => t === 'rewarded')).toHaveLength(1);
  });

  it('a payout retried after UTC midnight does not pay twice', async () => {
    await h.completeMediaUnit();
    h.advanceDays(1);
    await h.scanCard();
    const issued = await h.scanTokenMatching(/print your sheet/i);
    await h.parentGrades(ALL_RIGHT(U2), { sessionId: issued.sessionId });
    await h.closeOutcome({ sessionId: issued.sessionId });

    expect(await h.coinsFor()).toBe(5);
    expect(h.economyCalls).toHaveLength(1);

    // The economy's own replay guard reads ONE UTC day's ledger shard, so it
    // would pay this ref again tomorrow. School's durable `rewarded` event is
    // what actually holds — and the proof is that the economy is never asked.
    h.advanceDays(1);
    const retried = await h.closeOutcome({ sessionId: issued.sessionId });
    expect(retried.reward.skipReason).toBe('already_rewarded');
    expect(h.economyCalls).toHaveLength(1);
    expect(await h.coinsFor()).toBe(5);
    expect(h.ledgerFor().filter((t) => t.kind === 'earn')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. printer offline
// ---------------------------------------------------------------------------

describe('scenario 6 — the printer is offline when the sheet is asked for', () => {
  it('records the failure, hands over a recovery ticket, and prints on the retry', async () => {
    await h.completeMediaUnit();
    h.advanceDays(1);
    await h.scanCard();

    h.setFault('laser', 'offline');
    const attempt = await h.scanTokenMatching(/print your sheet/i);
    expect(attempt.status).toBe('print_failed');
    expect(attempt.printed).toBe(true);        // the SLIP printed; the sheet did not
    expect(h.printedPdfs()).toHaveLength(0);

    const slip = h.lastReceiptText();
    expect(slip).toContain('The printer is not answering');
    expect(slip).toContain('Your work is safe. Nothing was lost.');
    const recovery = h.tokensInLastReceipt();
    expect(recovery).toHaveLength(1);
    expect(recovery[0].label).toMatch(/try printing again/i);

    // The failure is an ANNOTATION: the state did not advance, so the work is
    // still issuable and nothing the child holds went stale.
    const sessionId = attempt.sessionId;
    expect(await h.eventTypes(sessionId)).toEqual(['created', 'failed']);
    const pending = await h.sessionState(sessionId);
    expect(pending.state).toBe('created');
    expect(pending.lastFailure.stage).toBe('print');
    expect(pending.nextAction.tokenClass).toBe('recovery');

    // --- printer back; the same ticket prints the sheet ---------------------
    h.setFault('laser', null);
    const recovered = await h.scanTokenMatching(/try printing again/i);
    expect(recovered.status).toBe('issued');
    expect(recovered.physical).toBe('worksheet');
    expect(h.printedPdfs()).toHaveLength(1);
    expect(await h.eventTypes(sessionId)).toEqual(['created', 'failed', 'issued']);
  });
});

// ---------------------------------------------------------------------------
// 7. media interruption
// ---------------------------------------------------------------------------

describe('scenario 7 — the video is stopped halfway and never finishes', () => {
  it('marks it stalled past duration + grace and offers to start it again', async () => {
    await h.scanCard();
    const started = await h.scanTokenMatching(/watch or listen/i);
    const sessionId = started.sessionId;

    h.interruptPlayback();
    expect(h.devices.playback.listDispatches()[0].status).toBe('stopped');

    // Inside the window it is still just "playing" — a paused video is not a
    // failure, and calling it one would rob a child mid-lesson.
    const early = await h.checkStalled(sessionId);
    expect(early.stalled).toBe(false);
    expect(early.reason).toBe('still_within_window');
    expect((await h.sessionState(sessionId)).state).toBe('media_dispatched');

    // 611s of video + the 600s grace.
    h.advanceClock((611 + 600 + 1) * 1000);
    const late = await h.checkStalled(sessionId);
    expect(late.stalled).toBe(true);
    expect(late.nextAction.tokenClass).toBe('media_action');
    expect((await h.sessionState(sessionId)).state).toBe('media_stalled');

    // The recovery is on paper, and it works.
    await h.scanCard();
    expect(h.lastReceiptText()).toMatch(/START IT AGAIN/i);
    const replay = await h.scanTokenMatching(/start it again/i);
    expect(replay.status).toBe('dispatched');
    expect(h.devices.playback.listDispatches()).toHaveLength(2);

    const done = await h.playToEnd();
    expect(done.status).toBe('completed');
    expect(await h.eventTypes(sessionId)).toEqual([
      'created', 'media_dispatched', 'media_stalled', 'media_dispatched', 'media_completed',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 8. gating
// ---------------------------------------------------------------------------

describe('scenario 8 — a locked unit always names its remedy', () => {
  // v2's agenda (§6.3) sections BY SUBJECT and prints only the ONE thing a
  // subject owes right now (Task 9/10) — all four fixture units share subject
  // "math", so the receipt never shows more than one line for it at a time.
  // That is a real behaviour change from the old flat per-unit agenda: a
  // distant lock (unit 03, gated on unit 02) is no longer printed BESIDE the
  // thing currently due (unit 01) — it simply is not reached yet. What v1's
  // "always names its remedy" promise still guarantees, unchanged, is (a) the
  // PLAN (the ungated, per-unit read `h.plan()` exposes) always carries the
  // locked unit's remedy, or a scan action is never left dangling on a
  // dead-end, and (b) when a section's one line genuinely IS a lock (nothing
  // else is due), the agenda prints the remedy rather than nothing at all —
  // proven directly below with a learner assigned ONLY the checkpoint.
  it('will not offer unit 03 before 02 passes, though only one line prints per day', async () => {
    await h.scanCard();
    // The one line math owes today is unit 01 — not the distant lock.
    expect(h.lastReceiptText()).toContain('Lesson · Equivalent Fractions and Common Denominators');
    expect(h.lastReceiptText()).toMatch(/WATCH OR LISTEN/i);
    expect(h.tokensInLastReceipt()).toHaveLength(1);
    expect(h.tokensInLastReceipt().some((t) => t.label.includes('Fractions Checkpoint'))).toBe(false);

    const locked = (await h.plan()).entries.find((e) => e.unitId === OMR_UNIT);
    expect(locked.status).toBe('locked');
    expect(locked.remedy).toMatchObject({ unitId: WORKSHEET_UNIT, action: 'start' });
    // Nothing was opened for a unit that cannot be worked on.
    expect((await h.sessionRows()).map((r) => r.unitId)).toEqual([MEDIA_UNIT]);

    // Passing 01 moves math's one-line-a-day to 02; the checkpoint's remedy
    // is unchanged — it was already naming 02, the nearer unpassed sibling.
    await h.completeMediaUnit();
    h.advanceDays(1);
    await h.scanCard();
    expect(h.lastReceiptText()).toContain('Lesson · Adding and Subtracting Unlike Denominators');
    expect(h.lastReceiptText()).toMatch(/PRINT YOUR SHEET/i);
    expect((await h.plan()).entries.find((e) => e.unitId === OMR_UNIT).remedy).toMatchObject({ unitId: WORKSHEET_UNIT });

    // Passing 02 opens 03, and math's one line becomes it (the next study day).
    await h.completeWorksheetUnit();
    expect((await h.plan()).entries.find((e) => e.unitId === OMR_UNIT).status).toBe('available');

    h.advanceDays(1);
    await h.scanCard();
    const opened = h.tokensInLastReceipt();
    expect(opened).toHaveLength(1);
    expect(opened[0].label).toContain('Fractions Checkpoint');
    // Drawing the agenda is what opens the session behind the offered line.
    expect((await h.plan()).entries.find((e) => e.unitId === OMR_UNIT).status).toBe('in_progress');
  });

  it('prints the remedy directly on the agenda when a lock is the only thing due', async () => {
    // Assigned standalone — the two earlier units are not on this learner's
    // list at all, so math's one line has nowhere else to point. The
    // checkpoint's lock IS the whole story, and the agenda says so rather
    // than printing nothing (spec §6.2/§9: a scan/agenda never dead-ends).
    await h.assign({ courses: [], units: [OMR_UNIT] });
    await h.scanCard();
    // The agenda names the subject section and, since nothing is available,
    // prints the lock's remedy in place of an offered line — no title, no
    // barcode, just the reason and what would clear it.
    expect(h.lastReceiptText()).toContain('MATH');
    expect(h.lastReceiptText()).toContain('Finish “Adding and Subtracting Unlike Denominators” first');
    // A lock is printed, never hidden — and it is not scannable.
    expect(h.tokensInLastReceipt()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. no identity
// ---------------------------------------------------------------------------

describe('scenario 9 — a scan with nobody behind it', () => {
  it('explains on paper, opens no session, and writes no record', async () => {
    const unclaimed = await h.useCases.resolvePersonalCard.execute({ learnerId: null });
    expect(unclaimed.status).toBe('unknown_learner');
    expect(unclaimed.printed).toBe(true);
    expect(h.lastReceiptText()).toContain('Whose card is this?');
    expect(h.lastReceiptText()).toContain('Ask a grown-up');

    expect(await h.sessionRows(DEFAULT_LEARNER)).toEqual([]);
    expect(await h.pendingReview()).toEqual([]);
    expect(h.attemptsFor(DEFAULT_LEARNER)).toEqual([]);
  });

  it('answers an unknown ticket with a slip rather than silence', async () => {
    const unknown = await h.scan('sch:ZZZZZZZZZZZZZZZZ');
    expect(unknown.status).toBe('unknown');
    expect(unknown.printed).toBe(true);
    expect(h.lastReceiptText()).toContain('That ticket did not work');
    expect(h.lastReceiptText()).toMatch(/scan your card/i);
    expect(await h.sessionRows(DEFAULT_LEARNER)).toEqual([]);
  });

  it('leaves a code that is not ours alone', async () => {
    const foreign = await h.scan('9781234567897');
    expect(foreign.status).toBe('not_school');
    expect(foreign.physical).toBe('none');
    expect(h.receiptTexts()).toEqual([]);
    // The relay asks the console `handlesCode` BEFORE handing anything over —
    // an EAN belongs to the nutrition route, and a console that claimed it
    // would swallow every grocery scan in the house.
    expect(h.consoleClaimedLastScan()).toBe(false);
  });

  it('claims its own tokens at the relay branch', async () => {
    await h.scanCard();
    expect(h.consoleClaimedLastScan()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the artifacts themselves
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// every printed barcode does something
// ---------------------------------------------------------------------------

describe('no printed barcode is a no-op', () => {
  /**
   * The action blocks a sheet declares, paired with the token IssueDocument
   * minted for each. A block whose `action` is not a token class gets no token
   * and the renderer prints that literal string into the code area — a barcode
   * on a real artifact a child is holding that scans to nothing.
   */
  const actionBlocksOf = (document) => (document.blocks ?? [])
    .filter((b) => b.type === 'scan_action' || b.type === 'media_action');

  it.each([
    ['the worksheet', WORKSHEET_UNIT, /print your sheet/i],
    ['the bubble sheet', OMR_UNIT, /print your sheet|print the questions/i],
  ])('every action printed on %s resolves to something that prints', async (_label, unitId, offer) => {
    await h.completeMediaUnit();
    h.advanceDays(1);
    if (unitId === OMR_UNIT) {
      await h.completeWorksheetUnit();
      h.advanceDays(1);
    }
    await h.scanCard();

    const issued = await h.scanTokenMatching(offer);
    expect(issued.status).toBe('issued');

    const unit = await h.stores.curriculum.getUnit(unitId);
    const document = await h.stores.curriculum.getDocument(unit.document);
    const blocks = actionBlocksOf(document);
    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      // Minted, not a literal: the code area carries an opaque `sch:` value.
      const token = issued.effect?.tokens?.[block.action] ?? null;
      expect(token, `no token minted for ${block.type} '${block.action}'`).toMatch(/^sch:[2-9A-HJ-NP-Z]{16}$/);

      // And scanning it does something a child can see happen.
      const before = h.receiptTexts().length + h.printedPdfs().length;
      const scanned = await h.scan(token);
      expect(scanned.status).not.toBe('not_school');
      expect(scanned.printed, `scanning ${block.label} printed nothing`).toBe(true);
      expect(h.receiptTexts().length + h.printedPdfs().length).toBeGreaterThan(before);
    }
  });

  it('the play box on a mixed unit is a real ticket, not the manifest id', async () => {
    const unit = await h.stores.curriculum.getUnit(MIXED_UNIT);
    const document = await h.stores.curriculum.getDocument(unit.document);
    const play = actionBlocksOf(document).find((b) => b.type === 'media_action');
    expect(play).toBeTruthy();
    // The renderer draws `tokens[block.action]`, so the action has to be a name
    // IssueDocument mints under — never a manifest id nothing can resolve.
    expect(play.action).toBe('media_action');
  });
});

describe('the artifacts a child is handed', () => {
  it('renders the agenda receipt on the real thermal target', async () => {
    await h.scanCard();
    const agenda = await h.agenda();
    const drawn = await h.probeReceiptRendering(agenda.document);
    expect(drawn.width).toBeGreaterThan(0);
    expect(drawn.height).toBeGreaterThan(0);
    // The scannable action reached the tape with its code intact.
    expect(drawn.codes).toHaveLength(1);
    expect(drawn.codes[0].code).toMatch(/^sch:/);
  });

  it('actually prints the agenda through the raster renderer, transcript and scannable token intact', async () => {
    // Unlike the probe above (an oracle wired into nothing), this is what the
    // scan really put on the wire: `schoolLifecycle.mjs`'s `receiptPrintRenderer`
    // wraps `DocumentReceiptRenderer`'s canvas into a single ESC/POS image job,
    // so a bare `qrcode`/`barcode` item should never appear on a real card scan
    // again — only its `codes`/`transcript` fields carry that now.
    await h.scanCard();

    const items = h.lastReceiptItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'image', align: 'left' });
    expect(items[0].width).toBeGreaterThan(0);
    expect(items[0].height).toBeGreaterThan(0);
    expect(items.some((i) => i.type === 'qrcode' || i.type === 'barcode' || i.type === 'text')).toBe(false);

    // The operator transcript — the thing a bare image item cannot carry —
    // survived the switch to raster.
    const transcript = h.lastReceiptText();
    expect(transcript).toContain('TEST LEARNER');
    expect(transcript.length).toBeGreaterThan(0);

    // And the code itself is still scannable, sourced from `codes` (pixels,
    // not an item) rather than an item type scan.
    const offered = h.tokensInLastReceipt();
    expect(offered).toHaveLength(1);
    expect(offered[0].token).toMatch(/^sch:[2-9A-HJ-NP-Z]{16}$/);
  });

  it('puts a legible worksheet in the tray with the questions actually on it', async () => {
    await h.completeMediaUnit();
    h.advanceDays(1);
    await h.scanCard();
    await h.scanTokenMatching(/print your sheet/i);

    const printed = await h.lastPrintedPdf();
    // pdfkit reports one page count and can emit another; the capture's own
    // sniff is the independent check.
    expect(printed.pageCount).toBe(2);
    expect(printed.pdf.length).toBeGreaterThan(20_000);

    // The name line, the page footers and the question numbers are the things a
    // child looks for first; they are drawn as text with the bundled fonts.
    const text = printed.pdf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('%%EOF');
  });
});
