import fs from 'node:fs';
import YAML from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState, deriveInteraction, transition } from '@shared-gaming/index.mjs';
import { scaleClashDefinition } from '@shared-gaming/fixtures/scaleClash.mjs';
import { GamingController } from './GamingController.js';
import { createProviderRegistry } from './providerRegistry.js';

const journeyDefinition = YAML.parse(fs.readFileSync('shared/gaming/definitions/card-game.yml', 'utf8'));

function harness({ resumeStarted = false, definition = scaleClashDefinition, mutateState = null, runtimeResult = null, clock = () => 1000 } = {}) {
  let session = {
    session_id: 'game_test', game_id: 'scale-clash', status: 'active', revision: 0,
    definition_hash: 'definition-current', definition,
    state: createInitialState(definition, { seed: 7, participants: [{ user_id: 'guest' }] }),
    events: [],
  };
  mutateState?.(session.state);
  session.interaction = deriveInteraction(session.state, session.definition, 'guest');
  if (resumeStarted) {
    const card = session.state.zones.hand[0];
    const commands = [
      { command_id: 'old-choose', session_revision: 0, type: 'choose_action', payload: { card_instance_id: card.instance_id } },
    ];
    let outcome = transition(session.state, commands[0], session.definition);
    const challengeId = outcome.state.pending_action.id;
    commands.push(
      { command_id: 'old-prepare', session_revision: 1, type: 'prepare_challenge', payload: { challenge_id: challengeId, prepared: { challenge_id: challengeId, prompt: outcome.state.pending_action.request.prompt } } },
      { command_id: 'old-start', session_revision: 2, type: 'start_challenge', payload: { challenge_id: challengeId } },
    );
    for (const command of commands.slice(1)) outcome = transition(outcome.state, command, session.definition);
    session = { ...session, revision: 3, state: outcome.state, interaction: deriveInteraction(outcome.state, session.definition, 'guest') };
  }
  const api = {
    getDefinition: vi.fn(async () => ({ definition_hash: 'definition-current', definition })),
    createSession: vi.fn(async () => structuredClone(session)),
    getSession: vi.fn(async () => structuredClone(session)),
    applyCommand: vi.fn(async (_id, command) => {
      expect(command.session_revision).toBe(session.revision);
      const result = transition(session.state, command, session.definition);
      if (result.error) throw new Error(result.error.message);
      session = {
        ...session,
        revision: session.revision + 1,
        state: result.state,
        status: result.state.status,
        interaction: deriveInteraction(result.state, session.definition, 'guest'),
        events: result.events,
      };
      return structuredClone(session);
    }),
  };
  const runtime = {
    Surface: () => null,
    ready: Promise.resolve(),
    prepare: vi.fn(async (request) => ({ challenge_id: request.challenge_id, prompt: request.prompt, provider_version: 'test' })),
    start: vi.fn(async () => runtimeResult || ({
      status: 'completed', score: 1,
      metrics: { durationMs: 900, timeToFirstInputMs: 200, firstTry: true, notesPlayed: 8, wrongNotes: 0, restarts: 0 },
      provider_version: 'test', attempt_id: 'attempt-1',
    })),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
  const provider = { id: 'piano', createRuntime: vi.fn(async () => runtime) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child() { return this; } };
  const controller = new GamingController({
    api, providerRegistry: createProviderRegistry([provider]), gameId: 'scale-clash',
    participants: [{ user_id: 'guest' }], viewerId: 'guest', resumeSessionId: resumeStarted ? 'game_test' : null, logger, clock,
  });
  return { controller, api, runtime, logger };
}

describe('GamingController', () => {
  it('starts a fresh battle instead of resuming a stale pinned definition', async () => {
    const definition = structuredClone(scaleClashDefinition);
    const state = createInitialState(definition, { seed: 7, participants: [{ user_id: 'guest' }] });
    const response = (sessionId, definitionHash) => ({
      session_id: sessionId,
      game_id: 'scale-clash',
      status: 'active',
      revision: 0,
      definition_hash: definitionHash,
      definition,
      state: structuredClone(state),
      interaction: deriveInteraction(state, definition, 'guest'),
      events: [],
    });
    const stale = response('game_stale', 'definition-old');
    const fresh = response('game_fresh', 'definition-current');
    const api = {
      getSession: vi.fn(async () => structuredClone(stale)),
      getDefinition: vi.fn(async () => ({ definition_hash: 'definition-current', definition })),
      createSession: vi.fn(async () => structuredClone(fresh)),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child() { return this; } };
    const controller = new GamingController({
      api,
      providerRegistry: createProviderRegistry([]),
      gameId: 'scale-clash',
      participants: [{ user_id: 'guest' }],
      viewerId: 'guest',
      resumeSessionId: 'game_stale',
      logger,
    });

    await controller.start();

    expect(api.createSession).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().session.session_id).toBe('game_fresh');
    expect(logger.warn).toHaveBeenCalledWith('gaming.session.resume-invalidated', expect.objectContaining({
      sessionId: 'game_stale',
      pinnedDefinitionHash: 'definition-old',
      currentDefinitionHash: 'definition-current',
      reason: 'definition_changed',
    }));
    controller.dispose();
  });

  it('abandons a resumed journey when the player deliberately chooses a different partner', async () => {
    const oldState = createInitialState(journeyDefinition, {
      seed: 7, participants: [{ user_id: 'kid-1' }], setup: { partner_id: 'bulbasaur' },
    });
    const newState = createInitialState(journeyDefinition, {
      seed: 8, participants: [{ user_id: 'kid-1' }], setup: { partner_id: 'charmander' },
    });
    const oldSession = {
      session_id: 'game_oldjourney', game_id: 'card-game', status: 'active', revision: 0,
      definition_hash: 'definition-current', definition: journeyDefinition, state: oldState,
      interaction: deriveInteraction(oldState, journeyDefinition, 'kid-1'), events: [],
    };
    const freshSession = {
      ...oldSession,
      session_id: 'game_newjourney',
      state: newState,
      interaction: deriveInteraction(newState, journeyDefinition, 'kid-1'),
    };
    const api = {
      getSession: vi.fn(async () => structuredClone(oldSession)),
      getDefinition: vi.fn(async () => ({ definition_hash: 'definition-current', definition: journeyDefinition })),
      applyCommand: vi.fn(async () => ({ ...oldSession, status: 'abandoned' })),
      createSession: vi.fn(async () => structuredClone(freshSession)),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child() { return this; } };
    const controller = new GamingController({
      api,
      providerRegistry: createProviderRegistry([]),
      gameId: 'card-game',
      participants: [{ user_id: 'kid-1' }],
      viewerId: 'kid-1',
      resumeSessionId: 'game_oldjourney',
      setup: { partner_id: 'charmander' },
      logger,
    });

    await controller.start();

    expect(api.applyCommand).toHaveBeenCalledWith('game_oldjourney', expect.objectContaining({
      type: 'abandon_session', payload: { reason: 'partner_changed' },
    }), 'kid-1');
    expect(api.createSession).toHaveBeenCalledWith(expect.objectContaining({
      setup: { partner_id: 'charmander' },
    }));
    expect(controller.getSnapshot().session.state.partner_id).toBe('charmander');
    controller.dispose();
  });

  it('drives the persisted challenge saga through one provider result', async () => {
    const { controller, api, runtime, logger } = harness();
    await controller.start();
    const initial = controller.getSnapshot().session;
    const enemyBefore = initial.state.enemy.health;
    await controller.chooseAction(initial.state.zones.hand[0].instance_id);
    const final = controller.getSnapshot().session;
    expect(api.applyCommand.mock.calls.map(([, command]) => command.type)).toEqual([
      'choose_action', 'prepare_challenge', 'start_challenge', 'submit_challenge_result',
    ]);
    expect(final.revision).toBe(4);
    expect(final.state.pending_action).toBeNull();
    expect(final.state.enemy.health).toBeLessThan(enemyBefore);
    expect(controller.getSnapshot().combatResult).toMatchObject({
      cardTitle: expect.any(String),
      damage: expect.any(Number),
      retaliation: 2,
      effectiveness: 'Full power',
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
    const experienceEvents = logger.info.mock.calls.map(([event]) => event);
    expect(experienceEvents).toEqual(expect.arrayContaining([
      'gaming.session.ready',
      'gaming.card.selected',
      'gaming.challenge.prepared',
      'gaming.challenge.started',
      'gaming.challenge.completed',
    ]));
    expect(logger.info).toHaveBeenCalledWith('gaming.challenge.completed', expect.objectContaining({
      durationMs: 900,
      timeToFirstInputMs: 200,
      firstTry: true,
      notesPlayed: 8,
      wrongNotes: 0,
      restarts: 0,
    }));
    controller.dispose();
    expect(logger.info).toHaveBeenCalledWith('gaming.session.closed', expect.objectContaining({
      outcome: 'abandoned', cardsSelected: 1, challengesCompleted: 1,
    }));
  });

  it('authoritatively abandons the session when the player closes the game', async () => {
    const { controller, api, logger } = harness();
    await controller.start();
    await controller.close();
    expect(api.applyCommand).toHaveBeenCalledOnce();
    expect(api.applyCommand.mock.calls[0][1]).toMatchObject({
      type: 'abandon_session', payload: { reason: 'player_closed' },
    });
    expect(controller.getSnapshot().session.status).toBe('abandoned');
    expect(logger.info).toHaveBeenCalledWith('gaming.session.close-requested', expect.objectContaining({ reason: 'player_closed' }));
    controller.dispose();
  });

  it('saves an active session without making it terminal', async () => {
    const { controller, api } = harness();
    await controller.start();
    await controller.suspend();
    expect(api.applyCommand).toHaveBeenCalledOnce();
    expect(api.applyCommand.mock.calls[0][1]).toMatchObject({
      type: 'suspend_session', payload: { reason: 'player_saved' },
    });
    expect(controller.getSnapshot().session).toMatchObject({ status: 'active', state: { pending_action: null } });
    controller.dispose();
  });

  it('refunds a pending card when provider preparation fails', async () => {
    const { controller, api, runtime } = harness();
    runtime.prepare.mockRejectedValueOnce(new Error('piano unavailable'));
    await controller.start();
    const card = controller.getSnapshot().session.state.zones.hand[0];
    await controller.chooseAction(card.instance_id);
    expect(api.applyCommand.mock.calls.map(([, command]) => command.type)).toEqual([
      'choose_action', 'abort_pending_action',
    ]);
    expect(controller.getSnapshot().session.state.pending_action).toBeNull();
    expect(controller.getSnapshot().session.state.zones.hand).toContainEqual(card);
    controller.dispose();
  });

  it('keeps tactical card plays in the same turn and resolves announced intent on end turn', async () => {
    const definition = structuredClone(scaleClashDefinition);
    definition.card_battle.turn_mode = 'tactical';
    definition.card_battle.hand_size = 3;
    definition.card_battle.enemy.intents = [
      { id: 'swing', title: 'Heavy Swing', kind: 'attack', amount: 4 },
      { id: 'brace', title: 'Brace', kind: 'defend', amount: 3 },
    ];
    const { controller, api, logger } = harness({ definition });
    await controller.start();
    const initial = controller.getSnapshot().session;
    await controller.chooseAction(initial.state.zones.hand[0].instance_id);
    expect(controller.getSnapshot().session.state).toMatchObject({ turn: 1, cards_played_this_turn: 1 });
    expect(controller.getSnapshot().session.state.player.health).toBe(initial.state.player.health);

    await controller.endTurn();

    expect(api.applyCommand.mock.calls.at(-1)[1].type).toBe('end_turn');
    expect(controller.getSnapshot().session.state).toMatchObject({ turn: 2 });
    expect(controller.getSnapshot().session.state.player.health).toBe(initial.state.player.health - 4);
    expect(controller.getSnapshot().combatResult).toMatchObject({
      kind: 'enemy', cardTitle: 'Heavy Swing', enemyAction: 'attack', damage: 4,
    });
    expect(logger.info).toHaveBeenCalledWith('gaming.turn.ended', expect.objectContaining({
      enemyIntentId: 'swing', damage: 4,
    }));
    controller.dispose();
  });

  it('starts a clean rematch from the terminal battle result', async () => {
    const { controller, api, logger } = harness({ mutateState: (state) => { state.enemy.health = 1; } });
    await controller.start();
    const opening = controller.getSnapshot().session;
    await controller.chooseAction(opening.state.zones.hand[0].instance_id);
    expect(controller.getSnapshot().session.status).toBe('complete');

    const rematchState = createInitialState(scaleClashDefinition, { seed: 11, participants: [{ user_id: 'guest' }] });
    api.createSession.mockImplementationOnce(async () => ({
      session_id: 'game_rematch', game_id: 'scale-clash', status: 'active', revision: 0,
      definition_hash: 'definition-current', definition: scaleClashDefinition,
      state: rematchState, interaction: deriveInteraction(rematchState, scaleClashDefinition, 'guest'), events: [],
    }));
    await controller.restart('second-wind');

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'playing', combatResult: null, session: { session_id: 'game_rematch', status: 'active' },
    });
    expect(api.createSession).toHaveBeenLastCalledWith(expect.objectContaining({ setup: { upgrade_id: 'second-wind' } }));
    expect(logger.info).toHaveBeenCalledWith('gaming.session.ready', expect.objectContaining({ rematch: true, upgradeId: 'second-wind' }));
    controller.dispose();
  });

  it('warns once when cards exist but none are playable', async () => {
    const definition = structuredClone(scaleClashDefinition);
    for (const card of Object.values(definition.cards)) card.cost = 99;
    const { controller, logger } = harness({ definition });
    await controller.start();
    expect(logger.warn).toHaveBeenCalledWith('gaming.hand.blocked', expect.objectContaining({
      reason: 'insufficient_energy', handCount: 3, playableCount: 0, energy: 3,
    }));
    expect(logger.warn.mock.calls.filter(([event]) => event === 'gaming.hand.blocked')).toHaveLength(1);
    controller.dispose();
  });

  it('still logs a blocked tactical hand when end turn remains legal', async () => {
    const definition = structuredClone(scaleClashDefinition);
    definition.card_battle.turn_mode = 'tactical';
    definition.card_battle.hand_size = 3;
    definition.card_battle.enemy.intents = [
      { id: 'swing', title: 'Swing', kind: 'attack', amount: 4 },
      { id: 'brace', title: 'Brace', kind: 'defend', amount: 3 },
    ];
    const { controller, logger } = harness({
      definition,
      mutateState: (state) => { state.player.energy = 0; },
    });
    await controller.start();
    expect(logger.warn).toHaveBeenCalledWith('gaming.hand.blocked', expect.objectContaining({
      reason: 'insufficient_energy', playableCount: 0, energy: 0,
    }));
    controller.dispose();
  });

  it('warns when the authoritative player-choice state has an empty hand', async () => {
    const { controller, logger } = harness({ mutateState: (state) => { state.zones.hand = []; } });
    await controller.start();
    expect(logger.warn).toHaveBeenCalledWith('gaming.hand.empty', expect.objectContaining({
      handCount: 0, playableCount: 0,
    }));
    controller.dispose();
  });

  it('refunds a challenge that was already running when the browser disappeared', async () => {
    const { controller, api, runtime } = harness({ resumeStarted: true });
    await controller.start();
    await vi.waitFor(() => expect(controller.getSnapshot().session.state.pending_action).toBeNull());
    expect(api.applyCommand).toHaveBeenCalledOnce();
    expect(api.applyCommand.mock.calls[0][1]).toMatchObject({
      type: 'abort_pending_action',
      payload: { reason: 'interrupted_before_resume' },
    });
    expect(runtime.start).not.toHaveBeenCalled();
    controller.dispose();
  });
});
