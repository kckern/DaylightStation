import React from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {act,cleanup,render,screen,fireEvent} from '@testing-library/react';
const h=vi.hoisted(()=>({context:null,identity:null}));
vi.mock('../context/FitnessContext.jsx',()=>({useFitnessContext:()=>h.context}));
vi.mock('../identity/useIdentity.js',()=>({useIdentity:()=>h.identity}));
import ZoneTrustWarning from './ZoneTrustWarning.jsx';
import {__resetKioskEnvCache} from '@/lib/kioskEnv.js';
let resolve, approvals;
const profile=(id='kid')=>({id,displayName:id==='kid'?'Rider One':'Rider Two',heartRate:140,zoneTrusted:false,zoneReadingEligible:true,zoneReadingDeviceId:'sensor',trustRevision:1,zoneConfig:[{id:'active',min:100}]});
beforeEach(()=>{
 approvals=[];
 h.context={zoneProfiles:[profile()],participantRoster:[],fitnessSessionInstance:{sessionId:'session',endTime:null,approveZoneTrust:grant=>{approvals.push(grant);h.context.zoneProfiles=h.context.zoneProfiles.map(p=>p.id===grant.userId?{...p,zoneTrusted:true}:p);return {ok:true};}},forceUpdate:()=>{}};
 h.identity={registerAdmin:()=>new Promise(r=>{resolve=r;}),clearUnlock:vi.fn(),unlockState:'scanning'};
});
afterEach(cleanup);
it('shows lost celebrations and personal threshold until a trusted reading, only during sessions',()=>{
 const view=render(<ZoneTrustWarning/>);
 expect(screen.getByText('Reading not trusted')).toBeTruthy();
 expect(screen.getByText(/Rings and Fire celebrations are paused/)).toBeTruthy();
 expect(screen.getByText(/100/)).toBeTruthy();
 h.context.zoneProfiles[0].zoneReadingEligible=false;view.rerender(<ZoneTrustWarning/>);
 expect(screen.getByText(/accepted reading/i)).toBeTruthy();
 h.context.fitnessSessionInstance.sessionId=null;view.rerender(<ZoneTrustWarning/>);
 expect(screen.queryByText('Reading not trusted')).toBeNull();
});
it('admin approval clears only the selected rider after context refresh',async()=>{
 h.context.zoneProfiles.push(profile('other'));const view=render(<ZoneTrustWarning/>);
 fireEvent.click(screen.getByRole('button',{name:'Admin unlock Rider One'}));
 await act(async()=>resolve({matched:true,userId:'admin'}));view.rerender(<ZoneTrustWarning/>);
 expect(h.context.zoneProfiles[0].zoneTrusted).toBe(true);expect(h.context.zoneProfiles[1].zoneTrusted).toBe(false);
 expect(screen.queryByRole('button',{name:'Admin unlock Rider One'})).toBeNull();
 expect(screen.getByRole('button',{name:'Admin unlock Rider Two'})).toBeTruthy();
 expect(approvals[0]).toEqual({sessionId:'session',userId:'kid',deviceId:'sensor',trustRevision:1,adminId:'admin'});
 expect(h.identity.clearUnlock).toHaveBeenCalled();
});
it.each(['denied','cancel','session','session-object','wearer','revision','unmount'])('keeps trust blocked after %s',async mode=>{
 const view=render(<ZoneTrustWarning/>);fireEvent.click(screen.getByRole('button',{name:'Admin unlock Rider One'}));
 if(mode==='cancel')fireEvent.keyDown(window,{key:'Escape'});
 if(mode==='session-object')h.context.fitnessSessionInstance={...h.context.fitnessSessionInstance};
 if(mode==='session')h.context.fitnessSessionInstance={...h.context.fitnessSessionInstance,sessionId:'next'};
 if(mode==='wearer')h.context.zoneProfiles=[{...profile(),zoneReadingDeviceId:'replacement'}];
 if(mode==='revision')h.context.zoneProfiles=[{...profile(),trustRevision:2}];
 if(mode==='unmount')view.unmount();else view.rerender(<ZoneTrustWarning/>);
 await act(async()=>resolve({matched:mode!=='denied',userId:'admin'}));
 expect(approvals).toEqual([]);expect(h.context.zoneProfiles[0].zoneTrusted).toBe(false);
 if(mode!=='unmount')expect(screen.getByText('Reading not trusted')).toBeTruthy();
 expect(h.identity.clearUnlock).toHaveBeenCalled();
});

it('hides the warning for trusted riders and absent heart rate readings',()=>{
 h.context.zoneProfiles=[{...profile(),zoneTrusted:true},{...profile('other'),heartRate:0}];
 render(<ZoneTrustWarning/>);expect(screen.queryByText('Reading not trusted')).toBeNull();
});
it('a rejected domain grant keeps the rider warning visible',async()=>{
 h.context.fitnessSessionInstance.approveZoneTrust=()=>({ok:false,reason:'stale'});
 render(<ZoneTrustWarning/>);fireEvent.click(screen.getByRole('button',{name:'Admin unlock Rider One'}));
 await act(async()=>resolve({matched:true,userId:'admin'}));
 expect(h.context.zoneProfiles[0].zoneTrusted).toBe(false);
 expect(screen.getByText('Reading not trusted')).toBeTruthy();
 expect(screen.getByText(/Reading remains untrusted/)).toBeTruthy();
});

it('renders the fingerprint dialog outside the scrolling warning region',()=>{
 window.history.replaceState({},'', '/?kiosk=1');__resetKioskEnvCache();
 try {
  render(<ZoneTrustWarning/>);
  fireEvent.click(screen.getByRole('button',{name:'Admin unlock Rider One'}));
  const dialog=screen.getByRole('dialog',{name:'Fingerprint unlock'});
  const warning=screen.getByRole('complementary',{name:'Heart rate reading trust'});
  expect(warning.contains(dialog)).toBe(false);
 } finally {
  window.history.replaceState({},'', '/');__resetKioskEnvCache();
 }
});
