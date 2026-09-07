/**
 * YAML persistence for the reading shelf.
 *
 *   <householdPath>/school/records/books/{learnerId}.yml
 *
 * `records/`, not `runtime/`: a finished book is durable evidence a report card
 * is reconstructed from, never operational state a cooldown may prune.
 *
 * ## A READING, NOT A BOOK
 *
 * The stored unit is one child's PASS THROUGH a book: a `rdg_…` id that names
 * nothing, with the learner, the book and the days as FIELDS. The v1 shape
 * keyed an item `<learner>:<book>:<entryId>` and this adapter parsed the
 * learner back out of it to choose which file to write — which made correcting
 * a mis-scanned ISBN produce an id that lied, and made moving a book to the
 * sibling who actually read it structurally impossible. Every write here names
 * its learner explicitly; nothing parses an id, ever.
 *
 * ## SHARDED BY LEARNER, NOT BY DAY
 *
 * `YamlReadingLogStore` shards by study day because a daily count asks about
 * one day. A book is the opposite shape — it spans days, and every question
 * worth asking is about a learner across time.
 *
 * ## READS TOLERATE v1; WRITES EMIT v2
 *
 * A file with no `schema:` is v1 and is mapped into the v2 shape ON READ, with
 * its v1 `itemId` kept as the reading id so the ids a panel is holding stay
 * valid. Reading never rewrites it. The first WRITE converts the file, and
 * copies the original bytes to `{learnerId}.v1.bak` first — the same backup the
 * migration CLI takes, because a conversion nobody asked for still deserves one.
 *
 * ## STILL IDEMPOTENT ON THE CLIENT'S KEY
 *
 * A retried POST or a remounted screen must not append twice: a duplicate
 * finish is a duplicate BOOK against an obligation. The key does ONE job now —
 * it dedupes. It no longer names the record it created.
 *
 * ## MISSING IS EMPTY; DAMAGED IS LOUD
 *
 * A missing file answers `[]`. A corrupt, structurally invalid, or unreadable
 * file throws a named error on reads AND writes. Painting a damaged year of
 * evidence as an empty shelf tells a child the wrong story; accepting the next
 * write after that would replace the only copy. The UI can retry and an adult
 * can repair the bytes, but this adapter never silently discards them.
 *
 * @module adapters/persistence/yaml/YamlBookLogStore
 */
import path from 'path';
import yaml from 'js-yaml';
import { fileExists, readFile, writeFileAtomic, ensureDir } from '#system/utils/FileIO.mjs';
import { shortId } from '#system/utils/id.mjs';
import { readingFromLegacyItem } from '#domains/school/bookShelf.mjs';
import { IBookLogStore } from '#apps/school/ports/IBookLogStore.mjs';

/** No separators, no traversal — this becomes a filename. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const SCHEMA = 'school.book-log/v2';
const PROGRESS_MODES = new Set(['page', 'minutes', 'check']);
const STATUSES = new Set(['reading', 'finished', 'set-aside', 'unread']);

/** What `updateReading` may set. Identity and evidence are not in it. */
const READING_PATCH_FIELDS = new Set(['book', 'progressMode', 'status', 'openedOn', 'finishedOn']);
/** What `updateEntry` may set. An entry's id is not in it either. */
const ENTRY_PATCH_FIELDS = new Set(['on', 'at', 'page', 'minutes', 'note', 'rating', 'source']);

const isoDay = (at) => String(at ?? '').slice(0, 10);

export class BookLogShelfUnreadableError extends Error {
  constructor({ learnerId, status, reason }) {
    super(`Reading shelf for ${learnerId} is ${status}: ${reason || 'invalid data'}`);
    this.name = 'BookLogShelfUnreadableError';
    this.code = 'BOOK_LOG_SHELF_UNREADABLE';
    this.learnerId = learnerId;
    this.status = status;
  }
}

export class YamlBookLogStore extends IBookLogStore {
  #configService; #logger; #clock; #dayOf;
  #writeChain = Promise.resolve();

  constructor({ configService, logger = console, clock = () => new Date(), dayOf = isoDay } = {}) {
    super();
    if (!configService || typeof configService.getHouseholdPath !== 'function') {
      throw new Error('YamlBookLogStore: configService with getHouseholdPath() is required');
    }
    this.#configService = configService;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
    // The household's study-day rule, so a v1 file's instants map to the same
    // days the launcher measures with. A UTC slice would move a 7pm read to the
    // next day and shift real reading into a week already reported on.
    this.#dayOf = typeof dayOf === 'function' ? dayOf : isoDay;
  }

  #dir() { return this.#configService.getHouseholdPath('school/records/books'); }

