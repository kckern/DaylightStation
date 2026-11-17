import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {evaluateDrillEvidence} from './drillEvidence.mjs';
// This test changes household state ONLY during an explicitly arranged, approved drill.
const base=process.env.SUPERVISION_DRILL_BASE_URL;
const views=JSON.parse(process.env.SUPERVISION_DRILL_VIEWS??'[]');
const parent={username:process.env.SUPERVISION_DRILL_PARENT,password:process.env.SUPERVISION_DRILL_PASSWORD};
const evidencePath=process.env.SUPERVISION_DRILL_EVIDENCE;
const phaseRecords=[];
const initialHaProof=new Map();
let preflight;
test.describe.configure({mode:'serial'});
const commonStop=['renderer-restart-retained','backend-restart-retained','disconnect-retained'];
const physical={garage:['audio-ceased','game-ceased'],bank:['input-ceased'],reward:['input-ceased'],code:['input-ceased'],piano:['video-ceased','midi-ceased','other-app-retained'],arcade:['native-foreground-terminated','other-app-retained']};
const inventory=()=>[...new Set(views.map(view=>view.deviceId))].map(deviceId=>({deviceId,capabilities:[...new Set(views.filter(view=>view.deviceId===deviceId).flatMap(view=>view.requiredCapabilities??[]))]}));
async function evidence(){
 const record=JSON.parse(await readFile(evidencePath,'utf8'));
 if(preflight && (record.runId!==preflight.runId || JSON.stringify(record.artifacts)!==JSON.stringify(preflight.artifacts)))throw Error('The drill identity and reviewed artifacts must remain fixed during observation.');
 return record;
}
function checksFor(deviceId,phase){
 const ownViews=views.filter(view=>view.deviceId===deviceId);
 if(phase==='active')return ownViews.map(view=>`${view.label}-physically-active`);
 if(phase==='released')return ['no-content-resume','no-power-on'];
 if(phase==='offline')return ['consumer-unreachable','parent-sees-unverified','phone-delivered'];
 return [...new Set([...commonStop,...ownViews.flatMap(view=>physical[view.label]??[])])];
}
test.beforeAll(async()=>{
 if(process.env.SUPERVISION_SAFE_DRILL!=='yes' || !base || !parent.username || !parent.password || !evidencePath)throw Error('Arrange an explicit safe drill and supply its URL, parent credentials and private evidence file.');
 // BASE_URL disables Playwright's automatic webServer. Never let the harness launch a second controller.
 if(process.env.BASE_URL!==base)throw Error('BASE_URL must equal SUPERVISION_DRILL_BASE_URL and select the single approved stack.');
 const labels=new Set(views.map(view=>view.label));for(const label of Object.keys(physical))if(!labels.has(label))throw Error(`Missing drill coverage: ${label}`);
 for(const view of views)if(!view.deviceId || !view.path || !view.childSelector || !view.requiredCapabilities?.length)throw Error('Every view needs a registered device, path, child selector and explicit required capabilities.');
 const record=await evidence();
 if(!record.runId || !record.artifacts?.frontend || !record.artifacts?.backend || !record.rollback?.artifactId || !Number.isFinite(Date.parse(record.rollback.testedAt)) || record.rollback.ledgerPreserved!==true)throw Error('Record candidate build identities and an independently tested rollback preserving the Stop ledger.');
 for(const device of inventory()){
  const artifact=record.artifacts.devices?.[device.deviceId];
  if(!artifact?.installedVersion || !artifact?.candidateId || artifact.pairingPrepared!==true || artifact.signingLineageVerified!==true)throw Error(`Missing version/signing/pairing preflight for ${device.deviceId}`);
 }
 if(!inventory().some(device=>device.deviceId===record.offlineDeviceId))throw Error('Select the registered device for the unreachable-consumer repeat.');
 preflight=structuredClone(record);
});
async function parentCommand(request,action){const response=await request.post(`${base}/api/v1/supervision/parent-command`,{data:{...parent,action}});expect(response.ok()).toBe(true);return response.json();}
async function pairedDevices(browser,request){
 const bootstrap=await request.get(`${base}/api/v1/supervision/bootstrap`);expect(bootstrap.ok()).toBe(true);
 const configured=(await bootstrap.json()).devices;expect(configured?.slice().sort()).toEqual(inventory().map(device=>device.deviceId).sort());
 const contexts=new Map(),sessions=[];
 try{
  // Enrollment rotates a device's credential. Enroll once, sharing its cookie context across Portal views.
  for(const {deviceId} of inventory()){
   const context=await browser.newContext({baseURL:base});contexts.set(deviceId,context);
   const response=await context.request.post('/api/v1/supervision/enroll',{data:{...parent,deviceId}});expect(response.ok()).toBe(true);
  }
  for(const view of views){const context=contexts.get(view.deviceId),page=await context.newPage();await page.goto(view.path);sessions.push({view,context,page});}
  return {contexts,sessions};
 }catch(error){await Promise.all([...contexts.values()].map(context=>context.close()));throw error;}
}
async function snapshot(contexts){
 const perDevice=await Promise.all([...contexts].map(async([deviceId,context])=>{
  const [statusResponse,bootstrapResponse]=await Promise.all([context.request.get('/api/v1/supervision/status'),context.request.get('/api/v1/supervision/bootstrap')]);
  expect(statusResponse.ok()).toBe(true);expect(bootstrapResponse.ok()).toBe(true);
  return {deviceId,status:await statusResponse.json(),bootstrap:await bootstrapResponse.json()};
 }));
 const declared=inventory().flatMap(device=>device.capabilities.map(capability=>`${device.deviceId}:${capability}`)).sort();
 for(const row of perDevice[0].status.enforcement?.consumers??[]){
  const key=`${row.deviceId}:${row.commandRevision}`;
  // Retain the initial command's HA reports before periodic reconciliation replaces its detail.
  // Current ACK freshness and revision are still read independently on every poll.
  if(row.capability==='ha-stop' && row.acknowledged && row.blocked && row.detail?.verified && !initialHaProof.has(key))initialHaProof.set(key,{detail:structuredClone(row.detail),requestedAt:row.requestedAt});
 }
 expect((perDevice[0].status.enforcement?.consumers??[]).map(row=>`${row.deviceId}:${row.capability}`).sort()).toEqual(declared);
 return {perDevice,revisions:Object.fromEntries(perDevice.map(row=>[row.deviceId,row.bootstrap.commandRevision])),enforcement:perDevice[0].status.enforcement};
}
async function collect(contexts,phase,sinceMs,{offlineDeviceId}={}){
 let result;
 try{await expect.poll(async()=>{
  const state=await snapshot(contexts),record=await evidence();
  const consumers=(state.enforcement?.consumers??[]).map(row=>{
   const proof=initialHaProof.get(`${row.deviceId}:${row.commandRevision}`);
   return row.capability==='ha-stop' && proof?{...row,detail:proof.detail,requestedAt:proof.requestedAt}:row;
  });
  const devices=inventory().map(device=>({...device,artifactId:preflight.artifacts.devices[device.deviceId].candidateId,checks:checksFor(device.deviceId,phase)}));
  result={phase,at:new Date().toISOString(),...state,evidence:evaluateDrillEvidence({runId:record.runId,nowMs:Date.now(),phase,sinceMs,devices,revisions:state.revisions,consumers,observations:record.observations??[]})};
  if(phase==='offline'){
   const row=result.evidence.rows.find(row=>row.deviceId===offlineDeviceId);
   // A Stop receipt or stale ACK cannot pass the unreachable-consumer repeat.
   return result.evidence.allEnforced===false && row?.acknowledged===false && row?.physicallyObserved===true && state.enforcement?.activationAllowed===false && state.perDevice.every(row=>row.status.active===true);
  }
  return result.evidence.allEnforced && state.enforcement?.activationAllowed===true && !(state.enforcement?.missing?.length) && !(state.enforcement?.errors?.length);
 },{timeout:180000,intervals:[2000],message:`Await current per-device ${phase} ACKs and independently recorded physical evidence`}).toBe(true);
 return result;}finally{if(result)phaseRecords.push(result);}
}
test('network loss closes mounted child activity within the five-second permit bound',async({browser,request})=>{
 test.setTimeout(240000);
 await parentCommand(request,'release');const view=views[0],context=await browser.newContext({baseURL:base});
 try{
  const response=await context.request.post('/api/v1/supervision/enroll',{data:{...parent,deviceId:view.deviceId}});expect(response.ok()).toBe(true);
  const page=await context.newPage();await page.goto(view.path);await expect(page.locator(view.childSelector)).toBeVisible({timeout:180000});await context.setOffline(true);await expect(page.locator(view.childSelector)).toHaveCount(0,{timeout:6000});await expect(page.getByRole('button',{name:'Parent controls'})).toBeVisible();
 }finally{await context.close();}
});

