import { itemAction, itemActions } from '../../portable/planEdits.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const keys = (value, allowed, path, errors) => {
  if (!object(value)) { errors.push({ field:path, message:'Object required' }); return false; }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push({ field:`${path}.${key}`, message:'Unknown field' });
  return true;
};
const need = (condition, field, errors) => { if (!condition) errors.push({field, message:'Invalid or missing value'}); };
const timezone = value => { try { new Intl.DateTimeFormat('en', {timeZone:value}); return text(value); } catch { return false; } };
function contents(participants, list, settings, errors, requireDisplay) {
  const roster = new Set(), people = new Set(), items = new Map(), uids = new Set();
  need(Array.isArray(participants), 'participants', errors);
  for (const [index, p] of (Array.isArray(participants) ? participants : []).entries()) {
    const path = `participants.${index}`;
    if (!keys(p,['id','person','anonymous','display'],path,errors)) continue;
    need(text(p.id) && !roster.has(p.id), `${path}.id`, errors); roster.add(p.id);
    if (p.person) {
      if (keys(p.person,['kind','id'],`${path}.person`,errors)) {
        const key = `${p.person.kind}:${p.person.id}`;
        need(['user','guest'].includes(p.person.kind) && text(p.person.id) && !people.has(key) && !p.anonymous, `${path}.person`, errors); people.add(key);
      }
    } else need(p.anonymous === true, `${path}.anonymous`, errors);
    if (requireDisplay || p.display) {
      if (keys(p.display,['name','avatar'],`${path}.display`,errors)) need(text(p.display.name) && Object.hasOwn(p.display,'avatar'), `${path}.display`, errors);
    }
  }
  if (object(list) && Array.isArray(list.sections)) {
    for (const section of list.sections) {
      need(text(section?.uid) && !uids.has(section?.uid), 'list.sections.uid', errors); uids.add(section?.uid);
      need(Array.isArray(section?.items), 'list.sections.items', errors);
      for (const item of (Array.isArray(section?.items) ? section.items : [])) {
        need(text(item?.uid) && !uids.has(item?.uid), 'list.items.uid', errors); uids.add(item?.uid); items.set(item?.uid,item);
        const actionCount=itemActions(item).length + Number(Boolean(item?.list)) + Number(Boolean(item?.android));
        need(actionCount <= 1, 'list.items.action', errors);
      }
    }
  } else need(false,'list.sections',errors);
  if (!object(settings)) { need(false,'activity_settings',errors); return; }
  for (const [uid, setup] of Object.entries(settings)) {
    const path = `activity_settings.${uid}`;
    if (!keys(setup,['schema','action','participants','consumer','settings'],path,errors)) continue;
    need(setup.schema === 'agenda-activity-setup/v1',`${path}.schema`,errors);
    need(items.has(uid) && text(setup.action) && itemAction(items.get(uid)) === setup.action,`${path}.action`,errors);
    if (keys(setup.participants,['mode','ids'],`${path}.participants`,errors)) {
      const p = setup.participants;
      need(['plan','explicit'].includes(p.mode),`${path}.participants.mode`,errors);
      if (p.mode === 'explicit') need(Array.isArray(p.ids) && new Set(p.ids).size === p.ids.length && p.ids.every(id => roster.has(id)),`${path}.participants.ids`,errors);
      else need(!Object.hasOwn(p,'ids'),`${path}.participants.ids`,errors);
    }
    if (keys(setup.consumer,['id','version'],`${path}.consumer`,errors)) need(text(setup.consumer.id) && Number.isInteger(setup.consumer.version) && setup.consumer.version > 0,`${path}.consumer`,errors);
    need(object(setup.settings),`${path}.settings`,errors);
  }
}
export function validateSeries(series) {
  const errors=[];
  if (keys(series,['schema','series_id','household_id','revision','title','calendar','status','defaults','created_at','updated_at'],'series',errors)) {
    need(series.schema === 'agenda-series/v1','schema',errors);
    for (const key of ['series_id','household_id','title']) need(text(series[key]),key,errors);
    need(Number.isInteger(series.revision) && series.revision >= 0,'revision',errors);
    need(['active','archived'].includes(series.status),'status',errors);
    if (keys(series.calendar,['frequency','timezone','week_starts_on','default_day'],'calendar',errors)) {
      need(series.calendar.frequency === 'weekly' && series.calendar.week_starts_on === 'monday' && series.calendar.default_day === 'monday' && timezone(series.calendar.timezone),'calendar',errors);
    }
    if (keys(series.defaults,['participants','list','activity_settings'],'defaults',errors)) contents(series.defaults.participants,series.defaults.list,series.defaults.activity_settings,errors,false);
  }
  return {valid:errors.length === 0,errors};
}
export function validatePlan(plan, {purpose = 'draft'} = {}) {
  const errors=[];
  need(['draft','publish'].includes(purpose),'purpose',errors);
  if (keys(plan,['schema','plan_id','series_id','household_id','revision','week_of','scheduled_on','calendar','state','seeded_from','title','participants','list','activity_settings','created_at','updated_at'],'plan',errors)) {
    need(plan.schema === 'agenda-plan/v1','schema',errors);
    for (const key of ['plan_id','series_id','household_id','title']) need(text(plan[key]),key,errors);
    need(Number.isInteger(plan.revision) && plan.revision >= 0,'revision',errors);
    need(['draft','published','cancelled','archived'].includes(plan.state),'state',errors);
    if (keys(plan.calendar,['timezone','week_starts_on'],'calendar',errors)) need(timezone(plan.calendar.timezone) && plan.calendar.week_starts_on === 'monday','calendar',errors);
    const monday = date(plan.week_of) && new Date(`${plan.week_of}T00:00:00Z`).getUTCDay() === 1;
    need(monday,'week_of',errors);
    need(date(plan.scheduled_on) && monday && plan.scheduled_on >= plan.week_of && (Date.parse(`${plan.scheduled_on}T00:00:00Z`) - Date.parse(`${plan.week_of}T00:00:00Z`)) / 86400000 < 7,'scheduled_on',errors);
    if (keys(plan.seeded_from,['kind','id','revision'],'seeded_from',errors)) need(['series','plan'].includes(plan.seeded_from.kind) && text(plan.seeded_from.id) && Number.isInteger(plan.seeded_from.revision),'seeded_from',errors);
    contents(plan.participants,plan.list,plan.activity_settings,errors,true);
  }
  return {valid:errors.length === 0,errors};
}
