import { describe,it,expect,vi } from 'vitest';
import { GratitudeService } from './GratitudeService.mjs';
import { GRATITUDE_FOLLOW_UP_FALLBACK, GRATITUDE_FOLLOW_UP_FALLBACK_KO } from './GratitudeFollowUpWriter.mjs';
import { gratitudeConfigOf } from '../../domain/gratitude.mjs';
import { validGratitudeEvidence } from '../../domain/gratitudeEvidence.mjs';

function harness({ verdict='eligible', publishFailure=false, verdicts=null, writerFails=false, followUpEnabled=true, logger={}, followUpWriter=null, transcript='My toys', judgeDelay=null, config=null }={}) {
  const days=new Map(), selections=new Map(); let now=new Date('2026-11-16T18:00:00Z'); let fail=publishFailure; let assessment=verdict; let calls=0;
  const queue=verdicts?[...verdicts]:[]; const judgeCalls=[]; const extracted=[];
  const store={ async read(id,day){return {status:days.has(day)?'ok':'missing',events:structuredClone(days.get(day)??[])};},async append(id,day,event){const next=[...(days.get(day)??[]),structuredClone(event)];if(!validGratitudeEvidence(next))throw new Error('Invalid Gratitude evidence');days.set(day,next);},async listDays(){return [...days.keys()].sort();} };
  const deps={store,assignments:{get:async()=>({programs:[{programId:'gratitude',schedule:{daysOfWeek:[1,2,3,4,5]}}]})},clock:()=>now,timezone:'America/Los_Angeles',
    config:config??gratitudeConfigOf({gratitude:{follow_up:{enabled:followUpEnabled}}}),
    captureTake:async({onSaved})=>{const audioRef=`child/take-${days.size}-${Math.random().toString(36).slice(2,8)}.webm`;await onSaved({audioRef});return {audioRef,text:typeof transcript==='function'?transcript():transcript};},
    judge:{assess:async args=>{calls++;if(judgeDelay)await judgeDelay();judgeCalls.push(args);const v=queue.length?queue.shift():assessment;return {verdict:v,confidence:.99,model:'test',rubricVersion:1,matchedId:v==='repetition'?(args.history?.[0]?.id??'school-gratitude:child:2026-11-16'):null};}},
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
    // 2026-11-19: the queued one is a duplicate submit and gets the current state (the cooldown) instead of a 429.
    expect(outcomes[0].value.phase).toBe('cooldown');expect(outcomes[1].value).toMatchObject({phase:'cooldown',attemptId:'attempt-1'});expect(h.calls()).toBe(1);
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
  it('opens the retry box empty after an unclear follow-up answer',async()=>{
    const h=harness({verdicts:['general','uncertain']});
    await h.service.submit('child','2026-11-16',{...body,text:"I'm grateful for my mom"});
    const retry=await h.service.submit('child','2026-11-16',{...body,attemptId:'attempt-2',followUpOf:'attempt-1',text:'um'});
    expect(retry).toMatchObject({phase:'retry',reason:'unclear',followUp:null,draft:null});
  });
  it('still asks the follow-up for a general verdict stored before follow-ups were switched off',async()=>{
    const r=harness({followUpEnabled:false});
    r.days.set('2026-11-16',[{type:'opened',at:'2026-11-16T17:59:00Z'},{type:'submitted',at:'2026-11-16T17:59:10Z',...body},
      {type:'assessed',at:'2026-11-16T17:59:20Z',attemptId:'attempt-1',verdict:'general',confidence:.99,model:'test',rubricVersion:5,matchedId:null}]);
    expect((await r.restart().open('child','2026-11-16')).phase).toBe('follow-up');
  });
  it('rejects an empty take or the leaked transcription hint as unheard, keeping the draft',async()=>{
    for(const transcript of [null,'   ','A child saying what they are grateful for, in English or Korean.','a child saying what they are grateful for in english or korean']){
      const info=vi.fn();const h=harness({transcript,logger:{info}});
      await h.service.saveDraft('child','2026-11-16',{text:'My dog',via:'typed'});
      const result=await h.service.take('child','2026-11-16',{takeId:'take-1',buffer:Buffer.alloc(2000),mimeType:'audio/webm'});
      expect(result).toMatchObject({takeId:'take-1',text:null,unheard:true});
      expect(h.days.get('2026-11-16').at(-1)).toMatchObject({type:'take-unheard',takeId:'take-1'});
      expect((await h.service.day('child','2026-11-16')).draft).toMatchObject({text:'My dog'});
      expect(info).toHaveBeenCalledWith('school.gratitude.take-unheard',expect.objectContaining({learnerId:'child',day:'2026-11-16',takeId:'take-1'}));
    }
  });
  it('replaces the draft with each heard take',async()=>{
    const words=['Blah blah','Making cookies'];const h=harness({transcript:()=>words.shift()});
    await h.service.take('child','2026-11-16',{takeId:'take-1',buffer:Buffer.alloc(2000)});
    await h.service.take('child','2026-11-16',{takeId:'take-2',buffer:Buffer.alloc(2000)});
    expect((await h.service.day('child','2026-11-16')).draft).toMatchObject({text:'Making cookies',takeId:'take-2'});
  });
  it('answers a submit made while an attempt is being judged with the current state, starting nothing',async()=>{
    let release;const gate=new Promise(r=>{release=r;});
    const h=harness({verdict:'uncertain',judgeDelay:()=>gate});
    const first=h.service.submit('child','2026-11-16',body);
    await new Promise(r=>setTimeout(r,0));
    const taps=[2,3,4].map(n=>h.service.submit('child','2026-11-16',{...body,attemptId:`attempt-${n}`}));
    release();
    await first;const results=await Promise.all(taps);
    expect(h.calls()).toBe(1);
    expect(h.days.get('2026-11-16').filter(e=>e.type==='submitted')).toHaveLength(1);
    for(const r of results)expect(r).toMatchObject({phase:'retry',attemptId:'attempt-1'});
  });
});
describe('preschool verdict ladder',()=>{
  const pre=(opts={})=>harness({...opts,config:gratitudeConfigOf({gratitude:{preschool:['kid']}})});
  const seed=h=>h.days.set('2026-11-14',[{type:'opened',at:'2026-11-14T18:00:00Z'},{type:'submitted',at:'2026-11-14T18:00:01Z',attemptId:'old',text:'eating cookies',via:'typed',audioRef:null,edited:false},
    {type:'assessed',at:'2026-11-14T18:00:02Z',attemptId:'old',verdict:'eligible'},{type:'publication-pending',at:'2026-11-14T18:00:03Z',attemptId:'old',text:'eating cookies',subject:'Eating cookies',selectionId:'school-gratitude:kid:2026-11-14',timestamp:'2026-11-14T18:00:03Z'},
    {type:'completed',at:'2026-11-14T18:00:04Z',attemptId:'old',selectionId:'school-gratitude:kid:2026-11-14'}]);
  const say=(h,n,text='cookies')=>h.service.submit('kid','2026-11-16',{...body,attemptId:`a${n}`,text});
  it('reports the mode in the view',async()=>{
    expect((await pre().service.open('kid','2026-11-16')).mode).toBe('preschool');
    expect((await pre().service.open('child','2026-11-16')).mode).toBe('standard');
  });
  it('accepts an answer the judge cannot decide on, flagged for the teacher',async()=>{
    const info=vi.fn();const h=pre({verdict:'uncertain',logger:{info}});
    expect(await say(h,1)).toMatchObject({phase:'completed',flagged:true,subject:'Toys'});
    expect(h.days.get('2026-11-16').find(e=>e.type==='assessed')).toMatchObject({verdict:'eligible',flagged:'uncertain',judged:'uncertain'});
    expect(info).toHaveBeenCalledWith('school.gratitude.flagged',expect.objectContaining({learnerId:'kid',reason:'uncertain'}));
  });
  it('steers a repeat or a bare category without a break, then accepts the third good-faith answer flagged',async()=>{
    const info=vi.fn();const h=pre({verdicts:['repetition','general','repetition'],logger:{info}});
    seed(h);
    h.judgeCalls().length=0;
    const first=await say(h,1);
    expect(first).toMatchObject({phase:'steered',reason:'repetition',retryAt:null,draft:null,steer:{reason:'repetition',used:{subject:'Eating cookies',studyDay:'2026-11-14'}}});
    expect(first.steer.recent).toEqual(['Eating cookies']);
    expect(info).toHaveBeenCalledWith('school.gratitude.steered',expect.objectContaining({reason:'repetition'}));
    expect(await say(h,2,'mom')).toMatchObject({phase:'steered',reason:'general',steer:{reason:'general',used:null}});
    expect(h.days.get('2026-11-16').some(e=>e.type==='follow-up-asked')).toBe(false);
    expect(await say(h,3,'cookies again')).toMatchObject({phase:'completed',flagged:true});
    expect(h.days.get('2026-11-16').filter(e=>e.type==='assessed').at(-1)).toMatchObject({verdict:'eligible',flagged:'blue-limit',judged:'repetition'});
    expect(h.judgeCalls().map(c=>[c.allowFollowUp,c.askRude])).toEqual([[true,true],[true,true],[false,true]]);
  });
  it('warns on the first silly answer, breaks for five minutes on the second',async()=>{
    const info=vi.fn();const h=pre({verdict:'nonsense',logger:{info}});
    expect(await say(h,1,'blah blah')).toMatchObject({phase:'warned',retryAt:null,draft:null});
    expect(info).toHaveBeenCalledWith('school.gratitude.warned',expect.objectContaining({learnerId:'kid'}));
    expect(await say(h,2,'pff')).toMatchObject({phase:'cooldown',reason:'nonsense',retryAt:'2026-11-16T18:05:00.000Z',cooldownMs:300000});
    expect(info).toHaveBeenCalledWith('school.gratitude.refused',expect.objectContaining({reason:'nonsense'}));
  });
  it('a steer between two silly answers does not reset the silly count',async()=>{
    const h=pre({verdicts:['nonsense','repetition','nonsense']});
    seed(h);
    await say(h,1,'blah');await say(h,2,'cookies');
    expect((await say(h,3,'pff')).phase).toBe('cooldown');
  });
  it('rude goes straight to the break',async()=>{
    const info=vi.fn();const h=pre({verdict:'rude',logger:{info}});
    expect(await say(h,1,'You are stupid')).toMatchObject({phase:'cooldown',reason:'rude',retryAt:'2026-11-16T18:05:00.000Z'});
    expect(info).toHaveBeenCalledWith('school.gratitude.refused',expect.objectContaining({reason:'rude'}));
  });
  it('a finished break resets the silly count',async()=>{
    const h=pre({verdict:'nonsense'});
    await say(h,1,'blah');await say(h,2,'blah blah');
    h.setNow('2026-11-16T18:05:00Z');
    expect((await h.restart().open('kid','2026-11-16')).phase).toBe('retry');
    expect((await say(h,3,'pff')).phase).toBe('warned');
  });
  it('shows the break with its length on re-entry, and green after a completed day',async()=>{
    const h=pre({verdict:'rude'});await say(h,1,'stupid');
    h.setNow('2026-11-16T18:02:00Z');
    expect(await h.restart().open('kid','2026-11-16')).toMatchObject({phase:'cooldown',retryAt:'2026-11-16T18:05:00.000Z',cooldownMs:300000});
    const g=pre();await say(g,1);
    expect(await g.restart().open('kid','2026-11-16')).toMatchObject({phase:'completed',subject:'Toys',flagged:false});
  });
  it('leaves standard learners on the old ladder',async()=>{
    const h=pre({verdicts:['nonsense']});
    expect(await h.service.submit('child','2026-11-16',{...body,text:'blah'})).toMatchObject({phase:'cooldown',retryAt:'2026-11-16T18:30:00.000Z'});
    const u=pre({verdicts:['uncertain']});
    expect((await u.service.submit('child','2026-11-16',body)).phase).toBe('retry');
    expect(u.judgeCalls()[0].askRude).toBe(false);
  });
  const followedUp=()=>[{type:'opened',at:'2026-11-16T17:50:00Z'},{type:'submitted',at:'2026-11-16T17:50:01Z',attemptId:'f1',text:'my mom',via:'typed',audioRef:null,edited:false},
    {type:'assessed',at:'2026-11-16T17:50:02Z',attemptId:'f1',verdict:'general'},{type:'follow-up-asked',at:'2026-11-16T17:50:03Z',attemptId:'f1',question:'What about your mom are you grateful for today?',writer:'fallback'},
    {type:'submitted',at:'2026-11-16T17:50:04Z',attemptId:'f2',followUpOf:'f1',text:'um',via:'typed',audioRef:null,edited:false},{type:'assessed',at:'2026-11-16T17:50:05Z',attemptId:'f2',verdict:'uncertain'}];
  it('never sticks in Checking on a day that already had its follow-up',async()=>{
    const h=pre({verdict:'general'});h.days.set('2026-11-16',followedUp());
    const done=await say(h,3,'mom');
    expect(done).toMatchObject({phase:'completed',flagged:true});
    expect(h.judgeCalls().at(-1)).toMatchObject({allowFollowUp:false});
    expect(h.days.get('2026-11-16').filter(e=>e.type==='assessed').at(-1)).toMatchObject({verdict:'eligible',flagged:'general',judged:'general'});
  });
  it('a verdict the evidence would refuse falls back to a valid one instead of locking the child out',async()=>{
    // A judge that answers general although no follow-up was allowed (the 2026-11-19 failure shape).
    const h=harness({verdict:'general'});h.days.set('2026-11-16',followedUp());
    const result=await h.service.submit('child','2026-11-16',{...body,attemptId:'s3',text:'my dad'});
    expect(['completed','retry']).toContain(result.phase);
    expect(result.phase).not.toBe('pending');
  });
  it('a fresh answer retries a stuck attempt first rather than being turned away for good',async()=>{
    const h=pre({verdict:'eligible'});
    h.days.set('2026-11-16',[{type:'opened',at:'2026-11-16T17:50:00Z'},{type:'submitted',at:'2026-11-16T17:50:01Z',attemptId:'stuck',text:'cookies',via:'typed',audioRef:null,edited:false}]);
    const result=await say(h,4,'my dog');
    expect(result.phase).toBe('completed');
    expect(h.days.get('2026-11-16').find(e=>e.type==='completed').attemptId).toBe('stuck');
  });
  it('flags any answer accepted after the blue limit',async()=>{
    const h=pre({verdicts:['repetition','repetition','eligible']});seed(h);
    await say(h,1);await say(h,2);
    expect(await say(h,3,'my new bike')).toMatchObject({phase:'completed',flagged:true});
    expect(h.days.get('2026-11-16').filter(e=>e.type==='assessed').at(-1)).toMatchObject({verdict:'eligible',flagged:'blue-limit'});
  });
});
