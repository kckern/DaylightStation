export class IStateGatesEventPublisher {
  async publish(_publicationEnvelopes) { throw new Error('IStateGatesEventPublisher.publish must be implemented'); }
}
export default IStateGatesEventPublisher;
