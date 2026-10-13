/**
 * Application-owned media stream port.
 *
 * open({ source, method, range, signal }) returns only
 * categorical outcomes: opened, unauthorized, range_not_satisfiable, or
 * upstream_error. Concrete HTTP, redirects, provider origins, and response
 * translation belong to the implementing adapter.
 */
export class ILibraryMediaStreamGateway {
  async open(_request) {
    throw new Error('ILibraryMediaStreamGateway.open must be implemented');
  }
}
