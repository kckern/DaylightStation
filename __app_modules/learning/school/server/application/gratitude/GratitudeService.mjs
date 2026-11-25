import { GRATITUDE_PROMPT, isUnheardTranscript, deriveGratitudeState, recentGratitudeFacts, gratitudeConfigOf, gratitudePublicationId } from '../../domain/gratitude.mjs';
import { validGratitudeEvidence } from '../../domain/gratitudeEvidence.mjs';
import { studyDayForInstant, studyDayWindowForDate } from '../../domain/studyDay.mjs';
import { programAskedOn, DEFAULT_DAY_OFF_POLICY } from '../../domain/dayOffPolicy.mjs';
import { followUpFallbackFor, normalizeFollowUpQuestion } from './GratitudeFollowUpWriter.mjs';

export class GratitudeError extends Error {
  constructor(message, status = 400, retryAt = null) { super(message); this.name = 'GratitudeError'; this.status = status; this.retryAt = retryAt; }
}
const pending = state => Boolean(state.submitted) && ['assessing','pending'].includes(state.phase);
const sameAnswer = (a,b) => ['text','via','audioRef','edited','followUpOf'].every(key => (a[key] ?? (key === 'edited' ? false : null)) === (b[key] ?? (key === 'edited' ? false : null)));

/** Gratitude policy and durable recovery. All mutations for a learner share one queue. */
export class GratitudeService {
  #store; #assignments; #capture; #judge; #extractor; #followUpWriter; #publish; #clock; #timezone; #config; #logger; #queues = new Map(); #submitting = new Map(); #householdSchedule; #dayOffPolicy;
  constructor({ store, assignments, captureTake = null, judge, extractor, followUpWriter = null, publish, clock = () => new Date(), timezone = null, config = gratitudeConfigOf(), logger = {}, householdSchedule = null, dayOffPolicy = null }) {
    this.#store=store; this.#assignments=assignments; this.#capture=captureTake; this.#judge=judge; this.#extractor=extractor; this.#followUpWriter=followUpWriter; this.#publish=publish;
    this.#clock=clock; this.#timezone=timezone; this.#config=config; this.#logger=logger; this.#householdSchedule=householdSchedule; this.#dayOffPolicy=dayOffPolicy;
  }
  today() { return studyDayForInstant(this.#clock().getTime(), { timezone:this.#timezone }); }
  #now() { return this.#clock().toISOString(); }
  #serial(id, work) {
    const task=(this.#queues.get(id) ?? Promise.resolve()).catch(()=>{}).then(work);
    this.#queues.set(id,task);
    return task.finally(()=>{if(this.#queues.get(id)===task)this.#queues.delete(id);});
  }
  async #records(id) {
    const days=await this.#store.listDays(id);
    return Promise.all(days.map(async studyDay=>{
      const read=await this.#store.read(id,studyDay);
      if (!['ok','missing'].includes(read.status)) throw new GratitudeError('Your saved gratitude could not be read. Please try again later.',503);
      return {learnerId:id,studyDay,events:read.events};
    }));
  }
  #state(record) { return deriveGratitudeState(record?.events ?? [],{now:this.#now()}); }
  #preschool(id) { return Boolean(this.#config.preschool?.learners?.includes(id)); }
  #view(id,day,state,facts=[]) {
    const phase=pending(state) ? 'pending' : state.phase;
    // Blue screen: the subject already used (and when), plus recent subjects so the hints skip them.
    const steer=phase==='steered' && state.steer ? {reason:state.steer.reason,used:(f=>f?{subject:f.subject,studyDay:f.studyDay}:null)(facts.find(f=>f.id===state.steer.matchedId)),recent:facts.map(f=>f.subject)} : null;
    return {learnerId:id,studyDay:day,today:this.today(),serverNow:this.#now(),mode:this.#preschool(id)?'preschool':'standard',phase,prompt:GRATITUDE_PROMPT,
      steer,flagged:phase==='completed'?Boolean(state.assessment?.flagged):false,cooldownMs:phase==='cooldown'?state.cooldownMs:null,
      attemptId:state.attemptId,draft:state.draft,retryAt:state.retryAt,reason:state.reason ?? (phase==='pending'?'service':null),
      followUp:phase==='follow-up'?{question:state.followUp.question,firstText:state.followUp.firstText}:null,
      subject:state.subject,selectionId:state.selectionId,next:{kind:phase==='completed'?'exit':phase==='cooldown'?'wait':phase==='pending'?'retry':'respond'}};
  }
  async #append(id,day,event) { const stamped={...event,at:this.#now()};await this.#store.append(id,day,stamped);return stamped; }
  async #enrolled(id) {
    const assignment=await this.#assignments.get(id);
    const enrollment=assignment?.programs?.find(row=>row.programId==='gratitude');
    if(!enrollment)throw new GratitudeError('There is no Gratitude assignment for this learner.',403);
    return enrollment;
  }
  #cooldown(records) {
    const states=records.map(r=>this.#state(r)).filter(s=>s.phase==='cooldown');
    if(states.length){const retryAt=states.map(s=>s.retryAt).sort().at(-1);throw new GratitudeError('Try Gratitude again after a short break.',429,retryAt);}
  }
  async #fresh(id,day,records) {
    const enrollment=await this.#enrolled(id);
    if(!studyDayWindowForDate(day,{timezone:this.#timezone}) || day!==this.today())throw new GratitudeError('Please open today’s Gratitude activity.',409);
    const live=value=>typeof value==='function'?value():value;
    // The agenda's own rule (programAskedOn): a stay-home day that keeps scripture still asks for Gratitude.
    const program={...enrollment,subject:enrollment.subject??'scripture'};
    if(!programAskedOn(day,{enrollment:program,householdSchedule:live(this.#householdSchedule),dayOffPolicy:live(this.#dayOffPolicy)??DEFAULT_DAY_OFF_POLICY}))throw new GratitudeError('Gratitude is not assigned today.',409);
    this.#cooldown(records);
    if(records.some(r=>pending(this.#state(r))))throw new GratitudeError('Your saved answer is waiting. Please retry it first.',409);
    if(this.#state(records.find(r=>r.studyDay===day)).phase==='completed')throw new GratitudeError('Today’s Gratitude is already complete.',409);
  }
  async day(id,day) {
    await this.#enrolled(id);
    const records=await this.#records(id);
    const state=this.#state(records.find(r=>r.studyDay===day));
    if(state.phase!=='completed') {
      const active=records.map(r=>({day:r.studyDay,state:this.#state(r)})).find(r=>r.state.phase==='cooldown');
      if(active)return this.#view(id,day,{...state,phase:'cooldown',retryAt:active.state.retryAt,reason:active.state.reason,cooldownMs:active.state.cooldownMs});
    }
    const facts=state.phase==='steered'?recentGratitudeFacts(records,{learnerId:id,studyDay:day,spacingDays:this.#config.spacingDays}):[];
    return this.#view(id,day,state,facts);
  }
  async pendingDays(id) { return (await this.#records(id)).filter(r=>pending(this.#state(r))).map(r=>r.studyDay); }
  async history(id) { return this.#records(id); }
  async assertCanTake(id,day) { const records=await this.#records(id); await this.#fresh(id,day,records); }
  async open(id,day) {
    return this.#serial(id,async()=>{
      await this.#enrolled(id);
      let records=await this.#records(id);
      const held=records.find(r=>pending(this.#state(r)));
      if(held){await this.#resume(id,held.studyDay,records);records=await this.#records(id);if(pending(this.#state(records.find(r=>r.studyDay===held.studyDay))))return this.day(id,held.studyDay);}
      if(day!==this.today())return this.day(id,day);
      if(!records.some(r=>r.studyDay===day))await this.#append(id,day,{type:'opened'});
      return this.day(id,day);
    });
  }
  async saveDraft(id,day,body) {
    return this.#serial(id,async()=>{ const records=await this.#records(id);await this.#fresh(id,day,records);
      const draft=this.#body(body,false);await this.#audio(id,day,draft.audioRef,records);
      await this.#append(id,day,{type:'draft-saved',draft});return this.day(id,day); });
  }
  #body(body,required=true) {
    if(typeof body?.text!=='string' || body.text.length>4000 || (required && !body.text.trim()))throw new GratitudeError('Please say or type something you are grateful for.');
    if(!['voice','typed'].includes(body.via))throw new GratitudeError('Invalid input method.');
    if(required && !/^[a-zA-Z0-9_-]{1,100}$/.test(body.attemptId??''))throw new GratitudeError('A valid attempt is required.');
    const followUpOf=required && body.followUpOf!==null ? body.followUpOf : undefined;
    if(followUpOf!==undefined && (typeof followUpOf!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(followUpOf)))throw new GratitudeError('A valid follow-up is required.');
    return {text:body.text.trim(),via:body.via,audioRef:body.audioRef??null,edited:body.edited===true,...(required?{attemptId:body.attemptId}:{}),...(followUpOf!==undefined?{followUpOf}:{})};
  }
  async #audio(id,day,ref,records) {
    if(ref===null)return;
    if(typeof ref!=='string' || !ref.startsWith(id+'/') || !records.find(r=>r.studyDay===day)?.events.some(e=>e.type==='take-saved' && e.audioRef===ref))throw new GratitudeError('That recording does not belong to this answer.');
  }
  async take(id,day,{takeId,buffer,mimeType}) {
    return this.#serial(id,async()=>{
      const records=await this.#records(id);await this.#fresh(id,day,records);
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(takeId??''))throw new GratitudeError('A valid recording is required.');
      const prior=records.find(r=>r.studyDay===day)?.events.findLast(e=>e.type==='take-saved' && e.takeId===takeId);
      if(prior?.text)return {takeId,audioRef:prior.audioRef,text:prior.text};
      if(!this.#capture)throw new GratitudeError('Recording is unavailable. You can type your answer.',503);
      const result=await this.#capture({learnerId:id,studyDay:day,buffer,mimeType,savedAudioRef:prior?.audioRef??null,
        onSaved:async({audioRef})=>{if(!prior)await this.#append(id,day,{type:'take-saved',takeId,audioRef,text:null});},
      });
      const {transcribed,...saved}=result;
      if(transcribed!==false && isUnheardTranscript(saved.text)){
        // Nothing of the child's was heard: no words, or the transcription hint echoed back. Not judged.
        await this.#append(id,day,{type:'take-unheard',takeId,audioRef:saved.audioRef});
        this.#logger.info?.('school.gratitude.take-unheard',{learnerId:id,day,takeId,empty:!String(saved.text??'').trim()});
        return {takeId,audioRef:saved.audioRef,text:null,unheard:true};
      }
      await this.#append(id,day,{type:'take-saved',takeId,...saved});
      return {takeId,...saved};
    });
  }
  async submit(id,day,body) {
    // A submit that arrives while another is still being judged (repeated taps, a second tab) is a duplicate.
    const duplicate=this.#submitting.has(id);
    this.#submitting.set(id,(this.#submitting.get(id)??0)+1);
    const done=()=>{const left=this.#submitting.get(id)-1;if(left>0)this.#submitting.set(id,left);else this.#submitting.delete(id);};
    return this.#serial(id,async()=>{
      const answer=this.#body(body);await this.#enrolled(id);
      const records=await this.#records(id);const record=records.find(r=>r.studyDay===day);
      const prior=record?.events.find(e=>e.type==='submitted' && e.attemptId===answer.attemptId);
      if(prior){if(!sameAnswer(prior,answer))throw new GratitudeError('Please start a new attempt for a changed answer.',409);if(pending(this.#state(record)))await this.#resume(id,day,records);return this.day(id,day);}
      const current=this.#state(record);
      // Submit is locked while an attempt is out: a second one gets the current state and starts nothing.
      if(duplicate)return this.day(id,day);
      // An attempt left assessing (a crash, an outage) is retried first, so a child is never turned away for good.
      if(pending(current)){await this.#resume(id,day,records);return this.day(id,day);}
      await this.#fresh(id,day,records);await this.#audio(id,day,answer.audioRef,records);
      // While a follow-up is open the answer must name it; otherwise none may.
      if(current.phase==='follow-up' ? answer.followUpOf!==current.followUp.attemptId : answer.followUpOf!==undefined)
        throw new GratitudeError(current.phase==='follow-up'?'Please answer the follow-up question.':'There is no follow-up question to answer.',409);
      await this.#append(id,day,{type:'submitted',...answer});
      this.#logger.info?.('school.gratitude.submitted',{learnerId:id,day,attemptId:answer.attemptId,via:answer.via});
      await this.#resume(id,day,await this.#records(id));return this.day(id,day);
    }).finally(done);
  }
  async retry(id,day,{attemptId}) {
    return this.#serial(id,async()=>{
      await this.#enrolled(id);const records=await this.#records(id);this.#cooldown(records);
      const state=this.#state(records.find(r=>r.studyDay===day));
      if(state.attemptId!==attemptId)throw new GratitudeError('Please reopen your saved answer.',409);
      if(pending(state))await this.#resume(id,day,records);
      return this.day(id,day);
    });
  }
  async #refuse(id,day,attempt,decision,cooldownMs) {
    const retryAt=new Date(Date.parse(decision.at)+cooldownMs).toISOString();
    // The standard 30 minutes is implied when the event carries no length (records written before 2026-11-19).
    await this.#append(id,day,{type:'refused',attemptId:attempt.attemptId,reason:decision.verdict,retryAt,...(cooldownMs!==this.#config.cooldownMs?{cooldownMs}:{})});
    this.#logger.info?.('school.gratitude.refused',{learnerId:id,day,reason:decision.verdict,retryAt});
  }
  /** Preschool verdict ladder: blue steer, yellow warning, red break. True when the attempt is settled here. */
  async #ladderStep(id,day,state,attempt,decision) {
    const ladder=this.#config.preschool;
    if(['general','repetition'].includes(decision.verdict)){
      await this.#append(id,day,{type:'steered',attemptId:attempt.attemptId,reason:decision.verdict,...(decision.verdict==='repetition'?{matchedId:decision.matchedId}:{})});
      this.#logger.info?.('school.gratitude.steered',{learnerId:id,day,attemptId:attempt.attemptId,reason:decision.verdict});return true;
    }
    if(decision.verdict==='nonsense' && state.sillyRun<1){
      await this.#append(id,day,{type:'warned',attemptId:attempt.attemptId});
      this.#logger.info?.('school.gratitude.warned',{learnerId:id,day,attemptId:attempt.attemptId});return true;
    }
    if(['nonsense','rude'].includes(decision.verdict)){await this.#refuse(id,day,attempt,decision,ladder.cooldownMs);return true;}
    return false;
  }
  /**
   * A verdict the evidence chain would refuse must never be appended: the append would throw and leave the
   * attempt assessing for good. Fall back to doubt, which is always valid (green+flag for preschool).
   */
  #appendable(record,attempt,decision,preschool) {
    const at=this.#now();
    if(validGratitudeEvidence([...(record?.events??[]),{type:'assessed',at,attemptId:attempt.attemptId,...decision}]))return decision;
    this.#logger.warn?.('school.gratitude.verdict-invalid',{attemptId:attempt.attemptId,verdict:decision.verdict});
    return preschool?{...decision,verdict:'eligible',matchedId:null,judged:decision.judged??decision.verdict,flagged:'uncertain'}:{...decision,verdict:'uncertain',matchedId:null,judged:decision.verdict};
  }
  async #resume(id,day,records) {
    const record=records.find(r=>r.studyDay===day);
    let state=this.#state(record);
    if(!pending(state))return;
    const attempt=state.submitted;
    try {
      let decision=state.assessment;
      const preschool=this.#preschool(id);
      const ladder=this.#config.preschool;
      if(!decision){
        const history=recentGratitudeFacts(records,{learnerId:id,studyDay:day,spacingDays:this.#config.spacingDays});
        // One follow-up a day: after it, any good-faith answer is accepted as is.
        // Preschool has no follow-up; the same question decides a blue steer, until the blue limit.
        const allowFollowUp=preschool ? !state.followUpAsked && state.blueRun<ladder.blueLimit : this.#config.followUp?.enabled!==false && !state.followUpAsked;
        decision=await this.#judge.assess({text:state.assessText,history,allowFollowUp,askRude:preschool});
        if(decision.verdict==='unavailable')return;
        if(decision.verdict==='general' && !allowFollowUp)decision={...decision,verdict:'eligible',...(preschool?{judged:'general',flagged:state.blueRun>=ladder.blueLimit?'blue-limit':'general'}:{})};
        if(decision.verdict==='repetition' && !history.some(h=>h.id===decision.matchedId))decision={...decision,verdict:'uncertain'};
        if(preschool){
          // Only green earns credit, and doubt is green: an undecided answer, or one more good-faith answer
          // after the blue limit, is accepted and flagged for the teacher.
          if(['general','repetition'].includes(decision.verdict) && state.blueRun>=ladder.blueLimit)decision={...decision,verdict:'eligible',judged:decision.verdict,flagged:'blue-limit'};
          else if(decision.verdict==='uncertain')decision={...decision,verdict:'eligible',judged:'uncertain',flagged:'uncertain'};
          // Any answer accepted after the blue limit is flagged, whatever the judge said.
          else if(decision.verdict==='eligible' && !decision.flagged && state.blueRun>=ladder.blueLimit)decision={...decision,flagged:'blue-limit'};
        }
        decision=await this.#append(id,day,{type:'assessed',attemptId:attempt.attemptId,...this.#appendable(record,attempt,decision,preschool)});
        if(decision.flagged)this.#logger.info?.('school.gratitude.flagged',{learnerId:id,day,attemptId:attempt.attemptId,reason:decision.flagged});
      }
      if(preschool && await this.#ladderStep(id,day,state,attempt,decision))return;
      if(decision.verdict==='general'){
        let written=null;
        try{written=await this.#followUpWriter?.write({text:state.assessText});}catch{written=null;}
        const question=normalizeFollowUpQuestion(written?.question);
        if(!question || !['model','fallback'].includes(written?.writer))written={question:followUpFallbackFor(state.assessText),writer:'fallback'};
        else written={question,writer:written.writer};
        await this.#append(id,day,{type:'follow-up-asked',attemptId:attempt.attemptId,question:written.question,writer:written.writer});
        this.#logger.info?.('school.gratitude.follow-up',{learnerId:id,day,attemptId:attempt.attemptId,writer:written.writer});return;
      }
      if(['nonsense','repetition','rude'].includes(decision.verdict)){
        await this.#refuse(id,day,attempt,decision,this.#config.cooldownMs);return;
      }
      if(decision.verdict!=='eligible')return;
      let publication=state.publication;
      if(!publication){
        const extracted=await this.#extractor.extract({text:state.assessText});if(!extracted)return;
        publication={type:'publication-pending',attemptId:attempt.attemptId,text:state.assessText,subject:extracted.subject,selectionId:gratitudePublicationId(id,day),timestamp:this.#now(),extractorModel:extracted.model};
        await this.#append(id,day,publication);
      }
      const result=await this.#publish({learnerId:id,studyDay:day,subject:publication.subject,selectionId:publication.selectionId,timestamp:publication.timestamp});
      if(result?.selectionId!==publication.selectionId)throw new Error('Publication was not confirmed');
      await this.#append(id,day,{type:'completed',attemptId:attempt.attemptId,selectionId:publication.selectionId});
      this.#logger.info?.('school.gratitude.completed',{learnerId:id,day,selectionId:publication.selectionId});
    } catch(error) {this.#logger.warn?.('school.gratitude.pending',{learnerId:id,day,error:error?.name??'Error',code:error?.code??null});}
  }
}
