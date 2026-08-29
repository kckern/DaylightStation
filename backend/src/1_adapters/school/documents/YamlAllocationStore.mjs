/**
 * YAML persistence for OMR allocation records (spec §5.4), mirroring
 * `YamlPrintDocumentRepository`'s directory-root convention (same `directory`
 * as documents/cards/forms) and `YamlRemediationSessionRepository`'s
 * write-chain + injected-`io` conventions.
 *
 *   <directory>/cards/<cardId>.yml           (one file per PHYSICAL CARD,
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
import { loadYamlFromPath, readDirectory, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { DomainInvariantError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import {
  generateCardId, checkCollision, supersedes, rangesOverlap, ALLOCATION_STATUSES,
} from '#domains/school/documents/allocation.mjs';

const CARD_ID_RE = /^\d{7}$/;
const MAX_CARD_ID_ATTEMPTS = 20;
/** Legal `updateStatus`/`allocate`-supersede targets — always FROM `live` (spec §5.4). */
const TERMINAL_STATUSES = new Set(['satisfied', 'released', 'superseded']);

export class YamlAllocationStore {
  #directory; #rng; #now; #io; #timeZone; #writeChain = Promise.resolve();

  constructor({
    directory, rng = Math.random, now = () => new Date().toISOString(), io = {}, timeZone = 'UTC',
  } = {}) {
    if (typeof directory !== 'string' || directory.trim().length === 0) {
      throw new Error('YamlAllocationStore requires a non-empty directory');
    }
    this.#directory = directory;
    this.#rng = rng;
    this.#now = now;
    this.#timeZone = timeZone;
    this.#io = {
      load: io.load ?? loadYamlFromPath,
      save: io.save ?? saveYamlToPathAtomic,
      list: io.list ?? listAllocationCardIds,
    };
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
      // A recordId collision against an existing record that is NOT the
      // supersede target: when that record is `satisfied` and the request is
      // the byte-identical render context (same seed/learner/row mapping),
      // this is a REPRINT OF A TAKEN QUIZ — the teacher pulling the sheet or
      // its answer key back up to grade — and must return the record
      // unchanged, exactly like the live-reprint shortcut above. (Before this
      // branch existed, scanning a card poisoned its own print URL: the
      // satisfied record's id clashed here and every re-render 500'd.)
      // Anything else — a released/superseded record, or a same-id request
      // whose context actually differs — is refused rather than allowed to
      // create an ambiguous duplicate.
      const idClash = existing.find((record) => record.recordId === recordId);
      if (idClash) {
        if (idClash.status === 'satisfied') {
          if (isIdenticalReprint(idClash, request)) return structuredClone(idClash);
          throw new DomainInvariantError(
            `allocation recordId "${recordId}" exists satisfied on card ${resolvedCardId} but the request `
              + `is not an identical reprint (${reprintMismatchReason(idClash, request)})`,
            { code: 'ALLOCATION_RECORD_ID_CONFLICT', details: { cardId: resolvedCardId, recordId } },
          );
        }
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
        ...(request.sessionId != null ? { sessionId: request.sessionId } : {}),
        ...(Array.isArray(request.rowItems) ? { rowItems: request.rowItems } : {}),
        // Optional immutable lesson ownership for a composed worksheet. It
        // is deliberately stored with the allocation, not inferred from a
        // mutable course/agenda later, so an old OMR card always resolves to
        // the lesson sessions that were actually printed on it.
        ...(Array.isArray(request.sections) ? { sections: request.sections } : {}),
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
   * Physical-card usage. Historical rows are intentionally never reclaimed:
   * a satisfied/released/superseded allocation still has bubbles on paper.
   */
  async describeCard(cardId, { capacity = 50, expectedLearnerId = null } = {}) {
    assertCardId(cardId);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
      throw new Error('YamlAllocationStore.describeCard capacity must be 1..50');
    }
    const allocations = this.#load(cardId);
    const occupiedThrough = allocations.reduce((max, record) => Math.max(max, record.rowRange?.end ?? 0), 0);
    const learnerIds = [...new Set(allocations.map((record) => record.learnerId).filter(Boolean))];
    const mappedLearnerId = learnerIds.length === 1 ? learnerIds[0] : null;
    const statusCounts = Object.fromEntries(ALLOCATION_STATUSES.map((status) => [
      status, allocations.filter((record) => record.status === status).length,
    ]));
    const warnings = [];
    if (learnerIds.length > 1) warnings.push('This Student No. has allocations mapped to more than one learner.');
    if (expectedLearnerId && mappedLearnerId && mappedLearnerId !== expectedLearnerId) {
      warnings.push(`This Student No. is mapped to ${mappedLearnerId}, not ${expectedLearnerId}.`);
    }
    return {
      schema: 'school.answer-sheet/v1', cardId, studentNumber: cardId, capacity,
      usedRows: Math.min(capacity, occupiedThrough), remainingContiguousSlots: Math.max(0, capacity - occupiedThrough),
      nextRow: occupiedThrough < capacity ? occupiedThrough + 1 : null,
      mappedLearnerId, learnerIds, statusCounts, warnings, allocations: structuredClone(allocations),
    };
  }

