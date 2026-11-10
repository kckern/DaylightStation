// @vitest-environment node
import { it, expect } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { createArcadeBluetoothService } from '../composition/arcadeBluetooth.mjs';
import { createArcadeBluetoothRouter } from './arcadeBluetooth.mjs';

async function listen(handler) { const server = createServer(handler); await new Promise(r=>server.listen(0,'127.0.0.1',r)); return { url:`http://127.0.0.1:${server.address().port}`, close:()=>new Promise(r=>server.close(r)) }; }
const state = {ok:true, adapter:{supported:true,enabled:true,discovering:false},devices:[],pairing:null,capabilities:{input:true}};
it('routes only declared hosts, forwards input commands, and rejects GET mutations', async()=>{
 const calls=[];
 const native=await listen(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk; calls.push({url:req.url,method:req.method,body});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.method==='GET'?state:{ok:true,accepted:true}));});
 const service=createArcadeBluetoothService({devicesConfig:{tv:{bluetooth_bridge:{url:native.url}},garage:{}}});
 const app=express(); app.use('/bt',createArcadeBluetoothRouter({service}));const web=await listen(app);
 try {
  let r=await fetch(web.url+'/bt/tv'); expect(r.status).toBe(200);expect(await r.json()).toEqual(state);
  r=await fetch(web.url+'/bt/tv/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:'AA:BB:CC:DD:EE:FF',profile:'input'})});expect(r.status).toBe(202);
  expect(calls[1]).toMatchObject({url:'/bluetooth/connect',method:'POST'});expect(JSON.parse(calls[1].body).profile).toBe('input');
  for(const [path,status]of [['missing',404],['garage',503],['tv/connect',404]]){r=await fetch(web.url+'/bt/'+path);expect(r.status).toBe(status);}
  r=await fetch(web.url+'/bt/tv/unpair',{method:'POST',headers:{'content-type':'application/json'},body:'{"address":"bad"}'});expect(r.status).toBe(400);
  r=await fetch(web.url+'/bt/tv/scan/stop',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});expect(r.status).toBe(202);expect(calls.at(-1).url).toBe('/bluetooth/scan/stop');
  expect(calls.length).toBe(3);
 }finally{await web.close();await native.close();}
});
it('does not turn a native rejection, malformed response or timeout into acceptance',async()=>{
 let mode='reject';const native=await listen((_req,res)=>{res.setHeader('content-type','application/json');if(mode==='hang')return;res.end(mode==='invalid'?'broken':JSON.stringify({ok:false,error:'wake the controller',code:'action_rejected'}));});
 const service=createArcadeBluetoothService({devicesConfig:{tv:{bluetooth_bridge:{url:native.url}}},timeoutMs:3000});
 try {
  await expect(service.command('tv','connect',{address:'AA:BB:CC:DD:EE:FF',profile:'input'})).rejects.toMatchObject({status:409});
  mode='invalid';await expect(service.state('tv')).rejects.toMatchObject({status:502});
  mode='hang';const shortTimeout=createArcadeBluetoothService({devicesConfig:{tv:{bluetooth_bridge:{url:native.url}}},timeoutMs:100});await expect(shortTimeout.state('tv')).rejects.toMatchObject({status:504});
 }finally{await native.close();}
});
it('rejects arbitrary destinations and malformed mutation bodies before networking',async()=>{
 let calls=0;const service=createArcadeBluetoothService({devicesConfig:{tv:{}},fetchImpl:()=>{calls++;throw Error('network');}});
 await expect(service.state('http://elsewhere')).rejects.toMatchObject({status:404});
 await expect(service.command('tv','scan',{durationMs:30001})).rejects.toMatchObject({status:400});
 await expect(service.command('tv','connect',{address:'AA:BB:CC:DD:EE:FF',profile:'audio'})).rejects.toMatchObject({status:400});
 await expect(service.command('tv','power',{})).rejects.toMatchObject({status:400});
 expect(calls).toBe(0);
});
it('adds the device-configured pairing guide to status, and only when one is configured', async()=>{
 const { pairingGuide } = await import('../application/services/ArcadeBluetoothService.mjs');
 expect(pairingGuide(null)).toBeNull();expect(pairingGuide({steps:[' ','']})).toBeNull();
 expect(pairingGuide({mode:'Android mode',steps:['Hold START',' Hold PAIR '],troubleshoot:7})).toEqual({mode:'Android mode',steps:['Hold START','Hold PAIR'],troubleshoot:null});
 const native=await listen((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(state));});
 try {
  const service=createArcadeBluetoothService({devicesConfig:{tv:{bluetooth_bridge:{url:native.url,pairing:{steps:['Hold PAIR']}}}}});
  expect((await service.state('tv')).guide).toEqual({mode:null,steps:['Hold PAIR'],troubleshoot:null});
 }finally{await native.close();}
});
