import { describe,it,expect } from 'vitest';
import { createSkylineControlState,reduceSkylineControl,describeSkylineControls } from './controllerModel.js';
const riders=[{id:'child',name:'Child',position:1,avatarSrc:'/child.jpg'},{id:'dad',name:'Dad'}];
const acts=[{id:'one',name:'One',status:'completed'},{id:'two',name:'Two',status:'open'}];
const start=()=>createSkylineControlState({riders,acts});
const event=(s,e)=>reduceSkylineControl(s,e).state;
const press=(s,position,gesture='single')=>event(s,{type:'PRESS',position,gesture});
describe('seated game lifecycle',()=>{
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
  expect(describeSkylineControls(s)[1].label).toBe('Flights');expect(press(s,2).phase).toBe('flights');
  expect(press(s,1)).toMatchObject({phase:'ready',actId:'two',riderId:'child'});
 });
 it('gates new attempts and rider changes behind saving the same terminal run',()=>{
  const s={...press(start(),1),phase:'result',saveStatus:'error'};
  const retry=reduceSkylineControl(s,{type:'PRESS',position:1});
  expect(retry.state.phase).toBe('saving');
  expect(retry.effects).toEqual([{type:'retry-save'},{type:'clear-input'}]);
  expect(press(s,4).riderId).toBe('child');
  expect(press(s,3).phase).toBe('save-details');
 });
});
