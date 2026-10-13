const DAY_MS = 24 * 60 * 60 * 1000;
// Identities are issued with a 7-day life. Renewing once a day keeps remaining
// life pinned near the maximum, which is the outage budget: a host that has been
// off for less than that recovers on its own, and one that exceeds it must
// re-pair through the provider's chip/clone/code ceremony.
const DEFAULT_RENEW_WHEN_REMAINING_MS = 6 * DAY_MS;

/**
 * Keeps the stored Libby identity fresh independently of playback. Renewal is
 * usage-independent by design: the failure case is nobody opening an audiobook
 * for a week.
 */
export class LibbyIdentityRenewalService {
  #credentials;
  #client;
  #now;
  #logger;
  #threshold;
  #inFlight = null;

  constructor({ credentials, client, now = Date.now, logger = console,
    renewWhenRemainingMs = DEFAULT_RENEW_WHEN_REMAINING_MS } = {}) {
    if (typeof credentials?.getSnapshot !== 'function' || typeof credentials?.persist !== 'function') {
      throw new Error('LibbyIdentityRenewalService requires credentials');
    }
    if (typeof client?.renewIdentity !== 'function') {
      throw new Error('LibbyIdentityRenewalService requires client');
    }
    this.#credentials = credentials;
    this.#client = client;
    this.#now = now;
    this.#logger = logger;
    this.#threshold = renewWhenRemainingMs;
  }

  // The never-throw contract has to cover the logger too, not just the body.
  #log(level, event, data) {
    try { this.#logger?.[level]?.(event, data); } catch { /* logging must never break renewal */ }
  }

  /** Milliseconds until the identity falls due; 0 means due now (or unreadable). */
  msUntilDue() {
    try {
      const { expiresAt } = this.#credentials.getSnapshot();
      if (!Number.isFinite(expiresAt)) return 0;
      return Math.max(0, (expiresAt - this.#threshold) - this.#now());
    } catch {
      return 0;
    }
  }

  async renewIfDue() {
    if (this.msUntilDue() > 0) return { status: 'skipped' };
    return this.renewNow();
  }

  /** Single-flight: concurrent triggers share one provider call. */
  async renewNow() {
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = this.#run().finally(() => { this.#inFlight = null; });
    return this.#inFlight;
  }

  async #run() {
    try {
      const { identity, expiresAt } = await this.#client.renewIdentity();
      await this.#credentials.persist(identity);
      this.#log('info', 'libby.identity.renewed', { expiresAt: new Date(expiresAt).toISOString() });
      return { status: 'renewed', expiresAt };
    } catch (error) {
      // Codes only: provider messages can carry credential material.
      this.#log('error', 'libby.identity.renewal_failed', { code: error?.code ?? error?.name ?? 'unknown' });
      return { status: 'failed' };
    }
  }
}

/**
 * Drive renewal off the credential's own expiry rather than a fixed schedule,
 * so the cadence stays correct if the provider changes identity lifetimes and
 * re-derives itself after a restart. Returns a dispose function.
 */
export function startIdentityRenewal({ service, scheduler = { setTimeout, clearTimeout },
  retryFloorMs = 15 * 60 * 1000, maxDelayMs = 6 * 60 * 60 * 1000 } = {}) {
  if (typeof service?.msUntilDue !== 'function' || typeof service?.renewIfDue !== 'function') {
    throw new Error('startIdentityRenewal requires a renewal service');
  }
  let timer = null;
  let stopped = false;

  // floorMs keeps a permanently-overdue identity (provider rejecting us) from
  // spinning the loop: without it msUntilDue stays 0 and we would retry forever.
  const arm = (floorMs) => {
    if (stopped) return;
    const delay = Math.min(Math.max(service.msUntilDue(), floorMs), maxDelayMs);
    timer = scheduler.setTimeout(async () => {
      if (stopped) return;
      const result = await service.renewIfDue();
      arm(result?.status === 'renewed' ? 0 : retryFloorMs);
    }, delay);
    timer?.unref?.();
  };

  arm(0);
  return () => {
    stopped = true;
    if (timer) scheduler.clearTimeout(timer);
  };
}

export default LibbyIdentityRenewalService;
