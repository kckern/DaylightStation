/**
 * PlaybackHubSurface — the DoNow adapter for the headset playback hub (spec
 * §5, surface id `playback-hub`).
 *
 * Dispatch delegates straight to the existing `SendHubCommand` use case
 * (`backend/src/3_applications/playback-hub/usecases/SendHubCommand.mjs`),
 * which already owns target expansion (`red`/`red,blue`/`all`/…),
 * per-device volume clamping, and the applied/skipped accounting — this
 * adapter adds nothing beyond translating the DoNow action shape into that
 * use case's `execute()` call.
 *
 * Occupancy is a SYNCHRONOUS probe against the same gateway `SendHubCommand`
 * wraps (`IPlaybackHubGateway.getStatus()`, see
 * `HttpPlaybackHubAdapter.getStatus`): any slot in the target's color set
 * reporting `now_playing` truthy and not `paused` counts as busy (the same
 * "paused counts as idle" semantics the deploy gate and the livingroom
 * surface both use). `headsetHubGateway` is a SEPARATE injected dep from
 * `sendHubCommand` — `SendHubCommand` does not expose the raw gateway, and
 * occupancy has no reason to route through command-building.
 *
 * `IDoNowSurface.occupancy()` is called with no arguments by `DoNowService`
 * (it probes speculatively, ahead of knowing whether a request will even be
 * approved) — so with no action to scope to, this checks whether ANYTHING
 * on the hub is currently playing. Callers that know which slots they are
 * about to target (tests, or a future direct probe) may pass the action
 * through `occupancy(action)` to scope the check to just that target's
 * color set.
 */
export class PlaybackHubSurface {
  #sendHubCommand;
  #gateway;
  #logger;

  /**
   * @param {Object} config
   * @param {{execute: Function}} [config.sendHubCommand] - SendHubCommand-shaped; optional
   * @param {{getStatus: Function}} [config.headsetHubGateway] - IPlaybackHubGateway-shaped; optional
   * @param {Object} [config.logger]
   */
  constructor({ sendHubCommand = null, headsetHubGateway = null, logger = console } = {}) {
    this.#sendHubCommand = sendHubCommand;
    this.#gateway = headsetHubGateway;
    this.#logger = logger;
  }

  get id() { return 'playback-hub'; }

  /** @param {{action: string, target: string, contentId?: string, volume?: number, durationMin?: number}} raw */
  validateAction(raw) {
    const errors = [];
    if (!raw || typeof raw !== 'object') return ['action must be an object'];
    if (typeof raw.action !== 'string' || raw.action.length === 0) errors.push('action.action is required');
    if (typeof raw.target !== 'string' || raw.target.length === 0) errors.push('action.target is required');
    return errors;
  }

  /**
   * @param {{target?: string}} [action] - optional; scopes the probe to this target's colors
   * @returns {Promise<{state: 'idle'|'active'|'unknown', occupantId: null}>}
   */
  async occupancy(action) {
    if (!this.#gateway) return { state: 'unknown', occupantId: null };
    let slots;
    try {
      slots = await this.#gateway.getStatus();
    } catch (err) {
      this.#logger.warn?.('donow.playback-hub.occupancy-failed', { error: err?.message || String(err) });
      return { state: 'unknown', occupantId: null };
    }
    const colors = this.#targetColors(action?.target);
    const relevant = colors ? slots.filter((s) => colors.has(s.color)) : slots;
    const playing = relevant.some((s) => Boolean(s.now_playing) && !s.paused);
    return { state: playing ? 'active' : 'idle', occupantId: null };
  }

  /** @returns {Promise<{dispatched: boolean, detail?: *}>} */
  async dispatch({ action }) {
    if (!this.#sendHubCommand) return { dispatched: false };
    try {
      const result = await this.#sendHubCommand.execute(action);
      const applied = result?.applied ?? [];
      return { dispatched: applied.length > 0, detail: result };
    } catch (err) {
      this.#logger.warn?.('donow.playback-hub.dispatch-failed', { error: err?.message || String(err) });
      return { dispatched: false };
    }
  }

  label() { return 'The headset playback hub'; }

  /** Parse a `target` string into a Set of colors, or null for group keywords we can't resolve without HubConfig. */
  #targetColors(target) {
    if (typeof target !== 'string' || target.length === 0) return null;
    if (target === 'all' || target === 'all-private' || target === 'all-public') return null;
    const colors = target.split(',').map((s) => s.trim()).filter(Boolean);
    return colors.length ? new Set(colors) : null;
  }
}

export default PlaybackHubSurface;
