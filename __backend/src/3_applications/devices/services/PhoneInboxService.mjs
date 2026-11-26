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
 * The right install, every time (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §H):
 *   - a poll is authorized by the device's token (`authorize`, connected by the
 *     composition); an install names itself (`installId`, `model`) on every poll and
 *     is remembered;
 *   - a command is addressed to one install. One sent without an address is stamped
 *     for the install seen last (the phone in use); with no install known yet it goes
 *     to the first poller. A poll from another install never receives it. An install
 *     that polled within INSTALL_FRESH_MS is "live" for the web's picker;
 *   - `keep` / `unkeep` commands ("Keep on this phone" from the web) are durable: kept
 *     in the store the composition connects, with no TTL, until the phone acks them;
 *     handed over again if no ack came within REDELIVER_MS (keep is idempotent on the
 *     phone);
 *   - the phone reports what it keeps (`reportKeeps`, the full list, its truth); the
 *     web reads it with the commands still waiting (`keeps`).
 *
 * @module applications/devices/services/PhoneInboxService
 */

export const PRESENCE_MS = 35_000;
export const ENTRY_TTL_MS = 120_000;
export const MAX_ENTRIES = 20;
export const MAX_WAIT_S = 30;
export const HEARTBEAT_MS = 10_000;
/** An install that polled within this reads "live" in the web's picker. */
export const INSTALL_FRESH_MS = 120_000;
/** A durable command handed over and not acked within this goes out again. */
export const REDELIVER_MS = 300_000;
export const MAX_DURABLE = 200;
export const MAX_KEPT_ITEMS = 500;
export const MAX_INSTALLS = 8;
/** Commands kept until acked: "Keep on this phone" and its removal. */
export const DURABLE_COMMANDS = Object.freeze(['keep', 'unkeep']);
export const KEEP_STATES = Object.freeze(['queued', 'downloading', 'ready', 'failed', 'refused', 'removed']);
const INSTALL_ID = /^[A-Za-z0-9_-]{8,64}$/;

export class PhoneInboxService {
  #clock;
  #scheduler;
  #publish = null;
  #serves = () => false;
  #boxes = new Map();
  #logger;
  #authorize = null;
  #store = null;

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
  connect({ serves, publish, authorize, store } = {}) {
    if (typeof serves === 'function') this.#serves = serves;
    if (typeof publish === 'function') this.#publish = publish;
    if (typeof authorize === 'function') this.#authorize = authorize;
    if (store && typeof store.load === 'function' && typeof store.save === 'function') this.#store = store;
  }

  /**
   * Whether a request speaks for this device: the composition checks the presented
   * bearer token against the device's own. No checker connected: refused (never open).
   * @returns {{ok:boolean, reason?:string}}
   */
  authorize(deviceId, authorizationHeader) {
    if (!this.#authorize) return { ok: false, reason: 'no_authority' };
    const m = typeof authorizationHeader === 'string' ? /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim()) : null;
    if (!m) return { ok: false, reason: 'no_token' };
    try {
      const verdict = this.#authorize(deviceId, m[1]);
      if (verdict === true) return { ok: true };
      return { ok: false, reason: typeof verdict === 'string' ? verdict : 'wrong_token' };
    } catch {
      return { ok: false, reason: 'check_failed' };
    }
  }

  /** A valid install id, or null. */
  static installIdOf(value) {
    return typeof value === 'string' && INSTALL_ID.test(value) ? value : null;
  }

  /** Whether this device takes its commands from an inbox (its provider is phone-inbox). */
  serves(deviceId) {
    try { return !!this.#serves(deviceId); } catch { return false; }
  }

  #box(deviceId) {
    let box = this.#boxes.get(deviceId);
    if (!box) {
      box = { entries: [], waiters: new Set(), lastPollAt: 0, holding: 0, state: null, revision: 0,
        installs: new Map(), durable: [], keeps: {} };
      this.#boxes.set(deviceId, box);
      this.#load(deviceId, box);
    }
    return box;
  }

