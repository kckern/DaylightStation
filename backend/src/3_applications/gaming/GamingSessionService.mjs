import crypto from 'node:crypto';
import {
  COMMAND_TYPES,
  GAMING_ENGINE_VERSION,
  projectState,
  transition,
  validateCommandEnvelope,
  createInitialState,
  canonicalStringify,
} from '#shared/gaming/index.mjs';

export class GamingServiceError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'GamingServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class GamingSessionService {
  constructor({
    definitionStore,
    sessionStore,
    idFactory = () => `game_${crypto.randomUUID()}`,
    clock = () => new Date(),
    logger = null,
    pendingTimeoutMs = 120_000,
    idleTimeoutMs = 6 * 60 * 60 * 1000,
  }) {
    this.definitionStore = definitionStore;
    this.sessionStore = sessionStore;
    this.idFactory = idFactory;
    this.clock = clock;
    this.logger = logger;
    this.pendingTimeoutMs = pendingTimeoutMs;
    this.idleTimeoutMs = idleTimeoutMs;
  }

  recoverStaleSessions() {
    const now = this.clock().getTime();
    const recovered = [];
    for (const session of this.sessionStore.list?.() || []) {
      if (session.status !== 'active') continue;
      const ageMs = Math.max(0, now - new Date(session.updated_at).getTime());
      const pending = session.state?.pending_action;
      let type = null;
      let payload = null;
      if (pending) {
        const authoredTimeout = Number(pending.prepared?.timeout_ms ?? pending.request?.timeout_ms);
        const timeoutMs = Number.isFinite(authoredTimeout) && authoredTimeout > 0
          ? authoredTimeout
          : this.pendingTimeoutMs;
        if (ageMs <= timeoutMs) continue;
        type = COMMAND_TYPES.ABORT_PENDING_ACTION;
        payload = { challenge_id: pending.id, reason: 'stale_challenge_timeout' };
      } else {
        if (ageMs <= this.idleTimeoutMs) continue;
        type = COMMAND_TYPES.ABANDON_SESSION;
        payload = { reason: 'idle_session_timeout' };
      }
      try {
        this.applyCommand(session.session_id, {
          command_id: `recovery-${session.revision}-${type}`,
          session_revision: session.revision,
          type,
          payload,
        });
        recovered.push({ session_id: session.session_id, type });
      } catch (error) {
        this.logger?.warn?.('gaming.session.recovery-skipped', {
          sessionId: session.session_id,
          type,
          code: error.code || null,
          error: error.message,
        });
      }
    }
    return recovered;
  }

  getDefinition(gameId) {
    const loaded = this.definitionStore.get(gameId);
    if (!loaded) throw new GamingServiceError('definition_not_found', 'Game definition not found', 404);
    return loaded;
  }

  createSession({ game_id: gameId, participants = [], seed = null, setup = {} }) {
    if (!setup || typeof setup !== 'object' || Array.isArray(setup)) {
      throw new GamingServiceError('invalid_setup', 'Session setup must be an object', 400);
    }
    const loaded = this.getDefinition(gameId);
    const pinned = this.definitionStore.pin(loaded.definition);
    if (setup?.upgrade_id && !(pinned.definition.card_battle.upgrades || []).some((upgrade) => upgrade.id === setup.upgrade_id)) {
      throw new GamingServiceError('invalid_upgrade', 'Selected upgrade is unavailable', 400);
    }
    const createdAt = this.clock().toISOString();
    const actualSeed = Number.isInteger(seed) ? seed >>> 0 : crypto.randomBytes(4).readUInt32LE(0);
    const state = createInitialState(pinned.definition, { seed: actualSeed, participants, setup });
    const session = {
      schema_version: 1,
      session_id: this.idFactory(),
      game_id: gameId,
      status: state.status,
      revision: 0,
      engine_version: GAMING_ENGINE_VERSION,
      definition_hash: pinned.hash,
      seed: actualSeed,
      participants: structuredClone(participants),
      setup: structuredClone(setup),
      state,
      commands: [],
      events: [],
      accepted_command_ids: {},
      created_at: createdAt,
      updated_at: createdAt,
      completed_at: null,
    };
    this.sessionStore.create(session);
    this.logger?.info?.('gaming.session.created', { sessionId: session.session_id, gameId, definitionHash: pinned.hash });
    return this.#response(session, pinned.definition);
  }

  getSession(sessionId, viewerId = null) {
    const session = this.sessionStore.get(sessionId);
    if (!session) throw new GamingServiceError('session_not_found', 'Gaming session not found', 404);
    const definition = this.definitionStore.getPinned(session.definition_hash);
    if (!definition) throw new GamingServiceError('definition_snapshot_missing', 'Pinned game definition is unavailable', 500);
    return this.#response(session, definition, viewerId);
  }

  applyCommand(sessionId, command, viewerId = null) {
    const validation = validateCommandEnvelope(command);
    if (!validation.valid) throw new GamingServiceError('invalid_command', validation.errors.join('; '), 400);
    const session = this.sessionStore.get(sessionId);
    if (!session) throw new GamingServiceError('session_not_found', 'Gaming session not found', 404);
    const fingerprint = crypto.createHash('sha256').update(canonicalStringify(command)).digest('hex');
    const acceptedFingerprint = session.accepted_command_ids?.[command.command_id];
    if (acceptedFingerprint) {
      if (acceptedFingerprint !== fingerprint) throw new GamingServiceError('idempotency_conflict', 'command_id was already used with different content', 409);
      return { ...this.getSession(sessionId, viewerId), duplicate: true };
    }
    if (command.session_revision !== session.revision) {
      throw new GamingServiceError('revision_conflict', 'Gaming session revision is stale', 409, { current_revision: session.revision });
    }
    const definition = this.definitionStore.getPinned(session.definition_hash);
    if (!definition) throw new GamingServiceError('definition_snapshot_missing', 'Pinned game definition is unavailable', 500);

    const pendingBefore = session.state.pending_action;
    const outcome = transition(session.state, command, definition);
    if (outcome.error) throw new GamingServiceError(outcome.error.code, outcome.error.message, 422, outcome.error.details);
    const updatedAt = this.clock().toISOString();
    const next = {
      ...session,
      revision: session.revision + 1,
      status: outcome.state.status,
      state: outcome.state,
      commands: [...session.commands, structuredClone(command)],
      events: [...session.events, ...outcome.events.map((event) => ({ revision: session.revision + 1, ...event }))],
      accepted_command_ids: { ...(session.accepted_command_ids || {}), [command.command_id]: fingerprint },
      updated_at: updatedAt,
      completed_at: outcome.state.status !== 'active' ? updatedAt : session.completed_at,
    };
    this.sessionStore.compareAndSwap(next, session.revision);
    const logFields = {
      sessionId,
      gameId: session.game_id,
      userId: session.participants[0]?.user_id || session.participants[0]?.id || null,
      revision: next.revision,
      turn: next.state.turn,
    };
    this.logger?.info?.('gaming.command.accepted', { ...logFields, commandId: command.command_id, type: command.type });
    for (const event of outcome.events) {
      if (event.type === 'challenge_resolved') {
        this.logger?.info?.('gaming.authority.challenge.resolved', {
          ...logFields,
          challengeId: event.challenge_id,
          cardDefinitionId: pendingBefore?.card_definition_id || null,
          challengeKind: pendingBefore?.request?.kind || null,
          score: event.score,
          outcome: event.outcome,
        });
      } else if (event.type === 'action_aborted' || event.type === 'challenge_interrupted') {
        this.logger?.info?.('gaming.authority.challenge.aborted', {
          ...logFields,
          challengeId: event.challenge_id,
          cardDefinitionId: pendingBefore?.card_definition_id || null,
          challengeKind: pendingBefore?.request?.kind || null,
          reason: event.reason || event.status || 'aborted',
        });
      } else if (event.type === 'enemy_intent_resolved') {
        const damage = outcome.events.find((candidate) => candidate.type === 'damage_dealt' && candidate.target === 'player');
        const blocked = outcome.events.find((candidate) => candidate.type === 'damage_blocked' && candidate.target === 'player');
        this.logger?.info?.('gaming.authority.enemy.intent.resolved', {
          ...logFields,
          intentId: event.intent_id,
          intentKind: event.kind,
          amount: event.amount,
          damage: damage?.amount ?? 0,
          blocked: blocked?.amount ?? 0,
          playerHealth: next.state.player.health,
        });
      } else if (event.type === 'game_ended') {
        this.logger?.info?.('gaming.authority.session.completed', {
          ...logFields,
          winner: event.winner,
          playerHealth: next.state.player.health,
          enemyHealth: next.state.enemy.health,
          score: next.state.score ?? null,
          durationMs: Math.max(0, new Date(updatedAt).getTime() - new Date(session.created_at).getTime()),
        });
      } else if (event.type === 'session_abandoned') {
        this.logger?.info?.('gaming.authority.session.abandoned', {
          ...logFields,
          reason: event.reason,
          durationMs: Math.max(0, new Date(updatedAt).getTime() - new Date(session.created_at).getTime()),
        });
      }
    }
    return this.#response(next, definition, viewerId, outcome.events);
  }

  #response(session, definition, viewerId = null, events = []) {
    const projected = projectState(session.state, definition, viewerId);
    return {
      session_id: session.session_id,
      game_id: session.game_id,
      status: session.status,
      revision: session.revision,
      definition_hash: session.definition_hash,
      definition,
      ...projected,
      events,
      created_at: session.created_at,
      updated_at: session.updated_at,
    };
  }
}
