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
    name: 'PersistenceError', code: 'STATE_GATES_STATE_UNAVAILABLE', status: 503, cause,
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
  'gates', 'entitlements', 'subjectSets', 'reasonLabels', 'reason_labels',
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
    schema: 'daylight.state-gates-state/v1',
    projection: null,
    journal: [],
    compactedThrough: 0,
    deliveryCheckpoint: 0,
  };
}

export class YamlStateGatesStateEngine {
  #resolveFilePath; #load; #save; #maxEntries; #maxAgeMs; #queues = new Map(); #cache = new Map();
  // Retention defaults match composition's (5_composition/modules/stateGates.mjs).
  // The journal shares current.yml with the projection, so its size is the cost
  // of every commit — these are deliberately small, and a direct construction
  // that omits them should not silently inherit the old 5000/30d.
  constructor({ filePath, resolveFilePath, load = strictLoad, save = saveYamlToPathAtomic, maxEntries = 500, maxAgeMs = 7 * 24 * 60 * 60 * 1000 }) {
    if (!filePath && !resolveFilePath) throw new Error('YamlStateGatesStateEngine requires filePath or resolveFilePath');
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxAgeMs) || maxAgeMs < 1) {
      throw new Error('YamlStateGatesStateEngine retention must be positive');
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
    catch (error) { throw persistenceError('State Gates state could not be read', error); }
    if (!stored) return emptyState();
    if (stored.schema !== 'daylight.state-gates-state/v1') {
      const cause = Object.assign(new Error('Unsupported State Gates state schema'), { code: 'UNSUPPORTED_STATE_SCHEMA' });
      throw persistenceError('State Gates state could not be read', cause);
    }
    return mapKeys(stored, camel);
  }

  /**
   * Parsed state for a household, from memory after the first read. Every
   * operation used to re-read and re-parse the whole file — 2.6 MB with the
   * journal inside it, ~140 ms parse plus a deep key-walk, 18-24 times per
   * fitness reconcile cycle (the 2026-09-02 event-loop stall). Writers are
   * already serialised per household (#serialized), so one copy is safe:
   * mutate it under the queue, write through, and drop it if the write fails
   * so the next read comes from disk — the interrupted-write contract that
   * stateGatesPersistence.matrix.test.mjs pins. Read paths hand out
   * structuredClone()s, never the copy itself.
   */
  #state(householdId) {
    let state = this.#cache.get(householdId);
    if (!state) {
      state = this.#read(householdId);
      this.#cache.set(householdId, state);
    }
    return state;
  }

  #write(householdId, state) {
    const stored = mapKeys(plain(state), snake);
    stored.schema = 'daylight.state-gates-state/v1';
    // Only the save is guarded. `state` is plain by construction here — commit()
    // serialises caller input before it touches the cached copy — so widening
    // this try to cover mapKeys/plain guards nothing reachable, and an
    // unreachable guard no test can kill does not earn its place.
    try { this.#save(this.#resolveFilePath(householdId), stored, { noRefs: true, sortKeys: true }); }
    catch (error) {
      this.#cache.delete(householdId); // disk is truth again; re-parse on the next read
      throw persistenceError('State Gates state could not be saved', error);
    }
  }

  async #serialized(householdId, operation) {
    const queue = this.#queues.get(householdId) ?? Promise.resolve();
    const pending = queue.then(operation, operation);
    this.#queues.set(householdId, pending.catch(() => {}));
    return pending;
  }

  async loadProjection(householdId = 'default') {
    await (this.#queues.get(householdId) ?? Promise.resolve());
    return structuredClone(this.#state(householdId).projection);
  }

  async commit(householdId, expectedRevision, projection, envelopes) {
    return this.#serialized(householdId, () => {
      const state = this.#state(householdId);
      const currentRevision = state.projection?.householdRevision ?? 0;
      if (currentRevision !== expectedRevision) return { committed: false, currentRevision };
      // Serialise caller input BEFORE touching the cached copy. plain() throws on
      // a value it cannot walk (a self-referential one recurses to RangeError),
      // and that throw must leave nothing mutated -- so the cache stays truthful
      // and there is no half-applied commit to drop.
      let nextProjection; let appended;
      try {
        nextProjection = plain(projection);
        appended = plain(envelopes).map(envelope => ({ ...envelope, published: false }));
      } catch (error) { throw persistenceError('State Gates state could not be saved', error); }
      state.projection = nextProjection;
      state.journal.push(...appended);
      this.#compact(state, Date.now());
      this.#write(householdId, state);
      return { committed: true, currentRevision: projection.householdRevision };
    });
  }

  async pending(householdId = 'default') {
    await (this.#queues.get(householdId) ?? Promise.resolve());
    return structuredClone(this.#state(householdId).journal.filter(item => !item.published).map(({ published, ...item }) => item));
  }

  async markPublished(householdId, ids) {
    if (!ids.length) return;
    await this.#serialized(householdId, () => {
      const state = this.#state(householdId);
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
    const state = this.#state(householdId);
    const currentRevision = state.projection?.householdRevision ?? 0;
    if (afterRevision > currentRevision) {
      const error = new Error('Replay cursor is ahead of current state');
      error.name = 'StateGatesApplicationError';
      error.code = 'INVALID_REPLAY_CURSOR';
      error.status = 400;
      throw error;
    }
    if (afterRevision < (state.compactedThrough ?? 0)) {
      const error = new Error('Replay cursor has expired');
      error.name = 'StateGatesApplicationError';
      error.code = 'CURSOR_EXPIRED';
      error.status = 410;
      error.details = { oldestAvailableRevision: (state.compactedThrough ?? 0) + 1, currentRevision };
      throw error;
    }
    const revisions = [...new Set(state.journal.filter(item => item.householdRevision > afterRevision).map(item => item.householdRevision))].sort((a, b) => a - b);
    const included = revisions.slice(0, limit);
    const events = structuredClone(state.journal.filter(item => included.includes(item.householdRevision)).map(({ published, ...item }) => item));
    const hasMore = revisions.length > included.length;
    const nextRevision = hasMore ? (included.at(-1) ?? afterRevision) : currentRevision;
    return {
      schema: 'daylight.state-gates-replay/v1',
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
      const state = this.#state(householdId);
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
    return (this.#state(householdId).compactedThrough ?? 0) + 1;
  }
}

export default YamlStateGatesStateEngine;
