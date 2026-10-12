import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const here=path.dirname(new URL(import.meta.url).pathname),repo=path.resolve(here,'../../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),pins={};
function read(p){pins[p]=sha(fs.readFileSync(p));return JSON.parse(fs.readFileSync(p));}
const joins=read(path.join(here,'current-http-manual-device-joins.json'));assert.equal(pins[path.join(here,'current-http-manual-device-joins.json')],'f22063e99399908f3394a2dc44e34adab4ac671bbb258dad6347a2308f1153e9');
const evidence=read(path.join(here,'current-http-evidence-projection-v2.json'));
const backendRequire=createRequire(path.join(repo,'backend/package.json'));
const routerFile=backendRequire.resolve('router');const routerRequire=createRequire(routerFile);const matcherFile=routerRequire.resolve('path-to-regexp');
const matcherRequire=createRequire(matcherFile),matcher=matcherRequire(matcherFile);
const routerPackage=read(path.join(path.dirname(routerFile),'package.json'));const matcherPackage=read(path.join(path.dirname(matcherFile),'../package.json'));assert.equal(routerPackage.version,'2.2.0');assert.equal(matcherPackage.version,'8.4.2');
const lock=read(path.join(repo,'backend/package-lock.json'));assert.equal(lock.packages['node_modules/router'].version,routerPackage.version);assert.equal(lock.packages['node_modules/router/node_modules/path-to-regexp'].version,matcherPackage.version);
for(const p of [routerFile,matcherFile])pins[p]=sha(fs.readFileSync(p));
const rows=joins.remainingWildcardMatcherJoins.map(c=>{
 const byRole=evidence.roles.map(role=>({role:role.role,sourceCommit:role.commit,matches:role.taskReachable.filter(r=>r.method===c.method&&matcher.match(r.template,{decode:false,end:true,sensitive:false,trailing:true})(c.path.split('?')[0])).map(r=>({template:r.template,nativeRouteOrder:r.order,routerId:r.routerId,mountOrders:r.mountOrders,handlerSha256:r.handlerSha256}))}));
 assert(byRole.every(x=>x.matches.length>0));assert.deepEqual(byRole[0].matches,byRole[1].matches);
 return {caseId:c.id,path:c.path,method:c.method,modelCandidates:byRole,nativeFiniteContractStillAccepted:true,nativeDispatcherJoinAccepted:false,disposition:'Exact captured task template matches under local8.4.2 source model. Installed image matcher source-file bytes are not independently pinned; retain dispatch qualification unresolved.',productionActivationCredit:false};
});
const controls=[];function reject(name,fn){assert.equal(fn(),false);controls.push(name);}
const m=t=>matcher.match(t,{decode:false,end:true,sensitive:false,trailing:true});assert(m('/api/v1/local/stream{/*splat}')('/api/v1/local/stream/audio/sample.wav'));assert(m('/api/v1/piano/bank/*splat')('/api/v1/piano/bank/arpeggios/all'));assert(m('/api/v1/content/:source/info/:id{/:modifiers}')('/api/v1/content/readalong/info/synthetic-story'));
reject('foreign-prefix',()=>m('/api/v1/piano/bank/*splat')('/foreign/piano/bank/arpeggios/all'));reject('required-wildcard-absent',()=>m('/api/v1/piano/bank/*splat')('/api/v1/piano/bank'));reject('missing-required-source',()=>m('/api/v1/content/:source/info/:id{/:modifiers}')('/api/v1/content/info/synthetic-story'));reject('extra-fixed-segment',()=>m('/api/v1/content/:source/info/:id{/:modifiers}')('/api/v1/content/readalong/info/synthetic-story/extra/more'));
const result={schema:'daylight.current-http-wildcard-source-model/v1',sourceModelOnly:true,installedImageMatcherFileBytesIndependentlyPinned:false,scope:'Preparation of49 captured request/template joins using exact local router2.2.0 nested path-to-regexp8.4.2 resolved from backend. This is not native installed matcher byte identity, dispatch admission, a production denominator or HTTP permission.',modelDependencies:{routerVersion:routerPackage.version,matcherVersion:matcherPackage.version,routerFile,matcherFile,lockedMatcherIntegrity:lock.packages['node_modules/router/node_modules/path-to-regexp'].integrity,requiredFutureEvidence:'Stopped immutable2217/new160 installed router/index.js and nested path-to-regexp/dist/index.js plus package.json source-byte pins must match this model before native dispatcher joins can be qualified.'},rows,controls:{positive:3,negative:controls,noNativeCalls:true},productionMethodTemplateDenominator:null,pins,generatorSha256:sha(fs.readFileSync(new URL(import.meta.url)))};
assert.equal(rows.length,49);fs.writeFileSync(path.join(here,'current-http-wildcard-source-model.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({modelRows:49,nativeJoinAdmissions:0,positiveControls:3,negativeControls:controls.length,productionDenominator:null}));
