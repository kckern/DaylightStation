/**
 * Guards triage writes. Requires a live, revocable login session (tokenResolver sets req.user
 * only for a non-revoked session; a bearer token without a session has sid null and is refused)
 * whose user is the triage user. No localhost bypass: that is browser-only (AuthGate).
 */
export function requireOwnerSession(req, res, next) {
  const user = req.user;
  if (!user || !user.sub || !user.sid) {
    return res.status(401).json({ error: 'login_required' });
  }
  if (user.sub !== req.triageUsername) {
    return res.status(403).json({ error: 'session_user_mismatch' });
  }
  req.triageSession = { username: user.sub, sid: user.sid };
  next();
}
