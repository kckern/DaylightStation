import { defineRuleModule } from '../../kernel/index.mjs';
import { parseDiceNotation, rollDice } from '../../mechanics/dice.mjs';

function validateDiceDefinition(definition) {
  const errors = [];
  if (typeof definition?.default_notation !== 'string') errors.push('default_notation is required');
  else try { parseDiceNotation(definition.default_notation); } catch (error) { errors.push(error.message); }
  if (definition?.presets != null && (!Array.isArray(definition.presets) || definition.presets.some((notation) => {
    try { parseDiceNotation(notation); return false; } catch { return true; }
  }))) errors.push('presets must contain valid dice notation');
  return { valid: errors.length === 0, errors };
}

export const diceRuleModule = defineRuleModule({
  id: 'dice', version: 1,
  validateDefinition: validateDiceDefinition,
  createInitialState: (definition) => ({ status: 'active', roll_count: 0, notation: definition.default_notation, outcome: null }),
  handleCommand(state, command, _definition, context) {
    if (command.type !== 'dice.roll') return { error: { code: 'illegal_command', message: `${command.type} cannot change a dice session` } };
    const notation = command.notation || state.notation;
    let outcome;
    try { outcome = rollDice(notation, (context.seed ^ Math.imul(state.roll_count + 1, 0x9e3779b1)) >>> 0); }
    catch (error) { return { error: { code: 'invalid_dice_notation', message: error.message } }; }
    return { state: { ...state, roll_count: state.roll_count + 1, notation, outcome }, events: [{ type: 'dice.outcome.committed', outcome }] };
  },
  project: (state, definition) => ({ state: structuredClone(state), definition: structuredClone(definition), interaction: { can_roll: true } }),
});
