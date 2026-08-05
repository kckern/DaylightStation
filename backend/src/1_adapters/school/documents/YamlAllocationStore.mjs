/**
 * YAML persistence for OMR allocation records (spec §5.4), mirroring
 * `YamlPrintDocumentRepository`'s directory-root convention (same `directory`
 * as sources/published/derived-banks) and `YamlRemediationSessionRepository`'s
 * write-chain + injected-`io` conventions.
 *
 *   <directory>/allocations/<cardId>.yml     (one file per PHYSICAL CARD,
 *                                              holding that card's full
 *                                              records array, oldest first)
 *
 * Persisted record shape (spec §5.4):
 *   { recordId, cardId, rowRange: {start, end}, documentId, rev, seed,
 *     variant, learnerId?, renderedAt, status, rowItems? }
 *
 * `rowItems` (F4 review fix — "bank-select scan integrity vs mutable external
 * banks"): `[{row, itemId, itemType}]`, the row→item mapping `planRows`
 * actually resolved AT RENDER TIME, straight off `RenderPrintDocument`'s own
 * `#allocateCard` (which already computes it to derive `rowRange` in the
 * first place — this is a pure passthrough, never re-derived here). A
 * bank-select block's selection formula (`resolveBankSelect`,
 * `RenderPrintDocument.mjs`) depends on `bank.items.length` — if an external
 * bank file gains or loses an item AFTER a card is printed, re-deriving the
 * mapping at scan time (`ResolveCardScan`'s whole reuse-the-render-seam
 * design) would silently resolve a DIFFERENT item than what is physically
 * printed on the card. `rowItems` is the durable record of what was actually
 * printed, so a scan can detect that drift instead of grading against a
 * mapping the paper doesn't carry. Optional: absent on any record allocated
 * before this field existed — `ResolveCardScan` keeps trusting pure
 * re-derivation for those, exactly as it always has.
 *
 * `recordId` is deterministic — `<documentId>@<rev>:v<variant>:<start>-<end>`
 * — so the same render context always names the same record.
 *
 * The domain (`2_domains/school/documents/allocation.mjs`) is pure and
 * speaks a FLAT record shape (`{cardId, startRow, endRow, documentId,
 * learnerId?, status}`) for `checkCollision`/`supersedes`, and a nested
 * `{start,end}` shape for `rangesOverlap`. This store is the boundary that
 * adapts between the domain's shapes and the persisted `rowRange` shape.
 *
 * SUPERSEDE SCOPE (Task 1 report's flagged judgment call): `supersedes` is
 * called with only THIS CARD's own records, so a reprint only ever
 * supersedes a prior record on the SAME card. A reprint issued against a
 * DIFFERENT card (e.g. the original card was lost) leaves the original
 * card's record `live` forever — it simply strands as an uncollected
 * allocation until someone explicitly `release`s that card. This is simpler
 * and safe: the alternative (a cross-card supersede) would let a record on
 * card A silently go stale because of an action taken against card B, with
 * no way for someone holding card A to discover why a scan of it no longer
 * resolves.
 *
 * COLLISION vs SUPERSEDE ordering: a candidate allocation first checks
 * whether it supersedes a prior live `(documentId, learnerId)` record on
 * this card; if so, that prior record is EXCLUDED from the collision check
 * (a same-range reprint must not collide with the very record it replaces).
 * Only then is the remaining live-record set checked for a row-range
 * collision (spec §5.4's "regardless of learner" rule).
 */
