/**
 * PianoMidiWakeService — wakes the yellow-room piano tablet's FKB backlight when
 * someone plays the piano, using an always-on signal that survives a dark WebView.
 *
 * Why this exists (see docs/_wip/plans/2026-07-01-piano-tablet-screen-power-sync.md,
 * "The three wake paths" → optional hardening):
 *   The in-browser screensaver's MIDI/touch wake is unreliable once the backlight
 *   is off — a backgrounded WebView gets its timers + Web MIDI throttled/suspended
 *   and touch is not delivered to it. So a manual "Turn off screen" (or an idle
 *   sleep) could strand the tablet dark with no way back short of FKB REST.
 *
 *   The piano-bridge APK (net.kckern.pianobridge) owns the BLE-MIDI device
 *   directly via Android MidiManager and runs as a foreground service, so it keeps
 *   receiving note-ons regardless of display state and fans them out over its
 *   WebSocket control plane (ws://<tablet>:8770) as `{"type":"note.on"}`. This
 *   service is a thin always-on WS client of that fan-out: on a note-on it calls
 *   `device.setScreen(true)` (FKB screenOn), debounced so a run of notes pokes FKB
 *   at most once per `cooldownMs`.
 *
 * Coordination with PianoScreenAuthorityService: no conflict. That service only
 * force-OFFs when the piano reads OFF (no power ⇒ no MIDI ⇒ no wake here) and
 * force-ONs only on the piano power edge. While the piano is ON it leaves the
 * screen to other writers — this MIDI wake is exactly such a writer, and a
 * force-ON when the screen is already on is a harmless FKB no-op.
 *
 * @module 3_applications/devices/services/PianoMidiWakeService
 */

const DEFAULT_COOLDOWN_MS = 8000;

export class PianoMidiWakeService {
  #deviceService; #logger; #clock;
  #deviceId; #cooldownMs; #bridge;
  #lastWakeAt;   // ms of the last wake fired, or null (never)
  #waking;       // in-flight guard so a burst can't stack setScreen calls
  #screenOverride; // shared ScreenOverrideService; note-ons are muted while its window is 'off'
  #lastRelay;    // in-flight APK config relay promise (test seam)

  /**
   * @param {Object} opts
   * @param {{get:Function}} opts.deviceService
   * @param {string} opts.deviceId - FKB tablet device id (e.g. 'yellow-room-tablet')
   * @param {IPianoMidiBridge} opts.bridge - piano-bridge transport capability
   * @param {Object} [opts.logger]
   * @param {{now:()=>number}} [opts.clock]
   * @param {number} [opts.cooldownMs] - min gap between wake pokes (debounce)
   */
  constructor({
    deviceService, deviceId, bridge,
    logger = console, clock = Date,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    screenOverride = null,
  } = {}) {
    if (!deviceService || typeof deviceService.get !== 'function') {
      throw new Error('PianoMidiWakeService requires deviceService with get');
    }
    if (!deviceId) throw new Error('PianoMidiWakeService requires deviceId');
    if (!bridge || typeof bridge.start !== 'function' || typeof bridge.stop !== 'function' ||
        typeof bridge.suppressWakeUntil !== 'function') {
      throw new Error('PianoMidiWakeService requires bridge');
    }

    this.#deviceService = deviceService;
    this.#deviceId = deviceId;
    this.#bridge = bridge;
    this.#logger = logger;
    this.#clock = clock;
    this.#cooldownMs = cooldownMs;
    this.#lastWakeAt = null;
    this.#waking = false;
    this.#screenOverride = screenOverride;
  }

  /**
   * Mute MIDI-driven screen wakes until `deadlineMs` (epoch-ms). Skips this
   * service's own FKB pokes AND relays the deadline to the piano-bridge APK's
   * control plane so its on-device ScreenWaker is muted too (no APK rebuild —
   * the APK reads fkbWakeSuppressUntilEpochMs in ScreenWaker.poke()).
   * @param {number} deadlineMs
   */
  suppressWakeUntil(deadlineMs) {
    const minutes = Math.max(0, (deadlineMs - this.#clock.now()) / 60_000);
    this.#screenOverride?.set(this.#deviceId, 'off', minutes);
    this.#logger.info?.('piano-midi-wake.suppressed', {
      deviceId: this.#deviceId, until: deadlineMs,
    });
    // Relay the deadline to the APK's on-device ScreenWaker. CRITICAL: the APK's
    // POST /config *REPLACES* the whole override file (DeviceConfig.writeOverride
    // truncates), so posting a lone `fkbWakeSuppressUntilEpochMs` erases targetMac
    // and strands the piano with no BLE-MIDI link — the exact outage of 2026-07-15.
    // Read-merge-write instead (mirrors pbctl config set): GET the live config,
    // merge our one key, POST the full set back. If the config can't be read, do
    // NOT write — a blind partial POST is the clobber, so failing safe (skipping
    // the on-device relay) keeps the MIDI link alive.
    this.#lastRelay = Promise.resolve(this.#bridge.suppressWakeUntil(deadlineMs));
  }

  /** Test seam: await the in-flight APK config relay. */
  _relayDone() { return this.#lastRelay ?? Promise.resolve(); }

  /** Test seam: exercise the note-on handler without a live WS. */
  _handleNoteOnForTest() { this.#onNoteOn(); }

  start() {
    this.#logger.info?.('piano-midi-wake.started', {
      deviceId: this.#deviceId, cooldownMs: this.#cooldownMs,
    });
    this.#bridge.start(() => this.#onNoteOn());
  }

  stop() {
    this.#bridge.stop();
  }

  /** @private Debounced wake: at most one setScreen(true) per cooldown window. */
  #onNoteOn() {
    const now = this.#clock.now();
    if (this.#screenOverride?.get(this.#deviceId)?.state === 'off') return; // manually muted
    if (this.#lastWakeAt !== null && now - this.#lastWakeAt < this.#cooldownMs) return;
    if (this.#waking) return;
    this.#lastWakeAt = now;
    this.#waking = true;
    Promise.resolve(this.#wake()).finally(() => { this.#waking = false; });
  }

  /** @private */
  async #wake() {
    const device = this.#deviceService.get(this.#deviceId);
    if (!device) {
      this.#logger.warn?.('piano-midi-wake.no-device', { deviceId: this.#deviceId });
      return;
    }
    try {
      const res = await device.setScreen(true);
      if (res?.ok === false) {
        this.#logger.warn?.('piano-midi-wake.rejected', { deviceId: this.#deviceId, error: res.error });
      } else {
        this.#logger.info?.('piano-midi-wake.woke', { deviceId: this.#deviceId });
      }
    } catch (err) {
      this.#logger.warn?.('piano-midi-wake.failed', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      });
    }
  }
}

export default PianoMidiWakeService;
