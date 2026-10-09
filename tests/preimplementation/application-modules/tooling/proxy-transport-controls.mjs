const tasks=[];const test=(name,run)=>tasks.push({name,run});import assert from 'node:assert/strict';
import { createServer, get, request } from '../drivers/proxy-memory-transport.mjs';
const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s)));
const close = s => new Promise(resolve => s.close(resolve));
test('raw Node response status headers and bytes serialize without sockets', async () => {
 const expected=Buffer.from([0,255,10,80]);
 const server=await listen(createServer((req,res)=>{assert.equal(req.method,'GET');assert.equal(req.url,'/bytes?x=1');res.writeHead(206,{'content-type':'video/mp4'});res.end(expected);}));
 const response=await new Promise((resolve,reject)=>get({port:server.address().port,path:'/bytes?x=1'},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));}).on('error',reject));
 assert.equal(response.status,206);assert.equal(response.headers['content-type'],'video/mp4');assert.deepEqual(response.body,expected);await close(server);
});
test('callback is async and request finish does not close upstream; destroy does',async()=>{
 let upstreamClosed=false,timer;
 const server=await listen(createServer((req,res)=>{req.socket.once('close',()=>{upstreamClosed=true;clearInterval(timer)});res.writeHead(206);timer=setInterval(()=>res.write(Buffer.from('live')),5);}));
 let assigned=false;
 const client=request(null,{port:server.address().port,path:'/stream',method:'GET'},res=>{assert.equal(assigned,true);res.on('data',()=>{});});assigned=true;client.end();
 await new Promise(r=>setTimeout(r,25));assert.equal(upstreamClosed,false);assert.equal(client.destroyed,false);
 client.destroy();await new Promise(r=>setTimeout(r,10));assert.equal(upstreamClosed,true);await close(server);
});
test('paired downstream Duplex drives actual ServerResponse close then upstream destroy',async()=>{
 let upstreamClosed=null,timer,proxyClosed=false;
 const upstream=await listen(createServer((req,res)=>{timer=setInterval(()=>res.write(Buffer.alloc(1024)),5);req.socket.once('close',()=>{upstreamClosed=Date.now();clearInterval(timer)});res.writeHead(206,{'content-type':'video/mp4'});}));
 const proxy=await listen(createServer((_req,res)=>{const upstreamRequest=request(null,{port:upstream.address().port,path:'/bytes',method:'GET'},source=>{res.writeHead(source.statusCode,source.headers);source.pipe(res);});res.once('close',()=>{proxyClosed=true;upstreamRequest.destroy();});upstreamRequest.end();}));
 const leftAt=await new Promise((resolve,reject)=>{const downstream=get({port:proxy.address().port,path:'/bytes'},res=>{res.once('data',()=>{downstream.destroy();resolve(Date.now());});});downstream.on('error',reject);});
 await new Promise(r=>setTimeout(r,25));assert.equal(proxyClosed,true);assert.notEqual(upstreamClosed,null);assert.ok(upstreamClosed-leftAt<300);await close(proxy);await close(upstream);
});

export async function assertProxyTransportControls(){for(const task of tasks){await task.run();process.stdout.write('PROXY CONTROL '+task.name+': PASS\n');}return tasks.map(task=>task.name);}
