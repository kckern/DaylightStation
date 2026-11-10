import { it, expect, vi } from 'vitest';
import { createBluetoothClient } from './bluetoothClient.js';
it('encodes device identity and rejects an upstream accepted:false response',async()=>{
 const calls=[];const client=createBluetoothClient({deviceId:'test tv',fetchImpl:async(url,o)=>{calls.push([url,o]);return {ok:true,json:async()=>({ok:true,accepted:false})};}});
 await expect(client.command('connect',{address:'AA:BB:CC:DD:EE:FF',profile:'input'})).rejects.toThrow('not accepted');
 expect(calls[0][0]).toBe('/api/v1/arcade-bluetooth/test%20tv/connect');
});
it('propagates cancellation and stops its timeout',async()=>{
 const upstream=new AbortController();let signal;
 const client=createBluetoothClient({deviceId:'tv',fetchImpl:async(_url,o)=>{signal=o.signal;return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));}});
 const result=client.state({signal:upstream.signal});upstream.abort();await expect(result).rejects.toMatchObject({name:'AbortError'});expect(signal.aborted).toBe(true);
});
