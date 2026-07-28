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
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { outcomeIdFor, evaluateOutcome, rewardDecision } from '#domains/school/sessions/outcome.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import { resultDocument, noticeDocument } from '#domains/school/documents/receipts.mjs';
import { planLearnerWork } from '#domains/school/planner.mjs';

export class CloseSessionOutcome {
  #curriculum; #sessions; #tokens; #assignments; #economy; #economyAction; #economyEnabled;
  #clock; #rng; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {{earn: Function}} [deps.economy] - EconomyService
   * @param {string} [deps.economyAction] - the earn action configured for school work
   * @param {boolean} [deps.economyEnabled] - household switch; default OFF (spec A5)
   * @param {() => Date} [deps.clock]
   * @param {() => number} [deps.rng]
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, sessions, tokens, assignments,
    economy = null, economyAction = 'school-unit-complete', economyEnabled = false,
    clock = () => new Date(), rng = Math.random, logger = console,
  } = {}) {
    if (!curriculum || !sessions || !tokens || !assignments) {
      throw new Error('CloseSessionOutcome requires curriculum, sessions, tokens and assignments');
    }
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#tokens = tokens;
    this.#assignments = assignments;
    this.#economy = economy;
    this.#economyAction = economyAction;
    this.#economyEnabled = economyEnabled;
    this.#clock = clock;
    this.#rng = rng;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @param {boolean} [args.signedOff] - a grown-up has approved the reward
   * @returns {Promise<{ status: 'settled'|'already_settled'|'unavailable',
   *                     sessionId: string, outcomeId: string|null,
   *                     result: string|null, percent: number|null,
   *                     reward: {amount: number, txnId: string|null, skipReason: string|null}|null,
   *                     unlocked: {unitId: string, title: string}|null,
   *                     retryToken: string|null, document: object|null, message: string }>}
   */
  async execute({ sessionId, signedOff = false } = {}) {
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
    if (state.state !== 'graded') {
      return this.#unavailable(sessionId, 'That work has not been marked yet.');
    }

    // `requiresSignoff` is deliberately NOT taken from the unit's REWARD policy
    // here. A reward waiting on a parent must not also hold the pass back —
    // that would leave the next unit locked behind a coin. Sign-off gates the
    // payment (in `rewardDecision`), not the result.
    const evaluated = evaluateOutcome({
      gradedPercent: state.gradedPercent,
      passingPercent: unit?.passing?.percent,
    });
    const outcomeId = outcomeIdFor(sessionId);
    const { errors, event } = createEvent({
      type: 'outcome_recorded', at: nowIso, sessionId,
      outcomeId, result: evaluated.result, reason: evaluated.reason,
    });
    if (errors.length) throw new Error(`CloseSessionOutcome: could not record the outcome: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);
    this.#logger.info?.('school.outcome.recorded', {
      sessionId, unitId: state.unitId, result: evaluated.result, reason: evaluated.reason, percent: state.gradedPercent,
    });

    const outcome = { outcomeId, result: evaluated.result, at: nowIso };
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
      document: resultDocument({
        sessionId,
        unitTitle: unit?.title ?? state.unitId,
        result: outcome.result,
        percent: state.gradedPercent,
        objectives: unit?.objectives ?? [],
        actions,
        reward: reward && reward.amount > 0 ? { amount: reward.amount } : null,
        unlockedTitle: unlocked?.title ?? null,
      }),
    };
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

  #unavailable(sessionId, line) {
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
      document: noticeDocument({
        id: `outcome-${sessionId ?? 'none'}`,
        headline: 'Nothing to settle yet',
        lines: [line, 'Scan your card to see what is next.'],
      }),
    };
  }
}

export default CloseSessionOutcome;
