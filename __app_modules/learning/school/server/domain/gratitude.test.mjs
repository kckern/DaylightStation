import { describe,it,expect } from 'vitest';
import { deriveGratitudeState,recentGratitudeFacts,validateGratitudeEnrollment } from './gratitude.mjs';
describe('gratitude policy',()=>{
  it('refuses an orphan completion instead of deriving unassessed credit',()=>{
    expect(()=>deriveGratitudeState([{type:'completed',at:'2026-11-16T18:00:00Z'}])).toThrow(/evidence/i);
  });
  it('allows a topic again on the seventh study-day date difference',()=>{
    const records=[{learnerId:'child',studyDay:'2026-11-16',events:[{type:'publication-pending',attemptId:'a',text:'My toys',subject:'Toys',selectionId:'s'},{type:'completed',selectionId:'s'}]}];
    expect(recentGratitudeFacts(records,{learnerId:'child',studyDay:'2026-11-22',spacingDays:7})).toHaveLength(1);
    expect(recentGratitudeFacts(records,{learnerId:'child',studyDay:'2026-11-23',spacingDays:7})).toEqual([]);
    expect(recentGratitudeFacts(records,{learnerId:'other',studyDay:'2026-11-22',spacingDays:7})).toEqual([]);
  });
  it('holds a fixed cooldown across midnight and releases exactly at expiry',()=>{
    const events=[{type:'submitted',attemptId:'a',at:'2026-11-17T11:50:00Z',text:'lalala',via:'typed'}, {type:'assessed',attemptId:'a',at:'2026-11-17T11:50:00Z',verdict:'nonsense'},{type:'refused',attemptId:'a',at:'2026-11-17T11:50:00Z',retryAt:'2026-11-17T12:20:00Z',reason:'nonsense'}];
    expect(deriveGratitudeState(events,{now:'2026-11-17T12:19:59Z'})).toMatchObject({phase:'cooldown',retryAt:'2026-11-17T12:20:00Z'});
    expect(deriveGratitudeState(events,{now:'2026-11-17T12:20:00Z'}).phase).toBe('retry');
  });
  it('validates enrollment to the scripture shelf without adding a course',()=>{
    expect(validateGratitudeEnrollment({}).enrollment).toMatchObject({programId:'gratitude',corpusId:null,subject:'scripture'});
    expect(validateGratitudeEnrollment({subject:'unknown'}).errors.length).toBeGreaterThan(0);
  });
});
