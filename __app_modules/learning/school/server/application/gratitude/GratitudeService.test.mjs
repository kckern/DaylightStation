import { describe,it,expect,vi } from 'vitest';
import { GratitudeService } from './GratitudeService.mjs';
import { GRATITUDE_FOLLOW_UP_FALLBACK, GRATITUDE_FOLLOW_UP_FALLBACK_KO } from './GratitudeFollowUpWriter.mjs';
import { gratitudeConfigOf } from '../../domain/gratitude.mjs';

function harness({ verdict='eligible', publishFailure=false, verdicts=null, writerFails=false, followUpEnabled=true, logger={}, followUpWriter=null }={}) {
  const days=new Map(), selections=new Map(); let now=new Date('2026-11-16T18:00:00Z'); let fail=publishFailure; let assessment=verdict; let calls=0;
  const queue=verdicts?[...verdicts]:[]; const judgeCalls=[]; const extracted=[];
  const store={ async read(id,day){return {status:days.has(day)?'ok':'missing',events:structuredClone(days.get(day)??[])};},async append(id,day,event){days.set(day,[...(days.get(day)??[]),structuredClone(event)]);},async listDays(){return [...days.keys()].sort();} };
  const deps={store,assignments:{get:async()=>({programs:[{programId:'gratitude',schedule:{daysOfWeek:[1,2,3,4,5]}}]})},clock:()=>now,timezone:'America/Los_Angeles',
    config:gratitudeConfigOf({gratitude:{follow_up:{enabled:followUpEnabled}}}),
    judge:{assess:async args=>{calls++;judgeCalls.push(args);const v=queue.length?queue.shift():assessment;return {verdict:v,confidence:.99,model:'test',rubricVersion:1,matchedId:v==='repetition'?'school-gratitude:child:2026-11-16':null};}},
    followUpWriter:followUpWriter??{write:async()=>writerFails?{question:GRATITUDE_FOLLOW_UP_FALLBACK,writer:'fallback'}:{question:'What about your mom are you grateful for today?',writer:'model'}},
    extractor:{extract:async({text})=>{extracted.push(text);return {subject:'Toys',model:'cheap'};}},publish:async body=>{selections.set(body.selectionId,body);if(fail)throw new Error('lost response');return {selectionId:body.selectionId,subject:body.subject};},logger};
  return {service:new GratitudeService(deps),restart:()=>new GratitudeService(deps),days,selections,setNow:value=>{now=new Date(value);},setVerdict:value=>{assessment=value;},restore:()=>{fail=false;},calls:()=>calls,judgeCalls:()=>judgeCalls,extracted:()=>extracted};
}
const body={attemptId:'attempt-1',text:"I'm grateful for my toys",via:'typed',audioRef:null,edited:false};
describe('School gratitude workflow',()=>{
  it('restores a server-saved take when the upload response was lost',async()=>{
    const h=harness();
    h.days.set('2026-11-16',[{type:'take-saved',at:'2026-11-16T18:00:00Z',takeId:'take-1',audioRef:'child/2026-11-16-1.webm',text:'My toys'}]);
    expect((await h.restart().day('child','2026-11-16')).draft).toMatchObject({text:'My toys',audioRef:'child/2026-11-16-1.webm',takeId:'take-1',via:'voice'});
  });
  it('publishes one accepted subject before completing and replays duplicate attempts',async()=>{
    const h=harness();
    expect(await h.service.submit('child','2026-11-16',body)).toMatchObject({phase:'completed',subject:'Toys'});
    await h.service.submit('child','2026-11-16',body);
    expect(h.selections.size).toBe(1);expect(h.calls()).toBe(1);
    await expect(h.service.submit('child','2026-11-16',{...body,text:'Different'})).rejects.toMatchObject({status:409});
  });
  it('persists a nonsense cooldown and does not extend it on blocked requests',async()=>{
    const h=harness({verdict:'nonsense'});
    expect(await h.service.submit('child','2026-11-16',{...body,text:'stinky stinky lalalal'})).toMatchObject({phase:'cooldown',retryAt:'2026-11-16T18:30:00.000Z'});
    h.setNow('2026-11-16T18:20:00Z');
    await expect(h.restart().submit('child','2026-11-16',{...body,attemptId:'attempt-2'})).rejects.toMatchObject({status:429,retryAt:'2026-11-16T18:30:00.000Z'});
    expect(h.calls()).toBe(1);expect(h.selections.size).toBe(0);
    h.setNow('2026-11-16T18:30:00Z');h.setVerdict('eligible');
    expect((await h.restart().submit('child','2026-11-16',{...body,attemptId:'attempt-2'})).phase).toBe('completed');
  });
  it('recovers a crash after publication with the same durable identity',async()=>{
    const h=harness({publishFailure:true});
    expect((await h.service.submit('child','2026-11-16',body)).phase).toBe('pending');
    h.restore();
    expect((await h.restart().retry('child','2026-11-16',{attemptId:'attempt-1'})).phase).toBe('completed');
    expect(h.selections.size).toBe(1);expect(h.calls()).toBe(1);
  });
  it('keeps uncertain answers and technical failures free of behavioral penalties',async()=>{
    const h=harness({verdict:'uncertain'});
    expect(await h.service.submit('child','2026-11-16',body)).toMatchObject({phase:'retry',reason:'unclear',retryAt:null});
    h.setVerdict('unavailable');
    expect(await h.service.submit('child','2026-11-16',{...body,attemptId:'attempt-2'})).toMatchObject({phase:'pending',reason:'service',retryAt:null});
    expect(h.selections.size).toBe(0);
  });
  it('serializes competing tabs so a refusal prevents a queued new attempt',async()=>{
    const h=harness({verdict:'nonsense'});
    const outcomes=await Promise.allSettled([h.service.submit('child','2026-11-16',body),h.service.submit('child','2026-11-16',{...body,attemptId:'other-attempt'})]);
    expect(outcomes[0].value.phase).toBe('cooldown');expect(outcomes[1].reason.status).toBe(429);expect(h.calls()).toBe(1);
  });
  it('rejects borrowed audio and corrupt history without a cheating verdict',async()=>{
    const h=harness();
    await expect(h.service.submit('child','2026-11-16',{...body,audioRef:'other/take.webm',via:'voice'})).rejects.toMatchObject({status:400});
    expect(h.calls()).toBe(0);
  });
  it('recovers yesterday pending work into its original day before accepting fresh work',async()=>{
    const h=harness({publishFailure:true});await h.service.submit('child','2026-11-16',body);
    h.setNow('2026-11-17T18:00:00Z');h.restore();
    await h.restart().open('child','2026-11-17');
    expect(h.days.get('2026-11-16').at(-1).type).toBe('completed');
    expect((await h.restart().day('child','2026-11-17')).phase).not.toBe('completed');
    await expect(h.service.submit('child','2026-11-16',{...body,attemptId:'backdate'})).rejects.toMatchObject({status:409});
  });
  it('asks one follow-up for a general answer and publishes the combined answer',async()=>{
    const h=harness({verdicts:['general','eligible']});
    const asked=await h.service.submit('child','2026-11-16',{...body,text:"I'm grateful for my mom"});
    expect(asked).toMatchObject({phase:'follow-up',followUp:{question:'What about your mom are you grateful for today?',firstText:"I'm grateful for my mom"},next:{kind:'respond'}});
    expect(h.selections.size).toBe(0);
    const done=await h.service.submit('child','2026-11-16',{...body,attemptId:'attempt-2',followUpOf:'attempt-1',text:'She made me pancakes'});
    expect(done.phase).toBe('completed');
    expect(h.judgeCalls()[0]).toMatchObject({allowFollowUp:true});
    expect(h.judgeCalls()[1]).toMatchObject({allowFollowUp:false,text:"I'm grateful for my mom\nShe made me pancakes"});
    expect(h.extracted()).toEqual(["I'm grateful for my mom\nShe made me pancakes"]);
  });
  it('never asks twice in a day',async()=>{
    const h=harness({verdicts:['general','uncertain','eligible']});
    await h.service.submit('child','2026-11-16',body);
    await h.service.submit('child','2026-11-16',{...body,attemptId:'attempt-2',followUpOf:'attempt-1',text:'um'});
    await h.service.submit('child','2026-11-16',{...body,attemptId:'attempt-3',text:'Mom reading to me'});
    expect(h.judgeCalls().map(c=>c.allowFollowUp)).toEqual([true,false,false]);
  });
  it('requires the follow-up to be answered as a follow-up, and refuses a stray one',async()=>{
    const h=harness({verdicts:['general']});
    await h.service.submit('child','2026-11-16',body);
    await expect(h.service.submit('child','2026-11-16',{...body,attemptId:'attempt-2',text:'pancakes'})).rejects.toMatchObject({status:409});
    const fresh=harness();
    await expect(fresh.service.submit('child','2026-11-16',{...body,followUpOf:'attempt-0'})).rejects.toMatchObject({status:409});
  });
  it('survives a restart between the general verdict and the question',async()=>{
    const h=harness({verdicts:['general'],writerFails:true});
    expect((await h.service.submit('child','2026-11-16',body)).phase).toBe('follow-up');
    expect(h.days.get('2026-11-16').find(e=>e.type==='follow-up-asked')).toMatchObject({writer:'fallback'});
    const r=harness();
    r.days.set('2026-11-16',[{type:'opened',at:'2026-11-16T17:59:00Z'},{type:'submitted',at:'2026-11-16T17:59:10Z',...body},
      {type:'assessed',at:'2026-11-16T17:59:20Z',attemptId:'attempt-1',verdict:'general',confidence:.99,model:'test',rubricVersion:5,matchedId:null}]);
    expect((await r.restart().open('child','2026-11-16')).phase).toBe('follow-up');
    expect(r.calls()).toBe(0);
  });
  it('keeps drafts in the follow-up phase',async()=>{
    const h=harness({verdicts:['general']});
    await h.service.submit('child','2026-11-16',body);
    expect((await h.service.saveDraft('child','2026-11-16',{text:'pan',via:'typed'})).phase).toBe('follow-up');
  });
  it('skips the follow-up when switched off',async()=>{
    const h=harness({verdicts:['eligible'],followUpEnabled:false});
    await h.service.submit('child','2026-11-16',body);
    expect(h.judgeCalls()[0].allowFollowUp).toBe(false);
  });
  it('accepts a second general verdict as eligible instead of asking again',async()=>{
    const h=harness({verdicts:['general','general']});
    await h.service.submit('child','2026-11-16',body);
    const done=await h.service.submit('child','2026-11-16',{...body,attemptId:'attempt-2',followUpOf:'attempt-1',text:'She is nice'});
    expect(done.phase).toBe('completed');
    expect(h.days.get('2026-11-16').filter(e=>e.type==='follow-up-asked')).toHaveLength(1);
  });
  it('accepts a general verdict as eligible when follow-ups are off',async()=>{
    const h=harness({verdicts:['general'],followUpEnabled:false});
    expect((await h.service.submit('child','2026-11-16',body)).phase).toBe('completed');
    expect(h.days.get('2026-11-16').some(e=>e.type==='follow-up-asked')).toBe(false);
  });
  it('treats a null followUpOf as absent and refuses one that is not an id string',async()=>{
    expect((await harness().service.submit('child','2026-11-16',{...body,followUpOf:null})).phase).toBe('completed');
    for(const followUpOf of [7,{id:'a'},'bad id!'])
      await expect(harness().service.submit('child','2026-11-16',{...body,followUpOf})).rejects.toMatchObject({status:400});
  });
  it('logs a pending failure by error name and code, never its message',async()=>{
    const warn=vi.fn();const h=harness({publishFailure:true,logger:{warn,info(){}}});
    await h.service.submit('child','2026-11-16',body);
    expect(warn).toHaveBeenCalledWith('school.gratitude.pending',{learnerId:'child',day:'2026-11-16',error:'Error',code:null});
    expect(JSON.stringify(warn.mock.calls)).not.toContain('lost response');
  });
  it('replaces an unusable or throwing writer with the fixed question in the child\'s language',async()=>{
    const h=harness({verdicts:['general'],followUpWriter:{write:async()=>{throw new Error('down');}}});
    expect((await h.service.submit('child','2026-11-16',{...body,text:'엄마'})).followUp.question).toBe(GRATITUDE_FOLLOW_UP_FALLBACK_KO);
    const g=harness({verdicts:['general'],followUpWriter:{write:async()=>({question:'Visit abc.com?',writer:'model'})}});
    expect((await g.service.submit('child','2026-11-16',body)).followUp).toMatchObject({question:GRATITUDE_FOLLOW_UP_FALLBACK});
    expect(g.days.get('2026-11-16').find(e=>e.type==='follow-up-asked').writer).toBe('fallback');
  });
  it('fills the retry box with both answers after an unclear follow-up answer',async()=>{
    const h=harness({verdicts:['general','uncertain']});
    await h.service.submit('child','2026-11-16',{...body,text:"I'm grateful for my mom"});
    const retry=await h.service.submit('child','2026-11-16',{...body,attemptId:'attempt-2',followUpOf:'attempt-1',text:'um'});
    expect(retry).toMatchObject({phase:'retry',reason:'unclear',followUp:null,draft:{text:"I'm grateful for my mom\num"}});
  });
  it('still asks the follow-up for a general verdict stored before follow-ups were switched off',async()=>{
    const r=harness({followUpEnabled:false});
    r.days.set('2026-11-16',[{type:'opened',at:'2026-11-16T17:59:00Z'},{type:'submitted',at:'2026-11-16T17:59:10Z',...body},
      {type:'assessed',at:'2026-11-16T17:59:20Z',attemptId:'attempt-1',verdict:'general',confidence:.99,model:'test',rubricVersion:5,matchedId:null}]);
    expect((await r.restart().open('child','2026-11-16')).phase).toBe('follow-up');
  });
});
