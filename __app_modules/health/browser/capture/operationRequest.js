/** Reuse an operation ID for retrying the same request; edited input is a new intent. */
export function operationRequest(ref, payload) {
  const fingerprint = JSON.stringify(payload);
  if (ref.current?.fingerprint !== fingerprint) ref.current = { fingerprint, id: crypto.randomUUID() };
  return { ...payload, operationId: ref.current.id };
}
