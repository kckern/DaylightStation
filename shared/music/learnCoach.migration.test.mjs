import { describe, it, expect } from 'vitest';
import records from './__fixtures__/learnCoachCapturedPractice.json';
import { createCoachPlan, projectCoach, applyCoachEvent } from './learnCoach.mjs';

// Thirteen observed practice records, with profiles, titles, hashes and dates anonymized.
// Counters, measure ranges, completion flags and missing metadata are preserved.
const planFor = ({ scoreId, record }) => createCoachPlan({ scoreId, fingerprint: record.fingerprint.contentSha256,
  segments: Object.keys(record.learn?.segments ?? record.learn?.passages ?? { 'm0-3': {} }).map((id) => {
    const [, start, end] = id.match(/^m(\d+)-(\d+)$/) ?? [];
    return { id, inMeasure: Number(start), outMeasure: Number(end), playableParts: ['rh', 'lh'] };
  }) });
describe('captured Learn progress migration', () => {
 it('covers every captured record', () => expect(records).toHaveLength(13));
 for (const [index, fixture] of records.entries()) it(`retains all earned work in captured record ${index + 1}`, () => {
  const before = JSON.stringify(fixture.record);const plan = planFor(fixture);
  const projection = projectCoach({ plan, legacy: fixture.record, dayKey: '2026-10-26' });
  expect(projection.retainedLegacy.passages).toEqual(fixture.record.learn?.passages ?? {});
  for(const segment of projection.segments) {
    const old = fixture.record.learn?.passages?.[segment.id];
    for(const skill of segment.skills) if((old?.rungs?.[skill.skill]?.passCount ?? 0)>=6) expect(skill).toMatchObject({ ready:true, provenance:'legacy' });
    if(!old?.complete&&!old?.testedOut) expect(segment.mastered).toBe(false);
  }
  expect(JSON.stringify(fixture.record)).toBe(before);
 });
 it('retains old earned counts separately when the score content changes',()=>{
  const fixture=records.find(row=>Object.values(row.record.learn?.passages??{}).some(p=>Object.values(p.rungs??{}).some(r=>r.passCount>=6)));
  const old=planFor(fixture);const plan=createCoachPlan({...old,fingerprint:'revised-score'});
  const projection=projectCoach({plan,legacy:fixture.record,dayKey:'2026-10-26'});
  expect(projection.segments.every(segment=>segment.skills.every(skill=>!skill.ready))).toBe(true);
  expect(projection.retainedLegacy).toMatchObject({compatible:false,passages:fixture.record.learn.passages});
 });
 it('never uses invalid historical timed failures to trigger an easier task or revoke retained work',()=>{
  const fixture=records[2];const plan=planFor(fixture);const task=plan.tasks.find(t=>t.mode==='cued');
  let state;for(let i=0;i<3;i++)state=applyCoachEvent(state,{id:`old-${i}`,type:'outcome',task,result:{status:'completed',rubric:{version:'2'},criteria:{completeness:0,cleanliness:0,placement:0},diagnostics:{expected_notes:8,matched_notes:0,missed_notes:8}}},{plan,now:'2026-10-26T18:00:00Z',dayKey:'2026-10-26'});
  expect(state.evidence).toHaveLength(0);expect(state.resume).toBeNull();
  expect(projectCoach({plan,state,legacy:fixture.record,dayKey:'2026-10-26'}).segments[0].skills.find(s=>s.skill==='right').ready).toBe(true);
 });
});
