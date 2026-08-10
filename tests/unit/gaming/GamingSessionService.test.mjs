import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YamlGamingDefinitionStore } from '../../../backend/src/1_adapters/persistence/yaml/gaming/YamlGamingDefinitionStore.mjs';
import { YamlGamingSessionStore } from '../../../backend/src/1_adapters/persistence/yaml/gaming/YamlGamingSessionStore.mjs';
import { GamingSessionService } from '../../../backend/src/3_applications/gaming/GamingSessionService.mjs';
import { validateDefinition } from '../../../shared/gaming/definition.mjs';
import { scaleClashDefinition } from '../../../shared/gaming/fixtures/scaleClash.mjs';

const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function service({ logger = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaming-service-'));
  scratch.push(root);
  const definitionStore = new YamlGamingDefinitionStore({
    definitionsDir: path.join(root, 'games'),
    archiveDir: path.join(root, 'definitions'),
    builtIns: { 'scale-clash': scaleClashDefinition },
    builtInFiles: {
      'card-game': path.resolve('shared/gaming/definitions/card-game.yml'),
    },
  });
  const sessionStore = new YamlGamingSessionStore({ sessionsDir: path.join(root, 'sessions') });
  return new GamingSessionService({
    definitionStore,
    sessionStore,
    idFactory: () => 'game_12345678',
    clock: () => new Date('2026-08-09T12:00:00.000Z'),
    logger,
  });
}

describe('GamingSessionService', () => {
  it('loads the Card Game from YAML and creates scale challenges', () => {
    const svc = service();
    const loaded = svc.getDefinition('card-game');
    expect(loaded.definition.title).toBe('Riff Raiders');
    expect(Object.values(loaded.definition.cards).every((card) => card.challenge.kind === 'scale')).toBe(true);
    expect(new Set(Object.values(loaded.definition.cards).map((card) => card.type))).toEqual(new Set(['attack', 'guard', 'focus']));
    expect(Object.values(loaded.definition.cards).every((card) => !/major|scale/i.test(card.title))).toBe(true);
    const prompts = loaded.definition.card_battle.challenge_pools['major-scales'].prompts;
    expect(prompts.every((prompt) => prompt.abc === undefined && prompt.expected_midi === undefined)).toBe(true);
    expect(prompts.map((prompt) => prompt.scale.tonic)).toEqual(['C', 'G', 'F', 'D']);
    const created = svc.createSession({ game_id: 'card-game', participants: [{ user_id: 'guest' }], seed: 7 });
    const card = created.state.zones.hand[0];
    const chosen = svc.applyCommand(created.session_id, {
      command_id: 'scale-1', session_revision: 0, type: 'choose_action', payload: { card_instance_id: card.instance_id },
    });
    expect(chosen.state.pending_action.request).toMatchObject({ domain: 'piano', kind: 'scale' });
    expect(chosen.state.pending_action.request.prompt.expected_midi).toHaveLength(8);
    expect(chosen.state.pending_action.request.prompt.scale).toMatchObject({ mode: 'major', octave: 4 });
    expect(chosen.state.pending_action.request.context.challenge_pool).toBe('major-scales');
    expect(loaded.definition.cards[card.definition_id].challenge.prompt).toBeUndefined();
  });

  it('rejects low-level MIDI or ABC authoring at the game-definition boundary', () => {
    const definition = structuredClone(service().getDefinition('card-game').definition);
    definition.card_battle.challenge_pools['major-scales'].prompts[0].expected_midi = [60, 62];
    expect(validateDefinition(definition)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        'challenge pool major-scales scale prompt must use semantic scale fields, not MIDI or ABC',
      ]),
    });
  });

  it('pins the definition and replays commands authoritatively', () => {
    const svc = service();
    const created = svc.createSession({ game_id: 'scale-clash', participants: [{ user_id: 'guest' }], seed: 7 });
    const card = created.state.zones.hand[0];
    const response = svc.applyCommand(created.session_id, {
      command_id: 'command-1', session_revision: 0, type: 'choose_action', payload: { card_instance_id: card.instance_id },
    });
    expect(response.revision).toBe(1);
    expect(response.state.pending_action.status).toBe('requested');
    expect(response.definition_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('logs authoritative challenge outcomes with stable monitoring fields', () => {
    const logger = { info: vi.fn() };
    const svc = service({ logger });
    const created = svc.createSession({ game_id: 'scale-clash', participants: [{ user_id: 'guest' }], seed: 7 });
    const card = created.state.zones.hand[0];
    let response = svc.applyCommand(created.session_id, {
      command_id: 'log-choose', session_revision: 0, type: 'choose_action', payload: { card_instance_id: card.instance_id },
    });
    const challenge = response.state.pending_action;
    response = svc.applyCommand(created.session_id, {
      command_id: 'log-prepare', session_revision: 1, type: 'prepare_challenge',
      payload: { challenge_id: challenge.id, prepared: { challenge_id: challenge.id, prompt: challenge.request.prompt } },
    });
    response = svc.applyCommand(created.session_id, {
      command_id: 'log-start', session_revision: 2, type: 'start_challenge', payload: { challenge_id: challenge.id },
    });
    svc.applyCommand(created.session_id, {
      command_id: 'log-result', session_revision: 3, type: 'submit_challenge_result',
      payload: { challenge_id: challenge.id, result: { status: 'completed', score: 1, metrics: {}, provider_version: 'test', attempt_id: 'attempt-1' } },
    });
    expect(logger.info).toHaveBeenCalledWith('gaming.authority.challenge.resolved', expect.objectContaining({
      sessionId: created.session_id,
      gameId: 'scale-clash',
      userId: 'guest',
      challengeId: challenge.id,
      challengeKind: 'chord',
      score: 1,
      outcome: 'strong',
    }));
  });

  it('logs tactical enemy intent outcomes authoritatively', () => {
    const logger = { info: vi.fn() };
    const svc = service({ logger });
    const created = svc.createSession({ game_id: 'card-game', participants: [{ user_id: 'guest' }], seed: 7 });
    svc.applyCommand(created.session_id, {
      command_id: 'end-turn-1', session_revision: 0, type: 'end_turn', payload: {},
    });
    expect(logger.info).toHaveBeenCalledWith('gaming.authority.enemy.intent.resolved', expect.objectContaining({
      sessionId: created.session_id,
      intentId: 'baton-strike',
      intentKind: 'attack',
      amount: 4,
      damage: 4,
      blocked: 0,
    }));
  });

  it('applies only authored rematch upgrades', () => {
    const svc = service();
    const upgraded = svc.createSession({
      game_id: 'card-game', participants: [{ user_id: 'guest' }], seed: 7, setup: { upgrade_id: 'second-wind' },
    });
    expect(upgraded.state.player).toMatchObject({ health: 16, max_health: 16 });
    expect(upgraded.state.applied_upgrade).toEqual({ id: 'second-wind', title: 'Second Wind' });
    expect(() => svc.createSession({
      game_id: 'card-game', participants: [], setup: { upgrade_id: 'god-mode' },
    })).toThrow(/unavailable/);
  });

  it('deduplicates a retry and rejects stale new commands', () => {
    const svc = service();
    const created = svc.createSession({ game_id: 'scale-clash', participants: [{ user_id: 'guest' }], seed: 7 });
    const command = {
      command_id: 'command-1', session_revision: 0, type: 'choose_action',
      payload: { card_instance_id: created.state.zones.hand[0].instance_id },
    };
    svc.applyCommand(created.session_id, command);
    expect(svc.applyCommand(created.session_id, command).duplicate).toBe(true);
    expect(() => svc.applyCommand(created.session_id, { ...command, command_id: 'command-2' })).toThrow(/stale/);
  });
});
