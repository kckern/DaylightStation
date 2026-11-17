import { JournalKnowledgeEvidence, journalSourceId } from '../adapters/knowledge/JournalKnowledgeEvidence.mjs';
/** Read-only authored provenance port; enabling KB maintenance is not required. */
export function createAuthoredJournalEvidence(options) {
  const evidence = new JournalKnowledgeEvidence(options);
  return {
    readByRefs: input => evidence.readByRefs({
      ...input,
      preview: false
    }),
    readRevocations: input => evidence.readRevocations(input),
    async readForMessage({
      username,
      conversationId,
      messageId,
      revision
    }) {
      const sourceId = journalSourceId(username, conversationId, String(messageId), revision);
      const rows = await evidence.readByRefs({
        username,
        refs: ['journalist:msg:' + sourceId],
        preview: false
      });
      return rows.length === 1 ? rows[0] : null;
    }
  };
}
