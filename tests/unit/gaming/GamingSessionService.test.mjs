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
  let sequence = 0;
  return new GamingSessionService({
    definitionStore,
    sessionStore,
    idFactory: () => `game_${String(++sequence).padStart(8, '0')}`,
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

function addCompletedRun(svc, {
  id, userId, displayName, score, completedAt, partnerId = 'bulbasaur', attemptScore = 0.9,
}) {
  const kinds = ['scale', 'chord', 'arpeggio', 'timed-pattern', 'scale', 'chord'];
  const practiceAttempts = kinds.map((kind, index) => ({
    kind, status: 'completed', score: attemptScore, first_pass: true,
    attempt_id: `${id}-attempt-${index}`,
  }));
  svc.sessionStore.create({
    session_id: id,
    game_id: 'card-game',
    status: 'complete',
    participants: [{ user_id: userId, display_name: displayName }],
    completed_at: completedAt,
    state: {
      status: 'complete',
      partner_id: partnerId,
      completed_encounters: ['pidgey', 'meowth', 'snorlax'],
      practice_attempts: practiceAttempts,
      journey_summary: {
        qualified: true,
        score,
        score_version: 1,
        journey_version: 1,
      },
    },
  });
}

describe('GamingSessionService', () => {
  it('loads the Pokémon journey from YAML and requests all four semantic piano skills', () => {
    const svc = service();
    const loaded = svc.getDefinition('card-game');
    expect(loaded.definition.title).toBe('Scale Stadium');
    expect(loaded.definition).toMatchObject({
      ruleset: 'pokemon-practice-journey-v1',
      view_id: 'pokemon-practice-journey-v1',
      presentation: { theme: 'pokemon-stadium', data_source: 'PokeAPI' },
    });
    expect(loaded.definition.journey.partners.map((partner) => partner.id)).toEqual([
      'bulbasaur', 'charmander', 'squirtle',
    ]);
    expect(loaded.definition.journey.opponents.map((opponent) => opponent.id)).toEqual([
      'pidgey', 'meowth', 'snorlax',
    ]);
    expect(new Set(Object.values(loaded.definition.cards).map((card) => card.challenge.kind))).toEqual(
      new Set(['scale', 'chord', 'arpeggio', 'timed-pattern']),
    );
    expect(JSON.stringify(loaded.definition)).not.toMatch(/expected_midi|\babc\b/i);
    const created = svc.createSession({
      game_id: 'card-game', participants: [{ user_id: 'kid-1' }], seed: 7,
      setup: { partner_id: 'bulbasaur' },
    });
    expect(created.state.zones.hand.map((card) => card.definition_id)).toEqual([
      'vine-whip', 'growl', 'growth', 'razor-leaf',
    ]);
    const scale = created.state.zones.hand[0];
    const chosen = svc.applyCommand(created.session_id, {
      command_id: 'scale-1', session_revision: 0, type: 'choose_action', payload: { card_instance_id: scale.instance_id },
    });
    expect(chosen.state.pending_action.request).toMatchObject({
      domain: 'piano', kind: 'scale',
      requirements: { curriculum: 'pokemon-journey-foundations' },
      timeout_ms: 90000,
    });
    expect(chosen.state.pending_action.request.prompt).toBeUndefined();
    expect(chosen.state.pending_action.request.context.challenge_sequence).toEqual(expect.any(Number));
    expect(loaded.definition.cards[scale.definition_id].challenge.prompt).toBeUndefined();
  });

  it('keeps domain-specific challenge requirements opaque to Gaming', () => {
    const definition = structuredClone(service().getDefinition('card-game').definition);
    definition.cards['vine-whip'].challenge.requirements = {
      curriculum: 'a-piano-owned-policy',
      future_piano_constraint: { arbitrary: true },
    };
    expect(validateDefinition(definition)).toMatchObject({ valid: true, errors: [] });
  });

  it('turns piano accuracy directly into direct, partial, and missed hits', () => {
    const cases = [
      { score: 0.8, outcome: 'direct-hit', damage: 44 },
      { score: 0.6, outcome: 'partial-hit', damage: 29 },
      { score: 0.4, outcome: 'miss', damage: 11 },
    ];
    for (const testCase of cases) {
      const svc = service();
      const created = svc.createSession({
        game_id: 'card-game', participants: [{ user_id: 'kid-1' }], seed: 2,
        setup: { partner_id: 'bulbasaur' },
      });
      const card = created.state.zones.hand.find((candidate) => candidate.definition_id === 'vine-whip');
      const result = resolveCard(svc, created, card, testCase.score, testCase.outcome);
      expect(result.events).toContainEqual(expect.objectContaining({
        type: 'challenge_resolved', outcome: testCase.outcome, score: testCase.score,
      }));
      expect(result.events).toContainEqual(expect.objectContaining({
        type: 'damage_dealt', target: 'enemy', amount: testCase.damage,
      }));
    }
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

  it('logs journey enemy intent outcomes authoritatively', () => {
    const logger = { info: vi.fn() };
    const svc = service({ logger });
    const created = svc.createSession({
      game_id: 'card-game', participants: [{ user_id: 'kid-1' }], seed: 7,
      setup: { partner_id: 'bulbasaur' },
    });
    resolveCard(svc, created, created.state.zones.hand[0], 0.4, 'miss');
    expect(logger.info).toHaveBeenCalledWith('gaming.authority.enemy.intent.resolved', expect.objectContaining({
      sessionId: created.session_id,
      intentId: expect.any(String),
      intentKind: expect.any(String),
      amount: expect.any(Number),
    }));
  });

  it('requires an authored partner and preserves it in the run state', () => {
    const svc = service();
    const created = svc.createSession({
      game_id: 'card-game', participants: [{ user_id: 'kid-1' }], seed: 7,
      setup: { partner_id: 'squirtle' },
    });
    expect(created.state).toMatchObject({ partner_id: 'squirtle', player: { name: 'Squirtle' } });
    expect(() => svc.createSession({
      game_id: 'card-game', participants: [], setup: { partner_id: 'missingno' },
    })).toThrow(/Choose an available Pokémon partner/);
  });

  it('persists mastery and ranks each sibling by their best version-compatible run', () => {
    const svc = service({ clock: () => new Date('2026-08-09T12:00:00.000Z') });
    addCompletedRun(svc, {
      id: 'game_kidold01', userId: 'kid-1', displayName: 'Alex', score: 9000,
      completedAt: '2026-08-01T18:00:00.000Z',
    });
    addCompletedRun(svc, {
      id: 'game_kidweek1', userId: 'kid-1', displayName: 'Alex', score: 8500,
      completedAt: '2026-08-08T18:00:00.000Z',
    });
    addCompletedRun(svc, {
      id: 'game_kidweek2', userId: 'kid-1', displayName: 'Alex', score: 8100,
      completedAt: '2026-08-09T10:00:00.000Z',
    });
    addCompletedRun(svc, {
      id: 'game_sisweek1', userId: 'kid-2', displayName: 'Maya', score: 8700,
      completedAt: '2026-08-07T18:00:00.000Z', partnerId: 'charmander',
    });

    const progress = svc.getProgress('card-game', 'kid-1');
    expect(progress).toMatchObject({
      persistent: true,
      journeys_completed: 3,
      personal_best: { score: 9000, partner_id: 'bulbasaur' },
      partners: { bulbasaur: { journeys_completed: 3, evolved: true } },
    });
    expect(progress.skill_stars.scale.stars).toBe(3);

    const leaderboard = svc.getLeaderboard('card-game', 'kid-1');
    expect(leaderboard.standings.map((entry) => [entry.display_name, entry.score])).toEqual([
      ['Maya', 8700],
      ['Alex', 8500],
    ]);
    expect(leaderboard.standings[1]).toMatchObject({ attempt_count: 2, rank: 2 });
    expect(leaderboard).toMatchObject({
      alltime: { display_name: 'Alex', score: 9000 },
      viewer_personal_best: { score: 9000 },
      rival: { display_name: 'Maya', score: 8700 },
    });
    expect(svc.getProgress('card-game', 'guest')).toMatchObject({ persistent: false, personal_best: null });
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
