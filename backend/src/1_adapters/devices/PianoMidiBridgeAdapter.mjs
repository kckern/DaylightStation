import WebSocket from 'ws';
import { IPianoMidiBridge } from '#apps/devices/ports/IPianoMidiBridge.mjs';

const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 30000;

/** Transport adapter for the piano-bridge APK WebSocket and config endpoint. */
export class PianoMidiBridgeAdapter extends IPianoMidiBridge {
  #bridgeUrl; #logger; #WebSocketImpl; #fetchImpl;
  #backoffBaseMs; #backoffMaxMs; #backoff; #ws; #stopped; #onNoteOn;

  constructor({
    bridgeUrl,
    logger = console,
    WebSocketImpl = WebSocket,
    fetchImpl = globalThis.fetch,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    backoffMaxMs = DEFAULT_BACKOFF_MAX_MS,
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
      ws = new this.#WebSocketImpl(this.#bridgeUrl);
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
}
