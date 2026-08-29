/**
 * Port: what the trigger app needs to call a named endpoint/script.
 * @module applications/trigger/ports/IEndpointGateway
 */
export class IEndpointGateway {
  async call(_ref, _params) { throw new Error('IEndpointGateway.call not implemented'); }
}
export function isEndpointGateway(o) { return !!o && typeof o.call === 'function'; }
export default IEndpointGateway;
