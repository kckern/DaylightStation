/** Verified journal receipts. Cursor is opaque; consumers pass it back unchanged. */
export class IKnowledgeEvidence {
  async readUserMessages({ username, after, through, preview = false }) { throw new Error('IKnowledgeEvidence.readUserMessages must be implemented'); }
  async readByRefs({ username, refs, preview = false }) { throw new Error('IKnowledgeEvidence.readByRefs must be implemented'); }
}
