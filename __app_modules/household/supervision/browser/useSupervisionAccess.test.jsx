import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {act,renderHook} from '@testing-library/react';
import {useSupervisionAccess} from './useSupervisionAccess.js';
import {publishLocalStop,clearLocalStop} from './localStop.js';
const context={deviceId:'portal',activityId:'school:workspace'};
const permit={allowed:true,epoch:0,issuedAt:100000,expiresAt:105000};
let event;
const subscribe=handler=>{event=handler;return ()=>{event=null;};};
const apiFor=getPermit=>async path=>path.includes('/bootstrap')?{enabled:true,deviceId:'portal'}:getPermit();
beforeEach(()=>{vi.useFakeTimers();localStorage.clear();});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();clearLocalStop();localStorage.clear();});
async function settle(){await act(async()=>{await Promise.resolve();await Promise.resolve();});}
describe('bounded canonical kiosk access',()=>{
 it('initial_load_and_fetch_error_are_blocked',async()=>{
  const api=apiFor(async()=>{throw Error('offline');});
  const {result}=renderHook(()=>useSupervisionAccess({...context,api,subscribe}));
  expect(result.current.allowed).toBe(false);await settle();expect(result.current.allowed).toBe(false);
 });
 it('missed_event_or_tab_resume_cannot_extend_5000ms_lease',async()=>{
  let fail=false;
  const api=apiFor(async()=>{if(fail)throw Error('offline');return permit;});
  const {result}=renderHook(()=>useSupervisionAccess({...context,api,subscribe}));
  await settle();expect(result.current.allowed).toBe(true);fail=true;
  await act(async()=>{await vi.advanceTimersByTimeAsync(5001);});expect(result.current.allowed).toBe(false);
  fail=false;await act(async()=>{window.dispatchEvent(new Event('focus'));});await settle();expect(result.current.allowed).toBe(true);
  fail=true;
  await act(async()=>{event({kind:'EntitlementDecisionChanged',payload:{capabilityId:'supervision.interactive',subject:{kind:'device',id:'portal'},to:{decision:'denied'}}});});
  expect(result.current.allowed).toBe(false);
 });
 it('a local stop survives remount and cannot be cleared by an old permit or event',async()=>{
  let response=permit;
  const opts={...context,api:apiFor(async()=>response),subscribe};
  const first=renderHook(()=>useSupervisionAccess(opts));await settle();expect(first.result.current.allowed).toBe(true);
  act(()=>publishLocalStop({epoch:1}));expect(first.result.current.allowed).toBe(false);first.unmount();
  const second=renderHook(()=>useSupervisionAccess(opts));await settle();expect(second.result.current.allowed).toBe(false);
  response={...permit,epoch:1};await act(async()=>{await second.result.current.refresh();});expect(second.result.current.allowed).toBe(true);
 });
 it('a delayed pre-stop response cannot regrant access after invalidation',async()=>{
  let resolveOld,calls=0;
  const api=apiFor(()=>++calls===1?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve({...permit,allowed:false,epoch:1}));
  const {result}=renderHook(()=>useSupervisionAccess({...context,api,subscribe}));await settle();
  act(()=>publishLocalStop({epoch:1}));resolveOld(permit);await settle();expect(result.current.allowed).toBe(false);
 });
});

it('unavailable browser storage does not invent a stop, but a real local stop survives remount',async()=>{
 vi.stubGlobal('localStorage',{getItem(){throw Error('storage disabled');},setItem(){throw Error('storage disabled');},removeItem(){},clear(){}});
 const options={...context,api:apiFor(async()=>permit),subscribe};
 const first=renderHook(()=>useSupervisionAccess(options));await settle();expect(first.result.current.allowed).toBe(true);
 act(()=>publishLocalStop({epoch:1}));first.unmount();
 const second=renderHook(()=>useSupervisionAccess(options));await settle();expect(second.result.current.allowed).toBe(false);
});

it('unrelated school and fitness gate events cannot interrupt an allowed activity',async()=>{
 const api=apiFor(async()=>permit);const {result}=renderHook(()=>useSupervisionAccess({...context,api,subscribe}));await settle();expect(result.current.allowed).toBe(true);
 act(()=>event({topic:'state-gates',kind:'EntitlementDecisionChanged',payload:{capabilityId:'piano.games',subject:{kind:'learner',id:'user_5'},to:{decision:'granted'}}}));
 expect(result.current.allowed).toBe(true);
});

it('refreshing a granted supervision observation does not tear down an allowed activity',async()=>{
 let pending=false;const api=apiFor(()=>pending?new Promise(()=>{}):Promise.resolve(permit));
 const {result}=renderHook(()=>useSupervisionAccess({...context,api,subscribe}));await settle();expect(result.current.allowed).toBe(true);pending=true;
 act(()=>event({kind:'EntitlementDecisionChanged',payload:{capabilityId:'supervision.interactive',subject:{kind:'device',id:'portal'},to:{decision:'granted'}}}));
 expect(result.current.allowed).toBe(true);
});
it('a grant event cannot open a blocked screen when the canonical query fails',async()=>{
 const api=apiFor(async()=>{throw Error('offline');});const {result}=renderHook(()=>useSupervisionAccess({...context,api,subscribe}));await settle();
 act(()=>event({kind:'EntitlementDecisionChanged',payload:{capabilityId:'supervision.interactive',subject:{kind:'device',id:'portal'},to:{decision:'granted'}}}));
 await settle();expect(result.current.allowed).toBe(false);
});
it('an explicitly never-configured feature preserves existing offline behavior',async()=>{
 let offline=false;const api=async()=>{if(offline)throw Error('offline');return {enabled:false};};
 const {result}=renderHook(()=>useSupervisionAccess({...context,api,subscribe}));await settle();expect(result.current.allowed).toBe(true);offline=true;
 await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(result.current.allowed).toBe(true);
});
it('a denial for a different State Gates period cannot revoke this kiosk permit',async()=>{
 const api=apiFor(async()=>permit);const {result}=renderHook(()=>useSupervisionAccess({...context,api,subscribe}));await settle();
 act(()=>event({kind:'EntitlementDecisionChanged',payload:{capabilityId:'supervision.interactive',subject:{kind:'device',id:'portal'},period:{kind:'interval',id:'kiosk-friction-day'},to:{decision:'denied'}}}));
 expect(result.current.allowed).toBe(true);
});
