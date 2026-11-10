// A scoped controller handles physical input before it becomes an assignment.
// Without a capture, preserve the existing assignment and cosmetic feedback.
export function dispatchRiderSelection(data, { route, ingest, emit, toast }) {
  if (route?.(data) === true) return;
  if (!data?.userId) return;
  ingest(data);
  if (emit(data) !== true) toast(data);
}
