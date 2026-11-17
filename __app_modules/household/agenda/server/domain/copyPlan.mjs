import { cloneListValue } from '../../../../../__capabilities/content-catalog/portable/list-structure.mjs';
import { copyContent } from '../../portable/copyContent.mjs';
import { validatePlan, validateSeries } from './contracts.mjs';

function invalid(field, message) { const error = new Error(message); error.field = field; error.code = 'invalid_agenda'; throw error; }
export function createPlan({series, weekOf, sourcePlan, ids, displaySnapshots, remapActivitySettings, imageRefs}) {
  const validation = validateSeries(series);
  if (!validation.valid) invalid(validation.errors[0].field,validation.errors[0].message);
  if (sourcePlan) return copyPlan({source:sourcePlan,targetWeek:weekOf,series,ids,remapActivitySettings,imageRefs}).plan;
  const copied = copyContent({source:series.defaults,ids,displaySnapshots,remapActivitySettings,imageRefs});
  const plan = {schema:'agenda-plan/v1',plan_id:copied.alloc('plan'),series_id:series.series_id,household_id:series.household_id,revision:0,week_of:weekOf,scheduled_on:weekOf,calendar:{timezone:series.calendar.timezone,week_starts_on:'monday'},state:'draft',seeded_from:{kind:'series',id:series.series_id,revision:series.revision},title:series.title,participants:copied.participants,list:copied.list,activity_settings:copied.activity_settings};
  const result = validatePlan(plan,{purpose:'draft'}); if (!result.valid) invalid(result.errors[0].field,result.errors[0].message);
  return plan;
}
export function copyPlan({source, targetWeek, series, ids, remapActivitySettings, imageRefs}) {
  const validation = validatePlan(source,{purpose:'draft'});
  if (!validation.valid) invalid(validation.errors[0].field,validation.errors[0].message);
  if (source.series_id !== series.series_id || source.household_id !== series.household_id) invalid('series_id','Source belongs to another series');
  const copied = copyContent({source,ids,remapActivitySettings,imageRefs});
  const plan = {schema:'agenda-plan/v1',plan_id:copied.alloc('plan'),series_id:source.series_id,household_id:source.household_id,revision:0,week_of:targetWeek,scheduled_on:targetWeek,calendar:cloneListValue(source.calendar),state:'draft',seeded_from:{kind:'plan',id:source.plan_id,revision:source.revision},title:source.title,participants:copied.participants,list:copied.list,activity_settings:copied.activity_settings};
  const result = validatePlan(plan,{purpose:'draft'}); if (!result.valid) invalid(result.errors[0].field,result.errors[0].message);
  return {plan,idMap:copied.idMap};
}