test('real administrator scan retains Stop, verifies physical teardown and reports an unreachable consumer',async({browser,request},testInfo)=>{
 test.setTimeout(900000);phaseRecords.length=0;initialHaProof.clear();
 const {contexts,sessions}=await pairedDevices(browser,request);let completed=false;
 try{
  const started=Date.now();await parentCommand(request,'release');
  for(const {view,page} of sessions)await expect(page.locator(view.childSelector)).toBeVisible({timeout:180000});
  // Operator starts real school input, piano video/MIDI, garage audio/game and native arcade foreground.
  const active=await collect(contexts,'active',started);
  // Scan the ACTUAL owner/guardian fingerprint in normal context. No synthetic biometric or Stop API.
  await Promise.all(sessions.map(({page})=>expect(page.getByText('Paused by a parent',{exact:true})).toBeVisible({timeout:60000})));
  await expect.poll(async()=>{const state=await snapshot(contexts);return state.perDevice.every(row=>row.status.active && state.revisions[row.deviceId]>active.revisions[row.deviceId]);},{timeout:30000}).toBe(true);
  for(const {view,page} of sessions){await expect(page.locator(view.childSelector)).toHaveCount(0);await page.reload();await expect(page.getByText('Paused by a parent',{exact:true})).toBeVisible();}
  // Operator performs actual renderer/backend restart, disconnect, other-app and native input/audio/video checks.
  await collect(contexts,'stopped',started);
  const releaseAt=Date.now(),released=await parentCommand(request,'release');expect(released.active).toBe(false);
  for(const {view,page} of sessions){await expect(page.getByRole('button',{name:'Return to menu'})).toBeVisible();await expect(page.getByRole('button',{name:'Parent controls'})).toBeVisible();await expect(page.locator(view.childSelector)).toHaveCount(0);}
  const normal=await collect(contexts,'released',releaseAt);
  // Operator makes the selected consumer unreachable, then performs another real normal-context scan.
  const offlineAt=Date.now(),record=await evidence();
  await expect.poll(async()=>{const state=await snapshot(contexts);return state.perDevice.every(row=>row.status.active && state.revisions[row.deviceId]>normal.revisions[row.deviceId]);},{timeout:180000}).toBe(true);
  await collect(contexts,'offline',offlineAt,{offlineDeviceId:record.offlineDeviceId});
  completed=true;
  // Leave Stop active after this negative drill. Parent release is a separate deliberate operation.
 }finally{
  try{const record=await evidence();
  await testInfo.attach('supervision-physical-acceptance',{body:JSON.stringify({status:completed?'observed':'incomplete',runId:record.runId,artifacts:record.artifacts,rollback:record.rollback,phases:phaseRecords},null,2),contentType:'application/json'});
  }finally{await Promise.all([...contexts.values()].map(context=>context.close()));}
 }
});