  /**
   * Every record for `documentId` across ALL cards — the sheet-identity lookup
   * behind "reuse this document's existing sheet" (the print route's automatic
   * omr mode). A linear scan of the allocations directory: card counts are
   * household-scale, and a missing directory simply means no cards yet.
   */
  async findByDocument(documentId) {
    const out = [];
    for (const cardId of this.#io.list(path.join(this.#directory, 'cards'))) {
      for (const record of this.#load(cardId)) {
        if (record.documentId === documentId) out.push(structuredClone(record));
      }
    }
    return out;
  }

  /**
   * Finds the learner's most recently used settled physical card with enough
   * untouched rows for another worksheet. Rows are never reclaimed: marks
   * remain on paper even after an allocation is satisfied or superseded.
   */
  async findReusableCard({ learnerId, rowsNeeded, capacity = 50, reuse = 'after_scan' } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new Error('YamlAllocationStore.findReusableCard requires learnerId');
    }
    if (!Number.isInteger(rowsNeeded) || rowsNeeded < 1) {
      throw new Error('YamlAllocationStore.findReusableCard requires rowsNeeded >= 1');
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('YamlAllocationStore.findReusableCard requires capacity >= 1');
    }
    if (!['never', 'after_scan', 'school_day', 'until_full'].includes(reuse)) {
      throw new Error(`YamlAllocationStore.findReusableCard: unknown reuse policy "${reuse}"`);
    }
    if (reuse === 'never') return null;

    const candidates = [];
    for (const cardId of this.#io.list(path.join(this.#directory, 'cards'))) {
      const records = this.#load(cardId);
      const learnerRecords = records.filter((record) => record.learnerId === learnerId);
      if (learnerRecords.length === 0) continue;
      // Conservative mode preserves the original behavior. Shared-card modes
      // may append non-overlapping live allocations for this same learner.
      if (reuse === 'after_scan' && learnerRecords.some((record) => record.status === 'live')) continue;
      if (reuse === 'school_day') {
        const today = localDateKey(this.#now(), this.#timeZone);
        if (!learnerRecords.some((record) => localDateKey(record.renderedAt, this.#timeZone) === today)) continue;
      }
      // A Student No. must never be shared between learners.
      if (records.some((record) => record.learnerId != null && record.learnerId !== learnerId)) continue;
      const occupiedThrough = Math.max(...records.map((record) => record.rowRange.end));
      const startRow = occupiedThrough + 1;
      if (startRow + rowsNeeded - 1 > capacity) continue;
      const lastUsedAt = learnerRecords.reduce((latest, record) => (
        record.renderedAt > latest ? record.renderedAt : latest
      ), '');
      candidates.push({ cardId, startRow, lastUsedAt });
    }
    candidates.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt) || b.cardId.localeCompare(a.cardId));
    return candidates.length ? { cardId: candidates[0].cardId, startRow: candidates[0].startRow } : null;
  }

  /**
   * Retires every live allocation on a lost physical answer sheet. Settled
   * evidence remains settled; history is never deleted. Replacement metadata
   * makes the lineage inspectable from either card.
   */
  async markCardLost({ cardId, replacementCardId, reportedBy, at = this.#now() } = {}) {
    assertCardId(cardId);
    assertCardId(replacementCardId);
    if (cardId === replacementCardId) throw new Error('replacementCardId must differ from lost cardId');
    if (typeof reportedBy !== 'string' || !reportedBy.trim()) throw new Error('markCardLost requires reportedBy');
    return this.#enqueue(async () => {
      const records = this.#load(cardId);
      const changed = [];
      const updated = records.map((record) => {
        if (record.status !== 'live') return record;
        const next = {
          ...record,
          status: 'superseded',
          supersededReason: 'answer-sheet-lost',
          replacementCardId,
          supersededAt: at,
          supersededBy: reportedBy,
        };
        changed.push(next);
        return next;
      });
      if (changed.length > 0) this.#save(cardId, updated);
      return structuredClone(changed);
    });
  }

