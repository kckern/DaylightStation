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
import { createTransaction, foldBalances, resolvePolicy, inBlackout, drainPerSecond, CURRENCIES } from "../domain/index.mjs";
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { shortId } from '#system/utils/id.mjs';

const STALE_SESSION_MS = 5 * 60 * 1000; // no settle for 5 min → session considered dead
const PAID_KINDS = new Set(['earn', 'prize']); // what counts toward a payout ref's "paid"

/** Whole `to` coins for `amount` at `rate`, floored (the epsilon absorbs 0.29 × 100 = 28.999…). */
export function convertedAmount(amount, rate) {
  return Math.floor(amount * rate + 1e-9);
}

export class EconomyService {
  #ds; #configProjection; #logger; #clock; #newTransactionId; #newSessionId;

  constructor({ datastore, configProjection, logger = console, clock = () => new Date(),
    newTransactionId = () => `txn_${shortId()}`,
    newSessionId = () => `ses_${shortId()}` }) {
    this.#ds = datastore;
    if (!configProjection?.policy || !configProjection?.hasUser) throw new Error('EconomyService requires configProjection');
    this.#configProjection = configProjection;
    this.#logger = logger;
    this.#clock = clock;
    this.#newTransactionId = newTransactionId;
    this.#newSessionId = newSessionId;
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
   *   both halves present   `already-closed`, nothing written
   *   only the `from` half  a crash between the appends; writes the missing
   *                         `to` half from the first half's own figures
   *                         (`repaired`), never re-reading the balance
   *   only the `to` half    refuses (ValidationError): this method never
   *                         writes that, so a person should look
   *   neither               `nothing` (balance ≤ 0), `below-rate` (balance
   *                         too small for one whole `to` coin: nothing is
   *                         spent for nothing), or `converted`
   * `dryRun` gives the same answer (`would-convert`, `would-repair`) and
   * writes nothing, not even the wallet snapshot.
   * @returns {Promise<{userId: string, status: string, spent: number, got: number, rate: number, txnIds: string[]}>}
   */
  async convert(userId, { from, to, rate, ref, action = 'convert', source = 'convert', meta = null, dryRun = false }) {
    this.#assertUser(userId);
    if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to) || from === to) {
      throw new ValidationError(`convert needs two different currencies, got ${from} → ${to}`);
    }
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) throw new ValidationError(`convert rate must be a positive number, got ${rate}`);
    if (typeof ref !== 'string' || !ref.trim()) throw new ValidationError('convert ref is required');
    const toRef = `${ref}:${to}`;
    return this.#ds.withUserLock(userId, async () => {
      const txns = this.#ds.readAllTransactions(userId, { strict: true });
      const isHalf = (t, r, c) => t.kind === 'convert' && t.ref === r && (t.currency ?? 'silver') === c;
      const fromHalf = txns.find((t) => isHalf(t, ref, from));
      const toHalf = txns.find((t) => isHalf(t, toRef, to));
      const result = (status, spent, got, rateUsed = rate, txnIds = []) => ({ userId, status, spent, got, rate: rateUsed, txnIds });
      if (fromHalf && toHalf) return result('already-closed', -fromHalf.delta, toHalf.delta, fromHalf.meta?.rate ?? rate);
      if (toHalf) throw new ValidationError(`convert ${ref}: the ${to} half exists without the ${from} half`);

      const at = this.#now();
      const half = (currency, delta, halfRef, spent, got, rateUsed) => createTransaction({
        id: this.#newTransactionId(), kind: 'convert', currency, delta, action, source, ref: halfRef,
        evidenceRef: ref, meta: { ...(meta ?? {}), from, to, rate: rateUsed, spent, got }, at,
      });

      if (fromHalf) {
        // Repair from what the first half recorded, not today's balance or rate.
        const spent = -fromHalf.delta;
        const rateUsed = fromHalf.meta?.rate ?? rate;
        const got = fromHalf.meta?.got ?? convertedAmount(spent, rateUsed);
        if (dryRun) return result('would-repair', spent, got, rateUsed);
        const txn = half(to, got, toRef, spent, got, rateUsed);
        await this.#ds.appendTransaction(userId, txn);
        this.#snapshot(userId);
        this.#logger.warn('economy.convert.repaired', { userId, ref, from, to, spent, got });
        return result('repaired', spent, got, rateUsed, [txn.id]);
      }

      const spent = foldBalances(txns)[from];
      if (spent <= 0) return result('nothing', 0, 0);
      const got = convertedAmount(spent, rate);
      if (got <= 0) return { ...result('below-rate', 0, 0), balance: spent };
      if (dryRun) return result('would-convert', spent, got);
      const out = half(from, -spent, ref, spent, got, rate);
      const back = half(to, got, toRef, spent, got, rate);
      // `from` first: a crash between leaves coins owed (repaired next run),
      // never coins minted from nothing.
      await this.#ds.appendTransaction(userId, out);
      await this.#ds.appendTransaction(userId, back);
      this.#snapshot(userId);
      this.#logger.info('economy.convert', { userId, ref, from, to, rate, spent, got });
      return result('converted', spent, got, rate, [out.id, back.id]);
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
