/**
 * Outcome evaluation and reward idempotency (spec §5.4). Pure: no I/O, no clock.
 *
 * A terminal work session emits exactly one OUTCOME with a deterministic id,
 * `out:{sessionId}`. That id is the whole point: it is the stable thing a reward
 * hangs off, so coins are a consequence of a settled result rather than of a
 * scan, a reprint, or a retried HTTP call.
 *
 * Two decisions live here and nowhere else:
 *   - `evaluateOutcome` — did this work pass? (score rule + parent sign-off)
 *   - `rewardDecision`  — should it pay, and how much?
 *
 * Both are total: a missing argument yields the conservative answer (not passed,
 * no award) instead of an exception.
 */

const OUTCOME_PREFIX = 'out:';

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPercent = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

/**
 * The deterministic outcome id — and the `ref` passed to `EconomyService.earn()`.
 *
 * Idempotent in its own right: handed an id that is already an outcome id it
 * returns it unchanged, so a caller that has the outcome rather than the session
 * cannot mint `out:out:ses_x` and split one result across two refs.
 *
 * @param {string} sessionId
 * @returns {string|null} null when there is no session to identify
 */
export function outcomeIdFor(sessionId) {
  if (!isNonEmptyString(sessionId)) return null;
  return sessionId.startsWith(OUTCOME_PREFIX) ? sessionId : `${OUTCOME_PREFIX}${sessionId}`;
}

/**
 * Decide a session's result from its grade and the unit's policy.
 *
 * A required sign-off that has not happened is NOT a pass — it is "not yet".
 * The reason code says which, because the printed receipt and the parent queue
 * render differently for "try again" than for "waiting on a grown-up".
 *
 * THE COMPANION GATE IS A VETO, NOT A SCORE (Task 10). A lesson with a
 * required companion prints a finish-code row; a sheet whose row is blank or
 * wrong cannot pass however well it scored. It is checked here, at the one
 * place a pass is decided, and it is deliberately OUTSIDE the percent: mixing
 * them makes the failure illegible, because a child who scored 7/10 and a
 * child who scored 10/10 but skipped the audio have different problems and one
 * percentage cannot tell them apart. So the gate can only ever block a sheet
 * that already cleared the bar; it never subtracts from one that did not.
 *
 * AND IT IS CHECKED AFTER THE SCORE, ON PURPOSE. A sheet that failed on
 * questions AND has a blank gate reports `below_passing`: that child owes a
 * retry either way, and the retry prints a fresh gate row with it. Leading
 * with the companion there would send them off to play audio for a sheet they
 * have to do again regardless. The gate reason therefore only ever appears on
 * a sheet whose answers were good enough — which is exactly when it is the
 * one thing standing in the way, and the only time it is worth saying.
 *
 * @param {object}  args
 * @param {number}  args.gradedPercent   score from the graded event (0-100)
 * @param {number}  args.passingPercent  the unit's passing rule (inclusive)
 * @param {{status: string}|null} [args.companionGate] - the scan's verdict on
 *   the finish-code row (`sessionEvents.mjs`'s `graded` event). `null`/absent
 *   is an UNGATED sheet — every worksheet without a required companion — and
 *   changes nothing. PRESENT means this sheet has a gate, and then only
 *   `satisfied` clears it: a status this function cannot read fails closed,
 *   because a gate it does not understand is not a gate it may wave through.
 * @param {boolean} [args.requiresSignoff]
 * @param {boolean} [args.signedOff]
 * @returns {{ result: 'passed'|'needs_remediation', reason: string }}
 */
