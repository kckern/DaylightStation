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

function service({ logger = null, clock = () => new Date('2026-08-09T12:00:00.000Z'), pendingTimeoutMs, idleTimeoutMs } = {}) {
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
    clock,
    logger,
    pendingTimeoutMs,
    idleTimeoutMs,
  });
}

function resolveCard(svc, session, card, score, prefix) {
  let response = svc.applyCommand(session.session_id, {
    command_id: `${prefix}-choose`, session_revision: 0, type: 'choose_action',
    payload: { card_instance_id: card.instance_id },
  });
  const challenge = response.state.pending_action;
  response = svc.applyCommand(session.session_id, {
    command_id: `${prefix}-prepare`, session_revision: 1, type: 'prepare_challenge',
    payload: { challenge_id: challenge.id, prepared: { challenge_id: challenge.id, prompt: { label: 'C major scale' } } },
  });
  response = svc.applyCommand(session.session_id, {
    command_id: `${prefix}-start`, session_revision: 2, type: 'start_challenge',
    payload: { challenge_id: challenge.id },
  });
  return svc.applyCommand(session.session_id, {
    command_id: `${prefix}-result`, session_revision: 3, type: 'submit_challenge_result',
    payload: {
      challenge_id: challenge.id,
      result: { status: 'completed', score, metrics: {}, provider_version: 'test', attempt_id: `${prefix}-attempt` },
    },
  });
}