  #fileFor(learnerId) { return path.join(this.#dir(), `${learnerId}.yml`); }

  #backupFor(learnerId) { return path.join(this.#dir(), `${learnerId}.v1.bak`); }

  #assertLearner(learnerId) {
    if (typeof learnerId !== 'string' || !SAFE_ID.test(learnerId)) {
      throw new Error(`YamlBookLogStore: unsafe learnerId: ${learnerId}`);
    }
    return learnerId;
  }

  /** Never throws; callers decide whether a missing or damaged file is usable. */
  #load(learnerId) {
    const file = this.#fileFor(learnerId);
    if (!fileExists(file)) return { status: 'missing', readings: [], legacy: false, text: null, file };
    let text;
    try {
      text = readFile(file);
    } catch (error) {
      return { status: 'unreadable', readings: [], legacy: false, text: null, file, reason: error.message };
    }
    try {
      const parsed = yaml.load(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { status: 'corrupt', readings: [], legacy: false, text, file, reason: 'root must be a mapping' };
      }
      if (parsed.schema === SCHEMA) {
        if (!Array.isArray(parsed.readings)) {
          return { status: 'corrupt', readings: [], legacy: false, text, file, reason: 'readings must be a list' };
        }
        return { status: 'ok', readings: parsed.readings.filter(Boolean), legacy: false, text, file };
      }
      if (!Array.isArray(parsed.items)) {
        return {
          status: 'corrupt', readings: [], legacy: false, text, file,
          reason: `root must carry ${SCHEMA} readings or a v1 items list`,
        };
      }
      // v1, mapped for this read only. The bytes on disk are not touched.
      const readings = parsed.items.filter(Boolean)
        .map((item) => readingFromLegacyItem(item, { learnerId, dayOf: this.#dayOf }));
      return { status: 'ok', readings, legacy: true, text, file };
    } catch (error) {
      return { status: 'corrupt', readings: [], legacy: false, text, file, reason: error.message };
    }
  }

  #requireReadable(learnerId, loaded) {
    if (loaded.status === 'missing' || loaded.status === 'ok') return loaded;
    this.#logger.error?.('school.book-log.shelf-unreadable', {
      learnerId, status: loaded.status, file: loaded.file, reason: loaded.reason,
    });
    throw new BookLogShelfUnreadableError({ learnerId, status: loaded.status, reason: loaded.reason });
  }

  /** Serialise writes; a shelf is read-modify-write and two panels may race. */
  #enqueue(work) {
    const queued = this.#writeChain.then(work, work);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  #persist(learnerId, loaded, readings) {
    const file = this.#fileFor(learnerId);
    ensureDir(path.dirname(file));
    this.#requireReadable(learnerId, loaded);
    // A v1 file is about to become a v2 one. Keep the original bytes: this
    // conversion was a side effect of a child logging a page, not a migration
    // anyone reviewed.
    if (loaded.legacy && typeof loaded.text === 'string' && !fileExists(this.#backupFor(learnerId))) {
      writeFileAtomic(this.#backupFor(learnerId), loaded.text);
      this.#logger.info?.('school.book-log.v1-converted', { learnerId, backup: this.#backupFor(learnerId) });
    }
    writeFileAtomic(file, yaml.dump({ schema: SCHEMA, readings }, { lineWidth: 120 }));
  }

  /** A deep-enough copy that a caller cannot edit the store's own arrays. */
  #copy(reading) {
    return {
      ...reading,
      book: { ...(reading.book ?? {}) },
      entries: (reading.entries ?? []).map((entry) => ({ ...entry })),
      revisions: (reading.revisions ?? []).map((revision) => ({ ...revision })),
    };
  }

  #mint(prefix, taken) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = `${prefix}_${shortId(12)}`;
      if (!taken.has(id)) return id;
    }
    throw new Error(`YamlBookLogStore: could not mint a unique ${prefix} id`);
  }

  #find(learnerId, readings, readingId) {
    const target = readings.find((reading) => reading.id === readingId);
    if (!target) throw new Error(`YamlBookLogStore: no reading ${readingId} for ${learnerId}`);
    return target;
  }

  async listForLearner(learnerId) {
    if (typeof learnerId !== 'string' || !SAFE_ID.test(learnerId)) return [];
    const loaded = this.#requireReadable(learnerId, this.#load(learnerId));
    return loaded.readings.map((reading) => this.#copy(reading));
  }

  /**
   * Open a book on a learner's shelf, or return the reading already there.
   *
   * A second pass through a finished book is a SECOND reading — they share a
   * book and nothing else — so only the client's key dedupes, never the book.
   */
  async openReading(reading = {}) {
    const learnerId = this.#assertLearner(reading.learnerId);
    const {
      isbn, progressMode = 'page', pageCount = null, openedOn = null, idempotencyKey,
    } = reading;
    if (typeof isbn !== 'string' || !isbn.trim()) throw new Error('YamlBookLogStore: isbn is required');
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new Error('YamlBookLogStore: idempotencyKey is required to open a reading');
    }

    return this.#enqueue(() => {
      const loaded = this.#requireReadable(learnerId, this.#load(learnerId));
      const readings = loaded.readings.map((entry) => this.#copy(entry));

      const existing = readings.find((entry) => entry.idempotencyKey === idempotencyKey
        || (entry.entries ?? []).some((row) => row?.idempotencyKey === idempotencyKey));
      if (existing) {
        if (existing.book?.isbn !== isbn) {
          throw new Error(`YamlBookLogStore: idempotencyKey ${idempotencyKey} already opened a different book (${existing.book?.isbn})`);
        }
        return existing;
      }

      const stored = {
        id: this.#mint('rdg', new Set(readings.map((entry) => entry.id))),
        learnerId,
        book: { isbn, pageCount },
        progressMode,
        status: 'reading',
        openedOn: openedOn ?? this.#dayOf(this.#clock().toISOString()),
        finishedOn: null,
        idempotencyKey,
        entries: [],
        revisions: [],
      };
      readings.push(stored);
      this.#persist(learnerId, loaded, readings);
      this.#logger.info?.('school.book-log.reading-opened', { learnerId, isbn, readingId: stored.id });
      return stored;
    });
  }

  /** One dated row of evidence. `on` is the study day; `at` is when it was recorded. */
  async appendEntry(entry = {}) {
    const learnerId = this.#assertLearner(entry.learnerId);
    const { readingId, on, page = null, minutes = null, source = 'panel', idempotencyKey = null } = entry;
    if (typeof readingId !== 'string' || !readingId) throw new Error('YamlBookLogStore: readingId is required');

    return this.#enqueue(() => {
      const loaded = this.#requireReadable(learnerId, this.#load(learnerId));
      const readings = loaded.readings.map((reading) => this.#copy(reading));
      const target = this.#find(learnerId, readings, readingId);

      const duplicate = idempotencyKey
        && target.entries.find((stored) => stored?.idempotencyKey === idempotencyKey);
      if (duplicate) return duplicate;

      const taken = new Set(readings.flatMap((reading) => (reading.entries ?? []).map((row) => row?.id)));
      const stored = {
        id: this.#mint('ent', taken),
        on: on ?? this.#dayOf(this.#clock().toISOString()),
        at: entry.at ?? this.#clock().toISOString(),
        ...(page !== null && page !== undefined ? { page } : {}),
        ...(minutes !== null && minutes !== undefined ? { minutes } : {}),
        ...(entry.note ? { note: String(entry.note) } : {}),
        ...(entry.rating !== undefined && entry.rating !== null ? { rating: entry.rating } : {}),
        ...(entry.externalId ? { externalId: String(entry.externalId) } : {}),
        source: source ? String(source) : 'panel',
        idempotencyKey,
      };
      target.entries.push(stored);
      this.#persist(learnerId, loaded, readings);
      return stored;
    });
  }

  /** Set fields on a reading. The id, the learner and the evidence are not fields. */
  async updateReading({ learnerId, readingId, patch = {}, revision = null } = {}) {
    const owner = this.#assertLearner(learnerId);
    if (typeof readingId !== 'string' || !readingId) throw new Error('YamlBookLogStore: readingId is required');
    assertPatch(patch, READING_PATCH_FIELDS);
    if (patch.progressMode !== undefined && !PROGRESS_MODES.has(patch.progressMode)) {
      throw new Error(`YamlBookLogStore: unknown progressMode: ${patch.progressMode}`);
    }
    if (patch.status !== undefined && !STATUSES.has(patch.status)) {
      throw new Error(`YamlBookLogStore: unknown status: ${patch.status}`);
    }

    return this.#enqueue(() => {
      const loaded = this.#requireReadable(owner, this.#load(owner));
      const readings = loaded.readings.map((reading) => this.#copy(reading));
      const target = this.#find(owner, readings, readingId);

      for (const [field, value] of Object.entries(patch)) {
        target[field] = field === 'book' ? { ...target.book, ...value } : value;
      }
      if (revision) target.revisions.push(revision);
      this.#persist(owner, loaded, readings);
      return target;
    });
  }

  /** Fix one row: a page typed wrong, a day chosen wrong. */
  async updateEntry({ learnerId, readingId, entryId, patch = {}, revision = null } = {}) {
    const owner = this.#assertLearner(learnerId);
    if (typeof entryId !== 'string' || !entryId) throw new Error('YamlBookLogStore: entryId is required');
    assertPatch(patch, ENTRY_PATCH_FIELDS);

    return this.#enqueue(() => {
      const loaded = this.#requireReadable(owner, this.#load(owner));
      const readings = loaded.readings.map((reading) => this.#copy(reading));
      const target = this.#find(owner, readings, readingId);
      const row = target.entries.find((entry) => entry.id === entryId);
      if (!row) throw new Error(`YamlBookLogStore: no entry ${entryId} on reading ${readingId}`);

      Object.assign(row, patch);
      if (revision) target.revisions.push(revision);
      this.#persist(owner, loaded, readings);
      return row;
    });
  }

  async deleteEntry({ learnerId, readingId, entryId, revision = null } = {}) {
    const owner = this.#assertLearner(learnerId);
    if (typeof entryId !== 'string' || !entryId) throw new Error('YamlBookLogStore: entryId is required');

    return this.#enqueue(() => {
      const loaded = this.#requireReadable(owner, this.#load(owner));
      const readings = loaded.readings.map((reading) => this.#copy(reading));
      const target = this.#find(owner, readings, readingId);
      const index = target.entries.findIndex((entry) => entry.id === entryId);
      if (index < 0) throw new Error(`YamlBookLogStore: no entry ${entryId} on reading ${readingId}`);
      const [removed] = target.entries.splice(index, 1);
      if (revision) target.revisions.push(revision);
      this.#persist(owner, loaded, readings);
      return removed;
    });
  }

  async deleteReading({ learnerId, readingId } = {}) {
    const owner = this.#assertLearner(learnerId);
    if (typeof readingId !== 'string' || !readingId) throw new Error('YamlBookLogStore: readingId is required');

    return this.#enqueue(() => {
      const loaded = this.#requireReadable(owner, this.#load(owner));
      const readings = loaded.readings.map((reading) => this.#copy(reading));
      const index = readings.findIndex((reading) => reading.id === readingId);
      if (index < 0) throw new Error(`YamlBookLogStore: no reading ${readingId} for ${owner}`);
      const [removed] = readings.splice(index, 1);
      this.#persist(owner, loaded, readings);
      this.#logger.info?.('school.book-log.reading-deleted', { learnerId: owner, readingId });
      return removed;
    });
  }

  /**
   * Move a reading to the sibling who actually read it.
   *
   * THE DESTINATION IS WRITTEN FIRST. If the receiving shelf is damaged, the
   * move is refused with the reading still on the source shelf — a record that
   * landed nowhere is worse than one that did not move. Same rule the teacher
   * console's attempt reassignment follows (teacher.md §10).
   */
  async moveReading({ learnerId, readingId, toLearnerId, revision = null } = {}) {
    const from = this.#assertLearner(learnerId);
    const to = this.#assertLearner(toLearnerId);
    if (typeof readingId !== 'string' || !readingId) throw new Error('YamlBookLogStore: readingId is required');
    if (from === to) throw new Error('YamlBookLogStore: a reading cannot move to the shelf it is already on');

    return this.#enqueue(() => {
      const source = this.#requireReadable(from, this.#load(from));
      const sourceReadings = source.readings.map((reading) => this.#copy(reading));
      const index = sourceReadings.findIndex((reading) => reading.id === readingId);
      if (index < 0) throw new Error(`YamlBookLogStore: no reading ${readingId} for ${from}`);

      // Read the destination BEFORE anything is removed: a corrupt shelf throws
      // here, and the source is still untouched.
      const destination = this.#requireReadable(to, this.#load(to));
      const destinationReadings = destination.readings.map((reading) => this.#copy(reading));
      if (destinationReadings.some((reading) => reading.id === readingId)) {
        throw new Error(`YamlBookLogStore: ${to} already holds reading ${readingId}`);
      }

      const moved = { ...sourceReadings[index], learnerId: to };
      if (revision) moved.revisions = [...(moved.revisions ?? []), revision];
      destinationReadings.push(moved);
      this.#persist(to, destination, destinationReadings);

      sourceReadings.splice(index, 1);
      this.#persist(from, source, sourceReadings);
      this.#logger.info?.('school.book-log.reading-moved', { from, to, readingId });
      return moved;
    });
  }
}

/** A patch may only name fields the caller is allowed to set. */
function assertPatch(patch, allowed) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('YamlBookLogStore: patch must be an object');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new Error('YamlBookLogStore: patch is empty');
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`YamlBookLogStore: patch may not set ${key}`);
  }
}

export default YamlBookLogStore;
