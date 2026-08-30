import {
  AUTHORITY_STRATEGIES,
  createGameSessionHeader,
  GamingKernelError,
  SESSION_STATUSES,
} from '#shared/gaming/kernel/index.mjs';
import { authorizeGamingSessionCreation, prepareGamingSessionSetup } from './gamingSessionSetup.mjs';

const clone = (value) => structuredClone(value);

function mergePatch(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(patch);
  const next = target && typeof target === 'object' && !Array.isArray(target) ? clone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergePatch(next[key], value) : clone(value);
  }
  return next;
}

/**
 * Process-memory authority for diagnostics and visual QA.
 *
 * It deliberately bypasses snapshots, journals, effects, AI, printing, and
 * persisted drawing checkpoints. A backend restart clears every session.
 */
export class GamingDiagnosticSessions {
  constructor({ runtime, definitions, manifestStore, partyGamesCatalog = null, ids, authorization, clock = { now: () => new Date() }, ttlMs = 4 * 60 * 60_000, maxSessions = 32 }) {
    if (!runtime || !definitions || !manifestStore || !ids || !authorization) throw new Error('GamingDiagnosticSessions dependencies are required');
    Object.assign(this, { runtime, definitions, manifestStore, partyGamesCatalog, ids, authorization, clock, ttlMs, maxSessions });
    this.sessions = new Map();
    this.drawings = new Map();
  }

  async createSession(request) {
    this.#prune();
    authorizeGamingSessionCreation({ viewer: request.viewer, participants: request.participants, seats: request.seats });
    const loaded = await this.definitions.getCurrent(request.definitionId);
    if (!loaded) throw new GamingKernelError('definition_not_found', `Definition ${request.definitionId} was not found`);
    // Use the authored definition as loaded. `pin()` archives artifacts for a
    // durable session and is therefore intentionally outside this path.
    const pinned = {
      definition: clone(loaded.definition),
      hash: loaded.hash,
      artifacts: clone(loaded.artifacts || {}),
    };
    const ruleset = pinned.definition?.rule_module;
    const experienceReference = pinned.definition?.experience;
    const manifest = this.manifestStore.get(experienceReference?.id, experienceReference?.version);
    if (!ruleset?.id || !Number.isInteger(ruleset.version) || !manifest) throw new GamingKernelError('invalid_definition', 'Mounted rules and experience references are required');
    const surface = manifest.surfaces.find((entry) => entry.id === request.surfaceId)
      || (manifest.surfaces.length === 1 ? manifest.surfaces[0] : null);
    if (!surface) throw new GamingKernelError('surface_incompatible', `Experience ${manifest.id} does not support surface ${request.surfaceId}`);
    const { participants, seats, setup } = prepareGamingSessionSetup({ manifest, request, partyGamesCatalog: this.partyGamesCatalog });
    const sessionId = `diagnostic:${this.ids.session().replace(/^[^:]+:/, '')}`;
    const header = createGameSessionHeader({
      sessionId,
      ruleset: { ...ruleset, definition_hash: pinned.hash },
      experience: { id: manifest.id, version: manifest.version, manifest_hash: manifest.hash },
      launch: { surface_id: surface.id, authority_mode: AUTHORITY_STRATEGIES.EPHEMERAL },
      artifacts: pinned.artifacts || {},
      seed: request.seed ?? this.ids.seed(),
      participants,
      seats,
      status: SESSION_STATUSES.ACTIVE,
    });
    const session = this.runtime.create({ header, definition: pinned.definition, setup });
    const now = this.clock.now().toISOString();
    this.sessions.set(sessionId, {
      session,
      definition: clone(pinned.definition),
      definitionId: request.definitionId,
      presenterId: surface.presenter,
      createdAt: now,
      updatedAt: now,
      history: [{ kind: 'created', revision: 0, at: now, setup: clone(setup) }],
    });
    this.#trim();
    return this.resumeSession(sessionId, request.viewer);
  }

  resumeSession(sessionId, viewer = {}) {
    const record = this.#record(sessionId);
    this.authorization.authorizeView({ session: record.session, viewer });
    return this.#view(record, viewer);
  }

