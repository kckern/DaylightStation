import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GamepadAdapter, restoreGamepadRoleBindings, clearGamepadRoleBindings } from '../../../../../__capabilities/screen-host/browser/input/adapters/GamepadAdapter.js';
import { BuzzerArbiter } from '../../../../../__app_modules/games/party-games/browser/interaction/BuzzerArbiter.js';

let clock, listeners, originalGetGamepads;
beforeEach(() => {
  clock = 1000; listeners = []; originalGetGamepads = navigator.getGamepads;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  listeners.forEach(listener => window.removeEventListener('gaming:interaction', listener));
  clearGamepadRoleBindings(); navigator.getGamepads = originalGetGamepads; vi.restoreAllMocks();
});
const MODEL = '8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)';
function setup(goldModel = MODEL) {
  const pad = (index,id) => ({index,id,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))});
  const blue = pad(1,MODEL), gold = pad(2,goldModel), inputs = [], wins = [];
  navigator.getGamepads = () => [blue,gold];
  const bindings = {[`gamepad:1:${MODEL}`]:'blue',[`gamepad:2:${goldModel}`]:'gold'};
  restoreGamepadRoleBindings(bindings);
  const arbiter = new BuzzerArbiter(); arbiter.restore({slotToTeam:bindings}); arbiter.arm(['gold']);
  const listener = event => {
    inputs.push(event.detail);
    if(event.detail.phase==='press') {
      const winner=arbiter.handleBuzz(`gamepad:${event.detail.controller_id}`);
      if(winner)wins.push(winner);
    }
  };
  listeners.push(listener); window.addEventListener('gaming:interaction',listener);
  const adapter=new GamepadAdapter({emit:vi.fn()}); adapter._pollGamepad();
  const button=(gamepad,index,down)=>{gamepad.buttons[index]={pressed:down,value:Number(down)};adapter._pollGamepad();};
  return {blue,gold,adapter,arbiter,inputs,wins,button};
}
it('eligible Gold receives A when ineligible Blue pressed A 20ms earlier on identical hardware', () => {
  const h=setup();h.button(h.blue,0,true);clock+=20;h.button(h.gold,0,true);
  expect(h.wins).toEqual(['gold']);
});
it('control: changing only the Gold model string allows the same physical sequence', () => {
  const h=setup('Different Pad Model');h.button(h.blue,0,true);clock+=20;h.button(h.gold,0,true);
  expect(h.wins).toEqual(['gold']);
});
it('control: same model and same button are accepted outside the 50ms window', () => {
  const h=setup();h.button(h.blue,0,true);clock+=60;h.button(h.gold,0,true);
  expect(h.wins).toEqual(['gold']);
});
it('control: different buttons on same-model controllers do not collide', () => {
  const h=setup();h.button(h.blue,0,true);clock+=20;h.button(h.gold,1,true);
  expect(h.wins).toEqual(['gold']);
});
it('eligible Gold is not lost when both same-model pads are observed pressed in one frame', () => {
  const h=setup();h.blue.buttons[0]={pressed:true,value:1};h.gold.buttons[0]={pressed:true,value:1};h.adapter._pollGamepad();
  expect(h.wins).toEqual(['gold']);
});
it('a release from one bound controller never suppresses the other controller release', () => {
  const h=setup();h.button(h.blue,0,true);clock+=60;h.button(h.gold,0,true);
  clock+=100;h.button(h.blue,0,false);clock+=20;h.button(h.gold,0,false);
  expect(h.inputs.filter(i=>i.controller_id.startsWith('2:')&&i.phase==='release')).toHaveLength(1);
});

it('bound controller independence also holds with Gold polled before Blue', () => {
  const h=setup();navigator.getGamepads=()=>[h.gold,h.blue];
  h.button(h.gold,0,true);clock+=20;h.button(h.blue,0,true);
  expect(h.wins).toEqual(['gold']);
  expect(h.inputs.filter(i=>i.phase==='press').map(i=>i.controller_id.split(':')[0])).toEqual(['2','1']);
});
it('accepts a fresh bound press just after a window opens even after an early press less than 50ms ago',()=>{
 const h=setup();h.arbiter.disarm();h.button(h.gold,0,true);clock+=10;h.button(h.gold,0,false);
 h.arbiter.arm(['gold']);clock+=10;h.button(h.gold,0,true);
 expect(h.wins).toEqual(['gold']);
});
