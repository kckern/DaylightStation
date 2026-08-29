import { COMMAND_TYPES } from '@shared-gaming/index.mjs';

const makeCommandId = () => globalThis.crypto?.randomUUID?.() || `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);
const freshExperience = () => ({
  cardsSelected: 0,
  turnsEnded: 0,
  challengesStarted: 0,
  challengesCompleted: 0,
  challengesAborted: 0,
  recoveredChallenges: 0,
  totalChallengeDurationMs: 0,
});

export class GamingController {
  constructor({ api, providerRegistry, gameId, surfaceId, participants, viewerId = null, resumeSessionId = null, setup = {}, logger, clock = () => Date.now() }) {
    this.api = api;
    this.providerRegistry = providerRegistry;
    this.gameId = gameId;
    this.surfaceId = surfaceId;
    this.participants = participants;
    this.viewerId = viewerId;
    this.resumeSessionId = resumeSessionId;
    this.setup = setup;
    this.logger = logger;
    this.clock = clock;
    this.listeners = new Set();
    this.snapshot = {
      phase: 'loading', session: null, error: null, providerRuntime: null, combatResult: null,
    };
    this.disposed = false;
    this.closing = false;
    this.actionInFlight = false;
    this.suspendRequested = false;
    this.suspendPromise = null;
    this.resolveSuspend = null;
    this.observedAt = this.clock();
    this.lastHandObservation = null;
    this.sessionCompleteLogged = false;
    this.sessionClosedLogged = false;
    this.experience = freshExperience();
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  #publish(patch) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  #sessionFields(session = this.snapshot.session) {
    return {
      gameId: this.gameId,
      sessionId: session?.session_id || null,
      userId: this.viewerId,
      revision: session?.revision ?? null,
      turn: session?.state?.turn ?? null,
    };
  }

  #challengeFields(pending, session = this.snapshot.session) {
    return {
      ...this.#sessionFields(session),
      challengeId: pending?.id || pending?.request?.challenge_id || null,
      challengeKind: pending?.request?.kind || null,
      challengeLabel: pending?.prepared?.prompt?.label || pending?.request?.prompt?.label || null,
      cardInstanceId: pending?.card_instance_id || null,
      cardDefinitionId: pending?.card_definition_id || null,
    };
  }

  #observeHandAvailability(session, source) {
    if (!session || session.status !== 'active' || session.state?.pending_action) return;
    const legal = session.interaction?.legal_commands || [];
    const playable = legal.filter((command) => command.type === COMMAND_TYPES.CHOOSE_ACTION);
    if (playable.length > 0) return;
    const hand = session.state?.zones?.hand || [];
    const signature = `${session.session_id}:${session.revision}:${hand.map((card) => card.instance_id).join(',')}`;
    if (signature === this.lastHandObservation) return;
    this.lastHandObservation = signature;
    const costs = hand.map((instance) => session.definition?.cards?.[instance.definition_id]?.cost).filter(Number.isFinite);
    const fields = {
      ...this.#sessionFields(session),
      source,
      handCount: hand.length,
      playableCount: 0,
      energy: session.state.player?.energy ?? null,
      cardCosts: costs,
    };
    if (hand.length === 0) {
      this.logger.warn('gaming.hand.empty', fields);
    } else {
      this.logger.warn('gaming.hand.blocked', {
        ...fields,
        reason: costs.length > 0 && costs.every((cost) => cost > session.state.player.energy)
          ? 'insufficient_energy'
          : 'no_legal_action',
      });
    }
  }

  #logSessionComplete(session) {
    if (this.sessionCompleteLogged || session?.status !== 'complete') return;
    this.sessionCompleteLogged = true;
    this.logger.info('gaming.session.completed', {
      ...this.#sessionFields(session),
      winner: session.state.winner,
      playerHealth: session.state.player.health,
      enemyHealth: session.state.enemy.health,
      score: session.state.score ?? null,
      observedDurationMs: Math.max(0, this.clock() - this.observedAt),
      ...this.experience,
    });
  }

  async start() {
    try {
      let session = null;
      if (this.resumeSessionId) {
        try {
          const candidate = await this.api.getSession(this.resumeSessionId, this.viewerId);
          const sameGame = candidate.status === 'active' && candidate.game_id === this.gameId;
          if (sameGame) session = candidate;
        } catch (error) {
          this.logger.warn('gaming.session.resume-missed', {
            gameId: this.gameId,
            sessionId: this.resumeSessionId,
            userId: this.viewerId,
            error: error.message,
          });
        }
      }
      session ||= await this.api.createSession({
        game_id: this.gameId,
        surface_id: this.surfaceId,
        participants: this.participants,
        ...(Object.keys(this.setup).length > 0 ? { setup: this.setup } : {}),
      });
      if (this.disposed) return;
      this.#publish({ phase: 'playing', session, error: null });
      this.logger.info('gaming.session.ready', {
        ...this.#sessionFields(session),
        resumed: session.session_id === this.resumeSessionId,
        definitionHash: session.definition_hash || null,
        handCount: session.state.zones.hand.length,
      });
      this.#observeHandAvailability(session, 'session_ready');
      if (session.state.pending_action) this.#runPendingChallenge().catch((error) => this.#recover(error));
    } catch (error) {
      this.#publish({ phase: 'error', error });
      this.logger.error('gaming.session.start-failed', { gameId: this.gameId, userId: this.viewerId, error: error.message });
    }
  }

  async chooseAction(cardInstanceId) {
    const before = this.snapshot.session;
    if (this.actionInFlight || this.snapshot.phase !== 'playing' || before?.state?.pending_action) return;
    const instance = before.state.zones.hand.find((card) => card.instance_id === cardInstanceId);
    const card = instance ? before.definition.cards[instance.definition_id] : null;
    this.actionInFlight = true;
    try {
      this.#publish({ combatResult: null });
      const selected = await this.#dispatch(COMMAND_TYPES.CHOOSE_ACTION, { card_instance_id: cardInstanceId });
      this.experience.cardsSelected += 1;
      this.logger.info('gaming.card.selected', {
        ...this.#sessionFields(selected),
        cardInstanceId,
        cardDefinitionId: instance?.definition_id || null,
        cardTitle: card?.title || null,
        cardType: card?.type || 'attack',
        challengeKind: card?.challenge?.kind || null,
        challengeLabel: selected.state.pending_action?.request?.prompt?.label || null,
        energyBefore: before.state.player.energy,
        cardCost: card?.cost ?? null,
        baseDamage: card?.damage ?? null,
        baseBlock: card?.block ?? null,
        baseFocus: card?.focus ?? null,
        handCount: before.state.zones.hand.length,
      });
      await this.#runPendingChallenge();
    } catch (error) {
      await this.#recover(error);
    } finally {
      this.actionInFlight = false;
    }
  }

  async restart(upgradeId = null) {
    if (this.actionInFlight || this.snapshot.session?.status !== 'complete') return;
    this.actionInFlight = true;
    try {
      const setup = upgradeId ? { upgrade_id: upgradeId } : null;
      const session = await this.api.createSession({
        game_id: this.gameId,
        surface_id: this.surfaceId,
        participants: this.participants,
        ...(setup ? { setup } : {}),
      });
      if (this.disposed) return;
      this.observedAt = this.clock();
      this.lastHandObservation = null;
      this.sessionCompleteLogged = false;
      this.experience = freshExperience();
      this.#publish({ phase: 'playing', session, error: null, providerRuntime: null, combatResult: null });
      this.logger.info('gaming.session.ready', {
        ...this.#sessionFields(session),
        resumed: false,
        rematch: true,
        upgradeId,
        definitionHash: session.definition_hash || null,
        handCount: session.state.zones.hand.length,
      });
      this.#observeHandAvailability(session, 'rematch_ready');
    } catch (error) {
      await this.#recover(error);
    } finally {
      this.actionInFlight = false;
    }
  }

  async endTurn() {
    const before = this.snapshot.session;
    if (this.actionInFlight || this.snapshot.phase !== 'playing' || before?.state?.pending_action || before?.status !== 'active') return;
    const intent = before.state.enemy.intent;
    this.actionInFlight = true;
    try {
      this.#publish({
        combatResult: {
          kind: 'enemy', cardTitle: intent?.title || 'Enemy turn', resolving: true,
        },
      });
      const session = await this.#dispatch(COMMAND_TYPES.END_TURN, {});
      this.experience.turnsEnded += 1;
      const result = this.#turnResult(session);
      this.#publish({ combatResult: result });
      this.logger.info('gaming.turn.ended', {
        ...this.#sessionFields(session),
        enemyIntentId: intent?.id || null,
        enemyIntentKind: intent?.kind || null,
        damage: result.damage,
        blocked: result.blocked,
        playerHealth: session.state.player.health,
        score: session.state.score ?? null,
      });
      this.#observeHandAvailability(session, 'turn_started');
      this.#logSessionComplete(session);
    } catch (error) {
      await this.#recover(error);
    } finally {
      this.actionInFlight = false;
    }
  }

  async abortChallenge(reason = 'user_aborted') {
    const pending = this.snapshot.session?.state?.pending_action;
    if (this.snapshot.providerRuntime) {
      // start() resolves with an aborted result; the existing lifecycle runner
      // persists that one terminal result, avoiding a competing abort command.
      this.snapshot.providerRuntime.cancel(reason);
      return;
    }
    if (!pending) return;
    try {
      const session = await this.#dispatch(COMMAND_TYPES.ABORT_PENDING_ACTION, { challenge_id: pending.id, reason });
      this.#logChallengeAborted(pending, session, { reason, durationMs: null });
      this.#observeHandAvailability(session, 'challenge_aborted');
    } catch (error) {
      await this.#recover(error);
    }
  }

  async close(reason = 'player_closed') {
    if (this.closing) return;
    this.closing = true;
    const session = this.snapshot.session;
    try {
      this.snapshot.providerRuntime?.cancel?.(reason);
      if (session?.status === 'active') {
        await this.#dispatch(COMMAND_TYPES.ABANDON_SESSION, { reason });
      }
    } catch (error) {
      await this.#recover(error);
    } finally {
      this.logger.info('gaming.session.close-requested', {
        ...this.#sessionFields(), reason,
      });
    }
  }

  async suspend(reason = 'player_saved') {
    if (this.suspendPromise) return this.suspendPromise;
    const session = this.snapshot.session;
    if (!session || session.status !== 'active') return session;
    if (this.snapshot.providerRuntime) {
      this.suspendRequested = true;
      this.suspendPromise = new Promise((resolve) => { this.resolveSuspend = resolve; });
      this.snapshot.providerRuntime.cancel?.('session_suspended');
      return this.suspendPromise;
    }
    try {
      const suspended = await this.#dispatch(COMMAND_TYPES.SUSPEND_SESSION, { reason });
      this.logger.info('gaming.session.suspended', this.#sessionFields(suspended));
      return suspended;
    } catch (error) {
      await this.#recover(error);
      throw error;
    }
  }

  #logChallengeAborted(pending, session, { reason, durationMs, result = null }) {
    this.experience.challengesAborted += 1;
    this.logger.info('gaming.challenge.aborted', {
      ...this.#challengeFields(pending, session),
      lifecycle: pending?.status || null,
      reason,
      durationMs: finiteOrNull(durationMs),
      providerVersion: result?.provider_version || null,
    });
  }

  #logChallengeCompleted(pending, result, session, durationMs) {
    const metrics = result.metrics || {};
    const resolution = (session.events || []).find((event) => event.type === 'challenge_resolved');
    const damage = (session.events || []).find((event) => event.type === 'damage_dealt' && event.target === 'enemy');
    const block = (session.events || []).find((event) => event.type === 'block_gained' && event.target === 'player');
    const focus = (session.events || []).find((event) => event.type === 'focus_gained' && event.target === 'player');
    this.experience.challengesCompleted += 1;
    this.experience.totalChallengeDurationMs += finiteOrNull(durationMs) || 0;
    if (metrics.firstTry === false || metrics.first_try === false) this.experience.recoveredChallenges += 1;
    this.logger.info('gaming.challenge.completed', {
      ...this.#challengeFields(pending, session),
      score: result.score,
      outcome: resolution?.outcome || null,
      passed: resolution?.passed ?? result.verdict?.passed ?? null,
      failedCriteria: resolution?.failed_criteria ?? result.verdict?.failed_criteria ?? [],
      failedGates: resolution?.failed_gates ?? result.verdict?.failed_gates ?? [],
      damage: damage?.amount ?? null,
      block: block?.amount ?? null,
      focus: focus?.amount ?? null,
      durationMs: finiteOrNull(durationMs),
      timeToFirstInputMs: finiteOrNull(metrics.timeToFirstInputMs),
      persistenceDurationMs: finiteOrNull(metrics.persistenceDurationMs),
      firstTry: metrics.firstTry ?? metrics.first_try ?? null,
      notesRequired: metrics.notesRequired ?? metrics.notes_required ?? null,
      notesPlayed: metrics.notesPlayed ?? null,
      wrongNotes: metrics.wrongNotes ?? null,
      wrongInputs: metrics.wrongInputs ?? null,
      restarts: metrics.restarts ?? null,
      persistenceError: metrics.persistenceError ?? metrics.persistence_error ?? false,
      providerVersion: result.provider_version,
      attemptId: result.attempt_id,
    });
  }

  #combatResult(pending, session) {
    const events = session.events || [];
    const resolution = events.find((event) => event.type === 'challenge_resolved');
    const enemyDamage = events.find((event) => event.type === 'damage_dealt' && event.target === 'enemy');
    const retaliation = events.find((event) => event.type === 'damage_dealt' && event.target === 'player');
    const block = events.find((event) => event.type === 'block_gained' && event.target === 'player');
    const focus = events.find((event) => event.type === 'focus_gained' && event.target === 'player');
    const absorbed = events.find((event) => event.type === 'damage_blocked' && event.target === 'enemy');
    const focusSpent = events.find((event) => event.type === 'focus_spent');
    const card = session.definition.cards[pending.card_definition_id];
    const outcome = card?.outcomes?.find((candidate) => candidate.id === resolution?.outcome);
    const multiplier = outcome?.multiplier ?? 1;
    const passGatedFailure = resolution?.passed === false;
    const resultLabel = passGatedFailure
      ? 'No effect — requirements not met'
      : outcome?.label || (multiplier >= 1 ? 'Full power' : multiplier > 0 ? 'Reduced power' : 'Fizzled');
    return {
      cardTitle: card?.title || 'Attack',
      kind: 'card',
      effectKind: card?.type || 'attack',
      damage: enemyDamage?.amount ?? 0,
      block: block?.amount ?? 0,
      focus: focus?.amount ?? 0,
      absorbed: absorbed?.amount ?? 0,
      focusSpent: focusSpent?.amount ?? 0,
      retaliation: retaliation?.amount ?? 0,
      effectiveness: resultLabel,
      passed: resolution?.passed ?? null,
      failedCriteria: resolution?.failed_criteria || [],
      failedGates: resolution?.failed_gates || [],
      hitResult: outcome?.id || null,
      winner: events.find((event) => event.type === 'game_ended')?.winner || null,
    };
  }

  #turnResult(session) {
    const events = session.events || [];
    const intent = events.find((event) => event.type === 'enemy_intent_resolved');
    const damage = events.find((event) => event.type === 'damage_dealt' && event.target === 'player');
    const blocked = events.find((event) => event.type === 'damage_blocked' && event.target === 'player');
    const block = events.find((event) => event.type === 'block_gained' && event.target === 'enemy');
    const charge = events.find((event) => event.type === 'focus_gained' && event.target === 'enemy');
    return {
      kind: 'enemy',
      cardTitle: intent?.title || 'Enemy turn',
      enemyAction: intent?.kind || null,
      damage: damage?.amount ?? 0,
      blocked: blocked?.amount ?? 0,
      block: block?.amount ?? 0,
      focus: charge?.amount ?? 0,
      winner: events.find((event) => event.type === 'game_ended')?.winner || null,
    };
  }

  async #runPendingChallenge() {
    let pending = this.snapshot.session?.state?.pending_action;
    if (!pending) return;
    // A browser cannot know whether an already-started physical performance
    // completed while it was away. Refund it rather than replaying or guessing.
    if (pending.status === 'started') {
      const session = await this.#dispatch(COMMAND_TYPES.ABORT_PENDING_ACTION, {
        challenge_id: pending.id,
        reason: 'interrupted_before_resume',
      });
      this.#logChallengeAborted(pending, session, { reason: 'interrupted_before_resume', durationMs: null });
      this.#observeHandAvailability(session, 'resume_refund');
      return;
    }
    const provider = this.providerRegistry.get(pending.request.domain);
    if (!provider) throw new Error(`Challenge provider unavailable: ${pending.request.domain}`);
    const prepareStartedAt = this.clock();
    const runtime = await provider.createRuntime({
      userId: pending.request.user_id,
      logger: this.logger.child({ provider: provider.id }),
    });
    if (this.disposed) return runtime.dispose();
    this.#publish({ providerRuntime: runtime });
    await runtime.ready;
    let prepared = pending.prepared;
    let restored = false;
    if (pending.status === 'requested') {
      prepared = await runtime.prepare(pending.request);
      await this.#dispatch(COMMAND_TYPES.PREPARE_CHALLENGE, { challenge_id: pending.id, prepared });
    } else if (runtime.restore) {
      restored = true;
      await runtime.restore(prepared);
    } else {
      restored = true;
      // Deterministic providers without restore prepare from the authoritative
      // request while start() still receives the stored prepared snapshot.
      await runtime.prepare(pending.request);
    }
    this.logger.info('gaming.challenge.prepared', {
      ...this.#challengeFields(pending),
      restored,
      prepareDurationMs: Math.max(0, this.clock() - prepareStartedAt),
      providerId: provider.id,
      providerVersion: prepared?.provider_version || provider.version || null,
      pedagogyPolicyVersion: prepared?.pedagogy_policy_version || null,
    });
    await this.#dispatch(COMMAND_TYPES.START_CHALLENGE, { challenge_id: pending.id });
    pending = this.snapshot.session.state.pending_action;
    const challengeStartedAt = this.clock();
    this.experience.challengesStarted += 1;
    this.logger.info('gaming.challenge.started', {
      ...this.#challengeFields(pending),
      providerId: provider.id,
      providerVersion: prepared?.provider_version || provider.version || null,
      pedagogyPolicyVersion: prepared?.pedagogy_policy_version || null,
    });
    const result = await runtime.start(prepared, {});
    if (this.suspendRequested) {
      const session = await this.#dispatch(COMMAND_TYPES.SUSPEND_SESSION, { reason: 'player_saved' });
      runtime.dispose();
      this.#publish({ providerRuntime: null, combatResult: null });
      this.suspendRequested = false;
      this.resolveSuspend?.(session);
      this.resolveSuspend = null;
      this.suspendPromise = null;
      return;
    }
    if (this.disposed || this.closing) {
      runtime.dispose();
      this.#publish({ providerRuntime: null });
      return;
    }
    if (result.status === 'completed') {
      const card = this.snapshot.session.definition.cards[pending.card_definition_id];
      this.#publish({
        combatResult: {
          kind: 'card', cardTitle: card?.title || 'Attack', resolving: true,
        },
      });
    }
    const session = await this.#dispatch(COMMAND_TYPES.SUBMIT_CHALLENGE_RESULT, { challenge_id: pending.id, result });
    const durationMs = result.metrics?.durationMs ?? Math.max(0, this.clock() - challengeStartedAt);
    if (result.status === 'completed') {
      this.#logChallengeCompleted(pending, result, session, durationMs);
      this.#publish({ combatResult: this.#combatResult(pending, session) });
    } else {
      this.#logChallengeAborted(pending, session, {
        reason: result.metrics?.reason || result.status,
        durationMs,
        result,
      });
    }
    runtime.dispose();
    this.#publish({ providerRuntime: null });
    this.#observeHandAvailability(session, 'challenge_resolved');
    this.#logSessionComplete(session);
  }

  async #dispatch(type, payload) {
    const session = this.snapshot.session;
    const command = { command_id: makeCommandId(), session_revision: session.revision, type, payload };

    const authoritative = await this.api.applyCommand(session.session_id, command, this.viewerId);
    if (this.disposed) return authoritative;
    this.#publish({ session: authoritative, error: null });
    return authoritative;
  }

  async #recover(error) {
    this.logger.error('gaming.command.failed', {
      ...this.#sessionFields(),
      code: error.code || null,
      error: error.message,
      challengeActive: Boolean(this.snapshot.session?.state?.pending_action),
    });
    const sessionId = this.snapshot.session?.session_id;
    if (!sessionId) return this.#publish({ phase: 'error', error });
    try {
      const session = await this.api.getSession(sessionId, this.viewerId);
      this.snapshot.providerRuntime?.dispose?.();
      this.#publish({ phase: 'playing', session, error, providerRuntime: null });
      const pending = session.state?.pending_action;
      let recoveredSession = session;
      if (pending) {
        recoveredSession = await this.#dispatch(COMMAND_TYPES.ABORT_PENDING_ACTION, {
          challenge_id: pending.id,
          reason: 'provider_or_command_error',
        });
        this.#logChallengeAborted(pending, recoveredSession, {
          reason: 'provider_or_command_error', durationMs: null,
        });
      }
      this.#observeHandAvailability(recoveredSession, 'command_recovery');
    } catch (reloadError) {
      this.#publish({ phase: 'error', error: reloadError });
    }
  }

  dispose() {
    if (this.disposed) return;
    const session = this.snapshot.session;
    const pending = session?.state?.pending_action;
    if (pending && !this.sessionCompleteLogged) {
      this.logger.info('gaming.challenge.abandoned', {
        ...this.#challengeFields(pending, session),
        lifecycle: pending.status,
        reason: 'surface_closed',
      });
    }
    if (!this.sessionClosedLogged) {
      this.sessionClosedLogged = true;
      this.logger.info('gaming.session.closed', {
        ...this.#sessionFields(session),
        outcome: session?.status === 'complete' ? session.state.winner : 'abandoned',
        observedDurationMs: Math.max(0, this.clock() - this.observedAt),
        challengeActive: Boolean(pending),
        ...this.experience,
      });
    }
    this.disposed = true;
    this.snapshot.providerRuntime?.dispose?.();
    this.listeners.clear();
  }
}
