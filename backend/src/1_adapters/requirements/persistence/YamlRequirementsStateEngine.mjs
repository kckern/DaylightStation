import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

function strictLoad(filePath) {
  try { return readYamlFromPath(filePath); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function persistenceError(message, cause) {
  return Object.assign(new Error(message), {
    name: 'PersistenceError', code: 'REQUIREMENTS_STATE_UNAVAILABLE', status: 503, cause,
  });
}

function plain(value) {
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [key, plain(item)]));
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
}

function snake(key) { return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`); }
function camel(key) { return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()); }

const DYNAMIC_MAPS = new Set([
  'publishers', 'subjectSets', 'subject_sets', 'claimTypes', 'claim_types',
  'requirements', 'entitlements', 'subjectSets', 'reasonLabels', 'reason_labels',
]);

function mapKeys(value, mapper, parentKey = null) {
  if (Array.isArray(value)) return value.map(item => mapKeys(item, mapper, parentKey));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const mapped = DYNAMIC_MAPS.has(parentKey) ? key : mapper(key);
    return [mapped, mapKeys(item, mapper, mapped)];
  }));
  return value;
}

function emptyState() {
  return {
    schema: 'daylight.requirements-state/v1',
    projection: null,
    journal: [],
    compactedThrough: 0,
    deliveryCheckpoint: 0,
  };
}

export class YamlRequirementsStateEngine {
  #resolveFilePath; #load; #save; #maxEntries; #maxAgeMs; #queues = new Map();
  constructor({ filePath, resolveFilePath, load = strictLoad, save = saveYamlToPathAtomic, maxEntries = 5000, maxAgeMs = 30 * 24 * 60 * 60 * 1000 }) {
    if (!filePath && !resolveFilePath) throw new Error('YamlRequirementsStateEngine requires filePath or resolveFilePath');
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxAgeMs) || maxAgeMs < 1) {
      throw new Error('YamlRequirementsStateEngine retention must be positive');
    }
    this.#resolveFilePath = resolveFilePath ?? (() => filePath);
    this.#load = load;
    this.#save = save;
    this.#maxEntries = maxEntries;
    this.#maxAgeMs = maxAgeMs;
  }

  #read(householdId) {
    let stored;
    try { stored = this.#load(this.#resolveFilePath(householdId)); }
    catch (error) { throw persistenceError('Requirements state could not be read', error); }
    if (!stored) return emptyState();
    if (stored.schema !== 'daylight.requirements-state/v1') {
      const cause = Object.assign(new Error('Unsupported requirements state schema'), { code: 'UNSUPPORTED_STATE_SCHEMA' });
      throw persistenceError('Requirements state could not be read', cause);
    }
    return mapKeys(stored, camel);
  }

  #write(householdId, state) {
    const stored = mapKeys(plain(state), snake);
    stored.schema = 'daylight.requirements-state/v1';
    try { this.#save(this.#resolveFilePath(householdId), stored, { noRefs: true, sortKeys: true }); }
    catch (error) { throw persistenceError('Requirements state could not be saved', error); }
  }

  async #serialized(householdId, operation) {
    const queue = this.#queues.get(householdId) ?? Promise.resolve();
    const pending = queue.then(operation, operation);
    this.#queues.set(householdId, pending.catch(() => {}));
    return pending;
  }

  async loadProjection(householdId = 'default') {
    await (this.#queues.get(householdId) ?? Promise.resolve());
    return this.#read(householdId).projection;
  }

  async commit(householdId, expectedRevision, projection, envelopes) {
    return this.#serialized(householdId, () => {
      const state = this.#read(householdId);
      const currentRevision = state.projection?.householdRevision ?? 0;
      if (currentRevision !== expectedRevision) return { committed: false, currentRevision };
      state.projection = plain(projection);
      state.journal.push(...plain(envelopes).map(envelope => ({ ...envelope, published: false })));
      this.#compact(state, Date.now());
      this.#write(householdId, state);
      return { committed: true, currentRevision: projection.householdRevision };
    });
  }

  async pending(householdId = 'default') {
    await (this.#queues.get(householdId) ?? Promise.resolve());
    return this.#read(householdId).journal.filter(item => !item.published).map(({ published, ...item }) => item);
  }

  async markPublished(householdId, ids) {
    if (!ids.length) return;
    await this.#serialized(householdId, () => {
      const state = this.#read(householdId);
      const wanted = new Set(ids);
      state.journal = state.journal.map(item => wanted.has(item.transitionId) ? { ...item, published: true } : item);
      const revisions = [...new Set(state.journal.map(item => item.householdRevision))].sort((a, b) => a - b);
      let checkpoint = state.deliveryCheckpoint ?? 0;
      for (const revision of revisions) {
        const batch = state.journal.filter(item => item.householdRevision === revision);
        if (revision > checkpoint && batch.every(item => item.published)) checkpoint = revision;
        else if (revision > checkpoint) break;
      }
      state.deliveryCheckpoint = checkpoint;
      this.#compact(state, Date.now());
      this.#write(householdId, state);
    });
  }

  #compact(state, now) {
    const byRevision = new Map();
    for (const item of state.journal) {
      if (!byRevision.has(item.householdRevision)) byRevision.set(item.householdRevision, []);
      byRevision.get(item.householdRevision).push(item);
    }
    let count = state.journal.length;
    for (const revision of [...byRevision.keys()].sort((a, b) => a - b)) {
      const batch = byRevision.get(revision);
      const old = batch.every(item => item.occurredAt < now - this.#maxAgeMs);
      const over = count > this.#maxEntries;
      if (!batch.every(item => item.published) || (!old && !over)) break;
      state.journal = state.journal.filter(item => item.householdRevision !== revision);
      state.compactedThrough = Math.max(state.compactedThrough ?? 0, revision);
      count -= batch.length;
    }
  }

  async replayAfter(householdId, afterRevision, limit) {
    await (this.#queues.get(householdId) ?? Promise.resolve());
    const state = this.#read(householdId);
    const currentRevision = state.projection?.householdRevision ?? 0;
    if (afterRevision > currentRevision) {
      const error = new Error('Replay cursor is ahead of current state');
      error.name = 'RequirementsApplicationError';
      error.code = 'INVALID_REPLAY_CURSOR';
      error.status = 400;
      throw error;
    }
    if (afterRevision < (state.compactedThrough ?? 0)) {
      const error = new Error('Replay cursor has expired');
      error.name = 'RequirementsApplicationError';
      error.code = 'CURSOR_EXPIRED';
      error.status = 410;
      error.details = { oldestAvailableRevision: (state.compactedThrough ?? 0) + 1, currentRevision };
      throw error;
    }
    const revisions = [...new Set(state.journal.filter(item => item.householdRevision > afterRevision).map(item => item.householdRevision))].sort((a, b) => a - b);
    const included = revisions.slice(0, limit);
    const events = state.journal.filter(item => included.includes(item.householdRevision)).map(({ published, ...item }) => item);
    const hasMore = revisions.length > included.length;
    const nextRevision = hasMore ? (included.at(-1) ?? afterRevision) : currentRevision;
    return {
      schema: 'daylight.requirements-replay/v1',
      afterRevision,
      nextRevision,
      currentRevision,
      oldestAvailableRevision: (state.compactedThrough ?? 0) + 1,
      hasMore,
      events,
    };
  }

  async compactThrough(householdId, revision) {
    await this.#serialized(householdId, () => {
      const state = this.#read(householdId);
      const revisions = [...new Set(state.journal.map(item => item.householdRevision))].sort((a, b) => a - b);
      for (const value of revisions) {
        if (value > revision) break;
        const whole = state.journal.filter(item => item.householdRevision === value);
        if (!whole.every(item => item.published)) break;
        state.journal = state.journal.filter(item => item.householdRevision !== value);
        state.compactedThrough = Math.max(state.compactedThrough ?? 0, value);
      }
      this.#write(householdId, state);
    });
  }

  async oldestAvailableRevision(householdId = 'default') {
    await (this.#queues.get(householdId) ?? Promise.resolve());
    return (this.#read(householdId).compactedThrough ?? 0) + 1;
  }
}

export default YamlRequirementsStateEngine;
