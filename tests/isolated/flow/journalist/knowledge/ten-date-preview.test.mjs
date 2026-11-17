import {it,expect} from 'vitest';
import {GenerateMorningDebrief} from '../../../../../__app_modules/personal/journalist/server/application/usecases/GenerateMorningDebrief.mjs';
import {selectQuestions,experimentArm} from '../../../../../__app_modules/personal/lifelog/server/domain/knowledge/selectQuestions.mjs';
import {loop,snapshot,TZ} from '../../../../../__app_modules/personal/lifelog/server/domain/knowledge/fixtures.testHelpers.mjs';
const dates=[['2026-11-01','2026-11-02'],['2026-11-02','2026-11-03'],['2026-11-03','2026-11-04'],['2026-11-04','2026-11-05'],['2026-11-05','2026-11-06'],['2026-11-06','2026-11-07'],['2026-11-07','2026-11-08'],['2026-11-08','2026-11-09'],['2026-11-09','2026-11-10'],['2026-11-10','2026-11-11']];
it('previews ten explicit report/ask-date pairs through the changed generator with no writer or real model',async()=>{
 const previews=[];
 for(const [index,[reportDate,askDate]]of dates.entries()){
  const asOf=Date.parse(askDate+'T15:00Z'),objects=index%3===0?{}:Object.fromEntries([0,1,2].map(i=>{const item=loop({id:'loop.task-'+i,title:'Task '+i,touched:reportDate,loop:{...loop().loop,due:reportDate,ask:{...loop().loop.ask,eligible_from:askDate}}});return[item.id,item];}));
  const view=snapshot(objects,{health:{available:true,conflicted:false,recovering:false,lastSweepAt:asOf}}),mode=experimentArm({activationDate:'2026-11-02',askDate});
  const followUpSource={selectForMorning:async input=>{expect(input.askDate).toBe(askDate);expect(input.asOf).toBe(asOf);const result=selectQuestions({snapshot:view,askDate,asOf,timezone:TZ,max:2});return {mode,reason:mode==='legacy'?'control':result.reason,questions:mode==='knowledge'?result.questions:[],queuedCount:result.quizCandidates.length,selectionId:'preview-'+askDate,askDate};}};
  let calls=0;
  const generator=new GenerateMorningDebrief({followUpSource,clock:()=>asOf,userTimezone:()=>TZ,lifelogAggregator:{aggregate:async(_user,date)=>{expect(date).toBe(reportDate);return {_meta:{date,hasEnoughData:true,sources:['activity']},summaryText:'Activity recorded.',events:[{}]};}},aiGateway:{chat:async messages=>{calls++;expect(messages[1].content).toContain(reportDate);return messages[0].content.includes('KB_QUESTIONS_BEGIN')?'HOOK: Did it feel busy?\nActivity recorded.\nKB_QUESTIONS_BEGIN\nInvented question?\nKB_QUESTIONS_END':'HOOK: Activity recorded\nActivity recorded.\nWhat happened at the activity?';}},logger:{info(){},warn(){},error(){}}});
  const result=await generator.execute({username:'sample',date:reportDate,askDate,asOf});expect(result.success).toBe(true);expect(result.date).toBe(reportDate);expect(calls).toBe(1);
  const questions=(result.summary.match(/\?/g)??[]).length;
  if(mode==='knowledge'){expect(questions).toBe(index%3===0?0:2);expect(result.headline).toBeNull();expect(result.summary).not.toContain('Invented');}else{expect(questions).toBe(1);expect(result.knowledgeControl.selectionId).toBe('preview-'+askDate);}
  previews.push({reportDate,askDate,mode,questions});
 }
 expect(previews).toHaveLength(10);expect(previews.filter(p=>p.mode==='knowledge'&&p.questions===0)).toHaveLength(2);
});
