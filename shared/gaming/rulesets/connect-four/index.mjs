import { defineRuleModule } from '../../kernel/index.mjs';
import { playColumn, replayGame } from './engine.mjs';

export const connectFourDefinition = Object.freeze({ id: 'connect-four-standard', columns: 7, rows: 6, connect: 4 });

export const connectFourRuleModule = defineRuleModule({
  id: 'connect-four', version: 1,
  validateDefinition: (definition) => ({ valid: definition?.columns === 7 && definition?.rows === 6 && definition?.connect === 4, errors: definition?.columns === 7 && definition?.rows === 6 && definition?.connect === 4 ? [] : ['Only the standard 7x6 connect-four definition is supported'] }),
  createInitialState: () => ({ ...replayGame({ moves: [] }), lifecycle_status: 'active' }),
  handleCommand(state, command) {
    if (command.type !== 'connect-four.play') return { error: { code: 'illegal_command', message: `${command.type} is not a connect-four command` } };
    const next = playColumn({ moves: state.moves }, command.column);
    if (next.error) return { error: { code: next.error, message: `Column ${command.column} cannot be played` } };
    const status = next.status.gameOver ? 'complete' : 'active';
    return { state: { ...next, lifecycle_status: status }, status, events: [{ type: 'connect-four.disc-dropped', column: command.column, row: next.lastMove.row, player: next.lastMove.player }, ...(next.status.gameOver ? [{ type: 'connect-four.completed', winner: next.status.winner, draw: next.status.draw }] : [])] };
  },
  project: (state) => ({ state: structuredClone(state), interaction: { legal_columns: state.board?.[0]?.flatMap((cell, column) => cell == null ? [column] : []) || [] } }),
});

export * from './engine.mjs';
export * from './opponent.mjs';