import path from 'node:path';
import { loadYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { DomainInvariantError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import {
  generateCardId, checkCollision, supersedes, rangesOverlap, ALLOCATION_STATUSES,
} from '#domains/school/documents/allocation.mjs';

const CARD_ID_RE = /^\d{7}$/;
const MAX_CARD_ID_ATTEMPTS = 20;
/** Legal `updateStatus`/`allocate`-supersede targets — always FROM `live` (spec §5.4). */
const TERMINAL_STATUSES = new Set(['satisfied', 'released', 'superseded']);

export class YamlAllocationStore {
  #directory; #rng; #now; #io; #writeChain = Promise.resolve();

  constructor({
    directory, rng = Math.random, now = () => new Date().toISOString(), io = {},
  } = {}) {
    if (typeof directory !== 'string' || directory.trim().length === 0) {
      throw new Error('YamlAllocationStore requires a non-empty directory');
    }
    this.#directory = directory;
    this.#rng = rng;
    this.#now = now;
    this.#io = { load: io.load ?? loadYamlFromPath, save: io.save ?? saveYamlToPathAtomic };
  }

  /**
   * @param {{cardId?: string, request: {documentId:string, rev:string,
   *   seed:number, variant?:number, learnerId?:string, rowRange:{start:number,end:number},
   *   rowItems?: Array<{row:number, itemId:string, itemType:string}>}}} args
   * @returns {Promise<object>} the persisted record
   */
  async allocate({ cardId, request } = {}) {
    assertRequest(request);
    if (cardId !== undefined) assertCardId(cardId);
    return this.#enqueue(async () => {
      let resolvedCardId = cardId;
      let existing;
      if (resolvedCardId !== undefined) {
        existing = this.#load(resolvedCardId);
      } else {
        ({ resolvedCardId, existing } = this.#generateFreshCardId());
      }

      const priorLive = supersedes(existing, {
        documentId: request.documentId, learnerId: request.learnerId ?? null,
      });
      const recordId = buildRecordId(request);

      // Identical render context re-requested (same documentId/rev/variant/rowRange as
      // the prior live record for this learner) names the SAME recordId — not a new
      // allocation to append, just the identical artifact reprinted. Mirrors
      // `IFormMapStore`'s "reprint reuses the artifact id -> resolves to the identical
      // record" idempotency: return the existing live record unchanged rather than
      // writing a second entry that would collide on recordId.
      if (priorLive && priorLive.recordId === recordId) {
        return structuredClone(priorLive);
      }
      // A recordId collision against ANY existing record (live or not) that is NOT the
      // supersede target means two different render contexts hashed to the same
      // deterministic id — refuse rather than create an ambiguous duplicate.
      const idClash = existing.find((record) => record.recordId === recordId);
      if (idClash) {
        throw new DomainInvariantError(
          `allocation recordId "${recordId}" already exists on card ${resolvedCardId} with status `
            + `"${idClash.status}" (not the record being superseded)`,
          { code: 'ALLOCATION_RECORD_ID_CONFLICT', details: { cardId: resolvedCardId, recordId } },
        );
      }

      const collisionPool = priorLive
        ? existing.filter((record) => record.recordId !== priorLive.recordId)
        : existing;
      const collisions = checkCollision(toFlatRecords(collisionPool), {
        cardId: resolvedCardId, startRow: request.rowRange.start, endRow: request.rowRange.end,
      });
      if (collisions.length > 0) {
        throw new DomainInvariantError(
          `allocation rows ${request.rowRange.start}-${request.rowRange.end} collide with `
            + `${collisions.length} live record(s) on card ${resolvedCardId}`,
          {
            code: 'ALLOCATION_COLLISION',
            details: { cardId: resolvedCardId, collidingRecordIds: collisions.map((record) => record.recordId) },
          },
        );
      }

      const record = {
        recordId,
        cardId: resolvedCardId,
        rowRange: { start: request.rowRange.start, end: request.rowRange.end },
        documentId: request.documentId,
        rev: request.rev,
        seed: request.seed,
        variant: request.variant ?? 0,
        ...(request.learnerId != null ? { learnerId: request.learnerId } : {}),
        ...(Array.isArray(request.rowItems) ? { rowItems: request.rowItems } : {}),
        renderedAt: this.#now(),
        status: 'live',
      };

      const updated = existing.map((prior) => (
        priorLive && prior.recordId === priorLive.recordId ? { ...prior, status: 'superseded' } : prior
      ));
      updated.push(record);
      this.#save(resolvedCardId, updated);
      return structuredClone(record);
    });
  }

  /** @returns {Promise<object[]>} this card's full records array (all statuses), oldest first. */
  async findByCard(cardId) {
    assertCardId(cardId);
    return structuredClone(this.#load(cardId));
  }

  /**
   * @param {{cardId:string, recordId:string, status:string}} args
   * @returns {Promise<object>} the updated record
   */
  async updateStatus({ cardId, recordId, status }) {
    assertCardId(cardId);
    if (!ALLOCATION_STATUSES.includes(status)) {
      throw new Error(`YamlAllocationStore.updateStatus: unknown status "${status}"`);
    }
    return this.#enqueue(async () => {
      const records = this.#load(cardId);
      const record = records.find((entry) => entry.recordId === recordId);
      if (!record) throw new EntityNotFoundError('AllocationRecord', recordId, { details: { cardId } });
      if (record.status !== 'live' || !TERMINAL_STATUSES.has(status)) {
        throw new DomainInvariantError(
          `illegal allocation status transition ${record.status} -> ${status} for record ${recordId}`,
          { code: 'ALLOCATION_ILLEGAL_TRANSITION' },
        );
      }
      const updated = records.map((entry) => (entry.recordId === recordId ? { ...entry, status } : entry));
      this.#save(cardId, updated);
      return structuredClone(updated.find((entry) => entry.recordId === recordId));
    });
  }

  /**
   * Releases all `live` records overlapping `rows`, or every `live` record
   * when `rows` is omitted (spec §5.4 "explicit CLI/admin release").
   * @param {{cardId:string, rows?: {start:number, end:number}}} args
   * @returns {Promise<object[]>} the records that were released (empty when none were live)
   */
  async release({ cardId, rows } = {}) {
    assertCardId(cardId);
    if (rows !== undefined) assertRowRange(rows, 'rows');
    return this.#enqueue(async () => {
      const records = this.#load(cardId);
      const releasedIds = new Set();
      const updated = records.map((record) => {
        if (record.status !== 'live') return record;
        if (rows && !rangesOverlap(record.rowRange, rows)) return record;
        releasedIds.add(record.recordId);
        return { ...record, status: 'released' };
      });
      if (releasedIds.size > 0) this.#save(cardId, updated);
      return structuredClone(updated.filter((record) => releasedIds.has(record.recordId)));
    });
  }

  /** Draws random cardIds (domain `generateCardId`) until one has no records in the store yet. */
  #generateFreshCardId() {
    for (let attempt = 0; attempt < MAX_CARD_ID_ATTEMPTS; attempt += 1) {
      const candidate = generateCardId(this.#rng);
      const existing = this.#load(candidate);
      if (existing.length === 0) return { resolvedCardId: candidate, existing };
    }
    throw new DomainInvariantError(
      `could not allocate a fresh card id after ${MAX_CARD_ID_ATTEMPTS} attempts (all collided with an existing card)`,
      { code: 'ALLOCATION_CARD_ID_EXHAUSTED' },
    );
  }

  /** Serializes all mutations (allocate/updateStatus/release) through one queue, per card-file write. */
  #enqueue(task) {
    const operation = this.#writeChain.then(task);
    this.#writeChain = operation.catch(() => {});
    return operation;
  }

  #path(cardId) { return path.join(this.#directory, 'allocations', `${cardId}.yml`); }

  #load(cardId) {
    const raw = this.#io.load(this.#path(cardId));
    return Array.isArray(raw) ? structuredClone(raw) : [];
  }

  #save(cardId, records) {
    this.#io.save(this.#path(cardId), records, { noRefs: true });
  }
}

