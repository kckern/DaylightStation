// backend/src/3_applications/devices/services/AndroidExcursionGuard.mjs

/**
 * Keeps a kiosk's short trip into another Android app on a leash.
 *
 * Fully Kiosk only blocks apps that something OTHER than Fully launches. An app
 * Fully itself opened (the menu's `fully.startIntent`) is let through, and while
 * it is in front Fully lets the rest of that app's package through too. So the
 * menu's "Pair Controller" entry, which opens Settings' pairing screen, also
 * opens a door to all of Shield Settings for as long as that screen is up.
 *
 * This guard closes the door for exactly that window. It is started by the
 * launch, polls the foreground screen, and returns the device to the kiosk the
 * moment the excursion reaches a screen its policy does not allow. It stops as
 * soon as the kiosk is back in front — it never runs while nobody has left.
 *
 * Only packages with a policy are guarded; launching Zoom starts nothing.
 */

const DEFAULT_INTERVAL_MS = 1500;
/** Grace for the launch itself: the kiosk is still in front for a beat after startIntent. */
const DEFAULT_LAUNCH_GRACE_MS = 10_000;
const DEFAULT_MAX_MS = 10 * 60_000;
const MAX_PROBE_FAILURES = 5;

/** `.accessories.X` and `com.android.tv.settings.accessories.X` are the same screen. */
function shortActivity(pkg, activity) {
  if (!activity) return '';
  return activity.startsWith(`${pkg}.`) ? activity.slice(pkg.length) : activity;
}

export class AndroidExcursionGuard {
  #probeFor; #policies; #kioskPackage; #scheduler; #clock; #logger;
  #intervalMs; #launchGraceMs;
  #running = new Map();

  /**
   * @param {Object} deps
   * @param {(deviceId: string) => ({foreground: Function, returnToKiosk: Function}|null)} deps.probeFor
   * @param {Object<string, {allow: string[], maxMs?: number}>} deps.policies - keyed by package
   * @param {string} deps.kioskPackage
   * @param {{every: Function}} deps.scheduler
   */
  constructor({ probeFor, policies = {}, kioskPackage, scheduler, clock = () => Date.now(),
    intervalMs = DEFAULT_INTERVAL_MS, launchGraceMs = DEFAULT_LAUNCH_GRACE_MS, logger = console }) {
    if (typeof probeFor !== 'function') throw new TypeError('AndroidExcursionGuard requires probeFor');
    if (!kioskPackage) throw new TypeError('AndroidExcursionGuard requires kioskPackage');
    if (typeof scheduler?.every !== 'function') throw new TypeError('AndroidExcursionGuard requires a scheduler');
    this.#probeFor = probeFor;
    this.#policies = policies;
    this.#kioskPackage = kioskPackage;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#intervalMs = intervalMs;
    this.#launchGraceMs = launchGraceMs;
    this.#logger = logger;
  }

  /**
   * Begin guarding an excursion the kiosk just launched.
   * @returns {{guarded: boolean, reason?: string}}
   */
  start({ deviceId, package: pkg, activity }) {
    const policy = this.#policies[pkg];
    if (!policy) return { guarded: false, reason: 'no-policy' };
    const probe = this.#probeFor(deviceId);
    if (!probe) {
      this.#logger.warn?.('device.excursion.unguarded', { deviceId, package: pkg, reason: 'no-probe' });
      return { guarded: false, reason: 'no-probe' };
    }

    this.#stop(deviceId);
    const state = {
      deviceId, pkg, policy, probe,
      startedAt: this.#clock(),
      maxMs: policy.maxMs ?? DEFAULT_MAX_MS,
      left: false, failures: 0, busy: false, cancel: null,
    };
    state.cancel = this.#scheduler.every(this.#intervalMs, () => this.#check(state));
    this.#running.set(deviceId, state);
    this.#logger.info?.('device.excursion.started', { deviceId, package: pkg, activity, maxMs: state.maxMs });
    return { guarded: true };
  }

  async #check(state) {
    if (state.busy || this.#running.get(state.deviceId) !== state) return;
    state.busy = true;
    try {
      const elapsedMs = this.#clock() - state.startedAt;
      const front = await state.probe.foreground();
      if (!front) {
        state.failures += 1;
        if (state.failures >= MAX_PROBE_FAILURES) this.#end(state, 'probe-failed', elapsedMs, 'warn');
        return;
      }
      state.failures = 0;

      if (front.package === this.#kioskPackage) {
        if (state.left) return this.#end(state, 'returned', elapsedMs);
        if (elapsedMs > this.#launchGraceMs) return this.#end(state, 'never-left', elapsedMs);
        return;
      }

      state.left = true;
      const allowed = front.package === state.pkg
        && state.policy.allow.some((prefix) => shortActivity(front.package, front.activity).startsWith(prefix));
      if (!allowed) return this.#trip(state, 'outside-policy', front, elapsedMs);
      if (elapsedMs > state.maxMs) return this.#trip(state, 'max-duration', front, elapsedMs);
    } finally {
      state.busy = false;
    }
  }

  async #trip(state, reason, front, elapsedMs) {
    this.#logger.warn?.('device.excursion.tripped', {
      deviceId: state.deviceId, reason, elapsedMs,
      foreground: `${front.package}/${front.activity}`,
    });
    this.#end(state, reason, elapsedMs, 'warn');
    const result = await state.probe.returnToKiosk();
    if (!result?.ok) {
      this.#logger.warn?.('device.excursion.return_failed', { deviceId: state.deviceId, error: result?.error });
    }
  }

  #end(state, reason, elapsedMs, level = 'info') {
    this.#stop(state.deviceId);
    this.#logger[level]?.('device.excursion.ended', { deviceId: state.deviceId, package: state.pkg, reason, elapsedMs });
  }

  #stop(deviceId) {
    const state = this.#running.get(deviceId);
    if (!state) return;
    state.cancel?.();
    this.#running.delete(deviceId);
  }
}

export default AndroidExcursionGuard;
