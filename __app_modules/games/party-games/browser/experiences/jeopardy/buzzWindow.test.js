import {it,expect} from 'vitest';
import {buzzWindow} from './buzzWindow.js';
const state={phase:'clue',roundIndex:0,set:{rounds:[{mode:'hosted'}]},active:{cat:1,row:2,clue:{}},teamIds:['blue','gold'],attempted:[],scores:{blue:0,gold:0},turnTeamId:'blue',answeringTeamId:null,revealed:false};
it('keeps one window through a hundred heartbeat snapshots',()=>{
 const first=buzzWindow(state,true);for(let seenAt=0;seenAt<100;seenAt++)expect(buzzWindow({...state,buzzerSetup:{seenAt}},true).key).toBe(first.key);
});
it('rearms only remaining teams after a wrong answer',()=>{
 const next=buzzWindow({...state,attempted:['blue']},true);
 expect(next.key).not.toBe(buzzWindow(state,true).key);expect(next.eligibleTeamIds).toEqual(['gold']);
});
it.each([{isDailyDouble:true},{active:{...state.active,clue:{little_kids:true}}},{revealed:true},{answeringTeamId:'blue'},{phase:'judging'}])('keeps exclusive/closed questions disarmed: %j',change=>expect(buzzWindow({...state,...change},true)).toBeNull());
it('does not open during tile acknowledgement',()=>expect(buzzWindow(state,false)).toBeNull());
