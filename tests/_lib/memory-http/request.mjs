/** Only request forms used by the router tests.
 * Real complete HTTP serialization; no sockets, abort/backpressure or timing parity.
 */
import assert from 'node:assert/strict';
import express from 'express';
import {wireRequest} from './http-wire.mjs';
export default function request(app) {
  if(typeof app?.handle!=='function')throw new TypeError('Expected real Express app');
  return Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,url=>{
    let body, started=false, promise;
    const headers={},checks=[];
    const chain={
      set(name,value){if(started)throw new Error('Request already dispatched');headers[name.toLowerCase()]=value;return chain;},
      send(value){if(started)throw new Error('Request already dispatched');body=value;return chain;},
      query(value){if(started)throw new Error('Request already dispatched');const query=new URLSearchParams(value).toString();url+=(url.includes('?')?'&':'?')+query;return chain;},
      expect(status,expected){if(!Number.isInteger(status))throw new Error('Only status/body expectations are supported');checks.push({status,expected,hasBody:arguments.length>1});return chain;},
      then(resolve,reject){
        if(!promise){started=true;promise=wireRequest(app,method.toUpperCase(),url,{body,headers}).then(response=>{
          const type=String(response.headers['content-type']||'');
          const result={status:response.status,headers:response.headers,text:response.body,
            body:/\bjson\b/i.test(type)&&response.body?response.json():/^(image\/|application\/(octet-stream|pdf))/i.test(type)?response.bytes:{}};
          for(const check of checks){assert.equal(result.status,check.status);if(check.hasBody)assert.deepEqual(result.body,check.expected);}
          return result;
        });}
        return promise.then(resolve,reject);
      },
    };
    return chain;
  }]));
}

/** Pure synthetic handlers verify transport before any retained router oracle. */
export async function assertRemainingWireControls() {
  const errorApp=express();errorApp.get('/error',()=>{throw new Error('synthetic finalhandler control');});
  assert.equal((await request(errorApp).get('/error')).status,500);assert.equal((await request(errorApp).get('/missing')).status,404);
  process.stdout.write('WIRE CONTROL real Express error and missing-route finalhandler: PASS\n');
  const bytes=Buffer.from([0,255,128,13,10]);
  const binary={handle(req,res){
    const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
      assert.equal(req.method,'PUT');assert.equal(req.url,'/bytes?name=a+b');
      assert.equal(req.headers['x-fixture'],'binary');
      assert.deepEqual(Buffer.concat(chunks),bytes);
      res.writeHead(201,{'content-type':'application/octet-stream','x-fixture':'roundtrip'});res.end(bytes);
    });
  }};
  const response=await request(binary).put('/bytes').query({name:'a b'}).set('X-Fixture','binary').send(bytes).expect(201);
  assert.deepEqual(response.body,bytes);assert.equal(response.headers['x-fixture'],'roundtrip');
  process.stdout.write('WIRE CONTROL binary/query/header/status: PASS\n');
  const value={items:[1,null,'é'],ok:true};
  const json={handle(req,res){const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
    assert.equal(req.headers['content-type'],'application/json');assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()),value);
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
  });}};
  assert.deepEqual((await request(json).post('/json').send(value).expect(200,value)).body,value);
  process.stdout.write('WIRE CONTROL unchanged JSON: PASS\n');
  const fixed={handle(_req,res){res.writeHead(200,{'content-type':'application/json'});res.end('{"actual":true}');}};
  await assert.rejects(Promise.resolve(request(fixed).get('/').expect(201)),{code:'ERR_ASSERTION'});
  await assert.rejects(Promise.resolve(request(fixed).get('/').expect(200,{wrong:true})),{code:'ERR_ASSERTION'});
  process.stdout.write('WIRE CONTROL mismatched status/body rejected: PASS\n');
}
