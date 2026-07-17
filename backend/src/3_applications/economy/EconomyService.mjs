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

  async earn(userId, { action, source, ref = null }) {
    this.#assertUser(userId);
    const policy = resolvePolicy(this.#config(), userId, action);
    if (!policy || policy.type !== 'earn') throw new ValidationError(`unknown earn action: ${action}`);
    const reward = policy.reward || 0;
    const cap = policy.daily_cap ?? Infinity;
    const today = new Date().toISOString().slice(0, 10);
    const earnedToday = this.#ds.readLedgerDay(userId, today)
      .filter((t) => t.kind === 'earn' && t.action === action)
      .reduce((s, t) => s + t.delta, 0);
    const grant = Math.max(0, Math.min(reward, cap - earnedToday));
    if (grant > 0) {
      this.#ds.appendTransaction(userId, createTransaction({ kind: 'earn', delta: grant, action, source, ref }));
    }
    const wallet = this.#snapshot(userId);
    this.#logger.info('economy-earn', { userId, action, earned: grant, capped: grant < reward, balance: wallet.balance });
    return { userId, earned: grant, capped: grant < reward, balance: wallet.balance };
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
