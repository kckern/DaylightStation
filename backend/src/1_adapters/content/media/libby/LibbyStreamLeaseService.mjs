import crypto from 'node:crypto';

const HOUR = 60 * 60 * 1000;

/** In-memory bearer-capability registry; raw handles are never retained. */
export class LibbyStreamLeaseService {
  #now;
  #randomBytes;
  #idleMs;
  #absoluteMs;
  #maxRecords;
  #pruneTimer;
  #records = new Map();

  constructor({ now = Date.now, randomBytes = crypto.randomBytes, idleMs = HOUR, absoluteMs = 12 * HOUR, maxRecords = 512, pruneIntervalMs = 60_000 } = {}) {
    this.#now = now;
    this.#randomBytes = randomBytes;
    this.#idleMs = idleMs;
    this.#absoluteMs = absoluteMs;
    this.#maxRecords = maxRecords;
    this.#pruneTimer = setInterval(() => this.prune(), pruneIntervalMs);
    this.#pruneTimer.unref?.();
  }

  #digest(handle) { return crypto.createHash('sha256').update(String(handle)).digest('hex'); }

  issue({ loan, part } = {}) {
    if (!loan?.cardId || !loan?.titleId || !part?.key || !part?.upstreamUrl) throw new Error('Libby lease requires loan and part');
    this.prune();
    while (this.#records.size >= this.#maxRecords) {
      const [digest, record] = this.#records.entries().next().value;
      this.#revokeDigest(digest, record);
    }
    const handle = this.#randomBytes(32).toString('base64url');
    const now = this.#now();
    const record = {
      cardId: String(loan.cardId), titleId: String(loan.titleId), partKey: String(part.key),
      part, issuedAt: now, lastAccessAt: now, verifiedAt: now,
      absoluteExpiresAt: Math.min(now + this.#absoluteMs, Number.isFinite(loan.expiresAt) ? loan.expiresAt : Infinity),
      aborts: new Set(),
    };
    this.#records.set(this.#digest(handle), record);
    return { handle };
  }

  resolve(handle) {
    const digest = this.#digest(handle);
    const record = this.#records.get(digest);
    if (!record) return { kind: 'gone', reason: 'absent' };
    const now = this.#now();
    if (now >= record.absoluteExpiresAt || now - record.lastAccessAt > this.#idleMs) {
      this.#revokeDigest(digest, record);
      return { kind: 'gone', reason: 'expired' };
    }
    record.lastAccessAt = now;
    return { kind: 'found', lease: record };
  }

  update(handle, { loan, part, verifiedAt = this.#now() } = {}) {
    const resolved = this.resolve(handle);
    if (resolved.kind !== 'found') return false;
    if (part) resolved.lease.part = part;
    resolved.lease.verifiedAt = verifiedAt;
    if (Number.isFinite(loan?.expiresAt)) resolved.lease.absoluteExpiresAt = Math.min(resolved.lease.absoluteExpiresAt, loan.expiresAt);
    return true;
  }

  attachAbort(handle, controller) {
    const resolved = this.resolve(handle);
    if (resolved.kind !== 'found') { controller.abort(); return () => {}; }
    resolved.lease.aborts.add(controller);
    return () => resolved.lease.aborts.delete(controller);
  }

  revoke(handle) {
    const digest = this.#digest(handle);
    const record = this.#records.get(digest);
    return record ? this.#revokeDigest(digest, record) : false;
  }

  revokeLoan(cardId, titleId) {
    let count = 0;
    for (const [digest, record] of this.#records) {
      if (record.cardId === String(cardId) && record.titleId === String(titleId)) {
        this.#revokeDigest(digest, record);
        count += 1;
      }
    }
    return count;
  }

  prune() {
    const now = this.#now();
    let count = 0;
    for (const [digest, record] of this.#records) {
      if (now >= record.absoluteExpiresAt || now - record.lastAccessAt > this.#idleMs) {
        this.#revokeDigest(digest, record);
        count += 1;
      }
    }
    return count;
  }

  dispose() {
    clearInterval(this.#pruneTimer);
    for (const [digest, record] of this.#records) this.#revokeDigest(digest, record);
  }

  #revokeDigest(digest, record) {
    for (const controller of record.aborts) controller.abort();
    record.aborts.clear();
    this.#records.delete(digest);
    return true;
  }

  inspect() {
    this.prune();
    return [...this.#records.entries()].map(([digest, record]) => ({
      digest, cardId: record.cardId, titleId: record.titleId, partKey: record.partKey,
      issuedAt: record.issuedAt, lastAccessAt: record.lastAccessAt, absoluteExpiresAt: record.absoluteExpiresAt,
    }));
  }
}

export default LibbyStreamLeaseService;
