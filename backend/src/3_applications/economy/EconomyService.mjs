/**
 * Use cases for the household coin economy. Owns all balance math and policy
 * enforcement; the datastore is dumb storage; the router is a thin shell.
 * Balance is derived by folding the append-only ledger; wallet.yml is a cache.
 */
import { createTransaction, foldBalance, resolvePolicy, inBlackout, drainPerSecond } from '#domains/economy/index.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

const STALE_SESSION_MS = 5 * 60 * 1000; // no settle for 5 min → session considered dead

export class EconomyService {
  #ds; #configService; #logger;

  constructor({ datastore, configService, logger = console }) {
    this.#ds = datastore;
    this.#configService = configService;
    this.#logger = logger;
  }

  #config() {
    return this.#configService.getHouseholdAppConfig?.(null, 'economy') || {};
  }

  #assertUser(userId) {
    if (!this.#configService.getUserProfile?.(userId)) {
      throw new EntityNotFoundError(`unknown user: ${userId}`);
    }
  }

  #snapshot(userId, session = undefined) {
    const balance = foldBalance(this.#ds.readAllTransactions(userId));
    const prev = this.#ds.readWallet(userId) || { session: null };
    const wallet = {
      balance,
      as_of: new Date().toISOString(),
      session: session === undefined ? (prev.session ?? null) : session,
    };
    this.#ds.writeWallet(userId, wallet);
    return wallet;
  }

  async getBalance(userId) {
    this.#assertUser(userId);
    const wallet = this.#reapStale(userId);
    return { userId, balance: wallet.balance, session: wallet.session };
  }

  async deposit(userId, { amount, note = null, source = 'admin' }) {
    this.#assertUser(userId);
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('deposit amount must be a positive integer');
    this.#ds.appendTransaction(userId, createTransaction({ kind: 'deposit', delta: amount, action: 'parent-deposit', source, ref: note }));
    const wallet = this.#snapshot(userId);
    this.#logger.info('economy-deposit', { userId, amount, balance: wallet.balance });
    return { userId, balance: wallet.balance };
  }

  /**
   * Apply an auditable signed reconciliation outside earn caps. The ledger may
   * go below zero; foldBalance deliberately floors only the displayed wallet,
   * so later earnings repay that debt before becoming spendable.
   */
  async adjust(userId, { delta, source, ref, note = null }) {
    this.#assertUser(userId);
    if (!Number.isInteger(delta)) throw new ValidationError('adjust delta must be an integer');
    if (typeof source !== 'string' || !source.trim()) throw new ValidationError('adjust source is required');
    if (typeof ref !== 'string' || !ref.trim()) throw new ValidationError('adjust ref is required');
    const existing = this.#ds.readAllTransactions(userId).find((txn) => txn.kind === 'adjust' && txn.ref === ref);
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
    const txn = createTransaction({ kind: 'adjust', delta, action: 'reward-reconciliation', source, ref, note });
    this.#ds.appendTransaction(userId, txn);
    const wallet = this.#snapshot(userId);
    this.#logger.info('economy-adjust', { userId, delta, source, ref, balance: wallet.balance });
    return { userId, adjusted: delta, duplicate: false, txnId: txn.id, balance: wallet.balance };
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
    const config = this.#config();
    // Feature-off no-op: on an install with no economy policy at all (no
    // economy.yml → no `earn` catalog), silently skip rather than throw. Keeps
    // the always-on piano earn-hook quiet on stock installs. A CONFIGURED
    // economy with an unknown action still throws below.
    if (!config?.earn) {
      const wallet = this.#snapshot(userId);
      return { userId, earned: 0, capped: false, duplicate: false, skipped: true, txnId: null, balance: wallet.balance };
    }
    const policy = resolvePolicy(config, userId, action);
    if (!policy || policy.type !== 'earn') throw new ValidationError(`unknown earn action: ${action}`);
    const override = Number.isInteger(amount) && amount > 0 ? amount : null;
    const reward = override ?? (policy.reward || 0);
    const cap = policy.daily_cap ?? Infinity;
    // NOTE: cap accounting is UTC-day (matches how txn.at is stamped). Blackout
    // windows are local-time; the split is intentional (see openSession).
    const today = new Date().toISOString().slice(0, 10);
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
      const txn = createTransaction({ kind: 'earn', delta: grant, action, source, ref });
      this.#ds.appendTransaction(userId, txn);
      txnId = txn.id ?? null;
    }
    const wallet = this.#snapshot(userId);
    this.#logger.info('economy-earn', { userId, action, earned: grant, capped: grant < reward, balance: wallet.balance });
    return { userId, earned: grant, capped: grant < reward, duplicate: false, txnId, balance: wallet.balance };
  }

  async openSession(userId, { action, source }) {
    this.#assertUser(userId);
    const policy = resolvePolicy(this.#config(), userId, action);
    if (!policy || policy.type !== 'spend') throw new ValidationError(`unknown spend action: ${action}`);
    if (inBlackout(policy.blackout)) throw new ValidationError(`${action} is in a blackout window`);
    const wallet = this.#reapStale(userId);
    if (wallet.session) throw new ValidationError(`user already has an open session: ${wallet.session.id}`);
    if (wallet.balance <= 0) throw new ValidationError('insufficient balance');
    const session = {
      id: `ses_${shortId()}`, action,
      opened_at: new Date().toISOString(),
      last_settled_at: new Date().toISOString(),
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
    const wallet = this.#ds.readWallet(userId);
    const session = wallet?.session;
    if (!session || session.id !== sessionId) throw new ValidationError(`no open session ${sessionId}`);
    const cumulative = Math.max(0, Math.floor(coins || 0));
    const newlyConsumed = Math.max(0, cumulative - session.settled_coins);
    const spend = Math.min(newlyConsumed, wallet.balance);
    if (spend > 0) {
      this.#ds.appendTransaction(userId, createTransaction({ kind: 'spend', delta: -spend, action: session.action, source: 'economy-session', ref: sessionId }));
    }
    const updated = { ...session, last_settled_at: new Date().toISOString(), settled_coins: session.settled_coins + spend };
    const next = this.#snapshot(userId, updated);
    this.#logger.debug?.('economy-session-settle', { userId, sessionId, cumulative, spend, balance: next.balance });
    return { userId, balance: next.balance, depleted: next.balance <= 0 };
  }

  async closeSession(userId, { sessionId, coins = 0 }) {
    // Tolerate a session that was already stale-reaped (normal cleanup after a
    // crash): treat as a no-op success rather than surfacing an error.
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
  }

  #reapStale(userId) {
    // Auto-close sessions that stopped settling (crash/power-loss). Costs the
    // kid nothing extra: consumed coins were already settled incrementally.
    const wallet = this.#ds.readWallet(userId) || this.#snapshot(userId);
    const s = wallet.session;
    if (s && Date.now() - Date.parse(s.last_settled_at || s.opened_at) > STALE_SESSION_MS) {
      this.#logger.warn('economy-session-stale-reaped', { userId, sessionId: s.id });
      return this.#snapshot(userId, null);
    }
    return this.#snapshot(userId); // refresh balance from ledger fold
  }
}

export default EconomyService;