describe('GamingSessionService', () => {
  it('loads the Card Game from YAML and requests semantic scale challenges', () => {
    const svc = service();
    const loaded = svc.getDefinition('card-game');
    expect(loaded.definition.title).toBe('Scale Stadium');
    expect(loaded.definition.presentation).toMatchObject({ theme: 'pokemon-tcg', data_source: 'PokeAPI' });
    expect(loaded.definition.card_battle.player.pokemon).toMatchObject({
      id: 25,
      dex: '0025',
      name: 'Pikachu',
      types: ['electric'],
      stats: { hp: 35, attack: 55, defense: 40, sp_attack: 50, sp_defense: 50, speed: 90 },
      assets: { svg: 'games/pokemon/svg/0025-pikachu-gen1.svg' },
    });
    expect(loaded.definition.card_battle.enemy.pokemon).toMatchObject({
      id: 7,
      dex: '0007',
      name: 'Squirtle',
      types: ['water'],
      stats: { hp: 44, attack: 48, defense: 65, sp_attack: 50, sp_defense: 64, speed: 43 },
      assets: { svg: 'games/pokemon/svg/0007-squirtle-gen1.svg' },
    });
    expect(Object.values(loaded.definition.cards).every((card) => card.challenge.kind === 'scale')).toBe(true);
    expect(new Set(Object.values(loaded.definition.cards).map((card) => card.type))).toEqual(new Set(['attack', 'guard', 'focus']));
    expect(Object.values(loaded.definition.cards).every((card) => !/major|scale/i.test(card.title))).toBe(true);
    expect(loaded.definition.card_battle.challenge_pools).toBeUndefined();
    expect(JSON.stringify(loaded.definition)).not.toMatch(/expected_midi|\babc\b/i);
    const created = svc.createSession({ game_id: 'card-game', participants: [{ user_id: 'guest' }], seed: 7 });
    const card = created.state.zones.hand[0];
    const chosen = svc.applyCommand(created.session_id, {
      command_id: 'scale-1', session_revision: 0, type: 'choose_action', payload: { card_instance_id: card.instance_id },
    });
    expect(chosen.state.pending_action.request).toMatchObject({ domain: 'piano', kind: 'scale' });
    expect(chosen.state.pending_action.request).toMatchObject({
      requirements: { curriculum: 'foundation-major-scales' },
      timeout_ms: 90000,
    });
    expect(chosen.state.pending_action.request.prompt).toBeUndefined();
    expect(chosen.state.pending_action.request.context.challenge_pool).toBeNull();
    expect(chosen.state.pending_action.request.context.challenge_sequence).toEqual(expect.any(Number));
    expect(loaded.definition.cards[card.definition_id].challenge.prompt).toBeUndefined();
  });

  it('keeps domain-specific challenge requirements opaque to Gaming', () => {
    const definition = structuredClone(service().getDefinition('card-game').definition);
    definition.cards['thunder-shock'].challenge.requirements = {
      curriculum: 'a-piano-owned-policy',
      future_piano_constraint: { arbitrary: true },
    };
    expect(validateDefinition(definition)).toMatchObject({ valid: true, errors: [] });
  });

  it('turns fluent and recovered piano performances into different Pokémon move power', () => {
    const fluentService = service();
    const fluent = fluentService.createSession({
      game_id: 'card-game', participants: [{ user_id: 'guest' }], seed: 2,
    });
    const fluentCard = fluent.state.zones.hand.find((card) => card.definition_id === 'thunder-shock');
    const fluentResult = resolveCard(fluentService, fluent, fluentCard, 1, 'fluent');
    expect(fluentResult.events).toContainEqual(expect.objectContaining({
      type: 'challenge_resolved', outcome: 'super-effective', score: 1,
    }));
    expect(fluentResult.events).toContainEqual({ type: 'damage_dealt', target: 'enemy', amount: 9, attempted: 9 });

    const recoveredService = service();
    const recovered = recoveredService.createSession({
      game_id: 'card-game', participants: [{ user_id: 'guest' }], seed: 2,
    });
    const recoveredCard = recovered.state.zones.hand.find((card) => card.definition_id === 'thunder-shock');
    const recoveredResult = resolveCard(recoveredService, recovered, recoveredCard, 0.5, 'recovered');
    expect(recoveredResult.events).toContainEqual(expect.objectContaining({
      type: 'challenge_resolved', outcome: 'recovered-hit', score: 0.5,
    }));
    expect(recoveredResult.events).toContainEqual({ type: 'damage_dealt', target: 'enemy', amount: 5, attempted: 5 });
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
      intentId: 'water-gun',
      intentKind: 'attack',
      amount: 8,
      damage: 8,
      blocked: 0,
    }));
  });

  it('applies only authored rematch upgrades', () => {
    const svc = service();
    const upgraded = svc.createSession({
      game_id: 'card-game', participants: [{ user_id: 'guest' }], seed: 7, setup: { upgrade_id: 'oran-berry' },
    });
    expect(upgraded.state.player).toMatchObject({ health: 41, max_health: 41 });
    expect(upgraded.state.applied_upgrade).toEqual({ id: 'oran-berry', title: 'Oran Berry' });
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

  it('recovers stale challenges and eventually abandons idle sessions', () => {
    let now = new Date('2026-08-09T12:00:00.000Z');
    const svc = service({ clock: () => now, pendingTimeoutMs: 1000, idleTimeoutMs: 5000 });
    const created = svc.createSession({ game_id: 'scale-clash', participants: [{ user_id: 'guest' }], seed: 7 });
    const card = created.state.zones.hand[0];
    svc.applyCommand(created.session_id, {
      command_id: 'stale-choose', session_revision: 0, type: 'choose_action', payload: { card_instance_id: card.instance_id },
    });

    now = new Date('2026-08-09T12:00:02.000Z');
    expect(svc.recoverStaleSessions()).toEqual([{ session_id: created.session_id, type: 'abort_pending_action' }]);
    expect(svc.getSession(created.session_id).state.pending_action).toBeNull();

    now = new Date('2026-08-09T12:00:08.000Z');
    expect(svc.recoverStaleSessions()).toEqual([{ session_id: created.session_id, type: 'abandon_session' }]);
    expect(svc.getSession(created.session_id)).toMatchObject({ status: 'abandoned' });
  });
});
