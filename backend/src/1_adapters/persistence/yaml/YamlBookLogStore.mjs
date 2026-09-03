/**
 * YAML persistence for the reading shelf.
 *
 *   <householdPath>/school/records/books/{learnerId}.yml
 *
 * `records/`, not `runtime/`: a finished book is durable evidence a report card
 * is reconstructed from, never operational state a cooldown may prune.
 *
 * ## SHARDED BY LEARNER, NOT BY DAY
 *
 * `YamlReadingLogStore` shards by study day because a daily count asks about
 * one day. A book is the opposite shape — it spans days, and every question
 * worth asking is about a learner across time. Sharding by day would scatter
 * one book's events across a dozen files and make the shelf a fan-out read.
 *
 * ## APPEND-ONLY; STATUS IS NEVER STORED
 *
 * Only events are written. `projectShelfItem` derives status, furthest page and
 * percentage on read, so there is no second copy of the truth to disagree with
 * the events it came from.
 *
 * ## IDEMPOTENT ON `entryId` — AND `entryId` NAMES THE ITEM
 *
 * A retried POST or a remounted screen must not append twice: a duplicate
 * `finished` is a duplicate BOOK against an obligation. A repeat returns what
 * is already on disk and writes nothing — the same hazard `YamlReadingLogStore`
 * documents for `pickId`.
 *
 * The `started` event's `entryId` is also what the `itemId` is built from, so
 * `entryId` is REQUIRED on open. Keying on `openedAt` collided: two opens of
 * the same book on the same instant (a re-read added the day an earlier copy
 * was finished, or a double tap) produced one id, and the second `started`
 * became an orphan that read as `reading` forever.
 *
 * ## READS FAIL OPEN; WRITES FAIL LOUD
 *
 * A missing OR corrupt file both answer `[]` — the worst that does is show an
 * empty shelf, never take the panel down. An unsafe learner id THROWS, because
 * filing a book under the wrong key loses it for good.
 *
 * A corrupt file is COPIED ASIDE before it is replaced. `openItem` is a
 * read-modify-write, so treating corruption as "empty shelf" on the write path
 * would let one stray byte erase a year of reading with nothing kept. The
 * side-file keeps it recoverable by hand while leaving the shelf usable.
 *
 * @module adapters/persistence/yaml/YamlBookLogStore
 */
import path from 'path';
import yaml from 'js-yaml';
import { fileExists, readFile, writeFileAtomic, ensureDir } from '#system/utils/FileIO.mjs';
import { IBookLogStore } from '#apps/school/ports/IBookLogStore.mjs';

