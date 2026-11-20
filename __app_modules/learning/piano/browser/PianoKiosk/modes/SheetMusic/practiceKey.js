/**
 * practiceKey — identity + hands-bucket helpers for the practice record (§C).
 * The slug is the shared one from portable/music/practiceKey.mjs, so the kiosk
 * and the server always file a score under the same key.
 */
import { practiceKeyOfScore as practiceKeyOf } from '../../../../portable/music/practiceKey.mjs';

export { practiceKeyOf };

/** Hands bucket for the practice record: non-grand-staff collapses to 'both'. */
export function bucketOf(grandStaff, activeParts) {
  if (!grandStaff) return 'both';
  const rh = !!activeParts?.[0];
  const lh = !!activeParts?.[1];
  return rh && lh ? 'both' : rh ? 'rh' : 'lh';
}

export default { practiceKeyOf, bucketOf };
