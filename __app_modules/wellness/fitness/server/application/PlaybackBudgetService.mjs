import { normalizePlaybackBudgetPolicies, reconcileBudget, reserveBudget, settleBudget, budgetView } from '../domain/services/playbackBudget.mjs';
import { classifySupervision, isGovernedChildId } from '../../shared/supervision.mjs';
import { hasGovernedLabel } from '../../shared/governedContent.mjs';

/** Durable, serialized allowance owner. The browser may spend only returned grants. */
export class PlaybackBudgetService {
  #store; #config; #catalog; #clock; #calendar; #devices; #logger; #queues = new Map(); #content = new Map();
  constructor({ store, policyConfig, contentCatalog, clock, calendar, deviceDirectory, logger }) {
    this.#store=store; this.#config=policyConfig; this.#catalog=contentCatalog;
    this.#clock=clock; this.#calendar=calendar; this.#devices=deviceDirectory; this.#logger=logger;
  }
  #serial(householdId, work) {
    const prior=this.#queues.get(householdId)??Promise.resolve();
    const run=prior.catch(()=>{}).then(work);
    this.#queues.set(householdId,run);
    run.finally(()=>{if(this.#queues.get(householdId)===run)this.#queues.delete(householdId);}).catch(()=>{});
    return run;
  }
  #setup({ householdId, deviceId }) {
    if(typeof householdId!=='string'||!householdId||typeof deviceId!=='string'||!Object.hasOwn(this.#devices(householdId)??{},deviceId)) throw new TypeError('Unknown playback budget device');
    const config=this.#config(householdId)??{};
    const policies=normalizePlaybackBudgetPolicies(config.governance?.playback_budgets);
    const nowMs=this.#clock.now(); const day=this.#calendar(nowMs,householdId);
    return {householdId,deviceId,config,policies,nowMs,...day};
  }
  async #load(key) {
    const value=await this.#store.load(key);
    if(value===null)return {policies:{},receipts:{},sequences:{},supervisorPresent:false};
    const object = input => input && typeof input === 'object' && !Array.isArray(input);
    if (!object(value) || !object(value.policies) || !object(value.receipts) || !object(value.sequences) || typeof value.supervisorPresent !== 'boolean') throw new Error('Corrupt playback budget device record');
    for (const [policyId, bucket] of Object.entries(value.policies)) {
      if (!object(bucket) || bucket.policyId !== policyId || bucket.localDate !== key.localDate || typeof bucket.supervisorPresent !== 'boolean' || !Number.isFinite(bucket.spentMs) || bucket.spentMs < 0 || !Number.isInteger(bucket.generation) || bucket.generation < 1 || !object(bucket.reservations)) throw new Error('Corrupt playback budget balance');
      for (const [id, grant] of Object.entries(bucket.reservations)) {
        if (!object(grant) || grant.id !== id || grant.localDate !== key.localDate || grant.generation !== bucket.generation || typeof grant.streamId !== 'string' || !Number.isFinite(grant.ms) || grant.ms <= 0 || grant.ms > 5000 || !Number.isFinite(grant.issuedAt) || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= grant.issuedAt || grant.expiresAt - grant.issuedAt > 15000) throw new Error('Corrupt playback budget reservation');
      }
    }
    return value;
  }
  #view(setup, value, grants={}) {
    const policies=setup.policies.map(policy=>{
      const bucket=Object.hasOwn(value.policies,policy.id)?value.policies[policy.id]:reconcileBudget(null,policy,{localDate:setup.localDate,supervised:value.supervisorPresent});
      return {...budgetView(bucket,policy),grant:grants[policy.id]??null};
    });
    return {deviceId:setup.deviceId,localDate:setup.localDate,generation:Math.max(0,...policies.map(p=>p.generation)),supervised:!!value.supervisorPresent,policies,serverNow:setup.nowMs,nextResetAt:setup.nextResetAt};
  }
  status(request) {
    return this.#serial(request.householdId,async()=>{
      const setup=this.#setup(request); const key={householdId:setup.householdId,deviceId:setup.deviceId,localDate:setup.localDate};
      return this.#view(setup,await this.#load(key));
    });
  }
  async #governed(contentId,setup) {
    if(!contentId)return false;
    const key=`${setup.householdId}:${contentId}`;
    let cached=this.#content.get(key);
    if(!cached||setup.nowMs-cached.at>60000) {
      const item=await this.#catalog?.getItem(contentId);
      if(!item)throw new Error('Playback budget content unavailable');
      cached={at:setup.nowMs,labels:[...(item.labels??[]),...(item.metadata?.labels??[])]};
      this.#content.set(key,cached);
      if(this.#content.size>128)this.#content.delete(this.#content.keys().next().value);
    }
    const labels=setup.config.governedLabels??setup.config.governance?.governed_labels??[];
    return hasGovernedLabel(cached.labels,labels);
  }
  observe(request) {
    return this.#serial(request.householdId,async()=>{
      const setup=this.#setup(request);
      const {streamId,sequence,previousGrantId,participantIds=[],guestIds=[],contentId=null}=request;
      const idList=list=>Array.isArray(list)&&list.length<=100&&list.every(id=>typeof id==='string'&&id.length<=100);
      if(typeof streamId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(streamId)||!Number.isSafeInteger(sequence)||sequence<1||!Array.isArray(participantIds)||participantIds.length>100||participantIds.some(id=>typeof id!=='string')||!idList(guestIds)||contentId!==null&&(typeof contentId!=='string'||contentId.length>256)) throw new TypeError('Invalid playback budget observation');
      const key={householdId:setup.householdId,deviceId:setup.deviceId,localDate:setup.localDate};
      const value=await this.#load(key); const receiptKey=`${streamId}:${sequence}`;
      const knownStream = Object.hasOwn(value.sequences, `${streamId}:seq`);
      const obsolete = value.activeStreamId && value.activeStreamId !== streamId && knownStream;
      if(Object.hasOwn(value.receipts,receiptKey)) {
        const old=value.receipts[receiptKey];const current=this.#view(setup,value);
        return !obsolete && current.generation===old.generation?{...old,serverNow:setup.nowMs}:current;
      }
      if(sequence<=(value.sequences[`${streamId}:seq`]??0))throw new TypeError('Stale playback budget observation');
      // Settle each policy's reservation against its own day, never today's allowance.
      const settlements = request.settlements ?? (previousGrantId ? [{ id: previousGrantId, localDate: request.previousGrantDate ?? setup.localDate, playedMs: request.playedMs ?? 0 }] : []);
      if (!Array.isArray(settlements) || settlements.length > 32) throw new TypeError('Invalid playback settlements');
      for (const claim of settlements) {
        const previousDate = claim.localDate;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(previousDate) || previousDate > setup.localDate) throw new TypeError('Invalid playback grant date');
        const oldKey = { ...key, localDate: previousDate };
        const settlement = previousDate === setup.localDate ? value : await this.#load(oldKey);
        for (const [id, bucket] of Object.entries(settlement.policies)) {
          const grant = bucket.reservations[claim.id];
          if (!grant) continue;
          if (grant.streamId !== streamId) throw new TypeError('Playback grant belongs to another stream');
          settlement.policies[id] = settleBudget(bucket, claim.id, claim.playedMs);
        }
        if (previousDate !== setup.localDate) await this.#store.save({ ...oldKey, value: settlement });
      }
      const current = this.#view(setup, value);
      if (obsolete || (request.expectedGeneration != null && request.expectedGeneration !== current.generation)) {
        const view = this.#view(setup, value);
        value.sequences[`${streamId}:seq`] = sequence;
        value.receipts[receiptKey] = view;
        await this.#store.save({ ...key, value });
        return view;
      }
      // A newly mounted browser owns future roster facts. Older streams may
      // settle existing grants, but cannot remove supervision or refill time.
      value.activeStreamId = streamId;
      // Same rule as the browser: guest assignments (from the kiosk roster) never
      // supervise and are never metered; a governed child is not a supervisor,
      // not exempt and not a guest.
      const supervisorIds=setup.config.governance?.superusers??[];
      const {supervised}=classifySupervision({participantIds,supervisorIds,guestIds});
      // No governed child on the roster is NOT `supervised`: supervised resets the day's budget.
      const lists={supervisorIds,exemptIds:setup.config.governance?.exemptions??[],guestIds};
      const hasSubject=participantIds.some(id=>isGovernedChildId(id,lists));
      const governed=!supervised && hasSubject && request.requestGrant!==false && await this.#governed(contentId,setup); const grants={};
      for(const policy of setup.policies) {
        const prior=Object.hasOwn(value.policies,policy.id)?value.policies[policy.id]:null;
        let bucket=reconcileBudget(prior,policy,{localDate:setup.localDate,supervised});
        if(prior&&bucket.generation!==prior.generation)this.#logger?.info?.('fitness.playback_budget.reset',{deviceId:setup.deviceId,policyId:policy.id,generation:bucket.generation,reason:supervised?'supervisor_join':'local_day'});
        if(governed&&!supervised&&hasSubject&&request.requestGrant!==false) {
          const result=reserveBudget(bucket,policy,{id:`${setup.localDate}/${bucket.generation}/${streamId}/${sequence}/${policy.id}`,streamId,nowMs:setup.nowMs,nextResetAtMs:setup.nextResetAt});
          bucket=result.record;grants[policy.id]=result.grant;
        }
        value.policies[policy.id]=bucket;
      }
      value.supervisorPresent=supervised;
      const view=this.#view(setup,value,grants);
      value.sequences[`${streamId}:seq`]=sequence;value.receipts[receiptKey]=view;
      const receipts=Object.keys(value.receipts);for(const id of receipts.slice(0,Math.max(0,receipts.length-256)))delete value.receipts[id];
      await this.#store.save({...key,value});
      this.#logger?.debug?.('fitness.playback_budget.observed',{deviceId:setup.deviceId,localDate:setup.localDate,generation:view.generation,supervised,policies:view.policies.map(({id,spentMs,remainingMs,expired})=>({id,spentMs,remainingMs,expired}))});
      return view;
    });
  }
}