export function evaluateOutcome({
  gradedPercent, passingPercent, companionGate = null, requiresSignoff = false, signedOff = false,
} = {}) {
  const fail = (reason) => ({ result: 'needs_remediation', reason });
  if (!isPercent(gradedPercent)) return fail('not_graded');
  // A unit with no passing rule cannot auto-pass: the bar is what makes a score
  // mean anything, and inventing one (">= 100"? ">= 0"?) would silently decide
  // policy the curriculum deliberately left to a person.
  if (!isPercent(passingPercent)) return fail('no_passing_policy');
  if (gradedPercent < passingPercent) return fail('below_passing');
  // PRESENCE is the question, not readability: a caller that hands over a
  // gate object at all is saying this sheet HAS a gate, so only `satisfied`
  // clears it. An unreadable status — a typo, a shape from a future version —
  // therefore blocks rather than waves through, which is the safe direction:
  // the cost is one sheet a grown-up has to look at, against a required
  // read-along nobody ever did.
  if (companionGate != null) {
    // Two reasons, not one: the child-facing instruction differs. A blank row
    // means "go and do it"; a wrong one means "you did it — check the letters".
    if (companionGate.status === 'wrong') return fail('companion_code_wrong');
    if (companionGate.status !== 'satisfied') return fail('companion_incomplete');
  }
  if (requiresSignoff && !signedOff) return fail('awaiting_signoff');
  return { result: 'passed', reason: 'met_passing' };
}

/**
 * Did the companion gate — rather than the score — decide this result?
 *
 * Exists so the close-out does not have to keep its own copy of the two reason
 * strings above in order to answer the questions that follow from them: does
 * this child get a retry ticket for a fresh worksheet (no — their answers were
 * fine), and what does the receipt tell them to do next.
 *
 * @param {string|null} reason - an `evaluateOutcome` reason code
 * @returns {'blank'|'wrong'|null} the gate status that vetoed, or null
 */
export function companionVetoStatus(reason) {
  if (reason === 'companion_incomplete') return 'blank';
  if (reason === 'companion_code_wrong') return 'wrong';
  return null;
}

/**
 * Decide whether this outcome pays, and how much.
 *
 * @param {object}  args
 * @param {object}  args.outcome            `{ outcomeId | sessionId, result, signedOff }`
 * @param {object}  args.unitReward         the unit's `reward:` block `{ amount, requiresSignoff }`
 * @param {string}  args.existingRewardTxn  transaction id already on the session, if any
 * @param {boolean} args.economyEnabled     household economy switch (default off, per spec A5)
 * @returns {{ award: boolean, amount: number, ref: string|null, skipReason: string|null }}
 */
export function rewardDecision({ outcome, unitReward, existingRewardTxn = null, economyEnabled = false } = {}) {
  const ref = outcome?.outcomeId ?? outcomeIdFor(outcome?.sessionId) ?? null;
  const skip = (skipReason) => ({ award: false, amount: 0, ref, skipReason });

  // FIRST, ahead of every other consideration. EconomyService.earn()'s replay
  // guard filters `this.#ds.readLedgerDay(userId, today)` — one UTC day's ledger
  // shard — so the identical ref pays again tomorrow. Any replay that crosses
  // midnight (a re-scan the next morning, a retried close-out, a reconciliation
  // job) would double-pay if this check sat behind the policy checks and a
  // policy edit had since changed the answer. School's own durable record is
  // therefore the real guard; the economy's is defence-in-depth.
  if (existingRewardTxn != null && existingRewardTxn !== '') return skip('already_rewarded');

  if (!economyEnabled) return skip('economy_disabled');
  if (outcome?.result !== 'passed') return skip('outcome_not_passed');

  // Whole coins only — the ledger has no fractional denomination, and rounding
  // up would pay a unit that declared less than a coin's worth of reward.
  const declared = unitReward?.amount;
  const amount = typeof declared === 'number' && Number.isFinite(declared) ? Math.floor(declared) : 0;
  if (amount < 1) return skip('no_reward_policy');

  if (unitReward?.requiresSignoff && !outcome?.signedOff) return skip('awaiting_signoff');

  // Daily caps are deliberately NOT applied here: `EconomyService.earn()` owns
  // `daily_cap` accounting against the real ledger, which this pure function
  // cannot see. Duplicating it would let the two disagree.
  return { award: true, amount, ref, skipReason: null };
}
