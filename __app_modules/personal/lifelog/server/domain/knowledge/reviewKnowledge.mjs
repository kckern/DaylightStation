import {evidenceProblem,normalizeQuote,proposalProblem,newBatch} from './contracts.mjs';
import {reduceKnowledge} from './reduceKnowledge.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
/** Delivered user decisions never grant model proposals merge or ask-policy authority. */
export function reviewKnowledge({snapshot,reviewId,action,evidence,asOf,timezone,receiptId}){
 const review=snapshot.state.pendingReviews?.find(row=>row.id===reviewId);
 if(!review||!['confirm','reject'].includes(action)||!receiptId)fail('KNOWLEDGE_REVIEW_UNKNOWN');
 const batch=newBatch(),p=review.proposal;
 if(action==='confirm'){
  if(!['person_confirmation','alias_confirmation','sensitive'].includes(review.reason))fail('KNOWLEDGE_REVIEW_UNSUPPORTED');
  const rows=evidence.filter(row=>row.ref===p.evidenceRef);
  if(proposalProblem(p)||rows.length!==1||evidenceProblem(rows[0],{mode:'commit',timezone,asOf})||!normalizeQuote(rows[0].content).includes(normalizeQuote(p.quote)))fail('KNOWLEDGE_REVIEW_EVIDENCE');
  const original=snapshot.objects[p.target];let object,path;
  if(original?.evidence.some(row=>row.ref===p.evidenceRef&&row.retracted))fail('KNOWLEDGE_REVIEW_RETRACTED');
  if(review.reason==='person_confirmation'&&p.op==='propose_entity'&&original?.kind==='person'&&(original.names??[]).includes(p.fields.name)){
   object=structuredClone(original);path='status';object.status='active';
  }else if(review.reason==='alias_confirmation'&&p.op==='alias_candidate'&&original?.kind==='person'&&(original.aliases??[]).some(alias=>alias.value===p.fields.alias)){
   object=structuredClone(original);path='aliases';object.aliases=object.aliases.map(alias=>alias.value===p.fields.alias?{...alias,confirmed:true}:alias);
  }else if(review.reason==='sensitive'&&p.op==='open_loop'&&!original){
   // Reuse every deterministic validation. A tap accepts storage, never permission to ask.
   const validationSnapshot={...snapshot,objects:Object.fromEntries(Object.entries(snapshot.objects).map(([id,o])=>[id,{...o,sensitivity:'normal'}])),state:{...snapshot.state,processedProposalIds:[]}};
   const reduced=reduceKnowledge({snapshot:validationSnapshot,proposals:[{...p,fields:{...p.fields,sensitivity:'normal',ask_policy:'never'}}],evidence:rows,asOf,timezone});
   if(reduced.rejected.length||reduced.batch.upserts.length!==1)fail('KNOWLEDGE_REVIEW_EVIDENCE');
   object=reduced.batch.upserts[0];object.sensitivity=p.fields.sensitivity??'normal';object.ask_policy='never';path='review';
  }else fail('KNOWLEDGE_REVIEW_UNSUPPORTED');
  object.user_edits.push({path,before:original?.[path]??null,after:path==='review'?'confirmed':structuredClone(object[path]),at:asOf,by:'tap',receiptId});
  batch.upserts=[object];
 }
 batch.statePatch.pendingReviews=snapshot.state.pendingReviews.filter(row=>row.id!==reviewId);
 batch.events=[{id:receiptId,type:'knowledge.review.'+(action==='confirm'?'confirmed':'rejected'),at:asOf,proposalId:reviewId,objectId:p.target}];
 return batch;
}
