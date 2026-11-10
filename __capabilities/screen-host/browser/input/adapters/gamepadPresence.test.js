import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {acquireGamepadInputHost,gamepadPresence} from './GamepadAdapter.js';
let time,handle,pads,read;
beforeEach(()=>{
 time=1000;pads=[{index:1,id:'Pad',connected:true,buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0]}];
 vi.spyOn(performance,'now').mockImplementation(()=>time);vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 read=vi.fn(()=>pads);Object.defineProperty(navigator,'getGamepads',{configurable:true,value:read});
});
afterEach(()=>{handle?.release();handle=null;delete window.__emulatorCapturingGamepad;vi.restoreAllMocks();vi.unstubAllGlobals();});
it('reads fresh observed slots from the shared poller without another hardware poll',()=>{
 expect(gamepadPresence()).toEqual({fresh:false,slots:[]});handle=acquireGamepadInputHost({emit:vi.fn()});
 expect(gamepadPresence().fresh).toBe(false);handle.adapter._pollGamepad();const calls=read.mock.calls.length;
 expect(gamepadPresence()).toEqual({fresh:true,slots:['gamepad:1:Pad']});expect(read.mock.calls.length).toBe(calls);
 time+=1000;expect(gamepadPresence().fresh).toBe(false);
});
it('never treats hidden or emulator-captured frames as a fresh hardware observation',()=>{
 handle=acquireGamepadInputHost({emit:vi.fn()});handle.adapter._pollGamepad();
 window.__emulatorCapturingGamepad=true;time+=500;handle.adapter._pollGamepad();expect(gamepadPresence().fresh).toBe(false);
 delete window.__emulatorCapturingGamepad;Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
 handle.adapter._pollGamepad();expect(gamepadPresence().fresh).toBe(false);
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});time+=1100;expect(gamepadPresence().fresh).toBe(false);
 handle.adapter._pollGamepad();expect(gamepadPresence().fresh).toBe(true);
});
it('removes disconnected pads and accepts a reconnect at a new index only after a new observation',()=>{
 handle=acquireGamepadInputHost({emit:vi.fn()});handle.adapter._pollGamepad();
 window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'),{gamepad:pads[0]}));expect(gamepadPresence().slots).toEqual([]);
 pads=[{...pads[0],index:2}];handle.adapter._pollGamepad();expect(gamepadPresence().slots).toEqual(['gamepad:2:Pad']);
 pads[0].connected=false;handle.adapter._pollGamepad();expect(gamepadPresence().slots).toEqual([]);
});
