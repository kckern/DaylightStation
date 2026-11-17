/** IKnowledgeLedger boundary. @interface */
export class IKnowledgeLedger {
  async prepare(_args) { throw new Error('IKnowledgeLedger.prepare must be implemented'); }
  async complete(_args) { throw new Error('IKnowledgeLedger.complete must be implemented'); }
  async read(_args) { throw new Error('IKnowledgeLedger.read must be implemented'); }
  async repair(_args) { throw new Error('IKnowledgeLedger.repair must be implemented'); }
}
export default IKnowledgeLedger;
