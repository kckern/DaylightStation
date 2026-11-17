import {JournalKnowledgeEvidence} from '../adapters/knowledge/JournalKnowledgeEvidence.mjs';
export {previewKnowledge} from '../application/knowledge/KnowledgePreview.mjs';
/** Read-only journal capability for owner-scoped private preview tooling. */
export function createJournalEvidencePreview(options){
 const reader=new JournalKnowledgeEvidence(options);
 return {readMessages:input=>reader.readUserMessages({...input,preview:true})};
}
