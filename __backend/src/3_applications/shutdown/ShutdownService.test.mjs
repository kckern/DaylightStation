import assert from 'node:assert/strict';
import test from 'node:test';
import { ShutdownService } from './ShutdownService.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

const config = {
  duration_seconds: 1800,
  targets: { school_screen_ids: ['portal'], piano_device_ids: ['yellow-room-tablet'] },
  home_assistant: { script: 'script.kiosk_shutdown_cue' },
};

function fakes() {
  let result = { state: null, invalid: false };
  const saved = [];
  const repo = {
    async read() { return result; },
    async save(state) { saved.push(state); result = { state, invalid: false }; },
  };
  const events = [];
  const portalCalls = [];
  const haCalls = [];
  return {
    repo, saved, events, portalCalls, haCalls,
    notifier: { publishState(payload) { events.push({ topic: 'shutdown.state', payload }); } },
    portal: { async setLockdown(value) { portalCalls.push(value); return {ok:true}; } },
    cue: { async announce(value) { haCalls.push(value); } },
    invalid() { result = { state: null, invalid: true }; },
  };
}

const policy = () => ({
  durationSeconds: config.duration_seconds,
  reconcileSeconds: config.reconcile_seconds,
  targets: ['school:portal', 'piano:yellow-room-tablet'],
});

test('activation persists the configured targets, publishes first, and resets the duration on repeat scan', async () => {
  const f = fakes();
  const service = new ShutdownService({ repo: f.repo, notifier: f.notifier, getPolicy: policy, cue: f.cue, portal: f.portal });
  const first = await service.activate({ readerId: 'study-omr', tagUid: '04aa660fcb2a81', now: 1_000 });
  const repeat = await service.activate({ readerId: 'study-omr', tagUid: '04aa660fcb2a81', now: 2_000 });
  assert.equal(first.lockedUntil, '1970-01-01T00:30:01.000Z');
  assert.equal(repeat.lockedUntil, '1970-01-01T00:30:02.000Z');
  assert.deepEqual(repeat.targets, ['school:portal', 'piano:yellow-room-tablet']);
  assert.equal(f.events[0].topic, 'shutdown.state');
  assert.equal(f.events[0].payload.locked, true);
  assert.deepEqual(f.portalCalls.at(-1), { locked: true, lockedUntil: repeat.lockedUntil });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.haCalls.length, 2, 'the audible cue repeats with a repeat scan');
});

test('malformed runtime YAML fails closed and sends an indefinite Portal lock', async () => {
  const f = fakes();
  f.invalid();
  const service = new ShutdownService({ repo: f.repo, notifier: f.notifier, getPolicy: policy, portal: f.portal });
  await service.reconcile();
  assert.equal((await service.status('school:portal')).locked, true);
  assert.equal(f.events[0].payload.locked, true);
  assert.deepEqual(f.events[0].payload.targets, ['school:portal', 'piano:yellow-room-tablet']);
  assert.deepEqual(f.portalCalls[0], { locked: true, lockedUntil: null });
});

test('failed Portal synchronization is retried without changing the persisted lock', async () => {
  const f = fakes();
  let attempts = 0;
  const portal = { async setLockdown() { attempts += 1; if (attempts === 1) throw new Error('offline'); } };
  const service = new ShutdownService({ repo: f.repo, notifier: f.notifier, getPolicy: policy, portal, logger: { warn() {} } });
  await service.activate({ readerId: 'study-omr', tagUid: '04aa660fcb2a81', now: Date.now() });
  await service.reconcile();
  assert.equal(attempts, 2);
  assert.equal((await service.status('piano:yellow-room-tablet')).locked, true);
});

