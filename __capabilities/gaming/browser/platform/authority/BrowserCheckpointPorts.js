/**
 * Every game writes a snapshot and a journal per session, and until 2026-10-23
 * nothing ever removed one: each new game and each server resume added two keys
 * for good. The office screen's localStorage filled, and every chess move after
 * that died `exceeded the quota` — the pawn was put back down and the child's
 * destination chord was read as a fresh pick-up ("Nothing on that square").
 *
 * A session is live only if an `<ns>:active:<user>` index names it. Every user's
 * index counts, because one screen serves the whole household. Everything else
 * in the namespace is a finished, abandoned or replaced game whose record the
 * server already holds.
 */
const QUOTA_ERROR_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);

export function isQuotaError(error) {
  return Boolean(error) && (QUOTA_ERROR_NAMES.has(error.name) || error.code === 22 || error.code === 1014);
}

function storageKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}

export function reclaimCheckpoints({ storage, namespace, keep = [] }) {
  const keys = storageKeys(storage);
  const live = new Set(keep.filter(Boolean));
  const activePrefix = `${namespace}:active:`;
  for (const key of keys) {
    if (!key.startsWith(activePrefix)) continue;
    const id = storage.getItem(key);
    if (id) live.add(id);
  }
  const removed = new Set();
  for (const kind of ['snapshot', 'journal']) {
    const prefix = `${namespace}:${kind}:`;
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (live.has(id)) continue;
      storage.removeItem(key);
      removed.add(id);
    }
  }
  return { removed: [...removed], kept: [...live] };
}

/**
 * A full store is reclaimed and the write tried once more. The session being
 * written is always kept: on create its keys land before the hook writes its
 * index, so the index alone would not protect it.
 */
function writeReclaiming({ storage, namespace, onReclaim }, key, value, sessionId) {
  try {
    storage.setItem(key, value);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    const result = reclaimCheckpoints({ storage, namespace, keep: [sessionId] });
    onReclaim?.(result, 'quota');
    storage.setItem(key, value);
  }
}

export class BrowserSnapshotRepository {
  constructor({ storage, namespace, onReclaim }) { this.storage = storage; this.namespace = namespace; this.onReclaim = onReclaim; this.listeners = new Map(); }
  key(id) { return `${this.namespace}:snapshot:${id}`; }
  async get(id) { const raw = this.storage.getItem(this.key(id)); return raw ? JSON.parse(raw) : null; }
  async put(session, { expectedRevision }) { const current = await this.get(session.header.session_id); if (expectedRevision === null ? current : current?.header?.revision !== expectedRevision) throw new Error('snapshot_revision_conflict'); writeReclaiming(this, this.key(session.header.session_id), JSON.stringify(session), session.header.session_id); for (const listener of this.listeners.get(session.header.session_id) || []) listener(structuredClone(session)); }
  observe(id, listener) { const set = this.listeners.get(id) || new Set(); set.add(listener); this.listeners.set(id, set); return () => set.delete(listener); }
}

export class BrowserSessionJournal {
  constructor({ storage, namespace, onReclaim }) { this.storage = storage; this.namespace = namespace; this.onReclaim = onReclaim; }
  key(id) { return `${this.namespace}:journal:${id}`; }
  async read(id) { const raw = this.storage.getItem(this.key(id)); return raw ? JSON.parse(raw) : []; }
  async create(id, record) { if ((await this.read(id)).length) throw new Error('journal_exists'); writeReclaiming(this, this.key(id), JSON.stringify([record]), id); }
  async append(id, record, { expectedRevision }) { const entries = await this.read(id); if (!entries.length || entries.length - 1 !== expectedRevision) throw new Error('journal_revision_conflict'); entries.push({ ...record, revision: expectedRevision + 1 }); writeReclaiming(this, this.key(id), JSON.stringify(entries), id); }
}
