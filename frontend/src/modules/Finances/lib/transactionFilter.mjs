/**
 * Drawer transaction filtering. Null-safe: statement/bridge mortgage rows and
 * synthesized "Anticipated" rows may lack tagNames or description.
 */
export function matchesTransactionFilter(transaction, filter = {}) {
  const { tags, description, label, bucket } = filter || {};
  if (tags && !tags.some((tag) => (transaction.tagNames || []).includes(tag))) return false;
  if (description && !(transaction.description || '').includes(description)) return false;
  if (label && transaction.label !== label) return false;
  if (bucket && transaction.bucket !== bucket) return false;
  return true;
}
