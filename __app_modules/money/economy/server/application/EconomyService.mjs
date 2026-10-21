/**
 * Use cases for the household coin economy. Owns all balance math and policy
 * enforcement; the datastore is dumb storage; the router is a thin shell.
 * Balances (silver, gold, gems) are derived by folding the append-only ledger;
 * wallet.yml is a cache. `balance` is always the silver figure.
 *
 * Every read-check-append (dedup, cap, balance clamp) runs inside the
 * datastore's per-user lock: an append awaits the user's queue, so without
 * the lock a second call could pass the same check before the first lands.
 */
import { createTransaction, foldBalances, resolvePolicy, inBlackout, drainPerSecond, CURRENCIES, PAID_KINDS,
  passRef, parsePassRef, passesOn, findPass, priceIn, readCap, capUsed, consumedRef, refundedRef, refundRef } from "../domain/index.mjs";
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { shortId } from '#system/utils/id.mjs';
import { studyDayForInstant } from "../../../../learning/school/server/domain-study-day.mjs";

const STALE_SESSION_MS = 5 * 60 * 1000; // no settle for 5 min → session considered dead
// How long after the purchase the server still believes a "played under a
// minute" claim: the refund window plus this much for picking and loading a
// game. Past it, a client saying `playedMs: 0` is not taken at its word.
export const REFUND_SETUP_MS = 5 * 60 * 1000;

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isPlayedMs = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Whole `to` coins for `amount` at `rate`, floored (the epsilon absorbs 0.29 × 100 = 28.999…). */
export function convertedAmount(amount, rate) {
  return Math.floor(amount * rate + 1e-9);
}

const isRate = (rate) => typeof rate === 'number' && Number.isFinite(rate) && rate > 0;

/**
 * What a lone first half of a conversion says the pair is, checked: a
 * negative delta, `meta.from` matching, a real `meta.to`, a positive rate
 * and a whole `got` no more than that rate gives. Anything else is refused,
 * since repairing from it would mint coins nobody can account for.
 */
function repairFigures(fromHalf, from, ref) {
  const m = fromHalf.meta;
  const refuse = (why) => { throw new ValidationError(`convert ${ref}: cannot repair, ${why}`, { code: 'BAD_CONVERT_HALF' }); };
  if (!Number.isInteger(fromHalf.delta) || fromHalf.delta >= 0) refuse(`the ${from} half has delta ${fromHalf.delta}`);
  if (m == null || typeof m !== 'object') refuse('the first half has no meta');
  if (m.from !== from) refuse(`meta.from is ${m.from}, not ${from}`);
  if (!CURRENCIES.includes(m.to) || m.to === from) refuse(`meta.to is ${m.to}`);
  if (!isRate(m.rate)) refuse(`meta.rate is ${m.rate}`);
  const spent = -fromHalf.delta;
  if (!Number.isInteger(m.got) || m.got <= 0 || m.got > convertedAmount(spent, m.rate)) refuse(`meta.got is ${m.got}`);
  return { to: m.to, rate: m.rate, spent, got: m.got };
}

export class EconomyService {
  #ds; #configProjection; #logger; #clock; #newTransactionId; #newSessionId; #timezone; #boundaryHour;

  /**
   * @param {object} deps
   * @param {string|null} [deps.timezone] - the household's, for the study day a
   *   pass belongs to. Composition hands the SAME timezone and boundary hour
   *   to the earnings preview, so a pass's day and the preview's "today" agree.
   * @param {number} [deps.boundaryHour=4]
   */
  constructor({ datastore, configProjection, logger = console, clock = () => new Date(),
    timezone = null, boundaryHour = 4,
    newTransactionId = () => `txn_${shortId()}`,
    newSessionId = () => `ses_${shortId()}` }) {
    this.#ds = datastore;
    if (!configProjection?.policy || !configProjection?.hasUser) throw new Error('EconomyService requires configProjection');
    this.#configProjection = configProjection;
    this.#logger = logger;
    this.#clock = clock;
    this.#newTransactionId = newTransactionId;
    this.#newSessionId = newSessionId;
    this.#timezone = timezone ?? null;
    this.#boundaryHour = boundaryHour;
  }

  /** Today's study day (4 am boundary, household timezone): the day a pass belongs to. */
  currentStudyDay(date = this.#clock()) {
    return studyDayForInstant(date.getTime(), { timezone: this.#timezone, boundaryHour: this.#boundaryHour });
  }

  /** The household's timezone and study-day boundary, for read models that name days. */
  get studyCalendar() {
    return { timezone: this.#timezone, boundaryHour: this.#boundaryHour };
  }

  #config() {
    return this.#configProjection.policy();
  }

  #assertUser(userId) {
    if (!this.#configProjection.hasUser(userId)) {
      throw new EntityNotFoundError(`unknown user: ${userId}`);
    }
  }

  #now() {
    return this.#clock().toISOString();
  }

  /** Whether the household knows this user (has a profile, so has a wallet). */
  hasUser(userId) {
    return this.#configProjection.hasUser(userId);
  }

