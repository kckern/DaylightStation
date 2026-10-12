import test from 'node:test';
import assert from 'node:assert/strict';
import {validateObservation, validateOptions, assetPath, runSmoke, parseOptions} from './production-smoke.mjs';

const commit='5c34039569a9d6617f4cd7d86b323701f150c54d';
const obs=(body,type='application/json')=>({status:200,headers:{'content-type':type},body:Buffer.from(body),startedAt:1000,endedAt:2000});
test('only explicit origin and reviewed catalog IDs admitted',()=>{
  assert.equal(validateOptions({origin:'http://localhost:3111',expectedCommit:commit,catalogs:['piano-programs']}).origin,'http://localhost:3111');
  for(const origin of ['http://u:p@localhost:3111','http://localhost/x','https://localhost/?x']) assert.throws(()=>validateOptions({origin,expectedCommit:commit}));
  assert.throws(()=>validateOptions({origin:'http://localhost',expectedCommit:commit,catalogs:['/api/v1/trigger']}));
  assert.throws(()=>parseOptions(['--arbitrary-path','/trigger']));
  assert.throws(()=>parseOptions(['--origin','http://localhost','--origin','http://evil']));
  assert.throws(()=>parseOptions(['--origin']));
});
test('health timestamp/type/keys and build identity fail closed',()=>{
  validateObservation('healthz',obs('{"ok":true,"server":"main","timestamp":1500,"uptime":2}'),commit);
  assert.throws(()=>validateObservation('healthz',obs('{"ok":true,"server":"main","timestamp":"1500","uptime":2}'),commit));
  assert.throws(()=>validateObservation('ping',obs('{"ok":true,"timestamp":1500,"extra":1}'),commit));
  validateObservation('built',obs('Build Time: 2026-10-11 17:00:00\nCommit: https://github.com/kckern/DaylightStation/commit/'+commit+'\n','text/plain'),commit);
  assert.throws(()=>validateObservation('built',obs('https://github.com/kckern/DaylightStation/commit/'+'0'.repeat(40),'text/plain'),commit));
  assert.throws(()=>validateObservation('built',obs('Build Time: dev (not built)\nCommit: https://github.com/kckern/DaylightStation/commit/'+commit+'\n','text/plain'),commit));
  assert.throws(()=>validateObservation('built',obs('Build Time: today\nCommit: https://github.com/kckern/DaylightStation/commit/'+commit+'\n','text/plain'),'0'.repeat(40)));
});
test('status/content length corruption rejected; production catalog invariants checked',()=>{
  assert.throws(()=>validateObservation('ping',{...obs('{"ok":true,"timestamp":1500}'),status:302},commit));
  assert.throws(()=>validateObservation('ping',{...obs('{"ok":true,"timestamp":1500}'),headers:{'content-type':'application/json','content-length':'1'}},commit));
  assert.throws(()=>validateObservation('asset',obs('x'.repeat(1048577),'text/javascript'),commit));
  validateObservation('piano-programs',obs('{"programs":[{"id":"a","title":"A"}]}'),commit);
  assert.throws(()=>validateObservation('piano-programs',obs('{"programs":[{"id":"a"},{"id":"a"}]}'),commit));
  assert.throws(()=>validateObservation('piano-exercises',obs('{"title":"X","categories":[],"seeds":[],"totals":{"seeds":1,"variants":0}}'),commit));
});
test('asset extraction permits only same-origin built JS asset',()=>{
  assert.equal(assetPath('<script type="module" src="/assets/index-a.js"></script>'),'/assets/index-a.js');
  assert.throws(()=>assetPath('<script src="https://evil/assets/x.js"></script>'));
  assert.throws(()=>assetPath('<script src="/assets/../trigger.js"></script>'));
});
test('smoke uses fixed GET sequence and stops on invalid body',async()=>{
  const paths=[];
  await assert.rejects(runSmoke({origin:'http://localhost:3111',expectedCommit:commit},async(path)=>{paths.push(path);return obs('{}');}));
  assert.deepEqual(paths,['/healthz']);
});
test('complete finite sequence succeeds without HTTP using authored control bodies',async()=>{
  const paths=[];
  const bodies={
    '/healthz':obs('{"ok":true,"server":"main","timestamp":1500,"uptime":2}'),
    '/api/v1/ping':obs('{"ok":true,"timestamp":1500}'),
    '/build.txt':obs('Build Time: today\nCommit: https://github.com/kckern/DaylightStation/commit/'+commit+'\n','text/plain'),
    '/':obs('<html><script src="/assets/main-a.js"></script></html>','text/html'),
    '/assets/main-a.js':obs('export const value=1;','text/javascript'),
    '/api/v1/piano/programs':obs('{"programs":[]}'),
  };
  const result=await runSmoke({origin:'http://localhost:3111',expectedCommit:commit,catalogs:['piano-programs']},async(path,origin)=>{assert.equal(origin,'http://localhost:3111');paths.push(path);return bodies[path];});
  assert.equal(result.accepted,true);assert.deepEqual(paths,Object.keys(bodies));assert.equal(result.observations.length,6);
});
