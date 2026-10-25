import { describe, it, expect } from 'vitest';
import { jeopardyRuleModule as rules } from './index.mjs';
const round = {mode:'turns',categories:[{title:'Test',clues:[{value:100,clue:'Question',answer:'Secret'}]}]};
const definition = {rounds:[round,round],final:{category:'Final',clue:'Final secret',answer:'Final answer'}};
const initial = (v=2) => rules.createInitialState(definition,{seats:[{id:'blue'},{id:'red'}],setup:v ? {jeopardy_flow_version:v}:{}});
const command = (state,type,more={},actorId='host') => rules.handleCommand(state,{type,...more},definition,{actorId});
const play = () => command(command(initial(),'START_ROUND').state,'SELECT_TILE').state;
describe('versioned family experience',()=>{
 it('holds an assigned answer for review, prevents double scoring, then offers a round decision',()=>{
   const before=play();
   const review=command(before,'JUDGE',{correct:true}).state;
   expect(review).toMatchObject({phase:'answer-review',revealed:true,scores:{blue:100,red:0}});
   expect(review.answerReview).toEqual({teamId:'blue',correct:true,scoreDelta:100,judgmentPending:false});
   expect(review.active).toEqual(before.active); expect(review.used).toEqual({});
   expect(command(review,'JUDGE',{correct:true}).error.code).toBe('illegal_command');
   expect(command(review,'TIMEOUT').error.code).toBe('illegal_command');
   const decision=command(review,'RETURN_TO_BOARD').state;
   expect(decision).toMatchObject({phase:'round-decision',roundIndex:0,answerReview:null});
   expect(command(decision,'START_ROUND').error.code).toBe('illegal_command');
   expect(command(decision,'CONTINUE_ROUND',{},'blue').error.code).toBe('authorization_denied');
   expect(command(decision,'CONTINUE_ROUND').state).toMatchObject({phase:'round-intro',roundIndex:1,scores:review.scores});
   const finished=command(decision,'FINISH_GAME').state;
   expect(finished).toMatchObject({phase:'done',status:'complete',scores:review.scores});
   const projected=rules.project(finished,definition,{role:'participant'}).state;
   expect(JSON.stringify(projected)).not.toContain('Final secret'); expect(JSON.stringify(projected)).not.toContain('Final answer');
 });
 it('retains the durable review and decision through snapshot serialization',()=>{
   const review=command(play(),'JUDGE',{correct:false}).state;
   const restored=JSON.parse(JSON.stringify(review));
   expect(command(restored,'JUDGE',{correct:true}).error.code).toBe('illegal_command');
   const decision=command(restored,'RETURN_TO_BOARD').state;
   expect(command(JSON.parse(JSON.stringify(decision)),'CONTINUE_ROUND').state.phase).toBe('round-intro');
 });
 it('keeps the normal Final path after continuing through round two',()=>{
   let state=command(command(play(),'JUDGE',{correct:true}).state,'RETURN_TO_BOARD').state;
   state=command(state,'CONTINUE_ROUND').state;
   state=command(command(state,'START_ROUND').state,'SELECT_TILE').state;
   state=command(command(state,'JUDGE',{correct:true}).state,'RETURN_TO_BOARD').state;
   expect(state.phase).toBe('final-category'); expect(state).not.toHaveProperty('skippedFinal');
 });
 it('requires the host for an explicit upgrade and rejects an already started board',()=>{
   expect(command(initial(null),'ENABLE_EXPERIENCE_V2',{},'blue').error.code).toBe('authorization_denied');
   expect(command(command(initial(null),'START_ROUND').state,'ENABLE_EXPERIENCE_V2').error.code).toBe('illegal_command');
 });
 it('never clears an assigned answerer on timeout',()=>expect(command(play(),'TIMEOUT').error.code).toBe('illegal_command'));
 it('keeps legacy journal behavior and state shape',()=>{
   const start=initial(null); expect(start).not.toHaveProperty('jeopardyFlowVersion');
   let state=command(command(start,'START_ROUND').state,'SELECT_TILE').state;
   state=command(state,'REVEAL').state;
   expect(command(state,'JUDGE',{correct:true}).state).toMatchObject({phase:'round-intro',roundIndex:1});
 });
 it('upgrades only untouched games or a fully completed first round at second intro',()=>{
   expect(command(initial(null),'ENABLE_EXPERIENCE_V2').state.jeopardyFlowVersion).toBe(2);
   const paused={...initial(null),roundIndex:1,used:{'0:0:0':true},scores:{blue:300,red:100}};
   expect(command(paused,'ENABLE_EXPERIENCE_V2').state).toMatchObject({phase:'round-decision',roundIndex:0,scores:paused.scores});
   expect(command({...paused,used:{...paused.used,'1:0:0':true}},'ENABLE_EXPERIENCE_V2').error.code).toBe('illegal_command');
 });
 it('only reopens hidden hosted attempts, and revealing ends attempts',()=>{
   const hosted={...play(),set:{...play().set,rounds:definition.rounds.map(r=>({...r,mode:'hosted'}))},answeringTeamId:'blue',phase:'judging'};
   const retry=command(hosted,'JUDGE',{correct:false}).state;
   expect(retry).toMatchObject({phase:'clue',answeringTeamId:null,revealed:false,attempted:['blue']});
   const revealed=command(hosted,'REVEAL').state;
   expect(revealed.answerReview).toMatchObject({teamId:'blue',judgmentPending:true,correct:null,scoreDelta:0});
   expect(command(revealed,'JUDGE',{correct:false}).state.phase).toBe('answer-review');
   const ended=command(retry,'REVEAL').state;
   expect(ended.phase).toBe('answer-review');
   expect(ended.answerReview).toEqual({teamId:null,correct:null,scoreDelta:0,judgmentPending:false});
   expect(command(ended,'BUZZ',{teamId:'red'}).error.code).toBe('illegal_command');
 });
});
