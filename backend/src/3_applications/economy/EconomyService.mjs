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

  async settleSession(userId, { sessionId, coins }) {
    this.#assertUser(userId);
    const wallet = this.#ds.readWallet(userId);
    const session = wallet?.session;
    if (!session || session.id !== sessionId) throw new ValidationError(`no open session ${sessionId}`);
    const spend = Math.min(Math.max(0, Math.floor(coins || 0)), wallet.balance);
    if (spend > 0) {
      this.#ds.appendTransaction(userId, createTransaction({ kind: 'spend', delta: -spend, action: session.action, source: 'economy-session', ref: sessionId }));
    }
    const updated = { ...session, last_settled_at: new Date().toISOString(), settled_coins: session.settled_coins + spend };
    const next = this.#snapshot(userId, updated);
    this.#logger.debug?.('economy-session-settle', { userId, sessionId, spend, balance: next.balance });
    return { userId, balance: next.balance, depleted: next.balance <= 0 };
  }

  async closeSession(userId, { sessionId, coins = 0 }) {
    const settled = await this.settleSession(userId, { sessionId, coins });
    const next = this.#snapshot(userId, null);
    this.#logger.info('economy-session-close', { userId, sessionId, balance: next.balance });
    return { userId, balance: settled.balance };
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
