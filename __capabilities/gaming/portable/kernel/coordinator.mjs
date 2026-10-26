import { VerifiedSessionCache } from './verifiedSessionCache.mjs';
import { createGameSessionHeader, SESSION_STATUSES } from "./contracts.mjs";
import { GamingKernelError } from "./errors.mjs";
import { stableHash } from "./canonical.mjs";

const clone = (value) => structuredClone(value);

export class GameSessionCoordinator {
  constructor({ runtime, snapshots, journal, definitions, ids, clock, authorization, yieldControl = async () => {}, measureNow = () => 0, onOperation = null, cache = new VerifiedSessionCache() }) {
    Object.assign(this, { runtime, snapshots, journal, definitions, ids, clock, authorization, yieldControl, measureNow, onOperation, cache });
    this.lanes = new Map();
    if (!runtime || !snapshots || !journal || !definitions || !ids || !clock || !authorization) throw new Error('GameSessionCoordinator dependencies are required');
  }

  async create({ ruleset, experience = null, launch = null, definitionId, participants = [], seats = [], setup = {}, seed, viewer = {} }) {
    const loaded = await this.definitions.getCurrent(definitionId);
    if (!loaded) throw new GamingKernelError('definition_not_found', `Definition ${definitionId} was not found`);
    const pinned = await this.definitions.pin(loaded);
    const header = createGameSessionHeader({
      sessionId: this.ids.session(), ruleset: { ...ruleset, definition_hash: pinned.hash }, experience, launch, artifacts: pinned.artifacts || {}, seed: seed ?? this.ids.seed(),
      participants, seats, status: SESSION_STATUSES.ACTIVE,
    });
    const session = this.runtime.create({ header, definition: pinned.definition, setup });
    const created = { header: clone(header), definition_id: definitionId, setup: clone(setup) };
    let committedJournal = await this.journal.create(header.session_id, { ...created, checksum: stableHash(created) });
    const checkpoint = await this.snapshots.put(session, { expectedRevision: null });
    await this.#remember(header.session_id, session, pinned.definition, { journalVersion: committedJournal?.version, snapshotVersion: checkpoint?.version });
    return this.#view(session, pinned.definition, viewer);
  }

  /**
   * Create a session and apply a known sequence of commands to it in ONE pass.
   *
   * Exists for rebuilding a game from its record (durable chess resume). The
   * same commands sent through `dispatch` cost O(n^3): every dispatch reloads
   * the session by replaying the whole journal through the rules, so a 74-ply
   * game took ~18s to rebuild. Here each command is applied once, in memory,
   * and committed to the journal as `dispatch` would have; the snapshot is
   * written once at the end. Any rejected command throws and leaves a journal
   * that stops at the last accepted one, which a later `resume` recovers from.
   *
   * @param {object} request  as `create`
   * @param {Array<{actor_id: string, logical_time: number, command: object}>} steps
   */
  async createWithHistory(request, steps = []) {
    const { ruleset, experience = null, launch = null, definitionId, participants = [], seats = [], setup = {}, seed, viewer = {} } = request;
    const loaded = await this.definitions.getCurrent(definitionId);
    if (!loaded) throw new GamingKernelError('definition_not_found', `Definition ${definitionId} was not found`);
    const pinned = await this.definitions.pin(loaded);
    const header = createGameSessionHeader({
      sessionId: this.ids.session(), ruleset: { ...ruleset, definition_hash: pinned.hash }, experience, launch, artifacts: pinned.artifacts || {}, seed: seed ?? this.ids.seed(),
      participants, seats, status: SESSION_STATUSES.ACTIVE,
    });
    let session = this.runtime.create({ header, definition: pinned.definition, setup });
    const created = { header: clone(header), definition_id: definitionId, setup: clone(setup) };
    let committedJournal = await this.journal.create(header.session_id, { ...created, checksum: stableHash(created) });
    for (const step of steps) {
      const envelope = {
        command_id: this.ids.command(), actor_id: step.actor_id, expected_revision: session.header.revision,
        logical_time: step.logical_time, command: step.command,
      };
      this.authorization.authorizeCommand({ session, envelope, viewer });
      const result = this.runtime.dispatch(session, envelope, pinned.definition, { recordedAt: this.clock.now().toISOString() });
      const committed = { revision: result.session.header.revision, command: clone(envelope), events: clone(result.events) };
      committedJournal = await this.journal.append(header.session_id, { ...committed, checksum: stableHash(committed) }, { expectedRevision: session.header.revision });
      session = result.session;
    }
    const checkpoint = await this.snapshots.put(session, { expectedRevision: null });
    await this.#remember(header.session_id, session, pinned.definition, { journalVersion: committedJournal?.version, snapshotVersion: checkpoint?.version });
    return this.#view(session, pinned.definition, viewer);
  }

