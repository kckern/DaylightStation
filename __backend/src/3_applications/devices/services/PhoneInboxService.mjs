/**
 * PhoneInboxService — commands for a device that holds no WebSocket: the phone.
 *
 * A screen hears its commands on a WebSocket topic. The phone app has no socket; it
 * long-polls `GET /api/v1/device/:id/commands` while it is running and acks over HTTP.
 * This keeps, per device:
 *   - an inbox of short-lived command envelopes (Play on: bounded; the newest wins for
 *     one commandId; an entry older than ENTRY_TTL_MS is dropped unseen; a dispatch
 *     whose ack wait ran out takes its envelope back with `cancel`),
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
 * The right install, every time (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §H,
 * ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md):
 *   - a request speaks for the device with its token (`authorize`, connected by the
 *     composition). For the transition to builds that send one, a request with no
 *     token is let in when the composition allows it (logged, sampled); a token that
 *     is present and wrong is always refused;
 *   - an install names itself (`installId`, `model`) on every poll and is remembered;
 *   - a Play-on command is addressed to one install: the one named, else the only live
 *     install; with two live installs and none named it is refused (CHOOSE_PHONE), the
 *     person picks. A poll from another install never receives it. A new poll from an
 *     install answers its own older held poll empty, so a half-open socket cannot
 *     swallow a play;
 *   - `keep` / `unkeep` ("Keep on this phone" from the web) are durable: stored, no TTL,
 *     until the phone acks them; handed over again after REDELIVER_MS without an ack.
 *     With no live install a keep waits unaddressed and the first install to poll
 *     claims it; a new install takes over what waited for installs no longer live; an
 *     evicted install's keeps go with it. A keep not yet handed over can be cancelled;
 *   - the phone reports what it keeps (`reportKeeps`, the whole list, its truth, with
 *     its free space and limit); between the ack and that report a keep reads
 *     "received", and a keep the phone refused stays visible with its reason;
 *   - nothing here may lose what is stored: a store that cannot be read (half-synced,
 *     unreadable, damaged) leaves the device read-only — no saves, retried later —
 *     rather than read as empty and overwritten. A keep that cannot be stored is an
 *     error to the caller, never a silent 202.
 *
 * @module applications/devices/services/PhoneInboxService
 */

export const PRESENCE_MS = 35_000;
export const ENTRY_TTL_MS = 120_000;
export const MAX_ENTRIES = 20;
export const MAX_WAIT_S = 30;
export const HEARTBEAT_MS = 10_000;
/** An install that polled within this is live: the one a Play-on send is for. */
export const INSTALL_FRESH_MS = 120_000;
/** An install not heard from for this long is shown as gone (lifecycle spec §3.8). */
export const INSTALL_GONE_MS = 30 * 24 * 3600 * 1000;
/** A durable command handed over and not acked within this goes out again. */
export const REDELIVER_MS = 300_000;
/** A store that could not be read is tried again after this. */
export const LOAD_RETRY_MS = 60_000;
/** lastPollAt is kept in memory; written at most this often (installs going gone). */
export const POLL_PERSIST_MS = 6 * 3600 * 1000;
export const MAX_DURABLE = 200;
export const MAX_KEPT_ITEMS = 500;
export const MAX_INSTALLS = 8;
/** Commands kept until acked: "Keep on this phone" and its removal. */
export const DURABLE_COMMANDS = Object.freeze(['keep', 'unkeep']);
/** The states of a kept item (lifecycle spec §2), as the phone reports them. */
export const KEEP_STATES = Object.freeze([
  'asked', 'checking', 'needs-room', 'queued', 'waiting-wifi', 'waiting-home', 'waiting-storage',
  'downloading', 'paused', 'partly-ready', 'ready', 'updating', 'removing', 'not-available', 'damaged',
  // Earlier names, still taken.
  'failed', 'refused', 'removed',
]);
const INSTALL_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** A keep that could not be stored: the caller answers 503, never "queued". */
export class InboxStoreUnavailableError extends Error {
  constructor(message = 'The phone inbox cannot be saved right now') {
    super(message);
    this.name = 'InboxStoreUnavailableError';
    this.code = 'STORE_UNAVAILABLE';
  }
}

/** Two phones are live and none was named: the person picks one. */
export class ChoosePhoneError extends Error {
  constructor(installs = []) {
    super('Two phones are connected: choose one');
    this.name = 'ChoosePhoneError';
    this.code = 'CHOOSE_PHONE';
    this.installs = installs;
  }
}

