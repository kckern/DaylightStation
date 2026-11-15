/** IKnowledgeStore boundary. @interface */
export class IKnowledgeStore {
  async read(_args) { throw new Error('IKnowledgeStore.read must be implemented'); }
  async commit(_args) { throw new Error('IKnowledgeStore.commit must be implemented'); }
  async recover(_args) { throw new Error('IKnowledgeStore.recover must be implemented'); }
  async close() { throw new Error('IKnowledgeStore.close must be implemented'); }
}
export default IKnowledgeStore;
