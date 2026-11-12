import { describe,it,expect } from 'vitest';
import { createSkylineControlState,reduceSkylineControl,describeSkylineControls } from './controllerModel.js';
const riders=[{id:'child',name:'Child',position:1,avatarSrc:'/child.jpg'},{id:'dad',name:'Dad'}];
const acts=[{id:'one',name:'One',status:'completed'},{id:'two',name:'Two',status:'open'}];
const start=()=>createSkylineControlState({riders,acts});
const event=(s,e)=>reduceSkylineControl(s,e).state;
const press=(s,position,gesture='single')=>event(s,{type:'PRESS',position,gesture});
describe('seated game lifecycle',()=>{
 it('does not start before course data arrives, even when physical buttons are pressed during loading',()=>{
  let s=createSkylineControlState({riders,acts:[]});
  s=press(s,1);s=press(s,4);
  expect(s.phase).toBe('flights');
  s=event(s,{type:'CONFIG_CHANGED',config:{acts}});
  expect(press(s,4).phase).toBe('ready');
 });
 it('uses direct identity, then visible navigation, then waits safely at zero',()=>{
  let s=press(start(),1);expect(s.phase).toBe('flights');expect(s.riderId).toBe('child');expect(s.actId).toBe('two');
  s=press(s,4);expect(s.phase).toBe('ready');
  s=event(s,{type:'TICK',dt:20,nowMs:1000,cadence:{rpm:0,connected:true,ts:1000}});
  expect(s.phase).toBe('ready');
 });
 it('qualifies fresh cadence for 1.2 seconds and counts down for three',()=>{
  let s=press(press(start(),1),4);
  const tick=dt=>s=event(s,{type:'TICK',dt,nowMs:1000,cadence:{rpm:30,connected:true,ts:1000}});
  tick(1.19);expect(s.phase).toBe('ready');tick(.01);expect(s.phase).toBe('countdown');
  tick(2.9);expect(s.phase).toBe('countdown');tick(.1);expect(s.phase).toBe('flight');
 });
 it('cancels readiness/countdown on stale transport or revoked access',()=>{
  let s=press(press(start(),1),4);
  s=event(s,{type:'TICK',dt:2,nowMs:5000,cadence:{rpm:65,connected:true,ts:0}});expect(s.phase).toBe('ready');
  s=event(s,{type:'ACCESS_CHANGED',allowed:false});expect(s.phase).toBe('denied');
 });
 it('offers parents through other riders and retains a fixed panel everywhere',()=>{
  let s=press(start(),4,'long');expect(s.phase).toBe('roster');s=press(s,2);s=press(s,4);expect(s.riderId).toBe('dad');
  for(const phase of ['identity','roster','flights','ready','countdown','flight','menu','stall','crash','result','saving','denied','save-details']){
   const controls=describeSkylineControls({...s,phase});expect(controls).toHaveLength(4);expect(controls.map(c=>c.position)).toEqual([1,2,3,4]);
  }
 });
 it('does not let the menu rescue a stall or consume boost',()=>{
  const flight={...press(start(),1),phase:'flight',weaponsEnabled:true};
  const menu=reduceSkylineControl(flight,{type:'PRESS',position:4,gesture:'long'});
  expect(menu.state.phase).toBe('menu');expect(menu.effects.some(e=>e.type==='combat')).toBe(false);
  expect(press({...flight,phase:'stall'},4,'long').phase).toBe('stall');
 });
 it('keeps the last completed flight and does not wrap final Next to level one',()=>{
  let s={...press(start(),1),phase:'result',actId:'two',saveStatus:'saved'};
  expect(describeSkylineControls(s)[1]).toMatchObject({label:'No next level yet',disabled:true});expect(press(s,2)).toMatchObject({phase:'result',actId:'two'});
  expect(press(s,1)).toMatchObject({phase:'ready',actId:'two',riderId:'child'});
 });
 it('gives every result button its own truthful label and never names a locked next level',()=>{
  const locked=[...acts,{id:'three',name:'Ember Caves',status:'locked'}];
  const labels=state=>describeSkylineControls(state).map(c=>`${c.label} ${c.hint}`);
  const s={...press(start(),1),acts:locked,phase:'result',actId:'two',saveStatus:'saved'};
  const shown=labels(s);
  expect(new Set(describeSkylineControls(s).map(c=>c.label)).size).toBe(4);
  expect(shown.join(' | ')).not.toMatch(/Ember Caves/);
  expect(describeSkylineControls(s)[1].disabled).toBe(true);
  expect(press(s,2)).toMatchObject({phase:'result',actId:'two'});
  const open={...s,acts:[...acts,{id:'three',name:'Ember Caves',status:'open'}]};
  const offered=describeSkylineControls(open);
  expect(offered[1]).toMatchObject({label:'Next level',hint:'Ember Caves',disabled:false});
  expect(new Set(offered.map(c=>c.label)).size).toBe(4);
  expect(press(open,2)).toMatchObject({phase:'ready',actId:'three'});
 });
 it('gates new attempts and rider changes behind saving the same terminal run',()=>{
  const s={...press(start(),1),phase:'result',saveStatus:'error'};
  const retry=reduceSkylineControl(s,{type:'PRESS',position:1});
  expect(retry.state.phase).toBe('saving');
  expect(retry.effects).toEqual([{type:'retry-save'},{type:'clear-input'}]);
  expect(press(s,4).riderId).toBe('child');
  expect(press(s,3).phase).toBe('save-details');
 });
 it('lets the rider leave once saving is given up, with the same choices as a saved result',()=>{
  const s={...press(start(),1),phase:'result',actId:'one',saveStatus:'unsaved'};
  const offered=describeSkylineControls(s);
  expect(offered.map(c=>c.label)).toEqual(['Replay','Next level','Flights','Change rider']);
  expect(offered.every(c=>!c.disabled)).toBe(true);
  expect(press(s,3).phase).toBe('flights');
  expect(press(s,1).phase).toBe('ready');
  expect(press(s,4).phase).toBe('identity');
  expect(event({...s,phase:'saving'},{type:'SAVE_CHANGED',status:'unsaved'}).phase).toBe('result');
 });
});

