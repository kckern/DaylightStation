import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {HaStopActuator} from '../../../../__app_modules/household/supervision/server/adapters/HaStopActuator.mjs';
const fixtures=new URL('../../../_fixtures/supervision/ha/',import.meta.url);
function desired(latch){return execFileSync('python3',['-c',`import sys,json,yaml,jinja2
p=yaml.safe_load(open(sys.argv[1])); t=next(a['variables']['desired'] for a in p['actions'] if 'variables' in a)
s={'input_boolean.daylight_parental_stop':sys.argv[2],'input_boolean.garage_tv_power':'on','binary_sensor.garage_active':'on','switch.garage_speaker_plug':'off'}
print(jinja2.Template(t).render(is_state=lambda entity,value:s.get(entity)==value))`,new URL('garage_speaker_plug_enforcement.yaml',fixtures).pathname,latch],{encoding:'utf8'}).trim();}
function harness({stale=false,unavailable=false,latchAck=true}={}){
 let now=100000,latch='off',revision=0;const calls=[];
 const clock={now:()=>now},sleep=async ms=>{now+=ms;};
 const gateway={callService:async(domain,service,data)=>{calls.push({domain,service,data});if(service==='daylight_parental_stop' && latchAck){latch=data.active?'on':'off';revision=data.command_revision;}return {ok:true};},getState:async id=>id==='input_text.daylight_parental_stop_command'?{state:`${revision}:${latch}`}:id==='input_boolean.daylight_parental_stop'?{state:latch}:{state:unavailable?'unavailable':'off',lastReported:new Date(stale?1:now).toISOString()}};
 return {calls,clock,gateway,actuator:new HaStopActuator({gateway,clock,sleep,entities:['switch.speaker','binary_sensor.tv'],maxObservationAgeMs:5000})};
}
describe('parental HA latch and physical evidence',()=>{
 it('speaker_tick_cannot_reverse_stop_during_20_second_tv_debounce',()=>{expect(desired('on')).toBe('off');expect(desired('unavailable')).toBe('off');expect(desired('off')).toBe('on');});
 it('latched_stop_survives_ha_restart',()=>{const helper=readFileSync(new URL('daylight_parental_stop.yaml',fixtures),'utf8');expect(helper).toContain('daylight_parental_stop:');expect(helper).not.toMatch(/^\s*initial:/m);});
 it('confirms the latch before deactivation and requires two fresh off samples',async()=>{
  const h=harness();const result=await h.actuator.stop({commandRevision:2});expect(result).toMatchObject({blocked:true,detail:{verified:true}});expect(result.detail.samples).toHaveLength(2);expect(result.detail.samples[1].at-result.detail.samples[0].at).toBeGreaterThanOrEqual(2000);expect(h.calls[0].service).toBe('daylight_parental_stop');expect(h.calls.some(c=>c.service==='garage_deactivate')).toBe(true);
 });
 it('does not deactivate or falsely acknowledge when latch is unconfirmed',async()=>{const h=harness({latchAck:false});expect(await h.actuator.stop({commandRevision:2})).toMatchObject({blocked:false});expect(h.calls.some(c=>c.service==='garage_deactivate')).toBe(false);});
 it.each([{stale:true},{unavailable:true}])('stale_or_unavailable_power_never_verifies_off %j',async options=>{const h=harness(options);const result=await h.actuator.stop({commandRevision:2});expect(result).toMatchObject({blocked:true,detail:{verified:false}});expect(h.clock.now()).toBe(130000);});
 it('release only clears latch and never restarts power or content',async()=>{const h=harness();await h.actuator.stop({commandRevision:2});h.calls.length=0;expect(await h.actuator.release({commandRevision:3})).toMatchObject({blocked:false});expect(h.calls).toHaveLength(1);expect(h.calls[0]).toMatchObject({service:'daylight_parental_stop',data:{active:false,command_revision:3}});});
});
it('release waits for an earlier shutdown operation and cancels its retries',async()=>{
 let finish,announce;const started=new Promise(resolve=>{announce=resolve;});let now=100000,latch='off',revision=0;const calls=[];
 const gateway={callService:async(_domain,service,data)=>{calls.push(service);if(service==='daylight_parental_stop'){latch=data.active?'on':'off';revision=data.command_revision;}if(service==='garage_deactivate'){announce();await new Promise(resolve=>{finish=resolve;});}return {ok:true};},getState:async id=>({state:id==='input_text.daylight_parental_stop_command'?`${revision}:${latch}`:id==='input_boolean.daylight_parental_stop'?latch:'off',lastReported:new Date(now).toISOString()})};
 const actuator=new HaStopActuator({gateway,clock:{now:()=>now},sleep:async ms=>{now+=ms;},entities:['switch.speaker']});
 const stop=actuator.stop({commandRevision:2});await started;let released=false;const release=actuator.release({commandRevision:3}).then(()=>{released=true;});await Promise.resolve();await Promise.resolve();expect(released).toBe(false);
 finish();await stop;await release;expect(calls).toEqual(['daylight_parental_stop','garage_deactivate','daylight_parental_stop']);
});
