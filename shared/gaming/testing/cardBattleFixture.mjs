/** Generic test-only definition. Production definitions are mounted artifacts. */
export const cardBattleFixture = Object.freeze({
  schema_version: 1,
  game_id: 'fixture-card-battle',
  title: 'Fixture Card Battle',
  view_id: 'card-battle-v1',
  ruleset: 'card-battle-v1',
  rule_module: { id: 'card-battle', version: 1 },
  players: { min: 1, max: 1 },
  card_battle: {
    opening_hand: 3,
    player: { health: 12, max_energy: 3 },
    enemy: { id: 'target', name: 'Target', health: 14, attack: 2 },
    deck: ['action-a', 'action-b', 'action-c', 'action-d', 'action-a'],
  },
  cards: {
    'action-a': {
      title: 'Action A', cost: 1, damage: 4,
      challenge: { domain: 'test', kind: 'recall', requirements: { set: 'a' } },
      outcomes: [{ id: 'full', min_score: 1, multiplier: 1 }, { id: 'partial', min_score: 0, multiplier: 0.5 }],
    },
    'action-b': {
      title: 'Action B', cost: 1, damage: 4,
      challenge: { domain: 'test', kind: 'recall', requirements: { set: 'b' } },
      outcomes: [{ id: 'full', min_score: 1, multiplier: 1 }, { id: 'partial', min_score: 0, multiplier: 0.5 }],
    },
    'action-c': {
      title: 'Action C', cost: 1, damage: 4,
      challenge: { domain: 'test', kind: 'recall', requirements: { set: 'c' } },
      outcomes: [{ id: 'full', min_score: 1, multiplier: 1 }, { id: 'partial', min_score: 0, multiplier: 0.5 }],
    },
    'action-d': {
      title: 'Action D', cost: 1, damage: 4,
      challenge: { domain: 'test', kind: 'recall', requirements: { set: 'd' } },
      outcomes: [{ id: 'full', min_score: 1, multiplier: 1 }, { id: 'partial', min_score: 0, multiplier: 0.5 }],
    },
  },
});
