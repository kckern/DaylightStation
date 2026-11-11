import { describe, it, expect, vi } from 'vitest';
import { PlaybackBudgetController, OBSERVE_TIMEOUT_MS } from './PlaybackBudgetController.js';
function harness() {
 let now=0;const calls=[];let fail=false;let balance=900000;
 const media=new EventTarget();Object.assign(media,{paused:true,readyState:4,seeking:false,currentTime:0,playbackRate:1});
 media.pause=()=>{if(media.paused)return;media.paused=true;media.dispatchEvent(new Event('pause'));};
 media.play=async()=>{media.paused=false;media.dispatchEvent(new Event('play'));if(!media.paused)media.dispatchEvent(new Event('playing'));};
 let state;const controller=new PlaybackBudgetController({deviceId:'tv',streamId:'browser',now:()=>now,publish:s=>state=s,
 observe:async body=>{calls.push(body);if(fail)throw Error('offline');if(body.previousGrantId)balance+=5000-body.playedMs;
 if(body.participantIds.includes('parent'))balance=900000;
 const ms=body.requestGrant?Math.min(5000,balance):0;balance-=ms;
 return {generation:1,localDate:'2026-10-18',serverNow:now,nextResetAt:86400000,supervised:body.participantIds.includes('parent'),policies:[{id:'unattended',remainingMs:balance,expired:balance===0,grant:ms?{id:'g'+calls.length,ms,expiresAt:now+15000,localDate:'2026-10-18'}:null}]};}});
 const input={media,contentId:'video',matching:true,canPlay:true,participantIds:['child'],supervised:false};
 return {controller,media,calls,input,get state(){return state;},advance(ms){now+=ms;controller.tick();},offline(){fail=true;},async flush(){await controller.pending;},spent:()=>900000-balance};
}
describe('native playback budget controller',()=>{
 it('acquires before play and spends wall time, not seek distance or playback rate',async()=>{
 const h=harness();h.controller.update(h.input);await h.flush();expect(h.state.blocked).toBe(false);
 await h.media.play();h.advance(2000);h.media.currentTime=600;h.media.playbackRate=2;h.advance(1000);
 h.media.pause();await h.flush();expect(h.calls.at(-1)).toMatchObject({requestGrant:false});
 expect(h.calls.reduce((n,c)=>n+(c.playedMs||0),0)).toBe(3000);expect(h.spent()).toBe(3000);
 });
 it('does not charge paused, seeking or buffering intervals',async()=>{
 const h=harness();h.controller.update(h.input);await h.flush();await h.media.play();h.advance(1000);
 h.media.dispatchEvent(new Event('waiting'));h.advance(120000);await h.flush();
 expect(h.calls.some(c=>c.playedMs===1000)).toBe(true);
 expect(h.calls.filter(c=>c.playedMs).reduce((n,c)=>n+c.playedMs,0)).toBe(1000);
 });
 it('stops at the end of an acknowledged grant during an outage and rejects resume',async()=>{
 const h=harness();h.controller.update(h.input);await h.flush();await h.media.play();h.offline();h.advance(5000);await h.flush();
 expect(h.media.paused).toBe(true);expect(h.state.blocked).toBe(true);
 await h.media.play();expect(h.media.paused).toBe(true);
 });
 it('observes supervisor joins without a mounted player and does not meter supervised media',async()=>{
 const h=harness();h.controller.update({...h.input,media:null,contentId:null,matching:false,participantIds:['parent'],supervised:true});await h.flush();
 expect(h.calls.at(-1)).toMatchObject({participantIds:['parent'],requestGrant:false});expect(h.state.blocked).toBe(false);
 });
 it('settles on content change and never charges unmatched content',async()=>{
 const h=harness();h.controller.update(h.input);await h.flush();await h.media.play();h.advance(1000);
 h.controller.update({...h.input,contentId:'other',matching:false});await h.flush();expect(h.calls.at(-1)).toMatchObject({playedMs:1000,requestGrant:false});expect(h.state.blocked).toBe(false);
 });
 it('settles unused time on unmount',async()=>{
 const h=harness();h.controller.update(h.input);await h.flush();await h.media.play();h.advance(1250);
 await h.controller.dispose();expect(h.calls.at(-1)).toMatchObject({playedMs:1250,requestGrant:false});
 });
});

it('does not mistake queued native pause events during renewal for manual pause', async () => {
 const h=harness();
 h.media.pause=()=>{if(h.media.paused)return;h.media.paused=true;setTimeout(()=>h.media.dispatchEvent(new Event('pause')),0);};
 h.controller.update(h.input);await h.flush();await h.media.play();h.advance(5000);await h.flush();
 await new Promise(resolve=>setTimeout(resolve,10));await h.flush();
 expect(h.controller.manualPause).toBe(false);expect(h.media.paused).toBe(false);
 h.advance(2000);expect(h.controller.used).toBe(2000);
});

