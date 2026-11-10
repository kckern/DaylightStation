import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {jeopardyRuleModule as rules} from './index.mjs';
const definition={rounds:[{mode:'hosted',penalize_wrong:false,categories:[{name:'Two',clues:[{value:100,clue:'First',answer:'A'},{value:200,clue:'Second',answer:'B'}]}]}]};
const initial=()=>rules.createInitialState(definition,{seats:[{id:'blue'},{id:'gold'}],setup:{jeopardy_flow_version:2,jeopardy_input_version:1}});
const ctx=s=>({phase:s.phase,roundIndex:s.roundIndex,cat:s.active?.cat??null,row:s.active?.row??null,attempt:s.attempted.length,answeringTeamId:s.answeringTeamId??null,turnTeamId:s.turnTeamId??null,finalWagerCount:Object.keys(s.finalWagers).length,finalJudgedCount:Object.keys(s.finalJudged).length});
const apply=(s,command,actorId='host')=>rules.handleCommand(s,command,definition,{actorId,revision:10,recordedAt:'2026-01-01T00:00:00Z'});
const clue=()=>({...initial(),inputProtocolVersion:1,phase:'clue',active:{cat:0,row:0,clue:definition.rounds[0].categories[0].clues[0]}});
it('persists input protocol only when requested in new setup',()=>{
 expect(initial().inputProtocolVersion).toBe(1);
 expect(rules.createInitialState(definition,{seats:[{id:'blue'}]})).not.toHaveProperty('inputProtocolVersion');
});
it('requires context for new-protocol gameplay',()=>{
 expect(apply(clue(),{type:'BUZZ',teamId:'gold'}).error?.code).toBe('command_context_required');
});
it('accepts a matching context and rejects a different question',()=>{
 const s=clue();expect(apply(s,{type:'BUZZ',teamId:'gold',expectedContext:ctx(s)}).state?.answeringTeamId).toBe('gold');
 expect(apply(s,{type:'BUZZ',teamId:'gold',expectedContext:{...ctx(s),row:1}}).error?.code).toBe('stale_command_context');
});
it('rejects stale attempt and answerer without changing score',()=>{
 const s={...clue(),attempted:['blue']};
 expect(apply(s,{type:'BUZZ',teamId:'gold',expectedContext:{...ctx(s),attempt:0}}).error?.code).toBe('stale_command_context');
 const judging={...clue(),phase:'judging',answeringTeamId:'gold'};
 expect(apply(judging,{type:'JUDGE',correct:true,expectedContext:{...ctx(judging),answeringTeamId:'blue'}}).error?.code).toBe('stale_command_context');
});
it('rejects old Final progress and old timer context',()=>{
 const final={...clue(),phase:'final-wager',finalWagers:{blue:100}};
 expect(apply(final,{type:'SET_FINAL_WAGER',teamId:'gold',amount:100,expectedContext:{...ctx(final),finalWagerCount:0}}).error?.code).toBe('stale_command_context');
 const next={...clue(),active:{cat:0,row:1,clue:definition.rounds[0].categories[0].clues[1]}};
 expect(apply(next,{type:'TIMEOUT',expectedContext:ctx(clue())}).error?.code).toBe('stale_command_context');
});
it('only the host can enable protocol at an idle boundary',()=>{
 const old={...clue(),inputProtocolVersion:undefined,phase:'board',active:null};delete old.inputProtocolVersion;
 expect(apply(old,{type:'ENABLE_RELIABLE_INPUT'}).state?.inputProtocolVersion).toBe(1);
 expect(apply(old,{type:'ENABLE_RELIABLE_INPUT'},'gold').error?.code).toBe('authorization_denied');
 const answering={...old,phase:'judging',active:clue().active,answeringTeamId:'gold'};
 expect(apply(answering,{type:'ENABLE_RELIABLE_INPUT'}).error?.code).toBe('illegal_command');
});
it('replays frozen v1/v2 initial state and every emitted event exactly',()=>{
 const fixtures=JSON.parse(fs.readFileSync(new URL('../../../../../tests/_fixtures/group-play/jeopardy-input-protocol/legacy.json',import.meta.url),'utf8'));
 for(const f of fixtures){let s=rules.createInitialState(f.definition,{seats:[{id:'blue'},{id:'gold'}],setup:f.setup});expect(s).toEqual(f.initial);
  for(const step of f.steps){const result=rules.handleCommand(s,step.command,f.definition,step.context);expect(result).toEqual(step.result);s=result.state;}}
});
it('keeps participant context valid while hiding other teams Final wager amounts',async()=>{
 const {commandContext}=await import('./commandContext.mjs');
 const s={...initial(),inputProtocolVersion:1,phase:'final-wager',finalWagers:{blue:100},answeringTeamId:null};
 const projected=rules.project(s,definition,{role:'participant',participant_id:'gold'}).state;
 expect(projected.finalWagers.blue).toBeNull();
 expect(commandContext(projected)).toEqual(commandContext(s));
 const result=apply(s,{type:'SET_FINAL_WAGER',teamId:'gold',amount:100,expectedContext:commandContext(projected)},'gold');
 expect(result.error).toBeUndefined();
});
it('keeps ordinary participant buzzer context valid despite masked empty wager slots',async()=>{
 const {commandContext}=await import('./commandContext.mjs');const s=clue();
 const projected=rules.project(s,definition,{role:'participant',participant_id:'gold'}).state;
 expect(apply(s,{type:'BUZZ',teamId:'gold',expectedContext:commandContext(projected)},'gold').error).toBeUndefined();
});
