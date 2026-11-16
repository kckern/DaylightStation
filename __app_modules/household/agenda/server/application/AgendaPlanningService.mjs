import { validatePlan, validateSeries } from '../domain/contracts.mjs';
import { createPlan as instantiate } from '../domain/copyPlan.mjs';
import { weekOf } from '../domain/calendar.mjs';

const fail=(code,message,errors)=>Object.assign(new Error(message),{code,...(errors ? {errors} : {})});
export class AgendaPlanningService {
  constructor({repository,clock,ids,validateActivities,logger,resolveDisplay,remapActivitySettings,resolveItemImage,householdTimezone}) { if (!repository || typeof clock!=='function' || !ids || typeof validateActivities!=='function' || !logger) throw new Error('Repository, clock, IDs, activity validation and logger required'); Object.assign(this,{repository,clock,ids,validateActivities,logger,resolveDisplay,remapActivitySettings,resolveItemImage,householdTimezone}); }
  async createPlan({householdId,seriesId,weekOf:week,requestId,sourcePlanId=null,sourceRevision=null}) { return this.repository.createPlan({householdId,seriesId,weekOf:week,requestId,sourcePlanId,sourceRevision,make:async({series,planId})=>{ const sourcePlan=sourcePlanId ? (await this.repository.readPlanInSeries({householdId,seriesId,planId:sourcePlanId}))?.document : undefined; if (sourcePlanId && !sourcePlan) throw fail('not_found','Source plan not found'); if (sourceRevision !== null && (sourcePlan ?? series).revision !== sourceRevision) throw fail('revision_conflict','Source changed'); const displaySnapshots={}; if (!sourcePlan) for (const p of series.defaults.participants) if (p.person) { if (typeof this.resolveDisplay!=='function') throw fail('invalid_agenda','Identity display resolver required'); const entry=await this.resolveDisplay({householdId,person:p.person}); if (!entry?.display || entry.active===false) throw fail('invalid_agenda','Person unavailable'); displaySnapshots[`${p.person.kind}:${p.person.id}`]=entry.display; } const imageRefs=await this.resolveArtwork({source:sourcePlan ?? series.defaults,householdId}); const plan=instantiate({series,weekOf:week,sourcePlan,imageRefs,ids:{...this.ids,plan:()=>planId},displaySnapshots,remapActivitySettings:this.remapActivitySettings}); const now=new Date(this.clock()).toISOString(); return {...plan,created_at:now,updated_at:now}; }}); }
  async resolveArtwork({source,householdId}) {
    const images=Object.create(null);
    for (const item of source.list.sections.flatMap(section=>section.items)) {
      if (item.image) continue;
      if (typeof this.resolveItemImage !== 'function') throw fail('service_unavailable','Artwork resolver unavailable');
      const image=await this.resolveItemImage({householdId,item});
      if (image != null && (typeof image !== 'string' || !image)) throw fail('service_unavailable','Invalid artwork reference');
      if (image) images[item.uid]=image;
    }
    return images;
  }
  async defaultsArtwork({householdId,seriesId}) {
    const series=await this.repository.readSeries({householdId,seriesId});
    if (!series) throw fail('not_found','Series not found');
    return {revision:series.document.revision,images:await this.resolveArtwork({source:series.document.defaults,householdId})};
  }
  validateSeriesDocument(series) { const result=validateSeries(series); if (this.householdTimezone && series?.calendar?.timezone !== this.householdTimezone) return {valid:false,errors:[...result.errors,{field:'calendar.timezone',message:'Must match household timezone'}]}; return result; }
  validatePlanDocument(plan) { return validatePlan(plan); }
  async validateDraft({plan,viewer}) { const structural=validatePlan(plan,{purpose:'publish'}); if (!structural.valid) return structural; const validation=await this.validateActivities({plan,viewer}); if (!validation || typeof validation.valid!=='boolean' || !Array.isArray(validation.errors)) throw fail('invalid_validation','Activity validation returned an invalid result'); return validation; }
  async change({householdId,planId,expectedEtag,viewer,update,validate=false}) { return this.repository.mutatePlan({householdId,planId,expectedEtag,mutate:async old=>{ if (old.week_of < weekOf({instant:this.clock(),timezone:old.calendar.timezone})) throw fail('past_plan','Past plans are read-only'); const next=await update(old); next.created_at=old.created_at; next.updated_at=new Date(this.clock()).toISOString(); if (validate || next.state==='published') { const result=await this.validateDraft({plan:next,viewer}); if (!result.valid) throw fail('invalid_agenda','Plan validation failed',result.errors); } this.logger.info?.('agenda.plan.changed',{householdId,planId,state:next.state}); return next; }}); }
  async savePlan({householdId,planId,expectedEtag,plan,viewer}) { return this.change({householdId,planId,expectedEtag,viewer,update:old=>{ if (!['draft','published'].includes(old.state) || plan.state!==old.state) throw fail('invalid_transition','Cannot save this plan state'); return structuredClone(plan); }}); }
  async transition(args,state,from,validate=false) { return this.change({...args,validate,update:old=>{if (!from.includes(old.state)) throw fail('invalid_transition','Invalid plan transition'); return {...old,state};}}); }
  publishPlan(args) { return this.transition(args,'published',['draft'],true); }
  withdrawPlan(args) { return this.transition(args,'draft',['published']); }
  cancelPlan(args) { return this.transition(args,'cancelled',['draft','published']); }
  archivePlan(args) { return this.transition(args,'archived',['draft','published','cancelled']); }
  saveSeries({householdId,seriesId,expectedEtag,series}) { return this.repository.mutateSeries({householdId,seriesId,expectedEtag,mutate:old=>({...structuredClone(series),created_at:old?.created_at ?? new Date(this.clock()).toISOString(),updated_at:new Date(this.clock()).toISOString()})}); }
  archiveSeries({householdId,seriesId,expectedEtag}) { return this.repository.mutateSeries({householdId,seriesId,expectedEtag,mutate:old=>{if (!old) throw fail('not_found','Series not found'); return {...old,status:'archived',updated_at:new Date(this.clock()).toISOString()};}}); }
  async listSeries(args) { return this.repository.listSeries(args); }
  async readSeries(args) { return this.repository.readSeries(args); }
  async readPlan(args) { return this.repository.readPlanInSeries(args); }
  async listPlans(args) { return this.repository.listPlans(args); }
  async planningContext({householdId,seriesId}) {
    const series=await this.repository.readSeries({householdId,seriesId});
    if (!series) throw fail('not_found','Series not found');
    const thisWeek=weekOf({instant:this.clock(),timezone:series.document.calendar.timezone});
    const next=new Date(`${thisWeek}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate()+7);
    return {thisWeek,nextWeek:next.toISOString().slice(0,10)};
  }
  async resolveCurrent({householdId,seriesId}) { const series=await this.repository.readSeries({householdId,seriesId}); if (!series) throw fail('not_found','Series not found'); const week=weekOf({instant:this.clock(),timezone:series.document.calendar.timezone}); const plan=(await this.listPlans({householdId,seriesId})).find(p=>p.document.week_of===week); return {weekOf:week,document:plan?.document.state==='published' ? plan.document : null,etag:plan?.document.state==='published' ? plan.etag : null,state:plan?.document.state ?? 'missing'}; }
}
