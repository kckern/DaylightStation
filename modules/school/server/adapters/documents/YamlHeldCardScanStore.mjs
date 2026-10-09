import path from 'node:path';
import { loadYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

/** Append-preserving evidence store for answer-sheet identity holds/reviews. */
export class YamlHeldCardScanStore {
  #file; #io; #now; #writeChain = Promise.resolve();

  constructor({ directory, io = {}, now = () => new Date().toISOString() } = {}) {
    if (typeof directory !== 'string' || !directory.trim()) {
      throw new Error('YamlHeldCardScanStore requires directory');
    }
    this.#file = path.join(directory, 'scan-protection', 'held-scans.yml');
    this.#io = { load: io.load ?? loadYamlFromPath, save: io.save ?? saveYamlToPathAtomic };
    this.#now = now;
  }

  async findByFingerprint(fingerprint) {
    return structuredClone(this.#load().findLast((record) => record.fingerprint === fingerprint) ?? null);
  }

  async record({ fingerprint, state, evidence } = {}) {
    if (typeof fingerprint !== 'string' || !fingerprint) throw new Error('held scan fingerprint required');
    if (!['held', 'seen', 'shadow'].includes(state)) throw new Error(`unknown held scan state '${state}'`);
    return this.#enqueue(async () => {
      const records = this.#load();
      const duplicateStates = state === 'shadow'
        ? new Set(['shadow', 'held', 'seen'])
        : new Set(['held', 'seen']);
      const existing = records.findLast((record) => record.fingerprint === fingerprint
        && duplicateStates.has(record.state));
      if (existing) return { record: structuredClone(existing), duplicate: true };
      const at = this.#now();
      const record = {
        // Keep a shadow observation and a later enforced hold distinct. The
        // rollout intentionally runs shadow first, so reusing one deterministic
        // id here made `get(id)` return the older shadow record after enforce
        // appended the real hold for the same scan fingerprint.
        heldScanId: `answer-sheet-${fingerprint.slice(0, 20)}-${state}`,
        fingerprint,
        state,
        createdAt: at,
        evidence: structuredClone(evidence),
        reviews: [],
      };
      records.push(record);
      this.#save(records);
      return { record: structuredClone(record), duplicate: false };
    });
  }

  async listHeld() {
    return structuredClone(this.#load().filter((record) => (
      record.state === 'held' && !record.reviews.some((review) => review.terminal === true)
    )));
  }

  async get(heldScanId) {
    const record = this.#load().find((entry) => entry.heldScanId === heldScanId);
    if (!record) throw new EntityNotFoundError('HeldCardScan', heldScanId);
    return structuredClone(record);
  }

  async appendReview({ heldScanId, idempotencyKey, review } = {}) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new Error('held scan review requires idempotencyKey');
    }
    return this.#enqueue(async () => {
      const records = this.#load();
      const index = records.findIndex((entry) => entry.heldScanId === heldScanId);
      if (index < 0) throw new EntityNotFoundError('HeldCardScan', heldScanId);
      const existing = records[index].reviews.find((entry) => entry.idempotencyKey === idempotencyKey);
      if (existing) return { review: structuredClone(existing), duplicate: true };
      if (records[index].reviews.some((entry) => entry.terminal === true)) {
        const error = new Error(`held scan '${heldScanId}' is already resolved`);
        error.code = 'HELD_SCAN_ALREADY_RESOLVED';
        throw error;
      }
      const appended = { ...structuredClone(review), idempotencyKey, at: review.at ?? this.#now() };
      records[index] = { ...records[index], reviews: [...records[index].reviews, appended] };
      this.#save(records);
      return { review: structuredClone(appended), duplicate: false };
    });
  }

  #load() {
    const raw = this.#io.load(this.#file);
    return Array.isArray(raw) ? structuredClone(raw) : [];
  }

  #save(records) { this.#io.save(this.#file, records, { noRefs: true }); }

  #enqueue(task) {
    const operation = this.#writeChain.then(task);
    this.#writeChain = operation.catch(() => {});
    return operation;
  }
}

export default YamlHeldCardScanStore;
