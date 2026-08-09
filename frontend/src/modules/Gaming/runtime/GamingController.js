import { COMMAND_TYPES, deriveInteraction, transition } from '@shared-gaming/index.mjs';

const makeCommandId = () => globalThis.crypto?.randomUUID?.() || `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export class GamingController {
  constructor({ api, providerRegistry, gameId, participants, viewerId = null, resumeSessionId = null, logger }) {
    this.api = api;
    this.providerRegistry = providerRegistry;
    this.gameId = gameId;
    this.participants = participants;
    this.viewerId = viewerId;
    this.resumeSessionId = resumeSessionId;
    this.logger = logger;
    this.listeners = new Set();
    this.snapshot = { phase: 'loading', session: null, error: null, providerRuntime: null };
    this.disposed = false;
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

  async start() {
    try {
      let session = null;
      if (this.resumeSessionId) {
        try {
          const candidate = await this.api.getSession(this.resumeSessionId, this.viewerId);
          if (candidate.status === 'active' && candidate.game_id === this.gameId) session = candidate;
        } catch (error) {
          this.logger.warn('gaming-session-resume-missed', { sessionId: this.resumeSessionId, error: error.message });
        }
      }
      session ||= await this.api.createSession({ game_id: this.gameId, participants: this.participants });
      if (this.disposed) return;
      this.#publish({ phase: 'playing', session, error: null });
      this.logger.info('gaming-session-ready', { sessionId: session.session_id, gameId: this.gameId, resumed: session.session_id === this.resumeSessionId });
      if (session.state.pending_action) this.#runPendingChallenge().catch((error) => this.#recover(error));
    } catch (error) {
      this.#publish({ phase: 'error', error });
      this.logger.error('gaming-session-start-failed', { gameId: this.gameId, error: error.message });
    }
  }

  async chooseAction(cardInstanceId) {
    if (this.snapshot.phase !== 'playing' || this.snapshot.session?.state?.pending_action) return;
    try {
      await this.#dispatch(COMMAND_TYPES.CHOOSE_ACTION, { card_instance_id: cardInstanceId });
      await this.#runPendingChallenge();
    } catch (error) {
      await this.#recover(error);
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
      await this.#dispatch(COMMAND_TYPES.ABORT_PENDING_ACTION, { challenge_id: pending.id, reason });
    } catch (error) {
      await this.#recover(error);
    }
  }

  async #runPendingChallenge() {
    let pending = this.snapshot.session?.state?.pending_action;
    if (!pending) return;
    // A browser cannot know whether an already-started physical performance
    // completed while it was away. Refund it rather than replaying or guessing.
    if (pending.status === 'started') {
      await this.#dispatch(COMMAND_TYPES.ABORT_PENDING_ACTION, {
        challenge_id: pending.id,
        reason: 'interrupted_before_resume',
      });
      return;
    }
    const provider = this.providerRegistry.get(pending.request.domain);
    if (!provider) throw new Error(`Challenge provider unavailable: ${pending.request.domain}`);
    const runtime = await provider.createRuntime({
      userId: pending.request.user_id,
      api: this.api,
      logger: this.logger.child({ provider: provider.id }),
    });
    if (this.disposed) return runtime.dispose();
    this.#publish({ providerRuntime: runtime });
    await runtime.ready;
    let prepared = pending.prepared;
    if (pending.status === 'requested') {
      prepared = await runtime.prepare(pending.request);
      await this.#dispatch(COMMAND_TYPES.PREPARE_CHALLENGE, { challenge_id: pending.id, prepared });
    } else if (runtime.restore) {
      await runtime.restore(prepared);
    } else {
      // Compatibility fallback for simple deterministic providers. The stored
      // prepared snapshot remains authoritative and is what start() receives.
      await runtime.prepare(pending.request);
    }
    await this.#dispatch(COMMAND_TYPES.START_CHALLENGE, { challenge_id: pending.id });
    pending = this.snapshot.session.state.pending_action;
    const result = await runtime.start(prepared, {});
    if (this.disposed) return;
    await this.#dispatch(COMMAND_TYPES.SUBMIT_CHALLENGE_RESULT, { challenge_id: pending.id, result });
    runtime.dispose();
    this.#publish({ providerRuntime: null });
  }

  async #dispatch(type, payload) {
    const session = this.snapshot.session;
    const command = { command_id: makeCommandId(), session_revision: session.revision, type, payload };

    // Immediate local transition; the server independently replays the same
    // command and its response reconciles this optimistic snapshot.
    const optimistic = transition(session.state, command, session.definition);
    if (optimistic.error) throw Object.assign(new Error(optimistic.error.message), { code: optimistic.error.code });
    this.#publish({
      session: {
        ...session,
        revision: session.revision + 1,
        state: optimistic.state,
        interaction: deriveInteraction(optimistic.state, session.definition, this.viewerId),
        events: optimistic.events,
      },
    });
    const authoritative = await this.api.applyCommand(session.session_id, command, this.viewerId);
    if (this.disposed) return authoritative;
    this.#publish({ session: authoritative, error: null });
    return authoritative;
  }

  async #recover(error) {
    this.logger.error('gaming-command-failed', { code: error.code, error: error.message });
    const sessionId = this.snapshot.session?.session_id;
    if (!sessionId) return this.#publish({ phase: 'error', error });
    try {
      const session = await this.api.getSession(sessionId, this.viewerId);
      this.snapshot.providerRuntime?.dispose?.();
      this.#publish({ phase: 'playing', session, error, providerRuntime: null });
    } catch (reloadError) {
      this.#publish({ phase: 'error', error: reloadError });
    }
  }

  dispose() {
    this.disposed = true;
    this.snapshot.providerRuntime?.dispose?.();
    this.listeners.clear();
  }
}
