import {it,expect} from 'vitest';
import {nextKnowledgeRun} from './KnowledgeCalendarSchedule.mjs';
it('schedules local03:30 across spring DST using calendar days rather than24hours',()=>{
 expect(nextKnowledgeRun({asOf:Date.parse('2026-03-07T11:30Z'),timezone:'America/Los_Angeles',at:'03:30'})).toBe(Date.parse('2026-03-08T10:30Z'));
});
it('schedules Monday05:00 and moves a completed Monday run to the next local Monday',()=>{
 expect(nextKnowledgeRun({asOf:Date.parse('2026-11-08T15:00Z'),timezone:'America/Los_Angeles',at:'05:00',weekday:1})).toBe(Date.parse('2026-11-09T13:00Z'));
 expect(nextKnowledgeRun({asOf:Date.parse('2026-11-09T13:00Z'),timezone:'America/Los_Angeles',at:'05:00',weekday:1})).toBe(Date.parse('2026-11-16T13:00Z'));
});
