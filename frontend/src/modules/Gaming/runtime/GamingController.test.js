import { describe, expect, it, vi } from 'vitest';
import { createInitialState, deriveInteraction, transition } from '@shared-gaming/index.mjs';
import { scaleClashDefinition } from '@shared-gaming/fixtures/scaleClash.mjs';
import { GamingController } from './GamingController.js';
import { createProviderRegistry } from './providerRegistry.js';

function harness({ resumeStarted = false } = {}) {
  let session = {
    session_id: 'game_test', game_id: 'scale-clash', status: 'active', revision: 0,
    definition: scaleClashDefinition,
    state: createInitialState(scaleClashDefinition, { seed: 7, participants: [{ user_id: 'guest' }] }),
    events: [],
  };
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
    start: vi.fn(async () => ({ status: 'completed', score: 1, metrics: {}, provider_version: 'test', attempt_id: 'attempt-1' })),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
  const provider = { id: 'piano', createRuntime: vi.fn(async () => runtime) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child() { return this; } };
  const controller = new GamingController({
    api, providerRegistry: createProviderRegistry([provider]), gameId: 'scale-clash',
    participants: [{ user_id: 'guest' }], viewerId: 'guest', resumeSessionId: resumeStarted ? 'game_test' : null, logger,
  });
  return { controller, api, runtime };
}

describe('GamingController', () => {
  it('drives the persisted challenge saga through one provider result', async () => {
    const { controller, api, runtime } = harness();
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
    expect(runtime.dispose).toHaveBeenCalledOnce();
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
