import {describe,it,expect,vi} from 'vitest';
import {GenerateMorningDebrief} from './GenerateMorningDebrief.mjs';
const asOf=Date.parse('2026-11-03T15:00Z');
const selection={mode:'knowledge',selectionId:'selection-1',queuedCount:2,askDate:'2026-11-03',questions:[{id:'loop.reply:status',text:'Did you finish: Sample reply?'}]};
function setup({selected=selection,raw='HOOK: Did it feel busy?\nMeeting with Sample.\nKB_QUESTIONS_BEGIN\nAn invented question?\nKB_QUESTIONS_END',existing=null,failure=false,enough=true}={}){
 const ai={chat:vi.fn(async()=>raw)},source={selectForMorning:vi.fn(async()=>{if(failure)throw Error('unavailable');return selected;})};
 const usecase=new GenerateMorningDebrief({lifelogAggregator:{aggregate:async()=>({_meta:{date:'2026-11-02',hasEnoughData:enough,sources:['calendar']},summaryText:'Meeting with Sample',events:[{}]})},aiGateway:ai,followUpSource:source,clock:()=>asOf,userTimezone:()=> 'America/Los_Angeles',debriefRepository:existing?{getDebriefByDate:async()=>existing}:null,logger:{info(){},warn(){},error(){}}});
 return {usecase,ai,source};
}
const run=d=>d.usecase.execute({username:'sample',date:'2026-11-02',conversationId:'private-sample',askDate:'2026-11-03',asOf});
describe('KB morning generation',()=>{
 it('selects by current ask date, replaces model questions and drops a question hook without another model call',async()=>{
  const d=setup(),result=await run(d);expect(result.knowledgeSelection).toEqual(selection);expect(result.headline).toBeNull();expect(result.summary).toBe('Meeting with Sample.\n\n• Did you finish: Sample reply?');expect(d.ai.chat).toHaveBeenCalledTimes(1);
  expect(d.source.selectForMorning).toHaveBeenCalledWith({username:'sample',askDate:'2026-11-03',asOf,max:2});expect(d.ai.chat.mock.calls[0][0][0].content).toContain('KB_QUESTIONS_BEGIN');
 });
 it('suppresses all questions for a healthy empty selection',async()=>{
  const result=await run(setup({selected:{...selection,questions:[]}}));expect(result.summary).not.toContain('?');expect(result.headline).toBeNull();
 });
 it('returns facts and no invented fallback prompt when the archive has insufficient data on a healthy KB day',async()=>{
  const d=setup({enough:false,selected:{...selection,questions:[]}}),result=await run(d);
  expect(result.success).toBe(true);expect(result.summary).not.toContain('?');expect(d.ai.chat).not.toHaveBeenCalled();
 });
 it('keeps legacy question generation when the source is unavailable',async()=>{
  const raw='HOOK: A quiet day\nWhy did the meeting run late?',result=await run(setup({failure:true,raw}));expect(result.summary).toBe('Why did the meeting run late?');expect(result.knowledgeSelection).toBeUndefined();
 });
 it('sanitizes persisted debriefs against this mornings selection without a model call',async()=>{
  const d=setup({existing:{date:'2026-11-02',headline:'Why so busy?',summary:'Why did you feel tired?',summaries:[]}}),result=await run(d);
  expect(result.knowledgeSelection).toEqual(selection);expect(result.headline).toBeNull();expect(result.summary.match(/\?/g)).toHaveLength(1);expect(d.ai.chat).not.toHaveBeenCalled();
 });
});
