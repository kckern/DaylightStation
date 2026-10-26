import React,{useState} from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {renderHook,act,cleanup} from '@testing-library/react';
import {useBuzzerSetup} from './useBuzzerSetup.js';
import {jeopardyRuleModule as rules} from '../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
import {sendJeopardyCommand} from './jeopardyClient.js';
import {fetchSession} from '../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
vi.mock('./jeopardyClient.js',()=>({sendJeopardyCommand:vi.fn()}));
vi.mock('../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js',()=>({fetchSession:vi.fn()}));
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));vi.clearAllMocks();});
afterEach(()=>{cleanup();vi.useRealTimers();});
const definition={title:'Ready',rounds:[{mode:'hosted',categories:[{name:'One',clues:[{value:200,clue:'Q',answer:'A'}]}]}]};
async function fixture(){
 let current=rules.createInitialState(definition,{seats:[{id:'blue'},{id:'gold'}]});let revision=0,listener=()=>{};
 current.buzzerSetup={epoch:'old',seenAt:Date.now(),teams:{blue:{slot:'gamepad:0:Pad',generation:0,connected:true,tested:true},gold:{slot:'gamepad:1:Pad',generation:0,connected:true,tested:true}}};
 const logger={info:vi.fn(),warn:vi.fn()},audio={play:vi.fn()},hardware={fresh:true,slots:['gamepad:0:Pad','gamepad:1:Pad']};
 const buzzers={subscribeInput:fn=>{listener=fn;return()=>{};},restore:vi.fn(),capture:()=>()=>{},presence:()=>hardware};
 const view=renderHook(()=>{const [state,setState]=useState(current);const [sessionId,setSessionId]=useState('ready');useBuzzerSetup({sessionId,state,revision,buzzers,audio,logger,acceptSession:s=>setState(s.state)});return{state,setState,setSessionId};});
 sendJeopardyCommand.mockImplementation(async(_id,command)=>{const result=rules.handleCommand(current,command,definition,{actorId:'host',logicalTime:Date.now()});if(result.error)throw Object.assign(new Error(result.error.message),result.error);current=result.state;revision++;return{header:{revision},state:current};});
 fetchSession.mockImplementation(async()=>({header:{revision},state:current}));
 await act(async()=>{});
 const press=async(controller_id,phase='press')=>act(async()=>listener({controller_id,action:'button.a',phase,source:'gamepad'}));
 await press('0:Pad');await press('1:Pad');
 const phase=async phase=>act(async()=>{current={...current,phase};view.result.current.setState(current);});
 return{view,phase,press,logger,audio,hardware,get current(){return current;}};
}
it('renews only in Ready, without resetting epoch or generation across game phases',async()=>{
 const f=await fixture(),epoch=f.current.buzzerSetup.epoch,generation=f.current.buzzerSetup.teams.gold.generation;
 for(const phase of ['board','clue','judging','answer-review','wager','round-decision','final-wager','final-clue','final-judging']){
  await f.phase(phase);sendJeopardyCommand.mockClear();await act(async()=>vi.advanceTimersByTimeAsync(120000));
  expect(sendJeopardyCommand.mock.calls.filter(([,c])=>c.type==='BUZZER_PRESENCE')).toHaveLength(0);
 }
 expect(f.current.buzzerSetup.epoch).toBe(epoch);expect(f.current.buzzerSetup.teams.gold.generation).toBe(generation);
 sendJeopardyCommand.mockClear();await f.phase('round-intro');expect(sendJeopardyCommand.mock.calls.filter(([,c])=>c.type==='BUZZER_PRESENCE')).toHaveLength(1);
 await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(sendJeopardyCommand.mock.calls.filter(([,c])=>c.type==='BUZZER_PRESENCE')).toHaveLength(3);
});
it('does not renew stale hardware and requires retest for a missing assigned pad',async()=>{
 const f=await fixture();await f.phase('board');f.hardware.fresh=false;sendJeopardyCommand.mockClear();await f.phase('round-intro');
 await act(async()=>vi.advanceTimersByTimeAsync(20000));expect(sendJeopardyCommand.mock.calls.filter(([,c])=>c.type==='BUZZER_PRESENCE')).toHaveLength(0);
 f.hardware.fresh=true;f.hardware.slots=['gamepad:0:Pad'];await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(f.current.buzzerSetup.teams.gold).toMatchObject({connected:false,tested:false});
 expect(f.logger.info.mock.calls.some(([event,data])=>event==='jeopardy.buzzer.ready-state'&&data.blockers.includes('hardware-stale'))).toBe(true);
});
it('keeps disconnect reconciliation alive during gameplay and never overwrites it with presence',async()=>{
 const f=await fixture();await f.phase('board');const normal=sendJeopardyCommand.getMockImplementation();let fail=true;
 sendJeopardyCommand.mockImplementation((id,c,o)=>{if(c.kind==='disconnect'&&fail)throw new Error('offline');return normal(id,c,o);});
 fetchSession.mockRejectedValue(new Error('offline'));
 await act(async()=>window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'),{gamepad:{index:1,id:'Pad'}})));
 await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(f.current.buzzerSetup.teams.gold.connected).toBe(true);
 fail=false;await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(f.current.buzzerSetup.teams.gold.connected).toBe(false);
 expect(sendJeopardyCommand.mock.calls.filter(([,c])=>c.type==='BUZZER_PRESENCE')).toHaveLength(0);
});
it('logs assignment/test acknowledgements and bounded input suppression without spam audio',async()=>{
 const f=await fixture();const before=f.audio.play.mock.calls.length;
 for(let n=0;n<50;n++){await f.press('1:Pad','release');await f.press('1:Pad');}
 expect(f.audio.play.mock.calls).toHaveLength(before);
 const reports=f.logger.info.mock.calls.filter(([event,data])=>event==='jeopardy.buzzer.report-result'&&data.kind==='test');expect(reports.length).toBeGreaterThan(0);
 expect(reports[0][1]).toMatchObject({sessionId:'ready',kind:'test',result:'accepted',commandId:expect.any(String),elapsedMs:expect.any(Number)});
 const suppressed=f.logger.info.mock.calls.filter(([event])=>event==='jeopardy.buzzer.input-suppressed');expect(suppressed.length).toBeGreaterThan(0);expect(suppressed.length).toBeLessThan(10);
});

it('starts the next session setup even when the prior session has an unresolved renewal',async()=>{
 const f=await fixture();await f.phase('board');const normal=sendJeopardyCommand.getMockImplementation();
 sendJeopardyCommand.mockImplementation((id,c,o)=>c.type==='BUZZER_PRESENCE'?new Promise(()=>{}):normal(id,c,o));
 await f.phase('round-intro');
 await act(async()=>f.view.result.current.setSessionId('next-ready'));
 expect(sendJeopardyCommand.mock.calls.some(([id,c])=>id==='next-ready'&&c.type==='BUZZER_SETUP')).toBe(true);
});
