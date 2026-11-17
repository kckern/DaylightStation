import {emptySnapshot} from '../../domain/knowledge/contracts.mjs';
import {reduceKnowledge} from '../../domain/knowledge/reduceKnowledge.mjs';
import {selectQuestions,experimentArm} from '../../domain/knowledge/selectQuestions.mjs';
import {localDateFor} from '../../domain/knowledge/calendar.mjs';
/** Ephemeral Phase0 view. It never acquires a writer or invokes a model. */
export function previewKnowledge({username,proposals,evidence,askDate,activationDate,asOf,timezone}){
 if(localDateFor(asOf,timezone)!==askDate)throw new TypeError('Preview ask date does not match as-of');
 const available=evidence.filter(row=>(row.observedAt??row.at)<=asOf),refs=new Set(available.map(row=>row.ref));
 const base=emptySnapshot();base.health.lastSweepAt=asOf;
 const reduced=reduceKnowledge({snapshot:base,proposals:proposals.filter(p=>refs.has(p.evidenceRef)),evidence:available,asOf,timezone,mode:'preview'});
 const snapshot={...base,objects:Object.fromEntries(reduced.batch.upserts.map(object=>[object.id,object])),state:{...base.state,...reduced.batch.statePatch}};
 const mode=experimentArm({activationDate,askDate}),selected=selectQuestions({snapshot,askDate,asOf,timezone,max:mode==='knowledge'?2:0});
 return {previewOnly:true,selection:{mode,reason:mode==='legacy'?'control':selected.reason,questions:mode==='knowledge'?selected.questions:[],statements:[],queuedCount:selected.quizCandidates.length,selectionId:'preview:'+username+':'+askDate,askDate},rejected:reduced.rejected,availableEvidence:available.length};
}
