/**
 * PhoneInboxService — commands for a device that holds no WebSocket: the phone.
 *
 * A screen hears its commands on a WebSocket topic. The phone app has no socket; it
 * long-polls `GET /api/v1/device/:id/commands` while it is running and acks over HTTP.
 * This keeps, per device:
 *   - an inbox of command envelopes (bounded; the newest wins for one commandId;
 *     an entry older than ENTRY_TTL_MS is dropped unseen),
 *   - presence: the device is present while a poll is held, or one ended within
 *     PRESENCE_MS (what `content_control.provider: phone-inbox` checks before it
 *     queues, so a phone that is not listening reads "not connected", not "sent"),
 *   - the last state the phone reported, re-sent as its heartbeat so the Play-on
 *     picker shows it online (and what) while it polls.
 *
 * Messages for the bus (device-state, device-ack) go out through the publisher the
 * composition connects, as if the phone had sent them over a socket, so the same
 * liveness and ack handlers see them.
 *
 * @module applications/devices/services/PhoneInboxService
 */

export const PRESENCE_MS = 35_000;
export const ENTRY_TTL_MS = 120_000;
export const MAX_ENTRIES = 20;
export const MAX_WAIT_S = 30;
export const HEARTBEAT_MS = 10_000;

export class PhoneInboxService {
  #clock;
  #scheduler;
  #publish = null;
  #serves = () => false;
  #boxes = new Map();
  #logger;

  /**
   * @param {Object} [deps]
   * @param {{now:()=>number}} [deps.clock]
   * @param {{after:(ms:number, task:Function)=>Function}} deps.scheduler IApplicationScheduler (cancellable timers)
   * @param {Object} [deps.logger]
   */
  constructor({ clock = { now: () => Date.now() }, scheduler, logger = console } = {}) {
    if (!scheduler?.after) throw new Error('PhoneInboxService requires a scheduler');
    this.#clock = clock;
    this.#scheduler = scheduler;
    this.#logger = logger;
  }

  /**
   * Wire the outside: which devices use an inbox, and how a client message reaches the bus.
   * @param {{ serves?: (deviceId:string)=>boolean, publish?: (message:Object)=>void }} wiring
   */
  connect({ serves, publish } = {}) {
    if (typeof serves === 'function') this.#serves = serves;
    if (typeof publish === 'function') this.#publish = publish;
  }

  /** Whether this device takes its commands from an inbox (its provider is phone-inbox). */
  serves(deviceId) {
    try { return !!this.#serves(deviceId); } catch { return false; }
  }

  #box(deviceId) {
    let box = this.#boxes.get(deviceId);
    if (!box) {
      box = { entries: [], waiters: new Set(), lastPollAt: 0, holding: 0, state: null, revision: 0 };
      this.#boxes.set(deviceId, box);
    }
    return box;
  }

