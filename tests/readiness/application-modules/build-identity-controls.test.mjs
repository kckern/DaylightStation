import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compareCapturedApi,validateCaptureManifest,compareApi} from './api-comparator.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),fixture='a3834c2e4354987fa799c26d607ff84275eb93d2bad65e03494435b7f3880929';
const prefix='Build Time: dev (not built)\nCommit: https://github.com/kckern/DaylightStation/commit/';
const c={id:'native-build-source-identity',method:'GET',path:'/build.txt',safety:{reviewed:true,disposition:'read-only',sideEffects:false,nonlocal:false,longLived:false},nativeBuildContract:{kind:'admitted-native-git-v1',fixtureFileSha256:fixture},expected:{status:200,headers:{'content-type':'text/plain; charset=utf-8'},body:{kind:'text',exact:prefix+'<admitted-source-commit>\n'}},normalize:{jsonPaths:[],headers:['date','connection','keep-alive']}};
const manifest={schema:'comparator-v1',cases:[c]};
const observation=commit=>{const body=prefix+commit+'\n',b=Buffer.from(body);return {status:200,headers:{'content-type':'text/plain; charset=utf-8','content-length':String(b.length),etag:`W/"${b.length.toString(16)}-${createHash('sha1').update(b).digest('base64').slice(0,27)}"`},body};};
async function replay(change=()=>{},guardsAccepted=true){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'build-contract-control-'));const manifestSha256=hash(JSON.stringify(manifest)),pairNonce='1'.repeat(32),runtimeSha256='2'.repeat(64),harnessSha256='3'.repeat(64),runs=[];
 try{for(const [i,role] of ['original','candidate'].entries()){
  const sourceCommit=String(i+4).repeat(40),workingTreeSha256='5'.repeat(64),capture={schema:'isolated-api-capture-v1',url:'http://127.0.0.1:43129',role,pairNonce,sourceCommit,workingTreeSha256,fixtureFileSha256:fixture,runtimeSha256,harnessSha256,manifestSha256,fixtureSha256:'6'.repeat(64),runtimeTimezone:'UTC',startedAt:10+i*20,endedAt:20+i*20,cases:[{id:c.id,method:c.method,path:c.path,url:'http://127.0.0.1:43129/build.txt',bodyKind:'text',observed:observation(sourceCommit)}]};change(capture,i);
  const file=path.join(dir,role+'.capture.json'),data=JSON.stringify(capture);await fs.writeFile(file,data);const capPin={file,sha256:hash(data)};const receipt={schema:'local-app-result-v1',completed:true,controls:true,protectedInputsUnchanged:true,exitCode:0,signal:null,sourceCommit,fixtureSha256:capture.fixtureSha256,runtimeTimezone:'UTC',capture:{...capture,...capPin}};const receiptFile=path.join(dir,role+'.receipt.json'),receiptData=JSON.stringify(receipt);await fs.writeFile(receiptFile,receiptData);runs.push({role,sourceCommit,workingTreeSha256,capture:capPin,receipt:{file:receiptFile,sha256:hash(receiptData)}});
 }return await compareCapturedApi({manifest,manifestSha256,pairNonce,fixtureFileSha256:fixture,runtimeSha256,harnessSha256,runs,guardsAccepted});}finally{await fs.rm(dir,{recursive:true,force:true});}
}
test('complete different role commits pass with raw observations retained',async()=>{const r=await replay();assert.equal(r.accepted,true);assert.notEqual(r.cases[0].observations.reference.body,r.cases[0].observations.candidate.body);assert.equal(r.cases[0].intentionalSourceIdentityDifference,true);});
test('wrong commit,unknown,body/status/header mutations fail independently',async()=>{for(const mutate of [o=>o.body=prefix+'unknown\n',o=>o.body=prefix+'4'.repeat(40)+'\n',o=>o.body+='extra',o=>o.status=404,o=>o.headers.etag='wrong',o=>o.headers['content-length']='1',o=>o.headers['content-type']='application/json'])assert.equal((await replay((capture,i)=>{if(i===1)mutate(capture.cases[0].observed);})).accepted,false);});
test('fixed owner/path/fixture/shape and rawheaders cannot be bypassed',()=>{validateCaptureManifest(manifest,fixture);for(const delta of [{id:'other'},{path:'/api/v1/status'},{method:'HEAD'},{nativeBuildContract:{kind:'admitted-native-git-v1',fixtureFileSha256:'0'.repeat(64)}},{normalize:{jsonPaths:[],headers:['etag']}}])assert.throws(()=>validateCaptureManifest({...manifest,cases:[{...c,...delta}]},fixture));assert.throws(()=>validateCaptureManifest(manifest,'0'.repeat(64)));});
test('missing finalguard and unguarded direct comparison are denied',async()=>{await assert.rejects(replay(()=>{},false));await assert.rejects(compareApi({manifest,targets:{},transport:async()=>observation('4'.repeat(40))}));});

test('self-contained source projection excludes only finite Git metadata; all backing stays guarded',async()=>{
 const {default:vm}=await import('node:vm');
 const runner=await fs.readFile(new URL('./run-local-app.mjs',import.meta.url),'utf8');
 const line=runner.split('\n').find(s=>s.startsWith('const workingTreeSha256 = '));assert.ok(line);
 const sourceRoot='/independently-authored/native-tree',jsonHash=x=>hash(JSON.stringify(x));
 const expected=[{path:'backend/src/app.mjs',sha256:'a'.repeat(64)},{path:'backend/src/extra-sibling.yml',sha256:'b'.repeat(64)},{path:'package.json',sha256:'c'.repeat(64)}];
 for(const metadata of [[sourceRoot+'/.git/HEAD',sourceRoot+'/.git/config',sourceRoot+'/.git/packed-refs'],[sourceRoot+'/.git']]){
  const sourceInputs=[...expected.map(r=>({file:sourceRoot+'/'+r.path,sha256:r.sha256})),...metadata.map(file=>({file,sha256:'d'.repeat(64)})),{file:sourceRoot+'-other/backend/src/outside.mjs',sha256:'e'.repeat(64)}];
  const before=structuredClone(sourceInputs),evaluate=nativeBuild=>vm.runInNewContext(line+'\nworkingTreeSha256',{sourceInputs,sourceRoot,path,nativeBuild,nativeBuildGitMetadata:new Set(metadata),jsonHash});
  assert.equal(evaluate(true),jsonHash(expected));assert.notEqual(evaluate(false),jsonHash(expected));assert.deepEqual(sourceInputs,before);
  for(const p of metadata)assert.ok(sourceInputs.some(r=>r.file===p&&r.sha256==='d'.repeat(64)));
 }
 const coordinator=await fs.readFile(new URL('./run-isolated-pair.mjs',import.meta.url),'utf8'),guard=coordinator.slice(coordinator.indexOf('function guardBacking(rows)'),coordinator.indexOf('export async function main'));
 const sync=await import('node:fs'),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'build-metadata-denial-'));try{
  const file=path.join(tmp,'HEAD');await fs.writeFile(file,'native-pinned-commit\n');const st=sync.statSync(file),rows=[{path:file,dev:st.dev,ino:st.ino,kind:'file',sha256:hash(sync.readFileSync(file))}];
  const check=()=>vm.runInNewContext(guard+'\nguardBacking(rows)',{rows,fs:sync,assert,hash:p=>hash(sync.readFileSync(p))});check();await fs.appendFile(file,'tamper');assert.throws(check,/Backing byte drift/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
