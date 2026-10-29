/**
 * The teacher console's capability, as a sub-router reads it.
 *
 * The cookie's path is `/api/v1/school`, so it reaches every router mounted
 * under the school router — but only `createSchoolRouter` injects it into a
 * POST body. A sub-router's GET has no body, so it reads the cookie itself.
 * Same shape `createSchoolRouter`'s own `capabilityProof` returns.
 *
 * @module api/teacherCapabilityProof
 */
const COOKIE = 'daylight_teacher_session';

/** `{capabilityToken, stepUpToken}` from the request, or null when there is no cookie. */
export function capabilityProof(req) {
  const raw = String(req.get('cookie') ?? '');
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== COOKIE) continue;
    try {
      const capabilityToken = decodeURIComponent(part.slice(at + 1).trim());
      return capabilityToken ? { capabilityToken, stepUpToken: req.get('X-Teacher-Step-Up') ?? null } : null;
    } catch { return null; }
  }
  return null;
}

/**
 * Who is asking: the capability session's own teacher when the cookie holds
 * one, else the id the client named. The cookie outranks the query — a query
 * naming someone else would be attribution the gate never checked.
 */
export function teacherActorId(req, teacherCapabilitySessions, claimed = null) {
  const proof = capabilityProof(req);
  const session = proof ? teacherCapabilitySessions?.status?.(proof.capabilityToken) : null;
  return (session?.active ? session.userId : null) ?? claimed ?? null;
}
