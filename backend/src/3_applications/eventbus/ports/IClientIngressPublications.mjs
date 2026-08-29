/** Semantic publications available to client-ingress application policy. */
export class IClientIngressPublications {
  sendAuthorizationAck() { throw new Error('sendAuthorizationAck must be implemented'); }
  publishCall() { throw new Error('publishCall must be implemented'); }
  publishFitness() { throw new Error('publishFitness must be implemented'); }
  publishMidi() { throw new Error('publishMidi must be implemented'); }
  publishHomeline() { throw new Error('publishHomeline must be implemented'); }
  publishDeviceState() { throw new Error('publishDeviceState must be implemented'); }
  publishDeviceAck() { throw new Error('publishDeviceAck must be implemented'); }
  publishRelay() { throw new Error('publishRelay must be implemented'); }
  clientMetadata() { throw new Error('clientMetadata must be implemented'); }
}

export default IClientIngressPublications;
