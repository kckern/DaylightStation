import { defineRuleModule } from '../../kernel/index.mjs';
import { applyMove, createCube, cubeFaces, isSolved, normalizeMove } from './engine.mjs';

export const rubiksCubeDefinition = Object.freeze({ id: 'rubiks-cube-standard', size: 3, color_scheme: 'white-up-green-front' });

export const rubiksCubeRuleModule = defineRuleModule({
  id: 'rubiks-cube',
  version: 1,
  validateDefinition(definition) {
    const valid = definition?.size === 3 && definition?.color_scheme === 'white-up-green-front';
    return { valid, errors: valid ? [] : ['Rubik’s Cube definition must describe the standard 3×3 colour scheme'] };
  },
  createInitialState() {
    const cube = createCube(); return { status: 'active', cube, history: [], solved: isSolved(cube) };
  },
  handleCommand(state, command, _definition, context) {
    if (command?.type === 'cube.turn') {
      const move = normalizeMove(command.move); const cube = move && applyMove(state.cube, move);
      if (!cube) return { error: { code: 'invalid_move', message: 'Cube move must be standard Singmaster notation' } };
      const entry = { move, logical_time: context.logicalTime };
      return { state: { ...state, cube, solved: isSolved(cube), history: [...state.history, entry] }, events: [{ type: 'cube.turn.committed', move: entry, solved: isSolved(cube) }] };
    }
    if (command?.type === 'cube.reset') {
      const cube = createCube(); return { state: { status: 'active', cube, history: [], solved: true }, events: [{ type: 'cube.reset.committed' }] };
    }
    return { error: { code: 'illegal_command', message: `${command?.type || 'Unknown'} is not a cube command` } };
  },
  project(state) { return { state: structuredClone(state), interaction: { solved: state.solved, faces: cubeFaces(state.cube) } }; },
});
