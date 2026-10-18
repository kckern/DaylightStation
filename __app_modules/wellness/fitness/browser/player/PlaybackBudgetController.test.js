import { describe, it, expect } from 'vitest';
import { PlaybackBudgetController } from './PlaybackBudgetController.js';
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
 h.media.pause();await h.flush();expect(h.calls.at(-1)).toMatchObject({playedMs:3000,requestGrant:false});expect(h.spent()).toBe(3000);
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