describe('sound settings sheet',()=>{
 const flying=()=>({...press(start(),1),phase:'flight',weaponsEnabled:true});
 it('opens from the flight menu on button 2 and steps the volume with the bike buttons',()=>{
  let s=press(flying(),4,'long');expect(s.phase).toBe('menu');
  expect(describeSkylineControls(s)[1]).toMatchObject({label:'Sound'});
  s=press(s,2);expect(s.phase).toBe('settings');
  expect(reduceSkylineControl(s,{type:'PRESS',position:1}).effects).toContainEqual(expect.objectContaining({type:'volume-step',delta:-10}));
  expect(reduceSkylineControl(s,{type:'PRESS',position:2}).effects).toContainEqual(expect.objectContaining({type:'volume-step',delta:10}));
  expect(reduceSkylineControl(s,{type:'PRESS',position:4}).effects).toContainEqual(expect.objectContaining({type:'toggle-sound'}));
  expect(press(s,3).phase).toBe('menu');
 });
 it('a touch on the more button mid-flight pauses into the sheet and Back lands on the flight menu',()=>{
  const r=reduceSkylineControl(flying(),{type:'OPEN_SETTINGS'});
  expect(r.state.phase).toBe('settings');expect(r.effects.map(e=>e.type)).toContain('pause');
  expect(press(r.state,3).phase).toBe('menu');
 });
 it('from a lobby screen the sheet returns to that screen; a countdown returns to ready',()=>{
  const flights=press(start(),1);
  expect(press(event(flights,{type:'OPEN_SETTINGS'}),3).phase).toBe('flights');
  const countdown={...flights,phase:'countdown',countdown:2};
  const back=press(event(countdown,{type:'OPEN_SETTINGS'}),3);
  expect(back).toMatchObject({phase:'ready',countdown:3,steady:0});
 });
 it('never opens over a committed stall or a save in progress',()=>{
  for(const phase of ['stall','saving'])expect(event({...flying(),phase},{type:'OPEN_SETTINGS'}).phase).toBe(phase);
 });
 it('labels the sheet buttons with the live level and mute state',()=>{
  let s=event(press(start(),1),{type:'OPEN_SETTINGS'});
  s=event(s,{type:'SOUND_CHANGED',level:60,muted:false});
  const c=describeSkylineControls(s);
  expect(c.map(x=>x.label)).toEqual(['Quieter','Louder','Back','Mute']);
  expect(c[0].hint).toMatch(/60/);
  s=event(s,{type:'SOUND_CHANGED',level:60,muted:true});
  expect(describeSkylineControls(s)[3].label).toBe('Unmute');
  expect(describeSkylineControls({...s,sound:{level:100,muted:false}})[1].disabled).toBe(true);
  expect(describeSkylineControls({...s,sound:{level:0,muted:true}})[0].disabled).toBe(true);
 });
});
