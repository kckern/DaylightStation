import React,{useEffect} from 'react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {act,render,screen,fireEvent} from '@testing-library/react';
const h=vi.hoisted(()=>({api:null,registerAdmin:null,clearUnlock:vi.fn(),event:null,configuration:{_household:'home'},mounts:0}));
vi.mock('@/lib/api.mjs',async importOriginal=>({...await importOriginal(),DaylightAPI:(...args)=>h.api(...args)}));
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketSubscription:(_topic,handler)=>{h.event=handler;}}));
vi.mock('../context/FitnessContext.jsx',()=>({useFitnessContext:()=>({fitnessConfiguration:h.configuration,participantRoster:[],usersConfig:[{id:'adult',schoolLearner:false}]})}));
vi.mock('../identity/useIdentity.js',()=>({useIdentity:()=>({registerAdmin:(...args)=>h.registerAdmin(...args),clearUnlock:h.clearUnlock,unlockState:'scanning',unlockedUser:null})}));
vi.mock('@/lib/kioskEnv.js',()=>({isKioskEnv:()=>true,isLocalDevHost:()=>true}));
import {FitnessGameGate} from './FitnessGameGate.jsx';
function Child(){useEffect(()=>{h.mounts++;return()=>{h.mounts--;};},[]);return <p>Game running</p>;}
const start=Date.parse('2026-11-15T08:00:00Z'),end=Date.parse('2026-11-16T08:00:00Z');
const row=(decision='denied',startsAt=start,endsAt=end,id='2026-11-15')=>({capabilityId:'fitness.games-unsupervised',subject:{kind:'household',id:'home'},period:{kind:'local_day',id,startsAt,endsAt},decision,degraded:false,basisState:decision==='granted'?'satisfied':'unsatisfied',validFrom:startsAt,validUntil:endsAt});
const settle=()=>act(async()=>{for(let i=0;i<15;i++)await Promise.resolve();});
const content=(moduleId='cycle_game')=><FitnessGameGate moduleId={moduleId} label="Cycle Race"><Child/></FitnessGameGate>;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(start+1000);h.mounts=0;h.configuration={_household:'home'};h.clearUnlock.mockClear();h.registerAdmin=vi.fn(async()=>({matched:true,userId:'parent'}));h.api=vi.fn(async()=>({items:[row()]}));});
afterEach(()=>vi.useRealTimers());
describe('Sunday game boundary',()=>{
 it('Sunday blocks adults and an empty learner group, including localhost, before any game mounts',async()=>{
  render(content());await settle();expect(h.mounts).toBe(0);expect(screen.getByRole('button',{name:'Admin unlock'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Admin unlock'}));await settle();expect(h.registerAdmin).toHaveBeenCalledWith('cycle_game');expect(h.mounts).toBe(1);expect(screen.getByText('Game running')).toBeTruthy();
 });
 it('a failed or identity-free unlock never mounts a game',async()=>{
  h.registerAdmin=vi.fn(async()=>({matched:true}));render(content());await settle();fireEvent.click(screen.getByRole('button',{name:'Admin unlock'}));await settle();expect(h.mounts).toBe(0);
 });
 it('cancelled and switched-game async results cannot open a later game',async()=>{
  let resolve;h.registerAdmin=vi.fn(()=>new Promise(r=>{resolve=r;}));const {rerender}=render(content());await settle();fireEvent.click(screen.getByRole('button',{name:'Admin unlock'}));await settle();fireEvent.pointerDown(screen.getByRole('button',{name:'Cancel'}));await act(async()=>resolve({matched:true,userId:'parent'}));expect(h.mounts).toBe(0);
  fireEvent.click(screen.getByRole('button',{name:'Admin unlock'}));rerender(content('skyline_glider'));await settle();await act(async()=>resolve({matched:true,userId:'parent'}));expect(h.mounts).toBe(0);
 });
 it('ordinary weekday access opens without fingerprint and expires exactly at Sunday midnight',async()=>{
  vi.setSystemTime(start-2000);let reply=row('granted',start-86400000,start,'2026-11-14');h.api=vi.fn(async()=>({items:[reply]}));render(content());await settle();expect(h.mounts).toBe(1);expect(h.registerAdmin).not.toHaveBeenCalled();reply=row();await act(async()=>vi.advanceTimersByTimeAsync(2001));await settle();expect(h.mounts).toBe(0);expect(screen.getByRole('button',{name:'Admin unlock'})).toBeTruthy();
 });
 it('missing policy or failed reads do not become normal access or invent a household/day',async()=>{
  h.api=vi.fn(async()=>{throw Error('offline');});render(content());await settle();expect(h.mounts).toBe(0);expect(screen.getByRole('button',{name:'Retry access check'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Admin unlock'})).toBeNull();
  h.api=vi.fn(async()=>({items:[row()]}));fireEvent.click(screen.getByRole('button',{name:'Retry access check'}));await settle();expect(screen.getByRole('button',{name:'Admin unlock'})).toBeTruthy();
 });
 it('a successful admin unlock cannot carry to another game, household or local day',async()=>{
  const {rerender}=render(content());await settle();fireEvent.click(screen.getByRole('button',{name:'Admin unlock'}));await settle();expect(h.mounts).toBe(1);rerender(content('skyline_invaders'));expect(h.mounts).toBe(0);await settle();
  h.configuration={_household:'other'};rerender(content('skyline_invaders'));await settle();expect(h.mounts).toBe(0);
 });
});
it('an unlock finishing after unmount cannot open the same game on a new visit',async()=>{
 let resolve;h.registerAdmin=vi.fn(()=>new Promise(r=>{resolve=r;}));const first=render(content());await settle();fireEvent.click(screen.getByRole('button',{name:'Admin unlock'}));first.unmount();render(content());await settle();await act(async()=>resolve({matched:true,userId:'parent'}));expect(h.mounts).toBe(0);expect(screen.getByRole('button',{name:'Admin unlock'})).toBeTruthy();
});
it('a WebSocket grant is only an invalidation and cannot bypass the canonical Sunday denial',async()=>{
 render(content());await settle();h.api=vi.fn(async()=>{throw Error('offline');});act(()=>h.event({payload:{capabilityId:'fitness.games-unsupervised',subject:{kind:'household',id:'home'},decision:'granted'}}));await settle();expect(h.mounts).toBe(0);expect(h.registerAdmin).not.toHaveBeenCalled();
});
