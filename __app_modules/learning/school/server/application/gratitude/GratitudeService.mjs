import { GRATITUDE_PROMPT, deriveGratitudeState, recentGratitudeFacts, gratitudeConfigOf, gratitudePublicationId } from '../../domain/gratitude.mjs';
import { studyDayForInstant, studyDayWindowForDate } from '../../domain/studyDay.mjs';
import { scheduleVerdict } from '../../domain/schoolCalendar.mjs';
import { GRATITUDE_FOLLOW_UP_FALLBACK, normalizeFollowUpQuestion } from './GratitudeFollowUpWriter.mjs';

export class GratitudeError extends Error {
  constructor(message, status = 400, retryAt = null) { super(message); this.name = 'GratitudeError'; this.status = status; this.retryAt = retryAt; }
}
const pending = state => Boolean(state.submitted) && ['assessing','pending'].includes(state.phase);
const sameAnswer = (a,b) => ['text','via','audioRef','edited','followUpOf'].every(key => (a[key] ?? (key === 'edited' ? false : null)) === (b[key] ?? (key === 'edited' ? false : null)));

/** Gratitude policy and durable recovery. All mutations for a learner share one queue. */
export class GratitudeService {
  #store; #assignments; #capture; #judge; #extractor; #followUpWriter; #publish; #clock; #timezone; #config; #logger; #queues = new Map(); #householdSchedule;
  constructor({ store, assignments, captureTake = null, judge, extractor, followUpWriter = null, publish, clock = () => new Date(), timezone = null, config = gratitudeConfigOf(), logger = {}, householdSchedule = null }) {
    this.#store=store; this.#assignments=assignments; this.#capture=captureTake; this.#judge=judge; this.#extractor=extractor; this.#followUpWriter=followUpWriter; this.#publish=publish;
    this.#clock=clock; this.#timezone=timezone; this.#config=config; this.#logger=logger; this.#householdSchedule=householdSchedule;
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
  #view(id,day,state) {
    const phase=pending(state) ? 'pending' : state.phase;
    return {learnerId:id,studyDay:day,today:this.today(),serverNow:this.#now(),phase,prompt:GRATITUDE_PROMPT,
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
    const household=typeof this.#householdSchedule==='function'?this.#householdSchedule():this.#householdSchedule;
    if(!scheduleVerdict(day,enrollment.schedule??null).schoolDay || (household && !scheduleVerdict(day,household).schoolDay))throw new GratitudeError('Gratitude is not assigned today.',409);
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
      if(active)return this.#view(id,day,{...state,phase:'cooldown',retryAt:active.state.retryAt,reason:active.state.reason});
    }
    return this.#view(id,day,state);
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
    const followUpOf=required?body.followUpOf:undefined;
    if(followUpOf!==undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(followUpOf))throw new GratitudeError('A valid follow-up is required.');
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
      await this.#append(id,day,{type:'take-saved',takeId,...result});
      return {takeId,...result};
    });
  }
  async submit(id,day,body) {
    return this.#serial(id,async()=>{
      const answer=this.#body(body);await this.#enrolled(id);
      const records=await this.#records(id);const record=records.find(r=>r.studyDay===day);
      const prior=record?.events.find(e=>e.type==='submitted' && e.attemptId===answer.attemptId);
      if(prior){if(!sameAnswer(prior,answer))throw new GratitudeError('Please start a new attempt for a changed answer.',409);if(pending(this.#state(record)))await this.#resume(id,day,records);return this.day(id,day);}
      await this.#fresh(id,day,records);await this.#audio(id,day,answer.audioRef,records);
      // While a follow-up is open the answer must name it; otherwise none may.
      const current=this.#state(record);
      if(current.phase==='follow-up' ? answer.followUpOf!==current.followUp.attemptId : answer.followUpOf!==undefined)
        throw new GratitudeError(current.phase==='follow-up'?'Please answer the follow-up question.':'There is no follow-up question to answer.',409);
      await this.#append(id,day,{type:'submitted',...answer});
      this.#logger.info?.('school.gratitude.submitted',{learnerId:id,day,attemptId:answer.attemptId,via:answer.via});
      await this.#resume(id,day,await this.#records(id));return this.day(id,day);
    });
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
  async #resume(id,day,records) {
    let state=this.#state(records.find(r=>r.studyDay===day));
    if(!pending(state))return;
    const attempt=state.submitted;
    try {
      let decision=state.assessment;
      if(!decision){
        const history=recentGratitudeFacts(records,{learnerId:id,studyDay:day,spacingDays:this.#config.spacingDays});
        // One follow-up a day: after it, any good-faith answer is accepted as is.
        const allowFollowUp=this.#config.followUp?.enabled!==false && !state.followUpAsked;
        decision=await this.#judge.assess({text:state.assessText,history,allowFollowUp});
        if(decision.verdict==='unavailable')return;
        if(decision.verdict==='general' && !allowFollowUp)decision={...decision,verdict:'eligible'};
        if(decision.verdict==='repetition' && !history.some(h=>h.id===decision.matchedId))decision={...decision,verdict:'uncertain'};
        decision=await this.#append(id,day,{type:'assessed',attemptId:attempt.attemptId,...decision});
      }
      if(decision.verdict==='general'){
        let written=null;
        try{written=await this.#followUpWriter?.write({text:state.assessText});}catch{written=null;}
        const question=normalizeFollowUpQuestion(written?.question);
        if(!question || !['model','fallback'].includes(written?.writer))written={question:GRATITUDE_FOLLOW_UP_FALLBACK,writer:'fallback'};
        else written={question,writer:written.writer};
        await this.#append(id,day,{type:'follow-up-asked',attemptId:attempt.attemptId,question:written.question,writer:written.writer});
        this.#logger.info?.('school.gratitude.follow-up',{learnerId:id,day,attemptId:attempt.attemptId,writer:written.writer});return;
      }
      if(['nonsense','repetition'].includes(decision.verdict)){
        const retryAt=new Date(Date.parse(decision.at)+this.#config.cooldownMs).toISOString();
        await this.#append(id,day,{type:'refused',attemptId:attempt.attemptId,reason:decision.verdict,retryAt});
        this.#logger.info?.('school.gratitude.refused',{learnerId:id,day,reason:decision.verdict,retryAt});return;
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
    } catch(error) {this.#logger.warn?.('school.gratitude.pending',{learnerId:id,day,error:error.message});}
  }
}
