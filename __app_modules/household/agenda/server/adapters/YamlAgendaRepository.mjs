import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { readDirectory, readTextFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { validatePlan, validateSeries } from '../domain/contracts.mjs';
import { AgendaWriteLanes } from './AgendaWriteLanes.mjs';

const fail = (code, message) => Object.assign(new Error(message), {code});
const safe = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) || value === '..') throw fail('invalid_id','Invalid path identity'); return value; };
const digest = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const list = directory => { try { return readDirectory(directory, {withFileTypes:true}); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
const read = file => { try { const raw=readTextFromPath(file); const document=yaml.load(raw); return {document,etag:`"${digest(raw)}"`}; } catch(error) { if (error.code === 'ENOENT') return null; throw error; } };

const sharedLanes = new AgendaWriteLanes();

/** One installed process owns writes. Atomic rename is not cross-process CAS. */
export class YamlAgendaRepository {
  constructor({pathForHousehold,lanes = sharedLanes}) { if (typeof pathForHousehold !== 'function') throw new Error('pathForHousehold required'); this.pathForHousehold=pathForHousehold; this.lanes=lanes; }
  root(householdId) { return path.join(this.pathForHousehold(safe(householdId)),'agendas','series'); }
  seriesDir(householdId,seriesId) { return path.join(this.root(householdId),safe(seriesId)); }
  laneKey(householdId,seriesId) { return JSON.stringify([safe(householdId),safe(seriesId)]); }
  withSeriesLane(key,fn) { return this.lanes.withSeriesLane(key,fn); }
  async readSeries({householdId,seriesId}) { const result=read(path.join(this.seriesDir(householdId,seriesId),'series.yml')); if (!result) return null; const d=result.document; if (!validateSeries(d).valid || d.household_id !== householdId || d.series_id !== seriesId) throw fail('invalid_document','Invalid or foreign series'); return clone(result); }
  async listPlans({householdId,seriesId}) { const dir=path.join(this.seriesDir(householdId,seriesId),'plans'); const result=[]; for (const entry of list(dir)) { if (!entry.isFile() || !entry.name.endsWith('.yml') || entry.name.startsWith('.')) continue; const planId=safe(entry.name.slice(0,-4)); const p=await this.readPlanInSeries({householdId,seriesId,planId}); if (p) result.push(p); } const weeks=new Set(); for (const {document} of result) { if (weeks.has(document.week_of)) throw fail('duplicate_week','Duplicate plan week'); weeks.add(document.week_of); } return result; }
  async readPlanInSeries({householdId,seriesId,planId}) { const result=read(path.join(this.seriesDir(householdId,seriesId),'plans',`${safe(planId)}.yml`)); if (!result) return null; const d=result.document; if (!validatePlan(d).valid || d.household_id !== householdId || d.series_id !== seriesId || d.plan_id !== planId) throw fail('invalid_document','Invalid or foreign plan'); return clone(result); }
  async readPlan({householdId,planId}) { safe(planId); let found=null; for (const entry of list(this.root(householdId))) { if (!entry.isDirectory()) continue; const seriesId=safe(entry.name); const p=await this.readPlanInSeries({householdId,seriesId,planId}); if (p && found) throw fail('invalid_document','Duplicate plan identity'); if (p) found=p; } return found; }
  async mutateSeries({householdId,seriesId,expectedEtag,mutate}) { return this.withSeriesLane(this.laneKey(householdId,seriesId),async()=>{ const old=await this.readSeries({householdId,seriesId}); if ((old?.etag ?? null)!==expectedEtag) throw fail('revision_conflict','Series changed'); const next=await mutate(clone(old?.document ?? null)); if (!next || next.household_id!==householdId || next.series_id!==seriesId) throw fail('invalid_document','Invalid series identity'); next.revision=(old?.document.revision ?? -1)+1; if (!validateSeries(next).valid) throw fail('invalid_document','Invalid series'); if (old && JSON.stringify(old.document.calendar)!==JSON.stringify(next.calendar) && (await this.listPlans({householdId,seriesId})).length) throw fail('calendar_locked','Calendar migration required'); saveYamlToPathAtomic(path.join(this.seriesDir(householdId,seriesId),'series.yml'),next,{durable:true}); return this.readSeries({householdId,seriesId}); }); }
  async mutatePlan({householdId,planId,expectedEtag,mutate}) { const located=await this.readPlan({householdId,planId}); if (!located) throw fail('not_found','Plan not found'); const seriesId=located.document.series_id; return this.withSeriesLane(this.laneKey(householdId,seriesId),async()=>{ const old=await this.readPlanInSeries({householdId,seriesId,planId}); if (!old || old.etag!==expectedEtag) throw fail('revision_conflict','Plan changed'); const next=await mutate(clone(old.document)); if (!next || next.plan_id!==planId || next.household_id!==householdId || next.series_id!==seriesId || next.week_of!==old.document.week_of || JSON.stringify(next.calendar)!==JSON.stringify(old.document.calendar) || JSON.stringify(next.seeded_from)!==JSON.stringify(old.document.seeded_from)) throw fail('invalid_document','Plan identity and calendar are immutable'); next.revision=old.document.revision+1; if (!validatePlan(next).valid) throw fail('invalid_document','Invalid plan'); saveYamlToPathAtomic(path.join(this.seriesDir(householdId,seriesId),'plans',`${planId}.yml`),next,{durable:true}); return this.readPlanInSeries({householdId,seriesId,planId}); }); }
  async createPlan({householdId, seriesId, weekOf, requestId, sourcePlanId = null, make}) {
    if (typeof requestId !== 'string' || !requestId.trim()) throw fail('invalid_request', 'Request ID required');
    if (sourcePlanId !== null) safe(sourcePlanId);
    const token = digest(JSON.stringify([householdId, seriesId, requestId]));
    const planId = `ap_${token}`;
    const receiptPath = path.join(this.seriesDir(householdId, seriesId), 'requests', `${token}.yml`);
    return this.withSeriesLane(this.laneKey(householdId, seriesId), async () => {
      const receiptFile = read(receiptPath);
      let receipt = receiptFile?.document;
      if (receiptFile) {
        if (!receipt || receipt.schema !== 'agenda-create-request/v1' ||
            Object.keys(receipt).sort().join(',') !== 'household_id,plan_id,schema,series_id,source_plan_id,week_of' ||
            !(receipt.plan_id === null || typeof receipt.plan_id === 'string')) throw fail('invalid_document', 'Invalid request receipt');
        if (receipt.week_of !== weekOf || receipt.source_plan_id !== sourcePlanId ||
            receipt.household_id !== householdId || receipt.series_id !== seriesId) throw fail('idempotency_conflict', 'Request reused');
        if (receipt.plan_id !== null) {
          const existing = await this.readPlanInSeries({householdId, seriesId, planId:receipt.plan_id});
          if (!existing || existing.document.week_of !== receipt.week_of) throw fail('invalid_document', 'Request references missing or mismatched plan');
          return existing;
        }
      } else {
        const committed = await this.readPlanInSeries({householdId, seriesId, planId});
        if (committed && (committed.document.week_of !== weekOf ||
            (committed.document.seeded_from.kind === 'plan' ? committed.document.seeded_from.id : null) !== sourcePlanId)) {
          throw fail('idempotency_conflict', 'Request reused');
        }
        receipt = {schema:'agenda-create-request/v1', household_id:householdId, series_id:seriesId,
          week_of:weekOf, source_plan_id:sourcePlanId, plan_id:null};
        saveYamlToPathAtomic(receiptPath, receipt, {durable:true});
      }
      const series = await this.readSeries({householdId, seriesId});
      if (!series) throw fail('not_found', 'Series not found');
      const plans = await this.listPlans({householdId, seriesId});
      let existing = plans.find(p => p.document.plan_id === planId);
      if (existing && (existing.document.week_of !== weekOf ||
          (existing.document.seeded_from.kind === 'plan' ? existing.document.seeded_from.id : null) !== sourcePlanId)) {
        throw fail('idempotency_conflict', 'Request reused');
      }
      if (!existing && series.document.status !== 'active') throw fail('series_archived', 'Series archived');
      existing ??= plans.find(p => p.document.week_of === weekOf);
      if (!existing) {
        const next = await make({series:series.document, planId});
        if (next.plan_id !== planId || next.week_of !== weekOf || next.household_id !== householdId ||
            next.series_id !== seriesId || !validatePlan(next).valid) throw fail('invalid_document', 'Invalid new plan');
        saveYamlToPathAtomic(path.join(this.seriesDir(householdId, seriesId), 'plans', `${planId}.yml`), next, {durable:true});
        existing = await this.readPlanInSeries({householdId, seriesId, planId});
      }
      saveYamlToPathAtomic(receiptPath, {...receipt, plan_id:existing.document.plan_id}, {durable:true});
      return existing;
    });
  }
}
