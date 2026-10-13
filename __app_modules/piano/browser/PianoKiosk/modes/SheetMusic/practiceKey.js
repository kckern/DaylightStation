/**
 * practiceKey — identity + hands-bucket helpers for the practice record (§C).
 * The slug must satisfy the backend's /^[a-z0-9-]{1,120}$/ (dots corrupt YAML
 * filenames — FileIO appends .yml by inspecting the trailing extension).
 */
export function practiceKeyOf(contentId) {
  return String(contentId || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Hands bucket for the practice record: non-grand-staff collapses to 'both'. */
export function bucketOf(grandStaff, activeParts) {
  if (!grandStaff) return 'both';
  const rh = !!activeParts?.[0];
  const lh = !!activeParts?.[1];
  return rh && lh ? 'both' : rh ? 'rh' : 'lh';
}

export default { practiceKeyOf, bucketOf };
