/**
 * CloseSessionOutcome — settle a piece of work (spec §5.4, §6.1, §7).
 *
 * One graded session in; one outcome, one receipt, and at most one payment out.
 *
 * THE REWARD GUARD IS SCHOOL'S OWN. `EconomyService.earn()`'s replay guard reads
 * a single UTC day's ledger shard, so the identical `ref` pays again tomorrow. A
 * close-out retried after midnight — a reconciliation job, a re-scan the next
 * morning, an HTTP retry — would therefore double-pay. The durable check is the
 * session's own `rewardTxn`, applied by `rewardDecision` before every policy
 * question; the economy's guard is defence in depth.
 *
 * WHY A SKIPPED REWARD STILL APPENDS `rewarded`. `outcome_recorded` is not
 * terminal: something has to close it, or a passed unit whose policy pays
 * nothing would sit "open" forever and keep showing up as work in flight. So the
 * event means "the reward question is settled", and `amount: 0` — with the
 * outcome id standing in as the ledger reference — is the unambiguous record
 * that nothing was paid. The receipt only ever mentions coins when some were.
 *
 * A failure to pay is NOT a failure to settle. If the economy refuses the call
 * (an install with no `school` earn action, say), the outcome stays recorded,
 * a `failed` annotation says why, and the child's receipt still prints. Coins
 * are the least important thing on that piece of paper.
 *
 * SIGN-OFF IS A CLAIM, SO IT CARRIES A NAME. `signedOff` releases a reward the
 * unit says a grown-up must approve, and it arrives as a boolean in a request
 * body — a child could once close their own session with `{signedOff: true}`
 * and pay themselves. The claim now names the person making it and is checked
 * against the household roster. Closing WITHOUT a sign-off needs nobody:
 * settling a result is not the privileged part, approving the coins is.
 *
 * SETTLING PRINTS. Building a result document and handing it back to a caller
 * was not enough: on a FAIL that document carries the retry ticket, and a retry
 * ticket that never leaves the printer is a loop the child cannot close — they
 * are told to try again with nothing in their hand to scan. `ResolveScanAction`
 * already prints its own receipts for exactly this reason; settling does the
 * same, so every caller (the router, a scan, a reconciliation job) puts the
 * result on paper without having to remember to. A printer that is absent or
 * refuses does NOT hold up the settlement — `printed: false` reports it.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { outcomeIdFor, evaluateOutcome, rewardDecision } from '#domains/school/sessions/outcome.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import { resultDocument, noticeDocument, reviewNoteLines } from '#domains/school/documents/receipts.mjs';
import { planLearnerWork } from '#domains/school/planner.mjs';

export class CloseSessionOutcome {
  #curriculum; #sessions; #tokens; #assignments; #economy; #economyAction; #economyEnabled;
  #receipts; #grownUps; #clock; #rng; #logger; #reviewQueue; #passOverrides;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {{earn: Function}} [deps.economy] - EconomyService
   * @param {string} [deps.economyAction] - the earn action configured for school work
   * @param {boolean} [deps.economyEnabled] - household switch; default OFF (spec A5)
   * @param {import('../ReceiptPrinting.mjs').ReceiptPrinting} [deps.receipts] - puts
   *   the result document on the roll. Optional so an install with no receipt
   *   printer still settles; every result then reports `printed: false`.
   * @param {import('../GrownUpGate.mjs').GrownUpGate} deps.grownUps - who may
   *   approve a reward; required, so the check cannot be omitted by wiring
   * @param {() => Date} [deps.clock]
   * @param {() => number} [deps.rng]
   * @param {import('../ports/IReviewQueue.mjs').IReviewQueue} [deps.reviewQueue] - read to
   *   surface a grown-up's resolved-item notes on the result receipt (spec
   *   R7). Optional: absent, the receipt simply carries no "Notes for you"
   *   section, same as a household with no review queue wired at all.
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, sessions, tokens, assignments,
    economy = null, economyAction = 'school-unit-complete', economyEnabled = false,
    receipts = null, grownUps = null, clock = () => new Date(), rng = Math.random,
    reviewQueue = null,
    // Optional pass-criteria override store (teacher-console W3-2):
    // `{percentFor(unitId)}` — an override wins over the authored percent.
    passOverrides = null,
    logger = console,
  } = {}) {
    if (!curriculum || !sessions || !tokens || !assignments) {
      throw new Error('CloseSessionOutcome requires curriculum, sessions, tokens and assignments');
    }
    if (!grownUps) throw new Error('CloseSessionOutcome requires grownUps (a GrownUpGate)');
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#tokens = tokens;
    this.#assignments = assignments;
    this.#economy = economy;
    this.#economyAction = economyAction;
    this.#economyEnabled = economyEnabled;
    this.#receipts = receipts;
    this.#grownUps = grownUps;
    this.#clock = clock;
    this.#rng = rng;
    this.#reviewQueue = reviewQueue;
    this.#passOverrides = passOverrides;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @param {boolean} [args.honorClose] - the launch-unit completion door (spec
   *   §6.2): legal ONLY when the session is exactly at `launch_dispatched`,
   *   where it records a pass with `reason: 'launch_dispatched'` instead of
   *   deriving a result from a grade. From any other state it is refused with
   *   the same `unavailable` a regular close would give — the door does not
   *   let a `graded` or mid-flight session skip evaluation.
   * @param {boolean} [args.signedOff] - a grown-up has approved the reward
   * @param {string} [args.signedOffBy] - the roster id of that grown-up;
   *   required (and checked) whenever `signedOff` is true
   * @returns {Promise<{ status: 'settled'|'already_settled'|'unavailable',
   *                     sessionId: string, outcomeId: string|null,
   *                     result: string|null, percent: number|null,
   *                     reward: {amount: number, txnId: string|null, skipReason: string|null}|null,
   *                     unlocked: {unitId: string, title: string}|null,
   *                     retryToken: string|null, document: object|null, message: string,
   *                     printed: boolean, printReason: string|null }>}
   *   `printed` is whether the result document actually reached the roll — a
   *   false here on a FAIL means the retry ticket is not in the child's hand.
   */
  async execute({ sessionId, honorClose = false, signedOff = false, signedOffBy = null } = {}) {
    if (signedOff === true) {
      this.#grownUps.assert(signedOffBy, 'Only a grown-up can sign off a reward', {
        action: 'close.signoff', sessionId,
      });
    }

    const nowIso = this.#clock().toISOString();
    const state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!state.sessionId) return this.#unavailable(sessionId, 'We could not find that work.');

    const unit = await this.#curriculum.getUnit(state.unitId);

    if (state.outcome) {
      // A second close-out is a retry, not a second result. It re-prints and —
      // crucially — still routes through the reward step, whose own guard sees
      // the existing txn and skips.
      return this.#settle({ sessionId, state, unit, outcome: state.outcome, signedOff, nowIso, resettling: true });
    }

    if (honorClose) {
      // THE DOOR, NOT A BYPASS (spec §6.2). A `launch:` unit's whole ask is the
      // dispatch itself — there is no grade to derive a result from, so this is
      // the ONE place a result is asserted rather than evaluated. Guarded to the
      // single state it can mean anything in: everywhere else `honorClose`
      // changes nothing, and the caller gets the exact refusal a plain close
      // would give — a `graded` (or earlier) session can never be waved through
      // unevaluated just by naming the flag.
      if (state.state !== 'launch_dispatched') {
        return this.#unavailable(sessionId, 'That work has not been marked yet.');
      }
      return this.#recordOutcomeAndSettle({
        sessionId, state, unit, nowIso, signedOff, result: 'passed', reason: 'launch_dispatched',
      });
    }

    if (state.state !== 'graded') {
      return this.#unavailable(sessionId, 'That work has not been marked yet.');
    }

    // `requiresSignoff` is deliberately NOT taken from the unit's REWARD policy
    // here. A reward waiting on a parent must not also hold the pass back —
    // that would leave the next unit locked behind a coin. Sign-off gates the
    // payment (in `rewardDecision`), not the result.
    const evaluated = evaluateOutcome({
      gradedPercent: state.gradedPercent,
      // The bar stamped AT GRADING wins (advocacy A4); the live override /
      // authored percent is only the fallback for pre-stamp sessions.
      passingPercent: state.gradedPassingPercent
        ?? this.#passOverrides?.percentFor?.(unit?.unitId) ?? unit?.passing?.percent,
    });
    return this.#recordOutcomeAndSettle({
      sessionId, state, unit, nowIso, signedOff, result: evaluated.result, reason: evaluated.reason,
    });
  }

  /**
   * Append the `outcome_recorded` event and ride the shared `#settle` — the
   * one path a graded close and an honor-close both funnel through, so the
   * reward guard, unlock line and result receipt stay uniform between them.
   */
  async #recordOutcomeAndSettle({ sessionId, state, unit, nowIso, signedOff, result, reason }) {
    const outcomeId = outcomeIdFor(sessionId);
    const { errors, event } = createEvent({
      type: 'outcome_recorded', at: nowIso, sessionId, outcomeId, result, reason,
    });
    if (errors.length) throw new Error(`CloseSessionOutcome: could not record the outcome: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);
    this.#logger.info?.('school.outcome.recorded', {
      sessionId, unitId: state.unitId, result, reason, percent: state.gradedPercent,
    });

    const outcome = { outcomeId, result, at: nowIso };
    return this.#settle({ sessionId, state, unit, outcome, signedOff, nowIso, resettling: false });
  }

  async #settle({ sessionId, state, unit, outcome, signedOff, nowIso, resettling }) {
    const passed = outcome.result === 'passed';
    const reward = passed
      ? await this.#applyReward({ sessionId, state, unit, outcome, signedOff, nowIso })
      : null;

    const retryToken = passed ? null : await this.#mintRetryToken({ sessionId, state, nowIso });
    const unlocked = passed ? await this.#nextUnlocked({ state, unit, nowIso }) : null;

    const actions = [];
    if (retryToken) actions.push({ token: retryToken, label: 'Try again with a fresh sheet' });

    const notes = await this.#collectNotes(sessionId);
    const document = resultDocument({
      sessionId,
      unitTitle: unit?.title ?? state.unitId,
      result: outcome.result,
      percent: state.gradedPercent,
      passingPercent: state.gradedPassingPercent ?? unit?.passing?.percent ?? null,
      objectives: unit?.objectives ?? [],
      actions,
      reward: reward && reward.amount > 0 ? { amount: reward.amount } : null,
      rewardSkipReason: reward?.skipReason ?? null,
      unlockedTitle: unlocked?.title ?? null,
      notes,
    });

    return {
      status: resettling ? 'already_settled' : 'settled',
      sessionId,
      outcomeId: outcome.outcomeId,
      result: outcome.result,
      percent: state.gradedPercent,
      reward,
      unlocked,
      retryToken,
      message: passed ? 'Nice work!' : 'Almost there — try again.',
      document,
      ...(await this.#printed(document)),
    };
  }

  /**
   * A grown-up's written feedback on THIS session's review items, formatted
   * for the result receipt (spec R7) — never more than a handful of lines,
   * and never something a missing/failing review queue should block the
   * settlement over.
   */
  async #collectNotes(sessionId) {
    if (!this.#reviewQueue) return [];
    try {
      return reviewNoteLines(await this.#reviewQueue.listForSession(sessionId));
    } catch (err) {
      this.#logger.warn?.('school.outcome.notes-failed', { sessionId, error: err.message });
      return [];
    }
  }

  /**
   * Put a result document on the roll. Never throws and never blocks the
   * settlement: `ReceiptPrinting` already resolves `{printed:false}` for a
   * printer that is missing, jammed or unplugged, and a settled outcome must
   * not be undone by a paper problem.
   */
  async #printed(document) {
    if (!this.#receipts) return { printed: false, printReason: 'not_wired' };
    const outcome = await this.#receipts.print(document);
    if (!outcome.printed) {
      this.#logger.warn?.('school.outcome.receipt-unprinted', { id: document?.id ?? null, reason: outcome.reason });
    }
    return { printed: outcome.printed, printReason: outcome.reason };
  }

  /**
   * Pay, or record deliberately not paying. Either way the reward question ends
   * settled and the session reaches a terminal state.
   */
  async #applyReward({ sessionId, state, unit, outcome, signedOff, nowIso }) {
    if (state.rewardTxn) {
      return { amount: 0, txnId: state.rewardTxn, skipReason: 'already_rewarded' };
    }

    const decision = rewardDecision({
      outcome: { outcomeId: outcome.outcomeId, result: outcome.result, signedOff },
      unitReward: unit?.reward,
      existingRewardTxn: state.rewardTxn,
      economyEnabled: this.#economyEnabled && Boolean(this.#economy),
    });

    if (!decision.award) {
      // Sign-off is the one skip that must NOT close the session: a parent has
      // yet to make the decision, so closing it would settle a question nobody
      // answered. Everything else is settled by definition.
      if (decision.skipReason === 'awaiting_signoff') {
        this.#logger.info?.('school.reward.awaiting-signoff', { sessionId, unitId: state.unitId });
        return { amount: 0, txnId: null, skipReason: 'awaiting_signoff' };
      }
      await this.#recordRewarded({ sessionId, nowIso, txnId: outcome.outcomeId, amount: 0 });
      return { amount: 0, txnId: null, skipReason: decision.skipReason };
    }

    let earned;
    try {
      earned = await this.#economy.earn(state.learnerId, {
        action: this.#economyAction,
        source: 'school',
        ref: decision.ref,
        // What the UNIT says this piece of work is worth. `rewardDecision`
        // already read it off the curriculum and floored it to whole coins;
        // dropping it here paid every unit the earn action's flat rate, so a
        // milestone checkpoint worth 15 quietly settled for 5 and the
        // `reward.amount:` field in the unit schema did nothing at all.
        amount: decision.amount,
      });
    } catch (err) {
      // The outcome stands. Coins are the least important thing on the receipt.
      const { event } = createEvent({ type: 'failed', at: nowIso, sessionId, stage: 'reward', reason: err.message });
      if (event) await this.#sessions.appendEvent(sessionId, event);
      this.#logger.warn?.('school.reward.failed', { sessionId, action: this.#economyAction, error: err.message });
      return { amount: 0, txnId: null, skipReason: 'economy_error' };
    }

    const txnId = earned?.txnId ?? outcome.outcomeId;
    const amount = earned?.earned ?? 0;
    await this.#recordRewarded({ sessionId, nowIso, txnId, amount });
    this.#logger.info?.('school.reward.awarded', { sessionId, unitId: state.unitId, amount, txnId, ref: decision.ref });
    return { amount, txnId, skipReason: null };
  }

  async #recordRewarded({ sessionId, nowIso, txnId, amount }) {
    const { errors, event } = createEvent({ type: 'rewarded', at: nowIso, sessionId, txnId, amount });
    if (errors.length) {
      this.#logger.warn?.('school.reward.unrecordable', { sessionId, errors });
      return;
    }
    await this.#sessions.appendEvent(sessionId, event);
  }

  /** The retry ticket printed on a failed result receipt. */
  async #mintRetryToken({ sessionId, state, nowIso }) {
    if (state.remediation) return null; // already opened; the new session has its own paper
    try {
      const record = mintToken({ tokenClass: 'remediation', subject: { sessionId }, at: nowIso, rng: this.#rng });
      await this.#tokens.put(record);
      return record.token;
    } catch (err) {
      this.#logger.warn?.('school.outcome.retry-token-failed', { sessionId, error: err.message });
      return null;
    }
  }

  /**
   * What this pass just opened up. Reported rather than tokenised: the next
   * unit's session belongs to the agenda, which is the one place work sessions
   * are created (§6.3). The receipt names it and says to scan the card.
   */
  async #nextUnlocked({ state, unit, nowIso }) {
    if (!unit?.courseId) return null;
    const [assignment, units, history] = await Promise.all([
      this.#assignments.get(state.learnerId),
      this.#curriculum.listUnits(),
      this.#sessions.listForLearner(state.learnerId),
    ]);
    const plan = planLearnerWork({ learnerId: state.learnerId, assignment, units, sessions: history, now: nowIso });
    const nextId = plan.entries.find((e) => e.unitId === unit.unitId)?.unlocks ?? null;
    if (!nextId) return null;
    const next = plan.entries.find((e) => e.unitId === nextId);
    // Only report it as unlocked if it actually is: a unit still gated by
    // something else must not be promised on a receipt.
    if (!next || next.status === 'locked') return null;
    return { unitId: next.unitId, title: next.title };
  }

  async #unavailable(sessionId, line) {
    const document = noticeDocument({
      id: `outcome-${sessionId ?? 'none'}`,
      headline: 'Nothing to settle yet',
      lines: [line, 'Scan your card to see what is next.'],
    });
    return {
      status: 'unavailable',
      sessionId: sessionId ?? null,
      outcomeId: null,
      result: null,
      percent: null,
      reward: null,
      unlocked: null,
      retryToken: null,
      message: line,
      document,
      ...(await this.#printed(document)),
    };
  }
}

export default CloseSessionOutcome;
