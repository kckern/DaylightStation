/** Realtime status input and Fleet publication capabilities for playback hubs. */
export class IHubFleetRealtimeGateway {
  observeHubStatus(_handler) { throw new Error('observeHubStatus must be implemented'); }
  publishDeviceState(_publication) { throw new Error('publishDeviceState must be implemented'); }
}

export default IHubFleetRealtimeGateway;
