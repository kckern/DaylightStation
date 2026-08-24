import { defineRuleModule } from '../../kernel/index.mjs';
import { INITIAL_FEN, createGame, describeGame, playMove, undoMove } from './engine.mjs';

export const chessDefinition = Object.freeze({
  id: 'chess-standard',
  variant: 'standard',
  initial_fen: INITIAL_FEN,
});

export function validateChessDefinition(definition) {
  const errors = [];
  if (definition?.variant !== 'standard') errors.push('variant must be standard');
  try { createGame({ fen: definition?.initial_fen || INITIAL_FEN }); } catch { errors.push('initial_fen is invalid'); }
  return { valid: errors.length === 0, errors };
}

export const chessRuleModule = defineRuleModule({
  id: 'chess',
  version: 1,
  validateDefinition: validateChessDefinition,
  createInitialState(definition) {
    const game = createGame({ fen: definition.initial_fen || INITIAL_FEN });
    return {
      status: 'active',
      game,
      initial_fen: game.fen,
      last_move: null,
      history: [],
      undone_history: [],
      position: describeGame(game),
    };
  },
  handleCommand(state, command, _definition, context) {
    if (state.status === 'complete') return { error: { code: 'session_terminal', message: 'Chess game is complete' } };
    if (command.type === 'chess.move') {
      const result = playMove(state.game, { from: command.from, to: command.to, promotion: command.promotion || 'q' });
      if (result.error) return { error: { code: 'illegal_move', message: `Chess move ${command.from}-${command.to} is illegal` } };
      const position = describeGame(result.game);
      const entry = {
        from: result.move.from,
        to: result.move.to,
        san: result.move.san,
        color: result.move.color,
        captured: result.move.captured || null,
        promotion: result.move.promotion || null,
        logical_time: context.logicalTime,
      };
      const status = position.game_over ? 'complete' : 'active';
      return {
        status,
        state: { ...state, status, game: result.game, position, last_move: { from: entry.from, to: entry.to }, history: [...state.history, entry] },
        events: [{ type: 'chess.move.committed', move: entry, position }],
      };
    }
    if (command.type === 'chess.takeback') {
      const plies = command.plies ?? 1;
      if (!Number.isInteger(plies) || plies < 1 || plies > state.history.length) return { error: { code: 'invalid_takeback', message: 'Takeback plies are invalid' } };
      let game = state.game;
      for (let index = 0; index < plies; index += 1) game = undoMove(game);
      const undone = state.history.slice(-plies);
      const history = state.history.slice(0, -plies);
      const position = describeGame(game);
      return {
        state: {
          ...state,
          status: 'active',
          game,
          position,
          history,
          last_move: history.length ? { from: history.at(-1).from, to: history.at(-1).to } : null,
          undone_history: [...state.undone_history, ...undone.map((entry) => ({ ...entry, undone_at_revision: context.revision + 1 }))],
        },
        status: 'active',
        events: [{ type: 'chess.takeback.committed', plies, undone }],
      };
    }
    return { error: { code: 'illegal_command', message: `${command.type} is not a chess command` } };
  },
  project(state) {
    return {
      state: structuredClone(state),
      interaction: {
        turn: state.position.turn,
        game_over: state.position.game_over,
      },
    };
  },
});
