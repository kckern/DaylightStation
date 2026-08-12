import crypto from 'node:crypto';
import {
  COMMAND_TYPES,
  buildPokemonCampaignProgress,
  GAMING_ENGINE_VERSION,
  POKEMON_JOURNEY_RULESET,
  projectState,
  transition,
  validateCommandEnvelope,
  createInitialState,
  canonicalStringify,
} from '#shared/gaming/index.mjs';

const clone = (value) => structuredClone(value);
const participantId = (session) => session.participants?.[0]?.user_id || session.participants?.[0]?.id || 'guest';
const participantName = (session) => session.participants?.[0]?.display_name
  || session.participants?.[0]?.name
  || participantId(session);

function isoWeekKey(date) {
  const local = new Date(date);
  local.setHours(12, 0, 0, 0);
  const thursday = new Date(local);
  thursday.setDate(local.getDate() + 3 - ((local.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4, 12);
  const week = 1 + Math.round(((thursday - firstThursday) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function currentLocalWeek(clock, requestedKey = null) {
  let anchor = clock();
  if (requestedKey) {
    const match = /^(\d{4})-W(\d{2})$/.exec(requestedKey);
    if (!match) throw new GamingServiceError('invalid_week', 'week must use YYYY-Www', 400);
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (week < 1 || week > 53) throw new GamingServiceError('invalid_week', 'week must use YYYY-Www', 400);
    const januaryFourth = new Date(year, 0, 4, 12);
    const monday = new Date(januaryFourth);
    monday.setDate(januaryFourth.getDate() - ((januaryFourth.getDay() + 6) % 7) + (week - 1) * 7);
    if (isoWeekKey(monday) !== requestedKey) throw new GamingServiceError('invalid_week', 'week is not a valid ISO week', 400);
    anchor = monday;
  }
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { key: isoWeekKey(start), start, end };
}

function betterRun(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (right.score !== left.score) return right.score > left.score ? right : left;
  return String(right.completed_at).localeCompare(String(left.completed_at)) < 0 ? right : left;
}

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
    economyService = null,
    pendingTimeoutMs = 120_000,
    idleTimeoutMs = 6 * 60 * 60 * 1000,
  }) {
    this.definitionStore = definitionStore;
    this.sessionStore = sessionStore;
    this.idFactory = idFactory;
    this.clock = clock;
    this.logger = logger;
    this.economyService = economyService;
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
    let resolvedSetup = structuredClone(setup);
    if (setup?.upgrade_id && !(pinned.definition.card_battle?.upgrades || []).some((upgrade) => upgrade.id === setup.upgrade_id)) {
      throw new GamingServiceError('invalid_upgrade', 'Selected upgrade is unavailable', 400);
    }
    if (pinned.definition.ruleset === POKEMON_JOURNEY_RULESET) {
      const partnerId = setup.partner_id;
      if (!(pinned.definition.journey.partners || []).some((partner) => partner.id === partnerId)) {
        throw new GamingServiceError('invalid_partner', 'Choose an available Pokémon partner', 400);
      }
      const userId = participants[0]?.user_id || participants[0]?.id || 'guest';
      if (userId !== 'guest') {
        const progress = this.getProgress(gameId, userId);
        resolvedSetup = {
          ...resolvedSetup,
          unseen_ids: progress.pokedex.entries.filter((entry) => entry.status === 'unknown').map((entry) => entry.id),
          caught_ids: progress.pokedex.entries.filter((entry) => entry.caught).map((entry) => entry.id),
        };
      }
    }
    const createdAt = this.clock().toISOString();
    const actualSeed = Number.isInteger(seed) ? seed >>> 0 : crypto.randomBytes(4).readUInt32LE(0);
    const state = createInitialState(pinned.definition, { seed: actualSeed, participants, setup: resolvedSetup });
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
      setup: structuredClone(resolvedSetup),
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

  getActiveSession(gameId, userId) {
    if (!userId) throw new GamingServiceError('user_id_required', 'user_id is required', 400);
    const loaded = this.getDefinition(gameId);
    const active = (this.sessionStore.list?.() || [])
      .filter((session) => session.game_id === gameId
        && participantId(session) === userId
        && session.status === 'active'
        && session.definition_hash === loaded.hash)
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0] || null;
    if (!active) return { game_id: gameId, user_id: userId, active_session: null };
    const definition = this.definitionStore.getPinned(active.definition_hash);
    if (!definition) throw new GamingServiceError('definition_snapshot_missing', 'Pinned game definition is unavailable', 500);
    return { game_id: gameId, user_id: userId, active_session: this.#response(active, definition, userId) };
  }

  getProgress(gameId, userId) {
    if (!userId) throw new GamingServiceError('user_id_required', 'user_id is required', 400);
    const loaded = this.getDefinition(gameId);
    const definition = loaded.definition;
    if (definition.ruleset !== POKEMON_JOURNEY_RULESET) {
      throw new GamingServiceError('progress_unsupported', 'This game does not expose journey progress', 404);
    }
    const sessions = (this.sessionStore.list?.() || []).filter((session) => (
      session.game_id === gameId && participantId(session) === userId
    ));
    const activeSession = sessions
      .filter((session) => session.status === 'active' && session.definition_hash === loaded.hash)
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0] || null;
    return buildPokemonCampaignProgress({
      definition,
      sessions,
      userId,
      now: this.clock(),
      activeSession,
    });
  }

  getLeaderboard(gameId, userId, requestedWeek = null) {
    const loaded = this.getDefinition(gameId);
    const definition = loaded.definition;
    if (definition.ruleset !== POKEMON_JOURNEY_RULESET) {
      throw new GamingServiceError('leaderboard_unsupported', 'This game does not expose standings', 404);
    }
    const week = currentLocalWeek(this.clock, requestedWeek);
    const scoreVersion = definition.journey.score_version;
    const journeyVersion = definition.journey.version;
    const qualifying = (this.sessionStore.list?.() || []).filter((session) => {
      const summary = session.state?.journey_summary;
      return session.game_id === gameId
        && participantId(session) !== 'guest'
        && session.status === 'complete'
        && summary?.qualified
        && summary.score_version === scoreVersion
        && summary.journey_version === journeyVersion;
    }).map((session) => ({
      user_id: participantId(session),
      display_name: participantName(session),
      session_id: session.session_id,
      score: session.state.journey_summary.score,
      partner_id: session.state.partner_id,
      completed_at: session.completed_at,
    }));
    const inWeek = qualifying.filter((run) => {
      const completed = new Date(run.completed_at);
      return completed >= week.start && completed < week.end;
    });
    const buildStandings = (runs) => {
      const byUser = new Map();
      const counts = new Map();
      for (const run of runs) {
        counts.set(run.user_id, (counts.get(run.user_id) || 0) + 1);
        byUser.set(run.user_id, betterRun(byUser.get(run.user_id), run));
      }
      return [...byUser.values()]
        .sort((a, b) => b.score - a.score || String(a.completed_at).localeCompare(String(b.completed_at)))
        .map((run, index) => ({ ...run, rank: index + 1, attempt_count: counts.get(run.user_id) }));
    };
    const standings = buildStandings(inWeek);
    const allTimeStandings = buildStandings(qualifying);
    const viewerIndex = standings.findIndex((entry) => entry.user_id === userId);
    const viewerAllTime = allTimeStandings.find((entry) => entry.user_id === userId) || null;
    let rival = null;
    if (viewerIndex > 0) rival = standings[viewerIndex - 1];
    else if (viewerIndex < 0 && standings.length > 0) rival = standings.at(-1);
    else if (viewerIndex === 0 && allTimeStandings[0]?.score > standings[0].score) rival = allTimeStandings[0];
    return {
      game_id: gameId,
      score_version: scoreVersion,
      journey_version: journeyVersion,
      week: {
        key: week.key,
        starts_at: week.start.toISOString(),
        ends_at: week.end.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      standings,
      alltime: allTimeStandings[0] || null,
      viewer_personal_best: viewerAllTime,
      rival,
    };
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

    const progressBefore = definition.ruleset === POKEMON_JOURNEY_RULESET && participantId(session) !== 'guest'
      ? this.getProgress(session.game_id, participantId(session))
      : null;
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
      events: [...session.events, ...outcome.events.map((event) => ({
        revision: session.revision + 1,
        occurred_at: updatedAt,
        ...event,
      }))],
      accepted_command_ids: { ...(session.accepted_command_ids || {}), [command.command_id]: fingerprint },
      updated_at: updatedAt,
      completed_at: outcome.state.status !== 'active' ? updatedAt : session.completed_at,
    };
    this.sessionStore.compareAndSwap(next, session.revision);
    if (progressBefore && this.economyService) {
      const progressAfter = this.getProgress(next.game_id, participantId(next));
      if (!progressBefore.daily?.completed && progressAfter.daily?.completed) {
        Promise.resolve(this.economyService.earn(participantId(next), {
          action: 'piano-card-game-daily',
          source: 'card-game',
          ref: `daily:${progressAfter.daily.date}`,
        })).catch((error) => this.logger?.warn?.('gaming.daily.coin-award-failed', {
          userId: participantId(next), date: progressAfter.daily.date, error: error.message,
        }));
      }
    }
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
      setup: clone(session.setup || {}),
      definition,
      ...projected,
      events,
      created_at: session.created_at,
      updated_at: session.updated_at,
    };
  }
}
