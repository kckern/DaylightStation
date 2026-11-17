import moment from 'moment-timezone';
import {reviewKnowledge} from '../../domain/knowledge/reviewKnowledge.mjs';
import { selectQuestions,experimentArm } from '../../domain/knowledge/selectQuestions.mjs';
import { buildQuestion } from '../../domain/knowledge/questionForms.mjs';
import { applyUserReply,reduceKnowledge } from '../../domain/knowledge/reduceKnowledge.mjs';
import { localDateFor } from '../../domain/knowledge/calendar.mjs';
import { REPLY_WINDOW_MS } from '../../domain/knowledge/contracts.mjs';
import { mutateKnowledge,stateBatch } from './knowledgeMutation.mjs';
const DAY=86400000;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const legacy=reason=>({mode:'legacy',questions:[],statements:[],queuedCount:0,selectionId:null,reason});
const reserved=(snapshot,asOf)=>new Set(Object.values(snapshot.state.deliveries??{}).filter(d=>['prepared','quarantined'].includes(d.status)&&d.expiresAt>asOf).flatMap(d=>d.questions.map(q=>q.objectId).filter(Boolean)));
function eligibleView(snapshot,asOf) {
  const blocked=reserved(snapshot,asOf);
  return {...snapshot,objects:Object.fromEntries(Object.entries(snapshot.objects).filter(([id])=>!blocked.has(id)))};
}
/** Durable selections and receipt-bound decisions. Transport never supplies authority. */
export class KnowledgeQuestions {
  #enabled;#store;#evidence;#tokens;#verify;#identity;#timezone;#id;#activation;
  constructor({enabled=false,store,evidence,tokens,verifyPrincipal,identityForUser,userTimezone,nextId,activationDate}) {
    if(!store?.commit||!tokens?.mint||typeof verifyPrincipal!=='function'||typeof identityForUser!=='function'||typeof userTimezone!=='function'||typeof nextId!=='function')throw new TypeError('Invalid knowledge question dependencies');
    this.#enabled=enabled;this.#store=store;this.#evidence=evidence;this.#tokens=tokens;this.#verify=verifyPrincipal;this.#identity=identityForUser;this.#timezone=userTimezone;this.#id=nextId;this.#activation=activationDate;
  }
  #date(username,asOf){return localDateFor(asOf,this.#timezone(username));}
  #principal(principal){
    if(!this.#enabled)fail('KNOWLEDGE_DISABLED');
    const value=this.#verify(principal);if(!value)fail('KNOWLEDGE_PRINCIPAL_REQUIRED');
    if(value.authored!==true)fail('KNOWLEDGE_AUTHORED_INPUT_REQUIRED');
    const configured=this.#identity(value.username);
    if(!configured||String(configured.senderId)!==value.senderId||configured.conversationId!==value.conversationId)fail('KNOWLEDGE_IDENTITY_MISMATCH');
    return value;
  }
  #fresh(snapshot,asOf){return snapshot.health.available&&!snapshot.health.conflicted&&!snapshot.health.recovering&&Number.isFinite(snapshot.health.lastSweepAt)&&snapshot.health.lastSweepAt<=asOf&&asOf-snapshot.health.lastSweepAt<=REPLY_WINDOW_MS;}
  #nonce(tokens){for(let i=0;i<8;i++){const nonce=this.#tokens.mint();if(!Object.hasOwn(tokens,nonce))return nonce;}fail('KNOWLEDGE_TOKEN_COLLISION');}
  async selectForMorning({username,askDate,asOf,max=2}) {
    if(!this.#enabled)return legacy('disabled');
    if(this.#date(username,asOf)!==askDate)fail('KNOWLEDGE_ASK_DATE_MISMATCH');
    const initial=await this.#store.read({username});if(!this.#fresh(initial,asOf))return legacy('unavailable');
    let selected;
    await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
      if(!this.#fresh(snapshot,asOf)){selected=legacy('unavailable');return null;}
      const previous=snapshot.state.morningSelections?.[askDate];
      if(previous&&snapshot.state.selections?.[previous]){selected=snapshot.state.selections[previous];return null;}
      const activation=this.#activation?.(username)??this.#date(username,snapshot.state.activationAt??asOf);
      const mode=experimentArm({activationDate:activation,askDate});
      const used=snapshot.asks.filter(a=>a.channel==='morning'&&a.arm==='knowledge'&&a.askDate===askDate&&a.botMessageId&&Number.isFinite(a.deliveredAt)).length;
      const result=selectQuestions({snapshot:eligibleView(snapshot,asOf),askDate,asOf,timezone:this.#timezone(username),max:mode==='legacy'?0:Math.max(0,Math.min(2,max)-used)});
      const history={...(snapshot.state.quizHistory??{})},quiz=[];
      for(const question of result.quizCandidates){
        const object=snapshot.objects[question.objectId],old=history[object.id]??snapshot.quiz.find(row=>row.objectId===object.id);
        const moved=old&&object.touched>old.evidenceDate;
        if(old&&!moved&&asOf-old.enqueuedAt>=7*DAY)continue;
        const row={objectId:object.id,questionId:question.id,enqueuedAt:old&&!moved?old.enqueuedAt:asOf,evidenceDate:object.touched};
        history[object.id]=row;quiz.push(row);if(quiz.length===5)break;
      }
      const selectionId=this.#id();
      selected={mode,questions:mode==='knowledge'?result.questions:[],statements:[],queuedCount:quiz.length,selectionId,askDate,createdAt:asOf,kind:'morning',reason:mode==='legacy'?'control':result.reason};
      return stateBatch({selections:{...(snapshot.state.selections??{}),[selectionId]:selected},morningSelections:{...(snapshot.state.morningSelections??{}),[askDate]:selectionId},quiz,quizHistory:history});
    }});
    return selected;
  }
  async prepareEcho({username,runId,asOf}) {
    if(!this.#enabled)return {status:'disabled',sendAllowed:false};
    const askDate=this.#date(username,asOf);let selection;
    await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
      if(!this.#fresh(snapshot,asOf))fail('KNOWLEDGE_UNAVAILABLE');
      const candidate=snapshot.state.echoCandidates?.[runId];
      if(!candidate||asOf<candidate.createdAt||asOf-candidate.createdAt>=REPLY_WINDOW_MS){selection=null;return null;}
      const existing=snapshot.state.echoSelections?.[runId];
      if(existing){selection=snapshot.state.selections[existing];return null;}
      const objects=candidate.objectIds.map(id=>snapshot.objects[id]).filter(object=>object?.kind==='loop'&&object.sensitivity==='normal'&&object.ask_policy!=='never').slice(0,3);
      if(!objects.length&&!candidate.reviewCount){selection=null;return null;}
      const text=['Recorded: '+objects.map(object=>object.title).join('; '),candidate.reviewCount?'Other items await private review.':null].filter(Boolean).join('\n');
      const selectionId=this.#id();selection={mode:'knowledge',kind:'echo',selectionId,askDate,createdAt:asOf,questions:[{id:'echo:'+runId,scope:'echo',runId,text}]};
      return stateBatch({selections:{...(snapshot.state.selections??{}),[selectionId]:selection},echoSelections:{...(snapshot.state.echoSelections??{}),[runId]:selectionId}});
    }});
    if(!selection)return {status:'empty',sendAllowed:false,questions:[]};
    return this.prepareDelivery({username,conversationId:this.#identity(username)?.conversationId,selectionId:selection.selectionId,askDate:selection.askDate,channel:'echo',questionIds:selection.questions.map(q=>q.id),asOf});
  }
  async prepareWeeklyReview({username,asOf}) {
    if(!this.#enabled)return {status:'disabled',sendAllowed:false};
    const local=moment.tz(asOf,this.#timezone(username)),askDate=this.#date(username,asOf);
    if(local.isoWeekday()!==1||local.hour()<5)return {status:'not_due',sendAllowed:false};
    let selection;
    await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
      if(!this.#fresh(snapshot,asOf))fail('KNOWLEDGE_UNAVAILABLE');
      const existing=snapshot.state.weeklyReviews?.[askDate];
      if(existing){selection=snapshot.state.selections[existing];return null;}
      const reviews=(snapshot.state.pendingReviews??[]).filter(row=>['person_confirmation','alias_confirmation','sensitive'].includes(row.reason)).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)).slice(0,5);
      const selectionId=this.#id();
      selection={mode:'knowledge',kind:'review',selectionId,askDate,createdAt:asOf,questions:reviews.map(row=>({id:'review:'+row.id,scope:'review',proposalId:row.id,objectId:row.proposal.target,text:row.reason==='alias_confirmation'?`Confirm alias: ${row.proposal.fields.alias}`:row.reason==='person_confirmation'?`Confirm person: ${row.proposal.fields.name}`:`Keep privately: ${row.proposal.fields.title}`}))};
      return stateBatch({selections:{...(snapshot.state.selections??{}),[selectionId]:selection},weeklyReviews:{...(snapshot.state.weeklyReviews??{}),[askDate]:selectionId}});
    }});
    if(!selection.questions.length)return {status:'empty',sendAllowed:false,questions:[]};
    return this.prepareDelivery({username,conversationId:this.#identity(username)?.conversationId,selectionId:selection.selectionId,askDate,channel:'review',questionIds:selection.questions.map(q=>q.id),asOf});
  }
  async prepareDelivery({username,conversationId,selectionId,askDate,channel,questionIds=[],asOf}) {
    if(!this.#enabled)fail('KNOWLEDGE_DISABLED');
    if(this.#date(username,asOf)!==askDate)fail('KNOWLEDGE_ASK_DATE_MISMATCH');
    if(this.#identity(username)?.conversationId!==conversationId)fail('KNOWLEDGE_CONVERSATION_MISMATCH');
    if(!['morning','quiz','review','echo'].includes(channel)||!Array.isArray(questionIds))fail('KNOWLEDGE_INVALID_DELIVERY');
    let output;
    await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
      if(!this.#fresh(snapshot,asOf))fail('KNOWLEDGE_UNAVAILABLE');
      const selection=snapshot.state.selections?.[selectionId];
      if(!selection||selection.askDate!==askDate||selection.kind!==channel)fail('KNOWLEDGE_SELECTION_MISMATCH');
      const deliveries=structuredClone(snapshot.state.deliveries??{});
      for(const delivery of Object.values(deliveries)){
        if(['prepared','quarantined'].includes(delivery.status)&&delivery.expiresAt<=asOf)delivery.status='expired';
      }
      const previous=Object.values(deliveries).filter(d=>d.selectionId===selectionId&&d.channel===channel);
      const live=previous.find(d=>!['cancelled','expired'].includes(d.status));
      if(live){output={deliveryId:live.id,questions:live.displayQuestions,choices:live.choices,sendAllowed:false,status:live.status};return null;}
      if(previous.length>=2)fail('KNOWLEDGE_DELIVERY_RETRY_LIMIT');
      let questions=[];
      if(selection.mode==='legacy'){
        if(questionIds.some(id=>!/^legacy\.[0-9]+$/.test(id)))fail('KNOWLEDGE_QUESTION_MISMATCH');
        questions=questionIds.map(id=>({id,objectId:null,legacy:true}));
      }else{
        if(questionIds.some(id=>!selection.questions.some(q=>q.id===id)))fail('KNOWLEDGE_QUESTION_MISMATCH');
        questions=selection.questions.filter(q=>questionIds.includes(q.id)).map(q=>{
          if(q.scope&&q.scope!=='loop')return q;
          const object=snapshot.objects[q.objectId];
          if(!object||!['open','waiting','stale'].includes(object.status)||!['normal','user_initiated'].includes(object.ask_policy))return null;
          const fresh=buildQuestion({object});return fresh?.id===q.id?fresh:null;
        }).filter(Boolean);
        if(channel==='morning'){
          const used=snapshot.asks.filter(a=>a.channel==='morning'&&a.arm==='knowledge'&&a.askDate===askDate&&a.botMessageId&&Number.isFinite(a.deliveredAt)).length;
          questions=questions.slice(0,Math.max(0,2-used));
        }
      }
      const id=this.#id(),tokens={...(snapshot.state.callbackTokens??{})},choices=[],nonces=[];
      const expiresAt=asOf+7*DAY;
      for(const [index,q]of questions.entries()){
        if(q.legacy)continue;
        const nonce=this.#nonce(tokens),scope=q.scope??'loop';nonces.push(nonce);
        const actions=scope==='echo'?['looks_right']:scope==='review'?['confirm','reject']:channel==='quiz'?['yes','not_yet','drop','skip']:['yes','not_yet','drop'];
        tokens[nonce]={nonce,deliveryId:id,selectionId,username,conversationId,channel,scope,objectId:q.objectId??null,questionId:q.id,proposalId:q.proposalId??null,runId:q.runId??null,allowedActions:actions,status:'prepared',expiresAt};
        const labels={yes:'Yes',not_yet:'Not yet',drop:'Drop it',looks_right:'Looks right',confirm:'Confirm',reject:'Reject'};
        choices.push(actions.filter(a=>a!=='skip').map(action=>({text:(questions.length>1?`${index+1}. `:'')+labels[action],callback_data:this.#tokens.encode({nonce,action})})));
      }
      if(channel==='quiz'&&questions.length){
        const nonce=this.#nonce(tokens);nonces.push(nonce);
        tokens[nonce]={nonce,deliveryId:id,selectionId,username,conversationId,channel,scope:'control',questionId:'done',allowedActions:['done'],status:'prepared',expiresAt};
        choices.push([{text:'Different question',callback_data:this.#tokens.encode({nonce:nonces[0],action:'skip'})},{text:'Done',callback_data:this.#tokens.encode({nonce,action:'done'})}]);
      }
      const displayQuestions=questions.filter(q=>!q.legacy);
      const delivery={id,selectionId,username,conversationId,askDate,channel,arm:selection.mode==='legacy'?'legacy':'knowledge',questions,displayQuestions,choices,nonces,createdAt:asOf,expiresAt,status:'prepared',attempt:previous.length+1};
      output={deliveryId:id,questions:displayQuestions,choices,sendAllowed:true,status:'prepared'};
      return stateBatch({deliveries:{...deliveries,[id]:delivery},callbackTokens:tokens,...(channel==='quiz'?{quizSession:{selectionId,deliveryId:id,questionId:questions[0]?.id??null}}:{})});
    }});
    return output;
  }
  async recordDelivery({username,deliveryId,botMessageId,asOf}) {
    const askDate=this.#date(username,asOf);if(!/^[1-9][0-9]*$/.test(String(botMessageId)))fail('KNOWLEDGE_MESSAGE_ACK_REQUIRED');
    let result;
    await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
      const delivery=snapshot.state.deliveries?.[deliveryId];if(!delivery)fail('KNOWLEDGE_DELIVERY_UNKNOWN');
      if(delivery.status==='delivered'){if(delivery.botMessageId!==String(botMessageId))fail('KNOWLEDGE_MESSAGE_MISMATCH');result={status:'already_recorded'};return null;}
      if(delivery.status!=='prepared')fail('KNOWLEDGE_DELIVERY_NOT_PENDING');
      const tokens={...(snapshot.state.callbackTokens??{})};
      for(const nonce of delivery.nonces)tokens[nonce]={...tokens[nonce],status:'delivered',botMessageId:String(botMessageId)};
      const asks=[...snapshot.asks];
      for(const q of delivery.questions){
        if(q.scope&&q.scope!=='loop')continue;
        const id=deliveryId+':'+q.id;
        if(!asks.some(a=>a.id===id))asks.push({id,questionId:q.id,objectId:q.objectId,deliveryId,channel:delivery.channel,arm:delivery.arm,askDate,intendedAskDate:delivery.askDate,deliveredAt:asOf,botMessageId:String(botMessageId),response:null});
      }
      result={status:'recorded'};
      return stateBatch({asks,callbackTokens:tokens,deliveries:{...snapshot.state.deliveries,[deliveryId]:{...delivery,status:'delivered',botMessageId:String(botMessageId),deliveredAt:asOf,deliveredAskDate:askDate}}},[{id:deliveryId+':ack',type:'knowledge.delivery.acknowledged',at:asOf,deliveryId,channel:delivery.channel,arm:delivery.arm}]);
    }});return result;
  }
  async recordDeliveryFailure({username,deliveryId,uncertain,asOf}) {
    this.#date(username,asOf);
    await mutateKnowledge({store:this.#store,username,runId:this.#id(),build:snapshot=>{
      const delivery=snapshot.state.deliveries?.[deliveryId];if(!delivery||delivery.status==='delivered'||delivery.status!=='prepared')return null;
      const status=uncertain?'quarantined':'cancelled',tokens={...snapshot.state.callbackTokens};
      for(const nonce of delivery.nonces)tokens[nonce]={...tokens[nonce],status};
      return stateBatch({callbackTokens:tokens,deliveries:{...snapshot.state.deliveries,[deliveryId]:{...delivery,status,failedAt:asOf}},...(snapshot.state.quizSession?.deliveryId===deliveryId?{quizSession:null}:{})});
    }});
  }
  #callback(snapshot,principal,nonce,action,botMessageId,receiptId,asOf) {
    if(principal.kind!=='callback'||principal.messageId!==String(botMessageId)||principal.receiptId!==receiptId)fail('KNOWLEDGE_CALLBACK_BINDING');
    const decoded=this.#tokens.decode(principal.callbackData);
    const token=snapshot.state.callbackTokens?.[nonce];
    const controlAction=({'journal:skip':'skip','journal:change':'skip','journal:done':'done'})[principal.callbackData];
    const legacyControl=controlAction===action&&token?.channel==='quiz'&&((action==='skip'&&token.scope==='loop')||(action==='done'&&token.scope==='control'));
    if((!decoded||decoded.nonce!==nonce||decoded.action!==action)&&!legacyControl)fail('KNOWLEDGE_CALLBACK_BINDING');
    if(!token||token.username!==principal.username||token.conversationId!==principal.conversationId||!token.allowedActions.includes(action))fail('KNOWLEDGE_TOKEN_SCOPE');
    if(asOf>=token.expiresAt)fail('KNOWLEDGE_TOKEN_EXPIRED');
    if(token.botMessageId!==String(botMessageId)||!['delivered','consumed'].includes(token.status))fail('KNOWLEDGE_DELIVERY_NOT_ACKNOWLEDGED');
    return token;
  }
  async #reviewEvidence(username,nonce){
    const snapshot=await this.#store.read({username});
    const token=snapshot.state.callbackTokens?.[nonce];
    if(token?.scope!=='review')return [];
    const review=snapshot.state.pendingReviews?.find(row=>row.id===token.proposalId);
    return review?this.#evidence.readByRefs({username,refs:[review.proposal.evidenceRef],preview:false}):[];
  }
  async reply({principal,token:nonce,action,botMessageId,receiptId,asOf}) {
    const p=this.#principal(principal);this.#date(p.username,asOf);let result;
    const reviewEvidence=action==='confirm'?await this.#reviewEvidence(p.username,nonce):[];
    await mutateKnowledge({store:this.#store,username:p.username,runId:this.#id(),build:snapshot=>{
      this.#principal(p);const token=this.#callback(snapshot,p,nonce,action,botMessageId,receiptId,asOf);
      if(token.status==='consumed'||snapshot.state.appliedReceipts?.[receiptId]){result={status:'already_applied',channel:token.channel};return null;}
      if(token.scope==='review'){
        const batch=reviewKnowledge({snapshot,reviewId:token.proposalId,action,evidence:reviewEvidence,asOf,timezone:this.#timezone(p.username),receiptId});
        batch.statePatch.callbackTokens={...snapshot.state.callbackTokens,[nonce]:{...token,status:'consumed',receiptId,action}};
        batch.statePatch.appliedReceipts={...(snapshot.state.appliedReceipts??{}),[receiptId]:{deliveryId:token.deliveryId,action,channel:'review'}};
        result={status:'applied',channel:'review',action};return batch;
      }
      if(token.scope==='control')fail('KNOWLEDGE_CONTROL_ACTION_REQUIRED');
      const batch=stateBatch({}),tokens={...snapshot.state.callbackTokens,[nonce]:{...token,status:'consumed',receiptId,action}};
      if(token.scope==='loop'){
        if(!['yes','not_yet','drop','skip'].includes(action))fail('KNOWLEDGE_TOKEN_SCOPE');
        const object=snapshot.objects[token.objectId];if(!object)fail('KNOWLEDGE_TARGET_MISSING');
        batch.upserts=[applyUserReply({object,action,receiptId,asOf,timezone:this.#timezone(p.username)})];
        batch.statePatch.asks=snapshot.asks.map(ask=>ask.deliveryId===token.deliveryId&&ask.questionId===token.questionId?{...ask,response:ask.response??{at:asOf,action,by:'tap',length:0,attribution:'reply_to',receiptId}}:ask);
      }else if(token.scope==='echo'&&action!=='looks_right')fail('KNOWLEDGE_TOKEN_SCOPE');
      batch.statePatch={...batch.statePatch,callbackTokens:tokens,appliedReceipts:{...(snapshot.state.appliedReceipts??{}),[receiptId]:{deliveryId:token.deliveryId,action,channel:token.channel}},...(token.channel==='quiz'?{quizSession:null}:{})};
      batch.events=[{id:receiptId,type:token.scope==='echo'?'knowledge.echo.confirmed':'knowledge.reply.applied',at:asOf,objectId:token.objectId,action,attribution:'reply_to'}];
      result={status:'applied',channel:token.channel,action};return batch;
    }});return result;
  }
  async nextQuiz({principal,asOf}) {
    const p=this.#principal(principal),askDate=this.#date(p.username,asOf);let selection;
    await mutateKnowledge({store:this.#store,username:p.username,runId:this.#id(),build:snapshot=>{
      if(!this.#fresh(snapshot,asOf))fail('KNOWLEDGE_UNAVAILABLE');
      if(p.kind==='callback'){
        const origin=Object.values(snapshot.state.deliveries??{}).find(d=>d.status==='delivered'&&d.botMessageId===p.messageId&&d.conversationId===p.conversationId);
        if(!origin)fail('KNOWLEDGE_MESSAGE_MISMATCH');
        if(p.callbackData!=='debrief:ask'&&!snapshot.state.appliedReceipts?.[p.receiptId])fail('KNOWLEDGE_QUIZ_INTENT_REQUIRED');
      }
      const active=snapshot.state.quizSession&&snapshot.state.deliveries?.[snapshot.state.quizSession.deliveryId];
      if(active&&!['cancelled','quarantined','expired'].includes(active.status)){selection={active};return null;}
      const queued=snapshot.quiz.filter(row=>asOf-row.enqueuedAt<7*DAY);
      const view=eligibleView({...snapshot,objects:Object.fromEntries(queued.map(row=>[row.objectId,snapshot.objects[row.objectId]]).filter(([,o])=>o))},asOf);
      const eligible=new Set(selectQuestions({snapshot:view,askDate,asOf,timezone:this.#timezone(p.username),max:0}).quizCandidates.map(q=>q.objectId));
      const next=queued.find(row=>eligible.has(row.objectId));
      if(!next){selection={empty:true};return null;}
      const question=buildQuestion({object:snapshot.objects[next.objectId]});
      const key=askDate+':'+question.id,existing=snapshot.state.quizSelections?.[key];
      if(existing){selection=snapshot.state.selections[existing];return null;}
      const selectionId=this.#id();selection={mode:'knowledge',selectionId,askDate,kind:'quiz',questions:[question],createdAt:asOf};
      return stateBatch({selections:{...(snapshot.state.selections??{}),[selectionId]:selection},quizSelections:{...(snapshot.state.quizSelections??{}),[key]:selectionId}});
    }});
    if(selection.active)return {deliveryId:selection.active.id,questions:selection.active.displayQuestions,choices:selection.active.choices,sendAllowed:false,status:'active'};
    if(selection.empty)return {questions:[],choices:[],sendAllowed:false,status:'empty'};
    return this.prepareDelivery({username:p.username,conversationId:p.conversationId,selectionId:selection.selectionId,askDate,channel:'quiz',questionIds:selection.questions.map(q=>q.id),asOf});
  }
  async hasActiveQuiz({principal}){
    const p=this.#principal(principal),snapshot=await this.#store.read({username:p.username});
    const active=snapshot.state.quizSession&&snapshot.state.deliveries?.[snapshot.state.quizSession.deliveryId];
    return !!(active?.status==='delivered'&&active.conversationId===p.conversationId&&active.botMessageId===p.messageId);
  }
  async quizControl({principal,asOf}){
    const p=this.#principal(principal),action=({'journal:skip':'skip','journal:change':'skip','journal:done':'done'})[p.callbackData];
    if(p.kind!=='callback'||!action)fail('KNOWLEDGE_CONTROL_ACTION_REQUIRED');
    const snapshot=await this.#store.read({username:p.username});
    const active=snapshot.state.quizSession&&snapshot.state.deliveries?.[snapshot.state.quizSession.deliveryId];
    if(active?.status!=='delivered'||active.botMessageId!==p.messageId||active.conversationId!==p.conversationId)fail('KNOWLEDGE_QUIZ_NOT_ACTIVE');
    const nonce=active.nonces.find(n=>snapshot.state.callbackTokens[n]?.allowedActions.includes(action));
    if(!nonce)fail('KNOWLEDGE_TOKEN_SCOPE');
    return action==='done'?this.done({principal:p,token:nonce,asOf}):this.reply({principal:p,token:nonce,action,botMessageId:p.messageId,receiptId:p.receiptId,asOf});
  }
  async done({principal,token:nonce,asOf}) {
    const p=this.#principal(principal),decoded=this.#tokens.decode(p.callbackData)??(p.callbackData==='journal:done'?{nonce,action:'done'}:null);this.#date(p.username,asOf);
    if(!decoded||decoded.action!=='done')fail('KNOWLEDGE_CONTROL_ACTION_REQUIRED');let result;
    await mutateKnowledge({store:this.#store,username:p.username,runId:this.#id(),build:snapshot=>{
      const token=this.#callback(snapshot,p,decoded.nonce,'done',p.messageId,p.receiptId,asOf);
      if(token.scope!=='control'||token.channel!=='quiz')fail('KNOWLEDGE_TOKEN_SCOPE');
      if(token.status==='consumed'){result={status:'already_applied'};return null;}
      if(snapshot.state.quizSession?.deliveryId!==token.deliveryId)fail('KNOWLEDGE_QUIZ_NOT_ACTIVE');
      result={status:'done'};
      return stateBatch({quizSession:null,callbackTokens:{...snapshot.state.callbackTokens,[decoded.nonce]:{...token,status:'consumed',receiptId:p.receiptId,action:'done'}}},[{id:p.receiptId,type:'knowledge.quiz.done',at:asOf}]);
    }});return result;
  }
  async attributeEntry({principal,sourceId,length,asOf}) {
    const p=this.#principal(principal);
    if(!['text','voice'].includes(p.kind))fail('KNOWLEDGE_ENTRY_REQUIRED');
    this.#date(p.username,asOf);let result={attribution:'none',attributedAnswer:false};
    await mutateKnowledge({store:this.#store,username:p.username,runId:this.#id(),build:snapshot=>{
      if(snapshot.state.attributedSources?.[sourceId]){result=snapshot.state.attributedSources[sourceId];return null;}
      const candidates=snapshot.asks.filter(ask=>ask.botMessageId&&Number.isFinite(ask.deliveredAt)&&asOf>=ask.deliveredAt&&asOf-ask.deliveredAt<=REPLY_WINDOW_MS&&!ask.response);
      const direct=p.replyToMessageId?candidates.filter(ask=>ask.botMessageId===p.replyToMessageId):[];
      const found=direct.length?direct:candidates;
      const attribution=direct.length?'reply_to':found.length===1?'window':'none';
      const selected=attribution==='none'?[]:found;
      result={attribution,attributedAnswer:attribution!=='none',askIds:selected.map(ask=>ask.id)};
      const ids=new Set(result.askIds);
      const asks=snapshot.asks.map(ask=>ids.has(ask.id)?{...ask,response:{at:asOf,action:'text',by:p.kind==='voice'?'voice':'text',length,attribution,sourceId,receiptId:p.receiptId}}:ask);
      return stateBatch({asks,attributedSources:{...(snapshot.state.attributedSources??{}),[sourceId]:result}},[{id:p.receiptId+':attribution',type:'knowledge.entry.attributed',at:asOf,sourceId,attribution}]);
    }});return result;
  }
}
