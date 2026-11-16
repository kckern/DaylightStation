import { hashValue } from '../../../../../__capabilities/content-catalog/server/participant-launch.mjs';
import { itemAction } from '../../portable/planEdits.mjs';

function disable(row) {
  row.disabled = true;
  row.actions = {};
  delete row.android;
  delete row.launchIntent;
}

/** Projects plan-owned runtime references without placing setup or people in catalog metadata. */
export class AgendaMenuProjector {
  constructor({listProjector, codec, resolveTarget, registry, logger = console}) {
    if (!listProjector?.project || !codec?.encode || typeof resolveTarget !== 'function' || !registry?.resolve) throw new Error('Agenda projection dependencies required');
    Object.assign(this, {listProjector, codec, resolveTarget, registry, logger});
  }
  async project({plan, viewer, preview = false, participantLaunchVersion = null}) {
    const sourceId = `agenda:${plan.series_id}/plans/${plan.plan_id}`;
    const menu = await this.listProjector.project({list:plan.list, sourceId, order:'authored'});
    const byUid = new Map(plan.list.sections.flatMap(section => section.items).map(item => [item.uid,item]));
    for (const row of menu.items) {
      const item = byUid.get(row.metadata?.uid);
      const action = itemAction(item);
      if (preview) { disable(row); continue; }
      if (!action) {
        if ((item.list || item.android) && !plan.activity_settings?.[item.uid]) continue;
        disable(row); continue;
      }
      const binding = plan.activity_settings?.[item.uid];
      let target, consumer;
      try {
        target = await this.resolveTarget({item,action,viewer});
        consumer = this.registry.resolve({target,action});
      } catch (error) {
        this.logger.warn?.('agenda.projection.target_unavailable', {itemUid:item.uid, code:error.code || 'target_unavailable'});
        disable(row); continue;
      }
      if (!consumer && !binding) continue;
      if (!consumer || !binding || binding.action !== action || binding.consumer?.id !== consumer.id || binding.consumer?.version !== consumer.version || participantLaunchVersion !== 1) {
        disable(row); continue;
      }
      row.participantLaunches = {[action]:{schema:'participant-launch-ref/v1',provider:'agenda',ref:this.codec.encode({householdId:plan.household_id,planId:plan.plan_id,itemUid:item.uid,revision:plan.revision,action,targetDigest:hashValue(target)})}};
    }
    return {...menu,title:`${plan.title} — ${plan.scheduled_on || plan.week_of}${preview ? ' (Preview)' : ''}`,preview};
  }
}
