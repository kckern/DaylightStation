import { getFileStats } from '#system/utils/FileIO.mjs';

// A storage token, not a gameplay revision. Replacement and same-size edits
// invalidate it; missing files are distinct from unsupported versioning.
export function storageVersion(file) {
  if (!file) return null;
  try {
    const stat = getFileStats(file);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