export class PhoneInboxService {
  #clock;
  #scheduler;
  #publish = null;
  #serves = () => false;
  #authorize = null;
  #allowUnauthenticated = () => false;
  #store = null;
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
   * Wire the outside.
   * @param {Object} wiring
   * @param {(deviceId:string)=>boolean} [wiring.serves] which devices use an inbox
   * @param {(message:Object)=>void} [wiring.publish] how a client message reaches the bus
   * @param {(deviceId:string, token:string)=>true|string} [wiring.authorize] token check (true, or a reason)
   * @param {(deviceId:string)=>boolean} [wiring.allowUnauthenticated] let a request with no token in (transition)
   * @param {{load:(id:string)=>Object|null, save:(id:string, data:Object)=>Promise<void>|void, quarantine?:(id:string, err:Error)=>void}} [wiring.store]
   *   load: null when there is no file yet; THROWS for anything else (unreadable, damaged).
   */
  connect({ serves, publish, authorize, allowUnauthenticated, store } = {}) {
    if (typeof serves === 'function') this.#serves = serves;
    if (typeof publish === 'function') this.#publish = publish;
    if (typeof authorize === 'function') this.#authorize = authorize;
    if (typeof allowUnauthenticated === 'function') this.#allowUnauthenticated = allowUnauthenticated;
    if (store && typeof store.load === 'function' && typeof store.save === 'function') this.#store = store;
  }

