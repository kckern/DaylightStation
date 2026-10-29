// An app may consume the cosmetic selector feedback, never the assignment.
export function dispatchRiderSelection(data, { ingest, emit, toast }) {
  ingest(data);
  if (emit(data) !== true) toast(data);
}
