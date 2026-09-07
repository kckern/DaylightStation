import { parseBookIdentifier } from '#domains/books/BookIdentifier.mjs';

const TTL = 5 * 60_000;
const refuse = (status, message) => { const error = new Error(message); error.status = status; throw error; };

/** Short-lived household kiosk intentions. No reading store or progress writer is a dependency. */
export class PrepareBookScan {
  #deps; #records = new Map(); #events = new Map();
  constructor({ resolveBook, roster, issueLaunchTarget, wake, notifications, target,
    clock = Date.now, mintId, logger = {} }) {
    if (typeof mintId !== 'function') throw new TypeError('PrepareBookScan requires a secure intent id generator');
    this.#deps = { resolveBook, roster, issueLaunchTarget, wake, notifications, target, clock, mintId, logger };
  }
  #prune() {
    const now = this.#deps.clock();
    for (const [id, record] of this.#records) if (record.until <= now) this.#records.delete(id);
    for (const [id, until] of this.#events) if (until <= now) this.#events.delete(id);
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
  async receive({ code, device, eventId }) {
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
    const parsed = parseBookIdentifier(code);
    const isbn13 = parsed.kind === 'isbn' ? parsed.isbn13 : code;
    const coalesced = [...this.#records.values()].find(r => this.#live(r) && r.isbn13 === isbn13);
    if (coalesced) {
      if (!coalesced.claiming && coalesced.status === 'unavailable') this.#resolve(coalesced);
      if (!coalesced.claiming && coalesced.wakeFailed) this.#wake(coalesced);
      return { status: 'pending', intentId: coalesced.id };
    }
    const pending = [...this.#records.values()].filter(r => this.#live(r) && !r.claiming);
    // Keep the presented intention and only the newest deferred intention.
    const pinned = [...this.#records.values()].some(r => this.#live(r) && r.claiming);
    for (const old of pending.slice(0, Math.max(0, pending.length - (pinned ? 0 : 1)))) old.phase = 'superseded';
    const record = { id: mintId(), screenId: target.screenId, isbn13, receivedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + TTL).toISOString(), until: now + TTL, phase: 'pending',
      status: parsed.kind === 'isbn' ? 'loading' : 'invalid', book: null,
      error: parsed.kind === 'isbn' ? null : 'That book barcode is invalid. Scan the publisher ISBN again.' };
    this.#records.set(record.id, record);
    while (this.#records.size > 32) this.#records.delete(this.#records.keys().next().value);
    this.#notify(record);
    logger.info?.('school.book-scan.received', { screenId: target.screenId, status: record.status });
    this.#wake(record);
    if (parsed.kind === 'isbn') this.#resolve(record);
    return { status: 'pending', intentId: record.id };
  }
  #wake(record) {
    const { wake, target, logger } = this.#deps;
    record.wakeFailed = false;
    if (record.error?.startsWith('The screen')) record.error = null;
    void Promise.resolve().then(() => wake({ target: target.deviceId })).then(result => {
      if (result?.ok === false) throw new Error('Wake refused');
      if (this.#live(record)) this.#notify(record);
    }).catch(() => {
      logger.warn?.('school.book-scan.wake-failed', { screenId: target.screenId });
      if (this.#live(record)) { record.wakeFailed = true; record.error ??= 'The screen could not wake. Open the Portal or rescan.'; this.#notify(record); }
    });
  }
  #resolve(record) {
    record.status = 'loading'; record.error = record.wakeFailed ? 'The screen could not wake. Open the Portal or rescan.' : null;
    this.#notify(record);
    void Promise.resolve().then(() => this.#deps.resolveBook.execute(record.isbn13)).then(result => {
      if (!this.#live(record)) return;
      record.status = result?.status === 'ok' && result.book ? 'ready' : result?.status === 'not-found' ? 'not-found' : 'unavailable';
      record.book = record.status === 'ready' ? result.book : null;
      if (record.status === 'unavailable') record.error = 'Book details are unavailable. Try rescanning.';
      this.#notify(record);
    }).catch(() => {
      if (!this.#live(record)) return;
      record.status = 'unavailable'; record.error = 'Book details are unavailable. Try rescanning.';
      this.#notify(record);
    });
  }
  pending(screenId) {
    this.#prune();
    const record = [...this.#records.values()].reverse().find(r => this.#live(r) && r.screenId === screenId);
    return record ? this.#preview(record) : null;
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
      // Retire older previews so returning home only offers the latest deferred scan.
      for (const old of this.#records.values()) {
        if (old === record) break;
        if (old.phase === 'pending') old.phase = 'superseded';
      }
      this.#notify(record);
      this.#deps.logger.info?.('school.book-scan.claimed', { screenId });
      return record.result;
    }).finally(() => { record.claiming = null; });
    return record.claiming;
  }
  dismiss({ id, screenId }) {
    const record = this.#record(id, screenId);
    if (record.phase !== 'claimed') record.phase = 'dismissed';
    this.#notify(record);
    return { dismissed: true };
  }
}
