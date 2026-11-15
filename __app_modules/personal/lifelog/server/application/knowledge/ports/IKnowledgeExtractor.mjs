/** Bounded journal proposal extraction; model output never mutates the store. */
export class IKnowledgeExtractor {
  async extract({ messages, openLoops, roster, askedLoops, timezone, asOf }) { throw new Error('IKnowledgeExtractor.extract must be implemented'); }
}
