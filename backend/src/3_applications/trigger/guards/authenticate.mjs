/**
 * Authenticate stage. Passes when no token is configured for the (source,
 * location) or when the provided token matches. Layer: APPLICATION.
 * @module applications/trigger/guards/authenticate
 */
export function authenticate({ expectedToken, providedToken }) {
  if (expectedToken && expectedToken !== providedToken) {
    return { ok: false, code: 'AUTH_FAILED' };
  }
  return { ok: true };
}
export default authenticate;