/** `<documentId>@<rev>:v<variant>:<start>-<end>` (spec §5.4 / task brief). */
function buildRecordId({ documentId, rev, variant, rowRange }) {
  return `${documentId}@${rev}:v${variant ?? 0}:${rowRange.start}-${rowRange.end}`;
}

/** Adapts persisted `rowRange:{start,end}` records to the domain's flat `startRow`/`endRow` shape. */
function toFlatRecords(records) {
  return records.map((record) => ({
    ...record, startRow: record.rowRange.start, endRow: record.rowRange.end,
  }));
}

function assertCardId(cardId) {
  if (!CARD_ID_RE.test(cardId || '')) {
    throw new Error(`YamlAllocationStore: cardId must be a 7-digit string, got ${JSON.stringify(cardId)}`);
  }
}

function assertRowRange(rowRange, label) {
  if (!rowRange || !Number.isInteger(rowRange.start) || !Number.isInteger(rowRange.end)
      || rowRange.start > rowRange.end) {
    throw new Error(`YamlAllocationStore: ${label} must be {start, end} integers with start <= end`);
  }
}

function assertRequest(request) {
  if (!request || typeof request !== 'object') throw new Error('YamlAllocationStore.allocate requires a request');
  if (typeof request.documentId !== 'string' || request.documentId.trim().length === 0) {
    throw new Error('YamlAllocationStore.allocate request requires documentId');
  }
  if (typeof request.rev !== 'string' || request.rev.trim().length === 0) {
    throw new Error('YamlAllocationStore.allocate request requires rev');
  }
  if (!Number.isInteger(request.seed)) {
    throw new Error('YamlAllocationStore.allocate request requires an integer seed');
  }
  if (request.variant !== undefined && (!Number.isInteger(request.variant) || request.variant < 0)) {
    throw new Error('YamlAllocationStore.allocate request variant must be a non-negative integer');
  }
  assertRowRange(request.rowRange, 'request.rowRange');
  if (request.rowItems !== undefined) {
    const valid = Array.isArray(request.rowItems) && request.rowItems.every((entry) => (
      entry && Number.isInteger(entry.row) && typeof entry.itemId === 'string' && typeof entry.itemType === 'string'
    ));
    if (!valid) {
      throw new Error(
        'YamlAllocationStore.allocate request.rowItems must be an array of '
          + '{row:integer, itemId:string, itemType:string}',
      );
    }
  }
}

export default YamlAllocationStore;
