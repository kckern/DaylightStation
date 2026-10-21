import { it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlaybackBudgetService } from '../application/PlaybackBudgetService.mjs';
import { YamlPlaybackBudgetStore } from '../adapters/persistence/YamlPlaybackBudgetStore.mjs';
import { createFitnessPlaybackBudgetsRouter } from './fitnessPlaybackBudgets.mjs';
import { PlaybackBudgetController } from '../../browser/player/PlaybackBudgetController.js';

it('enforces 15 minutes over two episodes through the native meter, API and durable store; reload, adult and midnight', async () => {
 const dir=mkdtempSync(path.join(tmpdir(),'budget-integration-'));
 try {
 let now=Date.UTC(2026,9,18,12);const start=now;
 const makeService=()=>new PlaybackBudgetService({
 store:new YamlPlaybackBudgetStore({configService:{getHouseholdPath:()=>dir}}),
 policyConfig:()=>({governance:{superusers:['parent'],exemptions:['exempt-rider'],playback_budgets:[{id:'family-time',match:'governed',when:'unattended',limit_minutes:15}]},governedLabels:['ExerciseFun']}),
 contentCatalog:{getItem:async()=>({metadata:{labels:['ExerciseFun']}})},clock:{now:()=>now},
 calendar:t=>({localDate:new Date(t).toISOString().slice(0,10),nextResetAt:Date.parse(new Date(t).toISOString().slice(0,10))+86400000}),deviceDirectory:()=>({tv:{}}),userDirectory:id=>({child:{},'exempt-rider':{}})[id]??null,logger:{info(){}} });
 const app=express();app.use(express.json());app.use('/budget',createFitnessPlaybackBudgetsRouter({service:makeService(),householdId:'test'}));
 const media=new EventTarget();Object.assign(media,{paused:true,readyState:4,seeking:false});
 media.pause=()=>{if(!media.paused){media.paused=true;media.dispatchEvent(new Event('pause'));}};
 media.play=async()=>{media.paused=false;media.dispatchEvent(new Event('play'));if(!media.paused)media.dispatchEvent(new Event('playing'));};
 let state;const meter=new PlaybackBudgetController({deviceId:'tv',streamId:'meter',now:()=>now-start,publish:s=>state=s,observe:async body=>{
 const response=await request(app).post('/budget/observe').send(body).expect(200);
 expect(response.headers['cache-control']).toBe('no-store');return response.body;
 }});
 let input={media,contentId:'episode-1',matching:true,canPlay:true,participantIds:['child'],supervised:false};
 meter.update(input);await meter.pending;
 for(let i=0;i<180;i++) {
   if(i===90){input={...input,contentId:'episode-2'};meter.update(input);await meter.pending;}
   now+=5000;meter.tick();await meter.pending;
 }
 expect(state.status).toBe('exhausted');expect(state.blocked).toBe(true);expect(media.paused).toBe(true);
 const reloaded=makeService();expect((await reloaded.status({householdId:'test',deviceId:'tv'})).policies[0]).toMatchObject({spentMs:900000,remainingMs:0});
 let view=await reloaded.observe({householdId:'test',deviceId:'tv',streamId:'new-browser',sequence:1,participantIds:['parent'],requestGrant:false});
 expect(view.policies[0].spentMs).toBe(0);const generation=view.generation;
 view=await reloaded.observe({householdId:'test',deviceId:'tv',streamId:'new-browser',sequence:2,participantIds:['parent'],requestGrant:false});
 expect(view.generation).toBe(generation);
 view=await reloaded.observe({householdId:'test',deviceId:'tv',streamId:'new-browser',sequence:3,participantIds:['child'],contentId:'episode-2',requestGrant:true});
 expect(view.policies[0].grant.ms).toBe(5000);
 now+=86400000;expect((await reloaded.status({householdId:'test',deviceId:'tv'})).policies[0].spentMs).toBe(0);
 for(const [n,ids] of [[10,['exempt-rider']],[11,['no-profile']]]) {
  const v=await reloaded.observe({householdId:'test',deviceId:'tv',streamId:'new-browser',sequence:n,participantIds:ids,contentId:'episode-2',requestGrant:true});
  expect(v.policies[0].grant??null).toBeNull();expect(v.policies[0].spentMs).toBe(0);
 }
 await request(app).post('/budget/observe').send({deviceId:'unconfigured',streamId:'bad',sequence:1}).expect(400);
 } finally {rmSync(dir,{force:true,recursive:true});}
},30000);
