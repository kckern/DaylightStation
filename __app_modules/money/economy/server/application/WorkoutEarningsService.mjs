/**
 * What one workout was worth, and where the week stands — read-only.
 *
 * The bank trails a workout by up to ~90 min (PayoutService mints a ring step
 * only once its session is final, on the hourly reconcile), so a post-workout
 * ceremony cannot read the ledger for "what did I just earn". It prices the
 * ride the way the payout will: the ring line's sessions in end order, this
 * one counted even before it is final, each step at the week's running total
 * (`ringAmount`). The total is the wallet plus the ring silver still owed, so
 * it is what the bank will hold once the payouts land.
 */
import { ringAmount } from "../domain/earnings/index.mjs";
import { PAID_KINDS } from "../domain/index.mjs";

const ringLineOf = (learner) => (learner?.lines ?? []).find((l) => l?.kind === 'ring-threshold') ?? null;
const contestLineOf = (learner) => (learner?.lines ?? []).find((l) => l?.kind === 'ring-contest') ?? null;
const endOf = (s) => s.endMs ?? s.startMs ?? 0;

/** Rings to the next silver step (rate or threshold) from `rings`, or null when unpriced. */
function ringsToNextCoin(priced, rings) {
  const now = ringAmount(priced, rings).silver;
  const per = priced?.rate?.rings;
  const candidates = [];
  if (Number.isFinite(per) && per > 0 && priced.rate.silver > 0) candidates.push((Math.floor(rings / per) + 1) * per);
  for (const t of priced?.thresholds ?? []) if (t.at > rings && t.reward?.silver > 0) candidates.push(t.at);
  const next = candidates.sort((a, b) => a - b).find((at) => ringAmount(priced, at).silver > now);
  return next == null ? null : next - rings;
}

/**
 * A fitness session has two spellings: the live client's `fs_20261029193815`
 * and the saved file's bare `20261029193815` (which the ring line carries).
 * Compare on the bare form so either one finds the ride.
 */
export function normalizeWorkoutSessionId(sessionId) {
  const id = String(sessionId ?? '').trim();
  return id.startsWith('fs_') ? id.slice(3) : id;
}

export function workoutGain(line, sessionId) {
  if (!line?.priced || !Array.isArray(line.sessions)) return null;
  const sessions = line.sessions.filter((s) => Number.isFinite(s?.rings) && s.rings > 0).sort((a, b) => endOf(a) - endOf(b));
  const want = normalizeWorkoutSessionId(sessionId);
  const at = sessions.findIndex((s) => normalizeWorkoutSessionId(s.sessionId) === want);
  if (at < 0) return null;
  const before = sessions.slice(0, at).reduce((sum, s) => sum + s.rings, 0);
  const through = before + sessions[at].rings;
  const a = ringAmount(line.priced, before);
  const b = ringAmount(line.priced, through);
  const gained = { silver: b.silver - a.silver, gems: b.gems - a.gems };
  return { rings: sessions[at].rings, gained, nextCoinIn: gained.silver > 0 ? null : ringsToNextCoin(line.priced, through) };
}

export class WorkoutEarningsService {
  #preview; #economy; #config; #logger;

  constructor({ preview, economy, config, logger = console }) {
    if (!preview?.roster) throw new Error('WorkoutEarningsService requires preview');
    if (!economy?.peekBalance || !economy?.getHistory) throw new Error('WorkoutEarningsService requires economy');
    if (!config?.catalog) throw new Error('WorkoutEarningsService requires config');
    this.#preview = preview; this.#economy = economy; this.#config = config; this.#logger = logger;
  }

  #isUser(id) { return typeof this.#economy.hasUser !== 'function' || this.#economy.hasUser(id); }

  async #paidSilver(learnerId, ref) {
    let paid = 0;
    for (const t of await this.#economy.getHistory(learnerId)) {
      if (t.ref === ref && PAID_KINDS.has(t.kind) && (t.currency ?? 'silver') === 'silver') paid += t.delta || 0;
    }
    return paid;
  }

  async workout(sessionId) {
    const t0 = Date.now();
    const mode = this.#config.catalog().mode;
    if (mode === 'off') return { sessionId, mode, learners: [] };
    const roster = await this.#preview.roster({ week: null });
    const learners = [];
    for (const learner of roster?.learners ?? []) {
      const line = ringLineOf(learner);
      const gain = workoutGain(line, sessionId);
      if (!gain || !this.#isUser(learner.learnerId)) continue;
      try {
        const wallet = await this.#economy.peekBalance(learner.learnerId);
        const owed = Math.max(0, (line.amount?.silver ?? 0) - await this.#paidSilver(learner.learnerId, line.ref));
        learners.push({
          learnerId: learner.learnerId, learnerName: learner.learnerName ?? learner.learnerId,
          rings: gain.rings, gained: gain.gained, total: { silver: (wallet?.silver ?? 0) + owed }, nextCoinIn: gain.nextCoinIn,
        });
      } catch (err) {
        this.#logger.warn?.('economy.workout-earnings.learner-failed', { sessionId, learnerId: learner.learnerId, error: err?.message ?? String(err) });
      }
    }
    this.#logger.info?.('economy.workout-earnings.query', { sessionId, learners: learners.length, totalMs: Date.now() - t0 });
    return { sessionId, mode, learners };
  }

  async standings() {
    const mode = this.#config.catalog().mode;
    if (mode === 'off') return { mode, contestClosed: false, learners: [] };
    const roster = await this.#preview.roster({ week: null });
    const learners = [];
    for (const learner of roster?.learners ?? []) {
      if (!this.#isUser(learner.learnerId)) continue;
      try {
        const wallet = await this.#economy.peekBalance(learner.learnerId);
        const contest = contestLineOf(learner);
        const gem = contest?.status === 'earned' ? 'won' : (contest?.leader === true ? 'leading' : null);
        learners.push({ learnerId: learner.learnerId, learnerName: learner.learnerName ?? learner.learnerId, silver: wallet?.silver ?? 0, weekRings: ringLineOf(learner)?.count ?? 0, gem });
      } catch (err) {
        this.#logger.warn?.('economy.standings.learner-failed', { learnerId: learner.learnerId, error: err?.message ?? String(err) });
      }
    }
    return { mode, contestClosed: Boolean(roster?.contestClosed), learners };
  }
}

export default WorkoutEarningsService;
