import fs from 'node:fs';
import {describe,it,expect} from 'vitest';
import {jeopardyScoringPolicy} from './scoringPolicy.mjs';
import {jeopardyRuleModule as rules,validateGameSet,validateJeopardyDefinition} from './index.mjs';
const round=(multiplier=1,policy=true)=>({mode:'turns',multiplier,penalize_wrong:false,...(policy===undefined?{}:{daily_double_penalize_wrong:policy}),categories:[{name:'Risk',clues:[{value:300,clue:'Double question',answer:'Double answer',daily_double:true},{value:200,clue:'Ordinary question',answer:'Ordinary answer'}]}]});
const definition=policy=>({id:'risk',title:'Wagers',rounds:[round(1,policy),round(2,policy)],final:{category:'Final',clue:'Final question',answer:'Final answer'}});
const run=(state,command,def)=>rules.handleCommand(state,command,def,{actorId:'host',revision:1,recordedAt:'2026-10-25T00:00:00Z'});
function answering({score=0,roundIndex=0,policy=true,ordinary=false}={}){
 const def=definition(policy);let state=rules.createInitialState(def,{seats:[{id:'blue'},{id:'gold'}],setup:{jeopardy_flow_version:2}});
 state={...state,phase:'board',roundIndex,scores:{blue:score,gold:0}};
 state=run(state,{type:'SELECT_AT',cat:0,row:ordinary?1:0},def).state;
 if(!ordinary)state=run(state,{type:'SET_WAGER',amount:300},def).state;
 return{state,def};
}
it('selects DD risk independently of ordinary penalties, retaining legacy inheritance',()=>{
 expect(jeopardyScoringPolicy({penalize_wrong:false,daily_double_penalize_wrong:true})).toEqual({ordinaryWrongDeducts:false,dailyDoubleWrongDeducts:true,finalWrongDeducts:true});
 expect(jeopardyScoringPolicy({penalize_wrong:false}).dailyDoubleWrongDeducts).toBe(false);
 expect(jeopardyScoringPolicy({penalize_wrong:true}).dailyDoubleWrongDeducts).toBe(true);
 expect(jeopardyScoringPolicy({penalize_wrong:true,daily_double_penalize_wrong:false}).dailyDoubleWrongDeducts).toBe(false);
});
it.each([0,-100,500])('awards/loses the actual wager from starting score %s in either round',score=>{
 for(const roundIndex of [0,1])for(const correct of [true,false]){
  const {state,def}=answering({score,roundIndex}),result=run(state,{type:'JUDGE',correct},def);
  expect(result.error).toBeUndefined();expect(result.state.scores.blue-score).toBe(correct?300:-300);
  expect(result.state.answerReview.scoreDelta).toBe(correct?300:-300);expect(result.state.phase).toBe('answer-review');
  expect(run(result.state,{type:'BUZZ',teamId:'gold'},def).error?.code).toBe('illegal_command');
  expect(run(result.state,{type:'RETURN_TO_BOARD'},def).state.phase).toBe('board');
 }
});
it('keeps ordinary wrong answers at zero and permits the eligible opponent steal',()=>{
 const {state,def}=answering({ordinary:true});state.set.rounds[0].mode='hosted';
 const wrong=run({...state,phase:'judging',answeringTeamId:'blue'}, {type:'JUDGE',correct:false},def);
 expect(wrong.state.scores.blue).toBe(0);expect(wrong.state.phase).toBe('clue');expect(wrong.state.attempted).toContain('blue');
 expect(run(wrong.state,{type:'BUZZ',teamId:'gold'},def).state.answeringTeamId).toBe('gold');
});
it('retains authoritative wager bounds',()=>{
 const {state,def}=answering();const wager={...state,phase:'wager',wager:0};
 for(const amount of [-1,0,4,301,1.5])expect(run(wager,{type:'SET_WAGER',amount},def).error?.code).toBe('invalid_wager');
 expect(run(wager,{type:'SET_WAGER',amount:5},def).state.wager).toBe(5);
});
it.each([true,false])('Final still adds or deducts the wager: %s',correct=>{
 const {state,def}=answering();const final={...state,phase:'final-judging',finalWagers:{blue:300,gold:100},finalJudged:{}};
 expect(run(final,{type:'JUDGE_FINAL',teamId:'blue',correct},def).state.scores.blue).toBe(correct?300:-300);
});
it('validates explicit metadata and leaves the absent normalized field absent',()=>{
 const old=definition();for(const r of old.rounds)delete r.daily_double_penalize_wrong;
 expect(validateGameSet(old).set.rounds[0]).not.toHaveProperty('daily_double_penalize_wrong');
 const current=definition(true);expect(validateGameSet(current).set.rounds.every(r=>r.daily_double_penalize_wrong===true)).toBe(true);
 for(const value of [null,'true',1]){current.rounds[0].daily_double_penalize_wrong=value;expect(validateGameSet(current).valid).toBe(false);expect(validateJeopardyDefinition(current).valid).toBe(false);}
});
it('replays frozen pre-policy DD state, scoring and events exactly for v1/v2',()=>{
 const fixtures=JSON.parse(fs.readFileSync(new URL('../../../../../tests/_fixtures/group-play/jeopardy-input-protocol/legacy-daily-double.json',import.meta.url),'utf8'));
 for(const fixture of fixtures){let state=rules.createInitialState(fixture.definition,{seats:[{id:'blue'},{id:'gold'}],setup:fixture.setup});expect(state).toEqual(fixture.initial);
  for(const step of fixture.steps){const result=rules.handleCommand(state,step.command,fixture.definition,step.context);expect(result).toEqual(step.result);state=result.state;}
  expect(state.scores.blue).toBe(0);
 }
});
