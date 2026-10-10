// Only this independently reviewed lesson pair may observe published-unit readiness.
// No generic URL, delay, retry, credential, clock or product-cache capability.
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const manifestPin='9a9367d26aa44b4702bc8b70b5ba7c692c6996a9316dbe774c9741bd2e3feaf0';
const fixturePin='45472d30f2fb2fa7554e781decc00a4fbf4e790a9b5ee1803b56b03805fada61';
const url='http://127.0.0.1:43129/api/v1/school/lifecycle/curriculum/units/joins-video';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function lessonReadinessRequired(manifest,fixtureFileSha256){if(digest(manifest)!==manifestPin)return false;assert.equal(fixtureFileSha256,fixturePin,'Published-unit fixture identity');return true;}
function classify(observed){assert.match(observed.headers?.['content-type']??'',/^application\/json(?:;|$)/);const body=JSON.parse(observed.body);if(observed.status===404){assert.equal(typeof body.error==='string'?body.error:body.error?.message,'no published unit joins-video','Unexpected unpublished-unit response');return false;}assert.equal(observed.status,200,'Unexpected prerequisite status');for(const[k,v]of Object.entries({unitId:'joins-video',title:'Shapes Together',hasBank:true,hasMedia:true}))assert.deepEqual(body[k],v,'Published-unit predicate '+k);return true;}
function checkObservation(row,start,deadline){assert.equal(row.method,'GET');assert.equal(row.url,url);assert.equal(row.bodyKind,'json');assert.equal(row.sha256,digest(row.observed),'Readiness response tampered');const interval=row.observed.observationInterval;assert.ok(Number.isSafeInteger(interval?.startedAt)&&Number.isSafeInteger(interval?.endedAt)&&start<=interval.startedAt&&interval.startedAt<=interval.endedAt&&interval.endedAt<=deadline,'Readiness observation interval');return classify(row.observed);}
export async function waitForPublishedUnit({manifest,fixtureFileSha256,role,transport,now=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),persist}){
 assert.ok(lessonReadinessRequired(manifest,fixtureFileSha256));assert.ok(['original','candidate'].includes(role));assert.equal(typeof persist,'function');
 const startedAt=now();const evidence={schema:'exact-lesson-published-unit/v1',manifestSha256:manifestPin,fixtureFileSha256:fixturePin,role,startedAt,deadline:startedAt+20000,endedAt:startedAt,ready:false,observations:[]};persist(evidence);
 try{for(let attempt=0;attempt<81;attempt++){assert.ok(now()<evidence.deadline,'Published-unit deadline');const row={method:'GET',url,bodyKind:'json',attemptStartedAt:now()};evidence.observations.push(row);persist(evidence);
 try{row.observed=await transport({url,method:'GET',bodyKind:'json'});row.sha256=digest(row.observed);}catch(error){row.transportError={name:error.name,message:error.message};throw error;}
 evidence.endedAt=now();persist(evidence);if(checkObservation(row,startedAt,evidence.deadline)){evidence.ready=true;persist(evidence);return evidence;}await pause(Math.min(250,Math.max(0,evidence.deadline-now())));}
 throw Error('Published-unit deadline');
 }catch(error){evidence.endedAt=now();evidence.failure={name:error.name,message:error.message};persist(evidence);throw error;}
}
export function validatePublishedUnitEvidence({manifest,fixtureFileSha256,role,evidence,captureStartedAt,captureEndedAt,selectedObservations}){
 const required=lessonReadinessRequired(manifest,fixtureFileSha256);if(!required){assert.equal(evidence,undefined,'Unexpected readiness prerequisite');return;}
 assert.ok(evidence);assert.equal(evidence.schema,'exact-lesson-published-unit/v1');assert.equal(evidence.manifestSha256,manifestPin);assert.equal(evidence.fixtureFileSha256,fixturePin);assert.equal(evidence.role,role);assert.equal(evidence.ready,true);assert.equal(evidence.failure,undefined);assert.equal(evidence.deadline,evidence.startedAt+20000);assert.ok(captureStartedAt<=evidence.startedAt&&evidence.startedAt<=evidence.endedAt&&evidence.endedAt<=evidence.deadline&&evidence.endedAt<=captureEndedAt);
 assert.ok(evidence.observations.length>=1&&evidence.observations.length<=81);let last=evidence.startedAt;
 for(const[i,row]of evidence.observations.entries()){assert.equal(row.transportError,undefined);assert.ok(last<=row.attemptStartedAt&&row.attemptStartedAt<=row.observed.observationInterval.startedAt);assert.equal(checkObservation(row,evidence.startedAt,evidence.deadline),i===evidence.observations.length-1,'Publication must end observations');last=row.observed.observationInterval.endedAt;}
 assert.ok(last<=evidence.endedAt);for(const observed of selectedObservations){const interval=observed.observationInterval;assert.ok(evidence.endedAt<=interval?.startedAt&&interval.startedAt<=interval.endedAt&&interval.endedAt<=captureEndedAt,'Lesson captured before publication or outside role');}
}
