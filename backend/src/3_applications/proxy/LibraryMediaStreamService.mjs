const RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;

function validRange(value) {
  if (!RANGE.test(value)) return false;
  const [start, end] = value.slice(6).split('-');
  if (start && (!Number.isSafeInteger(Number(start)) || (end && Number(start) > Number(end)))) return false;
  if (!start && Number(end) === 0) return false;
  return !end || Number.isSafeInteger(Number(end));
}

/** Range-preserving relay for lease-scoped library-media audiobook parts. */
export class LibraryMediaStreamService {
  #leases;
  #client;
  #streamGateway;
  #now;
  #entitlementTtlMs;
  #scheduler;
  #refreshing = new Map();
  #loanState = new Map();

  constructor({ leases, client, streamGateway, scheduler, now = Date.now, entitlementTtlMs = 60_000 } = {}) {
    if (!leases?.resolve || !client?.openLoan || typeof streamGateway?.open !== 'function') throw new Error('LibraryMediaStreamService requires leases, client, and streamGateway');
    if (!['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].every((method) => typeof scheduler?.[method] === 'function')) throw new Error('LibraryMediaStreamService requires scheduler');
    this.#leases = leases;
    this.#client = client;
    this.#streamGateway = streamGateway;
    this.#now = now;
    this.#entitlementTtlMs = entitlementTtlMs;
    this.#scheduler = scheduler;
  }

  #applyFulfillment(handle, lease, loan) {
    const part = loan.parts.find((candidate) => candidate.key === lease.partKey);
    if (!part) {
      const error = new Error('Library media part no longer exists');
      error.code = 'LIBRARY_MEDIA_LOAN_EXPIRED';
      throw error;
    }
    if (!this.#leases.update(handle, { loan, part, verifiedAt: this.#now() })) {
      const error = new Error('Library media stream lease expired');
      error.code = 'LIBRARY_MEDIA_LEASE_EXPIRED';
      throw error;
    }
    const updated = this.#leases.resolve(handle);
    if (updated.kind !== 'found') {
      const error = new Error('Library media stream lease expired');
      error.code = 'LIBRARY_MEDIA_LEASE_EXPIRED';
      throw error;
    }
    return updated.lease;
  }

  async #refresh(handle, lease, force = false, observedGeneration = 0) {
    const current = this.#leases.resolve(handle);
    if (current.kind !== 'found') {
      const error = new Error('Library media stream lease expired');
      error.code = 'LIBRARY_MEDIA_LEASE_EXPIRED';
      throw error;
    }
    lease = current.lease;
    const key = `${lease.cardId}:${lease.titleId}`;
    const state = this.#loanState.get(key);
    if (force && state?.loan && state.generation > observedGeneration) {
      return this.#applyFulfillment(handle, lease, state.loan);
    }
    if (!force && this.#now() - lease.verifiedAt < this.#entitlementTtlMs) return lease;
    if (!this.#refreshing.has(key)) {
      this.#refreshing.set(key, this.#client.openLoan({ cardId: lease.cardId, titleId: lease.titleId })
        .then((loan) => {
          const previous = this.#loanState.get(key);
          const next = { generation: (previous?.generation || 0) + 1, loan };
          this.#loanState.set(key, next);
          const timer = this.#scheduler.setTimeout(() => {
            if (this.#loanState.get(key) === next) this.#loanState.delete(key);
          }, this.#entitlementTtlMs);
          timer.unref?.();
          return next;
        })
        .finally(() => this.#refreshing.delete(key)));
    }
    const fulfillment = await this.#refreshing.get(key);
    return this.#applyFulfillment(handle, lease, fulfillment.loan);
  }

  async open({ handle, method = 'GET', range = null, signal = null } = {}) {
    if (range && !validRange(range)) return { kind: 'invalid_range' };
    if (signal?.aborted) return { kind: 'upstream_error', reason: 'cancelled' };
    const resolved = this.#leases.resolve(handle);
    if (resolved.kind !== 'found') return resolved;
    let lease;
    try { lease = await this.#refresh(handle, resolved.lease); }
    catch (error) {
      if (error?.code === 'LIBRARY_MEDIA_CREDENTIAL_UNAVAILABLE') return { kind: 'credential_unavailable' };
      if (error?.code === 'LIBRARY_MEDIA_LEASE_EXPIRED') {
        this.#leases.revoke(handle);
        return { kind: 'gone', reason: 'lease_expired' };
      }
      if (['LIBRARY_MEDIA_LOAN_EXPIRED', 'LIBRARY_MEDIA_LOAN_NOT_FOUND'].includes(error?.code)) {
        this.#leases.revokeLoan(resolved.lease.cardId, resolved.lease.titleId);
        return { kind: 'gone', reason: 'loan_unavailable' };
      }
      return { kind: 'upstream_error', reason: error?.code || 'entitlement_failed' };
    }
    const controller = new AbortController();
    const detach = this.#leases.attachAbort(handle, controller);
    const abort = () => controller.abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let handedOff = false;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      controller.abort();
      signal?.removeEventListener?.('abort', abort);
      detach();
    };
    try {
      const request = () => this.#streamGateway.open({
        source: lease.part, method, range, signal: controller.signal,
      });
      const loanKey = `${lease.cardId}:${lease.titleId}`;
      const requestGeneration = this.#loanState.get(loanKey)?.generation || 0;
      let upstream = await request();
      if (upstream.kind === 'unauthorized') {
        try { lease = await this.#refresh(handle, lease, true, requestGeneration); }
        catch (error) {
          if (error?.code === 'LIBRARY_MEDIA_CREDENTIAL_UNAVAILABLE') return { kind: 'credential_unavailable' };
          if (error?.code === 'LIBRARY_MEDIA_LEASE_EXPIRED') {
            this.#leases.revoke(handle);
            return { kind: 'gone', reason: 'lease_expired' };
          }
          if (['LIBRARY_MEDIA_LOAN_EXPIRED', 'LIBRARY_MEDIA_LOAN_NOT_FOUND'].includes(error?.code)) {
            this.#leases.revokeLoan(lease.cardId, lease.titleId);
            return { kind: 'gone', reason: 'loan_unavailable' };
          }
          return { kind: 'upstream_error', reason: error?.code || 'entitlement_failed' };
        }
        upstream = await request();
      }
      if (upstream.kind !== 'opened') return upstream;
      let active = true;
      const entitlementTimer = this.#scheduler.setInterval(async () => {
        if (!active) return;
        try { lease = await this.#refresh(handle, lease); }
        catch (error) {
          if (['LIBRARY_MEDIA_LOAN_EXPIRED', 'LIBRARY_MEDIA_LOAN_NOT_FOUND'].includes(error?.code)) {
            this.#leases.revokeLoan(lease.cardId, lease.titleId);
          } else this.#leases.revoke(handle);
        }
      }, this.#entitlementTtlMs);
      entitlementTimer.unref?.();
      const deadlineMs = Math.max(0, lease.absoluteExpiresAt - this.#now());
      const deadlineTimer = this.#scheduler.setTimeout(() => this.#leases.revoke(handle), Math.min(deadlineMs, 2_147_483_647));
      deadlineTimer.unref?.();
      const streamCleanup = () => {
        if (!active) return;
        active = false;
        this.#scheduler.clearInterval(entitlementTimer);
        this.#scheduler.clearTimeout(deadlineTimer);
        cleanup();
      };
      handedOff = true;
      return {
        ...upstream,
        cleanup: streamCleanup,
      };
    } finally {
      if (!handedOff) cleanup();
    }
  }
}

export default LibraryMediaStreamService;
