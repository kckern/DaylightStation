/**
 * YamlNutriListDatastore - YAML-based denormalized food item persistence
 *
 * Implements INutriListDatastore port for NutriList storage.
 * NutriList stores individual food items for reporting/analytics.
 *
 * Storage Strategy:
 * - Hot storage: users/{userId}/lifelog/nutrition/nutrilist.yml (recent 30 days)
 * - Cold storage: users/{userId}/lifelog/nutrition/archives/nutrilist/{YYYY-MM}.yml
 * - Daily summaries: users/{userId}/lifelog/nutrition/nutriday.yml
 */

import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  ensureDir,
  dirExists,
  listYamlFiles,
  loadYaml,
  resolveYamlPath,
  saveYamlToPathAtomic
} from '#system/utils/FileIO.mjs';
import { foodGrams, scaleFoodPortion } from '#shared/contracts/health/foodQuantity.mjs';
import { isISODate } from '#shared/contracts/health/isoDate.mjs';
import { isCountedRow } from '#shared/contracts/nutrition/countedRows.mjs';
import { INutriListDatastore } from '#apps/nutribot/ports/INutriListDatastore.mjs';
import { shortIdFromUuid } from '#system/utils/id.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const ARCHIVE_RETENTION_DAYS = 30;
const NOOM_EMOJI = { green: '🟢', yellow: '🟡', orange: '🟠' };
const operationContext = new AsyncLocalStorage();
const inFlightOperations = new Map();

function dehydrateNutriListItem(log, item) {
  return {
    schemaVersion: 2,
    version: 1,
    id: item.id,
    uuid: item.uuid,
    label: item.label,
    icon: item.icon,
    grams: item.grams,
    unit: item.unit,
    amount: item.amount,
    color: item.color,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    fiber: item.fiber,
    sugar: item.sugar,
    sodium: item.sodium,
    cholesterol: item.cholesterol,
    logId: log.id,
    log_uuid: log.id,
    date: log.meal?.date,
    status: log.status,
    createdAt: log.createdAt,
    acceptedAt: log.acceptedAt,
    kind: item.kind,
    parentId: item.parentId,
    photoRef: item.photoRef,
    settled: item.settled,
    settledBy: item.settledBy,
    settledAt: item.settledAt,
    microsSource: item.microsSource,
    foodId: item.foodId,
    nutrientProvenance: item.nutrientProvenance,
    originalQuantity: item.originalQuantity ?? { amount: item.amount, unit: item.unit },
  };
}

