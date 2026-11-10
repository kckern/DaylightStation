/**
 * The `ended` payload for a stored session, or null when it has no usable end
 * or no participants. Shared by every path that ends a session.
 */
export function endedPayloadFor(session, fallbackId = null) {
  const toMs = (raw) => (typeof raw === 'number' ? raw : (raw ? Date.parse(raw) : NaN));
  const endMs = toMs(session?.endTime);
  if (!Number.isFinite(endMs)) return null;
  const sessionId = String(session?.sessionId?.toString?.() ?? session?.sessionId ?? fallbackId ?? '');
  const learnerIds = Object.keys(session?.participants ?? {});
  if (!sessionId || !learnerIds.length) return null;
  return { sessionId, learnerIds, endMs, startMs: toMs(session?.startTime), finalized: session.finalized === true };
}

export default endedPayloadFor;
