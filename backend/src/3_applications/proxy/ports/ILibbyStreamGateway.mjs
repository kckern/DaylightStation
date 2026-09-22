/**
 * Application-owned media stream port.
 *
 * open({ source, method, range, signal }) returns only
 * categorical outcomes: opened, unauthorized, range_not_satisfiable, or
 * upstream_error. Concrete HTTP, redirects, provider origins, and response
 * translation belong to the implementing adapter.
 */
export class ILibbyStreamGateway {
  async open(_request) {
    throw new Error('ILibbyStreamGateway.open must be implemented');
  }
}
