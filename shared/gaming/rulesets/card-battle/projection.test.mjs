import { describe, expect, it } from 'vitest';
import { cardBattleFixture } from '../../testing/cardBattleFixture.mjs';
import { createInitialState } from './reducer.mjs';
import { projectState } from './projection.mjs';

describe('card battle participant projection', () => {
  it('exposes current play data without future deck content or unrelated mounted content', () => {
    const definition = structuredClone(cardBattleFixture);
    definition.unreleased_encounters = [{ id: 'secret-opponent', answer: 'secret' }];
    const state = createInitialState(definition, { seed: 7, participants: [{ id: 'player' }] });
    const projection = projectState(state, definition, 'player');
    const visible = new Set(state.zones.hand.map((entry) => entry.definition_id));
    expect(Object.keys(projection.definition.cards).sort()).toEqual([...visible].sort());
    expect(projection.definition).not.toHaveProperty('unreleased_encounters');
    expect(projection.definition.card_battle).not.toHaveProperty('deck');
    expect(projection.definition.card_battle.enemy).not.toHaveProperty('intents');
    expect(projection.state.enemy.intent).toEqual(state.enemy.intent);
    expect(projection.state.zones.deck.every((entry) => entry.definition_id === undefined)).toBe(true);
  });
});