  #prune(box) {
    const now = this.#clock.now();
    box.entries = box.entries.filter((e) => now - e.at < ENTRY_TTL_MS);
  }

  /** Present: a poll is held now, or one ended within PRESENCE_MS. */
  isPresent(deviceId) {
    const box = this.#boxes.get(deviceId);
    if (!box) return false;
    return box.holding > 0 || this.#clock.now() - box.lastPollAt < PRESENCE_MS;
  }

  /**
   * Queue a command envelope. The newest copy of a commandId replaces an older one.
   * Wakes a held poll at once.
   */
  enqueue(deviceId, envelope) {
    const box = this.#box(deviceId);
    this.#prune(box);
    const commandId = envelope?.commandId;
    box.entries = box.entries.filter((e) => !commandId || e.envelope.commandId !== commandId);
    box.entries.push({ envelope, at: this.#clock.now() });
    while (box.entries.length > MAX_ENTRIES) box.entries.shift();
    for (const wake of [...box.waiters]) wake();
    this.#logger.info?.('phone-inbox.enqueued', { deviceId, commandId, waiting: box.entries.length, held: box.holding });
  }

  /** Takes every queued command (oldest first). */
  take(deviceId) {
    const box = this.#box(deviceId);
    this.#prune(box);
    const out = box.entries.map((e) => e.envelope);
    box.entries = [];
    return out;
  }

  /**
   * A long-poll: resolves with the commands as soon as there are any, or [] after
   * waitSeconds. While held the device is present and its heartbeat goes out every
   * HEARTBEAT_MS, so it never reads offline between polls.
   * @param {string} deviceId
   * @param {number} waitSeconds 0..MAX_WAIT_S
   */
  async poll(deviceId, waitSeconds) {
    const box = this.#box(deviceId);
    box.lastPollAt = this.#clock.now();
    this.heartbeat(deviceId);
    const ready = this.take(deviceId);
    const wait = Math.max(0, Math.min(MAX_WAIT_S, Number(waitSeconds) || 0));
    if (ready.length || wait === 0) return ready;

    box.holding++;
    try {
      return await new Promise((resolve) => {
        let cancelTimeout = () => {};
        let cancelBeat = () => {};
        const finish = (commands) => {
          box.waiters.delete(wake);
          cancelTimeout();
          cancelBeat();
          resolve(commands);
        };
        const wake = () => finish(this.take(deviceId));
        box.waiters.add(wake);
        const beat = () => {
          this.heartbeat(deviceId);
          cancelBeat = this.#scheduler.after(HEARTBEAT_MS, beat);
        };
        cancelBeat = this.#scheduler.after(HEARTBEAT_MS, beat);
        cancelTimeout = this.#scheduler.after(wait * 1000, () => finish([]));
      });
    } finally {
      box.holding--;
      box.lastPollAt = this.#clock.now();
    }
  }

  /**
   * The phone answered a command: publish its device-ack (what WakeAndLoad waits for)
   * and, with a state, its device-state, so the dispatch confirms "playing".
   * @param {string} deviceId
   * @param {{commandId:string, ok:boolean, error?:string, appliedAs?:string, state?:Object}} ack
   */
  ack(deviceId, { commandId, ok, error, appliedAs, state } = {}) {
    const box = this.#box(deviceId);
    box.lastPollAt = Math.max(box.lastPollAt, this.#clock.now());
    this.#emit({
      topic: 'device-ack',
      deviceId,
      commandId,
      ok: ok === true,
      ...(typeof error === 'string' && error ? { error: error.slice(0, 200) } : {}),
      ...(typeof appliedAs === 'string' && appliedAs ? { appliedAs } : {}),
      ts: new Date(this.#clock.now()).toISOString(),
    });
    if (state && typeof state === 'object') this.report(deviceId, state, { commandId, reason: 'change' });
  }

  /**
   * The phone's own state ({contentId, title, playing}) as a session snapshot the
   * fleet and the dispatch confirmation read. A new command starts a new session
   * and advances the playback revision.
   */
  report(deviceId, { contentId, title, playing, paused } = {}, { commandId = null, reason = 'change' } = {}) {
    const box = this.#box(deviceId);
    const id = typeof contentId === 'string' && contentId ? contentId : null;
    const state = !id ? 'idle' : playing === true ? 'playing' : paused === true || playing === false ? 'paused' : 'playing';
    box.revision += 1;
    const sessionId = commandId ? `phone-${commandId}` : (box.state?.sessionId ?? `phone-${deviceId}`);
    box.state = {
      sessionId,
      state,
      currentItem: id ? { contentId: id, ...(typeof title === 'string' && title ? { title: title.slice(0, 200) } : {}) } : null,
      queue: { items: id ? [{ contentId: id }] : [], currentIndex: id ? 0 : -1 },
      meta: {
        ownerId: deviceId,
        playbackOwner: { ownerInstanceId: `phone-inbox:${deviceId}`, playbackRevision: box.revision, queueRevision: box.revision },
      },
    };
    this.#emit({ topic: 'device-state', deviceId, snapshot: box.state, reason, ts: new Date(this.#clock.now()).toISOString() });
  }

  /** The device's last state (idle when it never reported), as a heartbeat. */
  heartbeat(deviceId) {
    const box = this.#box(deviceId);
    const snapshot = box.state ?? {
      sessionId: `phone-${deviceId}`,
      state: 'idle',
      currentItem: null,
      queue: { items: [], currentIndex: -1 },
      meta: { ownerId: deviceId },
    };
    this.#emit({ topic: 'device-state', deviceId, snapshot, reason: 'heartbeat', ts: new Date(this.#clock.now()).toISOString() });
  }

  #emit(message) {
    if (!this.#publish) return;
    try { this.#publish(message); }
    catch (err) { this.#logger.warn?.('phone-inbox.publish.failed', { topic: message.topic, error: err?.message }); }
  }
}

export default PhoneInboxService;