test('the lockdown cue carries a composed push in household local time', async () => {
  const f = fakes();
  const service = new ShutdownService({
    repo: f.repo, notifier: f.notifier, getPolicy: policy, cue: f.cue, portal: f.portal, timezone: 'America/Los_Angeles',
  });
  await service.activate({ readerId: 'study-omr', tagUid: '04aa660fcb2a81', now: Date.parse('2026-08-28T00:43:29.185Z') });
  await new Promise((resolve) => setImmediate(resolve));
  const { notification } = f.haCalls[0];
  assert.ok(notification.title.startsWith('🔒 Kiosks locked — 30 min, until'));
  assert.equal(notification.title, '🔒 Kiosks locked — 30 min, until 6:13 PM');
  assert.equal(notification.data.tag, 'kiosk-shutdown');
  assert.equal(notification.data.alert_once, true);
  assert.deepEqual(findPushTextDefects(notification.title), []);
  assert.deepEqual(findPushTextDefects(notification.message), []);
  assert.equal(f.haCalls[0].lockedUntil, '2026-08-28T01:13:29.185Z', 'the raw ISO stays for the script, not the text');
});

test('a bad timezone never withholds the cue: announce still runs', async () => {
  const f = fakes();
  const service = new ShutdownService({
    repo: f.repo, notifier: f.notifier, getPolicy: policy, cue: f.cue, portal: f.portal,
    timezone: 'America/LosAngeles', logger: { warn() {} },
  });
  const state = await service.activate({ readerId: 'study-omr', tagUid: '04aa660fcb2a81', now: Date.parse('2026-08-28T00:43:29.185Z') });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.haCalls.length, 1, 'the siren cue fires');
  assert.equal(f.haCalls[0].lockedUntil, state.lockedUntil);
  // formatClockTime degrades to null, so the push still composes, without the clock time.
  assert.equal(f.haCalls[0].notification.title, '🔒 Kiosks locked — 30 min');
});
test('a resolved skipped Portal command cannot advance the reconciliation signature',async()=>{
 const f=fakes();let calls=0;const portal={setLockdown:async()=>{calls++;return {ok:false,skipped:true};}};
 const service=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,portal,logger:{warn(){}}});
 await service.activate({readerId:'reader',tagUid:'ABCD',now:1000});await service.reconcile(1001);
 assert.equal(calls,2);
});

test('legacy status exposes unavailable Portal enforcement without extending its finite lock window',async()=>{
 const f=fakes(),observations=[];const service=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,portal:{setLockdown:async()=>({ok:false,skipped:true})},incidentReporter:{observe:async value=>observations.push(value)},logger:{warn(){}}});
 const state=await service.activate({now:1000});await service.reconcile(6000);
 const status=await service.status('school:portal',6000);
 assert.equal(status.lockedUntil,state.lockedUntil);assert.equal(status.locked,true);
 assert.equal(status.enforcement.consumers[0].acknowledged,false);assert.equal(status.enforcement.consumers[0].error,'CAPABILITY_UNAVAILABLE');
 assert.ok(observations.some(value=>value.health[0].desiredBlocked===true));
 assert.equal((await service.status('school:portal',1801001)).locked,false);
});
test('legacy refreshes current native evidence and exposes matching ACK without physical verification',async()=>{
 const f=fakes();let now=1000;const service=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,clock:{now:()=>now},portal:{setLockdown:async({locked})=>({ok:true,blocked:locked})}});
 await service.activate({now});now=6000;await service.reconcile(now);
 assert.equal((await service.status('school:portal',6000)).enforcement.consumers[0].lastContactAt,6000);
 assert.equal((await service.status('school:portal',6000)).enforcement.consumers[0].acknowledged,true);
});
test('legacy incident persistence failure does not prevent the Portal command',async()=>{
 const f=fakes();let stops=0;
 const service=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,portal:{setLockdown:async({locked})=>{stops++;return {ok:true,blocked:locked};}},incidentReporter:{observe:async()=>{throw Error('disk failure');}},logger:{warn(){}}});
 await service.activate({now:1000});assert.equal(stops,1);
 assert.equal((await service.status('school:portal',1000)).enforcement.incidentReportingError,'INCIDENT_REPORTING_UNAVAILABLE');
});

