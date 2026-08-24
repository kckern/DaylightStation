import { describe, expect, it } from 'vitest';
import { selectorRuleModule } from './index.mjs';

const definition = { id: 'fixture-selector', maximum_candidates: 100 };

describe('selector ruleset', () => {
  it('selects deterministically from environment-provided candidates', () => {
    const state = selectorRuleModule.createInitialState(definition, { setup: { candidates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } });
    const first = selectorRuleModule.handleCommand(state, { type: 'selector.pick', candidate_ids: ['a', 'c'] }, definition, { seed: 8 });
    const replay = selectorRuleModule.handleCommand(state, { type: 'selector.pick', candidate_ids: ['a', 'c'] }, definition, { seed: 8 });
    expect(first.state.selected).toEqual(replay.state.selected); expect(['a', 'c']).toContain(first.state.selected.id);
    expect(selectorRuleModule.handleCommand(state, { type: 'selector.pick', candidate_ids: ['missing'] }, definition, { seed: 8 })).toMatchObject({ error: { code: 'no_selection_candidates' } });
  });
});