  async resume(sessionId, viewer = {}) {
    return this.#operation('resume', sessionId, async metric => {
      const { session, definition } = await this.#verified(sessionId, metric);
      this.authorization.authorizeView({ session, viewer });
      metric.revision = session.header.revision;
      return this.#timed(metric, 'projectMs', () => this.#view(session, definition, viewer));
    });
  }

  async dispatch(sessionId, envelope, viewer = {}) {
    return this.#operation('dispatch', sessionId, async metric => {
      const { session, definition } = await this.#verified(sessionId, metric);
      this.authorization.authorizeCommand({ session, envelope, viewer });
      const result = this.runtime.dispatch(session, envelope, definition, { recordedAt: this.clock.now().toISOString() });
      if (!result.duplicate) {
        this.cache.invalidate(sessionId);
        const committed = { revision: result.session.header.revision, command: clone(envelope), events: clone(result.events) };
        const appended = await this.#timed(metric, 'appendMs', () => this.journal.append(sessionId, { ...committed, checksum: stableHash(committed) }, { expectedRevision: session.header.revision }));
        const checkpoint = await this.#timed(metric, 'checkpointMs', () => this.snapshots.put(result.session, { expectedRevision: session.header.revision }));
        await this.#remember(sessionId, result.session, definition, { journalVersion: appended?.version, snapshotVersion: checkpoint?.version });
      }
      metric.revision = result.session.header.revision;
      return this.#timed(metric, 'projectMs', () => ({ ...this.#view(result.session, definition, viewer), events: clone(result.events), duplicate: result.duplicate }));
    });
  }

  async #timed(metric, key, operation) {
    const start = this.measureNow();
    try { return await operation(); } finally { metric.durations[key] += Math.max(0, this.measureNow() - start); }
  }

  #operation(operation, sessionId, work) {
    const started = this.measureNow();
    const metric = { operation, sessionId, revision: null, cacheResult: 'bypass', replayedCommands: 0,
      durations: { loadMs: 0, replayMs: 0, appendMs: 0, checkpointMs: 0, projectMs: 0, totalMs: 0 } };
    const previous = this.lanes.get(sessionId) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      try { return await work(metric); }
      finally {
        metric.durations.totalMs = Math.max(0, this.measureNow() - started);
        try { this.onOperation?.(metric); } catch { /* Observability cannot undo a commit. */ }
      }
    });
    this.lanes.set(sessionId, pending);
    const release = () => { if (this.lanes.get(sessionId) === pending) this.lanes.delete(sessionId); };
    pending.then(release, release); return pending;
  }

  async #versions(sessionId) {
    const [journalVersion, snapshotVersion] = await Promise.all([this.journal.getVersion?.(sessionId), this.snapshots.getVersion?.(sessionId)]);
    return journalVersion === undefined || snapshotVersion === undefined ? null : { journalVersion, snapshotVersion };
  }
  #same(left, right) {
    return left && right && left.journalVersion === right.journalVersion && left.snapshotVersion === right.snapshotVersion;
  }
  #changed() { return new GamingKernelError('revision_conflict', 'Gaming storage changed during verification; retry against current history'); }
  async #remember(id, session, definition, versions) {
    // Commit tokens come from inside adapter locks. Never associate an owned
    // state with an external writer's newer token sampled after our commit.
    if (versions.journalVersion === undefined || versions.snapshotVersion === undefined) return;
    if (this.#same(versions, await this.#versions(id))) this.cache.set(id, { session, definition, ...versions });
  }

  async #verified(sessionId, metric) {
    const before = await this.#timed(metric, 'loadMs', () => this.#versions(sessionId));
    const cached = this.cache.get(sessionId, before);
    if (cached) { metric.cacheResult = 'hit'; return cached; }
    metric.cacheResult = before ? 'recovered' : 'bypass';
    const { snapshot, records } = await this.#timed(metric, 'loadMs', async () => ({ snapshot: await this.snapshots.get(sessionId), records: await this.journal.read(sessionId) }));
    const created = records[0];
    if (!created?.header) {
      if (snapshot) throw new GamingKernelError('journal_corrupt', 'Gaming snapshot has no creation journal');
      throw new GamingKernelError('session_not_found', `Session ${sessionId} was not found`);
    }
    const creation = { header: created.header, definition_id: created.definition_id, setup: created.setup || {} };
    if (!created.checksum || created.checksum !== stableHash(creation)) throw new GamingKernelError('journal_corrupt', 'Gaming session creation record checksum failed');
    if (created.header.session_id !== sessionId || (snapshot && snapshot.header.session_id !== sessionId)) throw new GamingKernelError('journal_corrupt', 'Gaming session identity does not match storage');
    const definition = await this.#timed(metric, 'loadMs', () => this.definitions.getPinned(created.header.ruleset.definition_hash));
    if (!definition) throw new GamingKernelError('definition_snapshot_missing', 'Pinned rules definition is unavailable');
    let session = await this.#timed(metric, 'replayMs', async () => {
      let recovered = this.runtime.create({ header: created.header, definition, setup: created.setup || {} });
      for (const record of records.slice(1)) {
        if (!record.command || record.revision !== recovered.header.revision + 1) throw new GamingKernelError('journal_corrupt', 'Gaming journal has a revision gap');
        const committed = { revision: record.revision, command: record.command, events: record.events };
        if (!record.checksum || record.checksum !== stableHash(committed)) throw new GamingKernelError('journal_corrupt', `Gaming journal checksum failed at revision ${record.revision}`);
        const replayed = this.runtime.dispatch(recovered, record.command, definition, { recordedAt: record.events?.[0]?.recorded_at || this.clock.now().toISOString() });
        if (stableHash(replayed.events) !== stableHash(record.events)) throw new GamingKernelError('journal_corrupt', `Gaming journal events diverged at revision ${record.revision}`);
        recovered = replayed.session; metric.replayedCommands += 1;
        if (metric.replayedCommands % 32 === 0) await this.yieldControl();
      }
      return recovered;
    });
    let versions = await this.#versions(sessionId);
    if (before && !this.#same(before, versions)) throw this.#changed();
    if (snapshot && session.header.revision < snapshot.header.revision) throw new GamingKernelError('journal_corrupt', 'Gaming snapshot is ahead of its journal');
    if (!snapshot || stableHash(session) !== stableHash(snapshot)) {
      const checkpoint = await this.#timed(metric, 'checkpointMs', () => this.snapshots.put(session, { expectedRevision: snapshot ? snapshot.header.revision : null }));
      versions = before && checkpoint?.version !== undefined ? { journalVersion: before.journalVersion, snapshotVersion: checkpoint.version } : null;
    }
    if (versions) {
      if (!this.#same(versions, await this.#versions(sessionId))) throw this.#changed();
      this.cache.set(sessionId, { session, definition, ...versions });
    }
    return { session, definition };
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
    const projection = this.runtime.project(session, clone(definition), viewer);
    if (viewer.role === 'host' || viewer.role === 'system') projection.definition = clone(definition);
    return { header: clone(session.header), ...projection };
  }

}
