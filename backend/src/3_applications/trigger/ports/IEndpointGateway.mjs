/**
 * Port: what the trigger app needs to call a named endpoint/script.
 * @module applications/trigger/ports/IEndpointGateway
 */
export const IEndpointGateway = { async call(_ref, _params) {} };
export function isEndpointGateway(o) { return !!o && typeof o.call === 'function'; }
export default IEndpointGateway;
