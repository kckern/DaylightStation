import { deriveInteraction } from './reducer.mjs';

export function projectState(state, definition, viewerId = null) {
  const projectedState = structuredClone(state);
  projectedState.zones.deck = projectedState.zones.deck.map((instance) => ({ instance_id: instance.instance_id }));
  const visibleCardIds = new Set([
    ...state.zones.hand,
    ...state.zones.discard,
    ...(state.pending_action ? [{ definition_id: state.pending_action.card_definition_id }] : []),
  ].map((instance) => instance.definition_id));
  const cards = Object.fromEntries([...visibleCardIds].filter((id) => definition.cards[id]).map((id) => [id, structuredClone(definition.cards[id])]));
  const visibleEnemy = structuredClone(definition.card_battle.enemy);
  delete visibleEnemy.intents;
  const publicDefinition = {
    schema_version: definition.schema_version,
    game_id: definition.game_id,
    title: definition.title,
    presentation: structuredClone(definition.presentation || {}),
    card_battle: {
      turn_mode: definition.card_battle.turn_mode,
      opening_hand: definition.card_battle.opening_hand,
      hand_size: definition.card_battle.hand_size,
      player: structuredClone(definition.card_battle.player),
      enemy: structuredClone(visibleEnemy),
      upgrades: structuredClone(definition.card_battle.upgrades || []),
    },
    cards,
  };
  return {
    state: projectedState,
    definition: publicDefinition,
    interaction: deriveInteraction(state, definition, viewerId),
  };
}
