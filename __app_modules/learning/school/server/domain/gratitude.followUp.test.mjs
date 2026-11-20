import { describe,it,expect } from 'vitest';
import { deriveGratitudeState, combineGratitudeAnswers } from './gratitude.mjs';
import { validGratitudeEvidence } from './gratitudeEvidence.mjs';
const t=n=>`2026-11-16T18:0${n}:00Z`;
const first={type:'submitted',at:t(1),attemptId:'a1',text:"I'm grateful for my mom",via:'typed',audioRef:null,edited:false};
const general={type:'assessed',at:t(2),attemptId:'a1',verdict:'general',confidence:.95,model:'jev',rubricVersion:5,matchedId:null};
const asked={type:'follow-up-asked',at:t(3),attemptId:'a1',question:'What about your mom are you grateful for today?',writer:'model'};
const second={type:'submitted',at:t(4),attemptId:'a2',followUpOf:'a1',text:'She made me pancakes',via:'typed',audioRef:null,edited:false};
const base=[{type:'opened',at:t(0)},first,general,asked];
describe('gratitude follow-up evidence',()=>{
  it('combines two answers on one line each',()=>{
    expect(combineGratitudeAnswers(' my mom ',' pancakes ')).toBe('my mom\npancakes');
  });
  it('enters the follow-up phase with an empty draft and the question',()=>{
    const s=deriveGratitudeState(base);
    expect(s).toMatchObject({phase:'follow-up',draft:null,followUpAsked:true,followUp:{attemptId:'a1',question:asked.question,firstText:first.text}});
  });
  it('keeps the follow-up phase while drafting and recording',()=>{
    const s=deriveGratitudeState([...base,{type:'take-saved',at:t(4),takeId:'k1',audioRef:'child/k1.webm',text:'pancakes'},{type:'draft-saved',at:t(5),draft:{text:'pancakes!',via:'voice',audioRef:'child/k1.webm',edited:true}}]);
    expect(s.phase).toBe('follow-up');expect(s.draft.text).toBe('pancakes!');
  });
  it('a take in the follow-up does not prepend the first answer',()=>{
    const s=deriveGratitudeState([...base,{type:'take-saved',at:t(4),takeId:'k1',audioRef:'child/k1.webm',text:'pancakes'}]);
    expect(s.draft.text).toBe('pancakes');
  });
  it('judges the combined text after a follow-up answer',()=>{
    const s=deriveGratitudeState([...base,second]);
    expect(s.phase).toBe('assessing');expect(s.assessText).toBe("I'm grateful for my mom\nShe made me pancakes");
  });
  it('judges the plain text when there was no follow-up',()=>{
    expect(deriveGratitudeState([{type:'opened',at:t(0)},first]).assessText).toBe(first.text);
  });
  it('accepts the follow-up chain and a publication of the combined text',()=>{
    const chain=[...base,second,{type:'assessed',at:t(5),attemptId:'a2',verdict:'eligible',confidence:.9,model:'jev',rubricVersion:5,matchedId:null},
      {type:'publication-pending',at:t(6),attemptId:'a2',text:"I'm grateful for my mom\nShe made me pancakes",subject:'Mom making pancakes',selectionId:'school-gratitude:child:2026-11-16',timestamp:t(6)}];
    expect(validGratitudeEvidence(chain,{learnerId:'child',studyDay:'2026-11-16'})).toBe(true);
    chain[6]={...chain[6],text:'She made me pancakes'};
    expect(validGratitudeEvidence(chain)).toBe(false);
  });
  it('refuses a second follow-up, a stray followUpOf, and a follow-up for another attempt',()=>{
    expect(validGratitudeEvidence([...base,second,{...general,at:t(5),attemptId:'a2'}])).toBe(false);
    expect(validGratitudeEvidence([{type:'opened',at:t(0)},{...first,followUpOf:'zz'}])).toBe(false);
    expect(validGratitudeEvidence([...base,{...second,followUpOf:'other'}])).toBe(false);
    expect(validGratitudeEvidence([{type:'opened',at:t(0)},first,general,{...asked,attemptId:'other'}])).toBe(false);
    expect(validGratitudeEvidence([{type:'opened',at:t(0)},first,general,{...asked,question:''}])).toBe(false);
  });
  it('a retry after an unclear combined answer starts fresh without followUpOf',()=>{
    const unclear={type:'assessed',at:t(5),attemptId:'a2',verdict:'uncertain',confidence:null,model:'jev',rubricVersion:5,matchedId:null};
    // The retry box starts empty (2026-11-19 design: a refused or unclear answer never stays in the box).
    expect(deriveGratitudeState([...base,second,unclear])).toMatchObject({phase:'retry',draft:null});
    const spoken={...second,via:'voice',audioRef:'child/k1.webm',edited:false};
    const take={type:'take-saved',at:t(3),takeId:'k1',audioRef:'child/k1.webm',text:'She made me pancakes'};
    expect(deriveGratitudeState([...base,take,spoken,unclear]).draft).toBeNull();
    const again={type:'submitted',at:t(6),attemptId:'a3',text:"I'm grateful for my mom\nShe read to me",via:'typed',audioRef:null,edited:true};
    const events=[...base,second,unclear,again];
    expect(validGratitudeEvidence(events)).toBe(true);
    expect(deriveGratitudeState(events)).toMatchObject({assessText:"I'm grateful for my mom\nShe read to me",followUpAsked:true});
  });
});
describe('unheard takes in evidence',()=>{
  it('accepts take-unheard only for a saved take of this answer',()=>{
    const take={type:'take-saved',at:t(1),takeId:'k1',audioRef:'child/k1.webm',text:null};
    expect(validGratitudeEvidence([{type:'opened',at:t(0)},take,{type:'take-unheard',at:t(2),takeId:'k1',audioRef:'child/k1.webm'}])).toBe(true);
    expect(validGratitudeEvidence([{type:'opened',at:t(0)},take,{type:'take-unheard',at:t(2),takeId:'k2',audioRef:'child/k1.webm'}])).toBe(false);
    expect(validGratitudeEvidence([{type:'opened',at:t(0)},take,{type:'take-unheard',at:t(2),takeId:'k1',audioRef:'child/other.webm'}])).toBe(false);
  });
});
describe('preschool ladder evidence',()=>{
  const sub=(n,id)=>({type:'submitted',at:t(n),attemptId:id,text:'x',via:'typed',audioRef:null,edited:false});
  const judged=(n,id,verdict,extra={})=>({type:'assessed',at:t(n),attemptId:id,verdict,...extra});
  it('accepts steered, warned and a five-minute break, and derives the runs',()=>{
    const events=[{type:'opened',at:t(0)},sub(1,'a'),judged(1,'a','repetition',{matchedId:'r'}),{type:'steered',at:t(1),attemptId:'a',reason:'repetition',matchedId:'r'},
      sub(2,'b'),judged(2,'b','nonsense'),{type:'warned',at:t(2),attemptId:'b'},
      sub(3,'c'),judged(3,'c','rude'),{type:'refused',at:t(3),attemptId:'c',reason:'rude',retryAt:'2026-11-16T18:08:00.000Z',cooldownMs:300000}];
    expect(validGratitudeEvidence(events)).toBe(true);
    expect(deriveGratitudeState(events.slice(0,4))).toMatchObject({phase:'steered',blueRun:1,steer:{reason:'repetition',matchedId:'r'}});
    expect(deriveGratitudeState(events.slice(0,7))).toMatchObject({phase:'warned',blueRun:0,sillyRun:1});
    expect(deriveGratitudeState(events,{now:t(4)})).toMatchObject({phase:'cooldown',cooldownMs:300000,sillyRun:0});
  });
  it('refuses a break that does not match its recorded length, a steer for nonsense, or a warning for a repeat',()=>{
    const head=[{type:'opened',at:t(0)},sub(1,'a')];
    expect(validGratitudeEvidence([...head,judged(1,'a','nonsense'),{type:'refused',at:t(1),attemptId:'a',reason:'nonsense',retryAt:'2026-11-16T18:06:00.000Z',cooldownMs:300000}])).toBe(true);
    expect(validGratitudeEvidence([...head,judged(1,'a','nonsense'),{type:'refused',at:t(1),attemptId:'a',reason:'nonsense',retryAt:'2026-11-16T18:06:00.000Z'}])).toBe(false);
    expect(validGratitudeEvidence([...head,judged(1,'a','nonsense'),{type:'refused',at:t(1),attemptId:'a',reason:'nonsense',retryAt:'2026-11-17T18:01:00.000Z',cooldownMs:86400000}])).toBe(false);
    expect(validGratitudeEvidence([...head,judged(1,'a','nonsense'),{type:'steered',at:t(1),attemptId:'a',reason:'nonsense'}])).toBe(false);
    expect(validGratitudeEvidence([...head,judged(1,'a','repetition',{matchedId:'r'}),{type:'warned',at:t(1),attemptId:'a'}])).toBe(false);
  });
});
