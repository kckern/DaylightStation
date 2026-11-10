import { it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
const fixture=vi.hoisted(()=>({bodies:[]}));
vi.mock('../../../../../frontend/src/lib/api.mjs',()=>({DaylightAPI:vi.fn(async (url,body)=>{
 fixture.bodies.push(body);
 return {generation:1,supervised:body.participantIds.includes('parent')&&!(body.guestIds??[]).includes('parent'),serverNow:Date.now(),policies:[{id:'cap',remainingMs:0,expired:true,grant:null}]};
})}));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js',()=>({default:()=>({warn:vi.fn()})}));
import { usePlaybackBudget } from './usePlaybackBudget.js';
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
