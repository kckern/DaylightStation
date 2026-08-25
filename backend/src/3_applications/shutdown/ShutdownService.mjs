import { ShutdownState } from '#domains/shutdown/ShutdownState.mjs';

/** Owns activation plus periodic disk→websocket→Portal reconciliation. */
export class ShutdownService {
  #repo; #eventBus; #config; #ha; #portal; #logger; #timer = null; #signature = null; #portalSignature = null;
  constructor({ repo, eventBus, getConfig, haGateway = null, portal = null, logger = console } = {}) {
    if (!repo || !eventBus || !getConfig) throw new Error('ShutdownService: repo, eventBus, getConfig required');
    this.#repo = repo; this.#eventBus = eventBus; this.#config = getConfig; this.#ha = haGateway; this.#portal = portal; this.#logger = logger;
  }
  #targets(cfg) { return [...(cfg.targets?.school_screen_ids || []).map((id) => `school:${id}`), ...(cfg.targets?.piano_device_ids || []).map((id) => `piano:${id}`)]; }
  async activate({ readerId, tagUid, now = Date.now() }) {
    const cfg = this.#config() || {}; const state = ShutdownState.create({ durationSeconds: Number(cfg.duration_seconds) || 1800, targets: this.#targets(cfg), source: { reader_id: readerId ?? null, tag_uid: tagUid } , now });
    await this.#repo.save(state); await this.#publish(state, 'locked');
    const script = cfg.home_assistant?.script;
    if (script && this.#ha?.callService) Promise.resolve(this.#ha.callService('script', 'turn_on', { entity_id: script, variables: { locked_until: state.lockedUntil, source: 'nfc-shutdown' } })).catch((error) => this.#logger.warn?.('shutdown.ha_failed', { error: error.message }));
    return state;
  }
  async status(target, now = Date.now()) { const { state, invalid } = await this.#repo.read(); return { locked: invalid || (!!state && state.isActive(now) && state.includes(target)), lockedUntil: state?.lockedUntil ?? null, invalid }; }
  async #publish(state, type, invalid = false) {
    const payload = {
      type,
      locked: invalid || !!state,
      lockedUntil: state?.lockedUntil ?? null,
      targets: state?.targets ?? (invalid ? this.#targets(this.#config() || {}) : []),
    };
    this.#eventBus.broadcast('shutdown.state', payload);
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
  async reconcile() {
    const { state, invalid } = await this.#repo.read(); const active = state?.isActive() ? state : null;
    const signature = invalid ? 'invalid' : active ? `${active.lockedUntil}:${active.targets.join(',')}` : 'clear';
    if (signature !== this.#signature) {
      this.#signature = signature;
      await this.#publish(active, active ? 'updated' : 'released', invalid);
    } else {
      await this.#syncPortal(active, invalid);
    }
  }
  start() {
    if (this.#timer) return;
    const seconds = Number(this.#config()?.reconcile_seconds);
    const intervalMs = (Number.isFinite(seconds) && seconds >= 1 && seconds <= 60 ? seconds : 5) * 1000;
    void this.reconcile().catch((error) => this.#logger.warn?.('shutdown.reconcile_failed', { error: error.message }));
    this.#timer = setInterval(() => this.reconcile().catch((error) => this.#logger.warn?.('shutdown.reconcile_failed', { error: error.message })), intervalMs);
  }
  dispose() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
}
