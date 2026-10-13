/** Application workflow for emergency authorization, lockdown, and session finalization. */
export class EmergencyLockdownService {
  constructor({ access = null, trigger = null, release = null, state = null,
    sessions = null, timelapse = null, clock = { now: () => Date.now() }, logger = console } = {}) {
    this.access = access;
    this.trigger = trigger;
    this.releaseLockdown = release;
    this.state = state;
    this.sessions = sessions;
    this.timelapse = timelapse;
    this.clock = clock;
    this.logger = logger;
  }

  nowSeconds() { return Math.floor(this.clock.now() / 1000); }

  async current() {
    const state = this.state ? await this.state.execute({ now: this.nowSeconds() }) : null;
    this.logger.debug?.('emergency.state_query', { locked: !!state, lockedUntil: state?.lockedUntil ?? null });
    return state ? { locked: true, lockedUntil: state.lockedUntil, lockedBy: state.lockedBy } : { locked: false };
  }

  async commit(householdId) {
    const now = this.nowSeconds();
    const existing = this.state ? await this.state.execute({ now }) : null;
    if (existing) {
      this.logger.info?.('emergency.commit_idempotent', { lockedBy: existing.lockedBy });
      return { kind: 'committed', state: existing };
    }
    const pending = this.access?.consumeCommitAuthorization?.();
    if (!pending) {
      this.logger.warn?.('emergency.commit_rejected', { reason: 'no-pending-detection' });
      return { kind: 'no_pending' };
    }
    if (!this.trigger) {
      this.logger.warn?.('emergency.commit_rejected', { reason: 'unavailable', lockedBy: pending.userId });
      return { kind: 'unavailable' };
    }
    this.logger.info?.('emergency.commit_accepted', { lockedBy: pending.userId });
    const state = await this.trigger.execute({ lockedBy: pending.userId, now });
    this.logger.info?.('emergency.committed', { lockedBy: pending.userId, lockedUntil: state.lockedUntil });
    this.finalizeSessions(householdId, pending.userId);
    return { kind: 'committed', state };
  }

  finalizeSessions(householdId, lockedBy) {
    if (!this.sessions) return;
    Promise.resolve().then(async () => {
      const active = await this.sessions.getActiveSessions(householdId);
      for (const session of active) {
        const sessionId = session.sessionId?.toString();
        if (!sessionId) continue;
        await this.sessions.endSession(sessionId, householdId, this.clock.now());
        this.logger.info?.('emergency.session_finalized', { sessionId, lockedBy });
        if (this.timelapse) Promise.resolve(this.timelapse.execute({ sessionId, householdId }))
          .then((result) => this.logger.info?.('fitness.timelapse.trigger_done', { sessionId, status: result?.status, via: 'emergency' }))
          .catch((error) => this.logger.error?.('fitness.timelapse.trigger_failed', { sessionId, error: error?.message, via: 'emergency' }));
      }
    }).catch((error) => this.logger.error?.('emergency.session_finalize_failed', { error: error?.message, lockedBy }));
  }

  abort() {
    const pending = this.access?.confirmAbort?.();
    this.logger.info?.(pending ? 'emergency.cancelled' : 'emergency.cancel_denied', pending
      ? { userId: pending.userId } : { reason: 'no-pending-detection' });
    return { confirmed: Boolean(pending) };
  }

  async release(householdId) {
    const authorization = this.access ? await this.access.authorizeRelease(householdId) : { kind: 'unlock_unavailable' };
    if (authorization.kind === 'unlock_unavailable') {
      this.logger.warn?.('emergency.release_denied', { reason: 'unlock-service-unavailable' });
      return { kind: 'unavailable' };
    }
    if (authorization.kind === 'scan_failed') return { kind: 'scan_failed' };
    if (authorization.kind === 'no_candidates') {
      this.logger.warn?.('emergency.release_denied', { reason: 'no-admin-candidates' });
      return { kind: 'denied' };
    }
    if (authorization.kind === 'denied') {
      this.logger.info?.('emergency.release_denied', { reason: authorization.reason });
      return { kind: 'denied' };
    }
    if (this.releaseLockdown) await this.releaseLockdown.execute({ by: authorization.userId, now: this.nowSeconds() });
    this.logger.info?.('emergency.released', { userId: authorization.userId });
    return { kind: 'released' };
  }
}

export default EmergencyLockdownService;
