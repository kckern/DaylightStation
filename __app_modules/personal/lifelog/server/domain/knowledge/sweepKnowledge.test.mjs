import { describe, it, expect } from 'vitest';
import { sweepKnowledge } from './sweepKnowledge.mjs';
import { loop, snapshot, ask, AS_OF, TZ } from './fixtures.testHelpers.mjs';
const sweep = s => sweepKnowledge({ snapshot: s, asOf: AS_OF, timezone: TZ });
describe('deterministic retirement', () => {
  it('retires a loop after two aged unanswered acknowledged asks, never prepared deliveries', () => {
    const l = loop(); const s = snapshot({ [l.id]: l }, { asks: [ask(),ask({id:'ask-2',botMessageId:'bot-2',askDate:'2026-10-30',deliveredAt:Date.parse('2026-10-30T14:00Z')})] });
    expect(sweep(s).upserts[0].status).toBe('stale');
    s.asks[1].deliveredAt = null; s.asks[1].botMessageId = null;
    expect(sweep(s).upserts).toEqual([]);
  });
  it('does not treat a just-delivered second ask as unanswered before its reply window', () => {
    const l = loop(); const s = snapshot({ [l.id]: l }, { asks: [ask(),ask({id:'ask-2',botMessageId:'bot-2',askDate:'2026-11-03',deliveredAt:AS_OF})] });
    expect(sweep(s).upserts).toEqual([]);
  });
  it('retires after two skips, and defers one skip for three local calendar days', () => {
    const l = loop(); const skips = [ask({response:{action:'skip',at:Date.parse('2026-11-01T14:00Z')}})];
    const first = sweep(snapshot({ [l.id]: l }, { asks: skips }));
    expect(first.upserts[0].loop.ask.deferred_until).toBe('2026-11-04');
    skips.push(ask({id:'ask-2',botMessageId:'bot-2',response:{action:'skip',at:AS_OF}}));
    expect(sweep(snapshot({ [l.id]: l }, { asks: skips })).upserts[0].status).toBe('stale');
  });
  it('ages sixty days past due without fresh evidence and preserves pinned status', () => {
    const l = loop({ touched:'2026-08-01', loop:{kind_of:'status',due:'2026-09-04',ask:{eligible_from:'2026-09-05'},stakes:1} });
    expect(sweep(snapshot({ [l.id]: l })).upserts[0].status).toBe('stale');
    l.pinned=['status']; expect(sweep(snapshot({ [l.id]: l })).upserts).toEqual([]);
  });
  it('sets fourteen-day weekend-only backoff after three distinct ignored KB mornings', () => {
    const asks = ['2026-10-27','2026-10-29','2026-10-31'].map((askDate,i) => ask({id:'ask-'+i,objectId:'loop.'+i,askDate,deliveredAt:Date.parse(askDate+'T14:00Z')}));
    const result = sweep(snapshot({}, {asks}));
    expect(result.statePatch.backoff).toMatchObject({since:'2026-11-03',until:'2026-11-17'});
    asks[2].response={action:'not_yet',at:AS_OF};
    expect(sweep(snapshot({}, {asks,state:{backoff:{since:'2026-11-01',until:'2026-11-15'}}})).statePatch.backoff).toBeNull();
  });
});
it('resets morning back-off on acknowledged message engagement without answering individual loops',()=>{
 const item=loop(),input=snapshot({[item.id]:item},{asks:[ask({askDate:'2026-11-03',deliveredAt:AS_OF-2*3600000,botMessageId:'99',arm:'knowledge'})],state:{backoff:{since:'2026-11-01',until:'2026-11-20',startedAt:AS_OF-3600000},messageReplies:{receipt:{at:AS_OF,botMessageId:'99',arm:'knowledge',channel:'morning',attribution:'reply_to'}}}});
 expect(sweepKnowledge({snapshot:input,asOf:AS_OF,timezone:TZ}).statePatch.backoff).toBeNull();expect(input.asks[0].response).toBeNull();
});
