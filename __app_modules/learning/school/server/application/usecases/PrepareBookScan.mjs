import { parseBookIdentifier } from "../../../../../../__capabilities/book-catalog/server/domain/BookIdentifier.mjs";

const TTL = 5 * 60_000;
// How long a claimed scan vouches for its book on that learner's shelf. It
// outlives the intention because the child still has to pick where they are
// with the book after the shelf opens; it is short because a pass left behind
// should not become a way to re-add the book all evening.
const PASS_TTL = 30 * 60_000;
// After a failed wake, scans for that screen within this window report the
// same failure instead of knocking on the kiosk again (2026-10-18: seven scans
// in ~5s fired seven wakes, every one failed).
const WAKE_COOLDOWN = 10_000;
const WAKE_FAILED = 'The screen could not wake. Open the Portal or rescan.';
// Shown for a scan that lands inside the cooldown: a rescan right now would
// not wake anything, so the child is told to give it a moment instead.
const WAKE_WAITING = 'The screen is waking up — wait a moment, then scan again.';
// A wake result can carry adapter error strings; keep them short and strip
// anything that looks like a credential before they reach the log store.
const safeError = (value) => (value == null ? null : String(value)
  .replace(/(password|token|key)=[^&\s]*/gi, '$1=***').slice(0, 200));
const stepSummary = (part) => (part && typeof part === 'object' ? {
  ok: part.ok ?? null,
  ...(part.step ? { step: part.step } : {}),
  ...(part.skipped ? { skipped: true } : {}),
  ...(part.error ? { error: safeError(part.error) } : {}),
} : null);
// THE PILE (2026-10-30). Every scan is ALSO a card in a per-screen pile that
// a grown-up files to one child with one tap (design:
// ops:docs/superpowers/specs/2026-10-30-portal-book-pile-design.md). The
// intentions above stay exactly as they were for the open-shelf scoped claim;
// cards are what the pile shows, and a card is never superseded or expired —
// only filed, claimed, removed, or cleared when the study day ends. A quiet
// gap of this long ends the SESSION: the reader stops being sticky, the cards
// stay.
export const PILE_QUIET_GAP_MS = 120_000;
const PILE_MAX_CARDS = 200;
// A reader that double-fires (or a child who taps twice) sends the same book
// again within seconds. Within this window the repeat only bumps the twin
// card's `duplicates`; it never makes a second record.
export const BURST_WINDOW_MS = 10_000;
const isIsbn13 = (value) => parseBookIdentifier(value).kind === 'isbn' && /^\d{13}$/.test(value);
const FILEABLE = new Set(['ready', 'not-found']);
const FILE_FAILED = 'Could not file this book. Tap a face to try again.';
const refuse = (status, message) => { const error = new Error(message); error.status = status; throw error; };

/**
 * Short-lived household kiosk intentions. No reading store or progress writer is a dependency.
 *
 * `pile` — the target screen shows the pile (the Portal: `BookScanEntry`
 * renders nothing for an unscoped scan there). Its waiting scans then form a
 * QUEUE that an open shelf drains first in, first out: nothing is superseded
 * by a later scan or by a claim, and `pending()` offers the OLDEST live intent.
 * Without it the corner-offer rules hold — one presented intent plus only the
 * newest deferred one (final review I1, 2026-11-05: on the Portal those rules
 * discarded books the shelf chip still counted as waiting). The store stays
 * bounded either way (32 intents, 5-minute TTL).
 */