  dispatch(sessionId, envelope, viewer = {}) {
    const record = this.#record(sessionId);
    this.authorization.authorizeCommand({ session: record.session, envelope, viewer });
    const recordedAt = this.clock.now().toISOString();
    const result = this.runtime.dispatch(record.session, envelope, record.definition, { recordedAt });
    record.session = result.session;
    record.updatedAt = recordedAt;
    record.history.push({ kind: 'command', revision: result.session.header.revision, at: recordedAt, envelope: clone(envelope), events: clone(result.events) });
    return { ...this.#view(record, viewer), events: clone(result.events), duplicate: result.duplicate };
  }

  advance(sessionId, { command, actorId = 'host' } = {}, viewer = {}) {
    if (!command?.type) throw new GamingKernelError('invalid_contract', 'A diagnostic command type is required');
    const record = this.#record(sessionId);
    return this.dispatch(sessionId, {
      command_id: this.ids.command(),
      actor_id: actorId,
      expected_revision: record.session.header.revision,
      logical_time: this.clock.now().getTime(),
      command: clone(command),
    }, viewer);
  }

  overrideState(sessionId, patch, viewer = {}) {
    if (viewer.role !== 'host' && viewer.role !== 'system') throw new GamingKernelError('authorization_denied', 'Gaming diagnostic override requires host authority');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new GamingKernelError('invalid_contract', 'Diagnostic state override must be an object');
    const record = this.#record(sessionId);
    const before = clone(record.session.state);
    record.session.state = mergePatch(record.session.state, patch);
    record.session.header.revision += 1;
    if (Object.values(SESSION_STATUSES).includes(record.session.state?.status)) record.session.header.status = record.session.state.status;
    record.updatedAt = this.clock.now().toISOString();
    record.history.push({ kind: 'override', revision: record.session.header.revision, at: record.updatedAt, patch: clone(patch), before });
    return this.#view(record, viewer);
  }

  inspect(sessionId, viewer = {}) {
    const record = this.#record(sessionId);
    this.authorization.authorizeView({ session: record.session, viewer });
    return { ...this.#view(record, viewer), diagnostic: { ...this.#metadata(record), history: clone(record.history) } };
  }

  listSessions(viewer = {}) {
    if (viewer.role !== 'host' && viewer.role !== 'system') throw new GamingKernelError('authorization_denied', 'Gaming diagnostics require host authority');
    this.#prune();
    return [...this.sessions.values()].map((record) => ({
      session_id: record.session.header.session_id,
      ruleset_id: record.session.header.ruleset.id,
      phase: record.session.state?.phase || null,
      status: record.session.header.status,
      revision: record.session.header.revision,
      ...this.#metadata(record),
    }));
  }

  deleteSession(sessionId, viewer = {}) {
    if (viewer.role !== 'host' && viewer.role !== 'system') throw new GamingKernelError('authorization_denied', 'Gaming diagnostics require host authority');
    const deleted = this.sessions.delete(sessionId);
    this.drawings.delete(sessionId);
    return { deleted };
  }

  closeSession(sessionId, options = {}, viewer = {}) {
    return this.advance(sessionId, {
      actorId: viewer.role === 'system' ? 'system' : 'host',
      command: { type: 'session.close', reason: options.reason || 'closed' },
    }, viewer);
  }

  listEffects() { return []; }
  printHostPacket() { return { status: 'diagnostic-session-no-print' }; }
  getDrawingCheckpoint(sessionId, viewer) { this.resumeSession(sessionId, viewer); return clone(this.drawings.get(sessionId) || { strokes: [] }); }
  putDrawingCheckpoint(sessionId, checkpoint, viewer) { this.resumeSession(sessionId, viewer); const value = clone(checkpoint || { strokes: [] }); this.drawings.set(sessionId, value); return value; }
  deleteDrawingCheckpoint(sessionId, viewer) { this.resumeSession(sessionId, viewer); return { deleted: this.drawings.delete(sessionId) }; }

  #view(record, viewer) {
    const projection = this.runtime.project(record.session, record.definition, viewer);
    if (viewer.role === 'host' || viewer.role === 'system') projection.definition = clone(record.definition);
    return { header: clone(record.session.header), ...projection, diagnostic: this.#metadata(record) };
  }

  #metadata(record) {
    return {
      ephemeral: true,
      definition_id: record.definitionId,
      presenter_id: record.presenterId,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    };
  }

  #record(sessionId) {
    this.#prune();
    const record = this.sessions.get(sessionId);
    if (!record) throw new GamingKernelError('session_not_found', `Diagnostic session ${sessionId} was not found`);
    return record;
  }

  #prune() {
    const cutoff = this.clock.now().getTime() - this.ttlMs;
    for (const [sessionId, record] of this.sessions) {
      if (Date.parse(record.updatedAt) < cutoff) this.deleteSession(sessionId, { role: 'system' });
    }
  }

  #trim() {
    while (this.sessions.size > this.maxSessions) {
      const oldest = [...this.sessions.entries()].sort((left, right) => Date.parse(left[1].updatedAt) - Date.parse(right[1].updatedAt))[0];
      if (!oldest) break;
      this.deleteSession(oldest[0], { role: 'system' });
    }
  }
}
