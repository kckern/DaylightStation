import { cloneListValue } from '../../../../../__capabilities/content-catalog/portable/list-structure.mjs';
import { remapSetup } from '../../portable/planEdits.mjs';
import { validatePlan, validateSeries } from './contracts.mjs';

function invalid(field, message) { const error = new Error(message); error.field = field; error.code = 'invalid_agenda'; throw error; }
function copyContent({source, ids, displaySnapshots, remapActivitySettings}) {
  const participantKeyMap = {}, itemUidMap = {}, sectionUidMap = {}, used = new Set();
  const alloc = kind => {
    if (typeof ids?.[kind] !== 'function') invalid(`ids.${kind}`, 'ID allocator required');
    const id = ids[kind]();
    if (typeof id !== 'string' || !id.trim() || used.has(id)) invalid(`ids.${kind}`, 'Unique ID required');
    used.add(id); return id;
  };
  if (source.plan_id) used.add(source.plan_id);
  for (const p of source.participants) used.add(p.id);
  for (const s of source.list.sections) { used.add(s.uid); for (const i of s.items) used.add(i.uid); }
  const participants = cloneListValue(source.participants);
  for (const p of participants) {
    const old = p.id; p.id = alloc('rosterEntry'); participantKeyMap[old] = p.id;
    if (!p.display && p.person) p.display = cloneListValue(displaySnapshots?.[`${p.person.kind}:${p.person.id}`]);
    if (!p.display || !p.display.name || !Object.hasOwn(p.display,'avatar')) invalid('participants.display','Display snapshot required');
  }
  const list = cloneListValue(source.list);
  for (const section of list.sections) {
    const old = section.uid; section.uid = alloc('section'); sectionUidMap[old] = section.uid;
    for (const item of section.items) { const oldItem = item.uid; item.uid = alloc('item'); itemUidMap[oldItem] = item.uid; }
  }
  const activity_settings = {};
  for (const [uid, setup] of Object.entries(source.activity_settings)) {
    if (!Object.hasOwn(itemUidMap,uid)) invalid(`activity_settings.${uid}`,'Dangling activity settings');
    activity_settings[itemUidMap[uid]] = remapSetup(setup,participantKeyMap,itemUidMap,remapActivitySettings);
  }
  return {participants,list,activity_settings,idMap:{participantKeyMap,itemUidMap,sectionUidMap},alloc};
}
export function createPlan({series, weekOf, sourcePlan, ids, displaySnapshots, remapActivitySettings}) {
  const validation = validateSeries(series);
  if (!validation.valid) invalid(validation.errors[0].field,validation.errors[0].message);
  if (sourcePlan) return copyPlan({source:sourcePlan,targetWeek:weekOf,series,ids,remapActivitySettings}).plan;
  const copied = copyContent({source:series.defaults,ids,displaySnapshots,remapActivitySettings});
  const plan = {schema:'agenda-plan/v1',plan_id:copied.alloc('plan'),series_id:series.series_id,household_id:series.household_id,revision:0,week_of:weekOf,scheduled_on:weekOf,calendar:{timezone:series.calendar.timezone,week_starts_on:'monday'},state:'draft',seeded_from:{kind:'series',id:series.series_id,revision:series.revision},title:series.title,participants:copied.participants,list:copied.list,activity_settings:copied.activity_settings};
  const result = validatePlan(plan,{purpose:'draft'}); if (!result.valid) invalid(result.errors[0].field,result.errors[0].message);
  return plan;
}
export function copyPlan({source, targetWeek, series, ids, remapActivitySettings}) {
  const validation = validatePlan(source,{purpose:'draft'});
  if (!validation.valid) invalid(validation.errors[0].field,validation.errors[0].message);
  if (source.series_id !== series.series_id || source.household_id !== series.household_id) invalid('series_id','Source belongs to another series');
  const copied = copyContent({source,ids,remapActivitySettings});
  const plan = {schema:'agenda-plan/v1',plan_id:copied.alloc('plan'),series_id:source.series_id,household_id:source.household_id,revision:0,week_of:targetWeek,scheduled_on:targetWeek,calendar:cloneListValue(source.calendar),state:'draft',seeded_from:{kind:'plan',id:source.plan_id,revision:source.revision},title:source.title,participants:copied.participants,list:copied.list,activity_settings:copied.activity_settings};
  const result = validatePlan(plan,{purpose:'draft'}); if (!result.valid) invalid(result.errors[0].field,result.errors[0].message);
  return {plan,idMap:copied.idMap};
}