test('a delayed legacy ACK records completion time after the failure alert and is freshly presented',async()=>{
 const {EnforcementIncidentReporter}=await import('../../../../__app_modules/household/supervision/server/application/EnforcementIncidentReporter.mjs');
 const {emptySupervisionState}=await import('../../../../__app_modules/household/supervision/shared/contracts.mjs');
 const {presentEnforcement}=await import('../../../../__app_modules/household/supervision/browser/enforcementPresentation.js');
 let now=1000,finish,state=emptySupervisionState();const alerts=[];
 const reporter=new EnforcementIncidentReporter({repository:{read:async()=>structuredClone(state),transaction:async fn=>fn(state)},monotonicNow:()=>now,notifyIncident:async event=>{alerts.push(event);return {accepted:true,delivered:null};}});
 const f=fakes(),service=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,clock:{now:()=>now},incidentReporter:reporter,portal:{setLockdown:()=>new Promise(resolve=>{finish=resolve;})}});
 const activation=service.activate({now});await new Promise(resolve=>setImmediate(resolve));
 now=6000;const retry=service.reconcile(now);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(alerts[0].type,'enforcement-unverified');now=7000;finish({ok:true,blocked:true});await Promise.all([activation,retry]);
 assert.deepEqual(alerts.map(event=>event.at),[new Date(6000).toISOString(),new Date(7000).toISOString()]);
 const row=(await service.status('school:portal',now)).enforcement.consumers[0];assert.equal(row.lastContactAt,7000);assert.equal(presentEnforcement(row,now).state,'acknowledged');
});

test('a Portal failure that keeps repeating warns once, and again when it changes',async()=>{
 const f=fakes(),warns=[];let code='CAPABILITY_UNAVAILABLE';
 const portal={setLockdown:async()=>{if(code==='ok')return {ok:true,blocked:false};return {ok:false,skipped:true,code};}};
 const service=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,portal,logger:{warn:(event,data)=>warns.push([event,data.error])}});
 for(let i=0;i<4;i++)await service.reconcile(1000+i);
 assert.deepEqual(warns,[['shutdown.portal_sync_failed','CAPABILITY_UNAVAILABLE']]);
 code='NATIVE_ACK_MISMATCH';await service.reconcile(2000);await service.reconcile(2001);
 assert.equal(warns.length,2);assert.equal(warns[1][1],'NATIVE_ACK_MISMATCH');
 code='ok';await service.reconcile(3000);code='CAPABILITY_UNAVAILABLE';await service.reconcile(3001);
 assert.equal(warns.length,3,'a failure after a recovery is a new failure');
});

test('a failed incident report logs the error code and message',async()=>{
 const f=fakes(),warnings=[];
 const failure=Object.assign(Error('The shutdown incident ledger is written only by writer_env=docker'),{code:'SUPERVISION_WRITER_HOST_REFUSED'});
 const service=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,portal:{setLockdown:async({locked})=>({ok:true,blocked:locked})},incidentReporter:{observe:async()=>{throw failure;}},logger:{warn:(event,data)=>warnings.push([event,data])}});
 await service.activate({now:1000});
 assert.deepEqual(warnings.find(([event])=>event==='shutdown.incident.reporting_failed'),['shutdown.incident.reporting_failed',{error:'INCIDENT_REPORTING_UNAVAILABLE',code:'SUPERVISION_WRITER_HOST_REFUSED',message:failure.message}]);
});

test('a backend that is not the incident writer reports not-writer instead of failing every Portal job',async()=>{
 const f=fakes(),warnings=[];
 const service=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,portal:{setLockdown:async({locked})=>({ok:true,blocked:locked})},incidentReporter:null,incidentReporting:'not-writer',logger:{warn:(event,data)=>warnings.push([event,data])}});
 await service.activate({now:1000});
 const {enforcement}=await service.status('school:portal',1000);
 assert.equal(enforcement.incidentReporting,'not-writer');
 assert.equal(enforcement.incidentReportingError,null);
 assert.equal((await service.diagnostics(1000)).enforcement.incidentReporting,'not-writer');
 assert.deepEqual(warnings.filter(([event])=>event==='shutdown.incident.reporting_failed'),[]);
});

test('incident reporting reads active with a reporter and unavailable without one',async()=>{
 const f=fakes();
 const withReporter=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,incidentReporter:{observe:async()=>{}},logger:{warn(){}}});
 assert.equal((await withReporter.status(null,1000)).enforcement.incidentReporting,'active');
 const without=new ShutdownService({repo:f.repo,notifier:f.notifier,getPolicy:policy,logger:{warn(){}}});
 assert.equal((await without.status(null,1000)).enforcement.incidentReporting,'unavailable');
});
