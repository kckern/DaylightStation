// supertest must listen on the address it connects to.
//
// supertest 6 called `app.listen(0)`, which binds dual-stack `::`, then
// connected to 127.0.0.1:<port>. Another socket bound to 127.0.0.1 on that
// same port (any parallel suite's server; macOS allows the more specific bind
// and prefers it) then received the request, and a test saw someone else's 404.
// supertest 7.3 listens on 127.0.0.1 itself, so that second bind is refused.
//
// This reproduces the collision on purpose: the moment supertest's server is
// listening, a worker thread binds an imposter to 127.0.0.1 on the same port
// while this thread waits, before supertest connects.
import {it,expect} from 'vitest';
import http from 'node:http';
import {Worker} from 'node:worker_threads';
import express from 'express';
import request from 'supertest';

const HINT='supertest bound a wildcard address and connected to 127.0.0.1; run `npm install` at the repo root (supertest >= 7.3 binds 127.0.0.1)';

it('every request reaches our own server even when another socket takes 127.0.0.1 on its port', async () => {
  const signal=new Int32Array(new SharedArrayBuffer(8));
  const worker=new Worker(`
    const {workerData,parentPort}=require('node:worker_threads');const http=require('node:http');const s=new Int32Array(workerData);
    const done=code=>{Atomics.store(s,1,code);Atomics.store(s,0,1);Atomics.notify(s,0);};
    parentPort.on('message',port=>{const imposter=http.createServer((q,r)=>{r.statusCode=418;r.end('imposter');});
      imposter.once('error',()=>done(2));imposter.listen(port,'127.0.0.1',()=>done(1));});`,{eval:true,workerData:signal.buffer});
  const bound=[],imposterBinds=[];
  const listen=http.Server.prototype.listen;
  http.Server.prototype.listen=function(...args){
    this.once('listening',()=>{
      bound.push(this.address().address);
      Atomics.store(signal,0,0);worker.postMessage(this.address().port);Atomics.wait(signal,0,0,5000);
      imposterBinds.push(Atomics.load(signal,1)===1?'bound':'refused');
    });
    return listen.apply(this,args);
  };
  const statuses=[];
  try{
    const app=express();app.get('/ok',(req,res)=>res.status(200).send('ours'));
    for(let i=0;i<20;i++)statuses.push((await request(app).get('/ok')).status);
  }finally{
    http.Server.prototype.listen=listen;
    await worker.terminate();
  }
  expect(bound.length,'the collision hook never saw supertest start a server').toBe(20);
  expect([...new Set(bound)],HINT).toEqual(['127.0.0.1']);
  expect([...new Set(imposterBinds)],HINT).toEqual(['refused']);
  expect(statuses,HINT).toEqual(Array(20).fill(200));
});
