import { describe, expect, it } from 'vitest';
import { chessDefinition, chessRuleModule } from './ruleModule.mjs';

describe('chess RuleModule', () => {
  it('commits deterministic moves and takebacks', () => {
    const initial = chessRuleModule.createInitialState(chessDefinition);
    const context = { logicalTime: 10, revision: 0 };
    const first = chessRuleModule.handleCommand(initial, { type: 'chess.move', from: 'e2', to: 'e4' }, chessDefinition, context);
    const replay = chessRuleModule.handleCommand(initial, { type: 'chess.move', from: 'e2', to: 'e4' }, chessDefinition, context);
    expect(first).toEqual(replay);
    expect(first.state.history[0]).toMatchObject({ from: 'e2', to: 'e4', san: 'e4' });
    const rewound = chessRuleModule.handleCommand(first.state, { type: 'chess.takeback', plies: 1 }, chessDefinition, { logicalTime: 11, revision: 1 });
    expect(rewound.state.game.fen).toBe(initial.game.fen);
    expect(rewound.state.undone_history).toHaveLength(1);
  });

  it('fails closed for illegal moves and invalid definitions', () => {
    expect(chessRuleModule.validateDefinition({ variant: 'giveaway', initial_fen: 'bad' }).valid).toBe(false);
    const initial = chessRuleModule.createInitialState(chessDefinition);
    expect(chessRuleModule.handleCommand(initial, { type: 'chess.move', from: 'e2', to: 'e5' }, chessDefinition, { logicalTime: 1, revision: 0 }))
      .toMatchObject({ error: { code: 'illegal_move' } });
  });
});
