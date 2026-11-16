import { hashValue } from '../../../../../__capabilities/content-catalog/server/participant-launch.mjs';
import { itemAction } from '../../portable/planEdits.mjs';
import { weekOf } from '../domain/calendar.mjs';
import { resolveParticipants } from './resolveParticipants.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };

/** Authorizes retained scope separately from live source resolution. */
export class AgendaParticipantContextProvider {
  id = 'agenda';

  constructor({repository, store, codec, clock, directory, authorize, resolveTarget}) {
    if (!repository || !store || !codec || typeof clock !== 'function' || !directory ||
        typeof authorize !== 'function' || typeof resolveTarget !== 'function') {
      throw Error('Agenda provider dependencies required');
    }
    Object.assign(this, {repository, store, codec, clock, directory, authorize, resolveTarget});
  }

  async authorizeAccess(ref, {viewer, action}) {
    const decoded = this.codec.decode(ref);
    if (decoded.action !== action) fail('invalid_participant_launch_ref', 'Action mismatch');
    const found = await this.repository.readPlan({householdId:decoded.householdId, planId:decoded.planId});
    const plan = found?.document;
    if (!plan || plan.household_id !== decoded.householdId || plan.plan_id !== decoded.planId) {
      fail('launch_not_found', 'Plan unavailable');
    }
    if (!await this.authorize({householdId:decoded.householdId, seriesId:plan.series_id, planId:decoded.planId, itemUid:decoded.itemUid, action, viewer})) {
      fail('authorization_denied', 'Agenda authority required');
    }
    return {store:this.store, scope_key:JSON.stringify([decoded.householdId, plan.series_id, decoded.planId, decoded.itemUid, action])};
  }

  async resolve(ref, {viewer}) {
    const data = this.codec.decode(ref);
    const found = await this.repository.readPlan({householdId:data.householdId, planId:data.planId});
    const plan = found?.document;
    if (!plan || plan.household_id !== data.householdId || plan.plan_id !== data.planId) {
      fail('launch_not_found', 'Plan unavailable');
    }
    if (plan.revision !== data.revision) fail('revision_conflict', 'Plan changed');
    const series = await this.repository.readSeries({householdId:data.householdId, seriesId:plan.series_id});
    if (!series || series.document.status !== 'active' || plan.state !== 'published' ||
        plan.week_of !== weekOf({instant:this.clock(), timezone:plan.calendar.timezone})) {
      fail('agenda_not_launchable', 'Plan is not launchable');
    }
    const source = await this.resolveDraft({plan, itemUid:data.itemUid, viewer});
    if (source.action !== data.action || hashValue(source.target) !== data.targetDigest) {
      fail('revision_conflict', 'Activity target changed');
    }
    return source;
  }

  async validateRoster(plan) { return resolveParticipants({plan,directory:this.directory}); }

  /** Caller has already enforced Admin authority and structural validation. */
  async resolveDraft({plan, itemUid, viewer}) {
    const item = plan.list.sections.flatMap(section => section.items).find(entry => entry.uid === itemUid);
    const binding = plan.activity_settings[itemUid];
    if (!item || !binding || itemAction(item) !== binding.action) {
      fail('invalid_participant_launch_ref', 'Activity binding unavailable');
    }
    const target = await this.resolveTarget({item, action:binding.action, viewer});
    const entries = await resolveParticipants({plan, directory:this.directory});
    const roster = entries.map(entry => ({
      key:entry.id,
      participant_id:entry.runtimeId,
      identity:entry.person ? {kind:entry.person.kind, id:entry.person.id} :
        {kind:'anonymous', scope_id:plan.plan_id, slot_id:entry.id},
      display:entry.display,
    }));
    const selector = binding.participants.mode === 'plan' ?
      {schema:'participant-selector/v1', mode:'all'} :
      {schema:'participant-selector/v1', mode:'explicit', keys:binding.participants.ids};
    const returnTo = {kind:'content', content_id:`agenda:${plan.series_id}/plans/${plan.plan_id}`, item_uid:item.uid};
    const provenance = {
      household_id:plan.household_id, series_id:plan.series_id, plan_id:plan.plan_id,
      item_uid:item.uid, source_revision:plan.revision, item:structuredClone(item),
    };
    return {sourceRevision:plan.revision, scope:{provider:'agenda', id:plan.plan_id, revision:plan.revision},
      roster, selector, action:binding.action, target, consumer:binding.consumer,
      settings:binding.settings, returnTo, sourceLabel:`Week of ${plan.week_of}`, provenance};
  }
}

/** Adapter for AgendaPlanningService's Admin-only activity validation port. */
export function createAgendaActivityValidator({provider, setupResolver}) {
  if (!provider || !setupResolver || typeof provider.validateRoster !== 'function' || typeof provider.resolveTarget !== 'function' || typeof setupResolver.registry?.resolve !== 'function') throw Error('Provider, setup resolver and consumer registry required');
  return async ({plan, viewer}) => {
    const errors = [];
    try { await provider.validateRoster(plan); }
    catch (error) {
      if (['service_unavailable','prepared_artifact_unavailable'].includes(error.code)) throw error;
      return {valid:false,errors:[{field:error.field || 'participants',message:error.message,code:error.code}]};
    }
    for (const item of plan.list?.sections.flatMap(section=>section.items) ?? []) {
      const action=itemAction(item) || (item.list ? 'list' : null);
      if (!action || plan.activity_settings[item.uid]) continue;
      try {
        const target=await provider.resolveTarget({item,action,viewer});
        if (setupResolver.registry.resolve({target,action})) errors.push({field:`activity_settings.${item.uid}`,message:'Participant setup is required for this activity',code:'participant_setup_required'});
      } catch (error) {
        if (['service_unavailable','prepared_artifact_unavailable'].includes(error.code)) throw error;
        errors.push({field:`list.items.${item.uid}`,message:error.message,code:error.code});
      }
    }
    for (const itemUid of Object.keys(plan.activity_settings)) {
      try {
        const resolvedSource = await provider.resolveDraft({plan, itemUid, viewer});
        await setupResolver.resolve({resolvedSource, viewer});
      } catch (error) {
        if (['service_unavailable', 'prepared_artifact_unavailable'].includes(error.code)) throw error;
        const sourceField = error.field;
        let field;
        if (sourceField === 'participants' || sourceField?.startsWith('participants.')) field = sourceField;
        else if (sourceField === 'selector') field = `activity_settings.${itemUid}.participants`;
        else if (sourceField === 'selector.keys' || sourceField?.startsWith('selector.keys.')) field = `activity_settings.${itemUid}.participants.ids${sourceField.slice('selector.keys'.length)}`;
        else if (sourceField === 'selector.mode') field = `activity_settings.${itemUid}.participants.mode`;
        else field = `activity_settings.${itemUid}${sourceField ? `.${sourceField}` : ''}`;
        errors.push({field, message:error.message, code:error.code});
      }
    }
    return {valid:errors.length === 0, errors};
  };
}
