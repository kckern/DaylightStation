import { createGameSessionHeader, SESSION_STATUSES } from './contracts.mjs';
import { GamingKernelError } from './errors.mjs';
import { stableHash } from './canonical.mjs';

const clone = (value) => structuredClone(value);

export class GameSessionCoordinator {
  constructor({ runtime, snapshots, journal, definitions, ids, clock, authorization }) {
    Object.assign(this, { runtime, snapshots, journal, definitions, ids, clock, authorization });
    if (!runtime || !snapshots || !journal || !definitions || !ids || !clock || !authorization) throw new Error('GameSessionCoordinator dependencies are required');
  }

  async create({ ruleset, experience = null, definitionId, participants = [], seats = [], setup = {}, seed, viewer = {} }) {
    const loaded = await this.definitions.getCurrent(definitionId);
    if (!loaded) throw new GamingKernelError('definition_not_found', `Definition ${definitionId} was not found`);
    const pinned = await this.definitions.pin(loaded);
    const header = createGameSessionHeader({
      sessionId: this.ids.session(), ruleset: { ...ruleset, definition_hash: pinned.hash }, experience, artifacts: pinned.artifacts || {}, seed: seed ?? this.ids.seed(),
      participants, seats, status: SESSION_STATUSES.ACTIVE,
    });
    const session = this.runtime.create({ header, definition: pinned.definition, setup });
    const created = { header: clone(header), definition_id: definitionId, setup: clone(setup) };
    await this.journal.create(header.session_id, { ...created, checksum: stableHash(created) });
    await this.snapshots.put(session, { expectedRevision: null });
    return this.#view(session, pinned.definition, viewer);
  }

  async resume(sessionId, viewer = {}) {
    const loaded = await this.#load(sessionId);
    let { session } = loaded;
    const definition = await this.definitions.getPinned(session.header.ruleset.definition_hash);
    if (!definition) throw new GamingKernelError('definition_snapshot_missing', 'Pinned rules definition is unavailable');
    session = await this.#recoverSnapshot(session, definition);
    this.authorization.authorizeView({ session, viewer });
    return this.#view(session, definition, viewer);
  }

  async dispatch(sessionId, envelope, viewer = {}) {
    const loaded = await this.#load(sessionId);
    let { session } = loaded;
    const definition = await this.definitions.getPinned(session.header.ruleset.definition_hash);
    if (!definition) throw new GamingKernelError('definition_snapshot_missing', 'Pinned rules definition is unavailable');
    session = await this.#recoverSnapshot(session, definition);
    this.authorization.authorizeCommand({ session, envelope, viewer });
    const result = this.runtime.dispatch(session, envelope, definition, { recordedAt: this.clock.now().toISOString() });
    if (!result.duplicate) {
      const committed = { revision: result.session.header.revision, command: clone(envelope), events: clone(result.events) };
      await this.journal.append(sessionId, { ...committed, checksum: stableHash(committed) }, { expectedRevision: session.header.revision });
      await this.snapshots.put(result.session, { expectedRevision: session.header.revision });
    }
    return { ...this.#view(result.session, definition, viewer), events: result.events, duplicate: result.duplicate };
  }

  async observe(sessionId, observer) {
    return this.snapshots.observe(sessionId, observer);
  }

  async close(sessionId, { reason = 'closed' } = {}) {
    const current = await this.resume(sessionId, { role: 'system' });
    return this.dispatch(sessionId, {
      command_id: this.ids.command(), actor_id: 'system', expected_revision: current.header.revision,
      logical_time: current.header.revision + 1, command: { type: 'session.close', reason },
    }, { role: 'system' });
  }

  #view(session, definition, viewer = {}) {
    const projection = this.runtime.project(session, definition, viewer);
    if (viewer.role === 'host' || viewer.role === 'system') projection.definition = clone(definition);
    return { header: clone(session.header), ...projection };
  }

  async #recoverSnapshot(session, definition, { snapshotExists = true } = {}) {
    const records = await this.journal.read(session.header.session_id);
    const created = records[0];
    const creation = { header: created?.header, definition_id: created?.definition_id, setup: created?.setup || {} };
    if (!created?.header || !created.checksum || created.checksum !== stableHash(creation)) throw new GamingKernelError('journal_corrupt', 'Gaming session creation record checksum failed');
    let recovered = this.runtime.create({ header: created.header, definition, setup: created.setup || {} });
    for (const record of records.slice(1)) {
      if (!record.command || record.revision !== recovered.header.revision + 1) throw new GamingKernelError('journal_corrupt', 'Gaming journal has a revision gap');
      const committed = { revision: record.revision, command: record.command, events: record.events };
      if (!record.checksum || record.checksum !== stableHash(committed)) throw new GamingKernelError('journal_corrupt', `Gaming journal checksum failed at revision ${record.revision}`);
      const replayed = this.runtime.dispatch(recovered, record.command, definition, { recordedAt: record.events?.[0]?.recorded_at || this.clock.now().toISOString() });
      if (stableHash(replayed.events) !== stableHash(record.events)) throw new GamingKernelError('journal_corrupt', `Gaming journal events diverged at revision ${record.revision}`);
      recovered = replayed.session;
    }
    if (recovered.header.revision < session.header.revision) throw new GamingKernelError('journal_corrupt', 'Gaming snapshot is ahead of its journal');
    if (stableHash(recovered) === stableHash(session)) return session;
    await this.snapshots.put(recovered, { expectedRevision: snapshotExists ? session.header.revision : null });
    return recovered;
  }

  async #load(sessionId) {
    const snapshot = await this.snapshots.get(sessionId);
    if (snapshot) return { session: snapshot };
    const records = await this.journal.read(sessionId);
    const created = records[0];
    if (!created?.header) throw new GamingKernelError('session_not_found', `Session ${sessionId} was not found`);
    const creation = { header: created.header, definition_id: created.definition_id, setup: created.setup || {} };
    if (!created.checksum || created.checksum !== stableHash(creation)) throw new GamingKernelError('journal_corrupt', 'Gaming session creation record checksum failed');
    const definition = await this.definitions.getPinned(created.header.ruleset.definition_hash);
    if (!definition) throw new GamingKernelError('definition_snapshot_missing', 'Pinned rules definition is unavailable');
    const initial = this.runtime.create({ header: created.header, definition, setup: created.setup || {} });
    const recovered = await this.#recoverSnapshot(initial, definition, { snapshotExists: false });
    if (recovered.header.revision === 0) await this.snapshots.put(recovered, { expectedRevision: null });
    return { session: recovered };
  }
}
