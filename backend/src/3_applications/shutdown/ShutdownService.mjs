import { ShutdownState } from '#domains/shutdown/ShutdownState.mjs';

/** Owns activation plus periodic disk→websocket→Portal reconciliation. */
export class ShutdownService {
  #repo; #notifier; #policy; #cue; #portal; #logger; #scheduleEvery; #cancelSchedule = null; #signature = null; #portalSignature = null;
  constructor({ repo, notifier, getPolicy, cue = null, portal = null, scheduleEvery = null, logger = console } = {}) {
    if (!repo || !notifier?.publishState || !getPolicy) throw new Error('ShutdownService: repo, notifier, getPolicy required');
    this.#repo = repo; this.#notifier = notifier; this.#policy = getPolicy; this.#cue = cue; this.#portal = portal;
    this.#scheduleEvery = scheduleEvery; this.#logger = logger;
  }
  async activate({ readerId, tagUid, now = Date.now() }) {
    const policy = this.#policy() || {};
    const durationSeconds = Number(policy.durationSeconds) || 1800;
    const state = new ShutdownState({
      locked_at: new Date(now).toISOString(),
      locked_until: new Date(now + durationSeconds * 1000).toISOString(),
      targets: policy.targets || [],
      source: { reader_id: readerId ?? null, tag_uid: tagUid },
    });
    await this.#repo.save(state); await this.#publish(state, 'locked');
    if (this.#cue?.announce) Promise.resolve(this.#cue.announce({ lockedUntil: state.lockedUntil, source: 'nfc-shutdown' })).catch((error) => this.#logger.warn?.('shutdown.cue_failed', { error: error.message }));
    return state;
  }
  async status(target, now = Date.now()) { const { state, invalid } = await this.#repo.read(); return { locked: invalid || (!!state && state.isActive(now) && state.includes(target)), lockedUntil: state?.lockedUntil ?? null, invalid }; }
  async #publish(state, type, invalid = false) {
    const payload = {
      type,
      locked: invalid || !!state,
      lockedUntil: state?.lockedUntil ?? null,
      targets: state?.targets ?? (invalid ? (this.#policy()?.targets || []) : []),
    };
    this.#notifier.publishState(payload);
    await this.#syncPortal(state, invalid);
  }
  async #syncPortal(state, invalid = false) {
    const desired = { locked: invalid || !!state, lockedUntil: state?.lockedUntil ?? null };
    const signature = JSON.stringify(desired);
    if (signature === this.#portalSignature) return;
    try {
      await this.#portal?.setLockdown(desired);
      this.#portalSignature = signature;
    } catch (error) {
      // Do not advance the signature: the five-second reconciler retries until
      // the panel is reachable, without weakening the server/frontend lock.
      this.#logger.warn?.('shutdown.portal_sync_failed', { error: error.message });
    }
  }
  async reconcile(now = Date.now()) {
    const { state, invalid } = await this.#repo.read(); const active = state?.isActive(now) ? state : null;
    const signature = invalid ? 'invalid' : active ? `${active.lockedUntil}:${active.targets.join(',')}` : 'clear';
    if (signature !== this.#signature) {
      this.#signature = signature;
      await this.#publish(active, active ? 'updated' : 'released', invalid);
    } else {
      await this.#syncPortal(active, invalid);
    }
  }
  start() {
    if (this.#cancelSchedule) return;
    if (typeof this.#scheduleEvery !== 'function') return;
    const seconds = Number(this.#policy()?.reconcileSeconds);
    const intervalMs = (Number.isFinite(seconds) && seconds >= 1 && seconds <= 60 ? seconds : 5) * 1000;
    void this.reconcile().catch((error) => this.#logger.warn?.('shutdown.reconcile_failed', { error: error.message }));
    this.#cancelSchedule = this.#scheduleEvery(intervalMs, () => this.reconcile().catch((error) => this.#logger.warn?.('shutdown.reconcile_failed', { error: error.message })));
  }
  dispose() { this.#cancelSchedule?.(); this.#cancelSchedule = null; }
}
