import WebSocket from 'ws';
import { IPianoMidiBridge } from "../../application/bridge/ports/IPianoMidiBridge.mjs";

const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 30000;
const SUPPRESS_SETTING = 'power.wakeSuppressUntilSec';
/** The setting is a 32-bit integer on the device. */
const SUPPRESS_MAX_SEC = 2147483647;

/**
 * Transport adapter for the bridge's note WebSocket, and on the old piano-bridge
 * APK its config endpoint.
 *
 * `headers` go on the WebSocket upgrade and the relay: the DaylightStation
 * Android app's control port refuses both without its token header.
 *
 * `relay` says how a wake-suppress deadline reaches the device's own note wake:
 * - `config` (default): the old APK's `fkbWakeSuppressUntilEpochMs`, by a
 *   read-merge-write of its `/config` (a lone POST would erase the rest of it).
 * - `setting`: the Android app's `power.wakeSuppressUntilSec` (epoch seconds,
 *   0 = none), by `POST /settings`. One key per request, so nothing else is touched.
 * See composition/bridge-endpoint.mjs.
 */
export class PianoMidiBridgeAdapter extends IPianoMidiBridge {
  #bridgeUrl; #logger; #WebSocketImpl; #fetchImpl; #headers; #relay; #now;
  #backoffBaseMs; #backoffMaxMs; #backoff; #ws; #stopped; #onNoteOn;

  constructor({
    bridgeUrl,
    logger = console,
    WebSocketImpl = WebSocket,
    fetchImpl = globalThis.fetch,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    backoffMaxMs = DEFAULT_BACKOFF_MAX_MS,
    headers = {},
    relay = 'config',
    now = () => Date.now(),
  } = {}) {
    super();
    if (!bridgeUrl) throw new Error('PianoMidiBridgeAdapter requires bridgeUrl');
    if (typeof fetchImpl !== 'function') throw new Error('PianoMidiBridgeAdapter requires fetchImpl');
    this.#bridgeUrl = bridgeUrl;
    this.#logger = logger;
    this.#WebSocketImpl = WebSocketImpl;
    this.#fetchImpl = fetchImpl;
    this.#backoffBaseMs = backoffBaseMs;
    this.#backoffMaxMs = backoffMaxMs;
    this.#backoff = backoffBaseMs;
    this.#ws = null;
    this.#stopped = false;
    this.#onNoteOn = null;
    this.#headers = { ...headers };
    if (relay !== 'config' && relay !== 'setting') throw new Error(`PianoMidiBridgeAdapter relay must be config or setting, not ${relay}`);
    this.#relay = relay;
    this.#now = now;
  }

  start(onNoteOn) {
    if (typeof onNoteOn !== 'function') throw new Error('PianoMidiBridgeAdapter.start requires onNoteOn');
    this.#onNoteOn = onNoteOn;
    this.#stopped = false;
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    try { this.#ws?.close(); } catch { /* ignore */ }
    this.#ws = null;
  }

  #connect() {
    if (this.#stopped) return;
    let ws;
    try {
      ws = Object.keys(this.#headers).length
        ? new this.#WebSocketImpl(this.#bridgeUrl, { headers: this.#headers })
        : new this.#WebSocketImpl(this.#bridgeUrl);
    } catch (err) {
      this.#logger.warn?.('piano-midi-wake.ws.error', { error: String(err?.message ?? err) });
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;
    ws.on('open', () => {
      this.#backoff = this.#backoffBaseMs;
      this.#logger.info?.('piano-midi-wake.ws.open', { bridgeUrl: this.#bridgeUrl });
    });
    ws.on('message', (data) => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message?.type === 'note.on') this.#onNoteOn?.();
    });
    ws.on('error', (err) => {
      this.#logger.warn?.('piano-midi-wake.ws.error', { error: String(err?.message ?? err) });
    });
    ws.on('close', () => {
      this.#ws = null;
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect() {
    if (this.#stopped) return;
    const inMs = this.#backoff;
    this.#logger.warn?.('piano-midi-wake.ws.reconnect', { inMs });
    const timer = setTimeout(() => this.#connect(), inMs);
    timer.unref?.();
    this.#backoff = Math.min(this.#backoff * 2, this.#backoffMaxMs);
  }

  async suppressWakeUntil(deadlineMs) {
    if (this.#relay === 'setting') return this.#relaySetting(deadlineMs);
    const httpBase = this.#bridgeUrl.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
    const url = `${httpBase}/config`;
    try {
      const response = await this.#fetchImpl(url, { method: 'GET' });
      let values = null;
      if (response?.ok) {
        try { values = (await response.json())?.values ?? null; } catch { values = null; }
      }
      if (!values || typeof values !== 'object') {
        this.#logger.warn?.('piano-midi-wake.suppress-relay-skipped', { reason: 'config-unreadable' });
        return;
      }
      const merged = { ...values, fkbWakeSuppressUntilEpochMs: String(deadlineMs) };
      const yaml = Object.entries(merged).map(([key, value]) => `${key}: ${value}`).join('\n') + '\n';
      await this.#fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: yaml,
      });
    } catch (err) {
      this.#logger.warn?.('piano-midi-wake.suppress-relay-failed', {
        error: String(err?.message ?? err),
      });
    }
  }

  /** The Android app: one setting, epoch seconds rounded up; 0 clears the hold. */
  async #relaySetting(deadlineMs) {
    const httpBase = this.#bridgeUrl.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
    const value = deadlineMs > this.#now() ? Math.min(Math.ceil(deadlineMs / 1000), SUPPRESS_MAX_SEC) : 0;
    try {
      const response = await this.#fetchImpl(`${httpBase}/settings`, {
        method: 'POST',
        headers: { ...this.#headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: SUPPRESS_SETTING, value }),
      });
      if (!response?.ok) {
        let error = null;
        try { error = (await response.json())?.error ?? null; } catch { /* not JSON */ }
        this.#logger.warn?.('piano-midi-wake.suppress-relay-failed', { status: response?.status ?? null, error, value });
        return;
      }
      this.#logger.info?.('piano-midi-wake.suppress-relayed', { setting: SUPPRESS_SETTING, value });
    } catch (err) {
      this.#logger.warn?.('piano-midi-wake.suppress-relay-failed', { error: String(err?.message ?? err), value });
    }
  }
}
