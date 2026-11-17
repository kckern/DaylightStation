import {it,expect} from 'vitest';
import {runJournalistKnowledgePreview,main} from './journalist-knowledge-preview.cli.mjs';
import {evidence,proposal,TZ,AS_OF} from '../../lifelog/server/domain/knowledge/fixtures.testHelpers.mjs';
it('renders explicit report/ask dates through the changed generator using a read-only extraction artifact',async()=>{
 const quote='I will contact Sample 2026-11-02',row=evidence({content:quote}),p=proposal({quote,fields:{title:'Contact Sample',due:'2026-11-02'}}),reads=[];
 const result=await runJournalistKnowledgePreview({username:'sample',timezone:TZ,extraction:{schema:'lifelog-knowledge-preview/v1',dryRun:true,username:'sample',since:'2026-11-01',until:'2026-11-02',asOf:AS_OF,proposals:[p],modelVersion:'fixture'},requests:[{reportDate:'2026-11-02',askDate:'2026-11-03',asOf:'2026-11-03T15:00:00Z'}],readMessages:async()=>({messages:[row]}),debriefRepository:{getDebriefByDate:async(date,username)=>{reads.push({date,username});return {date,summary:'Old invented question?',headline:'Did it feel busy?',summaries:[]};}}});
 expect(result.modelCalls).toBe(0);expect(result.previews[0]).toMatchObject({reportDate:'2026-11-02',askDate:'2026-11-03',mode:'knowledge',questionCount:1});expect(result.previews[0].summary).toContain('Did you finish: Contact Sample?');expect(result.previews[0].summary).not.toContain('invented');expect(reads.every(read=>read.username==='sample')).toBe(true);
});
it('rejects send/write options before constructing any runtime or model',async()=>{await expect(main(['--send'])).rejects.toThrow(/unsupported/i);});
