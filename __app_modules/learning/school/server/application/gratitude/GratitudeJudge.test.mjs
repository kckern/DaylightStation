import { describe,it,expect,vi } from 'vitest';
import { GratitudeJudge } from './GratitudeJudge.mjs';
const answer=(choice,confidence=.98)=>({type:'choice',choice,confidence,probabilities:{[choice]:confidence}});
const effort=probability=>({type:'yesNo',probability});
const history=[{id:'toys-day',studyDay:'2026-11-16',text:'My toys',subject:'Toys'}];
const judge=(answers)=>new GratitudeJudge({decisionGateway:{isConfigured:()=>true,evaluate:async()=>({model:'test-jev',answers})},config:{minConfidence:.85,timeoutMs:100},logger:{}});
describe('gratitude Jev policy',()=>{
  it('uses the calibrated default boundary and remains uncertain below it',async()=>{
    const make=confidence=>new GratitudeJudge({decisionGateway:{evaluate:async()=>({answers:{effort:effort(1-confidence)}})}});
    expect((await make(.8).assess({text:'asdf qwer zxcv blorp',history:[]})).verdict).toBe('nonsense');
    expect((await make(.79).assess({text:'unclear',history:[]})).verdict).toBe('uncertain');
  });
  it('supplies the gratitude question so a short noun phrase has its response context',async()=>{
    const gateway={evaluate:async state=>({answers:{effort:effort(state.prompt==='What are you grateful for today?'?.99:.5)}})};
    expect((await new GratitudeJudge({decisionGateway:gateway}).assess({text:'Mom',history:[]})).verdict).toBe('eligible');
  });
  it('accepts ordinary short gratitude without asking for an explanation',async()=>{
    expect(await judge({effort:effort(.98)}).assess({text:"I'm grateful for my toys",history:[]})).toMatchObject({verdict:'eligible',model:'test-jev'});
  });
  it('rejects clear nonsense but treats weak confidence as uncertainty',async()=>{
    expect((await judge({effort:effort(.02)}).assess({text:'stinky stinky lalalal',history:[]})).verdict).toBe('nonsense');
    expect((await judge({effort:effort(.4)}).assess({text:'My funny dog',history:[]})).verdict).toBe('uncertain');
  });
  it('requires a confident match to a supplied recent record for repetition',async()=>{
    expect((await judge({effort:effort(.98),novelty:answer('toys-day')}).assess({text:'my nice toys',history})).verdict).toBe('repetition');
    expect((await judge({effort:effort(.98),novelty:answer('made-up')}).assess({text:'my nice toys',history})).verdict).toBe('uncertain');
  });
  it('allows a fresh meaningful experience and keeps service failure unpenalized',async()=>{
    expect((await judge({effort:effort(.98),novelty:answer('distinct')}).assess({text:'엄마가 내가 무서울 때 도와주셨어요',history})).verdict).toBe('eligible');
    expect((await new GratitudeJudge({}).assess({text:'Family',history:[]})).verdict).toBe('unavailable');
  });
  it('asks for a follow-up only when allowed and the answer is confidently general',async()=>{
    const ask=specific=>judge({effort:effort(.98),specific:effort(specific)});
    expect((await ask(.05).assess({text:'my mom',history:[],allowFollowUp:true})).verdict).toBe('general');
    expect((await ask(.05).assess({text:'my mom',history:[]})).verdict).toBe('eligible');
    expect((await ask(.5).assess({text:'my mom',history:[],allowFollowUp:true})).verdict).toBe('eligible');
    expect((await ask(.97).assess({text:'Mom made pancakes',history:[],allowFollowUp:true})).verdict).toBe('eligible');
  });
  it('asks the specificity question only when a follow-up is allowed',async()=>{
    const seen=[];const gateway={evaluate:async(state,questions)=>{seen.push(Object.keys(questions));return {answers:{effort:effort(.98)}};}};
    await new GratitudeJudge({decisionGateway:gateway}).assess({text:'Mom',history:[]});
    await new GratitudeJudge({decisionGateway:gateway}).assess({text:'Mom',history:[],allowFollowUp:true});
    expect(seen).toEqual([['effort'],['effort','specific']]);
  });
  it('nonsense still wins over general, and general skips the repetition check',async()=>{
    expect((await judge({effort:effort(.02),specific:effort(.01)}).assess({text:'lalala',history:[],allowFollowUp:true})).verdict).toBe('nonsense');
    expect((await judge({effort:effort(.98),specific:effort(.02),novelty:answer('toys-day')}).assess({text:'toys',history,allowFollowUp:true})).verdict).toBe('general');
  });
  it('logs a judge failure by error name and code, never the gateway text',async()=>{
    const warn=vi.fn();
    await new GratitudeJudge({decisionGateway:{evaluate:async()=>{throw new Error('echo: my mom');}},logger:{warn}}).assess({text:'my mom',history:[]});
    expect(warn).toHaveBeenCalledWith('school.gratitude.judge-unavailable',{error:'Error',code:null});
  });
});
