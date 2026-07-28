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
 * @param {object}  args
 * @param {number}  args.gradedPercent   score from the graded event (0-100)
 * @param {number}  args.passingPercent  the unit's passing rule (inclusive)
 * @param {boolean} [args.requiresSignoff]
 * @param {boolean} [args.signedOff]
 * @returns {{ result: 'passed'|'needs_remediation', reason: string }}
 */
export function evaluateOutcome({ gradedPercent, passingPercent, requiresSignoff = false, signedOff = false } = {}) {
  const fail = (reason) => ({ result: 'needs_remediation', reason });
  if (!isPercent(gradedPercent)) return fail('not_graded');
  // A unit with no passing rule cannot auto-pass: the bar is what makes a score
  // mean anything, and inventing one (">= 100"? ">= 0"?) would silently decide
  // policy the curriculum deliberately left to a person.
  if (!isPercent(passingPercent)) return fail('no_passing_policy');
  if (gradedPercent < passingPercent) return fail('below_passing');
  if (requiresSignoff && !signedOff) return fail('awaiting_signoff');
  return { result: 'passed', reason: 'met_passing' };
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
