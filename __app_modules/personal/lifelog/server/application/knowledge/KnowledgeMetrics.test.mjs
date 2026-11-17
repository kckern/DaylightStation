import { it, expect, vi } from 'vitest';
import { KnowledgeMetrics } from './KnowledgeMetrics.mjs';
import { memoryStore } from './fixtures.testHelpers.mjs';
import { loop } from '../../domain/knowledge/fixtures.testHelpers.mjs';
const DAY=86400000,start=Date.parse('2026-11-01T15:00:00Z'),asOf=start+20*DAY;
const ask=(id,extra={})=>({id,objectId:'loop.application-reply',channel:'morning',askDate:'2026-11-01',arm:'knowledge',botMessageId:'bot-'+id,deliveredAt:start,...extra});
const setup=(asks=[],objects={},events=[])=>{
 const store=memoryStore({asks,objects});const ledger={read:vi.fn(async()=>({transactions:[{prepare:{at:start,batch:{events}},complete:{at:start}}]}))};
 return {metrics:new KnowledgeMetrics({store,ledger}),store,ledger};
};
const range={username:'sample',from:start-1,to:start+DAY,asOf};
it('counts acknowledged morning messages once per arm, not once per question',async()=>{
 const first=ask('first',{response:{at:start+3600000,by:'tap',action:'yes',length:0,attribution:'reply_to'}});
 const duplicate=ask('second',{objectId:'loop.second',botMessageId:first.botMessageId});
 const legacy=ask('legacy',{arm:'legacy',response:{at:start+13*3600000,by:'text',action:'text',length:24,attribution:'reply_to'}});
 const pending=ask('pending',{botMessageId:null}),preview=ask('preview',{previewOnly:true});
 const result=await setup([first,duplicate,legacy,pending,preview]).metrics.report(range);
 expect(result.replyRate12h).toEqual({knowledge:{eligible:1,replied:1,rate:1},legacy:{eligible:1,replied:0,rate:0}});
 expect(result.tapShare).toMatchObject({taps:1,replies:2,rate:0.5});expect(result.medianReplyLength).toBe(24);
});
it('does not attribute ambiguous replies or include immature12h deliveries',async()=>{
 const rows=[ask('ambiguous',{response:{at:start+1000,by:'text',length:10,attribution:'none'}}),ask('fresh',{deliveredAt:asOf-1000})];
 const result=await setup(rows).metrics.report({...range,to:asOf});
 expect(result.replyRate12h.knowledge).toEqual({eligible:1,replied:0,rate:0});
 expect(result.tapShare.replies).toBe(0);
});
it('measures14day resolution cohorts, asks per resolution, Drop-it and current stale stock',async()=>{
 const answered=loop({created:{...loop().created,at:start},status:'answered',loop:{...loop().loop,answer:{at:start+2*DAY,by:'tap'}}});
 const stale=loop({id:'loop.stale',status:'stale'});
 const rows=[ask('one'),ask('two',{deliveredAt:start+1000,response:{at:start+2000,action:'drop',by:'tap',attribution:'reply_to',length:0}})];
 const result=await setup(rows,{[answered.id]:answered,[stale.id]:stale}).metrics.report(range);
 expect(result.resolutionWithin14Days).toEqual({eligible:1,resolved:1,rate:1});
 expect(result.asksPerResolution).toEqual({asks:2,resolutions:1,ratio:2});expect(result.dropItCount).toBe(1);
 expect(result.staleRate).toEqual({stale:1,total:2,rate:0.5});
});
it('counts human review precision and back-off events only from completed non-preview ledger batches',async()=>{
 const events=[{id:'r1',type:'knowledge.review.confirmed',at:start},{id:'r2',type:'knowledge.review.rejected',at:start},{id:'b1',type:'knowledge.backoff.started',at:start}];
 const d=setup([],{},[...events,events[0]]);
 const result=await d.metrics.report(range);
 expect(result.reviewPrecision).toEqual({confirmed:1,rejected:1,rate:0.5});expect(result.backoffCount).toBe(1);
});
it('reports unknown rates as null rather than claiming unmeasured improvement',async()=>{
 const result=await setup().metrics.report(range);expect(result.replyRate12h.knowledge.rate).toBeNull();expect(result.medianReplyLength).toBeNull();expect(result.reviewPrecision.rate).toBeNull();
});
it('uses the last completed immutable image at as-of for historical metrics',async()=>{
 const future=loop({created:{...loop().created,at:start},status:'answered',loop:{...loop().loop,answer:{at:start+2*DAY}}});
 const d=setup([ask('one')],{[future.id]:future});
 d.ledger.read.mockResolvedValue({transactions:[{prepare:{at:start,batch:{events:[]},after:{files:{'loops/application-reply.yml':loop({created:{...loop().created,at:start}}),'asks/2026-11-01.yml':{items:[ask('one')]}}}},complete:{at:start}}]});
 expect((await d.metrics.report(range)).resolutionWithin14Days.resolved).toBe(0);
});
it('does not inflate reply or tap rates with a skipped quiz question',async()=>{
 const row=ask('skipped',{channel:'quiz',response:{at:start+1000,action:'skip',by:'tap',length:0,attribution:'reply_to'}});
 const result=await setup([row]).metrics.report(range);
 expect(result.tapShare).toEqual({taps:0,replies:0,rate:null});
});

it('excludes loops opened before the reporting cohort even when their first ask and resolution are recent',async()=>{
 const old=loop({created:{...loop().created,at:start-30*DAY},status:'answered',loop:{...loop().loop,answer:{at:start+2*DAY}}});
 expect((await setup([ask('recent')],{[old.id]:old}).metrics.report(range)).resolutionWithin14Days).toEqual({eligible:0,resolved:0,rate:null});
});
it('includes an opened loop resolved without ever needing an ask',async()=>{
 const fresh=loop({created:{...loop().created,at:start},status:'answered',loop:{...loop().loop,answer:{at:start+2*DAY}}});
 expect((await setup([],{[fresh.id]:fresh}).metrics.report(range)).resolutionWithin14Days).toEqual({eligible:1,resolved:1,rate:1});
});
it('counts one message-level reply without inventing per-loop answers for a shared morning message',async()=>{
 const d=setup([ask('one',{botMessageId:'shared'}),ask('two',{objectId:'loop.second',botMessageId:'shared'})]);await d.store.read({username:'sample'});
 d.store.users.get('sample').state.messageReplies={receipt:{receiptId:'receipt',at:start+3600000,deliveredAt:start,askDate:'2026-11-01',botMessageId:'shared',channel:'morning',arm:'knowledge',action:'text',by:'text',length:3,attribution:'reply_to'}};
 const report=await d.metrics.report(range);expect(report.replyRate12h.knowledge).toEqual({eligible:1,replied:1,rate:1});expect(report.tapShare).toEqual({taps:0,replies:1,rate:0});expect(report.medianReplyLength).toBe(3);
});
