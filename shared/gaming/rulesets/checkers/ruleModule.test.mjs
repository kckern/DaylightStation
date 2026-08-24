import { describe, expect, it } from 'vitest';
import { checkersDefinition, checkersRuleModule } from './index.mjs';

describe('checkers RuleModule', () => {
  it('commits legal moves deterministically and rejects illegal commands', () => {
    const initial = checkersRuleModule.createInitialState(checkersDefinition);
    const first = checkersRuleModule.handleCommand(initial, { type: 'checkers.move', from: 20, to: 16 });
    const replay = checkersRuleModule.handleCommand(initial, { type: 'checkers.move', from: 20, to: 16 });
    expect(first).toEqual(replay); expect(first.state.moves).toEqual([{ from: 20, to: 16 }]);
    expect(checkersRuleModule.handleCommand(initial, { type: 'checkers.move', from: 0, to: 1 })).toMatchObject({ error: { code: 'illegal_move' } });
  });
});
