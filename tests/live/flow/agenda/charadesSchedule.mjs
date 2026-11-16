import assert from 'node:assert/strict';

/** Validate every scheduled clue against its performer's selected mode. */
export function assertCharadesSchedule(session, modes) {
 const turns=session.state.turn_order;
 const presentations=session.state.clue_presentations;
 const perTurn=session.definition.clues_per_turn;
 assert.ok(Number.isSafeInteger(perTurn) && perTurn > 0, 'clues_per_turn must be positive');
 assert.ok(Array.isArray(turns) && turns.length > 0, 'turn order must not be empty');
 assert.deepEqual(new Set(turns),new Set(modes.keys()),'all selected participants must have turns');
 assert.ok(Array.isArray(presentations), 'clue presentations must be present');
 assert.equal(presentations.length,turns.length * perTurn,'every scheduled clue must have a presentation');
 for (let index=0;index<presentations.length;index++) {
  const turn=turns[Math.floor(index / perTurn)];
  assert.equal(presentations[index],modes.get(turn),`clue ${index} must use its performer mode`);
 }
}