export class PrepareBookScan {
  #deps; #records = new Map(); #events = new Map(); #passes = new Map(); #bursts = new Map();
  // Per screen: the wake in flight (shared by every scan that arrives while it
  // runs) and, after a failure, until when no new wake is attempted.
  #wakes = new Map(); #wakeCooldowns = new Map();
  // Per screen: { day, cards, reader, lastActiveAt, session, awake, chain }.
  // In memory, like the intentions: a backend restart loses an unfiled pile.
  #piles = new Map();
  constructor({ resolveBook, roster, issueLaunchTarget, wake, notifications, target,
    clock = Date.now, mintId, logger = {}, filer = null, dayOf = null, pile = false, schedule = null }) {
    if (typeof mintId !== 'function') throw new TypeError('PrepareBookScan requires a secure intent id generator');
    this.#deps = { resolveBook, roster, issueLaunchTarget, wake, notifications, target, clock, mintId, logger, filer, dayOf, pile: pile === true, schedule };
  }
  #prune() {
    const now = this.#deps.clock();
    for (const [key, firstAt] of this.#bursts) if (now - firstAt > BURST_WINDOW_MS) this.#bursts.delete(key);
    for (const [id, record] of this.#records) if (record.until <= now) this.#records.delete(id);
    for (const [id, until] of this.#events) if (until <= now) this.#events.delete(id);
    for (const [key, until] of this.#passes) if (until <= now) this.#passes.delete(key);
  }
  #notify(record) {
    try {
      Promise.resolve(this.#deps.notifications.bookScanAvailable({ screenId: record.screenId, intentId: record.id }))
        .catch(() => this.#deps.logger.warn?.('school.book-scan.notification-failed', {}));
    } catch { this.#deps.logger.warn?.('school.book-scan.notification-failed', {}); }
  }
  #live(record) { return this.#records.get(record.id) === record && record.phase === 'pending' && record.until > this.#deps.clock(); }
  #preview(record) {
    const { id, screenId, isbn13, receivedAt, expiresAt, status, book, error } = record;
    return { id, screenId, isbn13, receivedAt, expiresAt, status, book, error };
  }
  /**
   * @param {object} scan
   * @param {string} scan.code
   * @param {string} [scan.device]
   * @param {string} [scan.eventId]
   * @param {string|null} [scan.capturedAt] - when the reader captured it (the
   *   firmware's own clock, carried by the relay gateway); logged only
   * @param {number|null} [scan.delayedMs] - how long the reader held it before
   *   sending (an offline queue, a batch); logged only
   */
  async receive({ code, device, eventId, capturedAt = null, delayedMs = null }) {
    this.#prune();
    const { target, clock, mintId, logger } = this.#deps;
    if (!target?.screenId || !target?.deviceId) refuse(503, 'School book scan target is unavailable; ask a grown-up to configure the Portal, then rescan');
    const now = clock();
    const eventKey = eventId ? JSON.stringify([device, eventId]) : null;
    if (eventKey && this.#events.has(eventKey)) return { status: 'duplicate' };
    if (eventKey) {
      this.#events.set(eventKey, now + 10 * 60_000);
      // A separate bounded transport replay window, independent of the 32 intentions.
      while (this.#events.size > 2048) this.#events.delete(this.#events.keys().next().value);
    }
    // Two ISBNs run together by the reader (26 digits) are two scans, but only
    // when BOTH halves are real ISBN-13s; otherwise it stays one invalid code.
    const text = String(code ?? '').trim();
    if (/^\d{26}$/.test(text) && isIsbn13(text.slice(0, 13)) && isIsbn13(text.slice(13))) {
      const codes = [text.slice(0, 13), text.slice(13)];
      logger.info?.('school.book-scan.split', { screenId: target.screenId, codes });
      const results = [];
      for (const half of codes) results.push(await this.#intake({ code: half, device, capturedAt, delayedMs, now }));
      return { status: 'split', results };
    }
    return this.#intake({ code, device, capturedAt, delayedMs, now });
  }
  async #intake({ code, device, capturedAt, delayedMs, now }) {
    const { target, mintId, logger } = this.#deps;
    const parsed = parseBookIdentifier(code);
    const isbn13 = parsed.kind === 'isbn' ? parsed.isbn13 : code;
    // A code that names no book still becomes a card (so the grown-up sees it
    // was read), but it can never be filed: say so at warn, with the code. Two
    // ISBNs run together arrive here already split by `receive`; a 26-digit
    // run with a bad checksum in either half lands here whole, as one code.
    if (parsed.kind !== 'isbn') {
      logger.warn?.('school.book-scan.rejected', { screenId: target.screenId, code: String(code ?? '').slice(0, 128), reason: parsed.reason ?? parsed.kind, device: device ?? null });
    }
    const pile = this.#pileFor(target.screenId, now);
    const wasLive = this.#isLive(pile, now);
    if (!wasLive) {
      pile.session += 1; pile.reader = null;
      logger.info?.('school.book-pile.opened', { screenId: target.screenId, carried: pile.cards.filter(c => c.state === 'unfiled').length });
    }
    pile.lastActiveAt = now;
    // Same book twice in one session is one card. A later session's scan of it
    // is a new card: it may be for a different child.
    // A card a shelf claimed is that child's; a rescan of the book is a new card.
    const twin = pile.cards.find(c => c.session === pile.session && c.isbn13 === isbn13 && c.state !== 'removed' && c.state !== 'claimed');
    const burstKey = `${target.screenId}|${isbn13}`;
    const firstAt = this.#bursts.get(burstKey);
    // A burst is a reader double-firing at a book still being offered. A twin
    // whose intent is no longer live (dismissed, expired, evicted — or, on a
    // screen without a pile, superseded by a later scan or a shelf claim)
    // cannot be opened any more; the rescan is the child doing what
    // the shelf chip told them ("scan it again to open it") and must make a
    // new intent at once, not wait out the window.
    const twinLive = Boolean(twin) && [...this.#records.values()].some(r => r.card === twin && this.#live(r));
    const inBurst = twinLive && firstAt !== undefined && now - firstAt <= BURST_WINDOW_MS;
    if (firstAt === undefined || now - firstAt > BURST_WINDOW_MS) this.#bursts.set(burstKey, now);
    if (twin) {
      twin.duplicates += 1;
      logger.info?.('school.book-pile.card-added', { screenId: target.screenId, duplicate: true, isbn13 });
      if (twin.status === 'unavailable' && twin.record) this.#resolve(twin.record);
      this.#notify({ screenId: target.screenId, id: twin.id });
    }
    if (inBurst) logger.debug?.('school.book-scan.burst-duplicate', { screenId: target.screenId, isbn13, msSinceFirst: now - firstAt });
    const coalesced = [...this.#records.values()].find(r => this.#live(r) && r.isbn13 === isbn13);
    if (coalesced) {
      if (!twin) this.#addCard(pile, coalesced);
      if (!coalesced.claiming && coalesced.status === 'unavailable') this.#resolve(coalesced);
      if (!coalesced.claiming && coalesced.wakeFailed) this.#wake(coalesced);
      return { status: 'pending', intentId: coalesced.id };
    }
    // Inside the window a repeat never makes a second record, even when the
    // first record is no longer live (superseded, dismissed): the twin card
    // already counted it.
    if (inBurst) return { status: 'pending', intentId: twin.record?.id ?? twin.id };
    // A pile screen queues every waiting scan (see the class note). Elsewhere:
    // keep the presented intention and only the newest deferred intention.
    const pending = this.#deps.pile ? [] : [...this.#records.values()].filter(r => this.#live(r) && !r.claiming);
    const pinned = [...this.#records.values()].some(r => this.#live(r) && r.claiming);
    const superseded = pending.slice(0, Math.max(0, pending.length - (pinned ? 0 : 1)));
    for (const old of superseded) old.phase = 'superseded';
    const record = { id: mintId(), screenId: target.screenId, isbn13, receivedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + TTL).toISOString(), until: now + TTL, phase: 'pending',
      status: parsed.kind === 'isbn' ? 'loading' : 'invalid', book: null,
      error: parsed.kind === 'isbn' ? null : 'That book barcode is invalid. Scan the publisher ISBN again.' };
    this.#records.set(record.id, record);
    while (this.#records.size > 32) this.#records.delete(this.#records.keys().next().value);
    // An intent that runs out sends no event of its own, so a card would show
    // "scan it again" only when something else moved. Say so when it expires
    // (`schedule(fn, ms)` is the composition's timer; absent, nothing is sent).
    this.#deps.schedule?.(() => {
      if (this.#records.get(record.id) === record && record.phase === 'pending') this.#notify(record);
    }, TTL);
    if (twin) record.card = twin;
    else this.#addCard(pile, record);
    // A superseded intent can no longer be claimed by an open shelf; its card
    // stays in the pile. Without this line two scans inside one shelf step
    // left no trace of which book stopped being claimable.
    for (const old of superseded) logger.info?.('school.book-scan.superseded', { screenId: target.screenId, isbn13: old.isbn13, intentId: old.id, supersededBy: record.id });
    this.#notify(record);
    logger.info?.('school.book-scan.received', { screenId: target.screenId, status: record.status, isbn13,
      receivedAt: record.receivedAt, capturedAt: capturedAt ?? null, delayedMs: Number.isFinite(delayedMs) ? delayedMs : null });
    // One wake per session: a pile of scans must not knock on the kiosk for
    // each book. A failed wake keeps the old behaviour (retry, with cooldown).
    if (!(wasLive && pile.awake)) this.#wake(record);
    if (parsed.kind === 'isbn') this.#resolve(record);
    return { status: 'pending', intentId: record.id };
  }
  #wake(record) {
    const { target, clock, logger } = this.#deps;
    record.wakeFailed = false;
    if (record.error?.startsWith('The screen')) record.error = null;
    const cooldownUntil = this.#wakeCooldowns.get(target.screenId) ?? 0;
    const pile = this.#piles.get(target.screenId);
    if (!this.#wakes.has(target.screenId) && cooldownUntil > clock()) {
      if (pile) pile.awake = false;
      logger.info?.('school.book-scan.wake-skipped', { screenId: target.screenId, reason: 'cooldown' });
      this.#wakeFailedFor(record, WAKE_WAITING);
      return;
    }
    if (pile) pile.awake = true;   // optimistic: scans while it runs must not re-wake
    void this.#wakeScreen(target).then(ok => {
      if (ok) { if (this.#live(record)) this.#notify(record); return; }
      if (pile) pile.awake = false;
      this.#wakeFailedFor(record);
    });
  }
  #wakeFailedFor(record, message = WAKE_FAILED) {
    if (!this.#live(record)) return;
    record.wakeFailed = true; record.wakeMessage = message; record.error ??= message; this.#notify(record);
  }
  /** One wake per screen at a time; resolves true/false and never rejects. */
  #wakeScreen(target) {
    const { wake, clock, logger } = this.#deps;
    const { screenId } = target;
    const inFlight = this.#wakes.get(screenId);
    if (inFlight) return inFlight;
    const attempt = Promise.resolve()
      .then(() => wake({ target: target.deviceId }))
      .then(result => (result?.ok === false ? { failed: true, result } : { failed: false }),
        error => ({ failed: true, thrown: error }))
      .then(({ failed, result, thrown }) => {
        if (!failed) { this.#wakeCooldowns.delete(screenId); return true; }
        this.#wakeCooldowns.set(screenId, clock() + WAKE_COOLDOWN);
        const power = stepSummary(result?.power);
        const foreground = stepSummary(result?.foreground);
        logger.warn?.('school.book-scan.wake-failed', {
          screenId,
          step: result?.step ?? foreground?.step ?? power?.step
            ?? (power?.ok === false ? 'power' : foreground?.ok === false ? 'foreground' : thrown ? 'wake-threw' : null),
          power,
          foreground,
          error: safeError(result?.error ?? foreground?.error ?? power?.error ?? thrown?.message ?? (thrown ? String(thrown) : null)),
          cooldownMs: WAKE_COOLDOWN,
        });
        return false;
      })
      .finally(() => { this.#wakes.delete(screenId); });
    this.#wakes.set(screenId, attempt);
    return attempt;
  }
  #resolve(record) {
    record.status = 'loading'; record.error = record.wakeFailed ? record.wakeMessage ?? WAKE_FAILED : null;
    if (record.card) Object.assign(record.card, { status: 'loading', error: null });
    this.#notify(record);
    // The CARD takes the lookup whatever became of the intention: a pile card
    // outlives the 5-minute intent and must still learn its title.
    const toCard = (status, book, error) => {
      if (!record.card) return;
      Object.assign(record.card, { status, book, error });
      this.#notify({ screenId: record.screenId, id: record.card.id });
    };
    void Promise.resolve().then(() => this.#deps.resolveBook.execute(record.isbn13)).then(result => {
      const status = result?.status === 'ok' && result.book ? 'ready' : result?.status === 'not-found' ? 'not-found' : 'unavailable';
      toCard(status, status === 'ready' ? result.book : null, status === 'unavailable' ? 'Book details are unavailable. Try rescanning.' : null);
      if (!this.#live(record)) return;
      record.status = status;
      record.book = record.status === 'ready' ? result.book : null;
      if (record.status === 'unavailable') record.error = 'Book details are unavailable. Try rescanning.';
      this.#notify(record);
    }).catch(() => {
      toCard('unavailable', null, 'Book details are unavailable. Try rescanning.');
      if (!this.#live(record)) return;
      record.status = 'unavailable'; record.error = 'Book details are unavailable. Try rescanning.';
      this.#notify(record);
    });
  }
  pending(screenId) {
    this.#prune();
    // A pile screen drains first in, first out; elsewhere the newest wins.
    const records = [...this.#records.values()];
    const record = (this.#deps.pile ? records : records.reverse()).find(r => this.#live(r) && r.screenId === screenId);
    return record ? this.#preview(record) : null;
  }
  /**
   * Every live intent for a pile screen, oldest first — the queue an open
   * shelf drains. The panel walks it to skip the scans it must not take (one
   * already waiting when the shelf opened, an unreadable barcode, a claim that
   * already failed) without those holding up the books behind them. Null on a
   * screen without a pile.
   */
  queue(screenId) {
    if (!this.#deps.pile) return null;
    this.#prune();
    return [...this.#records.values()].filter(r => this.#live(r) && r.screenId === screenId).map(r => this.#preview(r));
  }
  #record(id, screenId) {
    this.#prune();
    const record = this.#records.get(id);
    if (!record) refuse(410, 'This scan expired. Scan the book again.');
    if (record.screenId !== screenId) refuse(403, 'This scan belongs to another screen.');
    return record;
  }
  async claim({ id, screenId, learnerId }) {
    const record = this.#record(id, screenId);
    if (record.phase !== 'pending' && record.phase !== 'claimed') refuse(410, 'This scan is no longer available. Scan the book again.');
    if (parseBookIdentifier(record.isbn13).kind !== 'isbn') refuse(400, 'Scan a valid publisher ISBN.');
    if ((record.result || record.claiming) && record.learnerId !== learnerId) refuse(409, 'This scan was selected by another learner. Rescan for your shelf.');
    if (record.claiming) return record.claiming;
    record.learnerId = learnerId;
    record.claiming = Promise.resolve().then(async () => {
      const roster = await this.#deps.roster();
      if (!Array.isArray(roster) || !roster.some(learner => learner.id === learnerId)) refuse(403, 'Choose a current School learner.');
      this.#record(id, screenId);
      if (record.phase !== 'pending' && record.phase !== 'claimed') refuse(410, 'This scan is no longer available. Scan again.');
      if (record.result) return record.result;
      const launchTarget = await this.#deps.issueLaunchTarget({ userId: learnerId });
      this.#record(id, screenId);
      if (record.phase !== 'pending') refuse(410, 'This scan is no longer available. Scan again.');
      record.result = { intentId: id, launchTarget, bookEntry: { isbn13: record.isbn13, book: record.book } };
      record.phase = 'claimed';
      if (record.card?.state === 'unfiled') record.card.state = 'claimed';
      this.#passes.set(JSON.stringify([learnerId, record.isbn13]), this.#deps.clock() + PASS_TTL);
      while (this.#passes.size > 256) this.#passes.delete(this.#passes.keys().next().value);
      // Retire older previews so returning home only offers the latest
      // deferred scan. Not on a pile screen: those wait their turn.
      if (!this.#deps.pile) for (const old of this.#records.values()) {
        if (old === record) break;
        if (old.phase === 'pending') {
          old.phase = 'superseded';
          this.#deps.logger.info?.('school.book-scan.superseded', { screenId, isbn13: old.isbn13, intentId: old.id, supersededBy: record.id });
        }
      }
      this.#notify(record);
      this.#deps.logger.info?.('school.book-scan.claimed', { screenId });
      return record.result;
    }).finally(() => { record.claiming = null; });
    return record.claiming;
  }
  /**
   * Did this learner claim a scan of this book recently? The proof a
   * scan-only shelf (`school.yml` `books.manualEntry: false`) asks for before
   * a book joins it — the barcode was physically read, not typed.
   */
  hasScanned({ learnerId, isbn13 }) {
    this.#prune();
    return this.#passes.has(JSON.stringify([learnerId, isbn13]));
  }
  // ---- the pile -----------------------------------------------------------
  #pileFor(screenId, now = this.#deps.clock()) {
    const day = this.#deps.dayOf ? this.#deps.dayOf(new Date(now).toISOString()) : null;
    let pile = this.#piles.get(screenId);
    if (!pile || pile.day !== day) {
      if (pile?.cards.some(c => c.state === 'unfiled')) {
        this.#deps.logger.info?.('school.book-pile.closed', { screenId, reason: 'day-ended', unfiled: pile.cards.filter(c => c.state === 'unfiled').length });
      }
      pile = { day, cards: [], reader: null, lastActiveAt: null, session: 0, awake: false, chain: Promise.resolve() };
      this.#piles.set(screenId, pile);
    }
    return pile;
  }
  #isLive(pile, now = this.#deps.clock()) {
    return pile.lastActiveAt !== null && now - pile.lastActiveAt <= PILE_QUIET_GAP_MS;
  }
  /** A new card for `record` in the current session; the record now feeds it. */
  #addCard(pile, record) {
    const card = { id: this.#deps.mintId(), record, isbn13: record.isbn13, session: pile.session,
      receivedAt: new Date(this.#deps.clock()).toISOString(), status: record.status, book: record.book,
      error: record.status === 'invalid' || record.status === 'unavailable' ? record.error : null,
      duplicates: 0, attempt: 0, state: 'unfiled', learnerId: null, outcome: null, itemId: null };
    record.card = card;
    pile.cards.push(card);
    this.#capPile(pile);
    this.#deps.logger.info?.('school.book-pile.card-added', { screenId: record.screenId, duplicate: false, status: card.status, isbn13: card.isbn13 });
    return card;
  }
  #capPile(pile) {
    while (pile.cards.length > PILE_MAX_CARDS) {
      const index = pile.cards.findIndex(c => c.state !== 'unfiled' && c.state !== 'filing');
      if (index < 0) break;   // never drop an unfiled book to make room
      pile.cards.splice(index, 1);
    }
  }
  #view(screenId, pile) {
    const live = this.#isLive(pile);
    return {
      screenId, live, reader: live ? pile.reader : null, quietGapMs: PILE_QUIET_GAP_MS,
      lastScanAt: pile.lastActiveAt === null ? null : new Date(pile.lastActiveAt).toISOString(),
      cards: pile.cards.filter(c => c.state !== 'removed').map((card) => {
        const { id, isbn13, status, book, error, receivedAt, duplicates, state, learnerId, outcome, itemId } = card;
        return { id, isbn13, status, book, error, receivedAt, duplicates, state, learnerId, outcome, itemId, ...this.#intentOf(card) };
      }),
    };
  }
  /**
   * Which intent feeds a card, and whether an open shelf can still claim it.
   * A card outlives its intent: on a screen without a pile two scans in one
   * shelf step leave the older one superseded (see `claim`), and a dismissed,
   * expired or evicted intent is just as gone — an unfiled card no shelf will ever open unless the book
   * is scanned again, which hands the card a live intent.
   */
  #intentOf(card) {
    const live = [...this.#records.values()].find(r => r.card === card && this.#live(r));
    const record = live ?? card.record ?? null;
    // Any unfiled card without a live intent is out of a shelf's reach —
    // superseded, dismissed, expired or evicted alike — and needs a rescan.
    return { intentId: record?.id ?? null, superseded: card.state === 'unfiled' && !live && record != null };
  }
  pile(screenId) {
    // Reading never allocates: only a scan (or a filing) creates a pile.
    if (!this.#piles.has(screenId)) {
      return { screenId, live: false, reader: null, quietGapMs: PILE_QUIET_GAP_MS, lastScanAt: null, cards: [] };
    }
    return this.#view(screenId, this.#pileFor(screenId));
  }
  /** Run one pile operation at a time per screen, so a card is never filed twice. */
  #serial(pile, task) {
    const run = pile.chain.then(task);
    pile.chain = run.catch(() => {});
    return run;
  }
  #requireFiler() {
    if (!this.#deps.filer) refuse(503, 'Filing books from the Portal is unavailable right now.');
    return this.#deps.filer;
  }
  async #requireLearner(learnerId) {
    const roster = await this.#deps.roster();
    if (!Array.isArray(roster) || !roster.some(learner => learner.id === learnerId)) refuse(403, 'Choose a current School learner.');
  }
  #card(pile, cardId) {
    const card = pile.cards.find(c => c.id === cardId && c.state !== 'removed');
    if (!card) refuse(403, 'That book is not in this pile.');
    return card;
  }
  async #fileCard(screenId, card, learnerId) {
    card.state = 'filing';
    try {
      const result = await this.#deps.filer.file({ learnerId, isbn13: card.isbn13, attemptKey: `${card.id}:${card.attempt}` });
      Object.assign(card, { state: 'filed', learnerId, outcome: result.outcome, itemId: result.itemId, error: null });
      this.#retire(card);
    } catch (error) {
      Object.assign(card, { state: 'unfiled', error: FILE_FAILED });
      this.#deps.logger.warn?.('school.book-pile.file-failed', { screenId, error: error?.message ?? String(error) });
    }
    this.#notify({ screenId, id: card.id });
  }
  /**
   * A card the pile has dealt with must not stay offered as a live intent: the
   * open-shelf path claims a live intent (the oldest on a pile screen), and would hand a book filed
   * to one child to whichever child opens their shelf next.
   */
  #retire(card) {
    if (card.record?.phase === 'pending' && !card.record.claiming) card.record.phase = 'dismissed';
  }
  async #unfileCard(card) {
    if (card.state !== 'filed') return;
    await this.#deps.filer.undo({ learnerId: card.learnerId, itemId: card.itemId, attemptKey: `${card.id}:${card.attempt}`, outcome: card.outcome });
    Object.assign(card, { state: 'unfiled', learnerId: null, outcome: null, itemId: null, attempt: card.attempt + 1 });
  }
  /**
   * One tap: file every unfiled card to this learner and make them the
   * session's reader. With `cardIds` it files just those and leaves the reader
   * alone — that is the tucked-away split, not the default.
   */
  async filePile({ screenId, learnerId, cardIds = null }) {
    this.#requireFiler();
    await this.#requireLearner(learnerId);
    const pile = this.#pileFor(screenId);
    if (cardIds) for (const id of cardIds) this.#card(pile, id);
    return this.#serial(pile, async () => {
      // NOTHING TO FILE IS A NO-OP. A pile already filed looks the same to a
      // child, who taps again (2026-11-05: three more taps). Such a tap must
      // not restart the quiet gap, or the pile stays up longer the more the
      // child tries to make it go away. A card still being looked up counts:
      // tapping a face for it is a real answer, and the sticky reader is how
      // it gets filed when the lookup lands.
      const waiting = pile.cards.some(c => c.state === 'unfiled' && (FILEABLE.has(c.status) || c.status === 'loading')
        && (!cardIds || cardIds.includes(c.id)));
      if (!waiting) {
        this.#deps.logger.debug?.('school.book-pile.file-empty', { screenId, learnerId, cards: pile.cards.length });
        return { ...this.#view(screenId, pile), filed: { learnerId, count: 0, alreadyToday: 0, failed: 0 } };
      }
      if (!cardIds) {
        // A tap on a pile left from a closed session opens a new one, so later
        // scans start fresh cards rather than merging with the old ones.
        if (!this.#isLive(pile)) pile.session += 1;
        pile.reader = learnerId; pile.lastActiveAt = this.#deps.clock();
      }
      const targets = pile.cards.filter(c => c.state === 'unfiled' && FILEABLE.has(c.status) && (!cardIds || cardIds.includes(c.id)));
      for (const card of targets) await this.#fileCard(screenId, card, learnerId);
      const filed = { learnerId,
        count: targets.filter(c => c.state === 'filed').length,
        alreadyToday: targets.filter(c => c.outcome === 'already-today').length,
        failed: targets.filter(c => c.state !== 'filed').length };
      if (targets.length) this.#deps.logger.info?.('school.book-pile.filed', { screenId, ...filed });
      // `filed` is what THIS tap did, so the panel can confirm it in the
      // server's own numbers rather than counting cards.
      return { ...this.#view(screenId, pile), filed };
    });
  }
  async moveCard({ screenId, cardId, learnerId }) {
    this.#requireFiler();
    await this.#requireLearner(learnerId);
    const pile = this.#pileFor(screenId);
    const card = this.#card(pile, cardId);
    return this.#serial(pile, async () => {
      if (!FILEABLE.has(card.status)) refuse(409, 'This book is still being looked up. Try again in a moment.');
      const from = card.learnerId;
      await this.#unfileCard(card);
      await this.#fileCard(screenId, card, learnerId);
      this.#deps.logger.info?.('school.book-pile.card-moved', { screenId, from, to: learnerId });
      return this.#view(screenId, pile);
    });
  }
  async removeCard({ screenId, cardId }) {
    const pile = this.#pileFor(screenId);
    const card = this.#card(pile, cardId);
    return this.#serial(pile, async () => {
      const wasFiled = card.state === 'filed';
      if (wasFiled) { this.#requireFiler(); await this.#unfileCard(card); }
      card.state = 'removed';
      this.#retire(card);
      this.#notify({ screenId, id: card.id });
      this.#deps.logger.info?.('school.book-pile.card-removed', { screenId, wasFiled });
      return this.#view(screenId, pile);
    });
  }
  dismiss({ id, screenId }) {
    const record = this.#record(id, screenId);
    if (record.phase !== 'claimed') record.phase = 'dismissed';
    this.#notify(record);
    return { dismissed: true };
  }
}
