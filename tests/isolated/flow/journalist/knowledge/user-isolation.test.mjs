import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DebriefRepository} from '../../../../../__app_modules/personal/journalist/server/adapters/DebriefRepository.mjs';
import {GenerateMorningDebrief} from '../../../../../__app_modules/personal/journalist/server/application/usecases/GenerateMorningDebrief.mjs';
import {HandleDebriefResponse} from '../../../../../__app_modules/personal/journalist/server/application/usecases/HandleDebriefResponse.mjs';
import {SendMorningDebrief} from '../../../../../__app_modules/personal/journalist/server/application/usecases/SendMorningDebrief.mjs';
it('keeps cached facts, headlines, source summaries and subsequent writes scoped to the requested user',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'journalist-users-')),logger={info(){},warn(){},error(){}};
 try{
  const repo=new DebriefRepository({dataDir:root,username:'sample',logger});
  await repo.appendDebrief({date:'2026-11-02',summary:'PRIVATE FIRST USER',headline:'Private headline',summaries:[{source:'journal',text:'PRIVATE SOURCE'}]},'sample');
  const generator=new GenerateMorningDebrief({debriefRepository:repo,lifelogAggregator:{aggregate:async()=>({_meta:{date:'2026-11-02',hasEnoughData:true,sources:['calendar']},summaryText:'Other user activity.',summaries:[{source:'calendar',text:'OTHER SOURCE'}]})},aiGateway:{chat:async()=> 'HOOK: Other user activity\nOther user facts.'},followUpSource:{selectForMorning:async()=>({mode:'legacy',reason:'control',selectionId:'other-control',askDate:'2026-11-03',questions:[]})},logger});
  const result=await generator.execute({username:'other',date:'2026-11-02',askDate:'2026-11-03',asOf:Date.parse('2026-11-03T15:00Z')});
  expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(result.summary).toBe('Other user facts.');
  const sender=new SendMorningDebrief({debriefRepository:repo,messagingGateway:{sendMessage:async()=>({messageId:'200'})},logger});
  await sender.execute({conversationId:'telegram:b42_c202',debrief:result});
  expect((await repo.getDebriefByDate('2026-11-02','sample')).summary).toBe('PRIVATE FIRST USER');
  expect((await repo.getDebriefByDate('2026-11-02','other')).summary).toBe('Other user facts.');
  expect((await repo.getRecentDebriefs('other',1))[0].summary).toBe('Other user facts.');
  const details=new HandleDebriefResponse({debriefRepository:repo,conversationStateStore:{get:async()=>({activeFlow:'morning_debrief'}),set:async()=>{}},messagingGateway:{sendMessage:async()=>({messageId:'201'})},logger});
  expect((await details.execute({conversationId:'telegram:b42_c202',userId:'other',text:'📊 Details'})).sources).toEqual(['calendar']);
  await expect(repo.getAllDebriefs('../sample')).rejects.toThrow();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
