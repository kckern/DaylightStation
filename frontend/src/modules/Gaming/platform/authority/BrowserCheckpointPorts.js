export class BrowserSnapshotRepository {
  constructor({ storage, namespace }) { this.storage = storage; this.namespace = namespace; this.listeners = new Map(); }
  key(id) { return `${this.namespace}:snapshot:${id}`; }
  async get(id) { const raw = this.storage.getItem(this.key(id)); return raw ? JSON.parse(raw) : null; }
  async put(session, { expectedRevision }) { const current = await this.get(session.header.session_id); if (expectedRevision === null ? current : current?.header?.revision !== expectedRevision) throw new Error('snapshot_revision_conflict'); this.storage.setItem(this.key(session.header.session_id), JSON.stringify(session)); for (const listener of this.listeners.get(session.header.session_id) || []) listener(structuredClone(session)); }
  observe(id, listener) { const set = this.listeners.get(id) || new Set(); set.add(listener); this.listeners.set(id, set); return () => set.delete(listener); }
}

export class BrowserSessionJournal {
  constructor({ storage, namespace }) { this.storage = storage; this.namespace = namespace; }
  key(id) { return `${this.namespace}:journal:${id}`; }
  async read(id) { const raw = this.storage.getItem(this.key(id)); return raw ? JSON.parse(raw) : []; }
  async create(id, record) { if ((await this.read(id)).length) throw new Error('journal_exists'); this.storage.setItem(this.key(id), JSON.stringify([record])); }
  async append(id, record, { expectedRevision }) { const entries = await this.read(id); if (!entries.length || entries.length - 1 !== expectedRevision) throw new Error('journal_revision_conflict'); entries.push({ ...record, revision: expectedRevision + 1 }); this.storage.setItem(this.key(id), JSON.stringify(entries)); }
}
