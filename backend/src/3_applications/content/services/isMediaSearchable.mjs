/**
 * Runtime capability check for optional media-search support on an injected
 * content source. This is application orchestration, not a domain port: content
 * sources already conform to their primary ContentSource contract.
 */
export function isMediaSearchable(value) {
  if (value === null || value === undefined || typeof value !== 'object' ||
      typeof value.search !== 'function' || typeof value.getSearchCapabilities !== 'function') {
    return false;
  }
  try {
    const capabilities = value.getSearchCapabilities();
    return Boolean(capabilities) && Array.isArray(capabilities.canonical) && Array.isArray(capabilities.specific);
  } catch {
    return false;
  }
}