it('renews ahead of the grant: continuous play never pauses and every millisecond is metered', async () => {
 const h=harness();let pauses=0;h.media.addEventListener('pause',()=>{pauses+=1;});
 h.controller.update(h.input);await h.flush();await h.media.play();
 for(let i=0;i<600;i+=1){h.advance(50);await h.flush();}
 expect(h.media.paused).toBe(false);expect(pauses).toBe(0);
 h.media.pause();await h.flush();
 expect(h.spent()).toBe(30000);
});
it('a slow renewal keeps playing on the current grant and charges the in-flight time to the next one', async () => {
 const h=harness();h.controller.update(h.input);await h.flush();await h.media.play();
 const observe=h.controller.observe;let release;h.controller.observe=body=>new Promise(r=>{release=()=>r(observe(body));});
 h.advance(3000); // 2000 left -> renewal starts, stays in flight
 await Promise.resolve();
 h.advance(1500); // still on the old grant
 expect(h.media.paused).toBe(false);
 release();await h.flush();h.controller.observe=observe;
 expect(h.controller.used).toBe(1500);
 h.media.pause();await h.flush();expect(h.spent()).toBe(4500);
});
it('holds when the old grant runs out before a slow renewal answers', async () => {
 const h=harness();h.controller.update(h.input);await h.flush();await h.media.play();
 const observe=h.controller.observe;let release;h.controller.observe=body=>new Promise(r=>{release=()=>r(observe(body));});
 h.advance(3000);await Promise.resolve();h.advance(2500);
 expect(h.media.paused).toBe(true);
 release();await h.flush();await new Promise(r=>setTimeout(r,0));h.controller.observe=observe;
 expect(h.media.paused).toBe(false);
});
it('polls the server once a minute when there is nothing to meter', async () => {
 const h=harness();h.controller.update({...h.input,media:null,contentId:null,matching:false});await h.flush();
 const before=h.calls.length;for(let i=0;i<59;i+=1)h.advance(1000);await h.flush();
 expect(h.calls.length).toBe(before);h.advance(1000);await h.flush();expect(h.calls.length).toBe(before+1);
});
it('does not meter when no governed child is on the roster', async () => {
 const h=harness();h.controller.update({...h.input,hasSubject:false});await h.flush();
 await h.media.play();h.advance(6000);await h.flush();
 expect(h.media.paused).toBe(false);expect(h.spent()).toBe(0);
 expect(h.calls.every(c=>c.requestGrant===false)).toBe(true);
});

// 2026-11-10 (garage, Forza video): governance held the video (videoLocked, so
// canPlay false) and the budget asked for no grant while held, so its status sat
// on 'checking' and its cover said "Waiting for playback allowance" over the
// governance lock, forever. Another hold owning the screen is now 'held', not blocked.
describe('budget under another hold, timeouts and the admin override', () => {
 it('a governance lock (canPlay false) is "held", not a blocking "checking" cover; the media stays held', async () => {
  const h=harness();h.controller.update({...h.input,canPlay:false});await h.flush();
  expect(h.calls.at(-1)).toMatchObject({requestGrant:false});
  expect(h.state).toMatchObject({blocked:false,status:'held'});
  await h.media.play();expect(h.media.paused).toBe(true); // the meter still refuses to run unpaid
  h.controller.update({...h.input,canPlay:true});await h.flush();await h.flush();
  expect(h.calls.at(-1)).toMatchObject({requestGrant:true});
  expect(h.state).toMatchObject({blocked:false,status:'ready'});
 });
 it('an exhausted budget still shows while another hold is up', async () => {
  const h=harness();h.controller.update(h.input);await h.flush();
  const exhausted={generation:1,serverNow:0,policies:[{id:'unattended',remainingMs:0,expired:true,grant:null}]};
  h.controller.observe=async()=>exhausted;
  h.controller.update({...h.input,canPlay:false});await h.flush();
  expect(h.state).toMatchObject({blocked:true,status:'exhausted'});
 });
 it('a budget read that never answers becomes "unavailable" (retried), not an endless "checking"', async () => {
  vi.useFakeTimers();
  try {
   const h=harness();h.controller.observe=()=>new Promise(()=>{});
   h.controller.update(h.input);
   expect(h.state).toMatchObject({blocked:true,status:'checking'});
   await vi.advanceTimersByTimeAsync(OBSERVE_TIMEOUT_MS+10);
   expect(h.state).toMatchObject({blocked:true,status:'unavailable'});
  } finally { vi.useRealTimers(); }
 });
 it('an admin override lifts the meter for the item: not blocked, no grant asked, playback resumes', async () => {
  const h=harness();const exhausted={generation:1,serverNow:0,policies:[{id:'unattended',remainingMs:0,expired:true,grant:null}]};
  h.controller.observe=async(body)=>{h.calls.push(body);return exhausted;};
  h.controller.update(h.input);await h.flush();expect(h.state).toMatchObject({blocked:true,status:'exhausted'});
  h.controller.resume=true;
  h.controller.update({...h.input,override:true});await h.flush();
  expect(h.state).toMatchObject({blocked:false,status:'overridden'});
  expect(h.calls.at(-1)).toMatchObject({requestGrant:false});
  h.controller.tryResume();expect(h.media.paused).toBe(false);
 });
 it('logs a status change at debug and a blocking change at info', async () => {
  const logs=[];const h=harness();h.controller.logger={info:(e,d)=>logs.push(['info',e,d]),debug:(e,d)=>logs.push(['debug',e,d]),warn:()=>{}};
  h.controller.update({...h.input,canPlay:false});await h.flush();
  h.controller.update({...h.input,canPlay:true});await h.flush();await h.flush();
  const status=logs.filter(([,e])=>e==='fitness.playback_budget.status').map(([l,,d])=>[l,d.to,d.blocked]);
  expect(status).toContainEqual(['info','held',false]); // the cover came down: info
  expect(status.at(-1).slice(1)).toEqual(['ready',false]);
  // info exactly when the cover goes up or down, debug otherwise.
  status.forEach((s,i)=>{ if(i>0) expect(s[0]).toBe(s[2]!==status[i-1][2]?'info':'debug'); });
  // Each line is a change: never the same status twice in a row.
  status.slice(1).forEach((s,i)=>expect(s[1]!==status[i][1]||s[2]!==status[i][2]).toBe(true));
 });
});
