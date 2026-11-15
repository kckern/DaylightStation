import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGratitudeRuntime} from './gratitude-runtime.mjs';
import {YamlProgramDayStore} from '../adapters/persistence/YamlProgramDayStore.mjs';
import {YamlGratitudeStore} from '../adapters/persistence/YamlGratitudeStore.mjs';
import {createGratitudeServices} from '../../../../personal/gratitude/server/public.mjs';
import {NodeAsyncScheduler} from '../../../../../__backend/src/1_adapters/scheduling/NodeAsyncScheduler.mjs';
it('keeps School pending when its owner reports a boolean write failure, then recovers',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'gratitude-write-failure-'));const data=new Map();let failing=true;
  const write=(key,value)=>{if(failing)return false;data.set(key,structuredClone(value));return true;};
  const owner=createGratitudeServices({dataService:{household:{read:key=>data.get(key)??null,write,writeAtomic:write}},logger:{}});
  const {service}=createGratitudeRuntime({configService:{getHouseholdAppConfig:()=>({}),getMediaDir:()=>root},store:new YamlProgramDayStore({rootDir:path.join(root,'records')}),assignments:{get:async()=>({programs:[{programId:'gratitude'}]})},scheduler:new NodeAsyncScheduler(),clock:()=>new Date('2026-11-16T18:00:00Z'),logger:{},
    decisionGateway:{evaluate:async()=>({model:'test',answers:{effort:{type:'yesNo',probability:.99}}})},aiGateway:{chatStructured:async()=>({subject:'Toys'})},publish:body=>owner.publishSchoolGratitude({...body,householdId:'home'}),
  });
  try{
    expect((await service.submit('child','2026-11-16',{attemptId:'a',text:'My toys',via:'typed'})).phase).toBe('pending');
    expect(data.size).toBe(0);
    failing=false;
    expect((await service.retry('child','2026-11-16',{attemptId:'a'})).phase).toBe('completed');
    expect(data.get('gratitude/selections.gratitude.yml')).toHaveLength(1);
  }finally{rmSync(root,{recursive:true,force:true});}
});

it('connects persisted School evidence to exactly one normal Gratitude selection',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'gratitude-assembly-'));
  const data=new Map();let decisions=0;
  const owner=createGratitudeServices({dataService:{household:{read:key=>structuredClone(data.get(key)??null),write:(key,value)=>data.set(key,structuredClone(value)),writeAtomic:(key,value)=>{data.set(key,structuredClone(value));return true;}}},logger:{}});
  const configService={getHouseholdAppConfig:()=>({}),getMediaDir:()=>path.join(root,'media'),getHouseholdPath:p=>path.join(root,p)};
  const store=new YamlGratitudeStore({configService});
  const defaults={configService,store,assignments:{get:async()=>({programs:[{programId:'gratitude'}]})},scheduler:new NodeAsyncScheduler(),clock:()=>new Date('2026-11-16T18:00:00Z'),timezone:'America/Los_Angeles',logger:{}};
  try{
    const {service}=createGratitudeRuntime({...defaults,
      decisionGateway:{isConfigured:()=>true,evaluate:async()=>{decisions++;return {model:'test-jev',answers:{effort:{type:'yesNo',probability:.99}}};}},
      aiGateway:{chatStructured:async()=>({subject:'Toys'})},publish:body=>owner.publishSchoolGratitude({...body,householdId:'home'}),
    });
    const input={attemptId:'first',text:"I'm grateful for my toys",via:'typed',audioRef:null,edited:false};
    await Promise.all([service.submit('child','2026-11-16',input),service.submit('child','2026-11-16',input)]);
    expect((await service.day('child','2026-11-16')).phase).toBe('completed');
    expect(data.get('gratitude/selections.gratitude.yml')).toHaveLength(1);
    expect(data.get('gratitude/selections.gratitude.yml')[0]).toMatchObject({userId:'child',item:{text:'Toys'}});
    expect((await store.read('child','2026-11-16')).events.map(e=>e.type)).toEqual(['submitted','assessed','publication-pending','completed']);
    expect(decisions).toBe(1);
    const offline=createGratitudeRuntime({...defaults,publish:()=>{throw new Error('Must not publish unassessed input');}});
    expect((await offline.service.submit('other','2026-11-16',input)).phase).toBe('pending');
    expect(data.get('gratitude/selections.gratitude.yml')).toHaveLength(1);
  }finally{rmSync(root,{recursive:true,force:true});}
});

it('persists a take before transcription and retries its existing audio without duplicate text',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'gratitude-take-recovery-'));let offline=true;
  const configService={getHouseholdAppConfig:()=>({}),getMediaDir:()=>path.join(root,'media'),getHouseholdPath:p=>path.join(root,p)};
  const store=new YamlGratitudeStore({configService});
  const runtime=createGratitudeRuntime({configService,store,assignments:{get:async()=>({programs:[{programId:'gratitude'}]})},scheduler:new NodeAsyncScheduler(),clock:()=>new Date('2026-11-16T18:00:00Z'),logger:{},
    aiGateway:{transcribe:async()=>{
      expect((await store.read('child','2026-11-16')).events.some(e=>e.type==='take-saved')).toBe(true);
      if(offline)throw new Error('Transcriber down');return 'My toys';
    }},
  });
  try{
    const first=await runtime.service.take('child','2026-11-16',{takeId:'voice-a',buffer:Buffer.alloc(1001),mimeType:'audio/webm'});
    expect(first.text).toBeNull();
    expect((await runtime.service.day('child','2026-11-16')).draft).toMatchObject({takeId:'voice-a',audioRef:first.audioRef});
    offline=false;
    const second=await runtime.service.take('child','2026-11-16',{takeId:'voice-a',buffer:Buffer.alloc(0),mimeType:'audio/webm'});
    await runtime.service.take('child','2026-11-16',{takeId:'voice-a',buffer:Buffer.alloc(0),mimeType:'audio/webm'});
    expect(second.audioRef).toBe(first.audioRef);
    expect((await runtime.service.day('child','2026-11-16')).draft.text).toBe('My toys');
    expect(readdirSync(path.join(root,'media/school/gratitude/child'))).toHaveLength(1);
  }finally{rmSync(root,{recursive:true,force:true});}
});
