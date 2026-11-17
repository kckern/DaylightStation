import {it,expect} from 'vitest';
import {calibrateGratitude} from './gratitude-calibrate.mjs';
it('fails calibration for a false penalty and records every synthetic case',async()=>{
  const report=await calibrateGratitude({judge:{assess:async()=>({verdict:'nonsense',model:'test',confidence:.99,rubricVersion:1})},cases:[{id:'valid-short',text:'Toys',expected:'eligible',history:[]}]});
  expect(report.passed).toBe(false);expect(report.falsePenalties).toBe(1);expect(report.results).toHaveLength(1);
});
it('passes the follow-up flag to the judge and never counts general as a penalty',async()=>{
  const seen=[];
  const judge={assess:async args=>{seen.push(args.allowFollowUp);return {verdict:'general',model:'test',confidence:.99,rubricVersion:5};}};
  const report=await calibrateGratitude({judge,cases:[{id:'general-mom',text:'my mom',expected:'general',allowFollowUp:true},{id:'plain',text:'Toys',expected:'eligible'}]});
  expect(seen).toEqual([true,false]);
  expect(report.falsePenalties).toBe(0);expect(report.correct).toBe(1);
});
it('keeps synthetic follow-up cases in the fixture',async()=>{
  const {default:fs}=await import('node:fs');
  const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/gratitude-calibration.json',import.meta.url),'utf8'));
  const followUp=cases.filter(c=>c.allowFollowUp===true && !c.id.startsWith('follow-up-ordinary-'));
  expect(followUp.filter(c=>c.expected==='general').map(c=>c.text)).toEqual(['my mom','my family','food','school','엄마']);
  expect(followUp.filter(c=>c.expected==='eligible')).toHaveLength(4);
  expect(followUp.filter(c=>c.expected==='nonsense').map(c=>c.text)).toEqual(['lalala stinky']);
});
it('keeps second-round cases: combined answers, combined history and the bare answers a follow-up now catches',async()=>{
  const {default:fs}=await import('node:fs');
  const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/gratitude-calibration.json',import.meta.url),'utf8'));
  const byId=Object.fromEntries(cases.map(c=>[c.id,c]));
  const combined=cases.filter(c=>c.id.startsWith('combined-'));
  expect(combined.length).toBeGreaterThanOrEqual(5);
  for(const c of combined){expect(c.text).toContain('\n');expect(c.allowFollowUp).not.toBe(true);}
  expect(byId['combined-01']).toMatchObject({text:'my mom\nShe read me a book',history:[],expected:'eligible'});
  expect(byId['combined-05']).toMatchObject({text:'my mom\nidk',expected:'eligible'});
  expect(combined.map(c=>c.expected).sort()).toEqual(['eligible','eligible','eligible','eligible','repetition']);
  const bare=cases.filter(c=>c.id.startsWith('follow-up-ordinary-'));
  expect(bare.map(c=>[c.text,c.expected])).toEqual([['Toys','general'],['Family','general'],["I'm grateful for my toys",'general'],['My puppy sneezes in a funny way and makes me laugh','eligible']]);
});
it('counts eligible answers that the judge sent to a follow-up',async()=>{
  const judge={assess:async({text})=>({verdict:text==='Toys'?'general':'eligible',model:'test',confidence:.99,rubricVersion:5})};
  const report=await calibrateGratitude({judge,cases:[{id:'a',text:'Toys',expected:'eligible',allowFollowUp:true},{id:'b',text:'Cookies with Sam',expected:'eligible'}]});
  expect(report.generalOnEligible).toBe(1);expect(report.falsePenalties).toBe(0);expect(report.passed).toBe(false);
});