  /** Whether this device takes its commands from an inbox (its provider is phone-inbox). */
  serves(deviceId) {
    try { return !!this.#serves(deviceId); } catch { return false; }
  }

  /**
   * Whether a request speaks for this device. A token that is present is checked
   * (wrong: refused). No token at all: let in only while the composition allows it
   * (the transition to builds that send one), logged.
   * @returns {{ok:boolean, reason?:string, unauthenticated?:boolean}}
   */
  authorize(deviceId, authorizationHeader) {
    const header = typeof authorizationHeader === 'string' ? authorizationHeader.trim() : '';
    if (!header) {
      let allowed = false;
      try { allowed = this.#allowUnauthenticated(deviceId) === true; } catch { allowed = false; }
      if (allowed) {
        this.#sampled('phone-inbox.unauthenticated', { deviceId });
        return { ok: true, unauthenticated: true };
      }
      return { ok: false, reason: 'no_token' };
    }
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m) return { ok: false, reason: 'no_token' };
    if (!this.#authorize) return { ok: false, reason: 'no_authority' };
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

  // ── the box and its store ────────────────────────────────────────────────

  #box(deviceId) {
    let box = this.#boxes.get(deviceId);
    if (!box) {
      box = {
        entries: [], waiters: new Set(), lastPollAt: 0, holding: 0, state: null, revision: 0,
        installs: new Map(), durable: [], keeps: {}, received: {}, refusals: {},
        loaded: false, readOnly: false, nextLoadAt: 0, persistedPollAt: 0, reportDigest: {},
        saving: Promise.resolve(),
      };
      this.#boxes.set(deviceId, box);
    }
    this.#ensureLoaded(deviceId, box);
    return box;
  }

  #ensureLoaded(deviceId, box) {
    if (box.loaded || !this.#store) { box.loaded = true; return; }
    if (box.readOnly && this.#clock.now() < box.nextLoadAt) return;
    let saved;
    try {
      saved = this.#store.load(deviceId);
    } catch (err) {
      // Not "empty": unreadable, half-synced or damaged. Never write over it.
      box.readOnly = true;
      box.nextLoadAt = this.#clock.now() + LOAD_RETRY_MS;
      this.#logger.error?.('phone-inbox.store.unreadable', { deviceId, error: err?.message, code: err?.code ?? null, retryInMs: LOAD_RETRY_MS });
      if (err?.name === 'YAMLException' || err?.damaged === true) {
        try { this.#store.quarantine?.(deviceId, err); } catch (qerr) {
          this.#logger.warn?.('phone-inbox.store.quarantine.failed', { deviceId, error: qerr?.message });
        }
      }
      return;
    }
    box.loaded = true;
    if (box.readOnly) this.#logger.info?.('phone-inbox.store.readable', { deviceId });
    box.readOnly = false;
    this.#merge(box, saved);
  }

  /** What was stored, under what this run already holds (a retry after a failed read). */
  #merge(box, saved) {
    if (!saved || typeof saved !== 'object') return;
    for (const i of Array.isArray(saved.installs) ? saved.installs : []) {
      const id = PhoneInboxService.installIdOf(i?.installId);
      if (!id || box.installs.has(id)) continue;
      const lastPollAt = Number(i.lastPollAt) || 0;
      box.installs.set(id, {
        installId: id,
        model: typeof i.model === 'string' ? i.model.slice(0, 80) : '',
        firstSeenAt: Number(i.firstSeenAt) || lastPollAt,
        lastPollAt,
      });
    }
    const have = new Set(box.durable.map((d) => d.envelope.commandId));
    for (const d of Array.isArray(saved.durable) ? saved.durable : []) {
      if (!d?.envelope?.commandId || !DURABLE_COMMANDS.includes(d.envelope.command) || have.has(d.envelope.commandId)) continue;
      box.durable.push({ envelope: d.envelope, at: Number(d.at) || 0, deliveredAt: 0, deliveredTo: null });
    }
    if (saved.keeps && typeof saved.keeps === 'object') box.keeps = { ...saved.keeps, ...box.keeps };
    if (saved.received && typeof saved.received === 'object') box.received = { ...saved.received, ...box.received };
    if (saved.refusals && typeof saved.refusals === 'object') box.refusals = { ...saved.refusals, ...box.refusals };
  }

  /**
   * Writes the box. Resolves true when stored, false when it could not be (read-only
   * after a failed read, or the write failed): the caller decides what that means.
   * Writes for one device go out in order.
   */
  #save(deviceId, box) {
    if (!this.#store) return Promise.resolve(true);
    if (box.readOnly) {
      this.#logger.warn?.('phone-inbox.store.save.skipped', { deviceId, reason: 'read-only' });
      return Promise.resolve(false);
    }
    const data = {
      installs: [...box.installs.values()],
      durable: box.durable.map((d) => ({ envelope: d.envelope, at: d.at })),
      keeps: box.keeps,
      received: box.received,
      refusals: box.refusals,
    };
    box.persistedPollAt = this.#clock.now();
    const run = box.saving.then(async () => {
      try {
        await this.#store.save(deviceId, data);
        return true;
      } catch (err) {
        this.#logger.error?.('phone-inbox.store.save.failed', { deviceId, error: err?.message, code: err?.code ?? null });
        return false;
      }
    });
    box.saving = run.then(() => undefined);
    return run;
  }

  // ── installs ─────────────────────────────────────────────────────────────

  /** The install that polled last (the phone in use), or null when none is known. */
  #current(box) {
    let best = null;
    for (const i of box.installs.values()) if (!best || i.lastPollAt > best.lastPollAt) best = i;
    return best;
  }

  #live(box) {
    const now = this.#clock.now();
    return [...box.installs.values()].filter((i) => now - (i.listenAt ?? 0) < INSTALL_FRESH_MS);
  }

