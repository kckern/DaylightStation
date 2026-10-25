import { describe, expect, it } from 'vitest';
import { jeopardyRuleModule } from "./index.mjs";

const definition = {
  title: 'Fixture',
  rounds: [{ name: 'Round', mode: 'hosted', multiplier: 1, categories: [{ name: 'Category', clues: [{ value: 100, clue: 'Prompt', answer: 'Answer' }] }] }],
  final: { category: 'Final', clue: 'Final prompt', answer: 'Final answer' },
};

function readyState(definition, options) {
  let state = jeopardyRuleModule.createInitialState(definition, options);
  const apply = action => { state = jeopardyRuleModule.handleCommand(state, action, definition, { actorId: 'host', logicalTime: 0 }).state; };
  apply({ type: 'BUZZER_SETUP', epoch: 'test' });
  state.teamIds.forEach((teamId, index) => {
    const report = { type: 'BUZZER_REPORT', epoch: 'test', teamId, generation: 0, slot: `gamepad:${index}:Pad` };
    apply({ ...report, kind: 'assign' }); apply({ ...report, kind: 'test' });
  });
  return state;
}
describe('Jeopardy semantic authority' , () => {
  it('reserves board and judgment commands for the host', () => {
    const state = readyState(definition, { seats: [{ id: 'red', members: [{ id: 'red-player' }] }, { id: 'blue', members: [{ id: 'blue-player' }] }] });
    expect(jeopardyRuleModule.handleCommand(state, { type: 'START_ROUND' }, definition, { actorId: 'red-player' }).error.code).toBe('authorization_denied');
    expect(jeopardyRuleModule.handleCommand(state, { type: 'START_ROUND' }, definition, { actorId: 'host' }).state.phase).toBe('board');
  });

  it('allows a participant to act only for their bound team', () => {
    let state = readyState(definition, { seats: [{ id: 'red', members: [{ id: 'red-player' }] }, { id: 'blue', members: [{ id: 'blue-player' }] }] });
    state = jeopardyRuleModule.handleCommand(state, { type: 'START_ROUND' }, definition, { actorId: 'host' }).state;
    state = jeopardyRuleModule.handleCommand(state, { type: 'SELECT_TILE' }, definition, { actorId: 'host' }).state;
    expect(jeopardyRuleModule.handleCommand(state, { type: 'BUZZ', teamId: 'blue' }, definition, { actorId: 'red-player' }).error.code).toBe('authorization_denied');
    expect(jeopardyRuleModule.handleCommand(state, { type: 'BUZZ', teamId: 'red' }, definition, { actorId: 'red-player' }).state.answeringTeamId).toBe('red');
  });

  it('validates wagers in the authoritative ruleset', () => {
    const state = {
      ...readyState(definition, { seats: [{ id: 'red', members: [{ id: 'red-player' }] }] }),
      phase: 'wager', answeringTeamId: 'red', scores: { red: 50 },
    };
    expect(jeopardyRuleModule.handleCommand(state, { type: 'SET_WAGER', amount: 1000 }, definition, { actorId: 'red-player' }).error.code).toBe('invalid_wager');
    expect(jeopardyRuleModule.handleCommand(state, { type: 'SET_WAGER', amount: 100 }, definition, { actorId: 'red-player' }).state.wager).toBe(100);
  });

  it('normalizes an omitted round multiplier before values reach state or scoring', () => {
    const withoutMultiplier = {
      ...definition,
      rounds: definition.rounds.map(({ multiplier: _multiplier, ...round }) => round),
    };
    let state = readyState(withoutMultiplier, { seats: [{ id: 'red', members: [{ id: 'red-player' }] }] });
    expect(state.set.rounds[0].multiplier).toBe(1);
    state = jeopardyRuleModule.handleCommand(state, { type: 'START_ROUND' }, withoutMultiplier, { actorId: 'host' }).state;
    state = jeopardyRuleModule.handleCommand(state, { type: 'SELECT_TILE' }, withoutMultiplier, { actorId: 'host' }).state;
    state = jeopardyRuleModule.handleCommand(state, { type: 'BUZZ', teamId: 'red' }, withoutMultiplier, { actorId: 'red-player' }).state;
    state = jeopardyRuleModule.handleCommand(state, { type: 'JUDGE', correct: true }, withoutMultiplier, { actorId: 'host' }).state;
    expect(state.scores.red).toBe(100);
  });
});

it('never applies a Final score twice when another team is still pending',()=>{
 const initial=readyState(definition,{seats:[{id:'blue',members:[]},{id:'gold',members:[]}]});
 const state={...initial,phase:'final-judging',finalWagers:{blue:100,gold:100}};
 const action={type:'JUDGE_FINAL',teamId:'blue',correct:true};
 const first=jeopardyRuleModule.handleCommand(state,action,definition,{actorId:'host'});
 expect(first.state.scores.blue).toBe(100);
 const duplicate=jeopardyRuleModule.handleCommand(first.state,action,definition,{actorId:'host'});
 expect(duplicate.error?.code).toBe('illegal_command');
 expect(first.state.scores.blue).toBe(100);
});
it('keeps a locked Final wager unchanged on a repeated team submission',()=>{
 const initial=readyState(definition,{seats:[{id:'blue',members:[]},{id:'gold',members:[]}]});
 const state={...initial,phase:'final-wager',finalWagers:{blue:100}};
 const duplicate=jeopardyRuleModule.handleCommand(state,{type:'SET_FINAL_WAGER',teamId:'blue',amount:50},definition,{actorId:'host'});
 expect(duplicate.error?.code).toBe('illegal_command');
 expect(state.finalWagers.blue).toBe(100);
});
