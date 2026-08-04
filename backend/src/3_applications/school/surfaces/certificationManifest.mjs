// backend/src/3_applications/school/surfaces/certificationManifest.mjs
import nodeFs from 'node:fs';

export const CERTIFICATION_MANIFEST_SCHEMA = 'school.certification-manifest/v1';

/** Recursively sort object keys so structurally-equal values serialize identically. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((sorted, key) => {
      sorted[key] = sortKeys(value[key]);
      return sorted;
    }, {});
  }
  return value;
}

/**
 * Task 10's certification row minus its digests (which become the entry
 * key) and its `moduleVerdicts` (module-level detail not persisted in the
 * manifest — only the rolled-up verdict/reasons/warnings).
 */
function toEntry(row) {
  const {
    address, surfaceId, baseline, verdict, reasons, warnings, resource,
  } = row;
  return {
    address,
    surfaceId,
    ...(baseline ? { baseline } : {}),
    verdict,
    reasons,
    warnings,
    ...(resource ? { resource } : {}),
  };
}

/**
 * Serialize certification rows (spec §8) to the on-disk manifest. Sorted
 * keys + trailing newline make byte-identical output for identical input
 * regardless of row order (determinism, spec §8 / acceptance §12.6).
 *
 * @param {object} params
 * @param {object[]} params.rows - Certification rows from GetSurfaceCertification.
 * @param {string} params.path - Destination file path.
 * @param {{writeFileSync: Function}} [params.fs] - Injectable fs (defaults to node:fs).
 */
export function writeManifest({ rows, path, fs = nodeFs }) {
  const entries = {};
  for (const row of rows) {
    entries[`${row.contentDigest}:${row.profileDigest}`] = toEntry(row);
  }
  const manifest = { schema: CERTIFICATION_MANIFEST_SCHEMA, entries };
  const json = JSON.stringify(sortKeys(manifest), null, 2);
  fs.writeFileSync(path, `${json}\n`);
}

/**
 * Read the on-disk manifest. Never throws for absence (spec §7.3: degrade
 * to on-demand certification) — a missing file yields empty entries.
 *
 * @param {object} params
 * @param {string} params.path - Manifest file path.
 * @param {{readFileSync: Function, existsSync: Function}} [params.fs] - Injectable fs.
 * @returns {{schema: string, entries: object}}
 */
export function readManifest({ path, fs = nodeFs }) {
  if (!fs.existsSync(path)) {
    return { schema: CERTIFICATION_MANIFEST_SCHEMA, entries: {} };
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

export default { writeManifest, readManifest };
