export const scaleClashDefinition = Object.freeze({
  schema_version: 1,
  game_id: 'scale-clash',
  title: 'Scale Clash',
  view_id: 'card-battle-v1',
  ruleset: 'card-battle-v1',
  players: { min: 1, max: 1 },
  card_battle: {
    opening_hand: 3,
    player: { health: 12, max_energy: 3 },
    enemy: { id: 'practice-golem', name: 'Practice Golem', health: 14, attack: 2 },
    deck: ['c-major-strike', 'f-major-strike', 'g-major-strike', 'a-minor-strike', 'c-major-strike'],
  },
  cards: {
    'c-major-strike': {
      title: 'C Major Strike', cost: 1, damage: 4,
      challenge: { domain: 'piano', kind: 'chord', prompt: { label: 'C', root: 0, pitch_classes: [0, 4, 7] } },
      outcomes: [{ id: 'strong', min_score: 1, multiplier: 1 }, { id: 'glance', min_score: 0, multiplier: 0.5 }],
    },
    'f-major-strike': {
      title: 'F Major Strike', cost: 1, damage: 4,
      challenge: { domain: 'piano', kind: 'chord', prompt: { label: 'F', root: 5, pitch_classes: [5, 9, 0] } },
      outcomes: [{ id: 'strong', min_score: 1, multiplier: 1 }, { id: 'glance', min_score: 0, multiplier: 0.5 }],
    },
    'g-major-strike': {
      title: 'G Major Strike', cost: 1, damage: 4,
      challenge: { domain: 'piano', kind: 'chord', prompt: { label: 'G', root: 7, pitch_classes: [7, 11, 2] } },
      outcomes: [{ id: 'strong', min_score: 1, multiplier: 1 }, { id: 'glance', min_score: 0, multiplier: 0.5 }],
    },
    'a-minor-strike': {
      title: 'A Minor Strike', cost: 1, damage: 4,
      challenge: { domain: 'piano', kind: 'chord', prompt: { label: 'Am', root: 9, pitch_classes: [9, 0, 4] } },
      outcomes: [{ id: 'strong', min_score: 1, multiplier: 1 }, { id: 'glance', min_score: 0, multiplier: 0.5 }],
    },
  },
});