  #snapshot(userId, session = undefined) {
    const balances = foldBalances(this.#ds.readAllTransactions(userId));
    const prev = this.#ds.readWallet(userId) || { session: null };
    const wallet = {
      balance: balances.silver,
      balances,
      as_of: this.#now(),
      session: session === undefined ? (prev.session ?? null) : session,
    };
    this.#ds.writeWallet(userId, wallet);
    return wallet;
  }

  async getBalance(userId) {
    this.#assertUser(userId);
    const wallet = this.#reapStale(userId);
    return { userId, balance: wallet.balance, balances: wallet.balances, session: wallet.session };
  }

  /**
   * Every ledger entry, newest first; entries sharing a timestamp come
   * last-appended first. A pre-currency entry reads as silver. An entry whose
   * `at` does not parse is kept (sorted last, never dropped by `since`) and
   * logged, so a bad row shows up instead of disappearing from the history.
   * @param {string} userId
   * @param {{since?: string|null}} [opts] - ISO time; keeps entries at or after it
   */
  async getHistory(userId, { since = null } = {}) {
    this.#assertUser(userId);
    const from = since == null ? -Infinity : Date.parse(since);
    if (Number.isNaN(from)) throw new ValidationError(`since must be an ISO timestamp, got ${since}`);
    const fromDay = since == null ? null : new Date(from).toISOString().slice(0, 10);
    const rows = [];
    for (const t of this.#ds.readAllTransactions(userId, { fromDay })) {
      const ms = Date.parse(t.at);
      if (Number.isNaN(ms)) this.#logger.warn('economy.history.unreadable-at', { userId, txnId: t.id ?? null, at: t.at ?? null });
      else if (ms < from) continue;
      rows.push({ txn: { ...t, currency: t.currency ?? 'silver' }, ms: Number.isNaN(ms) ? -Infinity : ms });
    }
    // Ledger order is append order; reversing first lets the stable sort keep
    // the latest-appended entry ahead of an earlier one with the same time.
    return rows.reverse().sort((x, y) => (y.ms > x.ms) - (y.ms < x.ms)).map((r) => r.txn);
  }

