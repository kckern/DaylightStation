import {describe,it,expect} from 'vitest';
import {reviewKnowledge} from './reviewKnowledge.mjs';
import {snapshot,evidence,proposal,AS_OF,TZ,loop} from './fixtures.testHelpers.mjs';
const person={...loop({id:'person.sample',kind:'person',title:'Sample',status:'candidate'}),names:['Sample'],aliases:[{value:'S',confirmed:false,dates:['2026-11-02']}]};
function decide({op='propose_entity',target='person.sample',fields={kind:'person',name:'Sample'},quote='Sample',reason='person_confirmation',objects={'person.sample':person},action='confirm',rows=[evidence()],over={}}={}){
 const p=proposal({op,target,fields,quote});return reviewKnowledge({snapshot:snapshot(objects,{state:{pendingReviews:[{id:p.id,reason,proposal:p,createdAt:AS_OF}],processedProposalIds:[p.id]}}),reviewId:p.id,action,evidence:rows,asOf:AS_OF,timezone:TZ,receiptId:'receipt-1',...over});
}
describe('explicit knowledge review decisions',()=>{
 it('confirms only the named person and removes only the decided review',()=>{
  const batch=decide();expect(batch.upserts[0].status).toBe('active');expect(batch.upserts[0].user_edits.at(-1)).toMatchObject({by:'tap',receiptId:'receipt-1'});expect(batch.statePatch.pendingReviews).toEqual([]);
 });
 it('confirms one alias without merging people or approving other aliases',()=>{
  const batch=decide({op:'alias_candidate',fields:{alias:'S'},quote:'S',reason:'alias_confirmation'});
  expect(batch.upserts[0].aliases).toEqual([{value:'S',confirmed:true,dates:['2026-11-02']}]);expect(batch.upserts[0].id).toBe('person.sample');
 });
 it('rejects without deleting existing objects',()=>{const batch=decide({action:'reject'});expect(batch.upserts).toEqual([]);expect(batch.statePatch.pendingReviews).toEqual([]);});
 it('refuses lost evidence and ambiguous person-name changes',()=>{
  expect(()=>decide({rows:[]})).toThrow('KNOWLEDGE_REVIEW_EVIDENCE');
  expect(()=>decide({reason:'ambiguous_person_name'})).toThrow('KNOWLEDGE_REVIEW_UNSUPPORTED');
 });
 it('refuses confirmation when its supporting evidence was retracted after delivery',()=>{
  const retracted={...person,evidence:[{ref:'journalist:msg:source-1',quote:'Sample',date:'2026-11-02',retracted:true}]};
  expect(()=>decide({objects:{[person.id]:retracted}})).toThrow('KNOWLEDGE_REVIEW_RETRACTED');
 });
 it('keeps confirmed sensitive loops unaskable',()=>{
  const batch=decide({op:'open_loop',target:'loop.sensitive',fields:{title:'Contact Sample',sensitivity:'private',dueText:'Monday'},quote:'I will contact Sample on Monday',reason:'sensitive',objects:{}});
  expect(batch.upserts[0]).toMatchObject({sensitivity:'private',ask_policy:'never'});
 });
});