  #load(deviceId, box) {
    if (!this.#store) return;
    let saved;
    try { saved = this.#store.load(deviceId); }
    catch (err) { this.#logger.warn?.('phone-inbox.store.load.failed', { deviceId, error: err?.message }); return; }
    if (!saved || typeof saved !== 'object') return;
    for (const i of Array.isArray(saved.installs) ? saved.installs : []) {
      const id = PhoneInboxService.installIdOf(i?.installId);
      if (id) box.installs.set(id, { installId: id, model: typeof i.model === 'string' ? i.model.slice(0, 80) : '', lastPollAt: Number(i.lastPollAt) || 0 });
    }
    for (const d of Array.isArray(saved.durable) ? saved.durable : []) {
      if (d?.envelope?.commandId && DURABLE_COMMANDS.includes(d.envelope.command)) {
        box.durable.push({ envelope: d.envelope, at: Number(d.at) || 0, deliveredAt: 0, deliveredTo: null });
      }
    }
    if (saved.keeps && typeof saved.keeps === 'object') box.keeps = saved.keeps;
  }

  #save(deviceId, box) {
    if (!this.#store) return;
    const data = {
      installs: [...box.installs.values()],
      durable: box.durable.map((d) => ({ envelope: d.envelope, at: d.at })),
      keeps: box.keeps,
    };
    try { this.#store.save(deviceId, data); }
    catch (err) { this.#logger.warn?.('phone-inbox.store.save.failed', { deviceId, error: err?.message }); }
  }

  /** The install that polled last (the phone in use), or null when none is known. */
  #current(box) {
    let best = null;
    for (const i of box.installs.values()) if (!best || i.lastPollAt > best.lastPollAt) best = i;
    return best;
  }

  /** Whether {@code installId} may take this envelope. */
  #mayTake(box, envelope, installId) {
    if (envelope.installId) return envelope.installId === installId;
    // Unaddressed: only the most recently seen install (or the only poller there is).
    const current = this.#current(box);
    if (!current) return true;
    return !!installId && current.installId === installId;
  }

  #seen(deviceId, box, installId, model) {
    if (!installId) return;
    const now = this.#clock.now();
    const prior = box.installs.get(installId);
    const fresh = !prior;
    box.installs.set(installId, { installId, model: typeof model === 'string' ? model.slice(0, 80) : (prior?.model ?? ''), lastPollAt: now });
    if (box.installs.size > MAX_INSTALLS) {
      const oldest = [...box.installs.values()].sort((a, b) => a.lastPollAt - b.lastPollAt)[0];
      box.installs.delete(oldest.installId);
    }
    // Saved on a new install and at most once a minute otherwise: a poll every 25 s
    // must not rewrite the file every time.
    if (fresh || !prior || now - (box.savedSeenAt ?? 0) > 60_000) {
      box.savedSeenAt = now;
      if (fresh) this.#logger.info?.('phone-inbox.install.new', { deviceId, installId, model: model ?? '' });
      this.#save(deviceId, box);
    }
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
    if (envelope && !envelope.installId) {
      // Stamp it for the phone in use (the install seen last, however long ago), so a
      // second install that polls next cannot take it. Short-lived commands still expire.
      const current = this.#current(box);
      if (current) envelope = { ...envelope, installId: current.installId };
    }
    const commandId = envelope?.commandId;
    box.entries = box.entries.filter((e) => !commandId || e.envelope.commandId !== commandId);
    box.entries.push({ envelope, at: this.#clock.now() });
    while (box.entries.length > MAX_ENTRIES) box.entries.shift();
    for (const wake of [...box.waiters]) wake();
    this.#logger.info?.('phone-inbox.enqueued', { deviceId, commandId, waiting: box.entries.length, held: box.holding });
  }

  /**
   * Takes the commands this install may have (oldest first): its short-lived ones are
   * handed over once; durable ones stay until acked and go out again only after
   * REDELIVER_MS without an ack. Another install's commands stay where they are.
   */
  take(deviceId, installId = null) {
    const box = this.#box(deviceId);
    this.#prune(box);
    const out = [];
    const rest = [];
    for (const e of box.entries) (this.#mayTake(box, e.envelope, installId) ? out : rest).push(e);
    box.entries = rest;
    const now = this.#clock.now();
    const durable = [];
    for (const d of box.durable) {
      if (!this.#mayTake(box, d.envelope, installId)) continue;
      if (d.deliveredAt && d.deliveredTo === installId && now - d.deliveredAt < REDELIVER_MS) continue;
      d.deliveredAt = now;
      d.deliveredTo = installId;
      durable.push(d.envelope);
    }
    return [...out.map((e) => e.envelope), ...durable];
  }

  /**
   * A poll whose caller left before the answer: its short-lived commands go back in the
   * inbox, its durable ones are marked not handed over (they never left the store).
   */
  putBack(deviceId, envelopes = []) {
    const box = this.#box(deviceId);
    for (const envelope of envelopes) {
      const durable = box.durable.find((d) => d.envelope.commandId === envelope?.commandId);
      if (durable) { durable.deliveredAt = 0; durable.deliveredTo = null; continue; }
      this.enqueue(deviceId, envelope);
    }
  }

  /**
   * "Keep on this phone" (or its removal) from another device: a durable command for
   * one install (or the phone in use). Kept until the phone acks it. Returns the envelope.
   * @param {string} deviceId
   * @param {{command:'keep'|'unkeep', contentId:string, title?:string, installId?:string, origin?:Object}} request
   */
  queueKeep(deviceId, { command, contentId, title, installId, origin, commandId } = {}) {
    if (!DURABLE_COMMANDS.includes(command)) throw new TypeError('command must be keep or unkeep');
    if (typeof contentId !== 'string' || !contentId) throw new TypeError('contentId is required');
    const box = this.#box(deviceId);
    const target = PhoneInboxService.installIdOf(installId) ?? this.#current(box)?.installId ?? null;
    // One waiting keep per content and install: the newest ask replaces an older one
    // (keep then remove before the phone heard either: only the remove goes).
    box.durable = box.durable.filter((d) => !(d.envelope.params?.contentId === contentId && (d.envelope.installId ?? null) === target));
    const envelope = {
      type: 'command',
      targetDevice: deviceId,
      command,
      commandId: typeof commandId === 'string' && commandId ? commandId : `${command}-${this.#clock.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      params: { contentId, ...(typeof title === 'string' && title ? { title: title.slice(0, 200) } : {}) },
      ...(target ? { installId: target } : {}),
      ...(origin && typeof origin === 'object' ? { origin } : {}),
      ts: new Date(this.#clock.now()).toISOString(),
    };
    box.durable.push({ envelope, at: this.#clock.now(), deliveredAt: 0, deliveredTo: null });
    while (box.durable.length > MAX_DURABLE) box.durable.shift();
    this.#save(deviceId, box);
    for (const wake of [...box.waiters]) wake();
    this.#logger.info?.('phone-inbox.keep.queued', { deviceId, command, contentId, installId: target, commandId: envelope.commandId });
    return envelope;
  }

  /**
   * The phone's own list of what it keeps (its truth, the whole list each time).
   * @param {string} deviceId
   * @param {{installId:string, items:Array<Object>}} report
   * @returns {number} items kept
   */
  reportKeeps(deviceId, { installId, items } = {}) {
    const id = PhoneInboxService.installIdOf(installId);
    if (!id) throw new TypeError('installId is required');
    if (!Array.isArray(items)) throw new TypeError('items must be a list');
    const clean = [];
    for (const it of items.slice(0, MAX_KEPT_ITEMS)) {
      if (!it || typeof it.contentId !== 'string' || !it.contentId || it.contentId.length > 200) continue;
      if (!KEEP_STATES.includes(it.state)) continue;
      const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
      clean.push({
        contentId: it.contentId,
        state: it.state,
        ...(typeof it.title === 'string' && it.title ? { title: it.title.slice(0, 200) } : {}),
        done: n(it.done), total: n(it.total), bytes: n(it.bytes),
        ...(typeof it.reason === 'string' && it.reason ? { reason: it.reason.slice(0, 200) } : {}),
      });
    }
    const box = this.#box(deviceId);
    box.keeps = { ...box.keeps, [id]: { items: clean, at: new Date(this.#clock.now()).toISOString() } };
    this.#save(deviceId, box);
    this.#logger.info?.('phone-inbox.keeps.reported', { deviceId, installId: id, items: clean.length });
    return clean.length;
  }

  /**
   * What the web shows: the installs seen (the one in use first), what each says it
   * keeps, and the keep commands still waiting for it.
   */
  keeps(deviceId) {
    const box = this.#box(deviceId);
    const current = this.#current(box);
    const now = this.#clock.now();
    const installs = [...box.installs.values()]
      .sort((a, b) => b.lastPollAt - a.lastPollAt)
      .map((i) => ({
        installId: i.installId,
        model: i.model,
        lastPollAt: i.lastPollAt ? new Date(i.lastPollAt).toISOString() : null,
        current: current?.installId === i.installId,
        live: now - i.lastPollAt < INSTALL_FRESH_MS,
      }));
    const waiting = box.durable.map((d) => ({
      command: d.envelope.command,
      commandId: d.envelope.commandId,
      contentId: d.envelope.params?.contentId,
      ...(d.envelope.params?.title ? { title: d.envelope.params.title } : {}),
      installId: d.envelope.installId ?? null,
      queuedAt: new Date(d.at).toISOString(),
      handedOver: !!d.deliveredAt,
    }));
    return { deviceId, installs, kept: box.keeps, waiting };
  }

  /**
   * A long-poll: resolves with the commands as soon as there are any, or [] after
   * waitSeconds. While held the device is present and its heartbeat goes out every
   * HEARTBEAT_MS, so it never reads offline between polls.
   * @param {string} deviceId
   * @param {number} waitSeconds 0..MAX_WAIT_S
   */
  async poll(deviceId, waitSeconds, { installId = null, model = null } = {}) {
    const box = this.#box(deviceId);
    const install = PhoneInboxService.installIdOf(installId);
    box.lastPollAt = this.#clock.now();
    this.#seen(deviceId, box, install, model);
    this.heartbeat(deviceId);
    const ready = this.take(deviceId, install);
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
        // Woken by a command for another install: keep holding (no early empty answer).
        const wake = () => { const got = this.take(deviceId, install); if (got.length) finish(got); };
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
    // A durable command is done once the phone answered it, either way (a refusal is
    // an answer: the phone's keep report says why).
    const before = box.durable.length;
    box.durable = box.durable.filter((d) => d.envelope.commandId !== commandId);
    if (box.durable.length !== before) {
      this.#save(deviceId, box);
      this.#logger.info?.('phone-inbox.keep.acked', { deviceId, commandId, ok: ok === true });
    }
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
