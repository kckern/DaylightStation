export class MemorySnapshotRepository {
  constructor() { this.sessions = new Map(); this.listeners = new Map(); }
  async get(id) { return this.sessions.has(id) ? structuredClone(this.sessions.get(id)) : null; }
  async put(session, { expectedRevision }) {
    const current = this.sessions.get(session.header.session_id);
    if (expectedRevision === null && current) throw Object.assign(new Error('snapshot_revision_conflict'), { code: 'revision_conflict' });
    if (expectedRevision !== null && current?.header.revision !== expectedRevision) throw Object.assign(new Error('snapshot_revision_conflict'), { code: 'revision_conflict' });
    this.sessions.set(session.header.session_id, structuredClone(session));
    for (const listener of this.listeners.get(session.header.session_id) || []) listener(structuredClone(session));
  }
  observe(id, listener) {
    const listeners = this.listeners.get(id) || new Set(); listeners.add(listener); this.listeners.set(id, listeners);
    return () => listeners.delete(listener);
  }
}

export class MemorySessionJournal {
  constructor() { this.records = new Map(); }
  async create(id, record) { if (this.records.has(id)) throw new Error('journal_exists'); this.records.set(id, [structuredClone(record)]); }
  async append(id, record, { expectedRevision }) {
    const records = this.records.get(id); if (!records) throw new Error('journal_not_found');
    const revision = records.slice(1).length;
    if (revision !== expectedRevision) throw Object.assign(new Error('journal_revision_conflict'), { code: 'revision_conflict' });
    records.push({ revision: expectedRevision + 1, ...structuredClone(record) });
  }
  async read(id) { return structuredClone(this.records.get(id) || []); }
}