/** No separators, no traversal — this becomes a filename. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const PROGRESS_MODES = new Set(['page', 'minutes', 'check']);

export class YamlBookLogStore extends IBookLogStore {
  #configService; #logger; #clock;
  #writeChain = Promise.resolve();

  constructor({ configService, logger = console, clock = () => new Date() } = {}) {
    super();
    if (!configService || typeof configService.getHouseholdPath !== 'function') {
      throw new Error('YamlBookLogStore: configService with getHouseholdPath() is required');
    }
    this.#configService = configService;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
  }

  #dir() { return this.#configService.getHouseholdPath('school/records/books'); }

  #fileFor(learnerId) { return path.join(this.#dir(), `${learnerId}.yml`); }

  #assertLearner(learnerId) {
    if (typeof learnerId !== 'string' || !SAFE_ID.test(learnerId)) {
      throw new Error(`YamlBookLogStore: unsafe learnerId: ${learnerId}`);
    }
    return learnerId;
  }

  /** Never throws. `corrupt` is kept apart from `missing` for the write path. */
  #load(learnerId) {
    const file = this.#fileFor(learnerId);
    if (!fileExists(file)) return { status: 'missing', items: [], text: null, file };
    let text;
    try {
      text = readFile(file);
    } catch (error) {
      return { status: 'unreadable', items: [], text: null, file, reason: error.message };
    }
    try {
      const parsed = yaml.load(text);
      const items = Array.isArray(parsed?.items) ? parsed.items.filter(Boolean) : [];
      return { status: 'ok', items, text, file };
    } catch (error) {
      return { status: 'corrupt', items: [], text, file, reason: error.message };
    }
  }

  /** Serialise writes; a shelf is read-modify-write and two panels may race. */
  #enqueue(work) {
    const queued = this.#writeChain.then(work, work);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  #persist(learnerId, loaded, items) {
    const file = this.#fileFor(learnerId);
    ensureDir(path.dirname(file));
    if (loaded.status === 'corrupt' && typeof loaded.text === 'string') {
      const stamp = this.#clock().toISOString().replace(/[:.]/g, '');
      const sideFile = `${file}.corrupt-${stamp}`;
      writeFileAtomic(sideFile, loaded.text);
      this.#logger.error?.('school.book-log.shelf-corrupt', { learnerId, sideFile, reason: loaded.reason });
    }
    if (loaded.status === 'unreadable') {
      // We could not get the bytes, so we cannot preserve them, so we refuse to
      // replace the file.
      throw new Error(`YamlBookLogStore: refusing to overwrite an unreadable shelf for ${learnerId}: ${loaded.reason}`);
    }
    writeFileAtomic(file, yaml.dump({ items }, { lineWidth: 120 }));
  }

  async openItem(item = {}) {
    const learnerId = this.#assertLearner(item.learnerId);
    const { bookId, progressMode = 'page', pageCount = null, openedAt, entryId } = item;
    if (typeof bookId !== 'string' || !bookId.trim()) throw new Error('YamlBookLogStore: bookId is required');
    if (typeof entryId !== 'string' || !entryId.trim()) throw new Error('YamlBookLogStore: entryId is required to open an item');

    return this.#enqueue(() => {
      const loaded = this.#load(learnerId);
      const items = [...loaded.items];

      const existing = items.find((entry) => entry?.events?.some((event) => event?.entryId === entryId));
      if (existing) {
        if (existing.bookId !== bookId) {
          throw new Error(`YamlBookLogStore: entryId ${entryId} already opened a different book (${existing.bookId})`);
        }
        return existing;
      }

      const at = openedAt ?? this.#clock().toISOString();
      const stored = {
        // learner + book + the `started` entryId: unique per open, independent
        // of `openedAt` (two opens on one instant used to collide). The learner
        // still LEADS so an itemId can locate its own record — without it
        // `appendEvent` would need the learner passed alongside, and a caller
        // holding only an itemId could not write at all. `learnerId` is
        // SAFE_ID (no colons), so the first colon always splits.
        itemId: `${learnerId}:${bookId}:${entryId}`,
        bookId,
        progressMode,
        pageCount,
        openedAt: at,
        events: [{ kind: 'started', at, entryId }],
      };
      items.push(stored);
      this.#persist(learnerId, loaded, items);
      this.#logger.info?.('school.book-log.item-opened', { learnerId, bookId, itemId: stored.itemId });
      return stored;
    });
  }

  async appendEvent(event = {}) {
    const { itemId, kind, at, entryId } = event;
    if (typeof itemId !== 'string' || !itemId) throw new Error('YamlBookLogStore: itemId is required');

    const learnerId = this.#assertLearner(event.learnerId ?? learnerFromItemId(itemId));

    return this.#enqueue(() => {
      const loaded = this.#load(learnerId);
      const items = loaded.items.map((entry) => ({ ...entry, events: [...(entry.events ?? [])] }));
      const target = items.find((entry) => entry.itemId === itemId);
      if (!target) throw new Error(`YamlBookLogStore: no shelf item for itemId ${itemId}`);

      const duplicate = entryId && target.events.find((stored) => stored?.entryId === entryId);
      if (duplicate) return duplicate;

      const stored = {
        kind,
        at: at ?? this.#clock().toISOString(),
        ...(event.page !== undefined && event.page !== null ? { page: event.page } : {}),
        ...(event.minutes !== undefined && event.minutes !== null ? { minutes: event.minutes } : {}),
        ...(event.note ? { note: String(event.note) } : {}),
        ...(event.rating !== undefined && event.rating !== null ? { rating: event.rating } : {}),
        ...(event.source ? { source: String(event.source) } : {}),
        ...(event.externalId ? { externalId: String(event.externalId) } : {}),
        entryId: entryId ?? null,
      };
      target.events.push(stored);
      this.#persist(learnerId, loaded, items);
      return stored;
    });
  }

  async setProgressMode({ itemId, progressMode } = {}) {
    if (typeof itemId !== 'string' || !itemId) throw new Error('YamlBookLogStore: itemId is required');
    if (!PROGRESS_MODES.has(progressMode)) throw new Error(`YamlBookLogStore: unknown progressMode: ${progressMode}`);
    const learnerId = this.#assertLearner(learnerFromItemId(itemId));
    return this.#enqueue(() => {
      const loaded = this.#load(learnerId);
      const items = loaded.items.map((entry) => ({ ...entry, events: [...(entry.events ?? [])] }));
      const target = items.find((entry) => entry.itemId === itemId);
      if (!target) throw new Error(`YamlBookLogStore: no shelf item for itemId ${itemId}`);
      target.progressMode = progressMode;
      this.#persist(learnerId, loaded, items);
      this.#logger.info?.('school.book-log.mode-switched', { learnerId, itemId, progressMode });
      return target;
    });
  }

  async listForLearner(learnerId) {
    if (typeof learnerId !== 'string' || !SAFE_ID.test(learnerId)) return [];
    const loaded = this.#load(learnerId);
    if (loaded.status === 'corrupt' || loaded.status === 'unreadable') {
      this.#logger.warn?.('school.book-log.shelf-unreadable', { learnerId, status: loaded.status });
      return [];
    }
    return loaded.items.map((item) => ({ ...item, events: [...(item.events ?? [])] }));
  }

}

/**
 * An itemId is `<learnerId>:<bookId>:<startedEntryId>`, so it locates its own
 * shard. `learnerId` cannot contain a colon (SAFE_ID), so the first one always
 * splits.
 */
function learnerFromItemId(itemId) {
  const index = String(itemId).indexOf(':');
  if (index <= 0) {
    throw new Error(`YamlBookLogStore: itemId does not name a learner: ${itemId}`);
  }
  return String(itemId).slice(0, index);
}

export default YamlBookLogStore;
