import { diceRendererKind, rollDice } from '@shared-gaming/mechanics/dice.mjs';

export function commitDiceOutcome({ notation = '1d6', seed, webgl = true }) {
  const outcome = rollDice(notation, seed);
  return { outcome, animation: { renderer: diceRendererKind(outcome.sides, { webgl }), committed_total: outcome.total } };
}
