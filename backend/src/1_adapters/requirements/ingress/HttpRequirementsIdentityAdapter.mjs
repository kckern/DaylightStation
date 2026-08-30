export class HttpRequirementsIdentityAdapter {
  actorFromRequest(req) {
    // X-Daylight-Device is an observability hint, not an authentication
    // credential. Only a verified token or the existing network-trust boundary
    // can establish an attesting actor in this foundation.
    const id = req.user?.sub ?? (req.isLocal ? 'trusted-local-network' : null);
    if (!id) throw Object.assign(new Error('Authentication required'), { name: 'RequirementsApplicationError', code: 'UNAUTHENTICATED', status: 401 });
    return Object.freeze({
      id,
      kind: req.user?.sub ? 'user' : 'network',
      roles: Object.freeze([...(req.roles ?? req.user?.roles ?? [])]),
      authenticatedBy: req.user?.sub ? 'token' : 'network_trust',
    });
  }
}
export default HttpRequirementsIdentityAdapter;