export class YamlNutriListDatastore extends INutriListDatastore {
  #dataService;
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.dataService - DataService instance (uses .user.resolveDir)
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options) {
    super();
    if (!options?.dataService) {
      throw new InfrastructureError('YamlNutriListDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = options.dataService;
    this.#logger = options.logger || console;
  }

  // ==================== Path Helpers ====================

  #getPath(userId) {
    return this.#dataService.user.resolveDir('lifelog/nutrition/nutrilist', userId);
  }

  #getArchiveDir(userId) {
    return this.#dataService.user.resolveDir('lifelog/nutrition/archives/nutrilist', userId);
  }

  #getArchivePath(userId, yearMonth) {
    return path.join(this.#getArchiveDir(userId), yearMonth);
  }

  #getNutridayPath(userId) {
    return this.#dataService.user.resolveDir('lifelog/nutrition/nutriday', userId);
  }

  #journalPath(userId) {
    return this.#dataService.user.resolveDir('lifelog/nutrition/ledger-transaction', userId);
  }

  #tombstonePath(userId) {
    return this.#dataService.user.resolveDir('lifelog/nutrition/ledger-deleted', userId);
  }

  #operationsPath(userId) {
    return this.#dataService.user.resolveDir('lifelog/nutrition/ledger-operations', userId);
  }

  #revisionPath(userId) {
    return this.#dataService.user.resolveDir('lifelog/nutrition/ledger-revision', userId);
  }

  readDaySnapshot(userId, date) {
    const items = this.#itemsInDayWindow(userId, date, date).map(row => this.#normalizeItem(row));
    return { date, items, revision: loadYaml(this.#revisionPath(userId))?.revision || 0 };
  }

  async runOperation(userId, id, payload, action) {
    if (!id) return action(); // compatibility for older transports
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Object.assign(new Error('Invalid operation ID'), { status: 400 });
    this.#recover(userId);
    const key = `${this.#operationsPath(userId)}:${id}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const operations = loadYaml(this.#operationsPath(userId)) || {};
    const prior = operations[id];
    if (prior && prior.fingerprint !== fingerprint) throw Object.assign(new Error('Operation ID was already used for another request'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    if (inFlightOperations.has(key)) return inFlightOperations.get(key);
    if (prior?.result) return prior.result;
    if (prior?.items?.length) {
      // The ledger committed before the response could be recorded. Recover
      // the committed outcome rather than calling the parser a second time.
      return { committed: true, logged: true, item: prior.items[0], items: prior.items,
        entryIds: prior.items.map(row => row.uuid || row.id), date: prior.items[0].date, mealTime: prior.items[0].mealTime };
    }
    operations[id] = { fingerprint, pending: true };
    this.#writeFile(this.#operationsPath(userId), operations);
    const promise = operationContext.run({ userId, id, fingerprint }, async () => {
      const result = await action();
      const latest = loadYaml(this.#operationsPath(userId)) || {};
      latest[id] = { ...latest[id], fingerprint, pending: false, result };
      this.#writeFile(this.#operationsPath(userId), latest);
      return result;
    });
    inFlightOperations.set(key, promise);
    try { return await promise; } finally { inFlightOperations.delete(key); }
  }

  #recover(userId) {
    const journal = loadYaml(this.#journalPath(userId));
    if (!journal?.pending) return;
    const root = path.dirname(this.#getPath(userId)) + path.sep;
    for (const [target, data] of journal.writes) {
      if (!path.resolve(target).startsWith(root)) throw new Error('Invalid ledger transaction target');
      this.#writeFile(target, data);
    }
    this.#writeFile(this.#journalPath(userId), { pending: false });
    this.#logger.info?.('health.ledger.recovered', { userId, files: journal.writes.length });
  }

  #documents(userId) {
    this.#recover(userId);
    const documents = new Map([[this.#getPath(userId), this.#readFile(this.#getPath(userId))]]);
    const archiveDir = this.#getArchiveDir(userId);
    if (dirExists(archiveDir)) {
      for (const month of listYamlFiles(archiveDir, { stripExtension: true })) {
        documents.set(this.#getArchivePath(userId, month), this.#loadArchive(userId, month));
      }
    }
    return documents;
  }

  #commit(userId, writes) {
    // No await between reading, validation, journaling and replacement: within
    // the application process a second request cannot observe half a command.
    // A restart completes a prepared transaction before subsequent reads.
    writes.set(this.#revisionPath(userId), { revision: (loadYaml(this.#revisionPath(userId))?.revision || 0) + 1 });
    this.#writeFile(this.#journalPath(userId), { pending: true, writes: [...writes] });
    for (const [target, data] of writes) this.#writeFile(target, data);
    this.#writeFile(this.#journalPath(userId), { pending: false });
  }

  #commitRows(userId, writes, dates, extraWrites = new Map()) {
    const documents = this.#documents(userId);
    const rows = [...documents].flatMap(([file, existing]) => writes.get(file) || existing);
    for (const [file, added] of writes) if (!documents.has(file)) rows.push(...added);
    const summaries = this.#readNutriday(userId);
    for (const date of new Set(dates.filter(Boolean))) {
      const seen = new Set();
      summaries[date] = this.#calculateDailySummary(rows.filter(row => {
        const key = row.uuid || row.id;
        if ((row.date || row.createdAt?.slice(0, 10)) !== date || seen.has(key)) return false;
        seen.add(key); return true;
      }));
    }
    writes.set(this.#getNutridayPath(userId), summaries);
    for (const [file, data] of extraWrites) writes.set(file, data);
    const operation = operationContext.getStore();
    if (operation?.userId === userId) {
      const operations = loadYaml(this.#operationsPath(userId)) || {};
      const previousIds = new Set([...documents.values()].flat().map(row => row.uuid || row.id));
      const created = rows.filter(row => !previousIds.has(row.uuid || row.id));
      operations[operation.id] = { ...operations[operation.id], fingerprint: operation.fingerprint,
        items: [...(operations[operation.id]?.items || []), ...created] };
      writes.set(this.#operationsPath(userId), operations);
    }
    this.#commit(userId, writes);
  }

  /** One validated mutation across active/archive rows and their summaries. */
  async mutateEntries(userId, { updates = [], deleteIds = [] } = {}) {
    const documents = this.#documents(userId);
    const all = [...documents.values()].flat();
    const matches = (row, id) => row.uuid === id || row.id === id;
    const affectedDates = new Set();
    const affectedIds = new Set();
    const changed = new Map();
    const removed = new Set();
    for (const id of [...updates.map(u => u.id), ...deleteIds]) {
      if (!all.some(row => matches(row, id))) throw Object.assign(new Error(`Item not found: ${id}`), { code: 'NOT_FOUND', status: 404 });
    }
    for (const { id, changes, expectedVersion } of updates) {
      const original = all.find(row => matches(row, id));
      if (expectedVersion != null && expectedVersion !== (original.version ?? 1)) {
        throw Object.assign(new Error('This entry changed. Reload it before saving.'), { code: 'VERSION_CONFLICT', status: 409 });
      }
      if (changes.date != null && !isISODate(changes.date)) throw Object.assign(new Error('Invalid date'), { status: 400 });
      const next = { ...original, ...changes, version: (original.version ?? 1) + 1 };
      if (Object.hasOwn(changes, 'name')) Object.assign(next, { item: changes.name, label: changes.name });
      changed.set(original.uuid || original.id, next);
      affectedIds.add(original.uuid || original.id);
      affectedDates.add(original.date || original.createdAt?.slice(0, 10));
      affectedDates.add(next.date || next.createdAt?.slice(0, 10));
    }
    for (const id of deleteIds) {
      const original = all.find(row => matches(row, id));
      removed.add(original.uuid || original.id);
      affectedIds.add(original.uuid || original.id);
      affectedDates.add(original.date || original.createdAt?.slice(0, 10));
    }
    const writes = new Map();
    const destination = this.#getPath(userId);
    const relocated = [];
    for (const [file, rows] of documents) {
      const next = rows.flatMap(row => {
        const key = row.uuid || row.id;
        if (removed.has(key)) return [];
        const updated = changed.get(key);
        if (!updated) return [row];
        // Moving an archived row to another day brings it into active storage;
        // archive maintenance can subsequently file it under the correct month.
        if (file !== destination && updated.date !== row.date) { relocated.push(updated); return []; }
        return [updated];
      });
      if (JSON.stringify(next) !== JSON.stringify(rows)) writes.set(file, next);
    }
    if (relocated.length) writes.set(destination, [...(writes.get(destination) || documents.get(destination)), ...relocated]);
    const finalRows = [...documents].flatMap(([file, rows]) => writes.get(file) || rows);
    const summaries = this.#readNutriday(userId);
    for (const date of affectedDates) {
      if (!date) continue;
      const seen = new Set();
      const rows = finalRows.filter(row => {
        const key = row.uuid || row.id;
        if (seen.has(key) || (row.date || row.createdAt?.slice(0, 10)) !== date) return false;
        seen.add(key); return true;
      });
      summaries[date] = this.#calculateDailySummary(rows);
    }
    writes.set(this.#getNutridayPath(userId), summaries);
    if (removed.size) {
      const deleted = loadYaml(this.#tombstonePath(userId)) || {};
      for (const key of removed) deleted[key] = all.find(row => (row.uuid || row.id) === key);
      writes.set(this.#tombstonePath(userId), deleted);
    }
    this.#commit(userId, writes);
    return { items: [...changed.values()].map(row => this.#normalizeItem(row)),
      affectedIds: [...affectedIds], affectedDates: [...affectedDates].filter(Boolean) };
  }

  /** Restore exactly the deleted snapshots; never reconstruct nutrition. */
  async restoreEntries(userId, entryIds) {
    if (!Array.isArray(entryIds) || !entryIds.length || entryIds.some(id => typeof id !== 'string')) {
      throw Object.assign(new Error('Entry IDs are required'), { status: 400 });
    }
    const documents = this.#documents(userId);
    const existing = new Set([...documents.values()].flat().map(row => row.uuid || row.id));
    const deleted = loadYaml(this.#tombstonePath(userId)) || {};
    const restored = [];
    for (const id of new Set(entryIds)) {
      if (existing.has(id)) continue; // a repeated Undo is harmless
      if (!deleted[id]) throw Object.assign(new Error('Deleted entry is no longer available'), { status: 409 });
      restored.push({ ...deleted[id], version: (deleted[id].version ?? 1) + 1 });
      delete deleted[id];
    }
    if (restored.length) this.#commitRows(userId,
      new Map([[this.#getPath(userId), [...documents.get(this.#getPath(userId)), ...restored]]]),
      restored.map(row => row.date), new Map([[this.#tombstonePath(userId), deleted]]));
    return { committed: true, items: restored.map(row => this.#normalizeItem(row)), affectedIds: entryIds,
      affectedDates: [...new Set(restored.map(row => row.date))] };
  }

  // ==================== File I/O ====================

  #readFile(basePath) {
    try {
      const data = loadYaml(basePath);
      // Handle both array and legacy object format
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object') return Object.values(data);
      if (data == null) return [];
      throw new Error('Expected a nutrition list');
    } catch (e) {
      this.#logger.warn?.('YamlNutriListDatastore.readFile.error', { basePath, error: e.message });
      throw e;
    }
  }

  #writeFile(basePath, data) {
    ensureDir(path.dirname(basePath));
    saveYamlToPathAtomic(resolveYamlPath(basePath) || `${basePath}.yml`, data, { durable: true });
  }

  #readNutriday(userId) {
    const basePath = this.#getNutridayPath(userId);
    return loadYaml(basePath) || {};
  }

  #loadArchive(userId, yearMonth) {
    const basePath = this.#getArchivePath(userId, yearMonth);
    return this.#readFile(basePath);
  }

  // ==================== Item Normalization ====================

  #normalizeItem(item) {
    return {
      ...item,
      id: item.id || (item.uuid ? shortIdFromUuid(item.uuid) : item.id),
      uuid: item.uuid || (typeof item.id === 'string' && item.id.includes('-') ? item.id : item.uuid),
      name: item.name || item.item || item.label || 'Unknown',
      color: item.color || item.noom_color || 'yellow',
      grams: foodGrams(item),
      logId: item.logId || item.log_uuid || item.logUuid,
      kind: item.kind || 'item',
    };
  }

  // ==================== INutriListStore Implementation ====================

  /**
   * Sync nutrilist from a NutriLog
   * @param {NutriLog} nutriLog
   * @returns {Promise<void>}
   */
  async syncFromLog(nutriLog, { revision = false } = {}) {
    this.#recover(nutriLog.userId);
    const filePath = this.#getPath(nutriLog.userId);
    const logId = nutriLog.id;
    const logUuid = nutriLog.uuid || nutriLog.id;

    // Load existing items
    let items = this.#readFile(filePath);

    // Capture replay may import previously unseen items, never replace the
    // consumed ledger. Explicit user revisions use a separate merge mode.
    const existing = this.#itemsInDayWindow(nutriLog.userId, '0001-01-01', '9999-12-31');
    const existingIds = new Set(existing.map(item => item.uuid || item.id));
    const deleted = loadYaml(this.#tombstonePath(nutriLog.userId)) || {};

    // Add new items if log is accepted
    if (nutriLog.isAccepted) {
      const newItems = nutriLog.items.map((foodItem) => dehydrateNutriListItem(nutriLog, foodItem)).map((item) => ({
        ...item,
        id: item.id || (item.uuid ? shortIdFromUuid(item.uuid) : shortIdFromUuid(logUuid)),
        uuid: item.uuid || item.id,
        logId,
        log_uuid: item.log_uuid || logUuid,
        date: nutriLog.meal?.date,
        mealTime: nutriLog.meal?.time ?? null,
      }));
      if (revision) {
        const belongs = row => row.logId === logId || row.log_uuid === logUuid;
        const originalRows = existing.filter(belongs);
        if (originalRows.some(row => (row.version ?? 1) > 1) || Object.values(deleted).some(belongs)) {
          throw Object.assign(new Error('This capture has been corrected in the food log. Edit its entries there.'), { status: 409, code: 'VERSION_CONFLICT' });
        }
        const documents = this.#documents(nutriLog.userId);
        const writes = new Map([...documents].map(([file, rows]) => [file, rows.filter(row => !belongs(row))]));
        const replacements = newItems.map(item => ({ ...item, version: 2 }));
        const replacementIds = new Set(replacements.map(item => item.uuid || item.id));
        for (const row of originalRows) if (!replacementIds.has(row.uuid || row.id)) deleted[row.uuid || row.id] = row;
        writes.set(filePath, [...writes.get(filePath), ...replacements]);
        this.#commitRows(nutriLog.userId, writes, [...originalRows.map(row => row.date), nutriLog.meal?.date],
          new Map([[this.#tombstonePath(nutriLog.userId), deleted]]));
        return;
      }
      items.push(...newItems.filter(item => !existingIds.has(item.uuid || item.id) && !deleted[item.uuid || item.id]));
    }

    // Sort by date descending
    items.sort((a, b) => {
      const dateA = a.createdAt || a.date || '';
      const dateB = b.createdAt || b.date || '';
      return dateB.localeCompare(dateA);
    });

    // Save back
    this.#commitRows(nutriLog.userId, new Map([[filePath, items]]), [nutriLog.meal?.date]);
  }

  /**
   * Save multiple items at once
   * @param {Object[]} newItems
   * @returns {Promise<void>}
   */
  async saveMany(newItems) {
    if (!newItems || newItems.length === 0) return;

    // Date integrity guard — accepting undefined or malformed dates silently
    // has caused real data to be bucketed to the wrong day. Fail loudly.
    for (const [i, item] of newItems.entries()) {
      if (!item.date) {
        throw new Error(`YamlNutriListDatastore.saveMany: item[${i}] missing date (logId=${item.logId ?? item.log_uuid ?? '?'})`);
      }
      if (!isISODate(item.date)) {
        throw new Error(`YamlNutriListDatastore.saveMany: item[${i}] has malformed date "${item.date}" (expected YYYY-MM-DD)`);
      }
    }

    const userId = newItems[0].userId || newItems[0].chatId || 'cli-user';

    // Validate userId to prevent path traversal or invalid directories
    if (!userId || userId.includes(':') || userId.includes('/')) {
      throw new InfrastructureError('Invalid userId for nutrilist save', {
        code: 'INVALID_USER_ID',
        received: userId,
        hint: 'userId must not contain ":" or "/" characters'
      });
    }

    const filePath = this.#getPath(userId);
    this.#recover(userId);

    // Load existing items
    let items = this.#readFile(filePath);

    // Transform new items
    const transformedItems = newItems.map(item => {
      const baseUuid = item.uuid || item.id || uuidv4();
      return {
        id: item.id || shortIdFromUuid(baseUuid),
        uuid: baseUuid,
        icon: item.icon || 'default',
        item: item.label || item.item || item.name || 'Unknown',
        schemaVersion: 2,
        version: item.version ?? 1,
        foodId: item.foodId ?? null,
        originalQuantity: item.originalQuantity ?? { amount: item.amount ?? null, unit: item.unit ?? null },
        nutrientBasis: item.nutrientBasis ?? null,
        nutrientProvenance: item.nutrientProvenance ?? null,
        copiedFrom: item.copiedFrom ?? null,
        grams: foodGrams(item),
        unit: item.unit || 'g',
        amount: item.amount ?? foodGrams(item),
        noom_color: item.color || item.noom_color || 'yellow',
        calories: item.calories ?? 0,
        fat: item.fat ?? 0,
        carbs: item.carbs ?? 0,
        protein: item.protein ?? 0,
        fiber: item.fiber ?? 0,
        sugar: item.sugar ?? 0,
        sodium: item.sodium ?? 0,
        cholesterol: item.cholesterol ?? 0,
        date: item.date,
        mealTime: item.mealTime ?? null,
        logId: item.logId || item.log_uuid || item.logUuid,
        log_uuid: item.log_uuid || item.logUuid,
        userId: item.userId,
        kind: item.kind || 'item',
        parentId: item.parentId ?? null,
        photoRef: item.photoRef ?? null,
        settled: item.settled,
        settledBy: item.settledBy ?? null,
        settledAt: item.settledAt ?? null,
        microsSource: item.microsSource ?? null,
      };
    });

    const existingIds = new Set(this.#itemsInDayWindow(userId, '0001-01-01', '9999-12-31').map(item => item.uuid || item.id));
    const deleted = loadYaml(this.#tombstonePath(userId)) || {};
    items.push(...transformedItems.filter(item => !existingIds.has(item.uuid) && !deleted[item.uuid]));

    // Sort by date descending
    items.sort((a, b) => {
      const dateA = a.createdAt || a.date || '';
      const dateB = b.createdAt || b.date || '';
      return dateB.localeCompare(dateA);
    });

    const affectedDates = [...new Set(transformedItems.map(i => i.date).filter(Boolean))];
    this.#commitRows(userId, new Map([[filePath, items]]), affectedDates);
  }

  /**
   * Find all items for a user
   * @param {string} userId
   * @param {Object} [options]
   * @returns {Promise<Object[]>}
   */
  async findAll(userId, options = {}) {
    this.#recover(userId);
    let items = this.#readFile(this.#getPath(userId));
    items = items.map(item => this.#normalizeItem(item));

    if (options.status) {
      items = items.filter(item => item.status === options.status);
    }

    if (options.color) {
      items = items.filter(item =>
        item.color === options.color || item.noom_color === options.color
      );
    }

    return items;
  }

  /**
   * Find items by log ID
   * @param {string} userId
   * @param {string} logId
   * @returns {Promise<Object[]>}
   */
  async findByLogId(userId, logId) {
    const items = await this.findAll(userId);
    return items.filter(item => item.logId === logId || item.log_uuid === logId);
  }

  /**
   * Find a single item by UUID
   * @param {string} userId
   * @param {string} uuid
   * @returns {Promise<Object|null>}
   */
  async findByUuid(userId, uuid) {
    const items = this.#itemsInDayWindow(userId, '0001-01-01', '9999-12-31').map(item => this.#normalizeItem(item));
    return items.find(item => item.uuid === uuid || item.id === uuid) || null;
  }

  /**
   * Update a single item
   * @param {string} userId
   * @param {string} entryId
   * @param {Object} updates
   * @returns {Promise<Object>}
   */
  async update(userId, entryId, updates) {
    const { expectedVersion, ...changes } = updates;
    const result = await this.mutateEntries(userId, { updates: [{ id: entryId, changes, expectedVersion }] });
    return result.items[0];
  }

  /**
   * Every row belonging to an inclusive day window, from wherever it lives.
   *
   * THE one place this store decides which day a row belongs to, and it uses
   * the same rule `archiveOldItems` uses to decide where a row is STORED:
   * `date`, falling back to `createdAt`'s day. Those two rules have to be the
   * same rule — a row filed into an archive by one predicate and looked up by
   * a narrower one is a row nobody can find. That is exactly what happened:
   * `findByDate` used to read only the hot file and match `item.date` exactly,
   * so a day older than the 30-day retention window came back EMPTY, and a
   * hot row carrying only `createdAt` came back empty on its own day while
   * counting in every range.
   *
   * Archives are touched only when the window actually reaches past the
   * retention cutoff, so a lookup for today costs exactly what it always did.
   * @private
   */
  #itemsInDayWindow(userId, startDate, endDate) {
    this.#recover(userId);
    let items = this.#readFile(this.#getPath(userId));

    const now = new Date();
    const cutoffDate = new Date(now.setDate(now.getDate() - ARCHIVE_RETENTION_DAYS))
      .toISOString()
      .split('T')[0];

    if (startDate < cutoffDate) {
      const archiveDir = this.#getArchiveDir(userId);
      if (dirExists(archiveDir)) {
        const startMonth = startDate.substring(0, 7);
        const endMonth = endDate.substring(0, 7);

        const archiveFiles = listYamlFiles(archiveDir, { stripExtension: true })
          .filter(ym => ym >= startMonth && ym <= endMonth);

        for (const yearMonth of archiveFiles) {
          items = [...items, ...this.#loadArchive(userId, yearMonth)];
        }
      }
    }

    items = items.filter(item => {
      const itemDate = item?.date || item?.createdAt?.substring(0, 10);
      return itemDate && itemDate >= startDate && itemDate <= endDate;
    });

    // A row merged in from an archive that was never pruned from the hot file
    // must not be counted twice.
    const seen = new Set();
    return items.filter(item => {
      const key = item.uuid || item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Find items by date — archive-aware, exactly like findByDateRange.
   *
   * Deliberately NOT re-sorted: a day's rows come back in file order (hot rows
   * first, then any archived ones), which is the chronological order the day
   * view has always rendered. `findByDateRange` sorts date-descending because a
   * multi-day list needs an order; imposing that on a single day would reshuffle
   * rows whose `date` is absent against rows that have one.
   *
   * @param {string} userId
   * @param {string} date
   * @returns {Promise<Object[]>}
   */
  async findByDate(userId, date) {
    return this.#itemsInDayWindow(userId, date, date).map(item => this.#normalizeItem(item));
  }

  /**
   * Find items by date range (includes archives if needed)
   * @param {string} userId
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<Object[]>}
   */
  async findByDateRange(userId, startDate, endDate) {
    const items = this.#itemsInDayWindow(userId, startDate, endDate);

    // Sort by date descending
    items.sort((a, b) =>
      (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '')
    );

    return items.map(item => this.#normalizeItem(item));
  }

  /**
   * Remove all items for a log
   * @param {string} userId
   * @param {string} logId
   * @returns {Promise<number>}
   */
  async removeByLogId(userId, logId) {
    const rows = [...this.#documents(userId).values()].flat()
      .filter(item => item.logId === logId || item.log_uuid === logId);
    const deleteIds = [...new Set(rows.map(row => row.uuid || row.id))];
    if (deleteIds.length) await this.mutateEntries(userId, { deleteIds });
    return deleteIds.length;
  }

  /**
   * Update portion by applying a multiplier
   * @param {string} userId
   * @param {string} uuid
   * @param {number} factor
   * @returns {Promise<boolean>}
   */
  async updatePortion(userId, uuid, factor) {
    const item = await this.findByUuid(userId, uuid);
    if (!item) return false;
    await this.update(userId, uuid, { ...scaleFoodPortion(item, factor), expectedVersion: item.version ?? 1 });
    return true;
  }

  /**
   * Delete an item by UUID
   * @param {string} userId
   * @param {string} uuid
   * @returns {Promise<boolean>}
   */
  async deleteById(userId, uuid) {
    const row = await this.findByUuid(userId, uuid);
    if (!row) return false;
    const children = row.kind === 'group' ? (await this.findByDate(userId, row.date))
      .filter(child => child.parentId != null && (child.parentId === row.uuid || child.parentId === row.id)) : [];
    await this.mutateEntries(userId, { deleteIds: [uuid, ...children.map(child => child.uuid || child.id)] });
    return true;
  }

  /**
   * Clear all items for a user
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async clear(userId) {
    const deleteIds = [...new Set([...this.#documents(userId).values()].flat().map(row => row.uuid || row.id))];
    if (deleteIds.length) await this.mutateEntries(userId, { deleteIds });
  }

  /**
   * Get total grams by color
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getGramsByColor(userId) {
    const items = await this.findAll(userId, { status: 'accepted' });

    const result = { green: 0, yellow: 0, orange: 0 };
    for (const item of items) {
      const color = item.color || item.noom_color || 'yellow';
      result[color] = (result[color] || 0) + (item.grams || item.amount || 0);
    }

    return result;
  }

  /**
   * Get item count by color
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getCountByColor(userId) {
    const items = await this.findAll(userId, { status: 'accepted' });

    const result = { green: 0, yellow: 0, orange: 0 };
    for (const item of items) {
      const color = item.color || item.noom_color || 'yellow';
      result[color] = (result[color] || 0) + 1;
    }

    return result;
  }

  // ==================== NutriDay Sync ====================

  /**
   * Sync nutriday summaries
   * @param {string} userId
   * @param {string[]} [datesToSync]
   * @returns {Promise<void>}
   */
  async syncNutriday(userId, datesToSync = null) {
    const items = this.#itemsInDayWindow(userId, '0001-01-01', '9999-12-31').map(item => this.#normalizeItem(item));

    // Group items by date
    const itemsByDate = {};
    for (const item of items) {
      const date = item.date;
      if (!date) continue;
      if (datesToSync && !datesToSync.includes(date)) continue;

      if (!itemsByDate[date]) {
        itemsByDate[date] = [];
      }
      itemsByDate[date].push(item);
    }

    // Load existing nutriday data
    const nutriday = this.#readNutriday(userId);

    // Empty source dates must replace their previous totals too.
    for (const date of datesToSync || Object.keys(nutriday)) itemsByDate[date] ??= [];

    // Calculate daily summaries
    for (const [date, dateItems] of Object.entries(itemsByDate)) {
      nutriday[date] = this.#calculateDailySummary(dateItems);
    }

    // Save nutriday
    this.#writeFile(this.#getNutridayPath(userId), nutriday);
  }

  #calculateDailySummary(items) {
    const totals = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      sodium: 0,
      sugar: 0,
      cholesterol: 0,
    };

    const foodItemsList = [];

    for (const item of items) {
      if (!isCountedRow(item)) continue;
      totals.calories += Math.round(item.calories || 0);
      totals.protein += Math.round(item.protein || 0);
      totals.carbs += Math.round(item.carbs || 0);
      totals.fat += Math.round(item.fat || 0);
      totals.fiber += Math.round(item.fiber || 0);
      totals.sodium += Math.round(item.sodium || 0);
      totals.sugar += Math.round(item.sugar || 0);
      totals.cholesterol += Math.round(item.cholesterol || 0);

      const color = item.color || item.noom_color || 'yellow';
      const emoji = NOOM_EMOJI[color] || '🟡';
      const name = item.name || item.item || item.label || 'Unknown';
      const amount = foodGrams(item);
      const cal = Math.round(item.calories || 0);

      foodItemsList.push(`${emoji} ${amount === null ? 'Weight unknown' : `${amount}g`} ${name} (${cal} cal)`);
    }

    // Sort by calories descending
    foodItemsList.sort((a, b) => {
      const calA = parseInt(a.match(/\((\d+) cal\)/)?.[1] || 0);
      const calB = parseInt(b.match(/\((\d+) cal\)/)?.[1] || 0);
      return calB - calA;
    });

    return { ...totals, food_items: foodItemsList };
  }

  // ==================== Archive Management ====================

  /**
   * Archive old items
   * @param {string} userId
   * @param {number} [retentionDays=30]
   * @returns {Promise<Object>}
   */
  async archiveOldItems(userId, retentionDays = ARCHIVE_RETENTION_DAYS) {
    this.#recover(userId);
    const filePath = this.#getPath(userId);
    const items = this.#readFile(filePath);

    const now = new Date();
    const cutoffDate = new Date(now.setDate(now.getDate() - retentionDays))
      .toISOString()
      .split('T')[0];

    const hotItems = [];
    const coldByMonth = {};
    let archived = 0;
    let kept = 0;

    for (const item of items) {
      const itemDate = item?.date || item?.createdAt?.substring(0, 10);

      if (!itemDate || itemDate >= cutoffDate) {
        hotItems.push(item);
        kept++;
      } else {
        const yearMonth = itemDate.substring(0, 7);
        if (!coldByMonth[yearMonth]) {
          coldByMonth[yearMonth] = [];
        }
        coldByMonth[yearMonth].push(item);
        archived++;
      }
    }

    if (archived === 0) {
      return { archived: 0, kept, months: [] };
    }

    // Write to monthly archives
    const archiveDir = this.#getArchiveDir(userId);
    ensureDir(archiveDir);

    const monthsUpdated = [];
    const writes = new Map();
    for (const [yearMonth, monthItems] of Object.entries(coldByMonth)) {
      const archivePath = this.#getArchivePath(userId, yearMonth);

      // Merge with existing archive (dedupe by uuid)
      const existing = this.#loadArchive(userId, yearMonth);
      const existingUuids = new Set(existing.map(i => i.uuid || i.id));
      const newItems = monthItems.filter(i => !existingUuids.has(i.uuid) && !existingUuids.has(i.id));
      const merged = [...existing, ...newItems];

      merged.sort((a, b) =>
        (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '')
      );

      writes.set(archivePath, merged);
      monthsUpdated.push(yearMonth);
    }

    // Sort hot items and save
    hotItems.sort((a, b) =>
      (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '')
    );
    writes.set(filePath, hotItems);
    this.#commit(userId, writes);

    return { archived, kept, months: monthsUpdated };
  }
}

export default YamlNutriListDatastore;
