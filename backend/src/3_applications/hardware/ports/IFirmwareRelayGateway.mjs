export class IFirmwareRelayGateway {
  subscribe(_listener) { throw new Error('subscribe must be implemented'); }
  publish(_deviceId, _event) { throw new Error('publish must be implemented'); }
}
export function isFirmwareRelayGateway(value) {
  return value != null && typeof value.subscribe === 'function' && typeof value.publish === 'function';
}
export default IFirmwareRelayGateway;