  /** Whether {@code installId} may take this envelope. */
  #mayTake(box, envelope, installId) {
    if (envelope.installId) return envelope.installId === installId;
    // Unaddressed: only possible with no live install when it was sent. The first
    // install that asks claims it (take stamps it).
    return true;
  }

  #seen(deviceId, box, installId, model, background = false) {
    if (!installId) return;
    const now = this.#clock.now();
    const prior = box.installs.get(installId);
    const deadBefore = [...box.installs.values()].filter((i) => i.installId !== installId && now - i.lastPollAt >= INSTALL_FRESH_MS).map((i) => i.installId);
    box.installs.set(installId, {
      installId,
      model: typeof model === 'string' && model ? model.slice(0, 80) : (prior?.model ?? ''),
      firstSeenAt: prior?.firstSeenAt ?? now,
      lastPollAt: now,
      // When it last listened (a long poll, the app open or playing): what "live" means.
      listenAt: background ? (prior?.listenAt ?? 0) : now,
    });
    let changed = !prior;
    if (!prior) {
      this.#logger.info?.('phone-inbox.install.new', { deviceId, installId, model: model ?? '' });
      // A reinstall or a new phone: what waited for installs that are no longer live
      // moves to it (lifecycle spec §3.8).
      let moved = 0;
      for (const d of box.durable) {
        if (d.envelope.installId && deadBefore.includes(d.envelope.installId)) {
          d.envelope = { ...d.envelope, installId };
          d.deliveredAt = 0; d.deliveredTo = null;
          moved++;
        }
      }
      if (moved) this.#logger.info?.('phone-inbox.keep.readdressed', { deviceId, installId, moved });
    }
    if (box.installs.size > MAX_INSTALLS) {
      const oldest = [...box.installs.values()].sort((a, b) => a.lastPollAt - b.lastPollAt)[0];
      this.#evict(deviceId, box, oldest.installId);
      changed = true;
    }
    // A poll every 25 s must not rewrite the file: a new install or an eviction is
    // saved now; lastPollAt only every POLL_PERSIST_MS (enough to tell gone after 30 days).
    if (changed || now - box.persistedPollAt > POLL_PERSIST_MS) this.#save(deviceId, box);
  }

  #evict(deviceId, box, installId) {
    box.installs.delete(installId);
    delete box.keeps[installId];
    delete box.reportDigest[installId];
    const before = box.durable.length;
    box.durable = box.durable.filter((d) => d.envelope.installId !== installId);
    for (const k of Object.keys(box.received)) if (box.received[k].installId === installId) delete box.received[k];
    for (const k of Object.keys(box.refusals)) if (box.refusals[k].installId === installId) delete box.refusals[k];
    this.#logger.info?.('phone-inbox.install.evicted', { deviceId, installId, droppedCommands: before - box.durable.length });
  }

  // ── short-lived commands (Play on) ───────────────────────────────────────

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
   * The installs a picker offers: live ones, the one in use first.
   * @returns {Array<{installId:string, model:string}>}
   */
  liveInstalls(deviceId) {
    const box = this.#box(deviceId);
    return this.#live(box).sort((a, b) => b.lastPollAt - a.lastPollAt).map(({ installId, model }) => ({ installId, model }));
  }

  /**
   * Queue a short-lived command. Addressed: the install named. Unaddressed: the only
   * live install; none live: the install seen last (or, with none known, the first
   * poller); two or more live: refused with ChoosePhoneError. The newest copy of a
   * commandId replaces an older one. Wakes the addressed install's held poll.
   * @returns {Object} the envelope as queued
   */
  enqueue(deviceId, envelope) {
    const box = this.#box(deviceId);
    this.#prune(box);
    let queued = envelope;
    if (queued && !queued.installId) {
      const live = this.#live(box);
      if (live.length > 1) {
        this.#logger.warn?.('phone-inbox.choose-phone', { deviceId, commandId: queued.commandId, live: live.length });
        throw new ChoosePhoneError(live.map(({ installId, model }) => ({ installId, model })));
      }
      const target = live[0] ?? this.#current(box);
      if (target) queued = { ...queued, installId: target.installId };
    }
    const commandId = queued?.commandId;
    box.entries = box.entries.filter((e) => !commandId || e.envelope.commandId !== commandId);
    box.entries.push({ envelope: queued, at: this.#clock.now() });
    while (box.entries.length > MAX_ENTRIES) box.entries.shift();
    this.#wake(box);
    this.#logger.info?.('phone-inbox.enqueued', { deviceId, commandId, installId: queued?.installId ?? null, waiting: box.entries.length, held: box.holding });
    return queued;
  }

  /**
   * Takes a short-lived command back before any install collected it (the dispatch's
   * ack wait ran out: the play is "not delivered", never a late play). True when it
   * was still waiting.
   */
  cancel(deviceId, commandId) {
    const box = this.#box(deviceId);
    const before = box.entries.length;
    box.entries = box.entries.filter((e) => e.envelope?.commandId !== commandId);
    const removed = box.entries.length !== before;
    this.#logger.info?.('phone-inbox.cancelled', { deviceId, commandId, removed });
    return removed;
  }

  #wake(box) {
    for (const w of [...box.waiters]) w.wake();
  }

  /**
   * Takes the commands this install may have (oldest first): its short-lived ones are
   * handed over once; durable ones stay until acked and go out again only after
   * REDELIVER_MS without an ack. An unaddressed one is claimed by this install.
   * Another install's commands stay where they are.
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
    let claimed = false;
    for (const d of box.durable) {
      if (!this.#mayTake(box, d.envelope, installId)) continue;
      if (d.deliveredAt && d.deliveredTo === installId && now - d.deliveredAt < REDELIVER_MS) continue;
      if (!d.envelope.installId && installId) { d.envelope = { ...d.envelope, installId }; claimed = true; }
      d.deliveredAt = now;
      d.deliveredTo = installId;
      durable.push(d.envelope);
    }
    if (claimed) this.#save(deviceId, box);
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
      box.entries.push({ envelope, at: this.#clock.now() });
    }
  }

  // ── durable commands (Keep on this phone) ───────────────────────────────

  /**
   * "Keep on this phone" (or its removal) from another device: a durable command for
   * the install named; unnamed, the only live install; none live, unaddressed (the
   * first install to poll claims it); two live and none named: ChoosePhoneError.
   * Stored before it is answered: a store that cannot be written throws
   * InboxStoreUnavailableError and nothing is queued.
   * @returns {Promise<Object>} the envelope
   */
  async queueKeep(deviceId, { command, contentId, title, installId, origin, commandId } = {}) {
    if (!DURABLE_COMMANDS.includes(command)) throw new TypeError('command must be keep or unkeep');
    if (typeof contentId !== 'string' || !contentId) throw new TypeError('contentId is required');
    const box = this.#box(deviceId);
    if (box.readOnly) throw new InboxStoreUnavailableError();
    let target = PhoneInboxService.installIdOf(installId);
    if (!target) {
      const live = this.#live(box);
      if (live.length > 1) throw new ChoosePhoneError(live.map(({ installId: id, model }) => ({ installId: id, model })));
      target = live[0]?.installId ?? null;
    }
    const before = { durable: box.durable, refusals: box.refusals };
    // One waiting keep per content and install: the newest ask replaces an older one
    // (keep then remove before the phone heard either: only the remove goes).
    box.durable = box.durable.filter((d) => !(d.envelope.params?.contentId === contentId && (d.envelope.installId ?? null) === target));
    const refusals = { ...box.refusals };
    for (const k of Object.keys(refusals)) if (refusals[k].contentId === contentId && (refusals[k].installId ?? null) === target) delete refusals[k];
    box.refusals = refusals;
    const now = this.#clock.now();
    const envelope = {
      type: 'command',
      targetDevice: deviceId,
      command,
      commandId: typeof commandId === 'string' && commandId ? commandId : `${command}-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      params: { contentId, ...(typeof title === 'string' && title ? { title: title.slice(0, 200) } : {}) },
      ...(target ? { installId: target } : {}),
      ...(origin && typeof origin === 'object' ? { origin } : {}),
      ts: new Date(now).toISOString(),
    };
    box.durable = [...box.durable, { envelope, at: now, deliveredAt: 0, deliveredTo: null }];
    while (box.durable.length > MAX_DURABLE) box.durable.shift();
    if (!(await this.#save(deviceId, box))) {
      box.durable = before.durable;
      box.refusals = before.refusals;
      this.#logger.error?.('phone-inbox.keep.not-stored', { deviceId, command, contentId });
      throw new InboxStoreUnavailableError();
    }
    this.#wake(box);
    this.#logger.info?.('phone-inbox.keep.queued', { deviceId, command, contentId, installId: target, commandId: envelope.commandId });
    return envelope;
  }

  /**
   * Cancels a waiting keep before the phone received it: removed when not yet handed
   * over ({cancelled:true}); already handed over, it is answered by a removal
   * ({cancelled:false, removing:true}); unknown: null.
   */
  async cancelKeep(deviceId, commandId) {
    const box = this.#box(deviceId);
    const found = box.durable.find((d) => d.envelope.commandId === commandId);
    if (!found) return null;
    if (found.deliveredAt) {
      const removal = await this.queueKeep(deviceId, {
        command: 'unkeep', contentId: found.envelope.params?.contentId, installId: found.envelope.installId ?? undefined,
      });
      return { cancelled: false, removing: true, commandId: removal.commandId };
    }
    if (box.readOnly) throw new InboxStoreUnavailableError();
    const before = box.durable;
    box.durable = box.durable.filter((d) => d !== found);
    if (!(await this.#save(deviceId, box))) { box.durable = before; throw new InboxStoreUnavailableError(); }
    this.#logger.info?.('phone-inbox.keep.cancelled', { deviceId, commandId });
    return { cancelled: true };
  }

  /**
   * The phone's own list of what it keeps (its truth, the whole list each time), with
   * its free space and limit. An unchanged list is not written again.
   * @returns {Promise<number>} items taken
   */
  async reportKeeps(deviceId, { installId, items, freeBytes, limitBytes } = {}) {
    const id = PhoneInboxService.installIdOf(installId);
    if (!id) throw new TypeError('installId is required');
    if (!Array.isArray(items)) throw new TypeError('items must be a list');
    const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
    const clean = [];
    for (const it of items.slice(0, MAX_KEPT_ITEMS)) {
      if (!it || typeof it.contentId !== 'string' || !it.contentId || it.contentId.length > 200) continue;
      if (!KEEP_STATES.includes(it.state)) continue;
      const item = { contentId: it.contentId, state: it.state, done: n(it.done), total: n(it.total), bytes: n(it.bytes) };
      if (typeof it.title === 'string' && it.title) item.title = it.title.slice(0, 200);
      if (typeof it.reason === 'string' && it.reason) item.reason = it.reason.slice(0, 200);
      for (const k of ['totalBytes', 'neededBytes', 'failed']) if (it[k] !== undefined) item[k] = n(it[k]);
      if (it.finished === true) item.finished = true;
      // Kept automatically while listening (lifecycle spec §3.10): the web says "Kept automatically".
      if (it.auto === true) item.auto = true;
      // A unit of a kept artist or author (lifecycle spec §3.11): the web shows it under its group.
      const group = PhoneInboxService.groupOf(it.group);
      if (group) item.group = group;
      if (Array.isArray(it.trackIds)) item.trackIds = it.trackIds.filter((t) => typeof t === 'string' && t.length <= 200).slice(0, 2000);
      clean.push(item);
    }
    const report = {
      items: clean,
      ...(freeBytes !== undefined ? { freeBytes: n(freeBytes) } : {}),
      ...(limitBytes !== undefined ? { limitBytes: n(limitBytes) } : {}),
    };
    const box = this.#box(deviceId);
    const digest = JSON.stringify(report);
    // What the phone now says it has supersedes "received".
    let receivedChanged = false;
    for (const k of Object.keys(box.received)) {
      const r = box.received[k];
      if (r.installId === id && clean.some((c) => c.contentId === r.contentId)) { delete box.received[k]; receivedChanged = true; }
    }
    box.keeps = { ...box.keeps, [id]: { ...report, at: new Date(this.#clock.now()).toISOString() } };
    if (digest === box.reportDigest[id] && !receivedChanged) return clean.length;
    box.reportDigest[id] = digest;
    if (!(await this.#save(deviceId, box))) throw new InboxStoreUnavailableError();
    this.#logger.info?.('phone-inbox.keeps.reported', {
      deviceId, installId: id, items: clean.length, auto: clean.filter((c) => c.auto).length,
      groups: new Set(clean.filter((c) => c.group).map((c) => c.group.id)).size,
    });
    return clean.length;
  }

  /**
   * A reported unit's group, cleaned: {id, title?, kind: 'artist'|'author', follow, removeFinished},
   * or null when it is not a valid one (no id, a bad id, an unknown kind).
   */
  static groupOf(g) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
    if (typeof g.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9._-]{1,160}$/.test(g.id)) return null;
    const kind = g.kind === 'author' || g.kind === 'artist' ? g.kind : null;
    if (!kind) return null;
    const out = { id: g.id, kind, follow: g.follow === true, removeFinished: g.removeFinished === true };
    if (typeof g.title === 'string' && g.title) out.title = g.title.slice(0, 200);
    return out;
  }

  /**
   * What the web shows: the installs seen (the one in use first; live, or gone after
   * INSTALL_GONE_MS), what each says it keeps, the keep commands still waiting (for
   * every install), the ones received but not yet reported, and the refusals.
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
        firstSeenAt: i.firstSeenAt ? new Date(i.firstSeenAt).toISOString() : null,
        lastPollAt: i.lastPollAt ? new Date(i.lastPollAt).toISOString() : null,
        current: current?.installId === i.installId,
        live: now - (i.listenAt ?? 0) < INSTALL_FRESH_MS,
        gone: now - i.lastPollAt >= INSTALL_GONE_MS,
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
    return {
      deviceId,
      installs,
      kept: box.keeps,
      waiting,
      received: Object.values(box.received),
      refused: Object.values(box.refusals),
      ...(box.readOnly ? { storeUnavailable: true } : {}),
    };
  }

  // ── the poll ─────────────────────────────────────────────────────────────

  /**
   * A long-poll: resolves with the commands as soon as there are any for this install,
   * or [] after waitSeconds. A newer poll from the same install answers this one [] at
   * once (a half-open socket must not hold a play). While held the device is present
   * and its heartbeat goes out every HEARTBEAT_MS, so it never reads offline between polls.
   * @param {string} deviceId
   * @param {number} waitSeconds 0..MAX_WAIT_S
   */
  async poll(deviceId, waitSeconds, { installId = null, model = null, background = false } = {}) {
    const box = this.#box(deviceId);
    const install = PhoneInboxService.installIdOf(installId);
    // A background check (the phone's app closed, its 15-minute job) collects keeps but is
    // not listening: it makes the phone neither present nor live, so Play on is not offered.
    if (!background) box.lastPollAt = this.#clock.now();
    this.#seen(deviceId, box, install, model, background);
    // A background check neither supersedes a listening poll nor says the phone is online.
    for (const w of background ? [] : [...box.waiters]) {
      if (w.install === install) {
        this.#logger.info?.('phone-inbox.poll.superseded', { deviceId, installId: install });
        w.finish([]);
      }
    }
    if (!background) this.heartbeat(deviceId);
    else this.#logger.info?.('phone-inbox.poll.background', { deviceId, installId: install });
    const ready = this.take(deviceId, install);
    const wait = Math.max(0, Math.min(MAX_WAIT_S, Number(waitSeconds) || 0));
    if (ready.length || wait === 0) return ready;

    box.holding++;
    try {
      return await new Promise((resolve) => {
        let cancelTimeout = () => {};
        let cancelBeat = () => {};
        let done = false;
        const waiter = { install, wake: null, finish: null };
        const finish = (commands) => {
          if (done) return;
          done = true;
          box.waiters.delete(waiter);
          cancelTimeout();
          cancelBeat();
          resolve(commands);
        };
        waiter.finish = finish;
        // Woken by a command for another install: keep holding (no early empty answer).
        waiter.wake = () => { const got = this.take(deviceId, install); if (got.length) finish(got); };
        box.waiters.add(waiter);
        const beat = () => {
          this.heartbeat(deviceId);
          cancelBeat = this.#scheduler.after(HEARTBEAT_MS, beat);
        };
        cancelBeat = this.#scheduler.after(HEARTBEAT_MS, beat);
        cancelTimeout = this.#scheduler.after(wait * 1000, () => finish([]));
      });
    } finally {
      box.holding--;
      if (!background) box.lastPollAt = this.#clock.now();
    }
  }

  /**
   * The phone answered a command: publish its device-ack (what WakeAndLoad waits for)
   * and, with a state, its device-state, so the dispatch confirms "playing". A durable
   * command is done once answered, either way: ok → "received" until the phone's next
   * report; refused → a visible refusal with the phone's reason.
   * @param {string} deviceId
   * @param {{commandId:string, ok:boolean, error?:string, appliedAs?:string, state?:Object}} ack
   */
  ack(deviceId, { commandId, ok, error, appliedAs, state } = {}) {
    const box = this.#box(deviceId);
    box.lastPollAt = Math.max(box.lastPollAt, this.#clock.now());
    const answered = box.durable.find((d) => d.envelope.commandId === commandId);
    if (answered) {
      box.durable = box.durable.filter((d) => d !== answered);
      const { contentId } = answered.envelope.params ?? {};
      const installId = answered.envelope.installId ?? answered.deliveredTo ?? null;
      const key = `${contentId}@${installId ?? ''}`;
      const at = new Date(this.#clock.now()).toISOString();
      if (ok === true) {
        box.received = { ...box.received, [key]: { contentId, installId, command: answered.envelope.command, commandId, at } };
        const { [key]: _gone, ...rest } = box.refusals;
        box.refusals = rest;
      } else {
        box.refusals = {
          ...box.refusals,
          [key]: { contentId, installId, command: answered.envelope.command, commandId, reason: typeof error === 'string' && error ? error.slice(0, 200) : 'refused', at },
        };
      }
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

  #sampled(event, data) {
    if (typeof this.#logger.sampled === 'function') {
      this.#logger.sampled(event, data, { maxPerMinute: 2, aggregate: true });
    } else {
      this.#logger.warn?.(event, data);
    }
  }

  #emit(message) {
    if (!this.#publish) return;
    try { this.#publish(message); }
    catch (err) { this.#logger.warn?.('phone-inbox.publish.failed', { topic: message.topic, error: err?.message }); }
  }
}

export default PhoneInboxService;
