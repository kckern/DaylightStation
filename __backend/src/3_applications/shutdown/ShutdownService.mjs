import { ShutdownState } from '#domains/shutdown/ShutdownState.mjs';
import { composeKioskShutdownPush } from '#domains/shutdown/shutdownPush.mjs';

/** Owns activation plus periodic disk→websocket→Portal reconciliation. */
export class ShutdownService {
  #supervision; #repo; #notifier; #policy; #cue; #portal; #timezone; #logger; #scheduleEvery; #cancelSchedule = null; #signature = null; #portalSignature = null; #incidentReporter; #portalDeviceId; #health=null; #incidentReportingError=null; #portalJob=null; #clock;
  constructor({ repo, notifier, getPolicy, cue = null, portal = null, timezone = null, scheduleEvery = null, supervision = null, incidentReporter = null, portalDeviceId = 'portal', clock = {now:()=>Date.now()}, logger = console } = {}) {
    if (!repo || !notifier?.publishState || !getPolicy) throw new Error('ShutdownService: repo, notifier, getPolicy required');
    this.#clock=clock;this.#supervision = supervision; this.#incidentReporter=incidentReporter;this.#portalDeviceId=portalDeviceId;
    this.#repo = repo; this.#notifier = notifier; this.#policy = getPolicy; this.#cue = cue; this.#portal = portal; this.#timezone = timezone;
    this.#scheduleEvery = scheduleEvery; this.#logger = logger;
  }
  async activate({ readerId, tagUid, now = this.#clock.now() }) {
    if (this.#supervision) return this.#supervision.activate({readerId,tagUid,now});
    const policy = this.#policy() || {};
    const durationSeconds = Number(policy.durationSeconds) || 1800;
    const state = new ShutdownState({
      locked_at: new Date(now).toISOString(),
      locked_until: new Date(now + durationSeconds * 1000).toISOString(),
      targets: policy.targets || [],
      source: { reader_id: readerId ?? null, tag_uid: tagUid },
    });
    await this.#repo.save(state); await this.#publish(state, 'locked', false, now);
    if (this.#cue?.announce) {
      // The push is a courtesy; the cue (the siren) is not. A compose failure
      // sends the cue without a notification rather than rejecting activate().
      let notification = null;
      try {
        notification = composeKioskShutdownPush({ lockedAt: state.lockedAt, lockedUntil: state.lockedUntil, timezone: this.#timezone });
      } catch (error) {
        this.#logger.warn?.('shutdown.push_compose_failed', { error: error.message });
      }
      Promise.resolve()
        .then(() => this.#cue.announce({ lockedUntil: state.lockedUntil, source: 'nfc-shutdown', notification }))
        .catch((error) => this.#logger.warn?.('shutdown.cue_failed', { error: error.message }));
    }
    return state;
  }
  async status(target, now = this.#clock.now()) {
    if(this.#supervision)return this.#supervision.status(target);
    const {state,invalid}=await this.#repo.read(),incidents=await this.#incidents();
    return {locked:invalid || (!!state && state.isActive(now) && (target===null || state.includes(target))),lockedUntil:state?.lockedUntil??null,invalid,
      enforcement:{incidentReportingError:this.#incidentReportingError,consumers:[structuredClone(this.#health??{deviceId:this.#portalDeviceId,capability:'portal-keys',acknowledged:false,error:'ACKNOWLEDGEMENT_UNAVAILABLE'})],incidents}};
  }
  async diagnostics(now=this.#clock.now()){
    if(this.#supervision)return this.#supervision.diagnostics();
    return {...await this.status(null,now),mode:'legacy'};
  }
  async #publish(state, type, invalid = false, now = this.#clock.now()) {
    const payload = {
      type,
      locked: invalid || !!state,
      lockedUntil: state?.lockedUntil ?? null,
      targets: state?.targets ?? (invalid ? (this.#policy()?.targets || []) : []),
    };
    this.#notifier.publishState(payload);
    await this.#syncPortal(state, invalid, now);
  }
  async #syncPortal(state, invalid = false, now = this.#clock.now()) {
    const desired = { locked: invalid || !!state, lockedUntil: state?.lockedUntil ?? null };
    const signature = JSON.stringify(desired);
    const commandRevision=state?Date.parse(state.lockedAt):0;
    const previous=this.#health;
    this.#portalSignature=signature;
    if(!previous || previous.commandRevision!==commandRevision || previous.desiredBlocked!==desired.locked)this.#health={deviceId:this.#portalDeviceId,capability:'portal-keys',commandRevision,desiredBlocked:desired.locked,requestedAt:now,blocked:false,acknowledged:false,lastContactAt:null,error:null};
    void this.#observe(now);
    if(this.#portalJob?.signature===signature)return this.#portalJob.promise;
    const job={signature,promise:null};
    job.promise=(async()=>{
      const priorError=this.#health?.error??null;
      const health={...this.#health,acknowledged:false,error:null};
      try {
        if(!this.#portal)throw Object.assign(Error('Portal key suppression is unavailable'),{code:'CAPABILITY_UNAVAILABLE'});
        const result=await this.#portal.setLockdown(desired);
        if(result?.ok!==true || result?.blocked!==desired.locked)throw Object.assign(Error('Portal key suppression is unavailable'),{code:result?.code??'CAPABILITY_UNAVAILABLE'});
        health.acknowledged=true;health.blocked=result.blocked;
      } catch(error){
        health.error=error.code??'CONSUMER_UNREACHABLE';
        // The reconciler retries every few seconds and an unconfigured Portal
        // fails every time (shutdown/config.yml omits portal_keys on purpose):
        // ~17k identical warns a day from 2026-11-15. Warn when the failure
        // starts or changes; status() keeps reporting it on every read.
        if(health.error!==priorError)this.#logger.warn?.('shutdown.portal_sync_failed',{error:health.error});
      }
      const completedAt=this.#clock.now();
      if(health.acknowledged)health.lastContactAt=completedAt;
      // An older completion may not overwrite evidence for a later window.
      if(this.#portalSignature===signature){this.#health=health;await this.#observe(completedAt);}
    })().finally(()=>{if(this.#portalJob===job)this.#portalJob=null;});
    this.#portalJob=job;return job.promise;
  }
  async #observe(nowMs){try{await this.#incidentReporter?.observe({health:[structuredClone(this.#health)],nowMs});this.#incidentReportingError=null;}catch{this.#incidentReportingError='INCIDENT_REPORTING_UNAVAILABLE';this.#logger.warn?.('shutdown.incident.reporting_failed',{error:this.#incidentReportingError});}}
  async #incidents(){try{return await this.#incidentReporter?.incidents?.()??[];}catch{this.#incidentReportingError='INCIDENT_REPORTING_UNAVAILABLE';return [];}}
  async reconcile(now = this.#clock.now()) {
    if (this.#supervision) return this.#supervision.reconcile();
    const { state, invalid } = await this.#repo.read(); const active = state?.isActive(now) ? state : null;
    const signature = invalid ? 'invalid' : active ? `${active.lockedUntil}:${active.targets.join(',')}` : 'clear';
    if (signature !== this.#signature) {
      this.#signature = signature;
      await this.#publish(active, active ? 'updated' : 'released', invalid, now);
    } else {
      await this.#syncPortal(active, invalid, now);
    }
  }
  start() {
    if (this.#cancelSchedule) return;
    if (typeof this.#scheduleEvery !== 'function') return;
    const seconds = Number(this.#policy()?.reconcileSeconds);
    const intervalMs = (Number.isFinite(seconds) && seconds >= 1 && seconds <= 60 ? seconds : 5) * 1000;
    void this.reconcile().catch((error) => this.#logger.warn?.('shutdown.reconcile_failed', { error: error.message }));
    this.#cancelSchedule = this.#scheduleEvery(intervalMs, () => this.reconcile().catch((error) => this.#logger.warn?.('shutdown.reconcile_failed', { error: error.message })));
  }
  dispose() { this.#cancelSchedule?.(); this.#cancelSchedule = null; }
}
