import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as api from './api-comparator.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(new URL('./first-readonly-expectations.json', import.meta.url)));
const selected = { ...manifest, cases: manifest.cases.slice(0, 1) };
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-pair-control-'));
  const put = (name, value) => { const file = path.join(root, name); fs.writeFileSync(file, JSON.stringify(value)); return { file, sha256: sha(fs.readFileSync(file)) }; };
  const nonce = 'a'.repeat(32), fixtureSha256 = 'b'.repeat(64), runtimeSha256 = 'c'.repeat(64), harnessSha256 = 'd'.repeat(64);
  const manifestPin = put('manifest.json', selected);
  const runs = ['original', 'candidate'].map((role, i) => {
    const sourceCommit = String(i+1).repeat(40), workingTreeSha256 = String(i+1).repeat(64);
    const capture = { schema:'isolated-api-capture-v1',role,pairNonce:nonce,sourceCommit,workingTreeSha256,runtimeSha256,harnessSha256,fixtureFileSha256:fixtureSha256,fixtureSha256,runtimeTimezone:'UTC',manifestSha256:manifestPin.sha256,url:'http://127.0.0.1:43129',startedAt:10+i*20,endedAt:20+i*20,cases:selected.cases.map(c=>({id:c.id,method:c.method,path:c.path,url:'http://127.0.0.1:43129'+c.path,bodyKind:c.expected.body.kind,observed:{status:200,headers:{'content-type':'application/json'},body:'{"ok":true,"timestamp":1}'}})) };
    const capturePin=put(role+'-capture.json',capture);
    const receipt={schema:'local-app-result-v1',completed:true,controls:true,protectedInputsUnchanged:true,exitCode:0,signal:null,sourceCommit, runtimeTimezone:'UTC', fixtureSha256,capture:{...capturePin,role,pairNonce:nonce,workingTreeSha256,runtimeSha256,harnessSha256,fixtureFileSha256:fixtureSha256,manifestSha256:manifestPin.sha256,startedAt:capture.startedAt,endedAt:capture.endedAt}};
    return { role,sourceCommit,workingTreeSha256,capture:capturePin,receipt:put(role+'-receipt.json',receipt) };
  });
  return {root,args:{manifest:selected,manifestSha256:manifestPin.sha256,pairNonce:nonce,fixtureFileSha256:fixtureSha256,runtimeSha256,harnessSha256,runs,guardsAccepted:true},put};
}
test('offline lane exists and capture admission rejects request bodies and unsafe methods',()=>{
  assert.equal(typeof api.validateCaptureManifest,'function');
  api.validateCaptureManifest(selected);
  for(const change of [{method:'POST'},{headers:{}},{body:''},{path:'/api/x?sid=secret'}]) assert.throws(()=>api.validateCaptureManifest({...selected,cases:[{...selected.cases[0],...change}]}));
});
test('receipt-bound sequential captures allow equal URL and preserve independent failures',async()=>{
  assert.equal(typeof api.compareCapturedApi,'function');
  const f=fixture(); try {const result=await api.compareCapturedApi(f.args); assert.equal(result.mode,'captured-isolated');assert.equal(result.readinessAccepted,false);assert.equal(result.accepted,false);}finally{fs.rmSync(f.root,{recursive:true});}
});
test('offline admission rejects stale role, fixture, receipt, overlap, duplicate and request linkage',async()=>{
  assert.equal(typeof api.compareCapturedApi,'function');
  for(const mutate of [a=>a.pairNonce='e'.repeat(32),a=>a.fixtureFileSha256='e'.repeat(64),a=>a.runs[0].role='candidate',a=>a.runs[1]=a.runs[0],a=>a.guardsAccepted=false]) {
    const f=fixture();try{mutate(f.args);await assert.rejects(api.compareCapturedApi(f.args));}finally{fs.rmSync(f.root,{recursive:true});}
  }
  for(const mutate of [c=>c.endedAt=100,c=>c.cases.push(c.cases[0]),c=>c.cases[0].path='/unexpected',c=>c.cases[0].headers={},c=>c.runtimeSha256='f'.repeat(64)]){
    const f=fixture();try{const run=f.args.runs[0];const c=JSON.parse(fs.readFileSync(run.capture.file));mutate(c);run.capture=f.put('changed.json',c);const r=JSON.parse(fs.readFileSync(run.receipt.file));r.capture={...r.capture,...run.capture};run.receipt=f.put('changed-receipt.json',r);await assert.rejects(api.compareCapturedApi(f.args));}finally{fs.rmSync(f.root,{recursive:true});}
  }
});
test('tampered stored raw bytes or final receipt fail before replay',async()=>{
  assert.equal(typeof api.compareCapturedApi,'function');
  for(const field of ['capture','receipt']) {const f=fixture();try{fs.appendFileSync(f.args.runs[0][field].file,' ');await assert.rejects(api.compareCapturedApi(f.args));}finally{fs.rmSync(f.root,{recursive:true});}}
});
test('distinct approved IDs sharing a URL replay their own captured occurrence',async()=>{
  const f=fixture();
  try {
    f.args.manifest={...selected,cases:[selected.cases[0],{...selected.cases[0],id:'same-request-second-contract'}]};
    f.args.manifestSha256=sha(JSON.stringify(f.args.manifest));
    for(const run of f.args.runs){
      const c=JSON.parse(fs.readFileSync(run.capture.file));c.manifestSha256=f.args.manifestSha256;
      c.cases[0].observed={status:200,headers:{'content-type':'application/json'},body:'{"ok":true,"server":"main","timestamp":1,"uptime":1}'};
      c.cases.push({...c.cases[0],id:'same-request-second-contract',observed:{...c.cases[0].observed,status:500}});
      run.capture=f.put(run.role+'-duplicate-request.json',c);
      const r=JSON.parse(fs.readFileSync(run.receipt.file));r.capture={...r.capture,...run.capture,manifestSha256:f.args.manifestSha256};run.receipt=f.put(run.role+'-duplicate-request-receipt.json',r);
    }
    const result=await api.compareCapturedApi(f.args);assert.equal(result.cases[0].accepted,true);assert.equal(result.cases[1].accepted,false);assert.equal(result.accepted,false);
  }finally{fs.rmSync(f.root,{recursive:true});}
});
