import { defineRuleModule } from '../../kernel/index.mjs';
import { applyMove, createGame } from './engine.mjs';

export const checkersDefinition = Object.freeze({ id: 'checkers-american-8x8', board_size: 8, playable_squares: 32 });

export const checkersRuleModule = defineRuleModule({
  id: 'checkers', version: 1,
  validateDefinition: (definition) => ({ valid: definition?.board_size === 8 && definition?.playable_squares === 32, errors: definition?.board_size === 8 && definition?.playable_squares === 32 ? [] : ['American checkers requires an 8x8 board with 32 playable squares'] }),
  createInitialState: () => ({ ...createGame(), lifecycle_status: 'active' }),
  handleCommand(state, command) {
    if (command.type !== 'checkers.move') return { error: { code: 'illegal_command', message: `${command.type} is not a checkers command` } };
    const next = applyMove(state, { from: command.from, to: command.to });
    if (next.error) return { error: { code: next.error, message: `Checkers move ${command.from}-${command.to} is illegal` } };
    const status = next.status.gameOver ? 'complete' : 'active';
    return { state: { ...next, lifecycle_status: status }, status, events: [{ type: 'checkers.move.committed', move: next.lastMove, outcome: next.status.outcome }] };
  },
  project: (state) => ({ state: structuredClone(state), interaction: { turn: state.turn, forced_from: state.forcedFrom } }),
});

export * from './engine.mjs';
export * from './opponent.mjs';
