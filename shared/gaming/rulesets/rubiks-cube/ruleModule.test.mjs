import { describe, expect, it } from 'vitest';
import { rubiksCubeDefinition, rubiksCubeRuleModule } from './ruleModule.mjs';

describe('Rubik’s Cube RuleModule', () => {
  it('records authoritative turns and rejects an invalid command', () => {
    const initial = rubiksCubeRuleModule.createInitialState(rubiksCubeDefinition);
    const moved = rubiksCubeRuleModule.handleCommand(initial, { type: 'cube.turn', move: 'R' }, rubiksCubeDefinition, { logicalTime: 4 });
    expect(moved.state.history).toEqual([{ move: 'R', logical_time: 4 }]);
    expect(moved.events[0].event ?? moved.events[0]).toBeDefined();
    expect(rubiksCubeRuleModule.handleCommand(initial, { type: 'cube.turn', move: 'Q' }, rubiksCubeDefinition, { logicalTime: 5 }).error.code).toBe('invalid_move');
  });
});