  async markRecordLost({ cardId, recordId, replacementCardId, replacementRecordId, reportedBy, at = this.#now() } = {}) {
    assertCardId(cardId);
    assertCardId(replacementCardId);
    if (cardId === replacementCardId) throw new Error('replacementCardId must differ from lost cardId');
    if (typeof reportedBy !== 'string' || !reportedBy.trim()) throw new Error('markRecordLost requires reportedBy');
    return this.#enqueue(async () => {
      const records = this.#load(cardId);
      const record = records.find((entry) => entry.recordId === recordId);
      if (!record) throw new EntityNotFoundError('AllocationRecord', recordId, { details: { cardId } });
      if (record.status !== 'live') {
        throw new DomainInvariantError(`cannot replace ${record.status} allocation ${recordId} as lost`, {
          code: 'ALLOCATION_ILLEGAL_TRANSITION',
        });
      }
      const replacement = {
        ...record,
        status: 'superseded',
        supersededReason: 'answer-sheet-lost',
        replacementCardId,
        replacementRecordId,
        supersededAt: at,
        supersededBy: reportedBy,
      };
      this.#save(cardId, records.map((entry) => (entry.recordId === recordId ? replacement : entry)));
      return structuredClone(replacement);
    });
  }

  /** Every card id with any records in the store — the near-miss pool for mis-bubbled-card diagnostics. */
  async listCardIds() {
    return [...this.#io.list(path.join(this.#directory, 'cards'))];
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

  #path(cardId) { return path.join(this.#directory, 'cards', `${cardId}.yml`); }

  #load(cardId) {
    const raw = this.#io.load(this.#path(cardId));
    return Array.isArray(raw) ? structuredClone(raw) : [];
  }

  #save(cardId, records) {
    this.#io.save(this.#path(cardId), records, { noRefs: true });
  }
}

/** Card ids present in the cards dir; a missing dir is simply "no cards yet". */
function listAllocationCardIds(dir) {
  try {
    return readDirectory(dir).filter((name) => name.endsWith('.yml')).map((name) => name.slice(0, -4));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function localDateKey(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** `<documentId>@<rev>:v<variant>:<start>-<end>` (spec §5.4 / task brief). */
function buildRecordId({ documentId, rev, variant, rowRange }) {
  return `${documentId}@${rev}:v${variant ?? 0}:${rowRange.start}-${rowRange.end}`;
}

/**
 * Whether a request whose recordId matched a satisfied record really IS that
 * record's render context. recordId already pins documentId/rev/variant/
 * rowRange; the fields it does NOT carry — seed, learner, and the printed
 * row→item mapping — must agree too, or the "reprint" would put different
 * questions (or a different child's identity) under the same card rows.
 * A missing rowItems on either side is a legacy record — accepted, exactly
 * as `ResolveCardScan` trusts re-derivation for those.
 */
function isIdenticalReprint(record, request) {
  if (record.seed !== request.seed) return false;
  if ((record.learnerId ?? null) !== (request.learnerId ?? null)) return false;
  if (Array.isArray(record.rowItems) && Array.isArray(request.rowItems)) {
    if (record.rowItems.length !== request.rowItems.length) return false;
    return record.rowItems.every((entry, index) => {
      const other = request.rowItems[index];
      return entry.row === other.row && entry.itemId === other.itemId && entry.itemType === other.itemType;
    });
  }
  return true;
}

/**
 * The first `isIdenticalReprint` check that failed, in the SAME order —
 * for the `ALLOCATION_RECORD_ID_CONFLICT` message, so a teacher (or the
 * dev debugging their bug report) sees WHICH field actually differs
 * instead of a bare "not an identical reprint".
 */
function reprintMismatchReason(record, request) {
  if (record.seed !== request.seed) return 'seed differs';
  if ((record.learnerId ?? null) !== (request.learnerId ?? null)) return 'learner differs';
  return 'row mapping differs';
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
  if (request.sessionId !== undefined && request.sessionId !== null
      && (typeof request.sessionId !== 'string' || request.sessionId.trim().length === 0)) {
    throw new Error('YamlAllocationStore.allocate request sessionId must be a non-empty string when given');
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
  if (request.sections !== undefined) {
    const valid = Array.isArray(request.sections) && request.sections.every((section) => (
      section && typeof section.id === 'string' && section.id.trim()
      && section.rowRange && Number.isInteger(section.rowRange.start) && Number.isInteger(section.rowRange.end)
      && section.rowRange.start <= section.rowRange.end
      && section.rowRange.start >= request.rowRange.start && section.rowRange.end <= request.rowRange.end
      && (section.sessionId === undefined || typeof section.sessionId === 'string')
      && (section.lessonId === undefined || typeof section.lessonId === 'string')
    ));
    if (!valid) {
      throw new Error('YamlAllocationStore.allocate request.sections must be section ids with in-range rowRange values');
    }
  }
}

export default YamlAllocationStore;
