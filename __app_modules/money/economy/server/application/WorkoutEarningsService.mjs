/**
 * What one workout was worth, and where the week stands — read-only.
 *
 * Two reads, kept apart:
 *   `workout()`  the PROJECTION: the ride priced the way the payout will, at the
 *                week's running total. For previews; never a ceremony's source.
 *   `paid()`     the PAYOUT: the ring entries (silver, and gems the same step
 *                minted) the bank has actually minted for the ride. A ceremony
 *                celebrates only what this returns.
 */
import { ringAmount, AREA_ORDER, GEM_AREAS } from "../domain/earnings/index.mjs";
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
  #preview; #economy; #config; #gemBoard; #logger; #participants;

  /**
   * @param {object} deps
   * @param {(sessionId: string) => Promise<string[]|null>} [deps.participants] - who rode a
   *   session, from the saved session record; when it answers, only those learners are priced.
   * @param {{board: Function}} [deps.gemBoard] - GemBoardService; without it the standings carry no gems.
   */
  constructor({ preview, economy, config, participants = null, gemBoard = null, logger = console }) {
    if (!preview?.roster) throw new Error('WorkoutEarningsService requires preview');
    if (!economy?.peekBalance || !economy?.getHistory) throw new Error('WorkoutEarningsService requires economy');
    if (!config?.catalog) throw new Error('WorkoutEarningsService requires config');
    this.#preview = preview; this.#economy = economy; this.#config = config; this.#participants = participants; this.#gemBoard = gemBoard; this.#logger = logger;
  }

  /**
   * The gems each learner HOLDS this week, rolled up by area, as
   * `(learnerId) => [{area, held, color}]` in AREA_ORDER. held = earned, plus a
   * contest gem while leading: what the board draws solid, and what its total
   * counts. A cell without `held` (an older board) falls back to its `week`.
   * Only areas holding something: a running day-count or a zero is not a gem.
   * `color` is the area's own (GEM_AREAS), so no client keeps a copy of it.
   * Read off the board itself, so a home card and the board cannot disagree.
   * A board that cannot be read leaves every list empty. `roster` is the
   * standings' own priced week, folded by the board rather than priced twice.
   */
  async #heldGems(roster) {
    if (!this.#gemBoard?.board) return () => [];
    try {
      const board = await this.#gemBoard.board({ week: null, roster });
      const rows = board?.categories ?? [];
      return (learnerId) => {
        const by = new Map();
        for (const row of rows) {
          const area = row.area ?? row.group;
          const cell = board.cells?.[row.id]?.[learnerId];
          const n = Number(cell?.held ?? cell?.week) || 0;
          if (n > 0) by.set(area, (by.get(area) ?? 0) + n);
        }
        return AREA_ORDER.filter((area) => by.get(area) > 0).map((area) => ({ area, held: by.get(area), color: GEM_AREAS[area].color }));
      };
    } catch (err) {
      this.#logger.warn?.('economy.standings.gems-unavailable', { error: err?.message ?? String(err) });
      return () => [];
    }
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

  /**
   * What the bank actually PAID for one workout: the ring-payout entries in
   * each learner's ledger whose `meta.session.id` is this ride. Read-only, and
   * the ceremony's truth: a promise (`workout()`) is not a payout.
   * @returns {Promise<{sessionId: string, mode: string, learners: Array<{learnerId: string, learnerName: string, entries: Array<{txnId: string, silver: number, gems: number, at: string, rings: number|null}>, wallet: {silver: number}}>}>}
   */
  async paid(sessionId) {
    const mode = this.#config.catalog().mode;
    if (mode === 'off') return { sessionId, mode, learners: [] };
    const want = normalizeWorkoutSessionId(sessionId);
    // Who rode comes from the session record; pricing the whole roster is the fallback.
    let riders = null;
    try {
      const ids = await this.#participants?.(sessionId);
      if (Array.isArray(ids) && ids.length) riders = ids.map(String);
    } catch (err) {
      this.#logger.warn?.('economy.workout-paid.participants-failed', { sessionId, error: err?.message ?? String(err) });
    }
    const priceWeek = async (week) => {
      if (!riders) return this.#preview.roster({ week });
      const priced = await Promise.all(riders.map(async (learnerId) => {
        try { return await this.#preview.preview({ learnerId, week }); } catch { return null; }
      }));
      return { today: this.#preview.currentStudyDay?.() ?? null, learners: priced.filter(Boolean) };
    };
    // The ride's own award week: this one, or (a ride that started before the
    // Monday rollover and turned final after it) the one before.
    const hasRide = (r) => (r?.learners ?? []).some((l) => (ringLineOf(l)?.sessions ?? []).some((s) => normalizeWorkoutSessionId(s?.sessionId) === want));
    let roster = await priceWeek(null);
    if (!hasRide(roster) && /^\d{4}-\d{2}-\d{2}$/.test(roster?.today ?? '')) {
      const before = await priceWeek(new Date(Date.parse(`${roster.today}T00:00:00.000Z`) - 7 * 86_400_000).toISOString().slice(0, 10));
      if (hasRide(before)) roster = before;
    }
    const learners = [];
    for (const learner of roster?.learners ?? []) {
      const ride = (ringLineOf(learner)?.sessions ?? []).find((s) => normalizeWorkoutSessionId(s?.sessionId) === want);
      if (!ride || !this.#isUser(learner.learnerId)) continue;
      try {
        const since = Number.isFinite(ride.startMs) ? new Date(ride.startMs - 86_400_000).toISOString() : null;
        // One entry per payout step: its silver, plus the gems the same step
        // minted (a `:gems` payout carrying the same ring count). A step that
        // paid only gems is an entry of its own.
        const steps = new Map();
        for (const t of await this.#economy.getHistory(learner.learnerId, { since })) {
          const currency = t.currency ?? 'silver';
          if (t.source !== 'payout' || t.meta?.kind !== 'ring-threshold' || (currency !== 'silver' && currency !== 'gems')) continue;
          if (normalizeWorkoutSessionId(t.meta?.session?.id) !== want) continue;
          const key = Number.isFinite(t.meta?.count) ? `count:${t.meta.count}` : `txn:${t.id}`;
          const step = steps.get(key) ?? { txnId: null, silver: 0, gems: 0, at: t.at, rings: Number.isFinite(t.meta.session.rings) ? t.meta.session.rings : null, gemTxnId: null };
          if (currency === 'silver') { step.txnId = t.id; step.silver += t.delta || 0; step.at = t.at; }
          else { step.gemTxnId = t.id; step.gems += t.delta || 0; }
          steps.set(key, step);
        }
        const entries = [...steps.values()].map(({ gemTxnId, ...e }) => ({ ...e, txnId: e.txnId ?? gemTxnId }));
        const wallet = await this.#economy.peekBalance(learner.learnerId);
        learners.push({
          learnerId: learner.learnerId, learnerName: learner.learnerName ?? learner.learnerId,
          entries: entries.reverse(), wallet: { silver: wallet?.silver ?? 0 },
        });
      } catch (err) {
        this.#logger.warn?.('economy.workout-paid.learner-failed', { sessionId, learnerId: learner.learnerId, error: err?.message ?? String(err) });
      }
    }
    this.#logger.info?.('economy.workout-paid.query', { sessionId, learners: learners.length });
    return { sessionId, mode, learners };
  }

  async standings() {
    const mode = this.#config.catalog().mode;
    if (mode === 'off') return { mode, contestClosed: false, learners: [] };
    // One priced roster for the standings and the board's gem chips: the
    // roster is every learner's school + ring read, so a second one doubled
    // each request's term-verdict projections (2026-11-10: ~50 s under load).
    const roster = await this.#preview.roster({ week: null });
    const gemsOf = await this.#heldGems(roster);
    const learners = [];
    for (const learner of roster?.learners ?? []) {
      if (!this.#isUser(learner.learnerId)) continue;
      try {
        const wallet = await this.#economy.peekBalance(learner.learnerId);
        const contest = contestLineOf(learner);
        const gem = contest?.status === 'earned' ? 'won' : (contest?.leader === true ? 'leading' : null);
        learners.push({ learnerId: learner.learnerId, learnerName: learner.learnerName ?? learner.learnerId, silver: wallet?.silver ?? 0, weekRings: ringLineOf(learner)?.count ?? 0, gem, gems: gemsOf(learner.learnerId) });
      } catch (err) {
        this.#logger.warn?.('economy.standings.learner-failed', { learnerId: learner.learnerId, error: err?.message ?? String(err) });
      }
    }
    return { mode, contestClosed: Boolean(roster?.contestClosed), learners };
  }
}

export default WorkoutEarningsService;
