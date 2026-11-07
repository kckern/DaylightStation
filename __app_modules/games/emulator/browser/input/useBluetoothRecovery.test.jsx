import { it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useBluetoothRecovery } from './useBluetoothRecovery.js';
const MAC='AA:BB:CC:DD:EE:FF';
const initial=()=>({ok:true,adapter:{supported:true,enabled:true,discovering:false},devices:[{address:MAC,bond:'bonded',manageable:true,connected:false,profiles:[]}],pairing:null,capabilities:{input:true}});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it('times out accepted operations, then displays late observed success',async()=>{
 vi.useFakeTimers();const state=initial();
 vi.stubGlobal('fetch',vi.fn(async(_url,o)=>({ok:true,json:async()=>o.method==='POST'?{ok:true,accepted:true}:structuredClone(state)})));
 const {result}=renderHook(()=>useBluetoothRecovery({deviceId:'tv'}));
 await act(async()=>{});expect(result.current.fresh).toBe(true);
 await act(async()=>{await result.current.command('connect',{address:MAC,profile:'input'});});
 expect(result.current.waiting).toBe(true);expect(result.current.state.devices[0].connected).toBe(false);
 await act(async()=>{await vi.advanceTimersByTimeAsync(31000);});
 expect(result.current.waiting).toBe(false);expect(result.current.message).toMatch(/No completed change/);
 state.devices[0].connected=true;state.devices[0].profiles=['input'];
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
 expect(result.current.state.devices[0].connected).toBe(true);
});
it('keeps previous state visibly stale after an outage and refuses new mutations',async()=>{
 vi.useFakeTimers();let online=true;const posts=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,o)=>{if(!online)throw Error('offline');if(o.method==='POST')posts.push(o);return {ok:true,json:async()=>initial()};}));
 const {result}=renderHook(()=>useBluetoothRecovery({deviceId:'tv'}));await act(async()=>{});
 online=false;await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
 expect(result.current.fresh).toBe(false);expect(result.current.state.devices[0].bond).toBe('bonded');
 await act(async()=>{await result.current.command('unpair',{address:MAC});});expect(posts).toHaveLength(0);
});
