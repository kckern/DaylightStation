import { AUTHORITY_STRATEGIES } from './contracts.mjs';

export class RemoteAuthority {
  constructor({ transport }) { this.kind = AUTHORITY_STRATEGIES.REMOTE; this.transport = transport; }
  create(request) { return this.transport.create(request); }
  resume(id, viewer) { return this.transport.resume(id, viewer); }
  dispatch(id, envelope, viewer) { return this.transport.dispatch(id, envelope, viewer); }
  observe(id, listener) { return this.transport.observe(id, listener); }
  close(id, options) { return this.transport.close(id, options); }
}

export class CheckpointedLocalAuthority {
  constructor({ coordinator }) { this.kind = AUTHORITY_STRATEGIES.CHECKPOINTED_LOCAL; this.coordinator = coordinator; }
  create(request) { return this.coordinator.create(request); }
  resume(id, viewer) { return this.coordinator.resume(id, viewer); }
  dispatch(id, envelope, viewer) { return this.coordinator.dispatch(id, envelope, viewer); }
  observe(id, listener) { return this.coordinator.observe(id, listener); }
  close(id, options) { return this.coordinator.close(id, options); }
}

export class EphemeralAuthority extends CheckpointedLocalAuthority {
  constructor(options) { super(options); this.kind = AUTHORITY_STRATEGIES.EPHEMERAL; }
}

export function createEphemeralPorts() {
  const sessions = new Map(); const records = new Map(); const listeners = new Map();
  return {
    snapshots: {
      async get(id) { return sessions.has(id) ? structuredClone(sessions.get(id)) : null; },
      async put(session, { expectedRevision }) {
        const current = sessions.get(session.header.session_id);
        if (expectedRevision === null ? current : current?.header.revision !== expectedRevision) throw new Error('snapshot_revision_conflict');
        sessions.set(session.header.session_id, structuredClone(session));
        for (const listener of listeners.get(session.header.session_id) || []) listener(structuredClone(session));
      },
      observe(id, listener) { const set = listeners.get(id) || new Set(); set.add(listener); listeners.set(id, set); return () => set.delete(listener); },
    },
    journal: {
      async create(id, record) { if (records.has(id)) throw new Error('journal_exists'); records.set(id, [structuredClone(record)]); },
      async append(id, record, { expectedRevision }) {
        const entries = records.get(id); if (!entries || entries.length - 1 !== expectedRevision) throw new Error('journal_revision_conflict');
        entries.push({ ...structuredClone(record), revision: expectedRevision + 1 });
      },
      async read(id) { return structuredClone(records.get(id) || []); },
    },
  };
}
