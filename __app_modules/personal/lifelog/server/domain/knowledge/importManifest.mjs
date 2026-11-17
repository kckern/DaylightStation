import crypto from 'node:crypto';
export const importJson = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
export const importDigest = value => crypto.createHash('sha256').update(importJson(value)).digest('hex');
export const validSourceHashes = value => value != null && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key, digest]) => key.length > 0 && /^[a-f0-9]{64}$/.test(digest));
export function validImportManifest(manifest) {
  return manifest?.schema === 'knowledge-import/v1' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(manifest.jobId ?? '') && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(manifest.username ?? '') && Number.isFinite(manifest.from) && Number.isFinite(manifest.asOf) && manifest.from <= manifest.asOf && manifest.asOf - manifest.from <= 90 * 86400000 && validSourceHashes(manifest.sourceHashes);
}
