export class IRequirementsEventPublisher {
  async publish(_publicationEnvelopes) { throw new Error('IRequirementsEventPublisher.publish must be implemented'); }
}
export default IRequirementsEventPublisher;
