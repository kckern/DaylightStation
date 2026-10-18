import { it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
const fixture=vi.hoisted(()=>({bodies:[]}));
vi.mock('../../../../../frontend/src/lib/api.mjs',()=>({DaylightAPI:vi.fn(async (url,body)=>{
 fixture.bodies.push(body);
 return {generation:1,supervised:body.participantIds.includes('parent'),serverNow:Date.now(),policies:[{id:'cap',remainingMs:0,expired:true,grant:null}]};
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
