import { describe, it, expect } from 'vitest';
import { selectQuestions, scoreLoop, experimentArm } from './selectQuestions.mjs';
import { loop, snapshot, ask, AS_OF, TZ } from './fixtures.testHelpers.mjs';
const select = (state, options = {}) => selectQuestions({ snapshot: state, askDate: '2026-11-03', asOf: AS_OF, timezone: TZ, max: 2, ...options });
describe('question selection', () => {
  it('ranks worthwhile overdue loops by the specified score', () => {
    expect(scoreLoop({ stakes: 3, overdueDays: 20, evidenceMoved: true, unansweredAsks: 1 })).toBe(16);
    const l = loop(); expect(select(snapshot({ [l.id]: l })).questions.map(q => q.objectId)).toEqual(['loop.application-reply']);
  });
  it('starts on the local day after due and caps independent morning questions at two', () => {
    const objects = Object.fromEntries(['a','b','c','d'].map(id => { const l = loop({ id: 'loop.' + id }); return [l.id,l]; }));
    expect(select(snapshot(objects), { askDate: '2026-11-02' }).questions).toEqual([]);
    expect(select(snapshot(objects)).questions.map(q => q.objectId)).toEqual(['loop.a','loop.b']);
  });
  it('never asks twice about one linked concern or more than one allowed sensitive loop', () => {
    const a = loop({ id: 'loop.a', links: ['concern.shared'] }); const b = loop({ id: 'loop.b', links: ['concern.shared'] });
    const c = loop({ id: 'loop.c', sensitivity: 'private' }); const d = loop({ id: 'loop.d', sensitivity: 'financial' });
    expect(select(snapshot({ a,b,c,d })).questions.map(q => q.objectId)).toEqual(['loop.a','loop.c']);
  });
  it('keeps never/data-only excluded and user-initiated questions quiz-only', () => {
    const objects = Object.fromEntries(['never','data_only','user_initiated'].map(ask_policy => { const l = loop({ id: 'loop.' + ask_policy.replace('_','-'), ask_policy }); return [l.id,l]; }));
    const result = select(snapshot(objects)); expect(result.questions).toEqual([]);
    expect(result.quizCandidates.map(q => q.objectId)).toEqual(['loop.user-initiated']);
  });
  it('enforces seven-day cooldown and an absolute three-day floor even with a shorter override', () => {
    const l = loop(); const s = snapshot({ [l.id]: l }, { asks: [ask({ askDate: '2026-10-28', deliveredAt: Date.parse('2026-10-28T14:00Z') })] });
    expect(select(s).questions).toEqual([]);
    l.loop.ask.cooldown_days = 1;
    s.asks = [ask({ askDate: '2026-11-01', deliveredAt: Date.parse('2026-11-01T14:00Z') })];
    expect(select(s).questions).toEqual([]);
    s.asks = [ask({ askDate: '2026-10-31', deliveredAt: Date.parse('2026-10-31T14:00Z') })];
    expect(select(s).questions).toHaveLength(1);
  });
  it('queues at most five and does not renew the age of expired quiz items', () => {
    const objects = Object.fromEntries(Array.from({length: 9}, (_,i) => { const l = loop({ id: 'loop.q' + i, ask_policy: 'user_initiated' }); return [l.id,l]; }));
    const s = snapshot(objects); expect(select(s).quizCandidates).toHaveLength(5);
    s.quiz = [{ objectId: 'loop.q0', enqueuedAt: AS_OF - 7*86400000, evidenceDate: '2026-11-02' }];
    expect(select(s).quizCandidates.map(q => q.objectId)).not.toContain('loop.q0');
  });
  it('returns no invented questions when healthy and empty, or when evidence health is unsafe', () => {
    expect(select(snapshot()).questions).toEqual([]);
    const l = loop(); const s = snapshot({ [l.id]: l }, { health: { available: false, conflicted: true, lastSweepAt: AS_OF } });
    expect(select(s).reason).toBe('unavailable'); expect(select(s).questions).toEqual([]);
  });
  it('counts unanswered morning dates rather than repeated delivery rows and honors A/B control days', () => {
    const l = loop();
    const s = snapshot({ [l.id]: l }, { asks: [ask(), ask({id:'duplicate'}), ask({id:'control',askDate:'2026-10-28',arm:'legacy'})] });
    expect(select(s).questions).toHaveLength(1);
  });
});

describe('morning delivery policy', () => {
  it.each([['2026-11-03','knowledge'],['2026-11-04','legacy'],['2026-11-16','legacy'],['2026-11-18','knowledge']])('uses local A/B dates only during the first fourteen days: %s', (askDate,expected) => expect(experimentArm({ activationDate:'2026-11-03', askDate })).toBe(expected));
  it('limits backoff to weekend mornings with one question and keeps the quiz opt-in', () => {
    const a=loop({id:'loop.a'}), b=loop({id:'loop.b'});
    const s=snapshot({a,b},{state:{backoff:{since:'2026-11-01',until:'2026-11-15'}}});
    expect(select(s).questions).toEqual([]);
    expect(select(s,{askDate:'2026-11-07'}).questions).toHaveLength(1);
  });
  it('accepts exactly thirty-six hours of freshness and rejects anything older', () => {
    const l=loop(), s=snapshot({[l.id]:l}); s.health.lastSweepAt=AS_OF-36*3600000;
    expect(select(s).questions).toHaveLength(1); s.health.lastSweepAt-=1;
    expect(select(s).reason).toBe('unavailable');
  });
});
it('treats linked loop tasks as one concern without grouping unrelated person links',()=>{
 const a=loop({id:'loop.first',title:'First task',links:['loop.second']}),b=loop({id:'loop.second',title:'Related task'}),c=loop({id:'loop.third',title:'Independent task'});
 const result=selectQuestions({snapshot:snapshot({[a.id]:a,[b.id]:b,[c.id]:c}),askDate:'2026-11-03',asOf:AS_OF,timezone:TZ});
 expect(result.questions.map(q=>q.objectId)).toEqual(['loop.first','loop.third']);
});
it('does not select using a sweep timestamp from after the requested as-of',()=>{
 const item=loop(),state=snapshot({[item.id]:item});state.health.lastSweepAt=AS_OF+1;
 expect(selectQuestions({snapshot:state,askDate:'2026-11-03',asOf:AS_OF,timezone:TZ}).reason).toBe('unavailable');
});
it('returns a skipped quiz loop after its explicit three-day deferral instead of applying the seven-day answer cooldown',async()=>{
 const {applyUserReply}=await import('./reduceKnowledge.mjs');
 const skipped=applyUserReply({object:loop(),action:'skip',receiptId:'skip-receipt',asOf:AS_OF,timezone:TZ});
 const state=snapshot({[skipped.id]:skipped},{asks:[ask({askDate:'2026-11-03',channel:'quiz',deliveredAt:AS_OF,response:{action:'skip',at:AS_OF}})],health:{available:true,conflicted:false,recovering:false,lastSweepAt:Date.parse('2026-11-05T15:00Z')}});
 expect(select(state,{askDate:'2026-11-05',asOf:Date.parse('2026-11-05T15:00Z')}).questions).toEqual([]);
 state.health.lastSweepAt=Date.parse('2026-11-06T15:00Z');
 expect(select(state,{askDate:'2026-11-06',asOf:Date.parse('2026-11-06T15:00Z')}).questions.map(q=>q.objectId)).toEqual(['loop.application-reply']);
});
