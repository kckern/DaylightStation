import {describe,it,expect} from 'vitest';
import {planDailyAgenda} from './agenda.mjs';
import {resolveDayCompletion} from './completion.mjs';
const scripture={unitId:'scripture-1',title:'Scripture',subject:'scripture',courseId:'cfm',program:null,elective:false,status:'available',timingPriority:3,timingRank:0};
const subject=(id,extra={})=>({...scripture,unitId:id,subject:id,courseId:id,...extra});
const build=(entries,day='2026-11-15',options={})=>planDailyAgenda({plan:{entries},now:`${day}T18:00:00Z`,timezone:'America/Los_Angeles',...options});
describe('Sunday requires only Scripture',()=>{
 it('explicit Sunday schedules, backlog and weekly work cannot create other Sunday obligations',()=>{
  const entries=[scripture,subject('english',{schedule:{daysOfWeek:[7]}}),subject('math',{timing:{mode:'catch_up'},timingState:'catch_up'}),subject('arts',{program:'piano-course',cadence:'weekly',schedule:{daysOfWeek:[7]}})];
  const agenda=build(entries,undefined,{programStatuses:{'piano-course':{doneToday:false}}});
  expect(agenda.sections.find(s=>s.subject==='scripture').obligation.state).toBe('obligated');
  for(const section of agenda.sections.filter(s=>s.subject!=='scripture'))expect(section.obligation.state).toBe('excused');
  expect(resolveDayCompletion(agenda).state).toBe('incomplete');
 });
 it('an unavailable non-Scripture program cannot fault Sunday or block completion after Scripture',()=>{
  const entries=[scripture,subject('arts',{program:'piano-course',cadence:'daily'})],at='2026-11-15T17:00:00Z';
  const agenda=build(entries,undefined,{programStatuses:{'piano-course':{error:true}},sessions:[{unitId:scripture.unitId,outcome:{result:'passed',at},updatedAt:at}]});
  expect(agenda.sections.find(s=>s.subject==='arts').obligation.state).toBe('excused');expect(resolveDayCompletion(agenda)).toMatchObject({state:'complete',faults:[]});
 });
 it('unavailable Scripture remains a fault, and a completed Sunday activity stays credited',()=>{
  const entries=[{...scripture,program:'scripture-reader'},subject('english')],at='2026-11-15T17:00:00Z';
  const agenda=build(entries,undefined,{programStatuses:{'scripture-reader':{error:true}},sessions:[{unitId:'english',outcome:{result:'passed',at},updatedAt:at}]});
  expect(agenda.sections.find(s=>s.subject==='scripture').obligation.state).toBe('faulted');expect(agenda.sections.find(s=>s.subject==='english').servedWork).toHaveLength(1);
 });
 it.each(['2026-11-14','2026-11-16'])('does not excuse normally scheduled work on %s',day=>{
  expect(build([subject('math')],day).sections[0].obligation.state).toBe('obligated');
 });
});
