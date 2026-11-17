import { evidenceProblem, REPLY_WINDOW_MS } from '../../domain/knowledge/contracts.mjs';
import { mutateKnowledge, stateBatch } from './knowledgeMutation.mjs';
/** Durable debounce and delivery claims; timers are injected, never authority. */
export class KnowledgeEntryScheduler {
  #store;#evidence;#maintenance;#scheduler;#clock;#timezone;#id;#sendAck;#deliverEcho;#logger;#enabled;#minutes;#minChars;#echoMin;#timers=new Map();#disposed=false;
  constructor({store,evidence,maintenance,scheduler,clock,userTimezone,nextId,sendAck,deliverEcho,logger,enabled=false,postEntryMinutes=15,minEntryChars=200,echoMinChars=600}) {
    if(!store?.commit||!evidence?.readByRefs||!maintenance?.execute||!scheduler?.after||typeof clock!=='function'||typeof nextId!=='function'||typeof userTimezone!=='function')throw new TypeError('Invalid knowledge scheduler dependencies');
    this.#store=store;this.#evidence=evidence;this.#maintenance=maintenance;this.#scheduler=scheduler;this.#clock=clock;this.#timezone=userTimezone;this.#id=nextId;this.#sendAck=sendAck;this.#deliverEcho=deliverEcho;this.#logger=logger;this.#enabled=enabled;this.#minutes=postEntryMinutes;this.#minChars=minEntryChars;this.#echoMin=echoMinChars;
  }
  async onEntrySaved({username,sourceId,attributedAnswer=false,asOf}) {
    const ignored={scheduled:false,suppressFollowUp:false};
    if(!this.#enabled||this.#disposed)return ignored;
    let suppressFollowUp=false;
    try {
      const rows=await this.#evidence.readByRefs({username,refs:['journalist:msg:'+sourceId],preview:false});
      const row=rows.find(item=>item.sourceId===sourceId);
      if(evidenceProblem(row,{mode:'commit',timezone:this.#timezone(username),asOf}))return ignored;
      if(row.content.length<this.#minChars&&!attributedAnswer)return ignored;
      const long=row.content.length>this.#echoMin;suppressFollowUp=long;let added=false,deadline;
      await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
        added=false;
        const previous=snapshot.state.pendingEntry;
        if((snapshot.state.cursor?.seen??[]).includes(sourceId)||(previous?.sourceIds??[]).includes(sourceId))return null;
        added=true;deadline=asOf+this.#minutes*60000;
        const pendingEntry={sourceIds:[...(previous?.sourceIds??[]),sourceId],answerIds:[...(previous?.answerIds??[]),...(attributedAnswer?[sourceId]:[])],echoSourceIds:[...(previous?.echoSourceIds??[]),...(long?[sourceId]:[])],deadline,generation:sourceId};
        const acknowledgements=long?{...(snapshot.state.acknowledgements??{}),[sourceId]:{status:'prepared',attempts:1,at:asOf}}:snapshot.state.acknowledgements??{};
        return stateBatch({pendingEntry,acknowledgements,...(!snapshot.state.cursor?{cursor:{since:row.at,seen:[]},activationAt:asOf}:{})},[{id:'entry:'+sourceId,type:'knowledge.entry.queued',at:asOf,sourceId}]);
      }});
      if(!added)return {...ignored,suppressFollowUp:long};
      this.#arm(username,deadline);
      if(long) {
        let receipt=null,status='failed';
        try {receipt=await this.#sendAck?.({username,text:'Got it. I’ll check what needs a follow-up.',choices:[],parseMode:null});if(receipt?.messageId)status='acknowledged';}
        catch {this.#logger?.warn?.('lifelog.knowledge.ack-failed',{sourceId,reason:'send_failed'});}
        await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
          const acknowledgement={status,attempts:1,at:asOf,...(receipt?.messageId?{botMessageId:String(receipt.messageId)}:{})};
          return stateBatch({acknowledgements:{...(snapshot.state.acknowledgements??{}),[sourceId]:acknowledgement}});
        }});
      }
      return {scheduled:true,suppressFollowUp:long};
    }catch(error){this.#logger?.warn?.('lifelog.knowledge.entry-unavailable',{reason:error.code??'entry_failed'});return {...ignored,suppressFollowUp};}
  }
  #arm(username,deadline) {
    if(this.#disposed||!Number.isFinite(deadline))return;
    const old=this.#timers.get(username);
    if(old?.deadline===deadline)return;
    old?.cancel();
    const cancel=this.#scheduler.after(Math.max(0,deadline-this.#clock()),async()=>{
      if(this.#timers.get(username)?.deadline===deadline)this.#timers.delete(username);
      if(!this.#disposed)await this.#runDue(username);
    });
    this.#timers.set(username,{deadline,cancel});
  }
  async #runDue(username) {
    try {
      const before=await this.#store.read({username}),pending=before.state.pendingEntry;
      if(!before.health.available||!Number.isFinite(pending?.deadline))return;
      if(pending.deadline>this.#clock()){this.#arm(username,pending.deadline);return;}
      const generation=pending.generation;
      const result=await this.#maintenance.execute({username,trigger:'post-entry',asOf:this.#clock()});
      if(this.#disposed)return;
      if(result.status==='completed'&&result.echo)await this.#sendReadyEcho(username,result.echo.runId);
      const current=(await this.#store.read({username})).state.pendingEntry;
      const remaining=new Set(current?.sourceIds??[]);
      const progressed=(pending.sourceIds??[]).some(id=>!remaining.has(id));
      if(Number.isFinite(current?.deadline)&&(current.generation!==generation||current.deadline>this.#clock()||progressed))this.#arm(username,current.deadline);
    }catch(error){this.#logger?.warn?.('lifelog.knowledge.debounce-failed',{reason:error.code??'run_failed'});}
  }
  async #sendReadyEcho(username,runId) {
    if(this.#disposed||typeof this.#deliverEcho!=='function')return;
    let candidate=null;
    await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
      candidate=null;
      const stored=snapshot.state.echoCandidates?.[runId];
      if(stored?.status!=='ready')return null;
      const expired=this.#clock()-stored.createdAt>REPLY_WINDOW_MS;
      if(!expired)candidate=structuredClone(stored);
      return stateBatch({echoCandidates:{...snapshot.state.echoCandidates,[runId]:{...stored,status:expired?'expired':'prepared'}}});
    }});
    if(!candidate||this.#disposed)return;
    let status='failed',botMessageId=null;
    try {const sent=await this.#deliverEcho({username,candidate,asOf:this.#clock()});if(sent?.messageId){status='delivered';botMessageId=String(sent.messageId);}}
    catch {this.#logger?.warn?.('lifelog.knowledge.echo-failed',{runId,reason:'send_failed'});}
    await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
      const stored=snapshot.state.echoCandidates?.[runId];if(!stored||stored.status!=='prepared')return null;
      return stateBatch({echoCandidates:{...snapshot.state.echoCandidates,[runId]:{...stored,status,...(botMessageId?{botMessageId,deliveredAt:this.#clock()}:{})}}});
    }});
  }
  async restore({username}) {
    if(!this.#enabled||this.#disposed)return {status:'disabled'};
    try {
      const snapshot=await this.#store.read({username});
      if(!snapshot.health.available)return {status:'unavailable'};
      for(const candidate of Object.values(snapshot.state.echoCandidates??{}).filter(row=>row.status==='ready').sort((a,b)=>a.createdAt-b.createdAt))await this.#sendReadyEcho(username,candidate.runId);
      const pending=(await this.#store.read({username})).state.pendingEntry;
      if(Number.isFinite(pending?.deadline))this.#arm(username,pending.deadline);
      return {status:'restored'};
    }catch(error){this.#logger?.warn?.('lifelog.knowledge.restore-failed',{reason:error.code??'restore_failed'});return {status:'unavailable'};}
  }
  async dispose() {
    this.#disposed=true;for(const timer of this.#timers.values())timer.cancel();this.#timers.clear();
  }
}
