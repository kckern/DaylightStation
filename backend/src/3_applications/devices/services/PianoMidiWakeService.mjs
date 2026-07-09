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

import WebSocket from 'ws';

const DEFAULT_COOLDOWN_MS = 8000;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 30000;

export class PianoMidiWakeService {
  #deviceService; #logger; #clock;
  #deviceId; #bridgeUrl; #cooldownMs;
  #WebSocketImpl; #backoffBaseMs; #backoffMaxMs;

  #ws;
  #stopped;
  #backoff;
  #lastWakeAt;   // ms of the last wake fired, or null (never)
  #waking;       // in-flight guard so a burst can't stack setScreen calls
  #screenOverride; // shared ScreenOverrideService; note-ons are muted while its window is 'off'
  #fetchImpl;    // injectable fetch for the APK /config relay (tests)

  /**
   * @param {Object} opts
   * @param {{get:Function}} opts.deviceService
   * @param {string} opts.deviceId - FKB tablet device id (e.g. 'yellow-room-tablet')
   * @param {string} opts.bridgeUrl - piano-bridge WS control plane (ws://host:8770)
   * @param {Object} [opts.logger]
   * @param {{now:()=>number}} [opts.clock]
   * @param {number} [opts.cooldownMs] - min gap between wake pokes (debounce)
   * @param {Function} [opts.WebSocketImpl] - injectable WS ctor for tests
   * @param {number} [opts.backoffBaseMs]
   * @param {number} [opts.backoffMaxMs]
   */
  constructor({
    deviceService, deviceId, bridgeUrl,
    logger = console, clock = Date,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    WebSocketImpl = WebSocket,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    backoffMaxMs = DEFAULT_BACKOFF_MAX_MS,
    fetchImpl,
    screenOverride = null,
  } = {}) {
    if (!deviceService || typeof deviceService.get !== 'function') {
      throw new Error('PianoMidiWakeService requires deviceService with get');
    }
    if (!deviceId) throw new Error('PianoMidiWakeService requires deviceId');
    if (!bridgeUrl) throw new Error('PianoMidiWakeService requires bridgeUrl');

    this.#deviceService = deviceService;
    this.#deviceId = deviceId;
    this.#bridgeUrl = bridgeUrl;
    this.#logger = logger;
    this.#clock = clock;
    this.#cooldownMs = cooldownMs;
    this.#WebSocketImpl = WebSocketImpl;
    this.#backoffBaseMs = backoffBaseMs;
    this.#backoffMaxMs = backoffMaxMs;

    this.#ws = null;
    this.#stopped = false;
    this.#backoff = backoffBaseMs;
    this.#lastWakeAt = null;
    this.#waking = false;
    this.#screenOverride = screenOverride;
    this.#fetchImpl = fetchImpl ?? ((...a) => fetch(...a));
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
    // ws://host:port → http://host:port/config (POST a flat key: value YAML line,
    // which the APK's /config endpoint hot-reloads and rebuilds ScreenWaker from).
    const httpBase = this.#bridgeUrl.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
    const url = `${httpBase}/config`;
    try {
      Promise.resolve(this.#fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `fkbWakeSuppressUntilEpochMs: ${deadlineMs}\n`,
      })).catch((err) => this.#logger.warn?.('piano-midi-wake.suppress-relay-failed', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      }));
    } catch (err) {
      this.#logger.warn?.('piano-midi-wake.suppress-relay-failed', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      });
    }
  }

  /** Test seam: exercise the note-on handler without a live WS. */
  _handleNoteOnForTest() { this.#onNoteOn(); }

  start() {
    this.#stopped = false;
    this.#logger.info?.('piano-midi-wake.started', {
      deviceId: this.#deviceId, bridgeUrl: this.#bridgeUrl, cooldownMs: this.#cooldownMs,
    });
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    try { this.#ws?.close(); } catch { /* ignore */ }
    this.#ws = null;
  }

  /** @private Open (or reopen) the WS to the bridge; reconnect with backoff. */
  #connect() {
    if (this.#stopped) return;
    let ws;
    try {
      ws = new this.#WebSocketImpl(this.#bridgeUrl);
    } catch (err) {
      this.#logger.warn?.('piano-midi-wake.ws.error', { error: String(err?.message ?? err) });
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;

    ws.on('open', () => {
      this.#backoff = this.#backoffBaseMs; // reset backoff on a good connection
      this.#logger.info?.('piano-midi-wake.ws.open', { bridgeUrl: this.#bridgeUrl });
    });
    ws.on('message', (data) => this.#onMessage(data));
    // A dead socket emits 'error' then 'close'; reconnect from 'close' only so we
    // schedule exactly one retry per drop.
    ws.on('error', (err) => {
      this.#logger.warn?.('piano-midi-wake.ws.error', { error: String(err?.message ?? err) });
    });
    ws.on('close', () => {
      this.#ws = null;
      this.#scheduleReconnect();
    });
  }

  /** @private */
  #scheduleReconnect() {
    if (this.#stopped) return;
    const inMs = this.#backoff;
    this.#logger.warn?.('piano-midi-wake.ws.reconnect', { inMs });
    const t = setTimeout(() => this.#connect(), inMs);
    t.unref?.();
    this.#backoff = Math.min(this.#backoff * 2, this.#backoffMaxMs);
  }

  /** @private */
  #onMessage(data) {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg?.type !== 'note.on') return;
    this.#onNoteOn();
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
