import { describe,it,expect } from 'vitest';
import { deriveGratitudeState,recentGratitudeFacts,validateGratitudeEnrollment } from './gratitude.mjs';
describe('gratitude policy',()=>{
  it('refuses an orphan completion instead of deriving unassessed credit',()=>{
    expect(()=>deriveGratitudeState([{type:'completed',at:'2026-11-16T18:00:00Z'}])).toThrow(/evidence/i);
  });
  it('allows a topic again on the seventh study-day date difference',()=>{
    const records=[{learnerId:'child',studyDay:'2026-11-16',events:[{type:'publication-pending',attemptId:'a',text:'My toys',subject:'Toys',selectionId:'s'},{type:'completed',selectionId:'s'}]}];
    expect(recentGratitudeFacts(records,{learnerId:'child',studyDay:'2026-11-22',spacingDays:7})).toHaveLength(1);
    expect(recentGratitudeFacts(records,{learnerId:'child',studyDay:'2026-11-23',spacingDays:7})).toEqual([]);
    expect(recentGratitudeFacts(records,{learnerId:'other',studyDay:'2026-11-22',spacingDays:7})).toEqual([]);
  });
  it('holds a fixed cooldown across midnight and releases exactly at expiry',()=>{
    const events=[{type:'submitted',attemptId:'a',at:'2026-11-17T11:50:00Z',text:'lalala',via:'typed'}, {type:'assessed',attemptId:'a',at:'2026-11-17T11:50:00Z',verdict:'nonsense'},{type:'refused',attemptId:'a',at:'2026-11-17T11:50:00Z',retryAt:'2026-11-17T12:20:00Z',reason:'nonsense'}];
    expect(deriveGratitudeState(events,{now:'2026-11-17T12:19:59Z'})).toMatchObject({phase:'cooldown',retryAt:'2026-11-17T12:20:00Z'});
    expect(deriveGratitudeState(events,{now:'2026-11-17T12:20:00Z'}).phase).toBe('retry');
  });
  it('validates enrollment to the scripture shelf without adding a course',()=>{
    expect(validateGratitudeEnrollment({}).enrollment).toMatchObject({programId:'gratitude',corpusId:null,subject:'scripture'});
    expect(validateGratitudeEnrollment({subject:'unknown'}).errors.length).toBeGreaterThan(0);
  });
});
describe('gratitude takes and retries (every child)',()=>{
  const t=n=>`2026-11-19T18:0${n}:00Z`;
  const take=(n,id,text)=>({type:'take-saved',at:t(n),takeId:id,audioRef:`kid/${id}.webm`,text});
  it('a new voice take replaces the draft instead of appending to it',()=>{
    const s=deriveGratitudeState([{type:'opened',at:t(0)},take(1,'k1',null),take(1,'k1','Blah blah'),take(2,'k2',null),take(2,'k2','Making cookies')]);
    expect(s.draft).toMatchObject({text:'Making cookies',via:'voice',audioRef:'kid/k2.webm',takeId:'k2'});
  });
  it('a take still being written down holds an empty draft for that take',()=>{
    const s=deriveGratitudeState([{type:'opened',at:t(0)},{type:'draft-saved',at:t(1),draft:{text:'typed',via:'typed',audioRef:null,edited:false}},take(2,'k1',null)]);
    expect(s.draft).toMatchObject({text:'',audioRef:'kid/k1.webm',takeId:'k1'});
  });
  it('an unheard take leaves the draft as it was before that take',()=>{
    const s=deriveGratitudeState([{type:'opened',at:t(0)},take(1,'k1','My dog'),take(2,'k2',null),{type:'take-unheard',at:t(3),takeId:'k2',audioRef:'kid/k2.webm'}]);
    expect(s.draft).toMatchObject({text:'My dog',takeId:'k1'});
  });
  it('an unclear answer opens the retry box empty',()=>{
    const s=deriveGratitudeState([{type:'opened',at:t(0)},{type:'submitted',at:t(1),attemptId:'a',text:'cookies',via:'typed',audioRef:null,edited:false},{type:'assessed',at:t(2),attemptId:'a',verdict:'uncertain'}]);
    expect(s).toMatchObject({phase:'retry',reason:'unclear',draft:null});
  });
  it('a refused answer is gone from the box after the break',()=>{
    const events=[{type:'opened',at:t(0)},{type:'submitted',at:t(1),attemptId:'a',text:'blah blah',via:'typed',audioRef:null,edited:false},{type:'assessed',at:t(1),attemptId:'a',verdict:'nonsense'},{type:'refused',at:t(1),attemptId:'a',reason:'nonsense',retryAt:'2026-11-19T18:31:00Z'}];
    expect(deriveGratitudeState(events,{now:'2026-11-19T18:40:00Z'})).toMatchObject({phase:'retry',draft:null});
  });
});
import { isUnheardTranscript } from './gratitude.mjs';
describe('unheard transcripts',()=>{
  it('catches the hint echoed back whole, in part, or with a contraction',()=>{
    for(const text of ['',null,'  ','A child saying what they are grateful for, in English or Korean.','a child saying what theyre grateful for','Saying what they\'re grateful for.','In English or Korean.','uh in english or korean','what they are grateful for in English']) expect(isUnheardTranscript(text)).toBe(true);
  });
  it('leaves a real answer alone, even one that borrows a few words',()=>{
    for(const text of ['Making cookies','I am grateful for my mom','I\'m grateful for what they are doing for me at school today','my teacher speaks English or Korean to me and I like it']) expect(isUnheardTranscript(text)).toBe(false);
  });
});
