import { localDateFor } from '../../domain/knowledge/calendar.mjs';
import { reduceKnowledge } from '../../domain/knowledge/reduceKnowledge.mjs';
import { sweepKnowledge } from '../../domain/knowledge/sweepKnowledge.mjs';
import { mutateKnowledge, stateBatch } from './knowledgeMutation.mjs';

/** One model job per user; storage mutations are short and revision checked. */
export class MaintainKnowledgeBase {
  #store; #evidence; #extractor; #clock; #timezone; #id; #logger; #enabled; #minChars; #inFlight = new Map(); #preview; #maxRuns;
  constructor({store,evidence,extractor,clock,userTimezone,nextId,logger,enabled=false,minEntryChars=200,maxRunsPerDay=4,previewRunner=null}) {
    if (!store?.commit || !evidence?.readByRefs || !extractor?.extract || typeof clock !== 'function' || typeof userTimezone !== 'function' || typeof nextId !== 'function') throw new TypeError('Invalid knowledge maintenance dependencies');
    if(!Number.isInteger(maxRunsPerDay)||maxRunsPerDay<1||maxRunsPerDay>4)throw new TypeError('Knowledge daily cap must be between one and four');
    this.#maxRuns=maxRunsPerDay;
    this.#store=store;this.#evidence=evidence;this.#extractor=extractor;this.#clock=clock;this.#timezone=userTimezone;this.#id=nextId;this.#logger=logger;this.#enabled=enabled;this.#minChars=minEntryChars;this.#preview=previewRunner;
  }
  async initialize({username,asOf}) {
    if (!this.#enabled) return {status:'disabled'};
    localDateFor(asOf,this.#timezone(username));
    await this.#store.recover({username});
    await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>snapshot.state.cursor?null:stateBatch({cursor:{since:asOf,seen:[]},activationAt:asOf})});
    return {status:'ready'};
  }
  execute(args) {
    if(!Number.isFinite(args.asOf))return Promise.resolve({status:'failed',reason:'invalid_time'});
    if (!this.#enabled) return Promise.resolve({status:'disabled'});
    if (this.#inFlight.has(args.username)) return this.#inFlight.get(args.username);
    const work=Promise.resolve().then(()=>this.#execute(args)).finally(()=>{if(this.#inFlight.get(args.username)===work)this.#inFlight.delete(args.username);});
    this.#inFlight.set(args.username,work);return work;
  }
  async #execute({username,trigger,asOf}) {
    const timezone=this.#timezone(username),runId=this.#id();let capturedGeneration=null;
    try {
      if(!this.#enabled)return {status:'disabled'};
      localDateFor(asOf,timezone);
      if (!['post-entry','nightly'].includes(trigger)) throw new TypeError('Unknown knowledge trigger');
      await this.initialize({username,asOf});
      const initial=await this.#store.read({username});
      if (!initial.health.available) throw Object.assign(Error('Knowledge unavailable'),{code:'KNOWLEDGE_UNAVAILABLE'});
      const pending=initial.state.pendingEntry;
      capturedGeneration=pending?.generation??null;
      if(trigger==='post-entry'&&Number.isFinite(pending?.deadline)&&pending.deadline>asOf)return {status:'deferred',runId};
      const selected=await this.#evidence.readUserMessages({username,after:initial.state.cursor,through:asOf,preview:false});
      const answers=new Set(pending?.answerIds??[]);
      const messages=selected.messages.filter(row=>row.content.length>=this.#minChars||answers.has(row.sourceId));
      let extraction={proposals:[],modelVersion:null};
      if (messages.length) {
        let permitted=false;
        const day=localDateFor(this.#clock(),timezone);
        await mutateKnowledge({store:this.#store,username,runId:runId+':budget',build:snapshot=>{
          permitted=false;
          const used=snapshot.state.budgets?.[day]??0;
          if(used>=this.#maxRuns)return null;
          permitted=true;
          return stateBatch({budgets:{...(snapshot.state.budgets??{}),[day]:used+1}},[{id:runId+':attempt',type:'knowledge.extraction.attempt',at:asOf,runId,day}]);
        }});
        if (!permitted) {await this.#deferFailed({username,generation:capturedGeneration,runId,asOf,reason:'budget_exhausted'});return {status:'budget_exhausted',runId};}
        // No serialized storage transform remains active across this await.
        if(!this.#enabled)throw Object.assign(Error('Knowledge stopped'),{code:'KNOWLEDGE_STOPPED'});
        extraction=await this.#extractor.extract({messages,openLoops:Object.values(initial.objects),roster:initial.roster,askedLoops:initial.asks,timezone,asOf});
      }
      if(!this.#enabled)throw Object.assign(Error('Knowledge stopped'),{code:'KNOWLEDGE_STOPPED'});
      let reduction,echo=null;
      const wanted=messages.map(row=>row.ref);
      // Re-read original receipts after AI, before reducing against fresh pins/revision.
      const evidence=await this.#evidence.readByRefs({username,refs:wanted,preview:false});
      await mutateKnowledge({store:this.#store,username,runId:runId+':apply',build:snapshot=>{
        if(!this.#enabled)throw Object.assign(Error('Knowledge stopped'),{code:'KNOWLEDGE_STOPPED'});
        echo=null;
        reduction=reduceKnowledge({snapshot,proposals:extraction.proposals,evidence,asOf,timezone,mode:'commit'});
        const batch=reduction.batch;
        const projected={...snapshot,objects:{...snapshot.objects,...Object.fromEntries(batch.upserts.map(object=>[object.id,object]))},state:{...snapshot.state,...batch.statePatch}};
        const sweep=sweepKnowledge({snapshot:projected,asOf,timezone});
        const upserts=new Map([...batch.upserts,...sweep.upserts].map(object=>[object.id,object]));
        batch.upserts=[...upserts.values()];batch.moves.push(...sweep.moves);batch.events.push(...sweep.events);
        const current=snapshot.state.pendingEntry,consumed=new Set(selected.cursor.seen);
        const remaining=current?(current.sourceIds??[]).filter(id=>!consumed.has(id)):[];
        const pendingEntry=current&&remaining.length?{...current,sourceIds:remaining,answerIds:(current.answerIds??[]).filter(id=>remaining.includes(id)),echoSourceIds:(current.echoSourceIds??[]).filter(id=>remaining.includes(id))}:null;
        if ((current?.echoSourceIds??[]).some(id=>consumed.has(id))) {
          const objectIds=batch.upserts.filter(object=>object.kind==='loop'&&object.sensitivity==='normal'&&batch.events.some(event=>event.type==='proposal.accepted'&&event.objectId===object.id)).map(object=>object.id).slice(0,3);
          const reviewCount=batch.events.filter(event=>event.type==='proposal.queued').length;
          if (objectIds.length||reviewCount) echo={runId,objectIds,reviewCount,createdAt:asOf,status:'ready'};
        }
        batch.statePatch={...batch.statePatch,...sweep.statePatch,cursor:selected.cursor,pendingEntry,
          ...(trigger==='nightly'?{lastSweepAt:asOf}:{}),
          ...(echo?{echoCandidates:{...(snapshot.state.echoCandidates??{}),[runId]:echo}}:{})};
        if (sweep.statePatch.backoff && JSON.stringify(sweep.statePatch.backoff)!==JSON.stringify(snapshot.state.backoff)) batch.events.push({id:runId+':backoff',type:'knowledge.backoff.started',at:asOf});
        return batch;
      }});
      const acceptedIds=[...new Set(reduction.batch.events.filter(event=>event.type==='proposal.accepted').map(event=>event.objectId))];
      this.#logger?.info?.('lifelog.knowledge.run-completed',{runId,proposals:extraction.proposals.length,accepted:acceptedIds.length,rejected:reduction.rejected.length});
      return {status:'completed',runId,acceptedIds,rejected:reduction.rejected,echo};
    } catch(error) {
      const reason=error.code??'extraction_failed';
      try {await this.#deferFailed({username,generation:capturedGeneration,runId,asOf,reason});}catch{/* An unavailable store stays unavailable; never fabricate a cursor. */}
      this.#logger?.warn?.('lifelog.knowledge.run-failed',{runId,reason});
      return {status:'failed',runId,reason};
    }
  }
  async #deferFailed({username,generation,runId,asOf,reason}) {
    await mutateKnowledge({store:this.#store,username,runId:runId+':failed',build:snapshot=>{
      const pending=snapshot.state.pendingEntry;
      return stateBatch(pending&&pending.generation===generation?{pendingEntry:{...pending,deadline:null,lastFailure:{at:asOf,reason}}}:{},[{id:runId+':failed',type:'knowledge.extraction.failed',at:asOf,reason}]);
    }});
  }
  async dispose() {
    this.#enabled=false;
    await Promise.allSettled([...this.#inFlight.values()]);
  }
  async preview(args) {
    if (!this.#preview) throw new Error('Read-only previews require the separately budgeted Phase 0 CLI');
    return this.#preview(args);
  }
}