  async deposit(userId, { amount, note = null, source = 'admin' }) {
    this.#assertUser(userId);
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('deposit amount must be a positive integer');
    return this.#ds.withUserLock(userId, async () => {
      await this.#ds.appendTransaction(userId, createTransaction({ id: this.#newTransactionId(), kind: 'deposit', delta: amount, action: 'parent-deposit', source, ref: note, at: this.#now() }));
      const wallet = this.#snapshot(userId);
      this.#logger.info('economy-deposit', { userId, amount, balance: wallet.balance });
      return { userId, balance: wallet.balance };
    });
  }

  /**
   * Apply an auditable signed reconciliation outside earn caps. The ledger may
   * go below zero; foldBalances deliberately floors only the displayed wallet,
   * so later earnings repay that debt before becoming spendable.
   */
  async adjust(userId, { delta, source, ref, note = null }) {
    this.#assertUser(userId);
    if (!Number.isInteger(delta)) throw new ValidationError('adjust delta must be an integer');
    if (typeof source !== 'string' || !source.trim()) throw new ValidationError('adjust source is required');
    if (typeof ref !== 'string' || !ref.trim()) throw new ValidationError('adjust ref is required');
    return this.#ds.withUserLock(userId, async () => {
      // Strict: a shard that does not parse could hold this very ref.
      const existing = this.#ds.readAllTransactions(userId, { strict: true }).find((txn) => txn.kind === 'adjust' && txn.ref === ref);
      if (existing) {
        if (existing.delta !== delta || existing.source !== source) {
          throw new ValidationError(`adjust ref was already used: ${ref}`);
        }
        const wallet = this.#snapshot(userId);
        return { userId, adjusted: 0, duplicate: true, txnId: existing.id, balance: wallet.balance };
      }
      if (delta === 0) {
        const wallet = this.#snapshot(userId);
        return { userId, adjusted: 0, duplicate: false, txnId: null, balance: wallet.balance };
      }
      const txn = createTransaction({ id: this.#newTransactionId(), kind: 'adjust', delta, action: 'reward-reconciliation', source, ref, note, at: this.#now() });
      await this.#ds.appendTransaction(userId, txn);
      const wallet = this.#snapshot(userId);
      this.#logger.info('economy-adjust', { userId, delta, source, ref, balance: wallet.balance });
      return { userId, adjusted: delta, duplicate: false, txnId: txn.id, balance: wallet.balance };
    });
  }

  /**
   * @param {string} userId
   * @param {object} args
   * @param {string} args.action - an `earn` action from the economy catalog
   * @param {string} args.source
   * @param {string|null} [args.ref] - idempotency key; a ref pays once per UTC day
   * @param {number|null} [args.amount] - what THIS completion is worth, when the
   *   caller's own policy says so (a school unit declares `reward.amount`).
   *   Overrides the catalog's flat `reward`; still subject to `daily_cap`, which
   *   is the household's ceiling and not the caller's to raise. A non-positive
   *   or non-integer value is ignored rather than treated as "pay nothing" — a
   *   miswired override must not silently zero a real reward.
   */
  async earn(userId, { action, source, ref = null, amount = null }) {
    this.#assertUser(userId);
    // One clock read: the cap day and the shard the earn lands in must agree.
    const now = this.#now();
    const config = this.#config();
    // Feature-off no-op: on an install with no economy policy at all (no
    // economy/config.yml → no `earn` catalog), skip rather than throw. Keeps
    // the always-on piano earn-hook quiet on stock installs. A CONFIGURED
    // economy with an unknown action still throws below.
    if (!config?.earn) {
      const wallet = this.#snapshot(userId);
      return { userId, earned: 0, capped: false, duplicate: false, skipped: true, reason: 'no-catalog', txnId: null, balance: wallet.balance };
    }
    // The catalog ships `earn: {}` (prices moved to earn-rules.yml), and `{}`
    // is truthy: an empty map prices nothing, so it skips the same way.
    if (Object.keys(config.earn).length === 0) {
      const wallet = this.#snapshot(userId);
      return { userId, earned: 0, capped: false, duplicate: false, skipped: true, reason: 'not-priced', txnId: null, balance: wallet.balance };
    }
    const policy = resolvePolicy(config, userId, action);
    if (!policy || policy.type !== 'earn') throw new ValidationError(`unknown earn action: ${action}`);
    const override = Number.isInteger(amount) && amount > 0 ? amount : null;
    const reward = override ?? (policy.reward || 0);
    const cap = policy.daily_cap ?? Infinity;
    // NOTE: cap accounting is UTC-day (matches how txn.at is stamped). Blackout
    // windows are local-time; the split is intentional (see openSession).
    return this.#ds.withUserLock(userId, async () => {
      const today = now.slice(0, 10);
      const todaysEarns = this.#ds.readLedgerDay(userId, today)
        .filter((t) => t.kind === 'earn' && t.action === action);
      // Replay guard: a completion event carrying a ref only ever pays out once
      // per day. Bounds the damage of a retried/duplicated earn (coins cash out).
      if (ref != null && todaysEarns.some((t) => t.ref === ref)) {
        const wallet = this.#snapshot(userId);
        this.#logger.info('economy-earn-duplicate', { userId, action, ref, balance: wallet.balance });
        // The already-paid transaction, so a caller holding a durable record of
        // its own (School's work sessions) can store the same id on a retry
        // instead of recording "paid, id unknown".
        const existing = todaysEarns.find((t) => t.ref === ref);
        return { userId, earned: 0, capped: false, duplicate: true, txnId: existing?.id ?? null, balance: wallet.balance };
      }
      const earnedToday = todaysEarns.reduce((s, t) => s + t.delta, 0);
      const grant = Math.max(0, Math.min(reward, cap - earnedToday));
      let txnId = null;
      if (grant > 0) {
        const txn = createTransaction({ id: this.#newTransactionId(), kind: 'earn', delta: grant, action, source, ref, at: now });
        await this.#ds.appendTransaction(userId, txn);
        txnId = txn.id ?? null;
      }
      const wallet = this.#snapshot(userId);
      this.#logger.info('economy-earn', { userId, action, earned: grant, capped: grant < reward, balance: wallet.balance });
      return { userId, earned: grant, capped: grant < reward, duplicate: false, txnId, balance: wallet.balance };
    });
  }

  /**
   * Pay what an earning is worth (PayoutService). `ref` is the idempotency
   * key across the WHOLE ledger, not one day's shard, and `amount` is what the
   * ref is worth in total: the mint pays only the part no entry with this ref
   * and currency has paid yet. A retried or racing mint therefore writes
   * nothing, and a week line that grew (a second green day) pays only the
   * difference. A ref already paid more than `amount` (a rate cut, a retracted
   * grade) is never clawed back here; that is an `adjust`.
   * "Paid" counts only `earn` and `prize` entries. A clawback is an `adjust`
   * under its OWN ref (e.g. `${ref}:clawback`); even an adjust that reuses
   * this ref is not counted, so a correction never makes the payout mint again.
   * The ledger read is strict: a corrupt shard throws `CORRUPT_LEDGER` rather
   * than read as "never paid".
   * Outside the earn catalog: no `daily_cap`, no action lookup. The entry's
   * `action` is `payout:<ruleId>` so earn()'s per-action cap never counts it.
   * @param {string} userId
   * @param {object} args
   * @param {'silver'|'gold'|'gems'} args.currency
   * @param {number} args.amount - positive integer, the ref's full worth
   * @param {'earn'|'prize'} [args.kind='earn']
   * @param {string} args.ref - one key per currency (PayoutService suffixes `:gems`)
   * @param {string|null} [args.ruleId]
   * @param {string|null} [args.timeliness]
   * @param {string|null} [args.evidenceRef] - the earning line the entry pays for
   * @param {string} [args.source='payout']
   */
  async mint(userId, { currency = 'silver', amount, kind = 'earn', ref, ruleId = null, timeliness = null, evidenceRef = null, source = 'payout' }) {
    this.#assertUser(userId);
    if (!['earn', 'prize'].includes(kind)) throw new ValidationError(`mint kind must be earn or prize, got ${kind}`);
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('mint amount must be a positive integer');
    if (typeof ref !== 'string' || !ref.trim()) throw new ValidationError('mint ref is required');
    return this.#ds.withUserLock(userId, async () => {
      // One all-time read per mint, under the lock: the authoritative check.
      const paid = this.#ds.readAllTransactions(userId, { strict: true })
        .filter((t) => PAID_KINDS.has(t.kind) && t.ref === ref && (t.currency ?? 'silver') === currency)
        .reduce((s, t) => s + (t.delta || 0), 0);
      const owed = amount - paid;
      if (owed <= 0) {
        const wallet = this.#snapshot(userId);
        return { userId, minted: 0, duplicate: true, paid, txnId: null, balance: wallet.balance, balances: wallet.balances };
      }
      const txn = createTransaction({ id: this.#newTransactionId(), kind, currency, delta: owed, action: `payout:${ruleId ?? kind}`, source, ref, ruleId, timeliness, evidenceRef, at: this.#now() });
      await this.#ds.appendTransaction(userId, txn);
      const wallet = this.#snapshot(userId);
      this.#logger.info('economy.mint', { userId, kind, currency, minted: owed, ref, ruleId, balance: wallet.balance });
      return { userId, minted: owed, duplicate: false, paid, txnId: txn.id, balance: wallet.balance, balances: wallet.balances };
    });
  }

  /**
   * Convert a wallet's whole `from` balance into `to` at `rate` (the week
   * close: silver → gold). Writes a pair of `convert` entries with one `at`:
   * −balance in `from` under `ref`, then +convertedAmount(balance, rate) in
   * `to` under `${ref}:${to}`. Both carry `evidenceRef: ref` and
   * `meta: { ...meta, from, to, rate, spent, got }`.
   *
   * The balance read (strict, all-time), the idempotency check and both
   * appends run in one user-lock body, so a mint or spend cannot land between
   * them. `ref` converts once:
   *   both halves present   `already-converted`, nothing written
   *   only the `from` half  a crash between the appends; writes the missing
   *                         half from the first half's own `meta` (its `to`,
   *                         `rate` and `got`, even if the caller's rule has
   *                         changed since), never re-reading the balance
   *                         (`repaired`). A first half whose figures do not
   *                         add up is refused (ValidationError,
   *                         BAD_CONVERT_HALF).
   *   only the `to` half    refuses (ValidationError, ORPHAN_CONVERT_HALF):
   *                         this method never writes that, so a person
   *                         should look
   *   neither               `nothing` (balance ≤ 0), `not-an-earner` (with
   *                         `requireEntry`: no ledger entry passes it),
   *                         `below-rate` (balance too small for
   *                         one whole `to` coin: nothing is spent for
   *                         nothing), or `converted`
   * `dryRun` gives the same answer (`would-convert`, `would-repair`) and
   * writes nothing, not even the wallet snapshot. Once the first half has
   * landed the wallet snapshot is written even if the second half throws; a
   * snapshot failure then is logged and never hides the append's error.
   * @param {((txn: object) => boolean)|null} [args.requireEntry] - convert only
   *   a wallet with at least one entry passing this (the week close:
   *   `isPayoutEntry`)
   * @returns {Promise<{userId: string, status: string, spent: number, got: number, rate: number, to: string, txnIds: string[]}>}
   */
  async convert(userId, { from, to, rate, ref, action = 'convert', source = 'convert', meta = null, dryRun = false, requireEntry = null }) {
    this.#assertUser(userId);
    if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to) || from === to) {
      throw new ValidationError(`convert needs two different currencies, got ${from} → ${to}`);
    }
    if (!isRate(rate)) throw new ValidationError(`convert rate must be a positive number, got ${rate}`);
    if (typeof ref !== 'string' || !ref.trim()) throw new ValidationError('convert ref is required');
    return this.#ds.withUserLock(userId, async () => {
      const txns = this.#ds.readAllTransactions(userId, { strict: true });
      const isHalf = (t, r, c) => t.kind === 'convert' && t.ref === r && (t.currency ?? 'silver') === c;
      const result = (status, spent, got, { rate: r = rate, to: c = to, txnIds = [] } = {}) => ({ userId, status, spent, got, rate: r, to: c, txnIds });
      const at = this.#now();
      const half = (currency, delta, halfRef, figures) => createTransaction({
        id: this.#newTransactionId(), kind: 'convert', currency, delta, action, source, ref: halfRef,
        evidenceRef: ref, meta: { ...(meta ?? {}), from, ...figures }, at,
      });

      const fromHalf = txns.find((t) => isHalf(t, ref, from));
      if (fromHalf) {
        // The first half says what the pair is; today's rule does not.
        const original = repairFigures(fromHalf, from, ref);
        const toRef = `${ref}:${original.to}`;
        const toHalf = txns.find((t) => isHalf(t, toRef, original.to));
        const opts = { rate: original.rate, to: original.to };
        if (toHalf) return result('already-converted', original.spent, toHalf.delta, opts);
        if (dryRun) return result('would-repair', original.spent, original.got, opts);
        if (original.to !== to) {
          this.#logger.warn('economy.convert.repair-original-target', { userId, ref, from, to: original.to, ruleTo: to });
        }
        const txn = half(original.to, original.got, toRef, original);
        await this.#appendThenSnapshot(userId, txn, ref);
        this.#logger.debug?.('economy.convert.repaired', { userId, ref, from, ...original });
        return result('repaired', original.spent, original.got, { ...opts, txnIds: [txn.id] });
      }
      const toRef = `${ref}:${to}`;
      if (txns.some((t) => isHalf(t, toRef, to))) {
        throw new ValidationError(`convert ${ref}: the ${to} half exists without the ${from} half`, { code: 'ORPHAN_CONVERT_HALF' });
      }

      const spent = foldBalances(txns)[from];
      if (spent <= 0) return result('nothing', 0, 0);
      if (requireEntry != null && !txns.some((t) => requireEntry(t))) return result('not-an-earner', 0, 0);
      const got = convertedAmount(spent, rate);
      if (got <= 0) return { ...result('below-rate', 0, 0), balance: spent };
      if (dryRun) return result('would-convert', spent, got);
      const figures = { to, rate, spent, got };
      const out = half(from, -spent, ref, figures);
      const back = half(to, got, toRef, figures);
      // `from` first: a crash between leaves coins owed (repaired next run),
      // never coins minted from nothing. The snapshot follows the ledger
      // either way.
      await this.#ds.appendTransaction(userId, out);
      await this.#appendThenSnapshot(userId, back, ref);
      this.#logger.debug?.('economy.convert', { userId, ref, from, to, rate, spent, got });
      return result('converted', spent, got, { txnIds: [out.id, back.id] });
    });
  }

  /**
   * Append, then refresh the wallet snapshot whatever happened: it must match
   * the ledger, which already holds an earlier half. A snapshot failure is
   * logged and never replaces the append's own error.
   */
  async #appendThenSnapshot(userId, txn, ref, event = 'economy.convert.snapshot-failed') {
    let appendErr = null;
    try {
      // In order; the first failure stops the rest.
      for (const t of Array.isArray(txn) ? txn : [txn]) await this.#ds.appendTransaction(userId, t);
    } catch (err) {
      appendErr = err;
    }
    let wallet = null;
    try {
      wallet = this.#snapshot(userId);
    } catch (err) {
      this.#logger.error?.(event, { userId, ref, error: err?.message ?? String(err) });
    }
    if (appendErr) throw appendErr;
    return wallet;
  }

  // ── Early passes ─────────────────────────────────────────────────────────
  //
  // A pass opens one unit of a privilege (one piano game) before the day is
  // done. The ledger entries are listed in domain/passes.mjs; the pass id is
  // the purchase marker's ref, `pass:{learnerId}:{studyDay}`. Every write
  // runs in the user lock over a strict read, and every transition is a new
  // marker entry: the first transition wins, a repeat is a no-op.
  //
  // Write order fails safe for the kid:
  //   buy     marker, then spend. A crash between leaves a pass nobody paid
  //           for (`paid: 0`), never coins gone with no pass. It is not
  //           charged later; a refund of it hands back what was paid, 0.
  //   refund  the earn, then the `:refunded` marker. The earn is the commit
  //           point: with it present the pass reads refunded, a consume is
  //           refused, and a retried refund writes only the missing marker.

  #catalog() {
    return this.#configProjection.catalog?.() ?? { passes: {} };
  }

  /** Log a refusal and return its error, for the caller to throw. */
  #passRefusal(userId, privilege, coin, price, code, message, details = undefined) {
    this.#logger.info('economy.pass.refused', { learnerId: userId, privilege, coin, price, reason: code });
    return new ValidationError(message, { code, ...(details ? { details } : {}) });
  }

  #readFrom(studyDay) {
    // Shards are UTC days; a study day's instants can fall on the UTC day before.
    return addDays(studyDay, -1);
  }

  /**
   * Buy today's pass for `privilege`, paid in `coin` (silver or gold, at the
   * catalog's price). Refusals write nothing:
   *   PASS_NOT_SOLD      no catalog pass lists the privilege, the coin is
   *                      priced 0 / unset, is gems or unknown, or the cap is
   *                      not one this code can honour
   *   PASS_CAP           `cap.count` passes already bought this study day,
   *                      in ANY state (a refunded pass still uses the day);
   *                      `across: all-passes` counts every pass, any other
   *                      value only this one
   *   PASS_UNAFFORDABLE  the ledger balance in `coin` is short;
   *                      `details: {coin, price, balance, shortfall}`
   * @returns {Promise<{userId: string, pass: object, balances: object}>}
   */
  async buyPass(userId, { privilege, coin } = {}) {
    this.#assertUser(userId);
    if (typeof privilege !== 'string' || !privilege.trim()) throw new ValidationError('privilege is required', { field: 'privilege' });
    if (typeof coin !== 'string' || !coin.trim()) throw new ValidationError('coin is required', { field: 'coin' });
    const found = findPass(this.#catalog(), privilege);
    if (!found) throw this.#passRefusal(userId, privilege, coin, null, 'PASS_NOT_SOLD', `no pass opens ${privilege}`);
    const price = priceIn(found.def, coin);
    if (price == null) throw this.#passRefusal(userId, privilege, coin, null, 'PASS_NOT_SOLD', `${found.key} is not sold in ${coin}`);
    const cap = readCap(found.def.cap);
    if (!cap) throw this.#passRefusal(userId, privilege, coin, price, 'PASS_NOT_SOLD', `${found.key} has a cap this economy cannot honour`);
    return this.#ds.withUserLock(userId, async () => {
      const date = this.#clock();
      const at = date.toISOString();
      const studyDay = this.currentStudyDay(date);
      const txns = this.#ds.readAllTransactions(userId, { strict: true });
      const today = passesOn(txns, { learnerId: userId, studyDay });
      if (capUsed(today, found)) {
        throw this.#passRefusal(userId, privilege, coin, price, 'PASS_CAP', `${cap.count} pass${cap.count === 1 ? '' : 'es'} a day: already used today`);
      }
      const balance = foldBalances(txns)[coin];
      if (balance < price) {
        throw this.#passRefusal(userId, privilege, coin, price, 'PASS_UNAFFORDABLE', `${found.key} costs ${price} ${coin}; the balance is ${balance}`,
          { coin, price, balance, shortfall: price - balance });
      }
      const id = passRef({ learnerId: userId, studyDay, seq: today.length + 1 });
      const common = { action: found.key, source: 'pass', ref: id, evidenceRef: id, currency: coin, at };
      const marker = createTransaction({ ...common, id: this.#newTransactionId(), kind: 'pass', delta: 0,
        meta: { pass: found.key, privilege, coin, price, state: 'active', boughtAt: at, studyDay,
          refundWithinMs: Number.isFinite(found.def.refund_within_ms) ? found.def.refund_within_ms : null } });
      const spend = createTransaction({ ...common, id: this.#newTransactionId(), kind: 'spend', delta: -price });
      // Marker first: if it fails nothing was written. If the spend fails
      // after it, the pass exists unpaid; the error names it (`passId`) and
      // says so at error level, and the caller must re-read the bank.
      await this.#ds.appendTransaction(userId, marker);
      let wallet;
      try {
        wallet = await this.#appendThenSnapshot(userId, spend, id, 'economy.pass.snapshot-failed');
      } catch (err) {
        if (err && typeof err === 'object') err.passId = id;
        this.#logger.error?.('economy.pass.unpaid', { learnerId: userId, passId: id, error: err?.message ?? String(err) });
        throw err;
      }
      this.#logger.info('economy.pass.bought', { learnerId: userId, privilege, coin, price, passId: id });
      const pass = passesOn([...txns, marker, spend], { learnerId: userId, studyDay }).find((p) => p.passId === id);
      return { userId, pass, balances: wallet?.balances ?? foldBalances([...txns, spend]) };
    });
  }

  /**
   * Today's passes, first first. `strict` throws CORRUPT_LEDGER when one of
   * today's shards does not parse (the bank shows "unknown"). Otherwise the
   * read is lenient, for gating, but a shard that would have thrown is logged
   * (`economy.pass.ledger-unreadable`) before the lenient read carries on.
   */
  async passesToday(userId, { strict = false } = {}) {
    this.#assertUser(userId);
    const studyDay = this.currentStudyDay();
    const fromDay = this.#readFrom(studyDay);
    let txns;
    try {
      txns = this.#ds.readAllTransactions(userId, { fromDay, strict: true });
    } catch (err) {
      if (strict || err?.code !== 'CORRUPT_LEDGER') throw err;
      this.#logger.warn?.('economy.pass.ledger-unreadable', { learnerId: userId, studyDay, error: err.message });
      txns = this.#ds.readAllTransactions(userId, { fromDay });
    }
    return passesOn(txns, { learnerId: userId, studyDay });
  }

  /** Today's active pass for `privilege`, or null. A pass expires when the study day rolls over at 4 am. */
  async activePass(userId, { privilege } = {}) {
    return (await this.passesToday(userId)).find((p) => p.state === 'active' && p.privilege === privilege) ?? null;
  }

  /** Lock, strict read, and the pass `passId` names for this user; 404 for anything else. */
  async #withPass(userId, passId, fn) {
    this.#assertUser(userId);
    const parsed = parsePassRef(passId);
    if (!parsed || parsed.learnerId !== userId) throw new EntityNotFoundError('pass', passId);
    return this.#ds.withUserLock(userId, async () => {
      const txns = this.#ds.readAllTransactions(userId, { strict: true });
      const pass = passesOn(txns, { learnerId: userId, studyDay: parsed.studyDay }).find((p) => p.passId === passId);
      if (!pass) throw new EntityNotFoundError('pass', passId);
      return fn(pass, txns, parsed);
    });
  }

  #notActive(pass, verb) {
    return new ValidationError(`pass ${pass.passId} is ${pass.state}; it cannot be ${verb}`, { code: 'PASS_NOT_ACTIVE', details: { state: pass.state } });
  }

  /**
   * The game the pass bought has ended. Consuming twice is a no-op
   * (`duplicate: true`); a refunded pass refuses with PASS_NOT_ACTIVE.
   * @param {{passId: string, playedMs?: number|null}} args
   */
  async consumePass(userId, { passId, playedMs = null } = {}) {
    if (playedMs != null && !isPlayedMs(playedMs)) throw new ValidationError('playedMs must be a non-negative number', { field: 'playedMs' });
    return this.#withPass(userId, passId, async (pass, txns) => {
      if (pass.state === 'consumed') return { userId, pass, duplicate: true };
      if (pass.state !== 'active') throw this.#notActive(pass, 'consumed');
      const marker = createTransaction({ id: this.#newTransactionId(), kind: 'pass', delta: 0, currency: pass.coin ?? 'silver',
        action: pass.pass ?? 'pass', source: 'pass', ref: consumedRef(passId), evidenceRef: passId, at: this.#now(),
        meta: { pass: pass.pass, privilege: pass.privilege, state: 'consumed', playedMs } });
      await this.#ds.appendTransaction(userId, marker);
      this.#logger.info('economy.pass.consumed', { learnerId: userId, privilege: pass.privilege, coin: pass.coin, price: pass.price, passId, playedMs });
      return { userId, pass: this.#stateAfter(txns, marker, userId, passId), duplicate: false };
    });
  }

  #stateAfter(txns, added, userId, passId) {
    const parsed = parsePassRef(passId);
    return passesOn([...txns, ...[].concat(added)], { learnerId: userId, studyDay: parsed.studyDay }).find((p) => p.passId === passId);
  }

  /**
   * Hand back what the pass cost: the game ended within the refund window.
   * Allowed only while the pass is active, on its own study day, with the
   * client's `playedMs` under `refund_within_ms` (as recorded at purchase),
   * AND the server's time since purchase under that window plus
   * REFUND_SETUP_MS, so a client cannot claim `playedMs: 0` an hour later.
   * Otherwise PASS_REFUND_CLOSED; consumed: PASS_NOT_ACTIVE. Refunding twice
   * refunds once (`duplicate: true`).
   * @param {{passId: string, playedMs: number, reason?: string|null}} args
   */
  async refundPass(userId, { passId, playedMs, reason = null } = {}) {
    if (!isPlayedMs(playedMs)) throw new ValidationError('playedMs must be a non-negative number', { field: 'playedMs' });
    const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 80) : null;
    return this.#withPass(userId, passId, async (pass, txns, parsed) => {
      const log = { learnerId: userId, privilege: pass.privilege, coin: pass.coin, price: pass.price, passId };
      const markerFor = () => createTransaction({ id: this.#newTransactionId(), kind: 'pass', delta: 0, currency: pass.coin ?? 'silver',
        action: pass.pass ?? 'pass', source: 'pass', ref: refundedRef(passId), evidenceRef: passId, at: this.#now(),
        meta: { pass: pass.pass, privilege: pass.privilege, state: 'refunded', playedMs, ...(why ? { reason: why } : {}) } });
      if (pass.state === 'refunded') {
        // Finish a refund whose marker never landed; never pay it twice.
        if (txns.some((t) => t.kind === 'pass' && t.ref === refundedRef(passId))) return { userId, pass, refunded: 0, duplicate: true, balances: foldBalances(txns) };
        const marker = markerFor();
        await this.#ds.appendTransaction(userId, marker);
        return { userId, pass: this.#stateAfter(txns, marker, userId, passId), refunded: 0, duplicate: true, balances: foldBalances(txns) };
      }
      if (pass.state !== 'active') {
        this.#logger.info('economy.pass.refused', { ...log, reason: 'PASS_NOT_ACTIVE' });
        throw this.#notActive(pass, 'refunded');
      }
      const date = this.#clock();
      const window = txns.find((t) => t.kind === 'pass' && t.ref === passId)?.meta?.refundWithinMs
        ?? findPass(this.#catalog(), pass.privilege)?.def?.refund_within_ms;
      const sinceBought = date.getTime() - Date.parse(pass.boughtAt);
      const closed = !Number.isFinite(window) || window <= 0 ? 'this pass has no refund window'
        : parsed.studyDay !== this.currentStudyDay(date) ? 'the pass was for an earlier day'
          : playedMs >= window ? `played ${Math.round(playedMs / 1000)} s, past the ${Math.round(window / 1000)} s refund window`
            : !(sinceBought < window + REFUND_SETUP_MS) ? 'bought too long ago to refund' : null;
      if (closed) {
        this.#logger.info('economy.pass.refused', { ...log, reason: 'PASS_REFUND_CLOSED' });
        throw new ValidationError(`no refund: ${closed}`, { code: 'PASS_REFUND_CLOSED' });
      }
      const owed = Math.max(0, pass.paid);
      const writes = [];
      if (owed > 0) {
        writes.push(createTransaction({ id: this.#newTransactionId(), kind: 'earn', currency: pass.coin, delta: owed,
          action: `${pass.pass}-refund`, source: 'pass', ref: refundRef(passId), evidenceRef: passId, at: date.toISOString() }));
      }
      writes.push(markerFor());
      const wallet = await this.#appendThenSnapshot(userId, writes, passId, 'economy.pass.snapshot-failed');
      this.#logger.info('economy.pass.refunded', { ...log, refunded: owed, playedMs, reason: why });
      return { userId, pass: this.#stateAfter(txns, writes, userId, passId), refunded: owed, duplicate: false, balances: wallet?.balances ?? foldBalances([...txns, ...writes]) };
    });
  }

  async openSession(userId, { action, source }) {
    this.#assertUser(userId);
    const policy = resolvePolicy(this.#config(), userId, action);
    if (!policy || policy.type !== 'spend') throw new ValidationError(`unknown spend action: ${action}`);
    if (inBlackout(policy.blackout, this.#clock())) throw new ValidationError(`${action} is in a blackout window`);
    const wallet = this.#reapStale(userId);
    if (wallet.session) throw new ValidationError(`user already has an open session: ${wallet.session.id}`);
    if (wallet.balance <= 0) throw new ValidationError('insufficient balance');
    const session = {
      id: this.#newSessionId(), action,
      opened_at: this.#now(),
      last_settled_at: this.#now(),
      settled_coins: 0,
    };
    this.#snapshot(userId, session);
    this.#logger.info('economy-session-open', { userId, action, sessionId: session.id, balance: wallet.balance });
    return { userId, sessionId: session.id, balance: wallet.balance, drainPerSecond: drainPerSecond(policy) };
  }

  /**
   * Settle a metered session. `coins` is the CUMULATIVE whole-or-fractional
   * coins the client reports consumed since the session opened (a monotonic
   * high-water mark), NOT an increment. The server charges only the newly-
   * crossed whole coins: spend = floor(cumulative) − settled_coins, clamped to
   * balance. This makes settle idempotent (a retried settle with the same
   * cumulative charges 0) and immune to sub-coin flushing (the remainder stays
   * uncharged until the next whole coin is crossed).
   */
  async settleSession(userId, { sessionId, coins }) {
    this.#assertUser(userId);
    return this.#ds.withUserLock(userId, async () => {
      const wallet = this.#ds.readWallet(userId);
      const session = wallet?.session;
      if (!session || session.id !== sessionId) throw new ValidationError(`no open session ${sessionId}`);
      const cumulative = Math.max(0, Math.floor(coins || 0));
      const newlyConsumed = Math.max(0, cumulative - session.settled_coins);
      const spend = Math.min(newlyConsumed, wallet.balance);
      if (spend > 0) {
        await this.#ds.appendTransaction(userId, createTransaction({ id: this.#newTransactionId(), kind: 'spend', delta: -spend, action: session.action, source: 'economy-session', ref: sessionId, at: this.#now() }));
      }
      const updated = { ...session, last_settled_at: this.#now(), settled_coins: session.settled_coins + spend };
      const next = this.#snapshot(userId, updated);
      this.#logger.debug?.('economy-session-settle', { userId, sessionId, cumulative, spend, balance: next.balance });
      return { userId, balance: next.balance, depleted: next.balance <= 0 };
    });
  }

  async closeSession(userId, { sessionId, coins = 0 }) {
    // Tolerate a session that was already stale-reaped (normal cleanup after a
    // crash): treat as a no-op success rather than surfacing an error.
    // Locked so the tail settle and the session clear land as one step.
    return this.#ds.withUserLock(userId, async () => {
      const wallet = this.#ds.readWallet(userId);
      if (!wallet?.session || wallet.session.id !== sessionId) {
        const fresh = this.#snapshot(userId);
        this.#logger.info('economy-session-close-noop', { userId, sessionId, balance: fresh.balance });
        return { userId, balance: fresh.balance };
      }
      await this.settleSession(userId, { sessionId, coins });
      const next = this.#snapshot(userId, null);
      this.#logger.info('economy-session-close', { userId, sessionId, balance: next.balance });
      return { userId, balance: next.balance };
    });
  }

  #reapStale(userId) {
    // Auto-close sessions that stopped settling (crash/power-loss). Costs the
    // kid nothing extra: consumed coins were already settled incrementally.
    const wallet = this.#ds.readWallet(userId) || this.#snapshot(userId);
    const s = wallet.session;
    if (s && this.#clock().getTime() - Date.parse(s.last_settled_at || s.opened_at) > STALE_SESSION_MS) {
      this.#logger.warn('economy-session-stale-reaped', { userId, sessionId: s.id });
      return this.#snapshot(userId, null);
    }
    return this.#snapshot(userId); // refresh balance from ledger fold
  }
}

export default EconomyService;
