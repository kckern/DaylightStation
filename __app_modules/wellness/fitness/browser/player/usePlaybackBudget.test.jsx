import { it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
const fixture=vi.hoisted(()=>({bodies:[]}));
vi.mock('../../../../../frontend/src/lib/api.mjs',()=>({DaylightAPI:vi.fn(async (url,body)=>{
 fixture.bodies.push(body);
 return {generation:1,supervised:body.participantIds.includes('parent')&&!(body.guestIds??[]).includes('parent'),serverNow:Date.now(),policies:[{id:'cap',remainingMs:0,expired:true,grant:null}]};
})}));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js',()=>({default:()=>({warn:vi.fn()})}));
import { usePlaybackBudget } from './usePlaybackBudget.js';
import { applyGovernanceBypass } from './governanceBypass.js';
afterEach(()=>{cleanup();fixture.bodies=[];});
it('observes a supervisor joining an exhausted screen after the Player closes',async()=>{
 const mediaRef={current:null};const initial={deviceId:'tv',policies:[{id:'cap'}],supervisorIds:['parent'],participantRoster:[{id:'child',isActive:true}],currentMedia:{contentId:'plex:1'},governanceState:{isGoverned:true,videoLocked:false},mediaRef,externalHold:false};
 const h=renderHook(props=>usePlaybackBudget(props),{initialProps:initial});
 await waitFor(()=>expect(h.result.current.status).toBe('exhausted'));
 h.rerender({...initial,currentMedia:null,participantRoster:[{id:'parent',isActive:true}]});
 await waitFor(()=>expect(fixture.bodies.at(-1)?.participantIds).toEqual(['parent']));
 expect(h.result.current.blocked).toBe(false);
 h.unmount();
});
it('a supervisor assigned as a guest does not supervise, and the server is told who the guests are',async()=>{
 const mediaRef={current:null};const props={deviceId:'tv',policies:[{id:'cap'}],supervisorIds:['parent'],participantRoster:[{id:'child',isActive:true},{id:'parent',isActive:true,isGuest:true}],currentMedia:{contentId:'plex:1'},governanceState:{isGoverned:true,videoLocked:false},mediaRef,externalHold:false};
 const h=renderHook(p=>usePlaybackBudget(p),{initialProps:props});
 await waitFor(()=>expect(h.result.current.status).toBe('exhausted'));
 expect(fixture.bodies.at(-1)).toMatchObject({participantIds:['child','parent'],guestIds:['parent']});
 expect(h.result.current.blocked).toBe(true);
 h.unmount();
});
it('a roster of guests only has no governed child to meter',async()=>{
 const mediaRef={current:null};const props={deviceId:'tv',policies:[{id:'cap'}],supervisorIds:['parent'],participantRoster:[{id:'visitor',isActive:true,isGuest:true}],currentMedia:{contentId:'plex:1'},governanceState:{isGoverned:true,videoLocked:false},mediaRef,externalHold:false};
 const h=renderHook(p=>usePlaybackBudget(p),{initialProps:props});
 await waitFor(()=>expect(fixture.bodies.length).toBeGreaterThan(0));
 expect(fixture.bodies.at(-1)).toMatchObject({guestIds:['visitor'],requestGrant:false});
 expect(h.result.current.blocked).toBe(false);
 h.unmount();
});
it('an admin override lifts the budget for the current item only; the next item is metered again',async()=>{
 const mediaRef={current:null};const props={deviceId:'tv',policies:[{id:'cap'}],supervisorIds:['parent'],participantRoster:[{id:'child',isActive:true}],currentMedia:{plex:'1'},governanceState:{isGoverned:true,videoLocked:false},mediaRef,externalHold:false};
 const h=renderHook(p=>usePlaybackBudget(p),{initialProps:props});
 await waitFor(()=>expect(h.result.current.status).toBe('exhausted'));
 expect(h.result.current.blocked).toBe(true);
 act(()=>{expect(h.result.current.grantOverride({userId:'parent'})).toBe(true);});
 await waitFor(()=>expect(h.result.current).toMatchObject({blocked:false,status:'overridden'}));
 await waitFor(()=>expect(fixture.bodies.at(-1)).toMatchObject({requestGrant:false}));
 h.rerender({...props,currentMedia:{plex:'2'}});
 await waitFor(()=>expect(h.result.current).toMatchObject({blocked:true,status:'exhausted'}));
 h.unmount();
});
it('with no device id an admin override still opens the item',async()=>{
 const mediaRef={current:null};const props={deviceId:null,policies:[{id:'cap'}],participantRoster:[{id:'child',isActive:true}],currentMedia:{plex:'1'},governanceState:{isGoverned:true,videoLocked:false},mediaRef,externalHold:false};
 const h=renderHook(p=>usePlaybackBudget(p),{initialProps:props});
 await waitFor(()=>expect(h.result.current).toMatchObject({blocked:true,status:'unavailable'}));
 act(()=>{h.result.current.grantOverride({userId:'parent'});});
 await waitFor(()=>expect(h.result.current).toMatchObject({blocked:false,status:'overridden'}));
 h.unmount();
});
// 2026-11-20 (garage, Danny Go): a `governance_bypass` fingerprint released the
// player's lock, but the meter was handed the engine snapshot (videoLocked: true),
// held the media (status `held`, no cover) and re-paused it within 3 ms of each of
// 14 play presses. The meter must be given the bypassed state FitnessContext publishes.
function fakeVideo(){
 const media=new EventTarget();Object.assign(media,{tagName:'VIDEO',paused:true,readyState:4,seeking:false,currentTime:0});
 media.pause=()=>{if(media.paused)return;media.paused=true;media.dispatchEvent(new Event('pause'));};
 media.play=async()=>{media.paused=false;media.dispatchEvent(new Event('play'));};
 return media;
}
it('an engine lock holds the media on play; the bypassed state lets the unlocked item play',async()=>{
 const media=fakeVideo();const mediaRef={current:media};
 const engineLocked={status:'pending',isGoverned:true,videoLocked:true};
 const props={deviceId:'tv',policies:[{id:'cap'}],supervisorIds:['parent'],participantRoster:[{id:'child',isActive:true}],currentMedia:{contentId:'plex:674297'},governanceState:engineLocked,mediaRef,externalHold:false};
 const h=renderHook(p=>usePlaybackBudget(p),{initialProps:props});
 await waitFor(()=>expect(h.result.current.status).toBe('held'));
 await act(async()=>{await media.play();});
 expect(media.paused).toBe(true); // the incident: the meter re-paused it
 h.rerender({...props,governanceState:applyGovernanceBypass(engineLocked,true)});
 await waitFor(()=>expect(h.result.current.status).toBe('inactive'));
 await act(async()=>{await media.play();});
 await new Promise(r=>setTimeout(r,120)); // several meter polls
 expect(media.paused).toBe(false);
 h.unmount();
});
