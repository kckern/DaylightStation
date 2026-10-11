import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// One independently authored, reviewed three-read slice. No path/grant comes from a packet.
const fixed = {"fixtureSha256":"917b7af2c3a0295fe5fe56890f78102c171ad8bd2738e380a63aed0e66719dea","cases":[{"id":"native-health-day-populated","path":"/api/v1/health/day?date=2026-09-07","sha256":"a15a935c96a474db80eb6bc5713392b9580754b57850d4df3d344198b8db18c9"},{"id":"native-health-morning-shortlist","path":"/api/v1/health/nutrition/catalog/suggest?bucket=morning&limit=16","sha256":"d4b12b307f0e7d507fc56791504c273652cd29cbf70f46ac5b2fa4a41cb211c3"},{"id":"native-health-desktop-budget-range","path":"/api/v1/health/budget/range?from=2026-08-09&to=2026-09-07","sha256":"566492771441a4a7a89a7c900fd73b6fdea6c27cc39b633a3f69b2d56b870711"}],"start":1791615600000,"end":1791702000000};
const absent = [
 'data/users/user_1/lifelog/nutrition/ledger-transaction.yml',
 'data/users/user_1/lifelog/nutrition/ledger-transaction.yaml',
 'data/household/fitness/log',
 'data/users/user_1/lifelog/strava.yml',
 'data/users/user_1/lifelog/strava.yaml',
 'data/users/user_1/lifelog/fitness.yml',
 'data/users/user_1/lifelog/fitness.yaml',
 'data/users/user_1/day_closed.yml',
 'data/users/user_1/day_closed.yaml',
 'data/users/user_1/lifelog/nutrition/ledger-revision.yml',
 'data/users/user_1/lifelog/nutrition/ledger-revision.yaml',
 'data/users/user_1/lifelog/nutrition/archives/nutrilist',
 'data/household/apps/health/icon-manifest.yml',
 'data/household/apps/health/icon-manifest.yaml',
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function healthReadPacket(manifest, fixtureFileSha256) {
 const cases=manifest?.cases??[];
 const selected=cases.some(c=>c.id?.startsWith('native-health-')||fixed.cases.some(f=>f.path===c.path));
 if(!selected)return null;
 assert.equal(fixtureFileSha256,fixed.fixtureSha256,'Exact reviewed Health fixture');
 assert.equal(cases.length,3,'Exact Health owner/cases');
 for(let i=0;i<3;i++)assert.equal(sha(JSON.stringify(cases[i])),fixed.cases[i].sha256,'Exact complete reviewed Health case');
 return {fixtureFileSha256,manifestSha256:sha(JSON.stringify(manifest)),localDay:'2026-10-10',zone:'America/Los_Angeles',start:fixed.start,end:fixed.end};
}

export function validateHealthDay(packet, ms) {
 assert.ok(Number.isSafeInteger(ms)&&packet.start<=ms&&ms<packet.end,'Health request outside sealed local day');
}

function identity(p) {
 const s=fs.lstatSync(p);
 assert.ok(!s.isSymbolicLink()&&s.isDirectory(),'Health ancestry must be a real directory');
 assert.equal(fs.realpathSync(p),p,'Canonical Health directory');
 return {path:p,dev:s.dev,ino:s.ino,kind:'directory'};
}

export function inspectHealthScratch(packet, scratch) {
 assert.ok(packet&&path.isAbsolute(scratch),'Bound Health scratch required');
 const root=identity(scratch),ancestors=new Map([[scratch,root]]),conditions=[];
 for(const relative of absent){
  const components=relative.split('/');let cursor=scratch,missing=false;
  for(let i=0;i<components.length;i++){
   cursor=path.join(cursor,components[i]);
   if(!fs.existsSync(cursor)){
    // existsSync follows symlinks: a broken link must never masquerade as absence.
    try{fs.lstatSync(cursor);assert.fail('Health broken link is not absence');}catch(e){if(e.code!=='ENOENT')throw e;}
    missing=true;break;
   }
   const leaf=i===components.length-1;
   if(leaf){
    assert.equal(relative,'data/household/fitness/log','Health guarded path must remain absent');
    const id=identity(cursor);assert.deepEqual(fs.readdirSync(cursor),[],'Fitness log must be exactly empty');
    ancestors.set(cursor,id);conditions.push({relative,state:'empty-directory',...id,entries:[]});
   }else ancestors.set(cursor,identity(cursor));
  }
  if(missing)conditions.push({relative,state:'absent'});
 }
 return {fixtureFileSha256:packet.fixtureFileSha256,manifestSha256:packet.manifestSha256,root,ancestors:[...ancestors.values()],conditions};
}

export function validateHealthObservation(packet,c,observed) {
 assert.ok(fixed.cases.some(f=>f.id===c.id&&f.path===c.path),'Health observed owner/path');
 const interval=observed.observationInterval;
 assert.ok(interval&&interval.startedAt<=interval.endedAt,'Health request interval');
 validateHealthDay(packet,interval.startedAt);validateHealthDay(packet,interval.endedAt);
 const date=Date.parse(observed.headers.date);
 assert.ok(Number.isFinite(date)&&new Date(date).toUTCString()===observed.headers.date,'Canonical raw HTTP Date required');
 validateHealthDay(packet,date);
 assert.ok(interval.startedAt-999<=date&&date<=interval.endedAt,'Raw Date outside actual request interval');
 assert.equal(observed.status,200,'Healthy Health status required');
 for(const [name,value] of Object.entries(c.expected.headers))assert.equal(observed.headers[name],value,`Health raw header ${name}`);
 const expected=JSON.stringify(c.expected.body.equals);
 assert.equal(observed.body,expected,'Complete independent raw Health JSON required');
 assert.equal(String(Buffer.byteLength(observed.body)),observed.headers['content-length']);
 const etag=`W/"${Buffer.byteLength(observed.body).toString(16)}-${createHash('sha1').update(observed.body).digest('base64').replace(/=+$/,'')}"`;
 assert.equal(observed.headers.etag,etag,'Raw Health ETag');
 return {id:c.id,path:c.path,observationInterval:interval,rawDate:observed.headers.date,bodySha256:sha(observed.body)};
}

export function finishHealthScratch(packet,scratch,before) {
 const after=inspectHealthScratch(packet,scratch);
 for(const row of before)assert.deepEqual(after,row,'Health physical guard/ancestry identity changed');
 return after;
}
